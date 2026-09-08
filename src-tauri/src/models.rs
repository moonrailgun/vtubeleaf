use serde::Serialize;
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
};

const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 256 * 1024 * 1024;
const MAX_ENTRIES: usize = 2048;
const MAX_ICON_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Clone, Serialize)]
pub struct ModelInfo {
    pub id: String,
    pub path: String,
    pub name: String,
    pub entry: String,
    pub files: Vec<String>,
}

#[derive(Serialize)]
pub struct Library {
    pub directory: String,
    pub models: Vec<ModelInfo>,
    pub errors: Vec<String>,
}

struct Model {
    root: PathBuf,
    entry: PathBuf,
    files: Vec<String>,
    icon: Option<String>,
    vts_warning: Option<String>,
}

#[derive(Default)]
pub struct Registry {
    models: BTreeMap<String, Model>,
    next_id: u64,
}

impl Registry {
    pub fn load(&mut self, path: &Path, data_dir: &Path) -> Result<ModelInfo, String> {
        let destination = data_dir.join("models");
        fs::create_dir_all(&destination).map_err(|_| "无法创建角色文件夹")?;
        let destination = destination
            .canonicalize()
            .map_err(|_| "无法访问角色文件夹")?;
        let model = if path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("zip"))
        {
            import_zip(path, &destination)?
        } else {
            let source = validate_model(path)?;
            if source.entry.starts_with(&destination) {
                source
            } else {
                copy_model(&source, &destination)?
            }
        };
        self.register(model)
    }

    fn register(&mut self, model: Model) -> Result<ModelInfo, String> {
        let id = self
            .models
            .iter()
            .find_map(|(id, existing)| (existing.entry == model.entry).then(|| id.clone()))
            .unwrap_or_else(|| {
                self.next_id += 1;
                format!("model-{}", self.next_id)
            });
        let entry = model
            .entry
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or("模型文件名必须是有效的 UTF-8")?
            .to_owned();
        let info = ModelInfo {
            id: id.clone(),
            path: model
                .entry
                .to_str()
                .ok_or("模型路径必须是有效的 UTF-8")?
                .to_owned(),
            name: entry.trim_end_matches(".model3.json").to_owned(),
            entry,
            files: model.files.clone(),
        };
        self.models.insert(id, model);
        Ok(info)
    }

    pub fn list(&mut self, data_dir: &Path) -> Result<Library, String> {
        let directory = data_dir.join("models");
        fs::create_dir_all(&directory).map_err(|_| "无法创建角色文件夹")?;
        let mut library = Library {
            directory: directory.to_string_lossy().into_owned(),
            models: Vec::new(),
            errors: Vec::new(),
        };
        for entry in fs::read_dir(&directory).map_err(|_| "无法读取角色文件夹")? {
            let entry = entry.map_err(|_| "无法读取角色目录")?;
            if !entry.file_type().map_err(|_| "无法检查角色目录")?.is_dir() {
                continue;
            }
            match validate_model(&entry.path()).and_then(|model| self.register(model)) {
                Ok(info) => library.models.push(info),
                Err(error) => library
                    .errors
                    .push(format!("{}：{error}", entry.file_name().to_string_lossy())),
            }
        }
        library
            .models
            .sort_by(|a, b| a.name.cmp(&b.name).then(a.path.cmp(&b.path)));
        Ok(library)
    }

    fn preview_path(&self, id: &str, data_dir: &Path) -> Result<PathBuf, String> {
        let model = self.models.get(id).ok_or("模型尚未加载")?;
        let directory = data_dir
            .join("models")
            .canonicalize()
            .map_err(|_| "无法访问角色文件夹")?;
        let relative = model
            .entry
            .strip_prefix(directory)
            .map_err(|_| "模型不在角色库中")?;
        let key = relative
            .components()
            .next()
            .ok_or("角色路径无效")?
            .as_os_str();
        Ok(data_dir.join("avatars").join(key).with_extension("png"))
    }

    pub fn read_preview(&self, id: &str, data_dir: &Path) -> Result<Vec<u8>, String> {
        let model = self.models.get(id).ok_or("模型尚未加载")?;
        if let Some(icon) = &model.icon {
            if let Ok(bytes) = checked_resource(&model.root, icon)
                .and_then(|path| read_bounded(&path, MAX_ICON_BYTES))
            {
                return Ok(bytes);
            }
        }
        let path = self.preview_path(id, data_dir)?;
        if !path.exists() {
            return Ok(Vec::new());
        }
        read_bounded(&path, 512 * 1024)
    }

    pub fn save_preview(&self, id: &str, data_dir: &Path, png: &[u8]) -> Result<(), String> {
        if png.len() < 24
            || png.len() > 512 * 1024
            || &png[..8] != b"\x89PNG\r\n\x1a\n"
            || &png[12..16] != b"IHDR"
            || [
                u32::from_be_bytes(png[16..20].try_into().unwrap()),
                u32::from_be_bytes(png[20..24].try_into().unwrap()),
            ]
            .iter()
            .any(|size| *size == 0 || *size > 512)
        {
            return Err("角色预览必须是 512 × 512 以内的 PNG 图片".into());
        }
        let path = self.preview_path(id, data_dir)?;
        let parent = path.parent().ok_or("预览路径无效")?;
        fs::create_dir_all(parent).map_err(|_| "无法创建预览文件夹")?;
        let mut staging =
            tempfile::NamedTempFile::new_in(parent).map_err(|_| "无法创建预览文件")?;
        staging.write_all(png).map_err(|_| "无法保存角色预览")?;
        staging.persist(path).map_err(|_| "无法保存角色预览")?;
        Ok(())
    }

    pub fn read(&self, id: &str, resource: &str) -> Result<Vec<u8>, String> {
        validate_resource(resource)?;
        let model = self.models.get(id).ok_or("模型尚未加载，请重新导入")?;
        if !model.files.iter().any(|file| file == resource) {
            return Err("禁止读取模型未声明的资源".into());
        }
        let path = checked_resource(&model.root, resource)?;
        read_bounded(&path, MAX_FILE_BYTES)
    }

    pub fn read_vts_config(&self, id: &str) -> Result<Option<Value>, String> {
        let model = self.models.get(id).ok_or("模型尚未加载")?;
        if let Some(warning) = &model.vts_warning {
            return Err(warning.clone());
        }
        super::vts::model_config(&model.entry).map(|config| config.map(|(_, value)| value))
    }
}

fn copy_model(source: &Model, destination: &Path) -> Result<Model, String> {
    let staging = tempfile::Builder::new()
        .prefix("model-")
        .tempdir_in(destination)
        .map_err(|_| "无法创建角色目录")?;
    let mut total = 0;
    for resource in &source.files {
        let input = checked_resource(&source.root, resource)?;
        let bytes = read_bounded(&input, MAX_FILE_BYTES)?;
        total += bytes.len() as u64;
        if total > MAX_TOTAL_BYTES {
            return Err("模型资源总大小超过 256 MB".into());
        }
        let target = staging.path().join(resource);
        fs::create_dir_all(target.parent().ok_or("资源路径无效")?)
            .map_err(|_| "无法创建角色资源目录")?;
        fs::write(target, bytes).map_err(|_| "无法复制角色资源，请检查磁盘空间")?;
    }
    // Optional VTS data must never prevent an otherwise valid model from loading.
    let vts_warning = (|| -> Result<(), String> {
        if let Some((name, value)) = super::vts::model_config(&source.entry)? {
            validate_resource(&name)?;
            let bytes = serde_json::to_vec(&value).map_err(|_| "无法保存 VTS 配置")?;
            fs::write(staging.path().join(name), bytes).map_err(|_| "无法复制 VTS 配置")?;
        }
        Ok(())
    })()
    .err();
    let mut model = validate_model(staging.path())?;
    model.vts_warning = vts_warning;
    let _ = staging.keep();
    Ok(model)
}

fn validate_resource(resource: &str) -> Result<(), String> {
    if resource.is_empty()
        || resource.len() > 1024
        || resource
            .chars()
            .any(|c| c.is_control() || "\\:%?#".contains(c))
    {
        return Err("模型资源路径不安全".into());
    }
    for component in resource.split('/') {
        let stem = component
            .split('.')
            .next()
            .unwrap_or_default()
            .to_ascii_uppercase();
        let device = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || (stem.len() == 4
                && (stem.starts_with("COM") || stem.starts_with("LPT"))
                && matches!(stem.as_bytes()[3], b'1'..=b'9'));
        if component.is_empty()
            || component == "."
            || component == ".."
            || component.ends_with(['.', ' '])
            || device
        {
            return Err("模型资源路径不安全".into());
        }
    }
    Ok(())
}

fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let file = File::open(path).map_err(|_| "无法读取模型资源，请确认文件仍然存在")?;
    let metadata = file.metadata().map_err(|_| "无法检查模型资源")?;
    if !metadata.is_file() || metadata.len() > limit {
        return Err("模型资源不是普通文件或超过大小限制".into());
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "读取模型资源失败")?;
    if bytes.len() as u64 > limit {
        return Err("模型资源超过大小限制".into());
    }
    Ok(bytes)
}

fn checked_resource(root: &Path, resource: &str) -> Result<PathBuf, String> {
    validate_resource(resource)?;
    let path = root
        .join(resource)
        .canonicalize()
        .map_err(|_| format!("缺少模型资源：{resource}"))?;
    if !path.starts_with(root) {
        return Err("模型资源链接超出模型目录".into());
    }
    let metadata = fs::metadata(&path).map_err(|_| "无法检查模型资源")?;
    if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
        return Err("模型资源不是普通文件或超过 64 MB".into());
    }
    Ok(path)
}

fn find_entry(path: &Path) -> Result<PathBuf, String> {
    if path.is_file() {
        if !path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.ends_with(".model3.json"))
        {
            return Err("请选择 .model3.json 文件或模型目录".into());
        }
        return path.canonicalize().map_err(|_| "无法访问模型入口".into());
    }
    let mut pending = vec![(path.to_owned(), 0)];
    let mut count = 0;
    let mut found = None;
    while let Some((directory, depth)) = pending.pop() {
        if depth > 16 {
            return Err("模型目录层级过深".into());
        }
        for entry in fs::read_dir(directory).map_err(|_| "无法读取模型目录")? {
            let entry = entry.map_err(|_| "无法读取模型目录内容")?;
            count += 1;
            if count > MAX_ENTRIES {
                return Err("模型目录文件数超过 2048".into());
            }
            let kind = entry.file_type().map_err(|_| "无法检查模型目录内容")?;
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                pending.push((entry.path(), depth + 1));
            } else if kind.is_file()
                && entry
                    .file_name()
                    .to_str()
                    .is_some_and(|name| name.ends_with(".model3.json"))
            {
                if found.is_some() {
                    return Err("目录包含多个模型，请直接选择需要的 .model3.json".into());
                }
                found = Some(entry.path());
            }
        }
    }
    found
        .ok_or_else(|| "未找到 .model3.json 模型入口".to_owned())?
        .canonicalize()
        .map_err(|_| "无法访问模型入口".into())
}

fn validate_model(path: &Path) -> Result<Model, String> {
    let entry = find_entry(path)?;
    let root = entry.parent().ok_or("模型入口没有有效目录")?.to_owned();
    let document: Value = serde_json::from_slice(&read_bounded(&entry, MAX_FILE_BYTES)?)
        .map_err(|_| "模型入口不是有效的 JSON")?;
    if document.get("Version").and_then(Value::as_u64) != Some(3) {
        return Err("仅支持 Cubism 3/4/5 的 model3.json 模型".into());
    }
    let refs = document
        .get("FileReferences")
        .and_then(Value::as_object)
        .ok_or("模型入口缺少 FileReferences")?;
    let mut resources = BTreeSet::new();
    let mut add = |value: Option<&Value>| -> Result<(), String> {
        let resource = value
            .and_then(Value::as_str)
            .ok_or("模型入口包含无效资源引用")?;
        validate_resource(resource)?;
        resources.insert(resource.to_owned());
        if resources.len() > MAX_ENTRIES {
            return Err("模型资源数超过 2048".into());
        }
        Ok(())
    };
    add(refs.get("Moc"))?;
    let textures = refs
        .get("Textures")
        .and_then(Value::as_array)
        .filter(|items| !items.is_empty())
        .ok_or("模型入口缺少纹理")?;
    for texture in textures {
        add(Some(texture))?;
    }
    for key in ["Physics", "Pose", "UserData", "DisplayInfo"] {
        if let Some(value) = refs.get(key) {
            add(Some(value))?;
        }
    }
    if let Some(expressions) = refs.get("Expressions") {
        for expression in expressions.as_array().ok_or("模型表情引用无效")? {
            add(expression.get("File"))?;
        }
    }
    if let Some(groups) = refs.get("Motions") {
        for motions in groups.as_object().ok_or("模型动作引用无效")?.values() {
            for motion in motions.as_array().ok_or("模型动作列表无效")? {
                add(motion.get("File"))?;
                if let Some(sound) = motion.get("Sound") {
                    add(Some(sound))?;
                }
            }
        }
    }
    resources.insert(
        entry
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or("模型入口文件名无效")?
            .to_owned(),
    );
    let icon = find_icon(&root, &entry, &resources);
    if let Some(icon) = &icon {
        resources.insert(icon.clone());
    }
    if resources.len() > MAX_ENTRIES {
        return Err("模型资源数超过 2048".into());
    }
    let mut total = 0;
    for resource in &resources {
        let file = checked_resource(&root, resource)?;
        total += fs::metadata(file).map_err(|_| "无法检查模型资源")?.len();
        if total > MAX_TOTAL_BYTES {
            return Err("模型资源总大小超过 256 MB".into());
        }
    }
    Ok(Model {
        root,
        entry,
        files: resources.into_iter().collect(),
        icon,
        vts_warning: None,
    })
}

fn find_icon(root: &Path, entry: &Path, resources: &BTreeSet<String>) -> Option<String> {
    let model_name = entry
        .file_name()?
        .to_str()?
        .trim_end_matches(".model3.json")
        .to_lowercase();
    let names = [
        "icon".to_owned(),
        format!("ico_{model_name}"),
        format!("{model_name}_icon"),
        "avatar".to_owned(),
        "portrait".to_owned(),
        "thumbnail".to_owned(),
        "preview".to_owned(),
        model_name,
    ];
    fs::read_dir(root)
        .ok()?
        .take(MAX_ENTRIES)
        .filter_map(|entry| {
            let entry = entry.ok()?;
            if !entry.file_type().ok()?.is_file() {
                return None;
            }
            let path = entry.path();
            let extension = path.extension()?.to_str()?.to_ascii_lowercase();
            if !matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "webp") {
                return None;
            }
            let name = entry.file_name().to_str()?.to_owned();
            if resources.contains(&name) {
                return None;
            }
            let stem = path.file_stem()?.to_str()?.to_lowercase();
            let priority = names.iter().position(|name| name == &stem)?;
            let path = checked_resource(root, &name).ok()?;
            if fs::metadata(path).ok()?.len() > MAX_ICON_BYTES {
                return None;
            }
            Some((priority, name))
        })
        .min()
        .map(|(_, name)| name)
}

fn import_zip(archive: &Path, destination: &Path) -> Result<Model, String> {
    let file = File::open(archive).map_err(|_| "无法读取 ZIP 文件")?;
    if file.metadata().map_err(|_| "无法检查 ZIP 文件")?.len() > MAX_TOTAL_BYTES {
        return Err("ZIP 文件超过 256 MB".into());
    }
    let mut archive = zip::ZipArchive::new(file).map_err(|_| "不是有效的 ZIP 文件")?;
    if archive.len() > MAX_ENTRIES {
        return Err("ZIP 文件数超过 2048".into());
    }
    fs::create_dir_all(destination).map_err(|_| "无法创建模型保存目录")?;
    let staging = tempfile::Builder::new()
        .prefix("model-")
        .tempdir_in(destination)
        .map_err(|_| "无法创建模型临时目录")?;
    let mut names = BTreeSet::new();
    let mut total = 0;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|_| "ZIP 包含无法读取的文件")?;
        let directory = entry.is_dir();
        let name = entry.name().strip_suffix('/').unwrap_or(entry.name());
        validate_resource(name)?;
        if !names.insert(name.to_lowercase()) {
            return Err("ZIP 包含重复文件路径".into());
        }
        if let Some(mode) = entry.unix_mode() {
            let kind = mode & 0o170000;
            if kind != 0 && kind != 0o100000 && kind != 0o040000 {
                return Err("ZIP 不允许符号链接或特殊文件".into());
            }
            if (kind == 0o040000) != directory && kind != 0 {
                return Err("ZIP 文件类型无效".into());
            }
        }
        if entry.size() > MAX_FILE_BYTES || entry.size() > MAX_TOTAL_BYTES - total {
            return Err("ZIP 解压大小超过限制".into());
        }
        let output_path = staging.path().join(name);
        if directory {
            fs::create_dir_all(output_path).map_err(|_| "ZIP 目录结构冲突")?;
        } else {
            fs::create_dir_all(output_path.parent().ok_or("ZIP 路径无效")?)
                .map_err(|_| "无法创建模型资源目录")?;
            let mut output = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(output_path)
                .map_err(|_| "ZIP 资源路径冲突或无法写入")?;
            let remaining = MAX_FILE_BYTES.min(MAX_TOTAL_BYTES - total);
            let copied = io::copy(&mut entry.by_ref().take(remaining + 1), &mut output)
                .map_err(|_| "ZIP 资源解压失败")?;
            if copied > MAX_FILE_BYTES || copied > MAX_TOTAL_BYTES - total {
                return Err("ZIP 解压大小超过限制".into());
            }
            total += copied;
        }
    }
    let model = validate_model(staging.path())?;
    let _ = staging.keep();
    Ok(model)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, io::Write};
    use zip::write::SimpleFileOptions;

    #[test]
    #[ignore = "set VTUBELEAF_MODEL_FIXTURE to a local model3.json"]
    fn imports_supplied_model_and_reads_all_resources() {
        let path = std::env::var_os("VTUBELEAF_MODEL_FIXTURE").expect("model fixture path");
        let source = Path::new(&path).canonicalize().unwrap();
        let data = tempfile::tempdir().unwrap();
        let mut registry = Registry::default();
        let model = registry.load(Path::new(&path), data.path()).unwrap();
        assert!(model.files.iter().any(|file| file.ends_with(".moc3")));
        for resource in &model.files {
            assert_eq!(
                registry.read(&model.id, resource).unwrap(),
                fs::read(source.parent().unwrap().join(resource)).unwrap()
            );
        }
        assert_eq!(
            registry
                .load(Path::new(&model.path), data.path())
                .unwrap()
                .id,
            model.id
        );
        let source = Path::new(&model.path).parent().unwrap();
        assert_eq!(registry.load(source, data.path()).unwrap().id, model.id);
        let archive = data.path().join("supplied-model.zip");
        let mut zip = zip::ZipWriter::new(File::create(&archive).unwrap());
        for resource in &model.files {
            zip.start_file(format!("model/{resource}"), SimpleFileOptions::default())
                .unwrap();
            zip.write_all(&registry.read(&model.id, resource).unwrap())
                .unwrap();
        }
        zip.finish().unwrap();
        let imported = registry.load(&archive, data.path()).unwrap();
        assert_eq!(imported.files, model.files);
        assert_ne!(imported.path, model.path);
        for resource in &model.files {
            assert_eq!(
                registry.read(&imported.id, resource).unwrap(),
                registry.read(&model.id, resource).unwrap()
            );
        }
    }

    fn fixture(root: &Path) {
        fs::write(
            root.join("leaf.model3.json"),
            r#"{"Version":3,"FileReferences":{"Moc":"leaf.moc3","Textures":["texture.png"]}}"#,
        )
        .unwrap();
        fs::write(root.join("leaf.moc3"), b"MOC3").unwrap();
        fs::write(root.join("texture.png"), b"texture").unwrap();
        fs::write(root.join("private.txt"), b"unreferenced").unwrap();
    }

    #[test]
    fn imports_icons_and_reads_them_without_rendering() {
        let source = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        fixture(source.path());
        fs::write(source.path().join("Avatar.JPG"), b"avatar").unwrap();
        fs::write(source.path().join("ico_leaf.png"), b"icon").unwrap();
        let mut registry = Registry::default();
        for path in [
            source.path().to_owned(),
            source.path().join("leaf.model3.json"),
        ] {
            let info = registry.load(&path, data.path()).unwrap();
            assert_eq!(
                registry.read_preview(&info.id, data.path()).unwrap(),
                b"icon"
            );
            assert!(info.files.contains(&"ico_leaf.png".to_owned()));
        }
        source.close().unwrap();
        let mut restarted = Registry::default();
        for info in restarted.list(data.path()).unwrap().models {
            let png = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR\0\0\x01\0\0\0\x01\0";
            restarted.save_preview(&info.id, data.path(), png).unwrap();
            assert_eq!(
                restarted.read_preview(&info.id, data.path()).unwrap(),
                b"icon"
            );
            #[cfg(unix)]
            {
                let icon = Path::new(&info.path).parent().unwrap().join("ico_leaf.png");
                fs::remove_file(&icon).unwrap();
                let outside = data.path().join("private.png");
                fs::write(&outside, b"private").unwrap();
                std::os::unix::fs::symlink(&outside, &icon).unwrap();
                assert_eq!(restarted.read_preview(&info.id, data.path()).unwrap(), png);
            }
        }
    }

    #[test]
    fn copies_directory_and_file_imports_into_a_persistent_library() {
        let source = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        fixture(source.path());
        let config = br#"{"Version":1,"ParameterSettings":[],"Hotkeys":[]}"#;
        fs::write(source.path().join("leaf.vtube.json"), config).unwrap();
        let mut registry = Registry::default();
        let first = registry.load(source.path(), data.path()).unwrap();
        let second = registry
            .load(&source.path().join("leaf.model3.json"), data.path())
            .unwrap();
        assert!(Path::new(&first.path).starts_with(data.path().canonicalize().unwrap()));
        assert_ne!(first.path, second.path);
        source.close().unwrap();
        for info in [&first, &second] {
            let copied = fs::read(
                Path::new(&info.path)
                    .parent()
                    .unwrap()
                    .join("leaf.vtube.json"),
            )
            .expect("the adjacent VTS config must survive importing and removing the source");
            assert_eq!(
                serde_json::from_slice::<Value>(&copied).unwrap(),
                serde_json::from_slice::<Value>(config).unwrap()
            );
        }
        assert_eq!(registry.read(&first.id, "texture.png").unwrap(), b"texture");
        assert_eq!(registry.read(&second.id, "leaf.moc3").unwrap(), b"MOC3");
        let mut restarted = Registry::default();
        let library = restarted.list(data.path()).unwrap();
        assert_eq!(library.models.len(), 2);
        assert!(library.errors.is_empty());
        assert!(library.models.iter().any(|model| model.path == first.path));
        for model in &library.models {
            assert_eq!(
                restarted.read_vts_config(&model.id).unwrap().unwrap()["Version"],
                1
            );
        }
        let broken = data.path().join("models/broken");
        fs::create_dir(&broken).unwrap();
        let library = restarted.list(data.path()).unwrap();
        assert_eq!(library.models.len(), 2);
        assert_eq!(library.errors.len(), 1);
        let info = &library.models[0];
        assert!(restarted
            .read_preview(&info.id, data.path())
            .unwrap()
            .is_empty());
        assert!(restarted
            .save_preview(&info.id, data.path(), b"not png")
            .is_err());
        let png = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR\0\0\x01\0\0\0\x01\0";
        restarted.save_preview(&info.id, data.path(), png).unwrap();
        let mut next_run = Registry::default();
        let restored = next_run.load(Path::new(&info.path), data.path()).unwrap();
        assert_eq!(
            next_run.read_preview(&restored.id, data.path()).unwrap(),
            png
        );
    }

    #[test]
    fn optional_vts_config_survives_zip_and_bad_configs_do_not_block_import() {
        let source = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        fixture(source.path());
        let mut registry = Registry::default();
        let config = source.path().join("leaf.vtube.json");
        for contents in [
            b"not json".as_slice(),
            br#"{"FileReferences":{"Model":"other.model3.json"}}"#,
        ] {
            fs::write(&config, contents).unwrap();
            let model = registry.load(source.path(), data.path()).unwrap();
            assert!(registry.read_vts_config(&model.id).is_err());
            assert_eq!(registry.read(&model.id, "leaf.moc3").unwrap(), b"MOC3");
        }
        File::create(&config)
            .unwrap()
            .set_len(2 * 1024 * 1024 + 1)
            .unwrap();
        let model = registry.load(source.path(), data.path()).unwrap();
        assert!(registry
            .read_vts_config(&model.id)
            .unwrap_err()
            .contains("2 MB"));
        fs::remove_file(&config).unwrap();
        let model = registry.load(source.path(), data.path()).unwrap();
        assert_eq!(registry.read_vts_config(&model.id).unwrap(), None);
        assert!(registry.read_vts_config("unknown").is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(source.path().join("private.txt"), &config).unwrap();
            let model = registry.load(source.path(), data.path()).unwrap();
            assert!(registry
                .read_vts_config(&model.id)
                .unwrap_err()
                .contains("符号链接"));
            fs::remove_file(&config).unwrap();
        }
        fs::write(&config, br#"{"Version":1,"FileReferences":{"Model":"leaf.model3.json"},"ParameterSettings":[],"Hotkeys":[]}"#).unwrap();
        let archive = data.path().join("model.zip");
        let mut zip = zip::ZipWriter::new(File::create(&archive).unwrap());
        for name in [
            "leaf.model3.json",
            "leaf.moc3",
            "texture.png",
            "leaf.vtube.json",
        ] {
            zip.start_file(format!("model/{name}"), SimpleFileOptions::default())
                .unwrap();
            zip.write_all(&fs::read(source.path().join(name)).unwrap())
                .unwrap();
        }
        zip.finish().unwrap();
        let info = registry.load(&archive, data.path()).unwrap();
        assert_eq!(
            registry.read_vts_config(&info.id).unwrap().unwrap()["Version"],
            1
        );
        source.close().unwrap();
        let mut restarted = Registry::default();
        let info = restarted.load(Path::new(&info.path), data.path()).unwrap();
        assert_eq!(
            restarted.read_vts_config(&info.id).unwrap().unwrap()["Version"],
            1
        );
    }

    #[test]
    fn rejects_paths_that_can_leave_the_resource_scope() {
        for path in [
            "../secret",
            "/etc/passwd",
            "https://example.com/a",
            "file:///a",
            "C:/a",
            "a\\..\\b",
            "a/../b",
            "a//b",
            "a/%2e%2e/b",
            "a?x=1",
            "a#fragment",
            "./a",
            "a/NUL.png",
            "a/COM1",
            "a/trailing. ",
            "",
        ] {
            assert!(validate_resource(path).is_err(), "accepted {path}");
        }
        assert!(validate_resource("textures/纹理 00.png").is_ok());
    }

    #[test]
    fn exposes_only_referenced_files_and_rejects_missing_assets() {
        let root = tempfile::tempdir().unwrap();
        fixture(root.path());
        let model = validate_model(root.path()).unwrap();
        assert_eq!(
            model.files,
            ["leaf.moc3", "leaf.model3.json", "texture.png"]
        );
        fs::remove_file(root.path().join("texture.png")).unwrap();
        assert!(validate_model(root.path()).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_resource_symlinks_escaping_the_model() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fixture(root.path());
        fs::write(outside.path().join("secret"), b"secret").unwrap();
        fs::remove_file(root.path().join("texture.png")).unwrap();
        std::os::unix::fs::symlink(
            outside.path().join("secret"),
            root.path().join("texture.png"),
        )
        .unwrap();
        assert!(validate_model(root.path()).is_err());
    }

    #[test]
    fn registry_rejects_unregistered_files_and_rechecks_sizes_on_each_read() {
        let root = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        fixture(root.path());
        let mut registry = Registry::default();
        let info = registry.load(root.path(), data.path()).unwrap();
        let again = registry.load(Path::new(&info.path), data.path()).unwrap();
        assert_eq!(info.id, again.id);
        assert_eq!(registry.read(&info.id, "texture.png").unwrap(), b"texture");
        assert!(registry.read(&info.id, "private.txt").is_err());
        assert!(registry.read("unknown", "texture.png").is_err());
        File::create(Path::new(&info.path).parent().unwrap().join("texture.png"))
            .unwrap()
            .set_len(MAX_FILE_BYTES + 1)
            .unwrap();
        assert!(registry.read(&info.id, "texture.png").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn registry_rejects_symlink_replacement_after_import() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fixture(root.path());
        let mut registry = Registry::default();
        let info = registry.load(root.path(), outside.path()).unwrap();
        fs::write(outside.path().join("secret"), b"private").unwrap();
        fs::remove_file(Path::new(&info.path).parent().unwrap().join("texture.png")).unwrap();
        std::os::unix::fs::symlink(
            outside.path().join("secret"),
            Path::new(&info.path).parent().unwrap().join("texture.png"),
        )
        .unwrap();
        assert!(registry.read(&info.id, "texture.png").is_err());
    }

    #[test]
    fn imports_zip_to_unique_directories_and_keeps_only_valid_imports() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source");
        fs::create_dir(&source).unwrap();
        fixture(&source);
        fs::write(source.join("icon.png"), b"icon").unwrap();
        let archive = root.path().join("leaf.zip");
        let mut zip = zip::ZipWriter::new(File::create(&archive).unwrap());
        for name in ["leaf.model3.json", "leaf.moc3", "texture.png", "icon.png"] {
            zip.start_file(format!("leaf/{name}"), SimpleFileOptions::default())
                .unwrap();
            zip.write_all(&fs::read(source.join(name)).unwrap())
                .unwrap();
        }
        zip.finish().unwrap();
        let destination = root.path().join("models");
        let first = import_zip(&archive, &destination).unwrap();
        let second = import_zip(&archive, &destination).unwrap();
        assert_ne!(first.root, second.root);
        assert_eq!(first.files, second.files);
        assert_eq!(first.icon.as_deref(), Some("icon.png"));
        assert!(first.entry.is_file());
        assert!(first.root.starts_with(destination.canonicalize().unwrap()));
        assert_eq!(fs::read_dir(destination).unwrap().count(), 2);
    }

    #[test]
    fn rejects_zip_symlinks_and_duplicate_paths() {
        let root = tempfile::tempdir().unwrap();
        let destination = root.path().join("models");
        fs::create_dir(&destination).unwrap();
        let archive = root.path().join("symlink.zip");
        let mut zip = zip::ZipWriter::new(File::create(&archive).unwrap());
        zip.add_symlink("texture.png", "../../outside", SimpleFileOptions::default())
            .unwrap();
        zip.finish().unwrap();
        assert!(import_zip(&archive, &destination).is_err());
        assert_eq!(fs::read_dir(&destination).unwrap().count(), 0);
        let archive = root.path().join("duplicate.zip");
        let mut zip = zip::ZipWriter::new(File::create(&archive).unwrap());
        for name in ["texture.png", "TEXTURE.png"] {
            zip.start_file(name, SimpleFileOptions::default()).unwrap();
            zip.write_all(b"texture").unwrap();
        }
        zip.finish().unwrap();
        assert!(import_zip(&archive, &destination).is_err());
        assert_eq!(fs::read_dir(&destination).unwrap().count(), 0);
    }

    #[test]
    fn rejects_zip_traversal_and_cleans_failed_staging() {
        let root = tempfile::tempdir().unwrap();
        let archive = root.path().join("bad.zip");
        let mut zip = zip::ZipWriter::new(fs::File::create(&archive).unwrap());
        zip.start_file("../escape", SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"escape").unwrap();
        zip.finish().unwrap();
        let destination = root.path().join("models");
        fs::create_dir(&destination).unwrap();
        assert!(import_zip(&archive, &destination).is_err());
        assert_eq!(fs::read_dir(&destination).unwrap().count(), 0);
        assert!(!root.path().join("escape").exists());
    }
}

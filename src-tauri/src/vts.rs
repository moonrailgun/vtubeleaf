use std::{fs, io::Read, path::Path};
use tauri_plugin_dialog::DialogExt;

const LIMIT: u64 = 2 * 1024 * 1024;

pub fn model_config(entry: &Path) -> Result<Option<(String, serde_json::Value)>, String> {
    let root = entry.parent().ok_or("模型目录无效")?;
    let model = entry
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("模型文件名无效")?;
    let preferred = format!("{}.vtube.json", model.trim_end_matches(".model3.json"));
    let name = match fs::symlink_metadata(root.join(&preferred)) {
        Ok(_) => preferred,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let mut candidate = None;
            for (index, file) in fs::read_dir(root)
                .map_err(|_| "无法查找 VTS 配置")?
                .enumerate()
            {
                if index >= 2048 {
                    return Err("模型目录文件过多，请手动选择 VTS 配置".into());
                }
                let file = file.map_err(|_| "无法查找 VTS 配置")?;
                let name = file.file_name().to_string_lossy().into_owned();
                if name.to_ascii_lowercase().ends_with(".vtube.json") {
                    if candidate.is_some() {
                        return Err("发现多个 VTS 配置，请手动选择需要的配置".into());
                    }
                    candidate = Some(name);
                }
            }
            let Some(name) = candidate else {
                return Ok(None);
            };
            name
        }
        Err(_) => return Err("无法读取 VTS 配置路径".into()),
    };
    let value = read_config(&root.join(&name))?;
    if let Some(reference) = value.pointer("/FileReferences/Model") {
        if reference
            .as_str()
            .map(|s| s.strip_prefix("./").unwrap_or(s))
            != Some(model)
        {
            return Err("VTS 配置引用了其他模型，请手动确认后导入".into());
        }
    }
    Ok(Some((name, value)))
}

fn read_config(path: &Path) -> Result<serde_json::Value, String> {
    // Reject links in every component, including linked parent directories.
    for ancestor in path.ancestors() {
        let meta = fs::symlink_metadata(ancestor).map_err(|_| "无法读取 VTS 配置路径")?;
        if meta.file_type().is_symlink() {
            return Err("VTS 配置路径不可包含符号链接".into());
        }
    }
    let meta = fs::symlink_metadata(path).map_err(|_| "无法读取 VTS 配置")?;
    if !meta.is_file() || meta.len() > LIMIT {
        return Err("VTS 配置必须为不超过 2 MB 的本机普通文件".into());
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|_| "无法打开 VTS 配置")?
        .take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "VTS 配置读取失败")?;
    if bytes.len() as u64 > LIMIT {
        return Err("VTS 配置超过 2 MB".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "VTS 配置不是有效 JSON".into())
}

#[tauri::command]
pub async fn choose_vts_config(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<Option<serde_json::Value>, String> {
    super::require_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .set_title("导入 VTube Studio 配置")
            .add_filter("VTube Studio JSON", &["json"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|_| "仅支持本机 VTS 配置")?;
        read_config(&path).map(Some)
    })
    .await
    .map_err(|_| "VTS 配置导入任务中断")?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn discovers_only_unambiguous_adjacent_configs_and_prefers_the_model_name() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let entry = root.join("leaf.model3.json");
        assert!(model_config(&entry).unwrap().is_none());
        fs::write(root.join("custom.vtube.json"), br#"{"Version":1}"#).unwrap();
        assert_eq!(
            model_config(&entry).unwrap().unwrap().0,
            "custom.vtube.json"
        );
        fs::write(root.join("other.vtube.json"), b"{}").unwrap();
        assert!(model_config(&entry).unwrap_err().contains("多个"));
        fs::write(
            root.join("leaf.vtube.json"),
            br#"{"FileReferences":{"Model":"leaf.model3.json"}}"#,
        )
        .unwrap();
        assert_eq!(model_config(&entry).unwrap().unwrap().0, "leaf.vtube.json");
        fs::write(
            root.join("leaf.vtube.json"),
            br#"{"FileReferences":{"Model":"../leaf.model3.json"}}"#,
        )
        .unwrap();
        assert!(model_config(&entry).is_err());
        fs::write(root.join("leaf.vtube.json"), b"invalid").unwrap();
        assert!(model_config(&entry).unwrap_err().contains("JSON"));
    }

    #[test]
    fn reads_bounded_json_and_rejects_other_files() {
        let dir = tempfile::tempdir().unwrap();
        // macOS /var is a symlink; isolate these checks from the system temp alias.
        let root = dir.path().canonicalize().unwrap();
        let path = root.join("model.vtube.json");
        fs::write(&path, br#"{"Version":1}"#).unwrap();
        assert_eq!(read_config(&path).unwrap()["Version"], 1);
        assert!(read_config(&root).is_err());
        fs::write(&path, b"broken").unwrap();
        assert!(read_config(&path).is_err());
        let mut at_limit = vec![b' '; LIMIT as usize];
        at_limit[..2].copy_from_slice(b"{}");
        fs::write(&path, &at_limit).unwrap();
        assert!(read_config(&path).unwrap().is_object());
        fs::File::create(&path).unwrap().set_len(LIMIT + 1).unwrap();
        assert!(read_config(&path).is_err());
        #[cfg(unix)]
        {
            let link = root.join("link.json");
            std::os::unix::fs::symlink(&path, &link).unwrap();
            assert!(read_config(&link).is_err());
            fs::write(&path, b"{}").unwrap();
            let linked_parent = root.join("linked-parent");
            std::os::unix::fs::symlink(&root, &linked_parent).unwrap();
            assert!(read_config(&linked_parent.join("model.vtube.json")).is_err());
        }
    }
}

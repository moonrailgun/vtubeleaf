use crate::locale;
use serde::Serialize;
use serde_json::Value;
use std::{
    cmp::Reverse,
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
};

const MAX_FILE_BYTES: u64 = 128 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 512 * 1024 * 1024;
const MAX_ENTRIES: usize = 2048;
const MAX_ICON_BYTES: u64 = 4 * 1024 * 1024;

const CREATE_LIBRARY_FAILED: [&str; 5] = [
    "Could not create the avatars folder",
    "无法创建角色文件夹",
    "キャラクターフォルダーを作成できません",
    "No se pudo crear la carpeta de avatares",
    "Impossible de créer le dossier des avatars",
];

const LIBRARY_INACCESSIBLE: [&str; 5] = [
    "Could not access the avatars folder",
    "无法访问角色文件夹",
    "キャラクターフォルダーにアクセスできません",
    "No se pudo acceder a la carpeta de avatares",
    "Impossible d’accéder au dossier des avatars",
];

const INVALID_AVATAR_PATH: [&str; 5] = [
    "Invalid avatar path",
    "角色路径无效",
    "キャラクターのパスが無効です",
    "Ruta del avatar no válida",
    "Chemin de l’avatar invalide",
];

const MODELS_UNAVAILABLE: [&str; 5] = [
    "Model state is unavailable",
    "模型状态不可用",
    "モデルの状態を利用できません",
    "El estado del modelo no está disponible",
    "L’état du modèle est indisponible",
];

const RESOURCE_MISSING: [&str; 5] = [
    "Could not read a model file. Make sure it still exists",
    "无法读取模型资源，请确认文件仍然存在",
    "モデルファイルを読み込めません。ファイルがまだ存在するか確認してください",
    "No se pudo leer un archivo del modelo. Comprueba que todavía exista",
    "Impossible de lire un fichier du modèle. Vérifiez qu’il existe toujours",
];

const RESOURCE_TOO_LARGE: [&str; 5] = [
    "A model file exceeds the size limit",
    "模型资源超过大小限制",
    "モデルファイルがサイズ上限を超えています",
    "Un archivo del modelo supera el límite de tamaño",
    "Un fichier du modèle dépasse la taille maximale",
];

const MODEL_NOT_LOADED: [&str; 5] = [
    "The model is not loaded yet",
    "模型尚未加载",
    "モデルがまだ読み込まれていません",
    "El modelo aún no se ha cargado",
    "Le modèle n’est pas encore chargé",
];

const SAVE_PREVIEW_FAILED: [&str; 5] = [
    "Could not save the avatar preview",
    "无法保存角色预览",
    "キャラクタープレビューを保存できません",
    "No se pudo guardar la vista previa del avatar",
    "Impossible d’enregistrer l’aperçu de l’avatar",
];

const MODEL_TOO_LARGE: [&str; 5] = [
    "Model files exceed 512 MB in total",
    "模型资源总大小超过 512 MB",
    "モデルファイルの合計サイズが 512 MB を超えています",
    "Los archivos del modelo superan 512 MB en total",
    "Les fichiers du modèle dépassent 512 MB au total",
];

const UNSAFE_RESOURCE_PATH: [&str; 5] = [
    "Unsafe model file path",
    "模型资源路径不安全",
    "モデルファイルのパスが安全ではありません",
    "Ruta de archivo del modelo no segura",
    "Chemin de fichier du modèle non sécurisé",
];

const CHECK_RESOURCE_FAILED: [&str; 5] = [
    "Could not check a model file",
    "无法检查模型资源",
    "モデルファイルを確認できません",
    "No se pudo comprobar un archivo del modelo",
    "Impossible de vérifier un fichier du modèle",
];

const ENTRY_INACCESSIBLE: [&str; 5] = [
    "Could not access the model3.json file",
    "无法访问模型入口",
    "model3.json ファイルにアクセスできません",
    "No se pudo acceder al archivo model3.json",
    "Impossible d’accéder au fichier model3.json",
];

const TOO_MANY_DIRECTORY_FILES: [&str; 5] = [
    "The model folder has more than 2048 files",
    "模型目录文件数超过 2048",
    "モデルフォルダーのファイル数が 2048 を超えています",
    "La carpeta del modelo tiene más de 2048 archivos",
    "Le dossier du modèle contient plus de 2048 fichiers",
];

const TOO_MANY_RESOURCES: [&str; 5] = [
    "The model has more than 2048 files",
    "模型资源数超过 2048",
    "モデルのファイル数が 2048 を超えています",
    "El modelo tiene más de 2048 archivos",
    "Le modèle contient plus de 2048 fichiers",
];

const ZIP_TOO_LARGE: [&str; 5] = [
    "The extracted ZIP exceeds the size limit",
    "ZIP 解压大小超过限制",
    "ZIP の展開後のサイズが上限を超えています",
    "El contenido descomprimido del ZIP supera el límite de tamaño",
    "Le contenu décompressé du ZIP dépasse la taille maximale",
];

#[derive(Clone, Serialize)]
pub struct ModelInfo {
    pub id: String,
    pub path: String,
    pub name: String,
    pub entry: String,
    pub files: Vec<String>,
    pub builtin: bool,
    #[serde(rename = "vtsResources", skip_serializing_if = "Option::is_none")]
    pub vts_resources: Option<VtsResources>,
}

#[derive(Clone, Serialize)]
pub struct ModelResource {
    pub name: String,
    pub file: String,
}

#[derive(Clone, Default, Serialize)]
pub struct VtsResources {
    pub expressions: Vec<ModelResource>,
    pub motions: Vec<ModelResource>,
    pub warnings: Vec<String>,
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
    vts_resources: Option<VtsResources>,
}

#[derive(Default)]
struct State {
    models: BTreeMap<String, Arc<Model>>,
    next_id: u64,
}

/// `state` is held only to look up or register models, so reads never wait for disk work.
#[derive(Default)]
pub struct Registry {
    state: Mutex<State>,
    // ponytail: one lock serializes imports, scans, removals and preview writes so none sees
    // another's partial work; use per-directory locks if parallel imports ever matter.
    disk: Mutex<()>,
}

fn lock<T>(mutex: &Mutex<T>) -> Result<MutexGuard<'_, T>, String> {
    mutex
        .lock()
        .map_err(|_| locale::text(MODELS_UNAVAILABLE).into())
}

impl Registry {
    fn model(&self, id: &str, missing: &str) -> Result<Arc<Model>, String> {
        lock(&self.state)?
            .models
            .get(id)
            .cloned()
            .ok_or_else(|| missing.into())
    }

    pub fn load(&self, path: &Path, data_dir: &Path) -> Result<ModelInfo, String> {
        let _disk = lock(&self.disk)?;
        let destination = data_dir.join("models");
        fs::create_dir_all(&destination).map_err(|_| locale::text(CREATE_LIBRARY_FAILED))?;
        let destination = destination
            .canonicalize()
            .map_err(|_| locale::text(LIBRARY_INACCESSIBLE))?;
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

    fn register(&self, model: Model) -> Result<ModelInfo, String> {
        let mut state = lock(&self.state)?;
        let id = state
            .models
            .iter()
            .find_map(|(id, existing)| (existing.entry == model.entry).then(|| id.clone()))
            .unwrap_or_else(|| {
                state.next_id += 1;
                format!("model-{}", state.next_id)
            });
        let entry = model
            .entry
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or(locale::text([
                "The model file name must be valid UTF-8",
                "模型文件名必须是有效的 UTF-8",
                "モデルのファイル名は有効な UTF-8 である必要があります",
                "El nombre del archivo del modelo debe ser UTF-8 válido",
                "Le nom du fichier du modèle doit être en UTF-8 valide",
            ]))?
            .to_owned();
        let info = ModelInfo {
            id: id.clone(),
            path: model
                .entry
                .to_str()
                .ok_or(locale::text([
                    "The model path must be valid UTF-8",
                    "模型路径必须是有效的 UTF-8",
                    "モデルのパスは有効な UTF-8 である必要があります",
                    "La ruta del modelo debe ser UTF-8 válido",
                    "Le chemin du modèle doit être en UTF-8 valide",
                ]))?
                .to_owned(),
            name: entry.trim_end_matches(".model3.json").to_owned(),
            entry,
            files: model.files.clone(),
            builtin: model
                .root
                .file_name()
                .is_some_and(|name| name.to_string_lossy().starts_with("builtin-")),
            vts_resources: model.vts_resources.clone(),
        };
        state.models.insert(id, Arc::new(model));
        Ok(info)
    }

    pub fn list_with_builtins(
        &self,
        data_dir: &Path,
        bundled_dir: &Path,
    ) -> Result<Library, String> {
        let _disk = lock(&self.disk)?;
        let directory = data_dir.join("models");
        fs::create_dir_all(&directory).map_err(|_| locale::text(CREATE_LIBRARY_FAILED))?;
        let mut errors = Vec::new();
        for name in ["Haru", "Hiyori", "Mao"] {
            let destination = directory.join(format!("builtin-{name}"));
            if destination.exists() {
                continue;
            }
            let result = validate_model(&bundled_dir.join(name))
                .and_then(|source| copy_model(&source, &directory))
                .and_then(|model| {
                    fs::rename(&model.root, &destination).map_err(|_| {
                        let _ = fs::remove_dir_all(&model.root);
                        locale::text([
                            "Could not save the built-in avatar",
                            "无法保存内置角色",
                            "内蔵キャラクターを保存できません",
                            "No se pudo guardar el avatar integrado",
                            "Impossible d’enregistrer l’avatar intégré",
                        ])
                        .to_owned()
                    })
                });
            if let Err(error) = result {
                errors.push(
                    locale::text([
                        "Built-in avatar {name}: {error}",
                        "内置角色 {name}：{error}",
                        "内蔵キャラクター {name}：{error}",
                        "Avatar integrado {name}: {error}",
                        "Avatar intégré {name} : {error}",
                    ])
                    .replace("{name}", name)
                    .replace("{error}", &error),
                );
            }
        }
        let mut library = self.list(data_dir)?;
        library.errors.extend(errors);
        Ok(library)
    }

    // Callers hold `disk`.
    fn list(&self, data_dir: &Path) -> Result<Library, String> {
        let directory = data_dir.join("models");
        fs::create_dir_all(&directory).map_err(|_| locale::text(CREATE_LIBRARY_FAILED))?;
        let mut library = Library {
            directory: directory.to_string_lossy().into_owned(),
            models: Vec::new(),
            errors: Vec::new(),
        };
        let mut entries = fs::read_dir(&directory)
            .map_err(|_| {
                locale::text([
                    "Could not read the avatars folder",
                    "无法读取角色文件夹",
                    "キャラクターフォルダーを読み込めません",
                    "No se pudo leer la carpeta de avatares",
                    "Impossible de lire le dossier des avatars",
                ])
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| {
                locale::text([
                    "Could not read the contents of the avatars folder",
                    "无法读取角色目录",
                    "キャラクターフォルダーの中身を読み込めません",
                    "No se pudo leer el contenido de la carpeta de avatares",
                    "Impossible de lire le contenu du dossier des avatars",
                ])
            })?;
        // Managed directories are created on import; selecting a model does not change this time.
        entries.sort_by_cached_key(|entry| {
            let added = entry
                .metadata()
                .and_then(|metadata| metadata.created().or_else(|_| metadata.modified()))
                .ok();
            (Reverse(added), entry.file_name())
        });
        for entry in entries {
            if !entry
                .file_type()
                .map_err(|_| {
                    locale::text([
                        "Could not check an avatar folder",
                        "无法检查角色目录",
                        "キャラクターフォルダーを確認できません",
                        "No se pudo comprobar una carpeta de avatar",
                        "Impossible de vérifier un dossier d’avatar",
                    ])
                })?
                .is_dir()
            {
                continue;
            }
            match validate_model(&entry.path()).and_then(|model| self.register(model)) {
                Ok(info) => library.models.push(info),
                Err(error) => library.errors.push(
                    locale::text([
                        "{name}: {error}",
                        "{name}：{error}",
                        "{name}：{error}",
                        "{name}: {error}",
                        "{name} : {error}",
                    ])
                    .replace("{name}", &entry.file_name().to_string_lossy())
                    .replace("{error}", &error),
                ),
            }
        }
        Ok(library)
    }

    pub fn remove(&self, id: &str, data_dir: &Path) -> Result<(), String> {
        let _disk = lock(&self.disk)?;
        let model = self.model(
            id,
            locale::text([
                "This avatar is not in the library",
                "角色不在库中",
                "このキャラクターはライブラリにありません",
                "Este avatar no está en la biblioteca",
                "Cet avatar n’est pas dans la bibliothèque",
            ]),
        )?;
        let directory = data_dir
            .join("models")
            .canonicalize()
            .map_err(|_| locale::text(LIBRARY_INACCESSIBLE))?;
        let relative = model.entry.strip_prefix(&directory).map_err(|_| {
            locale::text([
                "Only copies inside the library can be removed",
                "只能移除角色库内的副本",
                "ライブラリ内のコピーのみ削除できます",
                "Solo se pueden eliminar las copias de la biblioteca",
                "Seules les copies présentes dans la bibliothèque peuvent être supprimées",
            ])
        })?;
        let mut components = relative.components();
        let key = components
            .next()
            .ok_or(locale::text(INVALID_AVATAR_PATH))?
            .as_os_str();
        if components.next().is_none() {
            return Err(locale::text(INVALID_AVATAR_PATH).into());
        }
        if key.to_string_lossy().starts_with("builtin-") {
            return Err(locale::text([
                "Built-in avatars cannot be removed",
                "内置角色不能移除",
                "内蔵キャラクターは削除できません",
                "Los avatares integrados no se pueden eliminar",
                "Les avatars intégrés ne peuvent pas être supprimés",
            ])
            .into());
        }
        // ZIP imports can have nested folders: remove only their top-level managed directory.
        let target = directory.join(key);
        if target.canonicalize().map_err(|_| {
            locale::text([
                "The avatar folder does not exist",
                "角色文件夹不存在",
                "キャラクターフォルダーが存在しません",
                "La carpeta del avatar no existe",
                "Le dossier de l’avatar n’existe pas",
            ])
        })? != target
            || model.entry.canonicalize().map_err(|_| {
                locale::text([
                    "The avatar file does not exist",
                    "角色文件不存在",
                    "キャラクターのファイルが存在しません",
                    "El archivo del avatar no existe",
                    "Le fichier de l’avatar n’existe pas",
                ])
            })? != model.entry
        {
            return Err(locale::text([
                "The avatar path has changed. Reopen the app and try again",
                "角色路径已改变，请重新打开应用后再试",
                "キャラクターのパスが変更されました。アプリを開き直してからもう一度お試しください",
                "La ruta del avatar ha cambiado. Vuelve a abrir la app e inténtalo de nuevo",
                "Le chemin de l’avatar a changé. Rouvrez l’application puis réessayez",
            ])
            .into());
        }
        let preview = self.preview_path(id, data_dir)?;
        fs::remove_dir_all(&target).map_err(|error| {
            format!(
                "{}{error}",
                locale::text([
                    "Could not remove the avatar folder: ",
                    "无法移除角色文件夹：",
                    "キャラクターフォルダーを削除できません：",
                    "No se pudo eliminar la carpeta del avatar: ",
                    "Impossible de supprimer le dossier de l’avatar : "
                ])
            )
        })?;
        lock(&self.state)?
            .models
            .retain(|_, model| !model.entry.starts_with(&target));
        let _ = fs::remove_file(preview);
        Ok(())
    }

    fn preview_path(&self, id: &str, data_dir: &Path) -> Result<PathBuf, String> {
        let model = self.model(id, locale::text(MODEL_NOT_LOADED))?;
        let directory = data_dir
            .join("models")
            .canonicalize()
            .map_err(|_| locale::text(LIBRARY_INACCESSIBLE))?;
        let relative = model.entry.strip_prefix(directory).map_err(|_| {
            locale::text([
                "The model is not in the library",
                "模型不在角色库中",
                "モデルがライブラリにありません",
                "El modelo no está en la biblioteca",
                "Le modèle n’est pas dans la bibliothèque",
            ])
        })?;
        let key = relative
            .components()
            .next()
            .ok_or(locale::text(INVALID_AVATAR_PATH))?
            .as_os_str();
        Ok(data_dir.join("avatars").join(key).with_extension("png"))
    }

    pub fn read_preview(&self, id: &str, data_dir: &Path) -> Result<Vec<u8>, String> {
        let model = self.model(id, locale::text(MODEL_NOT_LOADED))?;
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
            return Err(locale::text([
                "The avatar preview must be a PNG image up to 512 × 512",
                "角色预览必须是 512 × 512 以内的 PNG 图片",
                "キャラクタープレビューは 512 × 512 以内の PNG 画像である必要があります",
                "La vista previa del avatar debe ser una imagen PNG de hasta 512 × 512",
                "L’aperçu de l’avatar doit être une image PNG de 512 × 512 maximum",
            ])
            .into());
        }
        // A concurrent removal must not leave this preview behind.
        let _disk = lock(&self.disk)?;
        let path = self.preview_path(id, data_dir)?;
        let parent = path.parent().ok_or(locale::text([
            "Invalid preview path",
            "预览路径无效",
            "プレビューのパスが無効です",
            "Ruta de vista previa no válida",
            "Chemin de l’aperçu invalide",
        ]))?;
        fs::create_dir_all(parent).map_err(|_| {
            locale::text([
                "Could not create the preview folder",
                "无法创建预览文件夹",
                "プレビューフォルダーを作成できません",
                "No se pudo crear la carpeta de vistas previas",
                "Impossible de créer le dossier des aperçus",
            ])
        })?;
        let mut staging = tempfile::NamedTempFile::new_in(parent).map_err(|_| {
            locale::text([
                "Could not create the preview file",
                "无法创建预览文件",
                "プレビューファイルを作成できません",
                "No se pudo crear el archivo de vista previa",
                "Impossible de créer le fichier d’aperçu",
            ])
        })?;
        staging
            .write_all(png)
            .map_err(|_| locale::text(SAVE_PREVIEW_FAILED))?;
        staging
            .persist(path)
            .map_err(|_| locale::text(SAVE_PREVIEW_FAILED))?;
        Ok(())
    }

    pub fn read(&self, id: &str, resource: &str) -> Result<Vec<u8>, String> {
        validate_resource(resource)?;
        let model = self.model(
            id,
            locale::text([
                "The model is not loaded yet. Please import it again",
                "模型尚未加载，请重新导入",
                "モデルがまだ読み込まれていません。もう一度インポートしてください",
                "El modelo aún no se ha cargado. Vuelve a importarlo",
                "Le modèle n’est pas encore chargé. Veuillez le réimporter",
            ]),
        )?;
        if !model.files.iter().any(|file| file == resource) {
            return Err(locale::text([
                "Files not declared by the model cannot be read",
                "禁止读取模型未声明的资源",
                "モデルで宣言されていないファイルは読み込めません",
                "No se pueden leer archivos que el modelo no declara",
                "Les fichiers non déclarés par le modèle ne peuvent pas être lus",
            ])
            .into());
        }
        let path = checked_resource(&model.root, resource)?;
        read_bounded(&path, MAX_FILE_BYTES)
    }

    pub fn read_vts_config(&self, id: &str) -> Result<Option<Value>, String> {
        let model = self.model(id, locale::text(MODEL_NOT_LOADED))?;
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
        .map_err(|_| {
            locale::text([
                "Could not create the avatar folder",
                "无法创建角色目录",
                "キャラクターフォルダーを作成できません",
                "No se pudo crear la carpeta del avatar",
                "Impossible de créer le dossier de l’avatar",
            ])
        })?;
    let mut total = 0;
    for resource in &source.files {
        // Rejects links leaving the model, non-regular files and files over 128 MB.
        let input = checked_resource(&source.root, resource)?;
        let limit = MAX_FILE_BYTES.min(MAX_TOTAL_BYTES - total);
        let file = File::open(&input).map_err(|_| locale::text(RESOURCE_MISSING))?;
        if file
            .metadata()
            .map_err(|_| locale::text(CHECK_RESOURCE_FAILED))?
            .len()
            > limit
        {
            return Err(locale::text(MODEL_TOO_LARGE).into());
        }
        let target = staging.path().join(resource);
        fs::create_dir_all(target.parent().ok_or(locale::text([
            "Invalid file path",
            "资源路径无效",
            "ファイルのパスが無効です",
            "Ruta de archivo no válida",
            "Chemin de fichier invalide",
        ]))?)
        .map_err(|_| {
            locale::text([
                "Could not create a folder for avatar files",
                "无法创建角色资源目录",
                "キャラクターファイル用のフォルダーを作成できません",
                "No se pudo crear una carpeta para los archivos del avatar",
                "Impossible de créer un dossier pour les fichiers de l’avatar",
            ])
        })?;

        // Streams into a fresh file instead of buffering it. Unlike fs::copy, no source flags
        // (e.g. Finder's lock) carry over and later block removing the model.
        let copied = File::create(&target)
            .and_then(|mut output| io::copy(&mut file.take(limit + 1), &mut output))
            .map_err(|_| {
                locale::text([
                    "Could not copy avatar files. Check your free disk space",
                    "无法复制角色资源，请检查磁盘空间",
                    "キャラクターのファイルをコピーできません。ディスクの空き容量を確認してください",
                    "No se pudieron copiar los archivos del avatar. Comprueba el espacio en disco",
                    "Impossible de copier les fichiers de l’avatar. Vérifiez l’espace disque disponible",
                ])
            })?;
        // The source may have grown since it was checked.
        if copied > limit {
            return Err(locale::text(RESOURCE_TOO_LARGE).into());
        }
        total += copied;
    }
    // Optional VTS data must never prevent an otherwise valid model from loading.
    let vts_warning = (|| -> Result<(), String> {
        if let Some((name, value)) = super::vts::model_config(&source.entry)? {
            validate_resource(&name).map_err(|error| {
                locale::text([
                    "VTS config “{name}” was not copied: {error}",
                    "VTS 配置「{name}」未复制：{error}",
                    "VTS 設定「{name}」はコピーされませんでした：{error}",
                    "La configuración de VTS “{name}” no se copió: {error}",
                    "La configuration VTS « {name} » n’a pas été copiée : {error}",
                ])
                .replace("{name}", &name)
                .replace("{error}", &error)
            })?;
            let bytes = serde_json::to_vec(&value).map_err(|_| {
                locale::text([
                    "Could not save the VTS config",
                    "无法保存 VTS 配置",
                    "VTS 設定を保存できません",
                    "No se pudo guardar la configuración de VTS",
                    "Impossible d’enregistrer la configuration VTS",
                ])
            })?;
            fs::write(staging.path().join(name), bytes).map_err(|_| {
                locale::text([
                    "Could not copy the VTS config",
                    "无法复制 VTS 配置",
                    "VTS 設定をコピーできません",
                    "No se pudo copiar la configuración de VTS",
                    "Impossible de copier la configuration VTS",
                ])
            })?;
        }
        Ok(())
    })()
    .err();
    let mut model = validate_model(staging.path())?;
    model.vts_warning = vts_warning.or_else(|| source.vts_warning.clone());
    // Keep the destination's verified resource list; copying the optional config may fail.
    for warning in source
        .vts_resources
        .iter()
        .flat_map(|resources| &resources.warnings)
        .chain(model.vts_warning.iter())
    {
        let resources = model
            .vts_resources
            .get_or_insert_with(VtsResources::default);
        if !resources.warnings.contains(warning) {
            resources.warnings.push(warning.clone());
        }
    }
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
        return Err(locale::text(UNSAFE_RESOURCE_PATH).into());
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
            return Err(locale::text(UNSAFE_RESOURCE_PATH).into());
        }
    }
    Ok(())
}

fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let file = File::open(path).map_err(|_| locale::text(RESOURCE_MISSING))?;
    let metadata = file
        .metadata()
        .map_err(|_| locale::text(CHECK_RESOURCE_FAILED))?;
    if !metadata.is_file() || metadata.len() > limit {
        return Err(locale::text([
            "A model file is not a regular file or exceeds the size limit",
            "模型资源不是普通文件或超过大小限制",
            "モデルファイルが通常のファイルではないか、サイズ上限を超えています",
            "Un archivo del modelo no es un archivo normal o supera el límite de tamaño",
            "Un fichier du modèle n’est pas un fichier standard ou dépasse la taille maximale",
        ])
        .into());
    }
    // `Take` hides the file size from read_to_end; reserving it avoids regrowing large buffers.
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(limit + 1).read_to_end(&mut bytes).map_err(|_| {
        locale::text([
            "Failed to read a model file",
            "读取模型资源失败",
            "モデルファイルの読み込みに失敗しました",
            "Error al leer un archivo del modelo",
            "Échec de la lecture d’un fichier du modèle",
        ])
    })?;
    if bytes.len() as u64 > limit {
        return Err(locale::text(RESOURCE_TOO_LARGE).into());
    }
    Ok(bytes)
}

fn checked_resource(root: &Path, resource: &str) -> Result<PathBuf, String> {
    validate_resource(resource)?;
    let path = root.join(resource).canonicalize().map_err(|_| {
        format!(
            "{}{resource}",
            locale::text([
                "Missing model file: ",
                "缺少模型资源：",
                "モデルファイルがありません：",
                "Falta un archivo del modelo: ",
                "Fichier du modèle manquant : "
            ])
        )
    })?;
    if !path.starts_with(root) {
        return Err(locale::text([
            "A model file link points outside the model folder",
            "模型资源链接超出模型目录",
            "モデルファイルのリンクがモデルフォルダーの外を指しています",
            "Un enlace de archivo del modelo apunta fuera de la carpeta del modelo",
            "Un lien de fichier du modèle pointe hors du dossier du modèle",
        ])
        .into());
    }
    let metadata = fs::metadata(&path).map_err(|_| locale::text(CHECK_RESOURCE_FAILED))?;
    if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
        return Err(locale::text([
            "A model file is not a regular file or is larger than 128 MB",
            "模型资源不是普通文件或超过 128 MB",
            "モデルファイルが通常のファイルではないか、128 MB を超えています",
            "Un archivo del modelo no es un archivo normal o supera los 128 MB",
            "Un fichier du modèle n’est pas un fichier standard ou dépasse 128 MB",
        ])
        .into());
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
            return Err(locale::text([
                "Choose a .model3.json file or a model folder",
                "请选择 .model3.json 文件或模型目录",
                ".model3.json ファイルまたはモデルフォルダーを選択してください",
                "Elige un archivo .model3.json o una carpeta de modelo",
                "Choisissez un fichier .model3.json ou un dossier de modèle",
            ])
            .into());
        }
        return path
            .canonicalize()
            .map_err(|_| locale::text(ENTRY_INACCESSIBLE).into());
    }
    let mut pending = vec![(path.to_owned(), 0)];
    let mut count = 0;
    let mut found = None;
    while let Some((directory, depth)) = pending.pop() {
        if depth > 16 {
            return Err(locale::text([
                "The model folder is nested too deeply",
                "模型目录层级过深",
                "モデルフォルダーの階層が深すぎます",
                "La carpeta del modelo tiene demasiados niveles",
                "Le dossier du modèle contient trop de sous-niveaux",
            ])
            .into());
        }
        for entry in fs::read_dir(directory).map_err(|_| {
            locale::text([
                "Could not read the model folder",
                "无法读取模型目录",
                "モデルフォルダーを読み込めません",
                "No se pudo leer la carpeta del modelo",
                "Impossible de lire le dossier du modèle",
            ])
        })? {
            let entry = entry.map_err(|_| {
                locale::text([
                    "Could not read the model folder contents",
                    "无法读取模型目录内容",
                    "モデルフォルダーの中身を読み込めません",
                    "No se pudo leer el contenido de la carpeta del modelo",
                    "Impossible de lire le contenu du dossier du modèle",
                ])
            })?;
            count += 1;
            if count > MAX_ENTRIES {
                return Err(locale::text(TOO_MANY_DIRECTORY_FILES).into());
            }
            let kind = entry.file_type().map_err(|_| {
                locale::text([
                    "Could not check the model folder contents",
                    "无法检查模型目录内容",
                    "モデルフォルダーの中身を確認できません",
                    "No se pudo comprobar el contenido de la carpeta del modelo",
                    "Impossible de vérifier le contenu du dossier du modèle",
                ])
            })?;
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
                    return Err(locale::text([
                        "The folder contains several models. Choose the .model3.json you want directly",
                        "目录包含多个模型，请直接选择需要的 .model3.json",
                        "フォルダーに複数のモデルがあります。使いたい .model3.json を直接選択してください",
                        "La carpeta contiene varios modelos. Elige directamente el .model3.json que quieras",
                        "Le dossier contient plusieurs modèles. Choisissez directement le .model3.json voulu",
                    ]).into());
                }
                found = Some(entry.path());
            }
        }
    }
    found
        .ok_or_else(|| {
            locale::text([
                "No .model3.json file found",
                "未找到 .model3.json 模型入口",
                ".model3.json ファイルが見つかりません",
                "No se encontró ningún archivo .model3.json",
                "Aucun fichier .model3.json trouvé",
            ])
            .to_owned()
        })?
        .canonicalize()
        .map_err(|_| locale::text(ENTRY_INACCESSIBLE).into())
}

fn validate_model(path: &Path) -> Result<Model, String> {
    let entry = find_entry(path)?;
    let root = entry
        .parent()
        .ok_or(locale::text([
            "The model3.json file has no valid folder",
            "模型入口没有有效目录",
            "model3.json ファイルのフォルダーが無効です",
            "El archivo model3.json no tiene una carpeta válida",
            "Le fichier model3.json n’a pas de dossier valide",
        ]))?
        .to_owned();
    let document: Value =
        serde_json::from_slice(&read_bounded(&entry, MAX_FILE_BYTES)?).map_err(|_| {
            locale::text([
                "The model3.json file is not valid JSON",
                "模型入口不是有效的 JSON",
                "model3.json ファイルが有効な JSON ではありません",
                "El archivo model3.json no es un JSON válido",
                "Le fichier model3.json n’est pas un JSON valide",
            ])
        })?;
    if document.get("Version").and_then(Value::as_u64) != Some(3) {
        return Err(locale::text([
            "Only Cubism 3/4/5 model3.json models are supported",
            "仅支持 Cubism 3/4/5 的 model3.json 模型",
            "Cubism 3/4/5 の model3.json モデルのみ対応しています",
            "Solo se admiten modelos model3.json de Cubism 3/4/5",
            "Seuls les modèles model3.json de Cubism 3/4/5 sont pris en charge",
        ])
        .into());
    }
    let refs = document
        .get("FileReferences")
        .and_then(Value::as_object)
        .ok_or(locale::text([
            "The model3.json file is missing FileReferences",
            "模型入口缺少 FileReferences",
            "model3.json ファイルに FileReferences がありません",
            "Al archivo model3.json le falta FileReferences",
            "Il manque FileReferences dans le fichier model3.json",
        ]))?;
    let mut resources = BTreeSet::new();
    let mut add = |value: Option<&Value>| -> Result<(), String> {
        let resource = value.and_then(Value::as_str).ok_or(locale::text([
            "The model3.json file has an invalid file reference",
            "模型入口包含无效资源引用",
            "model3.json ファイルに無効なファイル参照があります",
            "El archivo model3.json contiene una referencia de archivo no válida",
            "Le fichier model3.json contient une référence de fichier invalide",
        ]))?;
        validate_resource(resource)?;
        resources.insert(resource.to_owned());
        if resources.len() > MAX_ENTRIES {
            return Err(locale::text(TOO_MANY_RESOURCES).into());
        }
        Ok(())
    };
    add(refs.get("Moc"))?;
    let textures = refs
        .get("Textures")
        .and_then(Value::as_array)
        .filter(|items| !items.is_empty())
        .ok_or(locale::text([
            "The model3.json file has no textures",
            "模型入口缺少纹理",
            "model3.json ファイルにテクスチャがありません",
            "El archivo model3.json no tiene texturas",
            "Le fichier model3.json ne contient aucune texture",
        ]))?;
    for texture in textures {
        add(Some(texture))?;
    }
    for key in ["Physics", "Pose", "UserData", "DisplayInfo"] {
        if let Some(value) = refs.get(key) {
            add(Some(value))?;
        }
    }
    if let Some(expressions) = refs.get("Expressions") {
        for expression in expressions.as_array().ok_or(locale::text([
            "Invalid expression references in the model",
            "模型表情引用无效",
            "モデルの表情の参照が無効です",
            "Referencias de expresiones del modelo no válidas",
            "Références d’expressions du modèle invalides",
        ]))? {
            add(expression.get("File"))?;
        }
    }
    if let Some(groups) = refs.get("Motions") {
        for motions in groups
            .as_object()
            .ok_or(locale::text([
                "Invalid motion references in the model",
                "模型动作引用无效",
                "モデルのモーションの参照が無効です",
                "Referencias de animaciones del modelo no válidas",
                "Références d’animations du modèle invalides",
            ]))?
            .values()
        {
            for motion in motions.as_array().ok_or(locale::text([
                "Invalid motion list in the model",
                "模型动作列表无效",
                "モデルのモーション一覧が無効です",
                "Lista de animaciones del modelo no válida",
                "Liste d’animations du modèle invalide",
            ]))? {
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
            .ok_or(locale::text([
                "Invalid model3.json file name",
                "模型入口文件名无效",
                "model3.json のファイル名が無効です",
                "Nombre de archivo model3.json no válido",
                "Nom du fichier model3.json invalide",
            ]))?
            .to_owned(),
    );
    let icon = find_icon(&root, &entry, &resources);
    if let Some(icon) = &icon {
        resources.insert(icon.clone());
    }
    if resources.len() > MAX_ENTRIES {
        return Err(locale::text(TOO_MANY_RESOURCES).into());
    }
    let mut total = 0;
    for resource in &resources {
        let file = checked_resource(&root, resource)?;
        total += fs::metadata(file)
            .map_err(|_| locale::text(CHECK_RESOURCE_FAILED))?
            .len();
        if total > MAX_TOTAL_BYTES {
            return Err(locale::text(MODEL_TOO_LARGE).into());
        }
    }
    let (config, vts_warning) = match super::vts::model_config(&entry) {
        Ok(config) => (config.map(|(_, value)| value), None),
        Err(warning) => (None, Some(warning)),
    };
    let mut extras = discover_model_resources(&root, config.as_ref(), &mut resources, total);
    extras.warnings.extend(vts_warning.iter().cloned());
    let vts_resources = (config.is_some()
        || !extras.expressions.is_empty()
        || !extras.motions.is_empty()
        || !extras.warnings.is_empty())
    .then_some(extras);
    Ok(Model {
        root,
        entry,
        files: resources.into_iter().collect(),
        icon,
        vts_warning,
        vts_resources,
    })
}

fn discover_model_resources(
    root: &Path,
    config: Option<&Value>,
    resources: &mut BTreeSet<String>,
    mut total: u64,
) -> VtsResources {
    let mut result = VtsResources::default();
    let config = config.filter(|config| {
        if config.get("Version").and_then(Value::as_u64) == Some(1) {
            return true;
        }
        result
            .warnings
            .push(locale::text([
                "Unsupported VTS config version; its file references were skipped",
                "VTS 配置版本不支持，已跳过其资源引用",
                "VTS 設定のバージョンに対応していないため、ファイル参照をスキップしました",
                "Versión de configuración de VTS no compatible; se omitieron sus referencias de archivos",
                "Version de configuration VTS non prise en charge ; ses références de fichiers ont été ignorées",
            ]).into());
        false
    });
    let mut hotkeys = config
        .and_then(|config| config.get("Hotkeys"))
        .and_then(Value::as_array);
    if hotkeys.is_some_and(|items| items.len() > 128) {
        result
            .warnings
            .push(locale::text([
                "The VTS config has more than 128 hotkeys; their file references were skipped",
                "VTS 快捷键超过 128 个，已跳过其资源引用",
                "VTS のホットキーが 128 個を超えているため、ファイル参照をスキップしました",
                "La configuración de VTS tiene más de 128 atajos; se omitieron sus referencias de archivos",
                "La configuration VTS contient plus de 128 raccourcis ; leurs références de fichiers ont été ignorées",
            ]).into());
        hotkeys = None;
    }
    let mut references = Vec::new();
    if let Some(hotkeys) = hotkeys {
        for item in hotkeys {
            let expression = match item.get("Action").and_then(Value::as_str) {
                Some("ToggleExpression") => true,
                Some("TriggerAnimation") => false,
                _ => continue,
            };
            references.push((
                item.get("File")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_owned(),
                item.get("Name").and_then(Value::as_str).map(str::to_owned),
                expression,
            ));
        }
    }
    for field in ["IdleAnimation", "IdleAnimationWhenTrackingLost"] {
        if let Some(file) = config
            .and_then(|config| config.get("FileReferences"))
            .and_then(|refs| refs.get(field))
        {
            if file.as_str().is_some_and(str::is_empty) || file.is_null() {
                continue;
            }
            references.push((file.as_str().unwrap_or("").to_owned(), None, false));
        }
    }
    let inventory = model_resource_inventory(root);
    match &inventory {
        Ok(files) => {
            for file in files {
                let lower = file.to_ascii_lowercase();
                if lower.ends_with(".exp3.json") || lower.ends_with(".motion3.json") {
                    references.push((file.clone(), None, lower.ends_with(".exp3.json")));
                }
            }
        }
        Err(error) => result.warnings.push(format!(
            "{}{error}",
            locale::text([
                "Skipped searching for extra files: ",
                "附加资源搜索已跳过：",
                "追加ファイルの検索をスキップしました：",
                "Se omitió la búsqueda de archivos adicionales: ",
                "Recherche de fichiers supplémentaires ignorée : "
            ])
        )),
    }
    let mut seen = BTreeSet::new();
    for (reference, name, expression) in references {
        if !seen.insert((reference.clone(), expression)) {
            continue;
        }
        let discovered = (|| -> Result<Option<ModelResource>, String> {
            let suffix = if expression {
                ".exp3.json"
            } else {
                ".motion3.json"
            };
            if !reference.to_ascii_lowercase().ends_with(suffix) {
                return Err(locale::text([
                    "Should reference a {suffix} file",
                    "应引用 {suffix} 文件",
                    "{suffix} ファイルを参照する必要があります",
                    "Debe hacer referencia a un archivo {suffix}",
                    "Doit référencer un fichier {suffix}",
                ])
                .replace("{suffix}", suffix));
            }
            let file = resolve_vts_resource(root, &reference, &inventory)?;
            if resources.contains(&file) {
                return Ok(None);
            }
            if resources.len() >= MAX_ENTRIES {
                return Err(locale::text(TOO_MANY_RESOURCES).into());
            }
            let bytes = read_bounded(&checked_resource(root, &file)?, MAX_FILE_BYTES)?;
            if bytes.len() as u64 > MAX_TOTAL_BYTES - total {
                return Err(locale::text(MODEL_TOO_LARGE).into());
            }
            let data: Value = serde_json::from_slice(&bytes).map_err(|_| {
                locale::text([
                    "The file is not valid JSON",
                    "资源不是有效 JSON",
                    "ファイルが有効な JSON ではありません",
                    "El archivo no es un JSON válido",
                    "Le fichier n’est pas un JSON valide",
                ])
            })?;
            if !valid_vts_resource(&data, expression) {
                return Err(locale::text([
                    "The file is not a valid expression or motion",
                    "资源的表情或动作结构无效",
                    "ファイルの表情またはモーションの構造が無効です",
                    "El archivo no es una expresión o animación válida",
                    "Le fichier n’est pas une expression ou une animation valide",
                ])
                .into());
            }
            total += bytes.len() as u64;
            resources.insert(file.clone());
            let name = name
                .as_deref()
                .filter(|name| !name.trim().is_empty() && !name.chars().any(char::is_control))
                .unwrap_or_else(|| {
                    file.rsplit('/')
                        .next()
                        .unwrap_or(&file)
                        .trim_end_matches(suffix)
                })
                .chars()
                .take(100)
                .collect();
            Ok(Some(ModelResource { name, file }))
        })();
        match discovered {
            Ok(Some(resource)) => {
                if expression {
                    result.expressions.push(resource);
                } else {
                    result.motions.push(resource);
                }
            }
            Ok(None) => {}
            Err(error) => result.warnings.push(
                locale::text([
                    "Extra file “{file}”: {error}. Skipped; re-import from the complete original model package that includes this file",
                    "附加资源「{file}」：{error}；已跳过，请从包含该文件的完整原模型包重新导入",
                    "追加ファイル「{file}」：{error}。スキップしました。このファイルを含む元のモデルパッケージ一式から再インポートしてください",
                    "Archivo adicional “{file}”: {error}. Se omitió; vuelve a importar desde el paquete original completo del modelo que incluye este archivo",
                    "Fichier supplémentaire « {file} » : {error}. Ignoré ; réimportez depuis le paquet d’origine complet du modèle contenant ce fichier",
                ])
                .replace("{error}", &error)
                .replace(
                    "{file}",
                    &reference
                        .chars()
                        .filter(|c| !c.is_control())
                        .take(200)
                        .collect::<String>(),
                ),
            ),
        }
    }
    result
}

fn resolve_vts_resource(
    root: &Path,
    reference: &str,
    inventory: &Result<Vec<String>, String>,
) -> Result<String, String> {
    let reference = reference.replace('\\', "/");
    let reference = reference.trim_start_matches("./").to_owned();
    validate_resource(&reference)?;
    if root.join(&reference).exists() || reference.contains('/') {
        checked_resource(root, &reference)?;
        return Ok(reference);
    }
    let files = inventory.as_ref().map_err(Clone::clone)?;
    let matches = files
        .iter()
        .filter(|file| file.rsplit('/').next() == Some(&reference))
        .collect::<Vec<_>>();
    match matches.as_slice() {
        [file] => {
            checked_resource(root, file)?;
            Ok((*file).clone())
        }
        [] => Err(locale::text([
            "The file is missing from the model folder",
            "模型目录内缺少该文件",
            "モデルフォルダーにこのファイルがありません",
            "Falta el archivo en la carpeta del modelo",
            "Le fichier est absent du dossier du modèle",
        ]).into()),
        _ => Err(locale::text([
            "The model folder has several files with this name. Specify a relative path in the VTS config",
            "模型目录内存在多个同名文件，请在 VTS 配置中指定相对路径",
            "モデルフォルダーに同名のファイルが複数あります。VTS 設定で相対パスを指定してください",
            "La carpeta del modelo tiene varios archivos con este nombre. Indica una ruta relativa en la configuración de VTS",
            "Le dossier du modèle contient plusieurs fichiers portant ce nom. Indiquez un chemin relatif dans la configuration VTS",
        ]).into()),
    }
}

fn model_resource_inventory(root: &Path) -> Result<Vec<String>, String> {
    let mut files = Vec::new();
    let mut pending = vec![(root.to_owned(), 0)];
    let mut count = 0;
    while let Some((directory, depth)) = pending.pop() {
        if depth > 16 {
            return Err(locale::text([
                "The model folder is nested more than 16 levels deep",
                "模型目录层级超过 16",
                "モデルフォルダーの階層が 16 を超えています",
                "La carpeta del modelo tiene más de 16 niveles",
                "Le dossier du modèle dépasse 16 niveaux de profondeur",
            ])
            .into());
        }
        for entry in fs::read_dir(directory).map_err(|_| {
            locale::text([
                "Could not search the model folder",
                "无法搜索模型资源目录",
                "モデルフォルダーを検索できません",
                "No se pudo buscar en la carpeta del modelo",
                "Impossible de parcourir le dossier du modèle",
            ])
        })? {
            let entry = entry.map_err(|_| {
                locale::text([
                    "Could not read the model folder",
                    "无法读取模型资源目录",
                    "モデルフォルダーを読み込めません",
                    "No se pudo leer la carpeta del modelo",
                    "Impossible de lire le dossier du modèle",
                ])
            })?;
            count += 1;
            if count > MAX_ENTRIES {
                return Err(locale::text(TOO_MANY_DIRECTORY_FILES).into());
            }
            let kind = entry.file_type().map_err(|_| {
                locale::text([
                    "Could not check a model file type",
                    "无法检查模型资源类型",
                    "モデルファイルの種類を確認できません",
                    "No se pudo comprobar el tipo de un archivo del modelo",
                    "Impossible de vérifier le type d’un fichier du modèle",
                ])
            })?;
            if kind.is_dir() {
                pending.push((entry.path(), depth + 1));
            } else if kind.is_file() {
                if let Some(path) = entry.path().strip_prefix(root).ok().and_then(Path::to_str) {
                    files.push(path.replace('\\', "/"));
                }
            }
        }
    }
    files.sort();
    Ok(files)
}

fn valid_vts_resource(data: &Value, expression: bool) -> bool {
    let id = |value: &Value| {
        value
            .as_str()
            .is_some_and(|s| !s.is_empty() && s.len() <= 512 && !s.chars().any(char::is_control))
    };
    let finite = |value: &Value| value.as_f64().is_some_and(f64::is_finite);
    if expression {
        return data.get("Type").and_then(Value::as_str) == Some("Live2D Expression")
            && data
                .get("Parameters")
                .and_then(Value::as_array)
                .is_some_and(|parameters| {
                    parameters.len() <= 2048
                        && parameters.iter().all(|p| {
                            id(&p["Id"])
                                && finite(&p["Value"])
                                && p.get("Blend").is_none_or(|blend| {
                                    matches!(blend.as_str(), Some("Add" | "Multiply" | "Overwrite"))
                                })
                        })
                });
    }
    let Some(curves) = data.get("Curves").and_then(Value::as_array) else {
        return false;
    };
    let meta = &data["Meta"];
    if data["Version"].as_u64() != Some(3)
        || curves.len() > 2048
        || meta["CurveCount"].as_u64() != Some(curves.len() as u64)
        || !meta["Duration"]
            .as_f64()
            .is_some_and(|n| n.is_finite() && n > 0.0)
        || !meta["Fps"]
            .as_f64()
            .is_some_and(|n| n.is_finite() && n > 0.0)
    {
        return false;
    }
    let mut segment_count = 0;
    let mut point_count = 0;
    for curve in curves {
        let Some(segments) = curve.get("Segments").and_then(Value::as_array) else {
            return false;
        };
        if !id(&curve["Id"])
            || !matches!(
                curve["Target"].as_str(),
                Some("Model" | "Parameter" | "PartOpacity")
            )
            || segments.len() < 5
            || !segments.iter().all(finite)
        {
            return false;
        }
        let mut position = 2;
        point_count += 1;
        while position < segments.len() {
            let width = match segments[position].as_f64() {
                Some(0.0 | 2.0 | 3.0) => 3,
                Some(1.0) => 7,
                _ => return false,
            };
            if position + width > segments.len() {
                return false;
            }
            position += width;
            segment_count += 1;
            point_count += (width - 1) / 2;
        }
    }
    let events = data.get("UserData").and_then(Value::as_array);
    meta["TotalSegmentCount"].as_u64() == Some(segment_count)
        && meta["TotalPointCount"].as_u64() == Some(point_count as u64)
        && meta
            .get("UserDataCount")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            == events.map_or(0, |events| events.len() as u64)
        && events.is_none_or(|events| {
            events
                .iter()
                .all(|event| finite(&event["Time"]) && event["Value"].is_string())
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
    let file = File::open(archive).map_err(|_| {
        locale::text([
            "Could not read the ZIP file",
            "无法读取 ZIP 文件",
            "ZIP ファイルを読み込めません",
            "No se pudo leer el archivo ZIP",
            "Impossible de lire le fichier ZIP",
        ])
    })?;
    if file
        .metadata()
        .map_err(|_| {
            locale::text([
                "Could not check the ZIP file",
                "无法检查 ZIP 文件",
                "ZIP ファイルを確認できません",
                "No se pudo comprobar el archivo ZIP",
                "Impossible de vérifier le fichier ZIP",
            ])
        })?
        .len()
        > MAX_TOTAL_BYTES
    {
        return Err(locale::text([
            "The ZIP file is larger than 512 MB",
            "ZIP 文件超过 512 MB",
            "ZIP ファイルが 512 MB を超えています",
            "El archivo ZIP supera los 512 MB",
            "Le fichier ZIP dépasse 512 MB",
        ])
        .into());
    }
    let mut archive = zip::ZipArchive::new(file).map_err(|_| {
        locale::text([
            "Not a valid ZIP file",
            "不是有效的 ZIP 文件",
            "有効な ZIP ファイルではありません",
            "No es un archivo ZIP válido",
            "Ce n’est pas un fichier ZIP valide",
        ])
    })?;
    if archive.len() > MAX_ENTRIES {
        return Err(locale::text([
            "The ZIP has more than 2048 files",
            "ZIP 文件数超过 2048",
            "ZIP 内のファイル数が 2048 を超えています",
            "El ZIP tiene más de 2048 archivos",
            "Le ZIP contient plus de 2048 fichiers",
        ])
        .into());
    }
    fs::create_dir_all(destination).map_err(|_| {
        locale::text([
            "Could not create the model storage folder",
            "无法创建模型保存目录",
            "モデルの保存フォルダーを作成できません",
            "No se pudo crear la carpeta para guardar el modelo",
            "Impossible de créer le dossier d’enregistrement du modèle",
        ])
    })?;
    let staging = tempfile::Builder::new()
        .prefix("model-")
        .tempdir_in(destination)
        .map_err(|_| {
            locale::text([
                "Could not create a temporary model folder",
                "无法创建模型临时目录",
                "モデルの一時フォルダーを作成できません",
                "No se pudo crear una carpeta temporal para el modelo",
                "Impossible de créer un dossier temporaire pour le modèle",
            ])
        })?;
    let mut names = BTreeSet::new();
    let mut total = 0;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|_| {
            locale::text([
                "The ZIP contains a file that cannot be read",
                "ZIP 包含无法读取的文件",
                "ZIP に読み込めないファイルが含まれています",
                "El ZIP contiene un archivo que no se puede leer",
                "Le ZIP contient un fichier illisible",
            ])
        })?;
        let directory = entry.is_dir();
        let name = entry.name().strip_suffix('/').unwrap_or(entry.name());
        validate_resource(name)?;
        if !names.insert(name.to_lowercase()) {
            return Err(locale::text([
                "The ZIP contains duplicate file paths",
                "ZIP 包含重复文件路径",
                "ZIP に重複したファイルパスが含まれています",
                "El ZIP contiene rutas de archivo duplicadas",
                "Le ZIP contient des chemins de fichier en double",
            ])
            .into());
        }
        if let Some(mode) = entry.unix_mode() {
            let kind = mode & 0o170000;
            if kind != 0 && kind != 0o100000 && kind != 0o040000 {
                return Err(locale::text([
                    "Symbolic links and special files are not allowed in the ZIP",
                    "ZIP 不允许符号链接或特殊文件",
                    "ZIP にシンボリックリンクや特殊ファイルは使用できません",
                    "No se permiten enlaces simbólicos ni archivos especiales en el ZIP",
                    "Les liens symboliques et fichiers spéciaux ne sont pas autorisés dans le ZIP",
                ])
                .into());
            }
            if (kind == 0o040000) != directory && kind != 0 {
                return Err(locale::text([
                    "Invalid file type in the ZIP",
                    "ZIP 文件类型无效",
                    "ZIP 内のファイルの種類が無効です",
                    "Tipo de archivo no válido en el ZIP",
                    "Type de fichier invalide dans le ZIP",
                ])
                .into());
            }
        }
        if entry.size() > MAX_FILE_BYTES || entry.size() > MAX_TOTAL_BYTES - total {
            return Err(locale::text(ZIP_TOO_LARGE).into());
        }
        let output_path = staging.path().join(name);
        if directory {
            fs::create_dir_all(output_path).map_err(|_| {
                locale::text([
                    "Conflicting folder structure in the ZIP",
                    "ZIP 目录结构冲突",
                    "ZIP のフォルダー構造が競合しています",
                    "Estructura de carpetas en conflicto en el ZIP",
                    "Structure de dossiers en conflit dans le ZIP",
                ])
            })?;
        } else {
            fs::create_dir_all(output_path.parent().ok_or(locale::text([
                "Invalid path in the ZIP",
                "ZIP 路径无效",
                "ZIP 内のパスが無効です",
                "Ruta no válida en el ZIP",
                "Chemin invalide dans le ZIP",
            ]))?)
            .map_err(|_| {
                locale::text([
                    "Could not create a folder for model files",
                    "无法创建模型资源目录",
                    "モデルファイル用のフォルダーを作成できません",
                    "No se pudo crear una carpeta para los archivos del modelo",
                    "Impossible de créer un dossier pour les fichiers du modèle",
                ])
            })?;
            let mut output = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(output_path)
                .map_err(|_| {
                    locale::text([
                        "A ZIP file path conflicts or cannot be written",
                        "ZIP 资源路径冲突或无法写入",
                        "ZIP 内のファイルパスが競合しているか、書き込めません",
                        "Una ruta de archivo del ZIP está en conflicto o no se puede escribir",
                        "Un chemin de fichier du ZIP est en conflit ou ne peut pas être écrit",
                    ])
                })?;
            let remaining = MAX_FILE_BYTES.min(MAX_TOTAL_BYTES - total);
            let copied =
                io::copy(&mut entry.by_ref().take(remaining + 1), &mut output).map_err(|_| {
                    locale::text([
                        "Failed to extract a file from the ZIP",
                        "ZIP 资源解压失败",
                        "ZIP からのファイルの展開に失敗しました",
                        "Error al extraer un archivo del ZIP",
                        "Échec de l’extraction d’un fichier du ZIP",
                    ])
                })?;
            if copied > MAX_FILE_BYTES || copied > MAX_TOTAL_BYTES - total {
                return Err(locale::text(ZIP_TOO_LARGE).into());
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
        let registry = Registry::default();
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
        if let Some((name, config)) =
            super::super::vts::model_config(&source.join(&model.entry)).unwrap()
        {
            zip.start_file(format!("model/{name}"), SimpleFileOptions::default())
                .unwrap();
            zip.write_all(&serde_json::to_vec(&config).unwrap())
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
    fn imports_unreferenced_actions_without_vts_and_preserves_display_info() {
        let source = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        fixture(source.path());
        fs::create_dir(source.path().join("expressions")).unwrap();
        fs::create_dir(source.path().join("motions")).unwrap();
        let expression = br#"{"Type":"Live2D Expression","Parameters":[{"Id":"Param15","Value":1,"Blend":"Add"}]}"#;
        let motion = br#"{"Version":3,"Meta":{"Duration":1,"Fps":30,"CurveCount":1,"TotalSegmentCount":1,"TotalPointCount":2,"UserDataCount":0},"Curves":[{"Target":"Parameter","Id":"Param15","Segments":[0,0,0,1,1]}]}"#;
        for name in ["native", "hat"] {
            fs::write(
                source.path().join(format!("expressions/{name}.exp3.json")),
                expression,
            )
            .unwrap();
            fs::write(
                source.path().join(format!("motions/{name}.motion3.json")),
                motion,
            )
            .unwrap();
        }
        fs::write(
            source.path().join("leaf.model3.json"),
            br#"{"Version":3,"FileReferences":{"Moc":"leaf.moc3","Textures":["texture.png"],"DisplayInfo":"leaf.cdi3.json","Expressions":[{"Name":"Original","File":"expressions/native.exp3.json"}],"Motions":{"Idle":[{"File":"motions/native.motion3.json"}]}}}"#,
        )
        .unwrap();
        let display_info = r#"{"Parameters":[{"Id":"Param15","Name":"牌子","GroupId":"Props"}],"ParameterGroups":[{"Id":"Props","Name":"道具"}]}"#;
        fs::write(source.path().join("leaf.cdi3.json"), display_info).unwrap();
        let registry = Registry::default();
        let imported = registry.load(source.path(), data.path()).unwrap();
        let extras = imported.vts_resources.as_ref().unwrap();
        assert_eq!(extras.expressions.len(), 1);
        assert_eq!(extras.expressions[0].file, "expressions/hat.exp3.json");
        assert_eq!(extras.motions.len(), 1);
        assert_eq!(extras.motions[0].file, "motions/hat.motion3.json");
        assert!(extras.warnings.is_empty());
        assert!(registry.read_vts_config(&imported.id).unwrap().is_none());
        let direct = registry
            .load(&source.path().join("leaf.model3.json"), data.path())
            .unwrap();
        assert_eq!(direct.files, imported.files);
        let archive = data.path().join("model.zip");
        let mut zip = zip::ZipWriter::new(File::create(&archive).unwrap());
        for file in &imported.files {
            zip.start_file(format!("model/{file}"), SimpleFileOptions::default())
                .unwrap();
            zip.write_all(&fs::read(source.path().join(file)).unwrap())
                .unwrap();
        }
        zip.finish().unwrap();
        let zipped = registry.load(&archive, data.path()).unwrap();
        assert_eq!(zipped.files, imported.files);
        source.close().unwrap();
        let restarted = Registry::default();
        let library = restarted.list(data.path()).unwrap();
        assert!(library.errors.is_empty());
        assert_eq!(library.models.len(), 3);
        for info in library.models {
            assert_eq!(
                serde_json::to_value(info.vts_resources.as_ref().unwrap()).unwrap(),
                serde_json::to_value(extras).unwrap()
            );
            for (file, expected) in [
                ("expressions/hat.exp3.json", expression.as_slice()),
                ("motions/hat.motion3.json", motion.as_slice()),
                ("leaf.cdi3.json", display_info.as_bytes()),
            ] {
                assert_eq!(restarted.read(&info.id, file).unwrap(), expected);
            }
            assert!(restarted.read(&info.id, "private.txt").is_err());
        }
    }

    #[test]
    fn imports_vts_only_resources_and_keeps_them_readable_after_reload() {
        let source = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        fixture(source.path());
        fs::create_dir(source.path().join("expressions")).unwrap();
        fs::create_dir(source.path().join("motions")).unwrap();
        fs::write(
            source.path().join("expressions/牌子.exp3.json"),
            br#"{"Type":"Live2D Expression","Parameters":[{"Id":"Param15","Value":1,"Blend":"Add"}]}"#,
        )
        .unwrap();
        let motion = br#"{"Version":3,"Meta":{"Duration":1,"Fps":30,"CurveCount":1,"TotalSegmentCount":1,"TotalPointCount":2,"UserDataCount":0},"Curves":[{"Target":"Parameter","Id":"Param15","Segments":[0,0,0,1,1]}]}"#;
        for name in ["wave", "idle", "lost"] {
            fs::write(
                source.path().join(format!("motions/{name}.motion3.json")),
                motion,
            )
            .unwrap();
        }
        fs::write(
            source.path().join("leaf.vtube.json"),
            r#"{"Version":1,"ParameterSettings":[],"Hotkeys":[{"Name":"牌子","Action":"ToggleExpression","File":"牌子.exp3.json"},{"Name":"duplicate","Action":"ToggleExpression","File":".\\expressions\\牌子.exp3.json"},{"Name":"挥手","Action":"TriggerAnimation","File":"wave.motion3.json"}],"FileReferences":{"IdleAnimation":"./idle.motion3.json","IdleAnimationWhenTrackingLost":"motions/lost.motion3.json"}}"#,
        )
        .unwrap();
        let registry = Registry::default();
        let info = registry.load(source.path(), data.path()).unwrap();
        assert!(info
            .files
            .contains(&"expressions/牌子.exp3.json".to_owned()));
        let extras = info.vts_resources.as_ref().unwrap();
        assert_eq!(extras.expressions.len(), 1);
        assert_eq!(extras.expressions[0].name, "牌子");
        assert_eq!(extras.motions.len(), 3);
        assert_eq!(extras.motions[0].name, "挥手");
        assert!(extras.warnings.is_empty());
        assert_eq!(
            serde_json::to_value(&info).unwrap()["vtsResources"]["expressions"][0]["file"],
            "expressions/牌子.exp3.json"
        );
        assert!(registry.read(&info.id, "private.txt").is_err());
        assert_eq!(
            registry.read(&info.id, &info.entry).unwrap(),
            fs::read(source.path().join(&info.entry)).unwrap()
        );
        let direct = registry
            .load(&source.path().join(&info.entry), data.path())
            .unwrap();
        assert_eq!(direct.files, info.files);
        let archive = data.path().join("vts-model.zip");
        let mut zip = zip::ZipWriter::new(File::create(&archive).unwrap());
        for file in info
            .files
            .iter()
            .map(String::as_str)
            .chain(["leaf.vtube.json"])
        {
            zip.start_file(format!("model/{file}"), SimpleFileOptions::default())
                .unwrap();
            zip.write_all(&fs::read(source.path().join(file)).unwrap())
                .unwrap();
        }
        zip.finish().unwrap();
        let zipped = registry.load(&archive, data.path()).unwrap();
        assert_eq!(zipped.files, info.files);
        assert_eq!(
            zipped.vts_resources.as_ref().unwrap().expressions[0].file,
            "expressions/牌子.exp3.json"
        );
        source.close().unwrap();
        let restarted = Registry::default();
        let library = restarted.list(data.path()).unwrap();
        assert!(library.errors.is_empty());
        assert_eq!(library.models.len(), 3);
        for info in library.models {
            assert_eq!(info.vts_resources.as_ref().unwrap().expressions.len(), 1);
            assert!(!restarted
                .read(&info.id, "expressions/牌子.exp3.json")
                .unwrap()
                .is_empty());
            assert_eq!(
                restarted
                    .read(&info.id, "motions/wave.motion3.json")
                    .unwrap(),
                motion
            );
        }
    }

    #[test]
    fn invalid_optional_vts_resources_warn_without_blocking_the_model() {
        let source = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        fixture(source.path());
        let expression = br#"{"Type":"Live2D Expression","Parameters":[{"Id":"Param15","Value":1,"Blend":"Add"}]}"#;
        for directory in ["one", "two"] {
            fs::create_dir(source.path().join(directory)).unwrap();
            fs::write(
                source.path().join(directory).join("same.exp3.json"),
                expression,
            )
            .unwrap();
        }
        fs::write(source.path().join("bad.exp3.json"), b"{}").unwrap();
        File::create(source.path().join("huge.exp3.json"))
            .unwrap()
            .set_len(MAX_FILE_BYTES + 1)
            .unwrap();
        let cases = [
            ("same.exp3.json", "多个同名文件"),
            ("missing.exp3.json", "缺少"),
            ("../outside.exp3.json", "不安全"),
            ("C:\\outside.exp3.json", "不安全"),
            ("bad.exp3.json", "结构无效"),
            ("huge.exp3.json", "128 MB"),
        ];
        let config = serde_json::json!({"Version":1, "ParameterSettings":[], "Hotkeys": cases.iter().map(|(file, _)| serde_json::json!({"Action":"ToggleExpression", "File":file})).collect::<Vec<_>>()});
        fs::write(
            source.path().join("leaf.vtube.json"),
            serde_json::to_vec(&config).unwrap(),
        )
        .unwrap();
        let registry = Registry::default();
        let info = registry.load(source.path(), data.path()).unwrap();
        let extras = info.vts_resources.unwrap();
        assert_eq!(
            extras
                .expressions
                .iter()
                .map(|resource| resource.file.as_str())
                .collect::<Vec<_>>(),
            ["one/same.exp3.json", "two/same.exp3.json"]
        );
        assert!(extras.warnings.len() >= cases.len());
        for (file, reason) in cases {
            assert!(
                extras.warnings.iter().any(|warning| warning.contains(file)
                    && warning.contains(reason)
                    && warning.contains("重新导入")),
                "missing warning for {file}: {:?}",
                extras.warnings
            );
        }
        assert_eq!(registry.read(&info.id, "leaf.moc3").unwrap(), b"MOC3");

        // An exact relative path wins over duplicate basenames in child directories.
        fs::write(source.path().join("same.exp3.json"), expression).unwrap();
        fs::write(
            source.path().join("leaf.vtube.json"),
            br#"{"Version":1,"Hotkeys":[{"Action":"ToggleExpression","File":"same.exp3.json"}]}"#,
        )
        .unwrap();
        let info = registry.load(source.path(), data.path()).unwrap();
        assert_eq!(
            info.vts_resources.unwrap().expressions[0].file,
            "same.exp3.json"
        );

        #[cfg(unix)]
        {
            fs::remove_file(source.path().join("same.exp3.json")).unwrap();
            fs::write(data.path().join("outside.exp3.json"), expression).unwrap();
            std::os::unix::fs::symlink(
                data.path().join("outside.exp3.json"),
                source.path().join("same.exp3.json"),
            )
            .unwrap();
            let info = registry.load(source.path(), data.path()).unwrap();
            let extras = info.vts_resources.unwrap();
            assert_eq!(extras.expressions.len(), 2);
            assert!(!info.files.contains(&"same.exp3.json".to_owned()));
            assert!(extras
                .warnings
                .iter()
                .any(|warning| warning.contains("超出模型目录")));
        }
    }

    #[test]
    fn validates_motion_segments_before_exposing_them_to_cubism() {
        let motion: Value = serde_json::from_slice(include_bytes!(
            "../../vendor/models/Hiyori/motions/Hiyori_m03.motion3.json"
        ))
        .unwrap();
        assert!(valid_vts_resource(&motion, false));
        let mut invalid = motion.clone();
        invalid["Meta"]["TotalSegmentCount"] = serde_json::json!(1_000_000_000);
        assert!(!valid_vts_resource(&invalid, false));
        let mut invalid = motion.clone();
        invalid["Curves"][0]["Segments"][2] = serde_json::json!(99);
        assert!(!valid_vts_resource(&invalid, false));
        let mut invalid = motion;
        invalid["Curves"][0]["Segments"]
            .as_array_mut()
            .unwrap()
            .pop();
        assert!(!valid_vts_resource(&invalid, false));
        let constant = serde_json::json!({"Version":3,"Meta":{"Duration":1,"Fps":30,"CurveCount":1,"TotalSegmentCount":0,"TotalPointCount":1,"UserDataCount":0},"Curves":[{"Target":"Parameter","Id":"Param15","Segments":[0,1]}]});
        // The bundled Cubism parser requires at least one segment for each curve.
        assert!(!valid_vts_resource(&constant, false));
    }

    #[test]
    fn failed_optional_config_copy_keeps_independently_validated_actions_readable() {
        let source = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        fixture(source.path());
        fs::write(
            source.path().join("hat.exp3.json"),
            br#"{"Type":"Live2D Expression","Parameters":[]}"#,
        )
        .unwrap();
        fs::write(
            source.path().join("custom#config.vtube.json"),
            br#"{"Version":1,"Hotkeys":[{"Action":"ToggleExpression","File":"hat.exp3.json"}]}"#,
        )
        .unwrap();
        let registry = Registry::default();
        let info = registry.load(source.path(), data.path()).unwrap();
        let extras = info.vts_resources.unwrap();
        assert_eq!(extras.expressions.len(), 1);
        assert_eq!(extras.expressions[0].file, "hat.exp3.json");
        assert!(!extras.warnings.is_empty());
        assert!(registry.read(&info.id, "leaf.moc3").is_ok());
        assert!(registry.read(&info.id, "hat.exp3.json").is_ok());
    }

    #[test]
    fn unreferenced_actions_remain_optional_and_respect_resource_limits() {
        let source = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        fixture(source.path());
        let expression = br#"{"Type":"Live2D Expression","Parameters":[]}"#;
        fs::write(source.path().join("hat.exp3.json"), expression).unwrap();
        fs::write(source.path().join("bad.exp3.json"), b"{}").unwrap();
        fs::write(source.path().join("leaf.vtube.json"), b"bad config").unwrap();
        File::create(source.path().join("huge.motion3.json"))
            .unwrap()
            .set_len(MAX_FILE_BYTES + 1)
            .unwrap();
        #[cfg(unix)]
        {
            fs::write(data.path().join("outside.exp3.json"), expression).unwrap();
            std::os::unix::fs::symlink(data.path(), source.path().join("linked-directory"))
                .unwrap();
            std::os::unix::fs::symlink(
                data.path().join("outside.exp3.json"),
                source.path().join("linked.exp3.json"),
            )
            .unwrap();
        }
        let registry = Registry::default();
        let info = registry.load(source.path(), data.path()).unwrap();
        let extras = info.vts_resources.unwrap();
        assert_eq!(extras.expressions.len(), 1);
        assert_eq!(extras.expressions[0].file, "hat.exp3.json");
        assert!(extras.motions.is_empty());
        for file in ["bad.exp3.json", "huge.motion3.json"] {
            assert!(extras.warnings.iter().any(|warning| warning.contains(file)));
            assert!(registry.read(&info.id, file).is_err());
        }
        assert!(registry.read_vts_config(&info.id).is_err());
        assert!(registry.read(&info.id, "linked.exp3.json").is_err());
        assert!(registry
            .read(&info.id, "linked-directory/outside.exp3.json")
            .is_err());

        let root = source.path().canonicalize().unwrap();
        let mut resources = BTreeSet::new();
        let extras = discover_model_resources(&root, None, &mut resources, MAX_TOTAL_BYTES);
        assert!(resources.is_empty());
        assert!(extras.expressions.is_empty());
        assert!(extras
            .warnings
            .iter()
            .any(|warning| warning.contains("512 MB")));

        let deep = source.path().join(
            std::iter::repeat_n("nested", 17)
                .collect::<Vec<_>>()
                .join("/"),
        );
        fs::create_dir_all(deep).unwrap();
        let info = registry
            .load(&source.path().join("leaf.model3.json"), data.path())
            .unwrap();
        assert_eq!(registry.read(&info.id, "leaf.moc3").unwrap(), b"MOC3");
        assert!(info
            .vts_resources
            .unwrap()
            .warnings
            .iter()
            .any(|warning| warning.contains("层级超过 16")));
    }

    #[test]
    fn library_lists_newest_imports_first_after_reload() {
        let source = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let registry = Registry::default();
        let mut paths = Vec::new();
        for name in ["Alpha", "Zulu", "Middle"] {
            let root = source.path().join(name);
            fs::create_dir(&root).unwrap();
            fixture(&root);
            fs::rename(
                root.join("leaf.model3.json"),
                root.join(format!("{name}.model3.json")),
            )
            .unwrap();
            paths.push(registry.load(&root, data.path()).unwrap().path);
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        // Selecting an old model and saving its preview must not change its position.
        let oldest = registry.load(Path::new(&paths[0]), data.path()).unwrap();
        let png = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR\0\0\x01\0\0\0\x01\0";
        registry.save_preview(&oldest.id, data.path(), png).unwrap();
        for registry in [registry, Registry::default()] {
            let library = registry.list(data.path()).unwrap();
            assert!(library.errors.is_empty());
            assert_eq!(
                library
                    .models
                    .iter()
                    .map(|model| model.name.as_str())
                    .collect::<Vec<_>>(),
                ["Middle", "Zulu", "Alpha"]
            );
        }
    }

    #[test]
    fn removing_an_import_preserves_source_and_other_models() {
        let source = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        fixture(source.path());
        let registry = Registry::default();
        let imported = registry.load(source.path(), data.path()).unwrap();
        let other = registry.load(source.path(), data.path()).unwrap();
        let directory = Path::new(&imported.path).parent().unwrap().to_owned();
        let png = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR\0\0\x01\0\0\0\x01\0";
        registry
            .save_preview(&imported.id, data.path(), png)
            .unwrap();
        let preview = registry.preview_path(&imported.id, data.path()).unwrap();

        registry.remove(&imported.id, data.path()).unwrap();
        assert!(!directory.exists());
        assert!(!preview.exists());
        assert!(registry.read(&imported.id, "leaf.moc3").is_err());
        assert_eq!(fs::read(source.path().join("leaf.moc3")).unwrap(), b"MOC3");
        assert_eq!(registry.read(&other.id, "leaf.moc3").unwrap(), b"MOC3");
        let remaining = Registry::default().list(data.path()).unwrap();
        assert_eq!(remaining.models.len(), 1);
        assert_eq!(remaining.models[0].path, other.path);
        assert!(registry.remove(&imported.id, data.path()).is_err());

        let external = registry
            .register(validate_model(source.path()).unwrap())
            .unwrap();
        assert!(registry.remove(&external.id, data.path()).is_err());
        assert!(source.path().join("leaf.model3.json").exists());
    }

    #[cfg(unix)]
    #[test]
    fn removing_an_import_rejects_a_replaced_directory_symlink() {
        let source = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        fixture(source.path());
        let registry = Registry::default();
        let imported = registry.load(source.path(), data.path()).unwrap();
        let directory = Path::new(&imported.path).parent().unwrap();
        fs::remove_dir_all(directory).unwrap();
        std::os::unix::fs::symlink(source.path(), directory).unwrap();
        assert!(registry.remove(&imported.id, data.path()).is_err());
        assert_eq!(fs::read(source.path().join("leaf.moc3")).unwrap(), b"MOC3");
    }

    #[test]
    fn bundled_models_populate_the_library_once_and_preserve_user_data() {
        let bundled = Path::new(env!("CARGO_MANIFEST_DIR")).join("../vendor/models");
        let data = tempfile::tempdir().unwrap();
        let registry = Registry::default();
        let library = registry.list_with_builtins(data.path(), &bundled).unwrap();
        assert!(library.errors.is_empty(), "{:?}", library.errors);
        assert_eq!(
            library
                .models
                .iter()
                .map(|model| model.name.as_str())
                .collect::<BTreeSet<_>>(),
            BTreeSet::from(["Haru", "Hiyori", "Mao"])
        );
        for model in &library.models {
            assert!(model.builtin);
            assert!(registry.remove(&model.id, data.path()).is_err());
            for resource in &model.files {
                assert_eq!(
                    registry.read(&model.id, resource).unwrap(),
                    fs::read(bundled.join(&model.name).join(resource)).unwrap()
                );
                assert!(!resource.ends_with(".wav"));
            }
        }
        let haru = library
            .models
            .iter()
            .find(|model| model.name == "Haru")
            .unwrap();
        let png = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR\0\0\x01\0\0\0\x01\0";
        registry.save_preview(&haru.id, data.path(), png).unwrap();
        let entry = Path::new(&haru.path);
        let original = fs::read_to_string(entry).unwrap();
        let edited = format!("{original}\n");
        fs::write(entry, &edited).unwrap();
        let repeated = registry.list_with_builtins(data.path(), &bundled).unwrap();
        assert!(repeated.errors.is_empty());
        assert_eq!(repeated.models.len(), 3);
        assert!(repeated.models.iter().any(|model| model.id == haru.id));

        let source = tempfile::tempdir().unwrap();
        fixture(source.path());
        let imported = registry.load(source.path(), data.path()).unwrap();
        let restarted = Registry::default();
        let library = restarted.list_with_builtins(data.path(), &bundled).unwrap();
        assert!(library.errors.is_empty());
        assert_eq!(library.models.len(), 4);
        assert_eq!(library.models[0].path, imported.path);
        let restored_haru = library
            .models
            .iter()
            .find(|model| model.path == haru.path)
            .unwrap();
        assert_eq!(fs::read_to_string(entry).unwrap(), edited);
        assert_eq!(
            restarted
                .read_preview(&restored_haru.id, data.path())
                .unwrap(),
            png
        );

        // Missing bundle files must not prevent existing or imported models from loading.
        fs::remove_dir_all(data.path().join("models/builtin-Mao")).unwrap();
        let missing = data.path().join("missing-bundle");
        let library = restarted.list_with_builtins(data.path(), &missing).unwrap();
        assert_eq!(library.models.len(), 3);
        assert_eq!(library.errors.len(), 1);
        assert!(library.errors[0].contains("Mao"));
        let restored = restarted.list_with_builtins(data.path(), &bundled).unwrap();
        assert!(restored.errors.is_empty());
        assert_eq!(restored.models.len(), 4);
    }

    #[test]
    fn imports_icons_and_reads_them_without_rendering() {
        let source = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        fixture(source.path());
        fs::write(source.path().join("Avatar.JPG"), b"avatar").unwrap();
        fs::write(source.path().join("ico_leaf.png"), b"icon").unwrap();
        let registry = Registry::default();
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
        let restarted = Registry::default();
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
        let registry = Registry::default();
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
        let restarted = Registry::default();
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
        let next_run = Registry::default();
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
        let registry = Registry::default();
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
        let restarted = Registry::default();
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
        let registry = Registry::default();
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
        let registry = Registry::default();
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
        assert_eq!(fs::read_dir(&destination).unwrap().count(), 2);
        let registry = Registry::default();
        let imported = registry.register(first).unwrap();
        registry.remove(&imported.id, root.path()).unwrap();
        assert!(!Path::new(&imported.path).exists());
        assert_eq!(fs::read_dir(&destination).unwrap().count(), 1);
        assert!(second.entry.is_file());
        assert!(archive.is_file());
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

    #[test]
    fn reads_do_not_wait_for_imports_or_library_scans() {
        let source = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        fixture(source.path());
        let registry = Registry::default();
        let info = registry.load(source.path(), data.path()).unwrap();
        let (sender, receiver) = std::sync::mpsc::channel();
        std::thread::scope(|scope| {
            // Stands in for a long import, removal or library scan.
            let disk = registry.disk.lock().unwrap();
            let (registry, id, data) = (&registry, &info.id, data.path());
            scope.spawn(move || {
                let read = (
                    registry.read(id, "leaf.moc3"),
                    registry.read_preview(id, data),
                    registry.read_vts_config(id),
                );
                sender.send(read).unwrap();
            });
            let read = receiver.recv_timeout(std::time::Duration::from_secs(10));
            drop(disk);
            let (resource, preview, config) =
                read.expect("model reads must not wait for disk work");
            assert_eq!(resource.unwrap(), b"MOC3");
            assert!(preview.unwrap().is_empty());
            assert!(config.unwrap().is_none());
        });
    }

    #[test]
    fn copying_rechecks_resources_changed_after_validation() {
        let source = tempfile::tempdir().unwrap();
        let destination = tempfile::tempdir().unwrap();
        fixture(source.path());
        let model = validate_model(source.path()).unwrap();
        #[cfg(unix)]
        let locked = {
            use std::os::unix::fs::PermissionsExt;
            let locked = model.root.join(&model.files[0]);
            fs::set_permissions(&locked, fs::Permissions::from_mode(0o444)).unwrap();
            locked
        };
        let copy = copy_model(&model, destination.path()).unwrap();
        for file in &model.files {
            assert_eq!(
                fs::read(copy.root.join(file)).unwrap(),
                fs::read(model.root.join(file)).unwrap()
            );
        }
        // Copies are fresh files, so a locked or read-only source can't block removing the model.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(copy.root.join(&model.files[0]))
                .unwrap()
                .permissions()
                .mode();
            assert_ne!(mode & 0o200, 0);
            fs::set_permissions(&locked, fs::Permissions::from_mode(0o644)).unwrap();
        }
        let texture = source.path().join("texture.png");
        File::create(&texture)
            .unwrap()
            .set_len(MAX_FILE_BYTES + 1)
            .unwrap();
        assert!(copy_model(&model, destination.path()).is_err());
        #[cfg(unix)]
        {
            let outside = tempfile::tempdir().unwrap();
            fs::write(outside.path().join("secret.png"), b"secret").unwrap();
            fs::remove_file(&texture).unwrap();
            std::os::unix::fs::symlink(outside.path().join("secret.png"), &texture).unwrap();
            assert!(copy_model(&model, destination.path()).is_err());
        }
        // Failed copies leave only the successful one behind.
        assert_eq!(fs::read_dir(destination.path()).unwrap().count(), 1);
    }
}

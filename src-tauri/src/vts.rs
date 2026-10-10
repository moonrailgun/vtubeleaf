use crate::locale;
use std::{fs, io::Read, path::Path};
use tauri_plugin_dialog::DialogExt;

const LIMIT: u64 = 2 * 1024 * 1024;

const SEARCH_FAILED: [&str; 5] = [
    "Could not look for a VTS config",
    "无法查找 VTS 配置",
    "VTS 設定を検索できません",
    "No se pudo buscar la configuración de VTS",
    "Impossible de rechercher la configuration VTS",
];

const PATH_UNREADABLE: [&str; 5] = [
    "Could not read the VTS config path",
    "无法读取 VTS 配置路径",
    "VTS 設定のパスを読み込めません",
    "No se pudo leer la ruta de la configuración de VTS",
    "Impossible de lire le chemin de la configuration VTS",
];

pub fn model_config(entry: &Path) -> Result<Option<(String, serde_json::Value)>, String> {
    let root = entry.parent().ok_or(locale::text([
        "Invalid model folder",
        "模型目录无效",
        "モデルフォルダーが無効です",
        "Carpeta del modelo no válida",
        "Dossier du modèle invalide",
    ]))?;
    let model = entry
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or(locale::text([
            "Invalid model file name",
            "模型文件名无效",
            "モデルのファイル名が無効です",
            "Nombre de archivo del modelo no válido",
            "Nom de fichier du modèle invalide",
        ]))?;
    let preferred = format!("{}.vtube.json", model.trim_end_matches(".model3.json"));
    let name = match fs::symlink_metadata(root.join(&preferred)) {
        Ok(_) => preferred,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let mut candidate = None;
            for (index, file) in fs::read_dir(root)
                .map_err(|_| locale::text(SEARCH_FAILED))?
                .enumerate()
            {
                if index >= 2048 {
                    return Err(locale::text([
                        "The model folder has too many files. Choose the VTS config manually",
                        "模型目录文件过多，请手动选择 VTS 配置",
                        "モデルフォルダーのファイルが多すぎます。VTS 設定を手動で選択してください",
                        "La carpeta del modelo tiene demasiados archivos. Elige la configuración de VTS manualmente",
                        "Le dossier du modèle contient trop de fichiers. Choisissez la configuration VTS manuellement",
                    ]).into());
                }
                let file = file.map_err(|_| locale::text(SEARCH_FAILED))?;
                let name = file.file_name().to_string_lossy().into_owned();
                if name.to_ascii_lowercase().ends_with(".vtube.json") {
                    if candidate.is_some() {
                        return Err(locale::text([
                            "Found several VTS configs. Choose the one you want manually",
                            "发现多个 VTS 配置，请手动选择需要的配置",
                            "VTS 設定が複数見つかりました。使いたい設定を手動で選択してください",
                            "Se encontraron varias configuraciones de VTS. Elige manualmente la que quieras",
                            "Plusieurs configurations VTS trouvées. Choisissez manuellement celle que vous voulez",
                        ]).into());
                    }
                    candidate = Some(name);
                }
            }
            let Some(name) = candidate else {
                return Ok(None);
            };
            name
        }
        Err(_) => return Err(locale::text(PATH_UNREADABLE).into()),
    };
    let value = read_config(&root.join(&name))?;
    if let Some(reference) = value.pointer("/FileReferences/Model") {
        if reference
            .as_str()
            .map(|s| s.strip_prefix("./").unwrap_or(s))
            != Some(model)
        {
            return Err(locale::text([
                "The VTS config refers to a different model. Check it and import it manually",
                "VTS 配置引用了其他模型，请手动确认后导入",
                "VTS 設定が別のモデルを参照しています。確認してから手動でインポートしてください",
                "La configuración de VTS hace referencia a otro modelo. Revísala e impórtala manualmente",
                "La configuration VTS fait référence à un autre modèle. Vérifiez-la puis importez-la manuellement",
            ]).into());
        }
    }
    Ok(Some((name, value)))
}

fn read_config(path: &Path) -> Result<serde_json::Value, String> {
    // Reject links in every component, including linked parent directories.
    for ancestor in path.ancestors() {
        let meta = fs::symlink_metadata(ancestor).map_err(|_| locale::text(PATH_UNREADABLE))?;
        if meta.file_type().is_symlink() {
            return Err(locale::text([
                "The VTS config path cannot contain symbolic links",
                "VTS 配置路径不可包含符号链接",
                "VTS 設定のパスにシンボリックリンクを含めることはできません",
                "La ruta de la configuración de VTS no puede contener enlaces simbólicos",
                "Le chemin de la configuration VTS ne peut pas contenir de liens symboliques",
            ])
            .into());
        }
    }
    let meta = fs::symlink_metadata(path).map_err(|_| {
        locale::text([
            "Could not read the VTS config",
            "无法读取 VTS 配置",
            "VTS 設定を読み込めません",
            "No se pudo leer la configuración de VTS",
            "Impossible de lire la configuration VTS",
        ])
    })?;
    if !meta.is_file() || meta.len() > LIMIT {
        return Err(locale::text([
            "The VTS config must be a regular local file no larger than 2 MB",
            "VTS 配置必须为不超过 2 MB 的本机普通文件",
            "VTS 設定は 2 MB 以下のローカルの通常ファイルである必要があります",
            "La configuración de VTS debe ser un archivo local normal de 2 MB como máximo",
            "La configuration VTS doit être un fichier local standard de 2 MB maximum",
        ])
        .into());
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|_| {
            locale::text([
                "Could not open the VTS config",
                "无法打开 VTS 配置",
                "VTS 設定を開けません",
                "No se pudo abrir la configuración de VTS",
                "Impossible d’ouvrir la configuration VTS",
            ])
        })?
        .take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| {
            locale::text([
                "Failed to read the VTS config",
                "VTS 配置读取失败",
                "VTS 設定の読み込みに失敗しました",
                "Error al leer la configuración de VTS",
                "Échec de la lecture de la configuration VTS",
            ])
        })?;
    if bytes.len() as u64 > LIMIT {
        return Err(locale::text([
            "The VTS config is larger than 2 MB",
            "VTS 配置超过 2 MB",
            "VTS 設定が 2 MB を超えています",
            "La configuración de VTS supera los 2 MB",
            "La configuration VTS dépasse 2 MB",
        ])
        .into());
    }
    serde_json::from_slice(&bytes).map_err(|_| {
        locale::text([
            "The VTS config is not valid JSON",
            "VTS 配置不是有效 JSON",
            "VTS 設定が有効な JSON ではありません",
            "La configuración de VTS no es un JSON válido",
            "La configuration VTS n’est pas un JSON valide",
        ])
        .into()
    })
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
            .set_title(locale::text([
                "Import VTube Studio config",
                "导入 VTube Studio 配置",
                "VTube Studio の設定をインポート",
                "Importar configuración de VTube Studio",
                "Importer une configuration VTube Studio",
            ]))
            .add_filter("VTube Studio JSON", &["json"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|_| {
            locale::text([
                "Only local VTS configs are supported",
                "仅支持本机 VTS 配置",
                "ローカルの VTS 設定のみ対応しています",
                "Solo se admiten configuraciones de VTS locales",
                "Seules les configurations VTS locales sont prises en charge",
            ])
        })?;
        read_config(&path).map(Some)
    })
    .await
    .map_err(|_| {
        locale::text([
            "VTS config import was interrupted",
            "VTS 配置导入任务中断",
            "VTS 設定のインポートが中断されました",
            "Se interrumpió la importación de la configuración de VTS",
            "L’importation de la configuration VTS a été interrompue",
        ])
    })?
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

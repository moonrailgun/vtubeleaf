use crate::locale;
use std::{
    fs,
    io::{Read, Write},
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

const LIMIT: u64 = 16 * 1024 * 1024;

fn extension(bytes: &[u8]) -> Result<&'static str, String> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Ok("png")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Ok("gif")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Ok("jpg")
    } else {
        Err(locale::text([
            "Only PNG, JPEG and GIF images are supported",
            "仅支持 PNG、JPEG 和 GIF 图片",
            "PNG・JPEG・GIF 画像のみ対応しています",
            "Solo se admiten imágenes PNG, JPEG y GIF",
            "Seules les images PNG, JPEG et GIF sont prises en charge",
        ])
        .into())
    }
}

fn read_file(path: &Path) -> Result<Vec<u8>, String> {
    let meta = fs::symlink_metadata(path).map_err(|_| {
        locale::text([
            "Could not read the image",
            "无法读取图片",
            "画像を読み込めません",
            "No se pudo leer la imagen",
            "Impossible de lire l’image",
        ])
    })?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > LIMIT {
        return Err(locale::text([
            "The image must be a regular local file no larger than 16 MB",
            "图片必须为本机普通文件，且不超过 16 MB",
            "画像は 16 MB 以下のローカルの通常ファイルである必要があります",
            "La imagen debe ser un archivo local normal de 16 MB como máximo",
            "L’image doit être un fichier local standard de 16 MB maximum",
        ])
        .into());
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|_| {
            locale::text([
                "Could not open the image",
                "无法打开图片",
                "画像を開けません",
                "No se pudo abrir la imagen",
                "Impossible d’ouvrir l’image",
            ])
        })?
        .take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| {
            locale::text([
                "Failed to read the image",
                "图片读取失败",
                "画像の読み込みに失敗しました",
                "Error al leer la imagen",
                "Échec de la lecture de l’image",
            ])
        })?;
    if bytes.len() as u64 > LIMIT {
        return Err(locale::text([
            "The image is larger than 16 MB",
            "图片超过 16 MB",
            "画像が 16 MB を超えています",
            "La imagen supera los 16 MB",
            "L’image dépasse 16 MB",
        ])
        .into());
    }
    extension(&bytes)?;
    Ok(bytes)
}

fn valid_id(id: &str) -> bool {
    let Some((name, ext)) = id.split_once('.') else {
        return false;
    };
    name.len() == 32
        && name
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        && matches!(ext, "png" | "jpg" | "gif")
}

#[tauri::command]
pub async fn choose_asset(
    window: WebviewWindow,
    app: tauri::AppHandle,
) -> Result<Option<serde_json::Value>, String> {
    super::require_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .set_title(locale::text([
                "Import prop or background",
                "导入道具或背景",
                "アイテムまたは背景をインポート",
                "Importar accesorio o fondo",
                "Importer un accessoire ou un arrière-plan",
            ]))
            .add_filter(
                locale::text(["Images", "图片", "画像", "Imágenes", "Images"]),
                &["png", "jpg", "jpeg", "gif"],
            )
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|_| {
            locale::text([
                "Only local images are supported",
                "仅支持本机图片",
                "ローカルの画像のみ対応しています",
                "Solo se admiten imágenes locales",
                "Seules les images locales sont prises en charge",
            ])
        })?;
        let bytes = read_file(&path)?;
        let root = app.state::<super::AppState>().data_dir.join("assets");
        fs::create_dir_all(&root).map_err(|_| {
            locale::text([
                "Could not create the assets folder",
                "无法创建素材目录",
                "素材フォルダーを作成できません",
                "No se pudo crear la carpeta de recursos",
                "Impossible de créer le dossier des ressources",
            ])
        })?;
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| {
                locale::text([
                    "The system clock is invalid",
                    "系统时间异常",
                    "システム時刻が正しくありません",
                    "La hora del sistema no es válida",
                    "L’horloge système est incorrecte",
                ])
            })?
            .as_nanos();
        let id = format!("{nanos:032x}.{}", extension(&bytes)?);
        let mut temp = tempfile::NamedTempFile::new_in(&root).map_err(|_| {
            locale::text([
                "Could not write the asset",
                "无法写入素材",
                "素材を書き込めません",
                "No se pudo escribir el recurso",
                "Impossible d’écrire la ressource",
            ])
        })?;
        temp.write_all(&bytes).map_err(|_| {
            locale::text([
                "Failed to write the asset",
                "素材写入失败",
                "素材の書き込みに失敗しました",
                "Error al escribir el recurso",
                "Échec de l’écriture de la ressource",
            ])
        })?;
        temp.as_file().sync_all().map_err(|_| {
            locale::text([
                "Failed to save the asset",
                "素材保存失败",
                "素材の保存に失敗しました",
                "Error al guardar el recurso",
                "Échec de l’enregistrement de la ressource",
            ])
        })?;
        temp.persist_noclobber(root.join(&id)).map_err(|_| {
            locale::text([
                "Failed to save the asset. Please try again",
                "素材保存失败，请重试",
                "素材の保存に失敗しました。もう一度お試しください",
                "Error al guardar el recurso. Inténtalo de nuevo",
                "Échec de l’enregistrement de la ressource. Veuillez réessayer",
            ])
        })?;
        let name = path.file_stem().unwrap_or_default().to_string_lossy();
        Ok(Some(serde_json::json!({"id": id, "name": name})))
    })
    .await
    .map_err(|_| {
        locale::text([
            "Asset import was interrupted",
            "素材导入任务中断",
            "素材のインポートが中断されました",
            "Se interrumpió la importación del recurso",
            "L’importation de la ressource a été interrompue",
        ])
    })?
}

#[tauri::command]
pub async fn read_asset(
    window: WebviewWindow,
    app: tauri::AppHandle,
    id: String,
) -> Result<tauri::ipc::Response, String> {
    super::require_local_window(&window)?;
    if !valid_id(&id) {
        return Err(locale::text([
            "Invalid asset ID",
            "素材标识无效",
            "素材 ID が無効です",
            "ID de recurso no válido",
            "Identifiant de ressource invalide",
        ])
        .into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        read_file(
            &app.state::<super::AppState>()
                .data_dir
                .join("assets")
                .join(id),
        )
        .map(tauri::ipc::Response::new)
    })
    .await
    .map_err(|_| {
        locale::text([
            "Asset loading was interrupted",
            "素材读取任务中断",
            "素材の読み込みが中断されました",
            "Se interrumpió la lectura del recurso",
            "La lecture de la ressource a été interrompue",
        ])
    })?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_paths_and_foreign_content() {
        assert!(valid_id(&format!("{}.gif", "a".repeat(32))));
        for id in ["../../x.png", "/tmp/x.png", "bad.svg", "a.png/../x"] {
            assert!(!valid_id(id));
        }
        assert!(extension(b"<svg>").is_err());
        assert_eq!(extension(b"GIF89a").unwrap(), "gif");
    }
}

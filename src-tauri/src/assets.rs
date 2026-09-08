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
        Err("仅支持 PNG、JPEG 和 GIF 图片".into())
    }
}

fn read_file(path: &Path) -> Result<Vec<u8>, String> {
    let meta = fs::symlink_metadata(path).map_err(|_| "无法读取图片")?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > LIMIT {
        return Err("图片必须为本机普通文件，且不超过 16 MB".into());
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|_| "无法打开图片")?
        .take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "图片读取失败")?;
    if bytes.len() as u64 > LIMIT {
        return Err("图片超过 16 MB".into());
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
        let Some(file) = app.dialog().file().set_title("导入道具或背景").add_filter("图片", &["png", "jpg", "jpeg", "gif"]).blocking_pick_file() else { return Ok(None); };
        let path = file.into_path().map_err(|_| "仅支持本机图片")?;
        let bytes = read_file(&path)?;
        let root = app.state::<super::AppState>().data_dir.join("assets");
        fs::create_dir_all(&root).map_err(|_| "无法创建素材目录")?;
        let id = format!("{:032x}.{}", SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "系统时间异常")?.as_nanos(), extension(&bytes)?);
        let mut temp = tempfile::NamedTempFile::new_in(&root).map_err(|_| "无法写入素材")?;
        temp.write_all(&bytes).map_err(|_| "素材写入失败")?;
        temp.as_file().sync_all().map_err(|_| "素材保存失败")?;
        temp.persist_noclobber(root.join(&id)).map_err(|_| "素材保存失败，请重试")?;
        Ok(Some(serde_json::json!({"id": id, "name": path.file_stem().unwrap_or_default().to_string_lossy()})))
    }).await.map_err(|_| "素材导入任务中断")?
}

#[tauri::command]
pub async fn read_asset(
    window: WebviewWindow,
    app: tauri::AppHandle,
    id: String,
) -> Result<tauri::ipc::Response, String> {
    super::require_local_window(&window)?;
    if !valid_id(&id) {
        return Err("素材标识无效".into());
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
    .map_err(|_| "素材读取任务中断")?
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

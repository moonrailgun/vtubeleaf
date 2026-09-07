use serde_json::Value;
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::Path,
};

const MAX_SETTINGS_BYTES: u64 = 1024 * 1024;

pub fn save(root: &Path, settings: &Value) -> Result<(), String> {
    if !settings.is_object() {
        return Err("设置必须是 JSON 对象".into());
    }
    let bytes = serde_json::to_vec_pretty(settings).map_err(|_| "设置无法序列化")?;
    if bytes.len() as u64 > MAX_SETTINGS_BYTES {
        return Err("设置超过大小限制".into());
    }
    fs::create_dir_all(root).map_err(|_| "无法创建设置目录")?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(root).map_err(|_| "无法创建设置临时文件")?;
    temporary.write_all(&bytes).map_err(|_| "写入设置失败")?;
    temporary.as_file().sync_all().map_err(|_| "同步设置失败")?;
    temporary
        .persist(root.join("settings.json"))
        .map_err(|_| "保存设置失败，原有设置已保留")?;
    Ok(())
}

pub fn load(root: &Path) -> Result<Option<Value>, String> {
    let path = root.join("settings.json");
    let file = match File::open(&path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("无法读取设置文件".into()),
    };
    let mut bytes = Vec::new();
    file.take(MAX_SETTINGS_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "读取设置失败")?;
    if bytes.len() as u64 <= MAX_SETTINGS_BYTES {
        if let Ok(settings) = serde_json::from_slice::<Value>(&bytes) {
            if settings.is_object() {
                return Ok(Some(settings));
            }
        }
    }
    let recovery = tempfile::Builder::new()
        .prefix("settings-recovery-")
        .tempdir_in(root)
        .map_err(|_| "设置损坏，无法创建恢复目录；原文件已保留")?;
    fs::rename(&path, recovery.path().join("settings.json"))
        .map_err(|_| "设置损坏，无法备份；原文件已保留")?;
    let _ = recovery.keep();
    Err("设置文件损坏，已保留恢复副本并恢复默认设置".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn atomically_replaces_settings_and_preserves_corrupt_data() {
        let root = tempfile::tempdir().unwrap();
        let first = serde_json::json!({"smoothing":0.4});
        save(root.path(), &first).unwrap();
        assert_eq!(load(root.path()).unwrap(), Some(first));
        let second = serde_json::json!({"smoothing":0.8});
        save(root.path(), &second).unwrap();
        assert_eq!(load(root.path()).unwrap(), Some(second));
        std::fs::write(root.path().join("settings.json"), b"broken").unwrap();
        assert!(load(root.path()).is_err());
        assert_eq!(load(root.path()).unwrap(), None);
        assert!(std::fs::read_dir(root.path()).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("settings-recovery-")));
    }
}

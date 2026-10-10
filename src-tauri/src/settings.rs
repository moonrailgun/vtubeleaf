use crate::locale;
use serde_json::Value;
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::Path,
};

const MAX_SETTINGS_BYTES: u64 = 1024 * 1024;

pub fn save(root: &Path, settings: &Value) -> Result<(), String> {
    if !settings.is_object() {
        return Err(locale::text([
            "Settings must be a JSON object",
            "设置必须是 JSON 对象",
            "設定は JSON オブジェクトである必要があります",
            "Los ajustes deben ser un objeto JSON",
            "Les réglages doivent être un objet JSON",
        ])
        .into());
    }
    let bytes = serde_json::to_vec_pretty(settings).map_err(|_| {
        locale::text([
            "Could not serialize the settings",
            "设置无法序列化",
            "設定をシリアライズできません",
            "No se pudieron serializar los ajustes",
            "Impossible de sérialiser les réglages",
        ])
    })?;
    if bytes.len() as u64 > MAX_SETTINGS_BYTES {
        return Err(locale::text([
            "Settings exceed the size limit",
            "设置超过大小限制",
            "設定がサイズ上限を超えています",
            "Los ajustes superan el límite de tamaño",
            "Les réglages dépassent la taille maximale",
        ])
        .into());
    }
    fs::create_dir_all(root).map_err(|_| {
        locale::text([
            "Could not create the settings folder",
            "无法创建设置目录",
            "設定フォルダーを作成できません",
            "No se pudo crear la carpeta de ajustes",
            "Impossible de créer le dossier des réglages",
        ])
    })?;
    let mut temporary = tempfile::NamedTempFile::new_in(root).map_err(|_| {
        locale::text([
            "Could not create a temporary settings file",
            "无法创建设置临时文件",
            "設定の一時ファイルを作成できません",
            "No se pudo crear un archivo temporal de ajustes",
            "Impossible de créer un fichier temporaire de réglages",
        ])
    })?;
    temporary.write_all(&bytes).map_err(|_| {
        locale::text([
            "Failed to write settings",
            "写入设置失败",
            "設定の書き込みに失敗しました",
            "Error al escribir los ajustes",
            "Échec de l’écriture des réglages",
        ])
    })?;
    temporary.as_file().sync_all().map_err(|_| {
        locale::text([
            "Failed to sync settings",
            "同步设置失败",
            "設定の同期に失敗しました",
            "Error al sincronizar los ajustes",
            "Échec de la synchronisation des réglages",
        ])
    })?;
    temporary.persist(root.join("settings.json")).map_err(|_| {
        locale::text([
            "Failed to save settings; your previous settings were kept",
            "保存设置失败，原有设置已保留",
            "設定の保存に失敗しました。以前の設定はそのまま残っています",
            "Error al guardar los ajustes; se conservaron los anteriores",
            "Échec de l’enregistrement des réglages ; les réglages précédents ont été conservés",
        ])
    })?;
    Ok(())
}

pub fn load(root: &Path) -> Result<Option<Value>, String> {
    let path = root.join("settings.json");
    let file = match File::open(&path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => {
            return Err(locale::text([
                "Could not read the settings file",
                "无法读取设置文件",
                "設定ファイルを読み込めません",
                "No se pudo leer el archivo de ajustes",
                "Impossible de lire le fichier de réglages",
            ])
            .into())
        }
    };
    let mut bytes = Vec::new();
    file.take(MAX_SETTINGS_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| {
            locale::text([
                "Failed to read settings",
                "读取设置失败",
                "設定の読み込みに失敗しました",
                "Error al leer los ajustes",
                "Échec de la lecture des réglages",
            ])
        })?;
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
        .map_err(|_| locale::text([
            "Settings are corrupted and a recovery folder could not be created; the original file was kept",
            "设置损坏，无法创建恢复目录；原文件已保留",
            "設定が破損しており、復旧用フォルダーを作成できませんでした。元のファイルはそのまま残っています",
            "Los ajustes están dañados y no se pudo crear una carpeta de recuperación; se conservó el archivo original",
            "Les réglages sont corrompus et le dossier de récupération n’a pas pu être créé ; le fichier d’origine a été conservé",
        ]))?;
    fs::rename(&path, recovery.path().join("settings.json"))
        .map_err(|_| locale::text([
            "Settings are corrupted and could not be backed up; the original file was kept",
            "设置损坏，无法备份；原文件已保留",
            "設定が破損しており、バックアップできませんでした。元のファイルはそのまま残っています",
            "Los ajustes están dañados y no se pudo hacer una copia de seguridad; se conservó el archivo original",
            "Les réglages sont corrompus et n’ont pas pu être sauvegardés ; le fichier d’origine a été conservé",
        ]))?;
    let _ = recovery.keep();
    Err(locale::text([
        "The settings file was corrupted. A recovery copy was kept and default settings were restored",
        "设置文件损坏，已保留恢复副本并恢复默认设置",
        "設定ファイルが破損していました。復旧用のコピーを残し、既定の設定に戻しました",
        "El archivo de ajustes estaba dañado. Se guardó una copia de recuperación y se restauraron los ajustes predeterminados",
        "Le fichier de réglages était corrompu. Une copie de récupération a été conservée et les réglages par défaut ont été rétablis",
    ]).into())
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

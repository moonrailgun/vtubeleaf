use crate::locale;
use serde_json::Value;
use std::{collections::HashSet, io::Write, path::Path};

const MAX_MOTION_BYTES: usize = 32 * 1024 * 1024;

const MOTION_TOO_LARGE: [&str; 5] = [
    "The motion file exceeds the 32 MiB limit",
    "动作文件超过 32 MiB 限制",
    "モーションファイルが上限の 32 MiB を超えています",
    "El archivo de animación supera el límite de 32 MiB",
    "Le fichier d’animation dépasse la limite de 32 MiB",
];

pub fn encode(motion: &Value) -> Result<Vec<u8>, String> {
    let invalid = locale::text([
        "The motion data is not a valid Live2D motion3.json",
        "动作数据不是有效的 Live2D motion3.json",
        "モーションデータが有効な Live2D motion3.json ではありません",
        "Los datos de la animación no son un motion3.json de Live2D válido",
        "Les données d’animation ne sont pas un motion3.json Live2D valide",
    ]);
    if motion.get("Version").and_then(Value::as_u64) != Some(3) {
        return Err(invalid.into());
    }
    let meta = motion
        .get("Meta")
        .and_then(Value::as_object)
        .ok_or(invalid)?;
    let duration = meta
        .get("Duration")
        .and_then(Value::as_f64)
        .ok_or(invalid)?;
    let fps = meta.get("Fps").and_then(Value::as_f64).ok_or(invalid)?;
    if !duration.is_finite()
        || !(0.0..=3600.0).contains(&duration)
        || !fps.is_finite()
        || !(1.0..=240.0).contains(&fps)
        || meta.get("Loop").and_then(Value::as_bool).is_none()
    {
        return Err(invalid.into());
    }
    let curves = motion
        .get("Curves")
        .and_then(Value::as_array)
        .ok_or(invalid)?;
    if curves.is_empty() || curves.len() > 2048 {
        return Err(locale::text([
            "Invalid number of motion parameters",
            "动作参数数量无效",
            "モーションのパラメーター数が無効です",
            "Número de parámetros de la animación no válido",
            "Nombre de paramètres de l’animation invalide",
        ])
        .into());
    }
    let mut ids = HashSet::new();
    let mut segment_count = 0_u64;
    let mut point_count = 0_u64;
    for curve in curves {
        let id = curve.get("Id").and_then(Value::as_str).ok_or(invalid)?;
        if curve.get("Target").and_then(Value::as_str) != Some("Parameter")
            || id.is_empty()
            || id.len() > 512
            || id.contains('\0')
            || !ids.insert(id)
        {
            return Err(invalid.into());
        }
        let segments = curve
            .get("Segments")
            .and_then(Value::as_array)
            .ok_or(invalid)?;
        if segments.len() < 2 || segments.len() > MAX_MOTION_BYTES / 2 {
            return Err(locale::text([
                "Invalid motion curve size",
                "动作曲线大小无效",
                "モーションカーブのサイズが無効です",
                "Tamaño de curva de la animación no válido",
                "Taille de courbe de l’animation invalide",
            ])
            .into());
        }
        let number = |index: usize| -> Result<f64, &str> {
            segments
                .get(index)
                .and_then(Value::as_f64)
                .filter(|value| value.is_finite())
                .ok_or(invalid)
        };
        let mut time = number(0)?;
        number(1)?;
        if time < 0.0 || time > duration {
            return Err(invalid.into());
        }
        point_count += 1;
        let mut cursor = 2;
        while cursor < segments.len() {
            let kind = segments[cursor].as_u64().ok_or(invalid)?;
            let points = match kind {
                0 | 2 | 3 => 1,
                1 => 3,
                _ => return Err(invalid.into()),
            };
            for point in 0..points {
                let next = number(cursor + 1 + point * 2)?;
                number(cursor + 2 + point * 2)?;
                if next < time || next > duration {
                    return Err(invalid.into());
                }
                time = next;
            }
            cursor += 1 + points * 2;
            segment_count += 1;
            point_count += points as u64;
        }
    }
    for (name, expected) in [
        ("CurveCount", curves.len() as u64),
        ("TotalSegmentCount", segment_count),
        ("TotalPointCount", point_count),
    ] {
        if meta.get(name).and_then(Value::as_u64) != Some(expected) {
            return Err(locale::text([
                "Motion curve counts do not match",
                "动作曲线计数不一致",
                "モーションカーブの数が一致しません",
                "Los recuentos de curvas de la animación no coinciden",
                "Les nombres de courbes de l’animation ne correspondent pas",
            ])
            .into());
        }
    }
    let bytes = serde_json::to_vec(motion).map_err(|_| {
        locale::text([
            "Could not serialize the motion",
            "动作无法序列化",
            "モーションをシリアライズできません",
            "No se pudo serializar la animación",
            "Impossible de sérialiser l’animation",
        ])
    })?;
    if bytes.len() > MAX_MOTION_BYTES {
        return Err(locale::text(MOTION_TOO_LARGE).into());
    }
    Ok(bytes)
}

pub fn save(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > MAX_MOTION_BYTES {
        return Err(locale::text(MOTION_TOO_LARGE).into());
    }
    let parent = path
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .ok_or(locale::text([
            "Invalid motion export path",
            "动作导出路径无效",
            "モーションのエクスポート先が無効です",
            "Ruta de exportación de la animación no válida",
            "Chemin d’exportation de l’animation invalide",
        ]))?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|_| {
        locale::text([
            "Could not create a temporary motion file",
            "无法创建动作临时文件",
            "モーションの一時ファイルを作成できません",
            "No se pudo crear un archivo temporal de la animación",
            "Impossible de créer un fichier temporaire pour l’animation",
        ])
    })?;
    temporary.write_all(bytes).map_err(|_| {
        locale::text([
            "Failed to write the motion; the existing file was kept",
            "写入动作失败，原有文件已保留",
            "モーションの書き込みに失敗しました。元のファイルはそのまま残っています",
            "Error al escribir la animación; se conservó el archivo existente",
            "Échec de l’écriture de l’animation ; le fichier existant a été conservé",
        ])
    })?;
    temporary.as_file().sync_all().map_err(|_| {
        locale::text([
            "Failed to sync the motion; the existing file was kept",
            "同步动作失败，原有文件已保留",
            "モーションの同期に失敗しました。元のファイルはそのまま残っています",
            "Error al sincronizar la animación; se conservó el archivo existente",
            "Échec de la synchronisation de l’animation ; le fichier existant a été conservé",
        ])
    })?;
    temporary.persist(path).map_err(|_| {
        locale::text([
            "Failed to save the motion; the existing file was kept",
            "保存动作失败，原有文件已保留",
            "モーションの保存に失敗しました。元のファイルはそのまま残っています",
            "Error al guardar la animación; se conservó el archivo existente",
            "Échec de l’enregistrement de l’animation ; le fichier existant a été conservé",
        ])
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn motion() -> Value {
        serde_json::json!({"Version":3,"Meta":{"Duration":1,"Fps":30,"Loop":false,"CurveCount":1,"TotalSegmentCount":1,"TotalPointCount":2},"Curves":[{"Target":"Parameter","Id":"ParamAngleX","Segments":[0,0,0,1,10]}]})
    }

    #[test]
    fn validates_counts_segments_and_atomically_replaces_files() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("recording.motion3.json");
        let first = encode(&motion()).unwrap();
        save(&path, &first).unwrap();
        let mut changed = motion();
        changed["Curves"][0]["Segments"][4] = Value::from(-20);
        save(&path, &encode(&changed).unwrap()).unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&std::fs::read(&path).unwrap()).unwrap(),
            changed
        );
        for invalid in [
            serde_json::json!({}),
            {
                let mut value = motion();
                value["Meta"]["CurveCount"] = Value::from(2);
                value
            },
            {
                let mut value = motion();
                value["Curves"][0]["Segments"][3] = Value::from(-1);
                value
            },
            {
                let mut value = motion();
                value["Curves"][0]["Segments"][2] = Value::from(9);
                value
            },
            {
                let mut value = motion();
                value["Curves"][0]["Segments"] = serde_json::json!([0, 0, 0, 1]);
                value
            },
        ] {
            assert!(encode(&invalid).is_err());
        }
        assert!(save(&path, &vec![0; MAX_MOTION_BYTES + 1]).is_err());
        assert_eq!(
            serde_json::from_slice::<Value>(&std::fs::read(&path).unwrap()).unwrap(),
            changed
        );
    }
}

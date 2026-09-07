use serde_json::Value;
use std::{collections::HashSet, io::Write, path::Path};

const MAX_MOTION_BYTES: usize = 32 * 1024 * 1024;

pub fn encode(motion: &Value) -> Result<Vec<u8>, String> {
    let invalid = "动作数据不是有效的 Live2D motion3.json";
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
        return Err("动作参数数量无效".into());
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
            return Err("动作曲线大小无效".into());
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
            return Err("动作曲线计数不一致".into());
        }
    }
    let bytes = serde_json::to_vec(motion).map_err(|_| "动作无法序列化")?;
    if bytes.len() > MAX_MOTION_BYTES {
        return Err("动作文件超过 32 MiB 限制".into());
    }
    Ok(bytes)
}

pub fn save(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > MAX_MOTION_BYTES {
        return Err("动作文件超过 32 MiB 限制".into());
    }
    let parent = path
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .ok_or("动作导出路径无效")?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|_| "无法创建动作临时文件")?;
    temporary
        .write_all(bytes)
        .map_err(|_| "写入动作失败，原有文件已保留")?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|_| "同步动作失败，原有文件已保留")?;
    temporary
        .persist(path)
        .map_err(|_| "保存动作失败，原有文件已保留")?;
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

fn release_url(value: &str) -> Result<tauri::Url, String> {
    let url = tauri::Url::parse(value).map_err(|_| "下载链接无效")?;
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.path().starts_with("/moonrailgun/vtubeleaf/releases/")
    {
        return Err("仅允许打开 VTubeLeaf 发布链接".into());
    }
    Ok(url)
}

#[tauri::command]
pub fn get_download_platform() -> String {
    let os = if cfg!(target_os = "macos") {
        "darwin"
    } else {
        std::env::consts::OS
    };
    format!("{os}-{}", std::env::consts::ARCH)
}

#[tauri::command]
pub async fn open_release_url(window: tauri::WebviewWindow, url: String) -> Result<(), String> {
    crate::require_main(&window)?;
    let url = release_url(&url)?;
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "macos")]
        let opener = "/usr/bin/open";
        #[cfg(target_os = "windows")]
        let opener = "explorer.exe";
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let opener = "xdg-open";
        let status = std::process::Command::new(opener)
            .arg(url.as_str())
            .status()
            .map_err(|error| format!("无法打开浏览器：{error}"))?;
        if status.success() || cfg!(target_os = "windows") {
            Ok(())
        } else {
            Err("无法打开浏览器".into())
        }
    })
    .await
    .map_err(|_| "打开下载链接任务中断")?
}

#[cfg(test)]
mod tests {
    use super::release_url;

    #[test]
    fn only_opens_this_repositories_release_urls() {
        for path in [
            "latest",
            "download/v1.2.3/VTubeLeaf-OpenSeeFace-1.2.3-windows-x64.zip",
        ] {
            assert!(release_url(&format!(
                "https://github.com/moonrailgun/vtubeleaf/releases/{path}"
            ))
            .is_ok());
        }
        for url in [
            "javascript:alert(1)",
            "file:///tmp/download.zip",
            "https://example.com/moonrailgun/vtubeleaf/releases/latest",
            "https://github.com/other/repo/releases/latest",
            "https://github.com/moonrailgun/vtubeleaf/releases/../../other",
            "https://user:password@github.com/moonrailgun/vtubeleaf/releases/latest",
            "https://github.com:8443/moonrailgun/vtubeleaf/releases/latest",
            "https://github.com/moonrailgun/vtubeleaf/releases/latest?redirect=example.com",
        ] {
            assert!(release_url(url).is_err(), "{url}");
        }
    }
}

fn trusted_page(uri: &str) -> bool {
    let Ok(url) = tauri::Url::parse(uri) else {
        return false;
    };
    url.host_str() == Some("localhost")
        && url.username().is_empty()
        && url.password().is_none()
        && matches!(url.path(), "" | "/" | "/index.html")
        && ((url.scheme() == "tauri" && url.port().is_none())
            || (cfg!(debug_assertions) && url.scheme() == "http" && url.port() == Some(1420)))
}

#[cfg(target_os = "linux")]
pub fn configure_media(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    use gtk::prelude::*;
    use webkit2gtk::{
        PermissionRequestExt, SettingsExt, UserMediaPermissionRequestExt, WebViewExt,
    };

    window.with_webview(|platform| {
        let view = platform.inner();
        if let Some(settings) = WebViewExt::settings(&view) {
            settings.set_enable_media_stream(true);
        }
        view.connect_permission_request(|view, request| {
            if !view.uri().is_some_and(|uri| trusted_page(&uri)) {
                request.deny();
                return true;
            }
            // Listing local devices does not start capture; actual streams require consent below.
            if request.is::<webkit2gtk::DeviceInfoPermissionRequest>() {
                request.allow();
                return true;
            }
            let Some(media) = request.downcast_ref::<webkit2gtk::UserMediaPermissionRequest>()
            else {
                request.deny();
                return true;
            };
            let device = match (media.is_for_video_device(), media.is_for_audio_device()) {
                (true, true) => "摄像头和麦克风",
                (true, false) => "摄像头",
                (false, true) => "麦克风",
                _ => {
                    request.deny();
                    return true;
                }
            };
            let Some(parent) = view
                .toplevel()
                .and_then(|widget| widget.downcast::<gtk::Window>().ok())
            else {
                request.deny();
                return true;
            };
            let dialog = gtk::MessageDialog::builder()
                .transient_for(&parent)
                .modal(true)
                .destroy_with_parent(true)
                .message_type(gtk::MessageType::Question)
                .buttons(gtk::ButtonsType::YesNo)
                .text(format!("允许 VTubeLeaf 使用{device}进行本地追踪？"))
                .build();
            dialog.set_default_response(gtk::ResponseType::No);
            let request = request.clone();
            let view = view.downgrade();
            dialog.connect_response(move |dialog, response| {
                let local = view
                    .upgrade()
                    .and_then(|view| view.uri())
                    .is_some_and(|uri| trusted_page(&uri));
                if response == gtk::ResponseType::Yes && local {
                    request.allow();
                } else {
                    request.deny();
                }
                dialog.close();
            });
            dialog.show();
            true
        });
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn media_permissions_only_accept_the_local_workbench() {
        assert!(super::trusted_page("tauri://localhost"));
        assert!(super::trusted_page("tauri://localhost/index.html"));
        assert!(super::trusted_page("tauri://localhost/"));
        assert_eq!(
            super::trusted_page("http://localhost:1420/"),
            cfg!(debug_assertions)
        );
        for uri in [
            "https://example.com/",
            "tauri://localhost.evil/index.html",
            "tauri://localhost@evil/index.html",
            "tauri://localhost/output.html",
            "http://localhost:1234/",
            "http://localhost:1420/output.html",
            "invalid",
        ] {
            assert!(!super::trusted_page(uri), "unexpected permission for {uri}");
        }
    }
}

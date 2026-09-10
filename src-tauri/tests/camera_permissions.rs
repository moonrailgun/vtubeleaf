use tauri::utils::{
    acl::{resolved::Resolved, ExecutionContext},
    platform::Target,
};

#[test]
fn camera_permissions_are_available_only_to_the_local_main_window() {
    let manifests =
        serde_json::from_str(include_str!("../gen/schemas/acl-manifests.json")).unwrap();
    for target in [Target::MacOS, Target::Windows] {
        let capabilities =
            serde_json::from_str(include_str!("../gen/schemas/capabilities.json")).unwrap();
        let acl = Resolved::resolve(&manifests, capabilities, target).unwrap();
        for command in ["status", "install", "uninstall", "start", "stop", "submit"] {
            let name = format!("plugin:virtual-camera|{command}");
            let permissions = acl.allowed_commands.get(&name).expect(&name);
            assert!(!permissions.is_empty(), "{name}");
            for permission in permissions {
                assert_eq!(permission.context, ExecutionContext::Local);
                assert_eq!(permission.windows.len(), 1);
                assert_eq!(permission.windows[0].as_str(), "main");
                assert!(permission.webviews.is_empty());
            }
            assert!(!acl.denied_commands.contains_key(&name));
        }
    }
}

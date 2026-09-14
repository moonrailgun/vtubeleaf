mod assets;
mod camera;
mod models;
mod motion;
mod nvidia;
mod settings;
mod tracker;
mod vts;

use models::{Library, ModelInfo, Registry};
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{
    menu::{Menu, MenuItem},
    Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tauri_plugin_dialog::DialogExt;

struct AppState {
    data_dir: PathBuf,
    models: Mutex<Registry>,
    settings: Mutex<()>,
    // Both native engines own their process until dropped; only one may hold the camera.
    tracker: Mutex<Option<Box<dyn Send>>>,
}

fn require_main(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("此操作仅允许在工作台中使用".into())
    }
}

fn require_local_window(window: &WebviewWindow) -> Result<(), String> {
    if matches!(window.label(), "main" | "output") {
        Ok(())
    } else {
        Err("窗口无权访问模型资源".into())
    }
}

#[tauri::command]
async fn load_settings(
    window: WebviewWindow,
    app: tauri::AppHandle,
) -> Result<Option<Value>, String> {
    require_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let _guard = state.settings.lock().map_err(|_| "设置状态不可用")?;
        settings::load(&state.data_dir)
    })
    .await
    .map_err(|_| "读取设置任务中断")?
}

#[tauri::command]
async fn save_settings(
    window: WebviewWindow,
    app: tauri::AppHandle,
    settings: Value,
) -> Result<(), String> {
    require_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let _guard = state.settings.lock().map_err(|_| "设置状态不可用")?;
        settings::save(&state.data_dir, &settings)
    })
    .await
    .map_err(|_| "保存设置任务中断")?
}

#[tauri::command]
async fn save_motion(
    window: WebviewWindow,
    app: tauri::AppHandle,
    motion: Value,
) -> Result<bool, String> {
    require_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = motion::encode(&motion)?;
        let Some(selected) = app
            .dialog()
            .file()
            .set_title("导出 Live2D 动作")
            .set_file_name("recording.motion3.json")
            .add_filter("Live2D motion3.json", &["json"])
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let path = selected.into_path().map_err(|_| "仅支持导出到本机文件")?;
        motion::save(&path, &bytes)?;
        Ok(true)
    })
    .await
    .map_err(|_| "动作导出任务中断")?
}

fn register_model(app: &tauri::AppHandle, path: &Path) -> Result<ModelInfo, String> {
    let state = app.state::<AppState>();
    let result = state
        .models
        .lock()
        .map_err(|_| "模型状态不可用")?
        .load(path, &state.data_dir);
    result
}

#[tauri::command]
async fn choose_model(
    window: WebviewWindow,
    app: tauri::AppHandle,
    kind: String,
) -> Result<Option<ModelInfo>, String> {
    require_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let dialog = app.dialog().file().set_title("导入 Live2D 模型");
        let selected = match kind.as_str() {
            "directory" => dialog.blocking_pick_folder(),
            "file" => dialog
                .add_filter("Live2D 模型（model3.json / ZIP）", &["json", "zip"])
                .blocking_pick_file(),
            _ => return Err("模型导入类型无效".into()),
        };
        let Some(selected) = selected else {
            return Ok(None);
        };
        let path = selected.into_path().map_err(|_| "仅支持导入本机模型文件")?;
        register_model(&app, &path).map(Some)
    })
    .await
    .map_err(|_| "模型导入任务中断")?
}

#[tauri::command]
async fn load_model(
    window: WebviewWindow,
    app: tauri::AppHandle,
    path: String,
) -> Result<Option<ModelInfo>, String> {
    require_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || register_model(&app, Path::new(&path)).map(Some))
        .await
        .map_err(|_| "模型加载任务中断")?
}

#[tauri::command]
async fn list_models(window: WebviewWindow, app: tauri::AppHandle) -> Result<Library, String> {
    require_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let bundled_dir = app
            .path()
            .resource_dir()
            .map_err(|_| "无法定位内置角色目录")?
            .join("models");
        let state = app.state::<AppState>();
        let result = state
            .models
            .lock()
            .map_err(|_| "模型状态不可用")?
            .list_with_builtins(&state.data_dir, &bundled_dir);
        result
    })
    .await
    .map_err(|_| "读取角色库任务中断")?
}

#[tauri::command]
async fn remove_model(
    window: WebviewWindow,
    app: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    require_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let result = state
            .models
            .lock()
            .map_err(|_| "模型状态不可用")?
            .remove(&id, &state.data_dir);
        result
    })
    .await
    .map_err(|_| "移除角色任务中断")?
}

#[tauri::command]
async fn open_models_directory(window: WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    require_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let directory = app.state::<AppState>().data_dir.join("models");
        std::fs::create_dir_all(&directory).map_err(|_| "无法创建角色文件夹")?;
        #[cfg(target_os = "macos")]
        let opener = "/usr/bin/open";
        #[cfg(target_os = "windows")]
        let opener = "explorer.exe";
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let opener = "xdg-open";
        let status = std::process::Command::new(opener)
            .arg(directory)
            .status()
            .map_err(|error| format!("无法打开角色文件夹：{error}"))?;
        // Explorer may return a nonzero code when handing off to an existing window.
        if status.success() || cfg!(target_os = "windows") {
            Ok(())
        } else {
            Err("无法打开角色文件夹，请检查系统文件管理器是否可用".into())
        }
    })
    .await
    .map_err(|_| "打开角色文件夹任务中断")?
}

#[tauri::command]
async fn read_model_preview(
    window: WebviewWindow,
    app: tauri::AppHandle,
    id: String,
) -> Result<tauri::ipc::Response, String> {
    require_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let bytes = state
            .models
            .lock()
            .map_err(|_| "模型状态不可用")?
            .read_preview(&id, &state.data_dir)?;
        Ok(tauri::ipc::Response::new(bytes))
    })
    .await
    .map_err(|_| "读取角色预览任务中断")?
}

#[tauri::command]
async fn save_model_preview(
    window: WebviewWindow,
    app: tauri::AppHandle,
    id: String,
    png: Vec<u8>,
) -> Result<(), String> {
    require_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let result = state
            .models
            .lock()
            .map_err(|_| "模型状态不可用")?
            .save_preview(&id, &state.data_dir, &png);
        result
    })
    .await
    .map_err(|_| "保存角色预览任务中断")?
}

#[tauri::command]
async fn read_model_vts_config(
    window: WebviewWindow,
    app: tauri::AppHandle,
    id: String,
) -> Result<Option<serde_json::Value>, String> {
    require_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let result = state
            .models
            .lock()
            .map_err(|_| "模型状态不可用")?
            .read_vts_config(&id);
        result
    })
    .await
    .map_err(|_| "VTS 配置读取任务中断")?
}

#[tauri::command]
async fn read_model_resource(
    window: WebviewWindow,
    app: tauri::AppHandle,
    id: String,
    resource: String,
) -> Result<tauri::ipc::Response, String> {
    require_local_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let bytes = state
            .models
            .lock()
            .map_err(|_| "模型状态不可用")?
            .read(&id, &resource)?;
        Ok(tauri::ipc::Response::new(bytes))
    })
    .await
    .map_err(|_| "模型资源读取任务中断")?
}

#[tauri::command]
async fn start_openseeface(
    window: WebviewWindow,
    app: tauri::AppHandle,
    port: Option<u16>,
    camera: Option<u32>,
    python_path: Option<String>,
    script_path: Option<String>,
) -> Result<(), String> {
    require_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let mut active = state.tracker.lock().map_err(|_| "面捕状态不可用")?;
        active.take();
        let events = app.clone();
        let errors = app.clone();
        *active = Some(Box::new(tracker::Tracker::start(
            port.unwrap_or(11573),
            camera.unwrap_or(0),
            python_path
                .as_deref()
                .filter(|path| !path.trim().is_empty())
                .map(Path::new),
            script_path
                .as_deref()
                .filter(|path| !path.trim().is_empty())
                .map(Path::new),
            move |frame| {
                let _ = events.emit_to("main", "openseeface-frame", frame);
            },
            move |error| {
                let _ = errors.emit_to("main", "openseeface-error", error);
            },
        )?));
        Ok(())
    })
    .await
    .map_err(|_| "OpenSeeFace 启动任务中断")?
}

#[tauri::command]
async fn stop_openseeface(window: WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    require_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        state.tracker.lock().map_err(|_| "面捕状态不可用")?.take();
        Ok(())
    })
    .await
    .map_err(|_| "OpenSeeFace 停止任务中断")?
}

#[tauri::command]
async fn start_nvidia(
    window: WebviewWindow,
    app: tauri::AppHandle,
    executable: String,
    model_dir: String,
    camera: u32,
    fps: u32,
    resolution: String,
) -> Result<(), String> {
    require_main(&window)?;
    if !cfg!(windows) {
        return Err("NVIDIA RTX 跟踪（实验中）仅支持 Windows".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let mut active = state.tracker.lock().map_err(|_| "面捕状态不可用")?;
        active.take();
        let events = app.clone();
        let errors = app.clone();
        *active = Some(Box::new(nvidia::Tracker::start(
            Path::new(&executable),
            Path::new(&model_dir),
            camera,
            fps,
            &resolution,
            move |frame| {
                let _ = events.emit_to("main", "nvidia-frame", frame);
            },
            move |error| {
                let _ = errors.emit_to("main", "nvidia-error", error);
            },
        )?));
        Ok(())
    })
    .await
    .map_err(|_| "NVIDIA 启动任务中断")?
}

#[tauri::command]
async fn stop_nvidia(window: WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    stop_openseeface(window, app).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let application = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(camera::init())
        .setup(|app| {
            app.manage(AppState {
                data_dir: app.path().app_data_dir()?,
                models: Mutex::default(),
                settings: Mutex::default(),
                tracker: Mutex::default(),
            });
            let menu = Menu::default(app.handle())?;
            let about_menu = if cfg!(target_os = "macos") {
                menu.items()?.into_iter().next()
            } else {
                menu.get(tauri::menu::HELP_SUBMENU_ID)
            }
            .expect("默认菜单缺少关于子菜单");
            let submenu = about_menu.as_submenu().expect("关于入口必须位于子菜单中");
            submenu.remove_at(0)?;
            submenu.insert(
                &MenuItem::with_id(app, "about", "关于 VTubeLeaf", true, None::<&str>)?,
                0,
            )?;
            #[cfg(target_os = "macos")]
            app.set_menu(menu)?;
            #[cfg(not(target_os = "macos"))]
            app.get_webview_window("main")
                .expect("工作台窗口未创建")
                .set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id() == "about" {
                let app = app.clone();
                // WebView2 window creation must run outside the synchronous menu handler.
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = show_about(&app) {
                        app.dialog()
                            .message(format!("无法打开关于窗口：{error}"))
                            .title("VTubeLeaf")
                            .show(|_| {});
                    }
                });
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_settings,
            save_settings,
            save_motion,
            open_about,
            restart_app,
            assets::choose_asset,
            assets::read_asset,
            vts::choose_vts_config,
            read_model_vts_config,
            choose_model,
            load_model,
            list_models,
            open_models_directory,
            remove_model,
            read_model_preview,
            save_model_preview,
            read_model_resource,
            start_openseeface,
            stop_openseeface,
            start_nvidia,
            stop_nvidia
        ])
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                window.app_handle().exit(0);
            }
        })
        .build(tauri::generate_context!())
        .expect("无法启动 VTubeLeaf 桌面应用");
    application.run(|app, event| {
        if matches!(
            event,
            tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
        ) {
            if let Some(state) = app.try_state::<AppState>() {
                if let Ok(mut tracker) = state.tracker.lock() {
                    tracker.take();
                }
            }
        }
    });
}

#[tauri::command]
async fn open_about(window: WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    require_main(&window)?;
    show_about(&app).map_err(|error| error.to_string())
}

#[tauri::command]
async fn restart_app(window: WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    require_main(&window)?;
    app.restart();
}

fn show_about(app: &tauri::AppHandle) -> tauri::Result<()> {
    let window = match app.get_webview_window("about") {
        Some(window) => window,
        None => {
            WebviewWindowBuilder::new(app, "about", WebviewUrl::App("index.html?about=1".into()))
                .title("关于 VTubeLeaf")
                .inner_size(640.0, 700.0)
                .min_inner_size(480.0, 480.0)
                .center()
                .build()?
        }
    };
    window.unminimize()?;
    window.show()?;
    window.set_focus()
}

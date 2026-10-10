mod assets;
mod camera;
mod downloads;
mod locale;
#[cfg(any(target_os = "linux", windows, test))]
mod media;
mod models;
mod motion;
mod nvidia;
mod obs;
mod settings;
mod texture;
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

const SETTINGS_UNAVAILABLE: [&str; 5] = [
    "Settings are unavailable",
    "设置状态不可用",
    "設定を利用できません",
    "Los ajustes no están disponibles",
    "Les réglages sont indisponibles",
];

const TRACKER_UNAVAILABLE: [&str; 5] = [
    "Face tracking state is unavailable",
    "面捕状态不可用",
    "フェイストラッキングの状態を利用できません",
    "El estado del seguimiento facial no está disponible",
    "L’état du suivi du visage est indisponible",
];

const ABOUT: [&str; 5] = [
    "About VTubeLeaf",
    "关于 VTubeLeaf",
    "VTubeLeaf について",
    "Acerca de VTubeLeaf",
    "À propos de VTubeLeaf",
];

struct AppState {
    data_dir: PathBuf,
    models: Registry,
    settings: Mutex<()>,
    // Both native engines own their process until dropped; only one may hold the camera.
    tracker: Mutex<Option<Box<dyn Send>>>,
}

fn require_main(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err(locale::text([
            "This action is only allowed in the main window",
            "此操作仅允许在工作台中使用",
            "この操作はメインウィンドウでのみ行えます",
            "Esta acción solo se permite en la ventana principal",
            "Cette action n’est autorisée que dans la fenêtre principale",
        ])
        .into())
    }
}

fn require_local_window(window: &WebviewWindow) -> Result<(), String> {
    if matches!(window.label(), "main" | "output") {
        Ok(())
    } else {
        Err(locale::text([
            "This window is not allowed to access model files",
            "窗口无权访问模型资源",
            "このウィンドウはモデルファイルにアクセスできません",
            "Esta ventana no tiene acceso a los archivos del modelo",
            "Cette fenêtre n’a pas accès aux fichiers du modèle",
        ])
        .into())
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
        let _guard = state
            .settings
            .lock()
            .map_err(|_| locale::text(SETTINGS_UNAVAILABLE))?;
        settings::load(&state.data_dir)
    })
    .await
    .map_err(|_| {
        locale::text([
            "Loading settings was interrupted",
            "读取设置任务中断",
            "設定の読み込みが中断されました",
            "Se interrumpió la carga de los ajustes",
            "Le chargement des réglages a été interrompu",
        ])
    })?
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
        let _guard = state
            .settings
            .lock()
            .map_err(|_| locale::text(SETTINGS_UNAVAILABLE))?;
        settings::save(&state.data_dir, &settings)
    })
    .await
    .map_err(|_| {
        locale::text([
            "Saving settings was interrupted",
            "保存设置任务中断",
            "設定の保存が中断されました",
            "Se interrumpió el guardado de los ajustes",
            "L’enregistrement des réglages a été interrompu",
        ])
    })?
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
            .set_title(locale::text([
                "Export Live2D motion",
                "导出 Live2D 动作",
                "Live2D モーションをエクスポート",
                "Exportar animación de Live2D",
                "Exporter l’animation Live2D",
            ]))
            .set_file_name("recording.motion3.json")
            .add_filter("Live2D motion3.json", &["json"])
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let path = selected.into_path().map_err(|_| {
            locale::text([
                "Can only export to a local file",
                "仅支持导出到本机文件",
                "ローカルファイルにのみエクスポートできます",
                "Solo se puede exportar a un archivo local",
                "L’exportation n’est possible que vers un fichier local",
            ])
        })?;
        motion::save(&path, &bytes)?;
        Ok(true)
    })
    .await
    .map_err(|_| {
        locale::text([
            "Motion export was interrupted",
            "动作导出任务中断",
            "モーションのエクスポートが中断されました",
            "Se interrumpió la exportación de la animación",
            "L’exportation de l’animation a été interrompue",
        ])
    })?
}

fn register_model(app: &tauri::AppHandle, path: &Path) -> Result<ModelInfo, String> {
    let state = app.state::<AppState>();
    state.models.load(path, &state.data_dir)
}

#[tauri::command]
async fn choose_model(
    window: WebviewWindow,
    app: tauri::AppHandle,
    kind: String,
) -> Result<Option<ModelInfo>, String> {
    require_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let dialog = app.dialog().file().set_title(locale::text([
            "Import Live2D model",
            "导入 Live2D 模型",
            "Live2D モデルをインポート",
            "Importar modelo de Live2D",
            "Importer un modèle Live2D",
        ]));
        let selected = match kind.as_str() {
            "directory" => dialog.blocking_pick_folder(),
            "file" => dialog
                .add_filter(
                    locale::text([
                        "Live2D model (model3.json / ZIP)",
                        "Live2D 模型（model3.json / ZIP）",
                        "Live2D モデル（model3.json / ZIP）",
                        "Modelo de Live2D (model3.json / ZIP)",
                        "Modèle Live2D (model3.json / ZIP)",
                    ]),
                    &["json", "zip"],
                )
                .blocking_pick_file(),
            _ => {
                return Err(locale::text([
                    "Invalid model import type",
                    "模型导入类型无效",
                    "モデルのインポート方法が無効です",
                    "Tipo de importación de modelo no válido",
                    "Type d’importation de modèle invalide",
                ])
                .into())
            }
        };
        let Some(selected) = selected else {
            return Ok(None);
        };
        let path = selected.into_path().map_err(|_| {
            locale::text([
                "Only local model files can be imported",
                "仅支持导入本机模型文件",
                "ローカルのモデルファイルのみインポートできます",
                "Solo se pueden importar archivos de modelo locales",
                "Seuls les fichiers de modèle locaux peuvent être importés",
            ])
        })?;
        register_model(&app, &path).map(Some)
    })
    .await
    .map_err(|_| {
        locale::text([
            "Model import was interrupted",
            "模型导入任务中断",
            "モデルのインポートが中断されました",
            "Se interrumpió la importación del modelo",
            "L’importation du modèle a été interrompue",
        ])
    })?
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
        .map_err(|_| {
            locale::text([
                "Model loading was interrupted",
                "模型加载任务中断",
                "モデルの読み込みが中断されました",
                "Se interrumpió la carga del modelo",
                "Le chargement du modèle a été interrompu",
            ])
        })?
}

#[tauri::command]
async fn list_models(window: WebviewWindow, app: tauri::AppHandle) -> Result<Library, String> {
    require_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let bundled_dir = app
            .path()
            .resource_dir()
            .map_err(|_| {
                locale::text([
                    "Could not find the built-in avatars folder",
                    "无法定位内置角色目录",
                    "内蔵キャラクターのフォルダーが見つかりません",
                    "No se encontró la carpeta de avatares integrados",
                    "Dossier des avatars intégrés introuvable",
                ])
            })?
            .join("models");
        let state = app.state::<AppState>();
        state
            .models
            .list_with_builtins(&state.data_dir, &bundled_dir)
    })
    .await
    .map_err(|_| {
        locale::text([
            "Loading the library was interrupted",
            "读取角色库任务中断",
            "ライブラリの読み込みが中断されました",
            "Se interrumpió la carga de la biblioteca",
            "Le chargement de la bibliothèque a été interrompu",
        ])
    })?
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
        state.models.remove(&id, &state.data_dir)
    })
    .await
    .map_err(|_| {
        locale::text([
            "Removing the avatar was interrupted",
            "移除角色任务中断",
            "キャラクターの削除が中断されました",
            "Se interrumpió la eliminación del avatar",
            "La suppression de l’avatar a été interrompue",
        ])
    })?
}

#[tauri::command]
async fn open_models_directory(window: WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    require_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let directory = app.state::<AppState>().data_dir.join("models");
        std::fs::create_dir_all(&directory).map_err(|_| locale::text([
            "Could not create the avatars folder",
            "无法创建角色文件夹",
            "キャラクターフォルダーを作成できません",
            "No se pudo crear la carpeta de avatares",
            "Impossible de créer le dossier des avatars",
        ]))?;
        #[cfg(target_os = "macos")]
        let opener = "/usr/bin/open";
        #[cfg(target_os = "windows")]
        let opener = "explorer.exe";
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let opener = "xdg-open";
        let status = std::process::Command::new(opener)
            .arg(directory)
            .status()
            .map_err(|error| format!("{}{error}", locale::text([
                "Could not open the avatars folder: ",
                "无法打开角色文件夹：",
                "キャラクターフォルダーを開けません：",
                "No se pudo abrir la carpeta de avatares: ",
                "Impossible d’ouvrir le dossier des avatars : ",
            ])))?;
        // Explorer may return a nonzero code when handing off to an existing window.
        if status.success() || cfg!(target_os = "windows") {
            Ok(())
        } else {
            Err(locale::text([
                "Could not open the avatars folder. Check that your system file manager is available",
                "无法打开角色文件夹，请检查系统文件管理器是否可用",
                "キャラクターフォルダーを開けません。システムのファイルマネージャーが使えるか確認してください",
                "No se pudo abrir la carpeta de avatares. Comprueba que el gestor de archivos del sistema esté disponible",
                "Impossible d’ouvrir le dossier des avatars. Vérifiez que le gestionnaire de fichiers du système est disponible",
            ]).into())
        }
    })
    .await
    .map_err(|_| locale::text([
        "Opening the avatars folder was interrupted",
        "打开角色文件夹任务中断",
        "キャラクターフォルダーを開く処理が中断されました",
        "Se interrumpió la apertura de la carpeta de avatares",
        "L’ouverture du dossier des avatars a été interrompue",
    ]))?
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
        let bytes = state.models.read_preview(&id, &state.data_dir)?;
        Ok(tauri::ipc::Response::new(bytes))
    })
    .await
    .map_err(|_| {
        locale::text([
            "Loading the avatar preview was interrupted",
            "读取角色预览任务中断",
            "キャラクタープレビューの読み込みが中断されました",
            "Se interrumpió la carga de la vista previa del avatar",
            "Le chargement de l’aperçu de l’avatar a été interrompu",
        ])
    })?
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
        state.models.save_preview(&id, &state.data_dir, &png)
    })
    .await
    .map_err(|_| {
        locale::text([
            "Saving the avatar preview was interrupted",
            "保存角色预览任务中断",
            "キャラクタープレビューの保存が中断されました",
            "Se interrumpió el guardado de la vista previa del avatar",
            "L’enregistrement de l’aperçu de l’avatar a été interrompu",
        ])
    })?
}

#[tauri::command]
async fn read_model_vts_config(
    window: WebviewWindow,
    app: tauri::AppHandle,
    id: String,
) -> Result<Option<serde_json::Value>, String> {
    require_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<AppState>().models.read_vts_config(&id)
    })
    .await
    .map_err(|_| {
        locale::text([
            "Loading the VTS config was interrupted",
            "VTS 配置读取任务中断",
            "VTS 設定の読み込みが中断されました",
            "Se interrumpió la carga de la configuración de VTS",
            "Le chargement de la configuration VTS a été interrompu",
        ])
    })?
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
        let bytes = app.state::<AppState>().models.read(&id, &resource)?;
        Ok(tauri::ipc::Response::new(bytes))
    })
    .await
    .map_err(|_| {
        locale::text([
            "Loading model files was interrupted",
            "模型资源读取任务中断",
            "モデルファイルの読み込みが中断されました",
            "Se interrumpió la carga de los archivos del modelo",
            "Le chargement des fichiers du modèle a été interrompu",
        ])
    })?
}

#[tauri::command]
async fn start_openseeface(
    window: WebviewWindow,
    app: tauri::AppHandle,
    port: Option<u16>,
    camera: Option<u32>,
    mode: Option<tracker::Mode>,
    python_path: Option<String>,
    script_path: Option<String>,
) -> Result<(), String> {
    require_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let mut active = state.tracker.lock().map_err(|_| locale::text(TRACKER_UNAVAILABLE))?;
        active.take();
        let events = app.clone();
        let errors = app.clone();
        let source = match mode.unwrap_or_default() {
            tracker::Mode::External => tracker::Source::External,
            tracker::Mode::Custom => {
                let python = python_path
                    .as_deref()
                    .filter(|path| !path.trim().is_empty());
                let script = script_path
                    .as_deref()
                    .filter(|path| !path.trim().is_empty());
                match (python, script) {
                    (Some(python), Some(script)) => {
                        tracker::Source::Python(Path::new(python), Path::new(script))
                    }
                    _ => return Err(locale::text([
                        "Enter both the Python path and the OpenSeeFace launch script path",
                        "请同时填写 Python 和 OpenSeeFace 启动脚本路径",
                        "Python と OpenSeeFace 起動スクリプトのパスを両方入力してください",
                        "Introduce la ruta de Python y la del script de inicio de OpenSeeFace",
                        "Indiquez à la fois le chemin de Python et celui du script de lancement d’OpenSeeFace",
                    ]).into()),
                }
            }
        };
        *active = Some(Box::new(tracker::Tracker::start(
            port.unwrap_or(11573),
            camera.unwrap_or(0),
            source,
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
    .map_err(|_| locale::text([
        "Starting OpenSeeFace was interrupted",
        "OpenSeeFace 启动任务中断",
        "OpenSeeFace の起動が中断されました",
        "Se interrumpió el inicio de OpenSeeFace",
        "Le démarrage d’OpenSeeFace a été interrompu",
    ]))?
}

#[tauri::command]
async fn stop_openseeface(window: WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    require_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        state
            .tracker
            .lock()
            .map_err(|_| locale::text(TRACKER_UNAVAILABLE))?
            .take();
        Ok(())
    })
    .await
    .map_err(|_| {
        locale::text([
            "Stopping OpenSeeFace was interrupted",
            "OpenSeeFace 停止任务中断",
            "OpenSeeFace の停止が中断されました",
            "Se interrumpió la detención de OpenSeeFace",
            "L’arrêt d’OpenSeeFace a été interrompu",
        ])
    })?
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
        return Err(locale::text([
            "NVIDIA RTX tracking (experimental) is only available on Windows",
            "NVIDIA RTX 跟踪（实验中）仅支持 Windows",
            "NVIDIA RTX トラッキング（試験運用中）は Windows のみ対応しています",
            "El seguimiento NVIDIA RTX (experimental) solo está disponible en Windows",
            "Le suivi NVIDIA RTX (expérimental) n’est disponible que sous Windows",
        ])
        .into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let mut active = state
            .tracker
            .lock()
            .map_err(|_| locale::text(TRACKER_UNAVAILABLE))?;
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
    .map_err(|_| {
        locale::text([
            "Starting NVIDIA tracking was interrupted",
            "NVIDIA 启动任务中断",
            "NVIDIA トラッキングの起動が中断されました",
            "Se interrumpió el inicio del seguimiento NVIDIA",
            "Le démarrage du suivi NVIDIA a été interrompu",
        ])
    })?
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
            #[cfg(any(target_os = "linux", windows))]
            media::configure_media(&app.get_webview_window("main").expect("工作台窗口未创建"))?;
            app.manage(Mutex::new(obs::Output::default()));
            app.manage(Mutex::new(texture::Output::default()));
            app.manage(AppState {
                data_dir: app.path().app_data_dir()?,
                models: Registry::default(),
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
                &MenuItem::with_id(app, "about", locale::text(ABOUT), true, None::<&str>)?,
                0,
            )?;
            submenu.insert(
                &MenuItem::with_id(app, "check-updates", locale::text([
                    "Check for updates",
                    "检查更新",
                    "アップデートを確認",
                    "Buscar actualizaciones",
                    "Rechercher des mises à jour",
                ]), true, None::<&str>)?,
                1,
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
            let check_updates = event.id() == "check-updates";
            if event.id() == "about" || check_updates {
                let app = app.clone();
                // WebView2 window creation must run outside the synchronous menu handler.
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = show_about(&app, check_updates) {
                        app.dialog()
                            .message(format!("{}{error}", locale::text([
                                "Could not open the About window or check for updates: ",
                                "无法打开关于窗口或检查更新：",
                                "バージョン情報ウィンドウを開けないか、アップデートを確認できませんでした：",
                                "No se pudo abrir la ventana Acerca de ni buscar actualizaciones: ",
                                "Impossible d’ouvrir la fenêtre À propos ou de rechercher des mises à jour : ",
                            ])))
                            .title("VTubeLeaf")
                            .show(|_| {});
                    }
                });
            }
        })
        .invoke_handler(tauri::generate_handler![
            locale::system_language,
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
            downloads::get_download_platform,
            downloads::open_release_url,
            remove_model,
            read_model_preview,
            save_model_preview,
            read_model_resource,
            start_openseeface,
            stop_openseeface,
            start_nvidia,
            stop_nvidia,
            obs::obs_start,
            obs::obs_stop,
            obs::obs_submit,
            obs::obs_wanted,
            texture::texture_start,
            texture::texture_stop,
            texture::texture_submit,
            texture::texture_wanted
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
            // Quitting from the menu skips the window close handler that normally stops the output.
            if let Some(output) = app.try_state::<Mutex<texture::Output>>() {
                if let Ok(mut output) = output.lock() {
                    output.stop();
                }
            }
        }
    });
}

#[tauri::command]
async fn open_about(window: WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    require_main(&window)?;
    show_about(&app, false).map_err(|error| error.to_string())
}

#[tauri::command]
async fn restart_app(window: WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    require_main(&window)?;
    app.restart();
}

fn show_about(app: &tauri::AppHandle, check_updates: bool) -> tauri::Result<()> {
    let window = match app.get_webview_window("about") {
        Some(window) => window,
        None => {
            WebviewWindowBuilder::new(app, "about", WebviewUrl::App("index.html?about=1".into()))
                .title(locale::text(ABOUT))
                .inner_size(640.0, 700.0)
                .min_inner_size(480.0, 480.0)
                .center()
                .build()?
        }
    };
    window.unminimize()?;
    window.show()?;
    window.set_focus()?;
    if check_updates {
        app.emit_to("main", "update-action", "check")?;
    }
    Ok(())
}

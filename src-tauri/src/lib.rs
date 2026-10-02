// 分层目录即层名：commands(2) → infra(1) → domain(0)，单向依赖
pub mod commands;
pub mod domain;
pub mod infra;

use tauri::Manager;

/// tauri-specta 命令注册表：单一事实源，同时供 invoke_handler 与 TS 绑定导出使用。
/// 新增命令必须：① `#[specta::specta]` 标注；② 在此注册；③ 重新构建（pnpm dev 或
/// pnpm check 链路）自动复写 src/bindings.ts。
fn specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new()
        // 错误走 Promise reject（bindings 返回 Promise<T>），前端 try/catch 即可
        .error_handling(tauri_specta::ErrorHandlingMode::Throw)
        .events(tauri_specta::collect_events![
            infra::logging::LogLevelChanged
        ])
        .commands(tauri_specta::collect_commands![
            commands::notes::load_notes,
            commands::notes::save_notes,
            infra::logging::log_msg,
            infra::logging::get_log_level,
            infra::logging::set_log_level,
        ])
}

/// 绑定导出路径：锚定 CARGO_MANIFEST_DIR（编译期绝对路径），与进程工作目录无关。
/// 不能用相对路径——只有 tauri CLI 启动时 cwd 才是 src-tauri，
/// 其它启动方（如直接 spawn exe）会把文件写到项目外。
#[cfg(debug_assertions)]
fn bindings_path() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/bindings.ts")
}

/// debug 构建启动时自动导出 bindings；`DNOTE_EXPORT_BINDINGS` 触发「导出即退」供 pnpm check 复写。
#[cfg(debug_assertions)]
fn export_bindings(builder: &tauri_specta::Builder<tauri::Wry>) {
    builder
        .export(specta_typescript::Typescript::default(), bindings_path())
        .expect("导出 TypeScript 绑定失败");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let specta_builder = specta_builder();

    // 导出即退模式：pnpm check 直接复写 src/bindings.ts（不建窗口、不连
    // webview、不初始化任何子系统），导出后立即退出。
    #[cfg(debug_assertions)]
    if std::env::var_os("DNOTE_EXPORT_BINDINGS").is_some() {
        export_bindings(&specta_builder);
        return;
    }

    // debug 启动自动导出 bindings
    #[cfg(debug_assertions)]
    export_bindings(&specta_builder);

    // 文件日志初始化（级别：DNOTE_LOG > dnote-config.toml > 内置默认）
    infra::logging::init_from_config();
    log_info!(
        "dnote 启动（version {}，debug={}），日志级别 {}",
        env!("PACKAGE_VERSION"),
        cfg!(debug_assertions),
        infra::logging::level_str()
    );

    let mut builder = tauri::Builder::default();

    // 单实例**只保护 release 构建**（官方要求最先注册；二次启动不出新实例、直接唤起已有窗口，
    // 顺带也就不存在多实例并发写 dnote.txt 的问题）。
    // debug 构建不注册：锁的键是 app identifier，dev 与 release 读同一份 tauri.conf.json
    // → 撞同一把锁（Windows 上是命名互斥体 `<identifier>-sim`），常驻的 release 实例会把
    // dev 顶掉，表现为 `pnpm dev` 起不来。
    // 也不给 dev 另加「实例标识」之类的开关：dev 之间本来就并存不了（vite 用 strictPort
    // 占着 1420），而 e2e 直接 spawn 调试二进制、不经 vite，靠这一条就够并行。
    if cfg!(not(debug_assertions)) {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            commands::main_window::show_main_window(app);
        }));
    }

    builder
        .plugin({
            // 官方窗口状态插件：窗口创建时自动恢复上次尺寸/位置，退出时自动保存。
            // 排除 VISIBLE：主窗口可隐藏到托盘，可见性不参与持久化（否则托盘态退出后
            // 下次启动窗口不显示）。
            // 排除 DECORATIONS：边框形态由配置决定（无边框自绘），否则插件会把旧的
            // 原生边框状态恢复回来。
            let mut state = tauri_plugin_window_state::Builder::default().with_state_flags(
                tauri_plugin_window_state::StateFlags::all()
                    & !tauri_plugin_window_state::StateFlags::VISIBLE
                    & !tauri_plugin_window_state::StateFlags::DECORATIONS,
            );
            // dev/release 状态文件分离：release 用插件默认名（带前置点，插件内硬编码），
            // dev 单独命名，避免两边共享同一份窗口几何。
            if cfg!(debug_assertions) {
                state = state.with_filename("window-state.dev.json");
            }
            state.build()
        })
        .invoke_handler(specta_builder.invoke_handler())
        .setup(move |app| {
            specta_builder.mount_events(app);

            // 存储初始化：数据目录分离（dev=<项目根>/dnote-data，release=<app_config_dir>）
            let data_dir = infra::store::data_dir(app.handle());
            std::fs::create_dir_all(&data_dir)?;
            app.manage(infra::store::Store::new(data_dir.join("dnote.txt")));

            // 托盘常驻：无边框窗口没有系统按钮，托盘是「显示 / 退出」的兜底出口。
            // 左键单击切换显示/隐藏；右键菜单：显示 / 退出。
            #[cfg(desktop)]
            {
                use tauri::{
                    menu::{Menu, MenuItem, PredefinedMenuItem},
                    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
                };

                // dev 构建统一用通用的 DEV 图标，release 用应用自身图标（见 infra/tray.rs）。
                // 任务栏图标与托盘无关，也不受下面的开关影响，照常设置。
                let icon = infra::tray::icon(app.handle());
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.set_icon(icon.clone());
                }

                // e2e 等无人值守场景（`DNOTE_NO_TRAY`）不建托盘：并发实例会把系统托盘塞满一串
                // DEV 图标，也没人会去点它。注意此时 header 的 `-` 隐藏就再没有唤回入口了。
                if infra::tray::enabled() {
                    let show = MenuItem::with_id(app, "show", "显示", true, None::<&str>)?;
                    let sep = PredefinedMenuItem::separator(app)?;
                    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
                    let menu = Menu::with_items(app, &[&show, &sep, &quit])?;

                    TrayIconBuilder::with_id("dnote-tray")
                        .icon(icon)
                        .tooltip(if cfg!(debug_assertions) {
                            "dnote (dev)"
                        } else {
                            "dnote"
                        })
                        .menu(&menu)
                        .show_menu_on_left_click(false)
                        .on_menu_event(|app, event| match event.id.as_ref() {
                            "show" => commands::main_window::show_main_window(app),
                            "quit" => {
                                // 退出前显式保存窗口状态（插件在应用退出时也会自动保存）
                                use tauri_plugin_window_state::{AppHandleExt, StateFlags};
                                let _ = app.save_window_state(
                                    StateFlags::all()
                                        & !StateFlags::VISIBLE
                                        & !StateFlags::DECORATIONS,
                                );
                                app.exit(0);
                            }
                            _ => {}
                        })
                        .on_tray_icon_event(|tray, event| {
                            // 左键单击按可见性 toggle：隐藏 → 显示并聚焦；可见 → 隐藏。
                            // 不能用 is_focused 参与判断：点击托盘时窗口已先失焦，恒走显示分支。
                            if let TrayIconEvent::Click {
                                button: MouseButton::Left,
                                button_state: MouseButtonState::Up,
                                ..
                            } = event
                            {
                                let app = tray.app_handle();
                                if let Some(w) = app.get_webview_window("main") {
                                    if w.is_visible().unwrap_or(false) {
                                        commands::main_window::hide_main_window(app);
                                    } else {
                                        commands::main_window::show_main_window(app);
                                    }
                                }
                            }
                        })
                        .build(app)?;
                } else {
                    log_info!("DNOTE_NO_TRAY 已设置：本次不创建托盘图标");
                }
            }

            // 主窗口配置为 visible:false（避免几何恢复前的尺寸闪变），此处亮相
            let main_window = app.get_webview_window("main").expect("主窗口不存在");
            let _ = main_window.show();

            // 插件的尺寸恢复发生在窗口 show 之前（visible:false，尚无 DWM 帧），
            // 此时 set_size 会多算一个 caption 高：被恢复的尺寸偏大，退出时又按实际
            // 尺寸存回，形成每次重启都长高的棘轮。窗口已显示后再恢复一次，尺寸才准确。
            {
                use tauri_plugin_window_state::{StateFlags, WindowExt};
                if let Err(e) = main_window.restore_state(StateFlags::SIZE) {
                    log_warn!("窗口尺寸二次恢复失败：{e}");
                }
            }

            // 日志插件仅 debug 构建注册（终端输出）；应用日志量小，release 不落盘
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

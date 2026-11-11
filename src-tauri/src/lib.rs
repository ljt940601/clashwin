//! ClashWin backend: a Windows client for the mihomo core.

pub mod admin;
pub mod cli;
pub mod cmds;
pub mod config;
pub mod core;
pub mod geo;
pub mod nodegeo;
pub mod profiles;
pub mod settings;
pub mod speedtest;
pub mod state;
pub mod stats;
pub mod sysproxy;
pub mod tasks;
pub mod tray;
pub mod traypopup;
pub mod updates;
pub mod util;
pub mod windows;
pub mod winutil;

use std::sync::Arc;
use tauri_plugin_autostart::MacosLauncher;

use crate::state::AppState;
use crate::util::Paths;

pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    let has = |f: &str| args.iter().any(|a| a == f);

    let paths = Paths::new();
    let _ = paths.ensure();
    util::init_logger(&paths.logs);
    // Release builds abort on panic without a console, so record it in the log first.
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log::error!("panic: {info}");
        default_hook(info);
    }));
    log::info!("ClashWin {} starting (elevated: {})", env!("CARGO_PKG_VERSION"), admin::is_elevated());

    // A previous instance may be relaunching us (elevation); let it exit first.
    let relaunch = admin::wait_for_previous_instance(&paths.relaunch_marker());

    // With the helper installed, always run elevated (that's what the helper is for), so
    // switching Enhanced Mode only reloads the core instead of restarting the app. This
    // happens before any window exists, so it isn't visible.
    if !admin::is_elevated() && !has("--elevated") && !has("--no-elevate") && admin::helper_usable(&paths.data) {
        let mut handover = relaunch.clone().unwrap_or_default();
        handover.autostart |= has("--autostart");
        admin::write_relaunch_marker(&paths.relaunch_marker(), &handover);
        if admin::helper_run().is_ok() {
            log::info!("relaunching elevated via helper task");
            return;
        }
        let _ = std::fs::remove_file(paths.relaunch_marker());
    }

    let state = Arc::new(AppState::new(paths));
    let autostart = has("--autostart") || relaunch.as_ref().is_some_and(|r| r.autostart);
    let silent = match relaunch.as_ref().and_then(|r| r.show) {
        Some(show) => !show,
        None => state.settings.read().silent_start || autostart,
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            windows::show_dashboard(app, None);
        }))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--autostart"])))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(state.clone())
        .setup(move |app| {
            let handle = app.handle().clone();
            windows::create_main_restored(&handle, !silent, relaunch.as_ref())?;
            windows::create_tray_panel(&handle)?;
            tray::create(&handle)?;
            tasks::spawn_all(&handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // app
            cmds::app_info,
            cmds::app_memory,
            cmds::quit_app,
            cmds::restart_as_admin,
            cmds::open_dashboard,
            cmds::open_settings,
            cmds::hide_tray_panel,
            cmds::set_tray_panel_size,
            cmds::set_tray_panel_region,
            cmds::focus_tray_panel,
            cmds::open_url,
            cmds::reveal_path,
            cmds::process_icon,
            cmds::wifi_ssid,
            cmds::list_interfaces,
            cmds::lan_address,
            cmds::geoip_lookup,
            cmds::node_countries,
            cmds::local_location,
            cmds::check_app_update,
            cmds::install_app_update,
            cmds::app_update_cached,
            cmds::download_sources,
            cmds::test_download_sources,
            cmds::install_cli,
            cmds::geo_db_status,
            cmds::write_text_file,
            // settings
            cmds::get_settings,
            cmds::save_settings,
            cmds::reset_engine,
            // switches
            cmds::set_system_proxy,
            cmds::set_tun_mode,
            cmds::set_outbound_mode,
            // core
            cmds::core_status,
            cmds::core_start,
            cmds::core_stop,
            cmds::core_restart,
            cmds::core_reload,
            cmds::core_check_update,
            cmds::core_install,
            cmds::core_cached_versions,
            cmds::core_rollback,
            cmds::core_delete_cached,
            cmds::core_log_tail,
            cmds::speed_test,
            cmds::speed_test_cancel,
            // helper
            cmds::helper_status,
            cmds::helper_install,
            cmds::helper_uninstall,
            // profiles
            cmds::list_profiles,
            cmds::import_profile_url,
            cmds::import_profile_file,
            cmds::create_profile,
            cmds::update_profile,
            cmds::update_all_profiles,
            cmds::delete_profile,
            cmds::edit_profile_meta,
            cmds::set_active_profile,
            cmds::read_profile,
            cmds::write_profile,
            cmds::open_profile_in_editor,
            cmds::set_profile_providers,
            cmds::external_resources,
            cmds::update_external_resources,
            // rules
            cmds::get_rules,
            cmds::set_rules,
            cmds::add_rule,
            cmds::reset_rules,
            cmds::rule_targets,
            // stats
            cmds::stats_summary,
            cmds::stats_period,
            cmds::stats_routes,
            cmds::history_info,
            cmds::history_clear,
        ])
        .build(tauri::generate_context!())
        .expect("error while building ClashWin")
        .run(|app, event| match event {
            tauri::RunEvent::ExitRequested { api, code, .. } => {
                // Closing windows keeps the app alive in the tray; only explicit exits quit.
                if code.is_none() {
                    api.prevent_exit();
                }
            }
            tauri::RunEvent::Exit => {
                state::state(app).cleanup();
            }
            _ => {}
        });
}

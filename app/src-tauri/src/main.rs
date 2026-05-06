// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
use commands::{
    load_google_ai_studio_api_key,
    load_google_ai_studio_model,
    load_column_catalog,
    open_export_target,
    process_files,
    save_google_ai_studio_api_key,
    save_google_ai_studio_model,
    update_column_catalog_column,
    update_column_catalog_order,
    update_export,
};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            process_files,
            update_export,
            open_export_target,
            load_column_catalog,
            load_google_ai_studio_api_key,
            save_google_ai_studio_api_key,
            load_google_ai_studio_model,
            save_google_ai_studio_model,
            update_column_catalog_column,
            update_column_catalog_order
        ])
        .run(tauri::generate_context!())
        .expect("Erreur lors du lancement de l'application");
}

// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
use commands::{open_export_target, process_files, update_export};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![process_files, update_export, open_export_target])
        .run(tauri::generate_context!())
        .expect("Erreur lors du lancement de l'application");
}

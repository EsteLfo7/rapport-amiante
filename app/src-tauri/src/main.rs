// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use commands::process_files;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![process_files])
        .run(tauri::generate_context!())
        .expect("Erreur lors du lancement de l'application Tauri");
}

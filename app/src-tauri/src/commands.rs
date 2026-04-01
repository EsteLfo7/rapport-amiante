use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::command;

#[derive(Deserialize)]
pub struct ProcessArgs {
    pub paths: Vec<String>,
    pub mode: String,
    pub columns: Vec<String>,
}

#[derive(Serialize)]
pub struct ProcessResult {
    pub success: bool,
    pub message: String,
    pub output_path: Option<String>,
}

/// Commande principale : lance le script Python de traitement
/// avec les fichiers PDF, le mode (rapide/precis) et les colonnes souhaitees
#[command]
pub fn process_files(
    paths: Vec<String>,
    mode: String,
    columns: Vec<String>,
) -> Result<String, String> {
    if paths.is_empty() {
        return Err("Aucun fichier selectionne".to_string());
    }

    // Chemin vers le script Python principal
    // En production: relatif a l'executable .exe
    // En dev: relatif au workspace
    let script = find_python_script();

    // Colonnes separees par virgule
    let columns_str = columns.join(",");

    let mut cmd = Command::new("python");
    cmd.arg(&script)
        .arg("--mode")
        .arg(&mode)
        .arg("--columns")
        .arg(&columns_str);

    // Ajouter chaque fichier PDF
    for path in &paths {
        cmd.arg("--files").arg(path);
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Erreur lors du lancement du script Python: {}", e))?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let result: serde_json::Value =
            serde_json::from_str(&stdout).unwrap_or(serde_json::json!({
                "success": true,
                "message": "Traitement termine",
                "output_path": null
            }));
        let msg = result["message"]
            .as_str()
            .unwrap_or("Traitement termine avec succes")
            .to_string();
        Ok(msg)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(format!("Erreur Python: {}", stderr))
    }
}

/// Trouve le chemin du script Python
fn find_python_script() -> String {
    // En dev: depuis la racine du projet
    let dev_path = "../rapport_amiante/main.py";
    if std::path::Path::new(dev_path).exists() {
        return dev_path.to_string();
    }
    // En production (exe bundled): a cote de l'executable
    if let Ok(exe_dir) = std::env::current_exe() {
        if let Some(dir) = exe_dir.parent() {
            let prod_path = dir.join("main.py");
            if prod_path.exists() {
                return prod_path.to_string_lossy().to_string();
            }
        }
    }
    // Fallback
    "main.py".to_string()
}

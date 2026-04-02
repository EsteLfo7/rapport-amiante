// rapport-amiante/app/src-tauri/src/commands.rs
use std::env;
use std::path::PathBuf;
use std::process::Command;
use tauri::command;

#[command]
pub async fn process_files(
    paths: Vec<String>,
    mode: String,
    columns: Vec<String>,
) -> Result<String, String> {
    if paths.is_empty() {
        return Err("Aucun fichier selectionne".to_string());
    }

    let project_root = find_project_root()
        .ok_or_else(|| "Impossible de trouver la racine du projet".to_string())?;
    let python_bin = find_python_bin();
    let python_mode = match mode.as_str() {
        "rapide" => "gemini",
        "precis" => "rag",
        other => other,
    }.to_string(); 

    let columns_str = columns.join(",");
    let mut cmd = std::process::Command::new(&python_bin);
    cmd.current_dir(&project_root)
        .arg("-m")
        .arg("rapport_amiante.main")
        .arg("--mode")
        .arg(&python_mode)
        .arg("--columns")
        .arg(&columns_str)
        .arg("--files");
    for path in &paths {
        cmd.arg(path);
    }

    let output = tokio::task::spawn_blocking(move || -> std::io::Result<std::process::Output> {
        cmd.output()
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
    .map_err(|e| format!("Erreur lors du lancement de {}: {}", python_bin, e))?;

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
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let details = if stderr.trim().is_empty() { stdout } else { stderr };
        Err(format!("Erreur backend Python: {}", details.trim()))
    }
}

fn find_python_bin() -> String {
    if let Ok(bin) = env::var("RAPPORT_AMIANTE_PYTHON") {
        if !bin.trim().is_empty() {
            return bin;
        }
    }

    for candidate in ["python3", "python"] {
        if Command::new(candidate).arg("--version").output().is_ok() {
            return candidate.to_string();
        }
    }

    "python3".to_string()
}

fn find_project_root() -> Option<PathBuf> {

    let dev_root = PathBuf::from("../../");
    if dev_root.join("rapport_amiante").join("main.py").exists() {
        return dev_root.canonicalize().ok();
    }

    if let Ok(cwd) = std::env::current_dir() {
        let mut dir = cwd;
        for _ in 0..6 {
            if dir.join("rapport_amiante").join("main.py").exists() {
                return Some(dir);
            }
            match dir.parent() {
                Some(p) => dir = p.to_path_buf(),
                None => break,
            }
        }
    }

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(dir) = exe_path.parent() {
            let bundled_root = dir.join("_internal");
            if bundled_root.join("rapport_amiante").join("main.py").exists() {
                return Some(bundled_root);
            }
            if dir.join("rapport_amiante").join("main.py").exists() {
                return Some(dir.to_path_buf());
            }
        }
    }

    None
}

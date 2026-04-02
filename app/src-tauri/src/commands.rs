use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{command, Emitter, Window};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnDefinition {
    pub key: String,
    pub label: String,
    pub description: String,
    pub rag_keywords: Vec<String>,
    pub postprocess_prompt: String,
    pub category: String,
    pub simple: bool,
    pub builtin: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgressPayload {
    pub stage: String,
    pub message: String,
    pub total_files: usize,
    pub current_file_index: usize,
    pub processed_count: usize,
    pub error_count: usize,
    pub file_name: Option<String>,
    pub error_detail: Option<String>,
}

#[derive(Debug, Serialize)]
struct ProcessRequest {
    action: &'static str,
    mode: String,
    pdf_paths: Vec<String>,
    columns: Vec<ColumnDefinition>,
}

#[derive(Debug, Serialize)]
struct RefineRequest {
    action: &'static str,
    output_path: String,
    manifest_path: String,
    columns: Vec<ColumnDefinition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackendResponse {
    pub success: bool,
    pub message: String,
    pub output_path: Option<String>,
    pub output_dir: Option<String>,
    pub manifest_path: Option<String>,
    pub log_path: Option<String>,
    pub processed_count: usize,
    pub error_count: usize,
    pub duration_seconds: f64,
    pub error_details: Vec<String>,
    pub columns: Vec<ColumnDefinition>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", content = "payload", rename_all = "snake_case")]
enum BackendStreamEvent {
    Progress(ProgressPayload),
    Result(BackendResponse),
}

#[command]
pub async fn process_files(
    window: Window,
    paths: Vec<String>,
    mode: String,
    columns: Vec<ColumnDefinition>,
) -> Result<BackendResponse, String> {
    if paths.is_empty() {
        return Err("Aucun fichier sélectionné".to_string());
    }

    let python_mode = match mode.as_str() {
        "rapide" => "rag",
        "precis" => "gemini",
        other => other,
    }
    .to_string();

    let request = ProcessRequest {
        action: "process",
        mode: python_mode,
        pdf_paths: paths,
        columns,
    };

    run_backend_request(window, &request).await
}

#[command]
pub async fn update_export(
    window: Window,
    output_path: String,
    manifest_path: String,
    columns: Vec<ColumnDefinition>,
) -> Result<BackendResponse, String> {
    let request = RefineRequest {
        action: "refine",
        output_path,
        manifest_path,
        columns,
    };

    run_backend_request(window, &request).await
}

#[command]
pub fn open_export_target(path: String, reveal_in_finder: bool) -> Result<(), String> {
    let target_path = PathBuf::from(path);

    if !target_path.exists() {
        return Err(format!("Chemin introuvable: {}", target_path.display()));
    }

    open_with_system(&target_path, reveal_in_finder)
}

async fn run_backend_request<T: Serialize>(
    window: Window,
    request: &T,
) -> Result<BackendResponse, String> {
    let project_root = find_project_root()
        .ok_or_else(|| "Impossible de trouver la racine du projet".to_string())?;
    let python_bin = find_python_bin();
    let request_path = write_request_file(request)?;

    let mut command = Command::new(&python_bin);
    command
        .current_dir(&project_root)
        .arg("-m")
        .arg("rapport_amiante.main")
        .arg("--request-file")
        .arg(&request_path)
        .arg("--stream-events")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = tokio::task::spawn_blocking(move || run_streamed_command(window, command)).await;
    let _ = fs::remove_file(&request_path);

    output
        .map_err(|error| format!("Erreur thread Tauri: {error}"))?
        .map_err(|error| format!("Erreur backend Python: {error}"))
}

fn run_streamed_command(window: Window, mut command: Command) -> Result<BackendResponse, String> {
    let mut child = command
        .spawn()
        .map_err(|error| format!("Impossible de lancer le backend Python: {error}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Impossible de lire stdout du backend".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Impossible de lire stderr du backend".to_string())?;

    let stdout_window = window.clone();
    let stdout_handle = std::thread::spawn(move || -> Result<(Option<BackendResponse>, Vec<String>), String> {
        let reader = BufReader::new(stdout);
        let mut raw_lines: Vec<String> = Vec::new();
        let mut final_response: Option<BackendResponse> = None;

        for line_result in reader.lines() {
            let line = line_result.map_err(|error| format!("Lecture stdout impossible: {error}"))?;
            let trimmed_line = line.trim();

            if trimmed_line.is_empty() {
                continue;
            }

            match serde_json::from_str::<BackendStreamEvent>(trimmed_line) {
                Ok(BackendStreamEvent::Progress(payload)) => {
                    let _ = stdout_window.emit("processing-progress", &payload);
                }
                Ok(BackendStreamEvent::Result(payload)) => {
                    final_response = Some(payload);
                }
                Err(_) => raw_lines.push(trimmed_line.to_string()),
            }
        }

        Ok((final_response, raw_lines))
    });

    let stderr_handle = std::thread::spawn(move || -> Result<String, String> {
        let mut reader = BufReader::new(stderr);
        let mut output = String::new();
        reader
            .read_to_string(&mut output)
            .map_err(|error| format!("Lecture stderr impossible: {error}"))?;
        Ok(output)
    });

    let status = child
        .wait()
        .map_err(|error| format!("Impossible d'attendre la fin du backend: {error}"))?;
    let (final_response, raw_lines) = stdout_handle
        .join()
        .map_err(|_| "Lecture stdout interrompue".to_string())??;
    let stderr_output = stderr_handle
        .join()
        .map_err(|_| "Lecture stderr interrompue".to_string())??;

    if status.success() {
        if let Some(response) = final_response {
            return Ok(response);
        }

        let raw_stdout = raw_lines.join("\n");

        return serde_json::from_str::<BackendResponse>(&raw_stdout)
            .map_err(|error| format!("Réponse backend invalide: {error}. Sortie: {raw_stdout}"));
    }

    let raw_stdout = raw_lines.join("\n");
    let details = if stderr_output.trim().is_empty() {
        raw_stdout
    } else {
        stderr_output
    };

    Err(details.trim().to_string())
}

fn write_request_file<T: Serialize>(request: &T) -> Result<PathBuf, String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Erreur horodatage: {error}"))?
        .as_millis();
    let request_dir = env::temp_dir().join("rapport_amiante_requests");

    fs::create_dir_all(&request_dir)
        .map_err(|error| format!("Impossible de créer le dossier temporaire: {error}"))?;

    let request_path = request_dir.join(format!("request_{timestamp}.json"));
    let payload = serde_json::to_string(request)
        .map_err(|error| format!("Impossible de sérialiser la requête: {error}"))?;

    fs::write(&request_path, payload)
        .map_err(|error| format!("Impossible d'écrire la requête temporaire: {error}"))?;

    Ok(request_path)
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

    if let Ok(cwd) = env::current_dir() {
        let mut dir = cwd;

        for _ in 0..6 {
            if dir.join("rapport_amiante").join("main.py").exists() {
                return Some(dir);
            }

            match dir.parent() {
                Some(parent) => dir = parent.to_path_buf(),
                None => break,
            }
        }
    }

    if let Ok(exe_path) = env::current_exe() {
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

fn open_with_system(path: &Path, reveal_in_finder: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("open");

        if reveal_in_finder {
            command.arg("-R");
        }

        command.arg(path);
        command
            .status()
            .map_err(|error| format!("Impossible d'ouvrir {path:?}: {error}"))?;

        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        if reveal_in_finder {
            Command::new("explorer")
                .arg(format!("/select,{}", path.display()))
                .status()
                .map_err(|error| format!("Impossible d'ouvrir {path:?}: {error}"))?;
        } else {
            Command::new("cmd")
                .args(["/C", "start", ""])
                .arg(path)
                .status()
                .map_err(|error| format!("Impossible d'ouvrir {path:?}: {error}"))?;
        }

        return Ok(());
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let target = if reveal_in_finder {
            path.parent().unwrap_or(path)
        } else {
            path
        };

        Command::new("xdg-open")
            .arg(target)
            .status()
            .map_err(|error| format!("Impossible d'ouvrir {target:?}: {error}"))?;

        return Ok(());
    }
}

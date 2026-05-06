use serde::{Deserialize, Serialize};
use std::collections::HashSet;
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
    pub expected_format: String,
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
    pub mode: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ColumnCatalogPayload {
    version: u64,
    columns: Vec<ColumnDefinition>,
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

#[command]
pub fn load_column_catalog() -> Result<Vec<ColumnDefinition>, String> {
    Ok(read_column_catalog_payload()?.columns)
}

#[command]
pub fn update_column_catalog_column(
    previous_key: Option<String>,
    column: ColumnDefinition,
) -> Result<Vec<ColumnDefinition>, String> {
    let mut payload = read_column_catalog_payload()?;
    let target_key = previous_key.unwrap_or_else(|| column.key.clone());

    let index = payload
        .columns
        .iter()
        .position(|existing| existing.key == target_key)
        .or_else(|| payload.columns.iter().position(|existing| existing.key == column.key));

    if let Some(index) = index {
        payload.columns[index] = column;
    } else {
        payload.columns.push(column);
    }

    write_column_catalog_payload(&payload)?;
    Ok(payload.columns)
}

#[command]
pub fn update_column_catalog_order(column_keys: Vec<String>) -> Result<Vec<ColumnDefinition>, String> {
    let mut payload = read_column_catalog_payload()?;
    let current_columns = payload.columns.clone();
    let mut next_columns: Vec<ColumnDefinition> = Vec::with_capacity(current_columns.len());
    let mut seen_keys: HashSet<String> = HashSet::new();

    for key in column_keys {
        if !seen_keys.insert(key.clone()) {
            continue;
        }

        if let Some(column) = current_columns.iter().find(|existing| existing.key == key) {
            next_columns.push(column.clone());
        }
    }

    for column in current_columns {
        if seen_keys.insert(column.key.clone()) {
            next_columns.push(column);
        }
    }

    payload.columns = next_columns;
    write_column_catalog_payload(&payload)?;
    Ok(payload.columns)
}

#[command]
pub fn load_google_ai_studio_api_key() -> Result<String, String> {
    Ok(read_env_value_from_env_file("GEMINI_API_KEY")?.unwrap_or_default())
}

#[command]
pub fn save_google_ai_studio_api_key(api_key: String) -> Result<(), String> {
    write_env_value("GEMINI_API_KEY", api_key.trim())
}

#[command]
pub fn load_google_ai_studio_model() -> Result<String, String> {
    Ok(read_env_value_from_env_file("GEMINI_MODEL")?
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "gemini-2.5-flash-preview-04-17".to_string()))
}

#[command]
pub fn save_google_ai_studio_model(model: String) -> Result<(), String> {
    let normalized_model = model.trim();

    if normalized_model.is_empty() {
        return Err("Le modèle Gemini ne peut pas être vide.".to_string());
    }

    write_env_value("GEMINI_MODEL", normalized_model)?;
    write_env_value("RAG_POSTPROCESS_MODEL", normalized_model)
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

fn column_catalog_path() -> Result<PathBuf, String> {
    let project_root =
        find_project_root().ok_or_else(|| "Impossible de trouver la racine du projet".to_string())?;
    let catalog_path = project_root
        .join("app")
        .join("src")
        .join("catalog")
        .join("column_catalog.json");

    if !catalog_path.exists() {
        return Err(format!(
            "Le catalogue des colonnes est introuvable: {}",
            catalog_path.display()
        ));
    }

    Ok(catalog_path)
}

fn read_column_catalog_payload() -> Result<ColumnCatalogPayload, String> {
    let catalog_path = column_catalog_path()?;
    let payload = fs::read_to_string(&catalog_path).map_err(|error| {
        format!(
            "Impossible de lire le catalogue des colonnes {}: {error}",
            catalog_path.display()
        )
    })?;

    serde_json::from_str::<ColumnCatalogPayload>(&payload).map_err(|error| {
        format!(
            "Impossible de parser le catalogue des colonnes {}: {error}",
            catalog_path.display()
        )
    })
}

fn write_column_catalog_payload(payload: &ColumnCatalogPayload) -> Result<(), String> {
    let catalog_path = column_catalog_path()?;
    let serialized_payload = serde_json::to_string_pretty(payload)
        .map_err(|error| format!("Impossible de sérialiser le catalogue des colonnes: {error}"))?;

    fs::write(&catalog_path, format!("{serialized_payload}\n")).map_err(|error| {
        format!(
            "Impossible d'écrire le catalogue des colonnes {}: {error}",
            catalog_path.display()
        )
    })
}

fn backend_env_path() -> Result<PathBuf, String> {
    let project_root =
        find_project_root().ok_or_else(|| "Impossible de trouver la racine du projet".to_string())?;

    Ok(project_root.join(".env"))
}

fn read_env_value_from_env_file(key: &str) -> Result<Option<String>, String> {
    let env_path = backend_env_path()?;

    if !env_path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&env_path).map_err(|error| {
        format!(
            "Impossible de lire le fichier de configuration {}: {error}",
            env_path.display()
        )
    })?;

    for line in content.lines() {
        let trimmed = line.trim();

        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        if let Some(value) = trimmed.strip_prefix(&format!("{key}=")) {
            let normalized_value = value.trim().trim_matches('"').trim_matches('\'');
            return Ok(Some(normalized_value.to_string()));
        }
    }

    Ok(None)
}

fn write_env_value(key: &str, value: &str) -> Result<(), String> {
    let env_path = backend_env_path()?;
    let existing_content = if env_path.exists() {
        fs::read_to_string(&env_path).map_err(|error| {
            format!(
                "Impossible de lire le fichier de configuration {}: {error}",
                env_path.display()
            )
        })?
    } else {
        String::new()
    };

    let mut next_lines: Vec<String> = Vec::new();
    let mut found = false;
    let prefix = format!("{key}=");

    for line in existing_content.lines() {
        let trimmed = line.trim_start();

        if trimmed.starts_with(&prefix) {
            if !found {
                if !value.is_empty() {
                    next_lines.push(format!("{key}={value}"));
                }

                found = true;
            }

            continue;
        }

        next_lines.push(line.to_string());
    }

    if !found && !value.is_empty() {
        next_lines.push(format!("{key}={value}"));
    }

    let serialized = if next_lines.is_empty() {
        String::new()
    } else {
        format!("{}\n", next_lines.join("\n"))
    };

    fs::write(&env_path, serialized).map_err(|error| {
        format!(
            "Impossible d'écrire le fichier de configuration {}: {error}",
            env_path.display()
        )
    })
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

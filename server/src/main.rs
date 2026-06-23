//! rustviz: analyze a Rust project and serve a 3D visualization on localhost.

use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::Result;
use axum::extract::{Query, State};
use axum::http::{header, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use clap::Parser;
use rust_embed::RustEmbed;
use serde::Deserialize;

#[derive(RustEmbed)]
#[folder = "../web/dist"]
struct WebAssets;

#[derive(Parser)]
#[command(name = "rustviz", about = "3D simulator-style visualizer for Rust projects")]
struct Cli {
    /// Path to the Rust project (a directory or a Cargo.toml).
    project: PathBuf,
    /// Port to serve the UI on.
    #[arg(long, default_value_t = 7878)]
    port: u16,
    /// Print the analysis JSON to stdout and exit (no server).
    #[arg(long)]
    dump: bool,
    /// Do not open the browser automatically.
    #[arg(long)]
    no_open: bool,
}

#[derive(Clone)]
struct AppState {
    default_path: PathBuf,
    /// Canonical workspace root used to resolve `/api/source` requests safely.
    root: Arc<Mutex<PathBuf>>,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    if cli.dump {
        let graph = rustviz_analyzer::analyze(&cli.project, &now_millis())?;
        println!("{}", serde_json::to_string_pretty(&graph)?);
        return Ok(());
    }

    // Warm up once to discover the canonical workspace root for source serving.
    let root = match rustviz_analyzer::analyze(&cli.project, &now_millis()) {
        Ok(graph) => PathBuf::from(graph.meta.root_path),
        Err(err) => {
            eprintln!("warning: initial analysis failed: {err}");
            cli.project.clone()
        }
    };
    let root = root.canonicalize().unwrap_or(root);

    let state = AppState {
        default_path: cli.project.clone(),
        root: Arc::new(Mutex::new(root)),
    };

    let app = Router::new()
        .route("/api/analyze", post(analyze_handler))
        .route("/api/source", get(source_handler))
        .fallback(static_handler)
        .with_state(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], cli.port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    let url = format!("http://{addr}");
    println!("RustViz serving {} at {url}", cli.project.display());
    if !cli.no_open {
        let _ = open::that(&url);
    }
    axum::serve(listener, app).await?;
    Ok(())
}

#[derive(Deserialize, Default)]
struct AnalyzeReq {
    path: Option<String>,
}

async fn analyze_handler(State(st): State<AppState>, body: Option<Json<AnalyzeReq>>) -> Response {
    let path = body
        .and_then(|b| b.0.path)
        .map(PathBuf::from)
        .unwrap_or_else(|| st.default_path.clone());

    match rustviz_analyzer::analyze(&path, &now_millis()) {
        Ok(graph) => {
            if let Ok(canon) = PathBuf::from(&graph.meta.root_path).canonicalize() {
                if let Ok(mut guard) = st.root.lock() {
                    *guard = canon;
                }
            }
            Json(graph).into_response()
        }
        Err(err) => (StatusCode::BAD_REQUEST, format!("analyze failed: {err}")).into_response(),
    }
}

#[derive(Deserialize)]
struct SourceQuery {
    file: String,
    start: usize,
    end: usize,
}

async fn source_handler(State(st): State<AppState>, Query(q): Query<SourceQuery>) -> Response {
    let root = match st.root.lock() {
        Ok(g) => g.clone(),
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "state error").into_response(),
    };
    match read_source(&root, &q.file, q.start, q.end) {
        Ok(text) => ([(header::CONTENT_TYPE, "text/plain; charset=utf-8")], text).into_response(),
        Err(_) => (StatusCode::NOT_FOUND, "source not available").into_response(),
    }
}

/// Read a line range from a file, guarding against path traversal outside root.
fn read_source(root: &Path, file: &str, start: usize, end: usize) -> Result<String> {
    let canon = root.join(file).canonicalize()?;
    anyhow::ensure!(canon.starts_with(root), "path escapes project root");
    let content = std::fs::read_to_string(&canon)?;
    let lines: Vec<&str> = content.lines().collect();
    let s = start.saturating_sub(1).min(lines.len());
    let e = end.clamp(s, lines.len());
    Ok(lines[s..e].join("\n"))
}

async fn static_handler(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    if let Some(file) = WebAssets::get(path) {
        let mime = mime_guess::from_path(path).first_or_octet_stream();
        return ([(header::CONTENT_TYPE, mime.as_ref())], file.data.into_owned()).into_response();
    }
    // SPA fallback: serve index.html for unknown routes.
    match WebAssets::get("index.html") {
        Some(file) => (
            [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
            file.data.into_owned(),
        )
            .into_response(),
        None => (
            StatusCode::NOT_FOUND,
            "frontend not built — run `npm install && npm run build` in web/",
        )
            .into_response(),
    }
}

fn now_millis() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

//! Run `cargo llvm-cov` and parse the per-file line coverage. Like `tests`, this
//! executes the project; the analyzer stays static.

use std::path::Path;
use std::process::Stdio;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;
use tokio::process::Command;
use tokio::time::timeout;

const TIMEOUT: Duration = Duration::from_secs(1800);

#[derive(Debug, Clone, Serialize)]
pub struct FileCoverage {
    /// Path relative to the workspace root.
    pub file: String,
    pub covered: u64,
    pub total: u64,
    pub pct: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct CoverageReport {
    pub files: Vec<FileCoverage>,
    pub covered: u64,
    pub total: u64,
    pub pct: f64,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub ran_at: String,
}

fn now_millis() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn failed(error: String) -> CoverageReport {
    CoverageReport { files: vec![], covered: 0, total: 0, pct: 0.0, ok: false, error: Some(error), ran_at: now_millis() }
}

fn kill_group(pid: Option<u32>) {
    if let Some(p) = pid {
        let _ = std::process::Command::new("kill").arg("-9").arg(format!("-{p}")).status();
    }
}

struct Guard {
    pid: Option<u32>,
    armed: bool,
}
impl Drop for Guard {
    fn drop(&mut self) {
        if self.armed {
            kill_group(self.pid);
        }
    }
}

const INSTALL_HINT: &str = "cargo-llvm-cov is not installed. Install it with:\n  cargo install cargo-llvm-cov\n  rustup component add llvm-tools-preview";

/// Run `cargo llvm-cov` (summary JSON on stdout, build/test logs on stderr) and
/// parse per-file line coverage.
pub async fn run(root: &Path) -> CoverageReport {
    let child = Command::new("cargo")
        .args(["llvm-cov", "--summary-only", "--json", "--workspace", "--no-fail-fast"])
        .current_dir(root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .process_group(0)
        .spawn();

    let child = match child {
        Ok(c) => c,
        Err(e) => return failed(format!("failed to launch cargo llvm-cov: {e}")),
    };
    let pid = child.id();
    let mut guard = Guard { pid, armed: true };
    let out = timeout(TIMEOUT, child.wait_with_output()).await;
    guard.armed = false;

    let out = match out {
        Err(_) => {
            kill_group(pid);
            return failed(format!("coverage timed out after {}s", TIMEOUT.as_secs()));
        }
        Ok(Err(e)) => {
            kill_group(pid);
            return failed(format!("cargo llvm-cov did not complete: {e}"));
        }
        Ok(Ok(out)) => out,
    };

    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    match serde_json::from_str::<Value>(&stdout) {
        Ok(v) => parse(&v, root),
        Err(_) => {
            if stderr.contains("no such command") || stderr.contains("not installed") || stderr.contains("llvm-tools") {
                failed(INSTALL_HINT.to_string())
            } else {
                let tail: Vec<&str> = stderr.lines().filter(|l| l.trim_start().starts_with("error")).take(20).collect();
                failed(if tail.is_empty() {
                    "coverage produced no JSON output".to_string()
                } else {
                    format!("coverage failed:\n{}", tail.join("\n"))
                })
            }
        }
    }
}

/// Parse the llvm-cov export summary JSON (`data[0].files[].summary.lines` and
/// `data[0].totals.lines`).
fn parse(v: &Value, root: &Path) -> CoverageReport {
    let root_str = root.to_string_lossy();
    let data = &v["data"][0];
    let lines = |s: &Value| -> (u64, u64, f64) {
        let l = &s["lines"];
        (l["covered"].as_u64().unwrap_or(0), l["count"].as_u64().unwrap_or(0), l["percent"].as_f64().unwrap_or(0.0))
    };

    let mut files = Vec::new();
    if let Some(arr) = data["files"].as_array() {
        for f in arr {
            let name = f["filename"].as_str().unwrap_or("");
            let rel = name.strip_prefix(root_str.as_ref()).map(|s| s.trim_start_matches('/')).unwrap_or(name);
            let (covered, total, pct) = lines(&f["summary"]);
            files.push(FileCoverage { file: rel.to_string(), covered, total, pct });
        }
    }
    files.sort_by(|a, b| a.pct.partial_cmp(&b.pct).unwrap_or(std::cmp::Ordering::Equal));

    let (covered, total, pct) = lines(&data["totals"]);
    CoverageReport { files, covered, total, pct, ok: true, error: None, ran_at: now_millis() }
}

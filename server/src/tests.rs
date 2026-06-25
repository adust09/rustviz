//! Run the target project's tests (`cargo test`) and parse the output into a
//! structured `TestRun` for the Test dashboard. This is the one place the server
//! executes project code — the analyzer stays deterministic and side-effect free.

use std::path::Path;
use std::process::Stdio;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tokio::process::Command;
use tokio::time::timeout;

const TIMEOUT: Duration = Duration::from_secs(600);

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TestKind {
    Unit,
    Integration,
    Doc,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TestStatus {
    Passed,
    Failed,
    Ignored,
}

#[derive(Debug, Clone, Serialize)]
pub struct TestCase {
    pub name: String,
    pub status: TestStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Suite {
    /// Display name (`src/lib.rs`, `tests/analyze.rs`, …).
    pub name: String,
    #[serde(rename = "crate")]
    pub krate: String,
    pub kind: TestKind,
    pub tests: Vec<TestCase>,
    pub passed: u32,
    pub failed: u32,
    pub ignored: u32,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct TestRun {
    pub suites: Vec<Suite>,
    pub passed: u32,
    pub failed: u32,
    pub ignored: u32,
    pub duration_ms: u64,
    /// True when the run compiled and no test failed.
    pub ok: bool,
    /// Set when the run could not produce results (compile error, timeout, …).
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

fn failed_run(error: String) -> TestRun {
    TestRun {
        suites: vec![],
        passed: 0,
        failed: 0,
        ignored: 0,
        duration_ms: 0,
        ok: false,
        error: Some(error),
        ran_at: now_millis(),
    }
}

/// Run `cargo test` in `root` (merged stdout+stderr so the `Running` suite
/// headers interleave with the test output in order) and parse the result.
pub async fn run(root: &Path) -> TestRun {
    let child = Command::new("sh")
        .arg("-c")
        .arg("cargo test --workspace --no-fail-fast --color never 2>&1")
        .current_dir(root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();

    let child = match child {
        Ok(c) => c,
        Err(e) => return failed_run(format!("failed to launch cargo test: {e}")),
    };

    match timeout(TIMEOUT, child.wait_with_output()).await {
        Err(_) => failed_run(format!("test run timed out after {}s", TIMEOUT.as_secs())),
        Ok(Err(e)) => failed_run(format!("cargo test did not complete: {e}")),
        Ok(Ok(out)) => parse(&String::from_utf8_lossy(&out.stdout)),
    }
}

/// `(target/debug/deps/<stem>-<hash>)` → `<stem>` (crate for unit suites, test
/// binary name for integration suites).
fn dep_stem(line: &str) -> String {
    let inside = line.rsplit_once('(').and_then(|(_, r)| r.split_once(')')).map(|(s, _)| s);
    let file = inside.and_then(|p| p.rsplit_once('/')).map(|(_, f)| f).unwrap_or("");
    file.rsplit_once('-').map(|(name, _)| name).unwrap_or(file).to_string()
}

/// Recognize a `Running …` / `Doc-tests …` suite header.
fn parse_header(t: &str) -> Option<Suite> {
    let mk = |name: String, krate: String, kind: TestKind| Suite {
        name,
        krate,
        kind,
        tests: vec![],
        passed: 0,
        failed: 0,
        ignored: 0,
        duration_ms: 0,
    };
    if let Some(rest) = t.strip_prefix("Running ") {
        let label = rest.split(" (").next().unwrap_or(rest).trim();
        let krate = dep_stem(rest);
        let kind = if label.starts_with("tests/") { TestKind::Integration } else { TestKind::Unit };
        return Some(mk(label.to_string(), krate, kind));
    }
    if let Some(krate) = t.strip_prefix("Doc-tests ") {
        return Some(mk(format!("{} (doc)", krate.trim()), krate.trim().to_string(), TestKind::Doc));
    }
    None
}

/// Recognize a `test <name> ... ok|FAILED|ignored` line.
fn parse_test(t: &str) -> Option<TestCase> {
    if t.starts_with("test result:") {
        return None;
    }
    let rest = t.strip_prefix("test ")?;
    let idx = rest.rfind(" ... ")?;
    let name = rest[..idx].trim().to_string();
    let status = match rest[idx + 5..].trim() {
        "ok" => TestStatus::Passed,
        "FAILED" => TestStatus::Failed,
        s if s.starts_with("ignored") => TestStatus::Ignored,
        _ => return None,
    };
    Some(TestCase { name, status, message: None })
}

/// Duration from `test result: …; finished in 0.02s`. Counts are derived from
/// the individual `test … ok/FAILED/ignored` lines (robust against the `ok.`
/// prefix on the first segment).
fn parse_result_duration(t: &str) -> Option<u64> {
    let body = t.strip_prefix("test result:")?;
    let dur = body
        .split("finished in ")
        .nth(1)
        .and_then(|s| s.trim().strip_suffix('s'))
        .and_then(|s| s.trim().parse::<f64>().ok())
        .map(|sec| (sec * 1000.0) as u64)
        .unwrap_or(0);
    Some(dur)
}

fn finalize(mut s: Suite, duration_ms: u64) -> Suite {
    s.duration_ms = duration_ms;
    s.passed = s.tests.iter().filter(|t| matches!(t.status, TestStatus::Passed)).count() as u32;
    s.failed = s.tests.iter().filter(|t| matches!(t.status, TestStatus::Failed)).count() as u32;
    s.ignored = s.tests.iter().filter(|t| matches!(t.status, TestStatus::Ignored)).count() as u32;
    s
}

fn parse(text: &str) -> TestRun {
    let mut suites: Vec<Suite> = vec![];
    let mut cur: Option<Suite> = None;
    let mut messages: Vec<(String, String)> = vec![]; // (test name, failure detail)
    let mut capturing: Option<(String, String)> = None;
    let mut compile_error = false;

    for raw in text.lines() {
        let t = raw.trim_start();

        // Failure detail block: `---- <name> stdout ----` … until the next marker.
        if let Some(name) = t.strip_prefix("---- ").and_then(|s| s.strip_suffix(" stdout ----")) {
            if let Some(prev) = capturing.take() {
                messages.push(prev);
            }
            capturing = Some((name.to_string(), String::new()));
            continue;
        }
        let is_marker = t.starts_with("Running ") || t.starts_with("Doc-tests ") || t.starts_with("test result:") || t == "failures:";
        if let Some((name, buf)) = capturing.as_mut() {
            if is_marker {
                messages.push((name.clone(), buf.trim().to_string()));
                capturing = None;
            } else {
                buf.push_str(raw);
                buf.push('\n');
                continue;
            }
        }

        if let Some(suite) = parse_header(t) {
            if let Some(s) = cur.take() {
                suites.push(finalize(s, 0));
            }
            cur = Some(suite);
        } else if let Some(dur) = parse_result_duration(t) {
            if let Some(s) = cur.take() {
                suites.push(finalize(s, dur));
            }
        } else if let Some(tc) = parse_test(t) {
            if let Some(s) = cur.as_mut() {
                s.tests.push(tc);
            }
        } else if t.starts_with("error[") || t.starts_with("error:") {
            compile_error = true;
        }
    }
    if let Some((name, buf)) = capturing {
        messages.push((name, buf.trim().to_string()));
    }
    if let Some(s) = cur.take() {
        suites.push(finalize(s, 0));
    }

    // Attach failure messages to their test cases.
    for (name, msg) in messages {
        for s in &mut suites {
            for tc in &mut s.tests {
                if tc.name == name && matches!(tc.status, TestStatus::Failed) {
                    tc.message = Some(msg.clone());
                }
            }
        }
    }

    let passed = suites.iter().map(|s| s.passed).sum();
    let failed: u32 = suites.iter().map(|s| s.failed).sum();
    let ignored = suites.iter().map(|s| s.ignored).sum();
    let duration_ms = suites.iter().map(|s| s.duration_ms).sum();
    let ran_anything = !suites.is_empty();
    let error = if compile_error && !ran_anything {
        Some(compile_error_summary(text))
    } else {
        None
    };
    TestRun {
        suites,
        passed,
        failed,
        ignored,
        duration_ms,
        ok: failed == 0 && error.is_none() && ran_anything,
        error,
        ran_at: now_millis(),
    }
}

fn compile_error_summary(text: &str) -> String {
    let lines: Vec<&str> = text
        .lines()
        .filter(|l| {
            let t = l.trim_start();
            t.starts_with("error[") || t.starts_with("error:")
        })
        .take(20)
        .collect();
    if lines.is_empty() {
        "test run produced no results".to_string()
    } else {
        format!("compilation failed:\n{}", lines.join("\n"))
    }
}

import { useState } from "react";
import type { Suite, TestKind, TestRun } from "./testRun";

interface TestViewProps {
  run: TestRun | null;
  loading: boolean;
  error: string | null;
  onRun: () => void;
}

const KIND_ORDER: TestKind[] = ["unit", "integration", "doc"];
const KIND_LABEL: Record<TestKind, string> = {
  unit: "Unit tests",
  integration: "Integration / E2E",
  doc: "Doc-tests",
};

export function TestView({ run, loading, error, onRun }: TestViewProps): JSX.Element {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [failsOnly, setFailsOnly] = useState(false);

  const toggle = (id: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="test-wrap">
      <div className="test-bar">
        <button className="test-run" onClick={onRun} disabled={loading}>
          {loading ? "running…" : run ? "↻ re-run" : "▶ run tests"}
        </button>
        {run && !loading && (
          <>
            <span className={`test-badge ${run.ok ? "ok" : "bad"}`}>{run.ok ? "all passing" : `${run.failed} failing`}</span>
            <span className="test-chip pass">{run.passed} passed</span>
            <span className="test-chip fail">{run.failed} failed</span>
            <span className="test-chip ign">{run.ignored} ignored</span>
            <span className="test-chip">{(run.duration_ms / 1000).toFixed(2)}s</span>
            <label className="test-filter">
              <input type="checkbox" checked={failsOnly} onChange={() => setFailsOnly((v) => !v)} /> failures only
            </label>
          </>
        )}
      </div>

      <div className="test-body">
        {loading && <div className="test-msg">running <code>cargo test</code> on the project… this can take a while (it compiles first).</div>}
        {!loading && error && <div className="test-error">⚠ {error}</div>}
        {!loading && !error && run?.error && (
          <div className="test-error">
            <div>⚠ tests could not run</div>
            <pre>{run.error}</pre>
          </div>
        )}
        {!loading && !error && run && !run.error && run.suites.length === 0 && <div className="test-msg">no tests found.</div>}
        {!loading && !error && run && !run.error &&
          KIND_ORDER.filter((k) => run.suites.some((s) => s.kind === k)).map((kind) => (
            <KindSection key={kind} kind={kind} suites={run.suites.filter((s) => s.kind === kind)} failsOnly={failsOnly} expanded={expanded} onToggle={toggle} />
          ))}
      </div>
    </div>
  );
}

function KindSection(props: { kind: TestKind; suites: Suite[]; failsOnly: boolean; expanded: Set<string>; onToggle: (id: string) => void }): JSX.Element {
  const { kind, suites, failsOnly, expanded, onToggle } = props;
  const passed = suites.reduce((n, s) => n + s.passed, 0);
  const failed = suites.reduce((n, s) => n + s.failed, 0);
  return (
    <div className="test-kind">
      <div className="test-kind-h">
        {KIND_LABEL[kind]} <span className="test-kind-sub">{passed} passed{failed > 0 ? ` · ${failed} failed` : ""}</span>
      </div>
      {suites.map((s) => {
        const tests = failsOnly ? s.tests.filter((t) => t.status === "failed") : s.tests;
        if (failsOnly && tests.length === 0) return null;
        return (
          <div key={`${s.kind}:${s.name}:${s.crate}`} className="test-suite">
            <div className="test-suite-h">
              <span className="test-suite-name">{s.name}</span>
              <span className="test-suite-crate">{s.crate}</span>
              <span className="test-suite-counts">
                {s.passed}p {s.failed > 0 && <b className="fail">{s.failed}f</b>} {s.ignored > 0 ? `${s.ignored}i` : ""} · {(s.duration_ms / 1000).toFixed(2)}s
              </span>
            </div>
            {tests.map((t) => {
              const id = `${s.name}:${t.name}`;
              const open = expanded.has(id);
              const clickable = t.status === "failed" && t.message;
              return (
                <div key={id} className="test-case-wrap">
                  <div className={`test-case ${t.status} ${clickable ? "clickable" : ""}`} onClick={() => clickable && onToggle(id)}>
                    <span className={`test-dot ${t.status}`} />
                    <span className="test-case-name">{t.name}</span>
                    {clickable && <span className="test-case-x">{open ? "▾" : "▸"}</span>}
                  </div>
                  {open && t.message && <pre className="test-case-msg">{t.message}</pre>}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

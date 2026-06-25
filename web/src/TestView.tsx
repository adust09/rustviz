import { useMemo, useState } from "react";
import type { Graph } from "./schema";
import type { Suite, TestCase, TestRun } from "./testRun";
import type { CoverageReport, FileCoverage } from "./coverage";

interface TestViewProps {
  run: TestRun | null;
  loading: boolean;
  error: string | null;
  onRun: () => void;
  /** Graph supplies each test fn's doc comment (the "intent"). */
  graph: Graph | null;
  coverage: CoverageReport | null;
  covLoading: boolean;
  covError: string | null;
  onRunCoverage: () => void;
}

interface Row {
  suite: Suite;
  test: TestCase;
  intent: string;
  documented: boolean;
}

/** A test's last path segment, prettified — the fallback intent when undocumented. */
function humanize(name: string): string {
  const last = name.split("::").pop() ?? name;
  return last.replace(/_/g, " ");
}

const KIND_LABEL: Record<Suite["kind"], string> = { unit: "unit", integration: "e2e", doc: "doc" };

export function TestView(props: TestViewProps): JSX.Element {
  const { run, loading, error, onRun, graph, coverage, covLoading, covError, onRunCoverage } = props;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [failsOnly, setFailsOnly] = useState(false);

  // Map "<crate_underscored>::<module::path::name>" → doc comment, to look up a
  // test's documented intent. Test names from cargo are crate-relative; graph
  // ids are crate-qualified with the package (dashed) name.
  const docByKey = useMemo(() => {
    const m = new Map<string, string>();
    if (!graph) return m;
    for (const n of graph.nodes) {
      if (n.kind !== "fn" || !n.doc) continue;
      const rel = n.id.startsWith(`${n.crate}::`) ? n.id.slice(n.crate.length + 2) : n.id;
      m.set(`${n.crate.replaceAll("-", "_")}::${rel}`, n.doc);
    }
    return m;
  }, [graph]);

  const rows: Row[] = useMemo(() => {
    if (!run) return [];
    const out: Row[] = [];
    for (const suite of run.suites) {
      for (const test of suite.tests) {
        const doc = docByKey.get(`${suite.crate}::${test.name}`);
        out.push({ suite, test, intent: doc ?? humanize(test.name), documented: !!doc });
      }
    }
    return failsOnly ? out.filter((r) => r.test.status === "failed") : out;
  }, [run, docByKey, failsOnly]);

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
        <CoveragePanel report={coverage} loading={covLoading} error={covError} onRun={onRunCoverage} />

        {loading && <div className="test-msg">running <code>cargo test</code> on the project… this can take a while (it compiles first).</div>}
        {!loading && error && <div className="test-error">⚠ {error}</div>}
        {!loading && !error && run?.error && (
          <div className="test-error">
            <div>⚠ tests could not run</div>
            <pre>{run.error}</pre>
          </div>
        )}
        {!loading && !error && run && !run.error && rows.length === 0 && <div className="test-msg">no tests.</div>}
        {!loading && !error && run && !run.error && rows.length > 0 && (
          <table className="test-table">
            <thead>
              <tr>
                <th></th>
                <th>test</th>
                <th>intent (what it verifies)</th>
                <th>kind</th>
                <th>crate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const id = `${r.suite.name}:${r.test.name}`;
                const open = expanded.has(id);
                const clickable = r.test.status === "failed" && !!r.test.message;
                return <TestRow key={id} row={r} id={id} open={open} clickable={clickable} onToggle={toggle} />;
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/** <50% red, <80% amber, else green — the visual "where's the risk" cue. */
function tier(pct: number): "low" | "mid" | "high" {
  if (pct < 50) return "low";
  if (pct < 80) return "mid";
  return "high";
}

interface CrateCov {
  crate: string;
  prefix: string;
  covered: number;
  total: number;
  pct: number;
  files: FileCoverage[];
}

/** Roll per-file coverage up to per-crate, keyed by the path before `/src/`. */
function byCrate(files: FileCoverage[]): CrateCov[] {
  const groups = new Map<string, FileCoverage[]>();
  for (const f of files) {
    const i = f.file.indexOf("/src/");
    const prefix = i >= 0 ? f.file.slice(0, i) : f.file.split("/").slice(0, -1).join("/");
    const arr = groups.get(prefix) ?? [];
    arr.push(f);
    groups.set(prefix, arr);
  }
  const out: CrateCov[] = [];
  for (const [prefix, fs] of groups) {
    const covered = fs.reduce((s, f) => s + f.covered, 0);
    const total = fs.reduce((s, f) => s + f.total, 0);
    out.push({
      crate: prefix.split("/").pop() || prefix || "(root)",
      prefix,
      covered,
      total,
      pct: total ? (covered / total) * 100 : 0,
      files: fs,
    });
  }
  return out.sort((a, b) => a.pct - b.pct);
}

function Bar({ pct }: { pct: number }): JSX.Element {
  return (
    <span className={`cov-bar ${tier(pct)}`}>
      <span className="cov-bar-fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </span>
  );
}

function CoveragePanel(props: {
  report: CoverageReport | null;
  loading: boolean;
  error: string | null;
  onRun: () => void;
}): JSX.Element {
  const { report, loading, error, onRun } = props;
  const [open, setOpen] = useState<Set<string>>(new Set());
  const crates = useMemo(() => (report?.ok ? byCrate(report.files) : []), [report]);

  const toggle = (k: string): void =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <div className="cov-panel">
      <div className="cov-head">
        <span className="cov-title">coverage</span>
        <button className="cov-run" onClick={onRun} disabled={loading}>
          {loading ? "measuring…" : report ? "↻ re-measure" : "▶ measure coverage"}
        </button>
        {report?.ok && !loading && (
          <>
            <span className={`cov-overall ${tier(report.pct)}`}>{report.pct.toFixed(1)}%</span>
            <span className="cov-lines">
              {report.covered.toLocaleString()} / {report.total.toLocaleString()} lines
            </span>
            <span className="cov-overall-bar">
              <Bar pct={report.pct} />
            </span>
          </>
        )}
      </div>

      {loading && (
        <div className="test-msg">
          running <code>cargo llvm-cov</code>… this instruments and rebuilds the project, so it is slower than a plain test run.
        </div>
      )}
      {!loading && error && <div className="test-error">⚠ {error}</div>}
      {!loading && !error && report && !report.ok && (
        <div className="test-error">
          <div>⚠ coverage could not run</div>
          <pre>{report.error}</pre>
        </div>
      )}
      {!loading && !error && report?.ok && crates.length === 0 && <div className="test-msg">no coverage data.</div>}
      {!loading && !error && report?.ok && crates.length > 0 && (
        <table className="cov-table">
          <tbody>
            {crates.map((c) => {
              const isOpen = open.has(c.prefix);
              return (
                <CrateRow key={c.prefix} crate={c} open={isOpen} onToggle={() => toggle(c.prefix)} />
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function CrateRow(props: { crate: CrateCov; open: boolean; onToggle: () => void }): JSX.Element {
  const { crate, open, onToggle } = props;
  return (
    <>
      <tr className="cov-crate-row" onClick={onToggle}>
        <td className="cov-c-name" title={crate.prefix}>
          <span className="cov-x">{open ? "▾" : "▸"}</span> {crate.crate}
        </td>
        <td className="cov-c-bar"><Bar pct={crate.pct} /></td>
        <td className={`cov-c-pct ${tier(crate.pct)}`}>{crate.pct.toFixed(1)}%</td>
        <td className="cov-c-lines">{crate.covered} / {crate.total}</td>
      </tr>
      {open &&
        crate.files.map((f) => (
          <tr key={f.file} className="cov-file-row">
            <td className="cov-f-name" title={f.file}>{f.file.split("/").pop()}</td>
            <td className="cov-f-bar"><Bar pct={f.pct} /></td>
            <td className={`cov-f-pct ${tier(f.pct)}`}>{f.pct.toFixed(1)}%</td>
            <td className="cov-f-lines">{f.covered} / {f.total}</td>
          </tr>
        ))}
    </>
  );
}

function TestRow(props: { row: Row; id: string; open: boolean; clickable: boolean; onToggle: (id: string) => void }): JSX.Element {
  const { row, id, open, clickable, onToggle } = props;
  const { suite, test, intent, documented } = row;
  return (
    <>
      <tr className={`test-row ${test.status} ${clickable ? "clickable" : ""}`} onClick={() => clickable && onToggle(id)}>
        <td className="test-td-status"><span className={`test-dot ${test.status}`} /></td>
        <td className="test-td-name" title={test.name}>
          {test.name.split("::").pop()}
          {clickable && <span className="test-row-x">{open ? " ▾" : " ▸"}</span>}
        </td>
        <td className={`test-td-intent ${documented ? "doc" : "name"}`}>{intent}</td>
        <td className="test-td-kind">{KIND_LABEL[suite.kind]}</td>
        <td className="test-td-crate">{suite.crate}</td>
      </tr>
      {open && test.message && (
        <tr className="test-row-detail">
          <td></td>
          <td colSpan={4}><pre className="test-case-msg">{test.message}</pre></td>
        </tr>
      )}
    </>
  );
}

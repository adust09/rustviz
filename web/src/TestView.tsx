import { useMemo, useState } from "react";
import type { Graph } from "./schema";
import type { Suite, TestCase, TestRun } from "./testRun";

interface TestViewProps {
  run: TestRun | null;
  loading: boolean;
  error: string | null;
  onRun: () => void;
  /** Graph supplies each test fn's doc comment (the "intent"). */
  graph: Graph | null;
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

export function TestView({ run, loading, error, onRun, graph }: TestViewProps): JSX.Element {
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

import type { PrPatrolCommitRef, PrPatrolRunLinks } from "../../api";
import { SEVERITY_CHIP, verdictTone } from "./format";

function Commits({ commits }: { commits: PrPatrolCommitRef[] }) {
  if (!commits.length) return <span style={{ color: "var(--th-text-muted)" }}>-</span>;
  return (
    <span className="flex flex-col gap-0.5">
      {commits.map((c) => (
        <span key={c.sha} className="truncate" title={c.subject}>
          <code className="font-mono text-[11px]" style={{ color: "var(--th-text-secondary)" }}>
            {c.sha.slice(0, 7)}
          </code>{" "}
          <span style={{ color: "var(--th-text-muted)" }}>{c.subject}</span>
        </span>
      ))}
    </span>
  );
}

function Severity({ severity }: { severity: string }) {
  return (
    <span
      className={`inline-block rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${SEVERITY_CHIP[severity] ?? SEVERITY_CHIP.P3}`}
    >
      {severity}
    </span>
  );
}

const loc = (file: string | null, line: number | null) => (file ? `${file}${line ? `:${line}` : ""}` : "");

const TH = "px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide";

export default function FindingsTable({
  links,
  onOpenRun,
}: {
  links: PrPatrolRunLinks;
  onOpenRun: (taskId: string) => void;
}) {
  if (links.kind === "none") return null;
  const head = (cols: string[]) => (
    <thead style={{ color: "var(--th-text-muted)" }}>
      <tr className="border-b" style={{ borderColor: "var(--th-card-border)" }}>
        {cols.map((c) => (
          <th key={c} className={TH}>
            {c}
          </th>
        ))}
      </tr>
    </thead>
  );

  if (links.kind === "review") {
    if (!links.findings.length) return <Empty text="The review reported no findings." />;
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          {head(["Sev", "Finding", "Where", "Fix"])}
          <tbody>
            {links.findings.map((f, i) => (
              <tr key={i} className="border-b align-top" style={{ borderColor: "var(--th-card-border)" }}>
                <td className="px-2 py-1.5">
                  <Severity severity={f.severity} />
                </td>
                <td className="px-2 py-1.5" style={{ color: "var(--th-text-primary)" }}>
                  <div className="font-medium">{f.title}</div>
                  {f.detail && (
                    <div className="mt-0.5 line-clamp-3" style={{ color: "var(--th-text-muted)" }}>
                      {f.detail}
                    </div>
                  )}
                </td>
                <td className="px-2 py-1.5 font-mono text-[11px]" style={{ color: "var(--th-text-secondary)" }}>
                  {loc(f.file, f.line)}
                </td>
                <td className="px-2 py-1.5">
                  {f.fix ? (
                    <div className="flex flex-col gap-0.5">
                      <button
                        type="button"
                        onClick={() => onOpenRun(f.fix!.taskId)}
                        className="text-left text-sky-500 hover:underline"
                      >
                        Fix run{f.fix.verdict ? ": " : ""}
                        {f.fix.verdict && <span className={verdictTone(f.fix.verdict)}>{f.fix.verdict}</span>}
                      </button>
                      {f.fix.reason && <span style={{ color: "var(--th-text-muted)" }}>{f.fix.reason}</span>}
                      <Commits commits={f.fix.commits} />
                    </div>
                  ) : (
                    <span style={{ color: "var(--th-text-muted)" }}>
                      {f.blocking ? "no fix run yet" : "left for the author"}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (!links.items.length) return <Empty text="The agent reported no items." />;
  return (
    <div className="overflow-x-auto">
      {links.reviewTaskId && (
        <button
          type="button"
          onClick={() => onOpenRun(links.reviewTaskId!)}
          className="mb-2 text-xs text-sky-500 hover:underline"
        >
          Open the review these findings came from
        </button>
      )}
      <table className="w-full text-xs">
        {head(["Item", "Verdict", "Reason", "Commits"])}
        <tbody>
          {links.items.map((it, i) => (
            <tr key={`${it.key}:${i}`} className="border-b align-top" style={{ borderColor: "var(--th-card-border)" }}>
              <td className="px-2 py-1.5" style={{ color: "var(--th-text-primary)" }}>
                <div className="flex items-center gap-1.5">
                  {it.finding && <Severity severity={it.finding.severity} />}
                  <span className="font-medium">{it.title ?? (it.feedback ? `@${it.feedback.author}` : it.key)}</span>
                </div>
                {it.finding?.file && (
                  <div className="font-mono text-[11px]" style={{ color: "var(--th-text-muted)" }}>
                    {loc(it.finding.file, it.finding.line)}
                  </div>
                )}
                {it.feedback && (
                  <div className="mt-0.5 line-clamp-2" style={{ color: "var(--th-text-muted)" }}>
                    {it.feedback.path ? `${loc(it.feedback.path, it.feedback.line)}: ` : ""}
                    {it.feedback.url ? (
                      <a href={it.feedback.url} target="_blank" rel="noreferrer" className="hover:underline">
                        {it.feedback.excerpt}
                      </a>
                    ) : (
                      it.feedback.excerpt
                    )}
                  </div>
                )}
              </td>
              <td className={`px-2 py-1.5 font-medium ${verdictTone(it.verdict)}`}>{it.verdict}</td>
              <td className="px-2 py-1.5" style={{ color: "var(--th-text-secondary)" }}>
                {it.reason ?? ""}
              </td>
              <td className="max-w-[260px] px-2 py-1.5">
                <Commits commits={it.commits} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="text-sm" style={{ color: "var(--th-text-muted)" }}>
      {text}
    </div>
  );
}

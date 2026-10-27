import { useMemo, useState } from "react";
import type { PrPatrolRunCommit } from "../../api";
import PixelIcon from "../pixel/PixelIcon";
import { parseUnifiedDiff, type DiffFile, type DiffLineType } from "./diff-parse";

const LINE_STYLE: Record<DiffLineType, { cls: string; color?: string }> = {
  add: { cls: "border-l-2 border-emerald-500 bg-emerald-500/15", color: "var(--th-text-primary)" },
  del: { cls: "border-l-2 border-rose-500 bg-rose-500/15", color: "var(--th-text-primary)" },
  hunk: { cls: "border-l-2 border-transparent bg-sky-500/10 text-sky-500" },
  meta: { cls: "border-l-2 border-transparent italic", color: "var(--th-text-muted)" },
  ctx: { cls: "border-l-2 border-transparent", color: "var(--th-text-secondary)" },
};

/** Files with more lines than this start collapsed. */
const AUTO_COLLAPSE_LINES = 300;

function FileBlock({ file, defaultOpen }: { file: DiffFile; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-lg border" style={{ borderColor: "var(--th-card-border)" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs"
        style={{ background: "var(--th-bg-surface)", color: "var(--th-text-primary)" }}
      >
        <PixelIcon name={open ? "minus" : "plus"} size={12} />
        <PixelIcon name="file" size={12} />
        <span className="truncate font-mono" title={file.path}>
          {file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[11px]">
          <span className="text-emerald-500">+{file.additions}</span>{" "}
          <span className="text-rose-400">-{file.deletions}</span>
        </span>
      </button>
      {open && (
        <div className="overflow-x-auto" style={{ background: "var(--th-input-bg)" }}>
          {file.binary && file.lines.length === 0 ? (
            <div className="px-3 py-2 text-xs" style={{ color: "var(--th-text-muted)" }}>
              Binary file
            </div>
          ) : (
            <pre className="min-w-full font-mono text-[11px] leading-[1.45]">
              {file.lines.map((l, i) => {
                const st = LINE_STYLE[l.type];
                return (
                  <div
                    key={i}
                    data-diff-line={l.type}
                    className={`whitespace-pre px-3 ${st.cls}`}
                    style={st.color ? { color: st.color } : undefined}
                  >
                    {l.text || " "}
                  </div>
                );
              })}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function CommitDiff({ commit }: { commit: PrPatrolRunCommit }) {
  const parsed = useMemo(() => parseUnifiedDiff(commit.diff), [commit.diff]);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <PixelIcon name="git" size={14} />
        <code
          className="rounded px-1 text-xs"
          style={{ background: "var(--th-bg-surface)", color: "var(--th-text-secondary)" }}
        >
          {commit.sha.slice(0, 7)}
        </code>
        <span className="font-medium" style={{ color: "var(--th-text-heading)" }}>
          {commit.subject}
        </span>
        {(commit.author || commit.date) && (
          <span className="text-[11px]" style={{ color: "var(--th-text-muted)" }}>
            {commit.author}
            {commit.date ? ` · ${new Date(commit.date).toLocaleString()}` : ""}
          </span>
        )}
      </div>
      {parsed.stat.length > 0 && (
        <pre
          className="overflow-x-auto rounded-md px-3 py-2 font-mono text-[11px]"
          style={{ background: "var(--th-bg-surface)", color: "var(--th-text-secondary)" }}
        >
          {parsed.stat.join("\n")}
        </pre>
      )}
      {parsed.files.map((f, i) => (
        <FileBlock key={`${f.path}:${i}`} file={f} defaultOpen={f.lines.length <= AUTO_COLLAPSE_LINES} />
      ))}
      {parsed.files.length === 0 && !parsed.stat.length && (
        <div className="text-xs" style={{ color: "var(--th-text-muted)" }}>
          Empty diff (a merge commit without conflict resolutions shows no combined diff).
        </div>
      )}
      {commit.diffTruncated && (
        <div className="flex items-center gap-1.5 text-[11px] text-amber-500">
          <PixelIcon name="warning" size={12} /> Diff truncated (size cap).
        </div>
      )}
    </div>
  );
}

export default function DiffView({ commits }: { commits: PrPatrolRunCommit[] }) {
  return (
    <div className="flex flex-col gap-5">
      {commits.map((c) => (
        <CommitDiff key={c.sha} commit={c} />
      ))}
    </div>
  );
}

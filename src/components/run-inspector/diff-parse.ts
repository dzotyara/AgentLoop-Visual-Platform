/** Minimal unified-diff parser for `git show --stat --patch` output. */

export type DiffLineType = "add" | "del" | "ctx" | "hunk" | "meta";

export type DiffLine = { type: DiffLineType; text: string };

export type DiffFile = {
  path: string;
  oldPath: string | null;
  additions: number;
  deletions: number;
  binary: boolean;
  lines: DiffLine[];
};

export type ParsedDiff = { stat: string[]; files: DiffFile[] };

const FILE_HEADER = /^diff --(?:git a\/(.+?) b\/(.+)|cc (.+)|combined (.+))$/;

export function parseUnifiedDiff(text: string): ParsedDiff {
  const stat: string[] = [];
  const files: DiffFile[] = [];
  let cur: DiffFile | null = null;
  let inHunk = false;
  let combined = false;
  for (const line of text.split("\n")) {
    const m = FILE_HEADER.exec(line);
    if (m) {
      const newPath = m[2] ?? m[3] ?? m[4] ?? "";
      cur = {
        path: newPath,
        oldPath: m[1] && m[1] !== m[2] ? m[1] : null,
        additions: 0,
        deletions: 0,
        binary: false,
        lines: [],
      };
      files.push(cur);
      inHunk = false;
      combined = !m[1];
      continue;
    }
    if (!cur) {
      if (line.trim()) stat.push(line);
      continue;
    }
    if (line.startsWith("@@")) {
      inHunk = true;
      cur.lines.push({ type: "hunk", text: line });
      continue;
    }
    if (!inHunk) {
      if (/^Binary files /.test(line)) cur.binary = true;
      const rename = /^rename from (.+)$/.exec(line);
      if (rename) cur.oldPath = rename[1];
      if (!line.startsWith("--- ") && !line.startsWith("+++ ") && line.trim())
        cur.lines.push({ type: "meta", text: line });
      continue;
    }
    // combined diffs (merge commits) carry one marker column per parent
    const marks = combined ? line.slice(0, 2) : line.slice(0, 1);
    if (marks.includes("+")) {
      cur.additions++;
      cur.lines.push({ type: "add", text: line });
    } else if (marks.includes("-")) {
      cur.deletions++;
      cur.lines.push({ type: "del", text: line });
    } else if (line.startsWith("\\")) {
      cur.lines.push({ type: "meta", text: line });
    } else if (line.length) {
      cur.lines.push({ type: "ctx", text: line });
    }
  }
  return { stat, files };
}

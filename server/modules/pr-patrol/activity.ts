import path from "node:path";

/** Short human line for what a Claude Code tool call is doing ("Editing foo.ts", "Running pnpm vitest"). */
export function describeToolUse(name: string, input: Record<string, unknown> | undefined): string {
  const str = (k: string) => (typeof input?.[k] === "string" ? (input[k] as string) : "");
  const base = (p: string) => (p ? path.basename(p) : "");
  const clip = (s: string, n = 60) => {
    const one = s.replace(/\s+/g, " ").trim();
    return one.length > n ? `${one.slice(0, n - 1)}…` : one;
  };
  switch (name) {
    case "Bash": {
      const desc = str("description");
      if (desc) return clip(desc);
      const cmd = str("command").replace(/^cd [^&;]+(&&|;)\s*/, "");
      if (/^gh run view|^gh pr checks/.test(cmd)) return "Reading CI logs";
      if (/^git (diff|log|show)/.test(cmd)) return "Reading the diff";
      if (/^git commit/.test(cmd)) return "Committing";
      if (/^git merge/.test(cmd)) return "Merging the base branch";
      if (/(vitest|jest|pytest|go test|cargo test|npm test|pnpm test|bun test)/.test(cmd)) return "Running tests";
      if (/(tsc|typecheck|eslint|oxlint|prettier|ruff)/.test(cmd)) return "Running checks";
      return `Running ${clip(cmd, 48)}`;
    }
    case "Read":
      return `Reading ${base(str("file_path"))}`;
    case "Edit":
    case "MultiEdit":
      return `Editing ${base(str("file_path"))}`;
    case "Write":
      return str("file_path").endsWith(".json") && str("file_path").includes("pr-loop")
        ? "Writing the result"
        : `Writing ${base(str("file_path"))}`;
    case "Grep":
      return `Searching for ${clip(str("pattern"), 40)}`;
    case "Glob":
      return `Looking for ${clip(str("pattern"), 40)}`;
    case "Task":
    case "Agent":
      return `Delegating: ${clip(str("description") || str("prompt"), 48)}`;
    case "TodoWrite":
      return "Planning the work";
    case "WebFetch":
    case "WebSearch":
      return "Looking things up";
    default:
      return `Using ${name}`;
  }
}

/** Extracts activity lines from a chunk of `claude --output-format=stream-json` output (complete lines only). */
export function activityFromStreamLines(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (!line.startsWith("{")) continue;
    let evt: {
      type?: string;
      message?: { content?: Array<{ type?: string; name?: string; input?: Record<string, unknown> }> };
    };
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    if (evt.type !== "assistant") continue;
    for (const block of evt.message?.content ?? []) {
      if (block.type === "tool_use" && block.name) out.push(describeToolUse(block.name, block.input));
    }
  }
  return out;
}

/** Splits a stream into complete lines, carrying the unfinished tail between chunks. */
export function createLineSplitter(onLines: (lines: string[]) => void): (chunk: Buffer | string) => void {
  let tail = "";
  return (chunk) => {
    const text = tail + chunk.toString();
    const parts = text.split("\n");
    tail = parts.pop() ?? "";
    if (tail.length > 1_000_000) tail = ""; // a runaway line is not worth buffering
    if (parts.length) onLines(parts);
  };
}

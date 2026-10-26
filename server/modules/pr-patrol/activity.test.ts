import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { activityFromStreamLines, createLineSplitter, describeToolUse } from "./activity.ts";
import { ensureCommitPrefix } from "./workspace.ts";

describe("describeToolUse", () => {
  it("summarizes common tool calls", () => {
    expect(describeToolUse("Read", { file_path: "/a/b/foo.ts" })).toBe("Reading foo.ts");
    expect(describeToolUse("Edit", { file_path: "/a/b/foo.ts" })).toBe("Editing foo.ts");
    expect(describeToolUse("Bash", { command: "cd /x && pnpm vitest run a.test.ts" })).toBe("Running tests");
    expect(describeToolUse("Bash", { command: "gh run view 1 --log-failed" })).toBe("Reading CI logs");
    expect(describeToolUse("Bash", { command: "ls", description: "List files" })).toBe("List files");
    expect(describeToolUse("Grep", { pattern: "foo" })).toBe("Searching for foo");
  });
});

describe("activityFromStreamLines", () => {
  it("reads tool_use blocks from assistant events and ignores the rest", () => {
    const lines = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "/r/x.md" } }] },
      }),
      "not json",
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } }),
    ];
    expect(activityFromStreamLines(lines)).toEqual(["Reading x.md"]);
  });

  it("splits chunks into complete lines", () => {
    const got: string[] = [];
    const feed = createLineSplitter((l) => got.push(...l));
    feed('{"a":1}\n{"b"');
    feed(":2}\n");
    expect(got).toEqual(['{"a":1}', '{"b":2}']);
  });
});

describe("ensureCommitPrefix", () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd })
      .toString()
      .trim();

  it("rewords unprefixed commits after the start sha only", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prp-"));
    git(dir, "init", "-q");
    fs.writeFileSync(path.join(dir, "a"), "1");
    git(dir, "add", ".");
    git(dir, "commit", "-qm", "base");
    const start = git(dir, "rev-parse", "HEAD");
    fs.writeFileSync(path.join(dir, "a"), "2");
    git(dir, "commit", "-qam", "fix the thing");
    fs.writeFileSync(path.join(dir, "a"), "3");
    git(dir, "commit", "-qam", "[fix] already tagged");
    process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = "t";
    process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = "t@t";
    await ensureCommitPrefix({ path: dir, startSha: start, branch: "x" }, "[fix]");
    expect(git(dir, "log", "--format=%s").split("\n")).toEqual(["[fix] already tagged", "[fix] fix the thing", "base"]);
  });
});

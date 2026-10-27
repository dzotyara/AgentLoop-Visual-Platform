import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "./diff-parse";

const SHOW = [
  " src/a.ts | 3 ++-",
  " 1 file changed, 2 insertions(+), 1 deletion(-)",
  "",
  "diff --git a/src/a.ts b/src/a.ts",
  "index 111..222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,3 +1,4 @@",
  " const x = 1;",
  "-const y = 2;",
  "+const y = 3;",
  "+const z = 4;",
  " +not an addition, context starting with plus",
  "\\ No newline at end of file",
  "diff --git a/old.png b/new.png",
  "similarity index 100%",
  "rename from old.png",
  "rename to new.png",
  "Binary files a/old.png and b/new.png differ",
].join("\n");

describe("parseUnifiedDiff", () => {
  it("splits stat and files, counts additions and deletions", () => {
    const d = parseUnifiedDiff(SHOW);
    expect(d.stat).toEqual([" src/a.ts | 3 ++-", " 1 file changed, 2 insertions(+), 1 deletion(-)"]);
    expect(d.files).toHaveLength(2);
    const [a, png] = d.files;
    expect(a).toMatchObject({ path: "src/a.ts", oldPath: null, additions: 2, deletions: 1, binary: false });
    expect(a.lines.map((l) => l.type)).toEqual(["meta", "hunk", "ctx", "del", "add", "add", "ctx", "meta"]);
    expect(png).toMatchObject({ path: "new.png", oldPath: "old.png", binary: true, additions: 0 });
  });

  it("reads combined (merge) diffs with two marker columns", () => {
    const d = parseUnifiedDiff(
      ["diff --cc src/m.ts", "@@@ -1,2 -1,2 +1,3 @@@", "  same", "++both", " +theirs", "- ours"].join("\n"),
    );
    expect(d.files[0]).toMatchObject({ path: "src/m.ts", additions: 2, deletions: 1 });
  });

  it("handles empty input", () => {
    expect(parseUnifiedDiff("")).toEqual({ stat: [], files: [] });
  });
});

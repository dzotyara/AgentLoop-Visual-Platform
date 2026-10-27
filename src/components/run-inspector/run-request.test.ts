import { describe, expect, it } from "vitest";
import { openRunRequest, takeRunRequest } from "./run-request";
import { formatDuration, formatOffset, shortPr } from "./format";

describe("run request hand-off", () => {
  it("hands a task id over once", () => {
    expect(takeRunRequest()).toBeNull();
    openRunRequest("task-9");
    expect(takeRunRequest()).toBe("task-9");
    expect(takeRunRequest()).toBeNull();
  });
});

describe("format", () => {
  it("formats durations, offsets and PR keys", () => {
    expect(formatDuration(450)).toBe("450ms");
    expect(formatDuration(61_000)).toBe("1m 1s");
    expect(formatDuration(3_720_000)).toBe("1h 2m");
    expect(formatDuration(null)).toBe("-");
    expect(formatOffset(1000 + 83_000, 1000)).toBe("+1:23");
    expect(formatOffset(3_725_000, 0)).toBe("+1:02:05");
    expect(formatOffset(null, 0)).toBe("");
    expect(shortPr("acme/widgets#12")).toBe("widgets#12");
  });
});

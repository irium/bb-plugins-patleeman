import { describe, expect, it } from "vitest";
import { TYPE_LABELS, titleFromName } from "./shared";

describe("titleFromName", () => {
  it("makes a readable, capitalised title from a file name", () => {
    expect(titleFromName("reports/q3-usage_report.html")).toBe("Q3 usage report");
    expect(titleFromName("release notes.md")).toBe("Release notes");
    expect(titleFromName(".env")).toBe(".env");
  });
});

describe("TYPE_LABELS", () => {
  it("are words, not icon names", () => {
    for (const label of Object.values(TYPE_LABELS)) expect(label).toMatch(/^[A-Z][A-Za-z]*$/);
  });
});

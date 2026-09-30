import { describe, expect, it } from "vitest";
import { titleFromName } from "./shared";

describe("titleFromName", () => {
  it("makes a readable, capitalised title from a file name", () => {
    expect(titleFromName("reports/q3-usage_report.html")).toBe("Q3 usage report");
    expect(titleFromName("release notes.md")).toBe("Release notes");
    expect(titleFromName(".env")).toBe(".env");
  });
});

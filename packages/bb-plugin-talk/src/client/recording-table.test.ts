import { describe, expect, it } from "vitest";
import { DEFAULT_SORT, mentionPrompt, nextSort, sortRecordings, toggleSelection, transcriptBundle } from "./recording-table";

const rows = [
  { id: "a", title: "beta", createdAt: 1, durationMs: 30_000, wordCount: 5 },
  { id: "b", title: "Alpha 10", createdAt: 3, durationMs: 10_000, wordCount: 50 },
  { id: "c", title: "alpha 9", createdAt: 2, durationMs: 10_000, wordCount: 0 },
];

describe("recording table", () => {
  it("sorts newest first by default, and titles naturally", () => {
    expect(sortRecordings(rows, DEFAULT_SORT).map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(sortRecordings(rows, { key: "title", descending: false }).map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("breaks ties newest first", () => {
    expect(sortRecordings(rows, { key: "durationMs", descending: true }).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("flips the sorted column and starts others in their natural order", () => {
    expect(nextSort(DEFAULT_SORT, "createdAt")).toEqual({ key: "createdAt", descending: false });
    expect(nextSort(DEFAULT_SORT, "title")).toEqual({ key: "title", descending: false });
    expect(nextSort(DEFAULT_SORT, "wordCount")).toEqual({ key: "wordCount", descending: true });
  });

  it("toggles one row, or a range from the last one clicked", () => {
    const order = ["a", "b", "c", "d"];
    const one = toggleSelection(new Set(), order, "b", { range: false, anchor: null });
    expect([...one]).toEqual(["b"]);
    const range = toggleSelection(one, order, "d", { range: true, anchor: "b" });
    expect([...range].sort()).toEqual(["b", "c", "d"]);
    // A range click on a checked row clears the range.
    expect([...toggleSelection(range, order, "c", { range: true, anchor: "d" })]).toEqual(["b"]);
    // Without an anchor, shift-click is a plain toggle.
    expect([...toggleSelection(new Set(), order, "c", { range: true, anchor: null })]).toEqual(["c"]);
  });

  it("mentions every recording, without brackets in titles", () => {
    expect(mentionPrompt([{ id: "rec_1", title: "Sync [draft]" }, { id: "rec_2", title: "Notes" }])).toBe(
      "[Sync draft](/plugins/talk/recordings/rec_1) [Notes](/plugins/talk/recordings/rec_2) ",
    );
  });

  it("bundles transcripts under their titles", () => {
    const text = transcriptBundle(
      [
        { title: "One", createdAt: 0, durationMs: 65_000, transcript: "Hello.\n\nAgain." },
        { title: "Two", createdAt: 0, durationMs: 0, transcript: " " },
      ],
      () => "Sep 28",
    );
    expect(text).toBe("# One\n\nSep 28 · 1 min\n\nHello.\n\nAgain.\n\n# Two\n\nSep 28 · 0 sec\n\n(No transcript yet.)");
  });
});

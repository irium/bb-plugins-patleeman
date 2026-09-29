import { describe, expect, it } from "vitest";
import { addPending, parsePending, withoutPending } from "./pending-inserts";

describe("pending inserts", () => {
  it("appends a second dictation for the same thread", () => {
    const one = addPending({}, "thr_a", " First thought. ");
    expect(addPending(one, "thr_a", "Second thought.")).toEqual({ thr_a: "First thought. Second thought." });
  });

  it("keeps other threads when one is delivered", () => {
    const pending = addPending(addPending({}, "thr_a", "A"), "thr_b", "B");
    expect(withoutPending(pending, "thr_a")).toEqual({ thr_b: "B" });
  });

  it("drops malformed storage", () => {
    expect(parsePending("not json")).toEqual({});
    expect(parsePending("[1]")).toEqual({});
    expect(parsePending(JSON.stringify({ thr_a: "text", thr_b: 3, thr_c: " " }))).toEqual({ thr_a: "text" });
  });
});

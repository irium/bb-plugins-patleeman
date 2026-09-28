import { describe, expect, it } from "vitest";
import { LevelTracker, pickMimeType, rmsOf, segmentPolicy, shouldCut } from "./segmenter";

describe("segmenter", () => {
  it("cuts at a pause after the target, or at the hard maximum", () => {
    const policy = segmentPolicy(25);
    expect(shouldCut(policy, 20_000, 2_000)).toBe(false);
    expect(shouldCut(policy, 26_000, 100)).toBe(false);
    expect(shouldCut(policy, 26_000, 400)).toBe(true);
    expect(shouldCut(policy, 40_000, 0)).toBe(true);
  });

  it("clamps the segment length", () => {
    expect(segmentPolicy(1).targetMs).toBe(8_000);
    expect(segmentPolicy(600).targetMs).toBe(60_000);
    expect(segmentPolicy(Number.NaN).targetMs).toBe(25_000);
  });

  it("counts quiet time against an adaptive noise floor", () => {
    const tracker = new LevelTracker();
    for (let i = 0; i < 50; i++) tracker.push(0.01, 100);
    // Steady room noise becomes the floor, so it reads as quiet.
    expect(tracker.push(0.01, 100).quietForMs).toBeGreaterThan(0);
    expect(tracker.push(0.2, 100).quietForMs).toBe(0);
    expect(tracker.level).toBeGreaterThan(0.5);
    tracker.push(0.005, 200);
    expect(tracker.push(0.005, 200).quietForMs).toBe(400);
  });

  it("measures RMS and picks a supported container", () => {
    expect(rmsOf(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5);
    expect(pickMimeType((type) => type === "audio/mp4")).toBe("audio/mp4");
    expect(pickMimeType(() => false)).toBe("");
  });
});

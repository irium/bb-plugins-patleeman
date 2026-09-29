// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { INSERT_EVENT, clearStatus, fieldAt, insertIntoField, parseField, publishStatus } from "./fields";

afterEach(() => {
  document.body.innerHTML = "";
  clearStatus();
});

function field(key: string, label?: string): HTMLElement {
  const element = document.createElement("div");
  element.setAttribute("data-talk-field", key);
  if (label) element.setAttribute("data-talk-field-label", label);
  element.innerHTML = "<p><span>text</span></p>";
  document.body.append(element);
  return element;
}

describe("dictation fields", () => {
  it("rejects empty keys and fills in a missing label", () => {
    expect(parseField({ key: "", label: "x" })).toBeNull();
    expect(parseField(null)).toBeNull();
    expect(parseField({ key: "pages:pg_1" })).toEqual({ key: "pages:pg_1", label: "that field" });
  });

  it("finds the field around a nested node", () => {
    const element = field("pages:pg_1", "“Launch plan”");
    const text = element.querySelector("span")!.firstChild;
    expect(fieldAt(text)).toEqual({ element, field: { key: "pages:pg_1", label: "“Launch plan”" } });
    expect(fieldAt(document.body)).toBeNull();
  });

  it("delivers only when the owner takes the text", () => {
    const element = field("pages:pg_1");
    expect(insertIntoField("pages:pg_1", "Hello")).toBe(false);
    const received: string[] = [];
    element.addEventListener(INSERT_EVENT, (event) => {
      received.push((event as CustomEvent<{ text: string }>).detail.text);
      event.preventDefault();
    });
    expect(insertIntoField("pages:pg_1", "Hello")).toBe(true);
    expect(insertIntoField("pages:pg_2", "Elsewhere")).toBe(false);
    expect(received).toEqual(["Hello"]);
  });

  it("mirrors state onto the root element", () => {
    publishStatus("dictating", "pages:pg_1", "recording");
    expect(document.documentElement.dataset).toMatchObject({ bbTalk: "dictating", bbTalkField: "pages:pg_1", bbTalkPhase: "recording" });
    publishStatus("idle", null, "idle");
    expect(document.documentElement.dataset.bbTalkField).toBeUndefined();
  });
});

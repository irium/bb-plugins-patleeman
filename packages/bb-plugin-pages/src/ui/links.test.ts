import { describe, expect, it } from "vitest";
import { linkEmbed } from "./links";

const ORIGIN = "http://127.0.0.1:38886";

describe("linkEmbed", () => {
  it("makes a bookmark of a web link", () => {
    expect(linkEmbed("  https://example.com/post?id=1 \n", ORIGIN)).toEqual({ kind: "bookmark", target: "https://example.com/post?id=1" });
  });

  it("makes page and thread cards of BB links", () => {
    expect(linkEmbed(`${ORIGIN}/plugins/pages/pages/pg_0123456789ab`, ORIGIN)).toEqual({ kind: "page", target: "pg_0123456789ab" });
    expect(linkEmbed(`${ORIGIN}/projects/proj_a/threads/thr_abc123`, ORIGIN)).toEqual({ kind: "thread", target: "thr_abc123" });
  });

  it("leaves text, other schemes and several links alone", () => {
    expect(linkEmbed("see https://example.com", ORIGIN)).toBeNull();
    expect(linkEmbed("https://a.com https://b.com", ORIGIN)).toBeNull();
    expect(linkEmbed("mailto:me@example.com", ORIGIN)).toBeNull();
    expect(linkEmbed("example.com", ORIGIN)).toBeNull();
  });
});

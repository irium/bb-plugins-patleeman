import test from "node:test";
import assert from "node:assert/strict";
import { tokenExpiry } from "../datadog-token";

const jwt = (payload: object) => `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;

test("a ddtool token is refreshed a minute before its expiry", () => {
  assert.equal(tokenExpiry(jwt({ exp: 2_000_000 })), 2_000_000_000 - 60_000);
});

test("a token without a readable expiry is reused for five minutes", () => {
  assert.equal(tokenExpiry("opaque", 1000), 1000 + 5 * 60_000);
  assert.equal(tokenExpiry(jwt({ sub: "x" }), 1000), 1000 + 5 * 60_000);
});

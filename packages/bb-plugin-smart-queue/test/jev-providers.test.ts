import test from "node:test";
import assert from "node:assert/strict";
import { jevRoutes } from "../jev-providers";

const names = (settings: Parameters<typeof jevRoutes>[0], env = {}) =>
  jevRoutes(settings, env).routes.map((route) => route.name);

test("auto tries TypeSafe first, then every other provider with a key", () => {
  assert.deepEqual(
    names({ zenApiKey: "z", openRouterApiKey: "o", typesafeApiKey: "t", vercelApiKey: "v" }),
    ["TypeSafe", "Vercel AI Gateway", "OpenRouter", "OpenCode Zen"],
  );
  assert.deepEqual(names({}), []);
});

test("keys fall back to each provider's standard environment variable", () => {
  assert.deepEqual(names({}, { TYPESAFE_API_KEY: "t", OPENCODE_API_KEY: "z" }), ["TypeSafe", "OpenCode Zen"]);
  assert.deepEqual(names({}, { AI_GATEWAY_API_KEY: "v", OPENROUTER_API_KEY: "o" }), ["Vercel AI Gateway", "OpenRouter"]);
});

test("a pinned provider uses only that provider and reports a missing key", () => {
  const pinned = jevRoutes({ jevProvider: "typesafe", zenApiKey: "z" }, {});
  assert.deepEqual(pinned.routes, []);
  assert.match(pinned.problems[0]!, /TypeSafe has no API key/);
  assert.deepEqual(names({ jevProvider: "opencode-zen", typesafeApiKey: "t", zenApiKey: "z" }), ["OpenCode Zen"]);
});

test("the TypeSafe model can follow previews or pin a version", () => {
  assert.equal(jevRoutes({ typesafeApiKey: "t" }, {}).routes[0]!.model, "jev-latest");
  assert.equal(jevRoutes({ typesafeApiKey: "t", typesafeModel: "jev-1.13.0" }, {}).routes[0]!.model, "jev-1.13.0");
});

test("a custom endpoint joins auto after the presets", () => {
  const { routes } = jevRoutes(
    { zenApiKey: "z", customJevEndpoint: "https://gw.example.com/v1/systemone", customJevModel: "jev", customJevApiKey: "c" },
    {},
  );
  assert.deepEqual(routes.map((route) => route.name), ["OpenCode Zen", "Custom (gw.example.com)"]);
  assert.equal(routes[1]!.apiKey, "c");
});

test("custom endpoints must be HTTPS, keep keys out of the URL, and name a model", () => {
  const problem = (settings: Parameters<typeof jevRoutes>[0]) => jevRoutes({ jevProvider: "custom", ...settings }, {}).problems[0];
  assert.match(problem({ customJevEndpoint: "http://gw.example.com/x", customJevModel: "m" })!, /HTTPS/);
  assert.match(problem({ customJevEndpoint: "https://u:p@gw.example.com/x", customJevModel: "m" })!, /not in the URL/);
  assert.match(problem({ customJevEndpoint: "https://gw.example.com/x" })!, /endpoint URL and a model/);
  assert.match(problem({ customJevEndpoint: "not a url", customJevModel: "m" })!, /not a valid URL/);
  assert.equal(problem({ customJevEndpoint: "http://127.0.0.1:9000/systemone", customJevModel: "m" }), undefined);
});

test("a broken custom provider never blocks the presets in auto", () => {
  const result = jevRoutes({ typesafeApiKey: "t", customJevEndpoint: "http://gw.example.com", customJevModel: "m" }, {});
  assert.deepEqual(result.routes.map((route) => route.name), ["TypeSafe"]);
  assert.equal(result.problems.length, 1);
});

test("Datadog AI Gateway is opt-in for auto and sends the gateway's headers", () => {
  assert.deepEqual(names({}), []);
  const [route] = jevRoutes({ datadogAiGateway: true }, {}).routes;
  assert.equal(route!.name, "Datadog AI Gateway");
  assert.equal(route!.endpoint, "https://ai-gateway.us1.prod.dog/v1/systemone");
  assert.equal(route!.model, "typesafe/jev-latest");
  assert.equal(route!.apiKey, null);
  assert.equal(route!.ddtoolDatacenter, "us1.prod.dog");
  assert.deepEqual(route!.headers, { source: "bb-smart-queue", "org-id": "2" });
  assert.deepEqual(names({ jevProvider: "datadog" }), ["Datadog AI Gateway"]);
  assert.deepEqual(names({ datadogAiGateway: true, zenApiKey: "z" }), ["OpenCode Zen", "Datadog AI Gateway"]);
});

test("the Datadog datacenter must be a Datadog host", () => {
  const staging = jevRoutes({ jevProvider: "datadog", datadogDatacenter: "us1.staging.dog" }, {});
  assert.equal(staging.routes[0]!.endpoint, "https://ai-gateway.us1.staging.dog/v1/systemone");
  const bad = jevRoutes({ jevProvider: "datadog", datadogDatacenter: "evil.example.com/x" }, {});
  assert.deepEqual(bad.routes, []);
  assert.match(bad.problems[0]!, /not a Datadog datacenter/);
});

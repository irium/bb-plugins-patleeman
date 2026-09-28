import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

/**
 * Datadog AI Gateway takes a short-lived internal service token from
 * `ddtool`, not a stored key. BB's server may start with a minimal PATH, so
 * the usual install locations are searched too.
 */
const ddtoolDirs = ["/opt/homebrew/bin", "/usr/local/bin", join(homedir(), "go", "bin"), join(homedir(), ".local", "bin")];
/** Refresh this long before the token's own expiry. */
const refreshMarginMs = 60_000;
/** Used when the token carries no readable expiry. */
const fallbackLifetimeMs = 5 * 60_000;

type Cached = { token: string; expiresAt: number };
const cache = new Map<string, Cached>();
const pending = new Map<string, Promise<string>>();

/** Reads `exp` from a JWT without verifying it; the gateway does that. */
export function tokenExpiry(token: string, now = Date.now()): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    if (typeof payload.exp === "number") return payload.exp * 1000 - refreshMarginMs;
  } catch {
    // Not a JWT; fall through.
  }
  return now + fallbackLifetimeMs;
}

function runDdtool(datacenter: string, timeoutMs: number): Promise<string> {
  const PATH = [process.env.PATH, ...ddtoolDirs].filter(Boolean).join(delimiter);
  return new Promise((resolve, reject) => {
    execFile(
      "ddtool",
      ["auth", "token", "rapid-ai-platform", "--datacenter", datacenter],
      { env: { ...process.env, PATH }, timeout: timeoutMs, maxBuffer: 64 * 1024 },
      (error, stdout) => {
        const token = stdout.trim();
        if (error || !token || /\s/.test(token)) {
          const reason =
            (error as NodeJS.ErrnoException | null)?.code === "ENOENT"
              ? "ddtool is not installed"
              : "ddtool could not get a token; run `ddtool auth login` and try again";
          reject(new Error(`Datadog AI Gateway: ${reason}.`));
          return;
        }
        resolve(token);
      },
    );
  });
}

/** A cached token for the datacenter, fetched once at a time when missing or stale. */
export async function datadogToken(datacenter: string, timeoutMs = 15_000): Promise<string> {
  const cached = cache.get(datacenter);
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  let request = pending.get(datacenter);
  if (!request) {
    request = runDdtool(datacenter, timeoutMs)
      .then((token) => {
        cache.set(datacenter, { token, expiresAt: tokenExpiry(token) });
        return token;
      })
      .finally(() => pending.delete(datacenter));
    pending.set(datacenter, request);
  }
  return request;
}

/** Drops a token the gateway rejected, so the next call fetches a new one. */
export function forgetDatadogToken(datacenter: string) {
  cache.delete(datacenter);
}

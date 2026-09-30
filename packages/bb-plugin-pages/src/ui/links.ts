// Pasting a lone link on an empty line turns it into an embed card: a page or
// thread card for a BB link, a bookmark for anything else on the web.
import type { EmbedKind } from "../schema-config";

const PAGE_PATH = /^\/plugins\/pages\/pages\/(pg_[a-f0-9]{12})(?:\/|$)/;
const THREAD_PATH = /(?:^|\/)threads\/(thr_[a-z0-9]+)(?:\/|$)/;

export function linkEmbed(text: string, origin: string): { kind: EmbedKind; target: string } | null {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.origin === origin) {
    const page = PAGE_PATH.exec(url.pathname);
    if (page) return { kind: "page", target: page[1]! };
    const thread = THREAD_PATH.exec(url.pathname);
    if (thread) return { kind: "thread", target: thread[1]! };
  }
  return { kind: "bookmark", target: url.toString() };
}

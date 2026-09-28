const channelPath =
  /^\/plugins\/(?:bot-teams|bots)\/channels\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})(?:\/message\/([^/]+))?\/?$/iu;
const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
const threadPath =
  /^\/(?:projects\/proj_[^/]+\/)?threads\/(thr_[^/]+)\/?$/iu;

export function channelMessageReference(
  roomId: string,
  name: string,
  messageId: string,
) {
  const label = `Message in #${name}`
    .replace(/[\\[\]<>*_`]/gu, "\\$&")
    .replace(/[\r\n]/gu, " ");
  return `[${label}](/plugins/bot-teams/channels/${encodeURIComponent(roomId)}/message/${encodeURIComponent(messageId)})`;
}

/**
 * The channels panel subpath for a message. toPluginPanel encodes subpath
 * segments itself, so the message ID must stay raw. Pre-encoding it turns ':'
 * into '%253A', and the split-view route never decodes that back.
 */
export function channelMessageSubPath(roomId: string, messageId: string) {
  return `${roomId}/message/${messageId}`;
}

/**
 * Reads the message ID back from a channels panel subpath. Routed panels get
 * the subpath decoded once and split views get it still encoded, so decode
 * exactly once here; raw IDs never contain '%'.
 */
export function channelMessageIdFromSubPath(subPath: string) {
  const parts = subPath.split("/");
  if (parts[1] !== "message") return undefined;
  try {
    return decodeURIComponent(parts.slice(2, subPath.endsWith("/reply") ? -1 : undefined).join("/"));
  } catch {
    return undefined;
  }
}

export function channelLinkDestination(
  href: string,
  currentOrigin: string,
  knownChannelIds: ReadonlySet<string>,
) {
  if (!/^\/(?!\/)|^https?:\/\//iu.test(href)) return null;
  try {
    const url = new URL(href, currentOrigin);
    if (url.username || url.password || url.search || url.hash) return null;
    const match = channelPath.exec(url.pathname);
    if (!match) return null;
    const id = match[1]!.toLowerCase();
    // The old ID also belongs to an unrelated community plugin. Only adopt
    // links whose channel identity is present in this installation.
    if (/^\/plugins\/bots\//iu.test(url.pathname) && !knownChannelIds.has(id))
      return null;
    if (
      url.origin !== currentOrigin &&
      !(
        (loopback.has(url.hostname) ||
          url.hostname === new URL(currentOrigin).hostname) &&
        knownChannelIds.has(id)
      )
    )
      return null;
    if (!match[2]) return id;
    const messageId = decodeURIComponent(match[2]);
    if (!messageId || /[\u0000-\u001f\u007f]/u.test(messageId)) return null;
    return channelMessageSubPath(id, messageId);
  } catch {
    return null;
  }
}

/** A BB thread link copied on another local client still belongs in this app. */
export function channelThreadLinkDestination(href: string, currentOrigin: string) {
  if (!/^\/(?!\/)|^https?:\/\//iu.test(href)) return null;
  try {
    const url = new URL(href, currentOrigin);
    if (url.username || url.password || url.search || url.hash) return null;
    if (
      url.origin !== currentOrigin &&
      !loopback.has(url.hostname) &&
      url.hostname !== new URL(currentOrigin).hostname
    )
      return null;
    const match = threadPath.exec(url.pathname);
    if (!match) return null;
    const threadId = decodeURIComponent(match[1]!);
    if (!/^thr_[a-z0-9_-]+$/iu.test(threadId)) return null;
    return threadId;
  } catch {
    return null;
  }
}

/** Absolute filesystem paths in bot messages are host files, not web routes. */
export function channelFileLinkDestination(href: string) {
  if (!href.startsWith("/") || href.startsWith("//") || /[?#]/u.test(href))
    return null;
  try {
    const path = decodeURIComponent(href);
    if (
      !/^\/(?:[^/]+\/)+[^/]+\.[a-z0-9]{1,12}$/iu.test(path) ||
      /[\u0000-\u001f\u007f]/u.test(path) ||
      path.split("/").includes("..") ||
      /^(?:\/threads\/|\/projects\/|\/plugins\/|\/api\/)/iu.test(path)
    )
      return null;
    return path;
  } catch {
    return null;
  }
}

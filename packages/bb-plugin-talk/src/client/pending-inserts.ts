// Dictations finished away from their thread. BB keeps each thread's unsent
// composer text on the device and restores it when the thread opens, and
// writing the server draft of an open composer replaces what is typed. So
// Talk holds the text here and types it into the thread's composer the next
// time that composer is on screen.

export const PENDING_STORAGE_KEY = "bb-plugin-talk:pending-inserts";

export type PendingInserts = Record<string, string>;

/** Adds `text` for a thread, after anything already waiting there. */
export function addPending(pending: PendingInserts, threadId: string, text: string): PendingInserts {
  const before = pending[threadId]?.trim();
  return { ...pending, [threadId]: before ? `${before} ${text.trim()}` : text.trim() };
}

export function withoutPending(pending: PendingInserts, threadId: string): PendingInserts {
  const { [threadId]: _removed, ...rest } = pending;
  return rest;
}

export function parsePending(raw: string | null): PendingInserts {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim() !== "",
      ),
    );
  } catch {
    return {};
  }
}

export function readPending(): PendingInserts {
  try {
    return parsePending(localStorage.getItem(PENDING_STORAGE_KEY));
  } catch {
    return {};
  }
}

export function writePending(pending: PendingInserts): void {
  try {
    if (Object.keys(pending).length === 0) localStorage.removeItem(PENDING_STORAGE_KEY);
    else localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(pending));
  } catch {
    // Private mode: the dictation is still in Talk recordings.
  }
}

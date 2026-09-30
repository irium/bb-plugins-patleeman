// Formatting shared by every Studio surface, so dates and counts read the
// same everywhere.

export function relativeTime(at: number, now = Date.now()): string {
  const seconds = Math.round((now - at) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "Sep 30, 3:04 PM" */
export function shortDateTime(at: number): string {
  return new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function plural(count: number, noun: string, many = `${noun}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? noun : many}`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const untitled = (title: string) => title.trim() || "Untitled";

// Pure logic behind the Recordings table: sorting, checkbox selection, and
// the text its bulk actions produce.
import { formatLength, recordingHref } from "../shared/format";

export type SortKey = "createdAt" | "title" | "durationMs" | "wordCount";

export interface Sort {
  key: SortKey;
  descending: boolean;
}

export const DEFAULT_SORT: Sort = { key: "createdAt", descending: true };

interface Sortable {
  title: string;
  createdAt: number;
  durationMs: number;
  wordCount: number;
}

export function sortRecordings<T extends Sortable>(list: readonly T[], sort: Sort): T[] {
  const direction = sort.descending ? -1 : 1;
  return [...list].sort((a, b) => {
    const order =
      sort.key === "title"
        ? a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true })
        : a[sort.key] - b[sort.key];
    // Newest first breaks ties, whatever the sort.
    return order * direction || b.createdAt - a.createdAt;
  });
}

/** Clicking a header sorts by it; clicking the sorted header flips it. */
export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key === key) return { key, descending: !current.descending };
  // Text reads best A to Z; numbers and dates biggest or newest first.
  return { key, descending: key !== "title" };
}

/**
 * Toggles one row. With `range`, every row from the last one clicked
 * (`anchor`) through this one takes this row's new state, as in a file list.
 */
export function toggleSelection(
  selected: ReadonlySet<string>,
  orderedIds: readonly string[],
  id: string,
  options: { range: boolean; anchor: string | null },
): Set<string> {
  const next = new Set(selected);
  const checked = !selected.has(id);
  const from = options.anchor === null ? -1 : orderedIds.indexOf(options.anchor);
  const to = orderedIds.indexOf(id);
  const ids = options.range && from !== -1 && to !== -1
    ? orderedIds.slice(Math.min(from, to), Math.max(from, to) + 1)
    : [id];
  for (const each of ids) {
    if (checked) next.add(each);
    else next.delete(each);
  }
  return next;
}

/** A composer prompt that @-mentions each recording. */
export function mentionPrompt(recordings: readonly { id: string; title: string }[]): string {
  return `${recordings.map((r) => `[${r.title.replace(/[[\]]/g, "")}](${recordingHref(r.id)})`).join(" ")} `;
}

/** Several transcripts as one Markdown document, each under its title. */
export function transcriptBundle(
  items: readonly { title: string; createdAt: number; durationMs: number; transcript: string }[],
  formatDate: (ms: number) => string,
): string {
  return items
    .map((item) =>
      [
        `# ${item.title}`,
        `${formatDate(item.createdAt)} · ${formatLength(item.durationMs)}`,
        item.transcript.trim() || "(No transcript yet.)",
      ].join("\n\n"),
    )
    .join("\n\n");
}

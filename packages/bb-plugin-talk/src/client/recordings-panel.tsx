// The Recordings page: /plugins/talk/recordings lists every recording, and
// /plugins/talk/recordings/<id> is one recording's durable home — the link
// target for mentions and the CLI.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import {
  useBbNavigate,
  useRealtime,
  useRpc,
  type PluginNavPanelProps,
} from "@get-bb/plugin-sdk/app";
import type { Recording, Segment, TalkRpcContract } from "../shared/contract";
import {
  PANEL_PATH,
  TALK_ICON,
  RECORDING_CHANGED,
  formatClock,
  formatLength,
  joinTranscript,
} from "../shared/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { talk, useTalkState } from "./controller";
import {
  DEFAULT_SORT,
  mentionPrompt,
  nextSort,
  sortRecordings,
  toggleSelection,
  transcriptBundle,
  type Sort,
  type SortKey,
} from "./recording-table";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function useChangedSignal(onChange: (id: string) => void): void {
  useRealtime(RECORDING_CHANGED, (payload) => {
    const id = (payload as { id?: unknown } | null)?.id;
    if (typeof id === "string") onChange(id);
  });
}

function when(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function StatusBadge({ recording, live }: { recording: Recording; live: boolean }) {
  let label: string | null = null;
  let tone = "bg-muted text-muted-foreground";
  if (live || recording.status === "recording") {
    label = "Recording";
    tone = "bg-red-500/15 text-red-600 dark:text-red-400";
  } else if (recording.status === "paused") label = "Paused";
  else if (recording.status === "interrupted") {
    label = "Interrupted";
    tone = "bg-amber-500/15 text-amber-700 dark:text-amber-400";
  } else if (recording.pendingCount > 0) label = "Transcribing";
  else if (recording.failedCount > 0) {
    label = `${recording.failedCount} failed`;
    tone = "bg-destructive/15 text-destructive";
  }
  if (!label) return null;
  return <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", tone)}>{label}</span>;
}

function PanelFrame({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="h-full overflow-y-auto">
      <div
        className={cn(
          "mx-auto flex w-full flex-col gap-4 px-4 py-6 pb-[calc(env(safe-area-inset-bottom)+24px)] sm:px-6",
          wide ? "max-w-5xl" : "max-w-3xl",
        )}
      >
        {children}
      </div>
    </div>
  );
}

// ── List ─────────────────────────────────────────────────────────────────
type KindFilter = "all" | Recording["kind"];

const KIND_FILTERS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "recording", label: "Recordings" },
  { value: "dictation", label: "Dictations" },
];

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Copies text that is still being fetched. Handing the clipboard a promise
 * keeps the click's permission in Safari, which drops it after an await.
 */
function copyLater(text: Promise<string>): Promise<void> {
  if (typeof ClipboardItem === "undefined") return text.then((value) => navigator.clipboard.writeText(value));
  return navigator.clipboard.write([
    new ClipboardItem({ "text/plain": text.then((value) => new Blob([value], { type: "text/plain" })) }),
  ]);
}

function SortHeader({
  label,
  column,
  sort,
  onSort,
  className,
}: {
  label: string;
  column: SortKey;
  sort: Sort;
  onSort: (column: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === column;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.descending ? "descending" : "ascending") : "none"}
      className={cn("px-3 py-2 font-medium", className)}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn("inline-flex cursor-pointer items-center gap-1 hover:text-foreground", active && "text-foreground")}
      >
        {label}
        {active ? <Icon name={sort.descending ? "ArrowDown" : "ArrowUp"} className="size-3" /> : null}
      </button>
    </th>
  );
}

function RecordingList() {
  const rpc = useRpc<TalkRpcContract>();
  const navigate = useBbNavigate();
  const state = useTalkState();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const [recordings, setRecordings] = useState<Recording[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [working, setWorking] = useState(false);
  const refetch = useCallback(() => {
    const q = query.trim();
    rpc.call("recordings_list", { ...(q ? { query: q } : {}), limit: 200 }).then(
      (result) => {
        setRecordings(result.recordings);
        setError(null);
      },
      (cause) => setError(message(cause)),
    );
  }, [rpc, query]);
  useEffect(() => {
    const timer = setTimeout(refetch, query ? 200 : 0);
    return () => clearTimeout(timer);
  }, [refetch, query]);
  // A bulk delete sends one change per recording; refetch once for the lot.
  const changeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(changeTimer.current), []);
  useChangedSignal(() => {
    clearTimeout(changeTimer.current);
    changeTimer.current = setTimeout(refetch, 150);
  });

  // The recording Talk is capturing can't be picked: it is still changing,
  // and deleting it would pull it out from under the recorder.
  const liveId = state.phase !== "idle" ? state.recordingId : null;
  const rows = useMemo(
    () => sortRecordings((recordings ?? []).filter((r) => kind === "all" || r.kind === kind), sort),
    [recordings, kind, sort],
  );
  const selectableIds = useMemo(() => rows.filter((r) => r.id !== liveId).map((r) => r.id), [rows, liveId]);
  const chosen = useMemo(() => rows.filter((r) => selected.has(r.id) && r.id !== liveId), [rows, selected, liveId]);
  // Forget picks that were deleted, filtered out, or went live.
  useEffect(() => {
    setSelected((previous) => {
      const visible = new Set(selectableIds);
      const next = new Set([...previous].filter((id) => visible.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [selectableIds]);
  useEffect(() => setConfirmDelete(false), [selected]);

  const allChecked = chosen.length > 0 && chosen.length === selectableIds.length;
  const toggle = (id: string, range: boolean) => {
    setSelected((previous) => toggleSelection(previous, selectableIds, id, { range, anchor: anchor.current }));
    anchor.current = id;
  };
  const clear = () => setSelected(new Set());
  const failed = chosen.reduce((sum, r) => sum + r.failedCount, 0);

  const bulk = (action: () => Promise<unknown>) => {
    setWorking(true);
    void action()
      .catch((cause: unknown) => toast.error(message(cause)))
      .finally(() => setWorking(false));
  };
  const copyTranscripts = () =>
    bulk(async () => {
      const picked = chosen;
      await copyLater(
        Promise.all(picked.map((r) => rpc.call("recording_get", { id: r.id }))).then((results) =>
          transcriptBundle(
            results.map(({ recording, segments }) => ({ ...recording, transcript: joinTranscript(segments) })),
            when,
          ),
        ),
      );
      toast.success(picked.length === 1 ? "Transcript copied" : `Copied ${picked.length} transcripts`);
    });
  const retryFailed = () =>
    bulk(async () => {
      await Promise.all(chosen.filter((r) => r.failedCount > 0).map((r) => rpc.call("recording_retry", { id: r.id })));
      toast.success(`Retrying ${plural(failed, "piece")}`);
    });
  const deleteChosen = () =>
    bulk(async () => {
      const results = await Promise.allSettled(chosen.map((r) => rpc.call("recording_delete", { id: r.id })));
      const failures = results.filter((result) => result.status === "rejected");
      const deleted = results.length - failures.length;
      if (deleted > 0) toast.success(`Deleted ${plural(deleted, "recording")}`);
      if (failures.length > 0) {
        toast.error(`Couldn't delete ${plural(failures.length, "recording")}: ${message(failures[0]!.reason)}`);
      }
      clear();
    });

  return (
    <PanelFrame wide>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-xl font-semibold">Recordings</h1>
        <Button
          size="sm"
          disabled={state.phase !== "idle"}
          onClick={() => void talk.startRecording("recording")}
        >
          <Icon name="Mic" />
          New recording
        </Button>
      </div>
      <Input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search titles and transcripts"
        aria-label="Search recordings"
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {recordings === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : recordings.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
          {query.trim()
            ? "No recordings match."
            : "No recordings yet. Start one here, or press the composer's microphone to dictate."}
        </div>
      ) : (
        <div className="flex flex-col">
          <div
            role="toolbar"
            aria-label={chosen.length > 0 ? "Selected recordings" : "Filter recordings"}
            className="sticky top-0 z-10 -mx-1 flex min-h-11 flex-wrap items-center gap-2 bg-background px-1 py-1.5"
          >
            {chosen.length > 0 ? (
              <>
                <span className="mr-1 text-sm font-medium">{chosen.length} selected</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={working}
                  onClick={() => navigate.toCompose({ initialPrompt: mentionPrompt(chosen), focusPrompt: true })}
                >
                  <Icon name="MessageSquarePlus" /> New thread
                </Button>
                <Button size="sm" variant="outline" disabled={working} onClick={copyTranscripts}>
                  <Icon name="Copy" /> Copy transcripts
                </Button>
                {failed > 0 ? (
                  <Button size="sm" variant="outline" disabled={working} onClick={retryFailed}>
                    <Icon name="RotateCcw" /> Retry {failed} failed
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant={confirmDelete ? "destructive" : "outline"}
                  disabled={working}
                  onBlur={() => setConfirmDelete(false)}
                  onClick={() => (confirmDelete ? deleteChosen() : setConfirmDelete(true))}
                >
                  <Icon name="Trash2" /> {confirmDelete ? `Delete ${chosen.length} for good` : "Delete"}
                </Button>
                <Button size="sm" variant="ghost" className="ml-auto" onClick={clear}>
                  Clear
                </Button>
              </>
            ) : (
              <>
                <div className="inline-flex rounded-md border border-border p-0.5">
                  {KIND_FILTERS.map((filter) => (
                    <button
                      key={filter.value}
                      type="button"
                      aria-pressed={kind === filter.value}
                      onClick={() => setKind(filter.value)}
                      className={cn(
                        "cursor-pointer rounded px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground",
                        kind === filter.value && "bg-state-hover text-foreground",
                      )}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
                <span className="ml-auto text-xs text-muted-foreground">{plural(rows.length, "item")}</span>
              </>
            )}
          </div>
          {rows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
              {kind === "dictation" ? "No dictations here." : "No recordings here."}
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full table-fixed border-collapse text-sm">
                <thead className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="w-10 py-2 pl-3">
                      <Checkbox
                        aria-label={allChecked ? "Deselect all" : "Select all"}
                        disabled={selectableIds.length === 0}
                        checked={allChecked ? true : chosen.length > 0 ? "indeterminate" : false}
                        onCheckedChange={() => setSelected(allChecked ? new Set() : new Set(selectableIds))}
                        className="flex"
                      />
                    </th>
                    <SortHeader label="Title" column="title" sort={sort} onSort={(key) => setSort(nextSort(sort, key))} />
                    <SortHeader
                      label="Date"
                      column="createdAt"
                      sort={sort}
                      onSort={(key) => setSort(nextSort(sort, key))}
                      className="w-36 max-sm:hidden"
                    />
                    <SortHeader
                      label="Length"
                      column="durationMs"
                      sort={sort}
                      onSort={(key) => setSort(nextSort(sort, key))}
                      className="w-24 max-sm:hidden"
                    />
                    <SortHeader
                      label="Words"
                      column="wordCount"
                      sort={sort}
                      onSort={(key) => setSort(nextSort(sort, key))}
                      className="w-24 max-sm:hidden"
                    />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((recording) => {
                    const live = recording.id === liveId;
                    const checked = selected.has(recording.id) && !live;
                    const open = () => navigate.toPluginPanel(PANEL_PATH, { subPath: recording.id });
                    return (
                      <tr
                        key={recording.id}
                        data-state={checked ? "selected" : undefined}
                        onClick={open}
                        className="cursor-pointer align-top hover:bg-state-hover data-[state=selected]:bg-state-hover"
                      >
                        {/* The whole cell toggles, so the target is easy to hit. */}
                        <td
                          className="select-none py-3 pl-3"
                          onClick={(event) => {
                            event.stopPropagation();
                            if (!live) toggle(recording.id, event.shiftKey);
                          }}
                        >
                          <Checkbox
                            aria-label={`Select ${recording.title}`}
                            checked={checked}
                            disabled={live}
                            title={live ? "Talk is recording this" : undefined}
                            className="mt-0.5 flex"
                          />
                        </td>
                        <td className="min-w-0 px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <Icon
                              name={recording.kind === "dictation" ? "Mic" : TALK_ICON}
                              className="size-4 shrink-0 text-muted-foreground"
                            />
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                open();
                              }}
                              className="min-w-0 cursor-pointer truncate text-left font-medium focus-visible:underline focus-visible:outline-none"
                            >
                              {recording.title}
                            </button>
                            <StatusBadge recording={recording} live={live && state.phase === "recording"} />
                          </div>
                          <div className="mt-0.5 text-xs text-muted-foreground sm:hidden">
                            {when(recording.createdAt)} · {formatLength(recording.durationMs)} · {recording.wordCount} words
                          </div>
                          {recording.preview ? (
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">{recording.preview}</p>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground max-sm:hidden">
                          {when(recording.createdAt)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-muted-foreground max-sm:hidden">
                          {formatLength(recording.durationMs)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-muted-foreground max-sm:hidden">
                          {recording.wordCount.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </PanelFrame>
  );
}

// ── Detail ───────────────────────────────────────────────────────────────
function useRecording(id: string) {
  const rpc = useRpc<TalkRpcContract>();
  const [data, setData] = useState<{ recording: Recording; segments: Segment[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refetch = useCallback(() => {
    rpc.call("recording_get", { id }).then(
      (result) => {
        setData(result);
        setError(null);
      },
      (cause) => setError(message(cause)),
    );
  }, [rpc, id]);
  useEffect(() => {
    setData(null);
    refetch();
  }, [refetch]);
  useChangedSignal((changed) => {
    if (changed === id) refetch();
  });
  return { rpc, data, error, refetch };
}

/** Plays segment files back to back, starting from any one of them. */
function usePlayer(recordingId: string, segments: readonly Segment[]) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const order = useRef(segments);
  order.current = segments;

  const stop = useCallback(() => {
    audio.current?.pause();
    audio.current = null;
    setPlaying(null);
  }, []);

  const play = useCallback(
    (segmentId: string) => {
      audio.current?.pause();
      const element = new Audio(
        `/api/v1/plugins/talk/http/audio?recording=${encodeURIComponent(recordingId)}&segment=${encodeURIComponent(segmentId)}`,
      );
      audio.current = element;
      setPlaying(segmentId);
      element.addEventListener("ended", () => {
        if (audio.current !== element) return;
        const list = order.current;
        const next = list[list.findIndex((segment) => segment.id === segmentId) + 1];
        if (next) play(next.id);
        else stop();
      });
      element.play().catch((error: unknown) => {
        if (audio.current === element) stop();
        toast.error(`Could not play audio: ${message(error)}`);
      });
    },
    [recordingId, stop],
  );

  useEffect(() => stop, [stop, recordingId]);
  return { playing, play, stop };
}

interface Paragraph {
  sessionId: string;
  offsetMs: number;
  segments: Segment[];
}

function paragraphs(segments: readonly Segment[]): Paragraph[] {
  const out: Paragraph[] = [];
  for (const segment of segments) {
    const last = out.at(-1);
    if (last && last.sessionId === segment.sessionId) last.segments.push(segment);
    else out.push({ sessionId: segment.sessionId, offsetMs: segment.offsetMs, segments: [segment] });
  }
  return out;
}

function TitleEditor({ recording, onRename }: { recording: Recording; onRename: (title: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(recording.title);
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(recording.title);
          setEditing(true);
        }}
        title="Rename"
        className="group flex min-w-0 cursor-text items-center gap-2 text-left"
      >
        <h1 className="min-w-0 break-words text-xl font-semibold">{recording.title}</h1>
        <Icon name="Edit" className="size-4 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 max-sm:opacity-60" />
      </button>
    );
  }
  const save = () => {
    const title = draft.trim();
    setEditing(false);
    if (title && title !== recording.title) void onRename(title);
  };
  return (
    <Input
      autoFocus
      value={draft}
      maxLength={160}
      aria-label="Recording title"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === "Enter") save();
        if (event.key === "Escape") setEditing(false);
      }}
      className="text-lg font-semibold"
    />
  );
}

function RecordingDetail({ id }: { id: string }) {
  const { rpc, data, error, refetch } = useRecording(id);
  const navigate = useBbNavigate();
  const state = useTalkState();
  const segments = data?.segments ?? [];
  const player = usePlayer(id, segments);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const transcript = useMemo(() => joinTranscript(segments), [segments]);
  const groups = useMemo(() => paragraphs(segments), [segments]);
  // Tells the recording pill this page is where the recording lives.
  useEffect(() => {
    talk.setViewing(id);
    return () => talk.setViewing(null);
  }, [id]);
  // The recording went away while open: deleted elsewhere, or discarded
  // because it finished without a word.
  const gone = Boolean(data && error && /No recording/.test(error));
  const wasEmpty = data?.recording.wordCount === 0;
  const leaving = useRef(false);
  useEffect(() => {
    if (!gone || leaving.current) return;
    leaving.current = true;
    toast.info(wasEmpty ? "Talk heard nothing, so it didn't keep this recording." : "This recording was deleted.");
    navigate.toPluginPanel(PANEL_PATH, { replace: true });
  }, [gone, wasEmpty, navigate]);

  const back = () => navigate.toPluginPanel(PANEL_PATH);
  if (error && !data) {
    return (
      <PanelFrame>
        <Button variant="ghost" size="sm" className="self-start" onClick={back}>
          <Icon name="ArrowLeft" /> Recordings
        </Button>
        <p className="text-sm text-destructive">{error}</p>
      </PanelFrame>
    );
  }
  if (!data) {
    return (
      <PanelFrame>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </PanelFrame>
    );
  }
  const { recording } = data;
  const activeHere = state.recordingId === id && state.phase !== "idle";
  const run = (work: () => Promise<unknown>) => {
    void work().then(refetch, (cause) => toast.error(message(cause)));
  };

  return (
    <PanelFrame>
      <Button variant="ghost" size="sm" className="-ml-2 self-start" onClick={back}>
        <Icon name="ArrowLeft" /> Recordings
      </Button>
      <div className="flex flex-col gap-1">
        <TitleEditor
          recording={recording}
          onRename={async (title) => {
            try {
              await rpc.call("recording_rename", { id, title });
              refetch();
            } catch (cause) {
              toast.error(message(cause));
            }
          }}
        />
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{when(recording.createdAt)}</span>
          <span>·</span>
          <span>{formatLength(recording.durationMs)}</span>
          <span>·</span>
          <span>{recording.wordCount} words</span>
          <StatusBadge recording={recording} live={activeHere && state.phase === "recording"} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {activeHere ? (
          <>
            {state.phase === "recording" ? (
              <Button size="sm" variant="outline" onClick={() => void talk.pause()}>
                <Icon name="Pause" /> Pause
              </Button>
            ) : null}
            {state.phase === "paused" || state.phase === "needs-resume" ? (
              <Button size="sm" variant="outline" onClick={() => void talk.resume()}>
                <Icon name="Mic" /> Resume
              </Button>
            ) : null}
            {state.phase === "recording" || state.phase === "paused" || state.phase === "needs-resume" ? (
              <Button size="sm" variant="destructive" onClick={() => void talk.stop(false)}>
                <Icon name="Square" /> Stop
              </Button>
            ) : null}
          </>
        ) : recording.status !== "finishing" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={state.phase !== "idle"}
            onClick={() => void talk.continueRecording(recording)}
          >
            <Icon name="Mic" /> {recording.status === "interrupted" ? "Resume recording" : "Record more"}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          disabled={transcript === ""}
          onClick={() =>
            void navigator.clipboard.writeText(transcript).then(
              () => toast.success("Transcript copied"),
              (cause: unknown) => toast.error(message(cause)),
            )
          }
        >
          <Icon name="Copy" /> Copy
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            navigate.toCompose({
              initialPrompt: mentionPrompt([recording]),
              focusPrompt: true,
            })
          }
        >
          <Icon name="MessageSquarePlus" /> New thread
        </Button>
        {recording.failedCount > 0 ? (
          <Button size="sm" variant="outline" onClick={() => run(() => rpc.call("recording_retry", { id }))}>
            <Icon name="RotateCcw" /> Retry {recording.failedCount} failed
          </Button>
        ) : null}
        <Button
          size="sm"
          variant={confirmDelete ? "destructive" : "ghost"}
          className="ml-auto"
          disabled={activeHere}
          onBlur={() => setConfirmDelete(false)}
          onClick={() => {
            if (!confirmDelete) {
              setConfirmDelete(true);
              return;
            }
            player.stop();
            void rpc.call("recording_delete", { id }).then(back, (cause) => toast.error(message(cause)));
          }}
        >
          <Icon name="Trash2" /> {confirmDelete ? "Delete for good" : "Delete"}
        </Button>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
          {activeHere ? "Text appears here as each piece is transcribed." : "This recording has no audio."}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <section key={group.sessionId} className="flex gap-3">
              <button
                type="button"
                onClick={() => player.play(group.segments[0]!.id)}
                className="mt-0.5 h-6 shrink-0 cursor-pointer rounded px-1 font-mono text-xs tabular-nums text-muted-foreground hover:bg-state-hover hover:text-foreground"
                title="Play from here"
              >
                {formatClock(group.offsetMs)}
              </button>
              <p className="min-w-0 flex-1 text-[15px] leading-relaxed">
                {group.segments.map((segment) => (
                  <SegmentText
                    key={segment.id}
                    segment={segment}
                    playing={player.playing === segment.id}
                    onPlay={() => (player.playing === segment.id ? player.stop() : player.play(segment.id))}
                  />
                ))}
              </p>
            </section>
          ))}
        </div>
      )}
    </PanelFrame>
  );
}

function SegmentText({ segment, playing, onPlay }: { segment: Segment; playing: boolean; onPlay: () => void }) {
  const at = formatClock(segment.offsetMs);
  if (segment.status === "empty") return null;
  if (segment.status === "pending") {
    return (
      <span className="mr-1 inline-flex items-center gap-1 text-sm text-muted-foreground" title={`${at} — transcribing`}>
        <Icon name="Loading" className="size-3.5 animate-spin motion-reduce:animate-none" />
        {segment.attempts > 0 ? "retrying…" : "…"}
      </span>
    );
  }
  if (segment.status === "failed") {
    return (
      <button
        type="button"
        onClick={onPlay}
        title={segment.error ?? "Transcription failed"}
        className="mr-1 cursor-pointer rounded bg-destructive/10 px-1 text-sm text-destructive"
      >
        [{at} not transcribed]
      </button>
    );
  }
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={onPlay}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onPlay();
        }
      }}
      title={`${at} — play`}
      className={cn(
        "cursor-pointer rounded-sm hover:bg-state-hover",
        playing && "bg-primary/15 hover:bg-primary/20",
      )}
    >
      {segment.text}{" "}
    </span>
  );
}

export function RecordingsPanel({ subPath }: PluginNavPanelProps) {
  const id = subPath.split("/")[0] ?? "";
  return /^rec_[a-z0-9]{8,32}$/.test(id) ? <RecordingDetail id={id} /> : <RecordingList />;
}

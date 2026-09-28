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
  recordingHref,
} from "../shared/format";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { talk, useTalkState } from "./controller";

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

function PanelFrame({ children }: { children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 pb-[calc(env(safe-area-inset-bottom)+24px)] sm:px-6">
        {children}
      </div>
    </div>
  );
}

// ── List ─────────────────────────────────────────────────────────────────
function RecordingList() {
  const rpc = useRpc<TalkRpcContract>();
  const navigate = useBbNavigate();
  const state = useTalkState();
  const [query, setQuery] = useState("");
  const [recordings, setRecordings] = useState<Recording[] | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  useChangedSignal(refetch);

  return (
    <PanelFrame>
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
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {recordings.map((recording) => (
            <li key={recording.id}>
              <button
                type="button"
                onClick={() => navigate.toPluginPanel(PANEL_PATH, { subPath: recording.id })}
                className="flex w-full cursor-pointer flex-col gap-1 px-4 py-3 text-left hover:bg-state-hover"
              >
                <div className="flex items-center gap-2">
                  <Icon
                    name={recording.kind === "dictation" ? "Mic" : TALK_ICON}
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">{recording.title}</span>
                  <StatusBadge recording={recording} live={state.recordingId === recording.id && state.phase === "recording"} />
                </div>
                <div className="text-xs text-muted-foreground">
                  {when(recording.createdAt)} · {formatLength(recording.durationMs)} · {recording.wordCount} words
                </div>
                {recording.preview ? (
                  <p className="line-clamp-2 text-sm text-muted-foreground">{recording.preview}</p>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
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
              initialPrompt: `[${recording.title.replace(/[[\]]/g, "")}](${recordingHref(id)}) `,
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

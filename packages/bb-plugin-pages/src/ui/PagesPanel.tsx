import { useBbContext, useBbNavigate, useRealtime, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { REALTIME_CHANNEL, type RealtimeEvent } from "../constants";
import type { BotView, PageMetaView, RequestView, rpcContract } from "../contract";
import { PageConnection } from "./connection";
import { PagesUiContext, type PagesUi } from "./context";
import { AskBotDialog, HistoryDialog, KeepUpdatedDialog } from "./dialogs";
import { PageEditor, type SidePanel } from "./PageEditor";
import { pageFieldKey, toggleTalk, useTalk, type TalkView } from "./talk";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;
type Project = { id: string; name: string };

const PROJECT_KEY = "bb-pages:project";
const PAGE_ICONS = ["📄", "📝", "📋", "✅", "📊", "📈", "🗺️", "🧭", "💡", "🚀", "🧪", "🛠️", "📚", "🗓️", "🎯", "🔥", "⭐", "🧠", "🤖", "📣"];

export function relativeTime(at: number): string {
  const seconds = Math.round((Date.now() - at) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function actorName(key: string, bots: BotView[]): string {
  if (key === "user") return "you";
  if (key.startsWith("bot:")) return bots.find((bot) => bot.id === key.slice(4))?.name ?? "a bot";
  if (key.startsWith("agent:")) return "an agent";
  if (key === "cli") return "the CLI";
  return key;
}

function useProjects(): Project[] {
  const sdk = useSdk();
  const [projects, setProjects] = useState<Project[]>([]);
  useEffect(() => {
    sdk.projects
      .list()
      .then((list) => setProjects((list as { id: string; name: string }[]).map(({ id, name }) => ({ id, name }))))
      .catch(() => setProjects([]));
  }, [sdk]);
  return projects;
}

function usePagesData(rpc: Rpc, projectId: string | null) {
  const [pages, setPages] = useState<PageMetaView[] | null>(null);
  const [bots, setBots] = useState<{ available: boolean; reason: string | null; bots: BotView[] }>({
    available: false,
    reason: null,
    bots: [],
  });
  const [error, setError] = useState<string | null>(null);
  const refetch = useCallback(() => {
    rpc.call("tree", { projectId }).then(
      (result) => {
        setPages(result.pages);
        setError(null);
      },
      (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }, [rpc, projectId]);
  const refetchBots = useCallback(() => {
    rpc.call("bots", null).then(setBots, () => {});
  }, [rpc]);
  useEffect(() => {
    refetch();
  }, [refetch]);
  // Polls so the panel notices Bot Teams being installed, enabled or edited;
  // a hidden tab waits until it's shown again.
  useEffect(() => {
    const poll = () => {
      if (document.visibilityState === "visible") refetchBots();
    };
    poll();
    const timer = setInterval(poll, 30_000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [refetchBots]);
  return { pages, bots, error, refetch, setPages };
}

export function PagesPanel({ subPath }: { subPath: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const context = useBbContext();
  const projects = useProjects();
  const [projectId, setProjectId] = useState<string | null>(
    () => context.projectId ?? localStorage.getItem(PROJECT_KEY) ?? null,
  );
  const pageId = subPath.split("/")[0] || null;
  const { pages, bots, error, refetch } = usePagesData(rpc, projectId);

  useEffect(() => {
    if (!projectId && projects.length) setProjectId(projects[0]!.id);
  }, [projectId, projects]);
  useEffect(() => {
    if (projectId) localStorage.setItem(PROJECT_KEY, projectId);
  }, [projectId]);

  // Opening a page from another project switches the tree to that project.
  const [pageMeta, setPageMeta] = useState<PageMetaView | null | undefined>(undefined);
  const fetchPage = useCallback(() => {
    if (!pageId) {
      setPageMeta(undefined);
      return;
    }
    rpc.call("get", { id: pageId }).then(
      (result) => setPageMeta(result.page),
      () => setPageMeta(null),
    );
  }, [rpc, pageId]);
  useEffect(() => {
    fetchPage();
  }, [fetchPage]);
  useEffect(() => {
    if (pageMeta?.projectId && pageMeta.projectId !== projectId) setProjectId(pageMeta.projectId);
  }, [pageMeta?.projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const [requestsVersion, setRequestsVersion] = useState(0);
  useRealtime(REALTIME_CHANNEL, (payload) => {
    const event = payload as RealtimeEvent;
    if (event.type === "tree" || event.type === "deleted" || event.type === "page") refetch();
    if ((event.type === "page" && event.pageId === pageId) || event.type === "tree") fetchPage();
    if (event.type === "deleted" && pageId && event.pageIds.includes(pageId)) {
      navigate.toPluginPanel("pages", { subPath: "", replace: true });
    }
    if (event.type === "requests" && event.pageId === pageId) setRequestsVersion((version) => version + 1);
  });

  const openPage = useCallback((id: string) => navigate.toPluginPanel("pages", { subPath: id }), [navigate]);
  const ui = useMemo<PagesUi>(
    () => ({
      pages: pages ?? [],
      bots: bots.bots,
      openPage,
      openThread: (threadId) => navigate.toThread(threadId),
      openUrl: (url) => {
        if (!navigate.openUrl(url)) window.open(url, "_blank", "noopener");
      },
    }),
    [pages, bots.bots, openPage, navigate],
  );

  const createPage = async (parentId: string | null, global = false) => {
    const result = await rpc.call("create", { projectId: global ? null : projectId, parentId, title: "" });
    refetch();
    openPage(result.page.id);
  };

  return (
    <PagesUiContext.Provider value={ui}>
      <div className="pages-root flex h-full min-h-0 bg-background text-foreground">
        <Sidebar
          className={cn(pageId && "max-md:hidden")}
          pages={pages}
          error={error}
          projects={projects}
          projectId={projectId}
          onProject={setProjectId}
          activeId={pageId}
          onOpen={openPage}
          onCreate={createPage}
          rpc={rpc}
          onChanged={refetch}
        />
        <main className={cn("flex min-w-0 flex-1 flex-col", !pageId && "max-md:hidden")}>
          {pageId && pageMeta ? (
            <PageView
              key={pageId}
              page={pageMeta}
              pages={pages ?? []}
              bots={bots}
              rpc={rpc}
              requestsVersion={requestsVersion}
              onDeleted={() => navigate.toPluginPanel("pages", { subPath: "", replace: true })}
              onBack={() => navigate.toPluginPanel("pages", { subPath: "" })}
            />
          ) : pageId && pageMeta === null ? (
            <EmptyState
              title="Page not found"
              body="It may have been deleted."
              action={
                <Button size="sm" variant="outline" className="md:hidden" onClick={() => navigate.toPluginPanel("pages", { subPath: "" })}>
                  All pages
                </Button>
              }
            />
          ) : pageId ? null : (
            <EmptyState
              title="Pages"
              body="Documents you write with your agents. Mention a bot to hand it a task, or let one keep a page up to date."
              action={
                <Button size="sm" onClick={() => void createPage(null)}>
                  <Icon name="Plus" /> New page
                </Button>
              }
            />
          )}
        </main>
      </div>
    </PagesUiContext.Provider>
  );
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <Icon name="FileText" className="size-8 text-muted-foreground" />
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}

// Sidebar ---------------------------------------------------------------------

function Sidebar({
  className,
  pages,
  error,
  projects,
  projectId,
  onProject,
  activeId,
  onOpen,
  onCreate,
  rpc,
  onChanged,
}: {
  className?: string;
  pages: PageMetaView[] | null;
  error: string | null;
  projects: Project[];
  projectId: string | null;
  onProject(id: string | null): void;
  activeId: string | null;
  onOpen(id: string): void;
  onCreate(parentId: string | null, global?: boolean): Promise<void>;
  rpc: Rpc;
  onChanged(): void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [showArchived, setShowArchived] = useState(false);
  const live = (pages ?? []).filter((page) => !page.archived);
  const archived = (pages ?? []).filter((page) => page.archived);
  const project = projects.find((candidate) => candidate.id === projectId);

  // Keep the active page's ancestors open.
  useEffect(() => {
    if (!activeId || !pages) return;
    const byId = new Map(pages.map((page) => [page.id, page]));
    let parent = byId.get(activeId)?.parentId;
    const open: string[] = [];
    while (parent) {
      open.push(parent);
      parent = byId.get(parent)?.parentId ?? null;
    }
    if (open.length) setExpanded((current) => new Set([...current, ...open]));
  }, [activeId, pages]);

  const section = (label: string, scope: PageMetaView[], global: boolean) => {
    const ids = new Set(scope.map((page) => page.id));
    const roots = scope.filter((page) => !page.parentId || !ids.has(page.parentId));
    return (
      <div className="mb-3">
        <div className="group/section flex h-7 items-center justify-between px-2 text-xs font-medium text-muted-foreground">
          <span className="truncate">{label}</span>
          <button
            type="button"
            title={`New ${global ? "global " : ""}page`}
            className="pages-reveal rounded p-0.5 opacity-0 group-hover/section:opacity-100 hover:bg-state-hover hover:text-foreground"
            onClick={() => void onCreate(null, global)}
          >
            <Icon name="Plus" className="size-3.5" />
          </button>
        </div>
        {roots.length ? (
          roots.map((page) => (
            <TreeRow
              key={page.id}
              page={page}
              all={scope}
              depth={0}
              activeId={activeId}
              expanded={expanded}
              onToggle={(id) =>
                setExpanded((current) => {
                  const next = new Set(current);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
              onOpen={onOpen}
              onCreate={async (parentId) => {
                setExpanded((current) => new Set([...current, parentId]));
                await onCreate(parentId);
              }}
              rpc={rpc}
              onChanged={onChanged}
            />
          ))
        ) : (
          <div className="px-2 py-1 text-xs text-muted-foreground/70">No pages</div>
        )}
      </div>
    );
  };

  return (
    <nav className={cn("pages-sidebar flex w-64 shrink-0 flex-col border-r border-border bg-sidebar/40 max-md:w-full max-md:border-r-0", className)}>
      <div className="flex h-12 items-center gap-1 border-b border-border px-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm font-medium hover:bg-state-hover">
              <Icon name="Folder" className="size-4 text-muted-foreground" />
              <span className="truncate">{project?.name ?? "Global only"}</span>
              <Icon name="ArrowUpDown" className="ml-auto size-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-auto">
            <DropdownMenuLabel>Project</DropdownMenuLabel>
            {projects.map((candidate) => (
              <DropdownMenuItem key={candidate.id} onSelect={() => onProject(candidate.id)}>
                {candidate.name}
                {candidate.id === projectId ? <Icon name="Check" className="ml-auto size-3.5" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          title="New page"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-state-hover hover:text-foreground"
          onClick={() => void onCreate(null)}
        >
          <Icon name="Edit" className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1.5 py-2 text-sm">
        {error ? <p className="px-2 text-xs text-red-500">{error}</p> : null}
        {pages === null && !error ? <p className="px-2 text-xs text-muted-foreground">Loading…</p> : null}
        {pages !== null ? (
          <>
            {projectId ? section(project?.name ?? "Project", live.filter((page) => page.projectId), false) : null}
            {section("Global", live.filter((page) => !page.projectId), true)}
            {archived.length ? (
              <div>
                <button
                  type="button"
                  className="flex h-7 w-full items-center gap-1 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                  onClick={() => setShowArchived((value) => !value)}
                >
                  <Icon name={showArchived ? "ChevronDown" : "ChevronRight"} className="size-3" /> Archived ({archived.length})
                </button>
                {showArchived
                  ? archived.map((page) => (
                      <button
                        key={page.id}
                        type="button"
                        className={cn(
                          "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-muted-foreground hover:bg-state-hover",
                          page.id === activeId && "bg-state-active text-foreground",
                        )}
                        onClick={() => onOpen(page.id)}
                      >
                        <span className="w-4 text-center">{page.icon || "📄"}</span>
                        <span className="truncate">{page.title || "Untitled"}</span>
                      </button>
                    ))
                  : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </nav>
  );
}

function TreeRow({
  page,
  all,
  depth,
  activeId,
  expanded,
  onToggle,
  onOpen,
  onCreate,
  rpc,
  onChanged,
}: {
  page: PageMetaView;
  all: PageMetaView[];
  depth: number;
  activeId: string | null;
  expanded: Set<string>;
  onToggle(id: string): void;
  onOpen(id: string): void;
  onCreate(parentId: string): Promise<void>;
  rpc: Rpc;
  onChanged(): void;
}) {
  const children = all.filter((candidate) => candidate.parentId === page.id);
  const open = expanded.has(page.id);
  const active = page.id === activeId;
  return (
    <>
      <div
        className={cn(
          "group/row flex h-7 cursor-pointer items-center gap-1 rounded-md pr-1 hover:bg-state-hover max-md:h-10",
          active && "bg-state-active text-foreground",
        )}
        style={{ paddingLeft: 4 + depth * 14 }}
        onClick={() => onOpen(page.id)}
      >
        <button
          type="button"
          aria-label={`${open ? "Collapse" : "Expand"} ${page.title || "Untitled"}`}
          aria-expanded={open}
          className={cn("flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-state-hover", !children.length && "invisible")}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(page.id);
          }}
        >
          <Icon name={open ? "ChevronDown" : "ChevronRight"} className="size-3" />
        </button>
        <span className="w-4 shrink-0 text-center text-sm leading-none">{page.icon || "📄"}</span>
        <span className={cn("min-w-0 flex-1 truncate", !page.title && "text-muted-foreground")}>{page.title || "Untitled"}</span>
        {page.refresh ? <Icon name="Repeat" className="size-3 shrink-0 text-muted-foreground" aria-label="Kept updated" /> : null}
        <button
          type="button"
          title="Add a page inside"
          className="pages-reveal rounded p-0.5 text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:text-foreground"
          onClick={(event) => {
            event.stopPropagation();
            void onCreate(page.id);
          }}
        >
          <Icon name="Plus" className="size-3.5" />
        </button>
        <PageMenu page={page} rpc={rpc} onChanged={onChanged} compact />
      </div>
      {open
        ? children.map((child) => (
            <TreeRow
              key={child.id}
              page={child}
              all={all}
              depth={depth + 1}
              activeId={activeId}
              expanded={expanded}
              onToggle={onToggle}
              onOpen={onOpen}
              onCreate={onCreate}
              rpc={rpc}
              onChanged={onChanged}
            />
          ))
        : null}
    </>
  );
}

function PageMenu({
  page,
  rpc,
  onChanged,
  onDeleted,
  compact,
  extra,
}: {
  page: PageMetaView;
  rpc: Rpc;
  onChanged(): void;
  onDeleted?(): void;
  compact?: boolean;
  extra?: React.ReactNode;
}) {
  const context = useBbContext();
  const update = async (patch: { parentId?: string | null; projectId?: string | null; archived?: boolean }) => {
    await rpc.call("update", { id: page.id, ...patch });
    onChanged();
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Page actions"
          className={cn(
            "rounded p-0.5 text-muted-foreground hover:text-foreground",
            compact ? "pages-reveal opacity-0 group-hover/row:opacity-100 data-[state=open]:opacity-100" : "p-1.5 hover:bg-state-hover",
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <Icon name="MoreHorizontal" className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52" onClick={(event) => event.stopPropagation()}>
        {extra}
        {page.parentId ? <DropdownMenuItem onSelect={() => void update({ parentId: null })}>Move to top level</DropdownMenuItem> : null}
        {page.projectId ? (
          <DropdownMenuItem onSelect={() => void update({ projectId: null, parentId: null })}>Make global</DropdownMenuItem>
        ) : context.projectId ? (
          <DropdownMenuItem onSelect={() => void update({ projectId: context.projectId, parentId: null })}>Move to this project</DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => void update({ archived: !page.archived })}>{page.archived ? "Restore from archive" : "Archive"}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:bg-destructive/15 focus:text-destructive"
          onSelect={() => {
            if (!window.confirm(`Delete "${page.title || "Untitled"}" and every page inside it? This can't be undone.`)) return;
            void rpc.call("remove", { id: page.id }).then(() => {
              onChanged();
              onDeleted?.();
            });
          }}
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Page view -------------------------------------------------------------------

function useConnection(pageId: string) {
  const [connection, setConnection] = useState<PageConnection | null>(null);
  useEffect(() => {
    const next = new PageConnection(pageId);
    setConnection(next);
    return () => next.destroy();
  }, [pageId]);
  const status = useSyncExternalStore(
    useCallback((listener) => connection?.subscribe(listener) ?? (() => {}), [connection]),
    () => (connection ? `${connection.status}:${connection.synced}` : "connecting:false"),
  );
  const [state, synced] = status.split(":");
  return { connection, status: state as PageConnection["status"], synced: synced === "true" };
}

type Presence = { clientId: number; name: string; color: string; agent: boolean };

function usePresence(connection: PageConnection | null): Presence[] {
  const [presence, setPresence] = useState<Presence[]>([]);
  useEffect(() => {
    if (!connection) return;
    const read = () => {
      const seen = new Map<string, Presence>();
      for (const [clientId, state] of connection.awareness.getStates()) {
        if (clientId === connection.doc.clientID) continue;
        const user = (state as { user?: { name?: string; color?: string; agent?: boolean } }).user;
        if (!user?.name) continue;
        const key = `${user.name}:${user.agent ? 1 : 0}`;
        if (!seen.has(key)) seen.set(key, { clientId, name: user.name, color: user.color ?? "#888", agent: Boolean(user.agent) });
      }
      setPresence([...seen.values()]);
    };
    read();
    connection.awareness.on("change", read);
    return () => connection.awareness.off("change", read);
  }, [connection]);
  return presence;
}

/** A title that wraps onto more lines instead of scrolling sideways. */
function TitleField(props: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "className" | "rows">) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = useCallback(() => {
    const field = ref.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }, []);
  useEffect(fit, [fit, props.value]);
  useEffect(() => {
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [fit]);
  return (
    <textarea
      ref={ref}
      rows={1}
      placeholder="Untitled"
      className="block w-full resize-none overflow-hidden bg-transparent text-4xl leading-tight font-bold tracking-tight outline-none placeholder:text-muted-foreground/50 max-md:text-3xl"
      {...props}
    />
  );
}

const TALK_WORKING_PHASES = new Set(["starting", "finalizing", "transcribing"]);

function DictateButton({ talk, ready, onToggle }: { talk: TalkView; ready: boolean; onToggle(): void }) {
  if (talk.mode === "unavailable") return null;
  if (talk.mode === "here") {
    const working = TALK_WORKING_PHASES.has(talk.phase);
    return (
      <Button variant="ghost" size="sm" aria-pressed onClick={onToggle} disabled={working}>
        <Icon name={working ? "Mic" : "Square"} className={working ? "animate-pulse" : "text-red-500"} />
        <span className="max-md:sr-only">{talk.phase === "starting" ? "Starting…" : working ? "Transcribing…" : "Stop dictation"}</span>
      </Button>
    );
  }
  const busy = talk.mode === "elsewhere";
  return (
    <span title={busy ? "Talk is busy with another recording." : "Dictate into this page with Talk"}>
      <Button variant="ghost" size="sm" onClick={onToggle} disabled={busy || !ready} aria-label="Dictate">
        <Icon name="Mic" /> <span className="max-md:sr-only">Dictate</span>
      </Button>
    </span>
  );
}

function PageView({
  page,
  pages,
  bots,
  rpc,
  requestsVersion,
  onDeleted,
  onBack,
}: {
  page: PageMetaView;
  pages: PageMetaView[];
  bots: { available: boolean; reason: string | null; bots: BotView[] };
  rpc: Rpc;
  requestsVersion: number;
  onDeleted(): void;
  onBack(): void;
}) {
  const { connection, status, synced } = useConnection(page.id);
  const presence = usePresence(connection);
  const talk = useTalk(pageFieldKey(page.id));
  const [sidePanel, setSidePanel] = useState<SidePanel>(null);
  const [dialog, setDialog] = useState<"ask" | "refresh" | "history" | null>(null);
  const [requests, setRequests] = useState<RequestView[]>([]);
  const [title, setTitle] = useState(page.title);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editingTitle = useRef(false);

  useEffect(() => {
    if (!editingTitle.current) setTitle(page.title);
  }, [page.title]);

  useEffect(() => {
    rpc.call("requests", { pageId: page.id }).then((result) => setRequests(result.requests), () => {});
  }, [rpc, page.id, requestsVersion]);

  const saveTitle = (next: string) => {
    setTitle(next);
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => void rpc.call("update", { id: page.id, title: next.trim() }), 400);
  };

  const refreshBot = page.refresh ? bots.bots.find((bot) => bot.id === page.refresh!.botId) : undefined;
  const active = requests.filter((request) => request.status === "queued" || request.status === "working");

  return (
    // Positioned so the narrow-screen comments sheet stays inside the panel.
    <div className="relative flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4 text-sm max-md:gap-1 max-md:px-1.5">
        <button
          type="button"
          aria-label="All pages"
          className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground md:hidden"
          onClick={onBack}
        >
          <Icon name="ChevronLeft" className="size-5" />
        </button>
        <Breadcrumbs page={{ ...page, title }} pages={pages} />
        <div className="ml-auto flex shrink-0 items-center gap-1 max-md:gap-0">
          <PresenceStack presence={presence} />
          <ConnectionBadge status={status} />
          <span className="hidden px-2 text-xs text-muted-foreground md:inline">
            Edited {relativeTime(page.updatedAt)} by {actorName(page.updatedBy, bots.bots)}
          </span>
          <span title={bots.reason ?? undefined}>
            <Button variant="ghost" size="sm" onClick={() => setDialog("ask")} disabled={!bots.available} aria-label="Ask a bot">
              <Icon name="Bot" /> <span className="max-md:sr-only">Ask a bot</span>
            </Button>
          </span>
          <DictateButton talk={talk} ready={Boolean(connection && synced)} onToggle={() => toggleTalk(pageFieldKey(page.id))} />
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={sidePanel === "comments"}
            aria-label="Comments"
            onClick={() => setSidePanel((panel) => (panel === "comments" ? null : "comments"))}
          >
            <Icon name="MessageSquare" /> <span className="max-md:sr-only">Comments</span>
          </Button>
          <PageMenu
            page={page}
            rpc={rpc}
            onChanged={() => {}}
            onDeleted={onDeleted}
            extra={
              <>
                <DropdownMenuItem onSelect={() => setDialog("refresh")}>
                  <Icon name="Repeat" className="size-4" /> Keep updated…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDialog("history")}>
                  <Icon name="RotateCcw" className="size-4" /> Version history…
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    void rpc.call("markdown", { id: page.id }).then((result) => navigator.clipboard.writeText(result.markdown))
                  }
                >
                  <Icon name="Copy" className="size-4" /> Copy as Markdown
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            }
          />
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className={cn("mx-auto w-full px-6 pt-10 pb-32 max-md:px-0 max-md:pt-5", sidePanel ? "max-w-6xl" : "max-w-4xl")}>
          <div className="px-[54px] max-md:px-4">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="mb-2 rounded-md text-5xl leading-none hover:bg-state-hover" title="Change icon">
                  {page.icon || <span className="text-sm text-muted-foreground">Add icon</span>}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64 p-2">
                <div className="grid grid-cols-8 gap-1">
                  {PAGE_ICONS.map((icon) => (
                    <button
                      key={icon}
                      type="button"
                      className="rounded p-1 text-lg hover:bg-state-hover"
                      onClick={() => void rpc.call("update", { id: page.id, icon })}
                    >
                      {icon}
                    </button>
                  ))}
                </div>
                {page.icon ? (
                  <DropdownMenuItem className="mt-1" onSelect={() => void rpc.call("update", { id: page.id, icon: "" })}>
                    Remove icon
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
            <TitleField
              value={title}
              onFocus={() => (editingTitle.current = true)}
              onBlur={() => (editingTitle.current = false)}
              onChange={(event) => saveTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  (document.querySelector(".pages-editor .bn-editor") as HTMLElement | null)?.focus();
                }
              }}
            />
            <PageStrip
              page={page}
              refreshBot={refreshBot}
              requests={requests}
              active={active}
              onConfigure={() => setDialog("refresh")}
              onRefresh={() => void rpc.call("refreshNow", { id: page.id }).catch((error: unknown) => window.alert(String(error)))}
            />
          </div>
          {page.archived ? (
            <div className="mx-[54px] mt-4 rounded-md max-md:mx-4 border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
              This page is archived.
            </div>
          ) : null}
          <div className="mt-6 flex">
            {connection && synced ? (
              <PageEditor
                connection={connection}
                page={page}
                bots={bots.bots}
                pages={pages}
                sidePanel={sidePanel}
                onCloseSidePanel={() => setSidePanel(null)}
              />
            ) : status === "missing" ? (
              <p className="px-[54px] text-sm text-muted-foreground max-md:px-4">This page no longer exists.</p>
            ) : (
              <p className="px-[54px] text-sm text-muted-foreground max-md:px-4">Connecting…</p>
            )}
          </div>
        </div>
      </div>
      <AskBotDialog open={dialog === "ask"} onClose={() => setDialog(null)} page={page} bots={bots.bots} rpc={rpc} />
      <KeepUpdatedDialog open={dialog === "refresh"} onClose={() => setDialog(null)} page={page} bots={bots} rpc={rpc} />
      <HistoryDialog open={dialog === "history"} onClose={() => setDialog(null)} page={page} bots={bots.bots} rpc={rpc} />
    </div>
  );
}

function Breadcrumbs({ page, pages }: { page: PageMetaView; pages: PageMetaView[] }) {
  const navigate = useBbNavigate();
  const trail: PageMetaView[] = [];
  let parent = page.parentId;
  while (parent && trail.length < 6) {
    const found = pages.find((candidate) => candidate.id === parent);
    if (!found) break;
    trail.unshift(found);
    parent = found.parentId;
  }
  return (
    <div className="flex min-w-0 items-center gap-1 text-muted-foreground">
      {trail.map((crumb) => (
        <span key={crumb.id} className="flex min-w-0 items-center gap-1 max-md:hidden">
          <button type="button" className="truncate hover:text-foreground" onClick={() => navigate.toPluginPanel("pages", { subPath: crumb.id })}>
            {crumb.icon} {crumb.title || "Untitled"}
          </button>
          <span>/</span>
        </span>
      ))}
      <span className="truncate text-foreground">
        {page.icon} {page.title || "Untitled"}
      </span>
      {!page.projectId ? <span className="rounded bg-foreground/6 px-1.5 text-xs max-md:hidden">Global</span> : null}
    </div>
  );
}

function PresenceStack({ presence }: { presence: Presence[] }) {
  if (!presence.length) return null;
  return (
    <div className="flex items-center -space-x-1.5 px-1">
      {presence.slice(0, 5).map((user) => (
        <span
          key={user.clientId}
          title={`${user.name} ${user.agent ? "is editing" : "is here"}`}
          className={cn(
            "flex size-6 items-center justify-center rounded-full border-2 border-background text-[10px] font-semibold text-white",
            user.agent && "animate-pulse",
          )}
          style={{ background: user.color }}
        >
          {[...user.name][0]?.toUpperCase()}
        </span>
      ))}
    </div>
  );
}

function ConnectionBadge({ status }: { status: PageConnection["status"] }) {
  if (status === "connected") return null;
  return (
    <span className="flex items-center gap-1 rounded-full bg-amber-500/12 px-2 py-0.5 text-xs text-amber-600 dark:text-amber-300">
      <span className="size-1.5 rounded-full bg-current" />
      {status === "offline" ? "Offline — changes will sync" : status === "missing" ? "Deleted" : "Connecting"}
    </span>
  );
}

const STATUS_STYLE: Record<RequestView["status"], string> = {
  queued: "text-muted-foreground",
  working: "text-violet-500",
  done: "text-emerald-500",
  failed: "text-red-500",
};
const STATUS_ICON: Record<RequestView["status"], string> = {
  queued: "Clock",
  working: "Spinner",
  done: "CircleCheck",
  failed: "AlertCircle",
};

/** Keep-updated status and recent bot requests under the title. */
function PageStrip({
  page,
  refreshBot,
  requests,
  active,
  onConfigure,
  onRefresh,
}: {
  page: PageMetaView;
  refreshBot: BotView | undefined;
  requests: RequestView[];
  active: RequestView[];
  onConfigure(): void;
  onRefresh(): void;
}) {
  const navigate = useBbNavigate();
  const [open, setOpen] = useState(false);
  const recent = open ? requests.slice(0, 8) : active.length ? active : requests.slice(0, 1);
  if (!page.refresh && !requests.length) return null;
  return (
    <div className="mt-3 flex flex-col gap-1.5 text-sm">
      {page.refresh ? (
        <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
          <Icon name="Repeat" className="size-3.5" />
          <span>
            Kept updated by <span className="text-foreground">{refreshBot ? `${refreshBot.avatar} ${refreshBot.name}` : "a bot"}</span>
            {page.refresh.nextAt ? ` · next ${new Date(page.refresh.nextAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}` : ""}
          </span>
          <button type="button" className="text-xs underline-offset-2 hover:text-foreground hover:underline" onClick={onRefresh}>
            Refresh now
          </button>
          <button type="button" className="text-xs underline-offset-2 hover:text-foreground hover:underline" onClick={onConfigure}>
            Settings
          </button>
        </div>
      ) : null}
      {recent.map((request) => (
        <div key={request.id} className="group/req flex min-w-0 items-start gap-2 text-muted-foreground">
          <Icon
            name={STATUS_ICON[request.status]}
            className={cn("mt-0.5 size-3.5 shrink-0", STATUS_STYLE[request.status])}
          />
          <div className="min-w-0 flex-1">
            <span className="text-foreground">{request.botName}</span>{" "}
            {request.status === "queued" ? "will pick up" : request.status === "working" ? "is working on" : request.status === "done" ? "finished" : "couldn't finish"}{" "}
            {request.kind === "refresh" ? "a refresh" : request.kind === "comment" ? "a comment" : "a request"}
            {request.summary && request.kind !== "refresh" ? <span className="text-muted-foreground/80">: “{request.summary}”</span> : null}
            <span className="ml-1 text-xs text-muted-foreground/70">{relativeTime(request.updatedAt)}</span>
            {request.threadId ? (
              <button
                type="button"
                className="pages-reveal ml-2 text-xs underline-offset-2 opacity-0 group-hover/req:opacity-100 hover:text-foreground hover:underline"
                onClick={() => navigate.toThread(request.threadId!)}
              >
                Open thread
              </button>
            ) : null}
            {open && (request.result || request.error) ? (
              <p className={cn("mt-1 line-clamp-4 whitespace-pre-wrap text-xs", request.error && "text-red-500")}>{request.error ?? request.result}</p>
            ) : null}
          </div>
        </div>
      ))}
      {requests.length > 1 || requests.some((request) => request.result) ? (
        <button type="button" className="self-start text-xs text-muted-foreground hover:text-foreground" onClick={() => setOpen((value) => !value)}>
          {open ? "Hide activity" : "Show activity"}
        </button>
      ) : null}
    </div>
  );
}

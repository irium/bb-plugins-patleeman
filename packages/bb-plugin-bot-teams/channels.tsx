import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  useBbNavigate,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  experimental_Icon as Icon,
  type PluginNavPanelProps,
  type PluginThreadListProps,
  type ExperimentalSidebarNavigationProps,
} from "@get-bb/plugin-sdk/app";
import type {
  Bot,
  Conversation,
  DirectThreadInfo,
  Room,
  rpcContract,
  DirectThreadView,
  RoomWork,
  ThreadStatusView,
} from "./contract";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import { sharedReads } from "./shared-read";
import { ErrorMessage, message } from "./bot-ui";
import { ChannelSidebarRow } from "./channel-sidebar-row";
import { DirectSidebarThread } from "./direct-sidebar-row";
import { channelLinkDestination } from "./channel-links";
import { mentionBotId } from "./mentions";
import { Modal } from "./channel-controls";

const uuid = /^[a-f0-9-]{36}$/;
const channelId = (subPath: string) =>
  uuid.test(subPath.split("/")[0] ?? "") ? subPath.split("/")[0]! : null;
const directMessageBotId = (subPath: string) => {
  const [kind, id] = subPath.split("/");
  return kind === "dm" && /^bot_[a-f0-9]{16}$/.test(id ?? "") ? id! : null;
};
function useRoster(reconcile = false) {
  const rpc = useRpc<typeof rpcContract>();
  const connectionState = useRealtimeConnectionState();
  const [data, setData] = useState<{
    bots: Bot[];
    rooms: Room[];
    activeRoomIds: string[];
    directThreads: Record<string, DirectThreadView>;
    directConversations: Record<string, Conversation[]>;
    directThreadInfo: Record<string, DirectThreadInfo>;
    roomThreads: Record<string, ThreadStatusView[]>;
    roomWork: Record<string, RoomWork>;
    attentionCounts: Record<string, number>;
    approvalCounts: Record<string, number>;
  }>({
    bots: [],
    rooms: [],
    activeRoomIds: [],
    directThreads: {},
    directConversations: {},
    directThreadInfo: {},
    roomThreads: {},
    roomWork: {},
    attentionCounts: {},
    approvalCounts: {},
  });
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const load = useCallback(() => {
    const seq = ++request.current;
    sharedReads
      .read("roster", () => rpc.call("list"))
      .then(
        (d) => {
          if (seq === request.current) {
            setData(d);
            setError(null);
          }
        },
        (e) => {
          if (seq === request.current) setError(message(e));
        },
      );
  }, [rpc]);
  useEffect(() => {
    load();
    return () => {
      request.current++;
    };
  }, [load]);
  useRealtime("changed", (event) => {
    sharedReads.invalidate(
      event && typeof event === "object" && "revision" in event
        ? event.revision
        : undefined,
    );
    void load();
  });
  useEffect(() => {
    if (reconcile && connectionState === "connected") load();
  }, [reconcile, connectionState, load]);
  const hasActiveWork = data.activeRoomIds.length > 0 ||
    Object.values(data.directThreads).some((thread) =>
      ["starting", "active", "stopping"].includes(thread.status) ||
      ["runtime", "workflow", "background-agent", "background-command", "plan-mode", "goal"]
        .includes(thread.indicator)) ||
    Object.values(data.roomThreads).flat().some((thread) =>
      ["runtime", "workflow", "background-agent", "background-command", "plan-mode", "goal"]
        .includes(thread.indicator));
  useEffect(() => {
    if (!reconcile) return;
    const refresh = () => {
      if (document.visibilityState !== "hidden") load();
    };
    const timer = window.setInterval(refresh, hasActiveWork ? 2_500 : 15_000);
    window.addEventListener("pageshow", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [reconcile, hasActiveWork, load]);
  return { ...data, error, load };
}
export function ChannelLinkNavigation() {
  const { rooms } = useRoster();
  const navigate = useBbNavigate();
  useEffect(() => {
    const knownChannelIds = new Set(rooms.map((room) => room.id));
    const restoreLegacyLink = () => {
      if (!window.location.pathname.startsWith("/plugins/bots/channels/"))
        return;
      const destination = channelLinkDestination(
        window.location.href,
        window.location.origin,
        knownChannelIds,
      );
      if (destination)
        navigate.toPluginPanel("channels", {
          subPath: destination,
          replace: true,
        });
    };
    restoreLegacyLink();
    window.addEventListener("popstate", restoreLegacyLink);
    const openLink = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      const anchor =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (!anchor || anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href") ?? "";
      const botId = mentionBotId(href);
      if (botId) {
        event.preventDefault();
        event.stopPropagation();
        navigate.toPluginPanel("bots", { subPath: `${botId}/profile` });
        return;
      }
      const destination = channelLinkDestination(
        href,
        window.location.origin,
        knownChannelIds,
      );
      if (!destination) return;
      event.preventDefault();
      event.stopPropagation();
      // The route resolves the channel's thread; message links open the channel.
      navigate.toPluginPanel("channels", { subPath: destination });
    };
    document.addEventListener("click", openLink, true);
    return () => {
      document.removeEventListener("click", openLink, true);
      window.removeEventListener("popstate", restoreLegacyLink);
    };
  }, [rooms, navigate]);
  return null;
}
export function ChannelRedirect({ subPath }: { subPath?: string }) {
  const navigate = useBbNavigate();
  useEffect(
    () =>
      navigate.toPluginPanel("channels", {
        subPath: subPath ?? "new",
        replace: true,
      }),
    [navigate, subPath],
  );
  return null;
}
export function ChannelsNavigation({
  experimental_Original: Original,
}: ExperimentalSidebarNavigationProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [inlineTarget, setInlineTarget] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const sidebar = anchor.current?.closest('[data-sidebar="sidebar"]');
    const content = sidebar?.querySelector<HTMLElement>('[data-sidebar="content"]');
    if (!content) return;

    const target = document.createElement("div");
    target.className = "channels-sidebar-inline";
    content.prepend(target);
    setInlineTarget(target);
    return () => target.remove();
  }, []);

  const sections = <ChannelsSidebar activeThreadId={null} onNavigate={() => {}} />;
  return (
    <>
      <Original />
      <span ref={anchor} hidden />
      {inlineTarget
        ? createPortal(sections, inlineTarget)
        : <div className="channels-navigation-list">{sections}</div>}
    </>
  );
}

type ChannelOrganization = "pinned" | "activity" | "none";
type ChannelSort = "updated" | "created" | "alpha";
type ChannelDisplay = {
  organization: ChannelOrganization;
  sort: ChannelSort;
  direction: "ascending" | "descending";
};
const channelDisplayKey = "bb:bots:channel-sidebar-display";
const defaultChannelDisplay: ChannelDisplay = {
  organization: "pinned",
  sort: "updated",
  direction: "descending",
};

function readChannelDisplay(): ChannelDisplay {
  try {
    const value = JSON.parse(localStorage.getItem(channelDisplayKey) || "null");
    return {
      organization: ["pinned", "activity", "none"].includes(value?.organization)
        ? value.organization
        : defaultChannelDisplay.organization,
      sort: ["updated", "created", "alpha"].includes(value?.sort)
        ? value.sort
        : defaultChannelDisplay.sort,
      direction: ["ascending", "descending"].includes(value?.direction)
        ? value.direction
        : defaultChannelDisplay.direction,
    };
  } catch {
    return defaultChannelDisplay;
  }
}

function compareChannels(a: Room, b: Room, display: ChannelDisplay): number {
  const order = display.direction === "ascending" ? 1 : -1;
  const comparison = display.sort === "alpha"
    ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    : display.sort === "created"
      ? a.createdAt - b.createdAt
      : a.updatedAt - b.updatedAt;
  return comparison * order || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

export function ChannelsSidebar({
  onNavigate,
  activeThreadId,
}: Pick<PluginThreadListProps, "activeThreadId" | "onNavigate">) {
  const { bots, rooms, activeRoomIds, directThreads, directConversations, directThreadInfo, roomThreads, roomWork,
    attentionCounts, approvalCounts, error, load } =
      useRoster(true),
    rpc = useRpc<typeof rpcContract>(),
    navigate = useBbNavigate();
  const [selected, setSelected] = useState<string | null>(null),
    [channelSearch, setChannelSearch] = useState(""),
    [directSearch, setDirectSearch] = useState(""),
    [channelSearching, setChannelSearching] = useState(false),
    [directSearching, setDirectSearching] = useState(false),
    [channelsCollapsed, setChannelsCollapsed] = useState(false),
    [directCollapsed, setDirectCollapsed] = useState(false),
    [archived, setArchived] = useState(false),
    [showArchivedBots, setShowArchivedBots] = useState(false),
    [showArchivedDirectThreads, setShowArchivedDirectThreads] = useState(false),
    [display, setDisplay] = useState(readChannelDisplay),
    [renaming, setRenaming] = useState<Room | null>(null),
    [deleting, setDeleting] = useState<Room | null>(null),
    [failure, setFailure] = useState<string | null>(null),
    [pending, setPending] = useState(false);
  const channelListId = useId();
  const directListId = useId();
  const channelPanel = useRef<string | null>(null);
  const updateDisplay = (next: ChannelDisplay) => {
    setDisplay(next);
    try {
      localStorage.setItem(channelDisplayKey, JSON.stringify(next));
    } catch {}
  };
  const archive = async (room: Room) => {
    setPending(true);
    setFailure(null);
    try {
      await rpc.call("channelState", { id: room.id, archived: !room.archived });
    } catch (e) {
      setFailure(message(e));
    } finally {
      setPending(false);
    }
  };
  const changeChannelState = async (id: string, patch: {
    pinned?: boolean;
    lastReadAt?: number;
    markUnread?: boolean;
  }) => {
    setPending(true);
    setFailure(null);
    try {
      await rpc.call("channelState", { id, ...patch });
    } catch (e) {
      setFailure(message(e));
    } finally {
      setPending(false);
    }
  };
  const copyChannelId = async (id: string) => {
    setFailure(null);
    try {
      await navigator.clipboard.writeText(id);
    } catch (e) {
      setFailure(`Could not copy channel ID: ${message(e)}`);
    }
  };
  const copyChannelLink = async (id: string) => {
    setFailure(null);
    try {
      await navigator.clipboard.writeText(
        new URL(`/plugins/bot-teams/channels/${id}`, window.location.origin).href,
      );
    } catch (e) {
      setFailure(`Could not copy channel link: ${message(e)}`);
    }
  };
  useEffect(() => {
    const listener = (e: Event) => {
      channelPanel.current = (e as CustomEvent<string | null>).detail;
      setSelected(channelPanel.current);
    };
    window.addEventListener("bots:channel-selection", listener);
    return () => window.removeEventListener("bots:channel-selection", listener);
  }, []);
  useEffect(() => {
    if (!activeThreadId) {
      if (!channelPanel.current) setSelected(null);
      return;
    }
    let current = true;
    void rpc.call("channelForThread", { threadId: activeThreadId }).then(
      (roomId) => { if (current) setSelected(roomId); },
      () => { if (current) setSelected(null); },
    );
    return () => { current = false; };
  }, [activeThreadId, rpc]);
  const open = (id: string) => {
    setSelected(id);
    setFailure(null);
    void rpc.call("openChannelThread", { id }).then(
      ({ threadId }) => {
        navigate.toThread(threadId);
        onNavigate();
      },
      (e) => setFailure(message(e)),
    );
  };
  const channelQuery = channelSearch.trim().toLowerCase();
  const directQuery = directSearch.trim().toLowerCase();
  // One flat list: every visible direct thread, newest activity first, with its bot on the row.
  const directRows = bots
    .filter((bot) => showArchivedBots || !bot.retired)
    .flatMap((bot) => (directConversations[bot.id] ?? []).flatMap((conversation) => {
      const info = directThreadInfo[conversation.threadId];
      if (!info || (!showArchivedDirectThreads && info.archivedAt)) return [];
      const haystack = `${info.title} ${bot.name} @${bot.handle}`.toLowerCase();
      return haystack.includes(directQuery) ? [{ bot, conversation, info }] : [];
    }))
    .sort((a, b) => b.info.updatedAt - a.info.updatedAt ||
      a.info.title.localeCompare(b.info.title));
  const startDirectThread = async (bot: Bot) => {
    setPending(true);
    setFailure(null);
    try {
      const conversation = await rpc.call("newConversation", { id: bot.id });
      navigate.toThread(conversation.threadId);
      onNavigate();
    } catch (cause) {
      setFailure(message(cause));
    } finally {
      setPending(false);
    }
  };
  const list = rooms
    .filter(
      (r) =>
        (channelQuery ? true : !!r.archived === archived) &&
        r.name.toLowerCase().includes(channelQuery),
    )
    .sort((a, b) =>
      (display.organization === "pinned"
        ? Number(!!b.pinned) - Number(!!a.pinned)
        : 0) || compareChannels(a, b, display),
    );
  const needsInput = (id: string) =>
    (attentionCounts[id] ?? 0) + (approvalCounts[id] ?? 0) > 0 ||
    (roomThreads[id] ?? []).some((thread) =>
      ["waiting-for-input", "unread-error", "queued-failed"].includes(thread.indicator));
  const working = (id: string) => activeRoomIds.includes(id) ||
    (roomThreads[id] ?? []).some((thread) =>
      ["runtime", "workflow", "background-agent", "background-command", "plan-mode", "goal"]
        .includes(thread.indicator));
  const groups: { label: string | null; rooms: Room[] }[] =
    display.organization === "activity"
      ? [
          { label: "Needs you", rooms: list.filter((r) =>
            needsInput(r.id)) },
          { label: "Working", rooms: list.filter((r) =>
            !needsInput(r.id) && working(r.id)) },
          { label: "Other channels", rooms: list.filter((r) =>
            !needsInput(r.id) && !working(r.id)) },
        ].filter((group) => group.rooms.length > 0)
      : [{ label: null, rooms: list }];
  return (
    <>
      <section className="channels-sidebar" aria-label="Channels">
        <header>
          <div className="channels-sidebar-title">
            <span className="channels-sidebar-heading">
              {archived ? "Archived channels" : "Channels"}
            </span>
            <button type="button" className="channels-sidebar-collapse"
              aria-label={channelsCollapsed ? "Expand Channels section" : "Collapse Channels section"}
              aria-expanded={!channelsCollapsed} aria-controls={channelListId}
              onClick={() => setChannelsCollapsed(!channelsCollapsed)}>
              <Icon name="ChevronRight" aria-hidden="true" />
            </button>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Search channels"
            aria-expanded={channelSearching}
            onClick={() => {
              setChannelSearching(!channelSearching);
              setChannelSearch("");
              setChannelsCollapsed(false);
            }}
          >
            <Icon name="Search" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="New channel"
            onClick={() => {
              // "new" is a panel route, not a channel ID; CreateChannel makes the room.
              setFailure(null);
              navigate.toPluginPanel("channels", { subPath: "new" });
              onNavigate();
            }}
          >
            <Icon name="Plus" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Channel list options">
                <Icon name="MoreHorizontal" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" aria-label="Channel list options">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger aria-label="Organize by">
                  <Icon name="Layers" />
                  Organize by
                  <Icon name="ChevronRight" className="ml-auto" />
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent aria-label="Organize channels">
                  {([
                    ["pinned", "Pinned first"],
                    ["activity", "By activity"],
                    ["none", "No grouping"],
                  ] as const).map(([value, label]) => (
                    <DropdownMenuItem
                      key={value}
                      role="menuitemradio"
                      aria-checked={display.organization === value}
                      aria-label={label}
                      onSelect={(event) => {
                        event.preventDefault();
                        updateDisplay({ ...display, organization: value });
                      }}
                    >
                      {label}
                      {display.organization === value && <Icon name="Check" className="ml-auto" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger aria-label="Sort by">
                  <Icon name="ArrowUpDown" />
                  Sort by
                  <Icon name="ChevronRight" className="ml-auto" />
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent aria-label="Sort channels">
                  {([
                    ["updated", "Updated at", "descending"],
                    ["created", "Created at", "descending"],
                    ["alpha", "Alphabetical", "ascending"],
                  ] as const).map(([value, label, defaultDirection]) => {
                    const selected = display.sort === value;
                    const direction = selected ? display.direction : defaultDirection;
                    const nextDirection = selected
                      ? direction === "ascending" ? "descending" : "ascending"
                      : defaultDirection;
                    return (
                      <DropdownMenuItem
                        key={value}
                        role="menuitemradio"
                        aria-checked={selected}
                        aria-label={selected
                          ? `${label}, ${direction}. Sort ${nextDirection}`
                          : label}
                        onSelect={(event) => {
                          event.preventDefault();
                          updateDisplay({ ...display, sort: value, direction: nextDirection });
                        }}
                      >
                        {label}
                        {selected && (
                          <Icon
                            name={direction === "ascending" ? "ArrowUp" : "ArrowDown"}
                            className="ml-auto"
                          />
                        )}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                aria-label={archived ? "Show active channels" : "Show archived channels"}
                onSelect={() => {
                  setArchived(!archived);
                  setChannelSearch("");
                  setChannelsCollapsed(false);
                }}
              >
                <Icon name={archived ? "ListView" : "Archive"} />
                {archived ? "Show active channels" : "Show archived channels"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <div id={channelListId} hidden={channelsCollapsed}>
        {channelSearching && (
          <Input
            autoFocus
            aria-label="Search channels"
            placeholder="Search channels…"
            value={channelSearch}
            onChange={(e) => setChannelSearch(e.target.value)}
          />
        )}
        {error && <ErrorMessage error={error} />}
        <ErrorMessage error={failure} />
        {groups.map((group) => (
          <div key={group.label ?? "all"} className="channels-sidebar-group">
            {group.label && <p className="channels-sidebar-group-heading">{group.label}</p>}
            {group.rooms.map((r) => (
              <ChannelSidebarRow
                key={r.id}
                room={r}
                selected={selected === r.id}
                active={activeRoomIds.includes(r.id)}
                threads={roomThreads[r.id] ?? []}
                work={roomWork[r.id]}
                attentionCount={attentionCounts[r.id] ?? 0}
                approvalCount={approvalCounts[r.id] ?? 0}
                pending={pending}
                onOpen={() => open(r.id)}
                onMarkRead={() => void changeChannelState(r.id,
                  r.updatedAt > (r.lastReadAt ?? 0)
                    ? { lastReadAt: r.updatedAt }
                    : { markUnread: true })}
                onPin={() => void changeChannelState(r.id, { pinned: !r.pinned })}
                onRename={(name) => rpc.call("updateRoom", { id: r.id, name })}
                onCopyLink={() => void copyChannelLink(r.id)}
                onCopyId={() => void copyChannelId(r.id)}
                onArchive={() => void archive(r)}
                onDelete={() => setDeleting(r)}
              />
            ))}
          </div>
        ))}
        {!list.length && (
          <p className="channel-menu-label">
            {channelQuery
              ? "No matching channels"
              : archived
                ? "No archived channels"
                : "No active channels"}
          </p>
        )}
        </div>
      </section>
      <section className="channels-sidebar direct-messages-sidebar" aria-label="Direct messages">
        <header>
          <div className="channels-sidebar-title">
            <span className="channels-sidebar-heading">Direct messages</span>
            <button type="button" className="channels-sidebar-collapse"
              aria-label={directCollapsed ? "Expand Direct messages section" : "Collapse Direct messages section"}
              aria-expanded={!directCollapsed} aria-controls={directListId}
              onClick={() => setDirectCollapsed(!directCollapsed)}>
              <Icon name="ChevronRight" aria-hidden="true" />
            </button>
          </div>
          <Button variant="ghost" size="icon"
            aria-label="Search direct messages" aria-expanded={directSearching}
            onClick={() => {
              setDirectSearching(!directSearching);
              setDirectSearch("");
              setDirectCollapsed(false);
            }}>
            <Icon name="Search" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="New direct message">
                <Icon name="Plus" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" aria-label="Choose a bot">
              {bots.filter((bot) => !bot.retired).sort((a, b) =>
                a.name.localeCompare(b.name)).map((bot) => (
                <DropdownMenuItem key={bot.id} disabled={pending}
                  onSelect={() => void startDirectThread(bot)}>
                  {bot.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Direct message list options">
                <Icon name="MoreHorizontal" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" aria-label="Direct message list options">
              <DropdownMenuItem
                aria-label={showArchivedDirectThreads ? "Hide archived threads" : "Show archived threads"}
                onSelect={() => setShowArchivedDirectThreads(!showArchivedDirectThreads)}>
                <Icon name="Archive" />
                {showArchivedDirectThreads ? "Hide archived threads" : "Show archived threads"}
              </DropdownMenuItem>
              <DropdownMenuItem
                aria-label={showArchivedBots ? "Hide archived bots" : "Show archived bots"}
                onSelect={() => {
                  setShowArchivedBots(!showArchivedBots);
                  setDirectCollapsed(false);
                }}>
                <Icon name={showArchivedBots ? "ListView" : "Archive"} />
                {showArchivedBots ? "Hide archived bots" : "Show archived bots"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <div id={directListId} hidden={directCollapsed}>
        {directSearching && (
          <Input autoFocus aria-label="Search direct messages"
            placeholder="Search direct messages…" value={directSearch}
            onChange={(event) => setDirectSearch(event.target.value)} />
        )}
        {directRows.map(({ bot, conversation, info }) => (
          <DirectSidebarThread key={conversation.threadId} bot={bot}
            conversation={conversation} info={info}
            status={directThreads[bot.id]?.threadId === conversation.threadId
              ? directThreads[bot.id] : undefined}
            onNavigate={onNavigate} onNewThread={() => void startDirectThread(bot)}
            onChanged={load} selected={activeThreadId === conversation.threadId} />
        ))}
        {!directRows.length && <p className="channel-menu-label">
          {directQuery ? "No matching direct messages" : "No direct messages yet"}
        </p>}
        </div>
      </section>
      {renaming && (
        <RenameChannel
          key={renaming.id}
          room={renaming}
          onClose={() => setRenaming(null)}
        />
      )}
      {deleting && (
        <DeleteChannel room={deleting} onClose={() => setDeleting(null)} />
      )}
    </>
  );
}
function DeleteChannel({ room, onClose }: { room: Room; onClose: () => void }) {
  const rpc = useRpc<typeof rpcContract>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      title="Delete channel?"
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <div className="bot-form">
        <p className="text-sm leading-5">
          Permanently delete <strong>{room.name}</strong>, its thread, messages,
          and channel activity? This stops unfinished responses. Your
          bots and their workspaces are kept. This cannot be undone.
        </p>
        <ErrorMessage error={error} />
        <div className="channel-rename-actions">
          <Button
            autoFocus
            variant="ghost"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              setError(null);
              try {
                await rpc.call("deleteRoom", { id: room.id });
                localStorage.removeItem(`bb:bots:draft:${room.id}`);
                onClose();
              } catch (e) {
                setError(message(e));
              } finally {
                setPending(false);
              }
            }}
          >
            {pending ? "Deleting…" : "Delete channel"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
function RenameChannel({ room, onClose }: { room: Room; onClose: () => void }) {
  const rpc = useRpc<typeof rpcContract>();
  const [name, setName] = useState(room.name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      title="Rename channel"
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <form
        className="bot-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending || !name.trim()) return;
          setPending(true);
          setError(null);
          try {
            await rpc.call("updateRoom", { id: room.id, name: name.trim() });
            onClose();
          } catch (e) {
            setError(message(e));
          } finally {
            setPending(false);
          }
        }}
      >
        <Input
          autoFocus
          aria-label="Channel name"
          required
          maxLength={80}
          value={name}
          disabled={pending}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setName(e.target.value)}
        />
        <ErrorMessage error={error} />
        <div className="channel-rename-actions">
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={pending || !name.trim()}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
// BB owns tab selection, persistence, resizing, splits, and the compact drawer.
function CreateChannel() {
  const rpc = useRpc<typeof rpcContract>(),
    navigate = useBbNavigate();
  const opening = useRef<Promise<{ threadId: string }> | null>(null);
  const [attempt, setAttempt] = useState(0),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    // Reuse the request if React replays the effect while mounting.
    opening.current ??= rpc
      .call("createRoom", { memberIds: [] })
      .then((room) => rpc.call("openChannelThread", { id: room.id }));
    opening.current.then(
      ({ threadId }) => {
        if (active) navigate.toThread(threadId);
      },
      (e) => {
        if (active) setError(message(e));
      },
    );
    return () => {
      active = false;
    };
  }, [attempt, rpc, navigate]);
  return (
    <div className="bot-page">
      {error ? (
        <>
          <ErrorMessage error={error} />
          <Button
            onClick={() => {
              opening.current = null;
              setError(null);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </Button>
        </>
      ) : (
        <p role="status">Opening channel…</p>
      )}
    </div>
  );
}
/**
 * Channels are BB threads. This route only resolves the stable channel links
 * (`/plugins/bot-teams/channels/<id>`, message links, and old DM links) to
 * the thread that now holds the conversation.
 */
export function ChannelsPage({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<typeof rpcContract>(),
    navigate = useBbNavigate();
  const [error, setError] = useState<string | null>(null);
  const id = channelId(subPath);
  const botId = directMessageBotId(subPath);
  useEffect(() => {
    if (!id && !botId) return;
    let active = true;
    const target = botId
      ? rpc.call("conversation", { id: botId }).then((c) => c.threadId)
      : rpc.call("openChannelThread", { id: id! }).then((c) => c.threadId);
    target.then(
      (threadId) => active && navigate.toThread(threadId),
      (e) => active && setError(message(e)),
    );
    return () => {
      active = false;
    };
  }, [id, botId, rpc, navigate]);
  if (!id && !botId) return <CreateChannel />;
  return (
    <div className="bot-page">
      {error ? <ErrorMessage error={error} /> : <p role="status">Opening…</p>}
    </div>
  );
}

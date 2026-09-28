import { useEffect, useId, useState } from "react";
import {
  experimental_Icon as Icon,
  useBbNavigate,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import type { Bot, Conversation, DirectThreadInfo, DirectThreadView } from "./contract";
import { DirectMessageStatus } from "./bot-direct-chat";
import { message } from "./bot-ui";
import { useSidebarInlineRename } from "./sidebar-inline-rename";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "./components/ui/context-menu";
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

export function DirectSidebarThread({
  conversation,
  info,
  status,
  onNavigate,
  onChanged,
  selected,
}: {
  conversation: Conversation;
  info: DirectThreadInfo;
  status?: DirectThreadView;
  onNavigate: () => void;
  onChanged: () => void;
  selected: boolean;
}) {
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const [error, setError] = useState<string | null>(null);
  const [sections, setSections] = useState<{ id: string; name: string }[]>([]);
  const title = info.title || conversation.title || "Direct message";
  const rename = useSidebarInlineRename({
    name: title,
    label: "Thread name",
    onSave: async (next) => {
      await sdk.threads.update({ threadId: conversation.threadId, title: next });
      onChanged();
    },
  });
  const archived = info.archivedAt !== null;
  const href = `/projects/${info.projectId}/threads/${conversation.threadId}`;
  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      setError(null);
      onChanged();
    } catch (cause) {
      setError(message(cause));
    }
  };
  const open = () => {
    navigate.toThread(conversation.threadId);
    onNavigate();
  };
  const archive = () => void run(async () => {
    if (archived) {
      await sdk.threads.unarchive({ threadId: conversation.threadId });
      return;
    }
    const { nonDeletedChildCount } = await sdk.threads.childSummary({
      threadId: conversation.threadId,
    });
    if (nonDeletedChildCount) {
      if (!window.confirm(`Archive “${title}” and its ${nonDeletedChildCount} child threads?`))
        return;
      await sdk.threads.archiveAll({ threadId: conversation.threadId });
      return;
    }
    await sdk.threads.archive({ threadId: conversation.threadId });
  });
  const loadSections = () => {
    void sdk.threadSections.list().then(setSections, (cause) => setError(message(cause)));
  };
  const menuItems = (surface: "context" | "dropdown") => {
    const Item = surface === "context" ? ContextMenuItem : DropdownMenuItem;
    const Separator = surface === "context" ? ContextMenuSeparator : DropdownMenuSeparator;
    const Sub = surface === "context" ? ContextMenuSub : DropdownMenuSub;
    const SubTrigger = surface === "context" ? ContextMenuSubTrigger : DropdownMenuSubTrigger;
    const SubContent = surface === "context" ? ContextMenuSubContent : DropdownMenuSubContent;
    return <>
      <Item onSelect={() => void run(() => sdk.threads.open({
        threadId: conversation.threadId, file: null, split: "right",
      }))}>
        <Icon name="Columns2" /> Open in split
      </Item>
      <Separator />
      <Item onSelect={() => void navigator.clipboard.writeText(
        new URL(href, window.location.origin).href,
      )}>
        <Icon name="Copy" /> Copy thread link
      </Item>
      <Item onSelect={() => void run(() => info.unread
        ? sdk.threads.markRead({ threadId: conversation.threadId })
        : sdk.threads.markUnread({ threadId: conversation.threadId }))}>
        <Icon name={info.unread ? "MailOpen" : "Mail"} />
        {info.unread ? "Mark read" : "Mark unread"}
      </Item>
      <Item onSelect={() => void run(() => info.pinned
        ? sdk.threads.unpin({ threadId: conversation.threadId })
        : sdk.threads.pin({ threadId: conversation.threadId }))}>
        <Icon name={info.pinned ? "PinOff" : "Pin"} />
        {info.pinned ? "Unpin" : "Pin"}
      </Item>
      {!archived && <Sub>
        <SubTrigger><Icon name="Layers" /> Move to section</SubTrigger>
        <SubContent>
          <Item disabled={info.sectionId === null}
            onSelect={() => void run(() => sdk.threads.update({
              threadId: conversation.threadId, sectionId: null,
            }))}>Threads</Item>
          {sections.map((section) => <Item key={section.id}
            disabled={info.sectionId === section.id}
            onSelect={() => void run(() => sdk.threads.update({
              threadId: conversation.threadId, sectionId: section.id,
            }))}>{section.name}</Item>)}
        </SubContent>
      </Sub>}
      <Item onSelect={rename.startFromMenu}><Icon name="Edit" /> Rename</Item>
      <Separator />
      <Item onSelect={archive}>
        <Icon name={archived ? "ArchiveRestore" : "Archive"} />
        {archived ? "Unarchive" : "Archive"}
      </Item>
      <Item className="text-destructive focus:text-destructive"
        onSelect={() => void run(async () => {
          const { nonDeletedChildCount } = await sdk.threads.childSummary({
            threadId: conversation.threadId,
          });
          const detail = nonDeletedChildCount
            ? ` and its ${nonDeletedChildCount} child threads`
            : "";
          if (!window.confirm(`Delete “${title}”${detail}? This cannot be undone.`)) return;
          await sdk.threads.delete({
            threadId: conversation.threadId,
            childThreadsConfirmed: nonDeletedChildCount > 0,
          });
        })}>
        <Icon name="Trash2" /> Delete
      </Item>
    </>;
  };
  return <>
    <ContextMenu onOpenChange={(open) => { if (open) loadSections(); }}>
      <ContextMenuTrigger asChild>
        <div className="direct-thread-nav-row">
          {rename.editing ? <span className="channel-nav-row direct-thread-nav-link">
            {rename.editor}
          </span> : <a href={href} className="channel-nav-row direct-thread-nav-link"
            data-sidebar-thread-id={conversation.threadId}
            aria-current={selected ? "page" : undefined}
            title={title}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              open();
            }}>
            <span className="channel-nav-name">{title}</span>
            {archived && <span className="channel-nav-archived">Archived</span>}
            {status && !archived && <DirectMessageStatus thread={status} />}
          </a>}
          <button type="button" className="direct-thread-options direct-thread-archive"
            aria-label={`${archived ? "Unarchive" : "Archive"} ${title}`}
            onClick={archive}>
            <Icon name={archived ? "ArchiveRestore" : "Archive"} />
          </button>
          <DropdownMenu onOpenChange={(open) => { if (open) loadSections(); }}>
            <DropdownMenuTrigger asChild>
              <button type="button" className="direct-thread-options direct-thread-menu-trigger"
                aria-label={`${title} options`}>
                <Icon name="MoreHorizontal" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" aria-label={`${title} options`}
              onCloseAutoFocus={rename.onCloseAutoFocus}>
              {menuItems("dropdown")}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent aria-label={`${title} options`}
        onCloseAutoFocus={rename.onCloseAutoFocus}>{menuItems("context")}</ContextMenuContent>
    </ContextMenu>
    {error && <p role="alert" className="channel-menu-label">{error}</p>}
  </>;
}

export function DirectSidebarBot({
  bot,
  conversations,
  threadInfo,
  currentStatus,
  showArchivedThreads,
  activeThreadId,
  onNavigate,
  onNewThread,
  onChanged,
}: {
  bot: Bot;
  conversations: Conversation[];
  threadInfo: Record<string, DirectThreadInfo>;
  currentStatus?: DirectThreadView;
  showArchivedThreads: boolean;
  activeThreadId?: string;
  onNavigate: () => void;
  onNewThread: () => void;
  onChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  useEffect(() => {
    if (conversations.some((conversation) => conversation.threadId === activeThreadId))
      setExpanded(true);
  }, [activeThreadId, conversations]);
  const listId = useId();
  const visible = conversations.filter((conversation) => {
    const info = threadInfo[conversation.threadId];
    return info && (showArchivedThreads || info.archivedAt === null);
  });
  return <div className="direct-bot-group">
    <div className="direct-bot-nav-row">
      <div className="direct-bot-heading">
        <span className="channel-nav-name">{bot.name}</span>
        <button type="button" className="direct-bot-toggle"
          aria-label={`${expanded ? "Collapse" : "Expand"} ${bot.name} threads`}
          aria-expanded={expanded} aria-controls={listId}
          onClick={() => setExpanded(!expanded)}>
          <Icon name="ChevronRight" aria-hidden="true" />
        </button>
        {bot.retired && <span className="channel-nav-archived">Archived</span>}
      </div>
      {!bot.retired && <button type="button" className="direct-thread-options"
        aria-label={`New thread with ${bot.name}`} onClick={onNewThread}>
        <Icon name="Plus" />
      </button>}
    </div>
    <div id={listId} hidden={!expanded} className="direct-bot-threads">
      {visible.map((conversation) => <DirectSidebarThread key={conversation.threadId}
        conversation={conversation}
        info={threadInfo[conversation.threadId]!}
        status={conversation.archivedAt ? undefined : currentStatus}
        onNavigate={onNavigate} onChanged={onChanged}
        selected={activeThreadId === conversation.threadId} />)}
    </div>
  </div>;
}

import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  channelDeliverPrefix,
  levelForPermission,
  channelProviderId,
  channelStartPrefix,
  type ChannelDelivery,
} from "./channel-provider";
import type { Room, RoomMessage } from "./contract";
import { messageSchema } from "./contract";
import type { Store } from "./store";
import { attachmentUrl } from "./channel-attachments";
import { linkifyMentions } from "./mentions";
import { isForkConversation } from "./send-mode";
import { missingThread } from "./runtime";

const historyLimit = 30;

function selectionKey(room: Room) {
  return `${room.responseBehavior ?? "everyone"}:${levelForPermission(room.permissionMode)}`;
}

function deliveryText(delivery: ChannelDelivery) {
  return `${channelDeliverPrefix}${JSON.stringify(delivery)}`;
}

/** Input only the channel bridge sees; the thread shows no user message for it. */
function hiddenInput(text: string) {
  return { type: "text" as const, text, mentions: [], visibility: "agent-only" as const };
}
const historyExcerpt = 600;

interface Link {
  roomId: string;
  threadId: string;
  title: string;
  deliveredRowid: number;
}

/**
 * Each channel is a hidden BB thread on the channel provider. The room's
 * message log stays the source of truth: messages posted from the thread
 * are marked as origins, and every other visible message is delivered into
 * the thread in order, after a per-room watermark.
 */
export class ChannelThreads {
  private readonly creating = new Map<string, Promise<string>>();
  /** The chat mode and permission level each thread's picker last showed. */
  private readonly selections = new Map<string, string>();
  private readonly delivering = new Map<string, Promise<void>>();
  private rerun = new Set<string>();

  constructor(
    private readonly bb: BbPluginApi,
    private readonly store: Store,
    private readonly projectId: () => Promise<string>,
  ) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS channel_threads (room_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL UNIQUE, title TEXT NOT NULL, delivered_rowid INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS channel_thread_origins (message_id TEXT PRIMARY KEY);`);
  }

  private link(roomId: string): Link | null {
    const row = this.store.db
      .prepare("SELECT room_id AS roomId, thread_id AS threadId, title, delivered_rowid AS deliveredRowid FROM channel_threads WHERE room_id=?")
      .get(roomId) as Link | undefined;
    return row ?? null;
  }

  threadId(roomId: string) {
    return this.link(roomId)?.threadId ?? null;
  }

  roomForThread(threadId: string) {
    const row = this.store.db
      .prepare("SELECT room_id AS roomId FROM channel_threads WHERE thread_id=?")
      .get(threadId) as { roomId: string } | undefined;
    return row ? this.store.findRoom(row.roomId) : null;
  }

  /** A deleted channel takes its thread with it. */
  async forget(roomId: string) {
    const link = this.link(roomId);
    if (!link) return;
    this.store.db.prepare("DELETE FROM channel_threads WHERE room_id=?").run(roomId);
    try {
      await this.bb.sdk.threads.delete({ threadId: link.threadId, childThreadsConfirmed: false });
    } catch (cause) {
      if (!missingThread(cause)) throw cause;
    }
  }

  /** The picker already shows this room's selection: a message just applied it. */
  noteSelection(room: Room) {
    this.selections.set(room.id, selectionKey(room));
  }

  /** A message posted from the channel thread is already visible there. */
  markOrigin(messageId: string) {
    this.store.db.prepare("INSERT OR IGNORE INTO channel_thread_origins VALUES (?)").run(messageId);
  }

  /** The room's thread, created on first use and again if it was deleted. */
  async ensure(room: Room): Promise<string> {
    const existing = this.link(room.id);
    if (existing) {
      try {
        await this.bb.sdk.threads.get({ threadId: existing.threadId });
        return existing.threadId;
      } catch (cause) {
        if (!missingThread(cause)) throw cause;
        this.store.db.prepare("DELETE FROM channel_threads WHERE room_id=?").run(room.id);
      }
    }
    const pending = this.creating.get(room.id);
    if (pending) return pending;
    const created = this.create(room).finally(() => this.creating.delete(room.id));
    this.creating.set(room.id, created);
    return created;
  }

  private async create(room: Room) {
    const config = await this.bb.sdk.system.config();
    if (!config.primaryHostId) throw new Error("BB has no primary machine for channel threads.");
    // Earlier history rides the first input: a separate send can arrive before
    // the new thread has stored its execution settings.
    const history = this.history(room.id);
    const thread = await this.bb.sdk.threads.spawn({
      projectId: await this.projectId(),
      environment: { type: "host", hostId: config.primaryHostId, workspace: { type: "personal" } },
      input: [hiddenInput(history ? deliveryText(history) : channelStartPrefix)],
      title: room.name,
      visibility: "hidden",
      providerId: channelProviderId,
      model: room.responseBehavior ?? "everyone",
      reasoningLevel: levelForPermission(room.permissionMode),
      executionInputSources: { providerId: "explicit", model: "explicit", reasoningLevel: "explicit" },
      pluginMetadata: { channelRoomId: room.id },
    });
    this.store.db
      .prepare("INSERT INTO channel_threads VALUES (?,?,?,?)")
      .run(room.id, thread.id, room.name, this.maxRowid(room.id));
    await this.settled(thread.id);
    return thread.id;
  }

  /**
   * A new thread rejects messages until its first turn has stored its
   * execution settings. Wait for that hidden start turn so the owner's first
   * message is accepted.
   */
  private async settled(threadId: string, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const thread = await this.bb.sdk.threads.get({ threadId });
      if (thread.status === "idle" || thread.status === "error") return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  private maxRowid(roomId: string) {
    const row = this.store.db
      .prepare("SELECT COALESCE(MAX(rowid),0) AS n FROM room_messages WHERE room_id=?")
      .get(roomId) as { n: number };
    return row.n;
  }

  /** One catch-up message for a channel that had history before it became a thread. */
  private history(roomId: string): ChannelDelivery | null {
    const lines = this.store
      .messages(roomId, historyLimit * 2)
      .map((message) => this.delivery(message))
      .filter((delivery): delivery is ChannelDelivery => delivery !== null && delivery.kind !== "system")
      .slice(-historyLimit)
      .map((delivery) => {
        const text = delivery.text.trim();
        const excerpt = text.length > historyExcerpt ? `${text.slice(0, historyExcerpt)}…` : text;
        return `**${delivery.kind === "you" ? "You" : delivery.speaker}:** ${excerpt.replace(/\n+/g, " ")}`;
      });
    if (!lines.length) return null;
    return {
      messageId: `history:${roomId}`,
      kind: "history",
      speaker: "BB",
      avatar: null,
      text: `**Earlier in this channel**\n\n${lines.join("\n\n")}`,
      attachments: [],
    };
  }

  private delivery(message: RoomMessage): ChannelDelivery | null {
    if (message.internalResult) return null;
    if (!message.text.trim() && !message.attachments.length) return null;
    const attachments = message.attachments.map((a) => ({
      name: a.name,
      url: attachmentUrl(a),
      image: a.type === "localImage",
    }));
    if (message.botId) {
      const bots = this.store.all();
      const bot = bots.find((b) => b.id === message.botId);
      const byHandle = new Map(bots.map((b) => [b.handle.toLowerCase(), b.id]));
      return {
        messageId: message.id,
        kind: "bot",
        speaker: `${bot?.name ?? message.speaker}${message.conversationKey && isForkConversation(message.conversationKey) ? " · separate answer" : ""}`,
        avatar: bot?.avatar ?? null,
        // Known @handles render as links that open the bot, like pills in the composer.
        text: linkifyMentions(message.text, (handle) => byHandle.get(handle.toLowerCase()) ?? null),
        attachments,
      };
    }
    return {
      messageId: message.id,
      kind: message.system ? "system" : "you",
      speaker: message.speaker,
      avatar: null,
      text: message.text,
      attachments,
    };
  }

  private async send(threadId: string, delivery: ChannelDelivery) {
    await this.bb.sdk.threads.send({
      threadId,
      mode: "queue-if-active",
      input: [hiddenInput(deliveryText(delivery))],
    });
  }

  /** Deliver every linked room's new messages. Safe to call often. */
  syncAll() {
    for (const row of this.store.db.prepare("SELECT room_id AS roomId FROM channel_threads").all() as { roomId: string }[])
      void this.sync(row.roomId);
  }

  sync(roomId: string): Promise<void> {
    const running = this.delivering.get(roomId);
    if (running) {
      this.rerun.add(roomId);
      return running;
    }
    const task = this.deliver(roomId)
      .catch((cause) => this.bb.log.warn(`Channel thread delivery failed: ${String(cause)}`))
      .finally(() => {
        this.delivering.delete(roomId);
        if (this.rerun.delete(roomId)) void this.sync(roomId);
      });
    this.delivering.set(roomId, task);
    return task;
  }

  private async deliver(roomId: string) {
    const link = this.link(roomId);
    const room = this.store.findRoom(roomId);
    if (!link || !room) return;
    // The picker shows the channel's mode and permissions; follow changes made
    // elsewhere (Channel details, the CLI) and move older threads off the
    // retired "channel" model.
    const selection = selectionKey(room);
    if (this.selections.get(roomId) !== selection) {
      await this.bb.sdk.threads.update({
        threadId: link.threadId,
        model: room.responseBehavior ?? "everyone",
        reasoningLevel: levelForPermission(room.permissionMode),
      });
      this.selections.set(roomId, selection);
    }
    if (link.title !== room.name) {
      await this.bb.sdk.threads.update({ threadId: link.threadId, title: room.name });
      this.store.db.prepare("UPDATE channel_threads SET title=? WHERE room_id=?").run(room.name, roomId);
    }
    const rows = this.store.db
      .prepare("SELECT rowid, json FROM room_messages WHERE room_id=? AND rowid>? ORDER BY rowid")
      .all(roomId, link.deliveredRowid) as { rowid: number; json: string }[];
    for (const row of rows) {
      const message = messageSchema.parse(JSON.parse(row.json));
      const origin = this.store.db
        .prepare("SELECT 1 FROM channel_thread_origins WHERE message_id=?")
        .get(message.id);
      const delivery = origin ? null : this.delivery(message);
      if (delivery) await this.send(link.threadId, delivery);
      this.store.db
        .prepare("UPDATE channel_threads SET delivered_rowid=? WHERE room_id=?")
        .run(row.rowid, roomId);
    }
  }
}

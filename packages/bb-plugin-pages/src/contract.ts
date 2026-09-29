import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export * from "./constants";

// RPC surface for the Pages app. Document content does not go through RPC:
// editors sync over the `/sync` WebSocket (src/hub.ts).

const pageId = z.string().regex(/^pg_[a-f0-9]{12}$/);
const projectId = z.string().min(1).max(200).nullable();

export const refreshSchema = z.object({
  botId: z.string(),
  cron: z.string().min(1).max(120),
  instructions: z.string().max(4000),
  lastAt: z.number().nullable(),
  nextAt: z.number().nullable(),
});

export const pageMetaSchema = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  parentId: z.string().nullable(),
  title: z.string(),
  icon: z.string(),
  position: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  updatedBy: z.string(),
  archived: z.boolean(),
  refresh: refreshSchema.nullable(),
});
export type PageMetaView = z.infer<typeof pageMetaSchema>;

export const botSchema = z.object({
  id: z.string(),
  name: z.string(),
  handle: z.string(),
  avatar: z.string(),
  description: z.string(),
  working: z.boolean(),
});
export type BotView = z.infer<typeof botSchema>;

export const requestSchema = z.object({
  id: z.string(),
  botId: z.string(),
  botName: z.string(),
  threadId: z.string().nullable(),
  kind: z.enum(["mention", "comment", "refresh"]),
  blockId: z.string().nullable(),
  commentThreadId: z.string().nullable(),
  summary: z.string(),
  status: z.enum(["queued", "working", "done", "failed"]),
  error: z.string().nullable(),
  result: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type RequestView = z.infer<typeof requestSchema>;

export const snapshotSchema = z.object({
  id: z.string(),
  label: z.string(),
  actor: z.string(),
  createdAt: z.number(),
});
export type SnapshotView = z.infer<typeof snapshotSchema>;

export const rpcContract = defineRpcContract({
  tree: {
    input: z.object({ projectId }),
    output: z.object({ pages: z.array(pageMetaSchema) }),
  },
  create: {
    input: z.object({
      projectId,
      parentId: pageId.nullable(),
      title: z.string().max(200).default(""),
      icon: z.string().max(16).optional(),
      markdown: z.string().max(200_000).optional(),
    }),
    output: z.object({ page: pageMetaSchema }),
  },
  update: {
    input: z.object({
      id: pageId,
      title: z.string().max(200).optional(),
      icon: z.string().max(16).optional(),
      parentId: pageId.nullable().optional(),
      projectId: projectId.optional(),
      position: z.number().optional(),
      archived: z.boolean().optional(),
    }),
    output: z.object({ page: pageMetaSchema }),
  },
  remove: {
    input: z.object({ id: pageId }),
    output: z.object({ deleted: z.array(z.string()) }),
  },
  get: {
    input: z.object({ id: pageId }),
    output: z.object({ page: pageMetaSchema.nullable() }),
  },
  markdown: {
    input: z.object({ id: pageId }),
    output: z.object({ markdown: z.string() }),
  },
  search: {
    input: z.object({ query: z.string().max(200), projectId: projectId.optional() }),
    output: z.object({ pages: z.array(pageMetaSchema) }),
  },
  bots: {
    input: z.null(),
    output: z.object({ available: z.boolean(), reason: z.string().nullable(), bots: z.array(botSchema) }),
  },
  requests: {
    input: z.object({ pageId }),
    output: z.object({ requests: z.array(requestSchema) }),
  },
  setRefresh: {
    input: z.object({
      id: pageId,
      refresh: z.object({ botId: z.string(), cron: z.string().min(1).max(120), instructions: z.string().max(4000) }).nullable(),
    }),
    output: z.object({ page: pageMetaSchema }),
  },
  refreshNow: {
    input: z.object({ id: pageId }),
    output: z.object({ request: requestSchema }),
  },
  askBot: {
    input: z.object({ id: pageId, botId: z.string(), message: z.string().min(1).max(4000) }),
    output: z.object({ request: requestSchema }),
  },
  snapshots: {
    input: z.object({ id: pageId }),
    output: z.object({ snapshots: z.array(snapshotSchema) }),
  },
  snapshot: {
    input: z.object({ id: pageId, label: z.string().max(120).optional() }),
    output: z.object({ snapshot: snapshotSchema }),
  },
  restore: {
    input: z.object({ snapshotId: z.string() }),
    output: z.object({ ok: z.boolean() }),
  },
});

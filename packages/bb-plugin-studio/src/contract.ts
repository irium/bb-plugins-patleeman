import { defineRpcContract } from "@get-bb/plugin-sdk";
import { studioSchemas } from "@bb-studio/kit/contract";
import { z } from "zod";

export const schemas = studioSchemas(z);

const pluginId = z.string().min(1).max(100);
const ids = z.array(z.string().min(1).max(200)).min(1).max(500);
const projectId = z.string().min(1).max(200).nullable();

const provider = z.object({
  pluginId: z.string(),
  name: z.string(),
  /** ready: listed; outdated: installed without Studio support; offline: not running or failing. */
  state: z.enum(["ready", "outdated", "offline"]),
  detail: z.string().nullable(),
  panel: z.string().nullable(),
  kinds: z.array(schemas.kind),
});
export type ProviderView = z.infer<typeof provider>;

const sidebar = z.object({
  /** Add-on panels Studio can hide, as sidebar item ids (`<plugin>/<panel>`). */
  panels: z.array(z.object({ id: z.string(), label: z.string(), visible: z.boolean() })),
});
export type SidebarView = z.infer<typeof sidebar>;

export const rpcContract = defineRpcContract({
  /** Every provider and all of their items. */
  overview: {
    input: z.null(),
    output: z.object({
      providers: z.array(provider),
      items: z.array(schemas.item.extend({ pluginId: z.string() })),
    }),
  },
  /** `<plugin>:<id>` keys of items whose content matches. */
  search: {
    input: z.object({ query: z.string().min(1).max(200) }),
    output: z.object({ keys: z.array(z.string()) }),
  },
  create: {
    input: z.object({ pluginId, kind: z.string().min(1).max(100), projectId }),
    output: z.object({ item: schemas.item }),
  },
  move: { input: z.object({ pluginId, ids, projectId }), output: schemas.results },
  archive: { input: z.object({ pluginId, ids, archived: z.boolean() }), output: schemas.results },
  remove: { input: z.object({ pluginId, ids }), output: schemas.results },
  action: {
    input: z.object({ pluginId, action: z.string().min(1).max(100), ids }),
    output: z.object({ message: z.string().nullable(), text: z.string().nullable() }),
  },
  /** Add-ons call this when their items change. */
  studio_changed: schemas.changed,
  sidebar: { input: z.null(), output: sidebar },
  setSidebar: { input: z.object({ visible: z.boolean() }), output: sidebar },
});

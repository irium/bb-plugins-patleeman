// bb-plugin-studio server: the hub every Studio add-on plugs into.
//
// - Studio finds add-ons through RPC discovery (src/hub.ts) and fans the
//   collection's requests out to their `studio_*` methods.
// - Add-ons call `studio_changed` when their items change; Studio relays it
//   to open collections over realtime.
// - Studio can hide the add-ons' own sidebar entries, since its collection
//   lists their items (src/sidebar.ts).
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { STUDIO_REALTIME_CHANNEL } from "@bb-studio/kit/contract";
import { relativeTime, untitled } from "@bb-studio/kit/format";
import { z } from "zod";
import { rpcContract, type SidebarView } from "./src/contract";
import { errorText, StudioHub, type HubItem } from "./src/hub";
import { isPanelVisible, withPanelsVisible } from "./src/sidebar";

const ORDER_KEY = "sidebar.pluginPanelOrder";
const VISIBLE_KEY = "sidebar.visiblePluginPanels";
const MAX_LISTED = 100;

export default async function plugin(bb: BbPluginApi) {
  const hub = new StudioHub(bb.sdk);

  const addonPanels = async () =>
    (await hub.providers())
      .filter((provider) => provider.panel)
      .map((provider) => ({ id: `${provider.pluginId}/${provider.panel}`, label: provider.name }));

  const readSidebar = async (): Promise<SidebarView> => {
    const [panels, { preferences }] = await Promise.all([addonPanels(), bb.sdk.system.uiPreferences.list()]);
    const order = preferences[ORDER_KEY].value;
    const visible = preferences[VISIBLE_KEY].value;
    return { panels: panels.map((panel) => ({ ...panel, visible: isPanelVisible(order, visible, panel.id) })) };
  };

  bb.rpc.register(rpcContract, {
    overview: () => hub.overview(),
    search: async ({ query }) => ({ keys: await hub.search(query) }),
    create: ({ pluginId, kind, projectId }) => hub.call(pluginId, "studio_create", { kind, projectId }),
    move: ({ pluginId, ids, projectId }) => hub.call(pluginId, "studio_move", { ids, projectId }),
    archive: ({ pluginId, ids, archived }) => hub.call(pluginId, "studio_archive", { ids, archived }),
    remove: ({ pluginId, ids }) => hub.call(pluginId, "studio_delete", { ids }),
    action: ({ pluginId, action, ids }) => hub.call(pluginId, "studio_action", { action, ids }),
    studio_changed: ({ pluginId }) => {
      bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId });
      return { ok: true };
    },
    sidebar: () => readSidebar(),
    setSidebar: async ({ visible: show }) => {
      const ids = (await addonPanels()).map((panel) => panel.id);
      // Another window can change the sidebar between our read and write; a
      // stale revision fails, so read again and retry once.
      for (let attempt = 0; ; attempt++) {
        const { preferences } = await bb.sdk.system.uiPreferences.list();
        const order = preferences[ORDER_KEY];
        const visible = preferences[VISIBLE_KEY];
        const next = withPanelsVisible(order.value, visible.value, ids, show);
        try {
          if (next.order.length !== order.value.length) {
            await bb.sdk.system.uiPreferences.set({ key: ORDER_KEY, value: next.order, expectedRevision: order.revision });
          }
          await bb.sdk.system.uiPreferences.set({ key: VISIBLE_KEY, value: next.visible, expectedRevision: visible.revision });
          break;
        } catch (error) {
          if (attempt > 0) throw error;
        }
      }
      return readSidebar();
    },
  });

  // Agents --------------------------------------------------------------------

  const itemLine = (item: HubItem, kindLabel: string) =>
    `- ${item.icon ? `${item.icon} ` : ""}${untitled(item.title)} — ${kindLabel}${item.archived ? ", archived" : ""}, ${
      item.projectId ? "project" : "global"
    }, updated ${relativeTime(item.updatedAt)} (${item.href})`;

  const listItems = async (options: { projectId: string | null; all: boolean; kind?: string; query?: string }) => {
    const { providers, items } = await hub.overview();
    const labels = new Map(providers.flatMap((provider) => provider.kinds.map((kind) => [`${provider.pluginId}:${kind.id}`, kind.label])));
    const query = options.query?.trim().toLowerCase();
    const contentKeys = query ? new Set(await hub.search(query)) : null;
    const picked = items
      .filter(
        (item) =>
          !item.archived &&
          (options.all || item.projectId === null || item.projectId === options.projectId) &&
          (!options.kind || item.kind === options.kind) &&
          (!query || untitled(item.title).toLowerCase().includes(query) || contentKeys!.has(`${item.pluginId}:${item.id}`)),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const problems = providers.filter((provider) => provider.state !== "ready").map((provider) => `${provider.name}: ${provider.detail}`);
    return { picked, labels, problems, kinds: providers.flatMap((provider) => provider.kinds.map((kind) => kind.id)) };
  };

  const formatList = ({ picked, labels, problems }: Awaited<ReturnType<typeof listItems>>) => {
    const lines = picked.slice(0, MAX_LISTED).map((item) => itemLine(item, labels.get(`${item.pluginId}:${item.kind}`) ?? item.kind));
    if (picked.length > MAX_LISTED) lines.push(`…and ${picked.length - MAX_LISTED} more. Narrow with a query or kind.`);
    if (!lines.length) lines.push("No Studio items match.");
    if (problems.length) lines.push("", "Unavailable:", ...problems.map((problem) => `- ${problem}`));
    return lines.join("\n");
  };

  bb.agents.registerTool({
    name: "studio_list_items",
    description:
      "List the user's BB Studio items — pages, Talk recordings, drawings and anything else a Studio add-on provides — in this project and global ones, newest first. Each line has a link; open or mention it to work with the item.",
    parameters: z.object({
      query: z.string().max(200).optional().describe("Match titles and content"),
      kind: z.string().max(100).optional().describe("Only this kind, e.g. page, recording, drawing"),
      allProjects: z.boolean().optional().describe("Include every project, not just this one"),
    }),
    async execute({ query, kind, allProjects }, ctx) {
      return formatList(await listItems({ projectId: ctx.projectId ?? null, all: allProjects === true, kind, query }));
    },
  });

  bb.cli.register({
    name: "studio",
    summary: "List BB Studio items across Pages, Talk, Draw and other add-ons",
    commands: [
      { name: "list", summary: "List items in the current project and global ones", usage: "bb studio list [--all] [--kind <kind>] [--query <text>] [--json]" },
      { name: "providers", summary: "Show which Studio add-ons are installed and ready", usage: "bb studio providers" },
    ],
    async run(argv, ctx) {
      const [command, ...rest] = argv;
      const flag = (name: string) => {
        const index = rest.indexOf(name);
        if (index < 0) return false;
        rest.splice(index, 1);
        return true;
      };
      const option = (name: string) => {
        const index = rest.indexOf(name);
        if (index < 0) return undefined;
        const [, value] = rest.splice(index, 2);
        return value;
      };
      try {
        switch (command) {
          case "list": {
            const json = flag("--json");
            const result = await listItems({
              projectId: ctx.projectId ?? null,
              all: flag("--all"),
              kind: option("--kind"),
              query: option("--query"),
            });
            if (json) return { exitCode: 0, stdout: `${JSON.stringify(result.picked.slice(0, MAX_LISTED), null, 2)}\n` };
            return { exitCode: 0, stdout: `${formatList(result)}\n` };
          }
          case "providers": {
            const providers = await hub.providers();
            if (!providers.length) return { exitCode: 0, stdout: "No Studio add-ons installed. Install Studio Pages, Studio Talk or Studio Draw.\n" };
            const lines = providers.map(
              (provider) =>
                `${provider.pluginId}\t${provider.state}\t${provider.kinds.map((kind) => kind.id).join(",") || "-"}${provider.detail ? `\t${provider.detail}` : ""}`,
            );
            return { exitCode: 0, stdout: `${lines.join("\n")}\n` };
          }
          default:
            return { exitCode: 1, stderr: "usage: bb studio <list|providers> …\n" };
        }
      } catch (error) {
        return { exitCode: 1, stderr: `${errorText(error)}\n` };
      }
    },
  });
}

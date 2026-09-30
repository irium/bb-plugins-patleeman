// Artifacts as a Studio add-on: the `studio_*` methods Studio calls to list
// and manage artifacts in its collection.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { eachId, type StudioItem, type StudioKind, type StudioSchemas } from "@bb-studio/kit/contract";
import { registerStudioProvider } from "@bb-studio/kit/server";
import { ARTIFACT_ICON, PLUGIN_ID, TYPE_LABELS, artifactHref, contentUrl, formatBytes, isTextType } from "../shared";
import { displayTitle, versionType, type ArtifactStore, type ArtifactWithVersion } from "./store";

export const ARTIFACT_KIND: StudioKind = {
  id: "artifact",
  label: "Artifact",
  plural: "Artifacts",
  icon: ARTIFACT_ICON,
  columns: [
    { id: "type", label: "Type" },
    { id: "size", label: "Size" },
    { id: "versions", label: "Versions" },
  ],
  actions: [{ id: "copy-text", label: "Copy text", icon: "Copy", result: "copy" }],
  // Artifacts come from threads: agents save them, or you do from a reply.
  create: null,
  canArchive: true,
  blurb: "Files your agents made.",
  agentHint: "Read it with artifacts_read.",
};

const PREVIEW_CHARS = 140;
/** Text past this isn't searched or previewed. */
const TEXT_SCAN_BYTES = 1024 * 1024;

const texts = new Map<string, string | null>();

/** A version's text, for text types under the scan limit. Cached by version. */
export function artifactText(store: ArtifactStore, artifact: ArtifactWithVersion): string | null {
  const { version } = artifact;
  if (texts.has(version.id)) return texts.get(version.id)!;
  let text: string | null = null;
  if (isTextType(versionType(version)) && version.size <= TEXT_SCAN_BYTES) {
    text = store.bytes(version.sha256)?.toString("utf8") ?? null;
  }
  texts.set(version.id, text);
  return text;
}

function preview(store: ArtifactStore, artifact: ArtifactWithVersion): string | null {
  const source = artifact.description.trim() || firstLine(artifactText(store, artifact), displayTitle(artifact));
  if (!source) return null;
  const line = source.replace(/\s+/g, " ").trim();
  return line.length > PREVIEW_CHARS ? `${line.slice(0, PREVIEW_CHARS - 1).trimEnd()}…` : line;
}

/** The first line with words in it that doesn't just repeat the title. */
function firstLine(text: string | null, title: string): string | null {
  if (!text) return null;
  for (const line of text.split("\n")) {
    // Skip markup-only lines like "<!doctype html>" or "---".
    const clean = line.replace(/<[^>]*>/g, "").replace(/^[#>*\-\s`]+/, "").trim();
    if (clean && clean.toLowerCase() !== title.trim().toLowerCase()) return clean;
  }
  return null;
}

export function toStudioItem(store: ArtifactStore, artifact: ArtifactWithVersion): StudioItem {
  const { version } = artifact;
  const type = versionType(version);
  return {
    id: artifact.id,
    kind: ARTIFACT_KIND.id,
    title: displayTitle(artifact),
    icon: null,
    projectId: artifact.project_id,
    parentId: null,
    createdAt: artifact.created_at,
    updatedAt: artifact.updated_at,
    updatedBy: artifact.updated_by === "user" || artifact.updated_by === "agent" ? artifact.updated_by : null,
    preview: preview(store, artifact),
    facts: [
      { id: "type", value: TYPE_LABELS[type], sort: null },
      { id: "size", value: formatBytes(version.size), sort: version.size },
      { id: "versions", value: String(artifact.versions), sort: artifact.versions },
    ],
    badge: null,
    thumbnailUrl: type === "image" ? contentUrl(artifact.id, version.id) : null,
    href: artifactHref(artifact.id),
    archived: artifact.archived_at !== null,
  };
}

export function registerStudio(
  bb: Pick<BbPluginApi, "rpc">,
  schemas: StudioSchemas,
  deps: { store: ArtifactStore; changed(id: string): void },
): void {
  const { store } = deps;
  const mustGet = (id: string) => {
    const artifact = store.get(id);
    if (!artifact) throw new Error("Artifact not found.");
    return artifact;
  };

  registerStudioProvider(bb, schemas, {
    studio_describe: () => ({ pluginId: PLUGIN_ID, version: 1, panel: "artifacts", kinds: [ARTIFACT_KIND] }),
    studio_list: () => ({ items: store.list({ includeArchived: true, limit: 10_000 }).map((a) => toStudioItem(store, a)) }),
    // Studio matches titles itself; this finds descriptions, file names and text.
    studio_search: ({ query }) => {
      const needle = query.toLowerCase();
      return {
        ids: store
          .list({ limit: 10_000 })
          .filter(
            (artifact) =>
              artifact.description.toLowerCase().includes(needle) ||
              artifact.version.name.toLowerCase().includes(needle) ||
              (artifactText(store, artifact)?.toLowerCase().includes(needle) ?? false),
          )
          .slice(0, 200)
          .map((artifact) => artifact.id),
      };
    },
    studio_create: () => {
      throw new Error("Artifacts are saved from threads, not created in Studio.");
    },
    studio_move: ({ ids, projectId }) =>
      eachId(ids, (id) => {
        mustGet(id);
        store.setProject(id, projectId);
        deps.changed(id);
      }),
    studio_archive: ({ ids, archived }) =>
      eachId(ids, (id) => {
        mustGet(id);
        store.setArchived(id, archived);
        deps.changed(id);
      }),
    studio_delete: ({ ids }) =>
      eachId(ids, (id) => {
        mustGet(id);
        store.delete(id);
        deps.changed(id);
      }),
    studio_action: ({ action, ids }) => {
      if (action !== "copy-text") throw new Error(`Unknown action "${action}".`);
      const parts = ids.flatMap((id) => {
        const artifact = mustGet(id);
        const text = artifactText(store, artifact);
        if (text === null) return [];
        return [ids.length === 1 ? text : `## ${displayTitle(artifact)}\n\n${text}`];
      });
      if (!parts.length) return { message: ids.length === 1 ? "This artifact isn't text." : "None of these are text.", text: null };
      return { message: parts.length === 1 ? "Text copied" : `Copied text from ${parts.length} artifacts`, text: parts.join("\n\n") };
    },
  });
}

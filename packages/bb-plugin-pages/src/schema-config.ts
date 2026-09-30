// Custom block and inline-content configs shared by the server schema
// (src/schema-server.ts) and the React editor (components/blocks). Both sides
// must build the same ProseMirror schema, so every custom type's config lives
// here and each side only supplies a renderer.

export const calloutConfig = {
  type: "callout",
  propSchema: {
    tone: { default: "info", values: ["info", "success", "warning", "danger"] as const },
  },
  content: "inline",
} as const;

/** `spec` is ChartSpec JSON (see src/chart-spec.ts). */
export const chartConfig = {
  type: "chart",
  propSchema: {
    spec: { default: "" },
  },
  content: "none",
} as const;

/** `items` is StatItem[] JSON (see src/chart-spec.ts). */
export const statsConfig = {
  type: "stats",
  propSchema: {
    items: { default: "[]" },
  },
  content: "none",
} as const;

export const EMBED_KINDS = ["thread", "page", "bookmark", "drawing"] as const;
export type EmbedKind = (typeof EMBED_KINDS)[number];

export const embedConfig = {
  type: "embed",
  propSchema: {
    kind: { default: "bookmark", values: EMBED_KINDS },
    target: { default: "" },
    title: { default: "" },
    description: { default: "" },
    /** A bookmark's preview image URL. */
    image: { default: "" },
  },
  content: "none",
} as const;

export const MENTION_KINDS = ["bot", "page", "thread", "date", "agent"] as const;
export type MentionKind = (typeof MENTION_KINDS)[number];

export const mentionConfig = {
  type: "mention",
  propSchema: {
    kind: { default: "bot", values: MENTION_KINDS },
    target: { default: "" },
    label: { default: "" },
  },
  content: "none",
} as const;

/** The Y.XmlFragment the editor binds to; comments live in THREADS_MAP. */
export const DOCUMENT_FRAGMENT = "document";
export const THREADS_MAP = "threads";

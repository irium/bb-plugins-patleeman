import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs } from "@blocknote/core";
import { createReactBlockSpec, createReactInlineContentSpec } from "@blocknote/react";
import { useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { chartSpecSchema, parseJsonWith, resolveChart, statItemsSchema, type StatItem } from "../chart-spec";
import { calloutConfig, chartConfig, embedConfig, mentionConfig, statsConfig } from "../schema-config";
import { usePagesUi } from "./context";

// React renderers for the custom blocks. Configs come from schema-config.ts so
// the editor schema matches the server's (src/schema-server.ts).

const TONES = {
  info: { icon: "Info", className: "border-sky-500/30 bg-sky-500/8", iconClass: "text-sky-500" },
  success: { icon: "CircleCheck", className: "border-emerald-500/30 bg-emerald-500/8", iconClass: "text-emerald-500" },
  warning: { icon: "AlertTriangle", className: "border-amber-500/35 bg-amber-500/10", iconClass: "text-amber-500" },
  danger: { icon: "AlertCircle", className: "border-red-500/30 bg-red-500/8", iconClass: "text-red-500" },
} as const;
const TONE_ORDER = ["info", "success", "warning", "danger"] as const;

export const SERIES_COLORS = ["#6366f1", "#14b8a6", "#f59e0b", "#ec4899", "#0ea5e9", "#84cc16", "#a855f7", "#ef4444"];

const Callout = createReactBlockSpec(calloutConfig, {
  render: ({ block, editor, contentRef }) => {
    const tone = TONES[block.props.tone];
    return (
      <div className={cn("pages-callout my-1 flex w-full gap-2.5 rounded-lg border px-3 py-2.5", tone.className)}>
        <button
          type="button"
          contentEditable={false}
          title="Change callout style"
          className={cn("mt-0.5 h-5 w-5 shrink-0 cursor-pointer", tone.iconClass)}
          onClick={() => {
            const next = TONE_ORDER[(TONE_ORDER.indexOf(block.props.tone) + 1) % TONE_ORDER.length]!;
            editor.updateBlock(block, { props: { tone: next } });
          }}
        >
          <Icon name={tone.icon} className="size-4" />
        </button>
        <div className="min-w-0 flex-1" ref={contentRef} />
      </div>
    );
  },
});

/** A data block with a rendered view and a JSON source editor. */
function DataBlock({
  label,
  source,
  editable,
  onSave,
  error,
  children,
}: {
  label: string;
  source: string;
  editable: boolean;
  onSave(next: string): string | null;
  error: string | null;
  children: ReactNode;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  return (
    <div className="pages-data group/data relative my-1 w-full rounded-lg border border-border bg-card/50 p-3" contentEditable={false}>
      {editable && draft === null ? (
        <button
          type="button"
          className="absolute top-2 right-2 z-10 rounded-md border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground opacity-0 transition-opacity group-hover/data:opacity-100 hover:text-foreground"
          onClick={() => {
            setDraft(prettyJson(source));
            setDraftError(null);
          }}
        >
          Edit {label}
        </button>
      ) : null}
      {draft !== null ? (
        <div className="flex flex-col gap-2">
          <textarea
            className="min-h-48 w-full resize-y rounded-md border border-border bg-background p-2 font-mono text-xs"
            value={draft}
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
          {draftError ? <p className="text-xs text-red-500">{draftError}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="rounded-md bg-foreground px-2 py-1 text-xs text-background"
              onClick={() => {
                const problem = onSave(draft);
                if (problem) setDraftError(problem);
                else setDraft(null);
              }}
            >
              Save
            </button>
          </div>
        </div>
      ) : error ? (
        <p className="text-sm text-red-500">
          This {label} has invalid data: {error}
        </p>
      ) : (
        children
      )}
    </div>
  );
}

const prettyJson = (text: string) => {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
};

const EXAMPLE_CHART = JSON.stringify({
  type: "bar",
  title: "Example",
  data: [
    { label: "Mon", Value: 4 },
    { label: "Tue", Value: 7 },
    { label: "Wed", Value: 5 },
  ],
});

function ChartView({ spec }: { spec: string }) {
  const parsed = parseJsonWith(chartSpecSchema, spec || EXAMPLE_CHART);
  if (!parsed.ok) return <p className="text-sm text-red-500">{parsed.error}</p>;
  const { spec: chart, x, series } = resolveChart(parsed.value);
  const axis = { stroke: "currentColor", fontSize: 11, tickLine: false, axisLine: false } as const;
  const tooltip = (
    <Tooltip
      contentStyle={{ background: "var(--popover, #111)", border: "1px solid var(--border, #333)", borderRadius: 8, fontSize: 12 }}
      formatter={(value) => `${value}${chart.unit ?? ""}`}
    />
  );
  const common = { data: chart.data, margin: { top: 8, right: 8, bottom: 0, left: -16 } };
  let body: ReactNode;
  if (chart.type === "pie") {
    const key = series[0] ?? "value";
    body = (
      <PieChart>
        <Pie data={chart.data} dataKey={key} nameKey={x} innerRadius="45%" outerRadius="80%" paddingAngle={2} isAnimationActive={false}>
          {chart.data.map((_, index) => (
            <Cell key={index} fill={SERIES_COLORS[index % SERIES_COLORS.length]} />
          ))}
        </Pie>
        {tooltip}
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    );
  } else {
    const Chart = chart.type === "line" ? LineChart : chart.type === "area" ? AreaChart : BarChart;
    body = (
      <Chart {...common}>
        <CartesianGrid vertical={false} strokeOpacity={0.12} />
        <XAxis dataKey={x} {...axis} />
        <YAxis {...axis} />
        {tooltip}
        {series.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
        {series.map((key, index) => {
          const color = SERIES_COLORS[index % SERIES_COLORS.length]!;
          const stack = chart.stacked ? "stack" : undefined;
          if (chart.type === "line") return <Line key={key} dataKey={key} stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />;
          if (chart.type === "area")
            return <Area key={key} dataKey={key} stroke={color} fill={color} fillOpacity={0.18} stackId={stack} isAnimationActive={false} />;
          return <Bar key={key} dataKey={key} fill={color} radius={[3, 3, 0, 0]} stackId={stack} isAnimationActive={false} />;
        })}
      </Chart>
    );
  }
  return (
    <figure className="m-0 text-muted-foreground">
      {chart.title ? <figcaption className="mb-2 text-sm font-medium text-foreground">{chart.title}</figcaption> : null}
      <div className="h-60 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {body as never}
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

const ChartBlock = createReactBlockSpec(chartConfig, {
  render: ({ block, editor }) => (
    <DataBlock
      label="chart"
      source={block.props.spec || EXAMPLE_CHART}
      editable={editor.isEditable}
      error={null}
      onSave={(next) => {
        const parsed = parseJsonWith(chartSpecSchema, next);
        if (!parsed.ok) return parsed.error;
        editor.updateBlock(block, { props: { spec: JSON.stringify(parsed.value) } });
        return null;
      }}
    >
      <ChartView spec={block.props.spec} />
    </DataBlock>
  ),
});

const EXAMPLE_STATS = JSON.stringify([
  { label: "Metric", value: "42", delta: "+5%", trend: "up" },
  { label: "Another", value: "7", delta: "-1", trend: "down" },
]);

function StatsView({ items }: { items: StatItem[] }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(items.length, 4)}, minmax(0, 1fr))` }}>
      {items.map((item, index) => (
        <div key={index} className="min-w-0 rounded-md bg-background/60 px-3 py-2">
          <div className="truncate text-xs text-muted-foreground">{item.label}</div>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="truncate text-xl font-semibold tabular-nums text-foreground">{item.value}</span>
            {item.delta ? (
              <span
                className={cn(
                  "text-xs tabular-nums",
                  item.trend === "up" ? "text-emerald-500" : item.trend === "down" ? "text-red-500" : "text-muted-foreground",
                )}
              >
                {item.delta}
              </span>
            ) : null}
          </div>
          {item.caption ? <div className="mt-0.5 truncate text-xs text-muted-foreground">{item.caption}</div> : null}
        </div>
      ))}
    </div>
  );
}

const StatsBlock = createReactBlockSpec(statsConfig, {
  render: ({ block, editor }) => {
    const source = block.props.items && block.props.items !== "[]" ? block.props.items : EXAMPLE_STATS;
    const parsed = parseJsonWith(statItemsSchema, source);
    return (
      <DataBlock
        label="stats"
        source={source}
        editable={editor.isEditable}
        error={parsed.ok ? null : parsed.error}
        onSave={(next) => {
          const result = parseJsonWith(statItemsSchema, next);
          if (!result.ok) return result.error;
          editor.updateBlock(block, { props: { items: JSON.stringify(result.value) } });
          return null;
        }}
      >
        {parsed.ok ? <StatsView items={parsed.value} /> : null}
      </DataBlock>
    );
  },
});

const EMBED_ICONS = { thread: "MessageSquare", page: "FileText", bookmark: "ExternalLink", drawing: "Palette" } as const;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function EmbedView({ kind, target, title, description, onEdit }: {
  kind: keyof typeof EMBED_ICONS;
  target: string;
  title: string;
  description: string;
  onEdit?: (target: string) => void;
}) {
  const ui = usePagesUi();
  const [editing, setEditing] = useState(!target);
  const [draft, setDraft] = useState(target);
  const page = kind === "page" ? ui.pages.find((candidate) => candidate.id === target) : undefined;
  const heading = title || page?.title || (kind === "bookmark" ? hostOf(target) : target) || "Embed";
  const sub = description || (kind === "bookmark" ? target : kind === "page" ? "Page" : kind === "thread" ? "Thread" : "Drawing");

  if (editing && onEdit) {
    return (
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onEdit(draft.trim());
          setEditing(false);
        }}
      >
        <input
          autoFocus
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm"
          placeholder={kind === "bookmark" ? "Paste a link…" : kind === "thread" ? "Thread id (thr_…)" : "Page id (pg_…)"}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
        />
        <button type="submit" className="rounded-md bg-foreground px-3 text-xs text-background">
          Embed
        </button>
      </form>
    );
  }
  return (
    <button
      type="button"
      className="flex w-full cursor-pointer items-center gap-3 text-left"
      onClick={() => {
        if (kind === "page") ui.openPage(target);
        else if (kind === "thread") ui.openThread(target);
        else if (/^https?:\/\//.test(target)) ui.openUrl(target);
      }}
      onDoubleClick={() => onEdit && setEditing(true)}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
        {page?.icon ? <span className="text-lg">{page.icon}</span> : <Icon name={EMBED_ICONS[kind]} className="size-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{heading}</span>
        <span className="block truncate text-xs text-muted-foreground">{sub}</span>
      </span>
      <Icon name="ArrowUpRight" className="size-4 text-muted-foreground" />
    </button>
  );
}

const EmbedBlock = createReactBlockSpec(embedConfig, {
  render: ({ block, editor }) => (
    <div className="pages-embed my-1 w-full rounded-lg border border-border bg-card/50 p-2" contentEditable={false}>
      <EmbedView
        kind={block.props.kind}
        target={block.props.target}
        title={block.props.title}
        description={block.props.description}
        onEdit={editor.isEditable ? (target) => editor.updateBlock(block, { props: { target, title: "", description: "" } }) : undefined}
      />
    </div>
  ),
});

const MENTION_ICONS = { bot: "Bot", page: "FileText", thread: "MessageSquare", date: "Calendar", agent: "AiBrain01" } as const;

export function formatMentionDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function MentionChip({ kind, target, label }: { kind: keyof typeof MENTION_ICONS; target: string; label: string }) {
  const ui = usePagesUi();
  const bot = kind === "bot" ? ui.bots.find((candidate) => candidate.id === target) : undefined;
  const page = kind === "page" ? ui.pages.find((candidate) => candidate.id === target) : undefined;
  const text = kind === "date" ? formatMentionDate(target) : (bot?.name ?? page?.title ?? label) || target;
  return (
    <span
      className={cn(
        "pages-mention inline-flex cursor-pointer items-center gap-1 rounded px-1 align-baseline font-medium",
        kind === "bot" ? "bg-violet-500/12 text-violet-600 dark:text-violet-300" : "bg-foreground/6 text-foreground",
      )}
      data-kind={kind}
      onClick={() => {
        if (kind === "page") ui.openPage(target);
        else if (kind === "thread") ui.openThread(target);
      }}
    >
      {bot ? <span>{bot.avatar}</span> : page?.icon ? <span>{page.icon}</span> : <Icon name={MENTION_ICONS[kind]} className="size-3.5 opacity-70" />}
      {kind === "bot" ? `@${text}` : text}
    </span>
  );
}

const Mention = createReactInlineContentSpec(mentionConfig, {
  render: ({ inlineContent }) => (
    <MentionChip kind={inlineContent.props.kind} target={inlineContent.props.target} label={inlineContent.props.label} />
  ),
});

export const pageSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    callout: Callout(),
    chart: ChartBlock(),
    stats: StatsBlock(),
    embed: EmbedBlock(),
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    mention: Mention,
  },
});

export type PageSchema = typeof pageSchema;

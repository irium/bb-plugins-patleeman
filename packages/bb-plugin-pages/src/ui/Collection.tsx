import { useEffect, useMemo, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { BotView, PageMetaView } from "../contract";
import { actorName, editedByAgent, IconTile, PageMenu, relativeTime, type Project, type Rpc } from "./shared";

type Filter = "all" | "you" | "agents" | "updated" | "archived";
type View = "list" | "grid";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "you", label: "Edited by you" },
  { id: "agents", label: "Edited by agents" },
  { id: "updated", label: "Kept updated" },
  { id: "archived", label: "Archived" },
];
const VIEW_KEY = "bb-pages:view";
const PROJECT_KEY = "bb-pages:project-filter";
/** Project filter values besides a project id. */
const ALL_PROJECTS = "all";
const GLOBAL = "global";

const matchesFilter = (page: PageMetaView, filter: Filter) => {
  if (filter === "archived") return page.archived;
  if (page.archived) return false;
  if (filter === "you") return page.updatedBy === "user";
  if (filter === "agents") return editedByAgent(page.updatedBy);
  if (filter === "updated") return Boolean(page.refresh);
  return true;
};

export function Collection({
  pages,
  error,
  projects,
  defaultProjectId,
  bots,
  rpc,
  onOpen,
  onCreate,
  onChanged,
}: {
  pages: PageMetaView[] | null;
  error: string | null;
  projects: Project[];
  defaultProjectId: string | null;
  bots: BotView[];
  rpc: Rpc;
  onOpen(id: string): void;
  onCreate(projectId: string | null): Promise<void>;
  onChanged(): void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [project, setProject] = useState(() => localStorage.getItem(PROJECT_KEY) ?? ALL_PROJECTS);
  const [view, setView] = useState<View>(() => (localStorage.getItem(VIEW_KEY) === "grid" ? "grid" : "list"));
  // Page ids whose content matches the search, beyond title matches.
  const [contentMatches, setContentMatches] = useState<Set<string>>(() => new Set());

  useEffect(() => localStorage.setItem(PROJECT_KEY, project), [project]);
  useEffect(() => localStorage.setItem(VIEW_KEY, view), [view]);
  useEffect(() => {
    const text = query.trim();
    if (!text) {
      setContentMatches(new Set());
      return;
    }
    const timer = setTimeout(() => {
      rpc.call("search", { query: text }).then(
        (result) => setContentMatches(new Set(result.pages.map((page) => page.id))),
        () => {},
      );
    }, 150);
    return () => clearTimeout(timer);
  }, [rpc, query]);

  const projectName = (id: string | null) => (id ? (projects.find((candidate) => candidate.id === id)?.name ?? "Project") : "Global");
  const byId = useMemo(() => new Map((pages ?? []).map((page) => [page.id, page])), [pages]);
  const shown = useMemo(() => {
    const text = query.trim().toLowerCase();
    return (pages ?? [])
      .filter((page) => matchesFilter(page, filter))
      .filter((page) => (project === ALL_PROJECTS ? true : project === GLOBAL ? !page.projectId : page.projectId === project))
      .filter((page) => !text || (page.title || "Untitled").toLowerCase().includes(text) || contentMatches.has(page.id))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [pages, filter, project, query, contentMatches]);

  // New pages land in the filtered project, else the one BB has open.
  const newPageProject = project === GLOBAL ? null : project === ALL_PROJECTS ? defaultProjectId : project;
  const newPage = (
    <button
      type="button"
      className="flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-foreground px-4 text-sm font-medium text-background hover:bg-foreground/90"
      onClick={() => void onCreate(newPageProject)}
    >
      <Icon name="Plus" className="size-4" /> New page
    </button>
  );

  const rowMenu = (page: PageMetaView) => (
    <PageMenu
      page={page}
      rpc={rpc}
      projects={projects}
      onChanged={onChanged}
      triggerClassName="pages-reveal rounded-md p-1 text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:bg-state-hover hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100"
    />
  );
  const parentLine = (page: PageMetaView) => {
    const parent = page.parentId ? byId.get(page.parentId) : undefined;
    return parent ? `in ${parent.icon ? `${parent.icon} ` : ""}${parent.title || "Untitled"}` : null;
  };

  return (
    <div className="pages-root h-full overflow-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-5xl px-10 pt-14 pb-20 max-md:px-4 max-md:pt-6">
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight">Pages</h1>
        <div className="mt-6 flex items-center gap-2">
          <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm focus-within:border-foreground/30 md:max-w-sm">
            <Icon name="Search" className="size-4 shrink-0 text-muted-foreground" />
            <input
              aria-label="Search pages"
              placeholder="Search pages"
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query ? (
              <button type="button" aria-label="Clear search" className="text-muted-foreground hover:text-foreground" onClick={() => setQuery("")}>
                <Icon name="X" className="size-3.5" />
              </button>
            ) : null}
          </label>
          <div className="ml-auto flex items-center gap-2">
            <div className="flex rounded-md border border-border p-0.5 max-md:hidden" role="group" aria-label="Layout">
              {(["list", "grid"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-label={option === "list" ? "List view" : "Grid view"}
                  aria-pressed={view === option}
                  className="flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground aria-pressed:bg-state-active aria-pressed:text-foreground"
                  onClick={() => setView(option)}
                >
                  <Icon name={option === "list" ? "ListView" : "GridView"} className="size-4" />
                </button>
              ))}
            </div>
            {newPage}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-1.5 max-md:-mx-4 max-md:flex-nowrap max-md:overflow-x-auto max-md:px-4">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={filter === option.id}
              className="h-8 shrink-0 rounded-md px-3 text-sm text-muted-foreground hover:bg-state-hover hover:text-foreground aria-pressed:bg-state-active aria-pressed:text-foreground"
              onClick={() => setFilter(option.id)}
            >
              {option.label}
            </button>
          ))}
          <span className="mx-1 h-4 w-px shrink-0 bg-border" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Filter by project"
                className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border px-3 text-sm text-muted-foreground hover:bg-state-hover hover:text-foreground"
              >
                <Icon name="Folder" className="size-3.5" />
                <span className="max-w-40 truncate">{project === ALL_PROJECTS ? "All projects" : project === GLOBAL ? "Global" : projectName(project)}</span>
                <Icon name="ChevronDown" className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-auto">
              {[
                { id: ALL_PROJECTS, name: "All projects" },
                { id: GLOBAL, name: "Global" },
              ].map((option) => (
                <DropdownMenuItem key={option.id} onSelect={() => setProject(option.id)}>
                  {option.name}
                  {project === option.id ? <Icon name="Check" className="ml-auto size-3.5" /> : null}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              {projects.map((candidate) => (
                <DropdownMenuItem key={candidate.id} onSelect={() => setProject(candidate.id)}>
                  <span className="truncate">{candidate.name}</span>
                  {project === candidate.id ? <Icon name="Check" className="ml-auto size-3.5" /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="mt-6">
          {error ? <p className="text-sm text-red-500">{error}</p> : null}
          {pages === null && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
          {pages !== null && !pages.length ? (
            <div className="flex flex-col items-center gap-3 py-24 text-center">
              <Icon name="FileText" className="size-8 text-muted-foreground" />
              <h2 className="text-lg font-semibold">No pages yet</h2>
              <p className="max-w-sm text-sm text-muted-foreground">
                Write specs, plans and notes with your agents. They read and edit a page while you watch.
              </p>
              {newPage}
            </div>
          ) : pages !== null && !shown.length ? (
            <p className="py-16 text-center text-sm text-muted-foreground">No pages match.</p>
          ) : null}

          {shown.length && view === "grid" ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3 max-md:hidden">
              {shown.map((page) => (
                <div
                  key={page.id}
                  role="link"
                  tabIndex={0}
                  aria-label={page.title || "Untitled"}
                  className="group/row flex cursor-pointer flex-col gap-3 rounded-lg border border-border p-4 hover:bg-state-hover"
                  onClick={() => onOpen(page.id)}
                  onKeyDown={(event) => event.key === "Enter" && onOpen(page.id)}
                >
                  <div className="flex items-start justify-between">
                    <IconTile page={page} size="lg" />
                    {rowMenu(page)}
                  </div>
                  <div className="min-w-0">
                    <div className={cn("truncate font-medium", !page.title && "text-muted-foreground")}>{page.title || "Untitled"}</div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {projectName(page.projectId)} · {relativeTime(page.updatedAt)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {shown.length ? (
            <div role="table" aria-label="Pages" className={cn("text-sm", view === "grid" && "md:hidden")}>
              <div
                role="row"
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,180px)_170px] gap-4 border-b border-border px-2 pb-2 text-xs text-muted-foreground max-md:hidden"
              >
                <span role="columnheader">Name</span>
                <span role="columnheader">Project</span>
                <span role="columnheader">Last activity</span>
              </div>
              {shown.map((page) => (
                <div
                  key={page.id}
                  role="row"
                  tabIndex={0}
                  aria-label={page.title || "Untitled"}
                  className="group/row grid cursor-pointer grid-cols-[minmax(0,1fr)_minmax(0,180px)_170px] items-center gap-4 rounded-lg px-2 py-2 hover:bg-state-hover max-md:grid-cols-[minmax(0,1fr)_auto] max-md:py-2.5"
                  onClick={() => onOpen(page.id)}
                  onKeyDown={(event) => event.key === "Enter" && onOpen(page.id)}
                >
                  <div role="cell" className="flex min-w-0 items-center gap-3">
                    <IconTile page={page} />
                    <div className="min-w-0">
                      <div className={cn("flex items-center gap-1.5 font-medium", !page.title && "text-muted-foreground")}>
                        <span className="truncate">{page.title || "Untitled"}</span>
                        {page.refresh ? <Icon name="Repeat" className="size-3 shrink-0 text-muted-foreground" aria-label="Kept updated" /> : null}
                      </div>
                      {parentLine(page) ? <div className="truncate text-xs text-muted-foreground">{parentLine(page)}</div> : null}
                      <div className="truncate text-xs text-muted-foreground md:hidden">
                        {projectName(page.projectId)} · {relativeTime(page.updatedAt)}
                      </div>
                    </div>
                  </div>
                  <div role="cell" className="truncate text-muted-foreground max-md:hidden">
                    {projectName(page.projectId)}
                  </div>
                  <div role="cell" className="flex min-w-0 items-center justify-between gap-2 text-muted-foreground max-md:justify-end">
                    <span className="truncate max-md:hidden" title={`Edited by ${actorName(page.updatedBy, bots)}`}>
                      {relativeTime(page.updatedAt)}
                    </span>
                    {rowMenu(page)}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

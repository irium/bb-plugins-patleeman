import { createContext, useContext } from "react";
import type { BotView, PageMetaView } from "../contract";

/** What block and mention renderers need from the surrounding Pages UI. */
export interface PagesUi {
  pages: PageMetaView[];
  bots: BotView[];
  openPage(pageId: string): void;
  openThread(threadId: string): void;
  openUrl(url: string): void;
}

export const PagesUiContext = createContext<PagesUi>({
  pages: [],
  bots: [],
  openPage: () => {},
  openThread: () => {},
  openUrl: (url) => void window.open(url, "_blank", "noopener"),
});

export const usePagesUi = () => useContext(PagesUiContext);

/** Display name and colour for a comment/cursor author id. */
export function authorInfo(id: string, bots: BotView[]): { name: string; avatar: string } {
  if (id === "user") return { name: "You", avatar: "" };
  if (id.startsWith("bot:")) {
    const bot = bots.find((candidate) => candidate.id === id.slice(4));
    return { name: bot?.name ?? "Bot", avatar: bot?.avatar ?? "🤖" };
  }
  if (id.startsWith("agent:")) return { name: "Agent", avatar: "✨" };
  return { name: id, avatar: "" };
}

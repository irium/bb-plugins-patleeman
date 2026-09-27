import { useCallback, useSyncExternalStore } from "react";
import { readDraft } from "./draft";

const eventName = "bot-teams:channel-draft-changed";
const draftKey = (roomId: string) => `bb:bots:draft:${roomId}`;

export function notifyChannelDraftChanged(roomId: string) {
  window.dispatchEvent(new CustomEvent(eventName, { detail: roomId }));
}

export function useChannelDraft(roomId: string) {
  const snapshot = useCallback(() => {
    const draft = readDraft(localStorage, draftKey(roomId));
    return !!(draft.text.trim() || draft.attachments.length ||
      draft.handoffSource || draft.reply);
  }, [roomId]);
  const subscribe = useCallback((listener: () => void) => {
    const changed = (event: Event) => {
      if ((event as CustomEvent<string>).detail === roomId) listener();
    };
    const storageChanged = (event: StorageEvent) => {
      if (event.key === draftKey(roomId)) listener();
    };
    window.addEventListener(eventName, changed);
    window.addEventListener("storage", storageChanged);
    window.addEventListener("focus", listener);
    return () => {
      window.removeEventListener(eventName, changed);
      window.removeEventListener("storage", storageChanged);
      window.removeEventListener("focus", listener);
    };
  }, [roomId]);
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

import { useCallback, useSyncExternalStore } from "react";

const drafts = new Map<string, boolean>();
const listeners = new Set<() => void>();

export function setDirectDraft(threadId: string, hasDraft: boolean) {
  if ((drafts.get(threadId) ?? false) === hasDraft) return;
  drafts.set(threadId, hasDraft);
  for (const listener of listeners) listener();
}

export function useDirectDraft(threadId: string) {
  const subscribe = useCallback((listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);
  const snapshot = useCallback(() => drafts.get(threadId) ?? false, [threadId]);
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

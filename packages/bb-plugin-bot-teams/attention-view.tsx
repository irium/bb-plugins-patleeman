import { useCallback, useEffect, useRef, useState } from "react";
import {
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { Attention, AttentionView, rpcContract } from "./contract";
import { message } from "./bot-ui";

export function useAttention(
  status: Attention["status"] = "open",
  limit = 30,
  offset = 0,
  channelId?: string,
) {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [data, setData] = useState<{
    items: AttentionView[];
    openCount: number;
    nextOffset: number | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const load = useCallback(() => {
    const seq = ++sequence.current;
    return rpc
      .call("attentionList", {
        status,
        limit,
        offset,
        ...(channelId ? { channelId } : {}),
      })
      .then(
        (result) => {
          if (seq === sequence.current) {
            setData(result);
            setError(null);
          }
        },
        (cause) => {
          if (seq === sequence.current) setError(message(cause));
        },
      );
  }, [rpc, status, limit, offset, channelId]);
  useEffect(() => {
    setData(null);
    void load();
    return () => {
      sequence.current++;
    };
  }, [load]);
  useEffect(() => {
    if (connection === "connected") void load();
  }, [connection, load]);
  useRealtime("changed", load);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "hidden") void load();
    };
    const timer = setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);
  return { data, error, load };
}

export const attentionReasons = {
  decision: "Decision needed",
  blocker: "Blocked",
  update: "Important update",
};

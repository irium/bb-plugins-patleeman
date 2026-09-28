import { z } from "zod";

/** A channel is a BB thread on this provider. Bot Teams creates these threads; the model picker never lists it. */
export const channelProviderId = "bot-teams-channel";
export const channelModelId = "channel";
export const channelPostTool = "bots_channel_thread_post";

/** Hidden thread input: Bot Teams hands the bridge a stored channel message to show. */
export const channelDeliverPrefix = "[bot-teams:channel-deliver]";
/** Hidden thread input: wakes a new channel thread without a visible message. */
export const channelStartPrefix = "[bot-teams:channel-start]";

export const channelModel = {
  id: channelModelId,
  displayName: "Channel",
  description: "Routes messages to the channel's bots.",
  supportedReasoningEfforts: [{ reasoningEffort: "none", description: "None" }],
  defaultReasoningEffort: "none",
  isDefault: true,
} as const;

export const channelDeliverySchema = z.object({
  messageId: z.string(),
  kind: z.enum(["bot", "you", "system", "history"]),
  speaker: z.string(),
  avatar: z.string().nullable(),
  text: z.string(),
  attachments: z
    .array(z.object({ name: z.string(), path: z.string(), image: z.boolean() }))
    .default([]),
});
export type ChannelDelivery = z.infer<typeof channelDeliverySchema>;

export const channelPostInput = z.object({
  text: z.string().max(16000),
  attachments: z
    .array(
      z.object({
        path: z.string().min(1).max(4096),
        name: z.string().max(255).optional(),
        mimeType: z.string().max(255).optional(),
        sizeBytes: z.number().nonnegative().optional(),
        image: z.boolean(),
      }),
    )
    .max(10)
    .default([]),
});

/** The assistant text a delivery shows as. Assistant messages have no author, so the speaker leads the body. */
export function deliveryMarkdown(delivery: ChannelDelivery) {
  const files = delivery.attachments.map(
    (file) => `- [${file.name.replace(/[[\]]/g, "")}](<${file.path}>)`,
  );
  const body = [delivery.text.trim(), files.join("\n")].filter(Boolean).join("\n\n");
  switch (delivery.kind) {
    case "bot":
      return `**${delivery.avatar ? `${delivery.avatar} ` : ""}${delivery.speaker}**\n\n${body}`;
    case "you":
      return `**You** · sent outside this thread\n\n${body}`;
    case "system":
      return `_${body}_`;
    case "history":
      return body;
  }
}

import { env } from "../config/env.js";

/**
 * ntfy publishing — the transport behind the editorial push notifications
 * (lib/queue-notifier.ts). One POST per message to the topic named by
 * NTFY_TOPIC; the editor subscribes to that topic in the ntfy app. Optional by
 * design: with no topic configured, callers skip notifying entirely.
 *
 * Messages go out in ntfy's JSON publishing format rather than through the
 * X-Title/X-Tags headers: the copy is Finnish, and an HTTP header value is no
 * place for "ä".
 */

export const ntfyConfigured = Boolean(env.NTFY_TOPIC);

/** A stalled publish must not hold up the notifier's poll loop. */
const PUBLISH_TIMEOUT_MS = 10_000;

export interface NtfyMessage {
  title: string;
  message: string;
  /** ntfy priority 1–5; 4 = high, which sounds and vibrates on a phone. */
  priority?: number;
  /** Emoji shortcodes rendered before the title. */
  tags?: string[];
  /** Opened when the notification is tapped. */
  click?: string;
}

/** Publish one message. Throws on a transport error or a non-2xx reply. */
export async function publishNtfy(msg: NtfyMessage): Promise<void> {
  if (!ntfyConfigured) throw new Error("ntfy publish requested without NTFY_TOPIC configured");
  const res = await fetch(env.NTFY_SERVER, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(env.NTFY_TOKEN ? { authorization: `Bearer ${env.NTFY_TOKEN}` } : {}),
    },
    body: JSON.stringify({ topic: env.NTFY_TOPIC, ...msg }),
    signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
  });
  // Read the body on failure — ntfy explains rejections (bad topic, rate limit)
  // in plain text, and the status alone rarely says which.
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ntfy publish failed: ${res.status} ${detail.trim()}`.trim());
  }
}

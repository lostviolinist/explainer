/**
 * Verify a Hedra completion webhook.
 *
 * Headers: X-Hedra-Webhook-Signature (hex ed25519), X-Hedra-Webhook-Id (= job id),
 * X-Hedra-Webhook-Timestamp, X-Hedra-Webhook-Event, X-Hedra-Webhook-Redelivery.
 * Canonical string: timestamp \n id \n event \n redelivery \n sha256hex(rawBody).
 * Public key from GET /webhooks/public-key. Reject timestamps older than 5 minutes.
 */
import { createHash, verify as edVerify, createPublicKey } from "node:crypto";

export interface WebhookHeaders {
  signature: string;
  id: string;
  timestamp: string;
  event: string;
  redelivery: string;
}

export function verifyHedraWebhook(
  rawBody: Uint8Array,
  h: WebhookHeaders,
  publicKeyPem: string,
  nowMs = Date.now(),
): { ok: boolean; reason?: string } {
  const ts = Date.parse(h.timestamp) || Number(h.timestamp) * 1000;
  if (!Number.isFinite(ts) || Math.abs(nowMs - ts) > 5 * 60 * 1000) {
    return { ok: false, reason: "stale timestamp" };
  }
  const digest = createHash("sha256").update(rawBody).digest("hex");
  const canonical = [h.timestamp, h.id, h.event, h.redelivery, digest].join("\n");
  try {
    const key = createPublicKey(publicKeyPem);
    const ok = edVerify(null, Buffer.from(canonical), key, Buffer.from(h.signature, "hex"));
    return ok ? { ok } : { ok, reason: "bad signature" };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

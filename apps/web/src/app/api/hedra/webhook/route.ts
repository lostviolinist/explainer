/**
 * Hedra completion webhook. We poll as well, so this only has to be a fast
 * acknowledgement after signature verification; the pipeline picks up the
 * result on its next poll. Kept as a hook point for a future "wake the step
 * early" optimisation via an Inngest event.
 */
import { verifyHedraWebhook } from "@explainer/hedra";

let publicKeyPem: string | null = null;
async function getPublicKey(): Promise<string> {
  if (publicKeyPem) return publicKeyPem;
  const base = (process.env.HEDRA_API_BASE ?? "https://api.hedra.com/v3").replace(/\/v3$/, "");
  const res = await fetch(`${base}/webhooks/public-key`, { headers: { Authorization: `Key ${process.env.HEDRA_API_KEY}` } });
  if (!res.ok) throw new Error(`public key fetch failed: ${res.status}`);
  const data = (await res.json()) as { public_key?: string; pem?: string };
  publicKeyPem = data.public_key ?? data.pem ?? (await res.text());
  return publicKeyPem!;
}

export async function POST(req: Request) {
  const raw = new Uint8Array(await req.arrayBuffer());
  const h = req.headers;
  const result = verifyHedraWebhook(
    raw,
    {
      signature: h.get("x-hedra-webhook-signature") ?? "",
      id: h.get("x-hedra-webhook-id") ?? "",
      timestamp: h.get("x-hedra-webhook-timestamp") ?? "",
      event: h.get("x-hedra-webhook-event") ?? "",
      redelivery: h.get("x-hedra-webhook-redelivery") ?? "false",
    },
    await getPublicKey(),
  );
  if (!result.ok) return new Response(result.reason ?? "invalid", { status: 401 });
  return new Response("ok", { status: 200 });
}

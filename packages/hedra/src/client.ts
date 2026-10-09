/**
 * Minimal typed client for the Hedra v3 API.
 *
 *   POST /v3/models/{model}        { input, webhook?, idempotency_key? } → 202 SubmitResponse
 *   GET  /v3/jobs/{job_id}/status  → { status }
 *   GET  /v3/jobs/{job_id}         → JobResult with outputs[]
 *   POST /v3/files                 multipart → { url, expires_at }
 *   GET  /v3/models/{model}        → schema and capabilities
 *
 * Auth: `Authorization: Key <key_id>:<secret>`.
 * Media inputs are `{ source: "asset", asset_id }` or `{ source: "url", url }`.
 */

export type JobStatus = "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED";

export interface SubmitResponse {
  job_id: string;
  model: string;
  status: JobStatus;
  status_url: string;
  result_url: string;
  estimated_completion_at: string | null;
}

export interface OutputItem {
  status: "COMPLETED" | "FAILED" | "EXPIRED";
  asset_id: string | null;
  voice_id: string | null;
  url: string | null;
  content_type: string | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  fps: number | null;
  error: { code: string; message: string } | null;
}

export interface JobResult {
  job_id: string;
  model: string;
  status: JobStatus;
  outputs: OutputItem[];
  error: { code: string; message: string; retryable?: boolean; retry_after?: number | null } | null;
  cost: number | null;
  currency: string | null;
}

export type MediaRef = { source: "asset"; asset_id: string } | { source: "url"; url: string };

export class HedraError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus: number,
    public readonly retryable: boolean,
    public readonly retryAfterS: number | null = null,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HedraError";
  }
}

export interface HedraClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Default webhook for submitted jobs; when set we still poll as a fallback. */
  webhookUrl?: string;
}

export class HedraClient {
  private readonly base: string;
  private readonly key: string;
  private readonly f: typeof fetch;
  private readonly webhookUrl?: string;

  constructor(opts: HedraClientOptions) {
    if (!opts.apiKey) throw new Error("HEDRA_API_KEY is required");
    this.key = opts.apiKey;
    this.base = (opts.baseUrl ?? "https://api.hedra.com/v3").replace(/\/$/, "");
    this.f = opts.fetch ?? fetch;
    this.webhookUrl = opts.webhookUrl;
  }

  private headers(extra: Record<string, string> = {}) {
    return {
      Authorization: `Key ${this.key}`,
      Accept: "application/json",
      ...extra,
    };
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.f(`${this.base}${path}`, {
      ...init,
      headers: { ...this.headers(), ...(init.headers as Record<string, string> | undefined) },
    });
    const text = await res.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }
    if (!res.ok) {
      const err = body?.error ?? {};
      const retryAfter = Number(res.headers.get("Retry-After") ?? err.retry_after ?? NaN);
      throw new HedraError(
        err.message ?? `Hedra ${res.status} on ${path}`,
        err.code ?? `HTTP_${res.status}`,
        res.status,
        Boolean(err.retryable) || res.status === 429 || res.status >= 500,
        Number.isFinite(retryAfter) ? retryAfter : null,
        body,
      );
    }
    return body as T;
  }

  /** Submit a job. Always pass an idempotency key derived from the input hash. */
  async submit(model: string, input: Record<string, unknown>, idempotencyKey: string): Promise<SubmitResponse> {
    return this.request<SubmitResponse>(`/models/${encodeURIComponent(model)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        idempotency_key: idempotencyKey,
        ...(this.webhookUrl ? { webhook: this.webhookUrl } : {}),
      }),
    });
  }

  async status(jobId: string): Promise<{ status: JobStatus }> {
    return this.request(`/jobs/${encodeURIComponent(jobId)}/status`);
  }

  async result(jobId: string): Promise<JobResult> {
    return this.request(`/jobs/${encodeURIComponent(jobId)}`);
  }

  async model(model: string): Promise<unknown> {
    return this.request(`/models/${encodeURIComponent(model)}`);
  }

  /** Spendable balance on the account this key bills. */
  async balance(): Promise<{ balance?: number; currency?: string }> {
    return this.request(`/balance`);
  }

  /** Upload a file for use as a `{source:"url"}` input. Prefer asset ids when you have them. */
  async uploadFile(bytes: Uint8Array, filename: string, contentType: string): Promise<{ url: string; expires_at: string }> {
    const form = new FormData();
    form.append("file", new Blob([bytes as BlobPart], { type: contentType }), filename);
    return this.request(`/files`, { method: "POST", body: form });
  }

  /**
   * Poll until the job completes or fails. Backoff starts at `initialMs` and
   * caps at `maxMs`; gives up after `timeoutMs`.
   */
  async waitFor(
    jobId: string,
    opts: { initialMs?: number; maxMs?: number; timeoutMs?: number; onTick?: (s: JobStatus) => void } = {},
  ): Promise<JobResult> {
    const initial = opts.initialMs ?? 3000;
    const max = opts.maxMs ?? 20000;
    const timeout = opts.timeoutMs ?? 15 * 60 * 1000;
    const started = Date.now();
    let delay = initial;
    for (;;) {
      const { status } = await this.status(jobId);
      opts.onTick?.(status);
      if (status === "COMPLETED" || status === "FAILED") {
        const r = await this.result(jobId);
        if (r.status === "FAILED" || r.outputs.some((o) => o.status === "FAILED")) {
          const e = r.error ?? r.outputs.find((o) => o.error)?.error ?? { code: "UNKNOWN", message: "job failed" };
          throw new HedraError(e.message, e.code, 200, (e as any).retryable ?? false, null, r);
        }
        return r;
      }
      if (Date.now() - started > timeout) {
        throw new HedraError(`timed out waiting for ${jobId}`, "DEADLINE_EXCEEDED", 0, true);
      }
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(max, Math.round(delay * 1.6));
    }
  }

  /** Submit and wait. */
  async run(model: string, input: Record<string, unknown>, idempotencyKey: string): Promise<JobResult> {
    const ack = await this.submit(model, input, idempotencyKey);
    return this.waitFor(ack.job_id);
  }
}

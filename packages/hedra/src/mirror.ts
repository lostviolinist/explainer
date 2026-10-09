/**
 * Mirror Hedra outputs into our own object store.
 *
 * Hedra output URLs are presigned and expire; the Hedra asset id is the
 * durable handle for regenerations, and our mirrored copy is what the
 * renderer reads. Both are recorded on every MirroredAsset.
 */
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import type { OutputItem } from "./client.js";

export interface MirrorOptions {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBase: string;
  fetch?: typeof fetch;
}

export interface Mirrored {
  hedraAssetId: string;
  url: string;
  contentType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  bytes: number;
}

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/aac": "aac",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
};

export class AssetMirror {
  private readonly s3: S3Client;
  private readonly f: typeof fetch;

  constructor(private readonly opts: MirrorOptions) {
    this.s3 = new S3Client({
      region: opts.region,
      endpoint: opts.endpoint || undefined,
      forcePathStyle: Boolean(opts.endpoint),
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
    });
    this.f = opts.fetch ?? fetch;
  }

  private keyFor(projectId: string, assetId: string, contentType: string) {
    const ext = EXT[contentType] ?? "bin";
    return `projects/${projectId}/${assetId}.${ext}`;
  }

  private publicUrl(key: string) {
    return `${this.opts.publicBase.replace(/\/$/, "")}/${key}`;
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.opts.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  /** Download a completed Hedra output and store it. Idempotent on asset id. */
  async mirror(projectId: string, out: OutputItem): Promise<Mirrored> {
    if (!out.asset_id || !out.url || !out.content_type) {
      throw new Error("output has no retrievable bytes (expired or failed)");
    }
    const key = this.keyFor(projectId, out.asset_id, out.content_type);
    let bytes = 0;
    if (!(await this.exists(key))) {
      const res = await this.f(out.url);
      if (!res.ok) throw new Error(`download failed: ${res.status} for ${out.asset_id}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      bytes = buf.byteLength;
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.opts.bucket,
          Key: key,
          Body: buf,
          ContentType: out.content_type,
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
    }
    return {
      hedraAssetId: out.asset_id,
      url: this.publicUrl(key),
      contentType: out.content_type,
      width: out.width,
      height: out.height,
      durationMs: out.duration_ms,
      bytes,
    };
  }
}

/**
 * Wires the pipeline to this app: Prisma store, env-configured providers,
 * and a renderer that uploads to the same bucket the mirror uses.
 */
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { ctxFromEnv, makeFunctions, type Ctx } from "@explainer/pipeline";
import { LocalRenderer, LambdaRenderer, FfmpegFrameSampler, type Upload } from "@explainer/render";
import { drizzleStore } from "./store";

let ctx: Ctx | null = null;
export function getCtx(): Ctx {
  return (ctx ??= ctxFromEnv(drizzleStore, new FfmpegFrameSampler()));
}

const s3 = new S3Client({
  region: process.env.S3_REGION ?? "us-east-1",
  endpoint: process.env.S3_ENDPOINT || undefined,
  forcePathStyle: Boolean(process.env.S3_ENDPOINT),
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "" },
});

const upload: Upload = async (key, bytes, contentType) => {
  await s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: bytes, ContentType: contentType, CacheControl: "public, max-age=31536000, immutable" }));
  return `${(process.env.ASSETS_PUBLIC_BASE ?? "").replace(/\/$/, "")}/${key}`;
};

export function getRenderer() {
  if (process.env.RENDER_TARGET === "lambda") {
    return new LambdaRenderer(upload, {
      functionName: process.env.REMOTION_LAMBDA_FUNCTION!,
      serveUrl: process.env.REMOTION_LAMBDA_SERVE_URL!,
      region: process.env.REMOTION_LAMBDA_REGION ?? "us-east-1",
    });
  }
  return new LocalRenderer(upload);
}

export const functions = makeFunctions(getCtx, getRenderer);

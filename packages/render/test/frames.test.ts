import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import { RenderInternals } from "@remotion/renderer";
import { FfmpegFrameSampler, sampleTimes } from "../src/frames.ts";

/** A solid-colour RGB PNG, written by hand so the test needs no image library. */
function solidPng(w: number, h: number, rgb: number[]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const td = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(td.length + 8);
    out.writeUInt32BE(data.length, 0);
    td.copy(out, 4);
    out.writeUInt32BE(crc(td), td.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())]);
  const idat = deflateSync(Buffer.concat(Array.from({ length: h }, () => row)));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

const ff = (bin: "ffmpeg" | "ffprobe", args: string[]) =>
  RenderInternals.callFf({ bin, args, indent: false, logLevel: "error", binariesDirectory: null, cancelSignal: undefined });

test("sample times are inset from both ends and evenly spaced", () => {
  assert.deepEqual(sampleTimes(5, 3), [0.5, 2.5, 4.5]);
  assert.deepEqual(sampleTimes(2, 3), [0.2, 1, 1.8]);
  assert.deepEqual(sampleTimes(5, 1), [2.5]);
});

test("samples start, middle and end frames of a real h264 clip as jpeg data URLs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "frames-test-"));
  try {
    // 5 s at 24 fps, 64x36: red, then green, then blue thirds, piped to ffmpeg as PNGs.
    const [w, h, fps, n] = [64, 36, 24, 120];
    const pngs = [[255, 0, 0], [0, 255, 0], [0, 0, 255]].map((c) => solidPng(w, h, c));
    await writeFile(join(dir, "in.pngs"), Buffer.concat(Array.from({ length: n }, (_, f) => pngs[Math.floor((f * 3) / n)]!)));
    const mp4 = join(dir, "clip.mp4");
    await ff("ffmpeg", ["-v", "error", "-f", "image2pipe", "-c:v", "png", "-r", `${fps}`, "-i", join(dir, "in.pngs"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", mp4]);
    const bytes = await readFile(mp4);

    let fetched = "";
    const sampler = new FfmpegFrameSampler(undefined, (async (url: string) => {
      fetched = url;
      return new Response(bytes, { headers: { "content-type": "video/mp4" } });
    }) as typeof fetch);
    const frames = await sampler.sample("http://localhost:9000/explainer-assets/clip.mp4", 3);

    assert.equal(fetched, "http://localhost:9000/explainer-assets/clip.mp4");
    assert.equal(frames.length, 3);
    const colours: string[] = [];
    for (const [i, url] of frames.entries()) {
      assert.match(url, /^data:image\/jpeg;base64,/);
      const jpg = join(dir, `out${i}.jpg`);
      await writeFile(jpg, Buffer.from(url.split(",")[1]!, "base64"));
      const px = join(dir, `out${i}.png`);
      await ff("ffmpeg", ["-v", "error", "-i", jpg, "-vf", "scale=1:1", "-pix_fmt", "rgb24", "-y", px]);
      const png = await readFile(px);
      const idat = png.indexOf("IDAT");
      // 1x1 RGB scanline: [filter byte, r, g, b]
      const [, r, g, b] = inflateSync(png.subarray(idat + 4, idat + 4 + png.readUInt32BE(idat - 4)));
      colours.push(r! > 128 ? "red" : g! > 128 ? "green" : b! > 128 ? "blue" : `?${r},${g},${b}`);
    }
    assert.deepEqual(colours, ["red", "green", "blue"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

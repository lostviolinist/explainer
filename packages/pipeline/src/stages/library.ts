/**
 * The library: assets made once and shared by every video — a music bed per
 * tone and a small sound-effect kit. Generated through Hedra the first time a
 * video needs them, stored under library/ in the bucket, found there after.
 *
 * Music: one long instrumental bed per tone, composed to end properly (a
 * resolved final chord that rings out). The composition plays its *ending*
 * over the video's end card (end-aligned), so the music never stops mid-phrase.
 */
import { generateMusic, generateSfx, HedraError } from "@explainer/hedra";
import { SoundKind, type Tone } from "@explainer/schemas";
import type { Ctx } from "../context.js";
import { makeProgress, maxVideoSeconds } from "../context.js";

export type MusicBed = { url: string; durationS: number; tone: Tone };
export type SfxKit = Partial<Record<SoundKind, string>>;

/** Bump to regenerate every bed (prompts changed). */
const MUSIC_VERSION = "v1";
const SFX_VERSION = "v1";

const ENDING =
  " Instrumental only, no vocals. It is already in full texture from the very first second (no intro build-up), stays at a steady, even level the whole way with no big swells or drops, never resolves to a stop in the middle, and ends with a clear, resolved final chord that rings out and fades to silence over the last six seconds.";

export const MUSIC_PROMPTS: Record<Tone, string> = {
  neutral: "A calm, warm, minimal ambient bed for an educational explainer video: soft electric piano and gentle synth pads, a light unhurried pulse, mid-tempo, unobtrusive, optimistic but understated, sits comfortably under a narrator's voice.",
  playful: "A light, bright, playful bed for an educational explainer video: plucked synths, marimba, soft claps and a bouncy but gentle rhythm, cheerful and curious, never silly, sits comfortably under a narrator's voice.",
  serious: "A focused, understated, thoughtful bed for an educational explainer video: soft piano, low strings and a slow pad, measured pulse, calm gravity without drama, sits comfortably under a narrator's voice.",
  documentary: "A spacious, cinematic documentary bed: slow evolving pads, a soft felt piano motif, subtle low pulse, a sense of wonder and scale without tension, sits comfortably under a narrator's voice.",
};

export const SFX_PROMPTS: Record<SoundKind, { text: string; ms: number }> = {
  pop: { text: "A single short, soft, clean pop, like a small bubble, bright and pleasant, no reverb, no tail.", ms: 500 },
  whoosh: { text: "A single quick, soft, airy whoosh, like a card sliding into place, short, no tail.", ms: 700 },
  tick: { text: "A single soft wooden tick, like a gentle click of a switch, very short, no reverb.", ms: 500 },
  chime: { text: "A single gentle, bright chime, one clear note with a short soft decay, pleasant, no reverb.", ms: 1200 },
  swoosh: { text: "A single smooth, fast swoosh for a scene transition, airy and clean, short.", ms: 800 },
};

/** MUSIC_BED=0 turns the bed off. */
export const musicEnabled = () => !/^(0|off|false)$/i.test(process.env.MUSIC_BED ?? "");

type LibraryMeta = { file: string; durationMs: number; model: string; createdAt: string };

/** The tone's bed: from the library, or composed now (once). Null when music is off or can't be made. */
export async function ensureMusicBed(ctx: Ctx, projectId: string, tone: Tone): Promise<MusicBed | null> {
  if (!musicEnabled()) return null;
  const name = `music/${tone}-${MUSIC_VERSION}`;
  const cached = await ctx.mirror.getLibraryJson<LibraryMeta>(`${name}.json`);
  if (cached) return { url: ctx.mirror.libraryUrl(cached.file), durationS: cached.durationMs / 1000, tone };

  await makeProgress(ctx, projectId, "assemble")(`composing the ${tone} music bed (first time only)`, 0.05);
  // Long enough to end-align under any video we make; billed per minute, so this is paid once per tone.
  const durationMs = Math.min(600_000, Math.max(240, maxVideoSeconds() + 60) * 1000);
  try {
    const out = await generateMusic(ctx.hedra, `library:${name}`, ctx.style.models.music ?? ["elevenlabs-music"], MUSIC_PROMPTS[tone] + ENDING, durationMs);
    const o = out.job.outputs[0];
    if (!o?.url || !o.content_type) return null;
    const res = await fetch(o.url);
    if (!res.ok) throw new Error(`music download failed: ${res.status}`);
    const file = `${name}.${/wav/.test(o.content_type) ? "wav" : "mp3"}`;
    const url = await ctx.mirror.putLibrary(file, new Uint8Array(await res.arrayBuffer()), o.content_type);
    const meta: LibraryMeta = { file, durationMs: o.duration_ms ?? durationMs, model: out.model, createdAt: ctx.now() };
    await ctx.mirror.putLibrary(`${name}.json`, new TextEncoder().encode(JSON.stringify(meta)), "application/json");
    await ctx.store.recordCost(projectId, "music", out.costUsd, `${tone} bed (library, reused by every video)`);
    return { url, durationS: meta.durationMs / 1000, tone };
  } catch (e) {
    if (e instanceof HedraError && e.retryable) throw e;
    console.warn(`[library] no music bed for ${tone}: ${(e as Error).message}`);
    return null;
  }
}

/** The sound-effect kit: whatever is in the library, plus anything missing, made now (once). */
export async function ensureSfxKit(ctx: Ctx, projectId: string): Promise<SfxKit> {
  if (!musicEnabled()) return {};
  const kit: SfxKit = {};
  await Promise.all(
    SoundKind.options.map(async (kind) => {
      const name = `sfx/${kind}-${SFX_VERSION}`;
      const cached = await ctx.mirror.getLibraryJson<LibraryMeta>(`${name}.json`);
      if (cached) {
        kit[kind] = ctx.mirror.libraryUrl(cached.file);
        return;
      }
      try {
        const { text, ms } = SFX_PROMPTS[kind];
        const out = await generateSfx(ctx.hedra, `library:${name}`, ctx.style.models.sfx ?? ["elevenlabs-sound-effects"], text, ms);
        const o = out.job.outputs[0];
        if (!o?.url || !o.content_type) return;
        const res = await fetch(o.url);
        if (!res.ok) throw new Error(`sfx download failed: ${res.status}`);
        const file = `${name}.${/wav/.test(o.content_type) ? "wav" : "mp3"}`;
        const url = await ctx.mirror.putLibrary(file, new Uint8Array(await res.arrayBuffer()), o.content_type);
        const meta: LibraryMeta = { file, durationMs: o.duration_ms ?? ms, model: out.model, createdAt: ctx.now() };
        await ctx.mirror.putLibrary(`${name}.json`, new TextEncoder().encode(JSON.stringify(meta)), "application/json");
        await ctx.store.recordCost(projectId, "sfx", out.costUsd, `${kind} (library)`);
        kit[kind] = url;
      } catch (e) {
        if (e instanceof HedraError && e.retryable) throw e;
        console.warn(`[library] no ${kind} sound: ${(e as Error).message}`);
      }
    }),
  );
  return kit;
}

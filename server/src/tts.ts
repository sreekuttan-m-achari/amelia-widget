import { spawn, type ChildProcess } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export type TtsEngine = "piper" | "spd-say" | "off";

type ProbeResult = {
  engine: TtsEngine;
  piperModel?: string;
  player?: string;
};

let probe: ProbeResult | null = null;
let active: ChildProcess | null = null;
let activePlayer: ChildProcess | null = null;
let activeTempDir: string | null = null;

function which(bin: string): string | null {
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(":")) {
    if (!dir) continue;
    const full = join(dir, bin);
    try {
      accessSync(full, constants.X_OK);
      return full;
    } catch {
      /* continue */
    }
  }
  return null;
}

function voiceEnabled(): boolean {
  const raw = process.env.AMELIA_VOICE?.trim();
  if (raw === "0" || raw?.toLowerCase() === "false" || raw?.toLowerCase() === "off") {
    return false;
  }
  if (raw === "1" || raw?.toLowerCase() === "true" || raw?.toLowerCase() === "on") {
    return true;
  }
  // Default: on when a backend exists (decided at probe time)
  return true;
}

function preferredEngine(): "auto" | "piper" | "spd-say" {
  const raw = process.env.AMELIA_TTS?.trim().toLowerCase();
  if (raw === "piper" || raw === "spd-say") return raw;
  return "auto";
}

function findPiperModel(): string | null {
  const configured = process.env.AMELIA_PIPER_MODEL?.trim();
  if (configured && existsSync(configured)) return configured;

  const candidates = [
    join(homedir(), ".local", "share", "piper"),
    join(homedir(), ".local", "share", "piper", "voices"),
    "/usr/share/piper-voices",
    "/opt/piper/models",
  ];

  for (const dir of candidates) {
    if (!existsSync(dir)) continue;
    const found = findOnnxRecursive(dir, 3);
    if (found) return found;
  }
  return null;
}

function findOnnxRecursive(dir: string, depth: number): string | null {
  if (depth < 0) return null;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  const onnx = entries.filter((e) => e.endsWith(".onnx")).sort();
  // Prefer medium/lessac-ish if present
  const preferred =
    onnx.find((e) => e.includes("kristin") && e.includes("medium")) ??
    onnx.find((e) => e.includes("amy") && e.includes("medium")) ??
    onnx.find((e) => e.includes("hfc_female") && e.includes("medium")) ??
    onnx.find((e) => e.includes("lessac") && e.includes("medium")) ??
    onnx.find((e) => e.includes("medium")) ??
    onnx[0];
  if (preferred) return join(dir, preferred);
  for (const e of entries) {
    const full = join(dir, e);
    try {
      if (!statSync(full).isDirectory()) continue;
      const nested = findOnnxRecursive(full, depth - 1);
      if (nested) return nested;
    } catch {
      /* skip */
    }
  }
  return null;
}

function findPlayer(): string | null {
  return which("paplay") ?? which("pw-play") ?? which("aplay");
}

function canUsePiper(): { model: string; player: string } | null {
  if (!which("piper")) return null;
  const model = findPiperModel();
  if (!model) return null;
  const player = findPlayer();
  if (!player) return null;
  return { model, player };
}

function canUseSpdSay(): boolean {
  return Boolean(which("spd-say"));
}

function spdLanguage(): string {
  return process.env.AMELIA_SPD_LANGUAGE?.trim() || "en-US";
}

/** Named synthesis voice (-y), e.g. Andrea. Falls back to voice type (-t). */
function spdVoiceArgs(): string[] {
  const named = process.env.AMELIA_SPD_VOICE?.trim();
  if (named) {
    return ["-y", named];
  }
  const voiceType =
    process.env.AMELIA_SPD_VOICE_TYPE?.trim() || "female1";
  return ["-t", voiceType];
}

function spdVoiceLabel(): string {
  const named = process.env.AMELIA_SPD_VOICE?.trim();
  if (named) return `${named} (${spdLanguage()})`;
  const voiceType =
    process.env.AMELIA_SPD_VOICE_TYPE?.trim() || "female1";
  return `${voiceType} (${spdLanguage()})`;
}

/** spd-say rate -100..100; negative = slower. Default -15 for natural pace. */
function spdSayRate(): number {
  const raw = process.env.AMELIA_SPD_RATE?.trim();
  const n = raw ? Number.parseInt(raw, 10) : -15;
  if (!Number.isFinite(n)) return -15;
  return Math.min(100, Math.max(-100, n));
}

/** Piper length-scale: >1 slower, <1 faster. Default 0.94 for an active pace. */
function piperLengthScale(): number {
  const raw = process.env.AMELIA_PIPER_LENGTH_SCALE?.trim();
  const n = raw ? Number.parseFloat(raw) : 0.94;
  if (!Number.isFinite(n)) return 0.94;
  return Math.min(2, Math.max(0.5, n));
}

/** Pause between sentences (seconds). Default 0 — Piper silence gaps often hiss. */
function piperSentenceSilence(): number {
  const raw = process.env.AMELIA_PIPER_SENTENCE_SILENCE?.trim();
  const n = raw ? Number.parseFloat(raw) : 0;
  if (!Number.isFinite(n)) return 0;
  return Math.min(2, Math.max(0, n));
}

/** Optional generator noise (lower = less hiss). Model default ~0.667. */
function piperNoiseScale(): number | undefined {
  const raw = process.env.AMELIA_PIPER_NOISE_SCALE?.trim();
  if (!raw) return undefined;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(2, Math.max(0, n));
}

/** Use WAV file playback (slower). Default: stream raw audio for lower latency. */
function piperPreferWav(): boolean {
  const raw = process.env.AMELIA_PIPER_WAV?.trim();
  return raw === "1" || raw?.toLowerCase() === "true";
}

function piperBaseArgs(model: string): string[] {
  const args = [
    "--model",
    model,
    "--length-scale",
    String(piperLengthScale()),
    "--sentence-silence",
    String(piperSentenceSilence()),
  ];
  const noise = piperNoiseScale();
  if (noise !== undefined) {
    args.push("--noise-scale", String(noise));
  }
  return args;
}

function piperPlayerRawArgs(playerBin: string): string[] {
  const playerName = playerBin.split("/").pop() ?? playerBin;
  if (playerName === "paplay") {
    return ["--raw", "--rate=22050", "--channels=1", "--format=s16le"];
  }
  if (playerName === "pw-play") {
    return ["--rate", "22050", "--channels", "1", "--format", "s16"];
  }
  return ["-r", "22050", "-f", "S16_LE", "-t", "raw", "-"];
}

/** Load model into page cache so the first real utterance starts faster. */
function warmupPiper(model: string): void {
  const wav = join(tmpdir(), `amelia-piper-warmup-${process.pid}.wav`);
  const child = spawn(
    "piper",
    [...piperBaseArgs(model), "-f", wav],
    { stdio: ["pipe", "ignore", "ignore"], detached: true },
  );
  child.stdin?.write("ok");
  child.stdin?.end();
  child.unref();
  child.on("exit", () => {
    try {
      rmSync(wav, { force: true });
    } catch {
      /* ignore */
    }
  });
  child.on("error", () => {
    try {
      rmSync(wav, { force: true });
    } catch {
      /* ignore */
    }
  });
}

function cleanupTempDir(): void {
  if (!activeTempDir) return;
  try {
    rmSync(activeTempDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  activeTempDir = null;
}

/** Probe once and cache. Safe to call multiple times. */
export function initTts(): TtsEngine {
  if (probe) return probe.engine;

  if (!voiceEnabled()) {
    probe = { engine: "off" };
    console.error("[amelia-voice] disabled (AMELIA_VOICE=0)");
    return "off";
  }

  const prefer = preferredEngine();
  const piper = canUsePiper();
  const spd = canUseSpdSay();

  if (prefer === "piper") {
    if (piper) {
      probe = { engine: "piper", piperModel: piper.model, player: piper.player };
    } else {
      probe = { engine: "off" };
      console.error(
        "[amelia-voice] AMELIA_TTS=piper but piper/model/player unavailable; voice off",
      );
      return "off";
    }
  } else if (prefer === "spd-say") {
    if (spd) {
      probe = { engine: "spd-say" };
    } else {
      probe = { engine: "off" };
      console.error(
        "[amelia-voice] AMELIA_TTS=spd-say but spd-say unavailable; voice off",
      );
      return "off";
    }
  } else if (piper) {
    probe = { engine: "piper", piperModel: piper.model, player: piper.player };
  } else if (spd) {
    probe = { engine: "spd-say" };
  } else {
    probe = { engine: "off" };
  }

  if (probe.engine === "piper") {
    const mode = piperPreferWav() ? "wav" : "stream";
    console.error(
      `[amelia-voice] engine=piper model=${probe.piperModel} player=${probe.player} mode=${mode} length_scale=${piperLengthScale()} sentence_silence=${piperSentenceSilence()}s`,
    );
    if (probe.piperModel) {
      warmupPiper(probe.piperModel);
    }
  } else if (probe.engine === "spd-say") {
    console.error(`[amelia-voice] engine=spd-say voice=${spdVoiceLabel()}`);
  } else {
    console.error("[amelia-voice] engine=off (no piper/spd-say backend)");
  }

  return probe.engine;
}

export function getTtsEngine(): TtsEngine {
  return probe?.engine ?? initTts();
}

function killProc(proc: ChildProcess | null): void {
  if (!proc || proc.killed) return;
  try {
    proc.kill("SIGTERM");
  } catch {
    /* ignore */
  }
}

/** Stop any in-flight speech. */
export function stopSpeech(): void {
  killProc(activePlayer);
  killProc(active);
  activePlayer = null;
  active = null;
  cleanupTempDir();
}

function speakSpdSay(text: string): void {
  const rate = spdSayRate();
  const args = [
    "--wait",
    "-l",
    spdLanguage(),
    ...spdVoiceArgs(),
    ...(rate !== 0 ? ["-r", String(rate)] : []),
    text,
  ];
  const child = spawn("spd-say", args, {
    stdio: ["ignore", "ignore", "ignore"],
  });
  active = child;
  child.on("exit", () => {
    if (active === child) active = null;
  });
  child.on("error", (err) => {
    console.error("[amelia-voice] spd-say error:", err.message);
    if (active === child) active = null;
  });
}

function speakPiperRaw(text: string, model: string, playerBin: string): void {
  const piper = spawn(
    "piper",
    [...piperBaseArgs(model), "--output-raw"],
    { stdio: ["pipe", "pipe", "ignore"] },
  );
  const player = spawn(playerBin, piperPlayerRawArgs(playerBin), {
    stdio: ["pipe", "ignore", "ignore"],
  });

  active = piper;
  activePlayer = player;

  piper.stdout?.pipe(player.stdin!);
  piper.stdin?.write(text);
  piper.stdin?.end();

  const clear = (proc: ChildProcess) => {
    if (active === proc) active = null;
    if (activePlayer === proc) activePlayer = null;
  };

  piper.on("exit", (code) => {
    if (code !== 0 && active === piper) {
      console.error(`[amelia-voice] piper exited code=${code ?? "?"}`);
    }
    clear(piper);
  });
  player.on("exit", () => clear(player));
  piper.on("error", (err) => {
    console.error("[amelia-voice] piper error:", err.message);
    clear(piper);
  });
  player.on("error", (err) => {
    console.error("[amelia-voice] player error:", err.message);
    clear(player);
  });
}

function speakPiperWav(text: string, model: string, playerBin: string): void {
  cleanupTempDir();
  const dir = mkdtempSync(join(tmpdir(), "amelia-voice-"));
  activeTempDir = dir;
  const wavPath = join(dir, "speech.wav");

  const piperArgs = [...piperBaseArgs(model), "-f", wavPath];
  const piper = spawn("piper", piperArgs, {
    stdio: ["pipe", "ignore", "ignore"],
  });
  active = piper;

  piper.stdin?.write(text);
  piper.stdin?.end();

  piper.on("exit", (code, signal) => {
    if (active === piper) active = null;
    if (code !== 0) {
      console.error(
        `[amelia-voice] piper exited code=${code ?? "?"} signal=${signal ?? ""}`,
      );
      cleanupTempDir();
      return;
    }
    if (!existsSync(wavPath)) {
      console.error("[amelia-voice] piper produced no wav output");
      cleanupTempDir();
      return;
    }
    const player = spawn(playerBin, [wavPath], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    activePlayer = player;
    player.on("exit", () => {
      if (activePlayer === player) activePlayer = null;
      cleanupTempDir();
    });
    player.on("error", (err) => {
      console.error("[amelia-voice] player error:", err.message);
      if (activePlayer === player) activePlayer = null;
      cleanupTempDir();
    });
  });

  piper.on("error", (err) => {
    console.error("[amelia-voice] piper error:", err.message);
    if (active === piper) active = null;
    cleanupTempDir();
  });
}

function speakPiper(text: string, model: string, playerBin: string): void {
  if (piperPreferWav()) {
    speakPiperWav(text, model, playerBin);
  } else {
    speakPiperRaw(text, model, playerBin);
  }
}

/**
 * Speak text with the configured backend. Non-blocking; soft-fails.
 * Replaces any currently playing utterance.
 */
export function speak(text: string): void {
  const engine = getTtsEngine();
  if (engine === "off") return;
  const line = text.trim();
  if (!line) return;

  stopSpeech();

  try {
    if (engine === "piper" && probe?.piperModel && probe.player) {
      speakPiper(line, probe.piperModel, probe.player);
      return;
    }
    if (engine === "spd-say") {
      speakSpdSay(line);
      return;
    }
  } catch (err) {
    console.error(
      "[amelia-voice] speak failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

/** Short note for the agent persona about current voice setup. */
export function voiceCapabilitySummary(): string | undefined {
  const engine = getTtsEngine();
  if (engine === "off") return undefined;
  const model =
    probe?.piperModel?.split("/").pop()?.replace(".onnx", "") ?? engine;
  return [
    "## Voice (runtime)",
    "",
    "Local TTS is enabled on this desktop.",
    `Engine: ${engine}${engine === "piper" ? ` (${model})` : ""}.`,
    "After each reply, the widget speaks a short summary of your opening lines — not the full answer or code.",
    "Lead with a clear, friendly first sentence when it helps.",
    "Listening / microphone is not available yet.",
  ].join("\n");
}

/** Test helper: reset cached probe (not for production). */
export function _resetTtsProbeForTests(): void {
  stopSpeech();
  probe = null;
}

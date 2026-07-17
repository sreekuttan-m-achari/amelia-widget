/** Build short spoken lines for ack/done (no LLM). */

function maxChars(): number {
  const raw = process.env.AMELIA_VOICE_MAX_CHARS?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 280;
  return Number.isFinite(n) && n > 20 ? n : 280;
}

function collapseWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Remove fenced code, inline code blocks of substance, and bare URLs for speaking. */
export function cleanForSpeech(input: string): string {
  let s = input;
  s = s.replace(/```[\s\S]*?```/g, " ");
  s = s.replace(/`[^`]+`/g, " ");
  s = s.replace(/https?:\/\/\S+/gi, " ");
  s = s.replace(/^#{1,6}\s+/gm, "");
  s = s.replace(/^\s*[-*+]\s+/gm, "");
  s = s.replace(/^\s*\d+\.\s+/gm, "");
  return collapseWs(s);
}

function clipAtBoundary(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const sentenceEnd = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("? "),
    slice.lastIndexOf("! "),
  );
  if (sentenceEnd >= Math.floor(max * 0.4)) {
    return slice.slice(0, sentenceEnd + 1).trim();
  }
  const space = slice.lastIndexOf(" ");
  if (space >= Math.floor(max * 0.4)) {
    return slice.slice(0, space).trim();
  }
  return slice.trim();
}

/** Take up to several full sentences within a character budget. */
function firstSentences(text: string, max: number): string {
  const parts: string[] = [];
  const re = /[^.!?]+[.!?]+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    parts.push(match[0].trim());
  }
  if (parts.length === 0) {
    return clipAtBoundary(text, max);
  }
  let out = "";
  for (const part of parts) {
    const next = out ? `${out} ${part}` : part;
    if (next.length > max) break;
    out = next;
  }
  return out || clipAtBoundary(parts[0] ?? text, max);
}

function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  if (t.endsWith("?")) return true;
  return /^(what|why|how|when|where|who|which|can|could|should|is|are|do|does|did|will|would)\b/i.test(
    t,
  );
}

/**
 * Ack spoken at turn start from the user message.
 * e.g. "On it: fix the nginx config" or "Looking into: …"
 */
export function buildAckSpeech(userMessage: string): string {
  const cleaned = cleanForSpeech(userMessage);
  if (!cleaned) return "On it.";
  const body = clipAtBoundary(cleaned, maxChars());
  if (!body) return "On it.";
  const prefix = looksLikeQuestion(cleaned) ? "Looking into" : "On it";
  return `${prefix}: ${body}`;
}

/**
 * Done spoken after a successful turn from the assistant reply.
 * Up to a few sentences within AMELIA_VOICE_MAX_CHARS; falls back to "Done."
 */
export function buildDoneSpeech(reply: string): string {
  const cleaned = cleanForSpeech(reply);
  if (!cleaned) return "Done.";
  const prefix = "Done, ";
  const body = firstSentences(cleaned, maxChars() - prefix.length);
  if (!body) return "Done.";
  if (!/[a-zA-Z0-9]/.test(body)) return "Done.";
  return `${prefix}${body}`;
}

/** True when streamed text has a speakable first sentence (for early TTS). */
export function hasSpeakableFirstSentence(text: string): boolean {
  const cleaned = cleanForSpeech(text);
  if (!cleaned || !/[a-zA-Z0-9]/.test(cleaned)) return false;
  return /^(.+?[.!?])(?:\s|$)/.test(cleaned);
}

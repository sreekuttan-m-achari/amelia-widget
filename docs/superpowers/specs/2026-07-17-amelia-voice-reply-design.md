# Amelia voice reply (OS TTS) — Design

**Date:** 2026-07-17  
**Status:** Approved for planning  
**Scope:** Speak short ack + done lines via local TTS; listening deferred

## Goal

Give Amelia a lightweight **voice reply** on Linux: announce that work has started (A) and that it finished (C), without reading out long or technical replies. Keep Cursor SDK as the only LLM brain. No cloud TTS billing.

## Non-goals (v1)

- Listening / STT / microphone
- Speaking the full assistant reply
- Extra LLM calls to write spoken summaries
- WebRTC / Pipecat / LiveKit / OpenAI Realtime
- Per-desktop TTS (Qt Speech / GNOME / COSMIC)
- WebSocket `speak` events to clients
- Warm Piper daemon (optional later)

## Context

- Backend: Node (`server/`) on `127.0.0.1:8787`, Cursor SDK agent, serial chat queue
- Frontends: KDE QML, COSMIC Rust, GNOME GJS — text over WS/HTTP only
- `@cursor/sdk` has **no** built-in TTS; stream events are text/tool only
- Cursor “persona voice” in SOUL.md is writing style, not audio

## Architecture

Voice lives entirely in the Node server. Desktop UIs stay unchanged for v1.

```text
User message
    │
    ▼
handleChatTurn
    │
    ├─► speakAck(userMessage)      → TTS (non-blocking)
    │
    ├─► runChatTurn (Cursor SDK)   → stream chunks as today
    │
    └─► success: speakDone(reply)  → TTS (non-blocking)
        cancel:  stopSpeech()      → no done line
        error:   no done speech
```

### New modules

| File | Role |
|------|------|
| `server/src/tts.ts` | Backend selection, spawn/kill speech processes, soft-fail |
| `server/src/spoken.ts` | Build short ack/done strings from user message / reply |

### Integration point

Hook in `handleChatTurn` (`server/src/chat.ts`) so WS and HTTP paths both get voice. On cancel paths that surface through chat/runs, call `stopSpeech()`.

## TTS backends

Preference order when `AMELIA_TTS=auto` (default):

1. **Piper** — if `piper` is on `PATH` and a model path resolves
2. **`spd-say`** — Speech Dispatcher
3. **Off** — no-op; chat unaffected

Forced engine via `AMELIA_TTS=piper|spd-say`.

### Piper invocation (sketch)

```bash
echo "$TEXT" | piper --model "$MODEL" --output-raw \
  | aplay -r 22050 -f S16_LE -t raw -   # or paplay / pw-play as available
```

Model path from `AMELIA_PIPER_MODEL`, or a documented default under `~/.local/share/piper/` if present.

### Process rules

- Speech is **fire-and-forget** relative to the chat promise (do not await full audio before returning the reply to the client, except where cancel must race stop).
- Starting a new utterance **kills** the previous TTS child (and piped player) so ack and done do not overlap badly.
- TTS errors: log warning; never fail the chat turn.
- At server startup: probe backends once; log active engine (`piper` / `spd-say` / `off`).

**Note:** Piper cold-start may add ~0.5–2s before first audio. Acceptable for short A/C lines in v1; warm daemon is a later optimization.

## Spoken text rules

Default max length: **120 characters** (`AMELIA_VOICE_MAX_CHARS`).

### Ack (turn start) — from user message

1. Light cleanup: trim, collapse whitespace, strip fenced code / obvious URLs for speaking
2. Take first ~max chars at a word/sentence boundary
3. Prefix: `On it: …` (or `Looking into: …` when the text looks like a question)
4. If nothing usable remains → `On it.`

### Done (turn success) — from final reply

1. Prefer first plain-language sentence
2. Skip markdown headings, code fences, and dense bullet dumps when picking the spoken snippet
3. Cap to max chars; prefix `Done. …`
4. If empty / only code → `Done.`

### Cancel / error

- Cancel: stop any in-flight speech; **no** done line
- Error: no done speech (v1)

## Configuration

| Variable | Meaning | Default |
|----------|---------|---------|
| `AMELIA_VOICE` | `0` disables; `1` enables when a backend exists | On if a backend is found |
| `AMELIA_TTS` | `auto` \| `piper` \| `spd-say` | `auto` |
| `AMELIA_PIPER_MODEL` | Path to `.onnx` voice model | Auto-discover if possible |
| `AMELIA_VOICE_MAX_CHARS` | Max spoken snippet length | `120` |

Document in `server/.env-sample` and a short README note under deeper OS hooks / voice.

## Cost & processing

| Piece | Tokens / cloud cost | Local work |
|-------|---------------------|------------|
| Ack / Done text | None | Heuristic string ops |
| Main turn | Unchanged (Cursor SDK) | Unchanged |
| Piper / spd-say | None | Local TTS CPU + audio |

No extra Cursor turns for voice in v1.

## Testing

- Unit tests for `spoken.ts` (ack/done clipping, code-skip, empty fallbacks)
- TTS layer: mock `spawn` or skip when binaries missing; optional manual check with Piper / spd-say
- Confirm cancel stops speech and does not speak done
- Confirm TTS failure does not break `/chat` or WS `done`

## Rollout

1. Implement server modules + `handleChatTurn` hooks
2. Env sample + README
3. Manual listen-test on Pop!_OS with Piper preferred, spd-say fallback
4. Later: listening/STT; optional Piper warm process; quality pass on heuristics (or Approach 2 LLM summarize if needed)

## Decision log

- Prefer OS/local TTS over Pipecat (Amelia is Node + native DE widgets, not a greenfield Python voice stack)
- Cursor SDK has no TTS — voice is app-owned
- Speak A + C only, not full replies
- Include Piper in v1 (local, no cost) with spd-say fallback
- No extra LLM for spoken lines until heuristics prove insufficient

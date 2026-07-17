# Amelia Voice Reply Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax.

**Goal:** Speak short ack + done lines via local Piper/`spd-say` from the Amelia Node server.

**Architecture:** `spoken.ts` builds short strings; `tts.ts` speaks them (Piper preferred, spd-say fallback); `handleChatTurn` hooks A/C; cancel stops speech.

**Tech Stack:** Node 22+, TypeScript, `child_process`, `node:test`

## Global Constraints

- No Cursor/LLM calls for spoken text
- TTS failures must not fail chat
- Desktop UIs unchanged in v1
- Default max spoken length 120 chars

---

### Task 1: Spoken text helpers

- [x] `server/src/spoken.ts` — `buildAckSpeech`, `buildDoneSpeech`
- [x] `server/src/__tests__/spoken.test.ts` via `node:test`
- [x] `npm test` script in `server/package.json`

### Task 2: TTS layer

- [x] `server/src/tts.ts` — probe, speak, stop; Piper then spd-say
- [x] Init from `main.ts`; stop from `cancelActiveRun`

### Task 3: Wire chat + docs

- [x] Hook `handleChatTurn` (ack once, done on success, stop on cancel)
- [x] `.env-sample` + README voice section

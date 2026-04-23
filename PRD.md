# PRD — sensi

## Purpose
sensi is a personal desktop AI copilot for meetings, interviews, and live knowledge work. It captures what's happening on Toby's screen and in the room, builds rolling context, and generates immediate scripts, answers, and summaries using a user-owned AI provider (MiniMax by default, BYOK).

## Primary user
- Toby Joe
- Personal-use, single-machine, Windows-first
- Wants live assistance drawn from screenshots, dual-channel transcripts, and user-provided reference materials
- Owns all provider API keys and all data

## Core use cases
1. Capture a screenshot on demand during a live session
2. Transcribe both sides of a conversation (mic + system audio) as it happens
3. Build rolling context from the last N seconds of transcript + latest screenshots + user-provided materials (resume, JD, docs)
4. Generate immediate scripts, suggested answers, follow-up questions, and summaries from that rolling context
5. Switch providers with BYOK, with MiniMax as the default

## Must-have capabilities
- Windows desktop app (primary target; macOS/Linux as opportunistic by-products of Electron)
- Manual screenshot capture via global hotkey, tray action, or explicit UI button
- Live streaming transcript pipeline with speaker separation (mic vs system)
- Rolling-context response generation triggered on demand or on silence
- Provider abstraction with MiniMax as default; Claude + Google as optional add-ons later
- safeStorage-encrypted credentials at rest
- Local-first session storage (SQLite) with manual export

## Non-goals
- Team / multi-user product
- Subscription / billing / trial / licensing
- Public SaaS platform
- Cloud backend for sensi itself
- Marketing telemetry / analytics
- Auto-update from arbitrary third-party release feeds

## Milestone roadmap

### M0 — Clean Baseline
**Goal:** sensi builds and launches on Windows with no license crashes, no analytics, no upstream auto-update, no cloud calls to `natively.software` — and all docs reflect reality.

**Deliverables:**
- Docs landing (this milestone, M0-T1)
- `LicenseManager` stub that unlocks all gated features
- Analytics and install-ping removed
- `electron-updater` guarded behind an env var
- `natively.software` endpoints short-circuited
- Trial/donation UI gated off
- `productName`, `appId`, tray/permission strings renamed to "sensi" (symbol/file rename deferred to M1)
- Clean `typecheck` + `build` + launch smoke test

### M1 — MiniMax as Default Provider
**Goal:** manual screenshot + text prompt → streamed MiniMax response, end to end, with BYOK. Default provider is MiniMax.

**Deliverables:**
- `Provider` interface + adapter layer (non-invasive wrap of existing `LLMHelper` code paths)
- `MiniMaxProvider` class using OpenAI-compatible endpoint shape (text, vision, SSE streaming)
- `minimaxApiKey` in `CredentialsManager` with safeStorage encryption
- Typed `ProviderStatus = { provider, configured, validated, lastError?, lastValidatedAt? }` — never bare booleans
- `CredentialsManager.getDefaultModel()` returns MiniMax; first-launch migration for existing Gemini defaults
- Settings UI with MiniMax first-class tile + test-connection button
- Removal of `NativelyApiSettings`, trial/quota UI
- Full file/symbol rename to "sensi" (including `NativelyInterface.tsx` → `SensiInterface.tsx`, `natively.db` → `sensi.db`)
- Unit + integration tests ≥80% coverage on new code
- Smoke E2E: screenshot → MiniMax → response

### M2 — Live Transcription & Rolling Context
**Goal:** mic + system audio → separated transcripts → rolling context → MiniMax response loop.

**Deliverables:**
- Pick one primary STT (likely Deepgram or OpenAI Realtime) and feature-flag the others off
- Tag each transcript segment with `speaker: 'mic' | 'system'`
- Extend `TemporalContextBuilder` to interleave speaker-tagged turns
- Rolling response generator: debounced on final transcripts, fires MiniMax `WhatToAnswer`/`Assist` with latest N-sec window + latest screenshot
- Configurable trigger cadence: off / on-silence / on-demand — **shipped 2026-04-17** via TASKS.md M5 Pass 1 (policy + IPC) + M5 Pass 2 (M5-T6 dispatch binding). UI surface (M5-T8) still pending; mode can be set today via `window.electronAPI.setRollingTriggerMode('off' | 'on-silence' | 'on-demand')`.
- Pre-transcription 2-second min-audio guard (no STT spend on silence)
- Live "what to say next" pane in the renderer with streamed output

### M3 — Context Enrichment & Personal Knowledge
**Goal:** user-provided materials (resume, JD, reference docs) feed into rolling context.

**Deliverables:**
- Replace premium profile/RAG hooks with a local-only variant backed by SQLite + `sqlite-vec`
- User-provided document ingestion (PDF, DOCX, MD) via `pdf-parse` / `mammoth`
- Simple retrieval over user docs injected into the rolling context
- "Pinned context" UI: docs that should always be in the prompt
- Export/import of personal knowledge base
- Optional: Claude and Google Gemini as additional BYOK providers

## Explicit constraints
- No secrets in renderer
- No direct provider calls from renderer
- Prompt construction stays in main
- Capture is always user-initiated (no passive screenshots, no background recordings without explicit toggle)
- Small testable changes only; no broad rewrites
- See [CLAUDE.md](CLAUDE.md) and [SECURITY.md](SECURITY.md)

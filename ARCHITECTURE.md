# Architecture — sensi

> Audited 2026-04-12. M0-T1 through M0-T7 landed 2026-04-12 / 2026-04-13. This document reflects the **current** state of the forked codebase after M0 neutralization, not the end-state target. See [PRD.md](PRD.md) for the milestone roadmap toward the sensi target shape.

## Base
sensi is a fork of `natively-cluely-ai-assistant` (commercial "Natively" meeting copilot). The upstream product is a subscription-gated Electron app with multi-provider LLM routing, trial/license enforcement, dual-channel audio transcription, and screenshot+vision pipelines. sensi keeps the technical scaffolding but drops the commercial product layer.

## Current stack

| Layer | Technology |
|---|---|
| Shell | Electron 33 |
| Build | Vite 5 + `electron-vite` + `electron-builder` |
| Language | TypeScript 5.6 |
| UI | React 18 + Radix UI + Tailwind 3 + Framer Motion |
| Storage | `better-sqlite3` 12 (+ `sqlite-vec` for embeddings), `electron-store`, `keytar` / `safeStorage` |
| Native | Rust/NAPI audio module (`native-module/`) |
| Packaging | Windows NSIS + portable, macOS dmg (x64 + arm64), Linux AppImage + deb |
| Auto-update | `electron-updater` — **disabled by default** (guarded behind `SENSI_ENABLE_UPDATER=true`, publish config repointed at `tobyjoe/sensi` placeholder) |
| Product identity | `name: "sensi"`, `productName: "sensi"`, `appId: "com.tobyjoe.sensi"` — set in M0-T7 |

## Process topology

```
┌──────────────────────────────────────────────────────┐
│ Renderer (src/, ~15k LOC, React)                     │
│   - Overlay windows, settings, screenshot queue      │
│   - Calls window.electronAPI (contextBridge only)    │
│   - contextIsolation: true, nodeIntegration: false   │
└──────────────────────┬───────────────────────────────┘
                       │ IPC (176 channels)
┌──────────────────────┴───────────────────────────────┐
│ Main process (electron/, ~14.8k LOC)                 │
│   - main.ts: lifecycle, tray, permissions, logging   │
│   - WindowHelper: BrowserWindow, multi-monitor       │
│   - ipcHandlers.ts: 176 safeHandle() channels        │
│   - LLMHelper.ts (3986 lines): provider routing      │
│   - IntelligenceEngine + IntelligenceManager: modes  │
│   - ScreenshotHelper: desktopCapturer + DPI stitch   │
│   - SessionTracker: rolling transcript aggregation   │
│   - DatabaseManager: SQLite persistence              │
│   - CredentialsManager: safeStorage-encrypted keys   │
│   - KeybindManager: global hotkeys                   │
└──────┬────────────────────────┬──────────────────────┘
       │                        │
┌──────┴────────┐       ┌───────┴───────────────┐
│ Audio (Rust)  │       │ Network               │
│ - Mic capture │       │ - Provider APIs       │
│ - Sys capture │       │ - STT WebSockets      │
│ - NAPI bridge │       │ - (NO renderer access)│
└───────────────┘       └───────────────────────┘
```

## Key files (verified)

### Main process entry
- `electron/main.ts` (2644 lines) — app lifecycle, tray, logging to `~/Documents/natively_debug.log`, permission checks, calls `initializeIpcHandlers()`
- `electron/preload.ts` (1172 lines) — `contextBridge.exposeInMainWorld('electronAPI', …)` with wrapped IPC only

### IPC + window management
- `electron/ipcHandlers.ts` (2924 lines) — **176 IPC channels** across 8 categories (license, meeting, LLM, STT, window, settings, providers, profile/RAG)
- `electron/WindowHelper.ts` (786 lines) — BrowserWindow config: `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: !isDev`

### LLM orchestration
- `electron/LLMHelper.ts` (3986 lines) — per-provider request/stream handling for Gemini, Groq, OpenAI, Claude, Ollama, curl/custom
- `electron/IntelligenceEngine.ts` (932 lines) + `electron/IntelligenceManager.ts` — mode routing
- `electron/llm/` — mode classes: `AnswerLLM`, `AssistLLM`, `BrainstormLLM`, `ClarifyLLM`, `CodeHintLLM`, `FollowUpLLM`, `FollowUpQuestionsLLM`, `RecapLLM`, `WhatToAnswerLLM`, `IntentClassifier`, `TemporalContextBuilder`, `transcriptCleaner`
- `electron/llm/prompts.ts` (2148 lines) — centralized system prompts (renderer-unreachable)

### Capture
- `electron/ScreenshotHelper.ts` (945 lines) — `takeScreenshot()`, `takeSelectiveScreenshot()`, multi-monitor DPI-normalized stitching via `sharp`, PNG output to `${userData}/screenshots`, queue cap of 5
- `electron/SessionTracker.ts` (652 lines) — meeting session lifecycle, transcript aggregation

### Audio subsystem (`electron/audio/`)
- `MicrophoneCapture.ts` — Rust NAPI wrapper, emits PCM frames
- `SystemAudioCapture.ts` — Rust NAPI wrapper for loopback audio, lazy-init to avoid startup mute
- STT providers (all extend `EventEmitter`, emit `{text, isFinal, confidence}`):
  - `GoogleSTT.ts` (REST)
  - `OpenAIStreamingSTT.ts` (WebSocket Realtime → whisper-1 fallback)
  - `DeepgramStreamingSTT.ts` (Nova-3 WebSocket)
  - `GroqStreamingSTT.ts`
  - `ElevenLabsStreamingSTT.ts` (WebSocket)
  - `SonioxStreamingSTT.ts` (WebSocket)
  - `NativelyProSTT.ts` (disabled per M0-T5; file kept but never instantiated)
- `nativeModuleLoader.ts` — dlopens the compiled Rust `.node` binary

### Windows Rust Toolchain (M3-T1)

The `native-module/` Rust sources compile to a single NAPI binary that
`MicrophoneCapture` and `SystemAudioCapture` dlopen at runtime. On a fresh
machine the binary must be built before the app can capture audio —
otherwise `nativeModuleLoader.ts` returns `null`, both capture classes
silently no-op in their constructors, and meetings have no audio or
transcription. The failure is undetected at runtime (no crash, no banner)
because the loader is permissive by design.

**Prerequisites (Windows x64):**

| Tool | Version | Install source | Why |
|---|---|---|---|
| Rust stable | 1.80+ | `rustup-init.exe` from https://rustup.rs | Required by `napi-derive 3.5.2` and `wasapi 0.13.0` |
| MSVC Build Tools | VS 2019 16.11+ or VS 2022 | "Build Tools for Visual Studio 2022" → "Desktop development with C++" workload | The `windows 0.52.0` crate links Win32 headers; `cl.exe` + `link.exe` must be on PATH or use "x64 Native Tools Command Prompt for VS 2022" |
| Windows 10/11 SDK | 10.0.19041+ | Installed with the VS Build Tools workload | Provides `Audio`, `Com`, `Threading` headers for `Win32_Media_Audio` / `Win32_System_Com` / `Win32_System_Threading` crate features |
| Node.js | 20.x LTS | nvm-windows or nodejs.org | Electron 33 ships Node 20; NAPI-RS uses `node-api.h` directly, so no `electron-rebuild` step is required for the native module (unlike `better-sqlite3` and `sharp` which are rebuilt by `postinstall`) |

**Build command:**

```bash
npm run build:native
```

Expands to `node scripts/build-native.js`, which runs
`npx napi build --platform --release` inside `native-module/`. Cold build
is 3–8 min on Windows with a fresh Rust toolchain (roughly 70 crate
compiles including `wasapi`, `cpal`, `windows`, `ringbuf`, `rubato`,
`webrtc-vad`). Warm incremental builds are ~30 seconds.

**Expected output:** a single `.node` file at
`native-module/index.win32-x64-msvc.node` (~3–5 MB). `nativeModuleLoader.ts`
probes three paths in order — packaged `resourcesPath/app.asar.unpacked/`,
dev `app.getAppPath()/`, and dev-fallback `app.getAppPath()/../` — and
loads the first one it finds.

**Verification:**

```bash
# Artifact must exist:
ls native-module/index.win32-x64-msvc.node

# Dev launch — main-process log must NOT print "nativeModuleLoader returned null":
npm run app:dev
```

When a meeting starts, the log must NOT contain either of:
- `[MicrophoneCapture] Cannot start: Rust module missing`
- `[SystemAudioCapture] Cannot start: Rust module missing`

**Troubleshooting:**
- `cl.exe` not found → open the "x64 Native Tools Command Prompt for VS 2022" and run `npm run build:native` from there, or add the VS build tools to your user PATH.
- `link.exe` missing → install the "Desktop development with C++" workload in Visual Studio Installer.
- Permission denied on `native-module/target/` → delete the `target/` directory and rebuild.
- `wasapi` or `windows` crate fails to link → confirm the Windows SDK is installed (check Visual Studio Installer → Individual Components → Windows 10/11 SDK).
- Changed Electron version → rebuild `better-sqlite3` and `sharp` via `npm rebuild` (the `postinstall` script does this automatically on `npm install`); the native module does NOT need a rebuild unless Node major version changes.

See DECISIONS.md D012 for the rationale on local-only builds (no CI matrix, no prebuild artifact).

### Knowledge subsystem (`electron/knowledge/`, M4)

Personal-use RAG pipeline for user-provided reference documents (resume,
JD, PDFs, DOCX, Markdown). Main-process only. Renderer interacts via the
M4-T8 IPC handlers (future task), which wrap the `KnowledgeOrchestrator`
public API 1:1. All storage, embeddings, and provider calls stay in main.
See DECISIONS.md D014–D019 for the implementation trail.

- **`parsers.ts` (M4-T2)** — four pure helpers: `extractTextFromPdf`,
  `extractTextFromDocx`, `extractTextFromMarkdown`, `extractTextFromPlain`.
  Take a `Buffer` of file bytes, return normalized plain text. No
  filesystem reads inside the helpers — callers pass buffers.
- **`chunker.ts` (M4-T3)** — one pure function `splitIntoChunks(text,
  { maxChars?, overlap? }) → string[]`. Defaults: 1500 chars, 200 overlap.
  Sentence-boundary-aware backward search in the last ~30% of each window,
  hard-cut fallback. Zero deps, deterministic.
- **`KnowledgeStore.ts` (M4-T4)** — typed CRUD + vector search wrapper
  around the M4-T1 `kb_documents` / `kb_chunks` / `vec_kb_chunks` schema.
  8 public methods: insertDocument, upsertChunks, listDocuments,
  deleteDocument, searchByEmbedding, getDocumentText, setPinned, listPinned.
  Three typed error classes. BigInt binding rule for `vec_kb_chunks.chunk_id`
  centralized via internal `toVecPk()` helper (see D014c).
- **`EmbeddingAdapter.ts` (M4-T5, extended in M4-T6)** — produces 768-dim
  Float32 vectors. Provider policy: Ollama `nomic-embed-text` primary →
  Gemini `text-embedding-004` fallback → typed error if neither available.
  No OpenAI text-embedding-3-small in M4 (1536-dim would break the
  fixed-768 vec0 schema — see D018a). Three typed error classes.
  DI-friendly constructor for test hooks. M4-T6 added `resolveProvider()`
  for the zero-chunk ingestion path (D019a).
- **`KnowledgeOrchestrator.ts` (M4-T6)** — thin coordinator over the four
  primitives above. 8 public methods: ingestDocument, queryKnowledge,
  listDocuments, deleteDocument, pinDocument, unpinDocument, listPinned,
  getDocumentText. Handles file reads (`fs.promises.readFile`), MIME
  detection by extension, atomicity cleanup on ingest failure, and model-
  compatibility enforcement at query time (D019b: throw when all docs
  wrong model, silently filter in mixed-model DBs). Structural DI
  interfaces `KnowledgeStoreLike` and `EmbeddingAdapterLike` keep tests
  deterministic without `vi.mock`.
- **`buildKnowledgeContext.ts` (M4-T7)** — single exported async function
  `buildKnowledgeContextBlock(deps) → Promise<string>` that reads pinned
  docs + retrieved chunks from a `KnowledgeOrchestratorForContext` stub
  and formats them into a bounded, delimited knowledge block ready for
  prompt assembly. Hooked into `electron/llm/WhatToAnswerLLM.ts` via an
  optional `knowledgeContextFn: (query) => Promise<string>` constructor
  parameter (closure wraps the orchestrator — WhatToAnswerLLM stays
  decoupled from the knowledge module). Handles all typed-error
  degradation internally — live-assist stream is never broken by
  knowledge-base failures. See DECISIONS.md D020 for the format, size
  budget, dedup rule, query-derivation rule, and per-error policy.
- **`knowledgeIpcHelpers.ts` (M4-T8, extended in M4-T10)** — 10 pure
  DI-friendly handler functions (the 8 from M4-T8 plus
  `handleExportKnowledge` and `handleImportKnowledge` from M4-T10)
  that back the renderer-facing IPC channels. Each validates input,
  delegates to the orchestrator via a structural `KnowledgeOrchestratorForIpc`
  interface, catches typed errors, and translates them to the
  `KnowledgeIpcResult` discriminated union. The preview handler enforces
  a hard max of 12000 chars (default 4000) — full document text is never
  exposed through the IPC surface. Also exports `makeKnowledgeContextClosure`
  factory used by `IntelligenceEngine.initializeLLMs()` to produce the
  knowledge-hook closure passed to `WhatToAnswerLLM` (graceful degradation
  to `null` if the orchestrator can't be constructed). See DECISIONS.md D021.
- **`knowledgeTransfer.ts` (M4-T10)** — pure export/import module. Three
  typed errors (`KnowledgeExportError`, `KnowledgeImportError`,
  `KnowledgeIncompatibleFormatError`), format constants
  (`KNOWLEDGE_EXPORT_MAGIC`, `KNOWLEDGE_EXPORT_VERSION = 1`,
  `KNOWLEDGE_EXPORT_EMBEDDING_DIM = 768`), pure helpers
  (`buildExportArtifact`, `validateImportArtifact`), and IO entry points
  (`exportKnowledgeToFile`, `importKnowledgeFromFile`). Single versioned
  JSON artifact; replace policy with pre-import on-disk backup written
  to `<userData>/knowledge-preimport-backup-<ISO>.json` before
  `KnowledgeStore.replaceAllFromArtifact` runs its transactional wipe
  + insert. Structural DI via `ExportReadableStore` / `ImportWritableStore`
  / `TransferStore` interfaces keeps the module unit-testable without
  `better-sqlite3`. See DECISIONS.md D023.

**Production wiring path:**
```
renderer → window.electronAPI.knowledge*
  → ipcMain.handle('knowledge-*')                (electron/ipcHandlers.ts)
  → safeHandle wrapper
  → DatabaseManager.getInstance().getKnowledgeOrchestrator()
  → knowledgeIpcHelpers.handleX(orch, args)      (electron/knowledge/knowledgeIpcHelpers.ts)
  → KnowledgeOrchestrator method                 (electron/knowledge/KnowledgeOrchestrator.ts)
  → KnowledgeStore / EmbeddingAdapter / parsers  (main process, no renderer access)

IntelligenceEngine.initializeLLMs() → buildKnowledgeContextClosureOrNull()
  → makeKnowledgeContextClosure(() => DatabaseManager.getInstance().getKnowledgeOrchestrator())
  → new WhatToAnswerLLM(helper, closure)         (live-assist prompt assembly)
```

`DatabaseManager.getKnowledgeOrchestrator()` is the single production
instantiation point. Lazy-constructed on first call, cached thereafter.
Uses a runtime `require()` to avoid a circular type-level import.

Storage tables added in M4-T1 (lives inside the existing `sensi.db`):
- `kb_documents` — scalar metadata (id, name, mime, bytes, embedding_model,
  embedding_dim, pinned, pinned_at, ingested_at)
- `kb_chunks` — scalar chunk text (id TEXT PK, doc_id FK, chunk_index, text)
- `vec_kb_chunks` — sqlite-vec `vec0(chunk_id INTEGER PRIMARY KEY,
  embedding float[768])` — hard-coded 768-dim per D014a

Outstanding M4 work: T9 renderer settings pane, T10 export/import,
T11 manual smoke.

### Services (`electron/services/`)
- `CredentialsManager.ts` — API key storage via `safeStorage.encryptString`, encrypted `credentials.enc` at `${userData}`; trial token fields (lines 57–60)
- `KeybindManager.ts` — global hotkey registration
- `ModelVersionManager.ts` — model discovery/cache
- `CalendarManager.ts` — Outlook/Calendar integration
- `SettingsManager.ts`, `OllamaManager.ts`, `RateLimiter.ts`

### Data
- SQLite: `${app.getPath('userData')}/natively.db` — meetings, transcripts, usage, action items, sqlite-vec embeddings (filename rename deferred to M1-T8 with copy-on-first-launch migration)
- Encrypted credentials: `${app.getPath('userData')}/credentials.enc` — trial fields removed in M0-T5
- Non-secret settings: `electron-store` at OS app data path
- Debug log: `${documents}/sensi_debug.log` (renamed from `natively_debug.log` in M0-T7)

### Personal-use stubs / dead-wings kept for compile compatibility
- `premium/electron/services/LicenseManager.ts` — M0-T2 stub satisfying 12 `require()` call sites in `ipcHandlers.ts` and `electron/premium/featureGate.ts`. Returns `isPremium: true`, `getLicenseDetails: { provider: 'personal-use' }`, etc. See DECISIONS.md D003/D008.
- `electron/audio/NativelyProSTT.ts` — file kept per M0-T5 task constraint but no longer imported or instantiated. Class constant `wss://api.natively.software/v1/transcribe` is never reached.
- `electron/DonationManager.ts` + 3 IPC handlers — main-process service still registered; only renderer caller (`SupportToaster`) is gated off in M0-T6.
- Trial/donation/quota React components (`FreeTrialModal`, `FreeTrialBanner`, `TrialPromoToaster`, `NativelyQuotaBanner`, `SupportToaster`) — files kept per M0-T6 task constraint; all 6 render sites gated behind `!PERSONAL_USE` from `src/lib/config.ts`. Deletion deferred to M1-T8.

### Renderer (`src/`, ~35 components)
- React 18 overlay UI; key components:
  - `NativelyInterface.tsx` — main overlay
  - `GlobalChatOverlay.tsx`, `MeetingChatOverlay.tsx`
  - `settings/AIProvidersSettings.tsx`, `NativelyApiSettings.tsx`, `HelpSettings.tsx`
  - `Queue/ScreenshotQueue.tsx` (via `_pages/Queue.tsx`)
  - `trial/FreeTrialModal.tsx`, `trial/FreeTrialBanner.tsx`, `trial/TrialPromoToaster.tsx` — **to be gated off in M0, deleted in M1**
  - `StartupSequence.tsx`, `PermissionsToaster.tsx`, `UpdateModal.tsx`

## Trust boundaries (6 layers — see [SECURITY.md](SECURITY.md))

1. **Screen capture** — main-process `desktopCapturer` only; renderer receives file paths, never raw PNG bytes
2. **Audio capture** — Rust NAPI module in main; renderer receives transcript strings only
3. **Local storage** — SQLite + safeStorage-encrypted credentials + electron-store, all in main
4. **Context assembly** — `TemporalContextBuilder` + `transcriptCleaner` in main; prompts never leave main
5. **Outbound API calls** — all provider fetches from main; renderer CSP blocks provider hosts
6. **Renderer / UI** — `contextIsolation: true`, `nodeIntegration: false`, wrapped `contextBridge` only

## Known current-state findings

Status legend: ✅ mitigated in M0 • ⚠️ partially mitigated / deferred • ⏳ still open

| # | Finding | Location | Status |
|---|---|---|---|
| F1 | Missing `premium/` directory caused runtime exceptions | `electron/ipcHandlers.ts` (12 call sites) | ✅ **M0-T2**: stub created at `<root>/premium/electron/services/LicenseManager.ts`; all 12 sites resolve cleanly. See DECISIONS.md D003/D008. |
| F2 | Google Analytics GA4 (`G-494RMJ2G6E`) loaded in renderer despite PRIVACY.md claiming "no telemetry" | `src/lib/analytics/analytics.service.ts`, `index.html` CSP | ✅ **M0-T3**: service file deleted, 28 call sites removed, CSP hosts removed. |
| F3 | `electron-updater` publish config pointed at upstream `evinjohnn/natively-cluely-ai-assistant` GitHub releases | `package.json` `build.publish` | ✅ **M0-T4**: repointed at `tobyjoe/sensi` placeholder; `setupAutoUpdater()` guarded behind `SENSI_ENABLE_UPDATER=true`. Manual-trigger methods still unguarded — see SECURITY.md R3. |
| F4 | `api.natively.software` endpoints referenced for trial, chat, STT | `LLMHelper.ts`, `NativelyProSTT.ts`, `ipcHandlers.ts` | ✅ **M0-T5**: `generateWithNatively`/`streamWithNatively` short-circuited, 6 trial/usage IPC handlers stubbed, `NativelyProSTT` removed from STT registry, trial credential methods removed from `CredentialsManager`. No live network path remains. |
| F5 | Hardcoded DodoPayments checkout URLs in trial modal | `src/components/trial/FreeTrialModal.tsx` | ✅ **M0-T6**: all 6 trial/quota render sites gated behind `!PERSONAL_USE`. Modal never mounts. File retained for M1-T8 deletion. |
| F6 | `InstallPingManager.ts` phoned home on install | `electron/services/InstallPingManager.ts` | ✅ **M0-T3**: file deleted, init block removed from `main.ts`. |
| F7 | **MiniMax integration: zero** — only doc references | grep `minimax` → docs only | ⏳ **M1**: `MiniMaxProvider.ts`, typed `ProviderStatus`, credential slot, default-model migration, and Settings UI are the M1 deliverables. |
| F8 | `LLMHelper.ts` is 3986 lines | | ⏳ **M1-T1**: provider adapter layer refactor (non-invasive wrapper). |
| F9 | Both `sqlite3` and `better-sqlite3` declared | `package.json` | ⏳ M2+ dependency hygiene. |
| F10 | `tesseract.js` bundled but usage unclear | `package.json` | ⏳ M2+ dependency hygiene. |
| F11 | `webSecurity: !isDev` — disabled in dev mode | `electron/WindowHelper.ts:150-154` | ⏳ **M0-T8 verification** will confirm re-enabled in packaged build. |

See [SECURITY.md](SECURITY.md) for severity ratings and mitigation status.

## Target shape (summary — full roadmap in [PRD.md](PRD.md))

- Windows-first Electron app, local-first storage
- Manual screenshot capture (hotkey + tray + explicit UI, no passive/interval capture)
- Dual-channel live transcription (mic + system) → rolling context
- Provider abstraction with **MiniMax default**, BYOK, Claude/Google as add-ons
- Typed `ProviderStatus` surface (never bare boolean)
- Prompts centralized in main; UI never constructs prompts
- Paywall/trial/telemetry removed; no upstream cloud coupling
- Auto-updater disabled until sensi has its own release channel

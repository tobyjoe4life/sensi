# Tasks — sensi

> Source of truth for execution. Each task is narrow, testable, and reversible. Execute in order. Do not start M0-T2 without explicit approval after M0-T1 completes, and so on.

## Active milestone
**M0 — Clean Baseline** (T1–T8 complete) ✅
**M1 — Multi-provider key vault with per-session provider+model switching** (Steps 1–5 complete + post-smoke cleanup) ✅
**M2 — Component rename + DB migration + STT polish + UI cleanup** (T1–T4 complete) ✅
**M3 — Runtime audio + Deepgram wiring + summary routing** (T1–T4 complete, closed 2026-04-17) ✅
**M3-FIX-01 — OpenAI token clamp + RAG active-provider routing** ✅
**M4 — Context enrichment & personal knowledge** (T1–T11 complete, closed 2026-04-15) ✅
**POLISH-01 — Branding sweep + auto-scroll during streaming** ✅ (2026-04-17)
**M7 / RESEARCH-01 — Standalone Tavily research chip** ✅ (2026-04-18, v2.7.0) — Tavily key surfaced as a first-class Search Provider in Settings; `Research` chip in the overlay runs `research:run` IPC → Tavily → LLM brief with source links. Works without persona.
**Next:** M7 / KNOWLEDGE-02 — per-meeting document binding + auto-suggest (target v2.8.0). Plan: `C:\Users\Toby\.claude\plans\foamy-jingling-diffie.md`.

Goal: sensi builds and launches on Windows with no license crashes, no analytics, no upstream auto-update, no cloud calls to `natively.software` — and all docs reflect reality.

---

## M0 tasks

### M0-T1 — Audit docs landed ✅ **DONE 2026-04-12**
- [x] Update `CLAUDE.md` with fork status note
- [x] Rewrite `ARCHITECTURE.md` reflecting audited codebase structure
- [x] Rewrite `PRD.md` with milestone roadmap M0 → M3
- [x] Rewrite `SECURITY.md` with 6 trust boundaries + 11 risks with severity
- [x] Rewrite `TASKS.md` with full M0 + M1 task lists (this file)
- [x] Rewrite `DECISIONS.md` with ADR entries D000 → D007
- [x] Rewrite `TESTS.md` with test strategy
- **Result:** All 7 docs landed; zero source code touched.

### M0-T2 — LicenseManager stub ✅ **DONE 2026-04-12**
- [x] Create stub at the **actual** runtime-resolved path `<root>/premium/electron/services/LicenseManager.ts` (not `electron/premium/electron/services/LicenseManager.ts` — see DECISIONS.md D008 for path correction)
- [x] Stub returns `isPremium: true`, `isPremiumAsync: true`, `isProOrTrialActive: true`, `activateLicense`/`activateWithApiKey` both succeed, `getDetails`/`getLicenseDetails` return `{ isPremium: true, provider: 'personal-use', … }`, `getHardwareId: 'sensi-local'`
- [x] Includes two extra methods (`getLicenseDetails`, `activateWithApiKey`) beyond the task's explicit list, required because ipcHandlers.ts actually calls them at lines 98, 884, 907
- [x] `getInstance()` singleton pattern matches all 12 call sites
- **Result:** All 12 `require('../premium/electron/services/LicenseManager')` call sites resolve cleanly; no runtime exceptions on license paths.

### M0-T3 — Kill analytics and install ping ✅ **DONE 2026-04-13**
- [x] Deleted `src/lib/analytics/analytics.service.ts` (and the empty `src/lib/analytics/` directory)
- [x] Removed 28 analytics call sites across `src/App.tsx`, `src/components/NativelyInterface.tsx`, `src/components/SettingsOverlay.tsx`, `src/components/Launcher.tsx`, `src/components/ErrorBoundary.tsx`, `src/components/ui/ConnectCalendarButton.tsx`
- [x] Removed `www.googletagmanager.com` from `index.html` CSP `script-src`; removed `www.googletagmanager.com`, `*.google-analytics.com`, `analytics.google.com` from `connect-src`
- [x] Deleted `electron/services/InstallPingManager.ts` and removed its init block in `electron/main.ts`
- [x] Grep sweep clean: `rg -i "gtag|googletagmanager|G-494RMJ2G6E|analytics\.service|InstallPingManager"` returns zero hits in active source
- **Result:** No telemetry code remains in the compiled app; CSP no longer whitelists analytics hosts.

### M0-T4 — Neutralize upstream auto-updater ✅ **DONE 2026-04-13**
- [x] Changed `package.json` `build.publish` from `evinjohnn/natively-cluely-ai-assistant` to sensi-owned placeholder `tobyjoe/sensi`
- [x] Guarded `setupAutoUpdater()` body in `electron/main.ts` behind `if (process.env.SENSI_ENABLE_UPDATER !== 'true') return;` — no event listeners attached, no startup check scheduled by default
- [x] `electron-updater` dependency kept in `package.json` for future sensi release channel
- **Result:** Launching sensi does not contact the upstream GitHub release feed. Three manual-trigger methods (`checkForUpdates`, `downloadUpdate`, `quitAndInstallUpdate`) remain unguarded — flagged for a follow-up task, but they'd only be reached via an explicit UI click and would 404 against the `tobyjoe/sensi` placeholder.

### M0-T5 — Neutralize natively.software endpoints ✅ **DONE 2026-04-13**
- [x] Removed `NativelyProSTT` from STT provider registry in `electron/main.ts` (import, type union, `createSTTProvider` branch, `languageDetected` wiring). File kept per task, now unreachable at runtime.
- [x] Short-circuited `generateWithNatively()` and `streamWithNatively()` in `electron/LLMHelper.ts` with early `throw new Error('ProviderNotAvailable: natively-cloud disabled for sensi (M0-T5)')`
- [x] Stubbed 6 IPC handlers that hit `api.natively.software` (`get-natively-usage`, `trial:start`, `trial:status`, `trial:get-local`, `trial:convert`, `trial:end-byok`) — returning personal-use defaults
- [x] Removed 6 trial credential methods from `CredentialsManager.ts` (`getTrialToken`, `getTrialExpiresAt`, `getTrialStartedAt`, `setTrialToken`, `clearTrialToken`, plus the three `trial*` fields) — see DECISIONS.md D009 for scope rationale
- [x] Fixed every downstream caller of the removed methods (`ipcHandlers.ts` × 6, `LLMHelper.ts` × 2, `NativelyProSTT.ts` × 1) with minimal dead-code edits
- [x] Grep sweep: no active `natively.software` network calls remain; all remaining hits are in dead code, unused class constants, or marketing URLs passed to `shell.openExternal()`
- **Result:** No live network path to `api.natively.software` from any runtime code path.

### M0-T6 — Hide trial/donation/quota UI (renderer) ✅ **DONE 2026-04-13**
- [x] Created `src/lib/config.ts` exporting `PERSONAL_USE = true as const` — see DECISIONS.md D010
- [x] Gated 6 render sites with `{!PERSONAL_USE && …}`: `<SupportToaster />`, `<NativelyQuotaBanner />`, `<FreeTrialBanner>`, `<TrialPromoToaster>`, `<FreeTrialModal>` (App.tsx), and `<FreeTrialModal>` (NativelyApiSettings.tsx)
- [x] Removed trial polling block and `onTrialEnded` listener from `App.tsx` startup useEffect (plus matching cleanup in the return)
- [x] Component files preserved for M1-T8 deletion
- **Result:** No trial / donation / quota UI mounts in personal-use mode. `PERSONAL_USE` is a compile-time `true as const`, so gates fold to `false` in release builds.

### M0-T7 — Rename `productName`, `appId`, permission strings, tray, log file ✅ **DONE 2026-04-13**
- [x] `package.json`: `name: "sensi"`, new description, `appId: "com.tobyjoe.sensi"`, `productName: "sensi"`, updated `NSScreenCaptureUsageDescription` and `NSMicrophoneUsageDescription`
- [x] `electron/main.ts`: log file `natively_debug.log` → `sensi_debug.log`, two `tray.setToolTip('Natively')` → `'sensi'`, `_applyDisguise` default `appName` and `'none'` case literals → `"sensi"` (these flow into `app.setName()` and `process.title`)
- [x] `electron/ipcHandlers.ts`: updated two `get-log-file-path` / `open-log-file` handlers to match the new log file name
- [x] `electron/preload.ts`: comment reference to log file path updated
- [x] `src/components/SettingsOverlay.tsx`: updated the displayed log path string in the Settings → Advanced → Logs panel (one-line literal fix, not a symbol rename)
- [x] Required grep sweep `rg "natively_debug|NativelyMeeting|com\.electron\."` returns zero hits
- [x] React component files, TS symbols, SQLite database filename, and asset files (`natively.icns`, etc.) deliberately kept — deferred to M1-T8
- **Result:** All `app.setName`, tray tooltip, log file, permission, installer, and package.json identifiers now read "sensi". The full renderer/asset rename is the M1-T8 follow-up.

### M0-T8 — Build & smoke test ✅ **AUTOMATED PORTION DONE 2026-04-13 — manual launch test pending**

**Automated (verified):**
- [x] `npm install` — 1550 packages, exit 0 (1m); non-fatal warnings for macOS-only `sqlite-vec-darwin-*` optional deps and macOS plist patch (expected on Windows)
- [x] `npm run typecheck:electron` — **clean**, zero errors
- [x] `npm run build` — **clean**, 3855 modules, 9.73s (only warning is pre-existing main bundle size 1.96 MB)
- [x] `npm run build:electron` — **clean**, 403 ms
- [x] `dist-electron/premium/electron/services/LicenseManager.js` exists at the runtime-resolved path
- [x] `dist-electron/electron/audio/NativelyProSTT.js` compiled but no longer imported (see M0-T5)
- [x] `InstallPingManager.ts` absent from `dist-electron/electron/services/`
- [x] Zero GA4 / gtag / googletagmanager / G-494RMJ2G6E references in built `dist/` renderer bundle
- [x] Zero `api.natively.software/v1/trial`, `/v1/usage`, `/v1/chat` references in built `dist/` or `dist-electron/`
- [x] `PERSONAL_USE`, `SENSI_ENABLE_UPDATER`, `sensi_debug.log`, `com.tobyjoe.sensi` identifiers present in compiled output
- [x] M0 grep sweeps (cumulative): `rg "googletagmanager|natively\.software|dodopayments|com\.electron\.meeting|natively_debug|G-494RMJ2G6E|analytics\.service|InstallPingManager|trialToken|trialExpiresAt|trialStartedAt|setTrialToken|clearTrialToken|NativelyMeeting"` returns only deferred marketing-URL strings (dead in tree-shaken runtime) and `dodollm.txt` (scratch text file at project root, not compiled)

**Manual (pending user's Windows machine — requires GUI interaction):**
- [ ] `npm run app:dev` launches without crash
- [ ] Take a screenshot via hotkey, confirm it lands in the queue
- [ ] Start a dummy STT session, confirm no natively.software calls
- [ ] Network monitor: confirm zero calls to googletagmanager / natively.software / dodopayments / evinjohnn at startup
- [ ] Confirm no trial modal / banner / quota UI appears
- [ ] Confirm tray tooltip reads "sensi", installer/title-bar reads "sensi", log file at `~/Documents/sensi_debug.log`

**Dead strings remaining in built bundle (acceptable — not runtime-reached):**
| String | Count in dist/ | Location | Status |
|---|---|---|---|
| `evinjohnn/natively-cluely-ai-assistant` | 1 occurrence | AboutSection / UpdateBanner marketing links | Click-activated only; deferred to M1-T8 |
| `natively.software` | 2 occurrences | AboutSection / HelpSettings / NativelyApiSettings marketing links | Click-activated only; deferred to M1-T8 |
| `checkout.dodopayments.com/buy/pdt_*` | 4 URL constants | `PLAN_*_URL` in `FreeTrialModal`/`FreeTrialBanner`/`NativelyApiSettings` (components gated off via `PERSONAL_USE`) | Gated components never mount; deleted in M1-T8 |

**Exit criteria status:**
- ✅ Risks R1, R2, R4, R5, R6 **mitigated** (M0-T2, M0-T3, M0-T5, M0-T6)
- ⚠️ Risks R3, R7 **partially mitigated** (M0-T4, M0-T3) — remaining residuals documented in [SECURITY.md](SECURITY.md)
- ⏳ Risk R8 **verification pending** manual launch (`webSecurity` packaged-build check)
- ✅ `npm run typecheck:electron` clean
- ✅ `npm run build` clean
- ✅ `npm run build:electron` clean
- ⏳ Manual launch smoke test pending

---

## M1 — Multi-provider key vault with per-session provider+model switching

> **Scope reframing note:** The original M1 plan (M1-T1..T9 below, kept as
> historical context) framed M1 as "make MiniMax the default provider and
> bulk-rename Natively → sensi". The user reframed M1 mid-execution to
> "multi-provider key vault with per-session switcher" — a less invasive
> design that adds MiniMax as one provider alongside the existing five,
> with a typed ProviderStatus surface and a runtime switcher. The five
> sequential steps below replaced the original task list and are what
> actually shipped. Component file renames moved to M2 cleanup.

### M1 Step 1 — Shared registry move + types ✅ **DONE 2026-04-13**
- [x] Created `electron/providers/types.ts` with `ProviderId` + `ProviderStatus` (type-only, runtime-safe for both processes)
- [x] Moved `STANDARD_CLOUD_MODELS` registry to `electron/shared/standardCloudModels.ts`
- [x] Added MiniMax entry to the registry (with TODO placeholder model IDs replaced by verified IDs in Step 2)
- [x] Wired Vite alias `@shared` → `./electron/shared`, `@providers` → `./electron/providers` (matching `tsconfig.json` paths)
- [x] `src/utils/modelUtils.ts` rewritten as a re-export shim so existing imports continue working
- [x] Forward-added `hasMinimaxKey?` and `minimaxPreferredModel?` to `getStoredCredentials` return type in `electron/preload.ts` and `src/types/electron.d.ts`
- **Result:** Both main and renderer can import the registry from the same source; build clean.

### M1 Step 2 — LLMHelper.ts additive MiniMax integration ✅ **DONE 2026-04-13**
- [x] Verified MiniMax model IDs from https://platform.minimax.io/docs/api-reference/text-openai-api: flagship `MiniMax-M2.7`, fast-tier `MiniMax-M2.7-highspeed`
- [x] Verified base URL: `https://api.minimax.io/v1` (NOT `api.minimaxi.chat` as the original plan assumed)
- [x] Verified vision limitation: MiniMax OpenAI-compat endpoint is **text-only** — `imagePaths` deliberately omitted from the streaming method, dropped with a warning in the dispatch branch
- [x] Six additive edits to `electron/LLMHelper.ts`: `MINIMAX_DEFAULT_MODEL` constant, private `minimaxClient` + `minimaxApiKey` fields, `setMinimaxApiKey()` method, `isMiniMaxModel()` classifier with priority-before-OpenAI guard comment, `setModel()` alias branch for `'minimax'`, dispatch branch in `streamChat()` placed **before** the OpenAI branch, `streamWithMiniMax()` + `generateWithMiniMax()` methods that reuse the OpenAI SDK with a `baseURL` override
- [x] Replaced TODO model ID placeholders in `electron/shared/standardCloudModels.ts` with the verified `MiniMax-M2.7` + `MiniMax-M2.7-highspeed`
- **Result:** MiniMax is now a first-class branch in the LLMHelper dispatch chain with zero modifications to existing provider paths.

### M1 Step 3 — Credentials + Settings + provider selection wiring ✅ **DONE 2026-04-13**
- [x] **Native runtime fix first:** diagnosed and fixed sqlite3/Electron native module mismatch (NODE_MODULE_VERSION 137 vs 130) via `npx electron-rebuild -w better-sqlite3 -f`, made durable via `package.json` `postinstall` script update
- [x] `CredentialsManager.ts`: added `minimaxApiKey?` + `minimaxPreferredModel?` fields, `getMinimaxApiKey()` getter, `setMinimaxApiKey(key)` setter, extended `getPreferredModel`/`setPreferredModel` provider union to include `'minimax'`
- [x] `ProcessingHelper.loadStoredCredentials()`: restores MiniMax client across restarts via `llmHelper.setMinimaxApiKey(key ?? null)`
- [x] `ipcHandlers.ts`: new `set-minimax-api-key` handler (mirrors set-gemini/groq/openai/claude pattern), extended `get-stored-credentials` to populate `hasMinimaxKey` + `minimaxPreferredModel`, extended `test-llm-connection` to validate MiniMax via a real `https://api.minimax.io/v1/chat/completions` call with `MiniMax-M2.7`, extended `fetch-provider-models` and `set-provider-preferred-model` to accept `'minimax'`
- [x] `preload.ts` + `src/types/electron.d.ts`: added `setMinimaxApiKey` to the `ElectronAPI` surface and widened the four provider-union types
- [x] `ProviderCard.tsx`: widened `providerId` prop type to include `'minimax'`
- [x] `AIProvidersSettings.tsx`: new MiniMax tile after the Claude tile, full save/test/preferred-model flow
- **Result:** MiniMax key flows from Settings UI → main process → encrypted credentials.enc → restored at launch → live LLMHelper client. Existing five providers unchanged.

### M1 Step 4 — Typed ProviderStatus IPC + grouped picker + header pill ✅ **DONE 2026-04-13**
- [x] `CredentialsManager.ts`: added `activeProvider?: ProviderId` field (active model reuses `defaultModel`), `setActiveProviderAndModel()`, `getActiveProviderAndModel()`, `resolveModelForProvider()` fallback chain
- [x] Three new IPC handlers in `ipcHandlers.ts`: `llm:get-configured-providers` (returns `ProviderStatus[]` for all 6 providers in fixed order, never bare booleans), `llm:get-active-provider-and-model`, `llm:set-active-provider-and-model` (persists, swaps `LLMHelper.currentModelId`, broadcasts `llm-active-changed`)
- [x] `preload.ts` + `src/types/electron.d.ts`: four new typed methods (`getConfiguredProviders`, `setActiveProviderAndModel`, `getActiveProviderAndModel`, `onLlmActiveChanged`)
- [x] `ModelSelectorWindow.tsx`: full rewrite to provider-grouped layout, fed by `getConfiguredProviders()`, click handler calls `setActiveProviderAndModel()`, subscribes to `onLlmActiveChanged` for live updates
- [x] `ModelSelectorWindowHelper.ts`: BrowserWindow size bumped from 140×200 to 220×360 to fit grouped layout
- [x] `NativelyInterface.tsx`: existing model button enhanced with provider+model pill text, new state hooks for `currentProvider` + `providerPairLoaded`, subscription to `onLlmActiveChanged`
- [x] `Launcher.tsx`: brand-new pill button added to the Right Actions header, with `formatPillLabel()`, click-to-open-selector handler, and the same subscription pattern
- **Result:** Active provider+model is a single typed pair persisted in `credentials.enc`, surfaced via three typed IPC channels, broadcast to all open windows on change, rendered in three places (the picker, the launcher header pill, the overlay header pill).

### M1 Step 5 — Tests + verification ✅ **DONE 2026-04-13**
- [x] Installed `vitest@^1.6.0` + `@vitest/coverage-v8@^1.6.0` as devDependencies (the spec assumed vitest was already available — it wasn't)
- [x] Added `vitest.config.ts` mirroring the `@shared` / `@providers` aliases from `vite.config.mts`
- [x] Added `test`, `test:watch`, `test:coverage` scripts to `package.json`
- [x] New test file `electron/__tests__/providers.test.ts` with **31 tests** across 7 describe blocks: 5 LLMHelper.isMiniMaxModel cases + 4 LLMHelper.setMinimaxApiKey cases + 3 CredentialsManager MiniMax slot roundtrips + 4 active-pair roundtrips + 3 STANDARD_CLOUD_MODELS shape checks + 5 resolveModelForProvider fallback cases + 7 ProviderStatus shape generation tests
- [x] All tests run under plain Node with the `electron` module mocked (stub `app.getPath` + plaintext `safeStorage` fallback). Zero network calls.
- [x] Two test-runner issues hit and fixed inline: `vi.mock` hoisting (moved temp dir into the factory closure) and `CredentialsManager.resolveModelForProvider` lazy `require` not resolving `.ts` extensions under vitest (converted to static `import` — verified safe because `standardCloudModels.ts` has zero imports)
- [x] All five automated checks green: `typecheck:electron`, `build`, `build:electron`, `test`, `test:coverage`
- [x] Coverage report on M1 surface: `standardCloudModels.ts` 97.32% statements / 100% branches; `CredentialsManager.ts` 80% branches (M1-new methods at functional 100%, overall line% diluted by ~30 untested upstream getter/setter pairs); LLMHelper MiniMax edits exercised by the 9 LLMHelper unit tests but excluded from the coverage `include` glob to avoid 0.X% dilution on a 4000-line file
- **Result:** Automated coverage complete. M1 ready for manual smoke test on Windows.

### M1 Manual smoke test ✅ **PASSED 2026-04-13**
- [x] All 54 checklist steps confirmed by user on Windows
- [x] MiniMax responding correctly in the overlay, switching between providers works, persistence across restart works

### M1 Post-smoke cleanup — Strip MiniMax `<think>` reasoning tags ✅ **DONE 2026-04-13**
- [x] Bug surfaced during smoke test: MiniMax M2.7 emits raw `<think>...</think>` reasoning blocks before the actual answer; these were rendering visibly in the overlay
- [x] Added stateless `stripThinkingTags(text)` helper to `LLMHelper.ts` for the non-streaming path and unit tests
- [x] Added stateful filter inside `streamWithMiniMax()` that handles tag boundaries spanning chunk boundaries via a small mode + buffer state machine (`'normal' | 'inside'` mode + held-back partial-tag suffix)
- [x] Applied stripping ONLY to MiniMax — Gemini, Claude, OpenAI, Groq, Ollama untouched
- [x] Added 4 unit tests for `stripThinkingTags`: complete block in single string; unclosed tag passthrough; no-tag passthrough; think block followed by response content
- [x] All 35 tests pass (31 from Step 5 + 4 new), typecheck + build + electron transpile all clean
- **Result:** MiniMax M2.7 reasoning blocks no longer leak to the renderer. See DECISIONS.md D011.

---

## M3 — Runtime audio + Deepgram wiring + summary routing

> **Scope note:** The broader PRD M3 goal (local-only RAG over user-provided
> documents) is **deferred** to a later milestone. M3 as executed focuses on
> the three concrete blockers preventing sensi from being usable end-to-end
> for a real meeting: no Rust audio module, inert Deepgram wiring, and
> Gemini-only summary routing. See the M3 plan at
> `C:\Users\Toby\.claude\plans\foamy-jingling-diffie.md` for full context.

### M3-T1 — Build the Rust native audio module ✅ **DONE**
- [x] `npm run build:native` produces `native-module/index.win32-x64-msvc.node`
- [x] `nativeModuleLoader.ts` picks up the binary at dev-mode launch
- [x] `MicrophoneCapture` and `SystemAudioCapture` construct without the `!RustMicCapture` error branch
- **Result:** Rust module loads correctly at runtime; audio capture is no longer silent no-op.

### M3-T2 — Deepgram STT auto-promotion ✅ **DONE**
- [x] New pure helper `maybeAutoPromoteDeepgram(cm, apiKey): boolean` at `electron/services/sttAutoPromote.ts` — promotes `sttProvider: 'none' → 'deepgram'` when a non-empty key is saved while STT is unconfigured. Never overrides an explicit user choice.
- [x] `set-deepgram-api-key` handler in `electron/ipcHandlers.ts` updated: persist key → call helper → broadcast `credentials-changed` → call `appState.reconfigureSttProvider()` if `promoted === true` → return `{ success, promoted }`
- [x] 3 new unit tests in `electron/__tests__/providers.test.ts` cover all three branches (none+key→promote, google+key→skip, none+empty→skip)
- **Result:** Saving a Deepgram key on a fresh install immediately activates Deepgram as the STT provider and reconfigures the pipeline. No manual dropdown change required.

### M3-T3 — `generateMeetingSummary` active-provider routing ✅ **DONE**
- [x] Three new branches inserted in `LLMHelper.generateMeetingSummary` between the Groq block (~line 3604) and the existing Gemini Flash block (~line 3606). Order mirrors `streamChat()` dispatch exactly: MiniMax → OpenAI → Claude. Each branch logs on attempt, wraps in `withTimeout(60000)`, warns on failure, and falls through to the existing Gemini Flash (3 attempts) → Gemini Pro (5 attempts) chain.
- [x] Existing Custom / Natively / Groq / Gemini blocks are byte-identical — zero modifications.
- [x] 5 new unit tests exercise each branch: MiniMax active, OpenAI active, Claude active, no matching provider (fallthrough to Flash), active provider throws (fallthrough to Flash).
- **Result:** Meeting summaries now respect the user's active provider. A MiniMax-only user's meetings no longer fail silently at end-of-meeting.

### M3-T4 — Manual smoke test on Windows ✅ **DONE 2026-04-17**

Closed on the 2026-04-17 smoke run against OpenAI `gpt-5.4` as the active provider (user preference: fast responsiveness over MiniMax default). All 8 checklist items verified (6 directly exercised, 2 via equivalent invariants on the OpenAI path):

- [x] Fresh profile cold launch — clean startup, no `nativeModuleLoader returned null`, no audio-capture errors, sqlite-vec loaded, schema v10 migrations clean.
- [x] MiniMax key configured — `[LLMHelper] MiniMax client initialized (OpenAI-compat via api.minimax.io/v1).` persisted across quit + relaunch.
- [x] Deepgram auto-promotion — `[Main] Creating interviewer STT provider: deepgram` + `[Main] Creating user STT provider: deepgram`, both ws sessions connected within ~560 ms, no manual dropdown change.
- [x] Transcripts stream within ~1 s — mic + system audio chunks flowing from Rust NAPI, `[IntentClassifier]` firing, `[SessionTracker] addAssistantMessage` round-trip under 2 s.
- [x] Live-assist streamed response during meeting — 5 `addAssistantMessage` calls over one session, `runFollowUpQuestions` + `runClarify` + `generate-brainstorm` all fired, streamed tokens reached overlay. (Active provider was OpenAI per user preference for latency; MiniMax runtime activation deferred — same streaming-invariant path, verified equivalent.)
- [x] End-of-meeting summary via active provider — `[LLMHelper] Attempting OpenAI for summary...` → `✅ OpenAI summary generated successfully` → meeting persisted with non-null title + summary. M3-T3 active-provider routing working (no silent fallthrough to Gemini).
- [x] State persists across quit + relaunch — credentials, settings, DB schema v10, persisted meetings all reloaded cleanly.
- [x] M3-FIX-01 regression check — no `max_tokens is too large` 400 anywhere in the log. Clamp invariant held on the exercised gpt-5 family (`resolveMaxCompletionTokens('gpt-5.4', 65536) = 32768` per D027a). gpt-4o-specific clamp (16384) verified indirectly via the same helper and the M3-FIX-01 vitest coverage.

**Two non-blocking quality flags observed** (filed for optional follow-up, not required for M3 closure):

- **M3-FIX-02 (optional):** `generateMeetingSummary` fires twice per meeting end (23:20:42.926 + 23:20:43.742 on the same meeting id) — both succeed, ~900 tokens wasted per meeting. Suspected call-path: `MeetingPersistence.save()` + `RAGManager.processMeeting()` both trigger summary generation. Narrow one-task dedup fix.
- **M3-LOG-01 (trivial):** `[Main] (Reconfigured) SystemAudio->STT: chunk #..., googleSTT=active` log label fires during Deepgram sessions. Cosmetic only — chunks are reaching Deepgram correctly. Stale string in `electron/main.ts` from pre-M3-T2 era.

Neither blocks release, M5 work, or user-visible correctness.

### M3-FIX-01 — OpenAI token clamp + RAG active-provider routing ✅ **DONE 2026-04-15**
Two narrow fixes surfaced by the pre-M3-T4 smoke log.

- **Root cause 1 (primary smoke failure):** `MAX_OUTPUT_TOKENS = 65536` hardcoded in `electron/LLMHelper.ts:43` was passed as `max_completion_tokens` to every OpenAI chat-completions call. GPT-4o caps completion at 16384; GPT-5.4 / o1 / o3 caps are ≤32768. The 65536 default produced `400 max_tokens is too large 65536. This model supports at most 16384 completion tokens`. Three call sites affected: `generateWithOpenai` (line 1400), `streamWithOpenai` (line 2565), `streamWithOpenaiMultimodal` (line 2846). The existing `model.toLowerCase().includes('claude') ? CLAUDE_MAX_OUTPUT_TOKENS : MAX_OUTPUT_TOKENS` conditional was a legacy workaround for Claude-via-OpenAI-SDK that did nothing for OpenAI itself.

- **Root cause 2 (active-provider drift):** `RAGManager.queryMeeting` and `RAGManager.queryGlobal` in `electron/rag/RAGManager.ts` (lines 184 and 215) streamed specifically via `llmHelper.streamChatWithGemini(...)`, ignoring `currentModelId`. A user on OpenAI, MiniMax, or Claude who triggered a RAG query got routed through Gemini silently. Summary generation (M3-T3) already dispatched on active provider — this drift was isolated to the RAG retrieval path.

- **Fix 1 — Per-model OpenAI completion-token clamp.** New exported pure helper `resolveMaxCompletionTokens(model, requested)` in `electron/LLMHelper.ts` (~70 LOC with docstring + 4 named constants: `OPENAI_GPT4O_MAX_COMPLETION=16384`, `OPENAI_GPT5_O_FAMILY_MAX_COMPLETION=32768`, `OPENAI_DEFAULT_MAX_COMPLETION=16384`, `CLAUDE_VIA_OPENAI_SDK_MAX_COMPLETION=8192`). Clamp applied at three call sites via `resolveMaxCompletionTokens(model, MAX_OUTPUT_TOKENS)`. Requested values below the cap pass through unchanged; non-OpenAI/non-Claude ids pass through untouched so Gemini/MiniMax/Groq SDK paths keep their own clamping logic. `MAX_OUTPUT_TOKENS = 65536` constant preserved as the requested ceiling — the helper clamps down per model family.

- **Fix 2 — RAG active-provider swap.** `streamChatWithGemini(prompt, undefined, undefined, true)` → `streamChat(prompt, undefined, undefined, undefined, true)` at `RAGManager.ts:184` and `:215`. `streamChat` dispatches on `currentModelId` through the M1 / M3-T3 active-provider chain. The `ignoreKnowledgeMode: true` flag (last arg) prevents double-injection on top of the RAG prompt that `buildRAGPrompt` already constructs.

- **Files changed (3, production + test):**
  - `electron/LLMHelper.ts` — +70 LOC helper + 4 named constants + 3 call-site swaps at lines 1400, 2565, 2846. Zero control-flow changes.
  - `electron/rag/RAGManager.ts` — 2 one-line method swaps at lines 184 and 215.
  - `electron/__tests__/providers.test.ts` — +5 new tests in a new `resolveMaxCompletionTokens (M3-FIX)` describe block.

- **Files NOT touched (intentional):**
  - `MAX_OUTPUT_TOKENS = 65536` constant (kept as the ceiling; the helper clamps down — this is the requested value callers send; the helper decides the safe send value)
  - `CLAUDE_MAX_OUTPUT_TOKENS = 64000` (only exercised on the Anthropic SDK path; out of scope — separate narrow fix needed if ever changed)
  - `MODE_CONFIGS.*.maxOutputTokens = 65536` in `electron/llm/types.ts` (Gemini `maxOutputTokens`, not OpenAI — Gemini 3.1 Flash/Pro accept 65536)
  - Groq call sites (`max_tokens: 8192` / `28672` — already safe)
  - MiniMax call sites (no `max_completion_tokens` sent per existing comment at `LLMHelper.ts:2632`)
  - IPC handlers, preload, renderer, DB schema, electron.d.ts, CredentialsManager, SessionTracker, IntelligenceEngine, WhatToAnswerLLM, RAG live-indexing, Deepgram STT, native module loader, summary generation, docs beyond this entry.

- **Tests added (5, all passing):**
  1. `clamps GPT-4o family to 16384` — `gpt-4o`, `gpt-4o-mini`, `gpt-4o-2024-08-06`, uppercase variant, below-cap passthrough
  2. `clamps o1 / o3 / GPT-5 family to 32768` — `o1-preview`, `o1-mini`, `o3-mini`, `gpt-5.4`, `gpt-5-turbo`, below-cap passthrough
  3. `applies the conservative 16384 default for unknown OpenAI-family ids` — `gpt-4-turbo`, `gpt-3.5-turbo`, `openai-mystery-model`
  4. `passes through unknown and non-OpenAI models unchanged` — MiniMax, Gemini, Groq, empty string
  5. `clamps Claude-family ids routed through the OpenAI SDK to 8192` — `claude-sonnet-4-6`, `claude-3-5-sonnet-20241022`, below-cap passthrough

- **Not-a-bug investigations (no fix needed):**
  - `[RAG] JIT query failed with NO_RELEVANT_CONTEXT_FOUND, falling back to regular live chat` and `[RAG] Meeting X not processed and no JIT indexing, falling back to regular chat` — these are **expected graceful-degradation signals** defined at `electron/ipcHandlers.ts:2590, 2636`. They fire when the live indexer has no chunks yet or the retriever finds nothing semantically relevant. Fallback to plain `streamChat` against `SessionTracker` rolling context is the designed behavior. Follow-up generation via `WhatToAnswerLLM` still produces output.
  - **Potential wiring bug deferred:** `electron/ipcHandlers.ts:2566-2568` checks `isLiveIndexingActive(meetingId)` where `meetingId` comes from the renderer, but main process starts live indexing with the hardcoded string `'live-meeting-current'` at `electron/main.ts:1451`. If the renderer passes a DB-generated id, the check fails even during an active meeting. The dedicated `rag:query-live` handler uses the hardcoded string correctly, so the renderer has two paths available. M3-T4 smoke should verify which IPC the renderer actually calls before any narrow alias fix lands.

- **Contracts preserved:** no secrets in renderer, no direct provider calls from renderer, prompt construction in main, Deepgram auto-promotion untouched, native Rust audio loading untouched, screenshots untouched, provider switching untouched, M3-T3 summary-routing untouched, M4 knowledge pipeline untouched. Zero IPC additions, zero preload changes, zero DB schema changes, zero credential handling changes. All trust boundaries B1–B6 unchanged. Reversible with a single `git revert`.

- **Gate results (2026-04-15):** `typecheck:electron` clean; `npm test` → **215/215 vitest** (was 210; +5 new tests); `test:kb-schema` 4/4, `test:kb-store` 14/14, `test:kb-transfer` 5/5 unchanged; `build:electron` clean; `build` clean. Total: **238 tests passing**.

- **Result:** OpenAI on `gpt-4o` (and every other OpenAI family) no longer rejects with `400 max_tokens is too large`. RAG responses follow the user's active provider instead of silently routing through Gemini. M3-T4 manual smoke is now unblocked. See DECISIONS.md **D027**.

---

## POLISH-01 — Branding sweep + auto-scroll during streaming ✅ **DONE 2026-04-17**

Narrow polish pass bundling two concerns into a single reversible diff: finishing the last user-visible Natively → sensi sweep missed by M0-T7's grep, and fixing a streaming auto-scroll regression across the three chat surfaces.

- **Casing rule (locked):** product name is `sensi` lowercase everywhere — UI, code strings, `<title>`, tray, wordmarks, logs. `Sensi` ONLY when normal sentence-case grammar requires it (first word of a sentence). `Sensei` never used as the product name in UI or code; marketing copy may reference the root meaning (teacher). `SENSI` never. See DECISIONS.md **D028a**.

- **Logo direction:** Option B selected (brush-s monogram inscribed in optional circle + wordmark in Celeb Light). Exposed as `<SensiMark variant="mark" | "wordmark" | "lockup" size={N} />` with a backward-compatible `SensiLogoMark` alias so the existing two consumers (`SensiLogoMark.tsx` itself + `FreeTrialModal.tsx`) do not break. PNG/icon regeneration deferred — `icon.png` tray/installer glyph retains upstream "N" for this release, called out as a known residual. See DECISIONS.md **D028b**.

- **Auto-scroll spec (shared across 3 chat surfaces):** new `useAutoScrollToBottom(scrollRef, trigger)` hook in `src/hooks/useAutoScrollToBottom.ts` follows streaming output to the bottom when the user is within 48 px of bottom; pauses when the user scrolls up past the threshold; resumes when they return into range. Token-driven scrolls use `behavior: 'auto'` (instant); existing user-send `scrollIntoView({ behavior: 'smooth' })` calls preserved. ResizeObserver catches window/layout reflow. No programmatic scroll when the container doesn't overflow. See DECISIONS.md **D028c**.

- **Files changed — production (9):**
  - `index.html` — `<title>Natively</title>` → `<title>sensi</title>` (1 line, window-manager title)
  - `src/components/SensiLogoMark.tsx` — rewritten to export `SensiMark` + back-compat `SensiLogoMark` alias; new brush-s glyph replaces the upstream "N"
  - `src/components/Launcher.tsx` — 2 comment sweeps (`NativelyInterface` → `SensiInterface`, `Natively app` → `sensi app`)
  - `src/components/GlobalChatOverlay.tsx` — `nativelyIcon` → `sensiIcon` + hook integration + ref on scroll container
  - `src/components/MeetingChatOverlay.tsx` — `nativelyIcon` → `sensiIcon` + hook integration + ref on scroll container
  - `src/components/MeetingDetails.tsx` — `NativelyLogo` → `SensiLogo` (import rename only)
  - `src/components/settings/HelpSettings.tsx` — `nativelyIcon` → `sensiIcon` (6 occurrences)
  - `src/components/SensiInterface.tsx` — hook integration (existing `scrollContainerRef` reused)
  - `src/components/SettingsOverlay.tsx` — wordmark lockup mounted at top of the sidebar for brand consistency with the Launcher header

- **Files created (1):**
  - `src/hooks/useAutoScrollToBottom.ts` — ~160 LOC shared hook + exported pure `isWithinBottomThreshold(scrollTop, clientHeight, scrollHeight, threshold)` predicate

- **Files deleted (1):**
  - `src/assets/evin.png` — leftover upstream-author avatar, zero references

- **Tests added (4, all passing):**
  - `isWithinBottomThreshold (POLISH-01)` describe block in `electron/__tests__/providers.test.ts`:
    1. `returns true when viewport is exactly at the bottom`
    2. `returns true when viewport is within 48 px of the bottom (default threshold)`
    3. `returns false when viewport is more than threshold px from bottom`
    4. `treats non-overflowing containers as always "at bottom"`
  - No jsdom / React Testing Library added — DOM side effects (scroll listener, rAF, ResizeObserver) covered by the POLISH-01 manual smoke per D022 policy.

- **Explicitly out of scope / NOT touched:**
  - No IPC, preload, DB schema, provider-routing, credential-handling, or security-boundary changes
  - No PRD renumbering (M2/M3 scope drift still tracked by the M5 plan)
  - No icon PNG regeneration (`icon.png` and `assets/icons/png/*.png` retain upstream "N" until a separate design pass)
  - No Launcher or Settings layout redesign beyond mounting the wordmark
  - M0-T5 tombstone comments and state variables for the neutralized Natively cloud API (`hasNativelyKey`, `NativelyApiPromoToaster`, etc.) are NOT user-visible text and are intentionally preserved as historical wiring shims

- **Contracts preserved:** Deepgram auto-promotion, native Rust audio loading, screenshots, provider switching, M3-T3 summary routing, M3-FIX-01 OpenAI token clamp, M3-FIX-01 RAG active-provider routing, M4 knowledge pipeline, user-send `scrollIntoView({ behavior: 'smooth' })` calls — all untouched. Reversible with a single `git revert`.

- **Gate results (2026-04-17):** `npm run typecheck:electron` clean; `npm test` → **219 / 219 vitest** (was 215; +4 new); `test:kb-schema` 4/4, `test:kb-store` 14/14, `test:kb-transfer` 5/5 unchanged; `build:electron` clean; `build` clean (pre-existing renderer bundle-size warning only). **Total: 242 tests passing.**

- **Grep gates:** `grep -rn "Natively" src/ index.html --include="*.ts" --include="*.tsx" --include="*.html"` returns only M0-T5 tombstone state variables and tombstone comments — no user-visible product-name strings. `grep -rn "nativelyIcon\|NativelyLogo" src/` returns zero hits. `grep "<title>" index.html` returns `<title>sensi</title>` exactly.

- **Known residual:** `icon.png` tray/installer raster icon still renders the upstream "N" glyph. Will be regenerated from the new SVG in a separate design pass before packaged-release cut. In-app renderers were swapped to `<SensiMark>` in **POLISH-01a** (2026-04-17) — see the follow-up entry below.

### POLISH-01a — In-app icon.png renderers swap to SensiMark SVG ✅ **DONE 2026-04-17**

Tight follow-up to POLISH-01. The main-interface "Start sensi" button and several other in-app surfaces were still rendering the raster `icon.png` (upstream "N" glyph), even after POLISH-01 replaced the SVG component. User report: "the Natively logo at the main interface still shows. the new sensi logo only changes on the settings ui."

Root cause: D028b's scope fence deferred PNG regeneration, but many in-app components render `<img src={icon}>` pointing at the raster file — separate code path from `SensiLogoMark`. POLISH-01a swaps those specific in-app renderers to use `<SensiMark variant="mark" />` inline SVG so the new brand glyph shows everywhere the user sees it inside the app. The raster `icon.png` stays for OS-level surfaces (tray, installer, packaged app icon) that need a real file.

- **Files changed — production (7):**
  - `src/components/Launcher.tsx` — "Start sensi" CTA button icon
  - `src/components/ui/TopPill.tsx` — overlay title-bar pill logo button (orphan `icon` import removed)
  - `src/components/SettingsOverlay.tsx` — overlay preview pill
  - `src/components/GlobalChatOverlay.tsx` — search-all-meetings header glyph (orphan `sensiIcon` import removed)
  - `src/components/MeetingChatOverlay.tsx` — search-this-meeting header glyph (orphan `sensiIcon` import removed)
  - `src/components/MeetingDetails.tsx` — AI-answer avatar (replaces `SensiLogo`/icon.png import)
  - `src/components/settings/HelpSettings.tsx` — 5 render sites (TopPill replica, AI-answer avatar preview, search-header preview, permissions-row row, launcher-tile preview)
- **Files NOT touched (intentional):**
  - `src/components/StartupSequence.tsx` — 2-second app splash with complex `filter` animations keyed to an `<img>` tag. Would require a non-trivial animation rewrite to SVG. Documented as remaining residual under the PNG regeneration task.
  - `src/components/icon.png` and `assets/icons/png/*.png` — OS-level raster assets retained for tray / installer / packaged-app icon. Regeneration remains deferred per D028b.
- **Behavior:** zero functional changes. Every swapped site renders the new brush-s monogram at the same visual size and opacity. No IPC / preload / DB / provider / credential changes.
- **Orphan imports cleaned up:** `TopPill.tsx` (icon), `GlobalChatOverlay.tsx` (sensiIcon), `MeetingChatOverlay.tsx` (sensiIcon) — the raster file is no longer imported where it's no longer rendered.
- **Gate results (2026-04-17):** `typecheck:electron` clean; `npm test` → **219/219 vitest** unchanged (no new tests needed — pure visual swap); `build` clean. **242 total tests passing.**
- **Result:** The main interface, all chat overlays, all in-app logo surfaces now render the new sensi brush-s mark. Only OS-level raster surfaces (tray/installer) and the startup splash animation still use the upstream "N" — tracked as the one remaining residual.

- **Result:** Brand strings unified. Logo/wordmark lockup visible in Settings sidebar + composable everywhere else via `<SensiMark variant="lockup" />`. Auto-scroll follows streamed assistant output in SensiInterface, GlobalChatOverlay, and MeetingChatOverlay without fighting user scroll-up intent. M3-T4 smoke unblocked with the new streaming UX in place.

### POLISH-02 — Hide legacy Profile Intelligence tab in personal-use mode ✅ **DONE 2026-04-17**

Surfaced during the M3-T4 smoke on Settings → Profile Intelligence tab: a red banner *"Knowledge engine not initialized. Please ensure API keys are configured."* — from the **legacy upstream Natively persona engine** (commercial premium feature), NOT the M4 sensi Knowledge subsystem. `premium/electron/knowledge/*` does not exist in this fork; `[Main] Knowledge modules not available — profile intelligence disabled.` fires at startup and `AppState.knowledgeOrchestrator` stays null, but the renderer tab was rendering anyway and calling the null orchestrator.

- **Fix:** extended the `PERSONAL_USE` gate pattern from M0-T6 (already used for `SupportToaster`, `NativelyQuotaBanner`, `FreeTrialBanner`). Three gates in one file:
  1. Sidebar button hidden when `PERSONAL_USE === true`
  2. Panel branch `activeTab === 'profile'` gated with defense-in-depth `!PERSONAL_USE` check
  3. `initialTab='profile'` prop from external callers redirected to `'general'` in the mount effect — prevents deep-linking into the dead tab
- **Files changed (1):** `src/components/SettingsOverlay.tsx` — `import { PERSONAL_USE } from '../lib/config'` + 3 narrow gates. Zero changes to IPC, preload, profile handlers, or any other Settings tab.
- **Files NOT touched:** `electron/ipcHandlers.ts` profile handlers (`profileGetStatus`, `profileGetProfile`, `profileSelectFile`, etc.), `electron/preload.ts` profile bridge, `premium/` legacy modules. Profile IPC surface dormant but preserved for optional future reactivation or deletion.
- **Distinction preserved:** Settings → **Knowledge** tab (M4 subsystem, `electron/knowledge/*`, working) is untouched and remains visible. The hidden tab was upstream-premium Profile Intelligence, not the M4 knowledge base. See DECISIONS.md **D029**.
- **Gate results (2026-04-17):** `typecheck:electron` clean; `npm test` → **219/219 vitest** unchanged (no new tests — the gate is a compile-time-constant-folded branch); `build` clean. 242 total tests passing.
- **Result:** Red "Knowledge engine not initialized" banner no longer reachable in personal-use mode. Settings sidebar now shows: General, AI Providers, Knowledge (M4), Calendar, Audio, Keybinds, Setup & Help, About. Zero regression to any live feature.

---

## M5 — Live transcription & rolling-context loop

> **Scope revision (2026-04-17):** M5-T1/T2/T3 from the original plan (transcript segment typing, speaker-tagged aggregation, TemporalContextBuilder interleaving) were discovered during implementation to be **already shipped in the upstream codebase** — `electron/main.ts:817` types `speaker: 'interviewer' | 'user'` on every STT instance, `SessionTracker.addTranscript` persists the tag, and `SessionTracker.getFormattedContext(lastSeconds)` already returns N-second windowed context with `[INTERVIEWER]:` / `[ME]:` speaker prefixes. The actual remaining M5 work is the **trigger-cadence control** from the PRD M2 deliverable ("Configurable trigger cadence: off / on-silence / on-demand"). Per user-approved Option X, M5 is now scoped to 4 subtasks: M5-T4 SilenceDetector, M5-T5 RollingTriggerPolicy + IPC, M5-T6 dispatch binding, M5-T8 UI mode selector.

### M5-T4 + M5-T5 — SilenceDetector + RollingTriggerPolicy + persisted IPC surface ✅ **DONE 2026-04-17**

Pass 1 of Option X. Introduces the policy object and its persistence/IPC surface WITHOUT yet wiring it into the dispatch path — no behavior change for the end user until Pass 2 (M5-T6).

- **Files created (2):**
  - `electron/audio/SilenceDetector.ts` (~110 LOC) — pure in-memory state machine. No timers, no fs, no network. Caller drives with wall-clock deltas. Exposes both a class (`SilenceDetector`) and a pure `isSilentAt(lastFinalAt, now, threshold)` predicate for the same structural-test pattern used by `isWithinBottomThreshold` / `hasOllamaEmbeddingModel`. Interim transcript segments deliberately excluded — only `isFinal=true` counts toward silence reset.
  - `electron/llm/RollingTriggerPolicy.ts` (~180 LOC) — policy class. DI takes a clock fn + silence detector + initial mode. Exposes `setMode`, `noteSegment`, `shouldFireOnSilence` (pure decide), `markFiredOnSilence` (record dispatch), `triggerOnDemand`, `markStreamStarted/Finished`, `reset`. Handles the three real edge cases: (a) one-fire-per-lull debounce (prevents spam during a long silence), (b) in-flight guard (no new fire while a response is streaming), (c) mode change clears the already-fired flag so flipping off→on-silence mid-lull fires on the next tick. Also exports `ROLLING_TRIGGER_MODES` and `isValidRollingTriggerMode(value)` for IPC validation + tests.

- **Files modified (4):**
  - `electron/services/SettingsManager.ts` — added `rollingTriggerMode?: 'off' | 'on-silence' | 'on-demand'` to `AppSettings`. Persistence round-trips automatically via the existing generic `get<K>`/`set<K>` interface. Default when unset: `'on-silence'`.
  - `electron/ipcHandlers.ts` — added `set-rolling-trigger-mode(mode)` handler (enum-validates via `isValidRollingTriggerMode`, persists via `SettingsManager.set`, broadcasts a `rolling-trigger-mode-changed` event to launcher + overlay windows) and `get-rolling-trigger-mode()` handler (reads from SettingsManager with `'on-silence'` default). The setter also attempts to update the engine's live policy via a `setRollingTriggerMode` method call if the engine exposes one — no-op today, wired in Pass 2.
  - `electron/preload.ts` — added 3 contextBridge methods: `setRollingTriggerMode`, `getRollingTriggerMode`, `onRollingTriggerModeChanged` (returns unsubscribe function). Added the same 3 slots to the local `ElectronAPI` interface with optional markers.
  - `src/types/electron.d.ts` — added typed declarations for the 3 new methods (non-optional, so renderer code gets full type safety). Pointer to future D030 ADR for the policy spec.

- **Files NOT touched (Pass 1 fence):**
  - `electron/IntelligenceEngine.ts` — dispatch wiring is Pass 2 (M5-T6). Current intent-classifier-driven trigger is still the only path firing `runWhatShouldISay`.
  - Renderer UI — mode selector is Pass 3 (M5-T8). Today the only way to change the mode is to call `window.electronAPI.setRollingTriggerMode('off')` from DevTools or to programmatically persist it.
  - No changes to Deepgram STT, SessionTracker, TemporalContextBuilder, WhatToAnswerLLM, meeting persistence, or any existing trust boundary.

- **Tests added (17 new, all passing):**
  - **SilenceDetector (7 tests):** never-seen state, within-threshold not-silent, at/beyond-threshold silent, re-arm after new final, setThresholdMs mid-session, reset clears state, `isSilentAt` free-function matches class semantics.
  - **RollingTriggerPolicy (10 tests):** mode-validator accepts 3 values + rejects everything else; off mode never fires; on-silence one-fire-per-lull + re-arm after new final; interim segments don't reset silence; stream-in-flight guard blocks both on-silence and on-demand; on-demand mode never auto-fires but manual works; off mode rejects manual too; setMode clears fired-flag; reset clears all session state but preserves mode (user preference).

- **Contract preserved:** no IPC channel removal, no preload surface shrink, no DB/credential/security-boundary change. Trust boundaries B1–B6 all unchanged. The 2 new channels are typed getter/setter plus one broadcast.

- **Gate results (2026-04-17):** `typecheck:electron` clean; `npm test` → **236 / 236 vitest** (was 219; +17 new tests); `test:kb-schema` 4/4, `test:kb-store` 14/14, `test:kb-transfer` 5/5 unchanged; `build:electron` clean; `build` clean. **Total: 259 tests passing.**

- **Behavior change:** **none yet.** Policy is wired but not consulted. Any call to `setRollingTriggerMode` persists the value and broadcasts the change, but no trigger dispatch fires because `IntelligenceEngine` does not yet consult the policy. Pass 2 (M5-T6) will land the dispatch binding.

- **Result:** Policy + persistence + typed IPC surface ready. The engine can be taught to consult the policy in Pass 2 without touching any of the Pass 1 files. Pause here for review before M5-T6.

### M5-T6 — Dispatch binding: wire RollingTriggerPolicy into IntelligenceEngine ✅ **DONE 2026-04-17**

Pass 2 of Option X. Makes the policy from M5-T5 authoritative by binding it into the live dispatch path. After this pass, the persisted `rollingTriggerMode` setting actually affects behavior: 'off' disables all auto-triggers (silence + intent classifier), 'on-silence' fires `runWhatShouldISay` after a configurable silence threshold, 'on-demand' disables auto-triggers but leaves the keyboard shortcut / UI button working.

- **Files modified (3):**
  - `electron/IntelligenceEngine.ts` — import `RollingTriggerPolicy`, add private `rollingPolicy` field instantiated in the constructor via a `buildRollingPolicy()` factory that reads the persisted mode from `SettingsManager` and falls back to `'on-silence'` on any failure (SettingsManager unavailable during tests, invalid persisted value). Added a 300ms `setInterval` tick driver that polls `policy.shouldFireOnSilence()` and dispatches `runWhatShouldISay(undefined, 0.8, undefined)` on truthy, calling `markFiredOnSilence()` before dispatch. `handleTranscript` now calls `policy.noteSegment({isFinal, timestampMs})` on every transcript event and gates the refinement-intent classifier on `shouldRunRefinementClassifier(mode)`. `runWhatShouldISay` wrapped in `markStreamStarted()` at entry and `markStreamFinished()` in a `finally` block so every exit path (success, abort, error) releases the in-flight guard. `reset()` calls `policy.reset()` to clear session state at meeting boundaries. New `destroy()` method stops the tick. New public `setRollingTriggerMode(mode)` and `getRollingTriggerMode()` for IPC-driven mode changes. New pure helper `shouldRunRefinementClassifier(mode)` exported for tests (returns `mode !== 'off'`).
  - `electron/IntelligenceManager.ts` — delegator methods added: `setRollingTriggerMode`, `getRollingTriggerMode`, `getRollingTriggerPolicy`. Imported `RollingTriggerMode` type.
  - `electron/ipcHandlers.ts` — the forward-compat `(engine as any).setRollingTriggerMode?.(mode)` call added in Pass 1 now resolves to the real method, so IPC-driven mode changes land on the live policy immediately without requiring a restart.

- **Files NOT touched:**
  - `electron/audio/SilenceDetector.ts` / `electron/llm/RollingTriggerPolicy.ts` — Pass 1 code is unchanged; Pass 2 only consumes the contracts they defined.
  - `electron/preload.ts`, `src/types/electron.d.ts` — IPC surface unchanged.
  - `electron/main.ts` — no changes; the engine instance is the long-lived singleton and owns the tick driver via constructor.
  - SessionTracker, DB, credentials, trust boundaries — all unchanged.

- **Design decisions (per user approval):**
  - **`mode === 'off'` suppresses BOTH auto-paths** — the silence trigger AND the intent-classifier (refinement-pattern) path are disabled. Without this, a user who turns rolling off would still see `runFollowUp` auto-firing on refinement utterances — "off" would not actually be off. `shouldRunRefinementClassifier(mode)` gates this cleanly.
  - **`mode === 'on-demand'` leaves refinement classifier alive** — refinement fires `runFollowUp` (edits the last assistant message), not a new rolling response, so it does not conflict with the on-demand contract.
  - **Tick driver runs continuously** — instead of start/stop on meeting lifecycle, the 300ms tick runs for the lifetime of the IntelligenceEngine. The in-flight guard + "no fire until a final segment arrives" contract (SilenceDetector returns `false` for `isSilent` before the first `noteFinalSegment`) make spurious ticks cheap and side-effect-free outside an active meeting.
  - **`finally`-clause release, not try/catch release** — every exit path from `runWhatShouldISay` must call `markStreamFinished` or the in-flight guard permanently blocks future silence triggers after a crashed stream. Using `finally` guarantees this even on unexpected throws.

- **Tests added (5 new, all passing):**
  - `shouldRunRefinementClassifier` pure gate: 3 tests (off → false, on-silence → true, on-demand → true).
  - Dispatch-binding contract (M5-T6, uses real policy as integration fixture — no engine instantiation): 2 tests covering (a) realistic final + interim + final feed threading through the silence detector, and (b) 5x 300ms tick simulation during a single lull fires exactly once, re-arms only on a fresh final segment.

- **Why no full-engine integration test:** the IntelligenceEngine constructor pulls in LLMHelper, which requires the GoogleGenAI / Groq / OpenAI / Anthropic / sharp / axios client stack. Instantiating even a stubbed engine in unit tests is the jsdom-class problem D022 flagged — the cost/benefit is worse than pure-helper tests plus manual smoke. The wiring logic itself is small (transcript feed call + tick driver + in-flight wrap + reset propagation), all exercised by policy-level tests. Behavior-level verification belongs to the M5-T6 manual smoke in TESTS.md.

- **Contract preserved:** no IPC channel added or removed (the Pass 1 channels are unchanged), no preload surface delta, no DB schema, no credential change, no trust-boundary shift. Trust boundaries B1–B6 all unchanged.

- **Gate results (2026-04-17):** `typecheck:electron` clean; `npm test` → **241 / 241 vitest** (was 236; +5 new tests); `test:kb-schema` 4/4, `test:kb-store` 14/14, `test:kb-transfer` 5/5 unchanged; `build:electron` clean; `build` clean. **Total: 264 tests passing.**

- **Behavior change:** with the default mode `'on-silence'` and the default 1500ms threshold, after a meeting becomes active and finishes the first final transcript segment, `runWhatShouldISay` will auto-fire once per silence lull of 1500ms+. Users can flip to `'off'` via IPC to fully disable both auto-triggers. The UI mode selector is Pass 3 (M5-T8).

- **Result:** M5-T6 complete. The persisted `rollingTriggerMode` setting is now live and affects behavior. Pause here for review before Pass 3 (M5-T8) UI mode selector.

---

## PACKAGING-01 — First Windows installer + OTA update infrastructure

Pass A + Pass A.5 bundle shipped 2026-04-17. Prep work that clears the way for the first real release of sensi (v2.4.0) and the ongoing ship cadence. No milestone-scope features; this is packaging and branding-follow-through.

### PACKAGING-01 Pass A + A.5 ✅ **DONE 2026-04-17**

**Rationale:** the app disappeared during an interview. The user wants to stop running dev builds and ship an installer so future iterations reach the running version over the air via the existing (but idle) electron-updater wiring. The disappearance RCA is not in scope — the existing tray "Show sensi" item at [main.ts:2114](electron/main.ts#L2114) is the escape hatch, and tray-hide during stealth is mac-only.

- **Config fixes (2 edits):**
  - [package.json](package.json) — `publish.owner` `tobyjoe` → `tobyjoe4life` so the update feed resolves against the real repo.
  - [electron/main.ts](electron/main.ts) — updater gate flipped: `if (!app.isPackaged && process.env.SENSI_ENABLE_UPDATER !== 'true') return`. Packaged builds always check GitHub Releases; dev builds stay silent. Supersedes D005's "off by default" default; env-var opt-in preserved for dev.

- **Stale natively.icns purge (3 edits + 1 file deletion):**
  - Removed the `natively.icns` entry from [package.json](package.json) `extraResources`.
  - [package.json](package.json) `mac.icon`: `assets/natively.icns` → `assets/icon.icns`.
  - [electron/main.ts:2397-2398](electron/main.ts#L2397) + [electron/WindowHelper.ts:177-178](electron/WindowHelper.ts#L177) disguise-mode `'none'` Mac icon path updated.
  - Deleted `assets/natively.icns` from disk.

- **Icon regeneration (Pass A.5, new file + 16 replaced assets):**
  - New [scripts/generate-icons.js](scripts/generate-icons.js) rasterizes the `SensiMark` brush-s SVG (inline) to every size electron-builder needs. Uses `sharp` + `png-to-ico`. Direct-size rasterization (builds SVG per-target) avoids sharp's 268M pixel cap. Idempotent.
  - New npm script `npm run icons` wired in [package.json:29](package.json#L29).
  - Regenerated: `assets/icons/win/icon.ico` (419 KB, 10 resolutions: 16/20/24/32/40/48/64/96/128/256) — used by NSIS installer UI, Windows splash, taskbar, Alt-Tab, Start menu, task switcher.
  - Regenerated: `assets/icons/png/icon_{16,32,64,128,256,512,1024}x{N}.png` — Linux AppImage/deb size ladder.
  - Regenerated: `assets/icon.png` (1024×1024) + copy at `src/components/icon.png`.
  - macOS .icns regeneration deferred (requires `iconutil` which is macOS-only); current `assets/icon.icns` retained as the mac fallback until a mac build pass.
  - Added `png-to-ico@^3.0.1` to devDependencies.

- **User-visible changelog (1 new file):**
  - New [CHANGELOG.md](CHANGELOG.md) top section with the v2.4.0 entry. Preserves the upstream Natively release history below a divider for context. This is the source of truth for the in-app **What's new** modal (`ReleaseNotesManager.fetchReleaseNotes` pulls the body from the GitHub release, which gets seeded from this file at tag time).

- **Files NOT touched (scope fence):**
  - No behavior change to the stealth / disguise-mode logic. The "app disappeared" escape hatch is the existing tray item.
  - No Windows code-signing configuration — unsigned ship is a known limitation, noted in CHANGELOG.md and D031.
  - No CI pipeline; first 5 releases are local builds.
  - No macOS / Linux actual build output this pass; config remains ready for those platforms but the first ship targets Windows x64 + ia32.

- **Gate results (2026-04-17):** `typecheck:electron` clean; `npm test` 241/241; `build:electron` clean; `build` clean. Icon generation verified end-to-end (multi-resolution .ico produced correctly, all 10 sizes embedded). 

- **Behavior change:** once packaged and installed, sensi:
  1. Shows the sensi brush-s mark in the NSIS installer UI, Windows splash, taskbar, Alt-Tab, Start menu, and tray.
  2. Auto-checks the GitHub `tobyjoe4life/sensi` releases feed 10 s after launch.
  3. Shows the existing `UpdateBanner` component when a newer version is available.
  4. Downloads + installs on user confirmation via the existing `UpdateModal` flow.

- **Next (Pass B):** run `npm run dist` locally on Windows, smoke-install the output, publish v2.4.0 to GitHub Releases with `GH_TOKEN` set.

---

## M4 — Context enrichment & personal knowledge

> **Scope note:** Maps to PRD M3. Renumbered to M4 in TASKS.md because TASKS
> M3 was reframed mid-execution to the audio/STT/summary blockers. See
> `C:\Users\Toby\.claude\plans\foamy-jingling-diffie.md` for the full M4 plan.

### M4-T1 — sqlite-vec load probe + knowledge schema migration ✅ **DONE 2026-04-14**
- [x] **Stop-condition probe passed:** `sqlite-vec v0.1.7-alpha.2` loads cleanly under Electron's Node runtime; `vec_version()` returns non-empty. Probe was run via `ELECTRON_RUN_AS_NODE=1 electron` because `better-sqlite3` is ABI-locked to Electron 33 (NODE_MODULE_VERSION 130) by the `postinstall: electron-rebuild` step — plain Node 24 (ABI 137) cannot `dlopen()` the binary. Reported as a test-runtime finding, not a sqlite-vec failure.
- [x] **Schema deviation from spec:** tables are prefixed `kb_` (`kb_documents`, `kb_chunks`, `vec_kb_chunks`) because the upstream schema already uses `chunks` (v1 migration, meeting-transcript chunking) and per-dimension `vec_chunks_{768,1536,3072}` (v8 migration, meeting embeddings). Using the spec's literal names would collide with live data. See DECISIONS.md D014 for the rename rationale.
- [x] **vec0 column deviation:** the virtual table declares `chunk_id INTEGER PRIMARY KEY` as a rowid alias instead of the spec's literal `rowid INTEGER`. This matches the idiomatic pattern from the existing v3/v4 meeting vec0 migrations and avoids a better-sqlite3 binding type issue surfaced during the probe. The `INTEGER PRIMARY KEY` is functionally equivalent to rowid per sqlite-vec docs. See DECISIONS.md D014.
- [x] **sqlite-vec v0.1.7-alpha.2 requires BigInt bindings for primary key integer columns.** Plain JS `number` bindings are rejected with "Only integers are allows for primary key values …". Diagnosed via a 6-case binding test (plain int / BigInt / `1n` / SQL literal / safeIntegers combos — only BigInt and safeIntegers+BigInt passed). All M4-T4 CRUD and downstream tasks must use BigInt bindings when writing `vec_kb_chunks.chunk_id`. Recorded in TESTS.md and DECISIONS.md D014.
- [x] `DatabaseManager.createKnowledgeTables()` added as a private method (~70 LOC) called from `init()` immediately after `runMigrations()`. Sits OUTSIDE the user_version migration chain — all three DDL statements use `IF NOT EXISTS` so the method is safe to call on every launch, matching the spec's idempotency requirement and leaving the v1–v10 migration chain byte-identical.
- [x] 4 new tests in `electron/__tests__/knowledgeSchema.electron.cjs` cover: vec_version load probe, 768-dim insert+read roundtrip, `vec_distance_cosine` ordering on 3 hand-crafted vectors (identical / 45° / opposite), and DDL idempotency (run schema twice with live data in between, assert rows preserved). **4 passed, 0 failed** under Electron's Node runtime via the new `npm run test:kb-schema` script.
- [x] No regression: `npm run typecheck:electron` clean; `npm test` (vitest) — **49/49** passing unchanged.
- **Result:** Knowledge base storage surface exists on disk. Ready for M4-T2 (parsers).

### M4-T2 — Document parser helpers ✅ **DONE 2026-04-14**
- [x] New file `electron/knowledge/parsers.ts` with four narrow pure helpers: `extractTextFromPdf(buffer)`, `extractTextFromDocx(buffer)`, `extractTextFromMarkdown(buffer)`, `extractTextFromPlain(buffer)`. PDF uses `pdf-parse` v2's `PDFParse` class API (`{ data: buffer, verbosity: 0 }` → `getText()` → `destroy()` in `finally`). DOCX uses `mammoth.extractRawText({ buffer })`. Markdown and plain text decode UTF-8. All four run the output through a shared `normalize()` helper that normalizes line endings to LF, collapses 3+ blank lines to exactly 2, and trims outer whitespace. Empty buffers return empty string without invoking any parser — near-empty cases are predictable and non-crashing. No filesystem reads inside the helpers — callers pass buffers, per the M4 trust-boundary contract (file reads are the orchestrator's job in T6).
- [x] Two committed text fixtures under `electron/__tests__/fixtures/knowledge/`: `sample.md` (headings + two body paragraphs) and `sample.txt` (plain-text paragraphs). Binary fixtures (PDF, DOCX) are NOT committed — they are built in-memory at test time via `buildMinimalPdf(text)` (hand-rolled PDF byte assembly with computed xref offsets, ~50 LOC) and `buildMinimalDocx(text)` (uses `jszip`, which is a guaranteed transitive dep of `mammoth@1.11.0` per `npm ls jszip`). Committing binary files through this harness is unreliable (text-mode tools can corrupt bytes).
- [x] 14 new tests appended to `electron/__tests__/providers.test.ts` (not a dedicated `parsers.test.ts` — see D015 for the file-transition segfault diagnosis): 4 markdown cases, 5 plain-text cases, 3 DOCX cases, 2 PDF cases. Coverage: committed fixtures for MD/TXT, in-memory fixtures for PDF/DOCX, empty-buffer early return, CRLF/CR normalization, blank-line collapse, trim behavior, expected-snippet assertions.
- [x] No regression: `npm run typecheck:electron` clean; `npm test` — **63/63** passing (was 49); `npm run test:kb-schema` still 4/4.
- **Result:** Knowledge-base document ingestion has a tested, isolated parsing layer. Ready for M4-T3 (chunking).

### M4-T3 — Chunking helper ✅ **DONE 2026-04-14**
- [x] New file `electron/knowledge/chunker.ts` with one exported pure function `splitIntoChunks(text, options?)` returning `string[]`. Defaults: `maxChars = 1500`, `overlap = 200`. Fully synchronous, dependency-free, deterministic.
- [x] **Algorithm:**
  - Empty / whitespace-only input → `[]`
  - Short input (`text.length <= maxChars`) → single trimmed chunk
  - Long input: per window `[start, start + maxChars)`, search the tail zone (last ~30% of window, floored at `start + overlap + 1` to guarantee forward progress) backward for `.?!` followed by whitespace or EOF; cut at `boundary + 1`; if no boundary found, hard-cut at maxChars
  - `overlap` is clamped to `[0, maxChars - 1]` to prevent infinite loops when a caller passes a silly combination (e.g. `overlap > maxChars`)
  - Each emitted chunk is trimmed; empty chunks are skipped; every chunk satisfies `chunk.length <= maxChars`
- [x] 11 new unit tests in `electron/__tests__/providers.test.ts` under a new `chunker.splitIntoChunks (M4-T3)` describe block: empty string, whitespace-only, short-text single-chunk, outer-whitespace trim, sentence-boundary preference, hard-cut fallback when no punctuation, overlap preservation across adjacent chunks (byte-exact on the hard-cut path), custom `maxChars`, zero-overlap contiguous chunks, no-empty-chunks invariant, `chunk.length <= maxChars` invariant, and the `overlap >= maxChars` clamp path.
- [x] Appended to `providers.test.ts` (not a new file) per DECISIONS.md D015 to avoid the pdfjs-dist/sharp file-transition segfault.
- [x] Verification: `npm run typecheck:electron` clean; `npm test` — **75/75** passing, exit code 0 (was 63); `npm run test:kb-schema` still 4/4.
- [x] **Known cosmetic noise:** `npm`/`npx` shim bash wrapper at `/c/Program Files/nodejs/{npm,npx}: line 65` intermittently prints "Segmentation fault" after vitest exits cleanly. Exit code propagates correctly as 0. Confirmed via 3+3 runs across `npm test` and `npx vitest run`. This is a Windows-Git-Bash shim issue where the wrapper's post-exit cleanup races with a held resource (likely pdfjs-dist fake-worker state). Does NOT affect correctness or CI — vitest's exit code is the authoritative signal. See DECISIONS.md D016.
- **Contract for M4-T4 / M4-T6 to preserve:**
  1. Return value is a `string[]`. Array index IS the chunk's ordinal — T4's `upsertChunks` must persist that as `chunk_index`.
  2. Empty input returns `[]`, never `[""]`. T4 must handle the zero-chunk case.
  3. Every chunk satisfies `chunk.length <= maxChars` after trimming. T4 can use this for storage planning and vec0 chunk sizing.
  4. Overlap is character-level, not semantic. The same substring appears verbatim in two adjacent chunks by design (context continuity for embedding recall). No dedup.
  5. Helper is synchronous. T6 can call it inline without `await`.
  6. No trust boundary touched — pure function in main-process code.
- **Result:** Parser → chunker compose cleanly for M4-T6 when it lands. Ready for M4-T4 (KnowledgeStore CRUD).

### M4-T4 — KnowledgeStore (main-process CRUD + vector search) ✅ **DONE 2026-04-14**
- [x] New file `electron/knowledge/KnowledgeStore.ts` (~420 LOC) — one class plus three typed error classes (`KnowledgeDimensionError`, `KnowledgeNotFoundError`, `KnowledgeStoreInvariantError`), plus internal `toVecPk(value)` helper for the BigInt binding rule and internal `toVecBuffer(vec, label)` helper that validates dimension and converts `Float32Array | number[]` into a raw Float32 Buffer with correct byteOffset/byteLength slicing.
- [x] Eight public methods per spec: `insertDocument(meta) → string`, `upsertChunks(docId, chunks, embeddings) → void`, `listDocuments() → KnowledgeDocument[]`, `deleteDocument(id) → void`, `searchByEmbedding(queryVec, topK) → RetrievedChunk[]`, `getDocumentText(id) → string`, `setPinned(id, pinned) → { pinnedAt }`, `listPinned() → KnowledgeDocument[]`. Multi-row writes (`upsertChunks`, `deleteDocument`) run inside `db.transaction(...)` for atomicity.
- [x] `DatabaseManager` gains a lazy `getKnowledgeStore()` accessor + a `private knowledgeStore: KnowledgeStore | null` field. No changes to `init()`, `runMigrations()`, or any other existing method — M4-T1's `createKnowledgeTables()` call still runs at construction time and the singleton KnowledgeStore is created on first `getKnowledgeStore()` call.
- [x] **Chunk ↔ vec rowid linking:** `kb_chunks.id` stays `TEXT PRIMARY KEY` (UUID via `crypto.randomUUID()`) as in M4-T1. The implicit `kb_chunks.rowid` (integer) is the linkage to `vec_kb_chunks.chunk_id`. `upsertChunks` captures `insertChunk.run(...).lastInsertRowid` per row and feeds it through `toVecPk()` to the vec insert. No UUID→INTEGER mapping table needed.
- [x] **`searchByEmbedding` inlines `k = N` as a sanitized integer literal** (not a `?` binding). sqlite-vec v0.1.7-alpha.2 does not support parameter binding on the virtual-table query column, and the M4-T1 probe query used a literal. `topK` is floored and clamped to `[1, ∞)` before string interpolation — no SQL injection risk since the type system constrains input to `number`.
- [x] **`deleteDocument` verifies explicit cleanup:** walks `kb_chunks.rowid` for the doc, deletes matching `vec_kb_chunks` rows, deletes `kb_chunks` rows, deletes the `kb_documents` row, then counts remaining rows for that doc in both scalar tables and throws `KnowledgeStoreInvariantError` on any leftover. The virtual table has no cascade support, so rowid walking is the authoritative cleanup path.
- [x] 14 new tests in `electron/__tests__/knowledgeStore.electron.cjs` covering all 11 required scenarios plus 3 extras (searchByEmbedding query-vector dim rejection, getDocumentText on missing id, insertDocument on non-768 dim). Run via `npm run test:kb-store` which chains `npm run build:electron` first so the compiled `dist-electron/electron/knowledge/KnowledgeStore.js` is fresh. **14 passed, 0 failed.**
- [x] Tests run from compiled `dist-electron/` output because Electron's Node has no TS loader available without a new dep. Build + test chains take ~1s total.
- [x] Verification: `npm run typecheck:electron` clean; `npm test` — **75/75** passing unchanged; `npm run test:kb-schema` still 4/4; `npm run test:kb-store` — **14/14**. See DECISIONS.md D017 for the rowid-linking + dist-electron-require patterns.
- **Contract for M4-T5 / M4-T6 to preserve:**
  1. `insertDocument` requires `embeddingDim === 768`. T5 must configure its adapter against a 768-dim model (nomic-embed-text or text-embedding-004). `embeddingModel` is stored alongside for traceability; T7 should verify query-time model match before retrieval.
  2. `upsertChunks` requires `chunks.length === embeddings.length`. T6 must never pass mismatched arrays — the orchestrator passes the output of T3's `splitIntoChunks` 1:1 to T5's embedder and then 1:1 to T4's upsert.
  3. Embedding input type is `Float32Array | readonly number[]`. T5 can return either; conversion is internal and zero-copy for `Float32Array`.
  4. `upsertChunks` replaces prior chunks+vec rows for the doc atomically. T6 can re-ingest without pre-deleting.
  5. `deleteDocument` on a missing id throws `KnowledgeNotFoundError`. Callers can distinguish "already gone" from "never existed".
  6. `searchByEmbedding` rejects non-768 query vectors with `KnowledgeDimensionError`. T6's query path must embed with the same provider/dim as the stored chunks.
  7. `setPinned` timestamp is server-side `datetime('now')` (sqlite's second-precision). Callers cannot backfill pin times.
  8. Document + chunk IDs are generated internally via `crypto.randomUUID()`. Callers never supply IDs.
  9. Array order in `upsertChunks(docId, chunks, ...)` is the canonical `chunk_index`. T6 must preserve T3's output order.
  10. `getDocumentText` returns chunks joined with `\n\n` in `chunk_index` order. Zero-chunk documents return `''` (empty string, not throw).
- **Result:** Knowledge base storage layer is complete, typed, tested. Ready for M4-T5 (embedding adapter).

### M4-T5 — Embedding adapter ✅ **DONE 2026-04-14**
- [x] New file `electron/knowledge/EmbeddingAdapter.ts` (~260 LOC) — one exported class `EmbeddingAdapter`, three typed errors (`KnowledgeEmbeddingProviderUnavailableError`, `KnowledgeEmbeddingRequestError`, `KnowledgeEmbeddingDimensionError`), two public methods (`embed(strings): Promise<Float32Array[]>`, `getActiveEmbeddingConfig(): { provider, model, dimension }`), and DI-friendly constructor accepting `EmbeddingAdapterDeps` for test-time stubbing of the four hooks (probeOllama, embedWithOllama, embedWithGemini, getGeminiApiKey). Module-level default implementations hit the real endpoints in production.
- [x] **Provider policy (strict, per D018):** Ollama + nomic-embed-text primary (768-dim, local, free) → Gemini + text-embedding-004 cloud fallback (768-dim, BYOK via `CredentialsManager.getGeminiApiKey()`) → typed error if neither is available. **No OpenAI** (text-embedding-3-small is 1536-dim which breaks the fixed 768-dim vec0 schema from M4-T1). **No dimension reduction shim, no projection layer, no mixed-dim storage.** The spec explicitly forbade these.
- [x] **Empty-string policy: reject with `KnowledgeEmbeddingRequestError`.** M4-T3's `splitIntoChunks` never emits empty chunks (contract guarantee #8), so any empty string reaching T5 indicates a contract violation upstream. Silent filtering would hide the bug; loud rejection surfaces it.
- [x] **Provider probe: 500ms `/api/tags` fetch against `http://127.0.0.1:11434`**, matching the existing `OllamaManager.checkIsRunning()` pattern. OllamaManager's probe is private so we replicate rather than reuse — no parallel config plumbing introduced. No central Ollama URL setting; the adapter hardcodes the same `127.0.0.1:11434` that LLMHelper uses internally.
- [x] **Ollama API: `POST /api/embed`** with `{model: 'nomic-embed-text', input: string[]}` → `{embeddings: number[][]}` (batch-capable, one request per embed() call).
- [x] **Gemini API: `POST /v1beta/models/text-embedding-004:batchEmbedContents?key=…`** with batch `requests[]` → `{embeddings: [{values: number[]}]}`. API key goes in the URL query string (standard Google API pattern); error messages do NOT include the URL to avoid leaking the key in logs.
- [x] **Dimension post-condition:** every returned vector is length-checked and thrown with `KnowledgeEmbeddingDimensionError` on mismatch. Vector count mismatch throws `KnowledgeEmbeddingRequestError`. These are the two provider contract violations that would otherwise silently propagate to KnowledgeStore and trip its own dimension check from M4-T4.
- [x] **14 new tests** appended to `electron/__tests__/providers.test.ts` under `describe('EmbeddingAdapter (M4-T5)', ...)`: empty input early-return, Ollama primary path, Gemini fallback path, neither-available error, dim mismatch error, count mismatch error, order preservation, probe timeout doesn't hang (<500ms total), `getActiveEmbeddingConfig()` reports selected provider, `getActiveEmbeddingConfig()` before any embed throws, empty-string input rejection, whitespace-only input rejection, outer-whitespace trimming, empty input array never surfaces "no provider" error. All tests use DI — no `vi.mock`, no real network.
- [x] **Verification:** `npm run typecheck:electron` clean; `npm test` — **89/89 passing** (was 75); `npm run test:kb-schema` still 4/4; `npm run test:kb-store` still 14/14.
- **Contract for M4-T6 to preserve:**
  1. **Call `embed()` on T5 AFTER T3 chunking**, never before. T3 guarantees no empty chunks; passing raw document text would break T5's empty-string rejection policy.
  2. **Pass T3's output array 1:1 to T5.** Order is canonical — T5 preserves it, and T4's `upsertChunks` uses array index as `chunk_index`. No reordering or filtering between T3 → T5 → T4.
  3. **Check `getActiveEmbeddingConfig()` at query time.** T7's context builder must embed user queries with the SAME provider/model that was used for the stored chunks. If a user ingests documents via Ollama, then later Ollama goes offline and Gemini takes over for a query, the distances will be garbage because cosine distance is meaningful only within the same embedding space. T6/T7 should cache the `embeddingModel` per document (already stored in `kb_documents.embedding_model` by M4-T4) and verify at query time.
  4. **Both providers return 768-dim only.** If a future milestone adds a non-768 provider, the fixed vec0 schema from M4-T1 must be evolved first (either per-dim tables like the existing meeting-context `vec_chunks_{768,1536,3072}` pattern, or a dedicated knowledge-base migration).
  5. **`embed([])` is a fast-path no-op** that returns immediately without probing any provider. T6 can safely call it on zero-chunk documents without triggering the provider-unavailable error.
  6. **All errors are typed.** T6 should catch `KnowledgeEmbeddingProviderUnavailableError` and surface a user-facing "set up Ollama or Gemini" message, catch `KnowledgeEmbeddingRequestError` for transient network failures (retry logic?), and treat `KnowledgeEmbeddingDimensionError` as a provider-contract bug that should abort ingest.
  7. **No secrets in renderer.** `CredentialsManager.getGeminiApiKey()` returns the key to main-process code only. T8 IPC handlers must never forward the key to the renderer side.
  8. **Main-process only.** The adapter imports from `electron/services/CredentialsManager` and uses Node's `fetch` with `AbortSignal.timeout`. Safe under Electron 33's Node 20.18 runtime.
- **Result:** Embedding adapter ready. Ready for M4-T6 (orchestrator) to compose parsers → chunker → embedder → store.

### M4-T6 — Knowledge orchestrator ✅ **DONE 2026-04-14**
- [x] New file `electron/knowledge/KnowledgeOrchestrator.ts` (~430 LOC) — one exported class `KnowledgeOrchestrator`, three typed error classes (`KnowledgeIngestError`, `KnowledgeQueryError`, `KnowledgeEmbeddingModelMismatchError`), two structural DI interfaces (`KnowledgeStoreLike`, `EmbeddingAdapterLike`), public types for ingest result + query input, and two module-private helpers (`resolveMimeFromPath`, `defaultParseBuffer`).
- [x] **Constructor composes existing pieces only:** takes `store: KnowledgeStoreLike`, `adapter: EmbeddingAdapterLike`, and optional `readFile` + `parseBuffer` hooks for test-time injection. Defaults to `fs.promises.readFile` and the real M4-T2 parser dispatch by MIME. No new primitives introduced.
- [x] **Small T5 extension:** added `resolveProvider(): Promise<EmbeddingConfig>` method to `EmbeddingAdapter` (~25 LOC) — pure probe, no side effects, no embed quota consumed. Needed because `insertDocument` requires `embeddingModel` metadata BEFORE any embed call, and zero-chunk documents skip `embed()` entirely. Calling `embed(['probe'])` with a throwaway string would waste a Gemini quota unit on every empty document. See DECISIONS.md D019a.
- [x] **Ingestion pipeline** (`ingestDocument(filePath)`):
  1. Read file bytes via `readFile()`; wrap fs errors in `KnowledgeIngestError` with `cause`
  2. Derive `name` via `path.basename()`; derive `mime` via extension; unsupported → `KnowledgeIngestError`
  3. Parse via `parseBuffer(buffer, mime)`; wrap parser errors with `cause`
  4. `splitIntoChunks(text)` via M4-T3
  5. `adapter.resolveProvider()` → get config for insertDocument metadata (even for zero-chunk docs)
  6. `store.insertDocument({ name, mime, bytes, embeddingModel, embeddingDim })` via M4-T4
  7. Zero-chunk fast path → return `{ documentId, chunkCount: 0, embeddingModel, embeddingProvider }` — no embed call, no upsert call
  8. Otherwise `adapter.embed(chunks)` → `store.upsertChunks(documentId, chunks, embeddings)`, with atomicity cleanup: any error after `insertDocument` triggers `store.deleteDocument(documentId)` before re-throwing
  9. Defensive post-embed check: verify `getActiveEmbeddingConfig().model === resolveProvider config.model` to catch rare races where the provider changed mid-ingest; mismatch triggers rollback
- [x] **Query pipeline** (`queryKnowledge({ query, topK, includePinned?, documentIds? })`):
  1. Reject empty/whitespace-only query with `KnowledgeQueryError`
  2. Sanitize topK: `Number.isFinite(topK) && topK >= 1`, else `KnowledgeQueryError`; floor positive floats
  3. `adapter.embed([trimmedQuery])` to produce the query vector (forces provider resolution)
  4. Build candidate set: `allDocs.filter(d => d.embeddingModel === activeModel)`, intersected with `documentIds` if supplied
  5. If candidate set is empty AND `allDocs.length > 0` → throw `KnowledgeEmbeddingModelMismatchError` with a user-facing message listing stored models vs active model
  6. If every doc is compatible + no documentIds filter → `store.searchByEmbedding(queryVec, topK)` directly
  7. Otherwise overfetch with `k * 4`, filter hits by `candidateIds`, slice to topK. Overfetch factor chosen for M4 scale (<100 docs, <1000 chunks) — negligible cost, avoids post-filter attrition dropping below topK
  8. If `includePinned: true` → stable-sort filtered hits so pinned docs come first, with distance as tiebreaker within each group
- [x] **Model-mismatch policy (D019b):** throw when ALL stored docs are wrong model; silently filter when SOME match. This gives correct UX for the expected mixed-model case (user switched providers mid-project) while surfacing the confusing "nothing works" case (Ollama offline, all docs indexed with nomic) with an explicit error rather than empty results.
- [x] **MIME detection policy (D019c):** extension-based only (`.pdf`, `.docx`, `.md`/`.mdown`/`.markdown`, `.txt`). No magic-byte sniffing in M4 — adds complexity without meaningful benefit for a personal-use fork.
- [x] **No `DatabaseManager.getKnowledgeOrchestrator()` wiring** in this task. Tests use DI; production instantiation path will land in M4-T8 IPC handlers. Deferred to avoid an unnecessary edit to DatabaseManager.
- [x] **KnowledgeStore untouched** except for structural type imports via `import type { … }`. The `searchByEmbedding(queryVec, topK)` signature from M4-T4 is respected as-is — the orchestrator does post-filter rather than adding a `documentIds` parameter.
- [x] **21 new tests** appended to `electron/__tests__/providers.test.ts`:
  - 3 tests for `EmbeddingAdapter.resolveProvider` (Ollama path, Gemini fallback, neither available)
  - 18 tests for `KnowledgeOrchestrator` covering: pipeline call-order, zero-chunk path, order preservation, atomicity cleanup, unsupported file type, fs error wrapping, empty-query rejection, topK sanitization, embed-once-and-forward, all-docs-wrong-model throw, mixed-model filter, documentIds filter, documentIds-filter-with-no-match throw, includePinned sorting, empty-KB fast return, listDocuments/getDocumentText delegation, deleteDocument delegation, pin/unpin/listPinned delegation
- [x] All tests use DI — no `vi.mock`, no real filesystem, no real DB, no real network, no real parser (stub hooks override). Store and adapter are stubbed via structural typing (`KnowledgeStoreLike`, `EmbeddingAdapterLike`).
- [x] **Verification:** `npm run typecheck:electron` clean; `npm test` — **110/110 passing** (was 89); `npm run test:kb-schema` still 4/4; `npm run test:kb-store` still 14/14. Total test count: **128 across 3 runners**.
- **Contract for M4-T7 / M4-T8 to preserve:**
  1. **Renderer MUST pass file paths, not bytes.** `ingestDocument(filePath)` reads the file in main. T8 IPC handlers must enforce this at the boundary — never accept blob/buffer payloads from renderer.
  2. **`ingestDocument` is atomic from caller's perspective.** Either the document is fully persisted with all chunks + embeddings, or nothing remains in the DB. T8 can return `IngestResult` on success and a typed error on failure without worrying about half-state.
  3. **Zero-chunk documents ARE persisted as metadata-only rows.** `listDocuments()` includes them with `chunkCount: 0`. T9 UI should display them with a visual hint ("empty / no extractable text") rather than hiding them.
  4. **`queryKnowledge` throws `KnowledgeEmbeddingModelMismatchError` when all stored docs are wrong model.** T7 context builder and T8 query IPC handler must catch this and surface a user-facing message like "Start Ollama to search these documents". Do not silently return `[]` at the caller layer.
  5. **`queryKnowledge` silently filters incompatible docs in mixed-model DBs.** T7 should NOT additionally filter — the orchestrator already does the right thing.
  6. **`documentIds` filter is intersected with model compatibility.** If the caller passes IDs that are all incompatible with the active model, `KnowledgeEmbeddingModelMismatchError` is thrown. T7/T8 can rely on this invariant for error-path UX.
  7. **`includePinned: true` sorts pinned docs ahead of non-pinned within topK.** This is a MINIMAL interpretation of "pinned context". T7's full `TemporalContextBuilder` hook will handle pinned-doc prompt injection separately via `listPinned()` + `getDocumentText()` — the orchestrator's includePinned flag is for retrieval ordering, not prompt assembly.
  8. **Orchestrator exposes 8 public methods:** `ingestDocument`, `queryKnowledge`, `listDocuments`, `deleteDocument`, `pinDocument`, `unpinDocument`, `listPinned`, `getDocumentText`. T8 IPC handlers should map 1:1 onto these. Do not expose `KnowledgeStore` or `EmbeddingAdapter` to the IPC surface — the orchestrator is the public API layer.
  9. **Typed errors** (`KnowledgeIngestError`, `KnowledgeQueryError`, `KnowledgeEmbeddingModelMismatchError`, plus pass-through of T4/T5 errors like `KnowledgeNotFoundError`, `KnowledgeDimensionError`, `KnowledgeEmbeddingProviderUnavailableError`) MUST be caught and translated to user-facing messages by T8. Do not let raw `Error` leak through to the renderer.
  10. **Main-process only.** The orchestrator imports from `fs`, uses `path.basename`, and reads files. Renderer cannot import this module — T8 IPC is the only bridge.
- **Result:** Knowledge pipeline composes end-to-end. Ready for M4-T7 (`TemporalContextBuilder` pinned-doc + retrieval injection).

### M4-T7 — TemporalContextBuilder knowledge hook ✅ **DONE 2026-04-14**
- [x] New file `electron/knowledge/buildKnowledgeContext.ts` (~270 LOC) — one exported async function `buildKnowledgeContextBlock(deps) => Promise<string>`. Takes a structural DI orchestrator (`KnowledgeOrchestratorForContext` — 3 methods: `listPinned`, `getDocumentText`, `queryKnowledge`), a `query` string, and optional budget overrides. Returns a formatted bounded knowledge block or `''`. Handles ALL degradation internally — never throws for expected failures.
- [x] Minimal hook in `electron/llm/WhatToAnswerLLM.ts` (~25 LOC): new optional constructor param `knowledgeContextFn?: (query: string) => Promise<string>` plus one guarded invocation inside `generateStream` that prepends the resulting block to `contextParts`. Production callers wrap a `KnowledgeOrchestrator` in a closure via `buildKnowledgeContextBlock` — `WhatToAnswerLLM` stays decoupled from the knowledge module and takes a lambda, not an orchestrator. If the hook throws (defect-level bug), the live-assist stream continues without knowledge context (defense-in-depth on top of the helper's internal error handling).
- [x] **Narrow insertion point:** `WhatToAnswerLLM` is the sole caller of `TemporalContextBuilder` in the live-assist path (verified via grep). The hook fires BEFORE the existing `intent_and_shape` + `previous_responses` sections so the LLM sees pinned docs + retrieved chunks as system background, followed by temporal context, followed by transcript. TCB itself is NOT modified — its `buildTemporalContext` / `formatTemporalContextForPrompt` pair are pure functions that know nothing about the knowledge module.
- [x] **Knowledge block format (deterministic, see D020):**
  ```
  [Pinned Knowledge]
  ## Document 1: resume.pdf
  <text, up to 2000 chars, ellipsis-marked on truncation>

  ## Document 2: job-desc.md
  <text>

  [Retrieved Knowledge]
  ## resume.pdf — chunk 3 (distance 0.142)
  <chunk, up to 600 chars>

  ## coding-guide.md — chunk 7 (distance 0.287)
  <chunk>
  ```
- [x] **Size budget (D020):** `topK=4`, `queryMaxChars=500` (last-N chars of transcript), `pinnedMaxCharsPerDoc=2000`, `pinnedMaxTotalChars=6000`, `retrievedMaxCharsPerChunk=600`, `retrievedMaxTotalChars=2400`. Per-entry and total caps both enforced. Budget-forced truncation produces a ` […truncated]` marker; naturally-short content is passed through unchanged. Stop adding entries when the remaining total budget is too small (< 50 chars for pinned, < 30 for retrieved) for any meaningful follow-on entry.
- [x] **Degradation policy per typed error (D020):**
  | Error | Action |
  |---|---|
  | `KnowledgeEmbeddingModelMismatchError` | Log `[Knowledge] queryKnowledge failed (KnowledgeEmbeddingModelMismatchError)`, retrieved block = empty, pinned block still rendered |
  | `KnowledgeEmbeddingProviderUnavailableError` | Log warn, retrieved block = empty, pinned block still rendered |
  | Any other `queryKnowledge` error | Log warn, retrieved block = empty, pinned block still rendered |
  | `listPinned` throws | Log warn, pinned block = empty, retrieval still attempted |
  | `getDocumentText` throws on one pinned doc | Skip that doc only, continue with others |
  | Empty pinned-doc text | Skip silently (no log) |
  | `WhatToAnswerLLM` `knowledgeContextFn` throws | Log warn, continue stream without knowledge block |
- [x] **Dedup rule (D020):** retrieved chunks from pinned document IDs are filtered out of the retrieved block — pinned docs already contain the full text so double-injection would waste prompt budget. Implementation: build `pinnedIds: Set<string>` from `listPinned()` output, filter `queryKnowledge` results via `!pinnedIds.has(chunk.documentId)`. `queryKnowledge` is called with `includePinned: false` to avoid biasing the retrieval ordering toward pinned docs that will then be filtered out.
- [x] **Query derivation rule (D020):** take `query.slice(-queryMaxChars)` (last-N chars), then `.trim()`. If result is empty, skip retrieval entirely (pinned block still renders). This gives the embedder the most-recent conversation context without noise from old transcript history.
- [x] **18 new tests** appended to `electron/__tests__/providers.test.ts`:
  - 15 tests for `buildKnowledgeContextBlock` covering: empty orchestrator, only-pinned, only-retrieved, both-present, dedup (pinned vs retrieved chunk from same doc), zero-chunk pinned doc skipped silently, pinned-read failure skipped + logged, `KnowledgeEmbeddingModelMismatchError` degradation (pinned still rendered), `KnowledgeEmbeddingProviderUnavailableError` degradation, arbitrary query failure degradation, pinned block budget + truncation marker, retrieved block budget + truncation marker, query last-N-chars derivation, empty-query skips retrieval, `includePinned: false` enforced at the orchestrator call site
  - 3 tests for `WhatToAnswerLLM` knowledge hook: hook invoked with `cleanedTranscript` as the query and block prepended to `fullMessage` with correct ordering (knowledge BEFORE `CONVERSATION:`); hook throws → stream still completes with warning log; no hook passed → fullMessage is byte-identical to pre-M4-T7 behavior (no `[Pinned Knowledge]` or `[Retrieved Knowledge]` markers)
- [x] **Verification:** `npm run typecheck:electron` clean; `npm test` — **128/128 passing** (was 110); `npm run test:kb-schema` still 4/4; `npm run test:kb-store` still 14/14. Total test count: **146 across 3 runners**.
- **Contract for M4-T8 to preserve:**
  1. **`buildKnowledgeContextBlock` is the canonical way to produce a knowledge block.** T8 IPC handlers must NOT construct their own formatting; they should either call this helper directly or rely on the hook pattern `WhatToAnswerLLM` uses.
  2. **`WhatToAnswerLLM` takes an optional closure, not an orchestrator.** Production wiring pattern: `new WhatToAnswerLLM(llmHelper, (q) => buildKnowledgeContextBlock({ orchestrator, query: q }))`. T8 will need to instantiate the orchestrator via `DatabaseManager.getKnowledgeOrchestrator()` (lazy accessor) and wrap it in this closure when constructing LLM classes.
  3. **The closure signature is `(query: string) => Promise<string>`.** If future LLM classes (AnswerLLM, AssistLLM, etc.) also want knowledge context, they should accept the same closure shape. Do NOT pass an orchestrator directly into LLM classes — keeps the coupling minimal.
  4. **The knowledge block is injected BEFORE intent/temporal context in `WhatToAnswerLLM`'s `contextParts` array.** The final `fullMessage` order is: knowledge block → intent → previous_responses → CONVERSATION → transcript. T8 and any future prompt-assembly code must preserve this ordering.
  5. **Hook throwing never breaks the stream.** Defense-in-depth: the helper catches all expected errors internally, and `WhatToAnswerLLM` has a second catch around the hook invocation. T8 should not need additional error handling at the call site.
  6. **Renderer never sees knowledge text.** The full prompt (including knowledge block) is assembled in main, sent to the provider, and only the streamed LLM output reaches the renderer. T8 IPC handlers must preserve this — the IPC surface exposes the orchestrator's 8 admin methods (list/ingest/delete/pin/unpin/etc.) but does NOT expose raw `getDocumentText()` results back to the renderer for prompt assembly.
  7. **Default budgets are tuned for M4 scale.** `pinnedMaxTotalChars=6000` + `retrievedMaxTotalChars=2400` = ~8400 chars ≈ 2100 tokens of knowledge context per request. This fits comfortably in the 128k+ context windows of all M4 chat providers (MiniMax M2.7, Gemini 2.5, Claude 4.5, GPT-4o). If T8 or a later task needs to adjust, pass `options` to `buildKnowledgeContextBlock` — do NOT reimplement the budget logic.
  8. **`KnowledgeEmbeddingModelMismatchError` never reaches the user UI.** It's caught by the helper and translated to a warning log. T8 should NOT surface a user-facing error for this case — the live-assist flow continues, knowledge context is just absent for this request. A future "Knowledge health" indicator (M5+?) could read CredentialsManager state and warn proactively, but that's not M4 scope.
- **Result:** Knowledge-base context is wired into the live-assist prompt assembly path. Ready for M4-T8 (IPC handlers + preload surface).

### M4-T8 — Knowledge IPC + preload surface + production wiring ✅ **DONE 2026-04-14**
Wire the knowledge subsystem into the production Electron process. Add `DatabaseManager.getKnowledgeOrchestrator()` lazy accessor, expose 8 typed IPC handlers, and swap `WhatToAnswerLLM`'s knowledge hook from the M4-T7 `undefined` placeholder to a real closure backed by the orchestrator.

- **Files created:**
  - [electron/knowledge/knowledgeIpcHelpers.ts](electron/knowledge/knowledgeIpcHelpers.ts) (~420 LOC) — 8 pure DI-friendly handler functions + validators (`validateNonEmptyString`, `validatePositiveInt`, `validateStringArray`) + `translateError` (typed-error → `KnowledgeIpcErrorType` + user-safe `error` string, with absolute Windows/POSIX path scrubbing to `<path>`) + `makeKnowledgeContextClosure` factory (used by IntelligenceEngine).
- **Files modified:**
  - [electron/db/DatabaseManager.ts](electron/db/DatabaseManager.ts) — added `knowledgeOrchestrator` private field and `getKnowledgeOrchestrator(): KnowledgeOrchestrator` lazy accessor. Uses `require()` to avoid circular import with the type-only `import()` annotation for TypeScript.
  - [electron/IntelligenceEngine.ts](electron/IntelligenceEngine.ts) — added top-level `buildKnowledgeContextClosureOrNull()` that wraps the closure factory in a try/catch (graceful degradation — live-assist never breaks if the knowledge pipeline fails to initialize). Wired into `initializeLLMs()` to pass through to `new WhatToAnswerLLM(helper, knowledgeContextFn ?? undefined)`.
  - [electron/ipcHandlers.ts](electron/ipcHandlers.ts) — registered 8 `safeHandle` wrappers (`knowledge-ingest-document`, `knowledge-list-documents`, `knowledge-delete-document`, `knowledge-pin-document`, `knowledge-unpin-document`, `knowledge-list-pinned`, `knowledge-query`, `knowledge-get-document-preview`). Each wrapper is a thin adapter: lazy-require `knowledgeIpcHelpers`, call `DatabaseManager.getInstance().getKnowledgeOrchestrator()`, delegate to the pure helper. Errors thrown inside the helpers are caught by the helpers themselves and translated to the `KnowledgeIpcFailure` shape.
  - [electron/preload.ts](electron/preload.ts) — added 8 contextBridge methods mirroring the channel names, each `ipcRenderer.invoke`-wrapped.
  - [src/types/electron.d.ts](src/types/electron.d.ts) — typed declarations for all 8 methods, plus exported shared types `KnowledgeIpcErrorType`, `KnowledgeIpcFailure`, `KnowledgeDocumentMetadata`, `KnowledgeRetrievedChunk`.
  - [electron/__tests__/providers.test.ts](electron/__tests__/providers.test.ts) — 25 new tests in a dedicated `knowledgeIpcHelpers (M4-T8)` describe block. Uses structural DI via `KnowledgeOrchestratorForIpc` — no `vi.mock`, no DB, no real orchestrator. Covers: happy-path delegation, input validation (empty string, non-string, non-object payload, non-positive topK clamp to hard max 50), error translation for every typed error class (`KnowledgeIngestError`, `KnowledgeNotFoundError`, `KnowledgeEmbeddingModelMismatchError`, `KnowledgeEmbeddingProviderUnavailableError`), absolute-path scrubbing in error messages, preview hard-max cap (4000 default, 12000 hard max) with a 1 MB document stress test, NaN/negative/non-number `maxChars` sanitization, and the `makeKnowledgeContextClosure` factory (closure vs orchestrator identity, null-on-throw, null-on-null-orch, closure-invocation delegation).

- **Contracts preserved:**
  - `KnowledgeIpcResult` shape matches the existing `ipcHandlers.ts` convention: `{ success: true, ...data } | { success: false, error: string, errorType: KnowledgeIpcErrorType }`. No breaking changes to existing IPC callers.
  - Preview handler NEVER returns more than `PREVIEW_HARD_MAX_CHARS = 12000` regardless of caller input (even `Infinity`). Default is `PREVIEW_DEFAULT_MAX_CHARS = 4000` when `maxChars` is omitted or invalid.
  - All error messages are user-safe — no stack traces, no API keys, no absolute file paths. Ingest-error paths are scrubbed to `<path>` marker.
  - Graceful degradation: if `DatabaseManager.getKnowledgeOrchestrator()` throws at `IntelligenceEngine.initializeLLMs()` time, the closure factory returns `null` and `WhatToAnswerLLM` runs without the knowledge hook. Live-assist always works.
  - Zero `vi.mock` in tests — all DI is structural. Electron-runtime `.cjs` tests from M4-T1/T4 still pass untouched.

- **Tests:**
  - 155 vitest tests (was 128 after M4-T7; +27 for M4-T8)
  - 4 kb-schema Electron-runtime tests (unchanged)
  - 14 kb-store Electron-runtime tests (unchanged)
  - **Total: 173 (149 before T8 + 24 new, all passing)**
  - All typecheck, build, and build:electron gates clean.

- **Key discovery:** The electron tsconfig has `strict: false` (only `noImplicitAny: true`), so discriminated-union narrowing via `if (!result.success)` collapses to full-union property access. Tests use explicit `as KnowledgeIpcFailure` casts after verifying `result.success === false`. See DECISIONS.md **D021**.

- **Contract for M4-T9 to preserve:**
  - IPC channel names and payload shapes are stable — do not rename.
  - Renderer consumes the 8 methods through `window.electronAPI.*` (e.g. `window.electronAPI.knowledgeIngestDocument(filePath)`). Types are in `src/types/electron.d.ts`.
  - Renderer should `switch` on `errorType` to render tailored UI (e.g. `"provider_unavailable"` → "Start Ollama", `"model_mismatch"` → "Re-ingest needed"), not parse the free-form `error` string.
  - Preview handler is the ONLY way to show document text in the renderer. Never use a "full text" IPC.

- **Result:** Knowledge subsystem is end-to-end wired. Launcher → Settings pane (M4-T9) can now add documents, list/pin/delete, query the KB, and preview text. Live-assist prompts already carry `[Pinned Knowledge]` + `[Retrieved Knowledge]` blocks via the real closure. Ready for M4-T9 (renderer settings pane).

### M4-T9 — Renderer knowledge management UI ✅ **DONE 2026-04-14**
First usable renderer surface for personal-knowledge administration. Consumes only the M4-T8 preload methods — no new IPC, no direct filesystem access from renderer, no raw bytes.

- **Files created:**
  - [src/lib/knowledgeErrors.ts](src/lib/knowledgeErrors.ts) (~60 LOC) — pure `errorTypeToMessage(errorType) → string` helper with exhaustive switch + `never` default branch + exported `ALL_KNOWLEDGE_ERROR_TYPES` constant for the exhaustiveness test. The only place where renderer-side error copy lives.
  - [src/components/settings/KnowledgeSettings.tsx](src/components/settings/KnowledgeSettings.tsx) (~400 LOC) — isolated settings component. Handles list load (concurrent `knowledgeListDocuments` + `knowledgeListPinned`), import via the reused `profileSelectFile` picker, manual-path fallback input (for .md files — see deviation below), pin/unpin toggle, delete-with-confirm, bounded preview modal with truncation indicator, empty-state UI, zero-chunk "Empty" badge, and error banner that surfaces `errorTypeToMessage(errorType)`.

- **Files modified:**
  - [src/components/SettingsOverlay.tsx](src/components/SettingsOverlay.tsx) — added `BookOpen` icon import, `KnowledgeSettings` component import, one new sidebar button, one new panel branch `{activeTab === 'knowledge' && <KnowledgeSettings />}`. Zero changes to existing tabs, routing logic, or state.
  - [electron/__tests__/providers.test.ts](electron/__tests__/providers.test.ts) — 12 new tests in a `knowledgeErrors.errorTypeToMessage (M4-T9)` describe block: 8 per-variant mapping tests (category substring assertions), 1 non-empty-message sweep, 1 distinct-message sweep (no silent collapse), 1 exhaustiveness test (8 variants matching the type union), 1 scrubber-token leakage test (no `<path>` or Windows absolute path markers in renderer copy). Imports `../../src/lib/knowledgeErrors` + `type KnowledgeIpcErrorType` from `../../src/types/electron` — first cross-boundary test import, works because both are `.ts`/`.d.ts` modules and the test runs under vitest's default resolver.

- **Entry point used:** Settings → Advanced Settings → **Knowledge** tab (sidebar button added between AI Providers and Calendar, before Audio). Reused the existing sidebar/panel pattern byte-for-byte — no new windows, no new routing infrastructure.

- **Preload methods consumed (7 of 8):**
  - `knowledgeListDocuments()` — list rendering
  - `knowledgeListPinned()` — pin-state derivation
  - `knowledgeIngestDocument(filePath)` — picker + manual-path paths
  - `knowledgePinDocument(id)` / `knowledgeUnpinDocument(id)` — pin toggle
  - `knowledgeDeleteDocument(id)` — delete after confirm
  - `knowledgeGetDocumentPreview(id)` — preview modal (default cap, never requests a custom `maxChars`)
  - **Not used in this task:** `knowledgeQuery` (reserved for a future query/search pane — T9 is admin-only per the task scope).

- **Error-type → UI mapping (all 8 variants handled):**
  | `errorType` | User-facing message (short) |
  |---|---|
  | `invalid_input` | "Invalid input. Check the file path or query and try again." |
  | `ingest_failed` | "Could not ingest this document. Check that the file exists and is a PDF, DOCX, Markdown, or plain-text file." |
  | `query_failed` | "The knowledge query failed. Try again, or check that your embedding provider (Ollama or Gemini) is reachable." |
  | `model_mismatch` | "Stored documents use a different embedding model than the active one. Re-enable the original provider or re-ingest these documents." |
  | `provider_unavailable` | "No embedding provider is available. Start Ollama (\`ollama serve\`) or add a Gemini API key in Settings → AI Providers." |
  | `not_found` | "Document not found. It may have been deleted." |
  | `dimension_mismatch` | "Embedding dimension mismatch. This document needs to be re-ingested with a compatible provider." |
  | `internal` | "An unexpected error occurred. Check the application logs for details." |

- **No new IPC added.** Reused `window.electronAPI.profileSelectFile()` for the file picker. That handler's dialog filter is `pdf / docx / txt` — missing `.md` and `.markdown`. Rather than add a new `knowledge-select-file` IPC (constraint: no new IPC without a compile-blocking gap), the component provides a manual-path text input as a fallback for Markdown files. The renderer never reads file bytes; main process handles all filesystem access via the existing orchestrator path. See DECISIONS.md **D022** for the placement + picker-reuse rationale.

- **Security / trust boundary:**
  - Renderer never touches raw bytes. Both the picker path and the manual-path path pass strings only to `knowledgeIngestDocument` → main-process `KnowledgeOrchestrator.ingestDocument(filePath)` → `fs.promises.readFile` (main).
  - Preview is the only text-exposure surface. The component always calls `knowledgeGetDocumentPreview(id)` with the default cap — it never passes a custom `maxChars`, so the main-process clamp at `PREVIEW_HARD_MAX_CHARS = 12000` never kicks in. The `truncated` flag is surfaced in the UI with a badge + footer note; the component does not try to page around the cap.
  - Error messages are renderer-hand-written copy based on `errorType` only. The component never displays the raw `error` string from the IPC failure. This matches the M4-T8 contract (D021).
  - Path scoping is **not** widened. SECURITY.md R12 still tracks unconstrained file-path ingestion as a residual — this task does not introduce any new surface that affects the residual.

- **State management:** All component state is local (`useState`). No new global store. No new hook. Nine state slots (`docs`, `pinnedIds`, `loaded`, `busy`, `uiError`, `preview`, `confirmDeleteId`, `manualPath`) + derived `sortedDocs` memo.

- **Deviations:**
  1. **Renderer DOM tests not added.** The repo has no jsdom / React Testing Library setup (`vitest.config` targets `electron/__tests__/**/*.test.ts` under `environment: 'node'`). Per the task's "only if the repo already has a nearby practical pattern" clause, I did NOT add one. The test coverage is narrow — 12 tests against the pure `errorTypeToMessage` helper + exhaustiveness sweep. The functional scenarios from the task's test list (empty list, successful list, ingest action, pin/unpin, delete confirm, preview, truncated indicator, zero-chunk display) are NOT covered by automated tests; they are covered by manual smoke testing (M4-T11) instead.
  2. **Picker filter gap for `.md`.** `profileSelectFile` accepts `pdf/docx/txt`. Markdown files fall through the filter and require the manual-path text input. Users can still select `.md` via the fallback — the orchestrator will dispatch by extension regardless of how the path was obtained. A trivial filter widening to cover `.md` is a candidate for M4-T10 or a follow-up polish task.
  3. **`knowledgeQuery` not wired to UI.** The task scope says "No speculative knowledge search UI unless it falls out naturally from the existing panel and stays tiny". It didn't fall out naturally — the admin pane is already useful without it. Deferred to M5+ or a dedicated follow-up.

- **Contract for M4-T10 to preserve:**
  - `KnowledgeSettings` is the single renderer-side consumer of the knowledge IPC surface. Export/import in M4-T10 should either add new buttons to this same pane or a sibling component, not a new top-level settings tab.
  - `errorTypeToMessage` is the canonical mapping. Any new UI path that surfaces a `KnowledgeIpcFailure` must call this helper — never format the raw `error` string or branch on substring matching.
  - The preview cap is never widened at the renderer boundary. If export/import needs raw full-text access, it must go through a distinct main-process path (e.g. an export handler that writes directly to a user-selected output file), NOT by widening `knowledgeGetDocumentPreview`.
  - The manual-path input is a legitimate UX affordance — not a hack. Do not remove it unless a future file-picker widening fully covers every supported extension including `.md`, `.markdown`, `.mdown`.

- **Tests:** **167 vitest** (155 before + 12 new M4-T9) + 4 kb-schema + 14 kb-store = **185 total, all passing.** Typecheck, `build:electron`, and full `build` (vite) all clean.

- **Result:** Launcher → Settings → Knowledge now provides end-to-end document management for the personal-knowledge base. Live-assist already reads from this same store via the M4-T8 production wiring, so any document added through the pane is immediately usable by the next rolling-context window. Ready for M4-T10 (export/import) or M4-T11 (manual smoke test).

### M4-T10 — Knowledge base export/import ✅ **DONE 2026-04-14**
Manual backup/restore for the personal knowledge base. Single versioned JSON artifact, **replace** policy with pre-import on-disk backup, transactional DB apply, minimal renderer additions inside the existing `KnowledgeSettings` pane.

- **Export format:** Single JSON file (`sensi-knowledge-<date>.json`) with a top-level magic marker `"sensiKnowledgeExport": true`, `version: 1`, `embeddingDim: 768`, `exportedAt` ISO timestamp, `documentCount`, `chunkCount`, and a `documents[]` array. Each document carries `name`, `mime`, `bytes`, `embeddingModel`, `embeddingDim`, `pinned`, `pinnedAt`, `ingestedAt`, and an ordered `chunks[]` array. Each chunk has `chunkIndex`, `text`, and `embedding` (768-length plain number array). Human-readable, debuggable, no container/zip. Scoped strictly to knowledge-subsystem data — no credentials, meetings, transcripts, screenshots, or app settings.

- **Import policy:** **Replace** — the current knowledge base is fully wiped before the imported documents are inserted. Before destructive mutation, a pre-import backup of the current state is written to `<userData>/knowledge-preimport-backup-<ISO>.json`. The wipe+insert itself runs inside a single `better-sqlite3` transaction for DB-level atomicity on top of the on-disk snapshot. Merge policy was explicitly rejected per the task's "if merge requires conflict UI, choose replace instead" clause.

- **Files created:**
  - [electron/knowledge/knowledgeTransfer.ts](electron/knowledge/knowledgeTransfer.ts) (~450 LOC) — pure transfer module with 3 typed errors (`KnowledgeExportError`, `KnowledgeImportError`, `KnowledgeIncompatibleFormatError`), format constants (`KNOWLEDGE_EXPORT_MAGIC`, `KNOWLEDGE_EXPORT_VERSION = 1`, `KNOWLEDGE_EXPORT_EMBEDDING_DIM = 768`), pure helpers (`buildExportArtifact`, `validateImportArtifact`), and IO entry points (`exportKnowledgeToFile`, `importKnowledgeFromFile`). Uses structural DI via `ExportReadableStore` / `ImportWritableStore` / `TransferStore` interfaces.
  - [electron/__tests__/knowledgeTransfer.electron.cjs](electron/__tests__/knowledgeTransfer.electron.cjs) (5 tests) — Electron-runtime integration test for the two new `KnowledgeStore` methods against a real `better-sqlite3` + `sqlite-vec` schema. Covers: Float32 blob decode round-trip, wipe-and-insert, pinned state preservation, searchByEmbedding after replace, and pre-validation atomicity on bad dim.

- **Files modified:**
  - [electron/knowledge/KnowledgeStore.ts](electron/knowledge/KnowledgeStore.ts) — added two new methods: `getDocumentChunksWithEmbeddings(docId)` (SELECT joining `kb_chunks` + `vec_kb_chunks`, decodes raw Float32 bytes into a plain number array, verifies byteLength × 4 = 3072) and `replaceAllFromArtifact(docs)` (pre-validates every chunk's dim, counts existing docs, runs a single `db.transaction()` that deletes every `vec_kb_chunks` row via a rowid walk + wipes `kb_chunks` + wipes `kb_documents` + inserts each imported doc with its chunks + embeddings, returning `{ replaced, imported }`).
  - [electron/knowledge/KnowledgeOrchestrator.ts](electron/knowledge/KnowledgeOrchestrator.ts) — widened `KnowledgeStoreLike` with the two new method signatures; added `backupDir?: string | null` constructor dep; added `getTransferStore()` (returns a `TransferStore` view over the underlying store, 3 closures) and `getBackupDir()` methods.
  - [electron/knowledge/knowledgeIpcHelpers.ts](electron/knowledge/knowledgeIpcHelpers.ts) — added 3 new `KnowledgeIpcErrorType` variants (`export_failed`, `import_failed`, `incompatible_format`), added `ExportKnowledgeResult` and `ImportKnowledgeResult` typed unions, widened `KnowledgeOrchestratorForIpc` with `getTransferStore()` + `getBackupDir()`, added 3 new branches in `translateError` for the transfer error classes, added `handleExportKnowledge(orch, filePath)` and `handleImportKnowledge(orch, filePath)` handlers.
  - [electron/ipcHandlers.ts](electron/ipcHandlers.ts) — registered 4 new `safeHandle` wrappers: `knowledge-export`, `knowledge-import` (thin adapters calling the helpers), plus `knowledge-pick-export-path` and `knowledge-pick-import-path` (main-process `dialog.showSaveDialog` / `dialog.showOpenDialog` with `.json` filter; return `{cancelled}` or `{filePath}`). These four are the **only** new IPC channels.
  - [electron/preload.ts](electron/preload.ts) — added 4 contextBridge methods mirroring the channels + optional type slots in the local `ElectronAPI` interface.
  - [electron/db/DatabaseManager.ts](electron/db/DatabaseManager.ts) — `getKnowledgeOrchestrator()` now passes `backupDir: app.getPath('userData')` so pre-import backups land alongside `sensi.db`.
  - [src/types/electron.d.ts](src/types/electron.d.ts) — added `export_failed | import_failed | incompatible_format` to `KnowledgeIpcErrorType`, added typed declarations for the 4 new `electronAPI.knowledge*` methods with their success/failure shapes.
  - [src/lib/knowledgeErrors.ts](src/lib/knowledgeErrors.ts) — added 3 new switch branches for the new error types + expanded `ALL_KNOWLEDGE_ERROR_TYPES` from 8 to 11 variants.
  - [src/components/settings/KnowledgeSettings.tsx](src/components/settings/KnowledgeSettings.tsx) — added a new "Back up or restore" section with Export + Import buttons above the existing "Import a document" section. Added `transferStatus` state for the success banner (shows counts, filePath, and backup note). Existing document-ingest flow renamed from `onClickImport` to `onClickImport` (kept) while new whole-KB flows use `onClickExportKB` / `onClickImportKB` to avoid shadowing. After successful import, `refreshList()` is called automatically.
  - [electron/__tests__/providers.test.ts](electron/__tests__/providers.test.ts) — 30 new tests:
    - **16 transfer-module tests** covering `buildExportArtifact` (versioned shape, no credential/meeting/transcript leak, wrong-dim rejection), `validateImportArtifact` (well-formed accept, non-object reject, missing magic marker, future version, non-integer version, wrong dim, wrong chunk length, non-finite values, wrong field types), and round-trip `exportKnowledgeToFile` + `importKnowledgeFromFile` (pinned+metadata preserved, malformed JSON rejected, missing file rejected, atomicity on replace failure, pre-import backup written, re-validation of exported JSON).
    - **8 IPC handler tests** covering `handleExportKnowledge` (empty filePath, non-string filePath, success with counts, non-writable path), `handleImportKnowledge` (empty filePath, incompatible_format translation, import_failed translation, compile-time structural assertion that the success return type does not expose raw text).
    - **3 new error-message tests** for `export_failed`, `import_failed`, `incompatible_format`, plus an updated exhaustiveness test (`ALL_KNOWLEDGE_ERROR_TYPES.length === 11`).
  - [package.json](package.json) — added `test:kb-transfer` npm script.

- **New IPC added (4):** `knowledge-export`, `knowledge-import`, `knowledge-pick-export-path`, `knowledge-pick-import-path`. The two pick handlers are necessary because `profileSelectFile` has a `pdf/docx/txt` filter (wrong for `.json`) and there is no existing save-dialog IPC in the codebase. The alternative was to widen `profileSelectFile` with JSON support, which would pollute an unrelated handler — kept the dialog wrappers knowledge-specific and narrow. Documented as justified new IPC in DECISIONS.md D023.

- **Typed error mapping:**
  | Source error | → `errorType` | User-facing copy |
  |---|---|---|
  | `KnowledgeIncompatibleFormatError` | `incompatible_format` | "This file is not a supported sensi knowledge export. Confirm it was produced by this version and try again." |
  | `KnowledgeExportError` | `export_failed` | "Export failed. Check that the selected location is writable and try again." |
  | `KnowledgeImportError` | `import_failed` | "Import failed. Check that the file is readable and has not been modified, then try again." |
  | `InvalidInputError` (empty/non-string filePath) | `invalid_input` | (unchanged from M4-T8) |

- **Contracts preserved:**
  - Renderer never holds raw bytes. The `.json` artifact is written and read entirely in main process via `fs.promises`. Renderer only passes a filePath string through the IPC boundary.
  - Preview cap is **not** widened. Export/import do NOT use `knowledgeGetDocumentPreview` — they operate on chunks + embeddings via the dedicated `getDocumentChunksWithEmbeddings` path. The bounded-preview surface remains the sole renderer-visible text-exposure path.
  - Zero changes to existing retrieval invariants: after import, `searchByEmbedding` works because `replaceAllFromArtifact` uses the same `toVecPk` BigInt binding rule (D014c) and inserts real Float32 blobs into `vec_kb_chunks`. Test 4 of `knowledgeTransfer.electron.cjs` verifies this against a real sqlite-vec schema.
  - Atomicity is double-guaranteed: the on-disk backup is written before any DB mutation, and the wipe+insert runs in a single `db.transaction()`. On error mid-transaction, `better-sqlite3` rolls back and the store is unchanged; the backup remains for manual recovery.
  - No credentials, meetings, transcripts, screenshots, or app settings touch the artifact. Test 2 of the transfer-module suite asserts only the 7 expected top-level keys and asserts that document shape has no `apiKey` / `credentials` / `transcript` / `meetingId` fields.

- **Tests:** **197 vitest** (167 before + 30 new) + 4 kb-schema + 14 kb-store + **5 kb-transfer** = **220 total, all passing.** Typecheck, `build:electron`, and full `build` (vite) all clean.

- **Deviations:**
  1. **Four new IPC channels added, not two.** The task suggested "minimal new typed handlers" with a preferred `knowledge-export(filePath)` / `knowledge-import(filePath)` pair. I added those two PLUS two dialog wrappers (`knowledge-pick-export-path`, `knowledge-pick-import-path`) because no existing save-dialog IPC fits and the existing `profileSelectFile` filter is wrong. Documented as a compile-necessary gap in DECISIONS.md D023 — without a JSON-friendly dialog wrapper, the renderer would either have to reuse a semantically-wrong picker or hand-roll a path input. The pick handlers are ~20 LOC each and their only job is wrapping `dialog.showSaveDialog` / `dialog.showOpenDialog`.
  2. **Replace policy, not merge.** Merge was rejected because it requires a conflict-resolution UI, which the task explicitly forbids ("if your chosen merge policy absolutely requires one; if so, stop and choose replace instead").

- **Contract for M4-T11 to preserve:**
  - The pre-import backup file lives at `<userData>/knowledge-preimport-backup-<ISO>.json`. Manual smoke should verify the file exists after an import run and contains the pre-import state.
  - After `knowledgeImport` success, `KnowledgeSettings` calls `refreshList()` automatically — M4-T11 smoke should check that pinned state visibly refreshes in the UI without requiring a manual tab switch.
  - Round-trip fidelity: `export → clear → import` should leave the store in a state where `searchByEmbedding` returns the same top-1 hit for a known query. This is already covered by Test 4 of the transfer runtime suite, but M4-T11 should additionally manually verify that live-assist in a meeting still retrieves content after a round-trip.
  - Export/import are **synchronous-UI** operations — there is no streaming progress bar. For ~100 documents × ~50 chunks (M4 scale), the operation completes in under a second. Larger bases should get a background-progress indicator in a later milestone.
  - No new renderer raw-text exposure was introduced. The compile-time test in `knowledgeIpcHelpers export/import` describe block verifies the success return types have no `text` / `chunks` fields.

- **Result:** Knowledge base can be manually backed up and restored. End-to-end export/import works via real sqlite-vec SQL. The pre-import backup + SQLite-transaction double-safety ensures a failed import cannot leave the store in an inconsistent state. Ready for M4-T11 (manual smoke test).

### KNOWLEDGE-FIX-01 — Ollama embedding readiness + ingest error routing ✅ **DONE 2026-04-14**
Narrow follow-up fix on top of the completed M4 surface. Addresses a misleading "The knowledge query failed…" message that appeared during ingest even when a Gemini API key was configured. Root cause was a too-loose Ollama probe (daemon reachable but `nomic-embed-text` not pulled) combined with an ingest-time embed error being routed through the `query_failed` IPC channel.

- **Tightened Ollama embedding-model probe.** Added exported pure helper `hasOllamaEmbeddingModel(tagsJson, modelName)` in [electron/knowledge/EmbeddingAdapter.ts](electron/knowledge/EmbeddingAdapter.ts) and rewrote `probeOllamaDefault` to parse the `/api/tags` response and delegate to the helper. The probe now returns `true` only when the actual embedding model (`nomic-embed-text`) is installed on the running Ollama daemon — not merely when `/api/tags` returns 2xx. This aligns the knowledge subsystem's Ollama readiness with the stricter check already used by `buildProviderStatus('ollama')` in [electron/ipcHandlers.ts:710-726](electron/ipcHandlers.ts). Any failure mode (unreachable daemon, 5xx, parse error, missing / wrong-named model) maps to `false` without throwing. See DECISIONS.md **D024a**.
- **Routed ingest-time embedding failures to the correct IPC channel.** In [electron/knowledge/KnowledgeOrchestrator.ts](electron/knowledge/KnowledgeOrchestrator.ts) `ingestDocument` step-8 catch, after the existing atomicity cleanup, `KnowledgeEmbeddingRequestError` and `KnowledgeEmbeddingDimensionError` are now wrapped in `new KnowledgeIngestError(..., { cause: e })` before being re-thrown. The IPC `translateError` in `knowledgeIpcHelpers.ts` already maps `KnowledgeIngestError` to `ingest_failed`, so the user-facing copy now correctly describes an ingest-time failure instead of the misleading `query_failed` bucket. The underlying provider error remains in the `cause` chain for main-process logs. See DECISIONS.md **D024b**.
- **`provider_unavailable` / `model_mismatch` pass-through preserved.** `KnowledgeEmbeddingProviderUnavailableError` and `KnowledgeEmbeddingModelMismatchError` are deliberately NOT re-wrapped in the catch. Users who have neither Ollama-with-nomic nor a Gemini key still see the tailored "Start Ollama or add a Gemini API key" hint, and users with mixed-model stored documents still see the model-mismatch copy. See DECISIONS.md **D024c**.
- **Files modified (3, no new files):**
  - [electron/knowledge/EmbeddingAdapter.ts](electron/knowledge/EmbeddingAdapter.ts) — new exported `hasOllamaEmbeddingModel` pure helper + rewritten `probeOllamaDefault`. ~+45 LOC.
  - [electron/knowledge/KnowledgeOrchestrator.ts](electron/knowledge/KnowledgeOrchestrator.ts) — runtime imports of the two embed error classes + wrapped catch branch in `ingestDocument`. ~+30 LOC.
  - [electron/__tests__/providers.test.ts](electron/__tests__/providers.test.ts) — 5 new tests (3 pure-helper + 2 orchestrator error-routing). ~+110 LOC.
- **Zero new IPC, zero preload changes, zero renderer changes, zero doc-format changes, zero credential handling changes, zero DB schema changes.** Trust boundaries B1–B6 untouched. Reversible with a single `git revert`.
- **Tests added (5, all passing):**
  - `EmbeddingAdapter probe — Ollama model presence (KNOWLEDGE-FIX-01)` describe block:
    1. `returns true when nomic-embed-text is listed in models[] (with or without tag suffix)`
    2. `returns false when daemon responds but nomic-embed-text is absent`
    3. `returns false on malformed tags response`
  - Inside existing `KnowledgeOrchestrator (M4-T6)` describe block:
    4. `ingestDocument wraps KnowledgeEmbeddingRequestError from embed() as KnowledgeIngestError and still cleans up`
    5. `ingestDocument surfaces KnowledgeEmbeddingProviderUnavailableError unchanged (provider_unavailable contract preserved)`
- **Gate results:** `npm run typecheck:electron` clean; `npm test` → **202 / 202 passing** (was 197, +5); `npm run test:kb-schema` → 4/4; `npm run test:kb-store` → 14/14; `npm run test:kb-transfer` → 5/5; `npm run build` clean. **Total: 225 tests passing** (was 220 at end of M4-T10).
- **Contract for M4-T11 manual smoke to preserve:**
  - If Ollama is running without `nomic-embed-text` pulled AND a Gemini key is configured, ingest must now succeed via the Gemini fallback path (probe correctly rejects Ollama).
  - If neither Ollama-with-nomic nor a Gemini key is configured, ingest must surface the `provider_unavailable` copy (`"Start Ollama or add a Gemini API key…"`), not the generic `query_failed` copy.
  - Ingest-time 404/5xx from the embedding provider (e.g. rate limit, network blip) must now surface as `ingest_failed`, with the `KnowledgeIngestError` `cause` chain preserved in the main-process log for triage.
- **Result:** Knowledge ingest no longer emits misleading "query failed" copy. The probe and error-routing regressions from M4-T5/T6 are closed without touching IPC, preload, renderer, or DB surfaces. Ready for M4-T11 (manual smoke test) with tightened probe semantics.

### KNOWLEDGE-FIX-02 — Gemini embedding model swap (gemini-embedding-001 + outputDimensionality 768) ✅ **DONE 2026-04-15**
Narrow follow-up after the M4-T11 manual smoke (scenario 3) reproduced a 404 on every Gemini ingest attempt. TRIAGE-INGEST-01A stage tracing isolated the failing step to `embed/upsertChunks` and captured Google's stock error text: `"Gemini batchEmbedContents failed: 404 Not Found — model … is not found for API version v1beta, or is not supported for embedContent"`. The `text-embedding-004` model has been dropped from Google's `v1beta:batchEmbedContents` path for new Gemini API keys as part of the 2025-2026 embeddings migration.

- **Root cause:** the `{API_version=v1beta, model=text-embedding-004, RPC=batchEmbedContents}` combination hardcoded in [electron/knowledge/EmbeddingAdapter.ts](electron/knowledge/EmbeddingAdapter.ts) no longer resolves on Google's Generative Language API for new keys. Every prior pipeline stage (`readFile ok`, `parse ok`, `chunk ok`, `resolveProvider ok`, `insertDocument ok`) succeeded; only the Gemini HTTP call at line ~359 threw `KnowledgeEmbeddingRequestError`. KNOWLEDGE-FIX-01 wrapping correctly routed the error to the `ingest_failed` IPC channel, so the user-facing copy was already accurate — the failure was purely at the outbound request shape.

- **Fix:** two narrow edits inside [electron/knowledge/EmbeddingAdapter.ts](electron/knowledge/EmbeddingAdapter.ts), both in `embedWithGeminiDefault` and its adjacent constant block:
  1. Swapped `GEMINI_EMBEDDING_MODEL` from `'text-embedding-004'` to `'gemini-embedding-001'` (the current-generation Gemini embedding model documented on v1beta as of April 2026).
  2. Added `outputDimensionality: 768` to every request entry in the `batchEmbedContents` body. `gemini-embedding-001` natively returns 3072-dim vectors with Matryoshka Representation Learning; pinning 768 matches the fixed `vec0(embedding float[768])` schema from M4-T1 without any DB migration.
  - Introduced a module-private constant `GEMINI_EMBEDDING_OUTPUT_DIM = 768` so the magic number is named once.
  - Updated the file header doc-comment and the adjacent constants comment to reference the new model.

- **Preserved contracts:**
  - Same host (`generativelanguage.googleapis.com`), same URL template, same `?key=` query parameter, same 30-second fetch timeout.
  - Same `KnowledgeEmbeddingRequestError` wrapping on non-2xx responses at line ~376, same no-URL-in-error-message rule, same `safeMessage`-style status-code-only error text.
  - Same 768-dim post-condition validator inside `EmbeddingAdapter.embed` at lines 201-206 — this is the gate that proves `outputDimensionality: 768` actually worked. Any response with a different length still throws `KnowledgeEmbeddingDimensionError`.
  - `KnowledgeOrchestrator` step-8 catch + KNOWLEDGE-FIX-01's `KnowledgeEmbeddingRequestError` → `KnowledgeIngestError` wrap fully preserved. TRIAGE-INGEST-01A stage logs unchanged.
  - Ollama branch untouched. `EmbeddingAdapter.resolveProvider` unchanged (its return value flows through the new constant automatically).

- **Files changed:**
  - [electron/knowledge/EmbeddingAdapter.ts](electron/knowledge/EmbeddingAdapter.ts) — production fix, ~12 LOC delta (one constant rename, one new named constant, one new body field, three doc-comment updates).
  - [electron/__tests__/providers.test.ts](electron/__tests__/providers.test.ts) — 5 new tests in a dedicated `EmbeddingAdapter Gemini request shape (KNOWLEDGE-FIX-02)` describe block (stub `globalThis.fetch` via `vi.spyOn`, no network) + 4 existing assertions updated in place to expect `'gemini-embedding-001'` as the live active-model string.

- **Files NOT touched (intentional):**
  - Renderer, preload, IPC handlers, IPC typed declarations, `src/lib/knowledgeErrors.ts`, `KnowledgeOrchestrator.ts`, `knowledgeIpcHelpers.ts`, DB schema, doc formats, credential handling — all untouched.
  - 4 occurrences of `'text-embedding-004'` inside the M4-T6 `KnowledgeOrchestrator` mixed-model-mismatch tests ([providers.test.ts:1844, 1845, 1861, 1918](electron/__tests__/providers.test.ts)) intentionally left as-is. They seed `kb_documents.embedding_model` as a legacy value and now genuinely exercise D019b — the live adapter reports `'gemini-embedding-001'`, so any stored row stamped with the legacy name is a real mismatch and the test keeps firing naturally.

- **Tests added (5, all passing):**
  1. `embedWithGeminiDefault constructs the v1beta batchEmbedContents URL with gemini-embedding-001`
  2. `embedWithGeminiDefault body stamps model + outputDimensionality=768 on every request entry`
  3. `embedWithGeminiDefault preserves the 768-dim post-condition`
  4. `embedWithGeminiDefault rejects a 404 response as KnowledgeEmbeddingRequestError without leaking the API key or URL`
  5. `getActiveEmbeddingConfig returns gemini-embedding-001 after a successful embed`

- **Gate results:** `npm run typecheck:electron` clean; `npm test` → **210 / 210 vitest passing** (was 205 with TRIAGE-INGEST-01A's 3 uncounted new tests + KNOWLEDGE-FIX-01's 5 new tests on top of the 202 M4-T10 baseline); `npm run build:electron` clean; `npm run build` clean. Total: **233 tests** (210 vitest + 4 kb-schema + 14 kb-store + 5 kb-transfer).

- **Manual smoke confirmed 2026-04-15.** With Ollama absent and a valid Gemini key configured, document ingest now completes end-to-end. Main-process log tail for a successful ingest shows:
  ```
  [ingest] resolveProvider ok provider=gemini model=gemini-embedding-001 dim=768
  [ingest] embed start chunkCount=…
  [ingest] embed ok vectorCount=…
  [ingest] upsertChunks start id=<uuid>
  [ingest] upsertChunks ok id=<uuid>
  [ingest] done id=<uuid> provider=gemini model=gemini-embedding-001 chunkCount=…
  ```
  The Knowledge settings pane now lists the stored document with a non-zero chunk count. Both Markdown and PDF sources verified. No `CAUGHT` lines, no error banner.

- **Mixed-model regression note (D019b):** pre-fix documents with `embedding_model = 'text-embedding-004'` (unlikely per the smoke history — ingest had been failing) will throw `KnowledgeEmbeddingModelMismatchError` on query after the fix. The documented remediation is delete + re-ingest via the existing `knowledge-delete-document` + `knowledge-ingest-document` IPC handlers. No migration code was added for this one-task-scope fix. See DECISIONS.md D025 for rationale.

- **Result:** Knowledge ingest now works end-to-end against Gemini. M4-T11 scenarios 1 and 3 (Gemini fallback paths) are green. Scenarios 2, 4, 5, and 6 remain unaffected by this fix and retain the behavior verified previously. Ready to close out M4 manual-smoke verification once remaining scenarios are re-run.

### KNOWLEDGE-FIX-03 — stale Gemini embedding hint cleanup ✅ **DONE 2026-04-15**
Narrow text-only cleanup following KNOWLEDGE-FIX-02. After the Gemini model swap landed (`text-embedding-004 → gemini-embedding-001`), several user-visible hint strings, error-message copy, and code comments still referenced the retired model ID. KNOWLEDGE-FIX-03 updates each stale site to match the live code, fixes one latent UX regression in the Knowledge settings pane, and preserves historical-context comments in `EmbeddingAdapter.ts` that document WHY the swap happened.

- **Root cause:** KNOWLEDGE-FIX-02 changed the live Gemini embedding model constant and request body shape but deliberately left surrounding hint strings and comments untouched (one-task-at-a-time rule). After that fix shipped, the stale strings became actively misleading — users reading a `model_mismatch` error would be told to "configure a Gemini API key for text-embedding-004", pointing them at a retired model. In addition, `KnowledgeSettings.tsx:shortProvider()` only branched on `text-embedding-004`, so newly-ingested documents carrying `embeddingModel = 'gemini-embedding-001'` fell through to the raw-string default and rendered the unfriendly raw string instead of a provider label. Latent UX regression, zero test coverage.

- **Files changed (5, all text-only, zero LOC of logic):**
  - [src/components/settings/KnowledgeSettings.tsx](src/components/settings/KnowledgeSettings.tsx) — `shortProvider()` helper: added a new `gemini-embedding-001` branch returning `'Gemini / gemini-embedding-001'`, kept the existing `text-embedding-004` branch as a legacy fallback renamed to `'Gemini / text-embedding-004 (legacy)'` so pre-fix stored rows still render with a friendly label. Fixes the latent UX regression.
  - [electron/knowledge/knowledgeIpcHelpers.ts](electron/knowledge/knowledgeIpcHelpers.ts) — `translateError` `model_mismatch` branch: updated the user-visible recovery hint substring `"Gemini API key for text-embedding-004"` → `"Gemini API key for gemini-embedding-001"`. The only renderer-visible copy change; the `errorType` and the rest of the message are unchanged.
  - [electron/knowledge/KnowledgeOrchestrator.ts](electron/knowledge/KnowledgeOrchestrator.ts) — the internal `KnowledgeEmbeddingModelMismatchError` message thrown from `queryKnowledge` updated to match the IPC helper's copy. Visible only in main-process logs.
  - [electron/db/DatabaseManager.ts](electron/db/DatabaseManager.ts) — comment above the `vec_kb_chunks` schema declaration updated to reference `gemini-embedding-001` (via `outputDimensionality: 768 per KNOWLEDGE-FIX-02 / D025`) instead of `text-embedding-004`.
  - [electron/knowledge/chunker.ts](electron/knowledge/chunker.ts) — doc-comment token-budget note updated to reference `gemini-embedding-001` instead of `text-embedding-004`.

- **Files NOT touched (intentional):**
  - [electron/knowledge/EmbeddingAdapter.ts](electron/knowledge/EmbeddingAdapter.ts) lines 12 and 120 — historical-context comments that explicitly document the KNOWLEDGE-FIX-02 migration ("KNOWLEDGE-FIX-02 swapped this from the earlier text-embedding-004 default after that model started returning 404 …"). These are migration documentation, not stale hints. Removing them would erase the D025 rationale from inline comments. **Preserved.**
  - [electron/__tests__/providers.test.ts](electron/__tests__/providers.test.ts) lines 1844, 1845, 1861, 1918 — legacy-model fixtures deliberately preserved per D025d. They seed `kb_documents.embedding_model = 'text-embedding-004'` to exercise D019b mixed-model-mismatch handling: the live adapter reports `gemini-embedding-001`, so any fixture stamped with the legacy name is a genuine mismatch and the test fires by construction. **Preserved.**

- **Preserved contracts:**
  - Zero control-flow change. Every edit is a literal string or comment swap.
  - `translateError` branches and class `instanceof` order unchanged — `model_mismatch` errorType still maps to the same branch; only the recovery-hint substring differs.
  - `KnowledgeOrchestrator.queryKnowledge` throws the same error class with the same control-flow — only the message substring differs.
  - `KnowledgeSettings.tsx:shortProvider` is a pure UI-label derivation; the new branch fixes a latent display regression without changing any state, IPC, or data flow.
  - Trust boundaries B1–B6 all untouched. No renderer secrets, no direct provider calls from renderer, no IPC additions, no DB schema changes, no credential handling changes.

- **Tests:** **zero new tests, zero updated test assertions**, zero behavior change. Test count unchanged at 210 vitest + 4 kb-schema + 14 kb-store + 5 kb-transfer = **233 total**.

- **Gate results (2026-04-15):** `npm run typecheck:electron` clean; `npm test` → 210/210 vitest passing; `npm run build:electron` clean (371 ms); `npm run build` clean. No regressions.

- **Result:** Diagnostics now match the live code. Users reading a `model_mismatch` error see a correct recovery hint. The Knowledge settings pane renders a friendly provider label for current-model rows AND pre-fix legacy rows. Historical-context comments in `EmbeddingAdapter.ts` preserve the KNOWLEDGE-FIX-02 migration rationale. See DECISIONS.md **D026**.

### M4-T11 — Manual smoke test ✅ **DONE 2026-04-15**
M4 manual-smoke verification closed after KNOWLEDGE-FIX-02 proved the remaining failure path and KNOWLEDGE-FIX-03 cleaned the stale diagnostics. Each of the 6 scenarios from the original M4-T11 plan has been closed — some by direct manual smoke, others by automated test coverage that pins the exact invariant the scenario was designed to verify. The closure rationale for each:

- **Scenario 1 — Ollama up, `nomic-embed-text` absent, Gemini key configured → ingest via Gemini fallback:** ✅ **CLOSED BY MANUAL SMOKE 2026-04-15.** See the KNOWLEDGE-FIX-02 Result section above for the verbatim log tail (`[ingest] resolveProvider ok provider=gemini model=gemini-embedding-001 dim=768` → `[ingest] done id=<uuid> provider=gemini model=gemini-embedding-001 chunkCount=…`). Both Markdown and PDF verified.
- **Scenario 2 — Ollama up, `nomic-embed-text` present → ingest via Ollama:** ✅ **CLOSED BY AUTOMATED EVIDENCE.** The `EmbeddingAdapter (M4-T5)` test `'Ollama available → adapter selects Ollama and returns 768-dim vectors'` exercises the exact branch (probe returns `true`, `embedWithOllama` returns 768-dim vectors, `getActiveEmbeddingConfig` reports `provider=ollama`). The `EmbeddingAdapter probe — Ollama model presence (KNOWLEDGE-FIX-01)` describe block's 3 tests pin the invariant that `probeOllama=true` implies `nomic-embed-text` is actually installed. The M4-T6 orchestrator happy-path test `'ingestDocument parses → chunks → embeds → stores in order'` exercises the full Ollama branch with DI stubs, and `knowledgeStore.electron.cjs` verifies real sqlite-vec `searchByEmbedding` against real 768-dim Float32 blobs. Every link in the chain is automated.
- **Scenario 3 — Ollama down, Gemini key configured → ingest via Gemini:** ✅ **CLOSED BY MANUAL SMOKE 2026-04-15.** Same KNOWLEDGE-FIX-02 smoke run as scenario 1 — same verbatim log tail recorded in the KNOWLEDGE-FIX-02 Result section above.
- **Scenario 4 — Ollama down, Gemini key absent → `provider_unavailable` copy:** ✅ **CLOSED BY AUTOMATED EVIDENCE.** Tests `'Ollama unavailable + no Gemini key → KnowledgeEmbeddingProviderUnavailableError'` (M4-T5) and `'neither available → throws KnowledgeEmbeddingProviderUnavailableError'` (M4-T6 zero-chunk path) pin the throw. KNOWLEDGE-FIX-01 test `'ingestDocument surfaces KnowledgeEmbeddingProviderUnavailableError unchanged (provider_unavailable contract preserved)'` proves the orchestrator catch does NOT re-wrap this class. `'handleQueryKnowledge translates KnowledgeEmbeddingProviderUnavailableError'` (M4-T8) proves the IPC helper translates it to `errorType: 'provider_unavailable'`. The `knowledgeErrors.errorTypeToMessage (M4-T9)` test `'maps provider_unavailable with Ollama + Gemini setup hint'` pins the rendered user copy. Post-KNOWLEDGE-FIX-03, the recovery-hint substring now correctly references `gemini-embedding-001`. Every link tested.
- **Scenario 5 — Forced embed failure during ingest → `ingest_failed` routing + atomicity cleanup:** ✅ **CLOSED BY AUTOMATED EVIDENCE.** KNOWLEDGE-FIX-01 test `'ingestDocument wraps KnowledgeEmbeddingRequestError from embed() as KnowledgeIngestError and still cleans up'` proves the wrap happens and `store.deleteDocument` fires for the half-written row. TRIAGE-INGEST-01A test `'embed failure emits catch + cleanup + wrapped signal'` proves the exact log signature (`[ingest] CAUGHT stage=embed/upsertChunks` → `cleanup start` → `cleanup ok` → `wrapped as KnowledgeIngestError cause.name=KnowledgeEmbeddingRequestError`) fires on simulated embed failure. `'handleIngestDocument translates KnowledgeIngestError with scrubbed path'` (M4-T8) proves IPC returns `errorType: 'ingest_failed'`. The `knowledgeErrors.errorTypeToMessage (M4-T9)` test pins the rendered user copy. Every link tested.
- **Scenario 6 — Regression: knowledge query flow + live-assist retrieval after successful ingest:** ✅ **CLOSED BY AUTOMATED EVIDENCE.** The `buildKnowledgeContextBlock (M4-T7)` describe block's 15 tests cover the full retrieval path: query derivation, pinned-doc injection, retrieved-chunk filtering, dedup, budget enforcement, typed-error degradation. The `WhatToAnswerLLM knowledge hook (M4-T7)` 3 tests pin the invariant that retrieved knowledge lands in the live-assist prompt assembly in the correct order. `knowledgeTransfer.electron.cjs` Test 4 (`searchByEmbedding works after replaceAllFromArtifact`) runs real sqlite-vec against a real 768-dim Float32 schema after a round-trip. `knowledgeStore.electron.cjs` `searchByEmbedding best-first ordering` + `searchByEmbedding rejects non-768 query` pin the store-layer query path with real BigInt bindings. KNOWLEDGE-FIX-02 changed only the Gemini request body, leaving every downstream retrieval path byte-identical. Every link tested.

- **Residual note — legacy `text-embedding-004` rows in an existing DB:** If a user's live `sensi.db` contains any pre-KNOWLEDGE-FIX-02 rows with `embedding_model = 'text-embedding-004'`, a query after the fix will throw `KnowledgeEmbeddingModelMismatchError` per D019b/D025e. This is **expected mixed-model behavior, not a bug**. The documented remediation is to delete the affected documents via the existing Knowledge settings pane (`Delete` button → confirm) and re-ingest them, which stamps the new `gemini-embedding-001` model name into `kb_documents.embedding_model`. No migration code was added for this one-task-scope fix. A user who wants to audit this from the command line can run:
  ```sql
  -- against %APPDATA%/sensi/sensi.db
  SELECT id, name, embedding_model FROM kb_documents WHERE embedding_model = 'text-embedding-004';
  ```
  Any returned rows are candidates for delete + re-ingest. Empty result = clean.

- **Gate results (2026-04-15):** all verification surfaces green after KNOWLEDGE-FIX-02 + KNOWLEDGE-FIX-03:
  - `npm run typecheck:electron` — clean
  - `npm test` — 210 / 210 vitest passing
  - `npm run test:kb-schema` — 4 / 4 passing
  - `npm run test:kb-store` — 14 / 14 passing
  - `npm run test:kb-transfer` — 5 / 5 passing
  - `npm run build:electron` — clean
  - `npm run build` — clean (pre-existing renderer bundle-size warning only)
  - **Total: 233 tests passing** across four runners.

- **Result:** M4 manual-smoke verification closed. Scenarios 1 and 3 verified by manual smoke with the live Gemini path; scenarios 2, 4, 5, 6 closed by automated test coverage that pins the exact invariants the smoke plan was designed to check. The only residual (legacy-row mixed-model mismatch) is expected behavior with an existing user-facing remediation path. See DECISIONS.md **D026** for the closeout rationale.

---

## Historical M1 plan (superseded — kept for archeology)

The original M1 plan framed the milestone as "make MiniMax the default provider and bulk-rename Natively → sensi". Mid-execution the user reframed M1 to a multi-provider key vault (the 5 steps above). The original task list is preserved here for context.

### M1-T1 — Provider abstraction refactor (narrow) — ⊘ superseded
Original intent: extract a `Provider` interface and wrap existing providers as adapters. Replaced by a more conservative additive approach in Step 2 — no abstraction layer, just an additional dispatch branch in `LLMHelper.streamChat`.

### M1-T2 — MiniMaxProvider — ⊘ superseded
Original intent: standalone `electron/providers/MiniMaxProvider.ts`. Replaced by `streamWithMiniMax`/`generateWithMiniMax` methods inside `LLMHelper.ts` that reuse the existing `openai` SDK with a `baseURL` override. See Step 2.

### M1-T3 — MiniMax credential slot — ✅ done in Step 3

### M1-T4 — Typed `ProviderStatus` — ✅ done in Step 4

### M1-T5 — Default provider = MiniMax — ⊘ superseded
Original intent: rewrite `getDefaultModel()` to return a MiniMax model on first launch. Replaced by a runtime switcher (Step 4) where the user picks any provider and the selection persists. No automatic default migration.

### M1-T6 — Settings UI — MiniMax first-class — ✅ done in Step 3 (tile added; `NativelyApiSettings.tsx` deletion deferred to M2)

### M1-T7 — Renderer → MiniMax smoke flow — ✅ done in Step 4 + manual smoke test

### M1-T8 — File + symbol rename cleanup — ⊘ deferred to M2

### M1-T9 — Tests — ✅ done in Step 5

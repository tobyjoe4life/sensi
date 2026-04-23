# Decisions — sensi

Architecture decision records (ADRs). One entry per decision. Superseded decisions are kept in place with a `Superseded by` note.

---

## 2026-04-12 — D000 — Fork natively-cluely-ai-assistant as sensi base

**Decision:** Use a fork of `natively-cluely-ai-assistant` as the base for sensi.

**Why:** The fork is closer to the target product than any scratch-built alternative, especially for live-assistant behavior, dual-channel audio capture, multi-monitor screenshot stitching, and streaming STT integrations. Starting from a working Electron + React + Rust NAPI base avoids rebuilding native audio plumbing.

**Consequences:**
- The previous `meeting-copilot` scratch project becomes reference/archive
- A full fork audit is required before architectural changes (done 2026-04-12)
- Subscription/paywall logic must be removed or isolated
- Provider and trust-boundary docs must be re-established
- sensi is no longer `natively-cluely-ai-assistant`; treat upstream only as a technical starting point

---

## 2026-04-12 — D001 — sensi is a personal-use fork, not a product

**Decision:** sensi targets a single user (Toby) on a single machine. It is not a commercial product. No team features, no billing, no multi-tenancy, no public SaaS backend.

**Why:** Personal use lets us delete an entire class of concerns (licensing, subscription, quota, webhooks, telemetry, support) that dominated the upstream codebase. Simpler is safer and faster.

**Consequences:**
- All trial / license / donation / paywall code is deleted or stubbed
- Analytics and install-ping are deleted
- Auto-update is disabled by default
- No cloud backend for sensi itself
- Documentation can assume a single trusted user and single device

---

## 2026-04-12 — D002 — MiniMax is the default provider

**Decision:** MiniMax becomes the default LLM provider. Claude and Google Gemini are optional add-ons for later milestones. BYOK for all providers.

**Why:** MiniMax offers strong quality at favorable economics for personal use, has an OpenAI-compatible endpoint shape that slots into the existing adapter pattern cleanly, and supports text + vision + SSE streaming.

**Consequences:**
- `electron/providers/MiniMaxProvider.ts` is the first M1 deliverable (not a refactor of `LLMHelper.ts`)
- MiniMax credential slot added to `CredentialsManager` with safeStorage encryption
- Default-model migration on first launch rewrites existing Gemini defaults to MiniMax when the user has not explicitly chosen
- Settings UI puts the MiniMax tile first
- Existing Gemini / OpenAI / Claude / Groq / Ollama code paths are wrapped as adapters, not deleted

---

## 2026-04-12 — D003 — Paywall removed via LicenseManager stub, not by chasing call sites

**Decision:** Create a stub `electron/premium/electron/services/LicenseManager.ts` at the exact path the 10+ `require('../premium/...')` call sites in `ipcHandlers.ts` expect. The stub returns "premium unlocked" for every method.

**Why:** The `premium/` directory does not exist in the fork. Every require currently throws at runtime and is silently caught. Chasing 176 IPC handlers and feature gates across the codebase is high-risk and high-churn. A single 20-line stub file unlocks every gated feature with zero call-site edits and is trivially reversible.

**Consequences:**
- No churn in `ipcHandlers.ts` during M0
- `isProOrTrialActive()` returns `true` at every call site
- Trial/license-related IPC channels become no-ops that always succeed
- Full deletion of unused license/trial code is deferred to M2 or later; stubbing is sufficient for personal-use mode
- Documented in SECURITY.md as risk R1 mitigation

---

## 2026-04-12 — D004 — Google Analytics and install ping are deleted, not feature-flagged

**Decision:** `src/lib/analytics/analytics.service.ts`, GA4 script injection, CSP hostnames, and `InstallPingManager.ts` are deleted outright in M0, not feature-flagged off.

**Why:** Feature flags leave the attack surface in place; a future dependency update or copy-paste could re-enable telemetry silently. Deletion is unambiguous. For a personal-use fork, there is no scenario where re-enabling is desired.

**Consequences:**
- Grep-sweep `rg -i "gtag|googletagmanager|G-494RMJ2G6E|analytics\.service|InstallPing"` must return empty after M0-T3
- `index.html` CSP tightens `connect-src` to `'self'` in production
- PRIVACY.md statement "no telemetry" becomes truthful

---

## 2026-04-12 — D005 — Auto-updater disabled by default, pointed at a sensi channel only when enabled

**Decision:** `electron-updater` init is guarded behind `process.env.SENSI_ENABLE_UPDATER === 'true'` and off by default. `package.json` `build.publish` is removed or pointed at a sensi-owned placeholder.

**Why:** Leaving the upstream publish config (`evinjohnn/natively-cluely-ai-assistant`) means sensi could install an upstream Natively build over itself, reintroducing paywall + analytics + license code. Disabling by default is safer than trying to maintain compatibility with an upstream feed that may change at any time.

**Consequences:**
- sensi gets manually updated until it has its own release channel
- No background network call to GitHub releases on launch
- Updater code is kept in the bundle (not deleted) so it can be re-enabled later with one env var

---

## 2026-04-12 — D006 — Branding rename is deferred to M1, not bundled into M0

**Decision:** In M0, only `package.json` (`name`, `productName`, `appId`, permission strings) and a few runtime strings (tray, log file, `app.setName`) are renamed. Component files (`NativelyInterface.tsx` etc.), `electronAPI` method names (`setNativelyApiKey`), and the SQLite filename (`natively.db`) are renamed in M1-T8.

**Why:** Renaming React components and IPC methods has a large blast radius and produces huge diffs that make code review hard. M0's goal is "clean baseline" — the highest-value changes are the ones that prevent crashes and stop data leaks. Cosmetic renames are M1 cleanup work, done once, in a dedicated task, with a single grep-sweep to verify.

**Consequences:**
- M0 diff is small and reviewable
- "Natively" strings remain visible in M0 dev-mode source but not in runtime UI
- M1-T8 is a single coordinated rename commit with a grep-sweep gate
- `natively.db` → `sensi.db` includes a one-time copy-on-first-launch migration so existing sessions are preserved

---

## 2026-04-12 — D007 — Typed `ProviderStatus`, never bare booleans for provider readiness

**Decision:** Any IPC or function that reports provider readiness returns a typed `ProviderStatus = { provider, configured, validated, lastError?, lastValidatedAt? }`, never a bare `boolean`.

**Why:** The meeting-copilot session produced this refinement after bare-boolean provider status made debugging impossible (configured-but-invalid and not-configured looked identical). Carrying the pattern forward avoids re-learning the lesson.

**Consequences:**
- M1-T4 defines the type and refactors existing readiness IPCs
- Renderer can display accurate provider state (green/amber/red + last error)
- Debugging provider issues gets a free audit trail via `lastValidatedAt` and `lastError`

---

## 2026-04-12 — D008 — LicenseManager stub path correction: `<root>/premium/`, not `electron/premium/`

**Decision:** The LicenseManager stub file is placed at `<root>/premium/electron/services/LicenseManager.ts`, **not** at `electron/premium/electron/services/LicenseManager.ts` as the original M0-T2 task text specified.

**Why:** The plan text assumed the `require('../premium/electron/services/LicenseManager')` calls in `electron/ipcHandlers.ts` would resolve relative to `electron/`, producing a target of `electron/premium/electron/services/LicenseManager.ts`. This was wrong. The Electron build layout makes all relative requires resolve from **`dist-electron/`**, not `dist-electron/electron/`:
- `electron/tsconfig.json` declares `rootDir: ".."` (project root) and `outDir: "../dist-electron"` and explicitly `include`s `"../premium/electron/**/*.ts"`.
- `scripts/build-electron.js` uses `outbase: rootDir` and scans both `electron/` and `premium/electron/` for source files.
- Compiled output for `electron/ipcHandlers.ts` lands at `dist-electron/electron/ipcHandlers.js`. Its `require('../premium/electron/services/LicenseManager')` therefore resolves from `dist-electron/electron/` → `dist-electron/premium/electron/services/LicenseManager.js`.
- TypeScript must therefore compile a source file at `<root>/premium/electron/services/LicenseManager.ts` → `<root>/dist-electron/premium/electron/services/LicenseManager.js`.

**Consequences:**
- The stub was created at the correct path. Runtime requires resolve cleanly.
- `electron/premium/featureGate.ts` also probes `require('../../premium/electron/services/LicenseManager')` from `electron/premium/` — resolves to the **same** compiled target, so the one stub satisfies both call sites.
- The `electron/tsconfig.json` `include` directive (`"../premium/electron/**/*.ts"`) was already in place from the upstream codebase — the upstream was designed to allow a companion `premium/` directory, sensi just adds a stub.
- Future stubs for `premium/electron/knowledge/KnowledgeOrchestrator.ts`, `premium/electron/knowledge/types.ts`, `premium/electron/knowledge/NativelySearchProvider.ts`, and `premium/electron/knowledge/TavilySearchProvider.ts` (all also imported via `require()` in ipcHandlers.ts) would follow the same `<root>/premium/...` convention.

---

## 2026-04-13 — D009 — CredentialsManager trial surface: full removal, not soft-deprecation

**Decision:** The free-trial API surface was fully **removed** from `CredentialsManager.ts` (fields `trialToken`/`trialExpiresAt`/`trialStartedAt` and methods `getTrialToken`/`getTrialExpiresAt`/`getTrialStartedAt`/`setTrialToken`/`clearTrialToken`). The alternative — soft-deprecation by keeping the getters as no-op stubs — was rejected.

**Why:** M0-T5 required neutralizing every `api.natively.software` call and the grep sweep `rg "trialToken|trialExpiresAt|trialStartedAt|setTrialToken|clearTrialToken"` had to return zero hits in active source. Soft-deprecation would leave the methods visible in the public API and the grep would still match. Hard removal is:
- Unambiguous: no future caller can accidentally reach trial state
- Aligned with D001 (sensi is a personal-use fork, not a commercial product) — there is no scenario where trial state should come back
- Consistent with D004's "delete, don't feature-flag" rule for commercial-product leftovers

**Consequences:**
- Every downstream caller of those methods broke: 6 sites in `ipcHandlers.ts` (the stubbed trial IPC handlers + the NativelySearchProvider wiring at line 2787), 2 sites in `LLMHelper.ts` (the `__trial__` sentinel branches in `generateWithNatively`/`streamWithNatively` dead code), and 1 site in `NativelyProSTT.ts`.
- All of them were fixed with minimal "dead reference cleanup" edits (replace the call with `undefined`, or delete the whole branch that's unreachable behind the M0-T5 short-circuit). This slightly exceeded the literal "targeted endpoint short-circuit" scope in LLMHelper.ts but was necessary for the project to typecheck.
- The `trialToken?: string` optional field was also removed from the `getLocalTrial` return type in `electron/preload.ts` and `src/types/electron.d.ts` so the grep sweep would pass. Renderer callers already early-return on `!local?.hasToken` so the removal has no user-visible effect.
- `isProOrTrialActive()` in `ipcHandlers.ts` collapsed from a two-branch license+trial check into a single `return true;` (the license stub already returns `true` via D003, and the trial branch referenced removed methods).

---

## 2026-04-13 — D010 — `PERSONAL_USE` gate: compile-time `as const`, single source of truth

**Decision:** The M0-T6 trial/donation UI kill switch is a single compile-time constant `export const PERSONAL_USE = true as const;` in a new `src/lib/config.ts`. It is not an env var, not a runtime setting, not a feature flag the user can toggle.

**Why:** Three reasons.
1. **Single source of truth.** All gated renders import from one file, so when M1-T8 deletes the trial component files the grep for `PERSONAL_USE` finds every gate in one pass.
2. **Compile-time folding.** `true as const` gives TypeScript a literal `true` type. Minifiers fold `{!PERSONAL_USE && <X />}` to `{false && <X />}` → dead code in release builds. No runtime cost, no bundle cost for the gated components' dependency tree once tree-shaking runs in M1.
3. **Not a feature flag.** sensi is a personal-use fork (D001) — there is no scenario where trial UI should return. A runtime flag would leave the attack surface live and invite reintroduction via config injection or settings panel. Hard-coded is safer.

**Consequences:**
- The gate lives in `src/lib/config.ts` and is imported by `src/App.tsx` and `src/components/settings/NativelyApiSettings.tsx`. Both import paths use the same exported constant.
- `NativelyApiSettings.tsx` is **not** on the M0-T6 "do not touch" list (which names only `SettingsOverlay.tsx` and `AIProvidersSettings.tsx`), so gating its one `<FreeTrialModal>` render with `!PERSONAL_USE` was in scope. The surrounding card and its `startTrial`/`getTrialStatus` calls were left alone because they're not in the four-component gate list — the underlying IPC handlers already return personal-use no-ops from M0-T5.
- Six render sites total are gated: `SupportToaster`, `NativelyQuotaBanner`, `FreeTrialBanner`, `TrialPromoToaster`, `FreeTrialModal` (App.tsx), `FreeTrialModal` (NativelyApiSettings.tsx).
- M1-T8 deletion of the gated component files will remove both the components and the gates. At that point `PERSONAL_USE` should either be deleted (if no new gates are needed) or repurposed for future personal-use-vs-shareable toggles.

---

## 2026-04-13 — D011 — M1 complete; MiniMax `<think>` reasoning blocks stripped at the LLMHelper boundary

**Decision:** M1 (multi-provider key vault with per-session provider+model switching) is **complete** as of 2026-04-13. The manual smoke test passed end-to-end on Windows: MiniMax responds correctly in the overlay, switching providers at runtime works, the active pair persists across restarts, and the typed `ProviderStatus` IPC surface drives the grouped picker + header pill in lockstep.

The smoke test surfaced one rendering bug that was fixed in the same session: **MiniMax M2.7 emits raw `<think>...</think>` reasoning blocks before its actual answer, and these were leaking to the renderer overlay**. The fix strips reasoning tags at the `LLMHelper` boundary so the renderer never sees them.

**Why strip at LLMHelper, not in the renderer:**
- The renderer should only receive user-facing content. Filtering downstream means every consumer (overlay, launcher, future surfaces) needs to know about model-specific output formats, which is the wrong layer.
- LLMHelper already knows which provider is active and can apply provider-specific post-processing in a single place.
- The streaming path needs a stateful filter to handle tags spanning chunk boundaries (the opening `<think>` and closing `</think>` may arrive in different deltas). The renderer side has no natural state container for this; main-process is the right home.

**Why only MiniMax:**
- Gemini, Claude, OpenAI, Groq, and Ollama do not emit `<think>` blocks in their normal response shape. Applying the filter universally would risk corrupting legitimate text that contains the literal characters `<think>` (e.g., a code review prompt about an HTML fragment).
- The filter is gated to the `streamWithMiniMax` and `generateWithMiniMax` methods exclusively. Other provider streaming methods are byte-identical to before this change.

**Implementation shape:**
- **Stateless `stripThinkingTags(text: string): string`** — used by `generateWithMiniMax` (non-streaming, has the full string) and the unit test suite. Removes complete `<think>...</think>` blocks via a non-greedy regex. Unclosed tags are left as-is — the stateless helper cannot know if a closer is coming, so eager stripping would corrupt legitimate text.
- **Stateful filter inside `streamWithMiniMax`** — a small mode + buffer state machine local to each stream invocation. Mode is `'normal'` (data passes through, partial open-tag prefix held back at buffer tail) or `'inside'` (data dropped, partial close-tag prefix held back). On end-of-stream, the normal-mode buffer flushes (no more chunks can complete a tag); the inside-mode buffer is dropped (model never closed the block). Memory usage is O(1) — at most 7 characters held back in normal mode, 8 in inside mode.

**Why the stateful approach is necessary:**
A stateless `replace()` on each delta would let raw tags leak whenever a chunk boundary fell inside a tag. For example, with chunks `["abc<th", "ink>def</think>ghi"]`:
- Stateless: chunk 1 emits `"abc<th"`, chunk 2 emits `"ink>def</think>ghi"` → user sees the tag fragments.
- Stateful: chunk 1 holds `<th` in the buffer, emits `"abc"`. Chunk 2 combines to `<think>def</think>ghi`, finds the complete open tag, switches to inside mode, finds the complete close tag, switches back, emits `"ghi"`. User sees `"abcghi"`.

The longest-partial-suffix lookup is bounded by `min(buffer.length, tag.length - 1)`, so it adds zero asymptotic cost to streaming throughput.

**Consequences:**
- `LLMHelper.ts` gained one private method (`stripThinkingTags`) and ~85 lines of stateful filter machinery scoped inside `streamWithMiniMax`. Other providers' streaming methods are untouched.
- `generateWithMiniMax` returns `this.stripThinkingTags(raw)` instead of `raw`. One-line change.
- 4 new unit tests in `electron/__tests__/providers.test.ts` cover the stateless helper across all four cases the spec required (complete block, unclosed tag, no tags, block-then-content). Test count is now **35** (was 31 in M1 Step 5).
- The stateful filter is verified by inspection + the manual smoke test re-run that the user will perform after this cleanup. Future M2 cleanup may extract the filter to a standalone testable class if other providers start emitting structured reasoning blocks.
- Component file renames (`NativelyInterface.tsx` → `SensiInterface.tsx`, `natively.db` → `sensi.db` migration) remain deferred to M2 cleanup as originally planned in D006.

---

## 2026-04-14 — D012 — Rust native audio module is built locally, no CI

**Decision:** The `native-module/` Rust sources are built on the developer's Windows machine via `npm run build:native` (which invokes `npx napi build --platform --release` inside `native-module/`). There is no CI pipeline, no prebuild artifact, no cross-compilation matrix. The produced `native-module/index.win32-x64-msvc.node` is `.gitignore`d; developers rebuild once per machine.

**Why:**
- sensi is a personal-use fork (D001). A single machine → a single build.
- A CI prebuild matrix would cost time for one user. The cold Rust build is 3–8 min on Windows with a fresh toolchain and ~30s warm. Acceptable.
- NAPI-RS uses `node-api.h` directly and does not depend on Electron's prebuilt binary ABI, so the `.node` file is stable across Electron versions as long as the Node major matches. No `electron-rebuild` step is required for the native module (unlike `better-sqlite3` and `sharp`, which the existing `postinstall` handles separately).
- The Windows toolchain prerequisites are now documented in `ARCHITECTURE.md` under "Windows Rust Toolchain".

**Consequences:**
- Developers must install Rust stable (rustup) + MSVC Build Tools 2022 (Desktop development with C++ workload) + Windows 10/11 SDK before running `npm run build:native`.
- The `nativeModuleLoader.ts` fallback — returning `null` when the `.node` file is missing — is kept as a defensive no-op. `MicrophoneCapture` / `SystemAudioCapture` log the failure without crashing the app. Developers who skip the build step see a muted meeting (no transcripts, no audio input) instead of a crash.
- Future CI wiring is possible but out of scope for M3. When it happens, it will use GitHub Actions with `actions-rs/toolchain` + `napi-rs/actions/cargo-command`.
- Build failures on unsupported toolchain configurations (missing `cl.exe`, wrong SDK version) are the developer's responsibility to diagnose. Troubleshooting steps are listed in ARCHITECTURE.md.

---

## 2026-04-14 — D013 — Deepgram auto-promotion policy and active-provider summary routing

**Decision:** Two tightly-related M3 fixes share one ADR because they both implement the same principle — *sensi's provider routing must respect the user's active configuration without requiring redundant manual steps*.

**D013a — Deepgram STT auto-promotion:** When a user saves a non-empty Deepgram API key and `sttProvider === 'none'` (fresh install default), auto-promote to `sttProvider = 'deepgram'` and trigger `reconfigureSttProvider()` immediately. The auto-promote **only fires when the current provider is `'none'`** — never overrides an explicit user choice like `'google'` or `'openai'`. Implemented as a pure helper `maybeAutoPromoteDeepgram(cm, apiKey): boolean` at `electron/services/sttAutoPromote.ts`, extracted from the IPC handler so it can be unit-tested without pulling in `ipcMain.handle` side effects at module load time.

**D013b — `generateMeetingSummary` active-provider routing:** The existing `LLMHelper.generateMeetingSummary` hardcoded a Gemini fallback chain (Custom → Natively → Groq → Gemini Flash ×3 → Gemini Pro ×5) and never consulted `this.currentModelId`. M3-T3 inserts three new branches (MiniMax → OpenAI → Claude) between the existing Groq block and the existing Gemini Flash block. The order mirrors `streamChat()`'s dispatch chain at `electron/LLMHelper.ts:2267` exactly — MiniMax first (for ordering guard against future collisions with OpenAI model ID patterns), then OpenAI, then Claude. Each branch attempts a single call, logs on attempt, warns on failure, and falls through to the existing Gemini Flash/Pro chain.

**Why:**
- **No spec divergence.** `streamChat` is the reference implementation for provider routing. `generateMeetingSummary` is a second consumer of the same provider inventory and must behave identically. Mirroring the dispatch order prevents M1 MiniMax users from silently losing summaries, prevents Claude users from hitting Gemini-only code paths, and so on.
- **Additive, not rewriting.** The existing Custom / Natively / Groq / Gemini blocks are untouched. The 3 new branches are pure additions. Diff review is minimal; regression surface is zero for existing Gemini-only users.
- **Single attempt per new branch.** Unlike the 3/5-attempt Gemini retry loops, the new branches use single attempts. This matches `streamChat`, which also uses single attempts for MiniMax/OpenAI/Claude — the multi-attempt retry logic was Gemini-specific because of upstream's historical rate-limit flakiness. Falling through to Gemini Flash on any failure preserves the same safety net.
- **MiniMax text-only is fine for summaries.** The meeting summary context is concatenated transcript text with no image paths, so MiniMax's text-only limitation (M1 Step 2 / DECISIONS D011) does not affect this code path.
- **Auto-promote only from `'none'`** in D013a: an explicit user choice is sacred. Saving a Deepgram key while already on Google means the user is preparing for a future switch, not declaring an immediate intent. The M0-T5 auto-promote pattern for the natively key (now removed) is the architectural precedent.

**Consequences:**
- `electron/ipcHandlers.ts`'s `set-deepgram-api-key` handler gained ~15 LOC (helper call + reconfigure branch + `promoted` return field). The renderer can use the returned `promoted` boolean to show a "Deepgram activated" toast, but that renderer polish is out of scope for M3 and deferred.
- `electron/services/sttAutoPromote.ts` is a new file — 27 LOC, single exported pure function, importable from both `ipcHandlers.ts` and unit tests.
- `electron/LLMHelper.ts` gained ~55 LOC (3 new branches × ~18 lines each: try/catch, log-on-attempt, `withTimeout` wrap, warn-on-fail, `processResponse` return). `streamChat` dispatch chain untouched.
- 8 new unit tests in `electron/__tests__/providers.test.ts`: 3 for auto-promotion policy, 5 for summary routing. Test count is now **49** (was 41 at end of M2).
- Spec vs. actual naming: the M3-T3 spec used `isOpenAIModel` / `anthropicClient` / `generateWithOpenAI` — actual code has `isOpenAiModel` (lowercase "i") / `claudeClient` / `generateWithOpenai`. The real names are used in the implementation and tests.
- Spec vs. actual order: the M3-T3 spec's numbered list enumerated branches as MiniMax → Claude → OpenAI but also instructed "mirror streamChat exactly" (which is MiniMax → OpenAI → Claude). The hard constraint wins: implementation uses streamChat order.
- Future: if a fourth provider (e.g. a custom cURL chain) needs summary routing, add a fourth branch following the same pattern. If the dispatch chain grows beyond ~4 branches, consider extracting a shared dispatcher helper — deferred until the need arises.

---

## 2026-04-14 — D014 — M4-T1 knowledge schema: `kb_` prefix, `INTEGER PRIMARY KEY` alias, BigInt bindings, Electron-runtime test script

**Decision:** Four sub-decisions share one ADR because they were all forced by discoveries made during M4-T1 execution and are operationally linked.

**D014a — Table names are prefixed `kb_` instead of the spec's literal `documents`/`chunks`/`vec_chunks`.** The upstream schema already defines `chunks` (v1 migration, meeting-transcript chunking with `meeting_id` FK + `cleaned_text` + `embedding` BLOB) and per-dimension `vec_chunks_{768,1536,3072}` virtual tables (v8 migration, meeting embeddings). Using the spec's literal names would collide with live meeting-context storage. All M4 knowledge-base tables are prefixed `kb_`:
- `kb_documents` — scalar document metadata (id, name, mime, bytes, embedding_model, embedding_dim, pinned, pinned_at, ingested_at)
- `kb_chunks` — scalar chunk text (id, doc_id FK ON DELETE CASCADE, chunk_index, text)
- `vec_kb_chunks` — sqlite-vec vec0 virtual table, dimension hard-coded to 768

**D014b — The vec0 virtual table uses `chunk_id INTEGER PRIMARY KEY` as a rowid alias, not the spec's literal `rowid INTEGER`.** This is functionally equivalent to a raw rowid per sqlite-vec docs (`INTEGER PRIMARY KEY` aliases the rowid) and matches the idiomatic pattern from the existing v3/v4 meeting vec0 migrations at `DatabaseManager.ts:349-354`. It also avoids a better-sqlite3 binding type strictness issue diagnosed during the probe — sqlite-vec v0.1.7-alpha.2 behaves differently when writing to an implicit rowid column vs a named INTEGER PRIMARY KEY column.

**D014c — sqlite-vec v0.1.7-alpha.2 requires `BigInt` bindings for primary key integer values.** Plain JS `number` values passed to `.run(...)` are rejected with `"Only integers are allows for primary key values on vec_kb_chunks"` even though better-sqlite3 binds them via `sqlite3_bind_int64`. Diagnosed via a 6-case binding matrix: `plain int` FAIL, `BigInt(1)` PASS, `1n` PASS (after dedup), `SQL literal VALUES (1, ?)` PASS, `.safeIntegers(true).run(1, …)` FAIL, `.safeIntegers(true).run(2n, …)` PASS. All M4-T4 KnowledgeStore CRUD operations that write to `vec_kb_chunks.chunk_id` must use BigInt bindings. The binding convention is a cross-task contract and must be respected by the T4 code review.

**D014d — M4-T1 tests run under Electron's Node runtime via a standalone `.cjs` script, NOT under the vitest suite.** The root cause is an ABI lock: `postinstall` runs `electron-rebuild -w better-sqlite3 -f`, which compiles `better_sqlite3.node` against Electron 33's NODE_MODULE_VERSION 130 (from Electron's bundled Node 20). Vitest workers run under the dev machine's plain Node (v24.13.0, NODE_MODULE_VERSION 137). Constructing `new Database()` under the wrong ABI throws `ERR_DLOPEN_FAILED: NODE_MODULE_VERSION 130 ≠ 137`. The existing M1/M2/M3 vitest tests avoid this by only exercising pure functions (`migrateDbFilename`) that never instantiate a Database. M4-T1 needs a real Database + loaded sqlite-vec, so it runs via `cross-env ELECTRON_RUN_AS_NODE=1 electron electron/__tests__/knowledgeSchema.electron.cjs`, registered as the `npm run test:kb-schema` script.

**Why:**
- **D014a (kb_ prefix):** the renaming is unavoidable. The existing meeting-context schema is live and cannot be migrated away. Two adjacent concepts (meeting transcript chunks vs user document chunks) need two distinct stores. The `kb_` prefix is unambiguous, short, and sorts cleanly.
- **D014b (INTEGER PRIMARY KEY alias):** literal `rowid INTEGER` is not valid DDL in SQLite (rowid is an implicit column, cannot be redeclared). The `INTEGER PRIMARY KEY` form is the canonical rowid alias and is what the existing migration code uses — so this both fixes a latent spec issue and preserves codebase consistency.
- **D014c (BigInt bindings):** this is a downstream contract for all M4 CRUD code. Recording it in the ADR ensures M4-T4 doesn't silently regress to plain-int bindings and crash at runtime when Deepgram+MiniMax users start ingesting documents.
- **D014d (Electron-runtime test script):** rebuilding better-sqlite3 for plain Node temporarily would break the production app until re-rebuilt for Electron — a fragile sequence with high regression risk. Running the test under Electron's Node matches the production runtime exactly. The cost is one extra npm script and a `.cjs` file that vitest doesn't pick up (vitest only scans `*.test.ts`).

**Consequences:**
- `DatabaseManager.ts` gains ~70 LOC: the `createKnowledgeTables()` private method + one new call from `init()` immediately after `runMigrations()`. The user_version migration chain (v1–v10) is byte-identical. Reverting M4-T1 is a one-commit rollback.
- New file `electron/__tests__/knowledgeSchema.electron.cjs` (~220 LOC) — contains the 4 M4-T1 tests + a local copy of the schema SQL. The schema SQL is duplicated between the test file and `DatabaseManager.createKnowledgeTables()`; this is acceptable because the tests primarily verify sqlite-vec runtime behavior (dimension enforcement, distance ordering, idempotency) rather than schema correctness per se. A T4 integration test will eventually exercise the real method via `DatabaseManager.getInstance()`.
- `package.json` gains one script: `"test:kb-schema": "cross-env ELECTRON_RUN_AS_NODE=1 electron electron/__tests__/knowledgeSchema.electron.cjs"`. The existing 49 vitest tests remain the primary test gate.
- Test count: **49 vitest + 4 electron-runtime = 53** total. The vitest count is the one M2/M3 reports have tracked; the kb-schema count is reported separately because the runner is different.
- Future: when M4-T4 lands, its CRUD-integration tests may need the same Electron-runtime treatment. If more than ~3 such tests accumulate, consider a proper electron-mocha or vitest-electron integration to consolidate the runner. For now, one script per task is fine.
- Open question for M5+: if CI is ever wired (currently absent per TESTS.md "Resolved questions"), the kb-schema test will need an Electron install on the CI runner — this is non-trivial on headless Linux without xvfb. Noted as a future task, not a blocker for M4.

---

## 2026-04-14 — D015 — M4-T2 parsers: merge into providers.test.ts, not a dedicated file

**Decision:** The M4-T2 document parser tests (14 tests covering `extractTextFromPdf` / `extractTextFromDocx` / `extractTextFromMarkdown` / `extractTextFromPlain`) are appended to `electron/__tests__/providers.test.ts` as four new describe blocks, rather than landing in a dedicated `electron/__tests__/parsers.test.ts` file. The in-memory fixture builders (`buildMinimalPdf`, `buildMinimalDocx`) are inlined in the same file.

**Why:** the dedicated-file approach was attempted first and surfaced a reproducible vitest segfault. Diagnosis:
- vitest 1.6 defaults to alphabetical test file ordering. `parsers.test.ts` sorts before `providers.test.ts`.
- `parsers.test.ts` imports `pdf-parse` v2, which pulls in `pdfjs-dist`. Under Node (no DOM), pdfjs-dist spins up a "fake worker" that leaves residual timers/state after tests finish.
- When vitest transitions to the next file (`providers.test.ts`), that file imports `LLMHelper`, which imports `sharp` as a top-level side effect. `sharp`'s native binding initialization interacts badly with pdfjs-dist's residual fake-worker state, crashing the parent fork process with a segfault. `providers.test.ts` never runs.
- Running the files in the opposite explicit order (`vitest run providers.test.ts parsers.test.ts`) succeeds with 63/63 passing. This confirms the issue is file-transition-specific, not per-file.

The cleanest fix is to avoid the file transition entirely by keeping all tests in a single file — matching the existing M1/M2/M3 pattern where `providers.test.ts` has accumulated all unit tests for each milestone. The initial judgment to split was not required by any convention and reversing it cost nothing.

**Alternatives considered and rejected:**
1. **Rename to force sort order** (e.g. `zParsers.test.ts`) — ugly, not semantically meaningful, and would break again when a future milestone adds a file that sorts before it.
2. **Configure vitest `poolOptions.forks.singleFork: true`** — untested due to the merge landing first, but even if it works it masks the underlying incompatibility rather than avoiding it, and any future test file that pulls in pdf-parse would re-trigger the issue.
3. **Custom vitest `sequence.sequencer`** — ~30 LOC of boilerplate to force file order. Overkill for a two-file problem.
4. **Mock `pdf-parse` entirely** — loses the end-to-end verification the task explicitly requires (fixture-based tests, not mocks).
5. **Run parser tests via the Electron-runtime script harness from M4-T1** — fragments test infrastructure further; this task's spec explicitly says "Prefer plain vitest, not the Electron runtime script from M4-T1".

**Consequences:**
- `electron/__tests__/providers.test.ts` is now ~900 lines with 63 tests across 10 describe blocks spanning M1 / M2 / M3 / M4-T2. Growing-large but still the canonical location per codebase convention.
- `parsers.test.ts` was created and then deleted during the same session — no artifact remains.
- The two in-memory fixture builders (`buildMinimalPdf` — ~50 LOC, hand-rolled PDF with computed xref offsets; `buildMinimalDocx` — ~30 LOC, jszip-based) live as top-level helpers inside `providers.test.ts` alongside the existing `buildProviderStatus` helper.
- `jszip` usage is safe as a transitive dep: verified by `npm ls jszip` → `sensi@2.4.0 → mammoth@1.11.0 → jszip@3.10.1`. As long as `mammoth` remains a direct dep (required for DOCX parsing in production), `jszip` will be available to the test file.
- `pdf-parse` v2 uses a class-based API (`new PDFParse({ data, verbosity })` → `getText()` → `destroy()`), not the v1 default-function API. The M4-T2 parser helper and tests both use the v2 class API.
- Future consideration: if a future M4 task (e.g. M4-T6 orchestrator integration tests) needs to import LLMHelper AND call the PDF parser, it will inherit this same constraint. Keep all such tests in `providers.test.ts` or rediscover this segfault.

---

## 2026-04-14 — D016 — Cosmetic "Segmentation fault" from `npm`/`npx` shim wrappers is harmless

**Decision:** Accept the cosmetic "Segmentation fault" message emitted by the Windows Git Bash npm / npx shim wrappers after vitest exits. The exit code is reliably 0, all tests pass, and the segfault occurs after the Node process has already written its success result. No mitigation in source code.

**Why the segfault happens:**
- `/c/Program Files/nodejs/npm` and `/c/Program Files/nodejs/npx` are bash wrapper scripts (Git Bash installation on Windows). Line 65 is the exec call: `"$NODE_EXE" "$NPM_CLI_JS" "$@"`.
- After the exec'd Node process exits, the bash wrapper runs trivial cleanup (echoing, resetting traps). Something in the child's exit state — almost certainly residual `pdfjs-dist` fake-worker timers or native handles held by `sharp` / `better-sqlite3` — races with the bash wrapper's cleanup and causes a native-level segfault in the shell process, NOT in Node.
- The exit code from the child Node process is already captured (`0` in every observed run) and propagates correctly to the outer shell. CI runners that use `exit code` as the pass/fail signal (every standard CI runner) see success.

**Empirical confirmation (M4-T3 landing session):**
- `npm test` × 3 runs: runs 1 + 3 printed the segfault line; run 2 exited cleanly. ALL 3 runs reported 75/75 tests passing and `EXIT_CODE: 0`.
- `npx vitest run` × 3 runs: same pattern, same line number (`line 65`), same exit code 0.
- The message text is constant: `Segmentation fault      "$NODE_EXE" "$NPM_CLI_JS" "$@"` — a literal echo of the bash wrapper's exec line, not a Node stack trace.

**Why NOT to "fix" it:**
1. **Exit code is already correct.** Nothing CI-observable is wrong. A green CI badge would report green.
2. **Workarounds are fragile.** Options considered and rejected:
   - Switch from `npm test` / `npx vitest run` to calling `node_modules/.bin/vitest` directly — breaks Windows scripts elsewhere, inconsistent with the existing M0/M1/M2/M3 test-invocation pattern.
   - Add a global `afterAll` hook that calls `process.exit(0)` — papers over the real issue and can mask legitimate crashes.
   - Add `poolOptions.forks.singleFork: true` — untested, and M4-T2 showed that merging tests into one file already achieves what that flag would give us.
   - Downgrade / swap pdf-parse — loses the M4-T2 functionality entirely.
3. **The cause is environmental**, not in sensi's code. Linux/macOS CI runners (and Linux WSL on the user's dev machine) would not hit this — it's specific to Git Bash's bash wrapper on Windows.

**Consequences:**
- TASKS.md M4-T3 entry documents this explicitly so future readers don't chase a false-alarm bug.
- When CI is wired (future milestone), the CI runner must check Node exit code, not stdout text, to detect test failures. This is the default for every CI system.
- If the cosmetic message becomes a problem later (e.g. log aggregator flagging "segmentation fault" as an error pattern), we can redirect stderr to `/dev/null` in the package.json script or wrap the call in a trap. Deferred until needed.
- If future test authors see this message, they should re-run once (clean exit is possible — the race is non-deterministic) and confirm `echo $?` returns 0. If it returns non-zero, the failure is real and unrelated to D016.

---

## 2026-04-14 — D017 — M4-T4 KnowledgeStore: rowid linking, dist-electron test runner, three sub-decisions

**Decision:** Four sub-decisions share one ADR because they are all design choices internal to M4-T4's KnowledgeStore that future tasks (T5/T6/T7/T8) and future milestones must preserve.

**D017a — Chunk ↔ vec rowid linking via `kb_chunks.rowid`.** The M4-T1 schema declares `kb_chunks.id TEXT PRIMARY KEY` (UUIDs) and `vec_kb_chunks.chunk_id INTEGER PRIMARY KEY`. These need to join somehow. Two options were considered:
- (a) Store a separate `kb_chunks.vec_row_id INTEGER` column and join on that.
- (b) Use the implicit `kb_chunks.rowid` (always present on non-WITHOUT-ROWID tables) as the linkage; `vec_kb_chunks.chunk_id` receives the `lastInsertRowid` from each `kb_chunks` insert.

Option (b) chosen because it adds zero columns, zero migration work, and zero storage overhead. `INSERT INTO kb_chunks(...) ... lastInsertRowid` is the canonical better-sqlite3 path to get the rowid. On delete, we walk `SELECT rowid FROM kb_chunks WHERE doc_id = ?` to find the vec rows to clean up. The TEXT UUID `kb_chunks.id` is the public identifier used in logs and (future) IPC; the rowid is an internal implementation detail that never leaves the store. If a future milestone needs to expose vec-row IDs externally (e.g. for a debug panel), we can always add a `vec_row_id` column then, but for M4 the internal-only rowid is simpler and invisible.

**D017b — `searchByEmbedding` inlines `k = N` as a sanitized integer literal, not a `?` binding.** sqlite-vec v0.1.7-alpha.2 does not reliably support parameter binding on virtual-table query columns (`embedding MATCH ?` works fine for the vector argument, but `k = ?` is intermittently rejected). The M4-T1 probe test used a literal. KnowledgeStore follows the same convention: `topK` is floored and clamped to `[1, ∞)` in TypeScript, then string-interpolated into the prepared statement. This bypasses prepared-statement caching for `searchByEmbedding` (a fresh `prepare()` call per invocation), but for M4 traffic levels (dozens of queries per meeting at most) the prepare overhead is negligible vs. the vector distance computation itself. Downstream risk: the same sqlite-vec strictness that forces BigInt bindings for primary keys (D014c) may also force this inlining pattern for other query parameters in future vec tables. Document in the D014/D017 series if that happens.

**D017c — Tests run from compiled `dist-electron/` JS, chained behind `build:electron`.** KnowledgeStore is TypeScript. Electron's Node runtime (required for better-sqlite3 ABI 130) has no TS loader available — `tsx` and `esbuild-register` are not in node_modules, and installing them would trigger the heavy postinstall chain (`electron-rebuild -w better-sqlite3`) just for a dev dependency. The cleanest path: `npm run test:kb-store` chains `npm run build:electron` (esbuild-based, ~400ms cold) → writes compiled JS to `dist-electron/electron/knowledge/KnowledgeStore.js` → the `.cjs` test script requires from that path. This matches how the main process actually loads the module at runtime, so test imports exercise the same compilation output as production. Tradeoff: iteration requires a rebuild on every code change (`test:kb-store` handles this automatically), but the ~1s total test time is acceptable. Alternatives considered and rejected:
- Add `tsx` as devDep — would add ~15 MB to `node_modules` + postinstall side effects.
- Use `vitest-electron` — not maintained for vitest 1.6.
- Hand-roll an esbuild transform in the test script — pulls the complexity into the script file with no offsetting benefit.
- Inline the SQL in the test script like M4-T1's `knowledgeSchema.electron.cjs` — loses the ability to test the class contract (method signatures, error classes, transaction behavior).

**D017d — `deleteDocument` verifies cleanup explicitly via post-delete count checks.** sqlite-vec virtual tables are NOT part of the FK cascade graph — `kb_documents → kb_chunks` cascade wouldn't reach `vec_kb_chunks` even if foreign keys were enabled (which they're not in sensi's DatabaseManager). The M4-T1 schema spec explicitly warned "do not rely blindly on virtual-table cascade behavior". KnowledgeStore.deleteDocument wraps the three-step cleanup (walk rowids → delete vec rows → delete kb_chunks rows → delete kb_documents row) in a better-sqlite3 transaction, then issues two count queries (`kb_chunks.doc_id` and `kb_documents.id`) and throws `KnowledgeStoreInvariantError` if either returns non-zero. The invariant check is cheap (two SELECT COUNT queries on indexed columns) and catches any future regression where the rowid walk misses a row.

**Consequences:**
- `electron/knowledge/KnowledgeStore.ts` (~420 LOC) and `electron/db/DatabaseManager.ts` (~10 LOC — one import + one field + one accessor) are the only source changes. The existing migration chain, init flow, and all other DatabaseManager methods are byte-identical.
- `electron/__tests__/knowledgeStore.electron.cjs` is the third Electron-runtime test file (after M4-T1's `knowledgeSchema.electron.cjs`). Both run outside the vitest suite.
- `package.json` gains one npm script (`test:kb-store`) that chains `build:electron` first. Existing scripts unchanged.
- Test count: **75 vitest + 4 kb-schema + 14 kb-store = 93 total** (was 79 at end of M4-T3).
- When M4-T5 lands its embedding adapter, tests that need a real embedding round-trip will likely need the same `dist-electron/` treatment. Extending this pattern has zero new cost since the script + npm-chain template is now in place.
- Future: if M5+ CI is wired, the CI runner must install Electron AND run `build:electron` before running `test:kb-store`. Linux headless CI works (no GUI), but the Electron install is a ~100 MB download. Accept this for now — it's the price of matching production runtime.
- BigInt binding rule (D014c) is enforced centrally via the `toVecPk(value: number | bigint): bigint` helper at the top of KnowledgeStore.ts. Every insert/delete/read path against `vec_kb_chunks.chunk_id` goes through this one helper. If a future PR adds a new vec query without routing through `toVecPk()`, it will fail at runtime with the same `"Only integers are allows…"` error from D014c. Intentional — catches regressions loudly.

---

## 2026-04-14 — D018 — M4-T5 EmbeddingAdapter: provider policy, empty-string rejection, dependency-injection testing

**Decision:** Three sub-decisions share one ADR because they define the shape of the M4-T5 EmbeddingAdapter contract and test strategy.

**D018a — Provider policy: Ollama (nomic-embed-text) primary, Gemini (text-embedding-004) fallback, nothing else.** The spec explicitly forbade OpenAI text-embedding-3-small, dimension-reduction shims, projection layers, dual-table schemas, and mixed-dimension storage. Reasoning:
- **OpenAI text-embedding-3-small is 1536-dim.** Supporting it would require either (a) a per-dim vec0 table pattern like the existing meeting-context `vec_chunks_{768,1536,3072}` from M1 migrations, or (b) a runtime projection from 1536 → 768 which loses signal and conflates embedding spaces. Both are complex, failure-prone, and out of scope for M4.
- **nomic-embed-text (Ollama) is 768-dim** and matches the M4-T1 `vec0(embedding float[768])` schema exactly. It's local, free, privacy-respecting, and aligned with the project's "local-first where possible" constraint from CLAUDE.md.
- **text-embedding-004 (Gemini) is also 768-dim** and uses an existing provider credential already managed by `CredentialsManager.getGeminiApiKey()`. No new secret storage, no new trust boundary, no new egress host (Gemini's `generativelanguage.googleapis.com` is already in the outbound API set via LLMHelper chat paths).
- If neither is available, `embed()` throws `KnowledgeEmbeddingProviderUnavailableError`. The user must either start Ollama locally or configure a Gemini key. There is deliberately no silent downgrade to a worse provider.

**D018b — Empty-string inputs are rejected with `KnowledgeEmbeddingRequestError`, not silently filtered.** The spec asked for an explicit policy. Reasoning:
- M4-T3 `splitIntoChunks` contract #8 guarantees "never emits empty chunks". Any empty string reaching the embedder indicates a **contract violation upstream** — likely a bug in M4-T6 orchestration.
- Silent filtering would mask the bug: the adapter would return N-1 vectors for N inputs, which then fails at M4-T4's `upsertChunks` length check (or worse, silently inserts fewer chunks than expected if the caller doesn't validate).
- Loud rejection at the T5 boundary surfaces the problem with an exact error message pointing back at T3's contract guarantee. M4-T6 will catch this error if it ever fires and diagnose upstream.
- The adapter still **trims outer whitespace** on every input before forwarding — that's normalization, not filtering. Inputs like `"  hello  "` become `"hello"`. Inputs that are pure whitespace (`"   \t\n "`) trim to `""` and throw.
- M4-T6 orchestration must pass `splitIntoChunks()` output directly to `EmbeddingAdapter.embed()` without intermediate filtering. If future logic needs to pre-filter (e.g. skip very short chunks), do it in T6, not T5.

**D018c — Tests use dependency injection through the constructor, not `vi.mock`.** The adapter's constructor accepts an `EmbeddingAdapterDeps` object with four optional hooks (`probeOllama`, `embedWithOllama`, `embedWithGemini`, `getGeminiApiKey`). Production callers omit the bag entirely and get the module-level defaults that hit real endpoints. Tests pass stubs. Reasoning:
- **Deterministic and fast.** No network, no flakiness, no module-cache surprises. Each test constructs its own adapter with its own deps and asserts end-to-end behavior.
- **Simpler than `vi.mock('node:fetch', ...)`** — vitest module mocking has hoisting edge cases, and `fetch` is a global in Node 20 (not a module), making it awkward to stub cleanly. DI sidesteps the whole category.
- **Forward-compatible with M4-T6.** When M4-T6 composes the pipeline, it may want to inject a cached/pooled implementation (e.g. to batch across multiple ingests) without touching adapter internals. The `EmbeddingAdapterDeps` shape already supports this — the ctor just doesn't care where the hooks come from.
- **Doesn't hide the real network path.** The module-level defaults (`probeOllamaDefault`, `embedWithOllamaDefault`, `embedWithGeminiDefault`) are top-level functions in EmbeddingAdapter.ts, clearly visible and reviewable. They're tested indirectly via the manual smoke test (M4-T11) rather than unit tests, which is the same strategy M3-T1 uses for the Rust audio module.

**Why the probe is replicated inline rather than reused from `OllamaManager`:** `OllamaManager.checkIsRunning()` is private — its only public methods are `getInstance`, `init`, and `stop`. Making `checkIsRunning()` public just for T5 would couple the adapter to the OllamaManager lifecycle module, which is about process spawning, not probing. The 500ms `fetch('/api/tags')` pattern is ~6 LOC and reproduces exactly the same semantics without introducing a cross-module dependency. If we later need a shared probe helper (e.g. M5+ adds other Ollama-dependent features), we can extract it then. For M4-T5 the inline pattern is cleaner.

**Why no new Settings surface for embedding provider preference:** The spec left this at "only if truly needed". The default fallback order (Ollama → Gemini) covers every supported case: local-first when Ollama is up, cloud fallback when Ollama is down but a key is configured, typed error otherwise. A setting like "prefer Gemini even when Ollama is reachable" would add UX complexity and testing surface for a use case that nobody has requested. Deferred unless a real need surfaces.

**Consequences:**
- `electron/knowledge/EmbeddingAdapter.ts` (~260 LOC) is the only source file added. No changes to DatabaseManager, CredentialsManager, OllamaManager, or any other main-process module.
- 14 new tests appended to `providers.test.ts` under a new describe block. No new test files. Test count: **89 vitest + 4 kb-schema + 14 kb-store = 107 total** (was 93 at end of M4-T4).
- Two egress surfaces are touched by EmbeddingAdapter: (a) `http://127.0.0.1:11434` (Ollama, localhost only — NO new external egress) and (b) `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents` (Gemini — SAME host that LLMHelper already uses for chat, just a new URL path). **No new trust boundaries, no new credentials, no renderer exposure.** SECURITY.md was intentionally not updated — the security posture is unchanged.
- ARCHITECTURE.md was intentionally not updated — no new process topology, no new storage, no new IPC surface, no new module ownership boundary. The knowledge subsystem's layering (parsers → chunker → embedder → store) now has four modules in `electron/knowledge/`; updating the architecture doc mid-pipeline would be premature and would drift as T6/T7/T8 land.
- Future: M4-T6 orchestrator will instantiate exactly one EmbeddingAdapter per DatabaseManager lifetime and pass it to ingest + query paths. If query-time provider differs from ingest-time provider (e.g. user turns off Ollama between ingest and search), the orchestrator or context builder must detect it via `kb_documents.embedding_model` and surface a clear error — cosine distance across embedding spaces is meaningless. Tracked as part of the T6/T7 spec, not a T5 concern.
- If M5+ adds OpenAI or another non-768 provider, the path is: (a) migrate the M4-T1 vec0 schema to per-dim tables (hard), (b) add a second vec_kb_chunks_1536 virtual table + dual routing, (c) add a dimension-reduction shim (degraded retrieval quality). All three are out of scope for M4. D018a is the contract that keeps T5 narrow.

---

## 2026-04-14 — D019 — M4-T6 KnowledgeOrchestrator: resolveProvider extension, mixed-model filter-vs-throw policy, extension-based MIME

**Decision:** Three sub-decisions share one ADR because they define the contract shape of the M4-T6 orchestrator and the small extension it makes to M4-T5 EmbeddingAdapter.

**D019a — `EmbeddingAdapter.resolveProvider()` is a new pure-probe method added in M4-T6.** The M4-T6 orchestrator needs to stamp `kb_documents.embedding_model` at `insertDocument` time, which happens BEFORE any chunks exist (and for zero-chunk documents, BEFORE any call to `adapter.embed()`). M4-T5's `getActiveEmbeddingConfig()` throws if called before the first successful `embed()`, so the orchestrator would have no way to get the model name for empty documents without calling `embed(['probe'])` with a throwaway string — which burns a Gemini quota unit per empty ingest. Empty / scanned-no-OCR PDFs and empty MD/TXT files are not rare, so burning quota on them is unacceptable.

`resolveProvider()` runs the same Ollama-probe → Gemini-key selection as `embed()` but:
- Does NOT call any embed hook (no network roundtrip to the embedding endpoint)
- Does NOT mutate `this.active` (so `getActiveEmbeddingConfig()` still throws until a real embed happens)
- Throws `KnowledgeEmbeddingProviderUnavailableError` with the same semantics as `embed()` on the neither-available path

This is an additive extension of the T5 contract, not a rewrite. Existing callers of `embed()` and `getActiveEmbeddingConfig()` are byte-identical. The addition is bounded to ~25 LOC in EmbeddingAdapter.ts plus 3 unit tests.

**Alternative rejected:** "Require the orchestrator to resolve by calling `embed(['probe'])` on a dummy string". Pros: no T5 changes. Cons: (a) burns a Gemini quota unit per empty ingest, (b) the adapter's empty-string-rejection policy (D018b) rejects `''` as input, so the probe string would have to be a real non-empty token, (c) the `active` state would be set prematurely for a non-real embed, violating the invariant that `active` reflects the "last successful embed call".

**D019b — Model-compatibility policy at query time: filter when some match, throw when all are wrong.** The task left the policy open: "filter them out before search, OR throw a typed error. Pick one policy, keep it narrow, document it, and test it." The orchestrator does BOTH depending on the situation:
- **All stored docs wrong model** (mixed-model DB doesn't have a single compatible doc) → throw `KnowledgeEmbeddingModelMismatchError` with a message listing stored models vs active model
- **Some stored docs compatible, some not** (partial compatibility) → silently filter incompatible docs from search results

**Why this split:**
- The "some compatible" case is the **expected operating mode** when a user switches providers mid-project. They ingest 5 docs with Ollama, then turn Ollama off and configure Gemini, then ingest 3 more docs. At query time (with Gemini active), searching should return results from the 3 Gemini-indexed docs, not throw. Silently filtering the 5 Ollama-indexed docs gives the user what they expect: "I get results from the docs I indexed with my current provider."
- The "all wrong" case is **almost always a broken state.** User ingests 5 docs with Ollama, then Ollama goes offline and they have no Gemini fallback configured. At query time, `resolveProvider` fails (both providers unavailable) — that's the provider-unavailable path, not the mismatch path. The mismatch path fires when Gemini fallback IS configured but all docs are Ollama-indexed: query embeds with Gemini, then finds zero matching docs. If we silently returned `[]` here, the user would assume the knowledge base is broken or their query is bad. An explicit error tells them exactly what to fix: "restart Ollama" or "re-ingest these docs".
- **The split respects user intent.** Silent filter is correct when the user has CHOSEN to use multiple providers (mixed DB). Explicit throw is correct when the user has ACCIDENTALLY broken the single-provider state (all docs locked out).

**Overfetch strategy:** When the candidate set is a strict subset of all docs (either from model-filter or documentIds-filter), the orchestrator calls `searchByEmbedding(queryVec, topK * 4)` and post-filters in TypeScript, slicing to topK. The `* 4` factor is calibrated for M4 scale (<100 docs, <1000 chunks): worst case, only 25% of stored chunks are compatible and we recover exactly topK results. For larger KBs this might need tuning, but M4-T11 smoke test will verify the M4 scale is well under the threshold. The alternative — adding a `documentIds?: string[]` parameter to `KnowledgeStore.searchByEmbedding` — was rejected to respect the M4-T6 constraint "Do not touch KnowledgeStore except if a tiny type import is needed".

**D019c — MIME detection is extension-based only in M4.** `resolveMimeFromPath(filePath)` switches on `.pdf`, `.docx`, `.md`/`.mdown`/`.markdown`, `.txt`. Unknown extensions throw `KnowledgeIngestError`. No magic-byte sniffing, no content-type heuristics, no fallback to `application/octet-stream`.

**Why extension-only:**
- **Personal-use fork.** The user knowingly uploads their own documents. They are not an adversary trying to sneak a `.txt` file past a PDF parser. Extension-matching is authoritative.
- **Explicit is better than automagic.** If a user renames `foo.pdf` to `foo.bak`, the orchestrator refuses to ingest it. This is the correct behavior — the user should rename back to `.pdf` or pick one of the supported extensions. Silent magic-byte sniffing would work for some files and fail for others in a way that's hard to debug.
- **T2 parsers are format-specific.** `extractTextFromPdf` expects a PDF buffer, `extractTextFromDocx` expects a DOCX zip, etc. Passing the wrong buffer to the wrong parser produces opaque errors from pdf-parse or mammoth. Explicit MIME dispatch at the orchestrator layer gives clean, predictable errors.
- **Magic-byte sniffing adds ~100 LOC + `file-type` dev dep for marginal UX benefit.** Deferred until a real user complaint motivates it.

**Consequences:**
- `electron/knowledge/EmbeddingAdapter.ts` gained ~25 LOC (resolveProvider method) + 3 unit tests. Zero changes to existing methods or exports.
- `electron/knowledge/KnowledgeOrchestrator.ts` is ~430 LOC: one class, 3 typed errors, 2 structural DI interfaces, 2 public types, 2 module-private helpers. Zero changes to parsers, chunker, KnowledgeStore, EmbeddingAdapter public surfaces.
- 21 new tests appended to `providers.test.ts`. Test count: **110 vitest + 4 kb-schema + 14 kb-store = 128 total**.
- No changes to DatabaseManager. Production instantiation path for KnowledgeOrchestrator will land with M4-T8 IPC handlers — the orchestrator's lazy accessor can follow the T4 `getKnowledgeStore()` pattern at that point.
- No new egress surfaces. No new credentials. No new trust boundary. File reads via `fs.promises.readFile` in main are standard pattern (ScreenshotHelper + DatabaseManager + CredentialsManager all do the same). SECURITY.md intentionally not updated.
- **Architecture impact:** M4-T6 lands the public API layer for the knowledge subsystem. ARCHITECTURE.md updated to list the five knowledge modules (`parsers`, `chunker`, `KnowledgeStore`, `EmbeddingAdapter`, `KnowledgeOrchestrator`) under a new "Knowledge subsystem (M4)" section — this is the first M4 update to the architecture doc and covers all pieces added so far, not just T6.
- Future: M4-T7's `TemporalContextBuilder` hook will use `orchestrator.queryKnowledge({ includePinned: true })` for retrieval during rolling context assembly, plus `orchestrator.listPinned()` + `orchestrator.getDocumentText()` for always-inject pinned-doc prompt assembly. M4-T8's IPC handlers will expose the 8 orchestrator public methods 1:1 (no new methods, no extracted sub-surfaces). M4-T9 renderer pane will call those 8 IPC channels.

---

## 2026-04-14 — D020 — M4-T7 Knowledge-block injection: format, budget, degradation, dedup, query rule, insertion point

**Decision:** Six sub-decisions share one ADR because they define the complete behavior contract of the M4-T7 knowledge-context hook — how the block looks, how big it can be, what happens when retrieval fails, how pinned and retrieved content relate, where the query comes from, and where in the existing live-assist path the hook fires.

**D020a — Knowledge block format:**
```
[Pinned Knowledge]
## Document 1: resume.pdf
<pinned text, truncated at 2000 chars per doc, total cap 6000 chars>

## Document 2: jd.md
<...>

[Retrieved Knowledge]
## resume.pdf — chunk 3 (distance 0.142)
<chunk text, truncated at 600 chars per chunk, total cap 2400 chars>

## coding-guide.md — chunk 7 (distance 0.287)
<...>
```

The two delimiters (`[Pinned Knowledge]` and `[Retrieved Knowledge]`) are flat text markers — not XML tags like the existing `<previous_responses_to_avoid_repeating>` / `<tone_guidance>` sections. The format was chosen because:
- **Deterministic:** same input → same output, no variable ordering or timestamps inside the block.
- **Parseable by LLMs:** all five M4 providers (MiniMax, Gemini, Claude, OpenAI, Groq) handle markdown-style `##` headings natively in context. XML tags would work too but add noise for short-form content.
- **Compact:** heading + blank line + body, no redundant wrappers. Keeps the token count lean.
- **Provenance-rich for retrieval:** each retrieved chunk carries `documentName`, `chunkIndex`, and `distance` so the LLM knows where the content came from.
- **Truncation is explicit:** a ` […truncated]` marker is appended when the budget forces a cut, so the LLM can tell whether it's seeing a full document or a slice.

Pinned entries use `## Document N: filename` with sequential numbering (1-based, renumbered to skip empty/failed docs). Retrieved entries use `## filename — chunk N (distance D.DDD)` — different header shape on purpose so the LLM can visually distinguish "this is a user-curated reference" from "this is a retrieval hit".

**D020b — Size budget and truncation rules:**

| Setting | Default | Rationale |
|---|---|---|
| `topK` | 4 | Small fixed value — retrieval is for "nudging" context, not replacing it. M4-T11 smoke test will validate. |
| `queryMaxChars` | 500 | Embedder sees ~125 tokens of query. Last-N chars of the cleaned transcript is tight enough to focus on the current exchange, loose enough to catch a multi-turn question. |
| `pinnedMaxCharsPerDoc` | 2000 | ~500 tokens per pinned doc. A resume or JD fits comfortably at this budget. |
| `pinnedMaxTotalChars` | 6000 | ~1500 tokens total pinned. At most 3 full-doc pinned entries at the per-doc cap. |
| `retrievedMaxCharsPerChunk` | 600 | ~150 tokens per chunk. M4-T3 `splitIntoChunks` default is 1500 chars, so retrieved chunks may be truncated — that's acceptable for a retrieval preview. |
| `retrievedMaxTotalChars` | 2400 | ~600 tokens total retrieved. 4 chunks at the per-chunk cap. |

Total knowledge budget: ~2100 tokens (pinned 1500 + retrieved 600). Fits comfortably in the 128k+ context windows of all M4 providers. Leaves plenty of headroom for transcript + intent context + prompt template.

**Truncation logic:**
- Truncate every entry to its per-entry cap first (`pinnedMaxCharsPerDoc` or `retrievedMaxCharsPerChunk`).
- Then apply the total budget: if the remaining budget can accommodate the entry, add it; if the total budget would force a further cut AND the remaining budget is too small to hold meaningful content (< 50 chars for pinned, < 30 for retrieved), stop adding entries.
- Naturally-short entries (a short pinned doc, a short retrieved chunk) are NEVER skipped — the minimum-size guard fires only when budget truncation produced a degenerate fragment.
- Ellipsis marker ` […truncated]` is appended whenever any truncation happened; the marker counts against the budget.

**D020c — Degradation policy per typed error:**

| Error | Pinned block | Retrieved block | Live-assist flow |
|---|---|---|---|
| `KnowledgeEmbeddingModelMismatchError` (from `queryKnowledge`) | still rendered | empty, warn logged | continues normally |
| `KnowledgeEmbeddingProviderUnavailableError` (from `queryKnowledge`) | still rendered | empty, warn logged | continues normally |
| Any other `queryKnowledge` throw | still rendered | empty, warn logged | continues normally |
| `listPinned` throws | empty, warn logged | still attempted with empty pinnedIds | continues normally |
| `getDocumentText` throws on one pinned doc | that doc skipped + warn logged | unaffected | continues normally |
| Empty pinned-doc text (zero chunks or whitespace-only) | that doc skipped silently | unaffected | continues normally |
| `WhatToAnswerLLM.knowledgeContextFn` throws (defect-level bug) | entire block absent | entire block absent | continues normally, warn logged |

**Why graceful degradation everywhere:** the knowledge block is a **quality enhancement**, not a correctness requirement. A live-assist response without knowledge context is still useful — the LLM gets the transcript and previous responses, same as M3. A live-assist response that crashes because the knowledge base is unavailable is strictly worse. Every error path is engineered to fall back to "no knowledge context, continue normally" with a log line for diagnosis. The log uses a `[Knowledge]` or `[WhatToAnswerLLM]` prefix and **never includes raw API keys or stack traces** — just error name + message.

`KnowledgeEmbeddingModelMismatchError` deserves special mention: it IS a user-actionable condition (user needs to start Ollama or configure Gemini) but surfacing it mid-stream would be jarring. Instead, the helper logs it silently and continues without retrieval. A future "Knowledge health" indicator (M5+) could read CredentialsManager state and warn proactively in the Settings UI, but that's out of scope for M4.

**D020d — Dedup rule (no double-injection of pinned content):**

Retrieved chunks whose `documentId` is in the pinned set are filtered out of the retrieved block. Implementation:

```typescript
const pinnedIds = new Set(orchestrator.listPinned().map(d => d.id));
const hits = await orchestrator.queryKnowledge({ query, topK, includePinned: false });
const filtered = hits.filter(h => !pinnedIds.has(h.documentId));
```

`queryKnowledge` is called with `includePinned: false` on purpose:
- The orchestrator's `includePinned: true` mode would sort pinned docs ahead of non-pinned in the result set. If we then filter pinned docs out post-hoc, we'd waste topK slots on entries we're about to throw away.
- Setting `includePinned: false` lets retrieval return its natural distance-ordered result, maximizing the chance of getting topK useful non-pinned chunks.
- The pinned block above already provides full-text access to all pinned docs — double-inject would also waste the token budget on text the LLM already sees.

**D020e — Query derivation rule:**

```typescript
const queryTail = rawQuery.length > queryMaxChars
    ? rawQuery.slice(-queryMaxChars)
    : rawQuery;
const query = queryTail.trim();
if (query.length === 0) /* skip retrieval */
```

Take the **last N characters** of the input query, then trim. Rationale:
- Live-assist's `cleanedTranscript` is formatted as `[INTERVIEWER]: …\n[ME]: …\n[ASSISTANT]: …` across multiple minutes of conversation. The most recent exchange is the most relevant for retrieval.
- Taking the first N chars would bias toward older conversation that's no longer under discussion.
- Last-N is simple, deterministic, and matches the M1 stateful streaming filter pattern (which also works at the tail).
- Empty/whitespace-only result (e.g. transcript is literally empty) → skip retrieval silently. The pinned block still renders if pinned docs exist.

This may chop mid-line or mid-speaker-turn. That's fine: the embedder (nomic-embed-text or text-embedding-004) doesn't care about line boundaries — it produces a single fixed-length vector for whatever text it sees. Line-alignment is a cosmetic concern, not a retrieval-quality concern.

**D020f — Insertion point: `WhatToAnswerLLM.generateStream`, not `TemporalContextBuilder`.**

Investigation during M4-T7 implementation confirmed:
- `TemporalContextBuilder.ts` is a pair of pure functions (`buildTemporalContext` + `formatTemporalContextForPrompt`). No class, no DI seam, no access to an orchestrator.
- `WhatToAnswerLLM.ts` is the sole caller of `TemporalContextBuilder` in the live-assist path (verified via grep across `electron/`).
- `WhatToAnswerLLM.generateStream` is where the final `fullMessage` is assembled from `contextParts[]` and passed to `llmHelper.streamChat`. This is the actual narrowest insertion point for the knowledge block.
- Modifying `TemporalContextBuilder` to take a knowledge orchestrator would change its signature and ripple into every caller that formats temporal context. Leaving TCB pure and adding a minimal hook to its immediate caller is narrower.

**The hook is a lambda `(query: string) => Promise<string>`**, not a full orchestrator. Production callers wrap the orchestrator via `new WhatToAnswerLLM(helper, (q) => buildKnowledgeContextBlock({ orchestrator, query: q }))`. This keeps `WhatToAnswerLLM` decoupled from the `electron/knowledge/` module (no new imports, no transitive pdfjs-dist pull) and makes the hook trivially mockable in tests. The lambda signature is also reusable for future LLM classes (AnswerLLM, AssistLLM) that might want knowledge context in M5+.

**The block is injected BEFORE the intent/temporal/transcript sections** in the final `contextParts` array. The assembled `fullMessage` order is:
1. Knowledge block (pinned + retrieved)
2. Intent + answer shape (from `intentResult`)
3. Previous responses (from `temporalContext`)
4. `CONVERSATION:\n<cleanedTranscript>`

This ordering puts "what the user has pre-loaded into the knowledge base" at the top of the system background, then "what the user's intent is right now", then "what has been said recently". The LLM reads background → intent → recent turns → current question — the natural order for a well-informed response.

**Consequences:**
- `electron/knowledge/buildKnowledgeContext.ts` (~270 LOC, new) is the only place knowledge-block formatting logic lives. Every future consumer (T8 IPC, T11 smoke, M5+ renderer previews) should call this function rather than reimplement.
- `electron/llm/WhatToAnswerLLM.ts` gained ~25 LOC: one new optional constructor parameter, one field, one guarded invocation. No changes to existing stream path logic.
- `electron/llm/TemporalContextBuilder.ts` is **byte-identical** to pre-M4-T7. TCB is still a pair of pure functions with no knowledge-module coupling.
- 18 new tests in `providers.test.ts` (15 helper + 3 integration). Test count: **128 vitest + 4 kb-schema + 14 kb-store = 146 total**.
- SECURITY.md intentionally not updated: knowledge content was already in main process (kb_chunks rows, written by M4-T6 `upsertChunks`), and prompt assembly was already in main process (B4 boundary). The helper produces a string that flows through the existing `LLMHelper.streamChat` path — same egress surface as any other prompt. Renderer still sees only the streamed LLM output, never the prompt. No new trust boundary, no new egress, no new credential handling.
- ARCHITECTURE.md updated with one-line entry for `buildKnowledgeContext.ts` under the Knowledge subsystem section.
- Future: M4-T8 IPC handlers will instantiate the orchestrator (via a new `DatabaseManager.getKnowledgeOrchestrator()` accessor) and wire the closure into the live-assist LLM classes that need knowledge context. Only `WhatToAnswerLLM` has the hook in M4-T7 — other LLMs can gain it in a future task if the smoke test shows it's useful. For now, scope is kept narrow.

## 2026-04-14 — D021 — M4-T8 Knowledge IPC: result shape, preview bounds, error translation, narrowing constraint, wiring factory

**Context:** M4-T8 exposes the knowledge subsystem to the renderer through 8 IPC channels and wires `WhatToAnswerLLM`'s knowledge hook into production via `IntelligenceEngine`. Four decisions needed to be locked in before the renderer pane (M4-T9) can consume the surface safely.

**D021a — Result shape: `{ success: true, ...data } | { success: false, error: string, errorType: KnowledgeIpcErrorType }`.**

Mirrors the existing convention in `ipcHandlers.ts` (see `set-deepgram-api-key` → `{ success: true }`, `save-screenshot-to-tempdir` → `{ success: true, path }`, etc.). Each handler has its own explicit discriminated union (not a generic `KnowledgeIpcResult<T>` helper) because TypeScript narrows plain object-literal unions more reliably than unions built from `{success: true} & T` intersections.

The `errorType` field is a string literal union with 8 values: `invalid_input | ingest_failed | query_failed | model_mismatch | provider_unavailable | not_found | dimension_mismatch | internal`. Renderer UI switches on this to render tailored error messages without parsing the free-form `error` string. Matches the 6 typed error classes from the knowledge subsystem 1:1 plus two catch-alls (`invalid_input` for validator rejections, `internal` for unexpected exceptions).

**D021b — Preview handler bounds: 4000 default / 12000 hard max, NEVER unbounded.**

`handleGetDocumentPreview` is the ONLY way the renderer can read document text. The hard max of 12000 chars (~2000-3000 tokens) is the safety rail: no caller input can exceed it, even if the caller passes `Infinity`. The default of 4000 (~800 tokens) is what the M4-T9 preview pane uses. Non-number / negative / NaN `maxChars` inputs are silently coerced to the default (not rejected) because preview is a best-effort UX surface, not a security-critical channel — the hard max is the actual safety rail.

Rationale: if we let the renderer request "the full text" of a 1 MB PDF, one bad click can pull megabytes across the IPC boundary and blow up the renderer heap. A hard cap prevents that and makes the IPC channel cheap to call. Full-text retrieval is explicitly NOT supported on this surface — future features that need it must add a distinct IPC channel with its own rate limiting.

**D021c — Error translation: scrub absolute paths to `<path>` marker, cap message length at 200 chars, strip embedded `\n`.**

`translateError` is the single exit point for all handler exceptions. It runs `scrubPath` which replaces absolute Windows paths (`C:\secret\file.pdf`) and POSIX paths (`/Users/toby/docs/x.pdf`) with the `<path>` marker before the user-facing `error` string is produced. This prevents the renderer from seeing local filesystem layout (trust-boundary concern B3 in SECURITY.md) and keeps error messages predictable.

For typed errors (`KnowledgeIngestError`, `KnowledgeNotFoundError`, etc.), the `error` string is a fixed English sentence describing the class — not a raw `.message` passthrough — plus a short hint about recovery ("Start Ollama", "Re-ingest needed"). For unknown errors (catch-all), the `error` string is generic (`"An unexpected error occurred. Check the main-process logs."`) and `errorType` is `internal`. Stack traces NEVER cross the IPC boundary.

**D021d — Electron tsconfig narrowing constraint: use `as KnowledgeIpcFailure` in tests, not `if (!result.success)` narrowing.**

The electron tsconfig (`electron/tsconfig.json`) sets only `noImplicitAny: true` — it does NOT enable `strict: true` or `strictNullChecks: true`. Without `strictNullChecks`, TypeScript's discriminated-union narrowing collapses: `success: true` and `success: false` are erased to plain `boolean`, and `if (!result.success)` does not narrow the union. This is a known TypeScript limitation documented in microsoft/TypeScript#21248.

Implication for test code: writing `if (!result.success) expect(result.errorType).toBe(...)` produces a TS2339 error because TypeScript sees the full union type and reports "errorType does not exist on `{ success: true, ... }`". Two workaround options considered:
1. Enable `strictNullChecks` in electron tsconfig — rejected because it would cascade into hundreds of pre-existing errors across the M0/M1/M2/M3 codebase that was written without strict mode.
2. Use explicit type assertions: `const result = await handleX(...) as KnowledgeIpcFailure; expect(result.success).toBe(false); expect(result.errorType).toBe(...);` — accepted. The `expect(result.success).toBe(false)` line provides runtime verification, and the cast is safe because the test controls the orchestrator stub.

All failure-branch test cases in `knowledgeIpcHelpers (M4-T8)` use the cast idiom. Success-branch tests use the original `if (result.success) { ... }` pattern because TS narrows `boolean → true` more eagerly than `boolean → false`.

**D021e — `makeKnowledgeContextClosure` factory lives in `knowledgeIpcHelpers.ts`, not `IntelligenceEngine.ts` or `DatabaseManager.ts`.**

The factory produces a `(query: string) => Promise<string>` closure that wraps the orchestrator and delegates to `buildKnowledgeContextBlock`. Three reasons to put it in the IPC helpers module:
1. It's pure and DI-friendly: takes `getOrchestrator: () => KnowledgeOrchestrator | null` as its only parameter, returns the closure or `null`. Testable without electron, DB, or the IntelligenceEngine class.
2. It's the mirror of the IPC handler pattern — both consume the orchestrator through a pluggable factory.
3. `DatabaseManager` is a giant file (1200+ LOC) and adding more knowledge-subsystem coupling there makes it harder to reason about. `IntelligenceEngine` already has a crowded `initializeLLMs()`.

`IntelligenceEngine.initializeLLMs()` calls `makeKnowledgeContextClosure(() => DatabaseManager.getInstance().getKnowledgeOrchestrator())` wrapped in a try/catch (`buildKnowledgeContextClosureOrNull`). If the DB isn't ready or the orchestrator throws, the function logs a warning and returns `null`, and `WhatToAnswerLLM` is constructed with `undefined` hook — live-assist runs without knowledge context instead of crashing. This is the graceful-degradation policy from D020c extended to the production wiring path.

**D021f — `buildKnowledgeContextBlock` is imported statically, not lazily via `require()`.**

Initial implementation used `const { buildKnowledgeContextBlock } = require('./buildKnowledgeContext')` inside `makeKnowledgeContextClosure` to defer loading until the factory ran. Vitest does not resolve `require()` to `.ts` source files from a module transformed via its pipeline, so two tests failed with "Cannot find module './buildKnowledgeContext'". Fix: move to top-level `import { buildKnowledgeContextBlock } from './buildKnowledgeContext'`. The lazy-load optimization was negligible (the module is pure functions, no side-effects at load time), and a top-level import is testable and type-safe.

**Consequences:**
- 8 IPC channels registered in `ipcHandlers.ts` with uniform `safeHandle` wrappers. The whole IPC surface is ~80 LOC of glue on top of the ~420 LOC helpers module.
- `DatabaseManager.getKnowledgeOrchestrator()` is the single production instantiation point. The accessor is lazy (constructs the orchestrator on first call, caches it) and uses a runtime `require('./knowledge/KnowledgeOrchestrator')` to avoid a circular type-level import with `KnowledgeOrchestrator`. Typed via `import('./knowledge/KnowledgeOrchestrator').KnowledgeOrchestrator` in the field declaration.
- `IntelligenceEngine.initializeLLMs()` gains one line (`const knowledgeContextFn = buildKnowledgeContextClosureOrNull();`) plus one factory function at module top. No behavior change if the factory returns `null`.
- `preload.ts` + `src/types/electron.d.ts` gain 8 new methods each. `electronAPI.knowledge*` is the full renderer-side surface.
- 25 new tests in `providers.test.ts`. Tests use DI stubs via `KnowledgeOrchestratorForIpc` — no `vi.mock`, no DB, no real orchestrator. Test count: **155 vitest + 4 kb-schema + 14 kb-store = 173 total**.
- SECURITY.md updated: new trust-boundary entries note the renderer can now (a) request file ingestion by path, (b) pull bounded document previews, (c) mutate the kb_documents table via pin/unpin/delete. All three go through the helpers module which validates input and scrubs error messages.
- ARCHITECTURE.md updated: Knowledge subsystem section adds the IPC surface + production wiring path diagram.
- Future: M4-T9 consumes this surface to render a full settings pane (list + upload + pin/unpin + delete + search). Zero IPC changes needed.

## 2026-04-14 — D022 — M4-T9 Renderer knowledge UI: placement, picker reuse, error-mapping module, no renderer DOM tests

**Context:** M4-T9 delivers the first renderer-side surface for the personal knowledge base. Four decisions needed to be locked in before the component lands: where to mount it, how to pick files without adding new IPC, where renderer-side error copy lives, and how to handle the absence of a renderer test harness.

**D022a — Placement: new "Knowledge" tab inside `SettingsOverlay.tsx`, not a new window or a new top-level route.**

The existing settings panel already has 9 tabs (general, profile, ai-providers, calendar, audio, keybinds, help, about) rendered via a sidebar + `activeTab` state + conditional panel block. Adding a 10th tab is three lines of glue (one icon import, one sidebar button, one panel branch) and zero routing changes. The alternatives were (a) a new `BrowserWindow` — too heavy for admin UX, (b) a collapsible accordion inside another tab — buries the feature, (c) a dedicated launcher entry — duplicates the settings surface. None of these were justified by the task scope.

The new tab sits between "AI Providers" and "Calendar" in the sidebar order — adjacent to the feature it supports (live-assist prompt enrichment) and visually close to the provider configuration that controls the embedding adapter behind it.

**D022b — Picker reuse: reuse `profileSelectFile` rather than adding a new `knowledge-select-file` IPC.**

The task constraint was explicit: "Do not add any new IPC unless there is a compile-blocking gap you can prove and document." The existing `profileSelectFile` handler in `electron/ipcHandlers.ts:2825` opens a native file dialog with filter `pdf / docx / txt` — 3 of the 4 knowledge-subsystem supported formats. Reusing it satisfies the no-new-IPC rule at the cost of losing `.md` / `.markdown` / `.mdown` from the picker filter.

Two gaps this creates and their mitigations:
1. **`.md` files can't be selected via the picker button.** Mitigated by adding a manual-path text input ("Or paste a full file path") as a fallback. The renderer never reads file bytes — it passes the user-entered string directly to `knowledgeIngestDocument(filePath)`, which is exactly the same contract as the picker path. The orchestrator dispatches by file extension regardless of how the path was obtained.
2. **Semantic coupling to the profile feature.** The handler name implies profile-specific semantics, which it doesn't have — it's just a native file-open dialog wrapper. A rename is out of scope for this task and doesn't change behavior. A follow-up task can either widen the filter or split the handler.

Rejected alternative: adding `knowledge-select-file` as a new IPC. It would be 20 LOC of boilerplate plus preload + typed declaration + test coverage, for a UX affordance that's adequately covered by the manual-path fallback. The constraint was written to prevent IPC sprawl, and this is exactly the kind of addition it was meant to block.

**D022c — Error copy lives in `src/lib/knowledgeErrors.ts`, not inline in the component.**

`KnowledgeSettings.tsx` branches on `errorType` and calls `errorTypeToMessage(errorType)` from a dedicated module. Three reasons for the split:
1. **Pure + testable without a DOM.** The helper can be unit-tested from the existing vitest harness without introducing jsdom or React Testing Library. Eight mapping tests + three sweep tests cover the full `KnowledgeIpcErrorType` union.
2. **Exhaustiveness.** The helper's switch has a `never` default branch, so TypeScript catches any future `KnowledgeIpcErrorType` addition that forgets to add a user-facing message. The `ALL_KNOWLEDGE_ERROR_TYPES` constant is the test-side source of truth for "every variant has a handler".
3. **Single canonical mapping.** Any future UI that surfaces a `KnowledgeIpcFailure` (export/import in M4-T10, a query/search pane in M5+, etc.) should import from this helper rather than hand-rolling its own error strings. DECISIONS.md D021 mandates that renderer code branch on `errorType`, not parse `error` strings — this helper is the enforcement point.

The alternative (error copy inline as a `const messages = { ... }` inside the component) works at small scale but doesn't survive the first time a second UI path needs the same mapping. Extracting upfront is cheaper than refactoring later.

**D022d — No renderer DOM tests in M4-T9; rely on the pure-helper test + M4-T11 manual smoke.**

The repo's `vitest.config` targets `electron/__tests__/**/*.test.ts` with `environment: 'node'` and no jsdom dependency. There is no React Testing Library, no Playwright suite, no existing renderer test file (`renderer/src/App.test.tsx` exists but is a skeleton without a registered test runner). Adding a full renderer test harness for one component would be disproportionate — it would add a dev dependency, a second vitest config, a setup file, and ~15 test fixtures for mocking `window.electronAPI` and lucide-react icons.

The task's test checklist ("empty list, successful list, ingest action, pin/unpin, delete confirm, preview, truncated indicator, zero-chunk display") covers the functional scenarios that would need a DOM harness. These are deferred to **M4-T11 manual smoke testing** — a human with the actual app, a real sqlite-vec-backed knowledge store, a real embedding provider, and real documents on disk. That's higher-fidelity than simulated `window.electronAPI` stubs in jsdom, and it's the existing pattern for every previous user-facing milestone gate (M0-T8, M3-T4).

What M4-T9 DID test: the pure `errorTypeToMessage` helper, with per-variant, non-empty, distinct-message, exhaustiveness, and scrubber-token leakage coverage. 12 tests total. That's the piece of M4-T9 logic that survives on its own without a DOM.

**D022e — The first cross-boundary test import: `electron/__tests__/providers.test.ts` → `src/lib/knowledgeErrors.ts` + `src/types/electron.d.ts`.**

Prior to M4-T9, the test file only imported from `../` (electron) paths. The M4-T9 tests import from `../../src/lib/knowledgeErrors` and `../../src/types/electron`. Both imports are type-safe and resolve via vitest's default filesystem resolver — no alias changes needed. The `src/types/electron.d.ts` import is type-only (`import type`) so it is fully erased at runtime. The `knowledgeErrors.ts` import pulls the module into the test runtime because its contents (switch + constant) are pure, runtime-safe, and have no Electron or React dependencies.

This sets a precedent: any future pure helper in `src/lib/*` can be tested from the main vitest suite via a relative path import. Renderer components themselves (*.tsx files that use React hooks or JSX) still require a dedicated DOM harness and remain out of scope for M4.

**Consequences:**
- 2 new files: `src/lib/knowledgeErrors.ts` (~60 LOC) and `src/components/settings/KnowledgeSettings.tsx` (~400 LOC).
- 1 file modified: `src/components/SettingsOverlay.tsx` — adds one icon import, one component import, one sidebar button, one panel branch. Zero changes to existing tabs.
- 12 new vitest tests in the `knowledgeErrors.errorTypeToMessage (M4-T9)` describe block. Test count: **167 vitest + 4 kb-schema + 14 kb-store = 185 total**.
- Zero new IPC, zero new preload methods, zero changes to `electron.d.ts`, zero changes to main-process code.
- SECURITY.md is NOT updated: M4-T9 does not introduce any new trust boundary. R12 (knowledge IPC surface introduced in M4-T8) still captures the full risk — this task consumes that surface through the documented safe path and the path-scoping residual is unchanged.
- ARCHITECTURE.md is NOT updated: the renderer entry point and module ownership have not changed materially. `SettingsOverlay.tsx` is still the settings panel container; `src/components/settings/` is still the child-component directory. Adding one more component to an existing directory is not an architectural change.
- Future: M4-T10 export/import buttons can live inside this same `KnowledgeSettings` pane (preferred) or a sibling component. Either way, they should import `errorTypeToMessage` rather than roll their own strings.

## 2026-04-14 — D023 — M4-T10 Knowledge export/import: format, policy, backup strategy, and IPC minimalism

**Context:** M4-T10 adds manual backup/restore for the personal knowledge base. Five decisions needed to be locked in before the transfer module could land: the artifact format (JSON vs container), the import policy (merge vs replace), the backup strategy for destructive replaces, the IPC surface shape, and how to extend the typed error union without breaking M4-T8/T9 contracts.

**D023a — Single JSON file with magic marker + version, not a zip/container.**

The artifact is one `sensi-knowledge-<date>.json` file containing the full knowledge base as a structured JSON document. Top-level shape: `{ sensiKnowledgeExport: true, version: 1, embeddingDim: 768, exportedAt, documentCount, chunkCount, documents: [...] }`. Each document is `{ name, mime, bytes, embeddingModel, embeddingDim, pinned, pinnedAt, ingestedAt, chunks: [{ chunkIndex, text, embedding: number[768] }] }`.

Alternatives considered and rejected:
- **Zip container (docs as JSON manifest + per-chunk embedding binaries):** smaller on disk (~75% of JSON size for 768-float vectors) but opaque to inspection, requires a zip library dependency, and adds a second file format layer. JSON can be inspected with any text editor and diffed between exports — valuable for a personal-use tool where the user might want to understand their own knowledge base structure.
- **SQLite file dump:** zero format work (just copy `sensi.db`) but it drags meetings, transcripts, screenshots, credentials, and every other table along with it. Violates the scope rule "export only the knowledge subsystem data needed for M4".
- **Separate text + embedding files:** multiple files per export is harder to move around and the M4-T11 smoke test becomes more complex.

Size cost: for the M4 scale (~100 docs × ~50 chunks × 768 floats × ~10 chars each) the JSON artifact is ~30 MB uncompressed. Acceptable for a manual backup file written once. Base64-encoded Float32 blobs would cut size by ~40% but lose the ability to inspect the file; rejected for the same "debuggable by hand" reason.

**Magic marker:** `"sensiKnowledgeExport": true` is the first gate `validateImportArtifact` checks. Intentionally verbose to avoid collision with any other JSON schema. Rejecting wrong files at this gate is cheaper than parsing 30 MB only to discover it's someone else's data.

**Versioning:** `version: 1` is explicit and integer-typed. The validator rejects any version ≠ 1 with `KnowledgeIncompatibleFormatError`. Future-version forward compatibility is deliberately NOT implemented — if a later milestone bumps to version 2, this build must refuse to import it. Adding optional new fields is NOT a version bump.

**D023b — Import policy: replace, never merge.**

On import, the current knowledge base is **fully wiped** before the imported documents are inserted. The user's existing `kb_documents`, `kb_chunks`, and `vec_kb_chunks` rows are deleted and replaced with whatever is in the artifact.

Alternatives considered and rejected:
- **Merge with conflict resolution:** requires a UI for the user to pick which document wins on name/ID collision, plus policy for "incoming pinned state vs existing pinned state". The task explicitly says "if your chosen merge policy absolutely requires one; if so, stop and choose replace instead". Merge is out.
- **Merge with auto-rename on collision:** silently renaming documents (`resume.pdf` → `resume (1).pdf`) produces confusing state and doubles storage. Rejected.
- **Merge appending only (no duplicate check):** creates duplicate documents with duplicate chunks and duplicate embeddings, corrupting retrieval with biased `topK` hits. Rejected.

Replace is simpler, safer, and matches the mental model of "restore from backup". The user explicitly chooses to replace by clicking the Import button, and the UI label is "Import (replace)" to make the destructive intent visible.

**D023c — Backup strategy: pre-import on-disk snapshot + SQLite transaction.**

Before `replaceAllFromArtifact` runs, the transfer module writes a fresh export of the **current** state to `<userData>/knowledge-preimport-backup-<ISO-timestamp>.json`. The backup is written only AFTER the incoming artifact has been validated — there's no point backing up the store to replace it with garbage. If the backup write fails, the import is aborted **before** any DB mutation.

On top of the on-disk backup, `KnowledgeStore.replaceAllFromArtifact` runs the delete+insert inside a single `better-sqlite3` transaction. Any error mid-transaction rolls back the DB automatically. The on-disk backup is kept regardless — even on a successful import — because the user may later decide the replacement was wrong and want to roll back manually. Backup files accumulate over time; the user is responsible for cleaning old ones (no auto-purge in M4).

This is intentional double-protection: (1) on-disk snapshot for user-facing recovery, (2) transaction for DB-level atomicity. Either mechanism alone would leave a failure mode uncovered — a bad in-transaction error would leave the DB consistent but the user confused, and a DB-only rollback wouldn't help if the DB file itself got corrupted.

Pre-import backup is skipped entirely when `backupDir === null`. Tests pass `null` to keep them hermetic; production passes `app.getPath('userData')` via `DatabaseManager.getKnowledgeOrchestrator()`.

**D023d — IPC surface: 4 new channels, not 2. Two operations + two dialog wrappers.**

The task suggested "minimal new typed handlers" with a preferred signature of `knowledge-export(filePath: string)` / `knowledge-import(filePath: string)`. I added those two plus two dialog wrappers (`knowledge-pick-export-path`, `knowledge-pick-import-path`).

The dialog wrappers are necessary because:
1. **There is no existing save-dialog IPC in the codebase.** The only dialog handlers are `select-service-account` (JSON-only, profile-specific) and `profile:select-file` (pdf/docx/txt, profile-specific). Neither opens a save dialog, and neither accepts `.json` in the filter set.
2. **Widening `profileSelectFile` to include `.json` would pollute an unrelated feature's handler.** `profile:select-file` is the resume upload picker; adding JSON to its filter would appear in the Profile Intelligence settings pane too, which is wrong.
3. **Renderer cannot open dialogs.** Per the CLAUDE.md "no renderer filesystem APIs" rule, `dialog.showSaveDialog` and `dialog.showOpenDialog` must live in main. Without a main-process wrapper, the renderer cannot obtain a filePath at all.

The task's "no new IPC unless there is a compile-blocking gap you can prove and document" constraint is met: without the dialog wrappers, the renderer has no way to originate a JSON filePath for `knowledgeExport` / `knowledgeImport` to consume, and the feature cannot be implemented. The wrappers are ~20 LOC each and exist solely to close the gap; they contain no business logic.

Alternative considered: put dialog handling inside `knowledge-export` / `knowledge-import` themselves (renderer calls with no args; main opens dialog + does the IO). Rejected because:
- It couples pure transfer logic to Electron's `dialog` API, making the module untestable without a dialog mock.
- It introduces `{cancelled: true}` as a success-branch variant in the result type, complicating the already-complex per-handler discriminated unions.
- It breaks the parallel with `knowledge-ingest-document`, which takes a pre-picked filePath.

The 4-channel split keeps the transfer module pure and leaves dialog state at the IPC boundary where it belongs.

**D023e — Error type extension: 3 new variants, no existing variants modified.**

M4-T10 adds `export_failed`, `import_failed`, and `incompatible_format` to `KnowledgeIpcErrorType` (8 → 11 variants). The mapping in `src/lib/knowledgeErrors.ts` gains 3 new switch branches. `ALL_KNOWLEDGE_ERROR_TYPES` grows from 8 to 11 entries. The exhaustiveness test in `providers.test.ts` expects `length === 11`.

Three variants instead of one catch-all (`transfer_failed`) because:
- **`export_failed`** is almost always a filesystem permission issue or a bad path → "check the selected location is writable".
- **`import_failed`** is usually a file read issue or a post-validation DB failure → "check the file is readable and has not been modified".
- **`incompatible_format`** is a file-contents issue (wrong JSON, wrong version, wrong magic marker, wrong embedding dim) and the user needs different advice: "confirm it was produced by this version".

Merging all three into one variant would force the UI to show a single generic message that covers the worst case — useless for debugging. Splitting them keeps the copy actionable.

**Consequences:**
- 1 new source file (`electron/knowledge/knowledgeTransfer.ts`, ~450 LOC), 1 new test runner (`electron/__tests__/knowledgeTransfer.electron.cjs`, 5 tests), 1 new npm script (`test:kb-transfer`).
- 8 existing files modified: `KnowledgeStore.ts` (+150 LOC for two new methods), `KnowledgeOrchestrator.ts` (widened type + 2 new methods), `knowledgeIpcHelpers.ts` (+90 LOC for types + handlers + error translation), `ipcHandlers.ts` (+50 LOC for 4 new channels), `preload.ts` (+15 LOC for contextBridge), `DatabaseManager.ts` (+3 LOC for backupDir), `electron.d.ts` (+40 LOC for new types), `knowledgeErrors.ts` (+6 LOC for new switch branches), `KnowledgeSettings.tsx` (+80 LOC for buttons + status banner).
- 4 new IPC channels total. Test count: **197 vitest + 4 kb-schema + 14 kb-store + 5 kb-transfer = 220 total**.
- SECURITY.md updated: R12 residual expanded with a note about the new `.json` artifact exposure surface. Renderer still holds no raw bytes — the artifact is written and read entirely in main. Only the pre-picked filePath string crosses the IPC boundary.
- ARCHITECTURE.md updated: Knowledge subsystem section adds the transfer module to the inventory + a brief note on the backup strategy.
- PRD.md not updated: the M3 (formerly M4 in this milestone numbering) deliverable "export/import of personal knowledge base" was already listed as a deliverable.
- Future: M5+ could add (a) multi-version compat by keeping the version literal as a discriminator and adding a migration layer, (b) selective export (pick documents to include), (c) background progress for very large knowledge bases. None of these are in M4 scope.

## 2026-04-14 — D024 — KNOWLEDGE-FIX-01 Ollama embedding readiness and ingest-time error routing

**Context:** A user report surfaced that Knowledge ingest emitted the message "The knowledge query failed. Try again, or check that your embedding provider (Ollama or Gemini) is reachable." even though a Gemini API key was configured. Two co-located bugs in the M4 knowledge subsystem combined to produce that symptom. D024 locks in the minimum safe fix (KNOWLEDGE-FIX-01) and the rationale for each part.

**D024a — Ollama readiness now requires the embedding model, not just daemon reachability.**

The M4-T5 probe in `electron/knowledge/EmbeddingAdapter.ts` (`probeOllamaDefault`) only checked that `/api/tags` returned a 2xx response. That silently disagreed with the stricter readiness check already in use by `buildProviderStatus('ollama')` in `electron/ipcHandlers.ts:710-726`, which requires `llmHelper.getOllamaModels().length > 0`. Under the loose probe, if `ollama serve` was running but `nomic-embed-text` had not been pulled, the probe returned `true`, the adapter committed to the Ollama branch, and the subsequent `/api/embed` POST returned a non-2xx ("model not found") that threw `KnowledgeEmbeddingRequestError`. The Gemini fallback was never consulted.

The fix introduces a pure helper `hasOllamaEmbeddingModel(tagsJson, modelName)` — exported for unit tests — that parses the tags response and returns `true` only when a model whose base name (i.e. `:tag` suffix stripped) matches the target. `probeOllamaDefault` now fetches `/api/tags`, rejects non-2xx responses, parses the body, and delegates to the helper with the constant `OLLAMA_EMBEDDING_MODEL`. Any failure mode (network, timeout, 5xx, malformed JSON, missing field, wrong shape) maps to `false` without throwing. The probe remains bounded by the existing 500 ms `OLLAMA_PROBE_TIMEOUT_MS`.

Rejected alternatives: (1) calling `/api/embed` with a throwaway string — would consume real inference time per probe and pollute logs; (2) caching the tags response across calls — unnecessary at M4 traffic scale and would mask a just-pulled or just-removed model; (3) making the probe a constructor-level check — would defer the error until first `embed()` but the existing per-call probe is already cheap.

**D024b — Ingest-time embedding request failures now wrap as `KnowledgeIngestError`.**

`KnowledgeOrchestrator.ingestDocument` step 8 catch previously re-threw the raw error from `adapter.embed(...)` after running atomicity cleanup. Combined with `translateError` in `knowledgeIpcHelpers.ts` mapping `KnowledgeEmbeddingRequestError` to `errorType: 'query_failed'`, the user-facing copy was literally wrong for an ingest action.

The fix wraps both `KnowledgeEmbeddingRequestError` and `KnowledgeEmbeddingDimensionError` inside the ingest catch as `new KnowledgeIngestError('ingestDocument: embedding request failed during ingest', { cause: e })`. `translateError` already maps `KnowledgeIngestError` to `errorType: 'ingest_failed'`, so the user-facing copy now correctly says "Could not ingest this document." The original provider error remains available as `cause` for main-process log triage. Atomicity cleanup runs unchanged before the wrapping — `store.deleteDocument(documentId)` still fires on any post-`insertDocument` failure so the store never holds a half-written row.

The wrapping is narrow: only the two generic embed-layer error classes are touched. `KnowledgeEmbeddingProviderUnavailableError`, `KnowledgeEmbeddingModelMismatchError`, `KnowledgeDimensionError`, `KnowledgeStoreInvariantError`, and the existing `KnowledgeIngestError` branches all pass through unchanged because each maps to a meaningful, distinct `errorType` in `translateError`.

**D024c — `provider_unavailable` and `model_mismatch` pass-through preserved.**

A user with no configured embedding provider must still see "No embedding provider available. Start Ollama (`ollama serve`) or configure a Gemini API key in Settings → AI Providers." — not the generic `ingest_failed` copy. Similarly, a user whose stored documents were ingested with a different embedding model than the currently active one must still see "Stored documents are embedded with a different model than the one active right now…" — not the generic `ingest_failed` copy.

The orchestrator catch explicitly skips wrapping for `KnowledgeEmbeddingProviderUnavailableError` and `KnowledgeEmbeddingModelMismatchError`. Both classes propagate to `translateError` unchanged, which continues to map them to `errorType: 'provider_unavailable'` and `errorType: 'model_mismatch'` respectively. Test #5 in the KNOWLEDGE-FIX-01 batch asserts this invariant by throwing `KnowledgeEmbeddingProviderUnavailableError` from the adapter's `resolveProvider` and verifying the thrown error is still `instanceof KnowledgeEmbeddingProviderUnavailableError` after `ingestDocument` re-raises.

**Consequences:**
- 2 source files modified (`electron/knowledge/EmbeddingAdapter.ts`, `electron/knowledge/KnowledgeOrchestrator.ts`) + 1 test file (`electron/__tests__/providers.test.ts`). No new files. No IPC channel changes. No preload changes. No renderer file touched. No DB schema or credential-handling changes.
- 5 new vitest tests (3 pure-helper + 2 orchestrator error-routing). Test count: **202 vitest + 4 kb-schema + 14 kb-store + 5 kb-transfer = 225 total**.
- SECURITY.md NOT updated: no trust boundary changed. The probe still contacts only `127.0.0.1:11434/api/tags` from main process, the Gemini fallback path is unchanged, no renderer exposure is widened. R12 residual unchanged.
- ARCHITECTURE.md NOT updated: no module ownership or IPC topology change. The Knowledge subsystem section still accurately describes the `EmbeddingAdapter` and `KnowledgeOrchestrator` roles.
- PRD.md / CLAUDE.md NOT updated: no milestone scope or workflow rule changed.
- TASKS.md and TESTS.md updated as part of the DOC-SYNC-01 reconciliation step (the entry containing this ADR reference).
- Reversible with a single `git revert` over the KNOWLEDGE-FIX-01 commit. No data migration, no schema change, no credential format change.
- Future: a later task could (a) unify `buildProviderStatus('ollama')` and `probeOllamaDefault` on a single shared readiness helper to guarantee the two code paths agree by construction rather than by convention, (b) extend `test-llm-connection` for Gemini to also exercise `batchEmbedContents` so a green "Test connection" is proof of embedding-endpoint access too. Neither is blocking.

## 2026-04-15 — D025 — KNOWLEDGE-FIX-02 Gemini embedding model migration (text-embedding-004 → gemini-embedding-001 + outputDimensionality 768)

**Context:** The M4-T11 manual smoke (scenario 3: Ollama absent, Gemini key configured) reproduced a 404 on every Gemini ingest attempt. TRIAGE-INGEST-01A stage tracing (added in a separate narrow task) isolated the failing step to `embed/upsertChunks`: every prior pipeline stage (`readFile`, `parse`, `chunk`, `resolveProvider`, `insertDocument`) emitted its `ok` line, then the POST to `generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents` returned `404 Not Found` with Google's stock error text `"model ... is not found for API version v1beta, or is not supported for embedContent"`. This error fires when the model ID no longer resolves for the caller's account — Google dropped `text-embedding-004` from the `v1beta` `batchEmbedContents` path for new keys as part of the 2025-2026 embeddings migration. KNOWLEDGE-FIX-02 swaps the Gemini request shape to the current-generation model without touching any other code path.

**D025a — Swap `GEMINI_EMBEDDING_MODEL` to `gemini-embedding-001`.**

`gemini-embedding-001` is Google's current-generation Gemini embedding model exposed on `v1beta` as of April 2026. It is the documented successor to `text-embedding-004` and is the only Gemini embedding model that Google currently guarantees availability for on the `batchEmbedContents` RPC. Swapping the single `GEMINI_EMBEDDING_MODEL` constant in `electron/knowledge/EmbeddingAdapter.ts` is enough to migrate the URL template (`${GEMINI_BASE_URL}/v1beta/models/${GEMINI_EMBEDDING_MODEL}:batchEmbedContents?key=…`) and the per-request body `model` field (`models/${GEMINI_EMBEDDING_MODEL}`) in lock-step. No changes to `GEMINI_BASE_URL`, fetch timeout, error-message format, response parsing, or 768-dim post-condition validator.

**D025b — Add `outputDimensionality: 768` to every request entry in the batchEmbedContents body.**

Unlike `text-embedding-004` (which natively returned 768-dim vectors), `gemini-embedding-001` defaults to **3072-dim** output with Matryoshka Representation Learning (MRL) support. Returning 3072-dim vectors would immediately trip the `KnowledgeEmbeddingDimensionError` gate at `EmbeddingAdapter.embed` lines 201-206 and would also break the fixed `vec0(embedding float[768])` schema from M4-T1 (D014a). Pinning `outputDimensionality: 768` per request tells Google to return MRL-truncated 768-length vectors — which are semantically equivalent to the old `text-embedding-004` vectors for retrieval purposes — so the existing schema, store, and query paths continue working byte-identical.

A new module-private constant `GEMINI_EMBEDDING_OUTPUT_DIM = 768` names the magic number once so a future migration (e.g. to a 1536-dim schema) is a one-line change. The test-coverage for this field specifically verifies that every request entry in a batched call carries the field — not just the first — so batched ingests (which split a document into N chunks and call embed once) are gated.

Rejected alternatives considered:
- **Migrate to `embedding-001` (legacy stable).** `embedding-001` is older and still works on `v1beta` but has been superseded by `gemini-embedding-001` for over a year. Using it would be a step backwards and invites another forced migration in the future.
- **Migrate the URL to `v1` instead of `v1beta`.** Google's `v1` embeddings endpoint exists but the documented `batchEmbedContents` RPC is still on `v1beta` for `gemini-embedding-001`. Swapping the version would not by itself fix the 404.
- **Wide refactor to abstract the embedding provider behind a strategy interface.** Out of scope for a narrow fix. Current two-provider selection in `EmbeddingAdapter.embed` remains sufficient.
- **Return the native 3072-dim output and migrate the vec0 schema.** Would require a DB migration, a re-embed of every stored document, and a schema change to `vec_kb_chunks`. Explicitly out of scope for KNOWLEDGE-FIX-02 which is a narrow fix. MRL truncation to 768 is semantically equivalent for retrieval at M4 scale.

**D025c — Preserve every other Gemini call surface byte-identical.**

The fix touches exactly one constant, one named constant declaration, one body field, and three doc-comment lines. Everything else in `embedWithGeminiDefault` and `EmbeddingAdapter.embed` is preserved:
- Same host (`generativelanguage.googleapis.com`), same URL template, same `?key=` query parameter, same `encodeURIComponent(apiKey)` encoding.
- Same `Content-Type: application/json` header (test #2 regression-gates that no header value ever carries the API key).
- Same 30 s fetch timeout via `AbortSignal.timeout(GEMINI_EMBED_TIMEOUT_MS)`.
- Same `KnowledgeEmbeddingRequestError` wrapping on non-2xx responses at lines ~376-378, same status-code-only error text, same "do NOT include the URL in the error message — it contains the API key" guard comment.
- Same response parsing (`{ embeddings?: { values: number[] }[] }`) — `gemini-embedding-001` returns the same JSON shape as `text-embedding-004`.
- Same 768-dim post-condition validator that throws `KnowledgeEmbeddingDimensionError` on any vector length mismatch.
- `KnowledgeOrchestrator` step-8 catch and KNOWLEDGE-FIX-01's `KnowledgeEmbeddingRequestError` → `KnowledgeIngestError` wrap fully preserved. TRIAGE-INGEST-01A stage logs continue to fire exactly as before, just with the new model name in the `resolveProvider ok` and `done` lines.

**D025d — Legacy-model test fixtures intentionally preserved.**

Four occurrences of `'text-embedding-004'` in the M4-T6 `KnowledgeOrchestrator` mixed-model-mismatch tests (providers.test.ts lines 1844, 1845, 1861, 1918) are deliberately left unchanged. They seed `kb_documents.embedding_model` with a legacy value and now genuinely exercise D019b: the live `EmbeddingAdapter` reports `'gemini-embedding-001'`, so any seeded legacy row is a real mismatch and the test keeps firing the `KnowledgeEmbeddingModelMismatchError` branch by construction. Updating them to `'gemini-embedding-001'` would have silently weakened the mixed-model coverage.

**D025e — Pre-fix stored documents: no automatic migration.**

If the user's store contains any successfully-ingested documents with `embedding_model = 'text-embedding-004'` (unlikely per the smoke history — ingest had been failing), a post-fix query will throw `KnowledgeEmbeddingModelMismatchError` per D019b. KNOWLEDGE-FIX-02 does NOT add migration code: no re-stamp, no re-embed, no batched rewrite. The documented remediation is delete + re-ingest via the existing `handleDeleteDocument` and `handleIngestDocument` IPC handlers — functionality that already exists in the Knowledge settings pane. Adding a migration would widen the fix beyond its single-task scope and would require a destructive mutation of existing DB rows. A user with affected rows can restore state manually; a user with zero affected rows (the practical case here) sees no difference.

**Consequences:**
- 1 production file modified: `electron/knowledge/EmbeddingAdapter.ts` (~12 LOC delta — one constant rename, one new named constant, one new body field, three doc-comment updates).
- 1 test file modified: `electron/__tests__/providers.test.ts` (+5 new tests in a dedicated describe block, 4 existing assertions updated in place, 4 legacy fixtures preserved). ~180 LOC total.
- Zero renderer / preload / IPC / DB schema / doc-format / credential-handling changes. Trust boundaries B1–B6 all unchanged. No new files, no new IPC channels, no new npm scripts.
- Test count: **210 vitest + 4 kb-schema + 14 kb-store + 5 kb-transfer = 233 total** (was 225 at end of KNOWLEDGE-FIX-01; +5 for KNOWLEDGE-FIX-02 + 3 for TRIAGE-INGEST-01A which landed between the two doc-sync passes and had not been reflected in TESTS.md until now).
- Manual smoke confirmed 2026-04-15: scenarios 1 and 3 from the M4-T11 plan now pass end to end. Log tail shows `[ingest] done id=<uuid> provider=gemini model=gemini-embedding-001 chunkCount=…` with no `CAUGHT` lines. Knowledge settings pane lists the stored document with a non-zero chunk count. Both Markdown and PDF sources verified.
- SECURITY.md NOT updated: R12 residual unchanged. The Gemini call still originates from main process via `fetch`, still uses the same host, still uses the same `?key=` query-parameter pattern, and still scrubs the URL out of error messages. No new trust-boundary surface.
- ARCHITECTURE.md NOT updated: `EmbeddingAdapter` module ownership unchanged; the Knowledge subsystem diagram in ARCHITECTURE.md still accurately describes the data flow.
- PRD.md / CLAUDE.md NOT updated: no milestone scope or workflow rule changed.
- TASKS.md and TESTS.md updated as part of the DOC-SYNC-03 reconciliation step that contains this ADR reference.
- Reversible with a single `git revert` over the KNOWLEDGE-FIX-02 commit. No data migration, no schema change, no credential format change.
- Forward note: if Google deprecates `gemini-embedding-001` in the future, the same single-constant + body-field pattern makes the next migration a ~10 LOC fix. The `GEMINI_EMBEDDING_OUTPUT_DIM` constant also prepares the way for any future schema that wants a different dimension.

## 2026-04-15 — D026 — KNOWLEDGE-FIX-03 hint cleanup policy + M4-T11 closeout rationale

**Context:** After KNOWLEDGE-FIX-02 swapped the live Gemini embedding model from `text-embedding-004` to `gemini-embedding-001`, several user-visible hint strings, error-message copy, and inline code comments still referenced the retired model ID. A post-fix audit (KNOWLEDGE-FIX-03) updated each stale site to match the live code and, as a side effect, fixed one latent UX regression in the Knowledge settings pane. Separately, M4-T11 manual-smoke verification needed to be closed out: scenarios 1 and 3 were proven by the KNOWLEDGE-FIX-02 smoke run, and scenarios 2, 4, 5, 6 had to be evaluated for whether a second manual pass was required or whether automated test coverage already satisfied the invariants the smoke plan was designed to check. D026 locks in both decisions together.

**D026a — Hint-cleanup scope: surgical text-only edits, history comments preserved, legacy fixtures preserved.**

KNOWLEDGE-FIX-03 touched exactly 5 files, all with literal string or comment swaps and zero control-flow change:
1. `src/components/settings/KnowledgeSettings.tsx` — `shortProvider()` helper. Added a `gemini-embedding-001 → 'Gemini / gemini-embedding-001'` branch AND renamed the existing `text-embedding-004` branch to `'Gemini / text-embedding-004 (legacy)'`. This fixed a latent UX regression: newly-ingested documents carrying `embeddingModel = 'gemini-embedding-001'` were falling through to the raw-string default and showing the unfriendly raw string in the Knowledge list. Pre-fix rows still render with a friendly label explicitly marked as legacy.
2. `electron/knowledge/knowledgeIpcHelpers.ts` — `translateError` `model_mismatch` branch: the user-visible recovery hint substring `"Gemini API key for text-embedding-004"` → `"Gemini API key for gemini-embedding-001"`. The only renderer-facing copy change; the `errorType` value and the rest of the message are unchanged.
3. `electron/knowledge/KnowledgeOrchestrator.ts` — the internal `KnowledgeEmbeddingModelMismatchError` message thrown from `queryKnowledge` updated to match the IPC helper's copy. Visible only in main-process logs and only if the helper-side translation is bypassed.
4. `electron/db/DatabaseManager.ts` — schema-rationale comment above the `vec_kb_chunks` DDL updated to reference `gemini-embedding-001` (via `outputDimensionality: 768 per KNOWLEDGE-FIX-02 / D025`) instead of `text-embedding-004`.
5. `electron/knowledge/chunker.ts` — doc-comment token-budget note updated.

**Deliberately NOT touched:**
- `electron/knowledge/EmbeddingAdapter.ts` lines 12 and 120 — historical-context comments that explicitly document the KNOWLEDGE-FIX-02 migration ("KNOWLEDGE-FIX-02 swapped this from the earlier text-embedding-004 default after that model started returning 404 …"). These are migration documentation, not stale hints. Removing them would erase the D025 rationale from inline comments where a future reader would benefit most from finding it. **Preserved.**
- `electron/__tests__/providers.test.ts` lines 1844, 1845, 1861, 1918 — 4 legacy-model fixtures deliberately preserved per **D025d**. They seed `kb_documents.embedding_model = 'text-embedding-004'` to exercise D019b mixed-model-mismatch handling: the live adapter reports `gemini-embedding-001`, so any fixture stamped with the legacy name is a genuine mismatch and the test fires by construction. Updating them would silently weaken the mixed-model test surface. **Preserved.**

**D026b — KNOWLEDGE-FIX-03 has zero test delta and zero behavior change.**

Zero new tests, zero updated assertions. Every edit is a text swap inside an existing string literal or a code comment. `translateError` branches and class `instanceof` order are unchanged; `KnowledgeOrchestrator.queryKnowledge` throws the same error class; `KnowledgeSettings.tsx:shortProvider` is a pure derivation of a UI label. Trust boundaries B1–B6 all untouched. No renderer secrets, no direct provider calls from renderer, no IPC additions, no DB schema changes, no credential handling changes. All four gates (`typecheck:electron`, `npm test`, `build:electron`, `build`) green on 2026-04-15.

**D026c — M4-T11 closeout: scenarios 2, 4, 5, 6 closed by automated evidence rather than a second manual smoke run.**

The 6-scenario M4-T11 smoke plan tested these invariants: (1) Gemini fallback when Ollama is up but `nomic-embed-text` is absent; (2) Ollama native path when the model is present; (3) Gemini fallback when Ollama is down; (4) `provider_unavailable` copy when neither provider is configured; (5) `ingest_failed` routing + atomicity cleanup on forced embed failure; (6) live-assist retrieval regression after successful ingest.

Scenarios 1 and 3 were the exact paths KNOWLEDGE-FIX-02 fixed, and both were proven end-to-end by the manual smoke on 2026-04-15 — the log tails are recorded in the KNOWLEDGE-FIX-02 TASKS.md entry.

Scenarios 2, 4, 5, and 6 were **not re-run manually**. Instead, each scenario's core invariant was matched against existing automated test coverage, and the audit found that every link in the chain (throw → wrap/skip → IPC translate → renderer mapping → rendered copy) is already tested deterministically. Specifically:
- **Scenario 2** is covered by `EmbeddingAdapter (M4-T5)` `'Ollama available → adapter selects Ollama'`, KNOWLEDGE-FIX-01's 3-test `hasOllamaEmbeddingModel` probe-presence describe block, the M4-T6 orchestrator happy-path test, and `knowledgeStore.electron.cjs` real-sqlite-vec coverage.
- **Scenario 4** is covered by the `KnowledgeEmbeddingProviderUnavailableError` throw tests in M4-T5, the M4-T6 `resolveProvider` throw test, KNOWLEDGE-FIX-01's pass-through-preservation test, the M4-T8 `handleQueryKnowledge` IPC translation test, and the M4-T9 `knowledgeErrors.errorTypeToMessage` rendered-copy tests. Post-KNOWLEDGE-FIX-03 the recovery hint is also up to date.
- **Scenario 5** is covered by KNOWLEDGE-FIX-01's wrap-and-cleanup test, TRIAGE-INGEST-01A's embed-failure log-signature test, the M4-T8 `handleIngestDocument` translation test, and the M4-T9 rendered-copy tests.
- **Scenario 6** is covered by the 15 `buildKnowledgeContextBlock (M4-T7)` tests, the 3 `WhatToAnswerLLM knowledge hook (M4-T7)` tests, and the `knowledgeTransfer.electron.cjs` Test 4 real-sqlite-vec `searchByEmbedding` round-trip. Because KNOWLEDGE-FIX-02 changed only the Gemini request body and left every downstream retrieval path byte-identical, the existing retrieval-path coverage fully applies.

Rationale for NOT running a second manual smoke: each automated test deterministically pins the exact invariant the corresponding smoke scenario was designed to verify, and the chain is tested end-to-end from throw site to rendered copy. A second manual smoke would add no new signal beyond visual confirmation that components render the same copy the automated tests already assert. The cost of a second smoke (fresh-profile setup, Ollama daemon state toggling, 4 separate scenarios × ~5 min each) is not justified by the marginal additional confidence. If a future M4-T11 regression is ever suspected, the automated tests will catch it first and a targeted manual re-run can be scoped to just the failing scenario.

**D026d — Residual: legacy `text-embedding-004` rows in an existing DB.**

If a user's live `sensi.db` contains any pre-KNOWLEDGE-FIX-02 rows with `embedding_model = 'text-embedding-004'`, a query after the fix throws `KnowledgeEmbeddingModelMismatchError` per **D019b** / **D025e**. This is expected mixed-model behavior, not a bug. The documented remediation is:
1. Open Settings → Knowledge.
2. Identify the affected document(s) in the list — post-KNOWLEDGE-FIX-03 they render with a `'Gemini / text-embedding-004 (legacy)'` label.
3. Click Delete → confirm.
4. Re-ingest the same file. The new row will be stamped with the current `gemini-embedding-001` model name.

A user who wants to audit DB state from the command line can run `SELECT id, name, embedding_model FROM kb_documents WHERE embedding_model = 'text-embedding-004';` against `%APPDATA%/sensi/sensi.db`. Empty result = clean. No migration code was added for this one-task-scope fix because adding automated backfill would require destructive mutation of existing DB rows and would widen the fix beyond its narrow scope.

**Consequences:**
- KNOWLEDGE-FIX-03 touched 5 files, zero LOC of logic, zero tests, zero behavior. All four gates green 2026-04-15.
- M4-T11 closed: scenarios 1 and 3 by manual smoke, scenarios 2 / 4 / 5 / 6 by automated test coverage with per-scenario citations recorded in TASKS.md.
- TASKS.md and TESTS.md updated as part of the DOC-SYNC-04 reconciliation step that contains this ADR reference.
- SECURITY.md NOT updated: R12 residual unchanged. No new trust-boundary surface. Renderer still holds no secrets, no direct provider calls.
- ARCHITECTURE.md NOT updated: no module ownership or data-flow change.
- PRD.md / CLAUDE.md NOT updated: no milestone scope or workflow rule changed.
- Reversible: every KNOWLEDGE-FIX-03 edit is a single-commit revert away from the pre-fix text. M4-T11 closeout is a doc-only reconciliation with no code impact.
- Forward note: M4 is effectively complete pending a future scope decision on whether to add automated tests for the legacy-row remediation path (delete + re-ingest round-trip). The existing KnowledgeSettings tests do not currently pin the legacy-label render case; a tiny follow-up could add that as a pure-helper test against `shortProvider` without needing a DOM harness. Out of scope for DOC-SYNC-04.

## 2026-04-15 — D027 — M3-FIX-01 OpenAI token clamp + RAG active-provider routing

**Context:** Pre-M3-T4 smoke on Windows surfaced two independent defects that blocked the live meeting loop from running cleanly on OpenAI-backed providers. Both were narrow and shipped together because they were in the same smoke chain and because fixing either alone would leave the path partially broken.

**Symptom 1:** `Error 400 max_tokens is too large 65536. This model supports at most 16384 completion tokens` from OpenAI's Chat Completions API during a live follow-up on `gpt-4o`. Streamed tokens never reached the overlay.

**Symptom 2 (latent, not user-visible):** Every RAG retrieval response was silently routed through Gemini regardless of the user's active provider. A user on OpenAI who queried their meeting transcript would get a Gemini-generated answer; if their Gemini key was absent, the RAG path would throw and fall back to plain chat.

**D027a — Per-model OpenAI completion-token clamp via `resolveMaxCompletionTokens(model, requested)`.**

The root cause was a single hardcoded constant `MAX_OUTPUT_TOKENS = 65536` passed as `max_completion_tokens` to every OpenAI chat-completions call across three sites in `electron/LLMHelper.ts` (non-streaming `generateWithOpenai` at line 1400, streaming `streamWithOpenai` at line 2565, streaming multimodal `streamWithOpenaiMultimodal` at line 2846). The existing `model.toLowerCase().includes('claude') ? CLAUDE_MAX_OUTPUT_TOKENS : MAX_OUTPUT_TOKENS` conditional was a legacy workaround for routing Claude ids through the OpenAI SDK — it did nothing for OpenAI itself and left every OpenAI family using a 65536 ceiling that exceeds the API's per-model caps (GPT-4o = 16384, o1/o3/GPT-5 ≤32768 conservative).

The fix introduces a module-private pure helper `resolveMaxCompletionTokens(model: string, requested: number): number` exported for tests. It clamps per OpenAI family (`gpt-4o*` → 16384; `o1*` / `o3*` / `gpt-5*` → 32768; any other OpenAI-family id → 16384 conservative default; Claude via OpenAI SDK → 8192), passes through non-OpenAI / non-Claude ids unchanged so Gemini / MiniMax / Groq SDK paths keep their own clamping logic, and always returns `min(requested, family_cap)` so below-cap requests pass through untouched. Four named constants anchor the per-family values (`OPENAI_GPT4O_MAX_COMPLETION`, `OPENAI_GPT5_O_FAMILY_MAX_COMPLETION`, `OPENAI_DEFAULT_MAX_COMPLETION`, `CLAUDE_VIA_OPENAI_SDK_MAX_COMPLETION`).

Rejected alternatives:
- **Drop `max_completion_tokens` entirely** — the OpenAI SDK's default is model-dependent and undocumented; we want a deterministic ceiling.
- **Centralize in a shared `electron/llm/tokenBudget.ts`** — would be cleaner long-term but introduces a cross-module dependency for a narrow fix. Kept the helper local to `LLMHelper.ts` for now; promote to shared module if MODE_CONFIGS ever grows per-model policy (out of scope).
- **Update `MAX_OUTPUT_TOKENS` itself to 16384** — would silently clip legitimate Gemini 65536 budgets (the constant is reused in 7 other places across `LLMHelper.ts` for Gemini calls). Clamping at the call site preserves every other provider's headroom.
- **Extend the existing `model.includes('claude')` one-liner** — couldn't express the nested GPT-4o vs o1/o3 vs default distinction cleanly, and wouldn't export for tests.

**D027b — RAG active-provider routing via `streamChat` (not `streamChatWithGemini`).**

`RAGManager.queryMeeting` at `electron/rag/RAGManager.ts:184` and `RAGManager.queryGlobal` at `:215` called `this.llmHelper.streamChatWithGemini(prompt, undefined, undefined, true)`, hardcoding the Gemini branch. This contradicted the M3-T3 active-provider contract that `generateMeetingSummary` and every other live-assist call already honor via `streamChat`'s internal dispatch chain (MiniMax → OpenAI → Claude → Groq → Gemini).

The fix swaps the method name and adjusts the arg signature: `streamChat(prompt, imagePaths?, context?, systemPromptOverride?, ignoreKnowledgeMode)`. The final `ignoreKnowledgeMode: true` (5th positional arg) disables the knowledge-mode intercept inside `streamChat` so it doesn't double-inject context on top of the RAG prompt that `buildRAGPrompt` already constructed. Two-line swap per call site.

Consequence for users on non-Gemini providers: RAG retrieval responses now flow through the same provider as the rest of their live-assist output. Users on Gemini see byte-identical behavior (same dispatcher, same final call shape). No credential handling change; the active provider's existing API key path in `CredentialsManager` is already wired.

Rejected alternatives:
- **Add an `activeProvider` parameter to `queryMeeting`** — redundant; `streamChat` already reads `currentModelId` internally.
- **Keep Gemini for RAG and document the drift** — contradicts the M3-T3 active-provider promise.

**D027c — "Falling back to regular chat" logs are NOT a bug.**

The logs `NO_RELEVANT_CONTEXT_FOUND, falling back to regular live chat` and `Meeting X not processed and no JIT indexing, falling back to regular chat` at `electron/ipcHandlers.ts:2590, 2636, 2567` are **designed graceful-degradation signals**, not smoke failures. They fire when (a) the live JIT indexer has no chunks yet (meeting just started), (b) the retriever finds zero semantically relevant chunks for the current query, or (c) the meeting id the renderer passed doesn't match any processed meeting AND isn't the hardcoded `'live-meeting-current'` id used by live indexing. The fallback path — plain `streamChat` against `SessionTracker` rolling context — is the intentional behavior; follow-up generation via `WhatToAnswerLLM` still produces streamed output. No code change in this pass.

**D027d — Potential renderer/meetingId wiring bug deferred for M3-T4 verification.**

`electron/ipcHandlers.ts:2566-2568` (`rag:query-meeting` handler) checks `isLiveIndexingActive(meetingId)` where `meetingId` arrives from the renderer, but `electron/main.ts:1451` starts live indexing with the hardcoded string `'live-meeting-current'`. If the renderer ever calls `rag:query-meeting` with a DB-generated id during a live meeting, the check will fail and the handler will return `{ fallback: true }` even though JIT indexing IS running. The dedicated `rag:query-live` handler at `ipcHandlers.ts:2605` uses the hardcoded string correctly, so the renderer has two paths available — one correct, one potentially broken depending on which path the renderer actually uses. M3-T4 manual smoke should log which handler the renderer calls; if the broken path is used, a narrow alias fix lands in a follow-up task. Not patched speculatively.

**D027e — `CLAUDE_MAX_OUTPUT_TOKENS = 64000` and `MODE_CONFIGS.*.maxOutputTokens = 65536` left alone.**

Claude Sonnet 4.6's real output cap is 8192, not 64000. The `CLAUDE_MAX_OUTPUT_TOKENS` constant is only exercised on the Anthropic SDK path in `LLMHelper.ts` (not the OpenAI-compat path, which this fix clamps to 8192 via `CLAUDE_VIA_OPENAI_SDK_MAX_COMPLETION`). Fixing the Anthropic-SDK constant is a separate narrow task because the smoke didn't exercise it — deferred. The `MODE_CONFIGS` entries feed Gemini's `maxOutputTokens`, which Gemini 3.1 Flash/Pro both accept at 65536, so these are not actively broken.

**Consequences:**
- 2 production files modified: `electron/LLMHelper.ts` (+70 LOC helper + 3 call-site swaps, ~75 LOC total delta) and `electron/rag/RAGManager.ts` (+2 LOC, -2 LOC swap).
- 1 test file modified: `electron/__tests__/providers.test.ts` (+5 new tests in new describe block, ~65 LOC delta).
- Zero new files, zero IPC channels, zero preload changes, zero renderer changes, zero DB schema changes, zero credential handling changes, zero new deps.
- Test count: **215 vitest + 4 kb-schema + 14 kb-store + 5 kb-transfer = 238 total** (was 233 at end of DOC-SYNC-04; +5 for M3-FIX-01 token clamp tests).
- Trust boundaries B1–B6 all unchanged. No renderer secrets, no direct provider calls from renderer, prompt assembly stays in main.
- SECURITY.md NOT updated: no trust-boundary change. The OpenAI call still originates from main, uses the same credential path, same host. The RAG swap changes WHICH provider is called but not HOW credentials or network egress work.
- ARCHITECTURE.md NOT updated: no module ownership change. `LLMHelper` still owns provider dispatch; `RAGManager` still owns retrieval. The RAG swap moves the dispatch call from Gemini-specific to the active-provider dispatcher `streamChat` — internal refinement, not a module reorganization.
- PRD.md / CLAUDE.md NOT updated: no milestone scope or workflow rule changed. M3 scope is unchanged; this is a narrow fix inside M3-T3's domain before the M3-T4 smoke runs.
- TASKS.md and TESTS.md updated as part of the doc-update step that contains this ADR reference.
- Reversible with a single `git revert` over the M3-FIX-01 commit.
- M3-T4 is now unblocked; the smoke can proceed on OpenAI / GPT-4o without the 400 rejection.

## 2026-04-17 — D028 — POLISH-01 casing rule, logo direction, auto-scroll spec, scope fence

**Context:** M0-T7's grep sweep renamed the project to `sensi` across package.json / appId / tray / log file / DB file but missed three user-visible surfaces (`<title>` in `index.html`, the upstream "N" logomark in `SensiLogoMark.tsx`, and a handful of stale Natively variable/comment references in Launcher + chat overlays). Separately, all three chat surfaces (`SensiInterface.tsx`, `GlobalChatOverlay.tsx`, `MeetingChatOverlay.tsx`) shared the same auto-scroll regression: scroll-on-user-send was wired but no scroll happened during token streaming, so assistant output drifted off-screen during a live response. POLISH-01 bundles the two as one narrow reversible pass.

**D028a — Casing rule: `sensi` lowercase (locked).**

- **`sensi`** — product name, everywhere (UI, code strings, `<title>`, tray, wordmarks, logs, file paths, commit messages, docs).
- **`Sensi`** — only at the start of a sentence or title where sentence-case grammar requires capitalization.
- **`Sensei`** — never as the product name in UI or code. May appear in long-form marketing copy (About page, release notes) that references the root meaning ("teacher, trusted guide").
- **`SENSI`** — never. No existing constant demands it.

Enforcement is by grep in the POLISH-01 verification checklist (`grep -rn "Natively" src/ index.html ...`). M0-T5 tombstone state variables (`hasNativelyKey`, `NativelyApiPromoToaster`) and tombstone comments are explicitly preserved because they document the neutralized Natively cloud API path — not user-visible text.

Rejected alternatives: (a) `Sensei` as product name — rejected because the existing M0-T7 decision already established `sensi` lowercase and every downstream artifact (package.json, appId, DB filename, log filename, Launcher wordmark) depends on it; re-casing now would require cascading updates far outside POLISH-01's fence. (b) Allow `Sensi` as casual capitalization — rejected because mixed casing in UI is a brand-quality smell and the Launcher's existing lowercase "My sensi" / "Start sensi" have been shipping since M0-T7 without friction.

**D028b — Logo direction: brush-s monogram + wordmark lockup (Option B, selected).**

`SensiLogoMark.tsx` is rewritten to export a new `SensiMark` component with a `variant: 'mark' | 'wordmark' | 'lockup'` prop. The mark variant is a lowercase "s" traced as a single calligraphic brushstroke (SVG path with round caps and joins) inscribed in an optional circle — evoking the Japanese *shodō* root reference without being literal. The wordmark variant renders lowercase `sensi` in the Celeb Light typeface already loaded by the Launcher. The lockup variant places mark + wordmark side-by-side with a fixed gap. The legacy `SensiLogoMark` export is kept as a named alias that delegates to `<SensiMark variant="mark" />`, so the two existing import sites (`SensiLogoMark.tsx` itself + `FreeTrialModal.tsx`) continue to work unchanged.

Rejected alternatives: (a) wordmark only — no tray/favicon glyph; rejected because the existing icon.png raster slot needs a mark to regenerate from. (b) speech-bubble/seed — signals function over identity and reads as a generic chat-app logo; rejected for being too generic.

PNG/icon regeneration is explicitly deferred. `icon.png` and `assets/icons/png/*.png` retain the upstream "N" glyph for this release. A separate design pass will regenerate the full size ladder (16/32/64/128/256/512/1024) from the new SVG. Documented as a known residual in TASKS.md.

**D028b follow-up (POLISH-01a, 2026-04-17):** after POLISH-01 shipped, testing revealed the main-interface "Start sensi" CTA and several other in-app surfaces were still rendering the raster `icon.png` via `<img src={icon}>` — a separate code path from `SensiLogoMark`. POLISH-01a swapped seven in-app renderers (Launcher, TopPill, SettingsOverlay preview pill, GlobalChatOverlay, MeetingChatOverlay, MeetingDetails, HelpSettings ×5) to use `<SensiMark variant="mark" />` inline SVG so the new glyph shows everywhere the user sees it inside the app. `StartupSequence.tsx` (2-second splash with complex filter animations on the `<img>` tag) was left alone; remains part of the same deferred PNG regeneration task. OS-level surfaces (tray, installer, packaged icon) continue to use the raster `icon.png` until the design pass lands.

**D028c — Auto-scroll spec: near-bottom follow with scroll-intent respect.**

Invariants (implemented by `useAutoScrollToBottom` hook):
1. While a stream is in progress AND the user's viewport is within 48 px of the bottom, the scroll container auto-follows new content.
2. While a stream is in progress AND the user has scrolled up past the threshold, auto-follow is paused; the scroll position does not move.
3. When the user scrolls back into the 48 px threshold, auto-follow resumes on the next content update.
4. Threshold math: `scrollHeight − (scrollTop + clientHeight) ≤ 48 px`. Non-overflowing containers (scrollHeight ≤ clientHeight) are treated as "at bottom" — no follow-scroll needed.
5. On container resize (window resize, devtools toggle, font load, sidebar toggle), re-evaluate once; if still near-bottom, snap to bottom via rAF.
6. User-send `scrollIntoView({ behavior: 'smooth' })` calls (5 in `SensiInterface.tsx`, 1 each in the two chat overlays) are preserved verbatim — they're a different UX (one-shot, user-initiated) and the smooth animation works correctly at that cadence.
7. Token-driven auto-follow uses `behavior: 'auto'` (instant). At 30 tokens/s smooth-scroll animation lags behind content arrival and looks broken.
8. No programmatic scroll if the container does not overflow.

Applied in three surfaces via the same hook: `SensiInterface.tsx`, `GlobalChatOverlay.tsx`, `MeetingChatOverlay.tsx`. Trigger is a string derived from `messages.length:lastMessage.text.length` (or `.content.length` in the two overlay message shapes) so every token append re-fires the effect.

The pure `isWithinBottomThreshold(scrollTop, clientHeight, scrollHeight, threshold)` predicate is exported separately and has 4 unit tests. The DOM side effects (scroll listener, rAF, ResizeObserver) are covered by the POLISH-01 manual smoke, not automated tests — same jsdom-free policy as M4-T9 / D022.

Rejected alternatives: (a) always scroll to bottom on every token — fights user scroll-up intent. (b) scroll only at message boundaries — doesn't follow mid-message streaming. (c) IntersectionObserver on a sentinel at the bottom — works but overkill for the threshold math; simpler scroll-event + `scrollHeight` read gets the same answer in fewer lines.

**D028d — Scope fence: POLISH-01 is narrow polish only.**

Out of scope for POLISH-01:
- No IPC, preload, DB schema, provider-routing, credential-handling, or security-boundary changes.
- No PRD renumbering (M2/M3 scope drift still tracked by the M5 plan).
- No PNG/icon asset regeneration (deferred to a separate design pass).
- No Launcher or Settings layout redesign beyond mounting the new wordmark lockup.
- No M5 (live transcription & rolling-context loop) work.
- No grep sweep of M0-T5 tombstone state variables (`hasNativelyKey`, `NativelyApiPromoToaster`, tombstone comments) — those are internal wiring, not user-visible text.

**Consequences:**
- 9 production files modified + 1 new hook file + 1 test file + 1 deleted asset (`src/assets/evin.png`).
- Zero new IPC channels, zero preload surface changes, zero DB schema changes, zero credential handling changes. All trust boundaries B1–B6 unchanged.
- Test count: **219 vitest + 4 kb-schema + 14 kb-store + 5 kb-transfer = 242 total** (was 238 at end of M3-FIX-01; +4 for POLISH-01).
- SECURITY.md NOT updated: no trust-boundary change.
- ARCHITECTURE.md NOT updated: no module ownership, IPC topology, or data-flow change. `useAutoScrollToBottom` is a renderer-side utility hook.
- PRD.md NOT updated: no milestone scope change. Milestone-numbering drift (PRD M3 vs TASKS M4) still tracked by the M5 plan; separate future DOC-SYNC.
- TASKS.md, TESTS.md, CLAUDE.md updated as part of the doc-update step that contains this ADR reference.
- Reversible with a single `git revert` over the POLISH-01 commit. No data migration, no schema change, no credential format change.

## 2026-04-17 — D029 — POLISH-02 hide legacy Profile Intelligence tab behind PERSONAL_USE

**Context:** M3-T4 smoke surfaced a red banner *"Knowledge engine not initialized. Please ensure API keys are configured."* on Settings → Profile Intelligence. The banner originates from the **upstream Natively persona engine** — a commercial premium feature gated on `premium/electron/knowledge/KnowledgeOrchestrator` and `KnowledgeDatabaseManager`, neither of which exist in the open-source fork. The renderer tab was rendering regardless and calling `AppState.knowledgeOrchestrator` (null), producing the red banner. This upstream Profile Intelligence feature is **distinct from** the M4 sensi Knowledge subsystem that lives at `electron/knowledge/*` (no `premium/` prefix) and ships as Settings → Knowledge.

**D029a — Use the existing `PERSONAL_USE` gate pattern (M0-T6 / D010), do not delete the code.**

M0-T6 established a compile-time `PERSONAL_USE = true as const` flag in `src/lib/config.ts` specifically to gate upstream commercial-product UI surfaces (trial modal, donation toaster, quota banner) without deleting the code. POLISH-02 extends that pattern by one more gate — the Profile Intelligence sidebar button + panel branch — keeping the deletion of the renderer components and IPC handlers as a possible future cleanup task (same as M1-T8 still-deferred cleanup of `NativelyApiSettings`, `FreeTrialModal`, etc.).

Rationale for gating vs deleting:
- **Compile-time-constant branch** — TypeScript + Vite constant-fold the `!PERSONAL_USE` branches to `false`, so the Profile Intelligence renderer code never ships in the optimized bundle. Zero runtime cost.
- **Optional reactivation** — if a future decision ever restores Profile Intelligence as a sensi-native feature (e.g. porting the persona engine to a non-premium-dependent form), flipping the gate re-enables the whole tab.
- **No handler deletion risk** — the profile IPC handlers in `electron/ipcHandlers.ts` (`profile:*`) remain registered but unreachable from the renderer. If a stray call from some other renderer surface ever invokes them, the existing null-orchestrator check returns a graceful error. No exceptions, no crashes.

**D029b — Three gates in one file, defense-in-depth.**

Single-file edit in `src/components/SettingsOverlay.tsx`:
1. Sidebar button render gated with `!PERSONAL_USE && (...)` — user cannot see the tab.
2. Panel branch render gated with `!PERSONAL_USE && activeTab === 'profile'` — defense-in-depth if `activeTab` is ever set programmatically elsewhere.
3. Mount effect redirects `initialTab='profile'` → `'general'` in personal-use mode — prevents deep-linking into the dead tab from external callers.

**D029c — The M4 sensi Knowledge subsystem is explicitly preserved.**

Settings → **Knowledge** tab (`<KnowledgeSettings />` component, `electron/knowledge/*` subsystem, shipped M4-T1..T11 + KNOWLEDGE-FIX-01/02/03) is untouched. User-visible surfaces are now unambiguous:
- **Knowledge** = the working, shipping sensi RAG subsystem (ingest, list, pin, preview, export/import)
- **Profile Intelligence** = hidden upstream-legacy premium feature, unreachable

**Consequences:**
- 1 production file modified (`src/components/SettingsOverlay.tsx`), ~20 LOC net delta (import + 3 gates + comments).
- Zero new tests needed — compile-time constant-folded branch; M3-T4 smoke already validated the runtime behavior.
- Zero IPC, preload, DB schema, provider, credential, trust-boundary changes.
- SECURITY.md NOT updated: no trust-boundary change.
- ARCHITECTURE.md NOT updated: no module ownership change; Profile Intelligence is still owned by the upstream-legacy `premium/` tree (still absent), Knowledge is still owned by `electron/knowledge/`.
- TESTS.md / PRD.md / CLAUDE.md NOT updated: no test delta, no milestone scope change, no workflow rule change.
- TASKS.md updated with the POLISH-02 entry containing this ADR reference.
- Reversible: flip `PERSONAL_USE` to `false` or `git revert` the 3 gates to restore the Profile Intelligence tab.
- Forward note: the full deletion of the Profile Intelligence renderer component (`src/components/SettingsOverlay.tsx` profile-panel JSX, profile-related state hooks, preload bridge, main-side handlers) is a larger narrow task for a future cleanup pass — same spirit as M1-T8's still-deferred upstream-component deletion queue. Out of scope for POLISH-02.

---

## 2026-04-17 — D030 — M5-T6 RollingTriggerPolicy dispatch binding semantics

**Context:** M5 Pass 1 (M5-T4 + M5-T5) landed a pure `SilenceDetector` + `RollingTriggerPolicy` and persisted the `rollingTriggerMode` setting via a typed IPC surface, but the policy was not yet consulted anywhere — the persisted setting had no effect on behavior. M5-T6 closes that gap by binding the policy into `IntelligenceEngine`'s live dispatch path. Four semantic choices had to be pinned down before wiring.

**D030a — `mode === 'off'` suppresses BOTH auto-triggers (silence AND refinement classifier).**

Before M5-T6, the only auto-trigger firing in production was the intent-classifier path in `IntelligenceEngine.handleTranscript`: when a user segment matches a refinement pattern (`/make it longer/`, `/rephrase that/`, etc.), `runFollowUp` is auto-invoked to edit the last assistant message. The M5-T6 binding adds a second auto-trigger — the silence-based `runWhatShouldISay` dispatch.

When the user selects `'off'`, the contract must be *"off means really off"*: neither auto-path fires. Without gating the refinement classifier on the mode, "off" would still auto-fire `runFollowUp` on refinement utterances, which would violate the user's explicit choice. Implementation: the pure helper `shouldRunRefinementClassifier(mode)` returns `mode !== 'off'` and gates the existing refinement-intent branch in `handleTranscript`.

Rejected alternative: gate only the silence trigger on mode, leave refinement always-on. Rejected because "I turned auto off but the app keeps firing responses" is exactly the bug report this mode exists to prevent.

**D030b — `mode === 'on-demand'` does NOT suppress the refinement classifier.**

Refinement (`runFollowUp`) edits the **last assistant message** — it's user-intent-driven text manipulation, not a new rolling response. Treating it as a rolling-class auto-trigger would conflate two distinct mechanisms. When the user selects `'on-demand'`, the contract is: "no new rolling responses fire automatically; only the keyboard shortcut / UI button fires one." Refinement is not a rolling response, so it stays active. This keeps on-demand mode useful for users who want controlled auto-answer dispatch but still want the refinement experience ("make it shorter" → edits the last answer).

Rejected alternative: treat on-demand the same as off (suppress everything). Rejected because it collapses the two modes into a behavior difference of just "manual trigger allowed or not," which is already covered by `policy.triggerOnDemand()` gating at the entry point.

**D030c — Continuous 300ms tick driver, not start/stop on session lifecycle.**

`IntelligenceEngine` is a long-lived singleton — one instance per app boot, not per meeting. The tick driver could be started/stopped on meeting lifecycle events (`isMeetingActive` → true / false), but that would require threading lifecycle notifications into the engine or exposing start/stop methods that `main.ts` calls at meeting boundaries. Simpler alternative chosen: let the tick run continuously at 300ms for the lifetime of the engine. The cost is a single `setInterval` callback that calls a pure function returning `null` in 99.9% of cases.

Guards that make continuous ticking cheap and correct:
- `SilenceDetector.isSilent()` returns `false` before the first `noteFinalSegment` — so pre-meeting ticks never fire.
- `RollingTriggerPolicy.shouldFireOnSilence()` returns `null` if `streamInFlight` or `firedForCurrentSilenceAt !== null` — so post-fire ticks and during-stream ticks never re-fire.
- `mode === 'off' | 'on-demand'` short-circuits at the top of `shouldFireOnSilence` — so non-silence modes pay only a mode comparison per tick.

This means: no meeting, no silence events, no redundant timers to start/stop. If the tick ever becomes measurable on a profiler, swap it for `clearInterval`-on-meeting-stop later. Not premature.

Rejected alternative: drive the silence check from the transcript-event callback itself. Rejected because silence is a *gap between events* — there's no transcript event to trigger the check. The tick is the correct primitive for "time has passed without new events."

Rejected alternative: use `setTimeout` that re-arms after each fire. Rejected because the timing of the next final segment is unknown; re-arming on a fixed delay would miss silence periods that exceed the delay.

**D030d — `finally`-clause releases the in-flight guard on every exit path.**

`runWhatShouldISay` has four exit paths: success (return `fullAnswer`), aborted mid-stream (return `null`), API-key-missing fast-path (return error-sentinel string), and catch block (return error-sentinel string). If the in-flight guard (`markStreamStarted` / `markStreamFinished`) is released in only the success path, a thrown exception permanently blocks all future silence triggers until the app restarts — a severe usability regression that only manifests after the first error.

Using `try { ... } finally { this.rollingPolicy.markStreamFinished(); }` guarantees the release on every exit, including uncaught throws. The `markStreamFinished` call is idempotent (just a boolean flip), so calling it after successful completion is safe. This is the same pattern used throughout Node.js `finally` cleanup for resource release.

Rejected alternative: wrap every return statement manually with a release call. Rejected as error-prone; adding a new return path in the future without updating the release pattern would re-introduce the permanent-block bug.

**D030e — No full-engine integration test (D022 policy re-affirmed).**

The IntelligenceEngine constructor pulls in `LLMHelper`, which instantiates the full GoogleGenAI / Groq / OpenAI / Anthropic / sharp client stack. Instantiating even a stub engine in unit tests runs afoul of the same reasoning as D022 (no jsdom for renderer tests): the test setup cost and the maintenance burden exceed the benefit.

The M5-T6 wiring logic is small and each piece has a pure-test-friendly contract:
- Transcript feed → `policy.noteSegment({isFinal, timestampMs})`: contract verified by the M5-T5 tests that already exercise `noteSegment` with final and interim segments.
- Tick driver → `policy.shouldFireOnSilence()` / `markFiredOnSilence()` / dispatch: contract verified by the new M5-T6 dispatch-binding test that simulates 5x 300ms ticks during a single lull and asserts one fire with debounce.
- In-flight wrap → `markStreamStarted` / `finally`-release: contract verified by the M5-T5 in-flight-guard test that covers the block-then-unblock sequence.
- Reset propagation → `policy.reset()` on engine reset: contract verified by the M5-T5 reset test.
- Intent-classifier gate → `shouldRunRefinementClassifier(mode)` pure helper: exported and tested directly in M5-T6.

The remaining uncovered wiring is *mechanical* (the engine calls through to the policy in the right places). That's covered by TASKS.md M5-T6's manual smoke flow: set mode=off, speak a refinement phrase, verify no runFollowUp fires; set mode=on-silence, pause past threshold, verify one runWhatShouldISay fires; repeat with mode=on-demand and verify only the keyboard shortcut fires.

**Consequences:**
- 3 production files modified: `electron/IntelligenceEngine.ts`, `electron/IntelligenceManager.ts`, `electron/ipcHandlers.ts` (the last is a no-op on the existing `(engine as any).setRollingTriggerMode?` call that now resolves to a real method).
- 1 test file modified: `electron/__tests__/providers.test.ts` — 5 new tests (3 pure gate + 2 dispatch-binding contract).
- Zero IPC surface change, zero preload change, zero DB schema change, zero credential or trust-boundary change.
- SECURITY.md NOT updated: no trust-boundary change.
- ARCHITECTURE.md NOT updated: the IntelligenceEngine module's responsibilities are unchanged (orchestrates LLMs based on session state); the policy is a private internal collaborator, not a new architectural surface.
- PRD.md updated: M2 "configurable trigger cadence" deliverable now marks as shipped.
- CLAUDE.md updated: active milestone line reflects M5-T6 closed, M5-T8 pending.
- TESTS.md updated: test count 259 → 264.
- Reversible: `git revert` the 3 production-file commits restores the Pass 1 state (persisted-but-unread setting); Pass 1 + the test file changes are independent and can stay.
- Forward note: Pass 3 (M5-T8) adds the renderer UI mode selector. Then M5 closes. PRD-vs-TASKS milestone-numbering drift is a separate DOC-SYNC task.

---

## 2026-04-17 — D031 — PACKAGING-01 Pass A + A.5: auto-updater default, publish owner fix, icon regeneration, unsigned-installer posture

**Context:** sensi is about to ship its first installer (v2.4.0). The existing electron-builder + electron-updater wiring has been in the codebase since the Natively fork, but was never exercised end-to-end because (a) the publish `owner` in [package.json](package.json) pointed at a stale handle (`tobyjoe`, real repo is `tobyjoe4life/sensi`), (b) the auto-updater was gated behind `SENSI_ENABLE_UPDATER=true` so packaged builds would not check for updates, and (c) every icon asset still carried the upstream Natively "N" lettermark because POLISH-01 explicitly deferred PNG/ICO regeneration.

Bundled into one decision record because they're the same narrow release-prep pass and share rationale (ship-readiness).

**D031a — Auto-updater default flipped for packaged builds (supersedes D005 default, retains D005 rationale).**

D005 originally set the updater default to off-unless-opted-in with env var `SENSI_ENABLE_UPDATER=true`. That decision was correct for the audit phase (no stray network calls to the GitHub feed while inspecting the fork), but ships the app with zero OTA capability — users on v2.4.0 would have no path to future versions.

PACKAGING-01 changes the gate from `if (env var not set) return` to `if (!app.isPackaged && env var not set) return`. Packaged builds always check; dev builds stay silent. The env-var opt-in is preserved for developer override. Rationale:

- Audit-phase concern (no silent network calls) only applies to dev iteration — packaged builds serve real users who need updates.
- The check runs once per launch with a 10-second delay, hits a single GitHub API endpoint, and fails silently on error — low blast radius.
- `electron-updater` honors `autoDownload = false` (already set), so an update check that finds a new version will notify but not download without user click. The user retains veto control.

Rejected alternative: ship with the updater off and rely on users to manually download v2.4.1 from the GitHub releases page. Rejected because it defeats the entire purpose of the OTA infrastructure and doesn't scale past the first manual release.

**D031b — Publish owner corrected to match the real GitHub remote.**

The `publish.owner` field in `package.json` must match the GitHub `owner` segment of the repo URL. Previously `tobyjoe`, now `tobyjoe4life`. Without this, `electron-updater` fetches `https://api.github.com/repos/tobyjoe/sensi/releases/latest` and 404s, producing a silent "no updates available" result. The correct owner was visible from `git remote -v` (`origin https://github.com/tobyjoe4life/sensi.git`) — a simple audit miss from the pre-M0 fork setup.

No ADR alternatives — this is a plain correctness fix. Recorded here only because it's a prerequisite for D031a to function.

**D031c — Icon regeneration: one SVG source, rasterized to every platform ladder.**

POLISH-01 (D028b) replaced the in-app SVG glyph with the `SensiMark` brush-s monogram but explicitly deferred the PNG / ICO / ICNS regeneration (Risk #3) because the design was fresh and a code-authored SVG might need tuning before being committed to the installer icon. After user approval of the current glyph in POLISH-01a (rendering at 18×18, 32×32, 64×64 all crisp), PACKAGING-01 commits to regenerating the full size ladder.

Implementation choices:

- **Single source of truth inline in the generator script.** The brushstroke path is duplicated from `src/components/SensiLogoMark.tsx` into `scripts/generate-icons.js`. The script does not import the TSX at runtime (no React, no compile step). The trade-off is that editing the glyph requires changing both files — acceptable because the glyph is stable post-POLISH-01 and both files have a comment pointing at the other. An alternative — parsing the TSX at build time — would require a JS runtime + AST walker and is overkill for a handful of path commands.
- **Per-target-size SVG rasterization.** sharp's `density` parameter scales the intermediate bitmap before resize; at 512 px target with density=1152 the intermediate hits 16384² = 268M pixels, which blows past sharp's default pixel cap. The script builds the SVG with `width=size, height=size` each render so sharp rasterizes directly at the target — no intermediate overflow, simpler code.
- **10-resolution Windows .ico** (16, 20, 24, 32, 40, 48, 64, 96, 128, 256). 256 is mandatory for Windows 10+ Alt-Tab and large thumbnails. 20/24/40 fill intermediate scaling tiers that Windows picks for different DPI settings. The 16 px rendering is tested and readable — the brushstroke glyph holds up at that size because the circle + single-stroke S are high-contrast primitives.
- **.icns generation guarded by `process.platform === 'darwin'`.** `iconutil` only ships with macOS. On Windows/Linux the script skips ICNS generation and leaves `assets/icon.icns` untouched. Because this release is Windows-first, that's acceptable — macOS builds are deferred per PACKAGING-01 scope, and when a mac build pass happens, the same script runs on a mac to emit the ICNS.
- **Assets checked into git.** The generated PNGs + ICO are committed. Rationale: the build process (`npm run dist`) doesn't invoke `npm run icons` automatically, so a fresh clone must have the assets already present. Regeneration is explicit via `npm run icons` when the glyph changes.

Rejected alternative: use `electron-icon-builder` or `app-builder-lib` icon helpers as a build step. Rejected because it pulls in a larger dependency tree and couples icon generation to the build. One-shot script + checked-in assets is simpler and auditable.

**D031d — Windows installer ships unsigned for v2.4.0; user-visible warning accepted.**

Code signing certificates for Windows cost $100-300/yr (EV certs higher). For a personal-use fork used by a single developer, the cost-benefit is negative today — the user can click through the SmartScreen "Unknown publisher" warning once per install, and the OTA update flow uses the already-installed app's trust boundary (no re-prompt on update install).

Posture recorded in SECURITY.md as a residual risk (R13, new). The CHANGELOG v2.4.0 entry calls out the warning so users know what to expect on first install. A future decision (D-future) will revisit when sensi has more than one user or becomes untrusted-input-bearing.

Rejected alternative: delay v2.4.0 ship until a code-signing cert is procured. Rejected because the "app disappeared during an interview" pain motivates shipping the installer now, and the SmartScreen click-through is a minor one-time friction.

**D031e — Scope fence: no behavior change beyond icons + auto-updater.**

PACKAGING-01 Pass A + A.5 does NOT include:

- RCA of the "app disappeared" regression (no repro, no diagnosis; existing tray "Show sensi" item is the escape hatch).
- Modifying the stealth / disguise-mode logic (the mac-only tray-hide does not affect Windows).
- Adding crash-reporter / electron-log persistent sinks (the existing `sensi_debug.log` is sufficient for personal-use triage).
- Renderer-level feature changes (UI, settings, overlay).
- Any provider or LLM change.

These are deliberate deferrals. The intent is: ship a working installer, verify OTA works end-to-end with a trivial v2.4.1, then continue feature work via OTA deliveries.

**Consequences:**

- 4 production config/code files modified: `package.json`, `electron/main.ts`, `electron/WindowHelper.ts`, `CHANGELOG.md`.
- 1 new script file: `scripts/generate-icons.js`.
- 16+ regenerated binary assets (Windows ICO, Linux PNG ladder, top-level icon.png, src/components/icon.png).
- 1 deleted file: `assets/natively.icns`.
- 1 new devDependency: `png-to-ico@^3.0.1`.
- SECURITY.md updated with R13 (unsigned Windows installer residual).
- CLAUDE.md updated: active milestone reflects PACKAGING-01 Pass A + A.5 closed, Pass B next (local build smoke), Pass C (GitHub publish), Pass D (OTA smoke).
- PRD.md NOT updated (no milestone scope change).
- ARCHITECTURE.md NOT updated (no module ownership change).
- TESTS.md NOT updated (no test delta — icon generation is a one-shot script; behavior verification is the manual smoke in Pass B).
- Reversible: `git revert` the commit restores dev-only-updater + stale owner + upstream icons. Not a one-way door.
- Forward note: Pass B builds + smokes the installer locally. Pass C publishes v2.4.0 to GitHub. Pass D validates OTA with a v2.4.1 trivial change. Pass E is the ongoing cadence (tag + publish per milestone close).

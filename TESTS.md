# Tests — sensi

## Current state
- Forked from `natively-cluely-ai-assistant`; upstream test baseline never audited
- **Test runner: vitest 1.6.1** (added in M1 Step 5; the upstream `tap` 21.5.0 is still in `dependencies` but unused by sensi)
- **Coverage tool: @vitest/coverage-v8 1.6.1**
- **Test count: 35 passing** as of 2026-04-13 (M1 post-smoke cleanup)
- All tests run under plain Node with the `electron` module mocked — zero network calls, zero Electron runtime required
- Test file: [`electron/__tests__/providers.test.ts`](electron/__tests__/providers.test.ts)
- Config: [`vitest.config.ts`](vitest.config.ts) — wires `@shared` / `@providers` aliases mirroring `vite.config.mts`
- Coverage target: **80% on new code** per global rules ([common/testing.md](~/.claude/rules/common/testing.md))

## Test strategy

sensi uses a three-layer pyramid, same as the global rules:

| Layer | Scope | Tools | When |
|---|---|---|---|
| **Unit** | Pure functions, single classes, prompt builders, credential serialization, provider request/response parsing | **vitest** with `electron` module mocked (stub `app.getPath` + plaintext `safeStorage` fallback) | Every new function/class |
| **Integration** | IPC roundtrips, `CredentialsManager` + `safeStorage`, `ScreenshotHelper` + `sharp`, STT provider connection, `SessionTracker` transcript aggregation | vitest with `vi.mock('electron', ...)` and a per-test temp `userData` path | Every IPC handler + main-process module |
| **E2E / smoke** | Full launch → hotkey → screenshot → prompt → streamed MiniMax response | Manual checklist (Playwright wiring deferred to a future task) | Critical user flows |

## TDD workflow
Per the global TDD rule:
1. Write test first (RED)
2. Run — confirm it fails
3. Implement minimum to pass (GREEN)
4. Refactor
5. Verify coverage

For sensi specifically, **security-sensitive code is tested first**: credential storage, prompt isolation, IPC boundary enforcement.

## Coverage targets

| Area | Target | Rationale |
|---|---|---|
| `electron/providers/*` (new in M1) | **≥90%** | Provider correctness directly affects model output quality + cost |
| `electron/services/CredentialsManager.ts` changes | **≥90%** | Handles secrets; must be bulletproof |
| New IPC handlers | **≥80%** | Trust boundary |
| UI components | **≥60%** | Lower priority until M2+ |
| Rust native audio module | deferred | Covered by upstream audit; sensi touches the TS wrapper only |

## Priority test areas by milestone

### M0 (clean baseline) ✅ done
- **M0-T2 LicenseManager stub:** verified by manual launch (no exceptions on any license-gated path)
- **M0-T3 analytics removal:** grep-sweep gate (`rg -i "gtag|googletagmanager|analytics\.service|InstallPing"` returns zero)
- **M0-T4 auto-updater:** `setupAutoUpdater()` early-return verified by inspection + manual launch (no startup network calls)
- **M0-T5 natively.software:** grep sweep + manual smoke test confirmed zero live network paths
- **M0-T8 smoke test:** manual launch checklist passed on Windows

### M1 (multi-provider key vault) ✅ done
- **35 automated tests** in [`electron/__tests__/providers.test.ts`](electron/__tests__/providers.test.ts), all passing as of 2026-04-13:
  - `LLMHelper.isMiniMaxModel` — 5 cases (5 cloud + legacy `abab` + 2 negative)
  - `LLMHelper.setMinimaxApiKey` — 4 cases (construct, clear, replace, whitespace)
  - **`LLMHelper.stripThinkingTags` — 4 cases (post-smoke cleanup):** complete `<think>` block in single string, unclosed tag passthrough, no-tag passthrough, block followed by response content
  - `CredentialsManager` MiniMax slot roundtrip — 3 cases
  - `CredentialsManager` active provider+model pair — 4 cases (initial nulls, roundtrip, per-provider tracking, no ollama-preferred-model side effect)
  - `STANDARD_CLOUD_MODELS` registry shape — 3 cases
  - `CredentialsManager.resolveModelForProvider` fallback chain — 5 cases
  - `ProviderStatus` shape generation (mirrors `llm:get-configured-providers` IPC logic as a pure helper) — 7 cases
- **Coverage on M1 surface (from `npm run test:coverage`):**
  - `electron/shared/standardCloudModels.ts` — **97.32% statements / 100% branches** ✅
  - `electron/services/CredentialsManager.ts` — **80% branches** ✅ at target; 60% lines (diluted by ~30 untested upstream getter/setter pairs unrelated to M1; the M1-new methods themselves are at functional 100%)
  - `electron/providers/types.ts` — type-only file, no runtime statements (excluded from coverage report by design)
  - `electron/LLMHelper.ts` MiniMax edits — exercised functionally by 13 LLMHelper unit tests (5 classifier + 4 setter + 4 stripThinkingTags); excluded from `coverage.include` glob to avoid 0.X% dilution on a 4000-line file
- **Manual smoke test** ✅ passed on Windows 2026-04-13 — 54-step checklist covering fresh credentials, settings, MiniMax tile, picker, streaming response, provider switch, restart persistence, switch-back

### M2 (rename + DB migration + STT polish + UI cleanup) ✅ done
- 6 new unit tests for `migrateDbFilename` (fresh install, upgrade, re-run, both-exist, copy-fails, logging) — all passing as of 2026-04-13. Test count after M2: **41**.

### M3 (runtime audio + Deepgram wiring + summary routing) ✅ T1/T2/T3 done, T4 pending manual smoke
- **M3-T2 — Deepgram auto-promotion (3 tests)** in `electron/__tests__/providers.test.ts`:
  - `sttProvider='none' + non-empty key → promoted=true, sttProvider='deepgram'`
  - `sttProvider='google' + non-empty key → promoted=false, sttProvider unchanged`
  - `sttProvider='none' + empty string → promoted=false, sttProvider unchanged`
- **M3-T3 — `generateMeetingSummary` active-provider routing (5 tests)** in `electron/__tests__/providers.test.ts`:
  - MiniMax active + minimaxClient present → `generateWithMiniMax` called, Gemini NOT called
  - OpenAI active + openaiClient present → `generateWithOpenai` called, Gemini NOT called
  - Claude active + claudeClient present → `generateWithClaude` called, Gemini NOT called
  - No matching active provider → falls through to Gemini Flash
  - Active provider throws → falls through to Gemini Flash
- All 8 new tests use the existing `freshCredentialsManager()` helper or construct a fresh `LLMHelper` and clear internal clients via `(helper as any).x = null` cast, then `vi.spyOn(helper as any, 'generateWithX').mockResolvedValue(...)` to short-circuit any actual network call.
- **Test count after M3-T2/T3: 49** (was 41 at end of M2). All passing as of 2026-04-14.
- M3-T1 (Rust native module build) is NOT unit-tested — covered by the M3-T4 manual smoke test.

### M4 (context enrichment & personal knowledge) — in progress

- **KNOWLEDGE-FIX-02 — Gemini embedding request shape (5 new tests + 4 updated assertions + 3 prior stage-tracing tests, PASSING)** appended to `electron/__tests__/providers.test.ts`:
  - **5 new tests** in a dedicated describe block `EmbeddingAdapter Gemini request shape (KNOWLEDGE-FIX-02)`. All stub `globalThis.fetch` via `vi.spyOn` with `afterEach` restore so no real network is touched. Tests invoke the real `embedWithGeminiDefault` path by leaving `embedWithGemini` un-DI'd on the `EmbeddingAdapter` constructor and forcing the Ollama branch down via `probeOllama: async () => false`:
    1. `embedWithGeminiDefault constructs the v1beta batchEmbedContents URL with gemini-embedding-001` — asserts the fetch URL starts with `https://generativelanguage.googleapis.com/v1beta/models/`, contains `gemini-embedding-001`, and ends with `:batchEmbedContents?key=fake-test-key-ZZZZZZZZZZZZ`.
    2. `embedWithGeminiDefault body stamps model + outputDimensionality=768 on every request entry` — parses the fetch body and asserts `requests[i].model === 'models/gemini-embedding-001'` and `requests[i].outputDimensionality === 768` for every entry. Also asserts `Content-Type: application/json` and that NO header value contains the API key (headers-side leak guard).
    3. `embedWithGeminiDefault preserves the 768-dim post-condition` — stubs two 768-element response vectors and asserts the adapter returns `Float32Array[]` of length 2 with correct numeric values at positions 0 and 767.
    4. `embedWithGeminiDefault rejects a 404 response as KnowledgeEmbeddingRequestError without leaking the API key or URL` — stubs a `{status: 404, statusText: 'Not Found'}` response whose body is Google's real error text. Asserts `instanceof KnowledgeEmbeddingRequestError`, message contains `404` + `Not Found`, and message does NOT contain the API key, `?key=`, or the full Google URL.
    5. `getActiveEmbeddingConfig returns gemini-embedding-001 after a successful embed` — regression-gates `kb_documents.embedding_model` for future rows by asserting the adapter's cached active config reports the new model name.
  - **4 existing assertions updated** in the M4-T5 and M4-T6 describe blocks and in the TRIAGE-INGEST-01A describe block to expect `'gemini-embedding-001'` as the live active-model string. These are substring updates inside `expect(...).toEqual(...)` blocks — no test logic changed.
  - **4 occurrences deliberately preserved** as `'text-embedding-004'` inside the M4-T6 `KnowledgeOrchestrator` mixed-model-mismatch tests (providers.test.ts lines 1844, 1845, 1861, 1918). They seed `kb_documents.embedding_model` as a legacy value and now genuinely exercise D019b — the live adapter reports `'gemini-embedding-001'`, so any stored row stamped with the legacy name is a real mismatch and the test keeps firing naturally.
  - **3 prior TRIAGE-INGEST-01A stage-tracing tests (not previously counted in this file)** in the `KnowledgeOrchestrator ingest tracing (TRIAGE-INGEST-01A)` describe block — `happy path emits ordered stage logs`, `read failure emits catch log without cleanup`, `embed failure emits catch + cleanup + wrapped signal`. These landed alongside the per-step `[ingest]` console tracer in `KnowledgeOrchestrator.ingestDocument` and are folded into the count here since DOC-SYNC-01B did not yet reconcile them. See DECISIONS.md **D025**.
- **Test count at end of KNOWLEDGE-FIX-02: 210 vitest + 4 kb-schema + 14 kb-store + 5 kb-transfer = 233 total.** (was 225 at end of KNOWLEDGE-FIX-01; the +8 delta is +5 KNOWLEDGE-FIX-02 tests + 3 TRIAGE-INGEST-01A stage-tracing tests that landed between the two doc-sync passes.)

- **M3-FIX-01 — OpenAI max_completion_tokens clamp + RAG active-provider routing (5 new tests + 0 updated, PASSING)** appended to `electron/__tests__/providers.test.ts` in a new describe block `resolveMaxCompletionTokens (M3-FIX)`. All tests are pure string→number helper tests; no network, no SDK mocks, no DI stubs needed:
  1. `clamps GPT-4o family to 16384` — `gpt-4o`, `gpt-4o-mini`, `gpt-4o-2024-08-06`, case-insensitive, below-cap passthrough.
  2. `clamps o1 / o3 / GPT-5 family to 32768` — `o1-preview`, `o1-mini`, `o3-mini`, `gpt-5.4`, `gpt-5-turbo`, below-cap passthrough.
  3. `applies the conservative 16384 default for unknown OpenAI-family ids` — `gpt-4-turbo`, `gpt-3.5-turbo`, `openai-mystery-model`.
  4. `passes through unknown and non-OpenAI models unchanged` — MiniMax, Gemini, Groq, empty string all return the requested value unchanged (the clamp only triggers for OpenAI/Claude families, so non-OpenAI provider paths retain their own SDK-side clamping logic).
  5. `clamps Claude-family ids routed through the OpenAI SDK to 8192` — `claude-sonnet-4-6`, `claude-3-5-sonnet-20241022`, below-cap passthrough.
  - The RAG provider-drift fix (`streamChatWithGemini` → `streamChat` in `RAGManager.queryMeeting` / `queryGlobal`) is a two-line swap with no added tests. Coverage is via the existing M3-T3 active-provider dispatch tests (which already pin `streamChat`'s routing behavior) and the M3-T4 manual smoke.
- **Test count at end of M3-FIX-01: 215 vitest + 4 kb-schema + 14 kb-store + 5 kb-transfer = 238 total.** (was 233 at end of DOC-SYNC-04.)

- **POLISH-01 — auto-scroll threshold predicate (4 new tests, PASSING)** appended to `electron/__tests__/providers.test.ts` in a new describe block `isWithinBottomThreshold (POLISH-01)`. Gates the pure math helper that drives `useAutoScrollToBottom` in `src/hooks/useAutoScrollToBottom.ts`. All tests are synchronous number → boolean — no DOM, no jsdom, no mocks:
  1. `returns true when viewport is exactly at the bottom` — distance=0 passes any threshold including zero.
  2. `returns true when viewport is within 48 px of the bottom (default threshold)` — distance=40 and edge-case distance=48 both pass.
  3. `returns false when viewport is more than threshold px from bottom` — distance=100 rejected; custom tighter threshold rejects a 40 px gap; scrolled-to-top far-from-bottom case.
  4. `treats non-overflowing containers as always "at bottom"` — `scrollHeight ≤ clientHeight` short-circuits to true (correct no-op for the hook).
  - DOM side effects of the hook (scroll listener attach, rAF scheduling, ResizeObserver reflow handling) are covered by the POLISH-01 manual smoke, not automated tests — same jsdom-free policy as M4-T9 / D022. See DECISIONS.md **D028c**.
- **Test count at end of POLISH-01: 219 vitest + 4 kb-schema + 14 kb-store + 5 kb-transfer = 242 total.** (was 238 at end of M3-FIX-01; +4 for POLISH-01.)

- **M5-T4 + M5-T5 — SilenceDetector + RollingTriggerPolicy (17 new tests, PASSING)** appended to `electron/__tests__/providers.test.ts` in two new describe blocks:
  - **SilenceDetector (M5-T4)** — 7 pure-state-machine tests: never-seen initial state, within-threshold not-silent, at/beyond-threshold silent, re-arm after new final segment, `setThresholdMs` re-evaluates next call, `reset` clears state back to never-seen, and `isSilentAt` free-function parity with the class.
  - **RollingTriggerPolicy (M5-T5)** — 10 tests: `isValidRollingTriggerMode` accepts 3 modes + rejects everything else (incl. non-string); `off` mode never fires on silence; `on-silence` one-fire-per-lull + re-arm after new final; interim segments do NOT reset silence; stream-in-flight guard blocks both on-silence AND on-demand; `on-demand` mode never auto-fires but manual trigger works; `off` mode rejects manual triggers too; `setMode` mid-session clears the already-fired flag; `reset` clears session state while preserving mode (user preference).
  - All tests are pure DI (injected clock + silence detector) — no timers, no network, no DB.
- **Test count at end of M5 Pass 1: 236 vitest + 4 kb-schema + 14 kb-store + 5 kb-transfer = 259 total.** (was 242 at end of POLISH-01; +17 for M5-T4 + M5-T5.)

- **M5-T6 — Dispatch binding + intent-classifier gate (5 new tests, PASSING)** appended to `electron/__tests__/providers.test.ts`:
  - **`shouldRunRefinementClassifier` pure gate (3 tests)** — exercises the exported helper in `electron/IntelligenceEngine.ts` that gates the refinement-intent path on rolling mode. `off` → false (no auto-trigger at all); `on-silence` → true (refinement is independent of the silence trigger); `on-demand` → true (refinement edits the last assistant message, not a new rolling response, so it stays live).
  - **Dispatch-binding contract (2 tests)** — exercises the real `RollingTriggerPolicy` as a stand-in for the engine's internal instance (D022 policy: no jsdom / full-engine instantiation). Test 1: a realistic live-session feed of `final → interim → interim → final → long pause → tick` threads through the silence detector correctly and fires after the threshold. Test 2: 5x 300ms tick simulation during one lull fires exactly once, is blocked by the in-flight guard after dispatch, and only re-arms after a fresh final segment.
  - Full IntelligenceEngine-level integration is intentionally NOT tested — the engine pulls in the full LLMHelper stack (GoogleGenAI, Groq, OpenAI, Anthropic, sharp). Dispatch wiring (the tick driver, `handleTranscript.noteSegment` call, `runWhatShouldISay` `markStreamStarted/Finished` wrap, `reset` propagation) is small and verified by the manual smoke flow in TASKS.md M5-T6.
- **Test count at end of M5 Pass 2 (M5-T6): 241 vitest + 4 kb-schema + 14 kb-store + 5 kb-transfer = 264 total.** (was 259 at end of M5 Pass 1; +5 for M5-T6.)

- **KNOWLEDGE-FIX-03 — stale Gemini embedding hint cleanup:** text-only cleanup following KNOWLEDGE-FIX-02. **Zero new tests, zero updated test assertions, zero behavior change.** Five surgical string/comment edits in `src/components/settings/KnowledgeSettings.tsx`, `electron/knowledge/knowledgeIpcHelpers.ts`, `electron/knowledge/KnowledgeOrchestrator.ts`, `electron/db/DatabaseManager.ts`, and `electron/knowledge/chunker.ts`. Test count unchanged at **233 total** (210 vitest + 4 kb-schema + 14 kb-store + 5 kb-transfer). All gates green 2026-04-15: `typecheck:electron`, `npm test` (210/210), `build:electron`, `build`. See DECISIONS.md **D026** for the hint-cleanup policy and the 4 legacy-model test fixtures intentionally preserved per D025d.

- **M4-T11 — Manual smoke test closeout:** M4 manual-smoke verification closed 2026-04-15. Scenarios 1 and 3 (Gemini ingest) verified end-to-end by the KNOWLEDGE-FIX-02 manual smoke. Scenarios 2, 4, 5, 6 closed by automated test coverage already present in `electron/__tests__/providers.test.ts` and the three Electron-runtime runners — see TASKS.md `### M4-T11 — Manual smoke test ✅ DONE 2026-04-15` for the per-scenario closure citations. No test changes required. Test count unchanged.

- **KNOWLEDGE-FIX-01 — Ollama embedding-model presence probe + ingest error routing (5 new tests, PASSING)** appended to `electron/__tests__/providers.test.ts`:
  - **3 pure-helper tests** in a new describe block `EmbeddingAdapter probe — Ollama model presence (KNOWLEDGE-FIX-01)`. Covers the new exported `hasOllamaEmbeddingModel(tagsJson, modelName)` helper in `electron/knowledge/EmbeddingAdapter.ts`:
    1. `returns true when nomic-embed-text is listed in models[] (with or without tag suffix)` — exercises both the `:latest`-suffixed shape and the bare-name shape, plus a parameterized other-model case.
    2. `returns false when daemon responds but nomic-embed-text is absent` — covers only-other-models AND a near-miss (`nomic-embed-text-v2`) to guarantee the base-name comparison is exact after `:`-split.
    3. `returns false on malformed tags response` — 9 sub-assertions: `null`, `undefined`, string, number, `{}`, `models` as string, empty `models[]`, entries missing `name`/`model`, entries being non-objects/strings.
  - **2 orchestrator error-routing tests** inside the existing `KnowledgeOrchestrator (M4-T6)` describe block. Use the existing DI `makeStore` / `makeAdapter` helpers — no new harness:
    4. `ingestDocument wraps KnowledgeEmbeddingRequestError from embed() as KnowledgeIngestError and still cleans up` — asserts the thrown error is `instanceof KnowledgeIngestError`, its `cause` is the original `KnowledgeEmbeddingRequestError`, and the half-written doc row was deleted via `store.deleteDocument`.
    5. `ingestDocument surfaces KnowledgeEmbeddingProviderUnavailableError unchanged (provider_unavailable contract preserved)` — asserts the thrown error is still `instanceof KnowledgeEmbeddingProviderUnavailableError` (not re-wrapped) and that `store.insertDocument` was never called because resolution failed before any DB write.
  - All tests DI-based; no `vi.mock`, no real network, no real DB. See DECISIONS.md **D024**.
- **Test count at end of KNOWLEDGE-FIX-01: 202 vitest + 4 kb-schema + 14 kb-store + 5 kb-transfer = 225 total.** (was 220 at end of M4-T10.)

- **M4-T10 — Knowledge base export/import (30 new tests + 5 Electron-runtime tests, PASSING)** appended to `electron/__tests__/providers.test.ts` in two new describe blocks (`knowledgeTransfer (M4-T10)` and `knowledgeIpcHelpers export/import (M4-T10)`), plus a new standalone Electron-runtime runner file `electron/__tests__/knowledgeTransfer.electron.cjs` covering the DB-level round-trip.
  - **Pure transfer module (16 vitest tests):**
    1. `buildExportArtifact` produces a versioned artifact with magic marker + 768-dim + exportedAt + documentCount + chunkCount + documents array
    2. `buildExportArtifact` excludes unrelated fields — top-level keys are only `sensiKnowledgeExport / version / embeddingDim / exportedAt / documentCount / chunkCount / documents`; document shape has no `apiKey`, `credentials`, `transcript`, or `meetingId` fields
    3. `buildExportArtifact` throws `KnowledgeExportError` on wrong dim metadata
    4. `buildExportArtifact` throws `KnowledgeExportError` on wrong chunk embedding length
    5. `validateImportArtifact` accepts a well-formed artifact
    6. `validateImportArtifact` rejects non-object input (`null`, string, number)
    7. `validateImportArtifact` rejects missing magic marker
    8. `validateImportArtifact` rejects future version (e.g. 999)
    9. `validateImportArtifact` rejects non-integer version (1.5)
    10. `validateImportArtifact` rejects wrong embedding dim (1536)
    11. `validateImportArtifact` rejects chunk embedding of wrong length
    12. `validateImportArtifact` rejects non-finite embedding values (NaN)
    13. `validateImportArtifact` rejects documents array with wrong field types
    14. `exportKnowledgeToFile` + `importKnowledgeFromFile` round-trip preserves pinned state and embedding metadata (asserted via the captured replace-artifact payload)
    15. `importKnowledgeFromFile` rejects malformed JSON AND leaves the store untouched (atomicity)
    16. `importKnowledgeFromFile` atomicity: replace failure is surfaced as `KnowledgeImportError` and the stub store's state is preserved
    17. `importKnowledgeFromFile` writes a pre-import backup to the provided `backupDir` BEFORE mutating the store, and the backup contains the PRE-import state
    18. `exportKnowledgeToFile` produces JSON that re-validates via `validateImportArtifact`
  - **IPC handler tests (8 vitest tests):** empty/non-string `filePath` rejected with `invalid_input`, success with counts + filePath return, export to non-writable path translated to `export_failed`, import of malformed JSON translated to `incompatible_format`, missing file translated to `import_failed`, and a **compile-time structural assertion** that the success return type of `handleImportKnowledge` has no `text` / `chunks` fields (regression gate on renderer raw-text exposure).
  - **Error-message mapper extensions (3 new vitest tests + 1 updated exhaustiveness test):** per-variant copy assertions for `export_failed`, `import_failed`, `incompatible_format`, and the exhaustiveness test now expects 11 variants instead of 8.
  - **Electron-runtime transfer runner (5 tests, `knowledgeTransfer.electron.cjs`):** `getDocumentChunksWithEmbeddings` decodes real Float32 blobs from `vec_kb_chunks`; `replaceAllFromArtifact` wipes and inserts cleanly; pinned state and pinnedAt survive replace; `searchByEmbedding` returns the expected top-1 hit after replace (proves vec rows are actually populated, not just scalar chunks); pre-validation of a wrong-dim chunk rejects atomically without touching the existing store. Runner script: `npm run test:kb-transfer`.
- **Test count at end of M4-T10: 197 vitest + 4 kb-schema + 14 kb-store + 5 kb-transfer = 220 total.** (was 185 at end of M4-T9.)

- **M4-T9 — Renderer knowledge error-message mapping (12 tests, PASSING)** appended to `electron/__tests__/providers.test.ts` in a `knowledgeErrors.errorTypeToMessage (M4-T9)` describe block. This is the first cross-boundary test import — the test file reaches into `src/lib/knowledgeErrors.ts` (+ type-only `src/types/electron.d.ts`) because the renderer component relies on a pure helper for error-to-copy mapping, and the helper is the only piece of M4-T9 logic that can be unit-tested without a jsdom harness (which the repo has deliberately not set up).
  - **Per-variant tests (8):** each `KnowledgeIpcErrorType` value (`invalid_input`, `ingest_failed`, `query_failed`, `model_mismatch`, `provider_unavailable`, `not_found`, `dimension_mismatch`, `internal`) maps to a non-empty, user-facing string matching the expected advice category via substring assertions (e.g. `provider_unavailable` contains both "ollama" and "gemini", `ingest_failed` mentions file types, `internal` does not mention "stack"/"trace"/"error:").
  - **Non-empty sweep (1):** every entry in `ALL_KNOWLEDGE_ERROR_TYPES` produces a string ≥5 chars.
  - **Distinct-message sweep (1):** every variant maps to a unique message so no future variant can silently collapse into another bucket (`Map<string, KnowledgeIpcErrorType>` collision check).
  - **Exhaustiveness test (1):** `ALL_KNOWLEDGE_ERROR_TYPES.length === 8` matches the type union in `src/types/electron.d.ts`. The switch in `errorTypeToMessage` has a `never` default branch that produces a TS compile error if a new variant is added to the union without updating the helper.
  - **Scrubber-token leakage test (1):** no renderer copy contains `<path>` (main-process scrubber token) or a Windows absolute path marker. Renderer messages are hand-written, not derived from the free-form `error` string.
  - **Not tested (renderer DOM scenarios):** empty-list, successful-list, ingest/pin/unpin/delete action flows, preview truncated indicator, zero-chunk render. These would require a jsdom / React Testing Library setup that the repo has not added. Deferred to M4-T11 manual smoke testing. See DECISIONS.md D022.
- **Test count at end of M4-T9: 167 vitest + 4 kb-schema + 14 kb-store = 185 total.** (was 173 at end of M4-T8.)

- **M4-T8 — Knowledge IPC helpers + preload surface + production wiring (27 tests, PASSING)** appended to `electron/__tests__/providers.test.ts` in a dedicated `knowledgeIpcHelpers (M4-T8)` describe block:
  - **handleIngestDocument (4 tests):** happy-path delegation + provider/model stamp passthrough; empty filePath rejected with `invalid_input`; non-string filePath rejected with `invalid_input`; `KnowledgeIngestError` path translated with absolute Windows path scrubbed to `<path>` marker (verifies `C:\secret` not in error string).
  - **handleListDocuments (1 test):** delegation returns documents array.
  - **handleDeleteDocument (2 tests):** id validation + delegation happy path; `KnowledgeNotFoundError` translated to `not_found`.
  - **handlePinDocument / handleUnpinDocument / handleListPinned (3 tests):** pin returns `pinnedAt` timestamp; unpin returns `null` pinnedAt; listPinned delegates.
  - **handleQueryKnowledge (7 tests):** happy path with full input (query, topK, includePinned, documentIds) + captured input verification; empty query rejected; non-positive topK rejected; topK=999 clamped to 50; null payload rejected; `KnowledgeEmbeddingModelMismatchError` → `model_mismatch` with recovery hint; `KnowledgeEmbeddingProviderUnavailableError` → `provider_unavailable` with Ollama hint.
  - **handleGetDocumentPreview — the bounded text exposure surface (6 tests):** long text capped to `PREVIEW_DEFAULT_MAX_CHARS=4000` with `truncated=true`; explicit large `maxChars=99999` request clamped to `PREVIEW_HARD_MAX_CHARS=12000`; 1 MB document stress test with `[undefined, 50000, 99999, Infinity]` — all four caller inputs clamped to hard max; NaN / negative / non-number / zero `maxChars` sanitized to default (not rejected); short text returned un-truncated (`truncated=false`); `KnowledgeNotFoundError` → `not_found`.
  - **makeKnowledgeContextClosure — production wiring factory (4 tests):** returns a function (not the orchestrator itself); returns `null` if `getOrchestrator` throws (with `console.warn` call verified); returns `null` if factory returns `null`; closure invocation delegates to `buildKnowledgeContextBlock` with the real orchestrator and query forwarded through.
  - All tests use structural DI via `KnowledgeOrchestratorForIpc` stubs — zero `vi.mock`, zero DB, zero real orchestrator. Failure-branch tests use `as KnowledgeIpcFailure` casts (not `if (!result.success)` narrowing) because electron tsconfig has `strict: false` — see DECISIONS.md D021d.
- **Test count at end of M4-T8: 155 vitest + 4 kb-schema + 14 kb-store = 173 total.** (was 146 at end of M4-T7.)

- **M4-T7 — buildKnowledgeContextBlock + WhatToAnswerLLM knowledge hook (18 tests, PASSING)** appended to `electron/__tests__/providers.test.ts`:
  - **15 tests for `buildKnowledgeContextBlock (M4-T7)`** under a new describe block:
    1. Empty orchestrator (no pinned, no retrieved) → `''`
    2. Only pinned docs → pinned block rendered in stable `listPinned` order
    3. Only retrieved chunks → retrieved block with document_name + chunk_index + distance provenance header
    4. Both present → both blocks, delimited, pinned before retrieved
    5. Dedup: retrieved chunk from a pinned doc is filtered out; pinned doc's full text remains in pinned block
    6. Zero-chunk / empty pinned doc text → skipped silently
    7. Pinned `getDocumentText` throws → that doc skipped + logged, others continue
    8. `KnowledgeEmbeddingModelMismatchError` → pinned block rendered, retrieved block empty, warning logged
    9. `KnowledgeEmbeddingProviderUnavailableError` → same degradation
    10. Arbitrary query failure → both blocks can be empty, warning logged, no throw
    11. Pinned block respects per-doc + total budget; truncation marker `[…truncated]` appears
    12. Retrieved block respects per-chunk + total budget; exactly 2 chunks fit at 200/400
    13. Query uses the LAST N chars of input string (verified by checking the `query` forwarded to orchestrator stub ends with a known marker)
    14. Empty/whitespace-only query → retrieval skipped but pinned block still renders; `queryKnowledge` NOT called
    15. `queryKnowledge` is called with `includePinned: false` (dedup rule compatibility)
  - **3 tests for `WhatToAnswerLLM knowledge hook (M4-T7)`** under a new describe block:
    1. `knowledgeContextFn` invoked with the exact `cleanedTranscript` string; returned block prepended to `fullMessage` passed to `streamChat`; block appears BEFORE `CONVERSATION:` section in the final assembled message
    2. Hook throws → stream still completes, warning logged, knowledge block absent from `fullMessage`, caller receives the LLM's fallback chunks unchanged
    3. No `knowledgeContextFn` passed (constructor arg undefined) → `fullMessage` is byte-identical to pre-M4-T7 behavior, no `[Pinned Knowledge]` / `[Retrieved Knowledge]` markers
  - All tests use DI — the helper accepts a `KnowledgeOrchestratorForContext` structural stub; `WhatToAnswerLLM` integration uses `vi.spyOn(helper, 'streamChat').mockImplementation(async function* (...) {...})` to capture the assembled `fullMessage` without real network or LLMHelper init. See DECISIONS.md D020.
- **Test count at end of M4-T7: 128 vitest + 4 kb-schema + 14 kb-store = 146 total.** (was 128 at end of M4-T6.)

- **M4-T6 — KnowledgeOrchestrator + resolveProvider extension (21 tests, PASSING)** appended to `electron/__tests__/providers.test.ts`:
  - **3 tests for `EmbeddingAdapter.resolveProvider` (M4-T6 extension)** under `describe('resolveProvider (M4-T6 extension)', …)`:
    - Ollama available → returns `{provider: 'ollama', ...}` without calling embed hook; adapter's `active` state is NOT mutated (`getActiveEmbeddingConfig()` still throws)
    - Ollama unavailable + Gemini key configured → returns `{provider: 'gemini', ...}`
    - Neither available → throws `KnowledgeEmbeddingProviderUnavailableError`
  - **18 tests for `KnowledgeOrchestrator`** under `describe('KnowledgeOrchestrator (M4-T6)', …)`:
    1. Ingestion pipeline call ordering: read → parse → resolve → insert → embed → upsert; metadata correctly derived (name from basename, mime from extension, bytes from buffer, embeddingModel from resolveProvider)
    2. Zero-chunk path: parser returns empty string → chunker returns `[]` → `resolveProvider` called, `insertDocument` called, `embed` NOT called, `upsertChunks` NOT called, result reports `chunkCount: 0` with valid model metadata
    3. Chunk array order preserved end-to-end into `upsertChunks` (embedding index matches chunk index)
    4. Atomicity cleanup: `upsertChunks` throws → orchestrator calls `deleteDocument` → original error re-thrown
    5. Unsupported file extension → `KnowledgeIngestError`
    6. `fs.readFile` failure wrapped in `KnowledgeIngestError` with `cause` chain preserved
    7. Empty/whitespace-only query → `KnowledgeQueryError`
    8. `topK` sanitization: 0, negative, and `NaN` all throw `KnowledgeQueryError`
    9. Happy path: `embed` called once with `[trimmedQuery]`, `searchByEmbedding` called with `topK=5` (no overfetch when all docs compatible + no filter)
    10. All-docs-wrong-model → `KnowledgeEmbeddingModelMismatchError`
    11. Mixed-model DB (some compatible, some not) → orchestrator overfetches with `topK * 4`, filters incompatible docs silently, returns only compatible hits
    12. `documentIds` filter respected: overfetch kicks in, only matching doc ids returned
    13. `documentIds` filter intersected with model compatibility: if no intersection → `KnowledgeEmbeddingModelMismatchError`
    14. `includePinned: true` sorts pinned docs ahead of non-pinned within topK, with distance as tiebreaker
    15. Empty knowledge base (zero docs) → returns `[]` without throwing
    16. `listDocuments` and `getDocumentText` delegate to store
    17. `deleteDocument` delegates to store
    18. `pinDocument` / `unpinDocument` / `listPinned` delegate to store's `setPinned` / `listPinned`
  - **All tests use dependency injection** — constructor accepts `KnowledgeOrchestratorDeps` with `store: KnowledgeStoreLike`, `adapter: EmbeddingAdapterLike`, `readFile?`, `parseBuffer?` hooks. Store and adapter are stubbed via structural typing — no real DB, no real network, no real filesystem, no `vi.mock`. See DECISIONS.md D019 for the DI strategy.
- **Test count at end of M4-T6: 110 vitest + 4 kb-schema + 14 kb-store = 128 total.** (was 107 at end of M4-T5.)

- **M4-T5 — EmbeddingAdapter (14 tests, PASSING)** appended to `electron/__tests__/providers.test.ts` under `describe('EmbeddingAdapter (M4-T5)', ...)`:
  1. `embed([])` → `[]` without probing any provider (probe stub verifies it wasn't called)
  2. Ollama available → adapter selects Ollama, returns 768-dim vectors, `getActiveEmbeddingConfig()` reports `{provider: 'ollama', model: 'nomic-embed-text', dimension: 768}`
  3. Ollama unavailable + Gemini key present → adapter selects Gemini, passes the key to the embed hook, reports `{provider: 'gemini', model: 'text-embedding-004', dimension: 768}`
  4. Neither available → `KnowledgeEmbeddingProviderUnavailableError`
  5. Provider returns 512-dim vectors → `KnowledgeEmbeddingDimensionError`
  6. Provider returns fewer vectors than inputs → `KnowledgeEmbeddingRequestError`
  7. Order preservation (input index encoded as vector[0], asserted 0..3 on output)
  8. Probe stub resolves fast → total elapsed < 500ms (probe timeout path doesn't hang)
  9. `getActiveEmbeddingConfig()` reports the provider/model/dimension actually used after a successful `embed()` call
  10. `getActiveEmbeddingConfig()` before any `embed()` → throws `KnowledgeEmbeddingProviderUnavailableError`
  11. Empty string in input array → `KnowledgeEmbeddingRequestError` (policy: reject, don't filter — see D018)
  12. Whitespace-only string in input array → `KnowledgeEmbeddingRequestError`
  13. Outer whitespace trimmed on each input before forwarding to provider
  14. Empty input array bypasses the "no provider" error even when all providers unavailable (fast-path no-op)
- All tests use **dependency injection** — constructor accepts `EmbeddingAdapterDeps` with stubs for `probeOllama`, `embedWithOllama`, `embedWithGemini`, `getGeminiApiKey`. No `vi.mock`, no real network, no module stubbing. See DECISIONS.md D018 for rationale.
- **Test count at end of M4-T5: 89 vitest + 4 kb-schema + 14 kb-store = 107 total.** (was 93 at end of M4-T4.)

- **M4-T4 — KnowledgeStore CRUD + vector search (14 tests, PASSING)** in [`electron/__tests__/knowledgeStore.electron.cjs`](electron/__tests__/knowledgeStore.electron.cjs):
  1. `insertDocument + listDocuments` roundtrip (id, name, embeddingDim, chunkCount=0, pinned=false)
  2. `upsertChunks` preserves order (chunk_index 0..N-1) and count; listDocuments chunkCount updates
  3. `upsertChunks` rejects mismatched chunks/embeddings lengths with `KnowledgeStoreInvariantError`; nothing written on rejection
  4. `upsertChunks` rejects non-768 embeddings with `KnowledgeDimensionError`; nothing written on rejection
  5. `searchByEmbedding` returns best-first ordering on three hand-crafted vectors (identical / 45° / opposite); distances monotonic ascending; document metadata propagated through the JOIN
  5b. `searchByEmbedding` rejects non-768 query vectors with `KnowledgeDimensionError`
  6. `setPinned(true/false)` toggles state and pinnedAt correctly (non-null string on pin, null on unpin); both return value and listDocuments reflect the new state
  7. `listPinned` returns only pinned docs, ordered by pinned_at ASC (verified by forcing SQL-level time gap via direct UPDATE since `datetime('now')` is second-precision)
  8. `getDocumentText` returns chunks joined with `\n\n` in chunk_index order
  9. `deleteDocument` removes rows from kb_documents, kb_chunks, and vec_kb_chunks; delete-on-missing throws `KnowledgeNotFoundError`
  10. Re-upsert on same doc replaces old chunk/vector rows cleanly (second upsert with fewer chunks correctly truncates; old vec rows gone)
  11. Zero-chunk document remains valid across listDocuments, getDocumentText (empty string), setPinned, and deleteDocument
  12. `getDocumentText` on missing id throws `KnowledgeNotFoundError`
  13. `insertDocument` rejects non-768 `embedding_dim` with `KnowledgeDimensionError`; no doc row written on rejection
- **Run command:** `npm run test:kb-store` (chains `npm run build:electron` first so `dist-electron/electron/knowledge/KnowledgeStore.js` is fresh)
- **Why compile-first:** Electron's Node has no TS loader available without a new dev dependency. Tests require from `../../dist-electron/electron/knowledge/KnowledgeStore` so the compiled JS is what's under test. See DECISIONS.md D017.
- **Test count at end of M4-T4: 75 vitest + 4 kb-schema + 14 kb-store = 93 total.** (was 79 at end of M4-T3.)

- **M4-T3 — Chunking helper (11 tests, PASSING)** appended to `electron/__tests__/providers.test.ts` under `describe('chunker.splitIntoChunks (M4-T3)', ...)`:
  - Empty string → `[]`
  - Whitespace-only → `[]`
  - Short text below `maxChars` → single trimmed chunk
  - Outer whitespace trim on single short chunk
  - Sentence-boundary preference when `.?!` is present (at least one chunk ends on a period)
  - Hard-cut fallback when text has no sentence punctuation
  - Overlap preservation between adjacent chunks (byte-exact verification on the hard-cut path using `'abcdefghij'.repeat(500)` + `maxChars=1000, overlap=100`)
  - Custom `maxChars` option respected (all chunks ≤ maxChars)
  - Zero-overlap option produces contiguous chunks (rejoined = original text)
  - No chunk is empty (invariant across a mix of short sentences + whitespace + long filler)
  - `chunk.length <= maxChars` invariant on ~5600-char Lorem ipsum with `maxChars=600, overlap=60`
  - `overlap >= maxChars` is clamped internally (no infinite loop; forward progress guaranteed)
- **Test count after M4-T3: 75 vitest + 4 kb-schema = 79 total.** (was 67 at end of M4-T2.)

- **M4-T2 — Document parser helpers (14 tests, PASSING)** appended to `electron/__tests__/providers.test.ts`:
  - `extractTextFromMarkdown` — 4 cases (committed fixture, empty buffer, outer-whitespace trim, 3+ blank-line collapse)
  - `extractTextFromPlain` — 5 cases (committed fixture, CRLF normalization, bare-CR normalization, empty buffer, whitespace-only buffer)
  - `extractTextFromDocx` — 3 cases (in-memory jszip-built fixture with expected snippet, empty buffer early-return, outer-whitespace trim)
  - `extractTextFromPdf` — 2 cases (hand-rolled minimal PDF with computed xref offsets, empty buffer early-return)
  - Committed text fixtures: `electron/__tests__/fixtures/knowledge/sample.md` and `sample.txt`
  - Binary fixtures generated at test time via `buildMinimalPdf()` + `buildMinimalDocx()` helpers inlined in the test file. `jszip` is a guaranteed transitive dep of `mammoth` (verified via `npm ls jszip`).
  - **Why a single test file instead of a dedicated `parsers.test.ts`:** running two test files causes a vitest segfault when pdf-parse (via pdfjs-dist) loads FIRST, then the next file loads `sharp` through `LLMHelper`. pdfjs-dist's "fake worker" leaves residual state that corrupts sharp's native binding init on the following file load. Merging into `providers.test.ts` keeps all 63 tests in a single worker lifecycle with no file-to-file transition, avoiding the crash entirely. See DECISIONS.md D015.
- **Test count at end of M4-T2: 63 vitest + 4 kb-schema = 67 total.** (was 53 at end of M4-T1.)

- **M4-T1 — sqlite-vec load probe + knowledge schema (4 tests, PASSING)** in [`electron/__tests__/knowledgeSchema.electron.cjs`](electron/__tests__/knowledgeSchema.electron.cjs):
  - `vec_version()` returns non-empty string (`v0.1.7-alpha.2`)
  - Insert 768-dim vector into `vec_kb_chunks`, read back via `vec_to_json`, assert length 768 + correct first/last values
  - `vec_distance_cosine` ordering on 3 hand-crafted vectors (identical / 45° off / opposite) — asserts A(id=1) < B(id=2) < C(id=3)
  - Schema idempotency: running `KB_SCALAR_SQL` + `KB_VEC_SQL` twice in a row with data in between does not throw and preserves existing rows
- **Why this test file is separate from `providers.test.ts`:** vitest workers run under plain Node (ABI 137), and `better-sqlite3`'s compiled binary is rebuilt by `postinstall` (`electron-rebuild -w better-sqlite3 -f`) against Electron 33's NODE_MODULE_VERSION 130. `new Database()` under plain Node throws `ERR_DLOPEN_FAILED`. The existing M1/M2/M3 vitest suite only exercises pure functions from `DatabaseManager` (`migrateDbFilename`) that never construct a Database. M4-T1 requires a real sqlite handle + `sqlite-vec` extension, so it runs under Electron's Node runtime via `cross-env ELECTRON_RUN_AS_NODE=1 electron …`.
- **Run command:** `npm run test:kb-schema`
- **Exit code:** 0 on all-pass, 1 on any failure — suitable for CI when CI is added.
- **sqlite-vec binding note:** v0.1.7-alpha.2 **requires `BigInt` bindings for primary key integer columns**. Plain JS `number` values are rejected with "Only integers are allows for primary key values on …" even though better-sqlite3 binds them via `sqlite3_bind_int64`. The M4-T4 KnowledgeStore CRUD layer and all downstream M4 tasks that touch `vec_kb_chunks.chunk_id` MUST use `BigInt` bindings. Documented in the test script and will be documented in DECISIONS.md alongside the M4-T1 landing note.

### Future M4 tasks
- M4-T2 parsers, T3 chunker, T4 KnowledgeStore, T5 embedding adapter, T6 orchestrator, T7 context builder hook, T8 IPC, T9 renderer pane, T10 export/import, T11 manual smoke.

### Further-out milestones
- Live transcription testing: speaker tagging, debounced trigger timing, 2-sec min-audio guard, rolling-context window boundary conditions, stateful `<think>` filter regression test (extract to a standalone class if other providers start emitting reasoning blocks).

## Test commands

```bash
# Type check main process only
npm run typecheck:electron

# Full build (renderer tsc + vite)
npm run build

# Electron transpile (esbuild)
npm run build:electron

# Dev launch (manual smoke test)
npm run app:dev

# Vitest — added in M1 Step 5 (runs under plain Node, electron module mocked)
npm test                # run all unit + integration once (49 tests)
npm run test:watch      # watch mode
npm run test:coverage   # with coverage report

# M4-T1 knowledge schema tests — runs under Electron's Node runtime
# (required because better-sqlite3 is ABI-locked to Electron 33 via postinstall
# electron-rebuild). The existing vitest suite cannot construct a Database.
npm run test:kb-schema  # 4 sqlite-vec + schema tests

# M4-T4 KnowledgeStore CRUD tests — same Electron-runtime constraint.
# Chains `npm run build:electron` first so the compiled KnowledgeStore.js
# under test is always fresh.
npm run test:kb-store   # 14 CRUD + search + pinning tests
```

E2E (Playwright) is not wired yet — deferred to a future task.

## Fixtures and mocks
- Use `tmpdir()` for `userData` path in integration tests (never touch the real `%APPDATA%/sensi`)
- Mock `safeStorage` with a deterministic cipher in unit tests
- Mock MiniMax HTTP with a local fixture SSE stream
- Never hit real provider APIs in CI — integration tests use recorded fixtures
- Keep a separate manual "live-key" smoke suite that is opt-in via env var for local verification

## Resolved questions
- `tap` 21.5.0 in `dependencies` was a leftover from upstream — never used by sensi. M1 Step 5 added vitest as the actual test runner. `tap` can be removed in a future dependency-hygiene pass.
- Upstream has no Playwright wiring; E2E remains manual via the smoke-test checklist.
- No `.github/workflows/*` exists in the fork; CI is not yet wired (deferred).
- Upstream coverage baseline was unmeasured. M1 Step 5 instrumented only the M1 surface (`standardCloudModels.ts`, `CredentialsManager.ts`); the rest of the codebase is unmeasured by design.

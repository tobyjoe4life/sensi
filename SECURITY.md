# Security — sensi

> Audited 2026-04-12. M0-T2 through M0-T7 landed 2026-04-12 / 2026-04-13. Risk statuses updated to reflect mitigations.

## Principles
- Local-first where possible
- No secrets in renderer
- No direct provider calls from renderer
- Explicit boundaries around capture and outbound AI calls
- User-controlled capture only (no passive/interval screenshots, no background recording)
- Small, testable, reversible changes to security-sensitive code

## Sensitive data
- Screenshots (on-disk PNGs under `${userData}/screenshots`)
- Microphone and system audio (PCM frames, never persisted)
- Transcripts (stored in SQLite, indexed by session)
- User-provided reference documents (resume, JD, pasted context)
- Provider API keys (MiniMax, Claude, Google, OpenAI, Groq, STT providers)
- Device/session identifiers

## Trust boundaries (6 layers)

| # | Boundary | Enforcement | Status |
|---|---|---|---|
| B1 | **Screen capture** | `desktopCapturer` runs in main only; `ScreenshotHelper.takeScreenshot()` returns a path, never raw bytes to renderer | ✅ Enforced |
| B2 | **Audio capture** | Rust NAPI native module runs in main; `MicrophoneCapture` + `SystemAudioCapture` emit PCM to main-side STT; renderer receives only transcript strings via `onNativeAudioTranscript` IPC | ✅ Enforced |
| B3 | **Local storage** | `better-sqlite3` (`natively.db`), `safeStorage`-encrypted `credentials.enc`, and `electron-store` all live in main; renderer has no filesystem access | ✅ Enforced |
| B4 | **Context assembly** | `TemporalContextBuilder`, `transcriptCleaner`, and `llm/prompts.ts` (2148 lines of system prompts) live in main; renderer cannot construct or see raw prompts | ✅ Enforced |
| B5 | **Outbound API calls** | All provider fetches (`fetch`/`axios`/`ws`) originate from main process; renderer CSP permits only analytics + Google Gemini + Groq + a marketing vercel host — **no provider endpoints whitelisted in renderer CSP**; renderer must go through IPC | ✅ Enforced (but CSP needs cleanup in M0) |
| B6 | **Renderer / UI** | `BrowserWindow` uses `contextIsolation: true`, `nodeIntegration: false`, no `webview`/`<iframe>` for remote content, `contextBridge.exposeInMainWorld('electronAPI', …)` exposes wrapped IPC methods only (no raw `ipcRenderer`, no `require`) | ✅ Enforced (but `webSecurity: !isDev` — verify re-enabled in packaged build) |

## Risk inventory

Severity legend: **CRITICAL** (blocks M0), **HIGH** (must fix in M0), **MEDIUM** (must fix in M0 or M1), **LOW** (track but acceptable).
Status legend: ✅ **MITIGATED** • ⚠️ **PARTIAL** • ⏳ **OPEN**

### R1 — Missing `premium/` directory caused runtime exceptions — **HIGH** ✅ MITIGATED 2026-04-12
- **Where:** `electron/ipcHandlers.ts` (12 `require('../premium/electron/services/LicenseManager')` call sites) + `electron/premium/featureGate.ts` probe
- **Impact (historical):** Every call to `isProOrTrialActive()` caught a missing-module exception and fell through. The fork was silently broken on every license-gated path.
- **Mitigation applied (M0-T2):** Created `premium/electron/services/LicenseManager.ts` at the runtime-resolved path (corrected from the original task text per DECISIONS.md D008). Stub exports `getInstance()` singleton with `isPremium: true`, `isPremiumAsync: async true`, `isProOrTrialActive: true`, `activateLicense`/`activateWithApiKey` success, `getLicenseDetails`/`getDetails: { provider: 'personal-use' }`, `getHardwareId: 'sensi-local'`, `deactivate` no-op. All 12 require sites now resolve and every gated method has a non-throwing return path.
- **Residual:** `electron/premium/featureGate.ts` also probes `KnowledgeOrchestrator` — still missing, but `featureGate.isPremiumAvailable()` is not called from any active code path so its cached `false` is harmless. Tracked for optional future cleanup.

### R2 — Google Analytics live in renderer, contradicted PRIVACY.md — **HIGH** ✅ MITIGATED 2026-04-13
- **Where:** `src/lib/analytics/analytics.service.ts` (GA4 `G-494RMJ2G6E`), `index.html` CSP allowing `www.googletagmanager.com`, dynamic `<script>` injection in renderer
- **Impact (historical):** Personal usage, feature adoption, session duration, and model selection were shipped to Google Analytics.
- **Mitigation applied (M0-T3):** Deleted `src/lib/analytics/analytics.service.ts` and the empty `src/lib/analytics/` directory. Removed 28 `analytics.*` call sites across `src/App.tsx`, `NativelyInterface.tsx`, `SettingsOverlay.tsx`, `Launcher.tsx`, `ErrorBoundary.tsx` (comment-only), `ConnectCalendarButton.tsx`. Removed `www.googletagmanager.com` from CSP `script-src` and removed `www.googletagmanager.com`, `*.google-analytics.com`, `analytics.google.com` from `connect-src`. Grep sweep `rg -i "gtag|googletagmanager|G-494RMJ2G6E|analytics\.service|InstallPingManager"` returns zero hits in active source.

### R3 — `electron-updater` pointed at upstream GitHub releases — **HIGH** ⚠️ PARTIAL 2026-04-13
- **Where:** `package.json` `build.publish` → `{ provider: 'github', owner: 'evinjohnn', repo: 'natively-cluely-ai-assistant' }`; `electron/main.ts` `setupAutoUpdater()` scheduled a 10-second-after-launch `checkForUpdatesAndNotify()`.
- **Impact (historical):** A launched sensi build would poll the upstream release feed and could install an upstream Natively build over itself.
- **Mitigation applied (M0-T4):** Changed `build.publish` to `{ owner: 'tobyjoe', repo: 'sensi' }` (a placeholder that does not exist yet — so a 404 is the worst outcome). Added an early-return guard at the top of `setupAutoUpdater()`: `if (process.env.SENSI_ENABLE_UPDATER !== 'true') return;`. No event listeners attached, no startup `checkForUpdatesAndNotify` scheduled by default.
- **Residual (PARTIAL):** Three manual-trigger public methods (`checkForUpdates`, `downloadUpdate`, `quitAndInstallUpdate`) are **not** behind the env guard. They are only reached by explicit UI button clicks, and would 404 against the `tobyjoe/sensi` placeholder. Recommend guarding them symmetrically in a follow-up task. Also `ReleaseNotesManager.ts` still hardcodes `repoOwner = "evinjohnn"` and `repoName = "natively-cluely-ai-assistant"` — dev-mode fallback only, deferred to a future task.

### R4 — `natively.software` cloud endpoints still wired — **MEDIUM** ✅ MITIGATED 2026-04-13
- **Where:** `electron/LLMHelper.ts` (`generateWithNatively`, `streamWithNatively`), `electron/audio/NativelyProSTT.ts`, `electron/ipcHandlers.ts` (7 handlers: `get-natively-usage`, `trial:start`, `trial:status`, `trial:get-local`, `trial:convert`, `trial:end-byok`); endpoints: `https://api.natively.software/v1/trial/*`, `/v1/chat`, `/v1/usage`, `wss://api.natively.software/v1/transcribe`
- **Impact (historical):** If any code path reached these, sensi would leak device ID, trial state, transcripts, or chat payloads.
- **Mitigation applied (M0-T5):** `NativelyProSTT` removed from STT provider registry in `electron/main.ts` (import, type union, `createSTTProvider` branch, `languageDetected` wiring); file kept unreachable per task. `generateWithNatively()` and `streamWithNatively()` both start with `throw new Error('ProviderNotAvailable: natively-cloud disabled for sensi (M0-T5)')` before any network call. Six trial/usage IPC handlers stubbed to return personal-use defaults (`{ ok: false, error: 'natively_cloud_disabled' }` or `{ hasToken: false }`). Trial credential methods fully removed from `CredentialsManager` (DECISIONS.md D009). Grep sweep confirms zero active `natively.software` network calls — remaining hits are dead code below the throws, an unused class constant, or marketing URLs passed to `shell.openExternal()`.

### R5 — Hardcoded DodoPayments checkout URLs in trial modal — **MEDIUM** ✅ MITIGATED 2026-04-13
- **Where:** `src/components/trial/FreeTrialModal.tsx` (four `PLAN_*_URL` constants → `checkout.dodopayments.com/buy/pdt_*`)
- **Impact (historical):** If the trial modal mounted, users would see a paywall and be routed to an upstream-owned payment processor.
- **Mitigation applied (M0-T6):** Added `src/lib/config.ts` exporting `PERSONAL_USE = true as const`. Gated all 6 render sites with `{!PERSONAL_USE && …}`: `SupportToaster`, `NativelyQuotaBanner`, `FreeTrialBanner`, `TrialPromoToaster`, `FreeTrialModal` (App.tsx), `FreeTrialModal` (NativelyApiSettings.tsx). Removed the trial polling block and `onTrialEnded` listener from `App.tsx`. Component files retained per task for M1-T8 deletion. See DECISIONS.md D010 for the gate strategy rationale.

### R6 — `InstallPingManager.ts` phoned home on install — **MEDIUM** ✅ MITIGATED 2026-04-13
- **Where:** `electron/services/InstallPingManager.ts`, wired in `electron/main.ts`
- **Impact (historical):** Beaconed install event to a third party without consent.
- **Mitigation applied (M0-T3):** File deleted. Init block (`const { sendAnonymousInstallPing } = require('./services/InstallPingManager'); sendAnonymousInstallPing();`) removed from `electron/main.ts`.

### R7 — GA4 + upstream hostnames in CSP `connect-src` — **MEDIUM** ⚠️ PARTIAL 2026-04-13
- **Where:** `index.html` CSP
- **Impact (historical):** A permissive CSP allowed renderer code or a compromised dependency to exfiltrate to analytics or marketing hosts.
- **Mitigation applied (M0-T3):** Removed `www.googletagmanager.com` from `script-src`; removed `www.googletagmanager.com`, `*.google-analytics.com`, `analytics.google.com` from `connect-src`.
- **Residual (PARTIAL):** `connect-src` still whitelists `https://generativelanguage.googleapis.com`, `https://api.groq.com`, and `https://campaign-sand.vercel.app`. The renderer does not need direct provider network access (all traffic goes through main process IPC). These should be removed entirely in a follow-up CSP hardening task — they are the last renderer-side egress points in the CSP.

### R8 — `webSecurity: !isDev` in BrowserWindow options — **MEDIUM** ⏳ OPEN — verified in M0-T8
- **Where:** `electron/WindowHelper.ts` lines 150–154
- **Impact:** `webSecurity` is disabled in dev mode only. Must be confirmed re-enabled in packaged production builds. If not, same-origin policy and mixed-content protections are off.
- **Mitigation planned (M0-T8):** Runtime verification during the M0-T8 smoke test will confirm packaged builds have `webSecurity: true`. A defensive runtime assert in `main.ts` guarded by `!isDev` is a recommended addition.

### R9 — `LLMHelper.ts` is 3986 lines — **LOW (maintainability)**
- **Where:** `electron/LLMHelper.ts`
- **Impact:** Any provider change has a huge merge-conflict surface. Hard to review security-sensitive paths.
- **Mitigation (M1-T1):** Extract `Provider` interface + adapter layer in M1. Do not bulk-rewrite.

### R10 — Duplicate SQLite native deps (`sqlite3` + `better-sqlite3`) — **LOW**
- **Where:** `package.json` dependencies
- **Impact:** Doubles native build time, increases bundle size. Not a security risk.
- **Mitigation (M2 or later):** Remove the unused one after confirming which is actually loaded at runtime.

### R11 — `tesseract.js` bundled — usage unclear — **LOW**
- **Where:** `package.json` dependencies
- **Impact:** ~50 MB of WASM + language data in the bundle. Not a security risk, just bloat. Also an OCR capability exists that may not be used.
- **Mitigation (M2 or later):** Audit call sites; remove if unused.

### R13 — Windows installer ships unsigned for v2.4.0 — **LOW** ⚠️ ACCEPTED 2026-04-17
- **Where:** PACKAGING-01 Pass B produces `sensi-Setup-2.4.0.exe` via electron-builder NSIS target with no `win.certificateFile` / `certificatePassword` / `signtoolOptions` configured (see D031d).
- **Impact:** (a) Windows SmartScreen shows "Windows protected your PC — Unknown publisher" on first launch of the installer and each fresh install on a new machine. User must click **More info** → **Run anyway**. (b) Third-party download mirrors / antivirus engines may incorrectly flag the installer as untrusted until it accrues reputation. (c) OTA updates from v2.4.0 → v2.4.x do NOT re-trigger SmartScreen because the installed app's trust is anchored to the first accepted install, so subsequent updates flow through electron-updater's hash-verified delta install path without additional prompts.
- **Mitigation considered:** Purchase an OV ($100-300/yr) or EV ($300-600/yr) code-signing certificate and wire `win.certificateFile` + CSC env vars. Deferred for v2.4.0 because sensi is a single-user personal-use fork and the one-time click-through is acceptable friction; revisit when sensi gets more than one user or handles externally-supplied untrusted input beyond what's already fed into it (screenshots, transcripts — already trust-bounded). The CHANGELOG v2.4.0 entry calls out the warning so users know what to expect.
- **Residual:** Users who download the installer from a source other than the official GitHub Releases page have no publisher fingerprint to verify — they rely on the source being trustworthy. Mitigation: point users at the GitHub release URL (the only authoritative distribution channel).

### R12 — Knowledge IPC surface introduced in M4-T8 + M4-T10 — **LOW** ✅ BOUNDED 2026-04-14
- **Where:** `electron/knowledge/knowledgeIpcHelpers.ts` + 12 IPC channels registered in `electron/ipcHandlers.ts`. M4-T8 (8): `knowledge-ingest-document`, `knowledge-list-documents`, `knowledge-delete-document`, `knowledge-pin-document`, `knowledge-unpin-document`, `knowledge-list-pinned`, `knowledge-query`, `knowledge-get-document-preview`. M4-T10 (+4): `knowledge-export`, `knowledge-import`, `knowledge-pick-export-path`, `knowledge-pick-import-path`.
- **Impact:** Renderer can now (a) trigger file reads by path → main-process `fs.promises.readFile` pulls bytes into parsers; (b) mutate `kb_documents` rows (pin/unpin/delete); (c) query the embedding store and receive retrieved chunks; (d) request bounded document previews; (e) write the full knowledge base to a user-selected `.json` path; (f) wipe the knowledge base and replace it with the contents of a user-selected `.json` file.
- **Mitigation applied (M4-T8):** Every handler is a pure function with input validation at entry (`validateNonEmptyString`, `validatePositiveInt` with `max: 50` clamp on `topK`, `validateStringArray` for `documentIds`). `translateError` is the single exit point for all exceptions and runs `scrubPath` to replace absolute Windows / POSIX paths with `<path>` marker before the error string crosses the IPC boundary. Error strings are capped at 200 chars and never carry stack traces. The preview handler enforces a hard max of `PREVIEW_HARD_MAX_CHARS = 12000` chars (~2000-3000 tokens) — no caller input can request more, even `Infinity`. Default is `PREVIEW_DEFAULT_MAX_CHARS = 4000`. Non-number / NaN / negative `maxChars` values are silently coerced to the default.
- **Mitigation applied (M4-T10):** The export/import surface preserves the no-raw-bytes-in-renderer contract — the artifact is written and read entirely in main process via `fs.promises.writeFile` / `fs.promises.readFile`. The renderer only passes a filePath string through the IPC boundary. The pick-*-path handlers open `dialog.showSaveDialog` / `dialog.showOpenDialog` with a `.json` filter and return a user-picked path; the user makes the path choice, not the renderer. Import is destructive (replace policy) but always writes a pre-import backup to `<userData>/knowledge-preimport-backup-<ISO>.json` before the destructive mutation and runs the replace inside a single SQLite transaction. On any error the DB rolls back and the backup remains for manual recovery. The export handler's success return type deliberately contains no document text or chunk content — only counts and filePath — a regression enforced by a compile-time structural test. See DECISIONS.md D021 + D023.
- **Residual:** File ingestion (M4-T8) still reads files in main process via `fs.promises.readFile(validatedPath)` without path-root sandboxing. The M4-T10 export handler has the same property: the renderer-supplied `filePath` for the `.json` output is passed through to `fs.writeFile`, so a malicious renderer-side bug could exfiltrate the knowledge base to an arbitrary location. Neither is a new surface introduced in M4-T10 — the gap is consistent with M4-T8 (D021c) and is captured under this R12 entry. Mitigation considered: constrain allowed paths to a user-configurable knowledge root directory via a main-process allowlist check. Not landed in M4; tracked for a later milestone. For M4-T11 manual smoke the user is the operator choosing paths deliberately, so the residual is acceptable.

## Security posture summary

Updated 2026-04-13 after M0-T2 through M0-T7 landed.

| Layer | Status |
|---|---|
| contextIsolation | ✅ on |
| nodeIntegration | ✅ off |
| preload uses contextBridge | ✅ yes, no raw ipcRenderer exposed |
| Secrets in renderer | ✅ none (masked strings only) |
| Credentials at rest | ✅ `safeStorage`-encrypted; trial fields removed in M0-T5 |
| Renderer → provider direct calls | ✅ none |
| Premium/license runtime exceptions | ✅ **R1** mitigated via M0-T2 stub |
| Analytics/telemetry | ✅ **R2, R6** fully mitigated in M0-T3; ⚠️ **R7** partial (CSP still allows 3 provider/marketing hosts in `connect-src`) |
| Upstream auto-update | ⚠️ **R3** partial — `setupAutoUpdater` guarded in M0-T4, but manual-trigger methods (`checkForUpdates`, `downloadUpdate`, `quitAndInstallUpdate`) still reach `autoUpdater` singleton |
| Cloud trial/chat/STT coupling | ✅ **R4, R5** mitigated in M0-T5 / M0-T6 |
| Dev `webSecurity` toggle verified in prod | ⏳ **R8** — verify in M0-T8 smoke test |
| Maintainability | ⏳ **R9** — address in M1-T1 provider adapter refactor |
| Dependency hygiene | ⏳ **R10, R11** — address in M2+ |

## Response protocol
If a new security issue is discovered mid-work:
1. Stop the current task
2. Log the finding in this file with severity + location
3. Use the `security-reviewer` agent for triage
4. Fix CRITICAL/HIGH before continuing
5. Rotate any exposed secrets
6. Grep the codebase for similar issues

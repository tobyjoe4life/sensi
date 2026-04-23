# sensi changelog

All notable changes to sensi. Versions follow [Semantic Versioning](https://semver.org/).

Source of truth for the in-app **What's new** modal (`ReleaseNotesManager`
fetches from the GitHub release body, which is seeded from this file).

---

## [2.12.0] — 2026-04-19

### Added — M7 / PREP-01: Pre-meeting briefing surface
- **Prep me button on every Upcoming Meetings row.** Click to open a
  scrollable briefing modal composed from every source sensi has about
  the meeting:
  - Resume persona (PERSONA-01)
  - JD attached to this event (PERSONA-02)
  - Documents attached to this event (KNOWLEDGE-02)
  - Live Tavily research on the JD's company (RESEARCH-01)
- **One LLM call per briefing.** `PrepOrchestrator.generate(eventId)`
  gathers everything, sends a single request with `PREP_BRIEFING_PROMPT`,
  and returns strict markdown (~300 words). Briefing layout:
  - Event title + inferred meeting type
  - Setup (role / company / top requirements / your gaps / interview
    process)
  - Attached context (one bullet per doc with the salient takeaway)
  - Company pulse (2–3 recent facts from Tavily, no marketing fluff)
  - **Your 3 talking points** (persona × JD × docs, each a full sentence
    starting with a verb)
  - 2 smart follow-up questions the user can ask
- **Caching that doesn't go stale.** Briefs cached 24h per event; Tavily
  company research cached 7d per company. Every mutation that affects a
  briefing (JD attach/clear, doc attach/detach) now invalidates the
  event's cached brief so the next `Prep me` tap recomputes from fresh
  inputs.
- **Fallback path.** When the LLM call fails, the orchestrator still
  returns a plain-markdown dump of the gathered inputs so the user gets
  *something* before joining the meeting instead of a blank modal.
- **Input badges.** The modal header shows `Resume / JD / N docs /
  Research` chips — dim when missing, brass-highlighted when included —
  so the user knows at a glance what's feeding the briefing.
- **"Bring sensi" primary action.** One click arms the meeting with
  every context block loaded (persona × JD combined block from
  PERSONA-02, event-scoped knowledge retrieval from KNOWLEDGE-02).

### New IPC
- `prep:get-briefing({ eventId, title, description?, force? })` — returns
  the composed briefing or an error. `force: true` bypasses the 24h cache.
- `prep:invalidate(eventId)` — drop the cached brief for one event.

### Plumbing
- New `electron/services/PrepOrchestrator.ts` singleton, bound to
  `processingHelper.getLLMHelper()` at app init.
- `persona:upload-jd`, `persona:clear-jd`, `knowledge:attach-to-event`,
  `knowledge:detach-from-event` all call `PrepOrchestrator.invalidate()`
  so the brief never points at stale JD/doc state.

### Scope notes — closing M7 roadmap
- All five M7 passes are live: RESEARCH-01 (v2.7), MOTION-01 (v2.8),
  KNOWLEDGE-02 (v2.9), PERSONA-01 (v2.10), PERSONA-02 (v2.11), PREP-01
  (v2.12).
- Pre-compute at the 10-minute mark is deferred — today the user
  triggers `Prep me` manually. Auto pre-warm when `event-imminent`
  fires at 10m is a small follow-up (hook into `CalendarManager`'s
  existing reminder scheduler). Kept out of this pass to preserve the
  scope fence.
- The v2.4 "Bring sensi?" PreMeetingPrompt is unchanged; the briefing
  modal is its own surface invoked from Upcoming Meetings. Merging the
  two into a single "expand to briefing" flow is a later polish.

---

## [2.11.0] — 2026-04-19

### Added — M7 / PERSONA-02: Per-meeting JD + combined persona × JD injection
- **Attach-JD slot on each meeting's attachment modal.** Opens from the
  paperclip in Upcoming Meetings → "Attach JD for this meeting". Single
  LLM call extracts structured fields (`company`, `role`, `level`,
  `requiredSkills[]`, `niceToHaves[]`, `interviewRounds[]`). Shows the
  parsed role + top requirements inline; one-click Remove.
- **Combined persona × JD context injection.** When a meeting has BOTH
  an uploaded resume (PERSONA-01) and an attached JD, the persona hook
  no longer injects the resume-only `<persona>` block. Instead it
  assembles a `<meeting_context>` block containing:
  - YOU (name, role, years), YOUR SKILLS (top 8)
  - JOB (role @ company, level), JOB REQUIRES (top 8 required skills)
  - **OVERLAP** — skills you share with the JD (case-insensitive match)
  - **GAPS** — required skills absent from your resume (top 5)
  - **TALKING POINTS** — your top 3 achievements, framed as pivot
    material for job-relevant questions
- The LLM now answers every `What to answer?` call with gap awareness:
  leans on overlap when the topic matches, pivots to transferable
  experience when the topic hits a gap, never hedges.

### Schema
- `user_persona` gains `event_id TEXT` (nullable). Additive via
  `ALTER TABLE ADD COLUMN` for v2.10.0 upgraders; fresh installs include
  the column in `CREATE TABLE`. New index
  `idx_user_persona_kind_event (kind, event_id, updated_at DESC)` for
  fast "JD for this event" lookups. Resume rows leave `event_id` NULL;
  JD rows carry the calendar event id.
- **One JD per event.** Uploading a new JD for an event explicitly
  deletes any previous JD for the same event first — stale requirements
  never leak into live-assist.

### New IPC
- `persona:pick-jd-file` — OS file dialog (PDF/DOCX/MD/TXT).
- `persona:upload-jd(path, eventId)` — parse → LLM extract → store.
- `persona:get-jd-for-event(eventId)` — latest JD for this event or null.
- `persona:clear-jd(eventId)` — drops the JD attached to this event.

### Plumbing
- Persona hook signature updated: `PersonaContextFn = (eventId?: string) => string`.
- `IntelligenceEngine` threads the active meeting's `calendarEventId`
  into the hook via `WhatToAnswerLLM.activeEventId` (already wired in
  KNOWLEDGE-02).
- `PersonaManager.buildContextBlock(eventId)` returns the combined
  block when both resume + JD are present, the resume-only block when
  only resume is present, the JD-only block when only JD is present,
  and '' otherwise.

### Scope fence
- No auto-suggest for JDs (JDs are too specific to auto-pick — user
  attaches explicitly).
- No cross-event JD sharing (each JD is bound to one event).
- No negotiation generator, no mock-interview generator — those are
  intentionally not in scope. The combined-block approach keeps the
  live-assist prompt small and focused.

---

## [2.10.0] — 2026-04-19

### Added — M7 / PERSONA-01: Lightweight resume persona
- **New Persona tab in Settings** (between Calendar and Audio). One-shot
  resume upload → sensi extracts structured fields with a single LLM call
  → stores them locally → injects a compact `<persona>` block into every
  "What to answer?" prompt. Result: answers reference your actual role,
  skills, and recent wins instead of generic advice.
- **Extraction output** (`ResumePersona`): `name`, `currentRole`,
  `yearsExperience`, `skills[]` (top 12 hard skills), `education[]`
  (top 3), `topAchievements[3]`. Validated before storage; one retry on
  invalid JSON before surfacing an error.
- **Injection order**: persona first → knowledge block → intent/history
  → transcript. Persona is the shortest block (~100 tokens) so the
  overhead per call stays negligible.
- **History kept, only latest injected**: every upload writes a new
  `user_persona` row (audit trail); the live-assist hook always reads the
  newest row per kind. Replace and Delete actions do the expected thing.

### Schema
- New table `user_persona (id, version, kind, source_name, json_data,
  created_at, updated_at)`. `kind='resume'` for this pass;
  `kind='jd'` arrives in PERSONA-02. JSON-in-SQLite so the canonical
  shape can evolve without DB migrations. Indexed on
  `(kind, updated_at DESC)` for fast "latest" reads.

### New IPC
- `persona:pick-file` — OS file dialog (PDF/DOCX/MD/TXT).
- `persona:upload-resume(path)` — read → parse → LLM extract → validate → store.
- `persona:get-summary()` — latest resume persona or null.
- `persona:clear()` — drops every resume row.

### Supported formats
- PDF (text-based), DOCX, Markdown, plain text.
- Scanned-image PDFs are rejected loudly — "very little extractable text"
  is the error. OCR is out of scope for v2.10.

### Scope notes
- No JD. No gap analysis. No mock-interview generator. No company
  research tie-in. All of those are PERSONA-02 + PREP-01.
- The hidden Profile Intelligence panel (POLISH-02) stays hidden — this
  is an independent, lightweight path that does NOT depend on the
  premium KnowledgeOrchestrator/CompanyResearchEngine subtree.
- Extraction runs on the user's active LLM provider (Gemini, OpenAI,
  Claude, Groq, MiniMax — MiniMax is text-only and works fine here).
  No vision required since resumes are parsed to text first.

---

## [2.9.0] — 2026-04-18

### Added — M7 / KNOWLEDGE-02: Per-meeting document binding + auto-suggest
- **Paperclip button per event in Upcoming Meetings.** Click opens an
  attachment modal with three sections:
  (1) currently attached docs (with a Remove action per doc),
  (2) auto-suggested docs for this event (ranked by cosine distance of
      the event's title + description against your KB, top 3 by default),
  (3) "All docs" tab to browse unattached docs and attach any.
  Events with attached docs show a `📎 N` badge in the row.
- **Auto-suggest retrieval.** New orchestrator method
  `suggestDocumentsForEvent(eventId, searchText, topK)` embeds the event
  blob with the active provider and returns top-K unattached docs with
  distance scores. UI renders a "Suggested" subsection under Attached.
- **Event-first retrieval at `What to answer?` time.** When a meeting
  has a `calendarEventId` and at least one doc attached,
  `queryKnowledge` prefers event-scoped docs and short-circuits before
  the global fallback. Pinned docs still inject globally.
- **Attached-events badge in Settings → Knowledge.** Each doc row shows
  a `📎 N` chip listing how many calendar events it's attached to.

### Schema
- New join table `kb_document_events (doc_id, event_id, attached_at)`,
  PRIMARY KEY (doc_id, event_id). Indexed on both sides. ON DELETE
  CASCADE from `kb_documents.id` keeps the join clean when a doc is
  removed. Additive migration — existing docs stay global-only unless
  the user attaches them.

### New IPC
- `knowledge:attach-to-event(docId, eventId)`
- `knowledge:detach-from-event(docId, eventId)`
- `knowledge:list-for-event(eventId)` → attached docs
- `knowledge:list-events-for-document(docId)` → event ids
- `knowledge:suggest-for-event(eventId, searchText, topK?)` → scored suggestions

### Plumbing
- `buildKnowledgeContextBlock`, `makeKnowledgeContextClosure`, and the
  `KnowledgeContextFn` in `WhatToAnswerLLM` all now thread an optional
  `eventId` through to `queryKnowledge`.
- `IntelligenceManager.setMeetingMetadata` pushes `calendarEventId` into
  `IntelligenceEngine.setActiveEventId`, which forwards to the
  WhatToAnswerLLM instance. Active event id resets to null when the
  meeting ends.

### Scope notes
- Embedding dimension unchanged (768). No new provider wiring.
- Upload-new-from-modal currently routes the user to Settings → Knowledge
  for ingest rather than duplicating the file picker flow; a one-step
  upload-then-attach polish is a later pass.
- Cross-event doc sharing is explicit (the join table is many-to-many),
  so attaching the same doc to multiple interviews of the same role is a
  one-click operation per event.

---

## [2.8.0] — 2026-04-18

### Added — M7 / MOTION-01: Motion Capture (video + GIF comparison assessments)
- **Record chip on the overlay.** Tap to start sampling screen frames at
  ~1.5s intervals (20-frame cap, ~30s ceiling). Chip shows frame counter
  while recording (e.g. `3/20`). Tap again to stop.
- **Post-stop decision popover.** Choose **Summarize** for a single-clip
  video summary, or **Compare with next clip** to record a second clip and
  get a side-by-side comparison, or **Discard** to throw it away.
- **Summarize flow** (`VIDEO_SUMMARY_PROMPT`) — treats the captured frames
  as a video storyboard. Returns markdown with "What's happening",
  "Timeline" (4–6 key-frame timestamps), and "Key takeaways" (including
  verbatim on-screen text). Adds an "Answer" section when the clip
  clearly shows an assessment question.
- **Compare flow** (`MOTION_COMPARE_PROMPT`) — records Clip A + Clip B in
  sequence, sends both frame ranges in one multimodal call with a
  `frames 1-N / frames N+1-M` split marker. Returns Summary, Differences,
  Similarities, and a Verdict. Quotes on-screen labels verbatim.
- New singleton `MotionCaptureManager` (separate from `LiveScreenCapture`
  so the continuous background capture stays independent).
- New IPC surface: `motion:start`, `motion:stop`, `motion:status`,
  `motion:summarize`, `motion:compare`, `motion:discard`. Plus events
  `motion-frame-captured` and `motion-auto-stopped` for the UI timer.

### Why
User feedback: assessment mode needed to cover **video assessment and GIF
comparison assessment**, not just single-frame coding problems. A single
screenshot can't capture motion, animation timing, or state changes over
time — this pass adds the frame-sequence primitive both flows need.

### Scope notes
- Works with any configured vision-capable provider (Gemini, OpenAI,
  Claude, Groq multimodal). MiniMax drops image payloads (endpoint is
  text-only) — use a different provider for motion analysis.
- Frames live in the same `live_frames` dir as Live Coding but in a
  separate in-memory list; `motion:discard` cleans them up after the LLM
  call completes.
- 30s clip ceiling is intentional — multimodal token cost grows linearly
  with frame count, and most assessment videos / GIFs fit under 30s.
  A longer-clip path (Gemini Files API upload) is a v2.11+ consideration.

---

## [2.7.2] — 2026-04-18

### Changed
- **Assessment Mode now covers any online assessment, not just coding.**
  `ASSESSMENT_SOLVE_PROMPT` first classifies the visible question(s) into
  coding / MCQ single or multi / true-false / fill-in-the-blank / short
  answer / essay / math / matching / ordering / diagram / knowledge quiz,
  then answers using the heading set for that type. Coding still returns
  Problem / Approach / Solution / Edge cases / Walkthrough; MCQ returns
  Answer + Why; essays return Thesis + Supporting points + Close; math
  returns boxed Answer + Work in LaTeX; etc.
- `IntelligenceEngine.runAssessmentSolve` user message updated to match —
  no longer says "solve the coding problem".
- Settings → Online Assessment mode copy broadened to list the supported
  question types (quizzes, certifications, take-homes, proctored tests).
- Live Coding Mode already passed the attached frame through the general
  `WhatToAnswerLLM`, so it implicitly handled any question type; only the
  settings description was clarified.

### Why
User feedback: "the assessment mode and live coding mode should not be
limited to coding problems, it could be quiz or any kind of online
assessment." This removes the coding-only assumption from the prompt and
the UI copy so the feature matches its marketed name.

---

## [2.7.1] — 2026-04-18

### Fixed
- **Overlay quick-action row no longer clips the end chips.** Adding the
  Research chip in v2.7.0 pushed the 6-chip row past the overlay width, so
  "What to answer?" and "Answer" were cut off at both ends under
  `justify-center`. Research is now icon-only (Search icon + tooltip) and
  "Follow Up Question" is shortened to "Follow Up", which pulls the whole
  row back inside the overlay.

---

## [2.7.0] — 2026-04-18

### Added — M7 / RESEARCH-01: Standalone Research
- **Research chip on the overlay.** New `Search` icon chip next to Follow-Up
  Question. Click to open an inline "Company, role, or topic" input; Enter
  submits. Streams a tight markdown brief (what it is, recent signal, likely
  interview angles, follow-up questions to ask, source links) back into the
  chat as a system message. Works standalone — no resume / JD / persona
  required.
- **Search Providers card in Settings → AI Providers.** Tavily key input is
  now a first-class provider alongside Gemini / Groq / OpenAI / Claude /
  MiniMax. Previously this input lived inside the hidden Profile Intelligence
  panel (POLISH-02), so users in personal-use mode could never see it.
  Connected badge, remove button, link to `app.tavily.com` for a free key.
- **New IPC path `research:run(query, scope?)`.** Direct `@tavily/core` call
  → results trimmed to essentials → synthesized via `LLMHelper.chatWithGemini`
  with `COMPANY_RESEARCH_PROMPT` as the embedded system instruction. Bypasses
  the zombie `profile:research-company` path, which depended on the premium
  `KnowledgeOrchestrator` / `CompanyResearchEngine` subtree that is absent
  from this fork.
- `COMPANY_RESEARCH_PROMPT` in `electron/llm/prompts.ts` — ~200-word output
  contract (Recent / Likely angles / Follow-up questions), strict "no invented
  facts" rule, capped at 250 words.

### Changed
- `getStoredCredentials` preload typing now surfaces `hasTavilyKey` so the
  AI Providers card can render the Connected state on load.

### Notes
- Scope fence: no changes to the hidden Profile Intelligence panel or the
  `PERSONAL_USE` gate. Pass 2 (KNOWLEDGE-02) will add per-meeting document
  binding; this pass only reclaims Tavily as a standalone feature so users
  can research any company in under 3 clicks.

---

## [2.4.4] — 2026-04-17

### Changed
- **Replaced "Upcoming features" banner with Upcoming Meetings.** The Launcher
  now shows the next 4 calendar events from Google Calendar in the spot
  previously occupied by the promotional feature-spotlight carousel. Three
  states: (a) calendar not connected → shows "Connect your calendar" with a
  direct connect button, (b) connected but no events in the next 7 days →
  empty-state hint, (c) connected with events → clickable list, each event
  launches the Prepare flow on click. Relative date labels ("Today", "Tomorrow",
  weekday name). Link indicator when a meeting has a URL.
- The existing "Up Next" card (next meeting within 60 min) is unchanged and
  still takes precedence over this panel.

### Removed
- `FeatureSpotlight` is no longer imported by the Launcher. The component file
  remains for now to keep the diff narrow; a later cleanup will remove it.

---

## [2.4.3] — 2026-04-17

First real meeting surfaced two behavioral issues with the auto-answer path.

### Fixed
- **Auto-answering the user's own speech.** The silence trigger (M5-T6) was
  treating any final transcript segment as a "someone just finished
  speaking" signal. When the user talked into the mic, 1.5 s later the LLM
  would generate an answer to the user's own words — as if the user were
  interviewing themselves. Fixed by gating `RollingTriggerPolicy.noteSegment`
  on speaker: only `interviewer` final segments reset the silence baseline.
  User (`me`) segments are no-ops for the silence detector.
- **Default trigger mode changed from `on-silence` to `off`.** Out-of-box
  behavior is now fully manual. The user clicks the answer button to get a
  response. Auto-answer opt-in lives in Settings → General.

### Added
- **Auto-answer toggle in Settings** (M5-T8). Two-state switch:
  - **Off** (default) — manual; click the answer button for a response
  - **On** — auto; sensi answers after the interviewer pauses ~1.5 s

---

## [2.4.2] — 2026-04-17

Follow-up to v2.4.1. v2.4.1's 3-second z-order re-assertion used
`setAlwaysOnTop(true, 'floating')` which still lost to exclusive-fullscreen
apps (Chrome tab fullscreen, Zoom share, Teams fullscreen, games, etc.).
Confirmed repro: full-screen a Chrome tab during a meeting → overlay
disappears → exit fullscreen → overlay returns.

### Fixed
- **Overlay now stays on top of fullscreen windows.** All four overlay
  z-order call sites (creation, `showOverlay`, `switchToOverlay` with
  content protection, `switchToOverlay` without content protection, and the
  periodic re-assertion timer from v2.4.1) upgraded from `'floating'` to
  `'screen-saver'` — Electron's highest z-order level. Screen-saver stays
  above exclusive-fullscreen apps where `'floating'` is demoted.
- macOS is unaffected (still uses `setVisibleOnAllWorkspaces(true,
  { visibleOnFullScreen: true })` which is the right mechanism on macOS).

---

## [2.4.1] — 2026-04-17

Hotfix after first real use of the v2.4.0 installer. One meeting, two issues
surfaced; both fixed.

### Fixed
- **Overlay silently dropping behind fullscreen interview apps.** On Windows,
  DWM was demoting the overlay's HWND below any fullscreen or exclusive app
  (Zoom/Teams screen share, full-screen browser, etc.), leaving the overlay
  alive but invisible. The fix is a 3-second periodic re-assertion of
  `setAlwaysOnTop(true, 'floating')` while the overlay is visible, so DWM
  can't passively drop it. Timer runs only while the overlay is the active
  mode; no cost when the launcher is up or on macOS / Linux.
- **Relaunch silently killed by single-instance lock.** When the overlay
  became invisible and the user tried to relaunch sensi from Start menu,
  the new process detected the running instance and quit without saying
  anything, leaving the user with a pile of zombie processes. The fix
  adds a `second-instance` handler that raises the existing window to
  front (restores if minimized, shows if hidden, focuses) instead of
  silently exiting.

### Known workaround for users on v2.4.0
If the overlay disappears and won't restart: open Task Manager, kill all
`sensi.exe` processes, then relaunch. v2.4.1 makes this unnecessary.

---

## [2.4.0] — 2026-04-17

First personal-use ship of the sensi fork. Cut as the baseline installer so
future versions can roll out over the air via the in-app update banner.

### Added
- **Brand identity**: new sensi icon set — brush-s monogram on a dark
  rounded square. Shipped across the Windows installer UI, taskbar, Alt-Tab,
  task switcher, Start menu, and the in-app tray.
- **Rolling-response trigger cadence** (M5-T4 → M5-T6): silence-based
  auto-trigger for the "what should I say" stream. Modes are `off`,
  `on-silence` (default, fires after ~1.5s of silence), and `on-demand`.
  UI mode selector ships next release (M5-T8).
- **Auto-updater** runs automatically in packaged builds. After install,
  sensi checks GitHub Releases 10 seconds after launch and shows the
  **Update available** banner when a new version is published.
- **Knowledge subsystem** (M4 closed): local RAG over user-provided
  documents (PDF, DOCX, Markdown, plain text). Ingest, pin, preview,
  export, and import flows. 768-dim embeddings via Gemini
  `gemini-embedding-001` or local Ollama `nomic-embed-text`.

### Changed
- Auto-update gate flipped (D031): previously `SENSI_ENABLE_UPDATER=true`
  was required even in packaged builds (D005). Packaged builds now always
  check for updates; dev builds still stay silent unless the env var is set.
- Auto-scroll during streaming (POLISH-01): chat surfaces follow streamed
  tokens only while the user is near the bottom, pause on scroll-up. 48 px
  threshold.
- Profile Intelligence tab hidden (POLISH-02): the upstream commercial
  persona feature is gated behind `PERSONAL_USE`. The M4 Knowledge tab is
  the only user-facing knowledge surface.

### Fixed
- OpenAI `max_completion_tokens` clamp (M3-FIX-01): gpt-4o capped at 16384,
  gpt-5 / o1 / o3 capped at 32768. Prevents the `400 max_tokens is too
  large` error.
- RAG active-provider routing (M3-FIX-01): `queryMeeting` / `queryGlobal`
  no longer hard-code Gemini; they now dispatch to the user's active chat
  provider.
- Audio recovery handler + cross-window credential sync (v2.3 → v2.4).

### Branding sweep (POLISH-01 / POLISH-01a)
- Window title now `sensi` (was `Natively`).
- Every in-app raster icon (Launcher, overlay, Help, Chat) swapped to the
  `SensiMark` SVG.
- File rename `NativelyInterface.tsx` → `SensiInterface.tsx`,
  `NativelyLogoMark.tsx` → `SensiLogoMark.tsx`.
- Leftover upstream `natively.icns` removed from packaging; macOS builds
  now reference `assets/icon.icns`.

### Known issues
- **Windows installer is unsigned.** SmartScreen will warn "Unknown
  publisher" on first install. Click **More info** → **Run anyway**. A
  code-signing cert is a future release.
- **macOS and Linux builds are not produced** for this release. sensi is
  Windows-first.
- **If the window disappears mid-meeting**, right-click the sensi tray
  icon and choose **Show sensi**. The tray icon always stays present on
  Windows.

---

## Pre-release history

Upstream (Natively) release notes preserved below for context. The sensi
fork diverged from the upstream codebase at v2.2 and tracks its own
versioning from v2.4.0 onward.

---

    # Changelog

    ## [2.0.7] - 2026-03-20

    ### What's New
    
    - **Single-Trigger Analysis**: Added a new global keybind (`Cmd+Shift+Enter`) for "Capture and Process" to instantly take a screenshot and run AI analysis.
    - **Tavily Search Integration**: Replaced Google Custom Search Engine with the Tavily Search API. Features advanced depth and raw content extraction for vastly improved RAG and Company Research.
    - **Enhanced Company Dossiers**: Massively expanded the Premium Profile Intelligence UI. Now includes interview difficulty badges, a 5-star work culture grid with sub-dimensions, employee reviews with sentiment analysis, critics/complaints tracking, and core benefits pills.

    ### Improvements
    
    - **AI Language Strict Enforcement**: Rewrote the AI language enforcement pipeline. Native languages (Spanish, French, etc.) are now strongly prioritized over system prompt defaults using a triple-layer strict injection, guaranteeing the AI never incorrectly defaults back to English.
    - **Model Selection Accuracy**: Rewrote `LLMHelper` routing logic to guarantee your specifically selected cloud provider model (e.g., `gpt-4o`, `claude-3-5-sonnet`) is rigorously respected during vision fallbacks, multimodal processing, and streaming.
    - **Robust AI Fallbacks**: Added Gemini Flash and local Ollama models to the structured generation fallback chains, ensuring features like resume parsing work continuously even when primary models face rate limits or outages.
    - **Smoother Animations**: Mac window transitions now utilize zero-opacity pre-hiding to eliminate jarring animation flashes during rapid screenshot captures.
    
    ### Fixes
    
    - Fixed a bug where custom cURL endpoints and the "What to Say" auto-suggestion path would occasionally bypass the user's language preferences.
    - Fixed the OpenAI API validation ping by upgrading the deprecated connection test model to `gpt-4o-mini`.
    - Fixed UI sync issues where the AI response language dropdown could fall out of sync with the backend upon an IPC failure via a new optimistic playback system.
    - Removed unused dead user interface components and completely sanitized legacy template variables from core system prompts.

    ## [2.0.5] - 2026-03-15

    ### Improvements

    - **Stealth Mode UI**: The Process Disguise selector is now visually disabled and locked while Undetectable mode is active, preventing accidental state mismatches.
    - **State Synchronization**: Greatly improved internal state synchronization across all application windows (Settings, Launcher, Overlay).

    ### Fixes

    - **Infinite Feedback Loops**: Completely eliminated the bug where toggling Undetectable mode would sometimes cause the app to rapidly toggle itself on and off.
    - **Delayed Dock Reappearance**: Fixed a regression where the macOS dock icon would mysteriously reappear several seconds after entering stealth mode if a disguise had recently been changed.
    - **Initial State Loading**: Fixed an issue where the Settings UI would briefly show incorrect toggle states when first opened.
    - **macOS OS-level Events**: Hardened the app against macOS `activate` events (like clicking the app in Finder) accidentally breaking stealth mode.

    ### Technical

    - Refactored IPC (Inter-Process Communication) listeners for `SettingsPopup` and `SettingsOverlay` to use a strict one-way (receive-only) data binding pattern.
    - Added strict management and cancellation of `forceUpdate` timeouts during stealth mode transitions.
    - Added explicit type safety for the new getters in `electron.d.ts`.

    ## [2.0.4] - 2026-03-14

    ### Summary

    Version 2.0.4 introduces a massive architectural overhaul to the native audio pipeline, guaranteeing production-ready stability, true zero-allocation data transfer, and instantaneous STT responsiveness with WebRTC ML-based VAD.

    ### What's New

    - **Two-Stage Silence Processing**: Replaced basic RMS noise gating with a two-stage pipeline combining an adaptive RMS threshold and WebRTC Machine Learning VAD. Rejects typing, fan noise, and non-speech sounds before they bill STT APIs.
    - **Zero-Copy ABI Transfers**: Transitioned the `ThreadsafeFunction` bridging to direct `napi::Buffer` (Uint8Array) allocations, completely eliminating V8 garbage collection pressure during continuous capture.
    - **Sliding-Window RAG**: Implemented a 50-token semantic overlap in `SemanticChunker.ts` to prevent conversational context loss across chunk boundaries.

    ### Improvements

    - **Latency & Responsiveness Tuning**: Stripped redundant TS debouncing, slashed `MIN_BUFFER_BYTES`, and reduced native hangover, achieving a ~300ms reduction in end-to-end transcription latency. short utterances ("Yes", "Stop") no longer sit trapped in the buffer.
    - Removed floating-point division truncation for superior downsampling from 44.1kHz external microphones.

    ### Fixes

    - Fixed a critical bug where the native Rust monitor returned a hardcoded `16000Hz` while actually streaming 48kHz audio. Now syncs true hardware sample rates.
    - Resolved the "Input missing" silent crash bug on microphone restarts by properly recreating the CPAL stream.
    - Restored the 10s continuous speech backstop for REST APIs to prevent unbounded buffer growth.
    - Added missing `notifySpeechEnded()` properties and cleaned up dangerous type casts.

    ### Technical

    - Audio processing transitioned entirely to strict ABI memory bridging (`napi::Buffer`)
    - Re-architected native silence_suppression state machine around WebRTC VAD inputs.

    ## [2.0.3] - 2026-03-13

    ### What's New

    - **Dynamic AI Model Selection:** Replaced static model lists with dynamic dropdowns. Your preferred models synced from providers (like OpenAI, Anthropic, Google) now automatically appear across the entire app.
    - **Multimodal Resilience:** Added a "Smart Dynamic Fallback" using Groq Llama 4 Scout. If default vision models fail or get rate-limited during screen analysis, Natively instantly reroutes the image to ensure uninterrupted performance.
    - **Multiple Screenshot Support:** The Natively Interface can now handle and process multiple attached screenshots simultaneously instead of just one.
    - **Improved Settings UX:** API keys now auto-save after 5 seconds of inactivity, and selecting a preferred model immediately updates the rest of the application without requiring a page reload.

    ### Architecture & Fixes

    - **Better Embeddings:** Migrated from Gemini Embedding to a completely new and more robust embedding architecture.
    - **Claude Fixes:** Resolved max_tokens and context limits issues specific to Anthropic Claude interactions.
    - **DRY Refactoring:** Centralized model configuration strings across the codebase to ensure easier future updates.

    ## [2.0.2] - 2026-03-10

    ### Summary

    v2.0.2 focuses on fixing Windows system audio capture, improving RAG stability, and resolving critical Soniox STT configuration issues.

    ### What's New

    - Fully functional system audio capture for Windows
    - Introduced system for manual transcript finalization and interim/final bridging during recordings

    ### Improvements

    - Migrated to `app.getAppPath()` for reliable cross-platform resource discovery
    - Ensured `sqlite-vec` compatibility and fixed embedding queue management
    - Upgraded `@google/genai` and optimized embedding dimensionality for lower latency

    ### Fixes

    - Improved Soniox STT streaming reliability, manual flushing, and configuration persistence
    - Resolved application entry point and module resolution issues in production builds
    - Fixed transcript bridging for manual recording mode
    - Corrected stealth activation and window focus inconsistencies

    ### Technical

    - Dependency updates for `@google/genai`
    - Cleaned up native compiler warnings for Windows
    - Fixed module resolution for internal Electron paths

    ## [2.0.1] - 2026-03-06

    ### New Features

    - **Premium Profile Intelligence**: Job Description (JD) and Resume context awareness, company research, and negotiation assistance.
    - **Live Meeting RAG**: Instant intelligent retrieval of context directly during a live meeting using local vectors.
    - **Soniox Speech Provider**: Added support for ultra-fast and highly accurate streaming STT with Soniox.
    - **Multilingual Support**: Choose from various response languages, set speech recognition matching specific accents and dialects.

    ### Improvements & Fixes

    - Fixed numerous issues and merged 3 community pull requests to improve overall stability.

    ## [1.1.8] - 2026-02-23

    ### Summary

    Patch update addressing OpenAI GPT 5.x compatibility and increasing token output limits for all providers.

    ### What's New

    - Replaced deprecated `max_tokens` parameter with `max_completion_tokens` required by GPT 5.x models.
    - Increased max output tokens for OpenAI (GPT 5.2) and Claude (Sonnet 4.5) to 65,536.
    - Increased max output tokens for Groq (Llama 3.3 70B) to 32,768.

    ### Improvements

    - Improved response length capabilities across all text-generation AI models.
    - Updated connection test model to use `gpt-5.2-chat-latest` instead of the deprecated `gpt-3.5-turbo`.

    ### Fixes

    - Fixed 400 error when using OpenAI GPT 5.x models for text queries and toggle actions.

    ### Technical

    - Replaced `max_tokens` with `max_completion_tokens` in `LLMHelper.ts` and `ipcHandlers.ts`.

    ## [1.1.7] - 2026-02-20

    ### Summary

    Security hardening, memory optimization, and stability improvements for a more robust and reliable experience.

    ### What's New

    - API rate limiting to prevent 429 errors on free-tier plans (Gemini, Groq, OpenAI, Claude)
    - Cross-platform screenshot support (macOS, Linux, Windows)
    - Official website link added to the About section

    ### Improvements

    - Smarter transcript memory management with epoch summarization instead of hard truncation — no more losing early meeting context
    - API keys are now scrubbed from memory on app quit to minimize exposure window
    - Credentials manager now overwrites key data before disposal for enhanced security
    - Helper process renaming for improved stealth in Activity Monitor

    ### Fixes

    - Fixed V8/Electron entitlements crash on Intel Macs by including entitlements.mac.plist during ad-hoc signing
    - Fixed process disguise not applying correctly when undetectable mode is toggled on
    - Fixed usage array capping with dedicated helper method to prevent unbounded growth

    ### Technical

    - Added `RateLimiter` service (token bucket algorithm with configurable burst and refill rates)
    - Added `PRIVACY.md` and `SECURITY.md` policy documents
    - Refactored ad-hoc signing script with helper renaming and proper entitlements flow
    - Version bump to 1.1.7

    ## [1.1.6] - 2026-02-15

    ### New Features

    - **Speech Providers**: Added support for multiple speech providers including Google, Groq, OpenAI, Deepgram, ElevenLabs, Azure, and IBM Watson.
    - **Fast Response Mode**: Introduced ultra-fast text responses using Groq Llama 3.
    - **Local RAG & Memory**: Full offline vector retrieval for past meetings using SQLite.
    - **Custom Key Bindings**: Added ability to customize global shortcuts for easier control.
    - **Stealth Mode Improvements**: Enhanced disguise modes (Terminal, Settings, Activity Monitor) for better privacy.
    - **Markdown Support**: Improved Markdown rendering in the Usage section for better readability of AI responses.
    - **Image Processing**: Integrated `sharp` for optimized image handling and faster analysis.

    ### Improvements & Fixes

    - Fixed various UI bugs and focus stealing issues.
    - Improved application stability and performance.

    ## [1.1.5] - 2026-02-13

    ### Summary

    The Stealth & Intelligence Update: Enhances stealth capabilities, expands AI provider support, and improves local AI integration.

    ### What's New

    - **Native Speech Provider Support:** Added Deepgram, Groq, and OpenAI speech providers.
    - **Custom LLM Providers:** Connect to any OpenAI-compatible API including OpenRouter and DeepSeek.
    - **Smart Local AI:** Auto-detection of available Ollama models for local AI.
    - **Global Spotlight Search:** Toggle chat overlay with Cmd+K (macOS) and Ctrl+K (Windows/Linux).
    - **Masquerading Mode:** Appear as system processes like Terminal or Activity Monitor.
    - **Improved Stealth Mode:** Enhanced activation and window focus transitions.

    ### Improvements

    - **Natural Responses:** Updated system prompts for more concise and natural responses.
    - **Conversational Logic:** Reduced robotic preambles and unnecessary explanations.
    - **Performance:** Improved UI scaling and reduced speech-to-text latency.

    ### Fixes

    - No critical fixes reported in this release.

    ### Technical

    - Internal logic refinements for improved conversational flow.
    - Updater and background process stability improvements.

    #### macOS Installation (Unsigned Build)

    If you see "App is damaged":

    1. Move the app to your Applications folder.
    2. Open Terminal and run: `xattr -cr /Applications/Natively.app`

    ## [1.1.4] - 2026-02-12

    ### What's New in v1.1.4

    - **Custom LLM Providers:** Connect to any OpenAI-compatible API (OpenRouter, DeepSeek, commercial endpoints) simply by pasting a cURL command.
    - **Smart Local AI:** Enhanced Ollama integration that automatically detects and lists your available local models—no configuration required.
    - **Refined Human Persona:** Major updates to system prompts (`prompts.ts`) to ensure responses are concise, conversational, and indistinguishable from a real candidate.
    - **Anti-Chatbot Logic:** Specific negative constraints to prevent "AI-like" lectures, distinct "robot" preambles, and over-explanation.
    - **Global Spotlight Search:** Access AI chat instantly with `Cmd+K` / `Ctrl+K`.
    - **Masquerading (Undetectable Mode):** Stealth capability to disguise the app as common utility processes (Terminal, Activity Monitor) for discreet usage.

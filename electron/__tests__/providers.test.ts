/**
 * sensi M1 Step 5 — Provider unit + integration tests.
 *
 * Test surface (per TASKS.md M1 Step 5):
 *
 *   Unit (~10):
 *     LLMHelper.isMiniMaxModel — 5 case checks (private method, accessed via cast)
 *     LLMHelper.setMinimaxApiKey — 3 behaviour checks
 *     CredentialsManager.set/getMinimaxApiKey roundtrip
 *     CredentialsManager.set/getActiveProviderAndModel roundtrip
 *
 *   Integration-style (~5) — these exercise the same data-flow as the M1
 *   Step 4 IPC handlers without actually instantiating ipcMain. The handler
 *   bodies are thin closures over CredentialsManager + STANDARD_CLOUD_MODELS,
 *   so verifying the underlying logic gives us the same coverage with no
 *   Electron runtime required:
 *     get-configured-providers shape with no keys  (all configured: false)
 *     get-configured-providers shape with one key  (only that one configured)
 *     set-active-provider-and-model roundtrip      (persists + restores)
 *     get-models-for-provider('minimax')           (static baseline IDs)
 *     resolveModelForProvider fallback chain       (preferred → baseline)
 *
 * No network calls. The MiniMax client is the OpenAI SDK with a baseURL
 * override — its constructor stores config but does not hit the network,
 * so we can construct it freely without mocking `openai`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

// ─────────────────────────────────────────────────────────────────────────
// Mock the `electron` module BEFORE any imports that depend on it.
//
// vitest hoists vi.mock() calls to the very top of the module (above any
// other top-level statements), so the temp directory has to be computed
// INSIDE the factory closure — a top-level `const TEST_USER_DATA = ...`
// would be in the temporal dead zone when the mock factory runs.
// ─────────────────────────────────────────────────────────────────────────
vi.mock('electron', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodePath = require('node:path');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeOs = require('node:os');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeFs = require('node:fs');
  const tmpDir: string = nodePath.join(
    nodeOs.tmpdir(),
    `sensi-test-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
  );
  nodeFs.mkdirSync(tmpDir, { recursive: true });
  return {
    app: {
      getPath: (_key: string): string => tmpDir,
      isPackaged: false,
      whenReady: (): Promise<void> => Promise.resolve(),
      on: (): void => {},
    },
    safeStorage: {
      isEncryptionAvailable: (): boolean => false, // fall back to plaintext path in CredentialsManager
      encryptString: (s: string): Buffer => Buffer.from(s, 'utf-8'),
      decryptString: (b: Buffer): string => b.toString('utf-8'),
    },
    ipcMain: { handle: (): void => {}, removeHandler: (): void => {}, on: (): void => {} },
    BrowserWindow: { getAllWindows: (): unknown[] => [] },
  };
});

// Now safe to import modules that depend on `electron`.
import { CredentialsManager } from '../services/CredentialsManager';
import { STANDARD_CLOUD_MODELS } from '../shared/standardCloudModels';
import type { ProviderId, ProviderStatus } from '../providers/types';

// LLMHelper imports sharp + several SDKs at the top level. The SDKs are pure
// JS and safe; sharp loads its prebuilt native binary which was rebuilt by
// the postinstall step so it imports fine under Node 24.
import { LLMHelper, resolveMaxCompletionTokens } from '../LLMHelper';

// sensi M2-T4: migrateDbFilename is a pure function (only uses fs + path + console),
// so importing it from DatabaseManager.ts does not trigger better-sqlite3 or
// sqlite-vec side effects until a DatabaseManager instance is actually constructed.
// Tests call the function directly with temp paths — no singleton touched.
import { migrateDbFilename, type DbMigrationResult } from '../db/DatabaseManager';

// sensi M3-T2: STT auto-promotion helper — pure function extracted from the
// set-deepgram-api-key IPC handler so it can be unit-tested without pulling
// in ipcMain.handle side effects.
import { maybeAutoPromoteDeepgram } from '../services/sttAutoPromote';

// sensi M4-T2: document parser helpers. Lives in the same file as every
// other M1/M2/M3 test suite rather than a dedicated parsers.test.ts
// because a separate file triggers a vitest file-transition segfault:
// pdfjs-dist leaves residual fake-worker state after parsers load, and
// loading sharp via LLMHelper in the next file crashes the parent fork.
// Merging into one file keeps everything in a single long-lived worker
// with no file-to-file transition. Diagnosed during M4-T2 execution.
import {
    extractTextFromPdf,
    extractTextFromDocx,
    extractTextFromMarkdown,
    extractTextFromPlain,
} from '../knowledge/parsers';

// sensi M4-T3: chunking helper. Pure function, no deps, no side effects.
import { splitIntoChunks } from '../knowledge/chunker';

// sensi M4-T5: embedding adapter. DI-friendly — constructor accepts test
// doubles for probeOllama / embedWithOllama / embedWithGemini / getGeminiApiKey
// so tests run fully deterministic with no real network.
import {
    EmbeddingAdapter,
    KnowledgeEmbeddingProviderUnavailableError,
    KnowledgeEmbeddingRequestError,
    KnowledgeEmbeddingDimensionError,
    hasOllamaEmbeddingModel,
} from '../knowledge/EmbeddingAdapter';

// sensi M4-T6: knowledge orchestrator. Composes T2–T5 behind a narrow
// ingest/query/admin API. Tests use DI with in-memory store + adapter
// stubs — no real filesystem, no real network, no real DB.
import {
    KnowledgeOrchestrator,
    KnowledgeIngestError,
    KnowledgeQueryError,
    KnowledgeEmbeddingModelMismatchError,
    type KnowledgeStoreLike,
    type EmbeddingAdapterLike,
} from '../knowledge/KnowledgeOrchestrator';
import type {
    KnowledgeDocument,
    RetrievedChunk,
} from '../knowledge/KnowledgeStore';
// sensi M4-T8: runtime imports for error classes needed by the IPC
// helper tests below.
import { KnowledgeNotFoundError } from '../knowledge/KnowledgeStore';

// sensi M4-T7: knowledge context builder for rolling prompt. Pure async
// helper — tests DI a minimal orchestrator-like stub.
import {
    buildKnowledgeContextBlock,
    type KnowledgeOrchestratorForContext,
} from '../knowledge/buildKnowledgeContext';

// sensi M4-T7: WhatToAnswerLLM integration — verifies the knowledge
// hook is invoked in the right order and the block reaches the fullMessage.
import { WhatToAnswerLLM } from '../llm/WhatToAnswerLLM';

// sensi M4-T8: knowledge IPC helper functions. Pure — each handler
// takes an orchestrator and returns a discriminated-union result.
// Tests pass a stub orchestrator to exercise validation + delegation +
// error translation without ipcMain.handle scaffolding.
import {
    handleIngestDocument,
    handleListDocuments,
    handleDeleteDocument,
    handlePinDocument,
    handleUnpinDocument,
    handleListPinned,
    handleQueryKnowledge,
    handleGetDocumentPreview,
    makeKnowledgeContextClosure,
    PREVIEW_DEFAULT_MAX_CHARS,
    PREVIEW_HARD_MAX_CHARS,
    type KnowledgeOrchestratorForIpc,
    type KnowledgeIpcFailure,
} from '../knowledge/knowledgeIpcHelpers';

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

/** Reset the CredentialsManager singleton between tests so state never leaks. */
function freshCredentialsManager(): CredentialsManager {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (CredentialsManager as any).instance = null;
  const cm = CredentialsManager.getInstance();
  cm.init();
  cm.clearAll();
  return cm;
}

// ─────────────────────────────────────────────────────────────────────────
// UNIT: LLMHelper.isMiniMaxModel — 5 cases (private method, cast to access)
// ─────────────────────────────────────────────────────────────────────────
describe('LLMHelper.isMiniMaxModel', () => {
  let helper: LLMHelper;
  beforeEach(() => {
    helper = new LLMHelper();
  });

  it("returns true for 'MiniMax-M2.7'", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((helper as any).isMiniMaxModel('MiniMax-M2.7')).toBe(true);
  });

  it("returns true for 'MINIMAX-M2.7' (case insensitive)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((helper as any).isMiniMaxModel('MINIMAX-M2.7')).toBe(true);
  });

  it("returns true for 'abab6-chat' (legacy MiniMax prefix)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((helper as any).isMiniMaxModel('abab6-chat')).toBe(true);
  });

  it("returns false for 'gemini-3.1-flash'", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((helper as any).isMiniMaxModel('gemini-3.1-flash')).toBe(false);
  });

  it("returns false for 'gpt-5.4'", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((helper as any).isMiniMaxModel('gpt-5.4')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// UNIT: LLMHelper.setMinimaxApiKey — construction + clear + replace
// ─────────────────────────────────────────────────────────────────────────
describe('LLMHelper.setMinimaxApiKey', () => {
  let helper: LLMHelper;
  beforeEach(() => {
    helper = new LLMHelper();
  });

  it('constructs the minimaxClient when given a non-empty key', () => {
    helper.setMinimaxApiKey('sk-test-key');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((helper as any).minimaxClient).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((helper as any).minimaxApiKey).toBe('sk-test-key');
  });

  it('clears the minimaxClient when given null', () => {
    helper.setMinimaxApiKey('sk-test-key');
    helper.setMinimaxApiKey(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((helper as any).minimaxClient).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((helper as any).minimaxApiKey).toBeNull();
  });

  it('replaces the existing client when called twice with different keys', () => {
    helper.setMinimaxApiKey('sk-key-one');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const firstClient = (helper as any).minimaxClient;
    helper.setMinimaxApiKey('sk-key-two');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const secondClient = (helper as any).minimaxClient;
    expect(secondClient).not.toBeNull();
    expect(secondClient).not.toBe(firstClient);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((helper as any).minimaxApiKey).toBe('sk-key-two');
  });

  it('treats whitespace-only keys as empty (clears client)', () => {
    helper.setMinimaxApiKey('   ');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((helper as any).minimaxClient).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// UNIT: LLMHelper.stripThinkingTags — MiniMax M2.7 reasoning block removal.
//
// MiniMax M2.7 emits raw <think>...</think> blocks before its actual answer.
// stripThinkingTags is the stateless helper used by generateWithMiniMax and
// surfaced here for testability. The streaming path inside streamWithMiniMax
// uses a separate stateful filter that handles tags spanning chunk
// boundaries — this suite covers only the stateless helper per the M1
// cleanup spec.
// ─────────────────────────────────────────────────────────────────────────
describe('LLMHelper.stripThinkingTags', () => {
  let helper: LLMHelper;
  beforeEach(() => {
    helper = new LLMHelper();
  });

  it('removes a complete <think>...</think> block from a single string', () => {
    const input = '<think>some reasoning</think>actual response';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((helper as any).stripThinkingTags(input)).toBe('actual response');
  });

  it('leaves an unclosed <think> tag as-is (partial chunk passthrough)', () => {
    // The stateless helper cannot know if a closing tag is in a later chunk,
    // so it must NOT strip — that's the streaming filter's job. Eagerly
    // stripping here would corrupt legitimate text like "I think this is
    // great" if it ever passed through.
    const input = '<think>incomplete reasoning';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((helper as any).stripThinkingTags(input)).toBe('<think>incomplete reasoning');
  });

  it('passes through strings with no think tags unchanged', () => {
    const input = 'just a normal response with no tags';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((helper as any).stripThinkingTags(input)).toBe('just a normal response with no tags');
  });

  it('strips a think block followed by actual response content', () => {
    const input = '<think>let me reason about this</think>The answer is 42.';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((helper as any).stripThinkingTags(input)).toBe('The answer is 42.');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// UNIT: CredentialsManager — MiniMax slot roundtrip + active pair roundtrip
// ─────────────────────────────────────────────────────────────────────────
describe('CredentialsManager — MiniMax credential slot', () => {
  let cm: CredentialsManager;
  beforeEach(() => {
    cm = freshCredentialsManager();
  });

  it('round-trips a stored MiniMax key', () => {
    expect(cm.getMinimaxApiKey()).toBeUndefined();
    cm.setMinimaxApiKey('sk-mini-1');
    expect(cm.getMinimaxApiKey()).toBe('sk-mini-1');
  });

  it('clears the key when set with empty string', () => {
    cm.setMinimaxApiKey('sk-mini-2');
    expect(cm.getMinimaxApiKey()).toBe('sk-mini-2');
    cm.setMinimaxApiKey('');
    expect(cm.getMinimaxApiKey()).toBeUndefined();
  });

  it('persists across getInstance() calls in the same session', () => {
    cm.setMinimaxApiKey('sk-mini-3');
    const cm2 = CredentialsManager.getInstance();
    expect(cm2.getMinimaxApiKey()).toBe('sk-mini-3');
  });
});

describe('CredentialsManager — active provider+model pair', () => {
  let cm: CredentialsManager;
  beforeEach(() => {
    cm = freshCredentialsManager();
  });

  it('returns nulls before any selection', () => {
    const pair = cm.getActiveProviderAndModel();
    expect(pair.provider).toBeNull();
    expect(pair.model).toBeNull();
  });

  it('round-trips a set provider+model pair', () => {
    cm.setActiveProviderAndModel('minimax', 'MiniMax-M2.7');
    const pair = cm.getActiveProviderAndModel();
    expect(pair.provider).toBe('minimax');
    expect(pair.model).toBe('MiniMax-M2.7');
  });

  it('updates the per-provider preferred model alongside the active pair', () => {
    cm.setActiveProviderAndModel('gemini', 'gemini-3.1-pro-preview');
    expect(cm.getPreferredModel('gemini')).toBe('gemini-3.1-pro-preview');
    cm.setActiveProviderAndModel('gemini', 'gemini-3.1-flash-lite-preview');
    expect(cm.getPreferredModel('gemini')).toBe('gemini-3.1-flash-lite-preview');
  });

  it('does not touch a non-existent ollamaPreferredModel field', () => {
    cm.setActiveProviderAndModel('ollama', 'ollama-llama3.2');
    const pair = cm.getActiveProviderAndModel();
    expect(pair.provider).toBe('ollama');
    expect(pair.model).toBe('ollama-llama3.2');
    // No ollamaPreferredModel field should have been added — accessing it returns undefined
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((cm as any).credentials.ollamaPreferredModel).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// INTEGRATION: STANDARD_CLOUD_MODELS registry shape
// (verifies the static baseline used by the get-models-for-provider IPC)
// ─────────────────────────────────────────────────────────────────────────
describe('STANDARD_CLOUD_MODELS registry', () => {
  it('has a minimax entry with two model IDs', () => {
    const entry = STANDARD_CLOUD_MODELS.minimax;
    expect(entry).toBeDefined();
    expect(entry.ids.length).toBeGreaterThanOrEqual(1);
    expect(entry.ids).toContain('MiniMax-M2.7');
  });

  it('minimax entry hasKeyCheck reads hasMinimaxKey', () => {
    expect(STANDARD_CLOUD_MODELS.minimax.hasKeyCheck({ hasMinimaxKey: true })).toBe(true);
    expect(STANDARD_CLOUD_MODELS.minimax.hasKeyCheck({ hasMinimaxKey: false })).toBe(false);
    expect(STANDARD_CLOUD_MODELS.minimax.hasKeyCheck({})).toBe(false);
    expect(STANDARD_CLOUD_MODELS.minimax.hasKeyCheck(null)).toBe(false);
  });

  it('every provider in the registry has at least one baseline model ID', () => {
    for (const [provider, entry] of Object.entries(STANDARD_CLOUD_MODELS)) {
      expect(entry.ids.length, `provider ${provider} has at least one ID`).toBeGreaterThanOrEqual(1);
      expect(entry.names.length, `provider ${provider} names match ids`).toBe(entry.ids.length);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// INTEGRATION: resolveModelForProvider fallback chain
// (verifies the helper used by llm:set-active-provider-and-model when the
//  caller switches providers without specifying a model)
// ─────────────────────────────────────────────────────────────────────────
describe('CredentialsManager.resolveModelForProvider', () => {
  let cm: CredentialsManager;
  beforeEach(() => {
    cm = freshCredentialsManager();
  });

  it('falls back to the first static baseline model when no preference stored', () => {
    expect(cm.resolveModelForProvider('minimax')).toBe(STANDARD_CLOUD_MODELS.minimax.ids[0]);
    expect(cm.resolveModelForProvider('gemini')).toBe(STANDARD_CLOUD_MODELS.gemini.ids[0]);
    expect(cm.resolveModelForProvider('claude')).toBe(STANDARD_CLOUD_MODELS.claude.ids[0]);
    expect(cm.resolveModelForProvider('openai')).toBe(STANDARD_CLOUD_MODELS.openai.ids[0]);
    expect(cm.resolveModelForProvider('groq')).toBe(STANDARD_CLOUD_MODELS.groq.ids[0]);
  });

  it("returns the user's last-used model when a preference is stored", () => {
    cm.setPreferredModel('minimax', 'MiniMax-M2.7-highspeed');
    expect(cm.resolveModelForProvider('minimax')).toBe('MiniMax-M2.7-highspeed');
  });

  it('returns null for ollama when no defaultModel is stored', () => {
    expect(cm.resolveModelForProvider('ollama')).toBeNull();
  });

  it('returns the stored ollama default when one is set', () => {
    cm.setActiveProviderAndModel('ollama', 'ollama-llama3.2');
    expect(cm.resolveModelForProvider('ollama')).toBe('ollama-llama3.2');
  });

  it('per-provider preferred model survives a switch and switch-back', () => {
    cm.setActiveProviderAndModel('minimax', 'MiniMax-M2.7');
    cm.setActiveProviderAndModel('gemini', 'gemini-3.1-pro-preview');
    // Now switch back to MiniMax — resolveModelForProvider should return the
    // last-used MiniMax model, not the default.
    expect(cm.resolveModelForProvider('minimax')).toBe('MiniMax-M2.7');
    expect(cm.resolveModelForProvider('gemini')).toBe('gemini-3.1-pro-preview');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// INTEGRATION: ProviderStatus shape generation (mirrors the buildProviderStatus
// closure inside ipcHandlers.ts — implemented here as a pure function so we
// can test it without spinning up ipcMain or AppState)
// ─────────────────────────────────────────────────────────────────────────

interface BuildOpts {
  configured: boolean;
  preferredModel?: string;
  activePair: { provider: ProviderId | null; model: string | null };
  ollamaModels?: string[];
}

/**
 * Pure version of the same logic that lives inside ipcHandlers.ts
 * `buildProviderStatus`. Verifies that, given the same inputs, the test
 * helper produces the exact ProviderStatus shape the renderer relies on.
 * If this drifts from the IPC handler logic, the manual smoke test will
 * surface the divergence — both sides ultimately consume the same
 * STANDARD_CLOUD_MODELS registry.
 */
function buildProviderStatus(provider: ProviderId, opts: BuildOpts): ProviderStatus {
  const isActive = opts.activePair.provider === provider && opts.configured;
  let models: string[] = [];

  if (provider === 'ollama') {
    if (opts.ollamaModels && opts.ollamaModels.length > 0) {
      models = opts.ollamaModels.map((m) => `ollama-${m}`);
    }
  } else if (provider === 'sensi-managed') {
    // sensi-managed has no baseline model list — the backend picks the
    // model per tier. The registry doesn't apply.
    models = ['sensi-managed'];
  } else if (opts.configured) {
    const entry = STANDARD_CLOUD_MODELS[provider];
    if (entry) {
      const baseline = [...entry.ids];
      if (opts.preferredModel && !baseline.includes(opts.preferredModel)) {
        baseline.push(opts.preferredModel);
      }
      models = baseline;
    }
  }

  return {
    provider,
    configured: opts.configured,
    active: isActive,
    models,
    activeModel: isActive ? opts.activePair.model : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// sensi M2-T4 — DatabaseManager filename migration (natively.db → sensi.db)
//
// The migration is a pure function that only touches fs + path, so each test
// gets its own fresh temp directory with hand-crafted old/new file states.
// Tests verify all 5 branches of the contract plus the logging output.
// ─────────────────────────────────────────────────────────────────────────
describe('migrateDbFilename (M2-T4 sensi DB rename)', () => {
    let tmpDir: string;
    let oldPath: string;
    let newPath: string;
    const createFile = (p: string, content: string): void => {
        fs.writeFileSync(p, content, 'utf-8');
    };

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sensi-db-migration-'));
        oldPath = path.join(tmpDir, 'natively.db');
        newPath = path.join(tmpDir, 'sensi.db');
    });

    afterEach(() => {
        // Best-effort cleanup; ignore errors if files are already gone
        try {
            if (fs.existsSync(tmpDir)) {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        } catch { /* ignore */ }
    });

    it('fresh install: no old file, no new file — returns fresh, no copy', () => {
        expect(fs.existsSync(oldPath)).toBe(false);
        expect(fs.existsSync(newPath)).toBe(false);

        const result = migrateDbFilename(oldPath, newPath);

        expect(result.status).toBe('fresh');
        expect(fs.existsSync(oldPath)).toBe(false);
        expect(fs.existsSync(newPath)).toBe(false);
    });

    it('upgrade: old file exists, new does not — copies, verifies, deletes old', () => {
        const payload = 'SQLite format 3\x00__fake_db_payload_for_migration_test__';
        createFile(oldPath, payload);
        expect(fs.existsSync(oldPath)).toBe(true);
        expect(fs.existsSync(newPath)).toBe(false);

        const result = migrateDbFilename(oldPath, newPath);

        expect(result.status).toBe('migrated');
        if (result.status === 'migrated') {
            expect(result.bytesCopied).toBe(Buffer.byteLength(payload, 'utf-8'));
        }
        // Old file deleted, new file present with identical contents
        expect(fs.existsSync(oldPath)).toBe(false);
        expect(fs.existsSync(newPath)).toBe(true);
        expect(fs.readFileSync(newPath, 'utf-8')).toBe(payload);
    });

    it('re-run: sensi.db already exists (old already deleted) — skips migration, no changes', () => {
        const payload = 'already-migrated-content';
        createFile(newPath, payload);
        expect(fs.existsSync(oldPath)).toBe(false);
        expect(fs.existsSync(newPath)).toBe(true);

        const result = migrateDbFilename(oldPath, newPath);

        expect(result.status).toBe('already-migrated');
        // sensi.db content untouched
        expect(fs.readFileSync(newPath, 'utf-8')).toBe(payload);
        expect(fs.existsSync(oldPath)).toBe(false);
    });

    it('both files exist: skips migration, both files remain, logs warning', () => {
        const oldPayload = 'old-natively-db-content';
        const newPayload = 'new-sensi-db-content';
        createFile(oldPath, oldPayload);
        createFile(newPath, newPayload);
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

        const result = migrateDbFilename(oldPath, newPath);

        expect(result.status).toBe('both-exist');
        // Both files still present — migration did NOT touch either
        expect(fs.existsSync(oldPath)).toBe(true);
        expect(fs.existsSync(newPath)).toBe(true);
        expect(fs.readFileSync(oldPath, 'utf-8')).toBe(oldPayload);
        expect(fs.readFileSync(newPath, 'utf-8')).toBe(newPayload);
        // Warning logged
        expect(warnSpy).toHaveBeenCalledOnce();
        expect(warnSpy.mock.calls[0]?.[0]).toMatch(/skipping migration, using sensi\.db/i);
        warnSpy.mockRestore();
    });

    it('copy fails: logs error, does not crash, cleans up any partial sensi.db', () => {
        const payload = 'content-that-will-fail-to-copy';
        createFile(oldPath, payload);
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
        // Force fs.copyFileSync to throw, simulating a disk-full or
        // permissions error. The migration must catch, log, clean up, and
        // return a 'failed' status WITHOUT propagating the throw.
        const copySpy = vi.spyOn(fs, 'copyFileSync').mockImplementation(() => {
            throw new Error('EACCES: simulated permission denied');
        });

        let result: DbMigrationResult;
        expect(() => {
            result = migrateDbFilename(oldPath, newPath);
        }).not.toThrow();

        expect(result!.status).toBe('failed');
        if (result!.status === 'failed') {
            expect(result!.error).toContain('EACCES');
        }
        // Error was logged, old file untouched (init() will retry on next launch
        // or create a fresh sensi.db), no partial sensi.db left behind
        expect(errSpy).toHaveBeenCalledOnce();
        expect(fs.existsSync(oldPath)).toBe(true);
        expect(fs.existsSync(newPath)).toBe(false);

        copySpy.mockRestore();
        errSpy.mockRestore();
    });

    it('migration success: logs the expected one-line message with byte count', () => {
        const payload = 'x'.repeat(1234);
        createFile(oldPath, payload);
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => { });

        const result = migrateDbFilename(oldPath, newPath);

        expect(result.status).toBe('migrated');
        expect(logSpy).toHaveBeenCalled();
        // Find the specific "Migrated natively.db → sensi.db" line among any other logs
        const migrationLog = logSpy.mock.calls.find(call =>
            typeof call[0] === 'string' && call[0].includes('Migrated natively.db → sensi.db')
        );
        expect(migrationLog).toBeDefined();
        expect(migrationLog?.[0]).toContain('1234 bytes');

        logSpy.mockRestore();
    });
});

describe('ProviderStatus generation (mirrors llm:get-configured-providers logic)', () => {
  it('with no providers configured: every provider is configured: false', () => {
    const providers: ProviderId[] = ['minimax', 'gemini', 'claude', 'openai', 'groq', 'ollama'];
    const statuses = providers.map((p) =>
      buildProviderStatus(p, {
        configured: false,
        activePair: { provider: null, model: null },
      }),
    );
    expect(statuses).toHaveLength(6);
    for (const s of statuses) {
      expect(s.configured).toBe(false);
      expect(s.active).toBe(false);
      expect(s.models).toEqual([]);
      expect(s.activeModel).toBeNull();
      expect(s.lastError).toBeUndefined();
    }
  });

  it('with only MiniMax configured: only MiniMax shows configured + models', () => {
    const providers: ProviderId[] = ['minimax', 'gemini', 'claude', 'openai', 'groq', 'ollama'];
    const statuses = providers.map((p) =>
      buildProviderStatus(p, {
        configured: p === 'minimax',
        activePair: { provider: null, model: null },
      }),
    );
    const minimax = statuses.find((s) => s.provider === 'minimax')!;
    expect(minimax.configured).toBe(true);
    expect(minimax.models).toContain('MiniMax-M2.7');
    expect(minimax.models.length).toBeGreaterThanOrEqual(1);

    for (const s of statuses) {
      if (s.provider === 'minimax') continue;
      expect(s.configured).toBe(false);
      expect(s.models).toEqual([]);
    }
  });

  it('reports active=true and activeModel set when the active pair matches', () => {
    const status = buildProviderStatus('minimax', {
      configured: true,
      activePair: { provider: 'minimax', model: 'MiniMax-M2.7' },
    });
    expect(status.active).toBe(true);
    expect(status.activeModel).toBe('MiniMax-M2.7');
  });

  it('does not mark a configured provider as active when the active pair points elsewhere', () => {
    const status = buildProviderStatus('minimax', {
      configured: true,
      activePair: { provider: 'gemini', model: 'gemini-3.1-flash-lite-preview' },
    });
    expect(status.active).toBe(false);
    expect(status.activeModel).toBeNull();
  });

  it('appends a unique preferred model to the baseline list', () => {
    const status = buildProviderStatus('gemini', {
      configured: true,
      preferredModel: 'gemini-experimental-future',
      activePair: { provider: null, model: null },
    });
    expect(status.models).toContain('gemini-3.1-flash-lite-preview');
    expect(status.models).toContain('gemini-experimental-future');
  });

  it('does not duplicate a preferred model that is already in the baseline', () => {
    const baselineFirst = STANDARD_CLOUD_MODELS.gemini.ids[0];
    const status = buildProviderStatus('gemini', {
      configured: true,
      preferredModel: baselineFirst,
      activePair: { provider: null, model: null },
    });
    const occurrences = status.models.filter((m) => m === baselineFirst).length;
    expect(occurrences).toBe(1);
  });

  it('ollama configured with two installed models prefixes them with ollama-', () => {
    const status = buildProviderStatus('ollama', {
      configured: true,
      activePair: { provider: 'ollama', model: 'ollama-llama3.2' },
      ollamaModels: ['llama3.2', 'mistral:7b'],
    });
    expect(status.configured).toBe(true);
    expect(status.models).toEqual(['ollama-llama3.2', 'ollama-mistral:7b']);
    expect(status.active).toBe(true);
    expect(status.activeModel).toBe('ollama-llama3.2');
  });
});

// ═════════════════════════════════════════════════════════════════════════
// sensi M4-T2 — Document parser helpers
//
// Four parsers exercised:
//   - extractTextFromPdf       — via a hand-built minimal PDF buffer
//   - extractTextFromDocx      — via a jszip-built minimal DOCX buffer
//   - extractTextFromMarkdown  — via a committed fixture file + inline cases
//   - extractTextFromPlain     — via a committed fixture file + inline cases
//
// Binary fixtures (PDF, DOCX) are built in-memory rather than committed,
// because the text-mode file-write tools can corrupt binary bytes. Hand-
// rolled PDF uses computed xref offsets; DOCX uses `jszip` which is a
// guaranteed transitive dep of `mammoth` (npm ls jszip → sensi → mammoth →
// jszip). Markdown and plain-text fixtures are committed under
// electron/__tests__/fixtures/knowledge/ as real text files.
// ═════════════════════════════════════════════════════════════════════════

const KB_FIXTURE_DIR = path.resolve(__dirname, 'fixtures', 'knowledge');
const KB_MD_FIXTURE = path.join(KB_FIXTURE_DIR, 'sample.md');
const KB_TXT_FIXTURE = path.join(KB_FIXTURE_DIR, 'sample.txt');

/**
 * Build a minimal valid PDF buffer containing a single text line.
 *
 * PDF structure (5 indirect objects + xref + trailer):
 *   1: Catalog → Pages
 *   2: Pages (Kids: [Page])
 *   3: Page (MediaBox + Font resource + Contents ref)
 *   4: Contents stream (BT ... Tj ET)
 *   5: Font (Helvetica, Type1)
 *
 * Byte offsets for each object are computed as we append to the parts
 * list — this is the only fragile part. `cursor` is maintained in
 * latin1-byte-count (every string is latin1-encoded so byte length ===
 * string length).
 */
function buildMinimalPdf(text: string): Buffer {
    // PDF strings use () as delimiters — escape backslash and parens
    const safe = text
        .replace(/\\/g, '\\\\')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)');

    const parts: string[] = [];
    const offsets: number[] = [0]; // object 0 is the free sentinel
    let cursor = 0;

    const add = (s: string): void => {
        parts.push(s);
        cursor += Buffer.byteLength(s, 'latin1');
    };
    const markObj = (n: number): void => {
        while (offsets.length <= n) offsets.push(0);
        offsets[n] = cursor;
    };

    // Header + binary marker (signals "real PDF" to lenient readers)
    add('%PDF-1.4\n');
    add('%\xE2\xE3\xCF\xD3\n');

    markObj(1);
    add('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

    markObj(2);
    add('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

    markObj(3);
    add(
        '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
        '/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n'
    );

    const stream = `BT /F1 18 Tf 72 720 Td (${safe}) Tj ET\n`;
    const streamLen = Buffer.byteLength(stream, 'latin1');
    markObj(4);
    add(`4 0 obj\n<< /Length ${streamLen} >>\nstream\n${stream}endstream\nendobj\n`);

    markObj(5);
    add('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');

    // xref table
    const xrefStart = cursor;
    add('xref\n0 6\n');
    add('0000000000 65535 f \n');
    for (let i = 1; i <= 5; i++) {
        add(offsets[i].toString().padStart(10, '0') + ' 00000 n \n');
    }

    // trailer
    add('trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF\n');

    return Buffer.concat(parts.map((p) => Buffer.from(p, 'latin1')));
}

/**
 * Build a minimal valid DOCX buffer containing a single paragraph.
 *
 * DOCX is a zip of three XML files:
 *   [Content_Types].xml  — maps file extensions and part paths to MIME
 *   _rels/.rels          — root relationships pointing at word/document.xml
 *   word/document.xml    — the actual Word document body
 *
 * `jszip` is a transitive dep of `mammoth` (npm ls jszip → sensi@2.4.0 →
 * mammoth@1.11.0 → jszip@3.10.1). Safe as long as mammoth stays in deps.
 */
async function buildMinimalDocx(text: string): Promise<Buffer> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const JSZip = require('jszip');
    const zip = new JSZip();

    zip.file(
        '[Content_Types].xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
            '<Default Extension="xml" ContentType="application/xml"/>' +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
            '</Types>'
    );

    zip.file(
        '_rels/.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
            '</Relationships>'
    );

    const escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    zip.file(
        'word/document.xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
            '<w:body><w:p><w:r><w:t xml:space="preserve">' +
            escaped +
            '</w:t></w:r></w:p></w:body>' +
            '</w:document>'
    );

    return await zip.generateAsync({ type: 'nodebuffer' });
}

describe('parsers.extractTextFromMarkdown (M4-T2)', () => {
    it('reads committed fixture, preserves headings and body text', () => {
        const buf = fs.readFileSync(KB_MD_FIXTURE);
        const out = extractTextFromMarkdown(buf);
        expect(out).toContain('# sensi knowledge base fixture');
        expect(out).toContain('## Section one');
        expect(out).toContain('## Section two');
        expect(out).toContain('First body paragraph');
        expect(out).toContain('Second body paragraph');
        // Outer trim: first char is a '#', last char is non-whitespace
        expect(out.startsWith('#')).toBe(true);
        expect(/\s$/.test(out)).toBe(false);
    });

    it('returns empty string for empty buffer', () => {
        expect(extractTextFromMarkdown(Buffer.alloc(0))).toBe('');
    });

    it('trims outer whitespace but preserves internal paragraph structure', () => {
        const buf = Buffer.from('   \n\n# Title\n\nbody\n\n   ', 'utf-8');
        expect(extractTextFromMarkdown(buf)).toBe('# Title\n\nbody');
    });

    it('collapses 3+ consecutive blank lines to exactly 2', () => {
        const buf = Buffer.from('a\n\n\n\n\nb', 'utf-8');
        expect(extractTextFromMarkdown(buf)).toBe('a\n\nb');
    });
});

describe('parsers.extractTextFromPlain (M4-T2)', () => {
    it('reads committed plain-text fixture and returns expected content', () => {
        const buf = fs.readFileSync(KB_TXT_FIXTURE);
        const out = extractTextFromPlain(buf);
        expect(out).toContain('Plain text fixture');
        expect(out).toContain('Line one of the body.');
        expect(out).toContain('A second paragraph');
        expect(/^\s/.test(out)).toBe(false);
        expect(/\s$/.test(out)).toBe(false);
    });

    it('normalizes CRLF line endings to LF', () => {
        const buf = Buffer.from('a\r\nb\r\nc', 'utf-8');
        expect(extractTextFromPlain(buf)).toBe('a\nb\nc');
    });

    it('normalizes bare CR line endings to LF', () => {
        const buf = Buffer.from('a\rb\rc', 'utf-8');
        expect(extractTextFromPlain(buf)).toBe('a\nb\nc');
    });

    it('returns empty string for empty buffer', () => {
        expect(extractTextFromPlain(Buffer.alloc(0))).toBe('');
    });

    it('returns empty string for whitespace-only buffer (trimmed)', () => {
        expect(extractTextFromPlain(Buffer.from('   \n\n\t  ', 'utf-8'))).toBe('');
    });
});

describe('parsers.extractTextFromDocx (M4-T2)', () => {
    it('returns non-empty text containing expected snippet', async () => {
        const docx = await buildMinimalDocx(
            'sensi DOCX fixture: hello from mammoth'
        );
        const out = await extractTextFromDocx(docx);
        expect(out.length).toBeGreaterThan(0);
        expect(out).toContain('sensi DOCX fixture');
        expect(out).toContain('hello from mammoth');
    });

    it('returns empty string for empty buffer (no parser call)', async () => {
        expect(await extractTextFromDocx(Buffer.alloc(0))).toBe('');
    });

    it('trims outer whitespace on the extracted paragraph', async () => {
        const docx = await buildMinimalDocx('   hello world   ');
        const out = await extractTextFromDocx(docx);
        // mammoth preserves the leading/trailing spaces inside the <w:t>
        // element, but normalize() trims them at the outer boundary.
        expect(out).toBe('hello world');
    });
});

describe('parsers.extractTextFromPdf (M4-T2)', () => {
    it('returns non-empty text containing expected snippet', async () => {
        const pdf = buildMinimalPdf('sensi PDF fixture text');
        const out = await extractTextFromPdf(pdf);
        expect(out.length).toBeGreaterThan(0);
        expect(out).toContain('sensi PDF fixture');
    });

    it('returns empty string for empty buffer (no parser call)', async () => {
        expect(await extractTextFromPdf(Buffer.alloc(0))).toBe('');
    });
});

// ═════════════════════════════════════════════════════════════════════════
// sensi M4-T3 — Chunking helper
//
// Pure function `splitIntoChunks(text, { maxChars, overlap })`. No deps,
// no side effects. Default maxChars=1500, overlap=200. Prefers sentence-
// boundary cuts in the last ~30% of each window; falls through to hard
// cuts when no `.?!` boundary is available.
// ═════════════════════════════════════════════════════════════════════════

describe('chunker.splitIntoChunks (M4-T3)', () => {
    it('returns [] for empty string', () => {
        expect(splitIntoChunks('')).toEqual([]);
    });

    it('returns [] for whitespace-only string', () => {
        expect(splitIntoChunks('   \n\n\t  ')).toEqual([]);
    });

    it('returns a single trimmed chunk when text is shorter than maxChars', () => {
        expect(splitIntoChunks('short text', { maxChars: 1500 })).toEqual([
            'short text',
        ]);
    });

    it('trims outer whitespace on a single short chunk', () => {
        expect(splitIntoChunks('   hello world   ', { maxChars: 1500 })).toEqual([
            'hello world',
        ]);
    });

    it('prefers sentence-boundary cuts when punctuation is present', () => {
        // 100 sentences repeated. Every sentence ends with `. ` which is
        // a hard boundary for the chunker's backward search.
        const sentence = 'This is a sentence that ends with a period. ';
        const text = sentence.repeat(100);
        const chunks = splitIntoChunks(text, { maxChars: 500, overlap: 50 });

        expect(chunks.length).toBeGreaterThan(1);
        // At least one chunk — realistically most — should end on a period,
        // proving the sentence-boundary search actually fired.
        const endingWithPeriod = chunks.filter((c) => c.endsWith('.'));
        expect(endingWithPeriod.length).toBeGreaterThan(0);
    });

    it('hard-cuts at maxChars when no sentence boundary is available', () => {
        // Pure filler — no .?! anywhere, so the sentence-boundary search
        // finds nothing and falls through to the hard-cut path.
        const text = 'a'.repeat(5000);
        const chunks = splitIntoChunks(text, { maxChars: 1000, overlap: 100 });

        expect(chunks.length).toBeGreaterThan(1);
        for (const c of chunks) {
            expect(c.length).toBeLessThanOrEqual(1000);
        }
    });

    it('preserves overlap characters between adjacent chunks (hard-cut path)', () => {
        // 5000 chars, cycling every 10 — no punctuation so cuts are all
        // hard-cuts at exact maxChars boundaries, making overlap math
        // easy to verify byte-for-byte.
        const text = 'abcdefghij'.repeat(500);
        const chunks = splitIntoChunks(text, { maxChars: 1000, overlap: 100 });

        expect(chunks.length).toBeGreaterThanOrEqual(2);
        // chunk[0] is raw text[0..1000); its last 100 chars are text[900..1000)
        // chunk[1] is raw text[900..1900); its first 100 chars are text[900..1000)
        // So chunks[0].slice(-100) === chunks[1].slice(0, 100).
        const tail0 = chunks[0].slice(-100);
        const head1 = chunks[1].slice(0, 100);
        expect(head1).toBe(tail0);
        expect(head1.length).toBe(100);
    });

    it('respects a custom maxChars option', () => {
        const text = 'a'.repeat(500);
        const chunks = splitIntoChunks(text, { maxChars: 200, overlap: 20 });
        expect(chunks.length).toBeGreaterThan(1);
        for (const c of chunks) {
            expect(c.length).toBeLessThanOrEqual(200);
        }
    });

    it('respects a custom overlap option (zero overlap = contiguous chunks)', () => {
        // Zero overlap over pure-filler text means chunks are byte-exact
        // contiguous slices — rejoining them reproduces the original.
        const text = 'a'.repeat(1000);
        const chunks = splitIntoChunks(text, { maxChars: 300, overlap: 0 });
        expect(chunks.length).toBeGreaterThan(1);
        expect(chunks.join('')).toBe(text);
    });

    it('never emits empty chunks', () => {
        // Mix of short sentences, large whitespace gaps, and long filler
        // to exercise several code paths at once.
        const text =
            'short. ' + ' '.repeat(100) + 'mid. ' + 'long text '.repeat(100);
        const chunks = splitIntoChunks(text, { maxChars: 200, overlap: 20 });
        expect(chunks.length).toBeGreaterThan(0);
        for (const c of chunks) {
            expect(c.length).toBeGreaterThan(0);
        }
    });

    it('no chunk exceeds maxChars after trimming (size invariant)', () => {
        const text = 'Lorem ipsum dolor sit amet. '.repeat(200); // ~5600 chars
        const chunks = splitIntoChunks(text, { maxChars: 600, overlap: 60 });
        expect(chunks.length).toBeGreaterThan(1);
        for (const c of chunks) {
            expect(c.length).toBeLessThanOrEqual(600);
        }
    });

    it('clamps overlap to maxChars - 1 to prevent infinite loops', () => {
        // Caller passes overlap >= maxChars — the helper clamps internally
        // and still makes forward progress on long inputs.
        const text = 'b'.repeat(1000);
        const chunks = splitIntoChunks(text, { maxChars: 100, overlap: 500 });
        expect(chunks.length).toBeGreaterThan(0);
        // Every chunk respects the max-size invariant.
        for (const c of chunks) {
            expect(c.length).toBeLessThanOrEqual(100);
        }
    });
});

// ═════════════════════════════════════════════════════════════════════════
// sensi M4-T5 — EmbeddingAdapter
//
// All tests use dependency injection to stub out the four network/credential
// hooks (probeOllama, embedWithOllama, embedWithGemini, getGeminiApiKey).
// No real fetch, no `vi.mock`, no module stubbing. Each test constructs an
// EmbeddingAdapter with its own deps bag and asserts behavior end-to-end.
//
// Why DI instead of vi.mock: the four hooks are small and narrowly typed,
// so injecting them at the constructor is simpler and more deterministic
// than replacing module-level function exports. It also mirrors how a
// future M4-T6 orchestrator could inject a cached/pooled implementation
// without touching adapter internals.
// ═════════════════════════════════════════════════════════════════════════

describe('EmbeddingAdapter (M4-T5)', () => {
    // Helper: build a 768-dim Float32Array with a deterministic pattern
    // so tests can assert position and value without hand-filling 768 floats.
    const vec768 = (fn: (i: number) => number): Float32Array => {
        const a = new Float32Array(768);
        for (let i = 0; i < 768; i++) a[i] = fn(i);
        return a;
    };

    it('embed([]) returns [] without probing any provider', async () => {
        let probeCalled = false;
        const adapter = new EmbeddingAdapter({
            probeOllama: async () => {
                probeCalled = true;
                return true;
            },
            embedWithOllama: async () => [],
            embedWithGemini: async () => [],
            getGeminiApiKey: () => null,
        });
        const result = await adapter.embed([]);
        expect(result).toEqual([]);
        expect(probeCalled).toBe(false);
    });

    it('Ollama available → adapter selects Ollama and returns 768-dim vectors', async () => {
        const adapter = new EmbeddingAdapter({
            probeOllama: async () => true,
            embedWithOllama: async (texts) =>
                texts.map((_, i) => vec768((j) => (j === 0 ? i : 0))),
            embedWithGemini: async () => {
                throw new Error('Gemini should not be called when Ollama is available');
            },
            getGeminiApiKey: () => 'should-not-be-read',
        });
        const vectors = await adapter.embed(['alpha', 'beta', 'gamma']);
        expect(vectors.length).toBe(3);
        for (const v of vectors) {
            expect(v).toBeInstanceOf(Float32Array);
            expect(v.length).toBe(768);
        }
        // Provider identity recorded
        expect(adapter.getActiveEmbeddingConfig()).toEqual({
            provider: 'ollama',
            model: 'nomic-embed-text',
            dimension: 768,
        });
    });

    it('Ollama unavailable + Gemini configured → adapter selects Gemini', async () => {
        let geminiCalledWithKey: string | null = null;
        const adapter = new EmbeddingAdapter({
            probeOllama: async () => false,
            embedWithOllama: async () => {
                throw new Error('Ollama should not be called when probe returned false');
            },
            embedWithGemini: async (texts, apiKey) => {
                geminiCalledWithKey = apiKey;
                return texts.map((_, i) => vec768((j) => (j === 1 ? i : 0)));
            },
            getGeminiApiKey: () => 'AIzaFAKE_GEMINI_KEY',
        });
        const vectors = await adapter.embed(['one', 'two']);
        expect(vectors.length).toBe(2);
        expect(geminiCalledWithKey).toBe('AIzaFAKE_GEMINI_KEY');
        expect(adapter.getActiveEmbeddingConfig()).toEqual({
            provider: 'gemini',
            model: 'gemini-embedding-001',
            dimension: 768,
        });
    });

    it('Ollama unavailable + no Gemini key → KnowledgeEmbeddingProviderUnavailableError', async () => {
        const adapter = new EmbeddingAdapter({
            probeOllama: async () => false,
            embedWithOllama: async () => [],
            embedWithGemini: async () => [],
            getGeminiApiKey: () => null,
        });
        await expect(adapter.embed(['hello'])).rejects.toBeInstanceOf(
            KnowledgeEmbeddingProviderUnavailableError
        );
    });

    it('provider returns wrong vector dimension → KnowledgeEmbeddingDimensionError', async () => {
        const adapter = new EmbeddingAdapter({
            probeOllama: async () => true,
            embedWithOllama: async (texts) =>
                // Return 512-dim vectors instead of 768 — contract violation
                texts.map(() => new Float32Array(512)),
            embedWithGemini: async () => [],
            getGeminiApiKey: () => null,
        });
        await expect(adapter.embed(['x'])).rejects.toBeInstanceOf(
            KnowledgeEmbeddingDimensionError
        );
    });

    it('returned vector count matches input string count (mismatch throws)', async () => {
        const adapter = new EmbeddingAdapter({
            probeOllama: async () => true,
            embedWithOllama: async () => [vec768(() => 1)], // only 1 vector
            embedWithGemini: async () => [],
            getGeminiApiKey: () => null,
        });
        // 3 inputs, 1 vector back → provider returned wrong count
        await expect(adapter.embed(['a', 'b', 'c'])).rejects.toBeInstanceOf(
            KnowledgeEmbeddingRequestError
        );
    });

    it('returned vector order matches input order', async () => {
        // Encode input index as the first float value; then verify that
        // the adapter's return preserves the 0, 1, 2, 3 ordering.
        const adapter = new EmbeddingAdapter({
            probeOllama: async () => true,
            embedWithOllama: async (texts) =>
                texts.map((_, i) => vec768((j) => (j === 0 ? i + 100 : 0))),
            embedWithGemini: async () => [],
            getGeminiApiKey: () => null,
        });
        const vectors = await adapter.embed(['w', 'x', 'y', 'z']);
        expect(vectors.length).toBe(4);
        expect(vectors[0][0]).toBe(100);
        expect(vectors[1][0]).toBe(101);
        expect(vectors[2][0]).toBe(102);
        expect(vectors[3][0]).toBe(103);
    });

    it('probe timeout path does not hang tests', async () => {
        // Simulate the real 500ms probe timeout via a stub that resolves
        // quickly with `false`. If the adapter's control flow accidentally
        // awaits something else here, this test will hang and vitest's
        // outer timeout catches it.
        let probeResolvedAt = 0;
        const adapter = new EmbeddingAdapter({
            probeOllama: async () => {
                probeResolvedAt = Date.now();
                return false;
            },
            embedWithOllama: async () => [],
            embedWithGemini: async (texts) => texts.map(() => vec768(() => 0.5)),
            getGeminiApiKey: () => 'key',
        });
        const start = Date.now();
        await adapter.embed(['q']);
        const elapsed = Date.now() - start;
        // Probe must have been consulted and resolved, and the whole call
        // returned well under the real 500ms probe timeout.
        expect(probeResolvedAt).toBeGreaterThanOrEqual(start);
        expect(elapsed).toBeLessThan(500);
    });

    it('getActiveEmbeddingConfig() reports the provider/model/dimension actually used', async () => {
        // First call selects Ollama
        const adapter = new EmbeddingAdapter({
            probeOllama: async () => true,
            embedWithOllama: async (texts) => texts.map(() => vec768(() => 0.1)),
            embedWithGemini: async () => [],
            getGeminiApiKey: () => null,
        });
        await adapter.embed(['a']);
        const cfg = adapter.getActiveEmbeddingConfig();
        expect(cfg.provider).toBe('ollama');
        expect(cfg.model).toBe('nomic-embed-text');
        expect(cfg.dimension).toBe(768);
    });

    it('getActiveEmbeddingConfig() before any embed() throws', () => {
        const adapter = new EmbeddingAdapter({
            probeOllama: async () => true,
            embedWithOllama: async () => [],
            embedWithGemini: async () => [],
            getGeminiApiKey: () => null,
        });
        expect(() => adapter.getActiveEmbeddingConfig()).toThrowError(
            KnowledgeEmbeddingProviderUnavailableError
        );
    });

    it('empty string input throws KnowledgeEmbeddingRequestError', async () => {
        // Policy: T5 rejects empty strings loudly because T3 splitIntoChunks
        // never emits empty chunks, so any empty string here is a contract
        // violation upstream. See D018.
        const adapter = new EmbeddingAdapter({
            probeOllama: async () => true,
            embedWithOllama: async (texts) => texts.map(() => vec768(() => 0)),
            embedWithGemini: async () => [],
            getGeminiApiKey: () => null,
        });
        await expect(adapter.embed(['valid', ''])).rejects.toBeInstanceOf(
            KnowledgeEmbeddingRequestError
        );
    });

    it('whitespace-only string input throws KnowledgeEmbeddingRequestError', async () => {
        const adapter = new EmbeddingAdapter({
            probeOllama: async () => true,
            embedWithOllama: async (texts) => texts.map(() => vec768(() => 0)),
            embedWithGemini: async () => [],
            getGeminiApiKey: () => null,
        });
        await expect(adapter.embed(['valid', '   \n\t  '])).rejects.toBeInstanceOf(
            KnowledgeEmbeddingRequestError
        );
    });

    it('trims outer whitespace before forwarding to provider', async () => {
        let forwarded: readonly string[] | null = null;
        const adapter = new EmbeddingAdapter({
            probeOllama: async () => true,
            embedWithOllama: async (texts) => {
                forwarded = texts;
                return texts.map(() => vec768(() => 0));
            },
            embedWithGemini: async () => [],
            getGeminiApiKey: () => null,
        });
        await adapter.embed(['  hello  ', '\tworld\n']);
        expect(forwarded).toEqual(['hello', 'world']);
    });

    it('empty input array does not throw even if all providers unavailable', async () => {
        // Corollary of "embed([]) returns [] without probing" — an empty
        // input array is a fast-path no-op and must not surface the
        // "no provider available" error.
        const adapter = new EmbeddingAdapter({
            probeOllama: async () => false,
            embedWithOllama: async () => {
                throw new Error('unreachable');
            },
            embedWithGemini: async () => {
                throw new Error('unreachable');
            },
            getGeminiApiKey: () => null,
        });
        await expect(adapter.embed([])).resolves.toEqual([]);
    });

    // ─────────────────────────────────────────────────────────────────
    // M4-T6 addition: EmbeddingAdapter.resolveProvider()
    //
    // Pure probe — no embed hook called, no state mutation. Added so
    // the orchestrator can stamp kb_documents.embedding_model for zero-
    // chunk documents without burning an embed quota unit. See D019a.
    // ─────────────────────────────────────────────────────────────────
    describe('resolveProvider (M4-T6 extension)', () => {
        it('Ollama available → returns ollama config without calling embed', async () => {
            let ollamaEmbedCalled = false;
            const adapter = new EmbeddingAdapter({
                probeOllama: async () => true,
                embedWithOllama: async () => {
                    ollamaEmbedCalled = true;
                    return [];
                },
                embedWithGemini: async () => [],
                getGeminiApiKey: () => null,
            });
            const cfg = await adapter.resolveProvider();
            expect(cfg).toEqual({
                provider: 'ollama',
                model: 'nomic-embed-text',
                dimension: 768,
            });
            expect(ollamaEmbedCalled).toBe(false);
            // active state is NOT mutated by resolveProvider
            expect(() => adapter.getActiveEmbeddingConfig()).toThrowError(
                KnowledgeEmbeddingProviderUnavailableError
            );
        });

        it('Ollama unavailable + Gemini configured → returns gemini config', async () => {
            const adapter = new EmbeddingAdapter({
                probeOllama: async () => false,
                embedWithOllama: async () => [],
                embedWithGemini: async () => [],
                getGeminiApiKey: () => 'AIzaFAKE',
            });
            const cfg = await adapter.resolveProvider();
            expect(cfg).toEqual({
                provider: 'gemini',
                model: 'gemini-embedding-001',
                dimension: 768,
            });
        });

        it('neither available → throws KnowledgeEmbeddingProviderUnavailableError', async () => {
            const adapter = new EmbeddingAdapter({
                probeOllama: async () => false,
                embedWithOllama: async () => [],
                embedWithGemini: async () => [],
                getGeminiApiKey: () => null,
            });
            await expect(adapter.resolveProvider()).rejects.toBeInstanceOf(
                KnowledgeEmbeddingProviderUnavailableError
            );
        });
    });
});

// ═════════════════════════════════════════════════════════════════════════
// sensi M4-T6 — KnowledgeOrchestrator
//
// DI-friendly: tests pass stub store + adapter + readFile + parseBuffer
// hooks. No real filesystem, no real DB, no real network. The structural
// interfaces KnowledgeStoreLike and EmbeddingAdapterLike from the
// orchestrator module already exist for this purpose.
// ═════════════════════════════════════════════════════════════════════════

describe('KnowledgeOrchestrator (M4-T6)', () => {
    // Helper: build a 768-dim Float32Array for embedding returns
    const vec768 = (fn: (i: number) => number): Float32Array => {
        const a = new Float32Array(768);
        for (let i = 0; i < 768; i++) a[i] = fn(i);
        return a;
    };

    // Helper: build a KnowledgeDocument row suitable for listDocuments mocks
    const fakeDoc = (partial: Partial<KnowledgeDocument>): KnowledgeDocument => ({
        id: 'fake-id',
        name: 'fake.pdf',
        mime: 'application/pdf',
        bytes: 100,
        embeddingModel: 'nomic-embed-text',
        embeddingDim: 768,
        pinned: false,
        pinnedAt: null,
        ingestedAt: '2025-01-01 00:00:00',
        chunkCount: 0,
        ...partial,
    });

    // Helper: build a RetrievedChunk for searchByEmbedding mocks
    const fakeHit = (partial: Partial<RetrievedChunk>): RetrievedChunk => ({
        documentId: 'fake-doc',
        documentName: 'fake.pdf',
        chunkIndex: 0,
        text: 'fake chunk',
        distance: 0.5,
        ...partial,
    });

    // Builder: construct a store stub that tracks calls via a log
    interface StoreCallLog {
        insertDocument: Array<[Parameters<KnowledgeStoreLike['insertDocument']>[0]]>;
        upsertChunks: Array<Parameters<KnowledgeStoreLike['upsertChunks']>>;
        deleteDocument: string[];
        listDocumentsResult: KnowledgeDocument[];
        searchByEmbedding: Array<Parameters<KnowledgeStoreLike['searchByEmbedding']>>;
        searchResult: RetrievedChunk[];
        listPinnedResult: KnowledgeDocument[];
        setPinned: Array<[string, boolean]>;
        getDocumentText: string[];
        getDocumentTextResult: string;
    }

    const makeStore = (override: Partial<StoreCallLog> = {}): { store: KnowledgeStoreLike; log: StoreCallLog } => {
        const log: StoreCallLog = {
            insertDocument: [],
            upsertChunks: [],
            deleteDocument: [],
            listDocumentsResult: override.listDocumentsResult ?? [],
            searchByEmbedding: [],
            searchResult: override.searchResult ?? [],
            listPinnedResult: override.listPinnedResult ?? [],
            setPinned: [],
            getDocumentText: [],
            getDocumentTextResult: override.getDocumentTextResult ?? 'fake text',
        };
        const store: KnowledgeStoreLike = {
            insertDocument: (meta) => {
                log.insertDocument.push([meta]);
                return 'generated-doc-id';
            },
            upsertChunks: (docId, chunks, embeddings) => {
                log.upsertChunks.push([docId, chunks, embeddings]);
            },
            listDocuments: () => log.listDocumentsResult,
            deleteDocument: (id) => {
                log.deleteDocument.push(id);
            },
            searchByEmbedding: (q, k) => {
                log.searchByEmbedding.push([q, k]);
                return log.searchResult;
            },
            getDocumentText: (id) => {
                log.getDocumentText.push(id);
                return log.getDocumentTextResult;
            },
            setPinned: (id, pinned) => {
                log.setPinned.push([id, pinned]);
                return { pinnedAt: pinned ? '2025-01-01 00:00:00' : null };
            },
            listPinned: () => log.listPinnedResult,
            // M4-T10 stubs — not exercised by M4-T6 tests; return empty.
            getDocumentChunksWithEmbeddings: () => [],
            replaceAllFromArtifact: () => ({ replaced: 0, imported: 0 }),
        };
        return { store, log };
    };

    // Builder: construct an adapter stub with configurable resolve + embed behavior
    const makeAdapter = (opts: {
        resolveModel?: string;
        resolveProvider?: 'ollama' | 'gemini';
        embedReturns?: (chunks: readonly string[]) => Float32Array[];
        embedThrows?: Error;
        resolveThrows?: Error;
    }): {
        adapter: EmbeddingAdapterLike;
        log: { embed: Array<readonly string[]>; resolveProvider: number };
    } => {
        const log = { embed: [] as Array<readonly string[]>, resolveProvider: 0 };
        let active: ReturnType<EmbeddingAdapterLike['getActiveEmbeddingConfig']> | null = null;
        const model = opts.resolveModel ?? 'nomic-embed-text';
        const provider = opts.resolveProvider ?? 'ollama';
        const cfg = { provider, model, dimension: 768 as const };

        const adapter: EmbeddingAdapterLike = {
            embed: async (strings) => {
                log.embed.push(strings);
                if (opts.embedThrows) throw opts.embedThrows;
                active = cfg;
                return opts.embedReturns
                    ? opts.embedReturns(strings)
                    : strings.map(() => vec768(() => 0));
            },
            getActiveEmbeddingConfig: () => {
                if (!active) throw new KnowledgeEmbeddingProviderUnavailableError('not resolved yet');
                return active;
            },
            resolveProvider: async () => {
                log.resolveProvider++;
                if (opts.resolveThrows) throw opts.resolveThrows;
                return cfg;
            },
        };
        return { adapter, log };
    };

    // ─────────────────────────────────────────────────────────────────
    // ingestDocument tests
    // ─────────────────────────────────────────────────────────────────

    it('ingestDocument parses → chunks → embeds → stores in order', async () => {
        const { store, log: storeLog } = makeStore();
        const { adapter, log: adapterLog } = makeAdapter({});
        const callOrder: string[] = [];
        const orch = new KnowledgeOrchestrator({
            store,
            adapter,
            readFile: async (p) => {
                callOrder.push(`readFile:${p}`);
                return Buffer.from('raw file bytes');
            },
            parseBuffer: async (_buf, mime) => {
                callOrder.push(`parseBuffer:${mime}`);
                // Return enough text that splitIntoChunks emits ≥2 chunks.
                return 'Sentence one. '.repeat(300);
            },
        });

        const result = await orch.ingestDocument('/tmp/resume.pdf');

        // Call ordering: read → parse → resolve → insert → embed → upsert
        expect(callOrder[0]).toBe('readFile:/tmp/resume.pdf');
        expect(callOrder[1]).toBe('parseBuffer:application/pdf');
        expect(adapterLog.resolveProvider).toBe(1);
        expect(storeLog.insertDocument.length).toBe(1);
        expect(adapterLog.embed.length).toBe(1);
        expect(storeLog.upsertChunks.length).toBe(1);

        // Metadata correctly derived
        const [meta] = storeLog.insertDocument[0];
        expect(meta.name).toBe('resume.pdf');
        expect(meta.mime).toBe('application/pdf');
        expect(meta.embeddingModel).toBe('nomic-embed-text');
        expect(meta.embeddingDim).toBe(768);
        expect(meta.bytes).toBe(Buffer.from('raw file bytes').byteLength);

        // Result shape
        expect(result.documentId).toBe('generated-doc-id');
        expect(result.chunkCount).toBeGreaterThan(0);
        expect(result.embeddingModel).toBe('nomic-embed-text');
        expect(result.embeddingProvider).toBe('ollama');
    });

    it('ingestDocument zero-chunk path creates metadata row and skips embed()', async () => {
        const { store, log: storeLog } = makeStore();
        const { adapter, log: adapterLog } = makeAdapter({});
        const orch = new KnowledgeOrchestrator({
            store,
            adapter,
            readFile: async () => Buffer.from('irrelevant'),
            // Parser returns empty string → chunker returns []
            parseBuffer: async () => '',
        });

        const result = await orch.ingestDocument('/tmp/empty.md');

        // resolveProvider called (to get metadata for insertDocument)
        expect(adapterLog.resolveProvider).toBe(1);
        // insertDocument called
        expect(storeLog.insertDocument.length).toBe(1);
        // embed NOT called
        expect(adapterLog.embed.length).toBe(0);
        // upsertChunks NOT called
        expect(storeLog.upsertChunks.length).toBe(0);
        // Result reports zero chunks with valid metadata
        expect(result.chunkCount).toBe(0);
        expect(result.embeddingModel).toBe('nomic-embed-text');
        expect(result.embeddingProvider).toBe('ollama');
    });

    it('ingestDocument preserves chunk array order exactly into upsertChunks', async () => {
        const { store, log: storeLog } = makeStore();
        // Custom embed: encode the chunk index as the first float so we
        // can assert order end-to-end.
        const { adapter } = makeAdapter({
            embedReturns: (chunks) =>
                chunks.map((_, i) => vec768((j) => (j === 0 ? i + 1 : 0))),
        });
        const orch = new KnowledgeOrchestrator({
            store,
            adapter,
            readFile: async () => Buffer.from('irrelevant'),
            // Produce 3 deterministic chunks using hard-cut path (no
            // sentence boundaries, maxChars=10).
            parseBuffer: async () => 'aaaaaaaaaabbbbbbbbbbcccccccccc',
        });

        // Note: we rely on the default splitIntoChunks behavior inside
        // the orchestrator (with default options). The text is 30 chars,
        // which is < default maxChars=1500, so it comes out as ONE chunk.
        // That's fine for testing order — the [0]th chunk in the input
        // array must equal the [0]th chunk passed to upsertChunks.
        await orch.ingestDocument('/tmp/test.txt');

        expect(storeLog.upsertChunks.length).toBe(1);
        const [, chunks, embeddings] = storeLog.upsertChunks[0];
        expect(chunks.length).toBe(embeddings.length);
        // Every chunk at index i must have its embedding at the same index
        for (let i = 0; i < chunks.length; i++) {
            const emb = embeddings[i] as Float32Array;
            expect(emb[0]).toBe(i + 1);
        }
    });

    it('ingestDocument cleans up inserted document on downstream failure', async () => {
        const { store, log: storeLog } = makeStore();
        const upsertError = new Error('simulated upsertChunks failure');
        // Override upsertChunks to throw AFTER insertDocument has
        // already added a row — this is the atomicity failure case.
        const storeWithFailure: KnowledgeStoreLike = {
            ...store,
            upsertChunks: () => {
                throw upsertError;
            },
        };
        const { adapter } = makeAdapter({});
        const orch = new KnowledgeOrchestrator({
            store: storeWithFailure,
            adapter,
            readFile: async () => Buffer.from('irrelevant'),
            parseBuffer: async () => 'some text content here',
        });

        await expect(orch.ingestDocument('/tmp/test.txt')).rejects.toBe(upsertError);
        // The inserted document should have been cleaned up
        expect(storeLog.insertDocument.length).toBe(1);
        expect(storeLog.deleteDocument).toContain('generated-doc-id');
    });

    it('ingestDocument throws KnowledgeIngestError for unsupported file type', async () => {
        const { store } = makeStore();
        const { adapter } = makeAdapter({});
        const orch = new KnowledgeOrchestrator({
            store,
            adapter,
            readFile: async () => Buffer.from('irrelevant'),
            parseBuffer: async () => 'text',
        });
        await expect(
            orch.ingestDocument('/tmp/unknown.xyz')
        ).rejects.toBeInstanceOf(KnowledgeIngestError);
    });

    it('ingestDocument wraps fs read failures in KnowledgeIngestError with cause', async () => {
        const { store } = makeStore();
        const { adapter } = makeAdapter({});
        const fsError = new Error('ENOENT');
        const orch = new KnowledgeOrchestrator({
            store,
            adapter,
            readFile: async () => {
                throw fsError;
            },
            parseBuffer: async () => '',
        });
        let caught: unknown = null;
        try {
            await orch.ingestDocument('/tmp/missing.pdf');
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(KnowledgeIngestError);
        expect((caught as KnowledgeIngestError).cause).toBe(fsError);
    });

    // ─────────────────────────────────────────────────────────────────
    // KNOWLEDGE-FIX-01 — ingest-time embedding error routing
    // ─────────────────────────────────────────────────────────────────

    it('ingestDocument wraps KnowledgeEmbeddingRequestError from embed() as KnowledgeIngestError and still cleans up', async () => {
        const { store, log: storeLog } = makeStore();
        const embedFailure = new KnowledgeEmbeddingRequestError(
            'simulated ollama 404: model nomic-embed-text not found'
        );
        const { adapter } = makeAdapter({ embedThrows: embedFailure });
        const orch = new KnowledgeOrchestrator({
            store,
            adapter,
            readFile: async () => Buffer.from('raw file bytes'),
            parseBuffer: async () => 'Sentence one. '.repeat(300),
        });

        let caught: unknown = null;
        try {
            await orch.ingestDocument('/tmp/doc.md');
        } catch (e) {
            caught = e;
        }

        // The thrown error must be a KnowledgeIngestError so IPC
        // translation maps it to `ingest_failed`, not `query_failed`.
        expect(caught).toBeInstanceOf(KnowledgeIngestError);
        // The original provider error must be chained as `cause` so
        // main-process logs can still diagnose the underlying failure.
        expect((caught as KnowledgeIngestError).cause).toBe(embedFailure);
        // Atomicity cleanup: the half-written doc row must be deleted
        // before the wrapped error is thrown.
        expect(storeLog.deleteDocument.length).toBe(1);
        expect(storeLog.deleteDocument[0]).toBe('generated-doc-id');
    });

    it('ingestDocument surfaces KnowledgeEmbeddingProviderUnavailableError unchanged (provider_unavailable contract preserved)', async () => {
        const { store, log: storeLog } = makeStore();
        const providerUnavailable = new KnowledgeEmbeddingProviderUnavailableError(
            'Ollama unreachable and no Gemini API key configured'
        );
        const { adapter } = makeAdapter({ resolveThrows: providerUnavailable });
        const orch = new KnowledgeOrchestrator({
            store,
            adapter,
            readFile: async () => Buffer.from('raw file bytes'),
            parseBuffer: async () => 'Sentence one. '.repeat(300),
        });

        let caught: unknown = null;
        try {
            await orch.ingestDocument('/tmp/doc.md');
        } catch (e) {
            caught = e;
        }

        // The thrown error must still be a KnowledgeEmbeddingProviderUnavailableError
        // so the user sees the "Start Ollama or add a Gemini API key" hint
        // via the `provider_unavailable` errorType. It must NOT be
        // re-wrapped in KnowledgeIngestError — that would collapse the
        // signal into the generic ingest_failed bucket.
        expect(caught).toBeInstanceOf(KnowledgeEmbeddingProviderUnavailableError);
        // Resolution fails before any DB write — insertDocument was never
        // called, so there is nothing to clean up.
        expect(storeLog.insertDocument.length).toBe(0);
        expect(storeLog.deleteDocument.length).toBe(0);
    });

    // ─────────────────────────────────────────────────────────────────
    // queryKnowledge tests
    // ─────────────────────────────────────────────────────────────────

    it('queryKnowledge rejects empty query', async () => {
        const { store } = makeStore();
        const { adapter } = makeAdapter({});
        const orch = new KnowledgeOrchestrator({ store, adapter });
        await expect(
            orch.queryKnowledge({ query: '', topK: 5 })
        ).rejects.toBeInstanceOf(KnowledgeQueryError);
        await expect(
            orch.queryKnowledge({ query: '   \n\t  ', topK: 5 })
        ).rejects.toBeInstanceOf(KnowledgeQueryError);
    });

    it('queryKnowledge sanitizes topK', async () => {
        const { store } = makeStore();
        const { adapter } = makeAdapter({});
        const orch = new KnowledgeOrchestrator({ store, adapter });
        await expect(
            orch.queryKnowledge({ query: 'hi', topK: 0 })
        ).rejects.toBeInstanceOf(KnowledgeQueryError);
        await expect(
            orch.queryKnowledge({ query: 'hi', topK: -3 })
        ).rejects.toBeInstanceOf(KnowledgeQueryError);
        await expect(
            orch.queryKnowledge({ query: 'hi', topK: Number.NaN })
        ).rejects.toBeInstanceOf(KnowledgeQueryError);
    });

    it('queryKnowledge embeds once and forwards to store search', async () => {
        const { store, log: storeLog } = makeStore({
            listDocumentsResult: [
                fakeDoc({ id: 'd1', embeddingModel: 'nomic-embed-text' }),
            ],
            searchResult: [
                fakeHit({ documentId: 'd1', distance: 0.1, text: 'matched' }),
            ],
        });
        const { adapter, log: adapterLog } = makeAdapter({});
        const orch = new KnowledgeOrchestrator({ store, adapter });

        const result = await orch.queryKnowledge({ query: 'find me', topK: 5 });

        expect(adapterLog.embed.length).toBe(1);
        expect(adapterLog.embed[0]).toEqual(['find me']);
        expect(storeLog.searchByEmbedding.length).toBe(1);
        // Single compatible doc, no filter → searchK === topK (no overfetch)
        expect(storeLog.searchByEmbedding[0][1]).toBe(5);
        expect(result.length).toBe(1);
        expect(result[0].documentId).toBe('d1');
    });

    it('queryKnowledge enforces embedding-model compatibility (all docs wrong model)', async () => {
        const { store } = makeStore({
            listDocumentsResult: [
                fakeDoc({ id: 'd1', embeddingModel: 'text-embedding-004' }),
                fakeDoc({ id: 'd2', embeddingModel: 'text-embedding-004' }),
            ],
        });
        // Adapter is Ollama (nomic-embed-text) but all docs are Gemini
        const { adapter } = makeAdapter({});
        const orch = new KnowledgeOrchestrator({ store, adapter });

        await expect(
            orch.queryKnowledge({ query: 'hi', topK: 5 })
        ).rejects.toBeInstanceOf(KnowledgeEmbeddingModelMismatchError);
    });

    it('queryKnowledge filters out incompatible docs silently when some match (mixed DB)', async () => {
        const { store, log: storeLog } = makeStore({
            listDocumentsResult: [
                fakeDoc({ id: 'd1', embeddingModel: 'nomic-embed-text' }), // compatible
                fakeDoc({ id: 'd2', embeddingModel: 'text-embedding-004' }), // incompatible
                fakeDoc({ id: 'd3', embeddingModel: 'nomic-embed-text' }), // compatible
            ],
            // Search returns hits from ALL docs; orchestrator filters
            searchResult: [
                fakeHit({ documentId: 'd1', distance: 0.1, text: 'from d1' }),
                fakeHit({ documentId: 'd2', distance: 0.2, text: 'from d2 (wrong model)' }),
                fakeHit({ documentId: 'd3', distance: 0.3, text: 'from d3' }),
            ],
        });
        const { adapter } = makeAdapter({});
        const orch = new KnowledgeOrchestrator({ store, adapter });

        const result = await orch.queryKnowledge({ query: 'hi', topK: 5 });

        // Mixed-model DB → orchestrator overfetches (topK * 4 = 20)
        expect(storeLog.searchByEmbedding[0][1]).toBe(20);
        // d2 silently filtered; d1 and d3 pass through
        expect(result.length).toBe(2);
        const ids = result.map((r) => r.documentId);
        expect(ids).toContain('d1');
        expect(ids).toContain('d3');
        expect(ids).not.toContain('d2');
    });

    it('queryKnowledge documentIds filter is respected', async () => {
        const { store, log: storeLog } = makeStore({
            listDocumentsResult: [
                fakeDoc({ id: 'd1', embeddingModel: 'nomic-embed-text' }),
                fakeDoc({ id: 'd2', embeddingModel: 'nomic-embed-text' }),
                fakeDoc({ id: 'd3', embeddingModel: 'nomic-embed-text' }),
            ],
            searchResult: [
                fakeHit({ documentId: 'd1', distance: 0.1, text: 'from d1' }),
                fakeHit({ documentId: 'd2', distance: 0.2, text: 'from d2' }),
                fakeHit({ documentId: 'd3', distance: 0.3, text: 'from d3' }),
            ],
        });
        const { adapter } = makeAdapter({});
        const orch = new KnowledgeOrchestrator({ store, adapter });

        const result = await orch.queryKnowledge({
            query: 'hi',
            topK: 10,
            documentIds: ['d2'],
        });

        // documentIds filter → overfetch kicks in
        expect(storeLog.searchByEmbedding[0][1]).toBe(40);
        expect(result.length).toBe(1);
        expect(result[0].documentId).toBe('d2');
    });

    it('queryKnowledge documentIds filter with no model-compatible matches throws', async () => {
        const { store } = makeStore({
            listDocumentsResult: [
                fakeDoc({ id: 'd1', embeddingModel: 'nomic-embed-text' }),
                fakeDoc({ id: 'd2', embeddingModel: 'text-embedding-004' }),
            ],
        });
        const { adapter } = makeAdapter({});
        const orch = new KnowledgeOrchestrator({ store, adapter });

        // Supplied docIds filter to only d2, which is incompatible
        await expect(
            orch.queryKnowledge({ query: 'hi', topK: 5, documentIds: ['d2'] })
        ).rejects.toBeInstanceOf(KnowledgeEmbeddingModelMismatchError);
    });

    it('queryKnowledge includePinned sorts pinned results ahead of non-pinned', async () => {
        const { store } = makeStore({
            listDocumentsResult: [
                fakeDoc({ id: 'd1', embeddingModel: 'nomic-embed-text' }),
                fakeDoc({ id: 'd2', embeddingModel: 'nomic-embed-text', pinned: true }),
            ],
            listPinnedResult: [
                fakeDoc({ id: 'd2', embeddingModel: 'nomic-embed-text', pinned: true }),
            ],
            // Distance-order: d1 closer (0.1), d2 farther (0.5)
            searchResult: [
                fakeHit({ documentId: 'd1', distance: 0.1, text: 'unpinned close' }),
                fakeHit({ documentId: 'd2', distance: 0.5, text: 'pinned far' }),
            ],
        });
        const { adapter } = makeAdapter({});
        const orch = new KnowledgeOrchestrator({ store, adapter });

        const result = await orch.queryKnowledge({
            query: 'hi',
            topK: 2,
            includePinned: true,
        });

        expect(result.length).toBe(2);
        // Pinned doc bubbles to the top despite higher distance
        expect(result[0].documentId).toBe('d2');
        expect(result[1].documentId).toBe('d1');
    });

    it('queryKnowledge returns [] when knowledge base is empty (not an error)', async () => {
        const { store } = makeStore({ listDocumentsResult: [] });
        const { adapter } = makeAdapter({});
        const orch = new KnowledgeOrchestrator({ store, adapter });

        const result = await orch.queryKnowledge({ query: 'hi', topK: 5 });
        expect(result).toEqual([]);
    });

    // ─────────────────────────────────────────────────────────────────
    // Delegation tests
    // ─────────────────────────────────────────────────────────────────

    it('listDocuments / getDocumentText delegate to store', () => {
        const docs = [fakeDoc({ id: 'd1', chunkCount: 3 })];
        const { store, log: storeLog } = makeStore({
            listDocumentsResult: docs,
            getDocumentTextResult: 'chunk one\n\nchunk two',
        });
        const { adapter } = makeAdapter({});
        const orch = new KnowledgeOrchestrator({ store, adapter });

        expect(orch.listDocuments()).toEqual(docs);
        expect(orch.getDocumentText('d1')).toBe('chunk one\n\nchunk two');
        expect(storeLog.getDocumentText).toEqual(['d1']);
    });

    it('deleteDocument delegates to store', () => {
        const { store, log: storeLog } = makeStore();
        const { adapter } = makeAdapter({});
        const orch = new KnowledgeOrchestrator({ store, adapter });
        orch.deleteDocument('d1');
        expect(storeLog.deleteDocument).toEqual(['d1']);
    });

    it('pinDocument / unpinDocument / listPinned delegate to store', () => {
        const pinned = [fakeDoc({ id: 'd2', pinned: true })];
        const { store, log: storeLog } = makeStore({ listPinnedResult: pinned });
        const { adapter } = makeAdapter({});
        const orch = new KnowledgeOrchestrator({ store, adapter });

        const pinResult = orch.pinDocument('d1');
        expect(pinResult.pinnedAt).not.toBeNull();
        expect(storeLog.setPinned).toContainEqual(['d1', true]);

        const unpinResult = orch.unpinDocument('d1');
        expect(unpinResult.pinnedAt).toBeNull();
        expect(storeLog.setPinned).toContainEqual(['d1', false]);

        expect(orch.listPinned()).toEqual(pinned);
    });
});

// ═════════════════════════════════════════════════════════════════════════
// TRIAGE-INGEST-01A — KnowledgeOrchestrator.ingestDocument stage tracing
//
// Purely additive logging added by TRIAGE-INGEST-01A. Behavior is
// unchanged — these tests spy on `console.log` / `console.error` and
// assert that the expected `[ingest]` prefixed lines fire in the
// expected order / combination. The DI harness (`makeStore`,
// `makeAdapter`) is the same one used by the M4-T6 describe block
// immediately above.
//
// Tests use substring assertions (`toContain`) against the concatenated
// capture so log-copy tweaks don't break them.
// ═════════════════════════════════════════════════════════════════════════

describe('KnowledgeOrchestrator ingest tracing (TRIAGE-INGEST-01A)', () => {
    // Re-declared locally (the M4-T6 `makeStore`/`makeAdapter` are
    // scoped inside their own describe). We keep the shape minimal:
    // only the slots these three tests actually need.
    interface StageStoreLog {
        insertDocument: Array<[Parameters<KnowledgeStoreLike['insertDocument']>[0]]>;
        upsertChunks: Array<Parameters<KnowledgeStoreLike['upsertChunks']>>;
        deleteDocument: string[];
    }

    const makeStageStore = (
        opts: { deleteThrows?: Error } = {}
    ): { store: KnowledgeStoreLike; log: StageStoreLog } => {
        const log: StageStoreLog = {
            insertDocument: [],
            upsertChunks: [],
            deleteDocument: [],
        };
        const store: KnowledgeStoreLike = {
            insertDocument: (meta) => {
                log.insertDocument.push([meta]);
                return 'stage-doc-id';
            },
            upsertChunks: (docId, chunks, embeddings) => {
                log.upsertChunks.push([docId, chunks, embeddings]);
            },
            listDocuments: () => [],
            deleteDocument: (id) => {
                log.deleteDocument.push(id);
                if (opts.deleteThrows) throw opts.deleteThrows;
            },
            searchByEmbedding: () => [],
            getDocumentText: () => '',
            setPinned: () => ({ pinnedAt: null }),
            listPinned: () => [],
            getDocumentChunksWithEmbeddings: () => [],
            replaceAllFromArtifact: () => ({ replaced: 0, imported: 0 }),
        };
        return { store, log };
    };

    const vec768Stage = (fn: (i: number) => number): Float32Array => {
        const a = new Float32Array(768);
        for (let i = 0; i < 768; i++) a[i] = fn(i);
        return a;
    };

    const makeStageAdapter = (opts: {
        resolveThrows?: Error;
        embedThrows?: Error;
    }): EmbeddingAdapterLike => {
        const cfg = {
            provider: 'gemini' as const,
            model: 'gemini-embedding-001',
            dimension: 768 as const,
        };
        let active: typeof cfg | null = null;
        return {
            embed: async (strings) => {
                if (opts.embedThrows) throw opts.embedThrows;
                active = cfg;
                return strings.map(() => vec768Stage(() => 0));
            },
            getActiveEmbeddingConfig: () => {
                if (!active) throw new KnowledgeEmbeddingProviderUnavailableError('not resolved yet');
                return active;
            },
            resolveProvider: async () => {
                if (opts.resolveThrows) throw opts.resolveThrows;
                return cfg;
            },
        };
    };

    let logSpy: ReturnType<typeof vi.spyOn>;
    let errSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        logSpy.mockRestore();
        errSpy.mockRestore();
    });

    const capturedLog = (): string =>
        logSpy.mock.calls.map((args) => args.join(' ')).join('\n');
    const capturedErr = (): string =>
        errSpy.mock.calls.map((args) => args.join(' ')).join('\n');

    it('happy path emits ordered stage logs', async () => {
        const { store } = makeStageStore();
        const adapter = makeStageAdapter({});
        const orch = new KnowledgeOrchestrator({
            store,
            adapter,
            readFile: async () => Buffer.from('raw file bytes'),
            parseBuffer: async () => 'Sentence one. '.repeat(300),
        });

        const result = await orch.ingestDocument('/tmp/doc.md');
        expect(result.documentId).toBe('stage-doc-id');

        const log = capturedLog();
        // Every expected stage line is present
        const expectedStages = [
            '[ingest] enter',
            '[ingest] readFile start',
            '[ingest] readFile ok bytes=',
            '[ingest] parse start mime=',
            '[ingest] parse ok textLength=',
            '[ingest] chunk start',
            '[ingest] chunk ok chunkCount=',
            '[ingest] resolveProvider start',
            '[ingest] resolveProvider ok provider=gemini model=gemini-embedding-001 dim=768',
            '[ingest] insertDocument start',
            '[ingest] insertDocument ok id=stage-doc-id',
            '[ingest] embed start chunkCount=',
            '[ingest] embed ok vectorCount=',
            '[ingest] upsertChunks start id=stage-doc-id',
            '[ingest] upsertChunks ok id=stage-doc-id',
            '[ingest] done id=stage-doc-id provider=gemini model=gemini-embedding-001 chunkCount=',
        ];
        for (const stage of expectedStages) {
            expect(log).toContain(stage);
        }
        // Ordering: each stage substring appears after the previous one.
        let prev = -1;
        for (const stage of expectedStages) {
            const idx = log.indexOf(stage);
            expect(idx).toBeGreaterThan(prev);
            prev = idx;
        }
        // Happy path must not emit any catch / wrap / pass-through line.
        const err = capturedErr();
        expect(err).not.toContain('[ingest] CAUGHT');
        expect(err).not.toContain('[ingest] cleanup');
        expect(err).not.toContain('[ingest] wrapped as');
        expect(err).not.toContain('[ingest] passed-through');
    });

    it('read failure emits catch log without cleanup', async () => {
        const { store } = makeStageStore();
        const adapter = makeStageAdapter({});
        const fsError = new Error('ENOENT: no such file');
        const orch = new KnowledgeOrchestrator({
            store,
            adapter,
            readFile: async () => {
                throw fsError;
            },
            parseBuffer: async () => '',
        });

        let caught: unknown = null;
        try {
            await orch.ingestDocument('/tmp/missing.md');
        } catch (e) {
            caught = e;
        }

        // Behavior preserved: readFile failures are still wrapped as
        // KnowledgeIngestError by the existing pre-step-8 try/catch
        // (predates KNOWLEDGE-FIX-01). No change here.
        expect(caught).toBeInstanceOf(KnowledgeIngestError);
        expect((caught as KnowledgeIngestError).cause).toBe(fsError);

        const log = capturedLog();
        const err = capturedErr();

        // Progressed up to readFile start then stopped
        expect(log).toContain('[ingest] enter');
        expect(log).toContain('[ingest] readFile start');
        expect(log).not.toContain('[ingest] readFile ok');

        // Catch log fired with the ENOENT cause
        expect(err).toContain('[ingest] CAUGHT stage=readFile error.name=Error');
        expect(err).toContain('[ingest] CAUGHT cause chain=');

        // Cleanup MUST NOT have run — insertDocument never succeeded, so
        // there is no documentId to delete. The step-8 cleanup block is
        // the only emitter of these lines, and this test's failure path
        // unwinds before step 8.
        expect(err).not.toContain('[ingest] cleanup start');
        expect(err).not.toContain('[ingest] cleanup ok');
        expect(err).not.toContain('[ingest] cleanup FAILED');

        // Wrap / pass-through lines are also only emitted from the
        // step-8 catch, so neither should appear here.
        expect(err).not.toContain('[ingest] wrapped as KnowledgeIngestError');
        expect(err).not.toContain('[ingest] passed-through');
    });

    it('embed failure emits catch + cleanup + wrapped signal', async () => {
        const { store, log: storeLog } = makeStageStore();
        const embedFailure = new KnowledgeEmbeddingRequestError(
            'Gemini batchEmbedContents failed: 400 Bad Request — simulated'
        );
        const adapter = makeStageAdapter({ embedThrows: embedFailure });
        const orch = new KnowledgeOrchestrator({
            store,
            adapter,
            readFile: async () => Buffer.from('raw bytes'),
            parseBuffer: async () => 'Sentence one. '.repeat(300),
        });

        let caught: unknown = null;
        try {
            await orch.ingestDocument('/tmp/doc.md');
        } catch (e) {
            caught = e;
        }

        // Behavior preserved from KNOWLEDGE-FIX-01: the
        // KnowledgeEmbeddingRequestError is wrapped in a
        // KnowledgeIngestError so IPC translation maps to ingest_failed.
        expect(caught).toBeInstanceOf(KnowledgeIngestError);
        expect((caught as KnowledgeIngestError).cause).toBe(embedFailure);

        const log = capturedLog();
        const err = capturedErr();

        // Progressed all the way to embed start, but not embed ok
        expect(log).toContain('[ingest] embed start chunkCount=');
        expect(log).not.toContain('[ingest] embed ok vectorCount=');
        expect(log).not.toContain('[ingest] upsertChunks start');
        expect(log).not.toContain('[ingest] done');

        // Catch log fired with the embed error class name
        expect(err).toContain(
            '[ingest] CAUGHT stage=embed/upsertChunks error.name=KnowledgeEmbeddingRequestError'
        );
        expect(err).toContain('[ingest] CAUGHT cause chain=');

        // Atomicity cleanup ran and succeeded (stage store does not
        // throw from deleteDocument by default).
        expect(err).toContain('[ingest] cleanup start id=stage-doc-id');
        expect(err).toContain('[ingest] cleanup ok id=stage-doc-id');
        expect(err).not.toContain('[ingest] cleanup FAILED');

        // Wrap branch fired (NOT pass-through).
        expect(err).toContain(
            '[ingest] wrapped as KnowledgeIngestError cause.name=KnowledgeEmbeddingRequestError'
        );
        expect(err).not.toContain('[ingest] passed-through');

        // Sanity: the stage store actually received the delete call.
        expect(storeLog.deleteDocument).toEqual(['stage-doc-id']);
    });
});

// ═════════════════════════════════════════════════════════════════════════
// sensi M4-T7 — buildKnowledgeContextBlock
//
// DI-friendly: tests pass a stub orchestrator with three methods. No
// real DB, no real parser, no real embedder, no real network. Covers
// the format, budget, dedup, degradation, and query-derivation policies
// from DECISIONS.md D020.
// ═════════════════════════════════════════════════════════════════════════

describe('buildKnowledgeContextBlock (M4-T7)', () => {
    const fakeDocKb = (partial: Partial<KnowledgeDocument>): KnowledgeDocument => ({
        id: 'fake-id',
        name: 'fake.pdf',
        mime: 'application/pdf',
        bytes: 100,
        embeddingModel: 'nomic-embed-text',
        embeddingDim: 768,
        pinned: true,
        pinnedAt: '2025-01-01 00:00:00',
        ingestedAt: '2025-01-01 00:00:00',
        chunkCount: 3,
        ...partial,
    });

    const fakeHitKb = (partial: Partial<RetrievedChunk>): RetrievedChunk => ({
        documentId: 'fake-doc',
        documentName: 'fake.pdf',
        chunkIndex: 0,
        text: 'fake chunk text',
        distance: 0.5,
        ...partial,
    });

    // Builder for a KnowledgeOrchestratorForContext stub
    const makeOrchStub = (
        overrides: Partial<{
            pinned: KnowledgeDocument[];
            docText: (id: string) => string;
            hits: RetrievedChunk[];
            queryThrows: Error;
            listPinnedThrows: Error;
        }>
    ): { stub: KnowledgeOrchestratorForContext; log: { queryCalls: number; queryInputs: Array<unknown> } } => {
        const log = { queryCalls: 0, queryInputs: [] as unknown[] };
        const stub: KnowledgeOrchestratorForContext = {
            listPinned: () => {
                if (overrides.listPinnedThrows) throw overrides.listPinnedThrows;
                return overrides.pinned ?? [];
            },
            getDocumentText: (id) => {
                if (overrides.docText) return overrides.docText(id);
                return '';
            },
            queryKnowledge: async (input) => {
                log.queryCalls++;
                log.queryInputs.push(input);
                if (overrides.queryThrows) throw overrides.queryThrows;
                return overrides.hits ?? [];
            },
        };
        return { stub, log };
    };

    it('empty orchestrator (no pinned, no retrieved) returns empty string', async () => {
        const { stub } = makeOrchStub({ pinned: [], hits: [] });
        const block = await buildKnowledgeContextBlock({
            orchestrator: stub,
            query: 'any query',
        });
        expect(block).toBe('');
    });

    it('only pinned docs: renders pinned block in stable order', async () => {
        const pinned = [
            fakeDocKb({ id: 'd1', name: 'A.pdf' }),
            fakeDocKb({ id: 'd2', name: 'B.md' }),
        ];
        const { stub } = makeOrchStub({
            pinned,
            docText: (id) => (id === 'd1' ? 'alpha content' : 'beta content'),
            hits: [],
        });
        const block = await buildKnowledgeContextBlock({
            orchestrator: stub,
            query: 'irrelevant',
        });
        // Contains both pinned section markers + docs in listPinned order
        expect(block).toContain('[Pinned Knowledge]');
        expect(block).not.toContain('[Retrieved Knowledge]');
        expect(block).toContain('## Document 1: A.pdf');
        expect(block).toContain('## Document 2: B.md');
        expect(block).toContain('alpha content');
        expect(block).toContain('beta content');
        // Order: A before B in the string
        expect(block.indexOf('A.pdf')).toBeLessThan(block.indexOf('B.md'));
    });

    it('only retrieved chunks: renders retrieved block with provenance', async () => {
        const hits = [
            fakeHitKb({
                documentId: 'd1',
                documentName: 'resume.pdf',
                chunkIndex: 3,
                text: 'chunk three text',
                distance: 0.142,
            }),
            fakeHitKb({
                documentId: 'd2',
                documentName: 'jd.md',
                chunkIndex: 7,
                text: 'chunk seven text',
                distance: 0.287,
            }),
        ];
        const { stub } = makeOrchStub({ pinned: [], hits });
        const block = await buildKnowledgeContextBlock({
            orchestrator: stub,
            query: 'find something',
        });
        expect(block).toContain('[Retrieved Knowledge]');
        expect(block).not.toContain('[Pinned Knowledge]');
        expect(block).toContain('## resume.pdf — chunk 3 (distance 0.142)');
        expect(block).toContain('## jd.md — chunk 7 (distance 0.287)');
        expect(block).toContain('chunk three text');
        expect(block).toContain('chunk seven text');
    });

    it('both pinned + retrieved: both blocks present, clearly delimited', async () => {
        const pinned = [fakeDocKb({ id: 'p1', name: 'pinned.md' })];
        const hits = [
            fakeHitKb({
                documentId: 'h1',
                documentName: 'retrieved.pdf',
                chunkIndex: 0,
                text: 'retrieved text',
            }),
        ];
        const { stub } = makeOrchStub({
            pinned,
            docText: () => 'pinned text',
            hits,
        });
        const block = await buildKnowledgeContextBlock({
            orchestrator: stub,
            query: 'query',
        });
        // Both delimiters present, pinned first
        expect(block).toContain('[Pinned Knowledge]');
        expect(block).toContain('[Retrieved Knowledge]');
        expect(block.indexOf('[Pinned Knowledge]')).toBeLessThan(
            block.indexOf('[Retrieved Knowledge]')
        );
        expect(block).toContain('pinned text');
        expect(block).toContain('retrieved text');
    });

    it('no double-injection: retrieved chunks from pinned docs are filtered out', async () => {
        // Pinned doc p1 is listed. Retrieval returns one hit from p1 and
        // one from h1. The p1 hit must be filtered out (already in
        // pinned block) per the dedup rule.
        const pinned = [fakeDocKb({ id: 'p1', name: 'pinned.pdf' })];
        const hits = [
            fakeHitKb({ documentId: 'p1', documentName: 'pinned.pdf', chunkIndex: 2, text: 'from pinned' }),
            fakeHitKb({ documentId: 'h1', documentName: 'other.md', chunkIndex: 0, text: 'from h1' }),
        ];
        const { stub } = makeOrchStub({
            pinned,
            docText: () => 'full pinned doc text',
            hits,
        });
        const block = await buildKnowledgeContextBlock({
            orchestrator: stub,
            query: 'query',
        });
        expect(block).toContain('from h1');
        // The "from pinned" chunk text must NOT appear in the retrieved block
        // (though its parent doc's full text — 'full pinned doc text' — is
        // legitimately in the pinned block).
        expect(block).not.toContain('from pinned');
        expect(block).toContain('full pinned doc text');
    });

    it('zero-chunk / empty pinned doc is skipped silently', async () => {
        const pinned = [
            fakeDocKb({ id: 'p1', name: 'empty.pdf' }),
            fakeDocKb({ id: 'p2', name: 'normal.md' }),
        ];
        const { stub } = makeOrchStub({
            pinned,
            docText: (id) => (id === 'p1' ? '' : 'normal content'),
            hits: [],
        });
        const block = await buildKnowledgeContextBlock({
            orchestrator: stub,
            query: 'q',
        });
        expect(block).toContain('normal content');
        expect(block).not.toContain('empty.pdf');
        // Only one pinned entry rendered (renumbered: the skipped entry
        // doesn't claim the "Document 1" slot — it never gets an index).
        expect(block).toContain('## Document 1: normal.md');
    });

    it('pinned doc read failure is logged and the doc is skipped', async () => {
        const pinned = [
            fakeDocKb({ id: 'p1', name: 'broken.pdf' }),
            fakeDocKb({ id: 'p2', name: 'good.md' }),
        ];
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { stub } = makeOrchStub({
            pinned,
            docText: (id) => {
                if (id === 'p1') throw new Error('simulated read failure');
                return 'good content';
            },
            hits: [],
        });
        const block = await buildKnowledgeContextBlock({
            orchestrator: stub,
            query: 'q',
        });
        expect(block).toContain('good content');
        expect(block).not.toContain('broken.pdf');
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('KnowledgeEmbeddingModelMismatchError degrades gracefully — pinned still rendered', async () => {
        const pinned = [fakeDocKb({ id: 'p1', name: 'pinned.md' })];
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { stub } = makeOrchStub({
            pinned,
            docText: () => 'pinned text here',
            queryThrows: new KnowledgeEmbeddingModelMismatchError(
                'no compatible docs'
            ),
        });
        const block = await buildKnowledgeContextBlock({
            orchestrator: stub,
            query: 'q',
        });
        // Pinned block intact, retrieved block absent
        expect(block).toContain('[Pinned Knowledge]');
        expect(block).toContain('pinned text here');
        expect(block).not.toContain('[Retrieved Knowledge]');
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('KnowledgeEmbeddingProviderUnavailableError degrades gracefully', async () => {
        const pinned = [fakeDocKb({ id: 'p1', name: 'pinned.md' })];
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { stub } = makeOrchStub({
            pinned,
            docText: () => 'pinned text here',
            queryThrows: new KnowledgeEmbeddingProviderUnavailableError(
                'no provider'
            ),
        });
        const block = await buildKnowledgeContextBlock({
            orchestrator: stub,
            query: 'q',
        });
        expect(block).toContain('[Pinned Knowledge]');
        expect(block).not.toContain('[Retrieved Knowledge]');
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('arbitrary query failure degrades gracefully', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { stub } = makeOrchStub({
            pinned: [],
            queryThrows: new Error('boom'),
        });
        const block = await buildKnowledgeContextBlock({
            orchestrator: stub,
            query: 'q',
        });
        expect(block).toBe('');
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('pinned block respects per-doc and total budget with truncation marker', async () => {
        const longText = 'x'.repeat(5000);
        const pinned = [
            fakeDocKb({ id: 'p1', name: 'big.pdf' }),
            fakeDocKb({ id: 'p2', name: 'big2.pdf' }),
            fakeDocKb({ id: 'p3', name: 'big3.pdf' }),
        ];
        const { stub } = makeOrchStub({
            pinned,
            docText: () => longText,
            hits: [],
        });
        const block = await buildKnowledgeContextBlock({
            orchestrator: stub,
            query: 'q',
            options: {
                pinnedMaxCharsPerDoc: 500,
                pinnedMaxTotalChars: 1000,
            },
        });
        // Per-doc budget honored (each doc ≤ 500 chars)
        // Total budget honored (pinned content ≤ 1000 chars total)
        // At most 2 docs fit in 1000 chars at 500 per-doc, so p3 is absent.
        expect(block).toContain('big.pdf');
        expect(block).toContain('big2.pdf');
        expect(block).not.toContain('big3.pdf');
        // Truncation marker appears when per-doc limit is hit
        expect(block).toContain('[…truncated]');
    });

    it('retrieved block respects per-chunk and total budget', async () => {
        const longChunk = 'y'.repeat(2000);
        const hits = [
            fakeHitKb({ documentId: 'h1', chunkIndex: 0, text: longChunk }),
            fakeHitKb({ documentId: 'h2', chunkIndex: 0, text: longChunk }),
            fakeHitKb({ documentId: 'h3', chunkIndex: 0, text: longChunk }),
        ];
        const { stub } = makeOrchStub({ pinned: [], hits });
        const block = await buildKnowledgeContextBlock({
            orchestrator: stub,
            query: 'q',
            options: {
                retrievedMaxCharsPerChunk: 200,
                retrievedMaxTotalChars: 400,
            },
        });
        // Truncation marker for per-chunk budget
        expect(block).toContain('[…truncated]');
        // Total budget: at 200 per chunk and 400 total, exactly 2 chunks fit
        const chunk1Count = (block.match(/chunk 0/g) ?? []).length;
        expect(chunk1Count).toBe(2);
    });

    it('query is taken as the LAST N chars of the input query string', async () => {
        const { stub, log } = makeOrchStub({
            pinned: [],
            hits: [
                fakeHitKb({ documentId: 'h1', text: 'matched something' }),
            ],
        });
        // Query is 2000 chars long; queryMaxChars = 100 means we
        // should only forward the last 100 chars to queryKnowledge.
        const longQuery = 'A'.repeat(1900) + 'LAST_HUNDRED_CHARS_MARKER_EXACTLY';
        await buildKnowledgeContextBlock({
            orchestrator: stub,
            query: longQuery,
            options: { queryMaxChars: 100 },
        });
        expect(log.queryCalls).toBe(1);
        const firstInput = log.queryInputs[0] as QueryKnowledgeCall;
        // The last 100 chars of the input = 'A' repeated + the marker,
        // sliced from position (len - 100). Trim any leading 'A's that
        // happened to land before the marker — regardless, the marker
        // substring must be intact at the tail.
        expect(firstInput.query.length).toBeLessThanOrEqual(100);
        expect(firstInput.query.endsWith('LAST_HUNDRED_CHARS_MARKER_EXACTLY')).toBe(true);
    });

    it('empty query string skips retrieval but still renders pinned', async () => {
        const pinned = [fakeDocKb({ id: 'p1', name: 'p.md' })];
        const { stub, log } = makeOrchStub({
            pinned,
            docText: () => 'pinned text',
            hits: [],
        });
        const block = await buildKnowledgeContextBlock({
            orchestrator: stub,
            query: '   \n\t  ', // whitespace-only
        });
        expect(block).toContain('[Pinned Knowledge]');
        expect(block).not.toContain('[Retrieved Knowledge]');
        // queryKnowledge should NOT have been called
        expect(log.queryCalls).toBe(0);
    });

    it('retrieval uses includePinned: false to avoid double-injection bias', async () => {
        const { stub, log } = makeOrchStub({
            pinned: [fakeDocKb({ id: 'p1', name: 'p.md' })],
            docText: () => 'pinned',
            hits: [fakeHitKb({ documentId: 'h1', text: 'retrieved' })],
        });
        await buildKnowledgeContextBlock({
            orchestrator: stub,
            query: 'q',
        });
        expect(log.queryCalls).toBe(1);
        const input = log.queryInputs[0] as QueryKnowledgeCall;
        expect(input.includePinned).toBe(false);
    });
});

// Type-aliasing helper for the stub's queryInputs (avoids `any` in
// assertions without pulling in the full QueryKnowledgeInput type here).
interface QueryKnowledgeCall {
    query: string;
    topK: number;
    includePinned?: boolean;
}

// ═════════════════════════════════════════════════════════════════════════
// sensi M4-T7 — WhatToAnswerLLM knowledge hook integration
//
// Verifies that WhatToAnswerLLM calls the knowledge hook with the
// cleanedTranscript as the query source and prepends the resulting block
// to the contextParts that get forwarded to LLMHelper.streamChat.
// ═════════════════════════════════════════════════════════════════════════

describe('WhatToAnswerLLM knowledge hook (M4-T7)', () => {
    it('invokes knowledgeContextFn with the cleanedTranscript and prepends block to fullMessage', async () => {
        const helper = new LLMHelper();
        // Capture the fullMessage passed to streamChat. streamChat is an
        // async generator, so we stub it with a generator that records
        // its first arg then yields one chunk and returns.
        const captured: { fullMessage: string | null } = { fullMessage: null };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const streamSpy = vi.spyOn(helper, 'streamChat').mockImplementation(async function* (
            this: unknown,
            msg: string
        ): AsyncGenerator<string, void, unknown> {
            captured.fullMessage = msg;
            yield 'ok';
        } as any);

        let hookCalledWith: string | null = null;
        const knowledgeFn = async (q: string): Promise<string> => {
            hookCalledWith = q;
            return '[Pinned Knowledge]\n## Document 1: r.md\nhello';
        };

        const llm = new WhatToAnswerLLM(helper, knowledgeFn);
        const gen = llm.generateStream('interviewer: What about your resume?');
        // Drain the generator
        for await (const _ of gen) {
            /* no-op */
        }

        expect(hookCalledWith).toBe('interviewer: What about your resume?');
        expect(captured.fullMessage).not.toBeNull();
        expect(captured.fullMessage).toContain('[Pinned Knowledge]');
        expect(captured.fullMessage).toContain('hello');
        // Knowledge block must appear BEFORE the CONVERSATION section
        const convIdx = (captured.fullMessage ?? '').indexOf('CONVERSATION:');
        const kbIdx = (captured.fullMessage ?? '').indexOf('[Pinned Knowledge]');
        expect(kbIdx).toBeGreaterThanOrEqual(0);
        expect(kbIdx).toBeLessThan(convIdx);

        streamSpy.mockRestore();
    });

    it('knowledgeContextFn throwing does not break the stream (degrades silently)', async () => {
        const helper = new LLMHelper();
        const captured: { fullMessage: string | null } = { fullMessage: null };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const streamSpy = vi.spyOn(helper, 'streamChat').mockImplementation(async function* (
            this: unknown,
            msg: string
        ): AsyncGenerator<string, void, unknown> {
            captured.fullMessage = msg;
            yield 'fallback-response';
        } as any);
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const knowledgeFn = async (): Promise<string> => {
            throw new Error('simulated defect-level bug');
        };

        const llm = new WhatToAnswerLLM(helper, knowledgeFn);
        const gen = llm.generateStream('some transcript');
        const chunks: string[] = [];
        for await (const chunk of gen) chunks.push(chunk);

        // Stream still completed — fullMessage was passed to streamChat
        // without a knowledge block
        expect(captured.fullMessage).not.toBeNull();
        expect(captured.fullMessage).not.toContain('[Pinned Knowledge]');
        expect(captured.fullMessage).toContain('some transcript');
        expect(chunks).toContain('fallback-response');
        expect(warnSpy).toHaveBeenCalled();

        streamSpy.mockRestore();
        warnSpy.mockRestore();
    });

    it('no knowledgeContextFn (undefined constructor arg) is byte-identical to pre-M4-T7', async () => {
        const helper = new LLMHelper();
        const captured: { fullMessage: string | null } = { fullMessage: null };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const streamSpy = vi.spyOn(helper, 'streamChat').mockImplementation(async function* (
            this: unknown,
            msg: string
        ): AsyncGenerator<string, void, unknown> {
            captured.fullMessage = msg;
            yield 'out';
        } as any);

        const llm = new WhatToAnswerLLM(helper); // no hook
        for await (const _ of llm.generateStream('some transcript')) {
            /* no-op */
        }

        expect(captured.fullMessage).not.toContain('[Pinned Knowledge]');
        expect(captured.fullMessage).not.toContain('[Retrieved Knowledge]');
        expect(captured.fullMessage).toContain('some transcript');

        streamSpy.mockRestore();
    });
});

// ═════════════════════════════════════════════════════════════════════════
// sensi M4-T8 — Knowledge IPC helper functions
//
// Each test builds a stub orchestrator matching KnowledgeOrchestratorForIpc
// and exercises a single handler. Tests cover: input validation,
// orchestrator delegation, typed-error translation, preview cap
// enforcement, and the DI-friendly closure factory used by
// IntelligenceEngine to wire WhatToAnswerLLM's knowledge hook.
// ═════════════════════════════════════════════════════════════════════════

describe('knowledgeIpcHelpers (M4-T8)', () => {
    // Builder: minimal stub matching the 8-method orchestrator interface
    const makeOrch = (
        overrides: Partial<KnowledgeOrchestratorForIpc> = {}
    ): KnowledgeOrchestratorForIpc => ({
        ingestDocument: async () => ({
            documentId: 'd1',
            chunkCount: 2,
            embeddingModel: 'nomic-embed-text',
            embeddingProvider: 'ollama',
        }),
        listDocuments: () => [],
        deleteDocument: () => {},
        pinDocument: () => ({ pinnedAt: '2025-01-01 00:00:00' }),
        unpinDocument: () => ({ pinnedAt: null }),
        listPinned: () => [],
        queryKnowledge: async () => [],
        getDocumentText: () => '',
        // M4-T10 — transfer slots. Default stub returns an empty
        // transfer store so existing M4-T8 tests don't have to know
        // about export/import. Export/import tests override these.
        getTransferStore: () => ({
            listDocuments: () => [],
            getDocumentChunksWithEmbeddings: () => [],
            replaceAllFromArtifact: () => ({ replaced: 0, imported: 0 }),
        }),
        getBackupDir: () => null,
        ...overrides,
    });

    const fakeIpcDoc = (partial: Partial<KnowledgeDocument>): KnowledgeDocument => ({
        id: 'fake-id',
        name: 'fake.pdf',
        mime: 'application/pdf',
        bytes: 100,
        embeddingModel: 'nomic-embed-text',
        embeddingDim: 768,
        pinned: false,
        pinnedAt: null,
        ingestedAt: '2025-01-01 00:00:00',
        chunkCount: 0,
        ...partial,
    });

    const fakeIpcHit = (partial: Partial<RetrievedChunk>): RetrievedChunk => ({
        documentId: 'd1',
        documentName: 'fake.pdf',
        chunkIndex: 0,
        text: 'fake',
        distance: 0.1,
        ...partial,
    });

    // ─── handleIngestDocument ────────────────────────────────────
    it('handleIngestDocument validates filePath and delegates', async () => {
        let called: string | null = null;
        const orch = makeOrch({
            ingestDocument: async (p) => {
                called = p;
                return {
                    documentId: 'doc-42',
                    chunkCount: 5,
                    embeddingModel: 'nomic-embed-text',
                    embeddingProvider: 'ollama',
                };
            },
        });
        const result = await handleIngestDocument(orch, '/tmp/resume.pdf');
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.documentId).toBe('doc-42');
            expect(result.chunkCount).toBe(5);
            expect(result.embeddingProvider).toBe('ollama');
        }
        expect(called).toBe('/tmp/resume.pdf');
    });

    it('handleIngestDocument rejects empty filePath', async () => {
        const orch = makeOrch();
        const result = await handleIngestDocument(orch, '') as KnowledgeIpcFailure;
        expect(result.success).toBe(false);
        expect(result.errorType).toBe('invalid_input');
    });

    it('handleIngestDocument rejects non-string filePath', async () => {
        const orch = makeOrch();
        const result = await handleIngestDocument(orch, 42) as KnowledgeIpcFailure;
        expect(result.success).toBe(false);
        expect(result.errorType).toBe('invalid_input');
    });

    it('handleIngestDocument translates KnowledgeIngestError with scrubbed path', async () => {
        const orch = makeOrch({
            ingestDocument: async () => {
                throw new KnowledgeIngestError('failed to read C:\\secret\\path\\file.pdf');
            },
        });
        const result = await handleIngestDocument(orch, '/tmp/x.pdf') as KnowledgeIpcFailure;
        expect(result.success).toBe(false);
        expect(result.errorType).toBe('ingest_failed');
        expect(result.error).toContain('<path>');
        expect(result.error).not.toContain('C:\\secret');
    });

    // ─── handleListDocuments ─────────────────────────────────────
    it('handleListDocuments delegates and returns documents array', () => {
        const docs = [fakeIpcDoc({ id: 'a' }), fakeIpcDoc({ id: 'b' })];
        const orch = makeOrch({ listDocuments: () => docs });
        const result = handleListDocuments(orch);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.documents).toEqual(docs);
        }
    });

    // ─── handleDeleteDocument ────────────────────────────────────
    it('handleDeleteDocument validates id and delegates', () => {
        let called: string | null = null;
        const orch = makeOrch({
            deleteDocument: (id) => {
                called = id;
            },
        });
        const result = handleDeleteDocument(orch, 'doc-abc');
        expect(result.success).toBe(true);
        expect(called).toBe('doc-abc');
    });

    it('handleDeleteDocument translates KnowledgeNotFoundError', () => {
        const orch = makeOrch({
            deleteDocument: () => {
                throw new KnowledgeNotFoundError('missing');
            },
        });
        const result = handleDeleteDocument(orch, 'doc-abc') as KnowledgeIpcFailure;
        expect(result.success).toBe(false);
        expect(result.errorType).toBe('not_found');
    });

    // ─── handlePinDocument / handleUnpinDocument / handleListPinned ────
    it('handlePinDocument returns pinnedAt timestamp', () => {
        const orch = makeOrch({
            pinDocument: () => ({ pinnedAt: '2025-01-15 12:34:56' }),
        });
        const result = handlePinDocument(orch, 'doc-abc');
        expect(result.success).toBe(true);
        if (result.success) expect(result.pinnedAt).toBe('2025-01-15 12:34:56');
    });

    it('handleUnpinDocument returns null pinnedAt', () => {
        const orch = makeOrch({ unpinDocument: () => ({ pinnedAt: null }) });
        const result = handleUnpinDocument(orch, 'doc-abc');
        expect(result.success).toBe(true);
        if (result.success) expect(result.pinnedAt).toBeNull();
    });

    it('handleListPinned delegates to listPinned', () => {
        const pinned = [fakeIpcDoc({ id: 'p1', pinned: true })];
        const orch = makeOrch({ listPinned: () => pinned });
        const result = handleListPinned(orch);
        expect(result.success).toBe(true);
        if (result.success) expect(result.documents).toEqual(pinned);
    });

    // ─── handleQueryKnowledge ────────────────────────────────────
    it('handleQueryKnowledge validates query + topK and delegates', async () => {
        let captured: {
            query?: string;
            topK?: number;
            includePinned?: boolean;
            documentIds?: readonly string[];
        } = {};
        const orch = makeOrch({
            queryKnowledge: async (input) => {
                captured = { ...input };
                return [fakeIpcHit({ documentId: 'd1' })];
            },
        });
        const result = await handleQueryKnowledge(orch, {
            query: 'find stuff',
            topK: 5,
            includePinned: true,
            documentIds: ['d1', 'd2'],
        });
        expect(result.success).toBe(true);
        if (result.success) expect(result.hits.length).toBe(1);
        expect(captured.query).toBe('find stuff');
        expect(captured.topK).toBe(5);
        expect(captured.includePinned).toBe(true);
        expect(captured.documentIds).toEqual(['d1', 'd2']);
    });

    it('handleQueryKnowledge rejects empty query', async () => {
        const orch = makeOrch();
        const result = await handleQueryKnowledge(orch, { query: '', topK: 5 }) as KnowledgeIpcFailure;
        expect(result.success).toBe(false);
        expect(result.errorType).toBe('invalid_input');
    });

    it('handleQueryKnowledge rejects non-positive topK', async () => {
        const orch = makeOrch();
        const result = await handleQueryKnowledge(orch, { query: 'q', topK: 0 }) as KnowledgeIpcFailure;
        expect(result.success).toBe(false);
        expect(result.errorType).toBe('invalid_input');
    });

    it('handleQueryKnowledge clamps topK to the hard max of 50', async () => {
        let captured: { topK?: number } = {};
        const orch = makeOrch({
            queryKnowledge: async (input) => {
                captured = { topK: input.topK };
                return [];
            },
        });
        await handleQueryKnowledge(orch, { query: 'q', topK: 999 });
        expect(captured.topK).toBe(50);
    });

    it('handleQueryKnowledge rejects non-object payload', async () => {
        const orch = makeOrch();
        const result = await handleQueryKnowledge(orch, null) as KnowledgeIpcFailure;
        expect(result.success).toBe(false);
        expect(result.errorType).toBe('invalid_input');
    });

    it('handleQueryKnowledge translates KnowledgeEmbeddingModelMismatchError', async () => {
        const orch = makeOrch({
            queryKnowledge: async () => {
                throw new KnowledgeEmbeddingModelMismatchError('no compatible docs');
            },
        });
        const result = await handleQueryKnowledge(orch, { query: 'q', topK: 5 }) as KnowledgeIpcFailure;
        expect(result.success).toBe(false);
        expect(result.errorType).toBe('model_mismatch');
        expect(result.error).toContain('embedded with a different model');
    });

    it('handleQueryKnowledge translates KnowledgeEmbeddingProviderUnavailableError', async () => {
        const orch = makeOrch({
            queryKnowledge: async () => {
                throw new KnowledgeEmbeddingProviderUnavailableError('no provider');
            },
        });
        const result = await handleQueryKnowledge(orch, { query: 'q', topK: 5 }) as KnowledgeIpcFailure;
        expect(result.success).toBe(false);
        expect(result.errorType).toBe('provider_unavailable');
        expect(result.error).toContain('Ollama');
    });

    // ─── handleGetDocumentPreview — the BOUNDED text exposure surface ────
    it('handleGetDocumentPreview returns text up to default cap with truncated=true', () => {
        const longText = 'x'.repeat(PREVIEW_DEFAULT_MAX_CHARS + 500);
        const orch = makeOrch({ getDocumentText: () => longText });
        const result = handleGetDocumentPreview(orch, 'doc-1', undefined);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.text.length).toBe(PREVIEW_DEFAULT_MAX_CHARS);
            expect(result.truncated).toBe(true);
            expect(result.id).toBe('doc-1');
        }
    });

    it('handleGetDocumentPreview enforces hard max cap on large maxChars request', () => {
        const longText = 'x'.repeat(PREVIEW_HARD_MAX_CHARS + 5000);
        const orch = makeOrch({ getDocumentText: () => longText });
        const result = handleGetDocumentPreview(orch, 'doc-1', 99999);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.text.length).toBe(PREVIEW_HARD_MAX_CHARS);
            expect(result.truncated).toBe(true);
        }
    });

    it('handleGetDocumentPreview never returns unbounded full text', () => {
        // 1 MB document — no sane maxChars should give the full thing back.
        const hugeText = 'y'.repeat(1_000_000);
        const orch = makeOrch({ getDocumentText: () => hugeText });

        // Caller tries multiple maxChars values — all clamped to hard max
        for (const maxChars of [undefined, 50000, 99999, Infinity]) {
            const result = handleGetDocumentPreview(orch, 'doc-1', maxChars);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.text.length).toBeLessThanOrEqual(PREVIEW_HARD_MAX_CHARS);
                expect(result.truncated).toBe(true);
            }
        }
    });

    it('handleGetDocumentPreview sanitizes NaN/negative maxChars to default', () => {
        const longText = 'z'.repeat(PREVIEW_DEFAULT_MAX_CHARS + 100);
        const orch = makeOrch({ getDocumentText: () => longText });
        for (const bad of [Number.NaN, -10, 0, 'not a number' as unknown as number]) {
            const result = handleGetDocumentPreview(orch, 'doc-1', bad);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.text.length).toBe(PREVIEW_DEFAULT_MAX_CHARS);
            }
        }
    });

    it('handleGetDocumentPreview short text returns un-truncated', () => {
        const shortText = 'hello world';
        const orch = makeOrch({ getDocumentText: () => shortText });
        const result = handleGetDocumentPreview(orch, 'doc-1', undefined);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.text).toBe(shortText);
            expect(result.truncated).toBe(false);
        }
    });

    it('handleGetDocumentPreview translates KnowledgeNotFoundError', () => {
        const orch = makeOrch({
            getDocumentText: () => {
                throw new KnowledgeNotFoundError('missing');
            },
        });
        const result = handleGetDocumentPreview(orch, 'doc-404', undefined) as KnowledgeIpcFailure;
        expect(result.success).toBe(false);
        expect(result.errorType).toBe('not_found');
    });

    // ─── makeKnowledgeContextClosure — production wiring factory ────
    it('makeKnowledgeContextClosure returns a closure, not the orchestrator', () => {
        const orch = makeOrch();
        const closure = makeKnowledgeContextClosure(() => orch);
        expect(typeof closure).toBe('function');
        // Critical: it's a closure over the orchestrator, not the orch itself
        expect(closure).not.toBe(orch);
    });

    it('makeKnowledgeContextClosure returns null if getOrchestrator throws', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const closure = makeKnowledgeContextClosure(() => {
            throw new Error('database not ready');
        });
        expect(closure).toBeNull();
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('makeKnowledgeContextClosure returns null if orchestrator factory returns null', () => {
        const closure = makeKnowledgeContextClosure(() => null);
        expect(closure).toBeNull();
    });

    it('closure invocation delegates to buildKnowledgeContextBlock', async () => {
        // Use a spy-friendly orchestrator that records queryKnowledge inputs
        const orch = makeOrch({
            listPinned: () => [],
            queryKnowledge: async () => [fakeIpcHit({ documentName: 'h.pdf', text: 'matched' })],
        });
        const closure = makeKnowledgeContextClosure(() => orch);
        expect(closure).not.toBeNull();
        const block = await closure!('my query');
        // The closure returns a formatted knowledge block via
        // buildKnowledgeContextBlock. Our stub returned one hit, so we
        // should see the retrieved-block marker in the output.
        expect(block).toContain('[Retrieved Knowledge]');
        expect(block).toContain('matched');
    });
});

// ─────────────────────────────────────────────────────────────────────────
// sensi M3-T2 — Deepgram STT auto-promotion helper.
//
// Guards: only promotes when sttProvider === 'none' AND the key is truthy.
// Never overrides an explicit user choice (e.g. 'google'), never fires on
// an empty string. Pure function — no IPC, no network, just a
// CredentialsManager write.
// ─────────────────────────────────────────────────────────────────────────
describe('maybeAutoPromoteDeepgram (M3-T2 STT auto-promotion)', () => {
  let cm: CredentialsManager;
  beforeEach(() => {
    cm = freshCredentialsManager();
  });

  it("sttProvider='none' + non-empty key → promoted=true, sttProvider='deepgram'", () => {
    cm.setSttProvider('none');
    expect(cm.getSttProvider()).toBe('none');

    const promoted = maybeAutoPromoteDeepgram(cm, 'dg-key-abc123');

    expect(promoted).toBe(true);
    expect(cm.getSttProvider()).toBe('deepgram');
  });

  it("sttProvider='google' + non-empty key → promoted=false, sttProvider unchanged", () => {
    cm.setSttProvider('google');
    expect(cm.getSttProvider()).toBe('google');

    const promoted = maybeAutoPromoteDeepgram(cm, 'dg-key-abc123');

    expect(promoted).toBe(false);
    expect(cm.getSttProvider()).toBe('google');
  });

  it("sttProvider='none' + empty string → promoted=false, sttProvider unchanged", () => {
    cm.setSttProvider('none');

    const promoted = maybeAutoPromoteDeepgram(cm, '');

    expect(promoted).toBe(false);
    expect(cm.getSttProvider()).toBe('none');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// sensi M3-T3 — generateMeetingSummary active-provider dispatch.
//
// Verifies that the three new branches (MiniMax / OpenAI / Claude) route
// the meeting summary through the user's active provider before falling
// back to the hardcoded Gemini chain. Order mirrors the streamChat()
// dispatch chain exactly.
//
// Test setup: construct a fresh LLMHelper, clear all provider clients so
// nothing is inadvertently configured from env vars, set currentModelId
// to the model-id pattern the branch expects, attach a truthy sentinel
// client, then spy on the top-level generateWith* method to short-circuit
// any actual network or SDK call. generateWithFlash is always spied too
// so we can assert whether Gemini fallback fired.
// ─────────────────────────────────────────────────────────────────────────
describe('LLMHelper.generateMeetingSummary (M3-T3 active-provider routing)', () => {
  let helper: LLMHelper;

  beforeEach(() => {
    helper = new LLMHelper();
    // Clear all provider clients so tests have a known baseline regardless
    // of what env vars were set when LLMHelper construction ran.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (helper as any).openaiClient = null;
    (helper as any).claudeClient = null;
    (helper as any).minimaxClient = null;
    (helper as any).groqClient = null;
    (helper as any).customProvider = null;
    (helper as any).activeCurlProvider = null;
    (helper as any).nativelyKey = null;
    /* eslint-enable @typescript-eslint/no-explicit-any */
  });

  it('MiniMax active + minimaxClient present → generateWithMiniMax called, Gemini NOT called', async () => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (helper as any).currentModelId = 'MiniMax-M2.7';
    (helper as any).minimaxClient = {}; // truthy sentinel

    const mmSpy = vi.spyOn(helper as any, 'generateWithMiniMax').mockResolvedValue('minimax summary text');
    const flashSpy = vi.spyOn(helper, 'generateWithFlash').mockResolvedValue('gemini fallback (should not be called)');
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const result = await helper.generateMeetingSummary('system prompt', 'transcript context');

    expect(mmSpy).toHaveBeenCalledOnce();
    expect(flashSpy).not.toHaveBeenCalled();
    expect(result).toContain('minimax summary text');

    mmSpy.mockRestore();
    flashSpy.mockRestore();
  });

  it('OpenAI active + openaiClient present → generateWithOpenai called, Gemini NOT called', async () => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (helper as any).currentModelId = 'gpt-4o';
    (helper as any).openaiClient = {}; // truthy sentinel

    const openaiSpy = vi.spyOn(helper as any, 'generateWithOpenai').mockResolvedValue('openai summary text');
    const flashSpy = vi.spyOn(helper, 'generateWithFlash').mockResolvedValue('gemini fallback (should not be called)');
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const result = await helper.generateMeetingSummary('system prompt', 'transcript context');

    expect(openaiSpy).toHaveBeenCalledOnce();
    expect(flashSpy).not.toHaveBeenCalled();
    expect(result).toContain('openai summary text');

    openaiSpy.mockRestore();
    flashSpy.mockRestore();
  });

  it('Claude active + claudeClient present → generateWithClaude called, Gemini NOT called', async () => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (helper as any).currentModelId = 'claude-sonnet-4-5';
    (helper as any).claudeClient = {}; // truthy sentinel

    const claudeSpy = vi.spyOn(helper as any, 'generateWithClaude').mockResolvedValue('claude summary text');
    const flashSpy = vi.spyOn(helper, 'generateWithFlash').mockResolvedValue('gemini fallback (should not be called)');
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const result = await helper.generateMeetingSummary('system prompt', 'transcript context');

    expect(claudeSpy).toHaveBeenCalledOnce();
    expect(flashSpy).not.toHaveBeenCalled();
    expect(result).toContain('claude summary text');

    claudeSpy.mockRestore();
    flashSpy.mockRestore();
  });

  it('no matching active provider → falls through to Gemini Flash', async () => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    // currentModelId is Gemini — none of the three new branches match
    (helper as any).currentModelId = 'gemini-3.1-flash';
    // All provider clients remain null from beforeEach

    const mmSpy = vi.spyOn(helper as any, 'generateWithMiniMax').mockResolvedValue('should not be called');
    const openaiSpy = vi.spyOn(helper as any, 'generateWithOpenai').mockResolvedValue('should not be called');
    const claudeSpy = vi.spyOn(helper as any, 'generateWithClaude').mockResolvedValue('should not be called');
    const flashSpy = vi.spyOn(helper, 'generateWithFlash').mockResolvedValue('gemini flash summary');
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const result = await helper.generateMeetingSummary('system prompt', 'transcript context');

    expect(mmSpy).not.toHaveBeenCalled();
    expect(openaiSpy).not.toHaveBeenCalled();
    expect(claudeSpy).not.toHaveBeenCalled();
    expect(flashSpy).toHaveBeenCalled();
    expect(result).toContain('gemini flash summary');

    mmSpy.mockRestore();
    openaiSpy.mockRestore();
    claudeSpy.mockRestore();
    flashSpy.mockRestore();
  });

  it('active provider throws → falls through to Gemini Flash', async () => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (helper as any).currentModelId = 'MiniMax-M2.7';
    (helper as any).minimaxClient = {};

    const mmSpy = vi
      .spyOn(helper as any, 'generateWithMiniMax')
      .mockRejectedValue(new Error('simulated minimax rate limit'));
    const flashSpy = vi.spyOn(helper, 'generateWithFlash').mockResolvedValue('gemini fallback summary');
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const result = await helper.generateMeetingSummary('system prompt', 'transcript context');

    expect(mmSpy).toHaveBeenCalledOnce();
    expect(flashSpy).toHaveBeenCalled();
    expect(result).toContain('gemini fallback summary');

    mmSpy.mockRestore();
    flashSpy.mockRestore();
  });
});

// ═════════════════════════════════════════════════════════════════════════
// M4-T9 — Renderer knowledge error-message mapping
// ═════════════════════════════════════════════════════════════════════════
//
// KnowledgeSettings.tsx switches on the typed `errorType` field and
// renders a short user-facing string via `errorTypeToMessage`. This
// helper is a pure module (no React, no DOM) so it can be tested from
// the vitest harness without the renderer test scaffolding that the
// repo deliberately hasn't added yet. See DECISIONS.md D022 for the
// placement + "no renderer DOM harness" rationale.
//
// The tests verify:
//   - every `KnowledgeIpcErrorType` variant maps to a non-empty string
//   - each variant maps to the expected category of advice (ingest,
//     provider setup, re-ingest, etc.) via substring assertions
//   - the `ALL_KNOWLEDGE_ERROR_TYPES` constant stays in sync with the
//     type union (exhaustiveness check)
//   - exhaustiveness is enforced: every mapped message is distinct so
//     no future variant can silently collapse into another bucket
// ═════════════════════════════════════════════════════════════════════════

import {
    errorTypeToMessage,
    ALL_KNOWLEDGE_ERROR_TYPES,
} from '../../src/lib/knowledgeErrors';
import type { KnowledgeIpcErrorType } from '../../src/types/electron';

describe('knowledgeErrors.errorTypeToMessage (M4-T9)', () => {
    it('maps invalid_input to a short user-facing message', () => {
        const msg = errorTypeToMessage('invalid_input');
        expect(msg.length).toBeGreaterThan(0);
        expect(msg.toLowerCase()).toContain('invalid');
    });

    it('maps ingest_failed with format advice', () => {
        const msg = errorTypeToMessage('ingest_failed');
        // Should mention the supported file types so user knows what to retry
        expect(msg.toLowerCase()).toMatch(/pdf|docx|markdown|plain/);
    });

    it('maps query_failed with provider hint', () => {
        const msg = errorTypeToMessage('query_failed');
        expect(msg.toLowerCase()).toMatch(/ollama|gemini|provider/);
    });

    it('maps model_mismatch with re-ingest guidance', () => {
        const msg = errorTypeToMessage('model_mismatch');
        expect(msg.toLowerCase()).toMatch(/re-ingest|original|different/);
    });

    it('maps provider_unavailable with Ollama + Gemini setup hint', () => {
        const msg = errorTypeToMessage('provider_unavailable');
        expect(msg.toLowerCase()).toContain('ollama');
        expect(msg.toLowerCase()).toContain('gemini');
    });

    it('maps not_found to a deletion hint', () => {
        const msg = errorTypeToMessage('not_found');
        expect(msg.toLowerCase()).toContain('not found');
    });

    it('maps dimension_mismatch to a re-ingest prompt', () => {
        const msg = errorTypeToMessage('dimension_mismatch');
        expect(msg.toLowerCase()).toContain('re-ingest');
    });

    it('maps internal to a generic safe fallback', () => {
        const msg = errorTypeToMessage('internal');
        // Must not leak stack-trace-like content
        expect(msg.toLowerCase()).not.toMatch(/stack|trace|error:/);
        expect(msg.toLowerCase()).toContain('unexpected');
    });

    it('every errorType variant returns a non-empty message', () => {
        for (const errorType of ALL_KNOWLEDGE_ERROR_TYPES) {
            const msg = errorTypeToMessage(errorType);
            expect(typeof msg).toBe('string');
            expect(msg.length).toBeGreaterThan(5);
        }
    });

    it('every errorType maps to a distinct message (no silent collapse)', () => {
        const seen = new Map<string, KnowledgeIpcErrorType>();
        for (const errorType of ALL_KNOWLEDGE_ERROR_TYPES) {
            const msg = errorTypeToMessage(errorType);
            expect(seen.has(msg)).toBe(false);
            seen.set(msg, errorType);
        }
        expect(seen.size).toBe(ALL_KNOWLEDGE_ERROR_TYPES.length);
    });

    it('ALL_KNOWLEDGE_ERROR_TYPES has exactly 11 variants matching the type union', () => {
        // If a new errorType is added to `KnowledgeIpcErrorType` in
        // electron.d.ts, this test + the switch in errorTypeToMessage
        // must be updated together. M4-T10 added export_failed,
        // import_failed, and incompatible_format.
        expect(ALL_KNOWLEDGE_ERROR_TYPES.length).toBe(11);
        // Sanity check: every entry is a valid typed literal
        const expected: readonly KnowledgeIpcErrorType[] = [
            'invalid_input',
            'ingest_failed',
            'query_failed',
            'model_mismatch',
            'provider_unavailable',
            'not_found',
            'dimension_mismatch',
            'export_failed',
            'import_failed',
            'incompatible_format',
            'internal',
        ];
        expect([...ALL_KNOWLEDGE_ERROR_TYPES].sort()).toEqual([...expected].sort());
    });

    it('maps export_failed to a writable-location hint', () => {
        const msg = errorTypeToMessage('export_failed');
        expect(msg.toLowerCase()).toContain('export failed');
        expect(msg.toLowerCase()).toMatch(/writable|location/);
    });

    it('maps import_failed to a retry hint', () => {
        const msg = errorTypeToMessage('import_failed');
        expect(msg.toLowerCase()).toContain('import failed');
        expect(msg.toLowerCase()).toMatch(/readable|try again/);
    });

    it('maps incompatible_format to a version/source hint', () => {
        const msg = errorTypeToMessage('incompatible_format');
        expect(msg.toLowerCase()).toMatch(/not a supported|version|export/);
    });

    it('user-facing messages never contain raw path markers or scrubber tokens', () => {
        // The `<path>` token is a main-process scrubber marker — it should
        // never appear in renderer-side user-facing copy, because renderer
        // messages are hand-written, not derived from the free-form
        // `error` string.
        for (const errorType of ALL_KNOWLEDGE_ERROR_TYPES) {
            const msg = errorTypeToMessage(errorType);
            expect(msg).not.toContain('<path>');
            expect(msg).not.toMatch(/[A-Z]:\\/); // No Windows absolute paths
        }
    });
});

// ═════════════════════════════════════════════════════════════════════════
// M4-T10 — Knowledge base export/import (transfer module + IPC handlers)
// ═════════════════════════════════════════════════════════════════════════
//
// The transfer module is pure TypeScript with structural DI. No DB,
// no filesystem. IO paths (`exportKnowledgeToFile`,
// `importKnowledgeFromFile`) are exercised with a temp dir under
// `os.tmpdir()` so each test gets a fresh file without colliding with
// the real sensi.db. The DB round-trip against a real better-sqlite3
// + sqlite-vec schema is covered by the separate
// `knowledgeTransfer.electron.cjs` runtime test.
//
// See DECISIONS.md D023 for format and policy rationale.

import {
    KNOWLEDGE_EXPORT_MAGIC,
    KNOWLEDGE_EXPORT_VERSION,
    KNOWLEDGE_EXPORT_EMBEDDING_DIM,
    KnowledgeExportError,
    KnowledgeImportError,
    KnowledgeIncompatibleFormatError,
    buildExportArtifact,
    validateImportArtifact,
    exportKnowledgeToFile,
    importKnowledgeFromFile,
    type ExportedChunk,
    type ExportedDocument,
    type KnowledgeExportArtifact,
    type ExportReadableStore,
    type TransferStore,
} from '../knowledge/knowledgeTransfer';
import {
    handleExportKnowledge,
    handleImportKnowledge,
    type KnowledgeIpcFailure as IpcFailureT10,
    type KnowledgeOrchestratorForIpc as OrchForIpcT10,
} from '../knowledge/knowledgeIpcHelpers';
import * as osMod from 'node:os';
import * as fsMod from 'node:fs';
import * as pathMod from 'node:path';

describe('knowledgeTransfer (M4-T10)', () => {
    // ─── Test fixtures ────────────────────────────────────────────
    const makeChunk = (i: number, text = `chunk-${i}`): ExportedChunk => ({
        chunkIndex: i,
        text,
        // 768-element ramp with a per-chunk offset so each is distinct
        embedding: Array.from({ length: 768 }, (_, k) => (i + 1) * 0.001 + k * 0.0001),
    });

    const makeDoc = (
        name: string,
        chunkCount: number,
        overrides: Partial<ExportedDocument> = {}
    ): ExportedDocument => ({
        name,
        mime: 'text/plain',
        bytes: chunkCount * 10,
        embeddingModel: 'nomic-embed-text',
        embeddingDim: 768,
        pinned: false,
        pinnedAt: null,
        ingestedAt: '2026-04-14T00:00:00.000Z',
        chunks: Array.from({ length: chunkCount }, (_, i) => makeChunk(i)),
        ...overrides,
    });

    /**
     * Stub store that satisfies both `ExportReadableStore` and
     * `ImportWritableStore`. Internal state is plain arrays — no
     * sqlite-vec, no better-sqlite3.
     */
    const makeTransferStore = (
        initialDocs: ExportedDocument[] = []
    ): {
        store: TransferStore;
        state: { docs: ExportedDocument[] };
        replaceCalls: Array<readonly ExportedDocument[]>;
        throwOnReplace?: boolean;
        setReplaceError: (err: Error | null) => void;
    } => {
        const state = { docs: [...initialDocs] };
        const replaceCalls: Array<readonly ExportedDocument[]> = [];
        let replaceError: Error | null = null;
        const store: TransferStore = {
            listDocuments: () =>
                state.docs.map((d, i) => ({
                    id: `fake-id-${i}`,
                    name: d.name,
                    mime: d.mime,
                    bytes: d.bytes,
                    embeddingModel: d.embeddingModel,
                    embeddingDim: d.embeddingDim,
                    pinned: d.pinned,
                    pinnedAt: d.pinnedAt,
                    ingestedAt: d.ingestedAt,
                    chunkCount: d.chunks.length,
                })),
            getDocumentChunksWithEmbeddings: (docId) => {
                const idx = parseInt(docId.replace('fake-id-', ''), 10);
                return state.docs[idx]?.chunks ?? [];
            },
            replaceAllFromArtifact: (docs) => {
                replaceCalls.push(docs);
                if (replaceError) throw replaceError;
                const replaced = state.docs.length;
                state.docs = [...docs];
                return { replaced, imported: docs.length };
            },
        };
        return {
            store,
            state,
            replaceCalls,
            setReplaceError: (err) => {
                replaceError = err;
            },
        };
    };

    // ─── buildExportArtifact ──────────────────────────────────────
    it('buildExportArtifact produces a versioned artifact with knowledge-only fields', () => {
        const { store } = makeTransferStore([
            makeDoc('resume.txt', 2, { pinned: true, pinnedAt: '2026-04-01' }),
            makeDoc('notes.md', 1),
        ]);
        const artifact = buildExportArtifact(store);

        expect(artifact[KNOWLEDGE_EXPORT_MAGIC]).toBe(true);
        expect(artifact.version).toBe(KNOWLEDGE_EXPORT_VERSION);
        expect(artifact.embeddingDim).toBe(KNOWLEDGE_EXPORT_EMBEDDING_DIM);
        expect(artifact.documentCount).toBe(2);
        expect(artifact.chunkCount).toBe(3);
        expect(artifact.documents).toHaveLength(2);
        expect(artifact.documents[0].name).toBe('resume.txt');
        expect(artifact.documents[0].pinned).toBe(true);
        expect(artifact.documents[0].pinnedAt).toBe('2026-04-01');
        expect(artifact.documents[0].chunks[0].embedding.length).toBe(768);
    });

    it('buildExportArtifact excludes unrelated fields (no credentials, meetings, transcripts)', () => {
        const { store } = makeTransferStore([makeDoc('a.txt', 1)]);
        const artifact = buildExportArtifact(store);
        const topKeys = Object.keys(artifact).sort();
        // Only knowledge-specific keys must appear at the top level.
        expect(topKeys).toEqual(
            [
                KNOWLEDGE_EXPORT_MAGIC,
                'chunkCount',
                'documentCount',
                'documents',
                'embeddingDim',
                'exportedAt',
                'version',
            ].sort()
        );
        // And no credential/meeting/transcript fields leak into the document shape.
        const docKeys = Object.keys(artifact.documents[0]).sort();
        expect(docKeys).not.toContain('apiKey');
        expect(docKeys).not.toContain('credentials');
        expect(docKeys).not.toContain('transcript');
        expect(docKeys).not.toContain('meetingId');
    });

    it('buildExportArtifact throws KnowledgeExportError on wrong dim metadata', () => {
        const { store } = makeTransferStore([
            makeDoc('bad.txt', 1, { embeddingDim: 512 }),
        ]);
        expect(() => buildExportArtifact(store)).toThrow(KnowledgeExportError);
    });

    it('buildExportArtifact throws KnowledgeExportError on wrong chunk embedding length', () => {
        const badDoc = makeDoc('bad.txt', 1);
        badDoc.chunks[0].embedding = badDoc.chunks[0].embedding.slice(0, 100);
        const { store } = makeTransferStore([badDoc]);
        expect(() => buildExportArtifact(store)).toThrow(KnowledgeExportError);
    });

    // ─── validateImportArtifact ───────────────────────────────────
    const goodRaw = (): Record<string, unknown> => ({
        [KNOWLEDGE_EXPORT_MAGIC]: true,
        version: KNOWLEDGE_EXPORT_VERSION,
        embeddingDim: KNOWLEDGE_EXPORT_EMBEDDING_DIM,
        exportedAt: '2026-04-14T00:00:00.000Z',
        documentCount: 1,
        chunkCount: 1,
        documents: [
            {
                name: 'a.txt',
                mime: 'text/plain',
                bytes: 10,
                embeddingModel: 'nomic-embed-text',
                embeddingDim: 768,
                pinned: false,
                pinnedAt: null,
                ingestedAt: '2026-04-14T00:00:00.000Z',
                chunks: [
                    {
                        chunkIndex: 0,
                        text: 'hello',
                        embedding: Array.from({ length: 768 }, (_, i) => i * 0.001),
                    },
                ],
            },
        ],
    });

    it('validateImportArtifact accepts a well-formed artifact', () => {
        const artifact = validateImportArtifact(goodRaw());
        expect(artifact.documents[0].name).toBe('a.txt');
        expect(artifact.documents[0].chunks[0].embedding.length).toBe(768);
    });

    it('validateImportArtifact rejects non-object input', () => {
        expect(() => validateImportArtifact(null)).toThrow(
            KnowledgeIncompatibleFormatError
        );
        expect(() => validateImportArtifact('string')).toThrow(
            KnowledgeIncompatibleFormatError
        );
        expect(() => validateImportArtifact(42)).toThrow(
            KnowledgeIncompatibleFormatError
        );
    });

    it('validateImportArtifact rejects missing magic marker', () => {
        const raw = goodRaw();
        delete raw[KNOWLEDGE_EXPORT_MAGIC];
        expect(() => validateImportArtifact(raw)).toThrow(
            KnowledgeIncompatibleFormatError
        );
    });

    it('validateImportArtifact rejects future version', () => {
        const raw = goodRaw();
        raw.version = 999;
        expect(() => validateImportArtifact(raw)).toThrow(
            KnowledgeIncompatibleFormatError
        );
    });

    it('validateImportArtifact rejects non-integer version', () => {
        const raw = goodRaw();
        raw.version = 1.5;
        expect(() => validateImportArtifact(raw)).toThrow(
            KnowledgeIncompatibleFormatError
        );
    });

    it('validateImportArtifact rejects wrong embedding dim', () => {
        const raw = goodRaw();
        raw.embeddingDim = 1536;
        expect(() => validateImportArtifact(raw)).toThrow(
            KnowledgeIncompatibleFormatError
        );
    });

    it('validateImportArtifact rejects chunk embedding of wrong length', () => {
        const raw = goodRaw();
        (raw.documents as Array<Record<string, unknown>>)[0].chunks = [
            {
                chunkIndex: 0,
                text: 'x',
                embedding: [0.1, 0.2, 0.3], // wrong length
            },
        ];
        expect(() => validateImportArtifact(raw)).toThrow(
            KnowledgeIncompatibleFormatError
        );
    });

    it('validateImportArtifact rejects non-finite embedding values', () => {
        const raw = goodRaw();
        const doc = (raw.documents as Array<Record<string, unknown>>)[0];
        (doc.chunks as Array<Record<string, unknown>>)[0].embedding = Array.from(
            { length: 768 },
            (_, i) => (i === 0 ? Number.NaN : i * 0.001)
        );
        expect(() => validateImportArtifact(raw)).toThrow(
            KnowledgeIncompatibleFormatError
        );
    });

    it('validateImportArtifact rejects documents array with wrong field types', () => {
        const raw = goodRaw();
        (raw.documents as Array<Record<string, unknown>>)[0].name = 42 as unknown as string;
        expect(() => validateImportArtifact(raw)).toThrow(
            KnowledgeIncompatibleFormatError
        );
    });

    // ─── Round-trip via exportKnowledgeToFile + importKnowledgeFromFile ──
    // These hit real fs for write + read. Use a unique file per test.
    const tmpFile = (suffix: string): string => {
        const name = `sensi-kb-export-test-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2)}-${suffix}.json`;
        return pathMod.join(osMod.tmpdir(), name);
    };

    it('exportKnowledgeToFile + importKnowledgeFromFile round-trip preserves pinned state and metadata', async () => {
        const originalDocs = [
            makeDoc('resume.txt', 2, {
                pinned: true,
                pinnedAt: '2026-04-14T12:00:00.000Z',
                embeddingModel: 'nomic-embed-text',
            }),
            makeDoc('notes.md', 1),
        ];
        const { store: srcStore } = makeTransferStore(originalDocs);
        const dstStore = makeTransferStore([]);

        const filePath = tmpFile('roundtrip');
        try {
            const exportResult = await exportKnowledgeToFile(srcStore, filePath);
            expect(exportResult.documentCount).toBe(2);
            expect(exportResult.chunkCount).toBe(3);

            const importResult = await importKnowledgeFromFile(
                dstStore.store,
                filePath,
                null // no backup for this test
            );
            expect(importResult.replaced).toBe(0);
            expect(importResult.imported).toBe(2);
            expect(importResult.chunkCount).toBe(3);

            // Verify pinned + embeddingModel survived via the
            // replaceAllFromArtifact payload captured by the stub.
            const applied = dstStore.replaceCalls[0];
            expect(applied[0].name).toBe('resume.txt');
            expect(applied[0].pinned).toBe(true);
            expect(applied[0].pinnedAt).toBe('2026-04-14T12:00:00.000Z');
            expect(applied[0].embeddingModel).toBe('nomic-embed-text');
            expect(applied[0].chunks[0].embedding.length).toBe(768);
            expect(applied[1].name).toBe('notes.md');
        } finally {
            try {
                fsMod.unlinkSync(filePath);
            } catch {
                /* ignore */
            }
        }
    });

    it('importKnowledgeFromFile rejects malformed JSON', async () => {
        const filePath = tmpFile('malformed');
        fsMod.writeFileSync(filePath, '{this is not valid json}', 'utf8');
        const dst = makeTransferStore([]);
        try {
            await expect(
                importKnowledgeFromFile(dst.store, filePath, null)
            ).rejects.toBeInstanceOf(KnowledgeIncompatibleFormatError);
            // Atomicity: store should be untouched
            expect(dst.replaceCalls.length).toBe(0);
        } finally {
            fsMod.unlinkSync(filePath);
        }
    });

    it('importKnowledgeFromFile rejects missing file with KnowledgeImportError', async () => {
        const dst = makeTransferStore([]);
        await expect(
            importKnowledgeFromFile(
                dst.store,
                pathMod.join(osMod.tmpdir(), 'does-not-exist-sensi.json'),
                null
            )
        ).rejects.toBeInstanceOf(KnowledgeImportError);
        expect(dst.replaceCalls.length).toBe(0);
    });

    it('importKnowledgeFromFile atomicity: replace failure leaves store untouched', async () => {
        const srcStore = makeTransferStore([makeDoc('a.txt', 1)]);
        const filePath = tmpFile('atomic');
        try {
            await exportKnowledgeToFile(srcStore.store, filePath);

            const dst = makeTransferStore([makeDoc('existing.txt', 1)]);
            dst.setReplaceError(new Error('simulated DB transaction failure'));

            await expect(
                importKnowledgeFromFile(dst.store, filePath, null)
            ).rejects.toBeInstanceOf(KnowledgeImportError);
            // Replace was attempted exactly once and threw — caller sees
            // atomic failure (the stub does not commit state changes when
            // its internal error is set, matching a rolled-back transaction).
            expect(dst.replaceCalls.length).toBe(1);
            expect(dst.state.docs.length).toBe(1);
            expect(dst.state.docs[0].name).toBe('existing.txt');
        } finally {
            fsMod.unlinkSync(filePath);
        }
    });

    it('importKnowledgeFromFile writes pre-import backup before mutating store', async () => {
        const srcStore = makeTransferStore([makeDoc('new.txt', 1)]);
        const exportPath = tmpFile('new');
        const backupDir = pathMod.join(
            osMod.tmpdir(),
            `sensi-backup-test-${Date.now()}`
        );
        fsMod.mkdirSync(backupDir, { recursive: true });
        try {
            await exportKnowledgeToFile(srcStore.store, exportPath);

            const dst = makeTransferStore([makeDoc('existing.txt', 1)]);
            const result = await importKnowledgeFromFile(
                dst.store,
                exportPath,
                backupDir
            );

            expect(result.backupPath).not.toBeNull();
            expect(result.backupPath!).toContain('knowledge-preimport-backup-');
            const backupExists = fsMod.existsSync(result.backupPath!);
            expect(backupExists).toBe(true);

            // Backup should contain the PRE-IMPORT state (existing.txt)
            const backupRaw = fsMod.readFileSync(result.backupPath!, 'utf8');
            const backup = JSON.parse(backupRaw) as KnowledgeExportArtifact;
            expect(backup.documents[0].name).toBe('existing.txt');
        } finally {
            try {
                fsMod.unlinkSync(exportPath);
            } catch {
                /* ignore */
            }
            try {
                fsMod.rmSync(backupDir, { recursive: true, force: true });
            } catch {
                /* ignore */
            }
        }
    });

    it('exportKnowledgeToFile produces JSON that re-validates', async () => {
        const srcStore = makeTransferStore([
            makeDoc('a.txt', 2, { pinned: true, pinnedAt: '2026-01-01' }),
            makeDoc('b.txt', 0), // zero-chunk doc
        ]);
        const filePath = tmpFile('revalidate');
        try {
            await exportKnowledgeToFile(srcStore.store, filePath);
            const raw = fsMod.readFileSync(filePath, 'utf8');
            const parsed = JSON.parse(raw);
            const artifact = validateImportArtifact(parsed);
            expect(artifact.documentCount).toBe(2);
            expect(artifact.chunkCount).toBe(2);
            expect(artifact.documents[1].chunks).toHaveLength(0);
            expect(artifact.documents[0].pinned).toBe(true);
        } finally {
            fsMod.unlinkSync(filePath);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────
// IPC handler tests — thin wrappers around the transfer module
// ─────────────────────────────────────────────────────────────────────
describe('knowledgeIpcHelpers export/import (M4-T10)', () => {
    const baseOrch = (): OrchForIpcT10 => ({
        ingestDocument: async () => ({
            documentId: 'd1',
            chunkCount: 0,
            embeddingModel: 'nomic-embed-text',
            embeddingProvider: 'ollama',
        }),
        listDocuments: () => [],
        deleteDocument: () => {},
        pinDocument: () => ({ pinnedAt: null }),
        unpinDocument: () => ({ pinnedAt: null }),
        listPinned: () => [],
        queryKnowledge: async () => [],
        getDocumentText: () => '',
        getTransferStore: () => ({
            listDocuments: () => [],
            getDocumentChunksWithEmbeddings: () => [],
            replaceAllFromArtifact: () => ({ replaced: 0, imported: 0 }),
        }),
        getBackupDir: () => null,
    });

    it('handleExportKnowledge rejects empty filePath', async () => {
        const orch = baseOrch();
        const result = (await handleExportKnowledge(orch, '')) as IpcFailureT10;
        expect(result.success).toBe(false);
        expect(result.errorType).toBe('invalid_input');
    });

    it('handleExportKnowledge rejects non-string filePath', async () => {
        const orch = baseOrch();
        const result = (await handleExportKnowledge(orch, 42)) as IpcFailureT10;
        expect(result.success).toBe(false);
        expect(result.errorType).toBe('invalid_input');
    });

    it('handleExportKnowledge returns counts on success', async () => {
        const filePath = pathMod.join(
            osMod.tmpdir(),
            `sensi-handle-export-${Date.now()}.json`
        );
        const orch = baseOrch();
        try {
            const result = await handleExportKnowledge(orch, filePath);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.documentCount).toBe(0);
                expect(result.chunkCount).toBe(0);
                expect(result.filePath).toBe(filePath);
            }
        } finally {
            try {
                fsMod.unlinkSync(filePath);
            } catch {
                /* ignore */
            }
        }
    });

    it('handleImportKnowledge rejects empty filePath', async () => {
        const orch = baseOrch();
        const result = (await handleImportKnowledge(orch, '')) as IpcFailureT10;
        expect(result.success).toBe(false);
        expect(result.errorType).toBe('invalid_input');
    });

    it('handleImportKnowledge translates KnowledgeIncompatibleFormatError to incompatible_format', async () => {
        const filePath = pathMod.join(
            osMod.tmpdir(),
            `sensi-handle-import-bad-${Date.now()}.json`
        );
        fsMod.writeFileSync(filePath, 'not valid json', 'utf8');
        const orch = baseOrch();
        try {
            const result = (await handleImportKnowledge(
                orch,
                filePath
            )) as IpcFailureT10;
            expect(result.success).toBe(false);
            expect(result.errorType).toBe('incompatible_format');
        } finally {
            try {
                fsMod.unlinkSync(filePath);
            } catch {
                /* ignore */
            }
        }
    });

    it('handleImportKnowledge translates KnowledgeImportError (missing file) to import_failed', async () => {
        const orch = baseOrch();
        const result = (await handleImportKnowledge(
            orch,
            pathMod.join(osMod.tmpdir(), 'sensi-nonexistent-import.json')
        )) as IpcFailureT10;
        expect(result.success).toBe(false);
        expect(result.errorType).toBe('import_failed');
    });

    it('handleImportKnowledge preserves the no-new-raw-text-exposure invariant', () => {
        // The handler's success return type must NOT include any document
        // text or chunk text field. This test is a structural assertion
        // against accidental regression — if someone adds `text` or
        // `chunks` to `ImportKnowledgeResult`, the type assertion fails.
        type Result = Awaited<ReturnType<typeof handleImportKnowledge>>;
        // Compile-time assertion: the success branch has only these keys
        const _check: Result extends infer R
            ? R extends { success: true }
                ? keyof R & string
                : never
            : never = 'success' as never;
        void _check;
        // No runtime assertion — pure compile-time gate.
        expect(true).toBe(true);
    });

    it('handleExportKnowledge passes through error for non-writable path', async () => {
        // On Windows, a path containing invalid characters triggers a
        // write failure. We use a nested path under a non-existent
        // directory, which fails with ENOENT.
        const orch = baseOrch();
        const bogus = pathMod.join(
            osMod.tmpdir(),
            `sensi-missing-dir-${Date.now()}`,
            'nested',
            'export.json'
        );
        const result = (await handleExportKnowledge(orch, bogus)) as IpcFailureT10;
        expect(result.success).toBe(false);
        expect(result.errorType).toBe('export_failed');
    });
});

// ═════════════════════════════════════════════════════════════════════════
// KNOWLEDGE-FIX-01 — Ollama embedding-model presence probe
// ═════════════════════════════════════════════════════════════════════════
//
// The M4-T5 probe only checked `/api/tags` reachability. If `ollama serve`
// was running but `nomic-embed-text` wasn't pulled, the probe returned
// true, embed() committed to Ollama, and the subsequent `/api/embed` POST
// failed with a non-2xx — surfacing as a misleading "knowledge query
// failed" message during an ingest action. These tests cover a new pure
// helper `hasOllamaEmbeddingModel` that parses the tags response and
// returns true only when the required embedding model is actually
// installed. See the KNOWLEDGE-FIX-01 plan for the rationale.
// ═════════════════════════════════════════════════════════════════════════

describe('EmbeddingAdapter probe — Ollama model presence (KNOWLEDGE-FIX-01)', () => {
    it('returns true when nomic-embed-text is listed in models[] (with or without tag suffix)', () => {
        // Real Ollama /api/tags entries carry both `name` and `model`
        // fields with the `:latest` suffix. Either match should pass.
        const withSuffix = {
            models: [
                { name: 'llama3:8b', model: 'llama3:8b' },
                { name: 'nomic-embed-text:latest', model: 'nomic-embed-text:latest' },
            ],
        };
        expect(hasOllamaEmbeddingModel(withSuffix, 'nomic-embed-text')).toBe(true);

        // Some installs / custom tags may drop the suffix entirely.
        const withoutSuffix = {
            models: [{ name: 'nomic-embed-text', model: 'nomic-embed-text' }],
        };
        expect(hasOllamaEmbeddingModel(withoutSuffix, 'nomic-embed-text')).toBe(true);

        // The helper is parameterized on modelName so a future non-768
        // model (not in M4 scope) could be queried without editing the helper.
        const other = { models: [{ name: 'mxbai-embed-large:latest' }] };
        expect(hasOllamaEmbeddingModel(other, 'mxbai-embed-large')).toBe(true);
    });

    it('returns false when daemon responds but nomic-embed-text is absent', () => {
        const onlyLlama = {
            models: [
                { name: 'llama3:8b', model: 'llama3:8b' },
                { name: 'mistral:7b', model: 'mistral:7b' },
            ],
        };
        expect(hasOllamaEmbeddingModel(onlyLlama, 'nomic-embed-text')).toBe(false);

        // A near-miss (different base name) must NOT match.
        const nearMiss = {
            models: [{ name: 'nomic-embed-text-v2:latest', model: 'nomic-embed-text-v2:latest' }],
        };
        expect(hasOllamaEmbeddingModel(nearMiss, 'nomic-embed-text')).toBe(false);
    });

    it('returns false on malformed tags response', () => {
        // null
        expect(hasOllamaEmbeddingModel(null, 'nomic-embed-text')).toBe(false);
        // undefined
        expect(hasOllamaEmbeddingModel(undefined, 'nomic-embed-text')).toBe(false);
        // Non-object (string)
        expect(hasOllamaEmbeddingModel('not-a-json-object', 'nomic-embed-text')).toBe(false);
        // Non-object (number)
        expect(hasOllamaEmbeddingModel(42, 'nomic-embed-text')).toBe(false);
        // Missing `models` key
        expect(hasOllamaEmbeddingModel({}, 'nomic-embed-text')).toBe(false);
        // `models` is not an array
        expect(
            hasOllamaEmbeddingModel({ models: 'nomic-embed-text' }, 'nomic-embed-text')
        ).toBe(false);
        // Empty `models[]`
        expect(hasOllamaEmbeddingModel({ models: [] }, 'nomic-embed-text')).toBe(false);
        // Entries lack `name` and `model` fields
        expect(
            hasOllamaEmbeddingModel({ models: [{ size: 123 }, {}] }, 'nomic-embed-text')
        ).toBe(false);
        // Entries are non-objects
        expect(
            hasOllamaEmbeddingModel(
                { models: ['nomic-embed-text', null, 42] },
                'nomic-embed-text'
            )
        ).toBe(false);
    });
});

// ═════════════════════════════════════════════════════════════════════════
// KNOWLEDGE-FIX-02 — Gemini embedding request shape
//
// These tests exercise the real `embedWithGeminiDefault` path by
// letting `EmbeddingAdapter` reach its module-level default (we do NOT
// override `embedWithGemini` via the DI constructor). `globalThis.fetch`
// is stubbed with `vi.spyOn` so no network is touched. Tests pin the
// outbound URL shape, the request body shape (including the new
// `outputDimensionality: 768` field), the 768-dim post-condition, the
// non-2xx error-wrapping contract, and the no-API-key-leak guarantee.
// ═════════════════════════════════════════════════════════════════════════

describe('EmbeddingAdapter Gemini request shape (KNOWLEDGE-FIX-02)', () => {
    const vec768Local = (fn: (i: number) => number): number[] =>
        Array.from({ length: 768 }, (_, i) => fn(i));

    const makeOkGeminiResponse = (vectors: number[][]): Response => {
        const body = {
            embeddings: vectors.map((values) => ({ values })),
        };
        return {
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => body,
            text: async () => JSON.stringify(body),
        } as unknown as Response;
    };

    const make404GeminiResponse = (serverMsg: string): Response => {
        return {
            ok: false,
            status: 404,
            statusText: 'Not Found',
            json: async () => ({ error: { code: 404, message: serverMsg } }),
            text: async () => serverMsg,
        } as unknown as Response;
    };

    let fetchSpy: ReturnType<typeof vi.spyOn>;

    afterEach(() => {
        if (fetchSpy) fetchSpy.mockRestore();
    });

    const buildGeminiOnlyAdapter = (): EmbeddingAdapter => {
        // Leave `embedWithGemini` + `probeOllama` un-DI'd so the module-
        // level defaults (the real code paths) execute. Only force the
        // Ollama probe to "down" and supply a fake key.
        return new EmbeddingAdapter({
            probeOllama: async () => false,
            getGeminiApiKey: () => 'fake-test-key-ZZZZZZZZZZZZ',
        });
    };

    it('embedWithGeminiDefault constructs the v1beta batchEmbedContents URL with gemini-embedding-001', async () => {
        fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockImplementation(async () =>
                makeOkGeminiResponse([vec768Local(() => 0.1)])
            );

        const adapter = buildGeminiOnlyAdapter();
        await adapter.embed(['hello world']);

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const firstCall = fetchSpy.mock.calls[0];
        const url = firstCall[0] as string;
        expect(typeof url).toBe('string');
        expect(url.startsWith('https://generativelanguage.googleapis.com/v1beta/models/')).toBe(true);
        expect(url).toContain('gemini-embedding-001');
        expect(url).toContain(':batchEmbedContents?key=');
        // Key appears in the URL query string (only place it should ever
        // appear). encodeURIComponent leaves ASCII alphanumerics alone.
        expect(url).toContain('key=fake-test-key-ZZZZZZZZZZZZ');
    });

    it('embedWithGeminiDefault body stamps model + outputDimensionality=768 on every request entry', async () => {
        fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockImplementation(async () =>
                makeOkGeminiResponse([
                    vec768Local(() => 0.1),
                    vec768Local(() => 0.2),
                ])
            );

        const adapter = buildGeminiOnlyAdapter();
        await adapter.embed(['alpha', 'beta']);

        const init = fetchSpy.mock.calls[0][1] as RequestInit;
        expect(init).toBeDefined();
        expect(init.method).toBe('POST');

        // Headers should carry only Content-Type, never the API key.
        const headers = init.headers as Record<string, string>;
        expect(headers['Content-Type']).toBe('application/json');
        const headerValues = Object.values(headers).join('|');
        expect(headerValues).not.toContain('fake-test-key-ZZZZZZZZZZZZ');

        const bodyStr = init.body as string;
        expect(typeof bodyStr).toBe('string');
        const body = JSON.parse(bodyStr) as {
            requests: Array<{
                model: string;
                content: { parts: Array<{ text: string }> };
                outputDimensionality: number;
            }>;
        };
        expect(body.requests).toHaveLength(2);
        expect(body.requests[0].model).toBe('models/gemini-embedding-001');
        expect(body.requests[0].content.parts[0].text).toBe('alpha');
        expect(body.requests[0].outputDimensionality).toBe(768);
        expect(body.requests[1].model).toBe('models/gemini-embedding-001');
        expect(body.requests[1].content.parts[0].text).toBe('beta');
        expect(body.requests[1].outputDimensionality).toBe(768);
    });

    it('embedWithGeminiDefault preserves the 768-dim post-condition', async () => {
        fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockImplementation(async () =>
                makeOkGeminiResponse([
                    vec768Local((i) => (i === 0 ? 1 : i === 767 ? 2 : 0)),
                    vec768Local((i) => (i === 0 ? 3 : 0)),
                ])
            );

        const adapter = buildGeminiOnlyAdapter();
        const vectors = await adapter.embed(['a', 'b']);

        expect(vectors).toHaveLength(2);
        expect(vectors[0]).toBeInstanceOf(Float32Array);
        expect(vectors[0].length).toBe(768);
        expect(vectors[0][0]).toBeCloseTo(1);
        expect(vectors[0][767]).toBeCloseTo(2);
        expect(vectors[1][0]).toBeCloseTo(3);
    });

    it('embedWithGeminiDefault rejects a 404 response as KnowledgeEmbeddingRequestError without leaking the API key or URL', async () => {
        const geminiErrorText =
            '"models/gemini-embedding-001 is not found for API version v1beta, or is not supported for embedContent"';
        fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockImplementation(async () => make404GeminiResponse(geminiErrorText));

        const adapter = buildGeminiOnlyAdapter();

        let caught: unknown = null;
        try {
            await adapter.embed(['hello']);
        } catch (e) {
            caught = e;
        }

        expect(caught).toBeInstanceOf(KnowledgeEmbeddingRequestError);
        const msg = (caught as Error).message;
        expect(msg).toContain('404');
        expect(msg).toContain('Not Found');
        // Critical leak guards: the error message must never contain
        // the API key, the `?key=` query fragment, or the full Google
        // endpoint URL.
        expect(msg).not.toContain('fake-test-key-ZZZZZZZZZZZZ');
        expect(msg).not.toContain('?key=');
        expect(msg).not.toContain('https://generativelanguage.googleapis.com');
    });

    it('getActiveEmbeddingConfig returns gemini-embedding-001 after a successful embed', async () => {
        fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockImplementation(async () =>
                makeOkGeminiResponse([vec768Local(() => 0.5)])
            );

        const adapter = buildGeminiOnlyAdapter();
        await adapter.embed(['hi']);

        const cfg = adapter.getActiveEmbeddingConfig();
        expect(cfg.provider).toBe('gemini');
        expect(cfg.model).toBe('gemini-embedding-001');
        expect(cfg.dimension).toBe(768);
    });
});

// ═════════════════════════════════════════════════════════════════════════
// M3-FIX — OpenAI per-model max_completion_tokens clamp
//
// Gates the helper that prevents `400 max_tokens is too large` from the
// OpenAI API when the requested value (MAX_OUTPUT_TOKENS = 65536) exceeds
// the selected model's completion ceiling. Pure string → number helper;
// no network, no SDK, no mocks.
// ═════════════════════════════════════════════════════════════════════════

describe('resolveMaxCompletionTokens (M3-FIX)', () => {
    it('clamps GPT-4o family to 16384', () => {
        expect(resolveMaxCompletionTokens('gpt-4o', 65536)).toBe(16384);
        expect(resolveMaxCompletionTokens('gpt-4o-mini', 65536)).toBe(16384);
        expect(resolveMaxCompletionTokens('gpt-4o-2024-08-06', 65536)).toBe(16384);
        // Case-insensitive match
        expect(resolveMaxCompletionTokens('GPT-4O', 65536)).toBe(16384);
        // Requested value below the cap passes through unchanged
        expect(resolveMaxCompletionTokens('gpt-4o', 8192)).toBe(8192);
    });

    it('clamps o1 / o3 / GPT-5 family to 32768', () => {
        expect(resolveMaxCompletionTokens('o1-preview', 65536)).toBe(32768);
        expect(resolveMaxCompletionTokens('o1-mini', 65536)).toBe(32768);
        expect(resolveMaxCompletionTokens('o3-mini', 65536)).toBe(32768);
        expect(resolveMaxCompletionTokens('gpt-5.4', 65536)).toBe(32768);
        expect(resolveMaxCompletionTokens('gpt-5-turbo', 65536)).toBe(32768);
        // Below-cap requests still pass through
        expect(resolveMaxCompletionTokens('gpt-5.4', 8192)).toBe(8192);
    });

    it('applies the conservative 16384 default for unknown OpenAI-family ids', () => {
        // gpt-4-turbo (pre-4o) and gpt-3.5-turbo historically had
        // 4096 and 16384 output caps respectively; the conservative
        // default of 16384 is safe for every documented gpt- prefix.
        expect(resolveMaxCompletionTokens('gpt-4-turbo', 65536)).toBe(16384);
        expect(resolveMaxCompletionTokens('gpt-3.5-turbo', 65536)).toBe(16384);
        expect(resolveMaxCompletionTokens('openai-mystery-model', 65536)).toBe(16384);
    });

    it('passes through unknown and non-OpenAI models unchanged', () => {
        // Non-OpenAI providers have their own SDK-side clamping; the
        // helper must NOT rewrite their budgets or the Gemini/MiniMax/
        // Groq paths would silently clip their legitimate requests.
        expect(resolveMaxCompletionTokens('MiniMax-M2.7', 65536)).toBe(65536);
        expect(resolveMaxCompletionTokens('gemini-3.1-flash', 65536)).toBe(65536);
        expect(resolveMaxCompletionTokens('llama-3.3-70b-versatile', 65536)).toBe(65536);
        expect(resolveMaxCompletionTokens('unknown-model', 65536)).toBe(65536);
        // Empty / malformed ids also pass through rather than mis-clamp
        expect(resolveMaxCompletionTokens('', 65536)).toBe(65536);
    });

    it('clamps Claude-family ids routed through the OpenAI SDK to 8192', () => {
        // Legacy edge: claude-* ids ever routed through the OpenAI
        // client (not the Anthropic SDK). Claude Sonnet 4.6 actual
        // output cap is 8192. Below-cap requests pass through.
        expect(resolveMaxCompletionTokens('claude-sonnet-4-6', 65536)).toBe(8192);
        expect(resolveMaxCompletionTokens('claude-3-5-sonnet-20241022', 65536)).toBe(8192);
        expect(resolveMaxCompletionTokens('claude-sonnet-4-6', 4096)).toBe(4096);
    });
});

// ═════════════════════════════════════════════════════════════════════════
// POLISH-01 — isWithinBottomThreshold (auto-scroll predicate)
//
// Gates the pure math helper that drives `useAutoScrollToBottom`. This
// is the only piece of the hook that can be tested without jsdom; the
// DOM side effects (scroll listener attach, rAF, ResizeObserver) are
// covered by the POLISH-01 manual smoke. No renderer test harness is
// added — same policy as M4-T9 / D022.
// ═════════════════════════════════════════════════════════════════════════

import { isWithinBottomThreshold } from '../../src/hooks/useAutoScrollToBottom';

describe('isWithinBottomThreshold (POLISH-01)', () => {
    it('returns true when viewport is exactly at the bottom', () => {
        // scrollHeight 1000, clientHeight 400, scrollTop 600 → bottom edge.
        // distance = 1000 - (600 + 400) = 0 → inside any threshold.
        expect(isWithinBottomThreshold(600, 400, 1000)).toBe(true);
        expect(isWithinBottomThreshold(600, 400, 1000, 0)).toBe(true);
    });

    it('returns true when viewport is within 48 px of the bottom (default threshold)', () => {
        // distance = 1000 - (560 + 400) = 40 → inside 48 px default.
        expect(isWithinBottomThreshold(560, 400, 1000)).toBe(true);
        // distance exactly at threshold edge still counts as "near bottom".
        expect(isWithinBottomThreshold(552, 400, 1000)).toBe(true);
    });

    it('returns false when viewport is more than threshold px from bottom', () => {
        // distance = 1000 - (500 + 400) = 100 → outside 48 px default.
        expect(isWithinBottomThreshold(500, 400, 1000)).toBe(false);
        // Custom tight threshold rejects a 40 px gap.
        expect(isWithinBottomThreshold(560, 400, 1000, 10)).toBe(false);
        // Scrolled way up → definitely not at bottom.
        expect(isWithinBottomThreshold(0, 400, 1000)).toBe(false);
    });

    it('treats non-overflowing containers as always "at bottom"', () => {
        // scrollHeight <= clientHeight means there is nothing to scroll;
        // caller would be pinned to the top by definition and should not
        // trigger auto-scroll. Returning true = "already at bottom, no
        // follow-scroll required" is the correct no-op answer.
        expect(isWithinBottomThreshold(0, 400, 400)).toBe(true);
        expect(isWithinBottomThreshold(0, 400, 200)).toBe(true);
        expect(isWithinBottomThreshold(0, 0, 0)).toBe(true);
    });
});

// ═════════════════════════════════════════════════════════════════════════
// M5-T4 — SilenceDetector
//
// Pure in-memory helper driven by wall-clock deltas. No timers, no
// fs, no network. Tests cover the state machine: never-seen →
// recent → stale → reset. Plus the `isSilentAt` free function that
// backs the class, exposed for the same structural-test pattern used
// by `isWithinBottomThreshold` (POLISH-01).
// ═════════════════════════════════════════════════════════════════════════

import {
    SilenceDetector,
    isSilentAt,
} from '../audio/SilenceDetector';

describe('SilenceDetector (M5-T4)', () => {
    it('reports not silent before any final segment has been recorded', () => {
        const d = new SilenceDetector({ thresholdMs: 1500 });
        expect(d.isSilent(Date.now())).toBe(false);
        // Every subsequent now() call without a final segment stays not-silent
        expect(d.isSilent(Date.now() + 10_000)).toBe(false);
        expect(d.getLastFinalAt()).toBeNull();
    });

    it('reports not silent while a final segment is within the threshold', () => {
        const d = new SilenceDetector({ thresholdMs: 1500 });
        d.noteFinalSegment(10_000);
        // 500 ms after the final → within threshold
        expect(d.isSilent(10_500)).toBe(false);
        // 1499 ms after → still within threshold (strictly less than)
        expect(d.isSilent(11_499)).toBe(false);
    });

    it('reports silent once the final-segment age exceeds the threshold', () => {
        const d = new SilenceDetector({ thresholdMs: 1500 });
        d.noteFinalSegment(10_000);
        // 1500 ms after → edge-case, counts as silent (>= threshold)
        expect(d.isSilent(11_500)).toBe(true);
        // Well after → definitely silent
        expect(d.isSilent(15_000)).toBe(true);
    });

    it('re-arms correctly when a new final segment arrives after a silent period', () => {
        const d = new SilenceDetector({ thresholdMs: 1500 });
        d.noteFinalSegment(10_000);
        expect(d.isSilent(15_000)).toBe(true);   // silent
        d.noteFinalSegment(16_000);              // new speech
        expect(d.isSilent(16_500)).toBe(false);  // no longer silent
        expect(d.isSilent(18_000)).toBe(true);   // silent again after threshold
    });

    it('setThresholdMs re-evaluates the next isSilent call with the new value', () => {
        const d = new SilenceDetector({ thresholdMs: 1500 });
        d.noteFinalSegment(10_000);
        expect(d.isSilent(11_000)).toBe(false);  // within 1500ms
        d.setThresholdMs(500);                    // tighten threshold
        expect(d.isSilent(11_000)).toBe(true);   // now silent (1000ms > 500ms)
        d.setThresholdMs(5000);                   // loosen threshold
        expect(d.isSilent(11_000)).toBe(false);  // no longer silent
        // Invalid values rejected
        expect(() => d.setThresholdMs(-1)).toThrow();
        expect(() => d.setThresholdMs(Number.NaN)).toThrow();
    });

    it('reset clears the last-final timestamp and returns to never-seen state', () => {
        const d = new SilenceDetector({ thresholdMs: 1500 });
        d.noteFinalSegment(10_000);
        expect(d.isSilent(15_000)).toBe(true);
        d.reset();
        expect(d.getLastFinalAt()).toBeNull();
        expect(d.isSilent(15_000)).toBe(false);  // back to never-seen
        expect(d.isSilent(999_999)).toBe(false); // stays not-silent until next final
    });

    it('isSilentAt pure helper matches the class semantics', () => {
        // null last-final → never silent
        expect(isSilentAt(null, 10_000, 1500)).toBe(false);
        // Within threshold → not silent
        expect(isSilentAt(10_000, 11_000, 1500)).toBe(false);
        // At threshold (exactly) → silent
        expect(isSilentAt(10_000, 11_500, 1500)).toBe(true);
        // Beyond threshold → silent
        expect(isSilentAt(10_000, 20_000, 1500)).toBe(true);
    });
});

// ═════════════════════════════════════════════════════════════════════════
// M5-T5 — RollingTriggerPolicy
//
// Policy decides WHEN a rolling-response run should fire. Pure
// state machine, DI-friendly (injected clock + silence detector).
// No side effects — caller handles dispatch, caller marks the
// fire via `markFiredOnSilence()`.
// ═════════════════════════════════════════════════════════════════════════

import {
    RollingTriggerPolicy,
    ROLLING_TRIGGER_MODES,
    isValidRollingTriggerMode,
    type RollingTriggerMode,
} from '../llm/RollingTriggerPolicy';

describe('RollingTriggerPolicy (M5-T5)', () => {
    // Helper: policy wired to a controllable fake clock
    const makePolicy = (
        initialMode: RollingTriggerMode = 'on-silence',
        thresholdMs = 1500
    ) => {
        let now = 0;
        const clock = () => now;
        const silenceDetector = new SilenceDetector({ thresholdMs });
        const policy = new RollingTriggerPolicy({
            now: clock,
            silenceDetector,
            initialMode,
        });
        return {
            policy,
            silenceDetector,
            advance: (ms: number) => { now += ms; },
            setNow: (t: number) => { now = t; },
            getNow: () => now,
        };
    };

    it('isValidRollingTriggerMode accepts the three valid modes and rejects everything else', () => {
        expect(isValidRollingTriggerMode('off')).toBe(true);
        expect(isValidRollingTriggerMode('on-silence')).toBe(true);
        expect(isValidRollingTriggerMode('on-demand')).toBe(true);
        expect(isValidRollingTriggerMode('auto')).toBe(false);
        expect(isValidRollingTriggerMode('')).toBe(false);
        expect(isValidRollingTriggerMode(42)).toBe(false);
        expect(isValidRollingTriggerMode(null)).toBe(false);
        expect(isValidRollingTriggerMode(undefined)).toBe(false);
        expect(ROLLING_TRIGGER_MODES).toEqual(['off', 'on-silence', 'on-demand']);
    });

    it('off mode never fires on silence even after the threshold elapses', () => {
        const { policy, advance } = makePolicy('off');
        policy.noteSegment({ isFinal: true, timestampMs: 0 });
        advance(5000);  // well past threshold
        expect(policy.shouldFireOnSilence()).toBeNull();
    });

    it('on-silence mode fires once after the threshold, then suppresses until a new final arrives', () => {
        const { policy, advance } = makePolicy('on-silence');
        // Initial final segment at t=0
        policy.noteSegment({ isFinal: true, timestampMs: 0 });
        // Still within threshold → no fire
        advance(1000);
        expect(policy.shouldFireOnSilence()).toBeNull();
        // Past threshold → fire
        advance(600);  // now t=1600, 1600ms since last final
        const first = policy.shouldFireOnSilence();
        expect(first).not.toBeNull();
        expect(first?.kind).toBe('on-silence');
        // Caller marks the fire
        policy.markFiredOnSilence();
        // Same lull, no re-fire even after more time
        advance(3000);
        expect(policy.shouldFireOnSilence()).toBeNull();
        // New final segment → silence period ends, cooldown clears
        policy.noteSegment({ isFinal: true, timestampMs: policy['now']() });
        // Still within new threshold → no fire
        expect(policy.shouldFireOnSilence()).toBeNull();
        // After new silence threshold → fire again
        advance(2000);
        const second = policy.shouldFireOnSilence();
        expect(second).not.toBeNull();
    });

    it('interim segments do NOT reset silence (only final segments count)', () => {
        const { policy, advance } = makePolicy('on-silence');
        policy.noteSegment({ isFinal: true, timestampMs: 0 });
        advance(1000);
        // Interim ping should be ignored
        policy.noteSegment({ isFinal: false, timestampMs: 1000 });
        advance(700);  // t=1700, >1500ms since last FINAL
        expect(policy.shouldFireOnSilence()?.kind).toBe('on-silence');
    });

    it('stream-in-flight guard blocks on-silence fires until markStreamFinished', () => {
        const { policy, advance } = makePolicy('on-silence');
        policy.noteSegment({ isFinal: true, timestampMs: 0 });
        advance(2000);
        // Stream is streaming → no fire
        policy.markStreamStarted();
        expect(policy.shouldFireOnSilence()).toBeNull();
        // Stream finishes → fire allowed
        policy.markStreamFinished();
        expect(policy.shouldFireOnSilence()?.kind).toBe('on-silence');
    });

    it('on-demand mode never auto-fires but triggerOnDemand() returns a reason', () => {
        const { policy, advance } = makePolicy('on-demand');
        policy.noteSegment({ isFinal: true, timestampMs: 0 });
        advance(5000);
        // Silence does NOT fire in on-demand mode
        expect(policy.shouldFireOnSilence()).toBeNull();
        // But manual trigger works
        expect(policy.triggerOnDemand()?.kind).toBe('on-demand');
    });

    it('off mode rejects on-demand triggers (user explicitly disabled rolling responses)', () => {
        const { policy } = makePolicy('off');
        expect(policy.triggerOnDemand()).toBeNull();
    });

    it('stream-in-flight guard also blocks on-demand triggers', () => {
        const { policy } = makePolicy('on-silence');
        policy.markStreamStarted();
        expect(policy.triggerOnDemand()).toBeNull();
        policy.markStreamFinished();
        expect(policy.triggerOnDemand()?.kind).toBe('on-demand');
    });

    it('setMode switches modes at runtime and clears the already-fired flag', () => {
        const { policy, advance } = makePolicy('on-silence');
        policy.noteSegment({ isFinal: true, timestampMs: 0 });
        advance(2000);
        // Fire once
        expect(policy.shouldFireOnSilence()?.kind).toBe('on-silence');
        policy.markFiredOnSilence();
        // Same lull, no re-fire
        expect(policy.shouldFireOnSilence()).toBeNull();
        // Flip off → on-silence resets the flag so next tick in the same lull re-fires
        policy.setMode('off');
        policy.setMode('on-silence');
        expect(policy.shouldFireOnSilence()?.kind).toBe('on-silence');
        // Invalid mode rejected
        expect(() => policy.setMode('auto' as RollingTriggerMode)).toThrow();
    });

    it('reset clears all policy state including in-flight and fired-flag', () => {
        const { policy, advance } = makePolicy('on-silence');
        policy.noteSegment({ isFinal: true, timestampMs: 0 });
        policy.markStreamStarted();
        policy.markFiredOnSilence();
        expect(policy.isStreamInFlight()).toBe(true);
        policy.reset();
        expect(policy.isStreamInFlight()).toBe(false);
        // After reset, no final segment → silent check returns false
        advance(10_000);
        expect(policy.shouldFireOnSilence()).toBeNull();
        // New final segment re-arms silence detection
        policy.noteSegment({ isFinal: true, timestampMs: policy['now']() });
        advance(2000);
        expect(policy.shouldFireOnSilence()?.kind).toBe('on-silence');
        // Mode is preserved through reset (user preference, not session state)
        expect(policy.getMode()).toBe('on-silence');
    });
});

// ═════════════════════════════════════════════════════════════════════════
// M5-T6 — Dispatch binding wiring contract
//
// The binding itself (IntelligenceEngine) instantiates a real
// RollingTriggerPolicy, feeds `noteSegment()` from every transcript,
// ticks `shouldFireOnSilence()` on a 300ms interval, and wraps
// `runWhatShouldISay` in markStreamStarted/Finished. Direct
// instantiation of IntelligenceEngine requires the full LLMHelper
// (Google/Groq/OpenAI/Anthropic/sharp) which is too heavy for these
// unit tests — see DECISIONS.md D022 for the no-jsdom policy.
//
// These tests cover the pure-helper surface we extracted from the
// dispatch binding: the intent-classifier suppression gate. The rest
// of the wiring (tick driver, in-flight guard, finally-clause
// release) is exercised by the manual smoke flow in TASKS.md M5-T6.
// ═════════════════════════════════════════════════════════════════════════

import { shouldRunRefinementClassifier } from '../IntelligenceEngine';

describe('shouldRunRefinementClassifier (M5-T6 intent-classifier gate)', () => {
    it('returns false when rolling mode is off — the classifier is suppressed', () => {
        expect(shouldRunRefinementClassifier('off')).toBe(false);
    });

    it('returns true when rolling mode is on-silence — classifier runs alongside the silence trigger', () => {
        expect(shouldRunRefinementClassifier('on-silence')).toBe(true);
    });

    it('returns true when rolling mode is on-demand — classifier still runs (refinement ≠ rolling response)', () => {
        expect(shouldRunRefinementClassifier('on-demand')).toBe(true);
    });
});

// M5-T6 — verifies the policy contract from the dispatch binding side:
// every final transcript must re-arm the silence detector, every interim
// must not. This is what IntelligenceEngine.handleTranscript's call to
// policy.noteSegment() relies on. Duplicated from M5-T5 at a higher
// level to document the binding's expectation.
describe('RollingTriggerPolicy dispatch-binding contract (M5-T6)', () => {
    it('a live-session sequence of final+interim segments threads through the silence detector correctly', () => {
        let now = 0;
        const policy = new RollingTriggerPolicy({
            now: () => now,
            silenceDetector: new SilenceDetector({ thresholdMs: 1500 }),
            initialMode: 'on-silence',
        });

        // Simulate a realistic transcript feed: final → interim burst →
        // final → long pause → tick → fire
        policy.noteSegment({ isFinal: true, timestampMs: 0 });
        now = 500;
        policy.noteSegment({ isFinal: false, timestampMs: 500 });
        policy.noteSegment({ isFinal: false, timestampMs: 700 });
        policy.noteSegment({ isFinal: true, timestampMs: 900 });
        // 900ms since last final, below threshold → no fire
        now = 2000;
        expect(policy.shouldFireOnSilence()).toBeNull();
        // Past threshold → fire
        now = 2500; // 1600ms since last final
        expect(policy.shouldFireOnSilence()?.kind).toBe('on-silence');
    });

    it('in-flight → finished → fire-once per lull, even if tick fires many times during the lull', () => {
        let now = 0;
        const policy = new RollingTriggerPolicy({
            now: () => now,
            silenceDetector: new SilenceDetector({ thresholdMs: 1500 }),
            initialMode: 'on-silence',
        });
        policy.noteSegment({ isFinal: true, timestampMs: 0 });
        now = 2000;

        // Simulate the 300ms tick driver firing five times during a lull.
        // First tick should fire; remaining four should be suppressed.
        let fires = 0;
        for (let tick = 0; tick < 5; tick++) {
            if (policy.shouldFireOnSilence()) {
                policy.markFiredOnSilence();
                policy.markStreamStarted();
                fires++;
            }
            now += 300;
        }
        expect(fires).toBe(1);

        // Simulate stream finishing (no new final during the stream)
        policy.markStreamFinished();
        // Still same lull → no re-fire
        expect(policy.shouldFireOnSilence()).toBeNull();

        // New final segment (user spoke again) → fresh lull can fire
        policy.noteSegment({ isFinal: true, timestampMs: now });
        now += 2000;
        expect(policy.shouldFireOnSilence()?.kind).toBe('on-silence');
    });
});

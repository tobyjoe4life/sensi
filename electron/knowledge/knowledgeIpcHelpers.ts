/**
 * sensi M4-T8 — Knowledge IPC helper functions.
 *
 * These are the pure, DI-friendly handler bodies for the eight knowledge
 * IPC channels. The real ipcHandlers.ts registrations are thin
 * `safeHandle` wrappers that call into these functions, so unit tests
 * can exercise the full validation + delegation + error translation
 * logic without spinning up ipcMain.
 *
 * Every handler follows one contract:
 *   - Validate input (throw `Invalid input` with a user-safe message)
 *   - Delegate to the orchestrator
 *   - Catch typed errors → translate to the KnowledgeIpcResult union
 *   - Catch unknown errors → log internally, return a generic safe response
 *
 * The return type is a discriminated union:
 *   `{ success: true, ...data }` on success, matching the existing
 *   ipcHandlers.ts convention (see set-deepgram-api-key at line 1581,
 *   set-gemini-api-key, etc.)
 *   `{ success: false, error: string, errorType: KnowledgeIpcErrorType }`
 *   on failure, with a machine-readable `errorType` for the M4-T9 UI.
 *
 * Trust boundary notes:
 *   - Error messages are user-safe: no stack traces, no API keys, no
 *     absolute file paths (we scrub the path in ingest errors).
 *   - The preview handler enforces a hard max char cap so renderer
 *     cannot request the full text of a 1 MB document.
 *   - Filepaths from renderer are passed directly to the orchestrator,
 *     which reads files in main via `fs.promises.readFile`. Renderer
 *     never holds raw bytes. See SECURITY.md updated B3/B6 notes.
 *
 * See DECISIONS.md D021 for the IPC result shape, preview bounds, and
 * error translation policy rationale.
 */

import type {
    KnowledgeDocument,
    RetrievedChunk,
} from './KnowledgeStore';
import type {
    KnowledgeOrchestrator,
    IngestResult,
    QueryKnowledgeInput,
} from './KnowledgeOrchestrator';
import {
    KnowledgeIngestError,
    KnowledgeQueryError,
    KnowledgeEmbeddingModelMismatchError,
} from './KnowledgeOrchestrator';
import {
    KnowledgeDimensionError,
    KnowledgeNotFoundError,
    KnowledgeStoreInvariantError,
} from './KnowledgeStore';
import {
    KnowledgeEmbeddingProviderUnavailableError,
    KnowledgeEmbeddingRequestError,
    KnowledgeEmbeddingDimensionError,
} from './EmbeddingAdapter';
import { buildKnowledgeContextBlock } from './buildKnowledgeContext';
import {
    exportKnowledgeToFile,
    importKnowledgeFromFile,
    KnowledgeExportError,
    KnowledgeImportError,
    KnowledgeIncompatibleFormatError,
    type ExportReadableStore,
    type TransferStore,
} from './knowledgeTransfer';

// ═════════════════════════════════════════════════════════════════════════
// Public result shapes (exported for preload typings + renderer types)
// ═════════════════════════════════════════════════════════════════════════

/**
 * Machine-readable error category. Renderer UI can `switch` on this to
 * show tailored error messages (e.g. "Start Ollama" for `provider_unavailable`,
 * "Re-ingest these docs" for `model_mismatch`, etc.) without parsing the
 * free-form `error` string.
 */
export type KnowledgeIpcErrorType =
    | 'invalid_input'
    | 'ingest_failed'
    | 'query_failed'
    | 'model_mismatch'
    | 'provider_unavailable'
    | 'not_found'
    | 'dimension_mismatch'
    | 'export_failed'
    | 'import_failed'
    | 'incompatible_format'
    | 'internal';

export interface KnowledgeIpcFailure {
    success: false;
    error: string;
    errorType: KnowledgeIpcErrorType;
}

// Per-handler result types. Written as explicit discriminated unions
// (not via a generic `KnowledgeIpcResult<T>` helper) because TypeScript
// narrows plain object-literal unions more reliably than unions built
// from `{success: true} & T` intersections when callers use
// `if (!result.success)` narrowing in test code.
export type IngestDocumentResult =
    | {
          success: true;
          documentId: string;
          chunkCount: number;
          embeddingModel: string;
          embeddingProvider: 'ollama' | 'gemini';
      }
    | KnowledgeIpcFailure;

export type ListDocumentsResult =
    | { success: true; documents: KnowledgeDocument[] }
    | KnowledgeIpcFailure;

export type DeleteDocumentResult =
    | { success: true }
    | KnowledgeIpcFailure;

export type PinDocumentResult =
    | { success: true; pinnedAt: string | null }
    | KnowledgeIpcFailure;

export type ListPinnedResult =
    | { success: true; documents: KnowledgeDocument[] }
    | KnowledgeIpcFailure;

export type QueryKnowledgeResult =
    | { success: true; hits: RetrievedChunk[] }
    | KnowledgeIpcFailure;

export type PreviewDocumentResult =
    | { success: true; id: string; text: string; truncated: boolean }
    | KnowledgeIpcFailure;

// M4-T10 — Export/import result shapes.
// Both operations are initiated from the renderer with a filePath. The
// main process validates, does the IO, and returns typed counts. No
// `cancelled` discriminator — renderer is responsible for opening its
// own save/open dialog (reusing existing main-process dialog IPC where
// available) and only calling the handlers once it has a concrete path.
export type ExportKnowledgeResult =
    | {
          success: true;
          filePath: string;
          documentCount: number;
          chunkCount: number;
      }
    | KnowledgeIpcFailure;

export type ImportKnowledgeResult =
    | {
          success: true;
          filePath: string;
          replaced: number;
          imported: number;
          chunkCount: number;
          backupPath: string | null;
      }
    | KnowledgeIpcFailure;

// ═════════════════════════════════════════════════════════════════════════
// Constants — preview bounds (D021)
// ═════════════════════════════════════════════════════════════════════════
export const PREVIEW_DEFAULT_MAX_CHARS = 4000;
export const PREVIEW_HARD_MAX_CHARS = 12000;

// Bounded query params
const QUERY_TOPK_HARD_MAX = 50;

// ═════════════════════════════════════════════════════════════════════════
// Orchestrator shape for DI — structural subset used by the helpers
// ═════════════════════════════════════════════════════════════════════════

/**
 * Structural interface matching the subset of KnowledgeOrchestrator
 * these helpers actually call. Tests can pass a stub matching this
 * shape; production passes a real orchestrator instance via
 * `DatabaseManager.getKnowledgeOrchestrator()`.
 */
export interface KnowledgeOrchestratorForIpc {
    ingestDocument(filePath: string): Promise<IngestResult>;
    listDocuments(): KnowledgeDocument[];
    deleteDocument(id: string): void;
    pinDocument(id: string): { pinnedAt: string | null };
    unpinDocument(id: string): { pinnedAt: string | null };
    listPinned(): KnowledgeDocument[];
    queryKnowledge(input: QueryKnowledgeInput): Promise<RetrievedChunk[]>;
    getDocumentText(id: string): string;
    // M4-T10 — transfer store accessor. Returns the same TransferStore
    // that `knowledgeTransfer.exportKnowledgeToFile` /
    // `importKnowledgeFromFile` consume. Production implementation
    // returns the live `KnowledgeStore` instance; tests can return a
    // DI stub matching the `TransferStore` shape.
    getTransferStore(): TransferStore;
    // M4-T10 — user data directory for writing pre-import backups.
    // `null` skips the backup write entirely (used by tests).
    getBackupDir(): string | null;
    // sensi M7 / KNOWLEDGE-02 — optional per-meeting attachment API.
    // Real orchestrator implements; test stubs can omit. IPC handlers
    // guard on presence before calling.
    attachDocumentToEvent?(docId: string, eventId: string): void;
    detachDocumentFromEvent?(docId: string, eventId: string): void;
    listDocumentsForEvent?(eventId: string): KnowledgeDocument[];
    listEventsForDocument?(docId: string): string[];
    suggestDocumentsForEvent?(
        eventId: string,
        searchText: string,
        topK?: number
    ): Promise<Array<{ document: KnowledgeDocument; distance: number }>>;
}

// ═════════════════════════════════════════════════════════════════════════
// Validation helpers
// ═════════════════════════════════════════════════════════════════════════

function validateNonEmptyString(value: unknown, fieldName: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new InvalidInputError(`${fieldName} must be a non-empty string`);
    }
    return value;
}

function validatePositiveInt(
    value: unknown,
    fieldName: string,
    options: { max: number; default?: number }
): number {
    // Allow undefined / null → fall back to default if provided
    if ((value === undefined || value === null) && options.default !== undefined) {
        return options.default;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
        throw new InvalidInputError(
            `${fieldName} must be a positive integer`
        );
    }
    const floored = Math.floor(value);
    return Math.min(floored, options.max);
}

function validateStringArray(value: unknown, fieldName: string): string[] | undefined {
    if (value === undefined || value === null) return undefined;
    if (!Array.isArray(value)) {
        throw new InvalidInputError(`${fieldName} must be an array of strings`);
    }
    for (const item of value) {
        if (typeof item !== 'string' || item.length === 0) {
            throw new InvalidInputError(`${fieldName} must contain only non-empty strings`);
        }
    }
    return value as string[];
}

/**
 * Private error thrown by validators and caught at the top of each
 * helper to produce a clean `invalid_input` IPC failure. Never escapes
 * the helper boundary.
 */
class InvalidInputError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'InvalidInputError';
    }
}

// ═════════════════════════════════════════════════════════════════════════
// Error translation — convert downstream typed errors into IPC responses
// ═════════════════════════════════════════════════════════════════════════

/**
 * User-facing message policy: scrub absolute paths, cap length at 200
 * chars, strip stack traces. Never leak raw cause strings that might
 * contain file system details or provider credentials.
 */
function safeMessage(e: unknown, fallback: string): string {
    if (!(e instanceof Error)) return fallback;
    const raw = e.message || fallback;
    // Drop anything that looks like a Windows/Unix absolute path
    const scrubbed = raw
        .replace(/[A-Za-z]:\\[^\s]+/g, '<path>')
        .replace(/\/[A-Za-z][^\s]+/g, '<path>');
    return scrubbed.slice(0, 200);
}

function translateError(e: unknown, channel: string): KnowledgeIpcFailure {
    // Our own validators fire first
    if (e instanceof InvalidInputError) {
        return { success: false, errorType: 'invalid_input', error: e.message };
    }

    // Orchestrator-level errors
    if (e instanceof KnowledgeIngestError) {
        return {
            success: false,
            errorType: 'ingest_failed',
            error: 'Failed to ingest document: ' + safeMessage(e, 'unknown error'),
        };
    }
    if (e instanceof KnowledgeQueryError) {
        return {
            success: false,
            errorType: 'query_failed',
            error: 'Invalid query: ' + safeMessage(e, 'unknown error'),
        };
    }
    if (e instanceof KnowledgeEmbeddingModelMismatchError) {
        return {
            success: false,
            errorType: 'model_mismatch',
            error:
                'Stored documents are embedded with a different model than the one active right now. ' +
                'Start the original embedding provider (Ollama for nomic-embed-text, or configure a Gemini API key for gemini-embedding-001), ' +
                'or re-ingest these documents with your current provider.',
        };
    }

    // Store-level errors
    if (e instanceof KnowledgeNotFoundError) {
        return {
            success: false,
            errorType: 'not_found',
            error: 'Document not found.',
        };
    }
    if (e instanceof KnowledgeDimensionError) {
        return {
            success: false,
            errorType: 'dimension_mismatch',
            error:
                'Embedding dimension mismatch. This document needs to be re-ingested with a compatible provider.',
        };
    }
    if (e instanceof KnowledgeStoreInvariantError) {
        return {
            success: false,
            errorType: 'internal',
            error: 'Knowledge store invariant violation. Check the main-process logs.',
        };
    }

    // Embedding-adapter-level errors
    if (e instanceof KnowledgeEmbeddingProviderUnavailableError) {
        return {
            success: false,
            errorType: 'provider_unavailable',
            error:
                'No embedding provider available. Start Ollama (`ollama serve`) ' +
                'or configure a Gemini API key in Settings → AI Providers.',
        };
    }
    if (e instanceof KnowledgeEmbeddingRequestError) {
        return {
            success: false,
            errorType: 'query_failed',
            error: 'Embedding request failed: ' + safeMessage(e, 'unknown error'),
        };
    }
    if (e instanceof KnowledgeEmbeddingDimensionError) {
        return {
            success: false,
            errorType: 'dimension_mismatch',
            error: 'Embedding provider returned an unexpected dimension. ' +
                'This is usually a transient provider bug — retry, or switch providers.',
        };
    }

    // M4-T10 transfer-layer errors
    if (e instanceof KnowledgeIncompatibleFormatError) {
        return {
            success: false,
            errorType: 'incompatible_format',
            error: 'Knowledge file format is not supported: ' + safeMessage(e, 'unknown reason'),
        };
    }
    if (e instanceof KnowledgeExportError) {
        return {
            success: false,
            errorType: 'export_failed',
            error: 'Export failed: ' + safeMessage(e, 'unknown reason'),
        };
    }
    if (e instanceof KnowledgeImportError) {
        return {
            success: false,
            errorType: 'import_failed',
            error: 'Import failed: ' + safeMessage(e, 'unknown reason'),
        };
    }

    // Unknown error — log internally, never leak to renderer
    console.error(`[knowledge:${channel}] unknown error:`, e);
    return {
        success: false,
        errorType: 'internal',
        error: 'An internal error occurred. Check the main-process logs for details.',
    };
}

// ═════════════════════════════════════════════════════════════════════════
// Handler implementations
// ═════════════════════════════════════════════════════════════════════════

export async function handleIngestDocument(
    orchestrator: KnowledgeOrchestratorForIpc,
    filePath: unknown
): Promise<IngestDocumentResult> {
    try {
        const validatedPath = validateNonEmptyString(filePath, 'filePath');
        const result = await orchestrator.ingestDocument(validatedPath);
        return { success: true, ...result };
    } catch (e) {
        return translateError(e, 'ingest-document');
    }
}

export function handleListDocuments(
    orchestrator: KnowledgeOrchestratorForIpc
): ListDocumentsResult {
    try {
        const documents = orchestrator.listDocuments();
        return { success: true, documents };
    } catch (e) {
        return translateError(e, 'list-documents');
    }
}

export function handleDeleteDocument(
    orchestrator: KnowledgeOrchestratorForIpc,
    id: unknown
): DeleteDocumentResult {
    try {
        const validatedId = validateNonEmptyString(id, 'id');
        orchestrator.deleteDocument(validatedId);
        return { success: true };
    } catch (e) {
        return translateError(e, 'delete-document');
    }
}

export function handlePinDocument(
    orchestrator: KnowledgeOrchestratorForIpc,
    id: unknown
): PinDocumentResult {
    try {
        const validatedId = validateNonEmptyString(id, 'id');
        const { pinnedAt } = orchestrator.pinDocument(validatedId);
        return { success: true, pinnedAt };
    } catch (e) {
        return translateError(e, 'pin-document');
    }
}

export function handleUnpinDocument(
    orchestrator: KnowledgeOrchestratorForIpc,
    id: unknown
): PinDocumentResult {
    try {
        const validatedId = validateNonEmptyString(id, 'id');
        const { pinnedAt } = orchestrator.unpinDocument(validatedId);
        return { success: true, pinnedAt };
    } catch (e) {
        return translateError(e, 'unpin-document');
    }
}

export function handleListPinned(
    orchestrator: KnowledgeOrchestratorForIpc
): ListPinnedResult {
    try {
        const documents = orchestrator.listPinned();
        return { success: true, documents };
    } catch (e) {
        return translateError(e, 'list-pinned');
    }
}

export async function handleQueryKnowledge(
    orchestrator: KnowledgeOrchestratorForIpc,
    payload: unknown
): Promise<QueryKnowledgeResult> {
    try {
        if (typeof payload !== 'object' || payload === null) {
            throw new InvalidInputError('payload must be an object');
        }
        const p = payload as Record<string, unknown>;

        const query = validateNonEmptyString(p.query, 'query');
        const topK = validatePositiveInt(p.topK, 'topK', {
            max: QUERY_TOPK_HARD_MAX,
        });
        // includePinned is optional boolean
        let includePinned: boolean | undefined = undefined;
        if (p.includePinned !== undefined && p.includePinned !== null) {
            if (typeof p.includePinned !== 'boolean') {
                throw new InvalidInputError('includePinned must be a boolean');
            }
            includePinned = p.includePinned;
        }
        const documentIds = validateStringArray(p.documentIds, 'documentIds');

        const hits = await orchestrator.queryKnowledge({
            query,
            topK,
            includePinned,
            documentIds,
        });
        return { success: true, hits };
    } catch (e) {
        return translateError(e, 'query-knowledge');
    }
}

export function handleGetDocumentPreview(
    orchestrator: KnowledgeOrchestratorForIpc,
    id: unknown,
    maxChars: unknown
): PreviewDocumentResult {
    try {
        const validatedId = validateNonEmptyString(id, 'id');
        // maxChars is optional; default to PREVIEW_DEFAULT_MAX_CHARS,
        // clamp to [1, PREVIEW_HARD_MAX_CHARS]. Non-number / negative /
        // NaN falls back to default rather than throwing.
        let cap: number;
        if (maxChars === undefined || maxChars === null) {
            cap = PREVIEW_DEFAULT_MAX_CHARS;
        } else if (typeof maxChars === 'number' && Number.isFinite(maxChars) && maxChars >= 1) {
            cap = Math.min(Math.floor(maxChars), PREVIEW_HARD_MAX_CHARS);
        } else {
            // Silently coerce invalid inputs to default rather than
            // rejecting — preview is a best-effort UX, not a
            // security-critical channel. The hard max below is the
            // actual safety rail.
            cap = PREVIEW_DEFAULT_MAX_CHARS;
        }

        // Final safety rail: cap can never exceed PREVIEW_HARD_MAX_CHARS
        cap = Math.min(cap, PREVIEW_HARD_MAX_CHARS);

        const fullText = orchestrator.getDocumentText(validatedId);
        const truncated = fullText.length > cap;
        const text = truncated ? fullText.slice(0, cap) : fullText;
        return { success: true, id: validatedId, text, truncated };
    } catch (e) {
        return translateError(e, 'get-document-preview');
    }
}

// ─────────────────────────────────────────────────────────────────────
// M4-T10 — Export / import handlers
//
// Both handlers take an already-picked filePath from the renderer.
// The renderer opens its own save/open dialog via existing
// `selectKnowledgeExportPath` / `selectKnowledgeImportPath` helpers
// (or whichever dialog IPC it reuses) before calling these. We keep
// the transfer module decoupled from Electron's `dialog` API so the
// logic stays pure and testable.
// ─────────────────────────────────────────────────────────────────────

export async function handleExportKnowledge(
    orchestrator: KnowledgeOrchestratorForIpc,
    filePath: unknown
): Promise<ExportKnowledgeResult> {
    try {
        const validatedPath = validateNonEmptyString(filePath, 'filePath');
        const store: ExportReadableStore = orchestrator.getTransferStore();
        const result = await exportKnowledgeToFile(store, validatedPath);
        return {
            success: true,
            filePath: result.filePath,
            documentCount: result.documentCount,
            chunkCount: result.chunkCount,
        };
    } catch (e) {
        return translateError(e, 'export-knowledge');
    }
}

export async function handleImportKnowledge(
    orchestrator: KnowledgeOrchestratorForIpc,
    filePath: unknown
): Promise<ImportKnowledgeResult> {
    try {
        const validatedPath = validateNonEmptyString(filePath, 'filePath');
        const store = orchestrator.getTransferStore();
        const backupDir = orchestrator.getBackupDir();
        const result = await importKnowledgeFromFile(store, validatedPath, backupDir);
        return {
            success: true,
            filePath: result.filePath,
            replaced: result.replaced,
            imported: result.imported,
            chunkCount: result.chunkCount,
            backupPath: result.backupPath,
        };
    } catch (e) {
        return translateError(e, 'import-knowledge');
    }
}

// ═════════════════════════════════════════════════════════════════════════
// Production closure factory — used by IntelligenceEngine to wire
// WhatToAnswerLLM's knowledge hook.
//
// Returns a closure matching KnowledgeContextFn from WhatToAnswerLLM.ts:
// `(query: string) => Promise<string>`. Production callers get the
// orchestrator via DatabaseManager.getKnowledgeOrchestrator() and pass
// it through this factory.
//
// If the orchestrator resolver throws (e.g. DatabaseManager not ready,
// sqlite-vec load failure), the returned closure is `null` and the
// live-assist path falls back to M4-T7 pre-hook behavior — no crash, no
// degraded flow. See D021 for the defensive-wiring rationale.
// ═════════════════════════════════════════════════════════════════════════
export function makeKnowledgeContextClosure(
    getOrchestrator: () => KnowledgeOrchestratorForIpc | null
): ((query: string, eventId?: string) => Promise<string>) | null {
    // Resolve once at construction time to catch configuration errors
    // early. If resolution fails, return null so callers can detect
    // "no knowledge hook" at wire-up time rather than mid-stream.
    let orchestrator: KnowledgeOrchestratorForIpc | null;
    try {
        orchestrator = getOrchestrator();
    } catch (e) {
        console.warn(
            '[knowledge] makeKnowledgeContextClosure: getOrchestrator threw, knowledge hook disabled:',
            e instanceof Error ? e.message : String(e)
        );
        return null;
    }
    if (!orchestrator) return null;

    return async (query: string, eventId?: string): Promise<string> => {
        return await buildKnowledgeContextBlock({
            orchestrator: orchestrator!,
            query,
            eventId,
        });
    };
}

// Re-export the IngestResult type for convenience so callers don't have
// to import from KnowledgeOrchestrator directly.
export type { IngestResult, KnowledgeDocument, RetrievedChunk };
// Also re-export KnowledgeOrchestrator for DatabaseManager type-only imports
export type { KnowledgeOrchestrator };

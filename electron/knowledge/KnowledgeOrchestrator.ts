/**
 * sensi M4-T6 — KnowledgeOrchestrator: compose parsers → chunker →
 * embedder → store behind a narrow ingest/query/admin API.
 *
 * This is the main-process public API for the knowledge base. It does
 * NOT define new storage, new egress paths, or new trust-boundary
 * crossings — it's a thin coordinator over the four M4-T2..T5 primitives.
 *
 * Trust boundary: main-process only. Renderer interacts with the
 * knowledge base via M4-T8 IPC handlers (future task), not directly.
 * File reads happen here via `fs.promises.readFile` — standard
 * main-process pattern, same as ScreenshotHelper and DatabaseManager.
 * Renderer never supplies file bytes; it supplies paths only (M4-T8
 * will enforce this at the IPC boundary).
 *
 * DI-friendly constructor: production passes a real KnowledgeStore +
 * EmbeddingAdapter and the default file reader / parser dispatcher.
 * Tests pass stubs. No `vi.mock`, no module-level mutation.
 *
 * Pipeline flow for ingestDocument(filePath):
 *   1. Read file bytes via readFile()
 *   2. Derive MIME from extension; unsupported types throw
 *   3. Parse bytes via parseBuffer() (dispatches by MIME to M4-T2 parsers)
 *   4. splitIntoChunks() (M4-T3)
 *   5. resolveProvider() on the adapter (M4-T5) — gives us the model
 *      metadata without consuming an embed quota, even for zero-chunk docs
 *   6. insertDocument() with resolved model metadata (M4-T4)
 *   7. If zero chunks: return early with chunkCount: 0
 *   8. Else embed(chunks) via adapter, then upsertChunks(id, chunks, embeddings)
 *   9. On any failure after insertDocument → deleteDocument(id) cleanup,
 *      re-throw original error (atomicity from caller's perspective)
 *
 * Query flow for queryKnowledge({query, topK, includePinned?, documentIds?}):
 *   1. Validate non-empty query + positive integer topK
 *   2. Embed query via adapter (forces provider resolution via embed)
 *   3. List all docs; compute candidate set = docs matching active model
 *      (intersected with documentIds filter if supplied)
 *   4. If zero candidates AND there are stored docs → throw
 *      KnowledgeEmbeddingModelMismatchError (see D019b)
 *   5. Call store.searchByEmbedding with overfetch when mixed-model DB
 *   6. Filter hits to candidate set
 *   7. If includePinned, stable-sort pinned docs ahead of non-pinned
 *   8. Slice to topK, return
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { splitIntoChunks } from './chunker';
import {
    extractTextFromDocx,
    extractTextFromMarkdown,
    extractTextFromPdf,
    extractTextFromPlain,
} from './parsers';
import type {
    KnowledgeDocument,
    KnowledgeDocumentMeta,
    RetrievedChunk,
    EmbeddingVector,
} from './KnowledgeStore';
import type { EmbeddingConfig } from './EmbeddingAdapter';
// Runtime imports needed for instanceof checks in the ingest catch
// block (KNOWLEDGE-FIX-01). `KnowledgeEmbeddingProviderUnavailableError`
// is NOT imported because we want that class to pass through unchanged
// — instanceof checking it here would be dead code.
import {
    KnowledgeEmbeddingRequestError,
    KnowledgeEmbeddingDimensionError,
} from './EmbeddingAdapter';
import type {
    ExportedChunk,
    ExportedDocument,
    TransferStore,
} from './knowledgeTransfer';

// ═════════════════════════════════════════════════════════════════════════
// Typed errors
// ═════════════════════════════════════════════════════════════════════════

/**
 * Thrown when ingestion fails for reasons other than downstream typed
 * errors from the store or adapter — e.g. file read failure, unsupported
 * MIME type, parse failure. Wraps the underlying cause when possible so
 * callers can still inspect the root error via `e.cause`.
 */
export class KnowledgeIngestError extends Error {
    constructor(message: string, options?: { cause?: unknown }) {
        super(message, options);
        this.name = 'KnowledgeIngestError';
    }
}

/**
 * Thrown when queryKnowledge receives invalid input (empty query,
 * non-positive topK, etc). Downstream typed errors from the adapter or
 * store propagate as-is, not wrapped in KnowledgeQueryError.
 */
export class KnowledgeQueryError extends Error {
    constructor(message: string, options?: { cause?: unknown }) {
        super(message, options);
        this.name = 'KnowledgeQueryError';
    }
}

/**
 * Thrown when the query-time embedding model does not match any stored
 * document's embedding_model (i.e. every stored doc is in a different
 * embedding space). Surfaces the mismatch loudly so the user can fix
 * their provider configuration rather than see "no results" silently.
 * See DECISIONS.md D019b for the filter-vs-throw policy.
 */
export class KnowledgeEmbeddingModelMismatchError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'KnowledgeEmbeddingModelMismatchError';
    }
}

// ═════════════════════════════════════════════════════════════════════════
// Structural interfaces for DI
// ═════════════════════════════════════════════════════════════════════════

/**
 * Structural interface matching the subset of KnowledgeStore that the
 * orchestrator actually calls. Tests pass a stub object matching this
 * shape; production passes a real KnowledgeStore instance (structural
 * subtype — no `implements` clause needed).
 */
export interface KnowledgeStoreLike {
    insertDocument(meta: KnowledgeDocumentMeta): string;
    upsertChunks(
        docId: string,
        chunks: readonly string[],
        embeddings: readonly EmbeddingVector[]
    ): void;
    listDocuments(): KnowledgeDocument[];
    deleteDocument(id: string): void;
    searchByEmbedding(queryVec: EmbeddingVector, topK: number): RetrievedChunk[];
    getDocumentText(id: string): string;
    setPinned(id: string, pinned: boolean): { pinnedAt: string | null };
    listPinned(): KnowledgeDocument[];
    // M4-T10 — transfer support. Real store implements these directly;
    // existing orchestrator tests that don't exercise transfer can
    // declare them as no-op stubs or leave them off via intersection
    // typing (the test helper `makeStore()` in providers.test.ts sets
    // defaults for every required slot).
    getDocumentChunksWithEmbeddings(docId: string): ExportedChunk[];
    replaceAllFromArtifact(
        docs: readonly ExportedDocument[]
    ): { replaced: number; imported: number };
    // sensi M7 / KNOWLEDGE-02 — per-meeting attachment. Optional in the
    // structural type so existing orchestrator tests keep compiling;
    // queryKnowledge's event-preference path guards on presence.
    attachDocumentToEvent?(docId: string, eventId: string): void;
    detachDocumentFromEvent?(docId: string, eventId: string): void;
    listDocumentsForEvent?(eventId: string): KnowledgeDocument[];
    listEventsForDocument?(docId: string): string[];
    searchByEmbeddingWithDocumentFilter?(
        queryVec: EmbeddingVector,
        topK: number,
        allowedDocIds: readonly string[]
    ): RetrievedChunk[];
}

/**
 * Structural interface matching the subset of EmbeddingAdapter that the
 * orchestrator actually calls. `resolveProvider` is the M4-T6 extension
 * to T5 — see DECISIONS.md D019a for why it's needed.
 */
export interface EmbeddingAdapterLike {
    embed(strings: readonly string[]): Promise<Float32Array[]>;
    getActiveEmbeddingConfig(): EmbeddingConfig;
    resolveProvider(): Promise<EmbeddingConfig>;
}

// ═════════════════════════════════════════════════════════════════════════
// Constructor deps and return shapes
// ═════════════════════════════════════════════════════════════════════════

export interface KnowledgeOrchestratorDeps {
    store: KnowledgeStoreLike;
    adapter: EmbeddingAdapterLike;
    /** Override for tests. Defaults to `fs.promises.readFile`. */
    readFile?: (filePath: string) => Promise<Buffer>;
    /** Override for tests. Defaults to MIME-dispatching to the M4-T2 parsers. */
    parseBuffer?: (buffer: Buffer, mime: string) => Promise<string>;
    /**
     * M4-T10 — directory for pre-import backup files. Null or omitted
     * disables backup (tests use null; production passes app userData).
     */
    backupDir?: string | null;
}

export interface IngestResult {
    documentId: string;
    chunkCount: number;
    embeddingModel: string;
    embeddingProvider: 'ollama' | 'gemini' | 'openai';
}

export interface QueryKnowledgeInput {
    query: string;
    topK: number;
    /** If true, pinned documents are sorted ahead of non-pinned within topK. */
    includePinned?: boolean;
    /** If supplied, restrict the search to these document ids only. */
    documentIds?: readonly string[];
    /**
     * sensi M7 / KNOWLEDGE-02: when present, queryKnowledge first searches
     * documents attached to this event id. If the event-scoped search
     * returns enough hits, the fallback global search is skipped. This
     * preserves latency when the user has curated a handful of docs for a
     * specific meeting.
     */
    eventId?: string;
}

// ═════════════════════════════════════════════════════════════════════════
// KnowledgeOrchestrator
// ═════════════════════════════════════════════════════════════════════════

export class KnowledgeOrchestrator {
    private readonly store: KnowledgeStoreLike;
    private readonly adapter: EmbeddingAdapterLike;
    private readonly readFile: (filePath: string) => Promise<Buffer>;
    private readonly parseBuffer: (buffer: Buffer, mime: string) => Promise<string>;
    private readonly backupDir: string | null;

    constructor(deps: KnowledgeOrchestratorDeps) {
        this.store = deps.store;
        this.adapter = deps.adapter;
        this.readFile = deps.readFile ?? ((p) => fs.promises.readFile(p));
        this.parseBuffer = deps.parseBuffer ?? defaultParseBuffer;
        this.backupDir = deps.backupDir ?? null;
    }

    // ─────────────────────────────────────────────────────────────────
    // Ingestion
    // ─────────────────────────────────────────────────────────────────

    async ingestDocument(filePath: string): Promise<IngestResult> {
        // TRIAGE-INGEST-01A: additive stage logging. Every line is a
        // `[ingest]` prefixed console call so the main-process log
        // (forwarded to sensi_debug.log by electron/preload.ts) can be
        // grep'd for the full pipeline trace without changing any
        // behavior. Absolute paths are scrubbed via `scrubIngestPath`
        // so the log policy stays consistent with D021c.
        console.log(`[ingest] enter path=${scrubIngestPath(filePath)}`);

        // Step 1: read file bytes. Wrap raw fs errors with a typed error
        // carrying the path + cause so callers can surface a useful
        // message to the user.
        console.log('[ingest] readFile start');
        let buffer: Buffer;
        try {
            buffer = await this.readFile(filePath);
        } catch (e) {
            logCaught('readFile', e);
            throw new KnowledgeIngestError(
                `ingestDocument: failed to read file at ${filePath}`,
                { cause: e }
            );
        }
        console.log(`[ingest] readFile ok bytes=${buffer.byteLength}`);

        // Step 2: derive metadata
        const name = path.basename(filePath);
        const mime = resolveMimeFromPath(filePath);
        if (!mime) {
            // No `[ingest] parse start` line will appear after this —
            // the absence of `parse start` in the log tail is the
            // "unsupported mime" signal.
            const unsupportedErr = new KnowledgeIngestError(
                `ingestDocument: unsupported file type for ${filePath} — ` +
                    `supported extensions are .pdf, .docx, .md/.markdown/.mdown, .txt`
            );
            logCaught('mime', unsupportedErr);
            throw unsupportedErr;
        }
        const bytes = buffer.byteLength;

        // Step 3: parse. Parsers throw on malformed input; wrap with path context.
        console.log(`[ingest] parse start mime=${mime}`);
        let text: string;
        try {
            text = await this.parseBuffer(buffer, mime);
        } catch (e) {
            logCaught('parseBuffer', e);
            throw new KnowledgeIngestError(
                `ingestDocument: failed to parse ${mime} file ${filePath}`,
                { cause: e }
            );
        }
        console.log(`[ingest] parse ok textLength=${text.length}`);

        // Step 4: chunk
        console.log('[ingest] chunk start');
        const chunks = splitIntoChunks(text);
        console.log(`[ingest] chunk ok chunkCount=${chunks.length}`);

        // Step 5: resolve the embedding provider BEFORE insertDocument so
        // we can stamp kb_documents.embedding_model correctly even for
        // zero-chunk documents. resolveProvider is a pure probe — no
        // embed quota consumed. See D019a.
        console.log('[ingest] resolveProvider start');
        let config: EmbeddingConfig;
        try {
            config = await this.adapter.resolveProvider();
        } catch (e) {
            logCaught('resolveProvider', e);
            // Pass-through: KnowledgeEmbeddingProviderUnavailableError
            // (and anything else from the adapter here) keeps its
            // typed class so the IPC layer maps it to the correct
            // user-facing copy. No wrapping, no cleanup needed — no
            // DB row was written.
            console.error(
                `[ingest] passed-through error.name=${(e instanceof Error && e.name) || 'Unknown'}`
            );
            throw e;
        }
        console.log(
            `[ingest] resolveProvider ok provider=${config.provider} model=${config.model} dim=${config.dimension}`
        );

        // Step 6: insertDocument. Any error here is a T4 contract
        // violation (likely KnowledgeDimensionError if we passed a
        // non-768 config) — let it propagate; nothing is written yet
        // anyway.
        console.log('[ingest] insertDocument start');
        let documentId: string;
        try {
            documentId = this.store.insertDocument({
                name,
                mime,
                bytes,
                embeddingModel: config.model,
                embeddingDim: config.dimension,
            });
        } catch (e) {
            logCaught('insertDocument', e);
            console.error(
                `[ingest] passed-through error.name=${(e instanceof Error && e.name) || 'Unknown'}`
            );
            throw e;
        }
        console.log(`[ingest] insertDocument ok id=${documentId}`);

        // Step 7: zero-chunk fast path. Metadata row is persisted; no
        // embed call, no upsertChunks call. Caller sees chunkCount: 0.
        if (chunks.length === 0) {
            console.log(
                `[ingest] done id=${documentId} provider=${config.provider} model=${config.model} chunkCount=0`
            );
            return {
                documentId,
                chunkCount: 0,
                embeddingModel: config.model,
                embeddingProvider: config.provider,
            };
        }

        // Step 8: embed + upsert, with atomicity cleanup on failure.
        // Any error between insertDocument and successful upsertChunks
        // leaves the caller looking at a half-ingested state — delete
        // the doc row so the caller sees a clean failure.
        try {
            console.log(`[ingest] embed start chunkCount=${chunks.length}`);
            const embeddings = await this.adapter.embed(chunks);
            console.log(`[ingest] embed ok vectorCount=${embeddings.length}`);

            console.log(`[ingest] upsertChunks start id=${documentId}`);
            this.store.upsertChunks(documentId, chunks, embeddings);
            console.log(`[ingest] upsertChunks ok id=${documentId}`);

            // Defensive: verify the adapter's post-embed config matches
            // the pre-insert resolveProvider config. In theory these
            // always match (resolveProvider and embed use the same
            // selection logic) but a race (e.g. Ollama came up mid-call)
            // could diverge. Fail loudly rather than silently stamp a
            // stale model into kb_documents.
            const postConfig = this.adapter.getActiveEmbeddingConfig();
            if (postConfig.model !== config.model) {
                throw new KnowledgeIngestError(
                    `ingestDocument: provider changed mid-ingest (resolved ${config.model}, embed used ${postConfig.model}). Rolling back.`
                );
            }

            console.log(
                `[ingest] done id=${documentId} provider=${postConfig.provider} model=${postConfig.model} chunkCount=${chunks.length}`
            );
            return {
                documentId,
                chunkCount: chunks.length,
                embeddingModel: postConfig.model,
                embeddingProvider: postConfig.provider,
            };
        } catch (e) {
            logCaught('embed/upsertChunks', e);

            // Atomicity cleanup. Best-effort — don't mask the original
            // error if delete itself fails.
            console.error(`[ingest] cleanup start id=${documentId}`);
            try {
                this.store.deleteDocument(documentId);
                console.error(`[ingest] cleanup ok id=${documentId}`);
            } catch (cleanupErr) {
                /* original error wins */
                console.error(
                    `[ingest] cleanup FAILED id=${documentId} error.name=${
                        (cleanupErr instanceof Error && cleanupErr.name) || 'Unknown'
                    }`
                );
            }

            // KNOWLEDGE-FIX-01: generic embedding-request failures
            // (KnowledgeEmbeddingRequestError) and bad-dimension
            // responses (KnowledgeEmbeddingDimensionError) happened
            // DURING an ingest, not a query. Wrap them as
            // KnowledgeIngestError so `translateError` in
            // knowledgeIpcHelpers.ts maps them to `ingest_failed`
            // instead of the misleading `query_failed` bucket. The
            // underlying error is preserved via `cause` for main-
            // process logging.
            //
            // KnowledgeEmbeddingProviderUnavailableError is deliberately
            // passed through unchanged so the `provider_unavailable`
            // IPC copy ("Start Ollama or add a Gemini/OpenAI API key") still
            // reaches the user. The same rule applies to
            // KnowledgeEmbeddingModelMismatchError (raced provider
            // swap — see the pre-throw check above) and to
            // KnowledgeDimensionError / KnowledgeStoreInvariantError
            // from the store layer, which all have their own typed
            // IPC translations.
            if (
                e instanceof KnowledgeEmbeddingRequestError ||
                e instanceof KnowledgeEmbeddingDimensionError
            ) {
                console.error(
                    `[ingest] wrapped as KnowledgeIngestError cause.name=${
                        (e instanceof Error && e.name) || 'Unknown'
                    }`
                );
                throw new KnowledgeIngestError(
                    'ingestDocument: embedding request failed during ingest',
                    { cause: e }
                );
            }
            console.error(
                `[ingest] passed-through error.name=${(e instanceof Error && e.name) || 'Unknown'}`
            );
            throw e;
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // Query
    // ─────────────────────────────────────────────────────────────────

    async queryKnowledge(input: QueryKnowledgeInput): Promise<RetrievedChunk[]> {
        // Validate query string
        const trimmedQuery = input.query.trim();
        if (trimmedQuery.length === 0) {
            throw new KnowledgeQueryError(
                'queryKnowledge: query must be a non-empty, non-whitespace string'
            );
        }

        // Sanitize topK: must be a positive integer. Floor positive floats;
        // reject NaN, non-finite, zero, and negative values.
        if (!Number.isFinite(input.topK) || input.topK < 1) {
            throw new KnowledgeQueryError(
                `queryKnowledge: topK must be a positive integer, got ${String(input.topK)}`
            );
        }
        const k = Math.max(1, Math.floor(input.topK));

        // Embed the query. This call resolves the provider (if not already
        // cached) and returns exactly one vector. EmbeddingAdapter
        // already validates 768-dim and throws on empty input, so if we
        // got past the trim check we won't trip its empty-string guard.
        const [queryVec] = await this.adapter.embed([trimmedQuery]);
        const config = this.adapter.getActiveEmbeddingConfig();

        // Build the candidate set based on (a) model compatibility with
        // the query-time active model and (b) an optional documentIds
        // filter.
        const allDocs = this.store.listDocuments();
        if (allDocs.length === 0) {
            // Empty knowledge base — legitimately empty result, not an error.
            return [];
        }

        const modelCompatible = allDocs.filter((d) => d.embeddingModel === config.model);
        if (modelCompatible.length === 0) {
            // Every stored doc is in a different embedding space than the
            // query. Surface the mismatch loudly (see D019b).
            const storedModels = Array.from(new Set(allDocs.map((d) => d.embeddingModel))).join(
                ', '
            );
            throw new KnowledgeEmbeddingModelMismatchError(
                `queryKnowledge: no documents are embedded with the active model '${config.model}'. ` +
                    `Stored documents use: ${storedModels}. ` +
                    `To query these documents, ensure the matching embedding provider is available at query time ` +
                    `(start Ollama for nomic-embed-text, configure a Gemini API key for gemini-embedding-001, or configure an OpenAI API key for text-embedding-3-small).`
            );
        }

        // Apply documentIds filter on top of model compatibility.
        let candidateIds: Set<string>;
        const hasIdFilter = input.documentIds && input.documentIds.length > 0;
        if (hasIdFilter) {
            const supplied = new Set(input.documentIds);
            const compat = modelCompatible.filter((d) => supplied.has(d.id));
            if (compat.length === 0) {
                throw new KnowledgeEmbeddingModelMismatchError(
                    `queryKnowledge: none of the supplied documentIds are embedded with the active model '${config.model}'`
                );
            }
            candidateIds = new Set(compat.map((d) => d.id));
        } else {
            candidateIds = new Set(modelCompatible.map((d) => d.id));
        }

        // sensi M7 / KNOWLEDGE-02: event-scoped retrieval.
        // If the caller supplied an eventId AND the store supports the
        // attachment API, try searching only the docs attached to that
        // event first. If that yields any hits, we short-circuit —
        // curated event docs always win over generic global matches.
        // If zero hits (or the store lacks the API / no docs attached),
        // fall through to the normal path.
        if (
            input.eventId &&
            typeof this.store.listDocumentsForEvent === 'function' &&
            typeof this.store.searchByEmbeddingWithDocumentFilter === 'function'
        ) {
            try {
                const attached = this.store.listDocumentsForEvent(input.eventId);
                const attachedIds = attached
                    .filter((d) => d.embeddingModel === config.model)
                    .map((d) => d.id)
                    // Intersect with candidateIds so the documentIds filter
                    // (if any) still applies on top of event scoping.
                    .filter((id) => candidateIds.has(id));
                if (attachedIds.length > 0) {
                    const eventHits = this.store.searchByEmbeddingWithDocumentFilter(
                        queryVec,
                        k,
                        attachedIds
                    );
                    if (eventHits.length > 0) {
                        if (input.includePinned) {
                            const pinnedIds = new Set(
                                this.store.listPinned().map((d) => d.id)
                            );
                            eventHits.sort((a, b) => {
                                const aPinRank = pinnedIds.has(a.documentId) ? 0 : 1;
                                const bPinRank = pinnedIds.has(b.documentId) ? 0 : 1;
                                if (aPinRank !== bPinRank) return aPinRank - bPinRank;
                                return a.distance - b.distance;
                            });
                        }
                        return eventHits.slice(0, k);
                    }
                }
            } catch (e) {
                // Event-scoped path is best-effort — fall through to global.
                console.warn(
                    '[KnowledgeOrchestrator] event-scoped retrieval failed, falling back to global:',
                    (e as Error)?.message
                );
            }
        }

        // Decide whether to overfetch. If every stored doc is in the
        // candidate set AND there's no documentIds filter, the raw
        // searchByEmbedding(queryVec, k) call already returns the right
        // set and no post-filter is needed. Otherwise we overfetch by 4x
        // to compensate for post-filter attrition — for M4 scale (<100
        // docs, <1000 chunks) this is cheap.
        const allCompatibleNoFilter =
            candidateIds.size === allDocs.length && !hasIdFilter;
        const searchK = allCompatibleNoFilter ? k : k * 4;
        const hits = this.store.searchByEmbedding(queryVec, searchK);
        const filtered = hits.filter((h) => candidateIds.has(h.documentId));

        // Optional: stable-sort pinned docs ahead of non-pinned within
        // the result window. Distance order is still used as the
        // tiebreaker within each group. This is a MINIMAL
        // interpretation of includePinned — the full M4-T7
        // TemporalContextBuilder hook will handle pinned-doc prompt
        // injection separately.
        if (input.includePinned) {
            const pinnedIds = new Set(this.store.listPinned().map((d) => d.id));
            filtered.sort((a, b) => {
                const aPinRank = pinnedIds.has(a.documentId) ? 0 : 1;
                const bPinRank = pinnedIds.has(b.documentId) ? 0 : 1;
                if (aPinRank !== bPinRank) return aPinRank - bPinRank;
                return a.distance - b.distance;
            });
        }

        return filtered.slice(0, k);
    }

    // ─────────────────────────────────────────────────────────────────
    // Delegation methods (thin pass-through to KnowledgeStore)
    // ─────────────────────────────────────────────────────────────────

    listDocuments(): KnowledgeDocument[] {
        return this.store.listDocuments();
    }

    deleteDocument(id: string): void {
        this.store.deleteDocument(id);
    }

    pinDocument(id: string): { pinnedAt: string | null } {
        return this.store.setPinned(id, true);
    }

    unpinDocument(id: string): { pinnedAt: string | null } {
        return this.store.setPinned(id, false);
    }

    listPinned(): KnowledgeDocument[] {
        return this.store.listPinned();
    }

    getDocumentText(id: string): string {
        return this.store.getDocumentText(id);
    }

    resolveEmbeddingProvider(): Promise<EmbeddingConfig> {
        return this.adapter.resolveProvider();
    }

    // ─────────────────────────────────────────────────────────────────
    // sensi M7 / KNOWLEDGE-02 — per-meeting attachment pass-throughs
    // + auto-suggest. Renderer never holds the store directly, so every
    // attach / detach / list / suggest call flows through here.
    // ─────────────────────────────────────────────────────────────────

    attachDocumentToEvent(docId: string, eventId: string): void {
        if (typeof this.store.attachDocumentToEvent !== 'function') {
            throw new Error(
                'attachDocumentToEvent: knowledge store does not support per-meeting attachments'
            );
        }
        this.store.attachDocumentToEvent(docId, eventId);
    }

    detachDocumentFromEvent(docId: string, eventId: string): void {
        if (typeof this.store.detachDocumentFromEvent !== 'function') {
            throw new Error(
                'detachDocumentFromEvent: knowledge store does not support per-meeting attachments'
            );
        }
        this.store.detachDocumentFromEvent(docId, eventId);
    }

    listDocumentsForEvent(eventId: string): KnowledgeDocument[] {
        if (typeof this.store.listDocumentsForEvent !== 'function') return [];
        return this.store.listDocumentsForEvent(eventId);
    }

    listEventsForDocument(docId: string): string[] {
        if (typeof this.store.listEventsForDocument !== 'function') return [];
        return this.store.listEventsForDocument(docId);
    }

    /**
     * Auto-suggest documents for a calendar event. The caller passes the
     * event id (so we can exclude already-attached docs) plus a search
     * blob (typically `title + description`). We embed the blob and run
     * vector search over the user's compatible docs, returning the top
     * `topK` unattached candidates with cosine distance.
     *
     * Returns `[]` when the KB is empty, when the blob is empty after
     * trimming, or when every compatible doc is already attached.
     */
    async suggestDocumentsForEvent(
        eventId: string,
        searchText: string,
        topK: number = 3
    ): Promise<Array<{ document: KnowledgeDocument; distance: number }>> {
        const trimmed = (searchText ?? '').trim();
        if (trimmed.length === 0) return [];
        const k = Math.max(1, Math.floor(topK));

        const allDocs = this.store.listDocuments();
        if (allDocs.length === 0) return [];

        // Embed the event blob with the active model.
        const config = this.adapter.getActiveEmbeddingConfig();
        const compatible = allDocs.filter((d) => d.embeddingModel === config.model);
        if (compatible.length === 0) return [];

        const [queryVec] = await this.adapter.embed([trimmed]);

        // Exclude docs already attached to this event.
        const attachedIds = new Set(
            this.listDocumentsForEvent(eventId).map((d) => d.id)
        );
        const candidateIds = compatible
            .map((d) => d.id)
            .filter((id) => !attachedIds.has(id));
        if (candidateIds.length === 0) return [];

        let hits: RetrievedChunk[];
        if (typeof this.store.searchByEmbeddingWithDocumentFilter === 'function') {
            hits = this.store.searchByEmbeddingWithDocumentFilter(
                queryVec,
                k * 4, // overfetch to survive per-doc dedup
                candidateIds
            );
        } else {
            const raw = this.store.searchByEmbedding(queryVec, k * 4);
            const allow = new Set(candidateIds);
            hits = raw.filter((r) => allow.has(r.documentId));
        }

        // Dedup to one row per document (best distance wins).
        const byDoc = new Map<string, number>();
        for (const h of hits) {
            const prev = byDoc.get(h.documentId);
            if (prev === undefined || h.distance < prev) {
                byDoc.set(h.documentId, h.distance);
            }
        }
        const byId = new Map(compatible.map((d) => [d.id, d] as const));
        const results: Array<{ document: KnowledgeDocument; distance: number }> = [];
        for (const [docId, distance] of byDoc) {
            const doc = byId.get(docId);
            if (doc) results.push({ document: doc, distance });
        }
        results.sort((a, b) => a.distance - b.distance);
        return results.slice(0, k);
    }

    // ─────────────────────────────────────────────────────────────────
    // M4-T10 — Export/import bridge
    //
    // The store IS the transfer store — it implements both the
    // `ExportReadableStore` and `ImportWritableStore` shapes via the
    // `getDocumentChunksWithEmbeddings` and `replaceAllFromArtifact`
    // methods added in M4-T10. The orchestrator exposes it through a
    // typed accessor so IPC helpers never have to reach into the
    // orchestrator's private `store` field.
    // ─────────────────────────────────────────────────────────────────

    getTransferStore(): TransferStore {
        return {
            listDocuments: () => this.store.listDocuments(),
            getDocumentChunksWithEmbeddings: (docId) =>
                this.store.getDocumentChunksWithEmbeddings(docId),
            replaceAllFromArtifact: (docs) =>
                this.store.replaceAllFromArtifact(docs),
        };
    }

    getBackupDir(): string | null {
        return this.backupDir;
    }
}

// ═════════════════════════════════════════════════════════════════════════
// Helpers (module-private; exported only for potential future reuse)
// ═════════════════════════════════════════════════════════════════════════

/**
 * Resolve a MIME type from a file extension. Extension-based detection
 * is deliberate for M4 — magic-byte sniffing adds complexity without
 * meaningful benefit for a personal-use fork where users knowingly
 * upload their own documents. See DECISIONS.md D019c.
 *
 * Returns `null` for unsupported extensions (caller wraps in
 * KnowledgeIngestError).
 */

// ─────────────────────────────────────────────────────────────────────
// TRIAGE-INGEST-01A — logging helpers (module-private, no exports).
// Kept local to KnowledgeOrchestrator.ts so the task stays one-file.
// ─────────────────────────────────────────────────────────────────────

/**
 * Replace absolute Windows / POSIX paths with `<path>` so log lines
 * don't carry user filesystem layout. Mirrors the scrubber convention
 * used by `knowledgeIpcHelpers.translateError` (D021c) so the log text
 * matches what the renderer would see on an error.
 */
function scrubIngestPath(p: string): string {
    if (typeof p !== 'string' || p.length === 0) return '<path>';
    return p
        .replace(/[A-Za-z]:\\[^\s]+/g, '<path>')
        .replace(/\/[A-Za-z][^\s]+/g, '<path>');
}

/**
 * Log a single `[ingest] CAUGHT` line plus a `[ingest] CAUGHT cause chain`
 * line walking the `cause` chain up to a small depth. Values are the
 * error class name and a scrubbed message — never the full stack, never
 * the URL, never any request/response body. Safe to pipe straight to
 * `sensi_debug.log` via the existing verbose-log patch.
 */
function logCaught(stage: string, e: unknown): void {
    const name = e instanceof Error ? e.name : 'Unknown';
    const rawMsg = e instanceof Error ? e.message : String(e);
    const msg = scrubIngestPath(rawMsg).slice(0, 200);
    console.error(`[ingest] CAUGHT stage=${stage} error.name=${name} error.message=${msg}`);

    // Walk the cause chain up to depth 3. `cause` is a standard
    // ES2022 Error property and is explicitly set by the M4 typed
    // error classes that accept `{ cause }` in their constructor.
    const chain: string[] = [];
    let current: unknown = e;
    for (let depth = 0; depth < 3; depth++) {
        if (!(current instanceof Error)) break;
        const cause = (current as Error & { cause?: unknown }).cause;
        if (cause === undefined) break;
        if (cause instanceof Error) {
            chain.push(`${cause.name}:${scrubIngestPath(cause.message).slice(0, 120)}`);
            current = cause;
        } else {
            chain.push(`Unknown:${String(cause).slice(0, 120)}`);
            break;
        }
    }
    console.error(
        `[ingest] CAUGHT cause chain=${chain.length === 0 ? '<none>' : chain.join(' -> ')}`
    );
}

function resolveMimeFromPath(filePath: string): string | null {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case '.pdf':
            return 'application/pdf';
        case '.docx':
            return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        case '.md':
        case '.mdown':
        case '.markdown':
            return 'text/markdown';
        case '.txt':
            return 'text/plain';
        default:
            return null;
    }
}

/**
 * Default MIME-dispatching parser. Tests can override via the `parseBuffer`
 * constructor hook. Production uses this function which routes to the
 * M4-T2 parser helpers by MIME.
 */
async function defaultParseBuffer(buffer: Buffer, mime: string): Promise<string> {
    switch (mime) {
        case 'application/pdf':
            return extractTextFromPdf(buffer);
        case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
            return extractTextFromDocx(buffer);
        case 'text/markdown':
            return extractTextFromMarkdown(buffer);
        case 'text/plain':
            return extractTextFromPlain(buffer);
        default:
            throw new KnowledgeIngestError(
                `defaultParseBuffer: no parser registered for MIME type ${mime}`
            );
    }
}

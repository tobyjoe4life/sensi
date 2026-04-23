/**
 * sensi M4-T4 — KnowledgeStore: main-process CRUD + vector search.
 *
 * Thin wrapper around the M4-T1 kb_documents / kb_chunks / vec_kb_chunks
 * schema. Takes a ready-to-use `better-sqlite3` Database handle (no
 * sqlite-vec loading — that's done upstream by DatabaseManager.init()).
 *
 * Trust boundary: main-process only. Renderer never imports this module;
 * it interacts with the knowledge base via the M4-T8 IPC surface (which
 * will be implemented in a later task). All rows, chunks, and embeddings
 * live entirely in main. See SECURITY.md B3 and DECISIONS.md D014/D017.
 *
 * Contract guarantees for M4-T5 / M4-T6 consumers:
 *   - 768 dims only. Any other dim → KnowledgeDimensionError.
 *   - Array order is canonical for chunks. `upsertChunks(id, chunks)`
 *     persists `chunks[i]` with `chunk_index = i`. M4-T6 MUST NOT reorder
 *     the output of M4-T3's splitIntoChunks.
 *   - Overlap chunks are stored verbatim — no dedup. Embedding recall
 *     relies on the overlap (see D015 note on chunk contract).
 *   - UUIDs are generated internally via crypto.randomUUID(). Callers
 *     never supply document or chunk IDs.
 *   - All multi-row writes (upsertChunks, deleteDocument) run inside a
 *     better-sqlite3 transaction for atomicity.
 *   - Delete is explicit and verified: vec rows → chunk rows → doc row,
 *     with post-delete count checks that throw
 *     KnowledgeStoreInvariantError on any leftover.
 *   - vec_kb_chunks primary-key bindings go through toVecPk() because
 *     sqlite-vec v0.1.7-alpha.2 rejects plain JS numbers for primary key
 *     columns (see DECISIONS.md D014c — BigInt binding rule).
 */

import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { ExportedChunk, ExportedDocument } from './knowledgeTransfer';

// ─────────────────────────────────────────────────────────────────────────
// Typed errors — callers pattern-match on `instanceof` rather than string
// sniffing Error.message.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Thrown when an embedding vector is the wrong dimension. M4 is strictly
 * 768-dim; future milestones may support 1536 and beyond alongside
 * per-dimension vec tables, but M4 is single-dim by contract.
 */
export class KnowledgeDimensionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'KnowledgeDimensionError';
    }
}

/**
 * Thrown when a caller references a document id (or a chunk via doc id)
 * that does not exist in kb_documents.
 */
export class KnowledgeNotFoundError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'KnowledgeNotFoundError';
    }
}

/**
 * Thrown when the store detects an invariant violation — e.g. mismatched
 * chunks/embeddings array lengths, or a delete that left orphan rows
 * behind. These are contract failures that should surface loudly.
 */
export class KnowledgeStoreInvariantError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'KnowledgeStoreInvariantError';
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────

/** Required metadata to create a kb_documents row. */
export interface KnowledgeDocumentMeta {
    name: string;
    mime: string;
    bytes: number;
    embeddingModel: string;
    /** Must be 768 in M4. */
    embeddingDim: number;
}

/** Full document row as returned by list operations. */
export interface KnowledgeDocument {
    id: string;
    name: string;
    mime: string;
    bytes: number;
    embeddingModel: string;
    embeddingDim: number;
    pinned: boolean;
    pinnedAt: string | null;
    ingestedAt: string;
    chunkCount: number;
}

/** Result of `searchByEmbedding` — chunk plus containing document metadata. */
export interface RetrievedChunk {
    documentId: string;
    documentName: string;
    chunkIndex: number;
    text: string;
    distance: number;
}

/** Accepted embedding input type — converted to Float32Array internally. */
export type EmbeddingVector = Float32Array | readonly number[];

// ─────────────────────────────────────────────────────────────────────────
// M4 dimension invariant
// ─────────────────────────────────────────────────────────────────────────
const M4_EMBEDDING_DIM = 768;

// ─────────────────────────────────────────────────────────────────────────
// BigInt helper for vec_kb_chunks primary key bindings.
// sqlite-vec v0.1.7-alpha.2 rejects plain JS numbers as INTEGER PRIMARY KEY
// values with "Only integers are allows for primary key values on …"
// (diagnosed during M4-T1 — see DECISIONS.md D014c). Every read/write path
// that touches vec_kb_chunks.chunk_id must flow through this helper so the
// binding convention is centralized and auditable. Mixing plain number
// bindings elsewhere would re-trigger the binding error at runtime.
// ─────────────────────────────────────────────────────────────────────────
function toVecPk(value: number | bigint): bigint {
    return typeof value === 'bigint' ? value : BigInt(value);
}

/**
 * Convert an EmbeddingVector input into a raw little-endian Float32 Buffer
 * sized exactly 768 floats (3072 bytes). Throws KnowledgeDimensionError
 * on any dim mismatch.
 */
function toVecBuffer(vec: EmbeddingVector, label: string): Buffer {
    const arr =
        vec instanceof Float32Array ? vec : Float32Array.from(vec);
    if (arr.length !== M4_EMBEDDING_DIM) {
        throw new KnowledgeDimensionError(
            `${label}: embedding dimension must be ${M4_EMBEDDING_DIM}, got ${arr.length}`
        );
    }
    // Slice the underlying ArrayBuffer at the exact byteOffset/byteLength
    // of the Float32Array view. Matters when the caller passed a subarray
    // (which shares the parent ArrayBuffer) — using `Buffer.from(arr.buffer)`
    // alone would pick up bytes outside the intended vector.
    return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

// ─────────────────────────────────────────────────────────────────────────
// KnowledgeStore
// ─────────────────────────────────────────────────────────────────────────
/**
 * Typed CRUD + vector search wrapper around the M4-T1 kb_* schema.
 *
 * Constructed once per DatabaseManager instance and cached via
 * `DatabaseManager.getKnowledgeStore()`. Not a singleton in its own right
 * — lifetime is tied to the database connection.
 */
export class KnowledgeStore {
    // SQL is localized to this class. No ORM. No cross-module SQL helpers.
    constructor(private readonly db: Database.Database) {}

    /**
     * Insert a new document row and return its generated UUID.
     *
     * Throws KnowledgeDimensionError if embeddingDim is not 768.
     */
    insertDocument(meta: KnowledgeDocumentMeta): string {
        if (meta.embeddingDim !== M4_EMBEDDING_DIM) {
            throw new KnowledgeDimensionError(
                `insertDocument: embedding_dim must be ${M4_EMBEDDING_DIM}, got ${meta.embeddingDim}`
            );
        }
        const id = randomUUID();
        this.db
            .prepare(
                `INSERT INTO kb_documents
                    (id, name, mime, bytes, embedding_model, embedding_dim)
                 VALUES (?, ?, ?, ?, ?, ?)`
            )
            .run(
                id,
                meta.name,
                meta.mime,
                meta.bytes,
                meta.embeddingModel,
                meta.embeddingDim
            );
        return id;
    }

    /**
     * Replace the full set of chunks + embeddings for a document.
     *
     * Transactional: old kb_chunks + vec_kb_chunks rows are deleted before
     * new rows are inserted. On any failure, the DB state rolls back and
     * the document row is untouched.
     *
     * Array order is the canonical chunk_index — chunks[i] → chunk_index=i.
     */
    upsertChunks(
        docId: string,
        chunks: readonly string[],
        embeddings: readonly EmbeddingVector[]
    ): void {
        if (chunks.length !== embeddings.length) {
            throw new KnowledgeStoreInvariantError(
                `upsertChunks: chunks.length (${chunks.length}) !== embeddings.length (${embeddings.length})`
            );
        }
        // Verify document exists before we start mutating anything.
        const exists = this.db
            .prepare('SELECT 1 as ok FROM kb_documents WHERE id = ?')
            .get(docId);
        if (!exists) {
            throw new KnowledgeNotFoundError(
                `upsertChunks: document ${docId} not found`
            );
        }

        // Pre-validate every embedding BEFORE writing anything. This way,
        // a single bad embedding in the middle of a batch doesn't leave
        // the store half-written. (The transaction would also rollback,
        // but validating up-front also lets us use simple prepared
        // statements inside the transaction without mixed concerns.)
        const buffers: Buffer[] = [];
        for (let i = 0; i < embeddings.length; i++) {
            buffers.push(toVecBuffer(embeddings[i], `upsertChunks[${i}]`));
        }

        const selectOldRowIds = this.db.prepare(
            'SELECT rowid FROM kb_chunks WHERE doc_id = ?'
        );
        const deleteVecRow = this.db.prepare(
            'DELETE FROM vec_kb_chunks WHERE chunk_id = ?'
        );
        const deleteChunkRows = this.db.prepare(
            'DELETE FROM kb_chunks WHERE doc_id = ?'
        );
        const insertChunk = this.db.prepare(
            'INSERT INTO kb_chunks (id, doc_id, chunk_index, text) VALUES (?, ?, ?, ?)'
        );
        const insertVec = this.db.prepare(
            'INSERT INTO vec_kb_chunks (chunk_id, embedding) VALUES (?, ?)'
        );

        const upsert = this.db.transaction(() => {
            // Step 1: drop old vec rows first. sqlite-vec is NOT part of
            // the normal FK graph, so cascade would miss it. We walk
            // kb_chunks.rowid explicitly and delete from vec_kb_chunks.
            const oldRows = selectOldRowIds.all(docId) as { rowid: number | bigint }[];
            for (const r of oldRows) {
                deleteVecRow.run(toVecPk(r.rowid));
            }

            // Step 2: drop the scalar chunk rows (FK-less; direct delete).
            deleteChunkRows.run(docId);

            // Step 3: insert new chunks, capturing lastInsertRowid for
            // each one to key the vec row. Array order IS chunk_index.
            for (let i = 0; i < chunks.length; i++) {
                const chunkId = randomUUID();
                const result = insertChunk.run(chunkId, docId, i, chunks[i]);
                // lastInsertRowid is `number | bigint` depending on the
                // DB's safeIntegers mode. toVecPk handles both.
                insertVec.run(toVecPk(result.lastInsertRowid), buffers[i]);
            }
        });
        upsert();
    }

    /**
     * List all documents with chunkCount, ordered by ingested_at DESC
     * (most recently ingested first).
     */
    listDocuments(): KnowledgeDocument[] {
        const rows = this.db
            .prepare(
                `SELECT
                    d.id,
                    d.name,
                    d.mime,
                    d.bytes,
                    d.embedding_model,
                    d.embedding_dim,
                    d.pinned,
                    d.pinned_at,
                    d.ingested_at,
                    (SELECT COUNT(*) FROM kb_chunks c WHERE c.doc_id = d.id) AS chunk_count
                 FROM kb_documents d
                 ORDER BY d.ingested_at DESC, d.id DESC`
            )
            .all() as DocumentRow[];
        return rows.map(rowToDocument);
    }

    /**
     * Delete a document and all its chunks/embeddings. Verifies explicitly
     * that no orphan rows remain.
     *
     * Idempotent with caveat: calling delete on a non-existent id throws
     * KnowledgeNotFoundError rather than silently succeeding, so callers
     * can distinguish "was there" from "never existed".
     */
    deleteDocument(id: string): void {
        const exists = this.db
            .prepare('SELECT 1 as ok FROM kb_documents WHERE id = ?')
            .get(id);
        if (!exists) {
            throw new KnowledgeNotFoundError(
                `deleteDocument: document ${id} not found`
            );
        }

        const selectRowIds = this.db.prepare(
            'SELECT rowid FROM kb_chunks WHERE doc_id = ?'
        );
        const deleteVecRow = this.db.prepare(
            'DELETE FROM vec_kb_chunks WHERE chunk_id = ?'
        );
        const deleteChunkRows = this.db.prepare(
            'DELETE FROM kb_chunks WHERE doc_id = ?'
        );
        const deleteDocRow = this.db.prepare(
            'DELETE FROM kb_documents WHERE id = ?'
        );
        const countChunks = this.db.prepare(
            'SELECT COUNT(*) as n FROM kb_chunks WHERE doc_id = ?'
        );
        const countDoc = this.db.prepare(
            'SELECT COUNT(*) as n FROM kb_documents WHERE id = ?'
        );

        const deleteTx = this.db.transaction(() => {
            // Walk rowids first so we can delete vec rows before kb_chunks.
            const oldRows = selectRowIds.all(id) as { rowid: number | bigint }[];
            for (const r of oldRows) {
                deleteVecRow.run(toVecPk(r.rowid));
            }
            deleteChunkRows.run(id);
            deleteDocRow.run(id);

            // Explicit invariant check: no orphan chunk or document rows.
            // vec_kb_chunks cleanup is verified via kb_chunks count (if
            // we removed every chunk row, every vec row keyed by those
            // rowids was removed too — the virtual table doesn't have
            // its own referential integrity, but our rowid walk is
            // authoritative).
            const chunksLeft = (countChunks.get(id) as { n: number }).n;
            const docsLeft = (countDoc.get(id) as { n: number }).n;
            if (chunksLeft !== 0 || docsLeft !== 0) {
                throw new KnowledgeStoreInvariantError(
                    `deleteDocument: post-delete verify failed (chunks=${chunksLeft}, docs=${docsLeft}) for id=${id}`
                );
            }
        });
        deleteTx();
    }

    /**
     * kNN cosine search against vec_kb_chunks. Joins back to kb_chunks +
     * kb_documents to return rich result rows.
     *
     * `topK` is clamped to [1, ∞) and floored to an integer before being
     * inlined into the query string (sqlite-vec's `k = N` syntax does not
     * reliably accept a parameter binding in v0.1.7-alpha.2, so we
     * serialize it as a literal after sanitizing it to a plain integer).
     */
    searchByEmbedding(
        queryVec: EmbeddingVector,
        topK: number
    ): RetrievedChunk[] {
        const queryBuf = toVecBuffer(queryVec, 'searchByEmbedding');
        if (topK <= 0) return [];
        const k = Math.max(1, Math.floor(topK));

        // Prepare fresh per call because `k` is inlined. For M4 traffic
        // levels (dozens of queries per session at most) the prepare cost
        // is negligible.
        const rows = this.db
            .prepare(
                `SELECT
                    c.id       AS chunk_id,
                    c.doc_id   AS doc_id,
                    c.chunk_index AS chunk_index,
                    c.text     AS text,
                    d.name     AS document_name,
                    v.distance AS distance
                 FROM vec_kb_chunks v
                 JOIN kb_chunks c ON c.rowid = v.chunk_id
                 JOIN kb_documents d ON d.id = c.doc_id
                 WHERE v.embedding MATCH ? AND v.k = ${k}
                 ORDER BY v.distance`
            )
            .all(queryBuf) as RetrievedRow[];

        return rows.map((r) => ({
            documentId: r.doc_id,
            documentName: r.document_name,
            chunkIndex: r.chunk_index,
            text: r.text,
            distance: r.distance,
        }));
    }

    /**
     * Concatenate every chunk's text in chunk_index order, separated by
     * double-newlines, to reconstruct a (mostly) readable document.
     *
     * Throws KnowledgeNotFoundError if the id is unknown. Returns an empty
     * string if the document has zero chunks (e.g. pathological empty
     * input that ingested as a metadata-only row).
     */
    getDocumentText(id: string): string {
        const exists = this.db
            .prepare('SELECT 1 as ok FROM kb_documents WHERE id = ?')
            .get(id);
        if (!exists) {
            throw new KnowledgeNotFoundError(
                `getDocumentText: document ${id} not found`
            );
        }

        const rows = this.db
            .prepare(
                'SELECT text FROM kb_chunks WHERE doc_id = ? ORDER BY chunk_index ASC'
            )
            .all(id) as { text: string }[];
        return rows.map((r) => r.text).join('\n\n');
    }

    /**
     * Pin or unpin a document. `pinned_at` is server-side `datetime('now')`
     * when pinning and `NULL` when unpinning. Returns the new `pinnedAt`
     * value so callers can surface it in the UI without a round-trip.
     */
    setPinned(id: string, pinned: boolean): { pinnedAt: string | null } {
        const exists = this.db
            .prepare('SELECT 1 as ok FROM kb_documents WHERE id = ?')
            .get(id);
        if (!exists) {
            throw new KnowledgeNotFoundError(
                `setPinned: document ${id} not found`
            );
        }

        if (pinned) {
            this.db
                .prepare(
                    `UPDATE kb_documents
                     SET pinned = 1, pinned_at = datetime('now')
                     WHERE id = ?`
                )
                .run(id);
        } else {
            this.db
                .prepare(
                    `UPDATE kb_documents
                     SET pinned = 0, pinned_at = NULL
                     WHERE id = ?`
                )
                .run(id);
        }

        const row = this.db
            .prepare('SELECT pinned_at FROM kb_documents WHERE id = ?')
            .get(id) as { pinned_at: string | null };
        return { pinnedAt: row.pinned_at };
    }

    /**
     * List only pinned documents, ordered by pinned_at ASC (oldest pin
     * first) with a stable secondary sort on ingested_at ASC and id ASC.
     * The M4-T7 context builder will use this to determine which documents
     * always inject into rolling context.
     */
    listPinned(): KnowledgeDocument[] {
        const rows = this.db
            .prepare(
                `SELECT
                    d.id,
                    d.name,
                    d.mime,
                    d.bytes,
                    d.embedding_model,
                    d.embedding_dim,
                    d.pinned,
                    d.pinned_at,
                    d.ingested_at,
                    (SELECT COUNT(*) FROM kb_chunks c WHERE c.doc_id = d.id) AS chunk_count
                 FROM kb_documents d
                 WHERE d.pinned = 1
                 ORDER BY d.pinned_at ASC, d.ingested_at ASC, d.id ASC`
            )
            .all() as DocumentRow[];
        return rows.map(rowToDocument);
    }

    // ─────────────────────────────────────────────────────────────────
    // sensi M7 / KNOWLEDGE-02 (v2.9.0) — per-meeting document binding.
    //
    // Attachment primitives for the kb_document_events join table. Used
    // by KnowledgeOrchestrator to prefer event-scoped docs at retrieval
    // time, and by the UpcomingMeetingsPanel attachment modal.
    // ─────────────────────────────────────────────────────────────────

    /**
     * Attach a document to a calendar event id. Idempotent — calling with
     * the same (doc_id, event_id) pair is a no-op (INSERT OR IGNORE).
     * Throws KnowledgeNotFoundError if the document does not exist.
     */
    attachDocumentToEvent(docId: string, eventId: string): void {
        const exists = this.db
            .prepare('SELECT 1 as ok FROM kb_documents WHERE id = ?')
            .get(docId);
        if (!exists) {
            throw new KnowledgeNotFoundError(
                `attachDocumentToEvent: document ${docId} not found`
            );
        }
        this.db
            .prepare(
                `INSERT OR IGNORE INTO kb_document_events (doc_id, event_id)
                 VALUES (?, ?)`
            )
            .run(docId, eventId);
    }

    /**
     * Detach a document from an event. Silent no-op if the pair doesn't
     * exist — the caller's mental model is "make sure this isn't attached",
     * which is already true.
     */
    detachDocumentFromEvent(docId: string, eventId: string): void {
        this.db
            .prepare(
                'DELETE FROM kb_document_events WHERE doc_id = ? AND event_id = ?'
            )
            .run(docId, eventId);
    }

    /**
     * List all documents attached to a given event, ordered by most recent
     * attachment first. Returns the same shape as listDocuments() so the
     * IPC surface and the attachment modal can share rendering code.
     */
    listDocumentsForEvent(eventId: string): KnowledgeDocument[] {
        const rows = this.db
            .prepare(
                `SELECT
                    d.id,
                    d.name,
                    d.mime,
                    d.bytes,
                    d.embedding_model,
                    d.embedding_dim,
                    d.pinned,
                    d.pinned_at,
                    d.ingested_at,
                    (SELECT COUNT(*) FROM kb_chunks c WHERE c.doc_id = d.id) AS chunk_count
                 FROM kb_documents d
                 JOIN kb_document_events e ON e.doc_id = d.id
                 WHERE e.event_id = ?
                 ORDER BY e.attached_at DESC, d.ingested_at DESC, d.id DESC`
            )
            .all(eventId) as DocumentRow[];
        return rows.map(rowToDocument);
    }

    /**
     * List every event id a document is attached to. Used by
     * KnowledgeSettings to render a chip per attachment on each doc row.
     */
    listEventsForDocument(docId: string): string[] {
        const rows = this.db
            .prepare(
                `SELECT event_id FROM kb_document_events
                 WHERE doc_id = ?
                 ORDER BY attached_at DESC`
            )
            .all(docId) as { event_id: string }[];
        return rows.map(r => r.event_id);
    }

    /**
     * kNN cosine search constrained to a specific set of document ids.
     * When `allowedDocIds` is empty returns [] (callers should fall back
     * to the unfiltered path). When non-empty, inlines an IN clause via
     * placeholders so sqlite-vec's `k=N` literal requirement is preserved
     * while the doc filter stays parameterized.
     */
    searchByEmbeddingWithDocumentFilter(
        queryVec: EmbeddingVector,
        topK: number,
        allowedDocIds: readonly string[]
    ): RetrievedChunk[] {
        if (allowedDocIds.length === 0) return [];
        const queryBuf = toVecBuffer(queryVec, 'searchByEmbeddingWithDocumentFilter');
        if (topK <= 0) return [];
        const k = Math.max(1, Math.floor(topK));

        // `k` stays inlined; doc ids stay parameterized.
        const placeholders = allowedDocIds.map(() => '?').join(', ');
        const rows = this.db
            .prepare(
                `SELECT
                    c.id          AS chunk_id,
                    c.doc_id      AS doc_id,
                    c.chunk_index AS chunk_index,
                    c.text        AS text,
                    d.name        AS document_name,
                    v.distance    AS distance
                 FROM vec_kb_chunks v
                 JOIN kb_chunks c ON c.rowid = v.chunk_id
                 JOIN kb_documents d ON d.id = c.doc_id
                 WHERE v.embedding MATCH ? AND v.k = ${k}
                       AND c.doc_id IN (${placeholders})
                 ORDER BY v.distance`
            )
            .all(queryBuf, ...allowedDocIds) as RetrievedRow[];

        return rows.map((r) => ({
            documentId: r.doc_id,
            documentName: r.document_name,
            chunkIndex: r.chunk_index,
            text: r.text,
            distance: r.distance,
        }));
    }

    // ─────────────────────────────────────────────────────────────────
    // M4-T10 — Export/import support
    //
    // `getDocumentChunksWithEmbeddings` reads the raw Float32 bytes
    // out of `vec_kb_chunks` and decodes them into plain number
    // arrays for JSON serialization. `replaceAllFromArtifact` wipes
    // every kb_* table and inserts the artifact's documents inside a
    // single SQLite transaction — the sole entry point for the M4-T10
    // replace policy. See DECISIONS.md D023.
    // ─────────────────────────────────────────────────────────────────

    /**
     * Return every chunk of `docId` ordered by chunk_index with its
     * Float32 embedding decoded into a plain number array. Used by
     * `knowledgeTransfer.buildExportArtifact`.
     *
     * Throws `KnowledgeNotFoundError` if the document id is unknown.
     * Throws `KnowledgeDimensionError` if any stored embedding is
     * not exactly 768 floats — an invariant violation that would
     * indicate DB corruption rather than normal operation.
     */
    getDocumentChunksWithEmbeddings(docId: string): ExportedChunk[] {
        const exists = this.db
            .prepare('SELECT 1 as ok FROM kb_documents WHERE id = ?')
            .get(docId);
        if (!exists) {
            throw new KnowledgeNotFoundError(
                `getDocumentChunksWithEmbeddings: document ${docId} not found`
            );
        }

        const rows = this.db
            .prepare(
                `SELECT
                    c.rowid       AS row_id,
                    c.chunk_index AS chunk_index,
                    c.text        AS text,
                    v.embedding   AS embedding
                 FROM kb_chunks c
                 JOIN vec_kb_chunks v ON v.chunk_id = c.rowid
                 WHERE c.doc_id = ?
                 ORDER BY c.chunk_index ASC`
            )
            .all(docId) as Array<{
                row_id: number | bigint;
                chunk_index: number;
                text: string;
                embedding: Buffer | Uint8Array;
            }>;

        const out: ExportedChunk[] = [];
        for (const r of rows) {
            const buf = r.embedding;
            if (!buf || buf.byteLength !== M4_EMBEDDING_DIM * 4) {
                throw new KnowledgeDimensionError(
                    `getDocumentChunksWithEmbeddings: stored embedding byteLength ${buf?.byteLength ?? 'null'} does not match ${M4_EMBEDDING_DIM * 4}`
                );
            }
            // Copy bytes into a fresh ArrayBuffer to decouple from
            // better-sqlite3's internal buffer lifetime, then view as
            // Float32Array.
            const ab = new ArrayBuffer(buf.byteLength);
            new Uint8Array(ab).set(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
            const floats = new Float32Array(ab);
            out.push({
                chunkIndex: r.chunk_index,
                text: r.text,
                embedding: Array.from(floats),
            });
        }
        return out;
    }

    /**
     * Wipe every row from kb_documents / kb_chunks / vec_kb_chunks,
     * then insert each document in `docs` with its chunks and
     * embeddings. Runs inside a single better-sqlite3 transaction —
     * on any error, the store is rolled back to its pre-call state.
     *
     * `pinned_at` and `ingested_at` are copied verbatim from the
     * artifact when present, otherwise fall back to defaults
     * (NULL and `datetime('now')` respectively).
     *
     * Returns `{ replaced, imported }` where `replaced` is the number
     * of documents that existed in the store before the call and
     * `imported` is the number of documents inserted from the artifact.
     */
    replaceAllFromArtifact(
        docs: readonly ExportedDocument[]
    ): { replaced: number; imported: number } {
        // Validate every chunk's embedding length up-front so a bad
        // artifact doesn't leave the store half-wiped.
        for (let i = 0; i < docs.length; i++) {
            const d = docs[i];
            if (d.embeddingDim !== M4_EMBEDDING_DIM) {
                throw new KnowledgeDimensionError(
                    `replaceAllFromArtifact: documents[${i}].embeddingDim must be ${M4_EMBEDDING_DIM}, got ${d.embeddingDim}`
                );
            }
            for (let j = 0; j < d.chunks.length; j++) {
                if (d.chunks[j].embedding.length !== M4_EMBEDDING_DIM) {
                    throw new KnowledgeDimensionError(
                        `replaceAllFromArtifact: documents[${i}].chunks[${j}].embedding must have length ${M4_EMBEDDING_DIM}`
                    );
                }
            }
        }

        const countDocs = this.db
            .prepare('SELECT COUNT(*) as n FROM kb_documents')
            .get() as { n: number };
        const replaced = countDocs.n;

        // Prepared statements used inside the transaction
        const selectAllChunkRowIds = this.db.prepare(
            'SELECT rowid FROM kb_chunks'
        );
        const deleteVecRow = this.db.prepare(
            'DELETE FROM vec_kb_chunks WHERE chunk_id = ?'
        );
        const wipeChunks = this.db.prepare('DELETE FROM kb_chunks');
        const wipeDocs = this.db.prepare('DELETE FROM kb_documents');

        const insertDoc = this.db.prepare(
            `INSERT INTO kb_documents
                (id, name, mime, bytes, embedding_model, embedding_dim, pinned, pinned_at, ingested_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`
        );
        const insertChunk = this.db.prepare(
            'INSERT INTO kb_chunks (id, doc_id, chunk_index, text) VALUES (?, ?, ?, ?)'
        );
        const insertVec = this.db.prepare(
            'INSERT INTO vec_kb_chunks (chunk_id, embedding) VALUES (?, ?)'
        );

        const replaceTx = this.db.transaction(() => {
            // Step 1: drop every vec row first — sqlite-vec is outside
            // the normal FK graph so `DELETE FROM kb_chunks` alone
            // would leave orphans in the virtual table.
            const allRowIds = selectAllChunkRowIds.all() as {
                rowid: number | bigint;
            }[];
            for (const r of allRowIds) {
                deleteVecRow.run(toVecPk(r.rowid));
            }
            wipeChunks.run();
            wipeDocs.run();

            // Step 2: insert each document, then its chunks + vec rows.
            let imported = 0;
            for (const d of docs) {
                const docId = randomUUID();
                insertDoc.run(
                    docId,
                    d.name,
                    d.mime,
                    d.bytes,
                    d.embeddingModel,
                    d.embeddingDim,
                    d.pinned ? 1 : 0,
                    d.pinned ? d.pinnedAt : null,
                    d.ingestedAt || null
                );

                for (const c of d.chunks) {
                    const chunkId = randomUUID();
                    const result = insertChunk.run(
                        chunkId,
                        docId,
                        c.chunkIndex,
                        c.text
                    );
                    const f32 = Float32Array.from(c.embedding);
                    const buf = Buffer.from(
                        f32.buffer,
                        f32.byteOffset,
                        f32.byteLength
                    );
                    insertVec.run(toVecPk(result.lastInsertRowid), buf);
                }
                imported++;
            }
            return imported;
        });

        const imported = replaceTx();
        return { replaced, imported };
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Internal row shapes (not exported)
// ─────────────────────────────────────────────────────────────────────────

interface DocumentRow {
    id: string;
    name: string;
    mime: string;
    bytes: number;
    embedding_model: string;
    embedding_dim: number;
    pinned: number;
    pinned_at: string | null;
    ingested_at: string;
    chunk_count: number;
}

interface RetrievedRow {
    chunk_id: string;
    doc_id: string;
    chunk_index: number;
    text: string;
    document_name: string;
    distance: number;
}

function rowToDocument(r: DocumentRow): KnowledgeDocument {
    return {
        id: r.id,
        name: r.name,
        mime: r.mime,
        bytes: r.bytes,
        embeddingModel: r.embedding_model,
        embeddingDim: r.embedding_dim,
        pinned: r.pinned === 1,
        pinnedAt: r.pinned_at,
        ingestedAt: r.ingested_at,
        chunkCount: r.chunk_count,
    };
}

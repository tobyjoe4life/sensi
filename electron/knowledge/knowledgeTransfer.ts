/**
 * sensi M4-T10 — Knowledge base export/import.
 *
 * Single-file JSON artifact format for manually transferring the
 * personal knowledge base between installs. Local-only, versioned,
 * and scoped strictly to knowledge-subsystem data. No credentials,
 * no meetings, no transcripts, no app settings.
 *
 * Trust boundary: main-process only. The renderer never parses or
 * writes the artifact — it only triggers the IPC handlers that call
 * into this module. File IO happens via Node `fs.promises` in main.
 *
 * Import policy: **replace**. The current knowledge base is fully
 * wiped before the imported documents are inserted. A pre-import
 * backup of the current state is written to
 * `<userData>/knowledge-preimport-backup-<ISO>.json` before the
 * destructive mutation, and the wipe+insert itself runs inside a
 * single SQLite transaction for DB-level atomicity. If either the
 * backup write or the transaction fails, the store is rolled back
 * to the state it was in before the import began.
 *
 * See DECISIONS.md D023 for the format choice, policy rationale,
 * and versioning strategy.
 */

import { promises as fs } from 'node:fs';
import type { KnowledgeDocument } from './KnowledgeStore';

// ─────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────

/**
 * Magic marker — presence of this key on the top-level object is the
 * first gate validation checks to reject arbitrary JSON files. The
 * name is intentionally verbose to avoid collision with any other
 * JSON schema.
 */
export const KNOWLEDGE_EXPORT_MAGIC = 'sensiKnowledgeExport' as const;

/**
 * Current export format version. Bump only when the shape changes in
 * a backwards-incompatible way (rename of a field, change of
 * semantics, etc.). New optional fields should NOT bump the version.
 */
export const KNOWLEDGE_EXPORT_VERSION = 1 as const;

/**
 * Only 768-dim embeddings are supported in M4. Any other value in
 * either the artifact or the store is rejected at validation time.
 */
export const KNOWLEDGE_EXPORT_EMBEDDING_DIM = 768 as const;

// ─────────────────────────────────────────────────────────────────────
// Typed errors — callers (knowledgeIpcHelpers.translateError) pattern
// -match on `instanceof`, never on message string.
// ─────────────────────────────────────────────────────────────────────

export class KnowledgeExportError extends Error {
    constructor(message: string, options?: { cause?: unknown }) {
        super(message, options);
        this.name = 'KnowledgeExportError';
    }
}

export class KnowledgeImportError extends Error {
    constructor(message: string, options?: { cause?: unknown }) {
        super(message, options);
        this.name = 'KnowledgeImportError';
    }
}

export class KnowledgeIncompatibleFormatError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'KnowledgeIncompatibleFormatError';
    }
}

// ─────────────────────────────────────────────────────────────────────
// Artifact shape (the only schema consumers need to know about)
// ─────────────────────────────────────────────────────────────────────

export interface ExportedChunk {
    chunkIndex: number;
    text: string;
    /** 768-length Float32 vector serialized as a plain number array. */
    embedding: number[];
}

export interface ExportedDocument {
    name: string;
    mime: string;
    bytes: number;
    embeddingModel: string;
    embeddingDim: number;
    pinned: boolean;
    pinnedAt: string | null;
    ingestedAt: string;
    chunks: ExportedChunk[];
}

/**
 * Top-level JSON shape. Renamed fields or new required fields are a
 * version bump; new optional fields are not.
 */
export interface KnowledgeExportArtifact {
    [KNOWLEDGE_EXPORT_MAGIC]: true;
    version: number;
    embeddingDim: 768;
    exportedAt: string;
    documentCount: number;
    chunkCount: number;
    documents: ExportedDocument[];
}

// ─────────────────────────────────────────────────────────────────────
// Store DI interfaces — structural, so tests can substitute in-memory
// stubs without ever touching better-sqlite3 or the ABI-locked runtime.
// ─────────────────────────────────────────────────────────────────────

export interface ExportReadableStore {
    listDocuments(): KnowledgeDocument[];
    getDocumentChunksWithEmbeddings(docId: string): ExportedChunk[];
}

export interface ImportWritableStore {
    replaceAllFromArtifact(docs: readonly ExportedDocument[]): {
        replaced: number;
        imported: number;
    };
}

export type TransferStore = ExportReadableStore & ImportWritableStore;

// ─────────────────────────────────────────────────────────────────────
// Pure helpers — validation and serialization
// ─────────────────────────────────────────────────────────────────────

/**
 * Build a fully validated artifact from a store. This is a pure
 * transform — no IO. Used by `exportKnowledgeToFile` and by tests.
 *
 * Throws `KnowledgeExportError` if any document has an unexpected
 * embedding dimension. The dimension invariant is duplicated here
 * (not delegated to the store) so that a future store implementation
 * with multiple dim widths can't quietly leak a wrong-dim artifact.
 */
export function buildExportArtifact(store: ExportReadableStore): KnowledgeExportArtifact {
    const docs = store.listDocuments();
    const exported: ExportedDocument[] = [];
    let totalChunks = 0;

    for (const doc of docs) {
        if (doc.embeddingDim !== KNOWLEDGE_EXPORT_EMBEDDING_DIM) {
            throw new KnowledgeExportError(
                `Document ${doc.name} has embedding_dim ${doc.embeddingDim}, expected ${KNOWLEDGE_EXPORT_EMBEDDING_DIM}`
            );
        }
        const chunks = store.getDocumentChunksWithEmbeddings(doc.id);
        // Verify every returned chunk's embedding length before
        // handing it to the JSON serializer. Mismatches here would
        // produce an invalid artifact that import would later reject
        // — fail fast at export instead.
        for (const c of chunks) {
            if (c.embedding.length !== KNOWLEDGE_EXPORT_EMBEDDING_DIM) {
                throw new KnowledgeExportError(
                    `Chunk ${c.chunkIndex} of document ${doc.name} has embedding length ${c.embedding.length}, expected ${KNOWLEDGE_EXPORT_EMBEDDING_DIM}`
                );
            }
        }
        exported.push({
            name: doc.name,
            mime: doc.mime,
            bytes: doc.bytes,
            embeddingModel: doc.embeddingModel,
            embeddingDim: doc.embeddingDim,
            pinned: doc.pinned,
            pinnedAt: doc.pinnedAt,
            ingestedAt: doc.ingestedAt,
            chunks,
        });
        totalChunks += chunks.length;
    }

    return {
        [KNOWLEDGE_EXPORT_MAGIC]: true,
        version: KNOWLEDGE_EXPORT_VERSION,
        embeddingDim: KNOWLEDGE_EXPORT_EMBEDDING_DIM,
        exportedAt: new Date().toISOString(),
        documentCount: exported.length,
        chunkCount: totalChunks,
        documents: exported,
    };
}

/**
 * Validate an arbitrary `unknown` value as a `KnowledgeExportArtifact`.
 * Rejects malformed JSON, missing magic marker, wrong version, wrong
 * embedding dim, and any structural mismatch. Does NOT throw `Error`
 * with a raw cause — all error messages are hand-written and safe to
 * show in the renderer.
 */
export function validateImportArtifact(raw: unknown): KnowledgeExportArtifact {
    if (raw === null || typeof raw !== 'object') {
        throw new KnowledgeIncompatibleFormatError(
            'Artifact is not a JSON object.'
        );
    }
    const obj = raw as Record<string, unknown>;

    // Magic marker
    if (obj[KNOWLEDGE_EXPORT_MAGIC] !== true) {
        throw new KnowledgeIncompatibleFormatError(
            'Not a sensi knowledge export (missing magic marker).'
        );
    }

    // Version — reject future versions safely. Older versions could be
    // accepted in a future task via a migration layer; for now only
    // the current version is valid.
    if (typeof obj.version !== 'number' || !Number.isInteger(obj.version)) {
        throw new KnowledgeIncompatibleFormatError(
            'Artifact version is missing or not an integer.'
        );
    }
    if (obj.version !== KNOWLEDGE_EXPORT_VERSION) {
        throw new KnowledgeIncompatibleFormatError(
            `Artifact version ${obj.version} is not supported (this build expects ${KNOWLEDGE_EXPORT_VERSION}).`
        );
    }

    // Embedding dim
    if (obj.embeddingDim !== KNOWLEDGE_EXPORT_EMBEDDING_DIM) {
        throw new KnowledgeIncompatibleFormatError(
            `Artifact embeddingDim ${String(obj.embeddingDim)} is not supported (this build expects ${KNOWLEDGE_EXPORT_EMBEDDING_DIM}).`
        );
    }

    // Documents array
    if (!Array.isArray(obj.documents)) {
        throw new KnowledgeIncompatibleFormatError(
            'Artifact documents field is missing or not an array.'
        );
    }

    const validatedDocs: ExportedDocument[] = [];
    for (let i = 0; i < obj.documents.length; i++) {
        const d = obj.documents[i];
        validatedDocs.push(validateDocument(d, i));
    }

    const exportedAt =
        typeof obj.exportedAt === 'string' ? obj.exportedAt : '';

    return {
        [KNOWLEDGE_EXPORT_MAGIC]: true,
        version: KNOWLEDGE_EXPORT_VERSION,
        embeddingDim: KNOWLEDGE_EXPORT_EMBEDDING_DIM,
        exportedAt,
        documentCount: validatedDocs.length,
        chunkCount: validatedDocs.reduce((sum, d) => sum + d.chunks.length, 0),
        documents: validatedDocs,
    };
}

function validateDocument(raw: unknown, index: number): ExportedDocument {
    if (raw === null || typeof raw !== 'object') {
        throw new KnowledgeIncompatibleFormatError(
            `Document at index ${index} is not a JSON object.`
        );
    }
    const d = raw as Record<string, unknown>;

    const name = requireString(d.name, `documents[${index}].name`);
    const mime = requireString(d.mime, `documents[${index}].mime`);
    const bytes = requireNonNegativeInt(d.bytes, `documents[${index}].bytes`);
    const embeddingModel = requireString(
        d.embeddingModel,
        `documents[${index}].embeddingModel`
    );
    const embeddingDim = requireNonNegativeInt(
        d.embeddingDim,
        `documents[${index}].embeddingDim`
    );
    if (embeddingDim !== KNOWLEDGE_EXPORT_EMBEDDING_DIM) {
        throw new KnowledgeIncompatibleFormatError(
            `documents[${index}].embeddingDim must be ${KNOWLEDGE_EXPORT_EMBEDDING_DIM}, got ${embeddingDim}`
        );
    }
    const pinned = typeof d.pinned === 'boolean' ? d.pinned : false;
    const pinnedAt = typeof d.pinnedAt === 'string' ? d.pinnedAt : null;
    const ingestedAt = typeof d.ingestedAt === 'string' ? d.ingestedAt : '';

    if (!Array.isArray(d.chunks)) {
        throw new KnowledgeIncompatibleFormatError(
            `documents[${index}].chunks must be an array`
        );
    }

    const chunks: ExportedChunk[] = [];
    for (let j = 0; j < d.chunks.length; j++) {
        chunks.push(validateChunk(d.chunks[j], index, j));
    }

    return {
        name,
        mime,
        bytes,
        embeddingModel,
        embeddingDim,
        pinned,
        pinnedAt,
        ingestedAt,
        chunks,
    };
}

function validateChunk(raw: unknown, docIdx: number, chunkIdx: number): ExportedChunk {
    if (raw === null || typeof raw !== 'object') {
        throw new KnowledgeIncompatibleFormatError(
            `documents[${docIdx}].chunks[${chunkIdx}] is not a JSON object.`
        );
    }
    const c = raw as Record<string, unknown>;

    const chunkIndex = requireNonNegativeInt(
        c.chunkIndex,
        `documents[${docIdx}].chunks[${chunkIdx}].chunkIndex`
    );
    const text = requireString(
        c.text,
        `documents[${docIdx}].chunks[${chunkIdx}].text`,
        { allowEmpty: true }
    );

    if (!Array.isArray(c.embedding)) {
        throw new KnowledgeIncompatibleFormatError(
            `documents[${docIdx}].chunks[${chunkIdx}].embedding must be an array`
        );
    }
    if (c.embedding.length !== KNOWLEDGE_EXPORT_EMBEDDING_DIM) {
        throw new KnowledgeIncompatibleFormatError(
            `documents[${docIdx}].chunks[${chunkIdx}].embedding must have length ${KNOWLEDGE_EXPORT_EMBEDDING_DIM}, got ${c.embedding.length}`
        );
    }
    for (let k = 0; k < c.embedding.length; k++) {
        const v = c.embedding[k];
        if (typeof v !== 'number' || !Number.isFinite(v)) {
            throw new KnowledgeIncompatibleFormatError(
                `documents[${docIdx}].chunks[${chunkIdx}].embedding[${k}] is not a finite number`
            );
        }
    }

    return {
        chunkIndex,
        text,
        embedding: c.embedding as number[],
    };
}

function requireString(
    value: unknown,
    path: string,
    options: { allowEmpty?: boolean } = {}
): string {
    if (typeof value !== 'string') {
        throw new KnowledgeIncompatibleFormatError(`${path} must be a string`);
    }
    if (!options.allowEmpty && value.length === 0) {
        throw new KnowledgeIncompatibleFormatError(
            `${path} must be a non-empty string`
        );
    }
    return value;
}

function requireNonNegativeInt(value: unknown, path: string): number {
    if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        !Number.isInteger(value) ||
        value < 0
    ) {
        throw new KnowledgeIncompatibleFormatError(
            `${path} must be a non-negative integer`
        );
    }
    return value;
}

// ─────────────────────────────────────────────────────────────────────
// IO entry points — used by IPC handlers
// ─────────────────────────────────────────────────────────────────────

/**
 * Write the current knowledge base to `filePath` as a JSON artifact.
 * Returns document and chunk counts on success.
 *
 * Throws `KnowledgeExportError` on any IO or serialization failure.
 * The caller is responsible for validating `filePath` (the IPC
 * handler) and for catching the error for translation.
 */
export async function exportKnowledgeToFile(
    store: ExportReadableStore,
    filePath: string
): Promise<{ filePath: string; documentCount: number; chunkCount: number }> {
    let artifact: KnowledgeExportArtifact;
    try {
        artifact = buildExportArtifact(store);
    } catch (e) {
        if (e instanceof KnowledgeExportError) throw e;
        throw new KnowledgeExportError('Failed to build export artifact', { cause: e });
    }

    const json = JSON.stringify(artifact, null, 2);
    try {
        await fs.writeFile(filePath, json, 'utf8');
    } catch (e) {
        throw new KnowledgeExportError('Failed to write export file', { cause: e });
    }

    return {
        filePath,
        documentCount: artifact.documentCount,
        chunkCount: artifact.chunkCount,
    };
}

/**
 * Read and validate an artifact from `filePath`, then **replace** the
 * current knowledge base with its contents.
 *
 * Side effect before the destructive mutation: a pre-import backup is
 * written to `backupDir/knowledge-preimport-backup-<ISO>.json` so the
 * user can recover if the import succeeds but the data turns out to be
 * wrong. The backup is only written AFTER validation passes — there's
 * no point backing up to replace with garbage.
 *
 * Atomicity: `replaceAllFromArtifact` wraps the delete+insert in a
 * single SQLite transaction (see `KnowledgeStore.replaceAllFromArtifact`).
 * On any error inside that method, the DB is rolled back and the store
 * is unchanged. The on-disk backup is kept regardless so the user can
 * restore manually by copying it and re-importing.
 *
 * Throws `KnowledgeIncompatibleFormatError` on version/shape errors
 * and `KnowledgeImportError` on IO or DB application errors.
 */
export async function importKnowledgeFromFile(
    store: TransferStore,
    filePath: string,
    backupDir: string | null
): Promise<{
    filePath: string;
    replaced: number;
    imported: number;
    chunkCount: number;
    backupPath: string | null;
}> {
    let raw: string;
    try {
        raw = await fs.readFile(filePath, 'utf8');
    } catch (e) {
        throw new KnowledgeImportError('Failed to read import file', { cause: e });
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        throw new KnowledgeIncompatibleFormatError(
            'File is not valid JSON.'
        );
    }

    // Validate FIRST — no side effects before we know the artifact is good.
    const artifact = validateImportArtifact(parsed);

    // Pre-import backup. Any failure here aborts the import without
    // mutating the store — the whole point of writing the backup first
    // is that "import without a backup" isn't a state we ever enter.
    let backupPath: string | null = null;
    if (backupDir !== null) {
        try {
            const backupArtifact = buildExportArtifact(store);
            const backupJson = JSON.stringify(backupArtifact, null, 2);
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            backupPath = `${backupDir}/knowledge-preimport-backup-${stamp}.json`;
            await fs.writeFile(backupPath, backupJson, 'utf8');
        } catch (e) {
            throw new KnowledgeImportError(
                'Failed to write pre-import backup; import aborted',
                { cause: e }
            );
        }
    }

    // Apply replace policy inside a single DB transaction.
    let counts: { replaced: number; imported: number };
    try {
        counts = store.replaceAllFromArtifact(artifact.documents);
    } catch (e) {
        throw new KnowledgeImportError('Failed to apply import to store', { cause: e });
    }

    return {
        filePath,
        replaced: counts.replaced,
        imported: counts.imported,
        chunkCount: artifact.chunkCount,
        backupPath,
    };
}

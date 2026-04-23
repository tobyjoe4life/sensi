// sensi M4-T4 — KnowledgeStore integration tests.
//
// Runs under Electron's Node runtime because better-sqlite3 is ABI-locked
// to Electron 33 (NODE_MODULE_VERSION 130) and vitest workers run under
// plain Node 24 (ABI 137) — constructing `new Database()` under the wrong
// ABI throws ERR_DLOPEN_FAILED. See DECISIONS.md D014d and D017.
//
// Run:
//   npm run test:kb-store
// or (without rebuilding, against a stale dist-electron):
//   cross-env ELECTRON_RUN_AS_NODE=1 electron electron/__tests__/knowledgeStore.electron.cjs
//
// The npm script chains `npm run build:electron` first so the require'd
// `dist-electron/electron/knowledge/KnowledgeStore.js` is always fresh.
//
// Exit code: 0 on all-pass, 1 on any failure.

const Database = require('better-sqlite3');
const sqliteVec = require('sqlite-vec');

// Import KnowledgeStore from the compiled JS (not the .ts source — there's
// no TS loader available in Electron's Node, and adding one is out of
// scope for M4-T4). This matches how the main process actually loads the
// module at runtime.
const {
    KnowledgeStore,
    KnowledgeDimensionError,
    KnowledgeNotFoundError,
    KnowledgeStoreInvariantError,
} = require('../../dist-electron/electron/knowledge/KnowledgeStore');

// ─────────────────────────────────────────────────────────────────────────
// Test harness
// ─────────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function log(name, ok, detail) {
    const mark = ok ? 'PASS' : 'FAIL';
    const line = `  ${mark}  ${name}${detail ? '  —  ' + detail : ''}`;
    if (ok) {
        passed++;
        console.log(line);
    } else {
        failed++;
        console.error(line);
    }
}

function assertEq(actual, expected, label) {
    if (actual !== expected) {
        throw new Error(
            `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
        );
    }
}

function assertTrue(cond, label) {
    if (!cond) throw new Error(`${label}: expected true, got false`);
}

// Build a fresh in-memory DB with sqlite-vec loaded and the M4-T1 kb_*
// schema created. Each test gets its own DB to avoid cross-test
// contamination.
function freshDb() {
    const db = new Database(':memory:');
    sqliteVec.load(db);
    // Scalar tables
    db.exec(`
        CREATE TABLE IF NOT EXISTS kb_documents (
            id               TEXT PRIMARY KEY,
            name             TEXT NOT NULL,
            mime             TEXT NOT NULL,
            bytes            INTEGER NOT NULL,
            embedding_model  TEXT NOT NULL,
            embedding_dim    INTEGER NOT NULL,
            pinned           INTEGER NOT NULL DEFAULT 0,
            pinned_at        TEXT,
            ingested_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS kb_chunks (
            id           TEXT PRIMARY KEY,
            doc_id       TEXT NOT NULL
                         REFERENCES kb_documents(id) ON DELETE CASCADE,
            chunk_index  INTEGER NOT NULL,
            text         TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_kb_chunks_doc_id ON kb_chunks(doc_id);
    `);
    // vec0 virtual table
    db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_kb_chunks USING vec0(
            chunk_id INTEGER PRIMARY KEY,
            embedding float[768]
        );
    `);
    return db;
}

// Helper: build a 768-dim Float32Array with a deterministic pattern
function vec768(fn) {
    const a = new Float32Array(768);
    for (let i = 0; i < 768; i++) a[i] = fn(i);
    return a;
}

function run(name, fn) {
    try {
        fn();
    } catch (e) {
        log(name, false, e.message || String(e));
    }
}

const DOC_META = () => ({
    name: 'resume.pdf',
    mime: 'application/pdf',
    bytes: 1024,
    embeddingModel: 'nomic-embed-text',
    embeddingDim: 768,
});

// ─────────────────────────────────────────────────────────────────────────
// Test 1: insertDocument + listDocuments roundtrip
// ─────────────────────────────────────────────────────────────────────────
run('Test 1: insertDocument + listDocuments roundtrip', () => {
    const db = freshDb();
    const store = new KnowledgeStore(db);
    const id = store.insertDocument(DOC_META());
    assertTrue(typeof id === 'string' && id.length > 0, 'id is non-empty string');

    const docs = store.listDocuments();
    assertEq(docs.length, 1, 'listDocuments length');
    assertEq(docs[0].id, id, 'listDocuments id');
    assertEq(docs[0].name, 'resume.pdf', 'listDocuments name');
    assertEq(docs[0].embeddingDim, 768, 'listDocuments embeddingDim');
    assertEq(docs[0].chunkCount, 0, 'chunkCount == 0 before upsert');
    assertEq(docs[0].pinned, false, 'pinned false by default');
    assertEq(docs[0].pinnedAt, null, 'pinnedAt null by default');
    db.close();
    log('insertDocument + listDocuments roundtrip', true);
});

// ─────────────────────────────────────────────────────────────────────────
// Test 2: upsertChunks preserves chunk_index ordering and count
// ─────────────────────────────────────────────────────────────────────────
run('Test 2: upsertChunks preserves order and count', () => {
    const db = freshDb();
    const store = new KnowledgeStore(db);
    const id = store.insertDocument(DOC_META());

    const chunks = ['chunk zero', 'chunk one', 'chunk two', 'chunk three'];
    const embs = chunks.map((_, i) => vec768((j) => (j === 0 ? i : 0)));
    store.upsertChunks(id, chunks, embs);

    // Read back ordered by chunk_index and verify
    const rows = db
        .prepare('SELECT chunk_index, text FROM kb_chunks WHERE doc_id = ? ORDER BY chunk_index')
        .all(id);
    assertEq(rows.length, 4, 'chunks length');
    for (let i = 0; i < 4; i++) {
        assertEq(rows[i].chunk_index, i, `chunk ${i} chunk_index`);
        assertEq(rows[i].text, chunks[i], `chunk ${i} text`);
    }

    // listDocuments chunkCount reflects the upsert
    const docs = store.listDocuments();
    assertEq(docs[0].chunkCount, 4, 'chunkCount after upsert');
    db.close();
    log('upsertChunks preserves order and count', true);
});

// ─────────────────────────────────────────────────────────────────────────
// Test 3: upsertChunks rejects mismatched chunks/embeddings lengths
// ─────────────────────────────────────────────────────────────────────────
run('Test 3: upsertChunks rejects mismatched lengths', () => {
    const db = freshDb();
    const store = new KnowledgeStore(db);
    const id = store.insertDocument(DOC_META());

    let thrown = null;
    try {
        store.upsertChunks(id, ['a', 'b', 'c'], [vec768(() => 1)]);
    } catch (e) {
        thrown = e;
    }
    assertTrue(
        thrown instanceof KnowledgeStoreInvariantError,
        'throws KnowledgeStoreInvariantError'
    );
    // Nothing should have been written — verify chunkCount is still 0
    const docs = store.listDocuments();
    assertEq(docs[0].chunkCount, 0, 'no chunks written on rejection');
    db.close();
    log('upsertChunks rejects mismatched lengths', true);
});

// ─────────────────────────────────────────────────────────────────────────
// Test 4: upsertChunks rejects non-768 embeddings (KnowledgeDimensionError)
// ─────────────────────────────────────────────────────────────────────────
run('Test 4: upsertChunks rejects non-768 embeddings', () => {
    const db = freshDb();
    const store = new KnowledgeStore(db);
    const id = store.insertDocument(DOC_META());

    const bad512 = new Float32Array(512);
    let thrown = null;
    try {
        store.upsertChunks(id, ['chunk'], [bad512]);
    } catch (e) {
        thrown = e;
    }
    assertTrue(
        thrown instanceof KnowledgeDimensionError,
        'throws KnowledgeDimensionError'
    );
    assertTrue(
        thrown.message.includes('768') && thrown.message.includes('512'),
        'error message mentions 768 and 512'
    );
    // No rows written
    const docs = store.listDocuments();
    assertEq(docs[0].chunkCount, 0, 'no chunks written on dim rejection');
    db.close();
    log('upsertChunks rejects non-768 embeddings', true);
});

// ─────────────────────────────────────────────────────────────────────────
// Test 5: searchByEmbedding returns best-first ordering
//
// Store three chunks with hand-crafted vectors:
//   A: [1, 0, ..., 0]             — exact match to query
//   B: [0.707, 0.707, 0, ..., 0]  — 45° off query
//   C: [-1, 0, ..., 0]            — opposite of query
//
// Query = [1, 0, ..., 0]. Expected order: A < B < C by cosine distance.
// ─────────────────────────────────────────────────────────────────────────
run('Test 5: searchByEmbedding best-first ordering', () => {
    const db = freshDb();
    const store = new KnowledgeStore(db);
    const id = store.insertDocument(DOC_META());

    const vecA = vec768((i) => (i === 0 ? 1 : 0));
    const vecB = vec768((i) => (i < 2 ? Math.SQRT1_2 : 0));
    const vecC = vec768((i) => (i === 0 ? -1 : 0));
    store.upsertChunks(
        id,
        ['A identical', 'B forty-five', 'C opposite'],
        [vecA, vecB, vecC]
    );

    const query = vec768((i) => (i === 0 ? 1 : 0));
    const hits = store.searchByEmbedding(query, 3);
    assertEq(hits.length, 3, 'hits length');
    // Best match first: A, then B, then C
    assertEq(hits[0].text, 'A identical', 'best match text');
    assertEq(hits[1].text, 'B forty-five', 'second best text');
    assertEq(hits[2].text, 'C opposite', 'worst match text');
    // Distances monotonic ascending
    assertTrue(hits[0].distance < hits[1].distance, 'd0 < d1');
    assertTrue(hits[1].distance < hits[2].distance, 'd1 < d2');
    // Document metadata propagated through the join
    assertEq(hits[0].documentId, id, 'documentId from join');
    assertEq(hits[0].documentName, 'resume.pdf', 'documentName from join');
    assertEq(hits[0].chunkIndex, 0, 'chunkIndex propagated');
    db.close();
    log('searchByEmbedding best-first ordering', true);
});

// ─────────────────────────────────────────────────────────────────────────
// Test 5b: searchByEmbedding rejects non-768 query vectors
// ─────────────────────────────────────────────────────────────────────────
run('Test 5b: searchByEmbedding rejects non-768 query', () => {
    const db = freshDb();
    const store = new KnowledgeStore(db);
    const bad = new Float32Array(100);
    let thrown = null;
    try {
        store.searchByEmbedding(bad, 5);
    } catch (e) {
        thrown = e;
    }
    assertTrue(
        thrown instanceof KnowledgeDimensionError,
        'throws KnowledgeDimensionError on non-768 query'
    );
    db.close();
    log('searchByEmbedding rejects non-768 query', true);
});

// ─────────────────────────────────────────────────────────────────────────
// Test 6: setPinned toggles state and pinnedAt correctly
// ─────────────────────────────────────────────────────────────────────────
run('Test 6: setPinned toggles pinned state and pinnedAt', () => {
    const db = freshDb();
    const store = new KnowledgeStore(db);
    const id = store.insertDocument(DOC_META());

    // Pin
    const pinned = store.setPinned(id, true);
    assertTrue(typeof pinned.pinnedAt === 'string' && pinned.pinnedAt.length > 0, 'pinnedAt set on pin');
    const afterPin = store.listDocuments()[0];
    assertEq(afterPin.pinned, true, 'pinned flag true');
    assertEq(afterPin.pinnedAt, pinned.pinnedAt, 'pinnedAt matches return');

    // Unpin
    const unpinned = store.setPinned(id, false);
    assertEq(unpinned.pinnedAt, null, 'pinnedAt null on unpin');
    const afterUnpin = store.listDocuments()[0];
    assertEq(afterUnpin.pinned, false, 'pinned flag false');
    assertEq(afterUnpin.pinnedAt, null, 'pinnedAt null in list');
    db.close();
    log('setPinned toggles state and pinnedAt', true);
});

// ─────────────────────────────────────────────────────────────────────────
// Test 7: listPinned returns only pinned docs in stable order
// ─────────────────────────────────────────────────────────────────────────
run('Test 7: listPinned returns only pinned docs, ordered', () => {
    const db = freshDb();
    const store = new KnowledgeStore(db);
    const idA = store.insertDocument({ ...DOC_META(), name: 'A.pdf' });
    const idB = store.insertDocument({ ...DOC_META(), name: 'B.pdf' });
    const idC = store.insertDocument({ ...DOC_META(), name: 'C.pdf' });

    // Pin B first, then A. C stays unpinned.
    // Force a SQL-level time gap by advancing pinned_at via a direct
    // update (datetime('now') has second-level precision which isn't
    // enough to guarantee ordering in a fast test).
    store.setPinned(idB, true);
    db.prepare("UPDATE kb_documents SET pinned_at = '2025-01-01 00:00:00' WHERE id = ?").run(idB);
    store.setPinned(idA, true);
    db.prepare("UPDATE kb_documents SET pinned_at = '2025-01-02 00:00:00' WHERE id = ?").run(idA);

    const pinned = store.listPinned();
    assertEq(pinned.length, 2, 'only pinned docs returned');
    assertEq(pinned[0].id, idB, 'first pinned (oldest pin) is B');
    assertEq(pinned[1].id, idA, 'second pinned is A');
    // C not present
    assertTrue(
        !pinned.some((d) => d.id === idC),
        'unpinned C not in listPinned'
    );
    db.close();
    log('listPinned returns only pinned docs, ordered', true);
});

// ─────────────────────────────────────────────────────────────────────────
// Test 8: getDocumentText concatenates by chunk_index
// ─────────────────────────────────────────────────────────────────────────
run('Test 8: getDocumentText concatenates by chunk_index', () => {
    const db = freshDb();
    const store = new KnowledgeStore(db);
    const id = store.insertDocument(DOC_META());

    const chunks = ['alpha', 'beta', 'gamma'];
    const embs = chunks.map((_, i) => vec768((j) => (j === 0 ? i : 0)));
    store.upsertChunks(id, chunks, embs);

    const text = store.getDocumentText(id);
    assertEq(text, 'alpha\n\nbeta\n\ngamma', 'concatenated text');
    db.close();
    log('getDocumentText concatenates by chunk_index', true);
});

// ─────────────────────────────────────────────────────────────────────────
// Test 9: deleteDocument removes rows from all three tables
// ─────────────────────────────────────────────────────────────────────────
run('Test 9: deleteDocument removes kb_documents, kb_chunks, vec_kb_chunks', () => {
    const db = freshDb();
    const store = new KnowledgeStore(db);
    const id = store.insertDocument(DOC_META());
    store.upsertChunks(
        id,
        ['x', 'y'],
        [vec768((i) => (i === 0 ? 1 : 0)), vec768((i) => (i === 1 ? 1 : 0))]
    );

    // Pre-delete assertions
    assertEq(
        db.prepare('SELECT COUNT(*) AS n FROM kb_documents').get().n,
        1,
        'pre-delete doc count'
    );
    assertEq(
        db.prepare('SELECT COUNT(*) AS n FROM kb_chunks').get().n,
        2,
        'pre-delete chunk count'
    );
    assertEq(
        db.prepare('SELECT COUNT(*) AS n FROM vec_kb_chunks').get().n,
        2,
        'pre-delete vec count'
    );

    store.deleteDocument(id);

    // Post-delete: all three tables empty
    assertEq(
        db.prepare('SELECT COUNT(*) AS n FROM kb_documents').get().n,
        0,
        'post-delete doc count'
    );
    assertEq(
        db.prepare('SELECT COUNT(*) AS n FROM kb_chunks').get().n,
        0,
        'post-delete chunk count'
    );
    assertEq(
        db.prepare('SELECT COUNT(*) AS n FROM vec_kb_chunks').get().n,
        0,
        'post-delete vec count'
    );

    // deleteDocument on a non-existent id → KnowledgeNotFoundError
    let thrown = null;
    try {
        store.deleteDocument(id);
    } catch (e) {
        thrown = e;
    }
    assertTrue(
        thrown instanceof KnowledgeNotFoundError,
        'delete on missing id throws KnowledgeNotFoundError'
    );
    db.close();
    log('deleteDocument removes all three tables', true);
});

// ─────────────────────────────────────────────────────────────────────────
// Test 10: re-upsert on same doc replaces old chunk/vector rows cleanly
// ─────────────────────────────────────────────────────────────────────────
run('Test 10: re-upsert replaces old chunks cleanly', () => {
    const db = freshDb();
    const store = new KnowledgeStore(db);
    const id = store.insertDocument(DOC_META());

    // First upsert: 3 chunks
    store.upsertChunks(
        id,
        ['old1', 'old2', 'old3'],
        [
            vec768((i) => (i === 0 ? 1 : 0)),
            vec768((i) => (i === 1 ? 1 : 0)),
            vec768((i) => (i === 2 ? 1 : 0)),
        ]
    );
    assertEq(
        db.prepare('SELECT COUNT(*) AS n FROM kb_chunks WHERE doc_id = ?').get(id).n,
        3,
        'first upsert count'
    );
    assertEq(
        db.prepare('SELECT COUNT(*) AS n FROM vec_kb_chunks').get().n,
        3,
        'first upsert vec count'
    );

    // Second upsert: 2 chunks (fewer than before)
    store.upsertChunks(
        id,
        ['new1', 'new2'],
        [vec768((i) => (i === 3 ? 1 : 0)), vec768((i) => (i === 4 ? 1 : 0))]
    );
    assertEq(
        db.prepare('SELECT COUNT(*) AS n FROM kb_chunks WHERE doc_id = ?').get(id).n,
        2,
        'second upsert count (replaced, not appended)'
    );
    assertEq(
        db.prepare('SELECT COUNT(*) AS n FROM vec_kb_chunks').get().n,
        2,
        'second upsert vec count (old vec rows gone)'
    );
    // Texts match new content
    const rows = db
        .prepare('SELECT text FROM kb_chunks WHERE doc_id = ? ORDER BY chunk_index')
        .all(id);
    assertEq(rows[0].text, 'new1', 'replaced text 0');
    assertEq(rows[1].text, 'new2', 'replaced text 1');
    db.close();
    log('re-upsert replaces old chunks cleanly', true);
});

// ─────────────────────────────────────────────────────────────────────────
// Test 11: zero-chunk document remains valid across list/delete/getText
// ─────────────────────────────────────────────────────────────────────────
run('Test 11: zero-chunk document remains valid', () => {
    const db = freshDb();
    const store = new KnowledgeStore(db);
    const id = store.insertDocument(DOC_META());

    // No upsertChunks call — document has zero chunks
    const docs = store.listDocuments();
    assertEq(docs.length, 1, 'zero-chunk doc listed');
    assertEq(docs[0].chunkCount, 0, 'chunkCount 0');

    // getDocumentText on zero-chunk doc returns empty string (not throw)
    const text = store.getDocumentText(id);
    assertEq(text, '', 'getDocumentText empty string on zero chunks');

    // setPinned still works
    const pin = store.setPinned(id, true);
    assertTrue(typeof pin.pinnedAt === 'string', 'pin on zero-chunk doc');

    // deleteDocument still works
    store.deleteDocument(id);
    assertEq(store.listDocuments().length, 0, 'doc deleted');
    db.close();
    log('zero-chunk document remains valid', true);
});

// ─────────────────────────────────────────────────────────────────────────
// Test 12: getDocumentText on missing id throws KnowledgeNotFoundError
// ─────────────────────────────────────────────────────────────────────────
run('Test 12: getDocumentText on missing id throws', () => {
    const db = freshDb();
    const store = new KnowledgeStore(db);
    let thrown = null;
    try {
        store.getDocumentText('nonexistent-id');
    } catch (e) {
        thrown = e;
    }
    assertTrue(
        thrown instanceof KnowledgeNotFoundError,
        'throws KnowledgeNotFoundError on missing id'
    );
    db.close();
    log('getDocumentText on missing id throws', true);
});

// ─────────────────────────────────────────────────────────────────────────
// Test 13: insertDocument rejects non-768 embeddingDim
// ─────────────────────────────────────────────────────────────────────────
run('Test 13: insertDocument rejects non-768 embedding_dim', () => {
    const db = freshDb();
    const store = new KnowledgeStore(db);
    let thrown = null;
    try {
        store.insertDocument({
            name: 'x.pdf',
            mime: 'application/pdf',
            bytes: 1,
            embeddingModel: 'text-embedding-3-small',
            embeddingDim: 1536,
        });
    } catch (e) {
        thrown = e;
    }
    assertTrue(
        thrown instanceof KnowledgeDimensionError,
        'throws KnowledgeDimensionError on non-768 embedding_dim'
    );
    // No doc row should have been written
    assertEq(
        db.prepare('SELECT COUNT(*) AS n FROM kb_documents').get().n,
        0,
        'no doc row written on dim rejection'
    );
    db.close();
    log('insertDocument rejects non-768 embedding_dim', true);
});

// ─────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

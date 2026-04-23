// sensi M4-T10 — KnowledgeStore transfer-support integration test.
//
// Runs under Electron's Node runtime (ABI 130) to exercise the real
// better-sqlite3 + sqlite-vec path for the two new M4-T10 methods:
//   - KnowledgeStore.getDocumentChunksWithEmbeddings(docId)
//   - KnowledgeStore.replaceAllFromArtifact(docs)
//
// Vitest can unit-test the pure transfer module against in-memory
// stubs, but it cannot execute SQL against the ABI-locked native
// module. This runner fills that gap with 5 targeted tests that
// verify the DB round-trip matches what the pure tests assert at
// the type level.
//
// Run:
//   npm run test:kb-transfer
// or:
//   cross-env ELECTRON_RUN_AS_NODE=1 electron electron/__tests__/knowledgeTransfer.electron.cjs
//
// Exit code: 0 on all-pass, 1 on any failure.

const Database = require('better-sqlite3');
const sqliteVec = require('sqlite-vec');

const {
    KnowledgeStore,
} = require('../../dist-electron/electron/knowledge/KnowledgeStore');

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

function assertClose(a, b, eps, label) {
    if (Math.abs(a - b) > eps) {
        throw new Error(`${label}: expected ${b} (±${eps}), got ${a}`);
    }
}

function assertTrue(cond, label) {
    if (!cond) throw new Error(`${label}: expected true, got false`);
}

function freshDb() {
    const db = new Database(':memory:');
    sqliteVec.load(db);
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
    db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_kb_chunks USING vec0(
            chunk_id INTEGER PRIMARY KEY,
            embedding float[768]
        );
    `);
    return db;
}

function vec768(fn) {
    const a = new Float32Array(768);
    for (let i = 0; i < 768; i++) a[i] = fn(i);
    return a;
}

function exportedChunk(idx, text, embeddingFn) {
    return {
        chunkIndex: idx,
        text,
        embedding: Array.from({ length: 768 }, (_, i) => embeddingFn(i)),
    };
}

function exportedDoc(overrides) {
    return {
        name: 'default.txt',
        mime: 'text/plain',
        bytes: 100,
        embeddingModel: 'nomic-embed-text',
        embeddingDim: 768,
        pinned: false,
        pinnedAt: null,
        ingestedAt: '2026-04-14T00:00:00.000Z',
        chunks: [],
        ...overrides,
    };
}

function run(name, fn) {
    try {
        fn();
    } catch (e) {
        log(name, false, e.message || String(e));
    }
}

// ─────────────────────────────────────────────────────────────────────
// Test 1: getDocumentChunksWithEmbeddings round-trips Float32 data
// ─────────────────────────────────────────────────────────────────────
run('Test 1: getDocumentChunksWithEmbeddings decodes stored Float32 blob', () => {
    const db = freshDb();
    const store = new KnowledgeStore(db);
    const id = store.insertDocument({
        name: 'a.txt',
        mime: 'text/plain',
        bytes: 20,
        embeddingModel: 'nomic-embed-text',
        embeddingDim: 768,
    });
    const chunks = ['first chunk text', 'second chunk text'];
    const embeddings = [
        vec768((i) => i * 0.001),
        vec768((i) => 0.5 + i * 0.0005),
    ];
    store.upsertChunks(id, chunks, embeddings);

    const out = store.getDocumentChunksWithEmbeddings(id);
    assertEq(out.length, 2, 'two chunks returned');
    assertEq(out[0].chunkIndex, 0, 'chunk 0 index');
    assertEq(out[0].text, 'first chunk text', 'chunk 0 text');
    assertEq(out[0].embedding.length, 768, 'chunk 0 embedding length');
    assertClose(out[0].embedding[0], 0.0, 1e-6, 'chunk 0 embedding[0]');
    assertClose(out[0].embedding[100], 0.1, 1e-6, 'chunk 0 embedding[100]');
    assertClose(out[1].embedding[0], 0.5, 1e-6, 'chunk 1 embedding[0]');
    log('Test 1: getDocumentChunksWithEmbeddings decodes stored Float32 blob', true, `${out.length} chunks, embedding[0]=${out[0].embedding[0]}`);
});

// ─────────────────────────────────────────────────────────────────────
// Test 2: replaceAllFromArtifact wipes + inserts cleanly
// ─────────────────────────────────────────────────────────────────────
run('Test 2: replaceAllFromArtifact wipes existing and inserts new', () => {
    const db = freshDb();
    const store = new KnowledgeStore(db);

    // Seed two existing documents
    const id1 = store.insertDocument({
        name: 'old1.txt',
        mime: 'text/plain',
        bytes: 10,
        embeddingModel: 'nomic-embed-text',
        embeddingDim: 768,
    });
    store.upsertChunks(id1, ['old chunk 1'], [vec768(() => 0.1)]);

    const id2 = store.insertDocument({
        name: 'old2.txt',
        mime: 'text/plain',
        bytes: 20,
        embeddingModel: 'nomic-embed-text',
        embeddingDim: 768,
    });
    store.upsertChunks(id2, ['old chunk 2'], [vec768(() => 0.2)]);

    assertEq(store.listDocuments().length, 2, 'seeded two docs');

    // Replace with three new docs
    const newDocs = [
        exportedDoc({
            name: 'new1.txt',
            chunks: [
                exportedChunk(0, 'new chunk a', (i) => i * 0.002),
                exportedChunk(1, 'new chunk b', (i) => i * 0.003),
            ],
        }),
        exportedDoc({
            name: 'new2.txt',
            pinned: true,
            pinnedAt: '2026-04-14T12:00:00.000Z',
            chunks: [exportedChunk(0, 'pinned content', (i) => 0.5 + i * 0.0001)],
        }),
        exportedDoc({ name: 'empty.txt', chunks: [] }), // zero-chunk doc
    ];

    const result = store.replaceAllFromArtifact(newDocs);
    assertEq(result.replaced, 2, 'replaced old count');
    assertEq(result.imported, 3, 'imported new count');

    const final = store.listDocuments();
    assertEq(final.length, 3, 'three docs after replace');
    // Names should match the new set
    const names = final.map((d) => d.name).sort();
    assertEq(names[0], 'empty.txt', 'name sort 0');
    assertEq(names[1], 'new1.txt', 'name sort 1');
    assertEq(names[2], 'new2.txt', 'name sort 2');
    log('Test 2: replaceAllFromArtifact wipes existing and inserts new', true, `replaced=${result.replaced} imported=${result.imported}`);
});

// ─────────────────────────────────────────────────────────────────────
// Test 3: pinned state survives replaceAllFromArtifact
// ─────────────────────────────────────────────────────────────────────
run('Test 3: replaceAllFromArtifact preserves pinned flag + pinnedAt', () => {
    const db = freshDb();
    const store = new KnowledgeStore(db);

    const newDocs = [
        exportedDoc({
            name: 'pinned.txt',
            pinned: true,
            pinnedAt: '2026-03-01T08:00:00.000Z',
            chunks: [exportedChunk(0, 'x', () => 0.1)],
        }),
        exportedDoc({
            name: 'unpinned.txt',
            pinned: false,
            pinnedAt: null,
            chunks: [exportedChunk(0, 'y', () => 0.2)],
        }),
    ];

    store.replaceAllFromArtifact(newDocs);
    const pinnedList = store.listPinned();
    assertEq(pinnedList.length, 1, 'one pinned doc');
    assertEq(pinnedList[0].name, 'pinned.txt', 'pinned name');
    assertEq(pinnedList[0].pinnedAt, '2026-03-01T08:00:00.000Z', 'pinned timestamp preserved');
    log('Test 3: replaceAllFromArtifact preserves pinned flag + pinnedAt', true, `pinned=${pinnedList.length}`);
});

// ─────────────────────────────────────────────────────────────────────
// Test 4: embeddings are searchable after replaceAllFromArtifact
// (validates that vec_kb_chunks was populated correctly)
// ─────────────────────────────────────────────────────────────────────
run('Test 4: searchByEmbedding works after replaceAllFromArtifact', () => {
    const db = freshDb();
    const store = new KnowledgeStore(db);

    // Insert two docs where the second doc's embedding matches a
    // distinctive query vector.
    const newDocs = [
        exportedDoc({
            name: 'unrelated.txt',
            chunks: [exportedChunk(0, 'unrelated', () => 0.9)],
        }),
        exportedDoc({
            name: 'target.txt',
            chunks: [exportedChunk(0, 'target hit', (i) => i === 0 ? 1.0 : 0.0)],
        }),
    ];
    store.replaceAllFromArtifact(newDocs);

    const query = new Float32Array(768);
    query[0] = 1.0;
    const hits = store.searchByEmbedding(query, 2);
    assertTrue(hits.length >= 1, 'at least one hit');
    assertEq(hits[0].text, 'target hit', 'closest chunk text');
    assertEq(hits[0].documentName, 'target.txt', 'closest document name');
    log('Test 4: searchByEmbedding works after replaceAllFromArtifact', true, `hits=${hits.length} closest="${hits[0].text}"`);
});

// ─────────────────────────────────────────────────────────────────────
// Test 5: replaceAllFromArtifact rolls back on bad chunk dimension
// ─────────────────────────────────────────────────────────────────────
run('Test 5: replaceAllFromArtifact rejects wrong-dim chunk atomically', () => {
    const db = freshDb();
    const store = new KnowledgeStore(db);

    // Seed with one existing doc
    const id = store.insertDocument({
        name: 'keep.txt',
        mime: 'text/plain',
        bytes: 5,
        embeddingModel: 'nomic-embed-text',
        embeddingDim: 768,
    });
    store.upsertChunks(id, ['preserve me'], [vec768(() => 0.1)]);

    const badDocs = [
        exportedDoc({
            name: 'bad.txt',
            chunks: [
                {
                    chunkIndex: 0,
                    text: 'bad chunk',
                    embedding: [0.1, 0.2, 0.3], // wrong length
                },
            ],
        }),
    ];

    let threw = false;
    try {
        store.replaceAllFromArtifact(badDocs);
    } catch (e) {
        threw = true;
    }
    assertTrue(threw, 'replace threw on bad dim');

    // Because pre-validation runs BEFORE the transaction starts, the
    // store should be untouched.
    const after = store.listDocuments();
    assertEq(after.length, 1, 'existing doc preserved after rejection');
    assertEq(after[0].name, 'keep.txt', 'existing name preserved');
    log('Test 5: replaceAllFromArtifact rejects wrong-dim chunk atomically', true, 'threw and preserved existing');
});

// ─────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────
console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

// sensi M4-T1 — knowledge base schema tests.
//
// Why this script instead of vitest:
//   better-sqlite3's compiled .node binary is rebuilt by `postinstall`
//   (electron-rebuild -w better-sqlite3 -f) against Electron 33's
//   NODE_MODULE_VERSION 130. Vitest workers run under plain Node (ABI 137
//   on the current dev machine), and `new Database()` throws
//   ERR_DLOPEN_FAILED when loaded under the wrong ABI. The existing
//   vitest suite only exercises pure functions from DatabaseManager
//   (migrateDbFilename) that never construct a Database. Tests that
//   need a real sqlite handle + sqlite-vec extension must run under
//   Electron's Node runtime.
//
// Run:
//   npm run test:kb-schema
// or:
//   cross-env ELECTRON_RUN_AS_NODE=1 electron electron/__tests__/knowledgeSchema.electron.cjs
//
// Exit code: 0 on all tests passing, 1 on any failure.

const Database = require('better-sqlite3');
const sqliteVec = require('sqlite-vec');

// Schema SQL. KEEP IN SYNC with DatabaseManager.createKnowledgeTables().
// Drift between this and the real method only affects schema-match
// fidelity in this test — the idempotency test (#4) still exercises the
// same invariant, and test #2 / #3 still prove sqlite-vec's runtime
// behavior with the literal 768-dim float vec0 virtual table we ship.
const KB_SCALAR_SQL = `
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

    CREATE INDEX IF NOT EXISTS idx_kb_chunks_doc_id
        ON kb_chunks(doc_id);
`;

const KB_VEC_SQL = `
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_kb_chunks USING vec0(
        chunk_id INTEGER PRIMARY KEY,
        embedding float[768]
    );
`;

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

function freshDb() {
    const db = new Database(':memory:');
    sqliteVec.load(db);
    return db;
}

// Helper: create a 768-dim Float32Array and pack it as a Buffer the way
// sqlite-vec expects (raw little-endian float32 bytes).
function vec768(fn) {
    const a = new Float32Array(768);
    for (let i = 0; i < 768; i++) a[i] = fn(i);
    return Buffer.from(a.buffer);
}

// ─────────────────────────────────────────────────────────────────────────
// Test 1: sqlite-vec load probe.
//   vec_version() returns a non-empty string.
// ─────────────────────────────────────────────────────────────────────────
console.log('\nTest 1: vec_version() returns non-empty string');
try {
    const db = freshDb();
    const version = db.prepare('SELECT vec_version()').pluck().get();
    const ok = typeof version === 'string' && version.length > 0;
    log('vec_version() non-empty', ok, `version=${version}`);
    db.close();
} catch (e) {
    log('vec_version() non-empty', false, e.message);
}

// ─────────────────────────────────────────────────────────────────────────
// Test 2: Insert a 768-dim vector and read it back.
//   Verifies that the declared `float[768]` schema actually enforces
//   768-dimensional storage and that better-sqlite3 + sqlite-vec can
//   round-trip a Float32Array.
// ─────────────────────────────────────────────────────────────────────────
console.log('\nTest 2: Insert 768-dim vector and read back');
try {
    const db = freshDb();
    db.exec(KB_SCALAR_SQL);
    db.exec(KB_VEC_SQL);

    // Deterministic non-zero pattern — each dim gets i/1000
    const buf = vec768((i) => (i + 1) / 1000);
    // NOTE: sqlite-vec v0.1.7-alpha.2 REQUIRES BigInt bindings for primary
    // key integer columns. A plain JS `number` like `1` is rejected with
    // "Only integers are allows for primary key values on vec_kb_chunks"
    // even though better-sqlite3 binds it via sqlite3_bind_int64. The M4-T4
    // KnowledgeStore CRUD layer must follow the same BigInt convention.
    db.prepare(
        'INSERT INTO vec_kb_chunks(chunk_id, embedding) VALUES (?, ?)'
    ).run(BigInt(1), buf);

    const row = db.prepare(
        'SELECT vec_to_json(embedding) AS json FROM vec_kb_chunks WHERE chunk_id = ?'
    ).get(BigInt(1));
    const parsed = JSON.parse(row.json);

    const ok =
        Array.isArray(parsed) &&
        parsed.length === 768 &&
        Math.abs(parsed[0] - 0.001) < 1e-5 &&
        Math.abs(parsed[767] - 0.768) < 1e-5;
    log('read back length == 768 with correct values', ok,
        `length=${parsed.length} first=${parsed[0]} last=${parsed[767]}`);
    db.close();
} catch (e) {
    log('read back length == 768', false, e.message);
}

// ─────────────────────────────────────────────────────────────────────────
// Test 3: vec_distance_cosine returns correct ordering on 3 hand-crafted
// vectors.
//
//   Query vector:     q   = [1, 0, 0, ..., 0]    (first dim 1, rest 0)
//   Stored vectors:
//     A (chunk_id 1): [1, 0, 0, ..., 0]          — identical, cosine distance 0
//     B (chunk_id 2): [0.707, 0.707, 0, ..., 0]  — 45° off, distance ~0.29
//     C (chunk_id 3): [-1, 0, 0, ..., 0]         — opposite, distance ~2
//
//   Expected ranking (ascending distance): A < B < C
// ─────────────────────────────────────────────────────────────────────────
console.log('\nTest 3: vec_distance_cosine correct ordering on 3 vectors');
try {
    const db = freshDb();
    db.exec(KB_SCALAR_SQL);
    db.exec(KB_VEC_SQL);

    const vecA = vec768((i) => (i === 0 ? 1 : 0));
    const vecB = vec768((i) => (i < 2 ? Math.SQRT1_2 : 0));
    const vecC = vec768((i) => (i === 0 ? -1 : 0));

    const insert = db.prepare(
        'INSERT INTO vec_kb_chunks(chunk_id, embedding) VALUES (?, ?)'
    );
    // BigInt bindings required — see Test 2 note.
    insert.run(BigInt(1), vecA);
    insert.run(BigInt(2), vecB);
    insert.run(BigInt(3), vecC);

    // Query via MATCH k=3, ordered by distance ascending.
    const query = vec768((i) => (i === 0 ? 1 : 0));
    const rows = db.prepare(
        'SELECT chunk_id, distance FROM vec_kb_chunks ' +
        'WHERE embedding MATCH ? AND k = 3 ORDER BY distance'
    ).all(query);

    const ids = rows.map((r) => Number(r.chunk_id));
    const distances = rows.map((r) => Number(r.distance).toFixed(3));
    const orderOk =
        ids.length === 3 && ids[0] === 1 && ids[1] === 2 && ids[2] === 3;

    log(
        'ordering is A(id=1) < B(id=2) < C(id=3)',
        orderOk,
        `ids=${ids.join(',')} distances=${distances.join(',')}`
    );
    db.close();
} catch (e) {
    log('ordering A < B < C', false, e.message);
}

// ─────────────────────────────────────────────────────────────────────────
// Test 4: Idempotency — running the schema DDL twice must not throw.
//   Mirrors the M2-T4 migrateDbFilename idempotency pattern and proves
//   that calling DatabaseManager.createKnowledgeTables() on every launch
//   is safe.
// ─────────────────────────────────────────────────────────────────────────
console.log('\nTest 4: createKnowledgeTables SQL is idempotent');
try {
    const db = freshDb();

    // First pass — fresh tables
    db.exec(KB_SCALAR_SQL);
    db.exec(KB_VEC_SQL);

    // Insert a doc + chunk + vector so the second pass runs against
    // non-empty tables (more realistic than empty DDL re-run).
    db.prepare(
        'INSERT INTO kb_documents(id, name, mime, bytes, embedding_model, embedding_dim) ' +
        'VALUES (?, ?, ?, ?, ?, ?)'
    ).run('doc-1', 'resume.pdf', 'application/pdf', 42, 'nomic-embed-text', 768);

    db.prepare(
        'INSERT INTO kb_chunks(id, doc_id, chunk_index, text) VALUES (?, ?, ?, ?)'
    ).run('chunk-1', 'doc-1', 0, 'hello world');

    db.prepare(
        'INSERT INTO vec_kb_chunks(chunk_id, embedding) VALUES (?, ?)'
    ).run(BigInt(42), vec768((i) => i / 768));

    // Second pass — must not throw, must not clobber existing rows
    db.exec(KB_SCALAR_SQL);
    db.exec(KB_VEC_SQL);

    // Confirm data survived
    const docCount = db.prepare('SELECT COUNT(*) AS c FROM kb_documents').get().c;
    const chunkCount = db.prepare('SELECT COUNT(*) AS c FROM kb_chunks').get().c;
    const vecCount = db.prepare('SELECT COUNT(*) AS c FROM vec_kb_chunks').get().c;

    const ok = docCount === 1 && chunkCount === 1 && vecCount === 1;
    log(
        'second DDL pass did not throw and preserved existing rows',
        ok,
        `docs=${docCount} chunks=${chunkCount} vecs=${vecCount}`
    );
    db.close();
} catch (e) {
    log('second DDL pass did not throw', false, e.message);
}

// ─────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

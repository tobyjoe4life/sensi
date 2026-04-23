/**
 * sensi M4-T5 — EmbeddingAdapter: 768-dim embedding provider selection.
 *
 * Produces 768-dim Float32 vectors for the knowledge-base pipeline. Main
 * process only. Renderer never imports this module — it interacts with
 * the knowledge base via the M4-T8 IPC surface (future task).
 *
 * Provider policy for M4 (strict — see DECISIONS.md D018):
 *   1. Primary: Ollama + nomic-embed-text (768-dim, local, free)
 *   2. Cloud fallback: Gemini gemini-embedding-001 with
 *      outputDimensionality: 768 (BYOK). KNOWLEDGE-FIX-02 swapped
 *      this from the earlier text-embedding-004 default after that
 *      model started returning 404 from v1beta for new keys.
 *   3. Unsupported: OpenAI text-embedding-3-small (1536-dim — would
 *      break the fixed 768-dim vec0 schema from M4-T1). No dimension
 *      reduction shim, no projection layer, no mixed-dim storage. If
 *      neither Ollama nor Gemini is available, embed() throws.
 *
 * Provider selection runs per embed() call:
 *   - Probe Ollama with a 500 ms timeout against /api/tags
 *   - If reachable → use Ollama
 *   - Else → read CredentialsManager.getGeminiApiKey()
 *   - If present → use Gemini
 *   - Else → KnowledgeEmbeddingProviderUnavailableError
 *
 * Tests inject deps via the constructor to avoid real network — see the
 * EmbeddingAdapterDeps interface below. Production uses the module-level
 * default implementations which hit real endpoints.
 *
 * Trust boundary: main process only. Two egress surfaces:
 *   - Ollama: http://127.0.0.1:11434 (localhost, no new external egress)
 *   - Gemini: https://generativelanguage.googleapis.com (already used by
 *     LLMHelper chat paths — M4-T5 adds the embeddings endpoint under
 *     the same host/credential, so no new trust boundary)
 */

import { CredentialsManager } from '../services/CredentialsManager';

// ─────────────────────────────────────────────────────────────────────────
// Typed errors
// ─────────────────────────────────────────────────────────────────────────

/**
 * Thrown when neither Ollama nor Gemini can produce embeddings right now:
 *   - Ollama is unreachable AND
 *   - no Gemini API key is configured in CredentialsManager
 */
export class KnowledgeEmbeddingProviderUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'KnowledgeEmbeddingProviderUnavailableError';
    }
}

/**
 * Thrown when a provider request fails for any reason — network error,
 * non-2xx response, malformed response body, or an input-contract
 * violation (empty/whitespace-only strings).
 */
export class KnowledgeEmbeddingRequestError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'KnowledgeEmbeddingRequestError';
    }
}

/**
 * Thrown when a provider returns a vector whose dimension does not match
 * the M4 fixed 768. This is a contract violation at the T5 ↔ T4 boundary:
 * KnowledgeStore.upsertChunks will throw KnowledgeDimensionError on any
 * non-768 vector, and we'd rather surface the problem at the adapter
 * layer with a clearer provider context.
 */
export class KnowledgeEmbeddingDimensionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'KnowledgeEmbeddingDimensionError';
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Public types and constants
// ─────────────────────────────────────────────────────────────────────────

export interface EmbeddingConfig {
    provider: 'ollama' | 'gemini';
    model: string;
    dimension: 768;
}

/**
 * Optional dependency-injection hooks. Omit entirely in production —
 * the adapter falls through to module-level defaults that hit real
 * endpoints. Tests override one or more hooks to avoid network.
 */
export interface EmbeddingAdapterDeps {
    probeOllama?: () => Promise<boolean>;
    embedWithOllama?: (texts: readonly string[]) => Promise<Float32Array[]>;
    embedWithGemini?: (texts: readonly string[], apiKey: string) => Promise<Float32Array[]>;
    getGeminiApiKey?: () => string | null;
}

// M4 dimension invariant — matches M4-T1 vec0 schema (float[768]) and
// M4-T4 KnowledgeStore validation.
const M4_EMBEDDING_DIM = 768;

// Ollama defaults. We use 127.0.0.1 rather than "localhost" to match the
// LLMHelper.ts:3206 pattern that normalizes localhost → 127.0.0.1 for
// sqlite-vec / Node fetch consistency on Windows.
const OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
const OLLAMA_EMBEDDING_MODEL = 'nomic-embed-text';
const OLLAMA_PROBE_TIMEOUT_MS = 500;
const OLLAMA_EMBED_TIMEOUT_MS = 30_000;

// Gemini defaults. KNOWLEDGE-FIX-02: gemini-embedding-001 is the
// current-generation Gemini embedding model exposed on v1beta. It
// natively returns 3072-dim vectors and supports Matryoshka truncation
// via `outputDimensionality`; we pin 768 to match the fixed vec0 schema
// from M4-T1 (see D018 for why the dim is fixed). The predecessor
// `text-embedding-004` was dropped after Google's 2025-2026 embeddings
// migration started returning 404 Not Found for new keys.
const GEMINI_EMBEDDING_MODEL = 'gemini-embedding-001';
const GEMINI_EMBEDDING_OUTPUT_DIM = 768;
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';
const GEMINI_EMBED_TIMEOUT_MS = 30_000;

// ─────────────────────────────────────────────────────────────────────────
// EmbeddingAdapter
// ─────────────────────────────────────────────────────────────────────────

export class EmbeddingAdapter {
    private active: EmbeddingConfig | null = null;
    private readonly probeOllama: () => Promise<boolean>;
    private readonly embedWithOllama: (texts: readonly string[]) => Promise<Float32Array[]>;
    private readonly embedWithGemini: (texts: readonly string[], apiKey: string) => Promise<Float32Array[]>;
    private readonly getGeminiApiKey: () => string | null;

    constructor(deps: EmbeddingAdapterDeps = {}) {
        this.probeOllama = deps.probeOllama ?? probeOllamaDefault;
        this.embedWithOllama = deps.embedWithOllama ?? embedWithOllamaDefault;
        this.embedWithGemini = deps.embedWithGemini ?? embedWithGeminiDefault;
        this.getGeminiApiKey =
            deps.getGeminiApiKey ??
            ((): string | null => CredentialsManager.getInstance().getGeminiApiKey() ?? null);
    }

    /**
     * Produce a 768-dim embedding for each input string. Preserves order
     * and count. Empty input array returns empty array without probing
     * any provider. Empty / whitespace-only strings in a non-empty input
     * array are contract violations and throw KnowledgeEmbeddingRequestError.
     */
    async embed(strings: readonly string[]): Promise<Float32Array[]> {
        if (strings.length === 0) return [];

        // Trim and validate every input up front so contract violations
        // surface before any network work. Rejecting empty strings is a
        // deliberate policy choice (D018): M4-T3's splitIntoChunks never
        // emits empty chunks, so any empty string here is a bug upstream
        // and should fail loudly rather than silently filter.
        const trimmed: string[] = new Array(strings.length);
        for (let i = 0; i < strings.length; i++) {
            const t = strings[i].trim();
            if (t.length === 0) {
                throw new KnowledgeEmbeddingRequestError(
                    `embed: input[${i}] is empty or whitespace-only — M4-T3 splitIntoChunks never emits empty chunks, so this indicates a contract violation upstream`
                );
            }
            trimmed[i] = t;
        }

        // Provider selection: Ollama first, then Gemini. No other
        // providers supported in M4 (see D018).
        const ollamaUp = await this.probeOllama();
        let vectors: Float32Array[];
        let resolvedConfig: EmbeddingConfig;

        if (ollamaUp) {
            vectors = await this.embedWithOllama(trimmed);
            resolvedConfig = {
                provider: 'ollama',
                model: OLLAMA_EMBEDDING_MODEL,
                dimension: M4_EMBEDDING_DIM,
            };
        } else {
            const key = this.getGeminiApiKey();
            if (!key) {
                throw new KnowledgeEmbeddingProviderUnavailableError(
                    'No embedding provider available: Ollama unreachable and no Gemini API key configured. ' +
                        'Start Ollama with `ollama pull nomic-embed-text` + `ollama serve`, or configure a Gemini API key in Settings → AI Providers.'
                );
            }
            vectors = await this.embedWithGemini(trimmed, key);
            resolvedConfig = {
                provider: 'gemini',
                model: GEMINI_EMBEDDING_MODEL,
                dimension: M4_EMBEDDING_DIM,
            };
        }

        // Post-condition validation: provider must return one vector per
        // input, every vector must be exactly 768 dims. Any mismatch is a
        // provider-contract violation and must surface with a clear error.
        if (vectors.length !== trimmed.length) {
            throw new KnowledgeEmbeddingRequestError(
                `embed: provider ${resolvedConfig.provider} returned ${vectors.length} vectors for ${trimmed.length} inputs`
            );
        }
        for (let i = 0; i < vectors.length; i++) {
            if (vectors[i].length !== M4_EMBEDDING_DIM) {
                throw new KnowledgeEmbeddingDimensionError(
                    `embed: provider ${resolvedConfig.provider} returned vector[${i}] with dim ${vectors[i].length}, expected ${M4_EMBEDDING_DIM}`
                );
            }
        }

        this.active = resolvedConfig;
        return vectors;
    }

    /**
     * Resolve the active embedding provider WITHOUT calling any embed
     * hook. Runs the same Ollama probe → Gemini key check as embed(),
     * but does NOT mutate `this.active` and does NOT consume any
     * embedding quota.
     *
     * Added in M4-T6 to support the zero-chunk ingestion path: the
     * orchestrator needs to know which provider/model to stamp into
     * kb_documents.embedding_model BEFORE it has any text to embed, and
     * calling embed(['probe']) with a throwaway string would burn a
     * Gemini API unit on every empty document. See DECISIONS.md D019a
     * for the rationale.
     *
     * Throws KnowledgeEmbeddingProviderUnavailableError if neither
     * provider is available — same failure mode as embed().
     */
    async resolveProvider(): Promise<EmbeddingConfig> {
        const ollamaUp = await this.probeOllama();
        if (ollamaUp) {
            return {
                provider: 'ollama',
                model: OLLAMA_EMBEDDING_MODEL,
                dimension: M4_EMBEDDING_DIM,
            };
        }
        const key = this.getGeminiApiKey();
        if (key) {
            return {
                provider: 'gemini',
                model: GEMINI_EMBEDDING_MODEL,
                dimension: M4_EMBEDDING_DIM,
            };
        }
        throw new KnowledgeEmbeddingProviderUnavailableError(
            'resolveProvider: Ollama unreachable and no Gemini API key configured. ' +
                'Start Ollama (`ollama serve`) or set a Gemini API key in Settings → AI Providers.'
        );
    }

    /**
     * Return the config of the last successful embed() call. Throws
     * KnowledgeEmbeddingProviderUnavailableError before any successful
     * call — there is no "default" provider until one has been resolved.
     */
    getActiveEmbeddingConfig(): EmbeddingConfig {
        if (!this.active) {
            throw new KnowledgeEmbeddingProviderUnavailableError(
                'getActiveEmbeddingConfig: no embedding call has resolved a provider yet'
            );
        }
        return this.active;
    }
}

// ═════════════════════════════════════════════════════════════════════════
// Default network implementations (bypassed by DI in tests)
// ═════════════════════════════════════════════════════════════════════════

/**
 * Pure helper — inspect a parsed `/api/tags` response and return true
 * only when a model whose base name (i.e. `:tag` suffix stripped)
 * matches `modelName` is present.
 *
 * Exported for unit tests. Production callers use `probeOllamaDefault`
 * which wraps this helper in a network fetch. Keep the helper
 * side-effect-free — any failure mode (null, non-object, missing
 * fields, entries of the wrong shape) must return false without
 * throwing.
 *
 * Rationale (KNOWLEDGE-FIX-01): the M4-T5 probe only checked whether
 * the Ollama daemon was reachable. That disagreed with the stricter
 * readiness check already used by `buildProviderStatus('ollama')` in
 * `ipcHandlers.ts`, which requires at least one installed model. This
 * helper closes the gap specifically for the knowledge subsystem's
 * embedding model — the only model the adapter actually uses.
 */
export function hasOllamaEmbeddingModel(
    tagsJson: unknown,
    modelName: string
): boolean {
    if (tagsJson === null || typeof tagsJson !== 'object') return false;
    const obj = tagsJson as Record<string, unknown>;
    const models = obj.models;
    if (!Array.isArray(models)) return false;
    for (const entry of models) {
        if (entry === null || typeof entry !== 'object') continue;
        const e = entry as Record<string, unknown>;
        // Ollama tags entries carry both `name` and `model` fields. Either
        // may carry the `:tag` suffix. Compare against the base name.
        const candidates: string[] = [];
        if (typeof e.name === 'string') candidates.push(e.name);
        if (typeof e.model === 'string') candidates.push(e.model);
        for (const candidate of candidates) {
            const base = candidate.split(':', 1)[0];
            if (base === modelName) return true;
        }
    }
    return false;
}

async function probeOllamaDefault(): Promise<boolean> {
    try {
        const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
            signal: AbortSignal.timeout(OLLAMA_PROBE_TIMEOUT_MS),
        });
        if (!res.ok) return false;
        // Parse the tags response and only report usable when the
        // specific embedding model we need is actually installed.
        // Any parse failure (malformed body) maps to "not up".
        const json: unknown = await res.json().catch((): unknown => null);
        return hasOllamaEmbeddingModel(json, OLLAMA_EMBEDDING_MODEL);
    } catch {
        // ECONNREFUSED, DNS failure, timeout, abort — all map to "not up"
        return false;
    }
}

async function embedWithOllamaDefault(texts: readonly string[]): Promise<Float32Array[]> {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: OLLAMA_EMBEDDING_MODEL,
            input: texts,
        }),
        signal: AbortSignal.timeout(OLLAMA_EMBED_TIMEOUT_MS),
    });
    if (!res.ok) {
        throw new KnowledgeEmbeddingRequestError(
            `Ollama /api/embed failed: ${res.status} ${res.statusText}`
        );
    }
    const json = (await res.json()) as { embeddings?: number[][] };
    if (!json.embeddings || !Array.isArray(json.embeddings)) {
        throw new KnowledgeEmbeddingRequestError(
            'Ollama /api/embed returned malformed response (missing embeddings[])'
        );
    }
    return json.embeddings.map((v) => Float32Array.from(v));
}

async function embedWithGeminiDefault(
    texts: readonly string[],
    apiKey: string
): Promise<Float32Array[]> {
    // batchEmbedContents: one request, N embeddings back. Order
    // preserved per Google's API contract.
    const url = `${GEMINI_BASE_URL}/v1beta/models/${GEMINI_EMBEDDING_MODEL}:batchEmbedContents?key=${encodeURIComponent(apiKey)}`;
    // KNOWLEDGE-FIX-02: gemini-embedding-001 defaults to 3072-dim.
    // Pin outputDimensionality: 768 per request so the returned vectors
    // match the fixed vec0 schema. The post-condition validator inside
    // `EmbeddingAdapter.embed` throws `KnowledgeEmbeddingDimensionError`
    // if the server returns a different length, which gates against
    // silently-wrong schema drift.
    const body = {
        requests: texts.map((text) => ({
            model: `models/${GEMINI_EMBEDDING_MODEL}`,
            content: { parts: [{ text }] },
            outputDimensionality: GEMINI_EMBEDDING_OUTPUT_DIM,
        })),
    };
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(GEMINI_EMBED_TIMEOUT_MS),
    });
    if (!res.ok) {
        // Do NOT include the URL in the error message — it contains the
        // API key. Status code + reason phrase is enough to diagnose.
        const errText = await res.text().catch(() => '<unreadable body>');
        throw new KnowledgeEmbeddingRequestError(
            `Gemini batchEmbedContents failed: ${res.status} ${res.statusText} — ${errText.slice(0, 200)}`
        );
    }
    const json = (await res.json()) as { embeddings?: { values: number[] }[] };
    if (!json.embeddings || !Array.isArray(json.embeddings)) {
        throw new KnowledgeEmbeddingRequestError(
            'Gemini batchEmbedContents returned malformed response (missing embeddings[])'
        );
    }
    return json.embeddings.map((e) => Float32Array.from(e.values));
}

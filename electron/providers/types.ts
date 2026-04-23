/**
 * Typed provider status shape used across the IPC boundary.
 *
 * Import paths:
 * - **Main process**: relative imports such as `./providers/types` from
 *   within `electron/`.
 * - **Renderer**: import via the Vite alias `@providers/types` (see
 *   `vite.config.mts` and the root `tsconfig.json` `paths` entry).
 *
 * This file is deliberately type-only — zero runtime code, zero Node
 * imports, zero Electron imports — so it loads cleanly in both processes
 * and can be safely bundled into the renderer without leaking main-process
 * code.
 *
 * Rule (DECISIONS.md D007): any IPC or function that reports provider
 * readiness returns `ProviderStatus`, never a bare `boolean`. The typed
 * shape lets the renderer distinguish "not configured" from "configured
 * but invalid key" from "configured, active, and healthy".
 *
 * See TASKS.md M1 Step 1 and PRD.md M1 for the multi-provider key vault.
 */

/**
 * Stable set of provider identifiers supported by sensi.
 *
 * Adding a provider: append the literal here, update
 * `electron/shared/standardCloudModels.ts` (for cloud providers) or the
 * Ollama discovery path (for local), and add a credential slot in
 * `electron/services/CredentialsManager.ts`.
 */
export type ProviderId =
    | 'sensi-managed'
    | 'minimax'
    | 'claude'
    | 'gemini'
    | 'groq'
    | 'openai'
    | 'ollama';

/**
 * Full snapshot of a single provider's session-level state.
 *
 * Returned from `llm:get-configured-providers` and
 * `llm:set-active-provider-and-model` IPC handlers.
 */
export interface ProviderStatus {
    /** Stable provider key. */
    provider: ProviderId;
    /**
     * True if the provider has a stored API key (for cloud providers) or
     * is reachable (for Ollama — the local server is running and has at
     * least one model installed).
     */
    configured: boolean;
    /** True if this provider is the session-active one right now. */
    active: boolean;
    /**
     * Available model IDs for this provider. For cloud providers this is
     * the static baseline from `STANDARD_CLOUD_MODELS` plus any user-set
     * `<provider>PreferredModel`. For Ollama this is the live list from
     * `getAvailableOllamaModels()`.
     */
    models: string[];
    /** Active model ID when `active` is true; `null` otherwise. */
    activeModel: string | null;
    /**
     * Populated when a recent key-validation or connection attempt failed.
     * M1 populates this only on synchronous failures in `setXApiKey` or
     * `test-llm-connection`; periodic health pings are deferred.
     */
    lastError?: string;
}

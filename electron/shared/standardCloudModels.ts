/**
 * Shared cloud-model registry used by both main and renderer processes.
 *
 * Import paths:
 * - **Main process**: relative imports such as `./shared/standardCloudModels`
 *   (or deeper from nested subdirectories). Electron's tsconfig has
 *   `rootDir: ".."` with a recursive TypeScript include glob, so this
 *   file compiles natively without extra configuration.
 * - **Renderer**: import via the Vite alias `@shared/standardCloudModels`
 *   (see `vite.config.mts` and the root `tsconfig.json` `paths` entry).
 *
 * This module must remain runtime-safe: no Node-only APIs, no Electron
 * imports, no renderer DOM references. It loads cleanly in either process.
 *
 * Adding a provider: append an entry here, add a matching `has<Provider>Key`
 * field on the `get-stored-credentials` IPC payload, and add a credential
 * slot in `electron/services/CredentialsManager.ts`. The UI picks up the
 * new provider automatically via `STANDARD_CLOUD_MODELS` iteration.
 *
 * See TASKS.md M1 Step 1 and DECISIONS.md D007 (typed ProviderStatus).
 */

export type ProviderKey =
    | 'gemini'
    | 'openai'
    | 'claude'
    | 'groq';

export type PreferredModelKey =
    | 'geminiPreferredModel'
    | 'openaiPreferredModel'
    | 'claudePreferredModel'
    | 'groqPreferredModel';

export interface CloudModelRegistryEntry {
    /**
     * Returns true if the user has a stored API key for this provider.
     * Called with the object returned by `window.electronAPI.getStoredCredentials()`
     * on the renderer side, so the parameter is loosely typed on purpose.
     */
    hasKeyCheck: (creds: any) => boolean;
    /** Stable model IDs that this provider supports (baseline list). */
    ids: string[];
    /** Display names paired with `ids` by index. */
    names: string[];
    /** Short one-line descriptions paired with `ids` by index. */
    descs: string[];
    /** Field name on `StoredCredentials` used to remember the user's preferred model for this provider. */
    pmKey: PreferredModelKey;
}

export const STANDARD_CLOUD_MODELS: Record<ProviderKey, CloudModelRegistryEntry> = {
    gemini: {
        hasKeyCheck: (creds) => !!creds?.hasGeminiKey,
        ids: ['gemini-3.1-flash-lite-preview', 'gemini-3.1-pro-preview'],
        names: ['Gemini 3.1 Flash', 'Gemini 3.1 Pro'],
        descs: ['Fastest • Multimodal', 'Reasoning • High Quality'],
        pmKey: 'geminiPreferredModel',
    },
    openai: {
        hasKeyCheck: (creds) => !!creds?.hasOpenaiKey,
        ids: ['gpt-5.4'],
        names: ['GPT 5.4'],
        descs: ['OpenAI'],
        pmKey: 'openaiPreferredModel',
    },
    claude: {
        hasKeyCheck: (creds) => !!creds?.hasClaudeKey,
        ids: ['claude-sonnet-4-6'],
        names: ['Sonnet 4.6'],
        descs: ['Anthropic'],
        pmKey: 'claudePreferredModel',
    },
    groq: {
        hasKeyCheck: (creds) => !!creds?.hasGroqKey,
        ids: ['llama-3.3-70b-versatile'],
        names: ['Groq Llama 3.3'],
        descs: ['Ultra Fast'],
        pmKey: 'groqPreferredModel',
    },
};

export const prettifyModelId = (id: string): string => {
    if (!id) return '';
    return id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};

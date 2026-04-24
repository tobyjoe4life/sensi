/**
 * CredentialsManager - Secure storage for API keys and service account paths
 * Uses Electron's safeStorage API for encryption at rest
 */

import { app, safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';
// sensi M1 Step 4: typed provider identifier shared across the IPC boundary.
// Imported via relative path because the electron build is transpile-only and
// does not rewrite path aliases — see vite.config.mts and DECISIONS.md D008.
import type { ProviderId } from '../providers/types';
// sensi M1 Step 5: static import so vitest resolves the module from .ts source.
// `standardCloudModels` has zero imports (no cycle risk), so loading it at file
// load time is safe — the original lazy `require()` was a defensive precaution
// that broke the test runner without providing real value.
import { STANDARD_CLOUD_MODELS } from '../shared/standardCloudModels';

const CREDENTIALS_PATH = path.join(app.getPath('userData'), 'credentials.enc');

export interface CustomProvider {
    id: string;
    name: string;
    curlCommand: string;
}

export interface CurlProvider {
    id: string;
    name: string;
    curlCommand: string;
    responsePath: string; // e.g. "choices[0].message.content"
}

export interface StoredCredentials {
    geminiApiKey?: string;
    groqApiKey?: string;
    openaiApiKey?: string;
    claudeApiKey?: string;
    googleServiceAccountPath?: string;
    customProviders?: CustomProvider[];
    curlProviders?: CurlProvider[];
    defaultModel?: string;
    nativelyApiKey?: string;
    // STT Provider settings
    sttProvider?: 'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'natively';
    groqSttApiKey?: string;
    groqSttModel?: string;
    openAiSttApiKey?: string;
    deepgramApiKey?: string;
    elevenLabsApiKey?: string;
    azureApiKey?: string;
    azureRegion?: string;
    ibmWatsonApiKey?: string;
    ibmWatsonRegion?: string;
    sonioxApiKey?: string;
    sttLanguage?: string;
    aiResponseLanguage?: string;
    // Tavily Search
    tavilyApiKey?: string;
    // Dynamic Model Discovery – preferred models per provider
    geminiPreferredModel?: string;
    groqPreferredModel?: string;
    openaiPreferredModel?: string;
    claudePreferredModel?: string;
    // sensi M1 Step 4: session-active provider. The active model is reused from
    // the existing `defaultModel` field above, so only the provider key is new.
    // The pair is set together via setActiveProviderAndModel() so they cannot drift.
    activeProvider?: ProviderId;
    // sensi M0-T5: trial fields removed (personal-use mode, no natively cloud trial)
    // v2.5.4: Google OAuth Desktop App credentials for the Calendar integration.
    // Both fields are user-supplied via Settings → Calendar so sensi doesn't
    // ship with shared OAuth quota. For Desktop OAuth apps Google explicitly
    // states the client_secret is not actually secret (it's bundled with the
    // installer), but we still encrypt both via safeStorage for hygiene.
    googleOauthClientId?: string;
    googleOauthClientSecret?: string;
    // sensi M8 / PASS B (v2.13.0): sensi-cloud managed auth.
    // Tokens returned by `sensi://auth/callback` after the user completes
    // Google sign-in via api.sensi.cloudfrontiers.co.uk. Access token is a
    // short-lived (1h) sensi JWT; refresh token rotates on every use.
    sensiAccessToken?: string;
    sensiRefreshToken?: string;
    sensiAccessExpiresAt?: number;     // epoch seconds
    sensiRefreshExpiresAt?: number;    // epoch seconds
    sensiUserId?: string;
    sensiTier?: 'free' | 'pro';
    // Google OAuth tokens handed to the desktop alongside the sensi JWT so
    // the user's Google Calendar connects automatically without a second
    // OAuth consent step. Stored here (not in googleOauthClientId/Secret)
    // to avoid mixing the two auth paths.
    googleAccessToken?: string;
    googleAccessExpiresAt?: number;    // epoch seconds
    googleRefreshToken?: string;
    // sensi M8 / PASS B (v2.13.0): Outlook Calendar (Microsoft Graph).
    // Populated by the OutlookCalendarProvider's own desktop OAuth flow —
    // the backend does NOT mediate Outlook auth (unlike Google).
    outlookAccessToken?: string;
    outlookAccessExpiresAt?: number;   // epoch seconds
    outlookRefreshToken?: string;
}

export class CredentialsManager {
    private static instance: CredentialsManager;
    private credentials: StoredCredentials = {};

    private constructor() {
        // Load on construction after app ready
    }

    public static getInstance(): CredentialsManager {
        if (!CredentialsManager.instance) {
            CredentialsManager.instance = new CredentialsManager();
        }
        return CredentialsManager.instance;
    }

    /**
     * Initialize - load credentials from disk
     * Must be called after app.whenReady()
     */
    public init(): void {
        this.loadCredentials();
        console.log('[CredentialsManager] Initialized');
    }

    // =========================================================================
    // Getters
    // =========================================================================

    public getGeminiApiKey(): string | undefined {
        return this.credentials.geminiApiKey;
    }

    public getGroqApiKey(): string | undefined {
        return this.credentials.groqApiKey;
    }

    public getOpenaiApiKey(): string | undefined {
        return this.credentials.openaiApiKey;
    }

    public getClaudeApiKey(): string | undefined {
        return this.credentials.claudeApiKey;
    }

    public getGoogleServiceAccountPath(): string | undefined {
        return this.credentials.googleServiceAccountPath;
    }

    public getCustomProviders(): CustomProvider[] {
        return this.credentials.customProviders || [];
    }

    public getSttProvider(): 'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'natively' {
        return this.credentials.sttProvider || 'none';
    }

    public getDeepgramApiKey(): string | undefined {
        return this.credentials.deepgramApiKey;
    }

    public getGroqSttApiKey(): string | undefined {
        return this.credentials.groqSttApiKey;
    }

    public getGroqSttModel(): string {
        return this.credentials.groqSttModel || 'whisper-large-v3-turbo';
    }

    public getOpenAiSttApiKey(): string | undefined {
        return this.credentials.openAiSttApiKey;
    }

    public getElevenLabsApiKey(): string | undefined {
        return this.credentials.elevenLabsApiKey;
    }

    public getAzureApiKey(): string | undefined {
        return this.credentials.azureApiKey;
    }

    public getAzureRegion(): string {
        return this.credentials.azureRegion || 'eastus';
    }

    public getIbmWatsonApiKey(): string | undefined {
        return this.credentials.ibmWatsonApiKey;
    }

    public getIbmWatsonRegion(): string {
        return this.credentials.ibmWatsonRegion || 'us-south';
    }

    public getSonioxApiKey(): string | undefined {
        return this.credentials.sonioxApiKey;
    }

    public getTavilyApiKey(): string | undefined {
        return this.credentials.tavilyApiKey;
    }

    public getSttLanguage(): string {
        // v2.5.8: reverted default back to 'english-us' after auto-detect
        // produced inconsistent results in real meetings. Users who want
        // another language (Yoruba, Spanish, French, etc.) should pick it
        // explicitly in Settings → Audio → Language.
        return this.credentials.sttLanguage || 'english-us';
    }

    public getAiResponseLanguage(): string {
        return this.credentials.aiResponseLanguage || 'auto';
    }
    public getDefaultModel(): string {
        return this.credentials.defaultModel || 'gemini-3.1-flash-lite-preview';
    }

    public getNativelyApiKey(): string | undefined {
        return this.credentials.nativelyApiKey;
    }

    public getAllCredentials(): StoredCredentials {
        return { ...this.credentials };
    }

    // v2.5.4: Google OAuth Desktop App credentials for the Calendar integration.
    public getGoogleOauthClientId(): string | undefined {
        return this.credentials.googleOauthClientId;
    }
    public getGoogleOauthClientSecret(): string | undefined {
        return this.credentials.googleOauthClientSecret;
    }
    public hasGoogleOauthCredentials(): boolean {
        return !!this.credentials.googleOauthClientId && !!this.credentials.googleOauthClientSecret;
    }
    public setGoogleOauthCredentials(clientId: string, clientSecret: string): void {
        const trimId = (clientId ?? '').trim();
        const trimSecret = (clientSecret ?? '').trim();
        this.credentials.googleOauthClientId = trimId || undefined;
        this.credentials.googleOauthClientSecret = trimSecret || undefined;
        this.saveCredentials();
        console.log('[CredentialsManager] Google OAuth client credentials updated');
    }
    public clearGoogleOauthCredentials(): void {
        this.credentials.googleOauthClientId = undefined;
        this.credentials.googleOauthClientSecret = undefined;
        this.saveCredentials();
        console.log('[CredentialsManager] Google OAuth client credentials cleared');
    }

    // =========================================================================
    // sensi M8 / PASS B (v2.13.0): sensi-cloud managed auth
    //
    // Two linked token bundles are stored:
    //   1. sensi JWT pair (access + refresh) for api.sensi.cloudfrontiers.co.uk
    //   2. Google OAuth tokens (access + refresh) issued to the SAME user so
    //      Google Calendar auto-connects after sign-in.
    //
    // `sensiRefreshToken` rotates on every refresh; `googleRefreshToken` rarely
    // changes. Both live in the safeStorage-encrypted credentials.enc file.
    // =========================================================================

    public getSensiAccessToken(): string | undefined {
        return this.credentials.sensiAccessToken;
    }
    public getSensiRefreshToken(): string | undefined {
        return this.credentials.sensiRefreshToken;
    }
    public getSensiAccessExpiresAt(): number | undefined {
        return this.credentials.sensiAccessExpiresAt;
    }
    public getSensiRefreshExpiresAt(): number | undefined {
        return this.credentials.sensiRefreshExpiresAt;
    }
    public getSensiUserId(): string | undefined {
        return this.credentials.sensiUserId;
    }
    public getSensiTier(): 'free' | 'pro' | undefined {
        return this.credentials.sensiTier;
    }
    public isSensiSignedIn(): boolean {
        const t = this.credentials.sensiRefreshToken;
        const exp = this.credentials.sensiRefreshExpiresAt;
        if (!t) return false;
        if (typeof exp === 'number' && exp > 0 && exp * 1000 < Date.now()) return false;
        return true;
    }

    public getGoogleAccessToken(): string | undefined {
        return this.credentials.googleAccessToken;
    }
    public getGoogleAccessExpiresAt(): number | undefined {
        return this.credentials.googleAccessExpiresAt;
    }
    public getGoogleRefreshToken(): string | undefined {
        return this.credentials.googleRefreshToken;
    }

    public setSensiAuthBundle(bundle: {
        accessToken: string;
        refreshToken: string;
        accessExpiresAt: number;
        refreshExpiresAt: number;
        userId: string;
        tier: 'free' | 'pro';
        googleAccessToken?: string;
        googleAccessExpiresAt?: number;
        googleRefreshToken?: string;
    }): void {
        this.credentials.sensiAccessToken = bundle.accessToken;
        this.credentials.sensiRefreshToken = bundle.refreshToken;
        this.credentials.sensiAccessExpiresAt = bundle.accessExpiresAt;
        this.credentials.sensiRefreshExpiresAt = bundle.refreshExpiresAt;
        this.credentials.sensiUserId = bundle.userId;
        this.credentials.sensiTier = bundle.tier;
        if (bundle.googleAccessToken) {
            this.credentials.googleAccessToken = bundle.googleAccessToken;
        }
        if (bundle.googleAccessExpiresAt) {
            this.credentials.googleAccessExpiresAt = bundle.googleAccessExpiresAt;
        }
        if (bundle.googleRefreshToken) {
            this.credentials.googleRefreshToken = bundle.googleRefreshToken;
        }
        this.saveCredentials();
        console.log('[CredentialsManager] sensi auth bundle stored (tier=' + bundle.tier + ')');
    }

    public updateSensiAccessTokens(pair: {
        accessToken: string;
        refreshToken: string;
        accessExpiresAt: number;
        refreshExpiresAt: number;
        tier: 'free' | 'pro';
    }): void {
        this.credentials.sensiAccessToken = pair.accessToken;
        this.credentials.sensiRefreshToken = pair.refreshToken;
        this.credentials.sensiAccessExpiresAt = pair.accessExpiresAt;
        this.credentials.sensiRefreshExpiresAt = pair.refreshExpiresAt;
        this.credentials.sensiTier = pair.tier;
        this.saveCredentials();
    }

    public updateGoogleAccessToken(pair: {
        accessToken: string;
        accessExpiresAt: number;
    }): void {
        this.credentials.googleAccessToken = pair.accessToken;
        this.credentials.googleAccessExpiresAt = pair.accessExpiresAt;
        this.saveCredentials();
    }

    public clearSensiAuth(): void {
        this.credentials.sensiAccessToken = undefined;
        this.credentials.sensiRefreshToken = undefined;
        this.credentials.sensiAccessExpiresAt = undefined;
        this.credentials.sensiRefreshExpiresAt = undefined;
        this.credentials.sensiUserId = undefined;
        this.credentials.sensiTier = undefined;
        this.credentials.googleAccessToken = undefined;
        this.credentials.googleAccessExpiresAt = undefined;
        this.credentials.googleRefreshToken = undefined;
        this.saveCredentials();
        console.log('[CredentialsManager] sensi auth bundle cleared');
    }

    // Outlook Calendar OAuth tokens (PASS B — placeholder slots; actual
    // provider implementation ships in a later sub-pass alongside
    // OutlookCalendarProvider.ts).
    public getOutlookAccessToken(): string | undefined {
        return this.credentials.outlookAccessToken;
    }
    public getOutlookAccessExpiresAt(): number | undefined {
        return this.credentials.outlookAccessExpiresAt;
    }
    public getOutlookRefreshToken(): string | undefined {
        return this.credentials.outlookRefreshToken;
    }
    public setOutlookTokens(tokens: {
        accessToken: string;
        accessExpiresAt: number;
        refreshToken: string;
    }): void {
        this.credentials.outlookAccessToken = tokens.accessToken;
        this.credentials.outlookAccessExpiresAt = tokens.accessExpiresAt;
        this.credentials.outlookRefreshToken = tokens.refreshToken;
        this.saveCredentials();
    }
    public clearOutlookTokens(): void {
        this.credentials.outlookAccessToken = undefined;
        this.credentials.outlookAccessExpiresAt = undefined;
        this.credentials.outlookRefreshToken = undefined;
        this.saveCredentials();
    }

    // =========================================================================
    // Setters (auto-save)
    // =========================================================================

    public setGeminiApiKey(key: string): void {
        this.credentials.geminiApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Gemini API Key updated');
    }

    public setGroqApiKey(key: string): void {
        this.credentials.groqApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Groq API Key updated');
    }

    public setOpenaiApiKey(key: string): void {
        this.credentials.openaiApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] OpenAI API Key updated');
    }

    public setClaudeApiKey(key: string): void {
        this.credentials.claudeApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Claude API Key updated');
    }

    public setGoogleServiceAccountPath(filePath: string): void {
        this.credentials.googleServiceAccountPath = filePath;
        this.saveCredentials();
        console.log('[CredentialsManager] Google Service Account path updated');
    }

    public setSttProvider(provider: 'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'natively'): void {
        this.credentials.sttProvider = provider;
        this.saveCredentials();
        console.log(`[CredentialsManager] STT Provider set to: ${provider}`);
    }

    public setDeepgramApiKey(key: string): void {
        this.credentials.deepgramApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Deepgram API Key updated');
    }

    public setGroqSttApiKey(key: string): void {
        this.credentials.groqSttApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Groq STT API Key updated');
    }

    public setOpenAiSttApiKey(key: string): void {
        this.credentials.openAiSttApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] OpenAI STT API Key updated');
    }

    public setGroqSttModel(model: string): void {
        this.credentials.groqSttModel = model;
        this.saveCredentials();
        console.log(`[CredentialsManager] Groq STT Model set to: ${model}`);
    }

    public setElevenLabsApiKey(key: string): void {
        this.credentials.elevenLabsApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] ElevenLabs API Key updated');
    }

    public setAzureApiKey(key: string): void {
        this.credentials.azureApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Azure API Key updated');
    }

    public setAzureRegion(region: string): void {
        this.credentials.azureRegion = region;
        this.saveCredentials();
        console.log(`[CredentialsManager] Azure Region set to: ${region}`);
    }

    public setIbmWatsonApiKey(key: string): void {
        this.credentials.ibmWatsonApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] IBM Watson API Key updated');
    }

    public setIbmWatsonRegion(region: string): void {
        this.credentials.ibmWatsonRegion = region;
        this.saveCredentials();
        console.log(`[CredentialsManager] IBM Watson Region set to: ${region}`);
    }

    public setSonioxApiKey(key: string): void {
        this.credentials.sonioxApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Soniox API Key updated');
    }

    public setTavilyApiKey(key: string): void {
        // Store undefined (not empty string) when removing, so hasKey() checks stay consistent
        this.credentials.tavilyApiKey = key.trim() || undefined;
        this.saveCredentials();
        console.log('[CredentialsManager] Tavily API Key updated');
    }

    public setSttLanguage(language: string): void {
        this.credentials.sttLanguage = language;
        this.saveCredentials();
        console.log(`[CredentialsManager] STT Language set to: ${language}`);
    }

    public setAiResponseLanguage(language: string): void {
        this.credentials.aiResponseLanguage = language;
        this.saveCredentials();
        console.log(`[CredentialsManager] AI Response Language set to: ${language}`);
    }
    public setDefaultModel(model: string): void {
        this.credentials.defaultModel = model;
        this.saveCredentials();
        console.log(`[CredentialsManager] Default Model set to: ${model}`);
    }

    public setNativelyApiKey(key: string): void {
        const trimmed = key.trim();
        this.credentials.nativelyApiKey = trimmed || undefined;

        if (trimmed) {
            // Auto-promote natively to default model unless user already chose a non-Gemini/Groq model
            const current = this.credentials.defaultModel || '';
            const isAutoDefault = !current
                || current.startsWith('gemini-')
                || current.startsWith('llama-')
                || current.startsWith('mixtral-')
                || current.startsWith('gemma-')
                || current === 'gemini'
                || current === 'llama';
            if (isAutoDefault) {
                this.credentials.defaultModel = 'natively';
                console.log('[CredentialsManager] Auto-set default model to natively');
            }

            // Auto-promote natively STT if still on 'none' or the default Google STT
            if (!this.credentials.sttProvider || this.credentials.sttProvider === 'none' || this.credentials.sttProvider === 'google') {
                this.credentials.sttProvider = 'natively';
                console.log('[CredentialsManager] Auto-set STT provider to natively');
            }
        } else {
            // Key cleared — revert natively-auto-set defaults back to safe fallbacks
            if (this.credentials.defaultModel === 'natively') {
                this.credentials.defaultModel = 'gemini-3.1-flash-lite-preview';
                console.log('[CredentialsManager] Natively key cleared — reset default model to Gemini Flash');
            }
            if (this.credentials.sttProvider === 'natively') {
                this.credentials.sttProvider = 'none';
                console.log('[CredentialsManager] Natively key cleared — reset STT provider to none');
            }
        }

        this.saveCredentials();
        console.log('[CredentialsManager] Natively API Key updated');
    }

    public getPreferredModel(provider: 'gemini' | 'groq' | 'openai' | 'claude'): string | undefined {
        const key = `${provider}PreferredModel` as keyof StoredCredentials;
        return this.credentials[key] as string | undefined;
    }

    public setPreferredModel(provider: 'gemini' | 'groq' | 'openai' | 'claude', modelId: string): void {
        const key = `${provider}PreferredModel` as keyof StoredCredentials;
        (this.credentials as any)[key] = modelId;
        this.saveCredentials();
        console.log(`[CredentialsManager] ${provider} preferred model set to: ${modelId}`);
    }

    // ─────────────────────────────────────────────────────────────────────
    // sensi M1 Step 4 — Active provider + model session state
    //
    // The "active" pair is what gets used for the next LLM request. It
    // persists across restarts via `credentials.enc` so the user's last
    // selection is restored on relaunch. The active model is stored in
    // the existing `defaultModel` field — adding a separate `activeModel`
    // field would let the two drift, so we deliberately reuse one field
    // and add only `activeProvider` (see DECISIONS.md D010 rationale).
    //
    // Switching providers via setActiveProviderAndModel() also calls
    // setPreferredModel() so the per-provider "last used model" stays
    // current — when the user later switches back, resolveModelForProvider
    // can restore that exact model instead of the baseline default.
    //
    // `ollama` is intentionally excluded from setPreferredModel because
    // there is no `ollamaPreferredModel` field — Ollama models come from
    // the live local server via getAvailableOllamaModels(), so the "last
    // used" concept is captured by `defaultModel` alone for ollama.
    // ─────────────────────────────────────────────────────────────────────

    public setActiveProviderAndModel(provider: ProviderId, model: string): void {
        this.credentials.activeProvider = provider;
        this.credentials.defaultModel = model;
        // Remember per-provider so switching back restores the exact model.
        // Ollama has no preferred-model field — defaultModel covers it.
        if (provider !== 'ollama') {
            const key = `${provider}PreferredModel` as keyof StoredCredentials;
            (this.credentials as any)[key] = model;
        }
        this.saveCredentials();
        console.log(`[CredentialsManager] Active provider+model set: ${provider} / ${model}`);
    }

    public getActiveProviderAndModel(): { provider: ProviderId | null; model: string | null } {
        return {
            provider: this.credentials.activeProvider ?? null,
            model: this.credentials.defaultModel ?? null,
        };
    }

    /**
     * Resolve the best model ID to load when switching to `provider` without
     * an explicit model selection — typically used by the
     * llm:set-active-provider-and-model handler when the renderer asks to
     * "switch to provider X" by clicking a provider header.
     *
     * Returns:
     *   1. The user's last-used model for that provider, if stored
     *   2. The first baseline model from STANDARD_CLOUD_MODELS, if any
     *   3. `null` for ollama (caller must consult getAvailableOllamaModels)
     *      or for an unknown provider
     */
    public resolveModelForProvider(provider: ProviderId): string | null {
        if (provider === 'ollama') {
            // Ollama models are dynamic; use the stored defaultModel only if
            // it's an ollama-prefixed value, otherwise the caller should pick
            // from getAvailableOllamaModels().
            const stored = this.credentials.defaultModel;
            return stored && stored.startsWith('ollama-') ? stored : null;
        }
        const preferred = this.getPreferredModel(provider as 'gemini' | 'groq' | 'openai' | 'claude');
        if (preferred) return preferred;
        const entry = STANDARD_CLOUD_MODELS[provider as keyof typeof STANDARD_CLOUD_MODELS];
        return entry?.ids?.[0] ?? null;
    }

    public saveCustomProvider(provider: CustomProvider): void {
        if (!this.credentials.customProviders) {
            this.credentials.customProviders = [];
        }
        // Check if exists, update if so
        const index = this.credentials.customProviders.findIndex(p => p.id === provider.id);
        if (index !== -1) {
            this.credentials.customProviders[index] = provider;
        } else {
            this.credentials.customProviders.push(provider);
        }
        this.saveCredentials();
        console.log(`[CredentialsManager] Custom Provider '${provider.name}' saved`);
    }

    public deleteCustomProvider(id: string): void {
        if (!this.credentials.customProviders) return;
        this.credentials.customProviders = this.credentials.customProviders.filter(p => p.id !== id);
        this.saveCredentials();
        console.log(`[CredentialsManager] Custom Provider '${id}' deleted`);
    }

    public getCurlProviders(): CurlProvider[] {
        return this.credentials.curlProviders || [];
    }

    public saveCurlProvider(provider: CurlProvider): void {
        if (!this.credentials.curlProviders) {
            this.credentials.curlProviders = [];
        }
        const index = this.credentials.curlProviders.findIndex(p => p.id === provider.id);
        if (index !== -1) {
            this.credentials.curlProviders[index] = provider;
        } else {
            this.credentials.curlProviders.push(provider);
        }
        this.saveCredentials();
        console.log(`[CredentialsManager] Curl Provider '${provider.name}' saved`);
    }

    public deleteCurlProvider(id: string): void {
        if (!this.credentials.curlProviders) return;
        this.credentials.curlProviders = this.credentials.curlProviders.filter(p => p.id !== id);
        this.saveCredentials();
        console.log(`[CredentialsManager] Curl Provider '${id}' deleted`);
    }

    // ── Free Trial ─────────────────────────────────────────────
    // sensi M0-T5: the free-trial API surface (getTrialToken, getTrialExpiresAt,
    // getTrialStartedAt, setTrialToken, clearTrialToken) was removed. Personal-use
    // mode unlocks all gated features via the LicenseManager stub — there is no
    // natively-cloud trial. See DECISIONS.md D003 and SECURITY.md R1/R4.

    public clearAll(): void {
        this.scrubMemory();
        if (fs.existsSync(CREDENTIALS_PATH)) {
            fs.unlinkSync(CREDENTIALS_PATH);
        }
        const plaintextPath = CREDENTIALS_PATH + '.json';
        if (fs.existsSync(plaintextPath)) {
            fs.unlinkSync(plaintextPath);
        }
        console.log('[CredentialsManager] All credentials cleared');
    }

    /**
     * Scrub all API keys from memory to minimize exposure window.
     * Called on app quit and credential clear.
     */
    public scrubMemory(): void {
        // Overwrite each string field with empty before discarding
        for (const key of Object.keys(this.credentials) as (keyof StoredCredentials)[]) {
            const val = this.credentials[key];
            if (typeof val === 'string') {
                (this.credentials as any)[key] = '';
            }
        }
        this.credentials = {};
        console.log('[CredentialsManager] Memory scrubbed');
    }

    // =========================================================================
    // Storage (Encrypted)
    // =========================================================================

    private saveCredentials(): void {
        try {
            if (!safeStorage.isEncryptionAvailable()) {
                console.warn('[CredentialsManager] Encryption not available, falling back to plaintext');
                // Fallback: save as plaintext (less secure, but functional)
                const plainPath = CREDENTIALS_PATH + '.json';
                const tmpPlain = plainPath + '.tmp';
                fs.writeFileSync(tmpPlain, JSON.stringify(this.credentials));
                fs.renameSync(tmpPlain, plainPath);
                return;
            }

            const data = JSON.stringify(this.credentials);
            const encrypted = safeStorage.encryptString(data);
            const tmpEnc = CREDENTIALS_PATH + '.tmp';
            fs.writeFileSync(tmpEnc, encrypted);
            fs.renameSync(tmpEnc, CREDENTIALS_PATH);
        } catch (error) {
            console.error('[CredentialsManager] Failed to save credentials:', error);
        }
    }

    private loadCredentials(): void {
        try {
            // Try encrypted file first
            if (fs.existsSync(CREDENTIALS_PATH)) {
                if (!safeStorage.isEncryptionAvailable()) {
                    console.warn('[CredentialsManager] Encryption not available for load');
                    return;
                }

                const encrypted = fs.readFileSync(CREDENTIALS_PATH);
                const decrypted = safeStorage.decryptString(encrypted);
                try {
                    const parsed = JSON.parse(decrypted);
                    if (typeof parsed === 'object' && parsed !== null) {
                        this.credentials = parsed;
                        console.log('[CredentialsManager] Loaded encrypted credentials');
                    } else {
                        throw new Error('Decrypted credentials is not a valid object');
                    }
                } catch (parseError) {
                    console.error('[CredentialsManager] Failed to parse decrypted credentials — file may be corrupted. Starting fresh:', parseError);
                    this.credentials = {};
                }

                // Clean up any leftover plaintext fallback file to eliminate the data leak
                const plaintextPath = CREDENTIALS_PATH + '.json';
                if (fs.existsSync(plaintextPath)) {
                    try {
                        fs.unlinkSync(plaintextPath);
                        console.log('[CredentialsManager] Removed stale plaintext credential file');
                    } catch (cleanupErr) {
                        console.warn('[CredentialsManager] Could not remove stale plaintext file:', cleanupErr);
                    }
                }
                return;
            }

            // Fallback: try plaintext file
            const plaintextPath = CREDENTIALS_PATH + '.json';
            if (fs.existsSync(plaintextPath)) {
                const data = fs.readFileSync(plaintextPath, 'utf-8');
                try {
                    const parsed = JSON.parse(data);
                    if (typeof parsed === 'object' && parsed !== null) {
                        this.credentials = parsed;
                        console.log('[CredentialsManager] Loaded plaintext credentials');
                    } else {
                        throw new Error('Plaintext credentials is not a valid object');
                    }
                } catch (parseError) {
                    console.error('[CredentialsManager] Failed to parse plaintext credentials — file may be corrupted. Starting fresh:', parseError);
                    this.credentials = {};
                }
                return;
            }

            console.log('[CredentialsManager] No stored credentials found');
        } catch (error) {
            console.error('[CredentialsManager] Failed to load credentials:', error);
            this.credentials = {};
        }
    }
}

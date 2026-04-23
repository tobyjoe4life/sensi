/**
 * SensiSTTTokenClient — caches a short-lived Deepgram scoped token
 * minted by sensi-cloud so the desktop can stream audio directly to
 * Deepgram without ever seeing the project admin key.
 *
 * Lifecycle:
 *   - `getToken()` returns a live token, refreshing when fewer than
 *     5 min remain on the current one.
 *   - `reportUsage(seconds)` fires at session end so the backend can
 *     accumulate `daily_usage.stt_seconds`. Fire-and-forget; if the
 *     network is down the usage will be lost (cap still enforced at
 *     next mint).
 *   - `invalidate()` clears the cached token (e.g. after sign-out).
 *
 * Typed errors:
 *   SttDailyCapError       — HTTP 429 from the backend.
 *   SttManagedDisabledError — HTTP 503 with code managed_stt_disabled.
 *   SttUnavailableError    — everything else.
 *
 * All errors are thrown from `getToken()`. `reportUsage()` swallows
 * network failures silently; the token-mint path is the authoritative
 * cap enforcement.
 */

import { AuthManager } from './AuthManager';

const SENSI_API_BASE = 'https://api.sensi.cloudfrontiers.co.uk';
const REFRESH_THRESHOLD_SECONDS = 5 * 60;

export class SttDailyCapError extends Error {
    readonly code = 'stt_daily_cap' as const;
    constructor(
        public readonly used: number,
        public readonly cap: number,
    ) {
        super(`Daily STT cap reached (${used}/${cap} seconds). Upgrade to Pro or switch to your own key.`);
    }
}

export class SttManagedDisabledError extends Error {
    readonly code = 'managed_stt_disabled' as const;
    constructor() { super('Sensi AI audio is temporarily unavailable.'); }
}

export class SttUnavailableError extends Error {
    readonly code = 'stt_unavailable' as const;
    constructor(message = 'Could not start audio.') { super(message); }
}

interface CachedToken {
    token: string;
    expiresAt: number; // unix seconds
}

export class SensiSTTTokenClient {
    private static instance: SensiSTTTokenClient;
    private cached: CachedToken | null = null;
    private inflight: Promise<CachedToken> | null = null;

    public static getInstance(): SensiSTTTokenClient {
        if (!SensiSTTTokenClient.instance) {
            SensiSTTTokenClient.instance = new SensiSTTTokenClient();
        }
        return SensiSTTTokenClient.instance;
    }

    /**
     * Return a fresh Deepgram scoped key. Mints a new one when the
     * cached token is missing or within 5 minutes of expiry.
     */
    public async getToken(): Promise<string> {
        const now = Math.floor(Date.now() / 1000);
        if (this.cached && this.cached.expiresAt - now > REFRESH_THRESHOLD_SECONDS) {
            return this.cached.token;
        }
        // Coalesce concurrent callers onto the same in-flight mint.
        if (this.inflight) {
            return (await this.inflight).token;
        }
        this.inflight = this.mint();
        try {
            this.cached = await this.inflight;
            return this.cached.token;
        } finally {
            this.inflight = null;
        }
    }

    public invalidate(): void {
        this.cached = null;
    }

    public async reportUsage(seconds: number): Promise<void> {
        if (!Number.isFinite(seconds) || seconds <= 0) return;
        const rounded = Math.max(0, Math.round(seconds));
        try {
            const access = await AuthManager.getInstance().getFreshAccessToken();
            if (!access) return;
            await fetch(`${SENSI_API_BASE}/stt/usage-report`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    authorization: `Bearer ${access}`,
                },
                body: JSON.stringify({ seconds: rounded }),
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn('[SensiSTTTokenClient] usage-report failed (ignored):', msg);
        }
    }

    private async mint(): Promise<CachedToken> {
        const access = await AuthManager.getInstance().getFreshAccessToken();
        if (!access) {
            throw new SttUnavailableError('Sign in to use managed STT.');
        }
        const res = await fetch(`${SENSI_API_BASE}/stt/token`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${access}`,
            },
            body: JSON.stringify({}),
        });
        if (!res.ok) {
            let body: unknown = null;
            try { body = await res.json(); } catch { /* non-json */ }
            const err = (body as { error?: { code?: string; message?: string; used?: number; cap?: number } } | null)?.error;
            if (res.status === 429 && err?.code === 'daily_cap') {
                throw new SttDailyCapError(err.used ?? 0, err.cap ?? 0);
            }
            if (res.status === 503 && err?.code === 'managed_stt_disabled') {
                throw new SttManagedDisabledError();
            }
            throw new SttUnavailableError(err?.message ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as { deepgram_token?: string; expires_at?: number };
        if (!data.deepgram_token || !data.expires_at) {
            throw new SttUnavailableError('Malformed mint response.');
        }
        return { token: data.deepgram_token, expiresAt: data.expires_at };
    }
}

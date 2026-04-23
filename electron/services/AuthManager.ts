/**
 * AuthManager — sensi M8 / PASS B (v2.13.0).
 *
 * Owns the sensi-cloud sign-in lifecycle on the desktop side:
 *   - Opens the OS default browser at api.sensi.cloudfrontiers.co.uk/auth/google
 *   - Receives the token bundle via the `sensi://auth/callback?...` custom
 *     protocol (main.ts parses the URL and calls `handleCallback`)
 *   - Persists tokens in CredentialsManager (safeStorage-encrypted)
 *   - Rotates sensi refresh tokens before they expire
 *   - Polls `/me` for subscription state + daily usage counters
 *   - Broadcasts auth-state changes to every renderer window
 *
 * Trust boundary: main-process only. Renderer talks to this via IPC
 * (`auth:*` handlers). The raw refresh token never crosses the IPC boundary.
 */

import { BrowserWindow, shell } from 'electron';
import { EventEmitter } from 'events';
import { URL } from 'url';
import { CredentialsManager } from './CredentialsManager';

// ─────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────
const SENSI_API_BASE = 'https://api.sensi.cloudfrontiers.co.uk';
const ME_POLL_INTERVAL_MS = 60_000;          // every 60s while signed in
const ACCESS_REFRESH_THRESHOLD_SECONDS = 120; // refresh when < 2min left

// ─────────────────────────────────────────────────────────────
// Public shapes (also exported through preload to the renderer)
// ─────────────────────────────────────────────────────────────

export interface SensiMeUsage {
    used: number;
    cap: number | null;
}

export interface SensiMe {
    id: string;
    email: string;
    name: string | null;
    avatar_url: string | null;
    subscription: {
        tier: 'free' | 'pro';
        expires_at: string | null;
        has_stripe_customer: boolean;
    };
    usage: {
        what_to_answer: SensiMeUsage;
        research: SensiMeUsage;
        prep_briefing: SensiMeUsage;
    };
}

export interface AuthState {
    signedIn: boolean;
    userId: string | null;
    tier: 'free' | 'pro' | null;
    me: SensiMe | null;
}

type Tokens = {
    access: string;
    refresh: string;
    accessExp: number;
    refreshExp: number;
    tier: 'free' | 'pro';
    userId: string;
    googleAccess?: string;
    googleAccessExp?: number;
    googleRefresh?: string;
};

// ─────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────
export class AuthManager extends EventEmitter {
    private static instance: AuthManager;
    private meCache: SensiMe | null = null;
    private pollTimer: NodeJS.Timeout | null = null;

    private constructor() { super(); }

    public static getInstance(): AuthManager {
        if (!AuthManager.instance) {
            AuthManager.instance = new AuthManager();
        }
        return AuthManager.instance;
    }

    public init(): void {
        // If a refresh token was persisted on disk from a previous session,
        // start the poll loop so the UI reflects live tier/usage on launch.
        if (CredentialsManager.getInstance().isSensiSignedIn()) {
            this.startMePoll();
            // Fire-and-forget fetch so the state is fresh by the time the
            // renderer asks for it.
            void this.refreshMe();
        }
    }

    public getAuthState(): AuthState {
        const creds = CredentialsManager.getInstance();
        const signedIn = creds.isSensiSignedIn();
        if (!signedIn) {
            return { signedIn: false, userId: null, tier: null, me: null };
        }
        return {
            signedIn: true,
            userId: creds.getSensiUserId() ?? null,
            tier: creds.getSensiTier() ?? 'free',
            me: this.meCache,
        };
    }

    /**
     * Kick off the browser-based sign-in flow. The OS default browser opens
     * the Google consent URL; when Google redirects back through our
     * backend, the `sensi://` protocol brings focus back to the app with
     * the tokens in the query string.
     */
    public async startSignIn(): Promise<void> {
        await shell.openExternal(`${SENSI_API_BASE}/auth/google`);
    }

    public async openCheckout(): Promise<void> {
        const access = await this.getFreshAccessToken();
        if (!access) {
            throw new Error('Sign in first before upgrading');
        }
        const res = await fetch(`${SENSI_API_BASE}/billing/checkout`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${access}`,
            },
            body: JSON.stringify({}),
        });
        if (!res.ok) {
            const msg = await safeErrorText(res);
            throw new Error(`Checkout failed: ${msg}`);
        }
        const json = (await res.json()) as { url?: string };
        if (!json.url) throw new Error('Checkout did not return a URL');
        await shell.openExternal(json.url);
    }

    public async openBillingPortal(): Promise<void> {
        const access = await this.getFreshAccessToken();
        if (!access) {
            throw new Error('Sign in first to manage billing');
        }
        const res = await fetch(`${SENSI_API_BASE}/billing/portal`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${access}`,
            },
            body: JSON.stringify({}),
        });
        if (!res.ok) {
            const msg = await safeErrorText(res);
            throw new Error(`Portal failed: ${msg}`);
        }
        const json = (await res.json()) as { url?: string };
        if (!json.url) throw new Error('Portal did not return a URL');
        await shell.openExternal(json.url);
    }

    /**
     * Called by main.ts when a `sensi://auth/callback?...` URL is received
     * (either via `open-url` on macOS or the Windows second-instance event).
     * Parses the querystring, persists tokens, starts the me-poll loop,
     * and broadcasts an auth-state change.
     */
    public async handleCallback(callbackUrl: string): Promise<void> {
        const parsed = parseCallbackTokens(callbackUrl);
        if (!parsed) {
            console.warn('[AuthManager] callback URL did not contain tokens:', callbackUrl);
            return;
        }
        CredentialsManager.getInstance().setSensiAuthBundle({
            accessToken: parsed.access,
            refreshToken: parsed.refresh,
            accessExpiresAt: parsed.accessExp,
            refreshExpiresAt: parsed.refreshExp,
            userId: parsed.userId,
            tier: parsed.tier,
            googleAccessToken: parsed.googleAccess,
            googleAccessExpiresAt: parsed.googleAccessExp,
            googleRefreshToken: parsed.googleRefresh,
        });
        this.startMePoll();
        // Surface the fresh tokens to any listeners (CalendarManager will
        // adopt the Google tokens when it hears this event).
        this.emit('signed-in', {
            userId: parsed.userId,
            tier: parsed.tier,
            hasGoogleTokens: !!parsed.googleAccess,
        });
        await this.refreshMe();
        this.broadcastAuthState();
    }

    public async signOut(): Promise<void> {
        const creds = CredentialsManager.getInstance();
        const refresh = creds.getSensiRefreshToken();
        if (refresh) {
            try {
                await fetch(`${SENSI_API_BASE}/auth/signout`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ refresh }),
                });
            } catch (e) {
                // Best-effort: even if the call fails we still clear local state.
                const msg = e instanceof Error ? e.message : String(e);
                console.warn('[AuthManager] signout call failed:', msg);
            }
        }
        this.stopMePoll();
        this.meCache = null;
        creds.clearSensiAuth();
        this.emit('signed-out');
        this.broadcastAuthState();
    }

    /**
     * Return a non-expired sensi access token, refreshing it on demand if
     * it's within {@link ACCESS_REFRESH_THRESHOLD_SECONDS} of expiry.
     * Returns null if the user is not signed in or the refresh token has
     * expired.
     */
    public async getFreshAccessToken(): Promise<string | null> {
        const creds = CredentialsManager.getInstance();
        if (!creds.isSensiSignedIn()) return null;

        const access = creds.getSensiAccessToken();
        const accessExp = creds.getSensiAccessExpiresAt() ?? 0;
        const now = Math.floor(Date.now() / 1000);

        if (access && accessExp - now > ACCESS_REFRESH_THRESHOLD_SECONDS) {
            return access;
        }

        // Need to refresh
        const refresh = creds.getSensiRefreshToken();
        if (!refresh) return null;
        try {
            const res = await fetch(`${SENSI_API_BASE}/auth/refresh`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ refresh }),
            });
            if (!res.ok) {
                const code = res.status;
                console.warn('[AuthManager] refresh failed:', code);
                if (code === 401) {
                    // Refresh token revoked or replayed — force sign-out.
                    this.stopMePoll();
                    creds.clearSensiAuth();
                    this.broadcastAuthState();
                }
                return null;
            }
            const json = (await res.json()) as {
                access: string;
                access_exp: number;
                refresh: string;
                refresh_exp: number;
                tier: 'free' | 'pro';
            };
            creds.updateSensiAccessTokens({
                accessToken: json.access,
                refreshToken: json.refresh,
                accessExpiresAt: json.access_exp,
                refreshExpiresAt: json.refresh_exp,
                tier: json.tier,
            });
            return json.access;
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn('[AuthManager] refresh threw:', msg);
            return null;
        }
    }

    /**
     * Fetch /me and cache the result. Used by the settings UI to render the
     * usage meter. Safe to call on every poll tick — silent on network
     * errors (the stale cache continues to render).
     */
    public async refreshMe(): Promise<SensiMe | null> {
        const access = await this.getFreshAccessToken();
        if (!access) return null;
        try {
            const res = await fetch(`${SENSI_API_BASE}/me`, {
                headers: { authorization: `Bearer ${access}` },
            });
            if (!res.ok) {
                if (res.status === 401) {
                    // Access token got invalidated between refresh and /me;
                    // likely a server-side rotation. Try one more time.
                    console.warn('[AuthManager] /me returned 401, treating as transient');
                    return null;
                }
                return null;
            }
            const me = (await res.json()) as SensiMe;
            this.meCache = me;
            this.emit('me-updated', me);
            this.broadcastAuthState();
            return me;
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn('[AuthManager] /me fetch threw:', msg);
            return null;
        }
    }

    private startMePoll(): void {
        if (this.pollTimer) return;
        this.pollTimer = setInterval(() => {
            void this.refreshMe();
        }, ME_POLL_INTERVAL_MS);
    }

    private stopMePoll(): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    private broadcastAuthState(): void {
        const state = this.getAuthState();
        try {
            for (const win of BrowserWindow.getAllWindows()) {
                if (!win.isDestroyed()) {
                    win.webContents.send('auth-state-changed', state);
                }
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn('[AuthManager] broadcast failed:', msg);
        }
    }
}

// ─────────────────────────────────────────────────────────────
// Helpers (module-private)
// ─────────────────────────────────────────────────────────────

function parseCallbackTokens(callbackUrl: string): Tokens | null {
    try {
        const u = new URL(callbackUrl);
        // Accept either the canonical sensi://auth/callback form or any
        // sensi:// host/path — Windows delivers the full URL verbatim.
        const qp = u.searchParams;
        const access = qp.get('access');
        const refresh = qp.get('refresh');
        const accessExp = qp.get('access_exp');
        const refreshExp = qp.get('refresh_exp');
        const userId = qp.get('user_id');
        const tier = qp.get('tier');
        if (!access || !refresh || !accessExp || !refreshExp || !userId || !tier) {
            return null;
        }
        const parsedTier: 'free' | 'pro' = tier === 'pro' ? 'pro' : 'free';
        const googleAccess = qp.get('google_access') ?? undefined;
        const googleAccessExp = qp.get('google_access_exp');
        const googleRefresh = qp.get('google_refresh') ?? undefined;
        return {
            access,
            refresh,
            accessExp: Number.parseInt(accessExp, 10),
            refreshExp: Number.parseInt(refreshExp, 10),
            userId,
            tier: parsedTier,
            googleAccess,
            googleAccessExp: googleAccessExp ? Number.parseInt(googleAccessExp, 10) : undefined,
            googleRefresh,
        };
    } catch {
        return null;
    }
}

async function safeErrorText(res: Response): Promise<string> {
    try {
        const json = (await res.json()) as { error?: { message?: string } };
        return json.error?.message ?? `${res.status}`;
    } catch {
        return `${res.status}`;
    }
}

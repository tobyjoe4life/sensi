import { app, safeStorage, shell, net } from 'electron';
import axios from 'axios';
import http from 'http';
import url from 'url';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

// v2.5.4: OAuth credentials are supplied by the user via Settings → Calendar
// (stored encrypted in CredentialsManager). Previous env-var-only approach
// never worked for packaged users. Env vars are still honored as a fallback
// for developer convenience.
const REDIRECT_URI = "http://localhost:11111/auth/callback";
const SCOPES = ["https://www.googleapis.com/auth/calendar.readonly", "https://www.googleapis.com/auth/userinfo.email"];
const TOKEN_PATH = path.join(app.getPath('userData'), 'calendar_tokens.enc');

/**
 * Resolve OAuth creds at call time so users who paste them in Settings don't
 * need to restart sensi. Lazy-require keeps CalendarManager loadable before
 * CredentialsManager is ready (e.g. unit tests).
 */
function getOauthCreds(): { clientId: string; clientSecret: string } | null {
    // Env-var override for developers
    const envId = process.env.GOOGLE_CLIENT_ID;
    const envSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (envId && envSecret) {
        return { clientId: envId, clientSecret: envSecret };
    }
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { CredentialsManager } = require('./CredentialsManager');
        const mgr = CredentialsManager.getInstance();
        const clientId = mgr.getGoogleOauthClientId?.();
        const clientSecret = mgr.getGoogleOauthClientSecret?.();
        if (clientId && clientSecret) {
            return { clientId, clientSecret };
        }
    } catch (err) {
        console.warn('[CalendarManager] Failed to read OAuth creds from CredentialsManager:', err);
    }
    return null;
}

export class CalendarOauthMissingError extends Error {
    public readonly code = 'OAUTH_CREDS_MISSING';
    constructor() {
        super('Google OAuth credentials are not configured. Open Settings → Calendar and paste a Client ID + Client Secret from Google Cloud Console.');
    }
}

export interface CalendarEvent {
    id: string;
    title: string;
    startTime: string; // ISO
    endTime: string; // ISO
    link?: string;
    source: 'google';
}

export class CalendarManager extends EventEmitter {
    private static instance: CalendarManager;
    private accessToken: string | null = null;
    private refreshToken: string | null = null;
    private expiryDate: number | null = null;
    private isConnected: boolean = false;
    private userEmail: string | null = null;
    private updateInterval: NodeJS.Timeout | null = null;

    private constructor() {
        super();
        // Tokens loaded in init() to ensure safeStorage is ready
    }

    public static getInstance(): CalendarManager {
        if (!CalendarManager.instance) {
            CalendarManager.instance = new CalendarManager();
        }
        return CalendarManager.instance;
    }

    public init() {
        this.loadTokens();
    }

    // =========================================================================
    // Auth Flow
    // =========================================================================

    public async startAuthFlow(): Promise<void> {
        // v2.5.4: fail fast with a clear error the IPC handler can surface.
        if (!getOauthCreds()) {
            throw new CalendarOauthMissingError();
        }
        return new Promise((resolve, reject) => {
            // 1. Create Loopback Server
            const server = http.createServer(async (req, res) => {
                try {
                    if (req.url?.startsWith('/auth/callback')) {
                        const qs = new url.URL(req.url, 'http://localhost:11111').searchParams;
                        const code = qs.get('code');
                        const error = qs.get('error');

                        if (error) {
                            res.end('Authentication failed! You can close this window.');
                            server.close();
                            reject(new Error(error));
                            return;
                        }

                        if (code) {
                            res.end('Authentication successful! You can close this window and return to sensi.');
                            server.close();

                            // 2. Exchange code for tokens
                            await this.exchangeCodeForToken(code);
                            resolve();
                        }
                    }
                } catch (err) {
                    res.end('Authentication error.');
                    server.close();
                    reject(err);
                }
            });

            server.listen(11111, () => {
                // 3. Open Browser
                const authUrl = this.getAuthUrl();
                if (authUrl) {
                    shell.openExternal(authUrl);
                } else {
                    server.close();
                    reject(new CalendarOauthMissingError());
                }
            });

            server.on('error', (err) => {
                reject(err);
            });
        });
    }

    public async disconnect(): Promise<void> {
        this.accessToken = null;
        this.refreshToken = null;
        this.expiryDate = null;
        this.isConnected = false;
        this.userEmail = null;

        if (fs.existsSync(TOKEN_PATH)) {
            fs.unlinkSync(TOKEN_PATH);
        }

        this.emit('connection-changed', false);
    }

    /**
     * Adopt Google OAuth tokens obtained through the sensi-cloud sign-in
     * flow (AuthManager). Lets the streamlined sign-in double as a Calendar
     * connection so the user doesn't have to complete two OAuth consents.
     *
     * `accessExpiresAt` is unix seconds (matches the sensi:// callback
     * format); internally we store ms since we compare against Date.now().
     *
     * Separate from the BYO-OAuth loopback flow — this path doesn't require
     * a user-supplied client_id / client_secret because the backend's Google
     * Web App client issued the tokens. Refresh still requires creds; if the
     * user never connects BYO-OAuth creds and this token expires, we'll
     * quietly disconnect and prompt them to sign in again.
     */
    public adoptGoogleOAuthTokens(tokens: {
        accessToken: string;
        accessExpiresAt: number; // unix seconds
        refreshToken?: string;
    }): void {
        this.accessToken = tokens.accessToken;
        if (tokens.refreshToken) {
            this.refreshToken = tokens.refreshToken;
        }
        this.expiryDate = tokens.accessExpiresAt * 1000;
        this.isConnected = true;
        this.saveTokens();
        this.emit('connection-changed', true);

        // Best-effort: populate the connected email and prime the events
        // cache so Upcoming Meetings shows something on the first paint.
        void this.fetchUserEmail();
        void this.fetchUpcomingEvents();
    }

    public getConnectionStatus(): { connected: boolean; email?: string, lastSync?: number } {
        return { connected: this.isConnected, email: this.userEmail ?? undefined };
    }

    /**
     * Fetch the connected user's email via Google userinfo endpoint so the
     * Settings UI can display which account is connected. Best-effort —
     * we never throw from here; failure just leaves userEmail null.
     */
    private async fetchUserEmail(): Promise<void> {
        if (!this.accessToken) return;
        try {
            const res = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${this.accessToken}` },
                timeout: 5000,
            });
            if (res.data?.email) {
                this.userEmail = res.data.email;
                this.saveTokens();
                this.emit('connection-changed', true);
            }
        } catch (err) {
            // If userinfo scope wasn't granted we just skip — events still work
            console.log('[CalendarManager] userinfo fetch skipped:', (err as Error)?.message);
        }
    }

    private getAuthUrl(): string | null {
        const creds = getOauthCreds();
        if (!creds) return null;
        const params = new URLSearchParams({
            client_id: creds.clientId,
            redirect_uri: REDIRECT_URI,
            response_type: 'code',
            scope: SCOPES.join(' '),
            access_type: 'offline', // For refresh token
            prompt: 'consent' // Force prompts to ensure we get refresh token
        });
        return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    }

    private async exchangeCodeForToken(code: string) {
        const creds = getOauthCreds();
        if (!creds) throw new CalendarOauthMissingError();
        try {
            const response = await axios.post('https://oauth2.googleapis.com/token', {
                code,
                client_id: creds.clientId,
                client_secret: creds.clientSecret,
                redirect_uri: REDIRECT_URI,
                grant_type: 'authorization_code'
            });

            this.handleTokenResponse(response.data);
        } catch (error) {
            console.error('[CalendarManager] Token exchange failed:', error);
            throw error;
        }
    }

    // =========================================================================
    // Refresh Logic (NEW)
    // =========================================================================

    public async refreshState(): Promise<void> {
        console.log('[CalendarManager] Refreshing state (Reality Reconciliation)...');

        // 1. Reset Soft Heuristics
        // Clear existing reminder timeouts to prevent double scheduling or stale alerts
        this.reminderTimeouts.forEach(t => clearTimeout(t));
        this.reminderTimeouts = [];

        // 2. Calendar Re-sync & Temporal Re-evaluation
        if (this.isConnected) {
            // Force fetch will also re-schedule reminders based on NEW time
            await this.getUpcomingEvents(true);
        } else {
            console.log('[CalendarManager] Calendar not connected, skipping fetch.');
        }

        // 3. Emit update to UI
        // We emit 'updated' so the frontend knows to re-fetch via getUpcomingEvents
        // or we could push the data. usually ipcHandlers just call getUpcomingEvents.
        this.emit('events-updated');
    }

    private handleTokenResponse(data: any) {
        this.accessToken = data.access_token;
        if (data.refresh_token) {
            this.refreshToken = data.refresh_token; // Only returned on first consent
        }
        this.expiryDate = Date.now() + (data.expires_in * 1000);
        this.isConnected = true;
        this.saveTokens();
        this.emit('connection-changed', true);

        // v2.5.4: fetch connected email so Settings UI shows the account.
        void this.fetchUserEmail();

        // Initial fetch
        this.fetchUpcomingEvents();
    }

    private async refreshAccessToken() {
        if (!this.refreshToken) {
            throw new Error('No refresh token available');
        }
        const creds = getOauthCreds();
        if (!creds) throw new CalendarOauthMissingError();

        try {
            const response = await axios.post('https://oauth2.googleapis.com/token', {
                client_id: creds.clientId,
                client_secret: creds.clientSecret,
                refresh_token: this.refreshToken,
                grant_type: 'refresh_token'
            });

            this.handleTokenResponse(response.data);
        } catch (error) {
            console.error('[CalendarManager] Token refresh failed:', error);
            // If refresh fails (e.g. revoked), disconnect
            this.disconnect();
        }
    }

    // =========================================================================
    // Token Storage (Encrypted)
    // =========================================================================

    private saveTokens() {
        if (!safeStorage.isEncryptionAvailable()) {
            console.warn('[CalendarManager] Encryption not available, skipping token save');
            return;
        }

        const data = JSON.stringify({
            accessToken: this.accessToken,
            refreshToken: this.refreshToken,
            expiryDate: this.expiryDate,
            userEmail: this.userEmail,
        });

        const encrypted = safeStorage.encryptString(data);
        const tmpPath = TOKEN_PATH + '.tmp';
        fs.writeFileSync(tmpPath, encrypted);
        fs.renameSync(tmpPath, TOKEN_PATH);
    }

    private loadTokens() {
        if (!fs.existsSync(TOKEN_PATH)) return;

        try {
            if (!safeStorage.isEncryptionAvailable()) return;

            const encrypted = fs.readFileSync(TOKEN_PATH);
            const decrypted = safeStorage.decryptString(encrypted);
            const data = JSON.parse(decrypted);

            this.accessToken = data.accessToken;
            this.refreshToken = data.refreshToken;
            this.expiryDate = data.expiryDate;

            this.userEmail = data.userEmail ?? null;

            if (this.accessToken && this.refreshToken) {
                this.isConnected = true;
                // Check expiry
                if (this.expiryDate && Date.now() >= this.expiryDate) {
                    this.refreshAccessToken();
                } else if (!this.userEmail) {
                    // Best-effort backfill for older installs that didn't store email
                    void this.fetchUserEmail();
                }
            }
        } catch (error) {
            console.error('[CalendarManager] Failed to load tokens:', error);
        }
    }

    // =========================================================================
    // Reminders
    // =========================================================================

    private reminderTimeouts: NodeJS.Timeout[] = [];

    private scheduleReminders(events: CalendarEvent[]) {
        // Clear existing
        this.reminderTimeouts.forEach(t => clearTimeout(t));
        this.reminderTimeouts = [];

        const now = Date.now();

        events.forEach(event => {
            const startStr = event.startTime;
            if (!startStr) return;

            const startTime = new Date(startStr).getTime();
            // Reminder time: 2 minutes before
            const reminderTime = startTime - (2 * 60 * 1000);

            if (reminderTime > now) {
                const delay = reminderTime - now;
                // Only schedule if within next 24h (which fetch already limits)
                if (delay < 24 * 60 * 60 * 1000) {
                    const timeout = setTimeout(() => {
                        this.showNotification(event);
                    }, delay);
                    this.reminderTimeouts.push(timeout);
                }
            }
        });
    }

    // Track events the user has dismissed so a fresh poll doesn't re-alert
    // for the same event. In-memory only — new app launch starts fresh.
    private dismissedEventIds: Set<string> = new Set();

    public dismissEvent(eventId: string): void {
        this.dismissedEventIds.add(eventId);
    }

    private showNotification(event: CalendarEvent) {
        if (this.dismissedEventIds.has(event.id)) {
            console.log(`[CalendarManager] Suppressing notification for dismissed event: ${event.id}`);
            return;
        }

        // Primary channel: emit an in-app alert so the Launcher (if alive) can
        // show a rich modal prompt with "Yes, get ready" / "Not this one".
        // Main.ts forwards this to every renderer AND raises the window.
        this.emit('event-imminent', event);

        // Secondary channel: fire the native OS notification too, so the user
        // is still alerted if the sensi window is hidden or on another desktop.
        const { Notification } = require('electron');
        const notif = new Notification({
            title: 'Meeting starting soon',
            body: `"${event.title}" starts in 2 minutes. Bring sensi along?`,
            actions: [
                { type: 'button', text: 'Yes' },
                { type: 'button', text: 'Not this one' }
            ],
            sound: true
        });

        notif.on('action', (_evt: any, index: number) => {
            if (index === 0) {
                this.emit('start-meeting-requested', event);
            } else if (index === 1) {
                this.dismissEvent(event.id);
            }
        });

        notif.on('click', () => {
            // Clicking the body (not an action button) just brings sensi forward
            this.emit('open-requested');
        });

        notif.show();
    }

    // =========================================================================
    // Fetch Logic
    // =========================================================================

    public async getUpcomingEvents(force: boolean = false): Promise<CalendarEvent[]> {
        if (!this.isConnected || !this.accessToken) return [];

        // Check expiry
        if (this.expiryDate && Date.now() >= this.expiryDate - 60000) {
            await this.refreshAccessToken();
        }

        const events = await this.fetchEventsInternal();
        this.scheduleReminders(events);
        return events;
    }

    private async fetchEventsInternal(): Promise<CalendarEvent[]> {
        if (!this.accessToken) return [];

        const now = new Date();
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

        try {
            const response = await axios.get('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
                headers: {
                    Authorization: `Bearer ${this.accessToken}`
                },
                params: {
                    timeMin: now.toISOString(),
                    timeMax: tomorrow.toISOString(),
                    singleEvents: true,
                    orderBy: 'startTime'
                }
            });

            const items = response.data.items || [];

            return items
                .filter((item: any) => {
                    // Filter: >= 5 mins, no all-day
                    if (!item.start.dateTime || !item.end.dateTime) return false; // All-day events have .date instead of .dateTime

                    const start = new Date(item.start.dateTime).getTime();
                    const end = new Date(item.end.dateTime).getTime();
                    const durationMins = (end - start) / 60000;

                    return durationMins >= 5;
                })
                .map((item: any) => ({
                    id: item.id,
                    title: item.summary || '(No Title)',
                    startTime: item.start.dateTime,
                    endTime: item.end.dateTime,
                    link: this.resolveMeetingLink(item),
                    source: 'google'
                }));

        } catch (error) {
            console.error('[CalendarManager] Failed to fetch events:', error);
            return [];
        }
    }

    // Intelligent Link Extraction
    private resolveMeetingLink(item: any): string | undefined {
        // 1. Prefer explicit Hangout link (Google Meet) if valid
        if (item.hangoutLink) return item.hangoutLink;

        // 2. Parse description for other providers
        if (!item.description) return undefined;

        return this.extractMeetingLink(item.description);
    }

    private extractMeetingLink(description: string): string | undefined {
        // Regex for common meeting providers
        // Matches zoom.us, teams.microsoft.com, meet.google.com, webex.com
        const providerRegex = /(https?:\/\/(?:[a-z0-9-]+\.)?(?:zoom\.us|teams\.microsoft\.com|meet\.google\.com|webex\.com)\/[^\s<>"']+)/gi;

        const matches = description.match(providerRegex);
        if (matches && matches.length > 0) {
            // Deduplicate
            const unique = [...new Set(matches)];
            // Return the first valid provider link
            return unique[0];
        }

        // Fallback: Generic URL (less strict, but riskier)
        // const genericUrlRegex = /(https?:\/\/[^\s<>"']+)/g;
        // ... avoided to prevent picking up random links like "docs.google.com"

        return undefined;
    }

    // Background fetcher could go here if needed
    public async fetchUpcomingEvents() {
        // wrapper to just cache or trigger updates
        return this.getUpcomingEvents();
    }
}

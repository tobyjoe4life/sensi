/**
 * SensiAIProxy — desktop streaming client for sensi-cloud `/ai/chat`.
 *
 * Users signed into sensi hit this proxy instead of calling OpenAI
 * directly. The server holds the upstream key; the desktop only
 * presents its sensi JWT.
 *
 * Events produced by `streamChat()`:
 *   { kind: 'provider', provider, model } — fires once at stream open
 *   { kind: 'text',     delta }            — streamed token chunks
 *   { kind: 'done' }                       — stream finished cleanly
 *
 * Errors:
 *   DailyCapError    — HTTP 429 from the backend, caller should surface
 *                       the Upgrade / BYOK pill in the UI.
 *   ManagedAIDisabledError — HTTP 503 with code managed_ai_disabled.
 *   UpstreamUnavailableError — any other non-OK from the backend.
 *   AuthRequiredError — user is not signed in (or refresh failed).
 *
 * Single-flight: if the caller aborts via AbortSignal, the fetch is
 * cancelled and `done` is never emitted.
 */

import { AuthManager } from './AuthManager';

const SENSI_API_BASE = 'https://api.sensi.cloudfrontiers.co.uk';

export type SensiChatKind = 'what-to-answer' | 'research' | 'prep' | 'chat' | 'summary';

export type SensiChatRole = 'system' | 'user' | 'assistant';

export interface SensiChatMessage {
    role: SensiChatRole;
    content: string;
}

export interface SensiChatRequest {
    messages: SensiChatMessage[];
    kind: SensiChatKind;
    systemPrompt?: string;
    temperature?: number;
    maxOutputTokens?: number;
}

export type SensiChatEvent =
    | { kind: 'provider'; provider: string; model: string }
    | { kind: 'text'; delta: string }
    | { kind: 'done' };

export class AuthRequiredError extends Error {
    readonly code = 'auth_required' as const;
    constructor() { super('Sign in to use Sensi AI.'); }
}

export class DailyCapError extends Error {
    readonly code = 'daily_cap' as const;
    constructor(
        public readonly kindLimit: string,
        public readonly used: number,
        public readonly cap: number,
    ) {
        super(`Daily ${kindLimit} cap reached (${used}/${cap}). Upgrade to Pro or switch to your own key.`);
    }
}

export class ManagedAIDisabledError extends Error {
    readonly code = 'managed_ai_disabled' as const;
    constructor() { super('Sensi AI is temporarily unavailable. You can switch to your own key in Settings → AI Providers.'); }
}

export class UpstreamUnavailableError extends Error {
    readonly code = 'upstream_unavailable' as const;
    constructor(message: string = 'Sensi AI is busy. Try again shortly.') {
        super(message);
    }
}

/**
 * Stream a chat turn against `/ai/chat`. Returns an async iterator of
 * `SensiChatEvent`. Caller drives consumption via `for await`; pass an
 * AbortSignal to cancel mid-stream.
 */
export async function* streamChat(
    req: SensiChatRequest,
    signal?: AbortSignal,
): AsyncGenerator<SensiChatEvent> {
    const access = await AuthManager.getInstance().getFreshAccessToken();
    if (!access) {
        throw new AuthRequiredError();
    }

    const upstream = await fetch(`${SENSI_API_BASE}/ai/chat`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${access}`,
            accept: 'text/event-stream',
        },
        body: JSON.stringify(req),
        signal,
    });

    if (!upstream.ok) {
        let body: unknown = null;
        try { body = await upstream.json(); } catch { /* non-json */ }
        const err = (body as { error?: { code?: string; message?: string; kind?: string; used?: number; cap?: number } } | null)?.error;
        if (upstream.status === 429 && err?.code === 'daily_cap') {
            throw new DailyCapError(err.kind ?? 'call', err.used ?? 0, err.cap ?? 0);
        }
        if (upstream.status === 503 && err?.code === 'managed_ai_disabled') {
            throw new ManagedAIDisabledError();
        }
        throw new UpstreamUnavailableError(err?.message ?? `HTTP ${upstream.status}`);
    }
    if (!upstream.body) {
        throw new UpstreamUnavailableError('Empty response body.');
    }

    const decoder = new TextDecoder();
    const reader = upstream.body.getReader();
    let buf = '';
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });

            let idx: number;
            while ((idx = buf.indexOf('\n')) !== -1) {
                const raw = buf.slice(0, idx).replace(/\r$/, '');
                buf = buf.slice(idx + 1);
                if (!raw || raw.startsWith(':')) continue;
                const m = raw.match(/^data:\s?(.*)$/);
                if (!m) continue;
                const payload = m[1];
                if (!payload) continue;
                try {
                    const msg = JSON.parse(payload) as {
                        provider?: string;
                        model?: string;
                        text?: string;
                        done?: boolean;
                        error?: { code?: string; message?: string };
                    };
                    if (msg.error) {
                        throw new UpstreamUnavailableError(msg.error.message ?? 'Upstream stream error.');
                    }
                    if (msg.provider && msg.model) {
                        yield { kind: 'provider', provider: msg.provider, model: msg.model };
                    } else if (typeof msg.text === 'string') {
                        yield { kind: 'text', delta: msg.text };
                    } else if (msg.done) {
                        yield { kind: 'done' };
                        return;
                    }
                } catch (err) {
                    if (err instanceof UpstreamUnavailableError) throw err;
                    // Other parse errors are treated as stream noise (keepalives, comments).
                }
            }
        }
    } finally {
        reader.releaseLock();
    }
}

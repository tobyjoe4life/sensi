import React, { useEffect, useState } from 'react';
import { Calendar, ExternalLink, Check, AlertCircle, Trash2, Eye, EyeOff } from 'lucide-react';

interface GoogleCalendarSettingsProps {
    isLight: boolean;
    calendarStatus: { connected: boolean; email?: string };
    setCalendarStatus: (s: { connected: boolean; email?: string }) => void;
    isCalendarsLoading: boolean;
    setIsCalendarsLoading: (v: boolean) => void;
}

/**
 * v2.5.4 Calendar settings panel.
 *
 * Two-step flow:
 *   1. Paste Google OAuth 2.0 Client ID + Client Secret (Desktop app type)
 *      from Google Cloud Console. Stored safeStorage-encrypted.
 *   2. Click Connect Google → opens browser for consent → tokens persisted.
 *
 * The previous version tried to use env-var-only creds which never shipped
 * to packaged users, so calendar has been broken since install. Now it's
 * BYO-OAuth so each user has their own Cloud project + quota.
 */
export const GoogleCalendarSettings: React.FC<GoogleCalendarSettingsProps> = ({
    isLight,
    calendarStatus,
    setCalendarStatus,
    isCalendarsLoading,
    setIsCalendarsLoading,
}) => {
    const [oauthConfigured, setOauthConfigured] = useState<boolean | null>(null);
    const [maskedClientId, setMaskedClientId] = useState<string | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [clientId, setClientId] = useState('');
    const [clientSecret, setClientSecret] = useState('');
    const [showSecret, setShowSecret] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showGuide, setShowGuide] = useState(false);

    const refreshStatus = async () => {
        try {
            const st = await window.electronAPI?.getGoogleOauthStatus?.();
            setOauthConfigured(!!st?.configured);
            setMaskedClientId(st?.maskedClientId ?? null);
        } catch (e) {
            setOauthConfigured(false);
            setMaskedClientId(null);
        }
    };

    useEffect(() => { void refreshStatus(); }, []);

    const handleSaveCredentials = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSaving(true);
        try {
            const res = await window.electronAPI?.setGoogleOauthCredentials?.({
                clientId: clientId.trim(),
                clientSecret: clientSecret.trim(),
            });
            if (res?.success) {
                setShowForm(false);
                setClientId('');
                setClientSecret('');
                await refreshStatus();
            } else {
                setError(res?.error ?? 'Failed to save credentials');
            }
        } catch (err: any) {
            setError(err?.message ?? 'Failed to save credentials');
        } finally {
            setSaving(false);
        }
    };

    const handleClearCredentials = async () => {
        setSaving(true);
        try {
            await window.electronAPI?.clearGoogleOauthCredentials?.();
            setCalendarStatus({ connected: false });
            await refreshStatus();
        } finally {
            setSaving(false);
        }
    };

    const handleConnect = async () => {
        setIsCalendarsLoading(true);
        setError(null);
        try {
            const res = await window.electronAPI.calendarConnect() as { success: boolean; error?: string; code?: string };
            if (res?.success) {
                const status = await window.electronAPI.getCalendarStatus();
                setCalendarStatus(status);
            } else if (res?.code === 'OAUTH_CREDS_MISSING') {
                setError('Paste a Client ID + Client Secret below, then connect.');
                setShowForm(true);
            } else {
                setError(res?.error ?? 'Connection failed');
            }
        } catch (err: any) {
            setError(err?.message ?? 'Connection failed');
        } finally {
            setIsCalendarsLoading(false);
        }
    };

    const handleDisconnect = async () => {
        setIsCalendarsLoading(true);
        try {
            await window.electronAPI.calendarDisconnect();
            const status = await window.electronAPI.getCalendarStatus();
            setCalendarStatus(status);
        } finally {
            setIsCalendarsLoading(false);
        }
    };

    return (
        <div className="space-y-6 animated fadeIn h-full">
            <div>
                <h3 className="text-lg font-bold text-text-primary mb-2">Calendar Integration</h3>
                <p className="text-xs text-text-secondary mb-4">
                    Connect Google Calendar so sensi can show upcoming meetings and prompt before each one starts.
                </p>
            </div>

            {/* ── Step 1: OAuth credentials ─────────────────────────────────── */}
            <div className="bg-bg-card rounded-xl p-5 border border-border-subtle">
                <div className="flex items-start justify-between mb-3">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-[var(--accent-primary)]">Step 1</span>
                            {oauthConfigured && (
                                <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-emerald-400">
                                    <Check size={11} /> Configured
                                </span>
                            )}
                        </div>
                        <h4 className="text-sm font-bold text-text-primary">Google OAuth app credentials</h4>
                        <p className="text-[11px] text-text-secondary mt-1 max-w-[480px]">
                            sensi is BYO-OAuth so each install has its own Google Cloud quota. Create a free{' '}
                            <span className="font-medium">Desktop</span> OAuth 2.0 Client ID and paste it here.
                        </p>
                    </div>
                    <button
                        onClick={() => setShowGuide(!showGuide)}
                        className="text-[11px] text-[var(--accent-primary)] hover:underline flex items-center gap-1 flex-shrink-0"
                    >
                        {showGuide ? 'Hide steps' : 'Setup guide'}
                        <ExternalLink size={10} />
                    </button>
                </div>

                {showGuide && (
                    <div className="mt-3 mb-4 p-3.5 rounded-lg bg-bg-input border border-border-subtle text-[12px] text-text-secondary leading-relaxed space-y-2">
                        <ol className="list-decimal ml-4 space-y-1.5">
                            <li>
                                Open{' '}
                                <button
                                    onClick={() => window.electronAPI?.openExternal?.('https://console.cloud.google.com/')}
                                    className="text-[var(--accent-primary)] hover:underline"
                                >
                                    Google Cloud Console
                                </button>{' '}
                                → create a new project (or select an existing one).
                            </li>
                            <li>
                                <strong>APIs & Services → Library</strong> → search for <span className="font-mono text-[11px] bg-bg-elevated px-1 rounded">Google Calendar API</span> → <strong>Enable</strong>.
                            </li>
                            <li>
                                <strong>APIs & Services → OAuth consent screen</strong> → configure as <strong>External</strong>, add your email as a test user.
                            </li>
                            <li>
                                <strong>APIs & Services → Credentials</strong> → <strong>Create Credentials → OAuth client ID</strong> → Application type <strong>Desktop app</strong> → give it a name like <span className="font-mono text-[11px] bg-bg-elevated px-1 rounded">sensi desktop</span>.
                            </li>
                            <li>
                                Copy the <strong>Client ID</strong> and <strong>Client Secret</strong> from the dialog and paste them below.
                            </li>
                        </ol>
                        <p className="text-[11px] text-text-tertiary pt-1">
                            Desktop OAuth clients don't treat the secret as truly secret per Google's docs — it lives in every installer. We still encrypt it locally via <span className="font-mono">safeStorage</span>.
                        </p>
                    </div>
                )}

                {!showForm && oauthConfigured && (
                    <div className="flex items-center justify-between mt-3 px-3 py-2 bg-bg-input rounded-lg border border-border-subtle">
                        <div>
                            <div className="text-[11.5px] text-text-secondary">Client ID</div>
                            <div className="text-[12px] text-text-primary font-mono">{maskedClientId}</div>
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setShowForm(true)}
                                className="px-2.5 py-1.5 text-[11px] font-medium text-text-secondary hover:text-text-primary hover:bg-bg-elevated rounded transition-colors"
                            >
                                Replace
                            </button>
                            <button
                                onClick={handleClearCredentials}
                                disabled={saving}
                                className="p-1.5 text-text-tertiary hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                                title="Remove credentials"
                            >
                                <Trash2 size={12} />
                            </button>
                        </div>
                    </div>
                )}

                {(showForm || oauthConfigured === false) && (
                    <form onSubmit={handleSaveCredentials} className="space-y-3 mt-3">
                        <div>
                            <label className="block text-[11px] font-medium text-text-secondary mb-1">Client ID</label>
                            <input
                                type="text"
                                value={clientId}
                                onChange={(e) => setClientId(e.target.value)}
                                placeholder="123456789012-abc…xyz.apps.googleusercontent.com"
                                className={`w-full px-3 py-2 rounded-lg text-[12px] font-mono bg-bg-input border border-border-subtle text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]/40 focus:border-[var(--accent-primary)]/30 ${isLight ? '' : ''}`}
                                autoComplete="off"
                                spellCheck={false}
                            />
                        </div>
                        <div>
                            <label className="block text-[11px] font-medium text-text-secondary mb-1">Client Secret</label>
                            <div className="relative">
                                <input
                                    type={showSecret ? 'text' : 'password'}
                                    value={clientSecret}
                                    onChange={(e) => setClientSecret(e.target.value)}
                                    placeholder="GOCSPX-…"
                                    className="w-full pl-3 pr-10 py-2 rounded-lg text-[12px] font-mono bg-bg-input border border-border-subtle text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]/40 focus:border-[var(--accent-primary)]/30"
                                    autoComplete="off"
                                    spellCheck={false}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowSecret(!showSecret)}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-tertiary hover:text-text-primary rounded"
                                    aria-label={showSecret ? 'Hide secret' : 'Show secret'}
                                >
                                    {showSecret ? <EyeOff size={13} /> : <Eye size={13} />}
                                </button>
                            </div>
                        </div>

                        {error && (
                            <div className="flex items-start gap-2 text-[11.5px] text-red-400 bg-red-500/5 border border-red-500/15 rounded-lg px-3 py-2">
                                <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
                                <span>{error}</span>
                            </div>
                        )}

                        <div className="flex items-center gap-2 pt-1">
                            <button
                                type="submit"
                                disabled={saving || !clientId.trim() || !clientSecret.trim()}
                                className="px-4 py-2 rounded-md bg-[var(--accent-primary)] text-[#16151A] text-[12px] font-semibold hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {saving ? 'Saving…' : 'Save credentials'}
                            </button>
                            {oauthConfigured && (
                                <button
                                    type="button"
                                    onClick={() => { setShowForm(false); setError(null); setClientId(''); setClientSecret(''); }}
                                    className="px-4 py-2 rounded-md text-[12px] text-text-secondary hover:text-text-primary"
                                >
                                    Cancel
                                </button>
                            )}
                        </div>
                    </form>
                )}
            </div>

            {/* ── Step 2: Connect account ───────────────────────────────────── */}
            <div className={`bg-bg-card rounded-xl p-5 border border-border-subtle transition-opacity ${!oauthConfigured ? 'opacity-50' : ''}`}>
                <div className="mb-3">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-[var(--accent-primary)]">Step 2</span>
                        {calendarStatus.connected && (
                            <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-emerald-400">
                                <Check size={11} /> Connected
                            </span>
                        )}
                    </div>
                    <h4 className="text-sm font-bold text-text-primary">Connect your Google account</h4>
                </div>

                {calendarStatus.connected ? (
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-lg bg-[var(--accent-soft)] flex items-center justify-center text-[var(--accent-primary)]">
                                <Calendar size={18} />
                            </div>
                            <div>
                                <div className="text-[13px] font-medium text-text-primary">Google Calendar</div>
                                <div className="text-[11px] text-text-secondary">Connected as {calendarStatus.email || 'Google user'}</div>
                            </div>
                        </div>
                        <button
                            onClick={handleDisconnect}
                            disabled={isCalendarsLoading}
                            className="px-3 py-1.5 bg-bg-input hover:bg-bg-elevated border border-border-subtle text-text-primary rounded-md text-[11.5px] font-medium transition-colors disabled:opacity-60"
                        >
                            {isCalendarsLoading ? 'Disconnecting…' : 'Disconnect'}
                        </button>
                    </div>
                ) : (
                    <div>
                        <p className="text-[11.5px] text-text-secondary mb-3">
                            {oauthConfigured
                                ? 'Click Connect to open your browser and authorize sensi on your Google account.'
                                : 'Save your OAuth credentials above first, then connect.'}
                        </p>
                        <button
                            onClick={handleConnect}
                            disabled={isCalendarsLoading || !oauthConfigured}
                            className="px-4 py-2 rounded-md bg-[var(--accent-primary)] text-[#16151A] text-[12px] font-semibold hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            <svg viewBox="0 0 24 24" width="14" height="14" xmlns="http://www.w3.org/2000/svg">
                                <g transform="matrix(1, 0, 0, 1, 27.009001, -39.238998)">
                                    <path fill="#4285F4" d="M -3.264 51.509 C -3.264 50.719 -3.334 49.969 -3.454 49.239 L -14.754 49.239 L -14.754 53.749 L -8.284 53.749 C -8.574 55.229 -9.424 56.479 -10.684 57.329 L -10.684 60.329 L -6.824 60.329 C -4.564 58.239 -3.264 55.159 -3.264 51.509 Z" />
                                    <path fill="#34A853" d="M -14.754 63.239 C -11.514 63.239 -8.804 62.159 -6.824 60.329 L -10.684 57.329 C -11.764 58.049 -13.134 58.489 -14.754 58.489 C -17.884 58.489 -20.534 56.379 -21.484 53.529 L -25.464 53.529 L -25.464 56.619 C -23.494 60.539 -19.444 63.239 -14.754 63.239 Z" />
                                    <path fill="#FBBC05" d="M -21.484 53.529 C -21.734 52.809 -21.864 52.039 -21.864 51.239 C -21.864 50.439 -21.734 49.669 -21.484 48.949 L -21.484 45.859 L -25.464 45.859 C -26.284 47.479 -26.754 49.299 -26.754 51.239 C -26.754 53.179 -26.284 54.999 -25.464 56.619 L -21.484 53.529 Z" />
                                    <path fill="#EA4335" d="M -14.754 43.989 C -12.984 43.989 -11.404 44.599 -10.154 45.789 L -6.734 42.369 C -8.804 40.429 -11.514 39.239 -14.754 39.239 C -19.444 39.239 -23.494 41.939 -25.464 45.859 L -21.484 48.949 C -20.534 46.099 -17.884 43.989 -14.754 43.989 Z" />
                                </g>
                            </svg>
                            {isCalendarsLoading ? 'Connecting…' : 'Connect Google'}
                        </button>
                        {error && (
                            <div className="mt-3 flex items-start gap-2 text-[11.5px] text-red-400 bg-red-500/5 border border-red-500/15 rounded-lg px-3 py-2">
                                <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
                                <span>{error}</span>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

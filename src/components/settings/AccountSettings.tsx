import React, { useEffect, useState } from 'react';
import { CheckCircle, AlertCircle, ExternalLink, LogOut, Sparkles, Key, RefreshCw } from 'lucide-react';
import type { SensiAuthStateIpc, SensiMeIpc } from '../../types/electron';

interface AccountSettingsProps {
    isLight: boolean;
    onNavigateToAIProviders?: () => void;
}

type BusyFlag = null | 'sign-in' | 'sign-out' | 'checkout' | 'portal' | 'refresh';

/**
 * sensi M8 / PASS B (v2.13.0) — Account tab.
 *
 * Surfaces sensi-cloud sign-in, subscription tier, and the daily usage meter.
 * Signed-in state doubles as the streamlined Google Calendar connection
 * (CalendarManager adopts the tokens in the background — see main.ts
 * wire-up), so users only complete one OAuth consent.
 */
export const AccountSettings: React.FC<AccountSettingsProps> = ({
    isLight,
    onNavigateToAIProviders,
}) => {
    const [state, setState] = useState<SensiAuthStateIpc | null>(null);
    const [busy, setBusy] = useState<BusyFlag>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let mounted = true;
        void window.electronAPI.authGetState().then((res) => {
            if (!mounted) return;
            if (res.success) setState(res.state);
            else setError(res.error);
        });
        const unsubscribe = window.electronAPI.onAuthStateChanged((next) => {
            if (!mounted) return;
            setState(next);
        });
        return () => {
            mounted = false;
            unsubscribe();
        };
    }, []);

    const handleSignIn = async () => {
        setError(null);
        setBusy('sign-in');
        try {
            const res = await window.electronAPI.authSignIn();
            if (!res.success) setError(res.error);
        } finally {
            setBusy(null);
        }
    };

    const handleSignOut = async () => {
        setError(null);
        setBusy('sign-out');
        try {
            const res = await window.electronAPI.authSignOut();
            if (!res.success) setError(res.error);
        } finally {
            setBusy(null);
        }
    };

    const handleCheckout = async () => {
        setError(null);
        setBusy('checkout');
        try {
            const res = await window.electronAPI.authOpenCheckout();
            if (!res.success) setError(res.error);
        } finally {
            setBusy(null);
        }
    };

    const handlePortal = async () => {
        setError(null);
        setBusy('portal');
        try {
            const res = await window.electronAPI.authOpenPortal();
            if (!res.success) setError(res.error);
        } finally {
            setBusy(null);
        }
    };

    const handleRefresh = async () => {
        setError(null);
        setBusy('refresh');
        try {
            const res = await window.electronAPI.authRefreshMe();
            if (!res.success) setError(res.error);
        } finally {
            setBusy(null);
        }
    };

    const cardBase = isLight
        ? 'bg-white border border-gray-200 text-gray-900'
        : 'bg-bg-card border border-border-subtle text-text-primary';

    const mutedText = isLight ? 'text-gray-500' : 'text-text-secondary';

    const headerText = isLight ? 'text-gray-900' : 'text-text-primary';

    return (
        <div className="max-w-3xl">
            <h2 className={`text-xl font-semibold mb-1 ${headerText}`}>Account</h2>
            <p className={`text-sm mb-6 ${mutedText}`}>
                Sign in to unlock Sensi AI, daily usage tracking, and one-click Google Calendar.
            </p>

            {error && (
                <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start gap-2 text-sm">
                    <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
                    <span className="text-red-300">{error}</span>
                </div>
            )}

            {state?.signedIn
                ? renderSignedIn(state, {
                    onSignOut: handleSignOut,
                    onCheckout: handleCheckout,
                    onPortal: handlePortal,
                    onRefresh: handleRefresh,
                    busy,
                    cardBase,
                    mutedText,
                })
                : renderSignedOut({
                    onSignIn: handleSignIn,
                    onNavigateToAIProviders,
                    busy,
                    cardBase,
                    mutedText,
                })}
        </div>
    );
};

// ────────────────────────────────────────────────────────────────
// Signed-out
// ────────────────────────────────────────────────────────────────

interface SignedOutDeps {
    onSignIn: () => void;
    onNavigateToAIProviders?: () => void;
    busy: BusyFlag;
    cardBase: string;
    mutedText: string;
}

function renderSignedOut({ onSignIn, onNavigateToAIProviders, busy, cardBase, mutedText }: SignedOutDeps) {
    return (
        <div className={`rounded-xl p-6 ${cardBase}`}>
            <div className="flex items-start gap-4 mb-6">
                <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
                    <Sparkles size={20} className="text-blue-400" />
                </div>
                <div className="flex-1">
                    <h3 className="font-semibold mb-1">Sign in with Google</h3>
                    <p className={`text-sm ${mutedText}`}>
                        Sensi AI included. Usage meter. One-click upgrade. Google Calendar connects in the same step.
                    </p>
                </div>
            </div>

            <ul className="space-y-2 mb-6 text-sm">
                <Bullet>Daily free tier: 20 "What to answer?", 5 Research, 2 Prep briefings.</Bullet>
                <Bullet>Your transcripts, personas, and knowledge stay on this device.</Bullet>
                <Bullet>Upgrade to Pro removes the cap at any time.</Bullet>
            </ul>

            <button
                onClick={onSignIn}
                disabled={busy === 'sign-in'}
                className="w-full px-4 py-2.5 rounded-lg bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
                {busy === 'sign-in' ? 'Opening browser…' : 'Sign in with Google'}
                <ExternalLink size={14} />
            </button>

            <div className="mt-6 pt-5 border-t border-border-subtle">
                <div className="flex items-start gap-3">
                    <Key size={16} className={`${mutedText} shrink-0 mt-0.5`} />
                    <div className="flex-1">
                        <p className="text-sm font-medium mb-1">Prefer to bring your own API key?</p>
                        <p className={`text-sm ${mutedText} mb-2`}>
                            Paste a Gemini / Claude / OpenAI key and skip the free-tier cap entirely.
                            Your key, your quota — sensi never sees it.
                        </p>
                        {onNavigateToAIProviders && (
                            <button
                                onClick={onNavigateToAIProviders}
                                className="text-sm text-blue-400 hover:text-blue-300 underline"
                            >
                                Go to AI Providers
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ────────────────────────────────────────────────────────────────
// Signed-in
// ────────────────────────────────────────────────────────────────

interface SignedInDeps {
    onSignOut: () => void;
    onCheckout: () => void;
    onPortal: () => void;
    onRefresh: () => void;
    busy: BusyFlag;
    cardBase: string;
    mutedText: string;
}

function renderSignedIn(state: SensiAuthStateIpc, deps: SignedInDeps) {
    const { onSignOut, onCheckout, onPortal, onRefresh, busy, cardBase, mutedText } = deps;
    const me = state.me;
    const tier = state.tier ?? 'free';
    const isPro = tier === 'pro';

    return (
        <div className="space-y-6">
            {/* Identity + tier */}
            <div className={`rounded-xl p-6 ${cardBase}`}>
                <div className="flex items-start gap-4">
                    {me?.avatar_url ? (
                        <img
                            src={me.avatar_url}
                            alt={me.name ?? me.email}
                            className="w-12 h-12 rounded-full"
                        />
                    ) : (
                        <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center">
                            <span className="text-lg font-semibold text-blue-400">
                                {(me?.email ?? '?').charAt(0).toUpperCase()}
                            </span>
                        </div>
                    )}
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                            <h3 className="font-semibold truncate">{me?.name ?? me?.email ?? 'Signed in'}</h3>
                            <span
                                className={
                                    isPro
                                        ? 'px-2 py-0.5 rounded text-xs font-medium bg-amber-400/20 text-amber-300'
                                        : 'px-2 py-0.5 rounded text-xs font-medium bg-gray-500/20 text-gray-300'
                                }
                            >
                                {isPro ? 'Pro' : 'Free'}
                            </span>
                        </div>
                        {me?.email && me.name && (
                            <p className={`text-sm ${mutedText} truncate`}>{me.email}</p>
                        )}
                        <p className="text-xs text-emerald-400 flex items-center gap-1 mt-1">
                            <CheckCircle size={12} /> Google Calendar connected
                        </p>
                    </div>
                    <button
                        onClick={onRefresh}
                        disabled={busy === 'refresh'}
                        className={`p-2 rounded-lg hover:bg-white/5 disabled:opacity-50 ${mutedText}`}
                        title="Refresh"
                    >
                        <RefreshCw size={16} className={busy === 'refresh' ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {/* Usage meter */}
            {me && (
                <div className={`rounded-xl p-6 ${cardBase}`}>
                    <div className="flex items-baseline justify-between mb-4">
                        <h3 className="font-semibold">Today's usage</h3>
                        <span className={`text-xs ${mutedText}`}>Resets at midnight UTC</span>
                    </div>
                    <div className="space-y-4">
                        <UsageRow
                            label="What to answer?"
                            usage={me.usage.what_to_answer}
                            mutedText={mutedText}
                        />
                        <UsageRow
                            label="Research"
                            usage={me.usage.research}
                            mutedText={mutedText}
                        />
                        <UsageRow
                            label="Prep briefings"
                            usage={me.usage.prep_briefing}
                            mutedText={mutedText}
                        />
                        {/* v2.16.0: STT minutes — optional, only present when
                            the backend returns it (it does from v2.16.0+). */}
                        {me.usage.stt_seconds && (
                            <UsageRow
                                label="Audio minutes"
                                usage={{
                                    used: Math.round(me.usage.stt_seconds.used / 60),
                                    cap: me.usage.stt_seconds.cap === null
                                        ? null
                                        : Math.round(me.usage.stt_seconds.cap / 60),
                                }}
                                mutedText={mutedText}
                            />
                        )}
                    </div>
                </div>
            )}

            {/* Subscription actions */}
            <div className={`rounded-xl p-6 ${cardBase}`}>
                <h3 className="font-semibold mb-2">Subscription</h3>
                {isPro ? (
                    <>
                        <p className={`text-sm ${mutedText} mb-4`}>
                            You're on Pro. Daily caps are removed.
                            {me?.subscription.expires_at && (
                                <> Renews {new Date(me.subscription.expires_at).toLocaleDateString()}.</>
                            )}
                        </p>
                        <button
                            onClick={onPortal}
                            disabled={busy === 'portal'}
                            className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-50 text-sm font-medium flex items-center gap-2"
                        >
                            {busy === 'portal' ? 'Opening…' : 'Manage subscription'} <ExternalLink size={14} />
                        </button>
                    </>
                ) : (
                    <>
                        <p className={`text-sm ${mutedText} mb-4`}>
                            Upgrade to Pro to remove the daily cap.
                        </p>
                        <button
                            onClick={onCheckout}
                            disabled={busy === 'checkout'}
                            className="px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white text-sm font-medium flex items-center gap-2"
                        >
                            {busy === 'checkout' ? 'Opening…' : 'Upgrade to Pro'} <ExternalLink size={14} />
                        </button>
                    </>
                )}
            </div>

            {/* MEMORY-01: Cross-meeting memory engine */}
            <MemoryEngineCard cardBase={cardBase} mutedText={mutedText} />

            {/* Privacy + sign out */}
            <div className={`rounded-xl p-6 ${cardBase}`}>
                <h3 className="font-semibold mb-2">Privacy</h3>
                <ul className="space-y-1.5 text-sm">
                    <Bullet>Your transcripts stay on this device.</Bullet>
                    <Bullet>Your knowledge base and personas stay on this device.</Bullet>
                    <Bullet>Sensi AI sees your question + live-assist context, never the audio itself.</Bullet>
                </ul>
                <div className="mt-5 pt-4 border-t border-border-subtle">
                    <button
                        onClick={onSignOut}
                        disabled={busy === 'sign-out'}
                        className="px-3 py-2 rounded-lg text-sm font-medium text-red-400 hover:bg-red-500/10 disabled:opacity-50 transition-colors flex items-center gap-2"
                    >
                        <LogOut size={14} /> {busy === 'sign-out' ? 'Signing out…' : 'Sign out'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ────────────────────────────────────────────────────────────────
// MEMORY-01: Cross-meeting memory engine card
// ────────────────────────────────────────────────────────────────

interface MemoryEngineCardProps {
    cardBase: string;
    mutedText: string;
}

const MemoryEngineCard: React.FC<MemoryEngineCardProps> = ({ cardBase, mutedText }) => {
    const [enabled, setEnabled] = useState<boolean | null>(null);
    const [pending, setPending] = useState(0);
    const [purging, setPurging] = useState(false);
    const [status, setStatus] = useState<string | null>(null);

    useEffect(() => {
        let mounted = true;
        void window.electronAPI.memoryGetEnabled().then((r) => {
            if (!mounted) return;
            setEnabled(r.enabled);
        });
        void window.electronAPI.memoryGetQueueSize().then((r) => {
            if (!mounted) return;
            setPending(r.pending);
        });
        return () => {
            mounted = false;
        };
    }, []);

    const onToggle = async () => {
        if (enabled === null) return;
        const next = !enabled;
        setEnabled(next);
        try {
            await window.electronAPI.memorySetEnabled(next);
            setStatus(next ? 'On — new meetings will feed the memory engine.' : 'Off — no new meetings will be sent.');
        } catch {
            setEnabled(!next);
            setStatus('Could not save setting. Try again.');
        }
    };

    const onPurge = async () => {
        if (!window.confirm('Delete everything sensi has learned across your meetings? This cannot be undone.')) return;
        setPurging(true);
        setStatus(null);
        try {
            const r = await window.electronAPI.memoryPurge();
            if (r.success) setStatus(`Deleted ${r.deleted ?? 0} graph nodes.`);
            else setStatus(r.error ?? 'Purge failed.');
        } finally {
            setPurging(false);
        }
    };

    return (
        <div className={`rounded-xl p-6 ${cardBase}`}>
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h3 className="font-semibold mb-1">Cross-meeting memory</h3>
                    <p className={`text-sm ${mutedText} mb-2`}>
                        Lets sensi build a private, searchable graph of people, projects and decisions across all
                        your meetings. Powers smarter pre-meeting briefings and "what's still open on X?" questions.
                    </p>
                    <p className={`text-xs ${mutedText}`}>
                        Transcripts are processed on your own server only. Summaries stay on this device.
                    </p>
                </div>
                <div
                    role="switch"
                    aria-checked={enabled === true}
                    tabIndex={0}
                    onClick={onToggle}
                    onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') onToggle(); }}
                    className={`w-11 h-6 shrink-0 rounded-full relative cursor-pointer transition-colors ${
                        enabled ? 'bg-accent-primary' : 'bg-bg-toggle-switch border border-border-muted'
                    }`}
                >
                    <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-[#F1EDE6] shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-transform ${
                        enabled ? 'translate-x-5' : 'translate-x-0'
                    }`} />
                </div>
            </div>
            <div className="mt-4 pt-4 border-t border-border-subtle flex items-center justify-between gap-3">
                <span className={`text-xs ${mutedText}`}>
                    {pending > 0 ? `${pending} meetings queued for upload…` : 'All caught up.'}
                </span>
                <button
                    onClick={onPurge}
                    disabled={purging}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                >
                    {purging ? 'Deleting…' : 'Delete all memory'}
                </button>
            </div>
            {status && <p className={`mt-3 text-xs ${mutedText}`}>{status}</p>}
        </div>
    );
};

// ────────────────────────────────────────────────────────────────
// Small helpers
// ────────────────────────────────────────────────────────────────

const Bullet: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <li className="flex items-start gap-2">
        <CheckCircle size={14} className="text-emerald-400 shrink-0 mt-0.5" />
        <span>{children}</span>
    </li>
);

interface UsageRowProps {
    label: string;
    usage: { used: number; cap: number | null };
    mutedText: string;
}

const UsageRow: React.FC<UsageRowProps> = ({ label, usage, mutedText }) => {
    const cap = usage.cap;
    const uncapped = cap === null;
    const capText = uncapped ? 'Unlimited' : `${usage.used} / ${cap}`;
    const pct = cap === null || cap === 0 ? 0 : Math.min(100, (usage.used / cap) * 100);
    const near = !uncapped && pct >= 80;

    return (
        <div>
            <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-sm font-medium">{label}</span>
                <span className={`text-xs tabular-nums ${near ? 'text-amber-400' : mutedText}`}>
                    {capText}
                </span>
            </div>
            {!uncapped && (
                <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                    <div
                        className={near ? 'h-full bg-amber-400 transition-all' : 'h-full bg-blue-400 transition-all'}
                        style={{ width: `${pct}%` }}
                    />
                </div>
            )}
        </div>
    );
};

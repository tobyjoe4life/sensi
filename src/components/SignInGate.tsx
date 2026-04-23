import React, { useEffect, useState } from 'react';
import { Sparkles, Key, ExternalLink, CheckCircle } from 'lucide-react';
import type { SensiAuthStateIpc } from '../types/electron';
import { SensiMark } from './SensiLogoMark';

const BYOK_OPTOUT_KEY = 'sensi.signInGate.byokOptOut';

interface SignInGateProps {
    children: React.ReactNode;
}

/**
 * sensi M8 / PASS B — sign-in gate.
 *
 * Renders the full app only when the user has either:
 *   • signed in with Google (managed AI + calendar + usage meter), OR
 *   • explicitly opted out to use their own API key (BYOK).
 *
 * The BYOK opt-out is persisted in localStorage so returning users don't
 * get re-prompted. Signing out from Settings → Account also clears the
 * opt-out, so the gate re-appears on next launch.
 */
export const SignInGate: React.FC<SignInGateProps> = ({ children }) => {
    const [authState, setAuthState] = useState<SensiAuthStateIpc | null>(null);
    const [checking, setChecking] = useState(true);
    const [byokOptOut, setByokOptOut] = useState<boolean>(() => {
        try {
            return localStorage.getItem(BYOK_OPTOUT_KEY) === 'true';
        } catch {
            return false;
        }
    });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let mounted = true;
        const api = window.electronAPI;
        // Some window types (overlays, model selector) don't have the auth
        // surface wired — fall through to children in that case rather than
        // gating non-main windows.
        if (!api?.authGetState) {
            setChecking(false);
            return () => {};
        }
        void api.authGetState().then((res) => {
            if (!mounted) return;
            if (res.success) setAuthState(res.state);
            setChecking(false);
        });
        const unsubscribe = api.onAuthStateChanged?.((next) => {
            if (!mounted) return;
            setAuthState(next);
            // If the user signs out, re-arm the gate: clear the BYOK opt-out.
            if (!next.signedIn) {
                try {
                    localStorage.removeItem(BYOK_OPTOUT_KEY);
                } catch { /* noop */ }
                setByokOptOut(false);
            }
        });
        return () => {
            mounted = false;
            if (typeof unsubscribe === 'function') unsubscribe();
        };
    }, []);

    const handleSignIn = async () => {
        setError(null);
        setBusy(true);
        try {
            const res = await window.electronAPI.authSignIn();
            if (!res.success) setError(res.error);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Sign-in failed');
        } finally {
            setBusy(false);
        }
    };

    const handleOptOut = () => {
        try {
            localStorage.setItem(BYOK_OPTOUT_KEY, 'true');
        } catch { /* noop */ }
        setByokOptOut(true);
    };

    if (checking) return null;

    const passed = authState?.signedIn || byokOptOut;
    if (passed) return <>{children}</>;

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-bg-primary text-text-primary overflow-auto">
            <div className="w-full max-w-md p-8">
                <div className="flex items-center justify-center mb-6">
                    <SensiMark variant="lockup" size={40} />
                </div>

                <div className="bg-bg-card border border-border-subtle rounded-2xl p-7 shadow-xl">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
                            <Sparkles size={20} className="text-blue-400" />
                        </div>
                        <div>
                            <h1 className="text-lg font-semibold">Welcome to sensi</h1>
                            <p className="text-xs text-text-secondary">Sign in to get started.</p>
                        </div>
                    </div>

                    <ul className="space-y-2 text-sm mb-6">
                        <li className="flex items-start gap-2">
                            <CheckCircle size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                            <span>Sensi AI included. No keys to set up.</span>
                        </li>
                        <li className="flex items-start gap-2">
                            <CheckCircle size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                            <span>Free: 20 answers, 5 research briefs, 2 prep briefs, 60 audio minutes per day.</span>
                        </li>
                        <li className="flex items-start gap-2">
                            <CheckCircle size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                            <span>Google Calendar connects in the same click. Transcripts stay on this device.</span>
                        </li>
                    </ul>

                    {error && (
                        <div className="mb-3 p-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">
                            {error}
                        </div>
                    )}

                    <button
                        onClick={handleSignIn}
                        disabled={busy}
                        className="w-full px-4 py-2.5 rounded-lg bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
                    >
                        {busy ? 'Opening browser…' : 'Sign in with Google'}
                        <ExternalLink size={14} />
                    </button>

                    <div className="my-5 flex items-center gap-3 text-xs text-text-secondary">
                        <div className="h-px bg-border-subtle flex-1" />
                        <span>or</span>
                        <div className="h-px bg-border-subtle flex-1" />
                    </div>

                    <button
                        onClick={handleOptOut}
                        className="w-full px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-sm font-medium transition-colors flex items-center justify-center gap-2"
                    >
                        <Key size={14} /> I'll use my own API key
                    </button>
                    <p className="mt-2 text-[11px] text-text-secondary text-center">
                        Paste a Gemini / Claude / OpenAI key in Settings. No daily cap — your key, your quota.
                    </p>
                </div>

                <p className="mt-6 text-center text-[11px] text-text-secondary">
                    Signing in uses your Google account. sensi never sees your password.
                </p>
            </div>
        </div>
    );
};

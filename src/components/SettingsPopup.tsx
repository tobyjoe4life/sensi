import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { MessageSquare, Link, Camera, Zap, Heart, User, Eye, Brain } from 'lucide-react';
import { useShortcuts } from '../hooks/useShortcuts';
import { useResolvedTheme } from '../hooks/useResolvedTheme';

const SettingsPopup = () => {
    const { shortcuts } = useShortcuts();
    const isLightTheme = useResolvedTheme() === 'light';
    const [isUndetectable, setIsUndetectable] = useState(false);
    const [useGroqFastText, setUseGroqFastText] = useState(() => {
        return localStorage.getItem('natively_groq_fast_text') === 'true';
    });
    const [profileMode, setProfileMode] = useState(false);
    const [hasProfile, setHasProfile] = useState(false);
    const [isPremium, setIsPremium] = useState(false);

    const isFirstRender = React.useRef(true);

    const [hasStoredKey, setHasStoredKey] = useState<Record<string, boolean>>({});

    // Load credentials func
    const loadCredentials = async () => {
        try {
            // @ts-ignore
            const creds = await window.electronAPI?.getStoredCredentials?.();
            if (creds) {
                setHasStoredKey({
                    gemini: !!creds.hasGeminiKey,
                    groq: !!creds.hasGroqKey,
                    openai: !!creds.hasOpenaiKey,
                    claude: !!creds.hasClaudeKey,
                    natively: !!creds.hasNativelyKey
                });
            }
        } catch (e) {
            console.error("Failed to load settings:", e);
        }
    };

    // Load Initial Data and refresh on focus
    useEffect(() => {
        loadCredentials();
        const handleFocus = () => loadCredentials();
        window.addEventListener('focus', handleFocus);

        // Load profile status
        const loadProfile = async () => {
            try {
                // @ts-ignore
                const status = await window.electronAPI?.profileGetStatus?.();
                if (status) {
                    setHasProfile(status.hasProfile);
                    setProfileMode(status.profileMode);
                }
                // Check premium status
                const premium = await window.electronAPI?.licenseCheckPremium?.();
                setIsPremium(!!premium);
            } catch (e) { console.warn('[SettingsPopup] Failed to load profile/premium status:', e); }

        };
        loadProfile();

        return () => window.removeEventListener('focus', handleFocus);
    }, []);

    // Fetch initial undetectable state from main process (source of truth)
    useEffect(() => {
        if (window.electronAPI?.getUndetectable) {
            window.electronAPI.getUndetectable().then((state: boolean) => {
                setIsUndetectable(state);
            });
        }
    }, []);

    // One-way listener: receive state changes from main process, never echo back
    useEffect(() => {
        if (window.electronAPI?.onUndetectableChanged) {
            const unsubscribe = window.electronAPI.onUndetectableChanged((newState: boolean) => {
                setIsUndetectable(newState);
                localStorage.setItem('natively_undetectable', String(newState));
            });
            return () => unsubscribe();
        }
    }, []);

    useEffect(() => {
        // Listen for changes from other windows (2-way sync)
        if (window.electronAPI?.onGroqFastTextChanged) {
            const unsubscribe = window.electronAPI.onGroqFastTextChanged((enabled: boolean) => {
                setUseGroqFastText(enabled);
                localStorage.setItem('natively_groq_fast_text', String(enabled));
            });
            return () => unsubscribe();
        }
    }, []);

    useEffect(() => {
        // Skip initial render to avoid unnecessary IPC calls
        if (isFirstRender.current) {
            isFirstRender.current = false;
            // Ensure backend is synced on mount (even if no change)
            try {
                // @ts-ignore
                window.electronAPI?.invoke('set-groq-fast-text-mode', useGroqFastText);
            } catch (e) {
                console.error(e);
            }
            return;
        }

        // Apply Groq Text Mode
        localStorage.setItem('natively_groq_fast_text', String(useGroqFastText));
        try {
            // @ts-ignore - electronAPI not typed in this file yet
            window.electronAPI?.invoke('set-groq-fast-text-mode', useGroqFastText);
        } catch (e) {
            console.error(e);
        }
    }, [useGroqFastText]);

    const [actionButtonMode, setActionButtonModeState] = useState<'recap' | 'brainstorm'>('recap');

    const [showTranscript, setShowTranscript] = useState(() => {
        const stored = localStorage.getItem('natively_interviewer_transcript');
        return stored !== 'false'; // Default to true if not set
    });

    // v2.4.10: Auto-answer toggle mirror (M5-T8). Backed by the same
    // persisted setting the main Settings > General panel edits.
    const [rollingMode, setRollingMode] = useState<'off' | 'on-silence' | 'on-demand'>('off');
    useEffect(() => {
        // @ts-ignore
        window.electronAPI?.getRollingTriggerMode?.().then((mode: string) => {
            if (mode === 'off' || mode === 'on-silence' || mode === 'on-demand') {
                setRollingMode(mode as any);
            }
        }).catch(() => { });
        // @ts-ignore
        if (!window.electronAPI?.onRollingTriggerModeChanged) return;
        // @ts-ignore
        const unsubscribe = window.electronAPI.onRollingTriggerModeChanged((mode: string) => {
            if (mode === 'off' || mode === 'on-silence' || mode === 'on-demand') {
                setRollingMode(mode as any);
            }
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        const handleStorage = () => {
            const stored = localStorage.getItem('natively_interviewer_transcript');
            setShowTranscript(stored !== 'false');
        };

        window.addEventListener('storage', handleStorage);
        return () => window.removeEventListener('storage', handleStorage);
    }, []);

    // Load action button mode and subscribe to changes from other windows
    useEffect(() => {
        // @ts-ignore
        window.electronAPI?.getActionButtonMode?.()?.then((mode: 'recap' | 'brainstorm') => {
            setActionButtonModeState(mode ?? 'recap');
        }).catch(() => {});
        // @ts-ignore
        if (!window.electronAPI?.onActionButtonModeChanged) return;
        // @ts-ignore
        const unsubscribe = window.electronAPI.onActionButtonModeChanged((mode: 'recap' | 'brainstorm') => {
            setActionButtonModeState(mode);
        });
        return () => unsubscribe();
    }, []);

    // v2.6.2: Live Coding + Online Assessment mirrors in the overlay popup.
    // Both are backed by the same SettingsManager fields the main Settings
    // → General panel uses, so they stay in sync cross-window.
    const [liveCodingMode, setLiveCodingMode] = useState(false);
    const [assessmentMode, setAssessmentMode] = useState(false);
    useEffect(() => {
        window.electronAPI?.getLiveCodingModeEnabled?.().then((v: boolean) => setLiveCodingMode(!!v)).catch(() => { });
        window.electronAPI?.getOnlineAssessmentModeEnabled?.().then((v: boolean) => setAssessmentMode(!!v)).catch(() => { });
    }, []);
    useEffect(() => {
        const unsub = window.electronAPI?.onOnlineAssessmentModeChanged?.((enabled: boolean) => {
            setAssessmentMode(!!enabled);
        });
        return () => unsub?.();
    }, []);

    const contentRef = useRef<HTMLDivElement>(null);

    // Auto-resize Window
    useLayoutEffect(() => {
        if (!contentRef.current) return;

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const rect = entry.target.getBoundingClientRect();
                // Send exact dimensions to Electron
                try {
                    // @ts-ignore
                    window.electronAPI?.updateContentDimensions({
                        width: Math.ceil(rect.width),
                        height: Math.ceil(rect.height)
                    });
                } catch (e) {
                    console.warn("Failed to update dimensions", e);
                }
            }
        });

        observer.observe(contentRef.current);
        return () => observer.disconnect();
    }, []);

    const popupPanelClass = isLightTheme
        ? 'bg-[#F3F4F6]/92 border-black/10 shadow-black/10'
        : 'bg-[#1E1E1E]/80 border-white/10 shadow-black/40';
    const itemHoverClass = isLightTheme ? 'hover:bg-black/[0.04]' : 'hover:bg-white/5';
    const labelInactiveClass = isLightTheme ? 'text-slate-700 group-hover:text-slate-900' : 'text-slate-400 group-hover:text-slate-200';
    const iconInactiveClass = isLightTheme ? 'text-slate-500 group-hover:text-slate-700' : 'text-slate-500 group-hover:text-slate-300';
    const dividerClass = isLightTheme ? 'bg-black/[0.06]' : 'bg-white/[0.04]';
    const shortcutKeyClass = isLightTheme
        ? 'border-black/10 bg-black/[0.04] text-slate-600'
        : 'border-white/10 bg-white/5 text-slate-500';
    const defaultToggleTrackClass = isLightTheme ? 'bg-black/[0.22]' : 'bg-white/10';
    const toggleKnobClass = isLightTheme ? 'bg-white shadow-[0_1px_4px_rgba(0,0,0,0.18)]' : 'bg-black shadow-sm';

    return (
        <div className="w-fit h-fit bg-transparent flex flex-col">
            <div ref={contentRef} className={`w-[240px] max-h-[320px] backdrop-blur-md border rounded-[16px] overflow-hidden shadow-2xl p-2 flex flex-col animate-scale-in origin-top-left ${popupPanelClass}`}>
                <div className="flex-1 overflow-y-auto scrollbar-hide flex flex-col min-h-0">

                {/* Undetectability */}
                <div className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors duration-200 group cursor-default ${itemHoverClass}`}>
                    <div className="flex items-center gap-3">
                        <CustomGhost
                            className={`w-4 h-4 transition-colors ${isUndetectable ? (isLightTheme ? 'text-slate-900' : 'text-white') : iconInactiveClass}`}
                            fill={isUndetectable ? "currentColor" : "none"}
                            stroke={isUndetectable ? "none" : "currentColor"}
                            eyeColor={isUndetectable ? (isLightTheme ? "white" : "black") : (isLightTheme ? "#334155" : "white")}
                        />
                        <span className={`text-[12px] font-medium transition-colors ${isUndetectable ? (isLightTheme ? 'text-slate-950' : 'text-white') : labelInactiveClass}`}>{isUndetectable ? 'Undetectable' : 'Detectable'}</span>
                    </div>
                    <button
                        onClick={() => {
                            const newState = !isUndetectable;
                            setIsUndetectable(newState);
                            localStorage.setItem('natively_undetectable', String(newState));
                            window.electronAPI?.setUndetectable(newState);
                        }}
                        className={`w-[30px] h-[18px] rounded-full p-[1.5px] transition-all duration-300 ease-spring active:scale-[0.92] focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/40 ${isUndetectable
                            ? (isLightTheme ? 'bg-slate-900 shadow-[0_2px_8px_rgba(15,23,42,0.18)]' : 'bg-white shadow-[0_2px_8px_rgba(255,255,255,0.2)]')
                            : defaultToggleTrackClass}`}
                    >
                        <div className={`w-[15px] h-[15px] rounded-full transition-transform duration-300 ease-spring ${toggleKnobClass} ${isUndetectable ? 'translate-x-[12px]' : 'translate-x-0'}`} />
                    </button>
                </div>


                {/* Groq (Fast Text) Toggle — enabled with Groq key */}
                <div className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors duration-200 group ${!(hasStoredKey.groq || hasStoredKey.natively) ? 'opacity-50 grayscale cursor-not-allowed' : `${itemHoverClass} cursor-default`}`} title={!(hasStoredKey.groq || hasStoredKey.natively) ? "Requires Groq API key" : ""}>
                    <div className="flex items-center gap-3">
                        <Zap
                            className={`w-4 h-4 transition-colors ${useGroqFastText ? 'text-orange-500' : iconInactiveClass}`}
                            fill={useGroqFastText ? "currentColor" : "none"}
                        />
                        <span className={`text-[12px] font-medium transition-colors ${useGroqFastText ? (isLightTheme ? 'text-slate-950' : 'text-white') : labelInactiveClass}`}>Fast Response</span>
                    </div>
                    <button
                        onClick={() => {
                            if (!(hasStoredKey.groq || hasStoredKey.natively)) return;
                            setUseGroqFastText(!useGroqFastText);
                        }}
                        className={`w-[30px] h-[18px] rounded-full p-[1.5px] transition-all duration-300 ease-spring active:scale-[0.92] focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/40 ${useGroqFastText ? 'bg-orange-500 shadow-[0_2px_10px_rgba(249,115,22,0.3)]' : defaultToggleTrackClass}`}
                        disabled={!(hasStoredKey.groq || hasStoredKey.natively)}
                    >
                        <div className={`w-[15px] h-[15px] rounded-full transition-transform duration-300 ease-spring ${toggleKnobClass} ${useGroqFastText ? 'translate-x-[12px]' : 'translate-x-0'}`} />
                    </button>
                </div>

                {/* Interviewer Transcript Toggle */}
                <div className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors duration-200 group cursor-default ${itemHoverClass}`}>
                    <div className="flex items-center gap-3">
                        <MessageSquare
                            className={`w-3.5 h-3.5 transition-colors ${showTranscript ? 'text-emerald-400' : iconInactiveClass}`}
                            fill={showTranscript ? "currentColor" : "none"}
                        />
                        <span className={`text-[12px] font-medium transition-colors ${showTranscript ? (isLightTheme ? 'text-slate-950' : 'text-white') : labelInactiveClass}`}>Transcript</span>
                    </div>
                    <button
                        onClick={() => {
                            const newState = !showTranscript;
                            setShowTranscript(newState);
                            localStorage.setItem('natively_interviewer_transcript', String(newState));
                            // Dispatch event for same-window listeners
                            window.dispatchEvent(new Event('storage'));
                        }}
                        className={`w-[30px] h-[18px] rounded-full p-[1.5px] transition-all duration-300 ease-spring active:scale-[0.92] focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/40 ${showTranscript ? 'bg-emerald-500 shadow-[0_2px_10px_rgba(16,185,129,0.3)]' : defaultToggleTrackClass}`}
                    >
                        <div className={`w-[15px] h-[15px] rounded-full transition-transform duration-300 ease-spring ${toggleKnobClass} ${showTranscript ? 'translate-x-[12px]' : 'translate-x-0'}`} />
                    </button>
                </div>

                {/* Auto-answer Toggle — mirrors Settings > General. Off = manual (click Answer), On = auto-fire after interviewer pauses. */}
                <div className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors duration-200 group cursor-default ${itemHoverClass}`}>
                    <div className="flex items-center gap-3">
                        <Zap
                            className={`w-3.5 h-3.5 transition-colors ${rollingMode === 'on-silence' ? 'text-emerald-400' : iconInactiveClass}`}
                            fill={rollingMode === 'on-silence' ? "currentColor" : "none"}
                        />
                        <span className={`text-[12px] font-medium transition-colors ${rollingMode === 'on-silence' ? (isLightTheme ? 'text-slate-950' : 'text-white') : labelInactiveClass}`}>Auto-answer</span>
                    </div>
                    <button
                        onClick={() => {
                            const newMode: 'off' | 'on-silence' = rollingMode === 'on-silence' ? 'off' : 'on-silence';
                            setRollingMode(newMode);
                            // @ts-ignore
                            window.electronAPI?.setRollingTriggerMode?.(newMode).catch(() => { });
                        }}
                        className={`w-[30px] h-[18px] rounded-full p-[1.5px] transition-all duration-300 ease-spring active:scale-[0.92] focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/40 ${rollingMode === 'on-silence' ? 'bg-emerald-500 shadow-[0_2px_10px_rgba(16,185,129,0.3)]' : defaultToggleTrackClass}`}
                    >
                        <div className={`w-[15px] h-[15px] rounded-full transition-transform duration-300 ease-spring ${toggleKnobClass} ${rollingMode === 'on-silence' ? 'translate-x-[12px]' : 'translate-x-0'}`} />
                    </button>
                </div>

                {/* Interview Mode (Brainstorm) Toggle */}
                <div className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors duration-200 group cursor-default ${itemHoverClass}`}>
                    <div className="flex items-center gap-3">
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className={`w-3.5 h-3.5 transition-colors ${actionButtonMode === 'brainstorm' ? 'text-violet-400' : iconInactiveClass}`}
                        >
                            <line x1="6" y1="3" x2="6" y2="15" />
                            <circle cx="18" cy="6" r="3" />
                            <circle cx="6" cy="18" r="3" />
                            <path d="M18 9a9 9 0 0 1-9 9" />
                        </svg>
                        <span className={`text-[12px] font-medium transition-colors ${actionButtonMode === 'brainstorm' ? (isLightTheme ? 'text-slate-950' : 'text-white') : labelInactiveClass}`}>Interview Mode</span>
                    </div>
                    <button
                        onClick={async () => {
                            const newMode: 'recap' | 'brainstorm' = actionButtonMode === 'brainstorm' ? 'recap' : 'brainstorm';
                            setActionButtonModeState(newMode);
                            try {
                                // @ts-ignore
                                await window.electronAPI?.setActionButtonMode?.(newMode);
                            } catch (e) { console.error(e); }
                        }}
                        className={`w-[30px] h-[18px] rounded-full p-[1.5px] transition-all duration-300 ease-spring active:scale-[0.92] focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/40 ${actionButtonMode === 'brainstorm' ? 'bg-violet-500 shadow-[0_2px_10px_rgba(139,92,246,0.3)]' : defaultToggleTrackClass}`}
                    >
                        <div className={`w-[15px] h-[15px] rounded-full transition-transform duration-300 ease-spring ${toggleKnobClass} ${actionButtonMode === 'brainstorm' ? 'translate-x-[12px]' : 'translate-x-0'}`} />
                    </button>
                </div>

                {/* v2.6.2: Live Coding Mode — mirrors Settings → General toggle. */}
                <div className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors duration-200 group cursor-default ${itemHoverClass}`}>
                    <div className="flex items-center gap-3">
                        <Eye
                            className={`w-3.5 h-3.5 transition-colors ${liveCodingMode ? 'text-[var(--accent-primary)]' : iconInactiveClass}`}
                            fill={liveCodingMode ? 'currentColor' : 'none'}
                        />
                        <span className={`text-[12px] font-medium transition-colors ${liveCodingMode ? (isLightTheme ? 'text-slate-950' : 'text-white') : labelInactiveClass}`}>Live Coding</span>
                    </div>
                    <button
                        onClick={async () => {
                            const next = !liveCodingMode;
                            setLiveCodingMode(next);
                            try { await window.electronAPI?.setLiveCodingModeEnabled?.(next); } catch (e) { console.error(e); }
                        }}
                        className={`w-[30px] h-[18px] rounded-full p-[1.5px] transition-all duration-300 ease-spring active:scale-[0.92] focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/40 ${liveCodingMode ? 'bg-[var(--accent-primary)] shadow-[0_2px_10px_rgba(184,145,92,0.35)]' : defaultToggleTrackClass}`}
                    >
                        <div className={`w-[15px] h-[15px] rounded-full transition-transform duration-300 ease-spring ${toggleKnobClass} ${liveCodingMode ? 'translate-x-[12px]' : 'translate-x-0'}`} />
                    </button>
                </div>

                {/* v2.6.2: Online Assessment Mode — flips "What to answer?" into full-solution mode with a fresh screenshot. */}
                <div className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors duration-200 group cursor-default ${itemHoverClass}`}>
                    <div className="flex items-center gap-3">
                        <Brain
                            className={`w-3.5 h-3.5 transition-colors ${assessmentMode ? 'text-[var(--accent-primary)]' : iconInactiveClass}`}
                        />
                        <span className={`text-[12px] font-medium transition-colors ${assessmentMode ? (isLightTheme ? 'text-slate-950' : 'text-white') : labelInactiveClass}`}>Assessment</span>
                    </div>
                    <button
                        onClick={async () => {
                            const next = !assessmentMode;
                            setAssessmentMode(next);
                            try { await window.electronAPI?.setOnlineAssessmentModeEnabled?.(next); } catch (e) { console.error(e); }
                        }}
                        className={`w-[30px] h-[18px] rounded-full p-[1.5px] transition-all duration-300 ease-spring active:scale-[0.92] focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/40 ${assessmentMode ? 'bg-[var(--accent-primary)] shadow-[0_2px_10px_rgba(184,145,92,0.35)]' : defaultToggleTrackClass}`}
                    >
                        <div className={`w-[15px] h-[15px] rounded-full transition-transform duration-300 ease-spring ${toggleKnobClass} ${assessmentMode ? 'translate-x-[12px]' : 'translate-x-0'}`} />
                    </button>
                </div>

                {/* Profile Mode Toggle */}
                {hasProfile && (
                    <div className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors duration-200 group ${!isPremium ? 'opacity-50 grayscale cursor-not-allowed' : `${itemHoverClass} cursor-default`}`} title={!isPremium ? 'Requires Pro license to be active' : ''}>
                        <div className="flex items-center gap-3">
                            <User
                                className={`w-3.5 h-3.5 transition-colors ${profileMode && isPremium ? 'text-accent-primary' : iconInactiveClass}`}
                                fill={profileMode && isPremium ? "currentColor" : "none"}
                            />
                            <span className={`text-[12px] font-medium transition-colors ${profileMode && isPremium ? (isLightTheme ? 'text-slate-950' : 'text-white') : labelInactiveClass}`}>Profile Mode</span>
                        </div>
                        <button
                            onClick={async () => {
                                if (!isPremium) return;
                                const newState = !profileMode;
                                setProfileMode(newState);
                                try {
                                    // @ts-ignore
                                    await window.electronAPI?.profileSetMode?.(newState);
                                } catch (e) { console.error(e); }
                            }}
                            className={`w-[30px] h-[18px] rounded-full p-[1.5px] transition-all duration-300 ease-spring active:scale-[0.92] focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/40 ${profileMode && isPremium ? 'bg-accent-primary shadow-[0_2px_10px_rgba(var(--color-accent-primary),0.3)]' : defaultToggleTrackClass}`}
                            disabled={!isPremium}
                        >
                            <div className={`w-[15px] h-[15px] rounded-full transition-transform duration-300 ease-spring ${toggleKnobClass} ${profileMode && isPremium ? 'translate-x-[12px]' : 'translate-x-0'}`} />
                        </button>
                    </div>
                )}

                <div className={`h-px my-0.5 mx-2 ${dividerClass}`} />

                {/* Show/Hide sensi */}
                <div className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors duration-200 group interaction-base interaction-press ${itemHoverClass}`}>
                    <div className="flex items-center gap-3">
                        <MessageSquare className={`w-3.5 h-3.5 transition-colors ${iconInactiveClass}`} />
                        <span className={`text-[12px] transition-colors ${labelInactiveClass}`}>Show/Hide</span>
                    </div>
                    <div className="flex gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                        {/* Dynamic Keys for Toggle Visibility */}
                        {(shortcuts.toggleVisibility || ['⌘', 'B']).map((key, index) => (
                            <div key={index} className={`px-1.5 py-0.5 rounded border text-[10px] font-medium min-w-[20px] text-center ${shortcutKeyClass}`}>
                                {key}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Screenshot */}
                <div className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors duration-200 group interaction-base interaction-press ${itemHoverClass}`}>
                    <div className="flex items-center gap-3">
                        <Camera className={`w-3.5 h-3.5 transition-colors ${iconInactiveClass}`} />
                        <span className={`text-[12px] transition-colors ${labelInactiveClass}`}>Screenshot</span>
                    </div>
                    <div className="flex gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                        {/* Dynamic Keys for Take Screenshot */}
                        {(shortcuts.takeScreenshot || ['⌘', 'H']).map((key, index) => (
                            <div key={index} className={`px-1.5 py-0.5 rounded border text-[10px] font-medium min-w-[20px] text-center ${shortcutKeyClass}`}>
                                {key}
                            </div>
                        ))}
                    </div>
                </div>

                <div className={`h-px my-0.5 mx-2 ${dividerClass}`} />

                {/* sensi M2-T3: upstream donate block removed */}
                <div style={{ display: 'none' }}>
                    <div className="flex items-center gap-3">
                        <Heart className="w-3.5 h-3.5 text-pink-400" />
                        <span className="text-[12px]">Donate</span>
                    </div>
                    <div className="opacity-60">
                        <Link className="w-3 h-3" />
                    </div>
                </div>

                </div>
            </div>
        </div>
    );
};

interface CustomGhostProps {
    className?: string;
    fill?: string;
    stroke?: string;
    eyeColor?: string;
}

// Custom Ghost with dynamic eye color support
const CustomGhost = ({ className, fill, stroke, eyeColor }: CustomGhostProps) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill={fill || "none"}
        stroke={stroke || "currentColor"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
    >
        {/* Body */}
        <path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z" />
        {/* Eyes - No stroke, just fill */}
        <path
            d="M9 10h.01 M15 10h.01"
            stroke={eyeColor || "currentColor"}
            strokeWidth="2.5" // Slightly bolder for visibility
            fill="none"
        />
    </svg>
);

export default SettingsPopup;

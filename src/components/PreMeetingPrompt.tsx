import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar, Link as LinkIcon, Zap, X } from 'lucide-react';

interface PreMeetingEvent {
    id: string;
    title: string;
    startTime: string;
    endTime: string;
    link?: string;
}

/**
 * PreMeetingPrompt — surfaces 2 min before a calendar event starts.
 *
 * Main process sends a `pre-meeting-alert` IPC event; this component renders
 * a prominent modal in the launcher window with a binary choice:
 *   "Yes, get ready"  → start the meeting immediately
 *   "Not this one"    → dismiss (this event id is remembered so it won't re-fire)
 *
 * A setting in Settings → General disables the whole flow if the user prefers
 * native notifications only.
 */
export const PreMeetingPrompt: React.FC = () => {
    const [event, setEvent] = useState<PreMeetingEvent | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!window.electronAPI?.onPreMeetingAlert) return;
        const unsubscribe = window.electronAPI.onPreMeetingAlert((evt) => {
            if (!evt || !evt.id) return;
            setEvent(evt);
        });
        return () => unsubscribe();
    }, []);

    const handleAccept = async () => {
        if (!event) return;
        setBusy(true);
        try {
            await window.electronAPI?.preMeetingAcceptAlert?.({ id: event.id, title: event.title });
        } finally {
            setBusy(false);
            setEvent(null);
        }
    };

    const handleDismiss = async () => {
        if (!event) return;
        setBusy(true);
        try {
            await window.electronAPI?.preMeetingDismissAlert?.({ id: event.id });
        } finally {
            setBusy(false);
            setEvent(null);
        }
    };

    const startsInMin = event
        ? Math.max(0, Math.ceil((new Date(event.startTime).getTime() - Date.now()) / 60000))
        : 0;
    // v2.5.1: meeting-detector synthesizes event ids prefixed with 'detected:'
    // so we know whether this is a calendar pre-alert ("Meeting in X min") or
    // an auto-detect after the call already started ("Meeting started").
    const isAutoDetected = !!event && event.id.startsWith('detected:');

    return (
        <AnimatePresence>
            {event && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/40 backdrop-blur-sm"
                    onClick={handleDismiss}
                >
                    <motion.div
                        initial={{ scale: 0.94, y: 12, opacity: 0 }}
                        animate={{ scale: 1, y: 0, opacity: 1 }}
                        exit={{ scale: 0.96, y: 8, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                        onClick={(e) => e.stopPropagation()}
                        className="relative w-[440px] max-w-[90vw] rounded-2xl overflow-hidden bg-bg-elevated border border-border-subtle shadow-[0_40px_80px_-20px_rgba(0,0,0,0.6),0_0_0_1px_rgba(184,145,92,0.12)]"
                    >
                        {/* Ambient brass glows — matches Up Next card */}
                        <div className="absolute top-0 right-0 w-[240px] h-[240px] bg-[var(--accent-primary)] opacity-[0.10] blur-[80px] pointer-events-none" />
                        <div className="absolute bottom-0 left-0 w-[160px] h-[160px] bg-[var(--accent-primary)] opacity-[0.05] blur-[70px] pointer-events-none" />

                        <button
                            onClick={handleDismiss}
                            className="absolute top-3 right-3 z-10 p-1.5 rounded-full text-text-tertiary hover:text-text-primary hover:bg-white/[0.06] transition-colors"
                            aria-label="Close"
                        >
                            <X size={14} />
                        </button>

                        <div className="relative z-10 p-6">
                            {/* Eyebrow */}
                            <div className="flex items-center gap-2 mb-3">
                                <div className="relative flex items-center justify-center w-2 h-2">
                                    <div className="absolute inset-0 rounded-full bg-[var(--accent-primary)] opacity-30 animate-ping" />
                                    <div className="relative w-1.5 h-1.5 rounded-full bg-[var(--accent-primary)] shadow-[0_0_6px_rgba(184,145,92,0.8)]" />
                                </div>
                                <span className="text-[10.5px] font-bold text-[var(--accent-primary)] uppercase tracking-[0.18em]">
                                    {isAutoDetected ? 'Meeting started' : `Meeting in ${startsInMin} min`}
                                </span>
                            </div>

                            {/* Title */}
                            <h2 className="text-[22px] font-celeb-light font-medium text-text-primary leading-[1.2] tracking-[-0.01em] mb-2 line-clamp-3">
                                {event.title}
                            </h2>

                            {/* Time — only show for calendar events; detected meetings don't have reliable end time */}
                            {!isAutoDetected && (
                                <div className="flex items-center gap-2 text-text-secondary text-[12px]">
                                    <Calendar size={12} className="opacity-70" />
                                    <span className="tabular-nums">
                                        {new Date(event.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} — {new Date(event.endTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                                    </span>
                                    {event.link && (
                                        <>
                                            <span className="opacity-30">·</span>
                                            <LinkIcon size={11} className="text-[var(--accent-primary)] opacity-80" />
                                            <span className="text-[var(--accent-primary)] opacity-90">Link ready</span>
                                        </>
                                    )}
                                </div>
                            )}

                            {/* Prompt copy */}
                            <p className="mt-5 text-[13px] text-text-secondary leading-relaxed">
                                {isAutoDetected
                                    ? <>Looks like your call just started. Want sensi to come along? Tap <span className="font-medium text-text-primary">Yes</span> to start capturing audio and standing by with answers, or <span className="font-medium text-text-primary">Not this one</span> to skip.</>
                                    : <>Want sensi to come along? Tap <span className="font-medium text-text-primary">Yes</span> to start capturing audio and standing by with answers, or <span className="font-medium text-text-primary">Not this one</span> to skip.</>}
                            </p>

                            {/* Buttons */}
                            <div className="mt-5 flex items-center gap-2">
                                <motion.button
                                    onClick={handleAccept}
                                    disabled={busy}
                                    whileTap={{ scale: 0.98 }}
                                    className="flex-1 px-4 py-2.5 rounded-md text-[13px] font-semibold bg-[var(--accent-primary)] hover:brightness-110 text-[#16151A] transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-[0_8px_24px_-8px_rgba(184,145,92,0.5)]"
                                >
                                    <Zap size={13} />
                                    Yes, bring sensi
                                </motion.button>
                                <motion.button
                                    onClick={handleDismiss}
                                    disabled={busy}
                                    whileTap={{ scale: 0.98 }}
                                    className="px-4 py-2.5 rounded-md text-[13px] font-medium text-text-secondary hover:text-text-primary hover:bg-white/[0.05] transition-colors disabled:opacity-60"
                                >
                                    Not this one
                                </motion.button>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
    Sparkles,
    X,
    RefreshCw,
    AlertCircle,
    FileText,
    Briefcase,
    Globe,
    User,
    Zap,
} from 'lucide-react';
import type { PrepBriefingIpc } from '../types/electron';

/**
 * sensi M7 / PREP-01 — Pre-meeting briefing modal.
 *
 * Invoked from the "Prep me" button on each Upcoming Meetings row.
 * Calls prep:get-briefing for the selected event (which composes
 * persona + JD + docs + research + talking points via one LLM call)
 * and renders the markdown result in a scrollable card with a
 * "Bring sensi" primary action that starts the meeting armed.
 */
interface PrepBriefingModalProps {
    event: { id: string; title: string; description?: string; startTime: string };
    onClose: () => void;
    onStartMeeting?: () => void;
}

export const PrepBriefingModal: React.FC<PrepBriefingModalProps> = ({ event, onClose, onStartMeeting }) => {
    const [briefing, setBriefing] = useState<PrepBriefingIpc | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [regenerating, setRegenerating] = useState(false);

    const load = React.useCallback(async (force: boolean = false) => {
        if (!window.electronAPI?.prepGetBriefing) {
            setError('Prep briefing not available in this build.');
            setLoading(false);
            return;
        }
        setError(null);
        if (force) setRegenerating(true); else setLoading(true);
        try {
            const res = await window.electronAPI.prepGetBriefing({
                eventId: event.id,
                title: event.title,
                description: event.description,
                force,
            });
            if (res && 'success' in res && res.success) {
                setBriefing(res.briefing);
            } else {
                setError((res as any)?.error ?? 'Failed to generate briefing.');
            }
        } catch (err: any) {
            setError(err?.message ?? 'Failed to generate briefing.');
        } finally {
            setLoading(false);
            setRegenerating(false);
        }
    }, [event.id, event.title, event.description]);

    useEffect(() => { void load(false); }, [load]);

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
                onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
            >
                <motion.div
                    initial={{ scale: 0.96, y: 8, opacity: 0 }}
                    animate={{ scale: 1, y: 0, opacity: 1 }}
                    exit={{ scale: 0.96, y: 4, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                    className="relative w-[560px] max-w-[95vw] max-h-[85vh] rounded-2xl overflow-hidden bg-bg-elevated border border-border-subtle shadow-[0_40px_80px_-20px_rgba(0,0,0,0.6),0_0_0_1px_rgba(184,145,92,0.12)] flex flex-col"
                >
                    {/* Ambient brass glow */}
                    <div className="absolute top-0 right-0 w-[260px] h-[260px] bg-[var(--accent-primary)] opacity-[0.08] blur-[90px] pointer-events-none" />

                    {/* Header */}
                    <div className="relative z-10 px-6 pt-6 pb-4 border-b border-border-subtle flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1.5">
                                <Sparkles size={12} className="text-[var(--accent-primary)]" />
                                <span className="text-[10.5px] font-bold text-[var(--accent-primary)] uppercase tracking-[0.18em]">
                                    Prep briefing
                                </span>
                            </div>
                            <h2 className="text-[18px] font-celeb-light font-medium text-text-primary leading-[1.2] tracking-[-0.005em] truncate" title={event.title}>
                                {event.title || 'Untitled event'}
                            </h2>
                            <p className="text-[11px] text-text-tertiary mt-1 tabular-nums">
                                {new Date(event.startTime).toLocaleString([], {
                                    weekday: 'short',
                                    hour: 'numeric',
                                    minute: '2-digit',
                                    month: 'short',
                                    day: 'numeric',
                                })}
                            </p>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-1.5 rounded-full text-text-tertiary hover:text-text-primary hover:bg-white/[0.06] transition-colors flex-shrink-0"
                            aria-label="Close"
                        >
                            <X size={14} />
                        </button>
                    </div>

                    {/* Input badges */}
                    {briefing && (
                        <div className="relative z-10 px-6 py-2 flex items-center gap-2 flex-wrap border-b border-border-subtle">
                            <InputBadge icon={<User size={10} />} label="Resume" active={briefing.inputs.hasResume} />
                            <InputBadge icon={<Briefcase size={10} />} label={briefing.inputs.company ? briefing.inputs.company : 'JD'} active={briefing.inputs.hasJD} />
                            <InputBadge icon={<FileText size={10} />} label={`${briefing.inputs.attachedDocCount} doc${briefing.inputs.attachedDocCount === 1 ? '' : 's'}`} active={briefing.inputs.attachedDocCount > 0} />
                            <InputBadge icon={<Globe size={10} />} label="Research" active={briefing.inputs.hasResearch} />
                            <button
                                onClick={() => void load(true)}
                                disabled={regenerating}
                                className="ml-auto text-[10.5px] text-text-tertiary hover:text-text-primary inline-flex items-center gap-1 transition-colors disabled:opacity-60"
                                title="Regenerate briefing from fresh inputs"
                            >
                                <RefreshCw size={10} className={regenerating ? 'animate-spin' : ''} />
                                Regenerate
                            </button>
                        </div>
                    )}

                    {/* Body */}
                    <div className="relative z-10 flex-1 overflow-y-auto px-6 py-4">
                        {loading && (
                            <div className="flex flex-col items-center justify-center py-12 gap-3 text-text-tertiary">
                                <div className="relative flex items-center justify-center w-10 h-10">
                                    <div className="absolute inset-0 rounded-full bg-[var(--accent-primary)] opacity-20 animate-ping" />
                                    <Sparkles size={18} className="text-[var(--accent-primary)]" />
                                </div>
                                <span className="text-[12px]">Composing briefing…</span>
                                <span className="text-[10px] opacity-70">Pulls persona, JD, attached docs, and company research</span>
                            </div>
                        )}
                        {!loading && error && (
                            <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[12px] flex items-start gap-2">
                                <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}
                        {!loading && briefing && (
                            <div className="prose prose-sm prose-invert max-w-none text-text-primary prep-markdown">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {briefing.brief}
                                </ReactMarkdown>
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="relative z-10 px-6 py-4 border-t border-border-subtle flex items-center gap-2">
                        {onStartMeeting && (
                            <motion.button
                                whileTap={{ scale: 0.98 }}
                                onClick={() => { onStartMeeting(); onClose(); }}
                                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-[var(--accent-primary)] text-[#16151A] text-[13px] font-semibold hover:brightness-110 transition-all shadow-[0_8px_24px_-8px_rgba(184,145,92,0.5)]"
                            >
                                <Zap size={13} /> Bring sensi
                            </motion.button>
                        )}
                        <button
                            onClick={onClose}
                            className="px-4 py-2.5 rounded-md text-[13px] font-medium text-text-secondary hover:text-text-primary hover:bg-white/[0.05] transition-colors"
                        >
                            Close
                        </button>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};

interface InputBadgeProps {
    icon: React.ReactNode;
    label: string;
    active: boolean;
}

const InputBadge: React.FC<InputBadgeProps> = ({ icon, label, active }) => (
    <span
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${
            active
                ? 'border-[var(--accent-primary)]/30 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]'
                : 'border-border-subtle bg-bg-input text-text-tertiary opacity-50'
        }`}
        title={active ? `${label} included` : `${label} not available`}
    >
        {icon}
        {label}
    </span>
);

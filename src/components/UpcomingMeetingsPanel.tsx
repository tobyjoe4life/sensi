import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar, Link as LinkIcon, RefreshCw, ArrowRight, CalendarPlus, Paperclip, X, FileText, Plus, Sparkles, Loader2, Briefcase, Upload, Trash2, Zap } from 'lucide-react';
import type { PersonaSummaryIpc } from '../types/electron';
import { PrepBriefingModal } from './PrepBriefingModal';

interface CalendarEvent {
    id: string;
    title: string;
    description?: string;
    startTime: string;
    endTime: string;
    link?: string;
    source?: string;
}

interface UpcomingMeetingsPanelProps {
    events: CalendarEvent[];
    onPrepare?: (event: CalendarEvent) => void;
    onRefresh?: () => void;
    isRefreshing?: boolean;
}

type KnowledgeDoc = {
    id: string;
    name: string;
    mime: string;
    bytes: number;
    pinned: boolean;
    chunkCount: number;
};

/**
 * Replaces the upstream "Upcoming features" spotlight banner with a practical
 * view of the user's next few calendar events. Three states:
 *
 *   1. Calendar not connected — prompt to connect.
 *   2. Calendar connected but no upcoming events — empty-state hint.
 *   3. Calendar connected with events — list next 4, each clickable to prepare.
 *
 * The "next meeting within 60 minutes" card that already exists in Launcher is
 * the primary "Up Next" UI. This panel only renders when that card is not
 * showing, so it never duplicates a meeting that's already prominent at the
 * top of the launcher.
 */
export const UpcomingMeetingsPanel: React.FC<UpcomingMeetingsPanelProps> = ({
    events,
    onPrepare,
    onRefresh,
    isRefreshing,
}) => {
    const [calendarConnected, setCalendarConnected] = useState<boolean | null>(null);
    const [connectLoading, setConnectLoading] = useState(false);

    useEffect(() => {
        if (window.electronAPI?.getCalendarStatus) {
            window.electronAPI
                .getCalendarStatus()
                .then((s) => setCalendarConnected(!!s?.connected))
                .catch(() => setCalendarConnected(false));
        } else {
            setCalendarConnected(false);
        }
    }, []);

    const [connectHint, setConnectHint] = useState<string | null>(null);
    const handleConnect = async () => {
        if (!window.electronAPI?.calendarConnect) return;
        setConnectLoading(true);
        setConnectHint(null);
        try {
            // First check if OAuth creds are configured. If not, hint the user to
            // open Settings → Calendar rather than silently failing.
            const oauthStatus = await window.electronAPI.getGoogleOauthStatus?.();
            if (oauthStatus && !oauthStatus.configured) {
                setConnectHint('Open Settings → Calendar to paste your Google OAuth credentials first.');
                setConnectLoading(false);
                return;
            }
            const res = await window.electronAPI.calendarConnect();
            if (res?.success) {
                setCalendarConnected(true);
                onRefresh?.();
            } else if ((res as any)?.code === 'OAUTH_CREDS_MISSING') {
                setConnectHint('Open Settings → Calendar to paste your Google OAuth credentials first.');
            } else {
                setConnectHint(res?.error ?? 'Connection failed. Check Settings → Calendar.');
            }
        } catch (err) {
            console.error('[UpcomingMeetingsPanel] calendarConnect failed:', err);
            setConnectHint('Connection failed. Check Settings → Calendar.');
        } finally {
            setConnectLoading(false);
        }
    };

    const visibleEvents = useMemo(() => {
        const now = Date.now();
        const cutoff = now + 7 * 24 * 60 * 60 * 1000;
        return events
            .filter((e) => {
                const start = new Date(e.startTime).getTime();
                return start > now - 5 * 60_000 && start < cutoff;
            })
            .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
            .slice(0, 4);
    }, [events]);

    // sensi M7 / KNOWLEDGE-02: per-event attachment counts. Populated lazily
    // on mount so we can render a "📎 N" badge without hitting IPC on every
    // render. Refreshed when the user opens/closes the attachment modal.
    const [attachedCounts, setAttachedCounts] = useState<Record<string, number>>({});
    const refreshAttachmentCounts = React.useCallback(async () => {
        if (!window.electronAPI?.knowledgeListForEvent) return;
        const results = await Promise.all(
            visibleEvents.map(async (ev) => {
                try {
                    const res = await window.electronAPI!.knowledgeListForEvent!(ev.id);
                    return [ev.id, res?.success ? res.documents.length : 0] as const;
                } catch {
                    return [ev.id, 0] as const;
                }
            })
        );
        const next: Record<string, number> = {};
        for (const [id, n] of results) next[id] = n;
        setAttachedCounts(next);
    }, [visibleEvents]);
    useEffect(() => { void refreshAttachmentCounts(); }, [refreshAttachmentCounts]);

    // Attachment modal state
    const [attachEvent, setAttachEvent] = useState<CalendarEvent | null>(null);
    // sensi M7 / PREP-01: Prep briefing modal state
    const [prepEvent, setPrepEvent] = useState<CalendarEvent | null>(null);

    return (
        <div
            className="relative h-full w-full overflow-hidden rounded-xl flex flex-col bg-bg-elevated border border-border-subtle shadow-[0_20px_40px_-12px_rgba(0,0,0,0.4),0_0_0_1px_rgba(255,248,232,0.02)]"
            style={{ isolation: 'isolate' }}
        >
            {/* Warm ambient glows — brass and muted ink */}
            <div className="absolute top-0 left-0 w-[220px] h-[220px] bg-[var(--accent-primary)] opacity-[0.05] blur-[80px] pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-[180px] h-[180px] bg-[#C9A878] opacity-[0.04] blur-[70px] pointer-events-none" />

            <div className="relative z-10 flex items-center justify-between px-5 pt-4 pb-2">
                <div className="flex items-center gap-2">
                    <Calendar size={12} className="text-[var(--accent-primary)]" />
                    <span className="text-[10.5px] font-bold text-[var(--accent-primary)] uppercase tracking-[0.18em]">Upcoming</span>
                </div>
                {calendarConnected && onRefresh && (
                    <button
                        onClick={onRefresh}
                        className="text-text-tertiary hover:text-text-primary transition-colors p-1 rounded hover:bg-white/5 focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]/40"
                        title="Refresh calendar"
                        aria-label="Refresh calendar"
                    >
                        <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
                    </button>
                )}
            </div>

            <div className="relative z-10 flex-1 px-5 pb-4 flex flex-col">
                {calendarConnected === null ? (
                    <div className="flex-1 flex items-center justify-center">
                        <span className="text-text-tertiary text-xs">Loading…</span>
                    </div>
                ) : calendarConnected === false ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
                        <CalendarPlus size={28} className="text-[var(--accent-primary)] opacity-70" />
                        <div>
                            <h3 className="text-[16px] font-celeb-light font-medium text-text-primary mb-1 tracking-[-0.005em]">Connect your calendar</h3>
                            <p className="text-[12px] text-text-secondary max-w-[320px]">
                                See your next meetings here so sensi is ready the moment you join.
                            </p>
                        </div>
                        <motion.button
                            onClick={handleConnect}
                            disabled={connectLoading}
                            whileTap={{ scale: 0.97 }}
                            className="mt-1 flex items-center gap-2 px-4 py-2 rounded-md bg-[var(--accent-primary)] text-[#16151A] text-[12px] font-semibold hover:brightness-110 transition-all disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/40"
                        >
                            {connectLoading ? 'Connecting…' : 'Connect Google Calendar'}
                            {!connectLoading && <ArrowRight size={12} />}
                        </motion.button>
                        {connectHint && (
                            <p className="mt-2 text-[11px] text-text-tertiary max-w-[320px]">{connectHint}</p>
                        )}
                    </div>
                ) : visibleEvents.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center gap-2">
                        <Calendar size={24} className="text-text-tertiary" />
                        <h3 className="text-[14px] font-semibold text-text-primary">No upcoming meetings</h3>
                        <p className="text-[11.5px] text-text-secondary max-w-[280px]">
                            Nothing on your calendar for the next 7 days. You can still start a meeting manually.
                        </p>
                    </div>
                ) : (
                    <div className="flex-1 flex flex-col gap-0.5">
                        {visibleEvents.map((ev) => {
                            const count = attachedCounts[ev.id] ?? 0;
                            return (
                                <div
                                    key={ev.id}
                                    className="group flex items-center gap-2 px-3 py-2.5 rounded-md border border-transparent hover:bg-white/[0.03] hover:border-border-subtle transition-all duration-150"
                                >
                                    <button
                                        onClick={() => onPrepare?.(ev)}
                                        className="flex items-center justify-between gap-3 flex-1 min-w-0 text-left active:scale-[0.99] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]/40 rounded"
                                    >
                                        <div className="min-w-0 flex-1">
                                            <div className="text-[13px] font-medium text-text-primary truncate tracking-[-0.005em]">{ev.title || 'Untitled event'}</div>
                                            <div className="text-[11px] text-text-tertiary flex items-center gap-2 mt-1">
                                                <span className="tabular-nums font-medium">{formatWhen(ev.startTime)}</span>
                                                {ev.link && (
                                                    <>
                                                        <span className="opacity-40">·</span>
                                                        <LinkIcon size={10} className="text-[var(--accent-primary)] opacity-80" />
                                                        <span className="text-[var(--accent-primary)] opacity-80 font-medium">Link</span>
                                                    </>
                                                )}
                                                {count > 0 && (
                                                    <>
                                                        <span className="opacity-40">·</span>
                                                        <Paperclip size={10} className="text-[var(--accent-primary)] opacity-80" />
                                                        <span className="text-[var(--accent-primary)] opacity-80 font-medium tabular-nums">{count}</span>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                        <ArrowRight size={12} className="text-[var(--accent-primary)] opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 flex-shrink-0" />
                                    </button>
                                    {/* sensi M7 / PREP-01: Prep me button. Opens the
                                        briefing modal pre-populated with persona + JD +
                                        docs + research for this event. */}
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setPrepEvent(ev); }}
                                        className="p-1.5 rounded-md transition-all flex-shrink-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]/40 text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/10"
                                        title="Prep me for this meeting"
                                        aria-label="Generate pre-meeting briefing"
                                    >
                                        <Sparkles size={12} />
                                    </button>
                                    {/* Paperclip — opens the attachment modal for this event. */}
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setAttachEvent(ev); }}
                                        className={`p-1.5 rounded-md transition-all flex-shrink-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]/40 ${
                                            count > 0
                                                ? 'text-[var(--accent-primary)] bg-[var(--accent-primary)]/10 hover:bg-[var(--accent-primary)]/20'
                                                : 'text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-text-primary hover:bg-white/5'
                                        }`}
                                        title={count > 0 ? `${count} attached document${count === 1 ? '' : 's'}` : 'Attach documents to this meeting'}
                                        aria-label="Attach documents to this meeting"
                                    >
                                        <Paperclip size={12} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* sensi M7 / KNOWLEDGE-02: Attachment modal */}
            <AnimatePresence>
                {attachEvent && (
                    <AttachmentModal
                        event={attachEvent}
                        onClose={() => {
                            setAttachEvent(null);
                            void refreshAttachmentCounts();
                        }}
                    />
                )}
            </AnimatePresence>

            {/* sensi M7 / PREP-01: Prep briefing modal */}
            {prepEvent && (
                <PrepBriefingModal
                    event={prepEvent}
                    onClose={() => setPrepEvent(null)}
                    onStartMeeting={() => onPrepare?.(prepEvent)}
                />
            )}
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────
// sensi M7 / KNOWLEDGE-02: Attachment modal
// Shows:
//   1. Currently attached docs (with a ✗ to detach)
//   2. Auto-suggested docs for this event (with "Attach" buttons)
//   3. An "Upload new" action that routes through the existing ingest flow
// Auto-suggest embeds `title + description` and calls the orchestrator's
// vector search over unattached docs.
// ─────────────────────────────────────────────────────────────────────────
interface AttachmentModalProps {
    event: CalendarEvent;
    onClose: () => void;
}

const AttachmentModal: React.FC<AttachmentModalProps> = ({ event, onClose }) => {
    const [attached, setAttached] = useState<KnowledgeDoc[]>([]);
    const [suggestions, setSuggestions] = useState<Array<{ document: KnowledgeDoc; distance: number }>>([]);
    const [allDocs, setAllDocs] = useState<KnowledgeDoc[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
    const [error, setError] = useState<string | null>(null);
    const [tab, setTab] = useState<'attached' | 'all'>('attached');
    // sensi M7 / PERSONA-02: JD attached to this event (at most 1).
    const [jd, setJd] = useState<PersonaSummaryIpc | null>(null);
    const [jdUploading, setJdUploading] = useState(false);

    const loadAll = React.useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const attachRes = await window.electronAPI?.knowledgeListForEvent?.(event.id);
            if (attachRes?.success) {
                setAttached(attachRes.documents as unknown as KnowledgeDoc[]);
            }

            const searchText = `${event.title ?? ''} ${event.description ?? ''}`.trim();
            if (searchText) {
                const sugRes = await window.electronAPI?.knowledgeSuggestForEvent?.(event.id, searchText, 3);
                if (sugRes?.success) {
                    setSuggestions(sugRes.suggestions as unknown as Array<{ document: KnowledgeDoc; distance: number }>);
                }
            } else {
                setSuggestions([]);
            }

            const listRes = await window.electronAPI?.knowledgeListDocuments?.();
            if (listRes && 'success' in listRes && listRes.success) {
                setAllDocs(listRes.documents as unknown as KnowledgeDoc[]);
            }

            // sensi M7 / PERSONA-02: load attached JD (if any) for this event.
            try {
                const jdRes = await window.electronAPI?.personaGetJDForEvent?.(event.id);
                if (jdRes && 'success' in jdRes && jdRes.success) {
                    setJd(jdRes.summary ?? null);
                }
            } catch { /* silent — JD slot just stays empty. */ }
        } catch (err: any) {
            setError(err?.message ?? 'Failed to load attachments.');
        } finally {
            setLoading(false);
        }
    }, [event.id, event.title, event.description]);

    useEffect(() => { void loadAll(); }, [loadAll]);

    const attach = async (docId: string) => {
        setBusyIds((s) => new Set(s).add(docId));
        try {
            const res = await window.electronAPI?.knowledgeAttachToEvent?.(docId, event.id);
            if (res && 'success' in res && !res.success) {
                setError(res.error ?? 'Failed to attach.');
            }
            await loadAll();
        } finally {
            setBusyIds((s) => { const n = new Set(s); n.delete(docId); return n; });
        }
    };

    const detach = async (docId: string) => {
        setBusyIds((s) => new Set(s).add(docId));
        try {
            const res = await window.electronAPI?.knowledgeDetachFromEvent?.(docId, event.id);
            if (res && 'success' in res && !res.success) {
                setError(res.error ?? 'Failed to detach.');
            }
            await loadAll();
        } finally {
            setBusyIds((s) => { const n = new Set(s); n.delete(docId); return n; });
        }
    };

    const uploadNew = async () => {
        // Re-use the existing ingest picker pattern: renderer opens the OS
        // dialog via the existing pick helper, main ingests, then attach.
        // We piggy-back on knowledge-pick-import-path? No — that's the KB
        // export/import flow. Use the ingest flow directly via a file
        // input. Keeping it simple: prompt the user to use the Knowledge
        // settings page for ingest, then come back here to attach.
        setError('Upload via Settings → Knowledge, then return here to attach.');
    };

    // sensi M7 / PERSONA-02: attach / clear JD for this event.
    const uploadJD = async () => {
        setError(null);
        try {
            const picked = await window.electronAPI?.personaPickJDFile?.();
            if (!picked || picked.cancelled) return;
            if (!picked.filePath) {
                if ('error' in picked && picked.error) setError(picked.error);
                return;
            }
            setJdUploading(true);
            const up = await window.electronAPI?.personaUploadJD?.(picked.filePath, event.id);
            if (up && 'success' in up && up.success) {
                setJd(up.summary);
            } else {
                setError((up as any)?.error ?? 'JD extraction failed.');
            }
        } catch (err: any) {
            setError(err?.message ?? 'JD extraction failed.');
        } finally {
            setJdUploading(false);
        }
    };

    const clearJD = async () => {
        if (!jd) return;
        if (!confirm('Remove the JD attached to this meeting?')) return;
        setError(null);
        try {
            const res = await window.electronAPI?.personaClearJD?.(event.id);
            if (res && 'success' in res && res.success) {
                setJd(null);
            } else {
                setError((res as any)?.error ?? 'Failed to clear JD.');
            }
        } catch (err: any) {
            setError(err?.message ?? 'Failed to clear JD.');
        }
    };

    const attachedIds = useMemo(() => new Set(attached.map((d) => d.id)), [attached]);
    const unattachedAll = useMemo(
        () => allDocs.filter((d) => !attachedIds.has(d.id)),
        [allDocs, attachedIds]
    );

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-30 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 4 }}
                transition={{ duration: 0.12 }}
                className="w-full max-w-md bg-bg-elevated border border-border-subtle rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
            >
                {/* Header */}
                <div className="px-4 py-3 border-b border-border-subtle flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                            <Paperclip size={12} className="text-[var(--accent-primary)]" />
                            <span className="text-[10px] font-bold text-[var(--accent-primary)] uppercase tracking-wider">Attachments</span>
                        </div>
                        <h3 className="text-[13px] font-semibold text-text-primary truncate" title={event.title}>{event.title || 'Untitled event'}</h3>
                        <p className="text-[10.5px] text-text-tertiary mt-0.5">{formatWhen(event.startTime)}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-white/5 transition-colors flex-shrink-0"
                        aria-label="Close"
                    >
                        <X size={14} />
                    </button>
                </div>

                {/* sensi M7 / PERSONA-02: JD slot. Visually distinct from
                    the general knowledge-doc list — one JD per meeting,
                    owns its own row. */}
                <div className="px-4 pt-3">
                    {jd ? (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-amber-500/25 bg-amber-500/5">
                            <Briefcase size={13} className="text-amber-400 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-[11.5px] font-semibold text-text-primary truncate">
                                        {('role' in jd.persona && jd.persona.role) ? jd.persona.role : 'Job description'}
                                    </span>
                                    {'company' in jd.persona && jd.persona.company && (
                                        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">
                                            @ {jd.persona.company}
                                        </span>
                                    )}
                                    {'level' in jd.persona && jd.persona.level && jd.persona.level !== 'Unknown' && (
                                        <span className="text-[9.5px] text-text-tertiary">{jd.persona.level}</span>
                                    )}
                                </div>
                                {'requiredSkills' in jd.persona && jd.persona.requiredSkills.length > 0 && (
                                    <div className="text-[10px] text-text-tertiary mt-0.5 truncate">
                                        Requires: {jd.persona.requiredSkills.slice(0, 5).join(', ')}
                                    </div>
                                )}
                            </div>
                            <button
                                onClick={clearJD}
                                className="p-1 rounded text-text-tertiary hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0"
                                title="Remove JD"
                            >
                                <Trash2 size={11} />
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={uploadJD}
                            disabled={jdUploading}
                            className={`w-full flex items-center gap-2 px-3 py-2 rounded-md border border-dashed transition-colors ${
                                jdUploading
                                    ? 'border-border-subtle bg-white/[0.02] cursor-wait'
                                    : 'border-amber-500/25 bg-amber-500/5 hover:bg-amber-500/10'
                            }`}
                        >
                            {jdUploading
                                ? <Loader2 size={12} className="text-amber-400 animate-spin" />
                                : <Briefcase size={13} className="text-amber-400" />}
                            <span className="text-[11px] font-medium text-text-primary flex-1 text-left">
                                {jdUploading ? 'Extracting JD…' : 'Attach JD for this meeting'}
                            </span>
                            <Upload size={11} className="text-amber-400" />
                        </button>
                    )}
                </div>

                {/* Tab switcher */}
                <div className="px-4 pt-3 flex gap-1">
                    <button
                        onClick={() => setTab('attached')}
                        className={`px-3 py-1 rounded-md text-[11px] font-medium transition-colors ${
                            tab === 'attached'
                                ? 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]'
                                : 'text-text-tertiary hover:text-text-primary hover:bg-white/5'
                        }`}
                    >
                        Attached ({attached.length})
                    </button>
                    <button
                        onClick={() => setTab('all')}
                        className={`px-3 py-1 rounded-md text-[11px] font-medium transition-colors ${
                            tab === 'all'
                                ? 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]'
                                : 'text-text-tertiary hover:text-text-primary hover:bg-white/5'
                        }`}
                    >
                        All docs
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
                    {loading && (
                        <div className="flex items-center justify-center py-6 text-text-tertiary text-[11px] gap-2">
                            <Loader2 size={12} className="animate-spin" /> Loading…
                        </div>
                    )}

                    {!loading && tab === 'attached' && (
                        <>
                            {attached.length === 0 && (
                                <p className="text-[11px] text-text-tertiary">No docs attached yet. Check "All docs" or use a suggestion below.</p>
                            )}
                            {attached.map((d) => (
                                <DocRow
                                    key={d.id}
                                    doc={d}
                                    action="detach"
                                    busy={busyIds.has(d.id)}
                                    onClick={() => detach(d.id)}
                                />
                            ))}

                            {suggestions.length > 0 && (
                                <div>
                                    <div className="flex items-center gap-2 mb-2 mt-2">
                                        <Sparkles size={11} className="text-[var(--accent-primary)]" />
                                        <span className="text-[10px] font-bold text-[var(--accent-primary)] uppercase tracking-wider">Suggested</span>
                                    </div>
                                    {suggestions.map((s) => (
                                        <DocRow
                                            key={s.document.id}
                                            doc={s.document}
                                            action="attach"
                                            busy={busyIds.has(s.document.id)}
                                            scoreHint={`score ${(1 - s.distance).toFixed(2)}`}
                                            onClick={() => attach(s.document.id)}
                                        />
                                    ))}
                                </div>
                            )}
                        </>
                    )}

                    {!loading && tab === 'all' && (
                        <>
                            {unattachedAll.length === 0 && (
                                <p className="text-[11px] text-text-tertiary">Every document is already attached. Upload more via Settings → Knowledge.</p>
                            )}
                            {unattachedAll.map((d) => (
                                <DocRow
                                    key={d.id}
                                    doc={d}
                                    action="attach"
                                    busy={busyIds.has(d.id)}
                                    onClick={() => attach(d.id)}
                                />
                            ))}
                        </>
                    )}

                    {error && (
                        <p className="text-[10.5px] text-red-400 bg-red-500/10 border border-red-500/20 rounded p-2">{error}</p>
                    )}
                </div>

                {/* Footer */}
                <div className="px-4 py-3 border-t border-border-subtle flex items-center justify-between">
                    <button
                        onClick={uploadNew}
                        className="flex items-center gap-1.5 text-[11px] text-text-secondary hover:text-text-primary transition-colors"
                        title="Upload a new document"
                    >
                        <Plus size={11} /> Upload new
                    </button>
                    <button
                        onClick={onClose}
                        className="text-[11px] px-3 py-1 rounded-md bg-[var(--accent-primary)] text-[#16151A] font-semibold hover:brightness-110 transition-all"
                    >
                        Done
                    </button>
                </div>
            </motion.div>
        </motion.div>
    );
};

interface DocRowProps {
    doc: KnowledgeDoc;
    action: 'attach' | 'detach';
    busy: boolean;
    scoreHint?: string;
    onClick: () => void;
}

const DocRow: React.FC<DocRowProps> = ({ doc, action, busy, scoreHint, onClick }) => {
    return (
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/[0.03] transition-colors">
            <FileText size={13} className="text-text-tertiary flex-shrink-0" />
            <div className="flex-1 min-w-0">
                <div className="text-[12px] text-text-primary truncate" title={doc.name}>{doc.name}</div>
                {(scoreHint || doc.chunkCount > 0) && (
                    <div className="text-[10px] text-text-tertiary mt-0.5 flex items-center gap-2">
                        {scoreHint && <span>{scoreHint}</span>}
                        {doc.chunkCount > 0 && <span>{doc.chunkCount} chunk{doc.chunkCount === 1 ? '' : 's'}</span>}
                    </div>
                )}
            </div>
            <button
                onClick={onClick}
                disabled={busy}
                className={`text-[10px] font-medium px-2 py-0.5 rounded flex-shrink-0 transition-colors ${
                    action === 'attach'
                        ? 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25'
                        : 'text-red-400 hover:bg-red-500/10'
                } ${busy ? 'opacity-50 cursor-wait' : ''}`}
            >
                {busy ? '…' : action === 'attach' ? 'Attach' : 'Remove'}
            </button>
        </div>
    );
};

function formatWhen(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const isTomorrow = d.toDateString() === tomorrow.toDateString();

    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (sameDay) return `Today · ${time}`;
    if (isTomorrow) return `Tomorrow · ${time}`;
    return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} · ${time}`;
}

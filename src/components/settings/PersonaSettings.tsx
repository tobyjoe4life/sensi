import React, { useCallback, useEffect, useState } from 'react';
import {
    Upload,
    User,
    Trash2,
    RefreshCw,
    AlertCircle,
    CheckCircle,
    Sparkles,
    FileText,
} from 'lucide-react';
import type { PersonaSummaryIpc, ResumePersonaIpc } from '../../types/electron';

/**
 * sensi M7 / PERSONA-01 — Persona settings tab.
 *
 * One screen, one job: upload a resume → sensi extracts structured
 * fields once → displays a human-readable summary. The extracted JSON
 * is injected into every "What to answer?" call as a compact
 * <persona> block before the knowledge context. No JD, no company
 * research tie-in — those arrive in PERSONA-02 / PREP-01.
 */
// Narrowed summary — PersonaSettings only deals with kind='resume'.
// The IPC returns the union; we cast after guarding on kind.
interface ResumeSummary extends Omit<PersonaSummaryIpc, 'persona' | 'kind'> {
    kind: 'resume';
    persona: ResumePersonaIpc;
}

function asResumeSummary(s: PersonaSummaryIpc | null): ResumeSummary | null {
    if (!s || s.kind !== 'resume') return null;
    // The main-process path writes only resume personas with kind='resume',
    // so the union narrows safely here.
    return s as ResumeSummary;
}

export const PersonaSettings: React.FC = () => {
    const [summary, setSummary] = useState<ResumeSummary | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        try {
            const res = await window.electronAPI?.personaGetSummary?.();
            if (res && 'success' in res && res.success) {
                setSummary(asResumeSummary(res.summary ?? null));
            }
        } catch {
            /* silent — the UI falls back to the upload CTA. */
        } finally {
            setLoaded(true);
        }
    }, []);

    useEffect(() => { void refresh(); }, [refresh]);

    const handleUpload = async () => {
        setError(null);
        try {
            const pickRes = await window.electronAPI?.personaPickFile?.();
            if (!pickRes || pickRes.cancelled) return;
            if (!pickRes.filePath) {
                if ('error' in pickRes && pickRes.error) setError(pickRes.error);
                return;
            }
            setUploading(true);
            const up = await window.electronAPI?.personaUploadResume?.(pickRes.filePath);
            if (up && 'success' in up && up.success) {
                setSummary(asResumeSummary(up.summary));
            } else {
                setError((up as any)?.error ?? 'Resume extraction failed.');
            }
        } catch (err: any) {
            setError(err?.message ?? 'Resume extraction failed.');
        } finally {
            setUploading(false);
        }
    };

    const handleClear = async () => {
        // No native confirm() — it blocks the renderer and leaves focus stuck
        // on the settings panel. Re-upload a resume to restore the persona.
        setError(null);
        try {
            const res = await window.electronAPI?.personaClear?.();
            if (res && 'success' in res && res.success) {
                setSummary(null);
            } else {
                setError((res as any)?.error ?? 'Failed to clear persona.');
            }
        } catch (err: any) {
            setError(err?.message ?? 'Failed to clear persona.');
        }
    };

    const handleReplace = async () => {
        // Same as upload — the store keeps history but only the latest
        // row is injected, so uploading a fresh resume quietly
        // supersedes the previous one.
        await handleUpload();
    };

    return (
        <div className="space-y-5 animated fadeIn pb-10">
            <div>
                <h3 className="text-lg font-bold text-text-primary mb-1 flex items-center gap-2">
                    <User size={18} className="text-[var(--accent-primary)]" />
                    Persona
                </h3>
                <p className="text-xs text-text-secondary">
                    Upload your resume once. sensi extracts your name, role, skills, and top wins,
                    then frames every answer in your voice.
                </p>
            </div>

            {!loaded && (
                <div className="p-6 text-center text-xs text-text-secondary">Loading…</div>
            )}

            {loaded && !summary && (
                <div className="bg-bg-item-surface border border-dashed border-border-subtle rounded-xl p-6 text-center">
                    <User size={28} className="mx-auto text-[var(--accent-primary)] opacity-60 mb-3" />
                    <h4 className="text-sm font-bold text-text-primary mb-1">No persona yet</h4>
                    <p className="text-[11.5px] text-text-secondary max-w-sm mx-auto mb-4">
                        Pick your most recent resume (PDF, DOCX, Markdown, or plain text).
                        Takes about 5–10 seconds — one LLM call, then everything stays local.
                    </p>
                    <button
                        onClick={handleUpload}
                        disabled={uploading}
                        className={`inline-flex items-center gap-2 px-4 py-2 rounded-md text-[12px] font-semibold transition-all ${
                            uploading
                                ? 'bg-bg-input text-text-tertiary cursor-wait'
                                : 'bg-[var(--accent-primary)] text-[#16151A] hover:brightness-110'
                        }`}
                    >
                        {uploading ? (
                            <>
                                <RefreshCw size={13} className="animate-spin" /> Extracting…
                            </>
                        ) : (
                            <>
                                <Upload size={13} /> Upload resume
                            </>
                        )}
                    </button>
                    {error && (
                        <p className="mt-3 text-[11px] text-red-400 inline-flex items-center gap-1">
                            <AlertCircle size={11} /> {error}
                        </p>
                    )}
                </div>
            )}

            {loaded && summary && (
                <div className="bg-bg-item-surface border border-border-subtle rounded-xl p-5">
                    <div className="flex items-start gap-3 mb-4">
                        <div className="w-10 h-10 rounded-lg bg-[var(--accent-primary)]/10 border border-[var(--accent-primary)]/20 flex items-center justify-center flex-shrink-0">
                            <CheckCircle size={18} className="text-[var(--accent-primary)]" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <h4 className="text-sm font-bold text-text-primary truncate">
                                    {summary.persona.name || 'Unnamed resume'}
                                </h4>
                                {summary.persona.currentRole && (
                                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]">
                                        {summary.persona.currentRole}
                                    </span>
                                )}
                            </div>
                            <div className="text-[11px] text-text-secondary mt-0.5 flex items-center gap-2 flex-wrap">
                                {summary.persona.yearsExperience > 0 && (
                                    <span>{summary.persona.yearsExperience} yr{summary.persona.yearsExperience === 1 ? '' : 's'} experience</span>
                                )}
                                {summary.sourceName && (
                                    <>
                                        <span className="opacity-40">·</span>
                                        <FileText size={10} />
                                        <span className="truncate">{summary.sourceName}</span>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>

                    {summary.persona.skills.length > 0 && (
                        <div className="mb-4">
                            <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-1.5 flex items-center gap-1">
                                <Sparkles size={10} /> Top skills
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {summary.persona.skills.slice(0, 12).map((s) => (
                                    <span
                                        key={s}
                                        className="text-[11px] px-2 py-0.5 rounded-full bg-bg-input border border-border-subtle text-text-secondary"
                                    >
                                        {s}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {summary.persona.topAchievements.length > 0 && (
                        <div className="mb-4">
                            <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-1.5">
                                Recent wins
                            </div>
                            <ul className="space-y-1.5">
                                {summary.persona.topAchievements.slice(0, 3).map((a, i) => (
                                    <li key={i} className="text-[12px] text-text-primary flex gap-2">
                                        <span className="text-[var(--accent-primary)] opacity-70 flex-shrink-0">•</span>
                                        <span className="flex-1">{a}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {summary.persona.education.length > 0 && (
                        <div className="mb-4">
                            <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-1.5">
                                Education
                            </div>
                            <ul className="space-y-0.5">
                                {summary.persona.education.slice(0, 3).map((e, i) => (
                                    <li key={i} className="text-[11.5px] text-text-secondary">{e}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <div className="flex items-center gap-2 pt-3 border-t border-border-subtle">
                        <button
                            onClick={handleReplace}
                            disabled={uploading}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium bg-bg-input hover:bg-bg-elevated border border-border-subtle text-text-primary transition-colors disabled:opacity-50 disabled:cursor-wait"
                        >
                            {uploading ? <RefreshCw size={11} className="animate-spin" /> : <Upload size={11} />}
                            {uploading ? 'Extracting…' : 'Replace'}
                        </button>
                        <button
                            onClick={handleClear}
                            disabled={uploading}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                        >
                            <Trash2 size={11} /> Delete
                        </button>
                        <span className="ml-auto text-[10px] text-text-tertiary">
                            Updated {relative(summary.updatedAt)}
                        </span>
                    </div>

                    {error && (
                        <p className="mt-3 text-[11px] text-red-400 inline-flex items-center gap-1">
                            <AlertCircle size={11} /> {error}
                        </p>
                    )}
                </div>
            )}

            <div className="flex items-start gap-2 text-[10.5px] text-text-tertiary p-3 rounded-lg bg-bg-input/40">
                <AlertCircle size={11} className="mt-0.5 flex-shrink-0" />
                <span>
                    Extraction runs on the provider you have configured in AI Providers. Only the
                    resume text is sent to the model, and only once per upload. The resulting JSON
                    stays in the local SQLite database under <code>user_persona</code>.
                </span>
            </div>
        </div>
    );
};

function relative(isoOrSqlite: string): string {
    const t = new Date(isoOrSqlite.replace(' ', 'T') + (isoOrSqlite.endsWith('Z') ? '' : 'Z')).getTime();
    if (!Number.isFinite(t)) return 'recently';
    const diff = Date.now() - t;
    const days = Math.floor(diff / 86_400_000);
    if (days < 1) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days} days ago`;
    const months = Math.floor(days / 30);
    return `${months} month${months === 1 ? '' : 's'} ago`;
}

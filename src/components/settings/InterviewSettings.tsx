import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    AlertCircle,
    BookOpen,
    Briefcase,
    Building2,
    CheckCircle,
    RefreshCw,
    Save,
    User,
} from 'lucide-react';
import type { InterviewAnswerStyleIpc, InterviewProfileIpc, ProfileContextHealthIpc } from '../../types/electron';

const DEFAULT_PROFILE: InterviewProfileIpc = {
    enabled: true,
    targetCompany: '',
    targetRole: '',
    targetGradeOrLevel: '',
    sector: 'civil_service_public_sector',
    companyFirst: true,
    starPolicy: 'always_in_sector',
    answerStyleDefault: 'auto',
    customNotes: '',
};

const ANSWER_STYLE_OPTIONS: Array<{ id: InterviewAnswerStyleIpc; label: string }> = [
    { id: 'auto', label: 'Auto' },
    { id: 'concise', label: 'Concise' },
    { id: 'elaborate', label: 'Elaborate' },
    { id: 'star', label: 'STAR' },
];

export const InterviewSettings: React.FC = () => {
    const [draft, setDraft] = useState<InterviewProfileIpc>(DEFAULT_PROFILE);
    const [loaded, setLoaded] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [health, setHealth] = useState<ProfileContextHealthIpc | null>(null);

    const refresh = useCallback(async () => {
        setError(null);
        try {
            const [profileRes, healthRes] = await Promise.all([
                window.electronAPI.interviewProfileGet(),
                window.electronAPI.profileContextHealth?.(),
            ]);

            if (profileRes.success) {
                setDraft({ ...DEFAULT_PROFILE, ...profileRes.profile });
            } else {
                setError(profileRes.error);
            }

            if (healthRes?.success) {
                setHealth(healthRes.health);
            }
        } catch (err: any) {
            setError(err?.message ?? 'Failed to load interview profile.');
        } finally {
            setLoaded(true);
        }
    }, []);

    useEffect(() => {
        void refresh();
        const unsubscribe = window.electronAPI.onInterviewProfileChanged?.((profile) => {
            setDraft({ ...DEFAULT_PROFILE, ...profile });
            setSaved(true);
        });
        return () => unsubscribe?.();
    }, [refresh]);

    const save = useCallback(async () => {
        setSaving(true);
        setSaved(false);
        setError(null);
        try {
            const res = await window.electronAPI.interviewProfileSet(draft);
            if (res.success) {
                setDraft({ ...DEFAULT_PROFILE, ...res.profile });
                setSaved(true);
            } else {
                setError(res.error);
            }
        } catch (err: any) {
            setError(err?.message ?? 'Failed to save interview profile.');
        } finally {
            setSaving(false);
        }
    }, [draft]);

    const targetReady = useMemo(
        () => Boolean(draft.targetCompany.trim() || draft.targetRole.trim()),
        [draft.targetCompany, draft.targetRole]
    );

    const setField = <K extends keyof InterviewProfileIpc>(key: K, value: InterviewProfileIpc[K]) => {
        setDraft((prev) => ({ ...prev, [key]: value }));
        setSaved(false);
    };

    const segmentClass = (active: boolean) =>
        `px-3 py-1.5 rounded-md text-[11px] font-semibold border transition-colors ${
            active
                ? 'bg-[var(--accent-primary)] text-[#16151A] border-[var(--accent-primary)]'
                : 'bg-bg-input text-text-secondary border-border-subtle hover:text-text-primary'
        }`;

    return (
        <div className="space-y-5 animated fadeIn pb-10">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h3 className="text-lg font-bold text-text-primary mb-1 flex items-center gap-2">
                        <Briefcase size={18} className="text-[var(--accent-primary)]" />
                        Interview
                    </h3>
                    <p className="text-xs text-text-secondary">
                        Target company, role, sector, and answer style used by interview answers.
                    </p>
                </div>
                <button
                    onClick={save}
                    disabled={!loaded || saving}
                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-colors ${
                        saving
                            ? 'bg-bg-input text-text-tertiary cursor-wait'
                            : 'bg-[var(--accent-primary)] text-[#16151A] hover:brightness-110'
                    }`}
                >
                    {saving ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />}
                    {saving ? 'Saving' : saved ? 'Saved' : 'Save'}
                </button>
            </div>

            {!loaded && (
                <div className="p-6 text-center text-xs text-text-secondary">Loading...</div>
            )}

            {loaded && (
                <>
                    <div className="bg-bg-item-surface border border-border-subtle rounded-xl p-4 space-y-3">
                        <div className="flex flex-wrap gap-2 text-[11px]">
                            <StatusChip
                                ok={targetReady}
                                icon={<Building2 size={11} />}
                                label={targetReady ? 'Target set' : 'Target missing'}
                            />
                            <StatusChip
                                ok={health?.personaPresent === true}
                                icon={<User size={11} />}
                                label={health?.personaPresent ? 'Persona loaded' : 'Persona missing'}
                            />
                            <StatusChip
                                ok={(health?.pinnedKnowledgeCount ?? 0) > 0}
                                icon={<BookOpen size={11} />}
                                label={`Pinned ${health?.pinnedKnowledgeCount ?? 0}`}
                            />
                        </div>

                        <label className="flex items-center justify-between gap-3 border-t border-border-subtle pt-3">
                            <span className="text-xs font-semibold text-text-primary">Use interview profile</span>
                            <input
                                type="checkbox"
                                checked={draft.enabled}
                                onChange={(e) => setField('enabled', e.target.checked)}
                                className="h-4 w-4 accent-[var(--accent-primary)]"
                            />
                        </label>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                        <Field
                            label="Company"
                            icon={<Building2 size={13} />}
                            value={draft.targetCompany}
                            placeholder="Cabinet Office"
                            onChange={(value) => setField('targetCompany', value)}
                        />
                        <Field
                            label="Role"
                            icon={<Briefcase size={13} />}
                            value={draft.targetRole}
                            placeholder="Policy Advisor"
                            onChange={(value) => setField('targetRole', value)}
                        />
                    </div>

                    <Field
                        label="Grade or level"
                        icon={<User size={13} />}
                        value={draft.targetGradeOrLevel}
                        placeholder="HEO, SEO, Grade 7"
                        onChange={(value) => setField('targetGradeOrLevel', value)}
                    />

                    <div className="bg-bg-item-surface border border-border-subtle rounded-xl p-4 space-y-4">
                        <div>
                            <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-2">
                                Sector
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={() => setField('sector', 'civil_service_public_sector')}
                                    className={segmentClass(draft.sector === 'civil_service_public_sector')}
                                >
                                    Civil Service / Public Sector
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setField('sector', 'general')}
                                    className={segmentClass(draft.sector === 'general')}
                                >
                                    General
                                </button>
                            </div>
                        </div>

                        <div>
                            <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-2">
                                Default answer style
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {ANSWER_STYLE_OPTIONS.map((option) => (
                                    <button
                                        key={option.id}
                                        type="button"
                                        onClick={() => setField('answerStyleDefault', option.id)}
                                        className={segmentClass(draft.answerStyleDefault === option.id)}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-2">
                                Civil Service STAR policy (Auto mode)
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={() => setField('starPolicy', 'always_in_sector')}
                                    className={segmentClass(draft.starPolicy === 'always_in_sector')}
                                >
                                    Sector STAR
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setField('starPolicy', 'detected_competency')}
                                    className={segmentClass(draft.starPolicy === 'detected_competency')}
                                >
                                    Detected only
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setField('starPolicy', 'manual')}
                                    className={segmentClass(draft.starPolicy === 'manual')}
                                >
                                    Manual
                                </button>
                            </div>
                            <p className="mt-2 text-[11px] text-text-tertiary">
                                Applies only when the default or live style is Auto.
                            </p>
                        </div>

                        <label className="flex items-center justify-between gap-3 border-t border-border-subtle pt-3">
                            <span className="text-xs font-semibold text-text-primary">Company first</span>
                            <input
                                type="checkbox"
                                checked={draft.companyFirst}
                                onChange={(e) => setField('companyFirst', e.target.checked)}
                                className="h-4 w-4 accent-[var(--accent-primary)]"
                            />
                        </label>
                    </div>

                    <div className="bg-bg-item-surface border border-border-subtle rounded-xl p-4">
                        <label className="block text-[10px] uppercase tracking-wider text-text-tertiary mb-2">
                            Custom notes
                        </label>
                        <textarea
                            value={draft.customNotes}
                            onChange={(e) => setField('customNotes', e.target.value)}
                            rows={4}
                            maxLength={500}
                            placeholder="Tone, examples to prefer, or role-specific constraints"
                            className="w-full rounded-md bg-bg-input border border-border-subtle px-3 py-2 text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-[var(--accent-primary)] resize-none"
                        />
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 text-[11px] text-red-400">
                            <AlertCircle size={12} /> {error}
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

const StatusChip: React.FC<{ ok: boolean; icon: React.ReactNode; label: string }> = ({ ok, icon, label }) => (
    <span
        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border ${
            ok
                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                : 'border-amber-500/20 bg-amber-500/10 text-amber-300'
        }`}
    >
        {ok ? <CheckCircle size={11} /> : icon}
        {label}
    </span>
);

const Field: React.FC<{
    label: string;
    icon: React.ReactNode;
    value: string;
    placeholder: string;
    onChange: (value: string) => void;
}> = ({ label, icon, value, placeholder, onChange }) => (
    <label className="block bg-bg-item-surface border border-border-subtle rounded-xl p-4">
        <span className="text-[10px] uppercase tracking-wider text-text-tertiary mb-2 flex items-center gap-1.5">
            {icon}
            {label}
        </span>
        <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="w-full rounded-md bg-bg-input border border-border-subtle px-3 py-2 text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-[var(--accent-primary)]"
        />
    </label>
);

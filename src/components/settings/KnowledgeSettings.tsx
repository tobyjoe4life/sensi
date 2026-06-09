/**
 * sensi M4-T9 — Knowledge management settings pane.
 *
 * First usable renderer UI for the personal-knowledge base. Consumes
 * only the eight typed preload methods from M4-T8:
 *   - knowledgeListDocuments
 *   - knowledgeListPinned
 *   - knowledgeIngestDocument
 *   - knowledgePinDocument
 *   - knowledgeUnpinDocument
 *   - knowledgeDeleteDocument
 *   - knowledgeGetDocumentPreview
 *   - knowledgeQuery (not used in the M4-T9 admin UI — reserved for M5+)
 *
 * Renderer never touches raw file bytes: the file picker returns a
 * path, the path is passed to `knowledgeIngestDocument`, and main
 * reads the file. Preview is bounded — we call
 * `knowledgeGetDocumentPreview` with the default cap and respect the
 * returned `truncated` flag.
 *
 * Errors are narrowed to `errorType` and mapped via
 * `errorTypeToMessage` (src/lib/knowledgeErrors.ts). We never display
 * the raw `error` string to avoid leaking path details or stack traces
 * that the main-process scrubber may not have caught.
 *
 * See DECISIONS.md D022 for the placement + picker-reuse rationale.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    BookOpen,
    FileText,
    Pin,
    PinOff,
    Trash2,
    Eye,
    Upload,
    RefreshCw,
    AlertCircle,
    X,
    Download,
    Archive,
    CheckCircle,
} from 'lucide-react';
import type {
    KnowledgeDocumentMetadata,
    KnowledgeIpcErrorType,
    ProfileContextHealthIpc,
} from '../../types/electron';
import { errorTypeToMessage } from '../../lib/knowledgeErrors';

// ─────────────────────────────────────────────────────────────────────
// State types
// ─────────────────────────────────────────────────────────────────────

interface PreviewState {
    id: string;
    name: string;
    text: string;
    truncated: boolean;
}

interface UiErrorState {
    errorType: KnowledgeIpcErrorType;
    context: string;
}

type BusyOp = 'refresh' | 'ingest' | 'export' | 'import' | null;

interface TransferStatus {
    kind: 'export' | 'import';
    message: string;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers (pure, kept inline to avoid a second file for ~15 LOC)
// ─────────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function shortProvider(model: string): string {
    if (model.startsWith('nomic-embed-text')) return 'Ollama / nomic-embed-text';
    if (model.startsWith('gemini-embedding-001')) return 'Gemini / gemini-embedding-001';
    if (model.startsWith('text-embedding-3-small')) return 'OpenAI / text-embedding-3-small';
    // Legacy label: pre-KNOWLEDGE-FIX-02 documents may still carry the
    // older text-embedding-004 model name. Kept so the list view shows
    // a friendly label for those rows until they are re-ingested.
    if (model.startsWith('text-embedding-004')) return 'Gemini / text-embedding-004 (legacy)';
    return model || 'unknown';
}

// ─────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────

export const KnowledgeSettings: React.FC = () => {
    const [docs, setDocs] = useState<KnowledgeDocumentMetadata[]>([]);
    const [pinnedIds, setPinnedIds] = useState<ReadonlySet<string>>(new Set());
    const [loaded, setLoaded] = useState(false);
    const [busy, setBusy] = useState<BusyOp>(null);
    const [uiError, setUiError] = useState<UiErrorState | null>(null);
    const [preview, setPreview] = useState<PreviewState | null>(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [manualPath, setManualPath] = useState('');
    const [transferStatus, setTransferStatus] = useState<TransferStatus | null>(null);
    const [profileHealth, setProfileHealth] = useState<ProfileContextHealthIpc | null>(null);

    // ─── Data loading ───────────────────────────────────────────────
    const refreshList = useCallback(async () => {
        setBusy('refresh');
        setUiError(null);
        try {
            const [docsRes, pinnedRes, healthRes] = await Promise.all([
                window.electronAPI.knowledgeListDocuments(),
                window.electronAPI.knowledgeListPinned(),
                window.electronAPI.profileContextHealth?.(),
            ]);

            if (healthRes?.success) {
                setProfileHealth(healthRes.health);
            } else if (healthRes && !healthRes.success) {
                setProfileHealth({
                    dbReady: false,
                    personaBound: false,
                    personaPresent: false,
                    knowledgeDocumentCount: 0,
                    pinnedKnowledgeCount: 0,
                    embeddingProvider: null,
                    embeddingModel: null,
                    embeddingReady: false,
                    error: healthRes.error,
                });
            }

            if (!docsRes.success) {
                setUiError({ errorType: docsRes.errorType, context: 'Load documents' });
                setDocs([]);
                setPinnedIds(new Set());
                return;
            }
            if (!pinnedRes.success) {
                setUiError({ errorType: pinnedRes.errorType, context: 'Load pinned' });
                setDocs(docsRes.documents);
                setPinnedIds(new Set());
                return;
            }

            setDocs(docsRes.documents);
            setPinnedIds(new Set(pinnedRes.documents.map((d) => d.id)));
        } finally {
            setBusy(null);
            setLoaded(true);
        }
    }, []);

    useEffect(() => {
        void refreshList();
    }, [refreshList]);

    // ─── Ingest flows ───────────────────────────────────────────────
    const runIngest = useCallback(
        async (filePath: string) => {
            if (!filePath.trim()) {
                setUiError({ errorType: 'invalid_input', context: 'Ingest' });
                return;
            }
            setBusy('ingest');
            setUiError(null);
            try {
                const result = await window.electronAPI.knowledgeIngestDocument(filePath);
                if (!result.success) {
                    setUiError({ errorType: result.errorType, context: 'Ingest' });
                    return;
                }
                // Clear manual path field on success
                setManualPath('');
                await refreshList();
            } finally {
                setBusy(null);
            }
        },
        [refreshList]
    );

    const onClickImport = useCallback(async () => {
        // Use the knowledge-specific picker so every supported document
        // type goes through the same ingestion path.
        const pickResult = await window.electronAPI.knowledgePickDocument();
        if (!pickResult || pickResult.cancelled) return;
        if (!pickResult.filePath) {
            setUiError({ errorType: 'invalid_input', context: 'Choose file' });
            return;
        }
        await runIngest(pickResult.filePath);
    }, [runIngest]);

    const onClickIngestPath = useCallback(async () => {
        await runIngest(manualPath);
    }, [manualPath, runIngest]);

    // ─── Pin / unpin / delete ───────────────────────────────────────
    const onTogglePin = useCallback(
        async (doc: KnowledgeDocumentMetadata) => {
            setUiError(null);
            const api = window.electronAPI;
            const result = doc.pinned
                ? await api.knowledgeUnpinDocument(doc.id)
                : await api.knowledgePinDocument(doc.id);
            if (!result.success) {
                setUiError({
                    errorType: result.errorType,
                    context: doc.pinned ? 'Unpin' : 'Pin',
                });
                return;
            }
            await refreshList();
        },
        [refreshList]
    );

    const onRequestDelete = useCallback((id: string) => {
        setConfirmDeleteId(id);
    }, []);

    const onCancelDelete = useCallback(() => {
        setConfirmDeleteId(null);
    }, []);

    const onConfirmDelete = useCallback(
        async (id: string) => {
            setUiError(null);
            const result = await window.electronAPI.knowledgeDeleteDocument(id);
            setConfirmDeleteId(null);
            if (!result.success) {
                setUiError({ errorType: result.errorType, context: 'Delete' });
                return;
            }
            await refreshList();
        },
        [refreshList]
    );

    // ─── Preview ────────────────────────────────────────────────────
    const onPreview = useCallback(
        async (doc: KnowledgeDocumentMetadata) => {
            setUiError(null);
            // Always use the default cap — never request a larger value.
            // The main-process handler clamps to PREVIEW_HARD_MAX_CHARS
            // regardless, but we don't test that clamp here.
            const result = await window.electronAPI.knowledgeGetDocumentPreview(doc.id);
            if (!result.success) {
                setUiError({ errorType: result.errorType, context: 'Preview' });
                return;
            }
            setPreview({
                id: doc.id,
                name: doc.name,
                text: result.text,
                truncated: result.truncated,
            });
        },
        []
    );

    const onClosePreview = useCallback(() => {
        setPreview(null);
    }, []);

    // ─── Export / import of the whole KB (M4-T10) ────────────────
    const onClickExportKB = useCallback(async () => {
        setUiError(null);
        setTransferStatus(null);
        const api = window.electronAPI;
        if (!api.knowledgePickExportPath || !api.knowledgeExport) return;

        const pick = await api.knowledgePickExportPath();
        if (pick.cancelled) return;
        if (!('filePath' in pick) || !pick.filePath) {
            setUiError({ errorType: 'export_failed', context: 'Export' });
            return;
        }

        setBusy('export');
        try {
            const result = await api.knowledgeExport(pick.filePath);
            if (!result.success) {
                setUiError({ errorType: result.errorType, context: 'Export' });
                return;
            }
            setTransferStatus({
                kind: 'export',
                message: `Exported ${result.documentCount} document${result.documentCount === 1 ? '' : 's'} (${result.chunkCount} chunks) to ${result.filePath}`,
            });
        } finally {
            setBusy(null);
        }
    }, []);

    const onClickImportKB = useCallback(async () => {
        setUiError(null);
        setTransferStatus(null);
        const api = window.electronAPI;
        if (!api.knowledgePickImportPath || !api.knowledgeImport) return;

        const pick = await api.knowledgePickImportPath();
        if (pick.cancelled) return;
        if (!('filePath' in pick) || !pick.filePath) {
            setUiError({ errorType: 'import_failed', context: 'Import' });
            return;
        }

        setBusy('import');
        try {
            const result = await api.knowledgeImport(pick.filePath);
            if (!result.success) {
                setUiError({ errorType: result.errorType, context: 'Import' });
                return;
            }
            const backupNote = result.backupPath
                ? ` Pre-import backup saved alongside your sensi data.`
                : '';
            setTransferStatus({
                kind: 'import',
                message: `Imported ${result.imported} document${result.imported === 1 ? '' : 's'} (${result.chunkCount} chunks), replaced ${result.replaced} existing.${backupNote}`,
            });
            await refreshList();
        } finally {
            setBusy(null);
        }
    }, [refreshList]);

    const dismissTransferStatus = useCallback(() => setTransferStatus(null), []);

    // ─── Sorted docs: pinned first, then by ingest time desc ────────
    const sortedDocs = useMemo(() => {
        const copy = [...docs];
        copy.sort((a, b) => {
            const ap = pinnedIds.has(a.id) ? 0 : 1;
            const bp = pinnedIds.has(b.id) ? 0 : 1;
            if (ap !== bp) return ap - bp;
            return b.ingestedAt.localeCompare(a.ingestedAt);
        });
        return copy;
    }, [docs, pinnedIds]);

    // ─── Render ─────────────────────────────────────────────────────
    return (
        <div className="space-y-5 animated fadeIn select-text pb-4">
            <div className="flex items-start justify-between">
                <div>
                    <h3 className="text-lg font-bold text-text-primary mb-1 flex items-center gap-2">
                        <BookOpen size={18} /> Knowledge
                    </h3>
                    <p className="text-xs text-text-secondary">
                        Personal reference documents that feed into your live-assist prompts.
                    </p>
                </div>
                <button
                    onClick={() => void refreshList()}
                    disabled={busy !== null}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border-subtle bg-bg-subtle/30 hover:bg-bg-subtle hover:border-emerald-500/30 transition-colors text-xs font-medium text-text-secondary hover:text-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Refresh knowledge list"
                >
                    <RefreshCw size={13} className={busy === 'refresh' ? 'animate-spin' : ''} />
                    Refresh
                </button>
            </div>

            {profileHealth && (
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-secondary">
                    <span className={profileHealth.dbReady ? 'text-emerald-300' : 'text-red-300'}>
                        DB {profileHealth.dbReady ? 'ready' : 'offline'}
                    </span>
                    <span>Persona {profileHealth.personaPresent ? 'loaded' : 'missing'}</span>
                    <span>Docs {profileHealth.knowledgeDocumentCount}</span>
                    <span>Pinned {profileHealth.pinnedKnowledgeCount}</span>
                    <span className={profileHealth.embeddingReady ? 'text-emerald-300' : 'text-amber-300'}>
                        Embed {profileHealth.embeddingProvider ?? 'unavailable'}
                    </span>
                    {profileHealth.error && (
                        <span className="text-amber-300 truncate max-w-full" title={profileHealth.error}>
                            {profileHealth.error}
                        </span>
                    )}
                </div>
            )}

            {/* Error banner */}
            {uiError && (
                <div
                    role="alert"
                    className="flex items-start gap-2 p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-xs text-red-300"
                >
                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                    <div className="flex-1">
                        <div className="font-semibold mb-0.5">{uiError.context} failed</div>
                        <div>{errorTypeToMessage(uiError.errorType)}</div>
                    </div>
                    <button
                        onClick={() => setUiError(null)}
                        className="text-red-300/60 hover:text-red-300"
                        aria-label="Dismiss error"
                    >
                        <X size={14} />
                    </button>
                </div>
            )}

            {/* Transfer success banner (M4-T10) */}
            {transferStatus && (
                <div
                    role="status"
                    className="flex items-start gap-2 p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-300"
                >
                    <CheckCircle size={14} className="mt-0.5 shrink-0" />
                    <div className="flex-1">
                        <div className="font-semibold mb-0.5 capitalize">{transferStatus.kind} complete</div>
                        <div className="break-all">{transferStatus.message}</div>
                    </div>
                    <button
                        onClick={dismissTransferStatus}
                        className="text-emerald-300/60 hover:text-emerald-300"
                        aria-label="Dismiss status"
                    >
                        <X size={14} />
                    </button>
                </div>
            )}

            {/* Transfer controls (M4-T10) — export/import the whole KB */}
            <div className="p-4 rounded-lg border border-border-subtle bg-bg-subtle/20 flex items-center justify-between gap-3">
                <div>
                    <div className="text-sm font-medium text-text-primary">Back up or restore</div>
                    <div className="text-xs text-text-secondary mt-0.5">
                        Export the full knowledge base to a JSON file, or replace it
                        with a previously exported artifact. Import overwrites existing
                        documents after writing a pre-import backup.
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <button
                        onClick={() => void onClickExportKB()}
                        disabled={busy !== null}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border-subtle bg-bg-subtle/30 hover:bg-bg-subtle hover:border-emerald-500/30 transition-colors text-xs font-medium text-text-secondary hover:text-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Download size={13} />
                        {busy === 'export' ? 'Exporting…' : 'Export'}
                    </button>
                    <button
                        onClick={() => void onClickImportKB()}
                        disabled={busy !== null}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border-subtle bg-bg-subtle/30 hover:bg-bg-subtle hover:border-amber-500/30 transition-colors text-xs font-medium text-text-secondary hover:text-amber-400 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Archive size={13} />
                        {busy === 'import' ? 'Importing…' : 'Import (replace)'}
                    </button>
                </div>
            </div>

            {/* Import controls */}
            <div className="p-4 rounded-lg border border-border-subtle bg-bg-subtle/30 space-y-3">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="text-sm font-medium text-text-primary">Import a document</div>
                        <div className="text-xs text-text-secondary mt-0.5">
                            Supported: PDF, DOCX, Markdown, plain text. Files are read in the
                            main process — raw bytes never enter the renderer.
                        </div>
                    </div>
                    <button
                        onClick={() => void onClickImport()}
                        disabled={busy !== null}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/90 hover:bg-emerald-500 text-white text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Upload size={14} />
                        {busy === 'ingest' ? 'Ingesting…' : 'Choose file…'}
                    </button>
                </div>
                <div className="flex items-center gap-2">
                    <input
                        type="text"
                        value={manualPath}
                        onChange={(e) => setManualPath(e.target.value)}
                        placeholder="Or paste a full file path (useful for .md files)"
                        className="flex-1 px-3 py-1.5 rounded-md bg-bg-main border border-border-subtle text-xs text-text-primary placeholder:text-text-secondary/60 focus:outline-none focus:border-emerald-500/50"
                        disabled={busy !== null}
                    />
                    <button
                        onClick={() => void onClickIngestPath()}
                        disabled={busy !== null || manualPath.trim().length === 0}
                        className="px-3 py-1.5 rounded-md border border-border-subtle text-xs text-text-secondary hover:text-text-primary hover:border-emerald-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        Ingest path
                    </button>
                </div>
            </div>

            {/* Document list */}
            <div className="space-y-2">
                <div className="text-xs uppercase tracking-wider text-text-secondary">
                    Documents{loaded ? ` (${docs.length})` : ''}
                </div>

                {loaded && docs.length === 0 && (
                    <div className="p-6 rounded-lg border border-dashed border-border-subtle text-center text-xs text-text-secondary">
                        No documents yet. Import your resume, a job description, or reference
                        notes to feed them into live-assist.
                    </div>
                )}

                {!loaded && (
                    <div className="p-6 text-center text-xs text-text-secondary">Loading…</div>
                )}

                {sortedDocs.map((doc) => {
                    const isPinned = pinnedIds.has(doc.id);
                    const isZeroChunk = doc.chunkCount === 0;
                    const isConfirming = confirmDeleteId === doc.id;
                    return (
                        <div
                            key={doc.id}
                            className={`p-3 rounded-lg border transition-colors ${
                                isPinned
                                    ? 'border-emerald-500/30 bg-emerald-500/5'
                                    : 'border-border-subtle bg-bg-subtle/20'
                            }`}
                        >
                            <div className="flex items-start gap-3">
                                <FileText size={16} className="mt-0.5 text-text-secondary shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-sm font-medium text-text-primary truncate">
                                            {doc.name}
                                        </span>
                                        {isPinned && (
                                            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                                                Pinned
                                            </span>
                                        )}
                                        {isZeroChunk && (
                                            <span
                                                className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300"
                                                title="No extractable text — will not appear in retrieval"
                                            >
                                                Empty
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-[11px] text-text-secondary mt-0.5 flex items-center gap-2 flex-wrap">
                                        <span>{doc.chunkCount} chunks</span>
                                        <span>•</span>
                                        <span>{formatBytes(doc.bytes)}</span>
                                        <span>•</span>
                                        <span>{shortProvider(doc.embeddingModel)}</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                    <button
                                        onClick={() => void onPreview(doc)}
                                        disabled={busy !== null}
                                        className="p-1.5 rounded hover:bg-bg-item-active/60 text-text-secondary hover:text-text-primary disabled:opacity-40"
                                        aria-label={`Preview ${doc.name}`}
                                        title="Preview (bounded)"
                                    >
                                        <Eye size={14} />
                                    </button>
                                    <button
                                        onClick={() => void onTogglePin(doc)}
                                        disabled={busy !== null}
                                        className="p-1.5 rounded hover:bg-bg-item-active/60 text-text-secondary hover:text-emerald-400 disabled:opacity-40"
                                        aria-label={isPinned ? `Unpin ${doc.name}` : `Pin ${doc.name}`}
                                        title={isPinned ? 'Unpin' : 'Pin'}
                                    >
                                        {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
                                    </button>
                                    <button
                                        onClick={() => onRequestDelete(doc.id)}
                                        disabled={busy !== null}
                                        className="p-1.5 rounded hover:bg-bg-item-active/60 text-text-secondary hover:text-red-400 disabled:opacity-40"
                                        aria-label={`Delete ${doc.name}`}
                                        title="Delete"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </div>

                            {isConfirming && (
                                <div className="mt-3 pt-3 border-t border-border-subtle flex items-center justify-between gap-3">
                                    <div className="text-xs text-text-secondary">
                                        Delete this document and all its chunks? This cannot be
                                        undone.
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <button
                                            onClick={onCancelDelete}
                                            className="px-3 py-1 rounded border border-border-subtle text-xs text-text-secondary hover:text-text-primary"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={() => void onConfirmDelete(doc.id)}
                                            className="px-3 py-1 rounded bg-red-500/90 hover:bg-red-500 text-white text-xs font-semibold"
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Preview modal */}
            {preview && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
                    onClick={onClosePreview}
                >
                    <div
                        className="max-w-2xl w-full max-h-[80vh] rounded-xl border border-border-subtle bg-bg-main shadow-2xl flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between p-4 border-b border-border-subtle">
                            <div className="flex items-center gap-2 min-w-0">
                                <Eye size={16} className="text-text-secondary shrink-0" />
                                <span className="text-sm font-medium text-text-primary truncate">
                                    {preview.name}
                                </span>
                                {preview.truncated && (
                                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 shrink-0">
                                        Truncated
                                    </span>
                                )}
                            </div>
                            <button
                                onClick={onClosePreview}
                                className="p-1.5 rounded hover:bg-bg-item-active/60 text-text-secondary hover:text-text-primary"
                                aria-label="Close preview"
                            >
                                <X size={16} />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4">
                            <pre className="whitespace-pre-wrap text-xs text-text-primary font-mono">
                                {preview.text}
                            </pre>
                        </div>
                        {preview.truncated && (
                            <div className="p-3 border-t border-border-subtle text-[11px] text-amber-300/80">
                                Preview is bounded to protect memory. The full document is still
                                searchable during live-assist.
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

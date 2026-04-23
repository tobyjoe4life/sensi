import React, { useState, useEffect, useCallback } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import type { ProviderId, ProviderStatus } from '@providers/types';

/**
 * sensi M1 Step 4 — provider-grouped model selector.
 *
 * Replaces the flat list with a vertical grouped layout:
 *
 *   ┌─────────────────────┐
 *   │ MiniMax             │  ← provider header (non-clickable)
 *   │  ◉ MiniMax M2.7     │  ← active model = filled dot + check
 *   │  ○ MiniMax HighSpd  │
 *   │ Gemini              │
 *   │  ○ 3.1 Flash        │
 *   │  ○ 3.1 Pro          │
 *   │ Ollama (local)      │
 *   │  ○ ollama-llama3.2  │
 *   └─────────────────────┘
 *
 * Data flow:
 *  1. On mount, call `getConfiguredProviders()` for the typed full snapshot.
 *  2. Filter to providers where `configured: true`.
 *  3. Render each provider as a header + its `models[]` as clickable rows.
 *  4. The row matching `activeModel` for the active provider is highlighted.
 *  5. On click, call `setActiveProviderAndModel(provider, modelId)`. The
 *     handler persists, switches the runtime LLMHelper, and broadcasts
 *     `llm-active-changed`. We update local state optimistically and let
 *     the subscription confirm.
 *
 * Subscriptions:
 *  - `onLlmActiveChanged` fires whenever ANY window switches the active
 *    pair (e.g. another instance of this picker, or a tray menu). The hook
 *    updates the active highlight without a full reload.
 *  - On window focus, refetch `getConfiguredProviders()` so newly-saved
 *    keys (from the Settings panel in another window) appear immediately.
 */

const ModelSelectorWindow = () => {
    const isLight = useResolvedTheme() === 'light';
    const [providers, setProviders] = useState<ProviderStatus[]>(() => {
        try {
            const cached = localStorage.getItem('cached-provider-statuses');
            return cached ? JSON.parse(cached) : [];
        } catch { return []; }
    });
    const [activePair, setActivePair] = useState<{ provider: ProviderId | null; model: string | null }>(() => {
        try {
            const cached = localStorage.getItem('cached-active-pair');
            return cached ? JSON.parse(cached) : { provider: null, model: null };
        } catch { return { provider: null, model: null }; }
    });
    const [isLoading, setIsLoading] = useState<boolean>(() => {
        try { return !localStorage.getItem('cached-provider-statuses'); } catch { return true; }
    });

    // Load configured providers + active pair from main.
    const loadProviders = useCallback(async () => {
        try {
            const list = await window.electronAPI?.getConfiguredProviders?.();
            if (list && Array.isArray(list)) {
                setProviders(list);
                try { localStorage.setItem('cached-provider-statuses', JSON.stringify(list)); } catch {}
            }
            const pair = await window.electronAPI?.getActiveProviderAndModel?.();
            if (pair) {
                setActivePair(pair);
                try { localStorage.setItem('cached-active-pair', JSON.stringify(pair)); } catch {}
            }
        } catch (err) {
            console.error('[ModelSelectorWindow] Failed to load providers:', err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        loadProviders();
        window.addEventListener('focus', loadProviders);

        // Subscribe to live active-pair changes. Any window that swaps the
        // active provider/model fires `llm-active-changed` — refresh both the
        // pair and the providers list so highlight + active flag stay in sync.
        const off = window.electronAPI?.onLlmActiveChanged?.((payload) => {
            setActivePair({ provider: payload.provider, model: payload.model });
            try { localStorage.setItem('cached-active-pair', JSON.stringify(payload)); } catch {}
            // Refresh ProviderStatus[] so the `active` flag updates per-provider
            loadProviders();
        });

        return () => {
            window.removeEventListener('focus', loadProviders);
            off?.();
        };
    }, [loadProviders]);

    const handleSelect = async (provider: ProviderId, modelId: string) => {
        // Optimistic update — main process broadcast will confirm
        setActivePair({ provider, model: modelId });
        try {
            await window.electronAPI?.setActiveProviderAndModel?.(provider, modelId);
        } catch (err) {
            console.error('[ModelSelectorWindow] Failed to set active provider+model:', err);
            // Revert by reloading from main on failure
            loadProviders();
        }
    };

    // Display label for each provider key. Centralized here so the renderer
    // doesn't need to import the registry just for label strings.
    const PROVIDER_LABELS: Record<ProviderId, string> = {
        'sensi-managed': 'Sensi AI',
        minimax: 'MiniMax',
        gemini:  'Gemini',
        claude:  'Claude',
        openai:  'OpenAI',
        groq:    'Groq',
        ollama:  'Ollama (local)',
    };

    // Pretty-print the model ID. For ollama-* IDs, strip the prefix for display.
    const prettyModel = (id: string): string => {
        if (id.startsWith('ollama-')) return id.replace(/^ollama-/, '');
        // Tidy MiniMax variants
        if (id.startsWith('MiniMax-')) return id.replace(/^MiniMax-/, '');
        return id;
    };

    const panelClass = isLight
        ? 'bg-[#F3F4F6]/92 border-black/10 shadow-black/10'
        : 'bg-[#1E1E1E]/80 border-white/10 shadow-black/40';

    const headerClass = isLight
        ? 'text-slate-500'
        : 'text-slate-400';

    const configured = providers.filter(p => p.configured);

    return (
        <div className="w-fit h-fit bg-transparent flex flex-col">
            <div className={`w-[220px] h-[360px] backdrop-blur-md border rounded-[16px] overflow-hidden shadow-2xl p-2 flex flex-col animate-scale-in origin-top-left ${panelClass}`}>

                {isLoading ? (
                    <div className={`flex items-center justify-center py-4 ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        <span className="text-xs">Loading providers...</span>
                    </div>
                ) : (
                    <div className="flex-1 overflow-y-auto scrollbar-hide flex flex-col gap-0.5">
                        {configured.length === 0 ? (
                            <div className={`px-4 py-3 text-center text-xs ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
                                No providers connected.<br />Open Settings → AI Providers.
                            </div>
                        ) : (
                            configured.map((p) => (
                                <div key={p.provider} className="flex flex-col">
                                    {/* Provider header — non-clickable section label */}
                                    <div className={`px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider ${headerClass}`}>
                                        {PROVIDER_LABELS[p.provider]}
                                    </div>
                                    {/* Model rows */}
                                    {p.models.length === 0 ? (
                                        <div className={`px-3 py-1 text-[11px] italic ${headerClass}`}>
                                            No models
                                        </div>
                                    ) : (
                                        p.models.map((modelId) => {
                                            const isSelected = activePair.provider === p.provider && activePair.model === modelId;
                                            return (
                                                <button
                                                    key={`${p.provider}:${modelId}`}
                                                    onClick={() => handleSelect(p.provider, modelId)}
                                                    className={`
                                                        w-full text-left px-3 py-1.5 flex items-center justify-between group transition-colors duration-200 rounded-lg
                                                        ${isSelected
                                                            ? (isLight ? 'bg-black/[0.07] text-slate-900' : 'bg-white/10 text-white')
                                                            : (isLight ? 'text-slate-500 hover:bg-black/[0.04] hover:text-slate-800' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200')
                                                        }
                                                    `}
                                                >
                                                    <span className="text-[12px] font-medium truncate flex-1 min-w-0">{prettyModel(modelId)}</span>
                                                    {isSelected && <Check className={`w-3.5 h-3.5 shrink-0 ml-2 ${isLight ? 'text-emerald-600' : 'text-emerald-400'}`} />}
                                                </button>
                                            );
                                        })
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                )}

            </div>
        </div>
    );
};

export default ModelSelectorWindow;

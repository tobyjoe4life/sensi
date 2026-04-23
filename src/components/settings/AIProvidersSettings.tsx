import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Edit2, AlertCircle, CheckCircle, Save, ChevronDown, Check, RefreshCw, ExternalLink, Loader2, Globe, Sparkles } from 'lucide-react';
import { STANDARD_CLOUD_MODELS, prettifyModelId } from '../../utils/modelUtils';
import { validateCurl } from '../../lib/curl-validator';
import { ProviderCard } from './ProviderCard';
import type { SensiAuthStateIpc } from '../../types/electron';

interface CustomProvider {
    id: string;
    name: string;
    curlCommand: string;
    responsePath: string;
}

interface ModelOption {
    id: string;
    name: string;
}

interface ModelSelectProps {
    value: string;
    options: ModelOption[];
    onChange: (value: string) => void;
    placeholder?: string;
}

const ModelSelect: React.FC<ModelSelectProps> = ({ value, options, onChange, placeholder = "Select model" }) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = React.useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const selectedOption = options.find(o => o.id === value);

    return (
        <div className="relative" ref={containerRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-40 bg-bg-input border border-border-subtle rounded-lg px-3 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary flex items-center justify-between hover:bg-bg-elevated transition-colors"
                type="button"
            >
                <span className="truncate pr-2">{selectedOption ? selectedOption.name : placeholder}</span>
                <ChevronDown size={14} className={`text-text-secondary transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="absolute top-full right-0 mt-1 w-full bg-bg-elevated border border-border-subtle rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto animated fadeIn">
                    <div className="p-1 space-y-0.5">
                        {options.map((option) => (
                            <button
                                key={option.id}
                                onClick={() => {
                                    onChange(option.id);
                                    setIsOpen(false);
                                }}
                                className={`w-full text-left px-3 py-2 text-xs rounded-md flex items-center justify-between group transition-colors ${value === option.id ? 'bg-bg-input hover:bg-bg-elevated text-text-primary' : 'text-text-secondary hover:bg-bg-input hover:text-text-primary'}`}
                                type="button"
                            >
                                <span className="truncate">{option.name}</span>
                                {value === option.id && <Check size={14} className="text-accent-primary shrink-0 ml-2" />}
                            </button>
                        ))}
                        {options.length === 0 && (
                            <div className="px-3 py-2 text-xs text-gray-500 italic">No models available</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export const AIProvidersSettings: React.FC = () => {
    // v2.16.0: sensi-cloud auth state drives the managed-AI card visibility
    // and action copy. We listen to the broadcast so state stays live when
    // the user signs in/out from the Account tab.
    const [authState, setAuthState] = useState<SensiAuthStateIpc | null>(null);
    const [activeProvider, setActiveProvider] = useState<string | null>(null);
    const [managedBusy, setManagedBusy] = useState(false);
    const [managedError, setManagedError] = useState<string | null>(null);
    useEffect(() => {
        let mounted = true;
        window.electronAPI?.authGetState?.().then((res) => {
            if (!mounted) return;
            if (res.success) setAuthState(res.state);
        }).catch(() => { /* noop */ });
        const unsubscribe = window.electronAPI?.onAuthStateChanged?.((next) => {
            if (!mounted) return;
            setAuthState(next);
        });
        window.electronAPI?.getActiveProviderAndModel?.()
            .then((pair) => {
                if (!mounted) return;
                if (pair?.provider) setActiveProvider(pair.provider);
            })
            .catch(() => { /* noop */ });
        return () => {
            mounted = false;
            if (typeof unsubscribe === 'function') unsubscribe();
        };
    }, []);

    // --- Standard Providers ---
    const [apiKey, setApiKey] = useState('');
    const [groqApiKey, setGroqApiKey] = useState('');
    const [openaiApiKey, setOpenaiApiKey] = useState('');
    const [claudeApiKey, setClaudeApiKey] = useState('');
    // sensi M1 Step 3: MiniMax local input state, mirrors the other cloud providers
    const [minimaxApiKey, setMinimaxApiKey] = useState('');

    // Status
    const [savedStatus, setSavedStatus] = useState<Record<string, boolean>>({});
    const [savingStatus, setSavingStatus] = useState<Record<string, boolean>>({});
    const [hasStoredKey, setHasStoredKey] = useState<Record<string, boolean>>({});
    // Fast mode is available with a local Groq key
    const canUseFastMode = !!(hasStoredKey.groq || hasStoredKey.natively);
    const [testStatus, setTestStatus] = useState<Record<string, 'idle' | 'testing' | 'success' | 'error'>>({});
    const [testError, setTestError] = useState<Record<string, string>>({});

    // --- Custom Providers ---
    const [customProviders, setCustomProviders] = useState<CustomProvider[]>([]);
    const [isEditingCustom, setIsEditingCustom] = useState(false);
    const [editingProvider, setEditingProvider] = useState<CustomProvider | null>(null);
    const [customName, setCustomName] = useState('');
    const [customCurl, setCustomCurl] = useState('');
    const [customResponsePath, setCustomResponsePath] = useState('');
    const [curlError, setCurlError] = useState<string | null>(null);

    // --- Local (Ollama) ---
    const [ollamaModels, setOllamaModels] = useState<string[]>([]);
    const [ollamaStatus, setOllamaStatus] = useState<'checking' | 'detected' | 'not-found' | 'fixing'>('checking');
    const [ollamaRestarted, setOllamaRestarted] = useState(false);
    const [isRefreshingOllama, setIsRefreshingOllama] = useState(false);

    // --- Default Model ---
    const [defaultModel, setDefaultModel] = useState<string>('gemini-3.1-flash-lite-preview');
    const [fastResponseMode, setFastResponseMode] = useState(false);
    const [credentialsLoaded, setCredentialsLoaded] = useState(false);

    // --- Dynamic Model Discovery ---
    const [preferredModels, setPreferredModels] = useState<Record<string, string>>({});

    // --- sensi M7 / RESEARCH-01: Tavily (Search Provider) ---
    // Moved here from the hidden Profile Intelligence panel so the key is
    // surfaced as a first-class provider regardless of persona setup.
    const [tavilyApiKey, setTavilyApiKey] = useState('');
    const [tavilyError, setTavilyError] = useState('');
    const [tavilySaving, setTavilySaving] = useState(false);
    const [hasStoredTavilyKey, setHasStoredTavilyKey] = useState(false);

    // Load Initial Data
    useEffect(() => {
        const loadCredentials = async () => {
            try {
                // Load credentials FIRST so canUseFastMode is correct before we set fastResponseMode.
                // If we set fastResponseMode before hasStoredKey is populated, the enforcement
                // effect below fires with canUseFastMode=false and immediately resets fast mode
                // to false — writing that reset back to SettingsManager on every startup.
                // @ts-ignore
                const creds = await window.electronAPI?.getStoredCredentials?.();
                if (creds) {
                    setHasStoredKey({
                        gemini: creds.hasGeminiKey,
                        groq: creds.hasGroqKey,
                        openai: creds.hasOpenaiKey,
                        claude: creds.hasClaudeKey,
                        natively: creds.hasNativelyKey || false,
                        // sensi M1 Step 3: MiniMax presence flag
                        minimax: creds.hasMinimaxKey || false,
                    });
                    setHasStoredTavilyKey(!!creds.hasTavilyKey);
                    // Load preferred models
                    const pm: Record<string, string> = {};
                    if (creds.geminiPreferredModel) pm.gemini = creds.geminiPreferredModel;
                    if (creds.groqPreferredModel) pm.groq = creds.groqPreferredModel;
                    if (creds.openaiPreferredModel) pm.openai = creds.openaiPreferredModel;
                    if (creds.claudePreferredModel) pm.claude = creds.claudePreferredModel;
                    // sensi M1 Step 3: MiniMax preferred model
                    if (creds.minimaxPreferredModel) pm.minimax = creds.minimaxPreferredModel;
                    setPreferredModels(pm);
                }

                // Now it's safe to read fast mode — hasStoredKey is already set so
                // canUseFastMode will be correct when the enforcement effect runs.
                // @ts-ignore
                const fastMode = await window.electronAPI?.getGroqFastTextMode();
                if (fastMode) setFastResponseMode(fastMode.enabled);

                // Mark credentials as fully loaded so the enforcement effect can fire
                setCredentialsLoaded(true);

                // @ts-ignore
                const custom = await window.electronAPI?.getCustomProviders();
                if (custom) {
                    setCustomProviders(custom);
                }

                // Load persisted default model
                // @ts-ignore
                const result = await window.electronAPI?.getDefaultModel();
                if (result && result.model) {
                    setDefaultModel(result.model);
                }

                // Check Ollama
                checkOllama();

            } catch (e) {
                console.error("Failed to load settings:", e);
                setCredentialsLoaded(true); // Unblock even on error
            }
        };
        loadCredentials();

        // Listen for changes from other windows (2-way sync)
        if (window.electronAPI?.onGroqFastTextChanged) {
            // @ts-ignore
            const unsubscribe = window.electronAPI.onGroqFastTextChanged((enabled: boolean) => {
                setFastResponseMode(enabled);
                localStorage.setItem('natively_groq_fast_text', String(enabled));
            });
            return () => unsubscribe();
        }
    }, []);

    // Effect to enforce fast mode disabled if no Groq key is configured.
    // Guard with credentialsLoaded so this never fires during the initial async load phase
    // (when hasStoredKey is still empty and canUseFastMode is incorrectly false).
    useEffect(() => {
        if (!credentialsLoaded) return;
        if (!canUseFastMode && fastResponseMode) {
            setFastResponseMode(false);
            localStorage.setItem('natively_groq_fast_text', 'false');
            // @ts-ignore
            window.electronAPI?.setGroqFastTextMode(false);
        }
    }, [credentialsLoaded, canUseFastMode, fastResponseMode]);

    // Poll for Ollama status every 3 seconds requesting smart start on mount
    useEffect(() => {
        // Immediate "Smart Start" check
        ensureOllamaStartup();

        // Background polling for maintenance
        const interval = setInterval(() => {
            checkOllama(false);
        }, 3000);
        return () => clearInterval(interval);
    }, []);

    const ensureOllamaStartup = async () => {
        setOllamaStatus('checking');
        try {
            // @ts-ignore
            const result = await window.electronAPI?.invoke?.('ensure-ollama-running');
            if (result && result.success) {
                // It's running (or just started), now fetch models
                checkOllama(true);
            } else {
                setOllamaStatus('not-found');
            }
        } catch (e) {
            console.warn("Ollama ensure startup failed:", e);
            setOllamaStatus('not-found');
        }
    };

    const checkOllama = async (_isInitial = true) => {
        // Don't override 'checking' if we are already in smart-start mode
        // if (isInitial) setOllamaStatus('checking'); 

        try {
            // @ts-ignore
            const models = await window.electronAPI?.getAvailableOllamaModels?.();
            if (models && models.length > 0) {
                setOllamaModels(models);
                setOllamaStatus('detected');
            } else {
                // Silent failure on background checks
                // Only set not-found if we haven't detected it yet
                if (ollamaStatus !== 'detected') {
                    setOllamaStatus('not-found');
                }
            }
        } catch (e) {
            // console.warn(`Ollama check failed:`, e);
            if (ollamaStatus !== 'detected') {
                setOllamaStatus('not-found');
            }
        }
    };

    const handleFixOllama = async () => {
        setOllamaStatus('fixing');
        try {
            // @ts-ignore
            const result = await window.electronAPI?.invoke?.('force-restart-ollama');
            if (result && result.success) {
                setOllamaRestarted(true);
                // Wait for server to be ready
                setTimeout(() => checkOllama(false), 2000);
            } else {
                setOllamaStatus('not-found');
            }
        } catch (e) {
            console.error("Fix failed", e);
            setOllamaStatus('not-found');
        }
    };

    const handleSaveKey = async (provider: string, key: string, setter: (val: string) => void) => {
        if (!key.trim()) return;
        setSavingStatus(prev => ({ ...prev, [provider]: true }));
        try {
            let result;
            // @ts-ignore
            if (provider === 'gemini') result = await window.electronAPI.setGeminiApiKey(key);
            // @ts-ignore
            if (provider === 'groq') result = await window.electronAPI.setGroqApiKey(key);
            // @ts-ignore
            if (provider === 'openai') result = await window.electronAPI.setOpenaiApiKey(key);
            // @ts-ignore
            if (provider === 'claude') result = await window.electronAPI.setClaudeApiKey(key);
            // sensi M1 Step 3: MiniMax save path
            // @ts-ignore
            if (provider === 'minimax') result = await window.electronAPI.setMinimaxApiKey(key);

            if (result && result.success) {
                setSavedStatus(prev => ({ ...prev, [provider]: true }));
                setHasStoredKey(prev => ({ ...prev, [provider]: true }));
                setter('');
                setTimeout(() => setSavedStatus(prev => ({ ...prev, [provider]: false })), 2000);
            }
        } catch (e) {
            console.error(`Failed to save ${provider} key:`, e);
        } finally {
            setSavingStatus(prev => ({ ...prev, [provider]: false }));
        }
    };

    const handleRemoveKey = async (provider: string, setter: (val: string) => void) => {
        // Deliberately no confirm() dialog here — the Electron native confirm
        // blocks the renderer thread and leaves the underlying input with
        // ambiguous focus on dismissal, which manifests as "can't click the
        // next input until I close Settings" on some machines. Removing a
        // key is reversible (re-paste), so the friction wasn't worth it.
        try {
            let result;
            // @ts-ignore
            if (provider === 'gemini') result = await window.electronAPI.setGeminiApiKey('');
            // @ts-ignore
            if (provider === 'groq') result = await window.electronAPI.setGroqApiKey('');
            // @ts-ignore
            if (provider === 'openai') result = await window.electronAPI.setOpenaiApiKey('');
            // @ts-ignore
            if (provider === 'claude') result = await window.electronAPI.setClaudeApiKey('');
            // sensi M1 Step 3: MiniMax clear path (passing empty string clears the stored key
            // and the runtime LLMHelper.minimaxClient via the IPC handler)
            // @ts-ignore
            if (provider === 'minimax') result = await window.electronAPI.setMinimaxApiKey('');

            if (result && result.success) {
                setHasStoredKey(prev => ({ ...prev, [provider]: false }));
                setter('');
            }
        } catch (e) {
            console.error(`Failed to remove ${provider} key:`, e);
        }
    };

    const handleTestConnection = async (provider: string, key: string) => {
        // Allow testing if key is provided OR if we have a stored key
        if (!key.trim() && !hasStoredKey[provider]) {
            return;
        }
        setTestStatus(prev => ({ ...prev, [provider]: 'testing' }));
        setTestError(prev => ({ ...prev, [provider]: '' }));

        try {
            // @ts-ignore
            const result = await window.electronAPI.testLlmConnection(provider, key);
            if (result.success) {
                setTestStatus(prev => ({ ...prev, [provider]: 'success' }));
                setTimeout(() => setTestStatus(prev => ({ ...prev, [provider]: 'idle' })), 3000);
            } else {
                setTestStatus(prev => ({ ...prev, [provider]: 'error' }));
                setTestError(prev => ({ ...prev, [provider]: result.error || 'Connection failed' }));
            }
        } catch (e: any) {
            setTestStatus(prev => ({ ...prev, [provider]: 'error' }));
            setTestError(prev => ({ ...prev, [provider]: e.message || 'Connection failed' }));
        }
    };

    const openKeyUrl = (provider: string) => {
        const urls: Record<string, string> = {
            gemini: 'https://aistudio.google.com/app/apikey',
            groq: 'https://console.groq.com/keys',
            openai: 'https://platform.openai.com/api-keys',
            claude: 'https://console.anthropic.com/settings/keys',
            // sensi M1 Step 3: MiniMax key console (verified 2026-04-13)
            minimax: 'https://platform.minimax.io/user-center/basic-information/interface-key',
        };
        // @ts-ignore
        window.electronAPI?.openExternal(urls[provider]);
    };


    // --- Custom Provider Handlers ---

    const handleEditProvider = (provider: CustomProvider) => {
        setEditingProvider(provider);
        setCustomName(provider.name);
        setCustomCurl(provider.curlCommand);
        setCustomResponsePath(provider.responsePath || '');
        setIsEditingCustom(true);
        setCurlError(null);
    };

    const handleNewProvider = () => {
        setEditingProvider(null);
        setCustomName('');
        setCustomCurl('');
        setCustomResponsePath('');
        setIsEditingCustom(true);
        setCurlError(null);
    };

    const handleSaveCustom = async () => {
        setCurlError(null);
        if (!customName.trim()) {
            setCurlError("Provider Name is required.");
            return;
        }

        const validation = validateCurl(customCurl);
        if (!validation.isValid) {
            setCurlError(validation.message || "Invalid cURL command.");
            return;
        }

        const newProvider: CustomProvider = {
            id: editingProvider ? editingProvider.id : crypto.randomUUID(),
            name: customName,
            curlCommand: customCurl,
            responsePath: customResponsePath
        };

        try {
            // @ts-ignore
            const result = await window.electronAPI.saveCustomProvider(newProvider);
            if (result.success) {
                // Refresh list
                // @ts-ignore
                const updated = await window.electronAPI.getCustomProviders();
                setCustomProviders(updated);
                setIsEditingCustom(false);
            } else {
                setCurlError(result.error ?? null);
            }
        } catch (e: any) {
            setCurlError(e.message);
        }
    };

    const handleDeleteCustom = async (id: string) => {
        // No confirm() — native dialog steals focus from the settings panel.
        // Delete is immediate; user re-adds the provider if this was a mistake.
        try {
            // @ts-ignore
            const result = await window.electronAPI.deleteCustomProvider(id);
            if (result.success) {
                // @ts-ignore
                const updated = await window.electronAPI.getCustomProviders();
                setCustomProviders(updated);
            }
        } catch (e) {
            console.error("Failed to delete provider:", e);
        }
    };

    return (
        <div className="space-y-5 animated fadeIn pb-10">
            {/* Default Model for Chat */}
            <div className="space-y-5">
                <div>
                    <h3 className="text-sm font-bold text-text-primary mb-1">Default Model for Chat</h3>
                    <p className="text-xs text-text-secondary mb-2">Primary model for new chats. Other configured models act as fallbacks.</p>
                </div>

                <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle flex items-center justify-between">
                    <div>
                        <label className="block text-xs font-medium text-text-primary uppercase tracking-wide mb-0">Active Model</label>
                        <p className="text-[10px] text-text-secondary">Applies to new chats instantly.</p>
                    </div>
                    <ModelSelect
                        value={defaultModel}
                        options={(() => {
                            const opts: { id: string; name: string }[] = [];

                            for (const [prov, cfg] of Object.entries(STANDARD_CLOUD_MODELS)) {
                                if (!hasStoredKey[prov as keyof typeof hasStoredKey]) continue;
                                cfg.ids.forEach((id, i) => opts.push({ id, name: cfg.names[i] }));
                                const pm = preferredModels[prov as keyof typeof preferredModels];
                                if (pm && !cfg.ids.includes(pm)) {
                                    opts.push({ id: pm, name: prettifyModelId(pm) });
                                }
                            }
                            customProviders.forEach(p => opts.push({ id: p.id, name: p.name }));
                            ollamaModels.forEach(m => opts.push({ id: `ollama-${m}`, name: `${m} (Local)` }));
                            
                            if (defaultModel && !opts.find(o => o.id === defaultModel)) {
                                opts.unshift({ id: defaultModel, name: prettifyModelId(defaultModel) });
                            }
                            return opts;
                        })()}
                        onChange={(val) => {
                            setDefaultModel(val);
                            // @ts-ignore - persist as default + update runtime + broadcast
                            window.electronAPI?.setDefaultModel(val).catch(console.error);
                        }}
                    />
                </div>

                {/* Fast Response Mode */}
                <div
                    className={`bg-bg-item-surface rounded-xl p-5 border border-border-subtle flex items-center justify-between ${!canUseFastMode ? 'opacity-50 grayscale' : ''}`}
                    title={!canUseFastMode ? "Requires a Groq API Key to be configured" : ""}
                >
                    <div>
                        <div className="flex items-center gap-2">
                            <label className="block text-xs font-medium text-text-primary uppercase tracking-wide mb-0">Fast Response Mode</label>
                            <span className="bg-orange-500/10 text-orange-500 text-[9px] font-bold px-1.5 py-0.5 rounded border border-orange-500/20">NEW</span>
                        </div>
                        <p className="text-[10px] text-text-secondary mt-0.5">Super fast responses using Groq Llama 3 for text. Multimodal requests still use your Default Model.</p>
                        {!canUseFastMode && (
                            <p className="text-[10px] text-orange-500 mt-0.5 font-medium">Requires a Groq API Key to be configured.</p>
                        )}
                    </div>
                    <div
                        onClick={async () => {
                            if (!canUseFastMode) {
                                alert("Please configure a Groq API Key first to enable Fast Response Mode.");
                                return;
                            }
                            const newState = !fastResponseMode;
                            setFastResponseMode(newState);
                            localStorage.setItem('natively_groq_fast_text', String(newState));
                            // @ts-ignore
                            await window.electronAPI?.setGroqFastTextMode(newState);
                        }}
                        className={`w-11 h-6 rounded-full relative transition-colors ${!canUseFastMode ? 'cursor-not-allowed bg-bg-toggle-switch' : fastResponseMode ? 'bg-orange-500' : 'bg-bg-toggle-switch border border-border-muted'}`}
                    >
                        <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${fastResponseMode ? 'translate-x-5' : 'translate-x-0'}`} />
                    </div>
                </div>
            </div>

            {/* v2.16.0: Sensi AI (managed) — the default for signed-in users */}
            <div className="space-y-5">
                <div>
                    <h3 className="text-sm font-bold text-text-primary mb-1">Sensi AI</h3>
                    <p className="text-xs text-text-secondary mb-2">No key required. Free; upgrade for unlimited.</p>
                </div>

                <div className={`rounded-xl border p-5 ${activeProvider === 'sensi-managed' ? 'border-accent-primary/40 bg-accent-primary/5' : 'border-border-subtle bg-bg-item-surface'}`}>
                    <div className="flex items-start gap-4">
                        <div className="w-10 h-10 rounded-lg bg-accent-primary/10 border border-accent-primary/20 flex items-center justify-center shrink-0 text-accent-primary">
                            <Sparkles size={20} strokeWidth={1.8} />
                        </div>
                        <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                                <h4 className="text-sm font-semibold text-text-primary">Sensi AI</h4>
                                {authState?.signedIn ? (
                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border uppercase tracking-wide ${authState.tier === 'pro' ? 'text-amber-400 bg-amber-400/10 border-amber-400/20' : 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20'}`}>
                                        {authState.tier === 'pro' ? 'Pro' : 'Free'}
                                    </span>
                                ) : (
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border text-text-tertiary bg-bg-input border-border-subtle uppercase tracking-wide">Sign in</span>
                                )}
                                {activeProvider === 'sensi-managed' && (
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border text-accent-primary bg-accent-primary/10 border-accent-primary/20 uppercase tracking-wide">Active</span>
                                )}
                            </div>
                            <p className="text-[11px] text-text-secondary">
                                {authState?.signedIn
                                    ? 'Your account covers everything. No keys needed.'
                                    : 'Sign in once. No keys to manage.'}
                            </p>
                        </div>
                        {authState?.signedIn ? (
                            <button
                                onClick={async () => {
                                    if (activeProvider === 'sensi-managed') return;
                                    setManagedBusy(true);
                                    setManagedError(null);
                                    try {
                                        await window.electronAPI?.setActiveProviderAndModel?.('sensi-managed', 'sensi-managed');
                                        setActiveProvider('sensi-managed');
                                    } catch (e) {
                                        setManagedError(e instanceof Error ? e.message : 'Could not activate Sensi AI.');
                                    } finally {
                                        setManagedBusy(false);
                                    }
                                }}
                                disabled={managedBusy || activeProvider === 'sensi-managed'}
                                className={`px-4 py-2 rounded-lg text-xs font-medium transition-colors shrink-0 ${activeProvider === 'sensi-managed' ? 'bg-accent-primary/10 text-accent-primary border border-accent-primary/30' : 'bg-accent-primary/90 hover:bg-accent-primary text-white disabled:opacity-50'}`}
                            >
                                {managedBusy ? 'Activating...' : activeProvider === 'sensi-managed' ? 'In use' : 'Use as default'}
                            </button>
                        ) : (
                            <button
                                onClick={() => { void window.electronAPI?.authSignIn?.().catch(() => { /* noop */ }); }}
                                className="px-4 py-2 rounded-lg text-xs font-medium bg-accent-primary/90 hover:bg-accent-primary text-white shrink-0"
                            >
                                Sign in
                            </button>
                        )}
                    </div>
                    {managedError && (
                        <p className="mt-2 text-[11px] text-red-400">{managedError}</p>
                    )}
                </div>
            </div>

            {/* Power user — bring your own key. Collapsed by default for
                signed-in users; always expanded for signed-out users so
                they still have a discoverable path to BYOK. */}
            <details className="space-y-5 [&_summary]:list-none" {...(authState?.signedIn ? {} : { open: true })}>
                <summary className="cursor-pointer select-none">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-sm font-bold text-text-primary mb-1">Power user — bring your own key</h3>
                            <p className="text-xs text-text-secondary mb-2">Use your own Gemini / OpenAI / Claude / Groq / MiniMax key instead of Sensi AI.</p>
                        </div>
                        <ChevronDown size={16} className="text-text-tertiary group-open:rotate-180 transition-transform" />
                    </div>
                </summary>

                <div className="space-y-4">

                    {/* Gemini */}
                    <ProviderCard
                        providerId="gemini"
                        providerName="Gemini"
                        apiKey={apiKey}
                        preferredModel={preferredModels.gemini}
                        hasStoredKey={!!hasStoredKey.gemini}
                        onKeyChange={setApiKey}
                        onSaveKey={async () => { await handleSaveKey('gemini', apiKey, setApiKey); }}
                        onRemoveKey={() => handleRemoveKey('gemini', setApiKey)}
                        onTestConnection={() => handleTestConnection('gemini', apiKey)}
                        testStatus={testStatus.gemini || 'idle'}
                        testError={testError.gemini}
                        savingStatus={!!savingStatus.gemini}
                        savedStatus={!!savedStatus.gemini}
                        keyPlaceholder="AIzaSy..."
                        keyUrl="https://aistudio.google.com/app/apikey"
                        onPreferredModelChange={(model) => setPreferredModels(prev => ({ ...prev, gemini: model }))}
                    />

                    {/* Groq */}
                    <ProviderCard
                        providerId="groq"
                        providerName="Groq"
                        apiKey={groqApiKey}
                        preferredModel={preferredModels.groq}
                        hasStoredKey={!!hasStoredKey.groq}
                        onKeyChange={setGroqApiKey}
                        onSaveKey={async () => { await handleSaveKey('groq', groqApiKey, setGroqApiKey); }}
                        onRemoveKey={() => handleRemoveKey('groq', setGroqApiKey)}
                        onTestConnection={() => handleTestConnection('groq', groqApiKey)}
                        testStatus={testStatus.groq || 'idle'}
                        testError={testError.groq}
                        savingStatus={!!savingStatus.groq}
                        savedStatus={!!savedStatus.groq}
                        keyPlaceholder="gsk_..."
                        keyUrl="https://console.groq.com/keys"
                        onPreferredModelChange={(model) => setPreferredModels(prev => ({ ...prev, groq: model }))}
                    />

                    {/* OpenAI */}
                    <ProviderCard
                        providerId="openai"
                        providerName="OpenAI"
                        apiKey={openaiApiKey}
                        preferredModel={preferredModels.openai}
                        hasStoredKey={!!hasStoredKey.openai}
                        onKeyChange={setOpenaiApiKey}
                        onSaveKey={async () => { await handleSaveKey('openai', openaiApiKey, setOpenaiApiKey); }}
                        onRemoveKey={() => handleRemoveKey('openai', setOpenaiApiKey)}
                        onTestConnection={() => handleTestConnection('openai', openaiApiKey)}
                        testStatus={testStatus.openai || 'idle'}
                        testError={testError.openai}
                        savingStatus={!!savingStatus.openai}
                        savedStatus={!!savedStatus.openai}
                        keyPlaceholder="sk-..."
                        keyUrl="https://platform.openai.com/api-keys"
                        onPreferredModelChange={(model) => setPreferredModels(prev => ({ ...prev, openai: model }))}
                    />

                    {/* Claude */}
                    <ProviderCard
                        providerId="claude"
                        providerName="Claude"
                        apiKey={claudeApiKey}
                        preferredModel={preferredModels.claude}
                        hasStoredKey={!!hasStoredKey.claude}
                        onKeyChange={setClaudeApiKey}
                        onSaveKey={async () => { await handleSaveKey('claude', claudeApiKey, setClaudeApiKey); }}
                        onRemoveKey={() => handleRemoveKey('claude', setClaudeApiKey)}
                        onTestConnection={() => handleTestConnection('claude', claudeApiKey)}
                        testStatus={testStatus.claude || 'idle'}
                        testError={testError.claude}
                        savingStatus={!!savingStatus.claude}
                        savedStatus={!!savedStatus.claude}
                        keyPlaceholder="sk-ant-..."
                        keyUrl="https://console.anthropic.com/settings/keys"
                        onPreferredModelChange={(model) => setPreferredModels(prev => ({ ...prev, claude: model }))}
                    />

                    {/* sensi M1 Step 3 — MiniMax (text-only via OpenAI-compat endpoint).
                        Routed through the existing ProviderCard pattern. The
                        fetchProviderModels IPC returns the static MiniMax-M2.7 +
                        MiniMax-M2.7-highspeed baseline from
                        electron/shared/standardCloudModels.ts (no dynamic /v1/models
                        call yet). Vision is NOT supported on this endpoint — see the
                        warning in LLMHelper.streamChat() dispatch branch. */}
                    <ProviderCard
                        providerId="minimax"
                        providerName="MiniMax"
                        apiKey={minimaxApiKey}
                        preferredModel={preferredModels.minimax}
                        hasStoredKey={!!hasStoredKey.minimax}
                        onKeyChange={setMinimaxApiKey}
                        onSaveKey={async () => { await handleSaveKey('minimax', minimaxApiKey, setMinimaxApiKey); }}
                        onRemoveKey={() => handleRemoveKey('minimax', setMinimaxApiKey)}
                        onTestConnection={() => handleTestConnection('minimax', minimaxApiKey)}
                        testStatus={testStatus.minimax || 'idle'}
                        testError={testError.minimax}
                        savingStatus={!!savingStatus.minimax}
                        savedStatus={!!savedStatus.minimax}
                        keyPlaceholder="MiniMax API key..."
                        keyUrl="https://platform.minimax.io/user-center/basic-information/interface-key"
                        onPreferredModelChange={(model) => setPreferredModels(prev => ({ ...prev, minimax: model }))}
                    />

                </div>
            </details>

            {/* sensi M7 / RESEARCH-01: Search Providers
                Surfaces Tavily as a first-class provider so the overlay
                Research chip can operate without any persona setup. */}
            <div className="space-y-5">
                <div>
                    <h3 className="text-sm font-bold text-text-primary mb-1">Search Providers</h3>
                    <p className="text-xs text-text-secondary mb-2">Power live web lookups and the overlay's Research action.</p>
                </div>

                <div className="bg-bg-item-surface rounded-xl border border-border-subtle">
                    <div className="p-5">
                        <div className="flex items-center gap-4 mb-4">
                            <div className="w-10 h-10 rounded-lg bg-bg-input border border-border-subtle flex items-center justify-center text-emerald-500 shrink-0">
                                <Globe size={20} />
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <h4 className="text-sm font-bold text-text-primary">Tavily</h4>
                                    {hasStoredTavilyKey && (
                                        <span className="text-[9px] font-bold text-emerald-500 px-1.5 py-0.5 bg-emerald-500/10 rounded-full border border-emerald-500/20 uppercase tracking-wide">Connected</span>
                                    )}
                                </div>
                                <p className="text-[11px] text-text-secondary mt-0.5">
                                    Live web search for company research and topic briefs.
                                </p>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <div>
                                <div className="flex justify-between items-center mb-1.5">
                                    <label className="text-[10px] font-semibold text-text-secondary uppercase tracking-wide block">API Key</label>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => {
                                                // @ts-ignore
                                                window.electronAPI?.openExternal?.('https://app.tavily.com/home');
                                            }}
                                            className="text-[10px] flex items-center gap-1 text-text-tertiary hover:text-text-primary transition-colors"
                                            title="Get a Tavily API key"
                                        >
                                            <span className="uppercase tracking-wide">Get Key</span>
                                            <ExternalLink size={10} />
                                        </button>
                                        {hasStoredTavilyKey && (
                                            <button
                                                onClick={async () => {
                                                    try {
                                                        const result = await window.electronAPI?.setTavilyApiKey?.('');
                                                        if (result?.success) {
                                                            setHasStoredTavilyKey(false);
                                                            setTavilyApiKey('');
                                                        }
                                                    } catch (e: any) {
                                                        setTavilyError(e?.message ?? 'Failed to remove key.');
                                                    }
                                                }}
                                                className="text-[10px] flex items-center gap-1 text-red-400 hover:text-red-300 transition-colors bg-red-500/10 hover:bg-red-500/20 px-1.5 py-0.5 rounded"
                                                title="Remove API Key"
                                            >
                                                <Trash2 size={10} strokeWidth={2} /> Remove
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <input
                                    type="password"
                                    value={tavilyApiKey}
                                    onChange={(e) => { setTavilyApiKey(e.target.value); setTavilyError(''); }}
                                    placeholder={hasStoredTavilyKey ? '••••••••••••' : 'Enter Tavily API key (tvly-...)'}
                                    className="w-full bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-primary/50 focus:ring-1 focus:ring-accent-primary/20 transition-all"
                                />
                            </div>
                            {tavilyError && (
                                <p className="text-[10px] text-red-400 px-1">{tavilyError}</p>
                            )}
                            <button
                                onClick={async () => {
                                    if (!tavilyApiKey.trim()) return;
                                    setTavilyError('');
                                    setTavilySaving(true);
                                    try {
                                        const result = await window.electronAPI?.setTavilyApiKey?.(tavilyApiKey.trim());
                                        if (result && !result.success) {
                                            setTavilyError(result.error ?? 'Failed to save API key.');
                                        } else {
                                            setHasStoredTavilyKey(true);
                                            setTavilyApiKey('');
                                        }
                                    } catch (e: any) {
                                        setTavilyError(e?.message ?? 'Unexpected error saving API key.');
                                    } finally {
                                        setTavilySaving(false);
                                    }
                                }}
                                disabled={tavilySaving || !tavilyApiKey.trim()}
                                className={`w-full px-4 py-2 rounded-lg text-xs font-medium transition-all ${tavilySaving ? 'bg-bg-input text-text-tertiary cursor-wait' : !tavilyApiKey.trim() ? 'bg-bg-input text-text-tertiary cursor-not-allowed' : 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-sm'}`}
                            >
                                {tavilySaving ? 'Saving...' : 'Save API Key'}
                            </button>
                        </div>

                        <div className="mt-3 flex items-start gap-2 px-3 py-2.5 bg-bg-input/50 rounded-lg">
                            <AlertCircle size={12} className="text-text-tertiary shrink-0 mt-0.5" />
                            <p className="text-[10px] text-text-tertiary leading-relaxed">
                                Without a key, Research falls back to LLM general knowledge (may be outdated). Grab a free key at{' '}
                                <span
                                    className="text-emerald-500/80 hover:text-emerald-400 underline underline-offset-2 cursor-pointer"
                                    onClick={() => {
                                        // @ts-ignore
                                        window.electronAPI?.openExternal?.('https://app.tavily.com/home');
                                    }}
                                >
                                    app.tavily.com
                                </span>
                                . Keys start with <code className="text-emerald-500/80">tvly-</code>.
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Local (Ollama) Providers */}
            <div className="space-y-5">
                <div className="flex items-center justify-between mb-2">
                    <div>
                        <h3 className="text-sm font-bold text-text-primary mb-1">Local Models (Ollama)</h3>
                        <p className="text-xs text-text-secondary">Run open-source models locally.</p>
                    </div>
                    <button
                        onClick={async () => {
                            setIsRefreshingOllama(true);
                            await checkOllama(false);
                            // Add a small delay for visual feedback if the check is too fast
                            setTimeout(() => setIsRefreshingOllama(false), 500);
                        }}
                        className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-input transition-colors"
                        title="Refresh Ollama"
                        disabled={isRefreshingOllama}
                    >
                        <RefreshCw size={18} className={isRefreshingOllama ? "animate-spin" : ""} />
                    </button>
                </div>

                <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle">
                    {ollamaStatus === 'checking' && (
                        <div className="flex items-center gap-2 text-xs text-text-secondary">
                            <span className="animate-spin">⏳</span> Checking for Ollama...
                        </div>
                    )}

                    {ollamaStatus === 'fixing' && (
                        <div className="flex items-center gap-2 text-xs text-text-secondary">
                            <span className="animate-spin">🔧</span> Attempting to auto-fix connection...
                        </div>
                    )}

                    {ollamaStatus === 'not-found' && (
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-2 text-xs text-red-400">
                                <AlertCircle size={14} />
                                <span>Ollama not detected</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <p className="text-xs text-text-secondary">
                                    Ensure Ollama is running (`ollama serve`).
                                </p>
                                <button
                                    onClick={handleFixOllama}
                                    className="text-[10px] bg-bg-elevated hover:bg-bg-input px-2 py-1 rounded border border-border-subtle"
                                >
                                    Auto-Fix Connection
                                </button>
                            </div>
                        </div>
                    )}

                    {ollamaStatus === 'detected' && ollamaModels.length > 0 && (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 text-xs text-green-400 mb-3">
                                <CheckCircle size={14} />
                                <span>Ollama connected</span>
                            </div>

                            <div className="grid grid-cols-1 gap-2">
                                {ollamaModels.map(model => (
                                    <div key={model} className="flex items-center justify-between p-2 bg-bg-input rounded-lg border border-border-subtle">
                                        <span className="text-xs text-text-primary font-mono">{model}</span>
                                        <span className="text-[10px] text-bg-elevated bg-text-secondary px-1.5 py-0.5 rounded-full font-bold">LOCAL</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {ollamaStatus === 'detected' && ollamaModels.length === 0 && (
                        <div className="text-xs text-text-secondary">
                            Ollama is running but no models found. Run `ollama pull llama3` to get started.
                        </div>
                    )}
                </div>
            </div>

            {/* Custom Providers */}
            <div className="space-y-5">
                <div className="flex items-center justify-between mb-2">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <h3 className="text-sm font-bold text-text-primary">Custom Providers</h3>
                            <span className="px-1.5 py-0 rounded-full text-[7px] font-bold bg-yellow-500/10 text-yellow-500 uppercase tracking-widest border border-yellow-500/20 leading-loose mt-0.5">Experimental</span>
                        </div>
                        <p className="text-xs text-text-secondary">Add your own AI endpoints via cURL.</p>
                    </div>
                    {!isEditingCustom && (
                        <button
                            onClick={handleNewProvider}
                            className="flex items-center gap-2 px-3 py-1.5 bg-bg-input hover:bg-bg-elevated border border-border-subtle rounded-lg text-xs font-medium text-text-primary transition-colors"
                        >
                            <Plus size={14} /> Add Provider
                        </button>
                    )}
                </div>

                {isEditingCustom ? (
                    <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle animated fadeIn">
                        <h4 className="text-sm font-bold text-text-primary mb-4">{editingProvider ? 'Edit Provider' : 'New Provider'}</h4>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-text-primary uppercase tracking-wide mb-1">Provider Name</label>
                                <input
                                    type="text"
                                    value={customName}
                                    onChange={(e) => setCustomName(e.target.value)}
                                    placeholder="My Custom LLM"
                                    className="w-full bg-bg-input border border-border-subtle rounded-lg px-4 py-2.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary transition-colors"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-text-primary uppercase tracking-wide mb-1">cURL Command</label>
                                <div className="relative">
                                    <textarea
                                        value={customCurl}
                                        onChange={(e) => setCustomCurl(e.target.value)}
                                        placeholder={`curl https://api.openai.com/v1/chat/completions ... "content": "{{TEXT}}"`}
                                        className="w-full h-32 bg-bg-input border border-border-subtle rounded-lg p-4 text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary transition-colors resize-none leading-relaxed"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-text-primary uppercase tracking-wide mb-1">
                                    Response JSON Path <span className="text-text-tertiary normal-case font-normal">(Optional)</span>
                                </label>
                                <input
                                    type="text"
                                    value={customResponsePath}
                                    onChange={(e) => setCustomResponsePath(e.target.value)}
                                    placeholder="e.g. choices[0].message.content"
                                    className="w-full bg-bg-input border border-border-subtle rounded-lg px-4 py-2.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary transition-colors font-mono"
                                />
                                <p className="text-[10px] text-text-secondary mt-1">
                                    Dot notation path to the answer text in the JSON response. If empty, the full JSON is returned.
                                </p>
                            </div>

                            <div className="bg-bg-elevated/30 rounded-lg overflow-hidden border border-border-subtle mt-4">
                                <div className="px-4 py-3 bg-bg-elevated/50 border-b border-border-subtle flex items-center justify-between">
                                    <h5 className="block text-xs font-medium text-text-primary uppercase tracking-wide">
                                        Configuration Guide
                                    </h5>
                                </div>

                                <div className="p-4 space-y-4">
                                    <div>
                                        <p className="text-xs text-text-secondary mb-2 font-medium">Available Variables</p>
                                        <div className="grid grid-cols-1 gap-2">
                                            <div className="flex items-center gap-2 text-xs">
                                                <code className="bg-bg-input px-1.5 py-0.5 rounded text-text-primary font-mono border border-border-subtle">{"{{TEXT}}"}</code>
                                                <span className="text-text-tertiary">Combined System + Context + Message (Recommended)</span>
                                            </div>
                                            <div className="flex items-center gap-2 text-xs">
                                                <code className="bg-bg-input px-1.5 py-0.5 rounded text-text-primary font-mono border border-border-subtle">{"{{IMAGE_BASE64}}"}</code>
                                                <span className="text-text-tertiary">Screenshot data (if available)</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        <p className="text-xs text-text-secondary mb-2 font-medium">Examples</p>
                                        <div className="space-y-3">
                                            {/* Ollama Example */}
                                            <div>
                                                <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-1.5">Local (Ollama)</div>
                                                <div className="bg-bg-input p-2.5 rounded-lg border border-border-subtle overflow-x-auto group relative">
                                                    <code className="font-mono text-[10px] text-text-primary whitespace-pre block">
                                                        curl http://localhost:11434/api/generate -d '{"{"}"model": "llama3", "prompt": "{`{{TEXT}}`}"{"}"}'
                                                    </code>
                                                </div>
                                            </div>

                                            {/* OpenAI Example */}
                                            <div>
                                                <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-1.5">OpenAI Compatible</div>
                                                <div className="bg-bg-input p-2.5 rounded-lg border border-border-subtle overflow-x-auto">
                                                    <code className="font-mono text-[10px] text-text-primary whitespace-pre block">
                                                        {`curl https://api.openai.com/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "{{TEXT}}"}
    ],
    "temperature": 0.7
  }'`}
                                                    </code>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {curlError && (
                                <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs">
                                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                                    <span>{curlError}</span>
                                </div>
                            )}

                            <div className="flex justify-end gap-3 pt-2">
                                <button
                                    onClick={() => setIsEditingCustom(false)}
                                    className="px-4 py-2 rounded-lg text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-input transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSaveCustom}
                                    className="px-4 py-2 rounded-lg text-xs font-medium bg-accent-primary text-white hover:bg-accent-secondary transition-colors flex items-center gap-2"
                                >
                                    <Save size={14} /> Save Provider
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {customProviders.length === 0 ? (
                            <div className="text-center py-8 bg-bg-item-surface rounded-xl border border-border-subtle border-dashed">
                                <p className="text-xs text-text-tertiary">No custom providers added yet.</p>
                            </div>
                        ) : (
                            customProviders.map((provider) => (
                                <div key={provider.id} className="bg-bg-item-surface rounded-xl p-4 border border-border-subtle flex items-center justify-between group">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-bg-input flex items-center justify-center text-text-secondary font-mono text-xs font-bold">
                                            {provider.name.substring(0, 2).toUpperCase()}
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-medium text-text-primary">{provider.name}</h4>
                                            <p className="text-[10px] text-text-tertiary font-mono truncate max-w-[200px] opacity-60">
                                                {provider.curlCommand.substring(0, 30)}...
                                            </p>
                                            {provider.responsePath && (
                                                <p className="text-[9px] text-text-tertiary font-mono opacity-40 mt-0.5">
                                                    path: {provider.responsePath}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            onClick={() => handleEditProvider(provider)}
                                            className="p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors"
                                            title="Edit"
                                        >
                                            <Edit2 size={14} />
                                        </button>
                                        <button
                                            onClick={() => handleDeleteCustom(provider.id)}
                                            className="p-1.5 rounded-lg text-text-secondary hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                            title="Delete"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

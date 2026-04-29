import { contextBridge, ipcRenderer } from "electron"
// sensi M1 Step 4: shared provider-status type. Imported via relative path
// because the electron bundle is transpile-only (no path-alias rewriting at
// runtime). The renderer reaches the same type via the `@providers/types`
// Vite alias — see vite.config.mts.
import type { ProviderId, ProviderStatus } from "./providers/types"

// Types for the exposed Electron API
interface ElectronAPI {
  updateContentDimensions: (dimensions: {
    width: number
    height: number
  }) => Promise<void>
  getRecognitionLanguages: () => Promise<Record<string, any>>
  getScreenshots: () => Promise<Array<{ path: string; preview: string }>>
  deleteScreenshot: (
    path: string
  ) => Promise<{ success: boolean; error?: string }>
  onScreenshotTaken: (
    callback: (data: { path: string; preview: string }) => void
  ) => () => void
  onScreenshotAttached: (
    callback: (data: { path: string; preview: string }) => void
  ) => () => void
  onCaptureAndProcess: (
    callback: (data: { path: string; preview: string }) => void
  ) => () => void
  onSolutionsReady: (callback: (solutions: string) => void) => () => void
  onResetView: (callback: () => void) => () => void
  onSolutionStart: (callback: () => void) => () => void
  onDebugStart: (callback: () => void) => () => void
  onDebugSuccess: (callback: (data: any) => void) => () => void
  onSolutionError: (callback: (error: string) => void) => () => void
  onProcessingNoScreenshots: (callback: () => void) => () => void
  onProblemExtracted: (callback: (data: any) => void) => () => void
  onSolutionSuccess: (callback: (data: any) => void) => () => void

  onUnauthorized: (callback: () => void) => () => void
  onDebugError: (callback: (error: string) => void) => () => void
  takeScreenshot: () => Promise<void>
  takeSelectiveScreenshot: () => Promise<{ path: string; preview: string; cancelled?: boolean }>
  moveWindowLeft: () => Promise<void>
  moveWindowRight: () => Promise<void>
  moveWindowUp: () => Promise<void>
  moveWindowDown: () => Promise<void>
  windowMinimize: () => Promise<void>
  windowMaximize: () => Promise<void>
  windowClose: () => Promise<void>
  windowIsMaximized: () => Promise<boolean>

  analyzeImageFile: (path: string) => Promise<void>
  quitApp: () => Promise<void>

  // LLM Model Management
  getCurrentLlmConfig: () => Promise<{ provider: "ollama" | "gemini"; model: string; isOllama: boolean }>
  getAvailableOllamaModels: () => Promise<string[]>
  switchToOllama: (model?: string, url?: string) => Promise<{ success: boolean; error?: string }>
  switchToGemini: (apiKey?: string, modelId?: string) => Promise<{ success: boolean; error?: string }>
  testLlmConnection: (provider: 'gemini' | 'groq' | 'openai' | 'claude', apiKey?: string) => Promise<{ success: boolean; error?: string }>
  selectServiceAccount: () => Promise<{ success: boolean; path?: string; cancelled?: boolean; error?: string }>

  // API Key Management
  setGeminiApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setGroqApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setOpenaiApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setClaudeApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setNativelyApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>

  // sensi M1 Step 4 — typed multi-provider key vault surface.
  // See electron/providers/types.ts for the ProviderStatus shape.
  // All four entries are non-bare-boolean per DECISIONS.md D007.
  getConfiguredProviders: () => Promise<ProviderStatus[]>
  setActiveProviderAndModel: (provider: ProviderId, model: string) => Promise<ProviderStatus>
  getActiveProviderAndModel: () => Promise<{ provider: ProviderId | null; model: string | null }>
  onLlmActiveChanged: (callback: (payload: { provider: ProviderId; model: string }) => void) => () => void
  getNativelyUsage: () => Promise<{ ok: boolean; plan?: string; quota?: { transcription: { used: number; limit: number; remaining: number }; ai: { used: number; limit: number; remaining: number }; search: { used: number; limit: number; remaining: number }; resets_at: string }; member_since?: string; error?: string; status?: number }>
  getStoredCredentials: () => Promise<{ hasGeminiKey: boolean; hasGroqKey: boolean; hasOpenaiKey: boolean; hasClaudeKey: boolean; hasNativelyKey: boolean; googleServiceAccountPath: string | null; sttProvider: string; hasSttGroqKey: boolean; hasSttOpenaiKey: boolean; hasDeepgramKey: boolean; hasElevenLabsKey: boolean; hasAzureKey: boolean; azureRegion: string; hasIbmWatsonKey: boolean; ibmWatsonRegion: string; hasSonioxKey: boolean; hasTavilyKey?: boolean }>
  // Free Trial
  startTrial:     () => Promise<{ ok: boolean; trial_token?: string; started_at?: string; expires_at?: string; expired?: boolean; already_used?: boolean; converted_to?: string | null; usage?: { ai: number; stt_seconds: number; search: number }; limits?: { duration_ms: number; ai_requests: number; stt_minutes: number; search_requests: number }; error?: string; status?: number }>
  getTrialStatus: () => Promise<{ ok: boolean; expired?: boolean; remaining_ms?: number; started_at?: string; expires_at?: string; converted_to?: string | null; usage?: { ai: number; stt_seconds: number; search: number }; limits?: object; error?: string }>
  getLocalTrial:  () => Promise<{ hasToken: boolean; expiresAt?: string; startedAt?: string; expired?: boolean }>
  convertTrial:   (choice: string) => Promise<{ ok: boolean }>
  endTrialByok:   () => Promise<{ success: boolean; error?: string }>
  onTrialEnded:   (cb: (data: { choice: string }) => void) => () => void

  // STT Provider Management
  setSttProvider: (provider: 'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'natively') => Promise<{ success: boolean; error?: string }>
  getSttProvider: () => Promise<string>
  setGroqSttApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setOpenAiSttApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setDeepgramApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setElevenLabsApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setAzureApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setAzureRegion: (region: string) => Promise<{ success: boolean; error?: string }>
  setIbmWatsonApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setGroqSttModel: (model: string) => Promise<{ success: boolean; error?: string }>
  setSonioxApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setIbmWatsonRegion: (region: string) => Promise<{ success: boolean; error?: string }>
  testSttConnection: (provider: 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox', apiKey: string, region?: string) => Promise<{ success: boolean; error?: string }>

  // STT Config Events
  onSttConfigChanged: (callback: (data: { configured: boolean; provider: string }) => void) => () => void
  onCredentialsChanged: (callback: () => void) => () => void

  // Native Audio Service Events
  onNativeAudioTranscript: (callback: (transcript: { speaker: string; text: string; final: boolean }) => void) => () => void
  onNativeAudioSuggestion: (callback: (suggestion: { context: string; lastQuestion: string; confidence: number }) => void) => () => void
  onNativeAudioConnected: (callback: () => void) => () => void
  onNativeAudioDisconnected: (callback: () => void) => () => void
  onSuggestionGenerated: (callback: (data: { question: string; suggestion: string; confidence: number }) => void) => () => void
  onSuggestionProcessingStart: (callback: () => void) => () => void
  onSuggestionError: (callback: (error: { error: string }) => void) => () => void
  generateSuggestion: (context: string, lastQuestion: string) => Promise<{ suggestion: string }>
  getInputDevices: () => Promise<Array<{ id: string; name: string }>>
  getOutputDevices: () => Promise<Array<{ id: string; name: string }>>
  setRecognitionLanguage: (key: string) => Promise<{ success: boolean; error?: string }>
  getAiResponseLanguages: () => Promise<Array<{ label: string; code: string }>>
  setAiResponseLanguage: (language: string) => Promise<{ success: boolean; error?: string }>
  getSttLanguage: () => Promise<string>
  getAiResponseLanguage: () => Promise<string>
  onSttLanguageAutoDetected: (callback: (bcp47: string) => void) => () => void
  onSystemAudioPermissionDenied: (callback: (message: string) => void) => () => void

  // Intelligence Mode IPC
  generateAssist: () => Promise<{ insight: string | null }>
  generateWhatToSay: (question?: string, imagePaths?: string[]) => Promise<{ answer: string | null; question?: string; error?: string }>
  generateFollowUp: (intent: string, userRequest?: string) => Promise<{ refined: string | null; intent: string }>
  generateRecap: () => Promise<{ summary: string | null }>
  submitManualQuestion: (question: string) => Promise<{ answer: string | null; question: string }>
  getIntelligenceContext: () => Promise<{ context: string; lastAssistantMessage: string | null; activeMode: string }>
  resetIntelligence: () => Promise<{ success: boolean; error?: string }>

  // Meeting Lifecycle
  startMeeting: (metadata?: any) => Promise<{ success: boolean; error?: string }>
  endMeeting: () => Promise<{ success: boolean; error?: string }>
  finalizeMicSTT: () => Promise<void>
  getRecentMeetings: () => Promise<Array<{ id: string; title: string; date: string; duration: string; summary: string }>>
  getMeetingDetails: (id: string) => Promise<any>
  updateMeetingTitle: (id: string, title: string) => Promise<boolean>
  updateMeetingSummary: (id: string, updates: { overview?: string, actionItems?: string[], keyPoints?: string[], actionItemsTitle?: string, keyPointsTitle?: string }) => Promise<boolean>
  onMeetingsUpdated: (callback: () => void) => () => void

  // Intelligence Mode Events
  onIntelligenceAssistUpdate: (callback: (data: { insight: string }) => void) => () => void
  onIntelligenceSuggestedAnswer: (callback: (data: { answer: string; question: string; confidence: number }) => void) => () => void
  onIntelligenceRefinedAnswer: (callback: (data: { answer: string; intent: string }) => void) => () => void
  onIntelligenceRecap: (callback: (data: { summary: string }) => void) => () => void
  onIntelligenceClarify: (callback: (data: { clarification: string }) => void) => () => void
  onIntelligenceClarifyToken: (callback: (data: { token: string }) => void) => () => void
  onIntelligenceManualStarted: (callback: () => void) => () => void
  onIntelligenceManualResult: (callback: (data: { answer: string; question: string }) => void) => () => void
  onIntelligenceModeChanged: (callback: (data: { mode: string }) => void) => () => void
  onIntelligenceError: (callback: (data: { error: string; mode: string }) => void) => () => void

  // Model Management
  getDefaultModel: () => Promise<{ model: string }>
  setModel: (modelId: string) => Promise<{ success: boolean; error?: string }>
  setDefaultModel: (modelId: string) => Promise<{ success: boolean; error?: string }>
  toggleModelSelector: (coords: { x: number; y: number }) => Promise<void>
  forceRestartOllama: () => Promise<void>

  // Settings Window
  toggleSettingsWindow: (coords?: { x: number; y: number }) => Promise<void>

  // Groq Fast Text Mode
  getGroqFastTextMode: () => Promise<{ enabled: boolean }>
  setGroqFastTextMode: (enabled: boolean) => Promise<{ success: boolean; error?: string }>

  // Demo
  seedDemo: () => Promise<{ success: boolean }>

  // Custom Providers
  saveCustomProvider: (provider: any) => Promise<{ success: boolean; id?: string; error?: string }>
  getCustomProviders: () => Promise<any[]>
  deleteCustomProvider: (id: string) => Promise<{ success: boolean; error?: string }>

  // Follow-up Email
  generateFollowupEmail: (input: any) => Promise<string>
  extractEmailsFromTranscript: (transcript: Array<{ text: string }>) => Promise<string[]>
  openMailto: (params: { to: string; subject: string; body: string }) => Promise<{ success: boolean; error?: string }>

  // Audio Test
  startAudioTest: (deviceId?: string) => Promise<{ success: boolean }>
  stopAudioTest: () => Promise<{ success: boolean }>
  onAudioTestLevel: (callback: (level: number) => void) => () => void

  // Database
  flushDatabase: () => Promise<{ success: boolean }>
  showWindow: () => Promise<void>
  hideWindow: () => Promise<void>
  showOverlay: () => Promise<void>
  hideOverlay: () => Promise<void>
  getMeetingActive: () => Promise<boolean>
  onMeetingStateChanged: (callback: (data: { isActive: boolean }) => void) => () => void
  onWindowMaximizedChanged: (callback: (isMaximized: boolean) => void) => () => void
  onEnsureExpanded: (callback: () => void) => () => void
  onToggleExpand: (callback: () => void) => () => void
  toggleAdvancedSettings: () => Promise<void>
  setOverlayMousePassthrough: (enabled: boolean) => Promise<{ success: boolean }>
  toggleOverlayMousePassthrough: () => Promise<{ success: boolean; enabled: boolean }>
  getOverlayMousePassthrough: () => Promise<boolean>
  onOverlayMousePassthroughChanged: (callback: (enabled: boolean) => void) => () => void

  // Streaming listeners
  streamGeminiChat: (message: string, imagePaths?: string[], context?: string, options?: { skipSystemPrompt?: boolean, ignoreKnowledgeMode?: boolean }) => Promise<void>
  onGeminiStreamToken: (callback: (token: string) => void) => () => void
  onGeminiStreamDone: (callback: () => void) => () => void
  onGeminiStreamError: (callback: (error: string) => void) => () => void


  onUndetectableChanged: (callback: (state: boolean) => void) => () => void
  onGroqFastTextChanged: (callback: (enabled: boolean) => void) => () => void
  onModelChanged: (callback: (modelId: string) => void) => () => void

  // Ollama
  onOllamaPullProgress: (callback: (data: { status: string; percent: number }) => void) => () => void
  onOllamaPullComplete: (callback: () => void) => () => void

  // Theme API
  getThemeMode: () => Promise<{ mode: 'system' | 'light' | 'dark', resolved: 'light' | 'dark' }>
  setThemeMode: (mode: 'system' | 'light' | 'dark') => Promise<void>
  onThemeChanged: (callback: (data: { mode: 'system' | 'light' | 'dark', resolved: 'light' | 'dark' }) => void) => () => void

  getOnlineAssessmentModeEnabled: () => Promise<boolean>
  setOnlineAssessmentModeEnabled: (enabled: boolean) => Promise<{ success: boolean; error?: string }>
  onOnlineAssessmentModeChanged: (callback: (enabled: boolean) => void) => () => void

  // Auto-Update
  onUpdateAvailable: (callback: (info: any) => void) => () => void
  onUpdateDownloaded: (callback: (info: any) => void) => () => void
  onUpdateChecking: (callback: () => void) => () => void
  onUpdateNotAvailable: (callback: (info: any) => void) => () => void
  onUpdateError: (callback: (err: string) => void) => () => void
  onDownloadProgress: (callback: (progressObj: any) => void) => () => void
  restartAndInstall: () => Promise<void>
  checkForUpdates: () => Promise<void>
  downloadUpdate: () => Promise<void>
  testReleaseFetch: () => Promise<{ success: boolean; error?: string }>

  // RAG (Retrieval-Augmented Generation) API
  ragQueryMeeting: (meetingId: string, query: string) => Promise<{ success?: boolean; fallback?: boolean; error?: string }>
  ragQueryLive: (query: string) => Promise<{ success?: boolean; fallback?: boolean; error?: string }>
  ragQueryGlobal: (query: string) => Promise<{ success?: boolean; fallback?: boolean; error?: string }>
  ragCancelQuery: (options: { meetingId?: string; global?: boolean }) => Promise<{ success: boolean }>
  ragIsMeetingProcessed: (meetingId: string) => Promise<boolean>
  ragGetQueueStatus: () => Promise<{ pending: number; processing: number; completed: number; failed: number }>
  ragRetryEmbeddings: () => Promise<{ success: boolean }>
  onRAGStreamChunk: (callback: (data: { meetingId?: string; global?: boolean; chunk: string }) => void) => () => void
  onRAGStreamComplete: (callback: (data: { meetingId?: string; global?: boolean }) => void) => () => void
  onRAGStreamError: (callback: (data: { meetingId?: string; global?: boolean; error: string }) => void) => () => void

  // Keybind Management
  getKeybinds: () => Promise<Array<{ id: string; label: string; accelerator: string; isGlobal: boolean; defaultAccelerator: string }>>
  setKeybind: (id: string, accelerator: string) => Promise<boolean>
  resetKeybinds: () => Promise<Array<{ id: string; label: string; accelerator: string; isGlobal: boolean; defaultAccelerator: string }>>
  onKeybindsUpdate: (callback: (keybinds: Array<any>) => void) => () => void

  // Global shortcut events (stealth: fired even when window is not focused)
  onGlobalShortcut: (callback: (data: { action: string }) => void) => () => void

  // Donation API
  getDonationStatus: () => Promise<{ shouldShow: boolean; hasDonated: boolean; lifetimeShows: number }>;
  markDonationToastShown: () => Promise<{ success: boolean }>;
  setDonationComplete: () => Promise<{ success: boolean }>;

  // Profile Engine API
  profileUploadResume: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  profileGetStatus: () => Promise<{ hasProfile: boolean; profileMode: boolean; name?: string; role?: string; totalExperienceYears?: number }>;
  profileSetMode: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  profileDelete: () => Promise<{ success: boolean; error?: string }>;
  profileGetProfile: () => Promise<any>;
  profileSelectFile: () => Promise<{ success?: boolean; cancelled?: boolean; filePath?: string; error?: string }>;

  // JD & Research API
  profileUploadJD: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  profileDeleteJD: () => Promise<{ success: boolean; error?: string }>;
  profileResearchCompany: (companyName: string) => Promise<{ success: boolean; dossier?: any; error?: string }>;
  profileGenerateNegotiation: (force?: boolean) => Promise<{ success: boolean; script?: any; error?: string }>;
  profileGetNegotiationState: () => Promise<{ success: boolean; state?: any; isActive?: boolean; error?: string }>;
  profileResetNegotiation: () => Promise<{ success: boolean; error?: string }>;

  // Tavily Search API
  setTavilyApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;

  // sensi M7 / RESEARCH-01: Standalone research
  // sensi M8 / PASS B — sensi-cloud auth
  authSignIn: () => Promise<{ success: boolean; error?: string }>;
  authSignOut: () => Promise<{ success: boolean; error?: string }>;
  authGetState: () => Promise<{ success: boolean; state?: unknown; error?: string }>;
  authRefreshMe: () => Promise<{ success: boolean; me?: unknown; error?: string }>;
  authOpenCheckout: () => Promise<{ success: boolean; error?: string }>;
  authOpenPortal: () => Promise<{ success: boolean; error?: string }>;

  // MEMORY-01 (v2.17.0) — cross-meeting memory engine
  memoryGetEnabled: () => Promise<{ enabled: boolean }>;
  memorySetEnabled: (enabled: boolean) => Promise<{ success: boolean }>;
  memoryGetQueueSize: () => Promise<{ pending: number }>;
  memoryPurge: () => Promise<{ success: boolean; deleted?: number; error?: string }>;

  // PERF-03 (v2.17.0) — low-resource mode
  perfGetProfile: () => Promise<{
    cores: number;
    gbRam: number;
    autoIsLowResource: boolean;
    autoReason: string | null;
    currentLowResource: boolean;
  }>;
  perfSetLowResource: (enabled: boolean) => Promise<{ success: boolean }>;

  onAuthStateChanged: (callback: (state: unknown) => void) => () => void;

  researchRun: (query: string, scope?: 'company' | 'general') => Promise<{
    success: boolean;
    brief?: string;
    query?: string;
    scope?: 'company' | 'general';
    sources?: Array<{ title: string; url: string }>;
    error?: string;
  }>;

  // Overlay Opacity (Stealth Mode)
  setOverlayOpacity: (opacity: number) => Promise<void>;
  onOverlayOpacityChanged: (callback: (opacity: number) => void) => () => void;

  // Verbose / Debug Logging
  getVerboseLogging: () => Promise<boolean>;
  setVerboseLogging: (enabled: boolean) => Promise<{ success: boolean }>;
  getLogFilePath: () => Promise<string | null>;
  openLogFile: () => Promise<{ success: boolean; error?: string }>;
  
  // Arch
  getArch: () => Promise<string>;

  // Cropper API
  cropperConfirmed: (bounds: Electron.Rectangle) => void;
  cropperCancelled: () => void;
  onResetCropper: (callback: (data: { hudPosition: { x: number; y: number } }) => void) => () => void;

  // Platform
  platform: NodeJS.Platform;

  // M4-T10 — Knowledge export/import. Four channels; see comments
  // on the implementation below and DECISIONS.md D023.
  knowledgeExport?: (filePath: string) => Promise<unknown>;
  knowledgeImport?: (filePath: string) => Promise<unknown>;
  knowledgePickExportPath?: () => Promise<unknown>;
  knowledgePickImportPath?: () => Promise<unknown>;

  // sensi M7 / PERSONA-01 — lightweight resume persona
  personaPickFile?: () => Promise<unknown>;
  personaUploadResume?: (filePath: string) => Promise<unknown>;
  personaGetSummary?: () => Promise<unknown>;
  personaClear?: () => Promise<unknown>;

  // M5-T5 — Rolling-response trigger mode. Two RPCs + one broadcast.
  setRollingTriggerMode?: (mode: 'off' | 'on-silence' | 'on-demand') => Promise<unknown>;
  getRollingTriggerMode?: () => Promise<unknown>;
  setRollingTriggerSilenceMs?: (ms: number) => Promise<{ success: boolean; silenceMs?: number; error?: string }>;
  getRollingTriggerSilenceMs?: () => Promise<number>;
  onRollingTriggerModeChanged?: (callback: (mode: 'off' | 'on-silence' | 'on-demand') => void) => () => void;
}

export const PROCESSING_EVENTS = {
  //global states
  UNAUTHORIZED: "procesing-unauthorized",
  NO_SCREENSHOTS: "processing-no-screenshots",

  //states for generating the initial solution
  INITIAL_START: "initial-start",
  PROBLEM_EXTRACTED: "problem-extracted",
  SOLUTION_SUCCESS: "solution-success",
  INITIAL_SOLUTION_ERROR: "solution-error",

  //states for processing the debugging
  DEBUG_START: "debug-start",
  DEBUG_SUCCESS: "debug-success",
  DEBUG_ERROR: "debug-error"
} as const

// Expose the Electron API to the renderer process
contextBridge.exposeInMainWorld("electronAPI", {
  updateContentDimensions: (dimensions: { width: number; height: number }) =>
    ipcRenderer.invoke("update-content-dimensions", dimensions),
  getRecognitionLanguages: () => ipcRenderer.invoke("get-recognition-languages"),
  takeScreenshot: () => ipcRenderer.invoke("take-screenshot"),
  takeSelectiveScreenshot: () => ipcRenderer.invoke("take-selective-screenshot"),
  getScreenshots: () => ipcRenderer.invoke("get-screenshots"),
  deleteScreenshot: (path: string) =>
    ipcRenderer.invoke("delete-screenshot", path),

  // Event listeners
  onScreenshotTaken: (
    callback: (data: { path: string; preview: string }) => void
  ) => {
    const subscription = (_: any, data: { path: string; preview: string }) =>
      callback(data)
    ipcRenderer.on("screenshot-taken", subscription)
    return () => {
      ipcRenderer.removeListener("screenshot-taken", subscription)
    }
  },
  onScreenshotAttached: (
    callback: (data: { path: string; preview: string }) => void
  ) => {
    const subscription = (_: any, data: { path: string; preview: string }) =>
      callback(data)
    ipcRenderer.on("screenshot-attached", subscription)
    return () => {
      ipcRenderer.removeListener("screenshot-attached", subscription)
    }
  },
  onCaptureAndProcess: (
    callback: (data: { path: string; preview: string }) => void
  ) => {
    const subscription = (_: any, data: { path: string; preview: string }) =>
      callback(data)
    ipcRenderer.on("capture-and-process", subscription)
    return () => {
      ipcRenderer.removeListener("capture-and-process", subscription)
    }
  },
  onSolutionsReady: (callback: (solutions: string) => void) => {
    const subscription = (_: any, solutions: string) => callback(solutions)
    ipcRenderer.on("solutions-ready", subscription)
    return () => {
      ipcRenderer.removeListener("solutions-ready", subscription)
    }
  },
  onResetView: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("reset-view", subscription)
    return () => {
      ipcRenderer.removeListener("reset-view", subscription)
    }
  },
  onSolutionStart: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.INITIAL_START, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.INITIAL_START, subscription)
    }
  },
  onDebugStart: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.DEBUG_START, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.DEBUG_START, subscription)
    }
  },

  onDebugSuccess: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("debug-success", subscription)
    return () => {
      ipcRenderer.removeListener("debug-success", subscription)
    }
  },
  onDebugError: (callback: (error: string) => void) => {
    const subscription = (_: any, error: string) => callback(error)
    ipcRenderer.on(PROCESSING_EVENTS.DEBUG_ERROR, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.DEBUG_ERROR, subscription)
    }
  },
  onSolutionError: (callback: (error: string) => void) => {
    const subscription = (_: any, error: string) => callback(error)
    ipcRenderer.on(PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, subscription)
    return () => {
      ipcRenderer.removeListener(
        PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
        subscription
      )
    }
  },
  onProcessingNoScreenshots: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.NO_SCREENSHOTS, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.NO_SCREENSHOTS, subscription)
    }
  },

  onProblemExtracted: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on(PROCESSING_EVENTS.PROBLEM_EXTRACTED, subscription)
    return () => {
      ipcRenderer.removeListener(
        PROCESSING_EVENTS.PROBLEM_EXTRACTED,
        subscription
      )
    }
  },
  onSolutionSuccess: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on(PROCESSING_EVENTS.SOLUTION_SUCCESS, subscription)
    return () => {
      ipcRenderer.removeListener(
        PROCESSING_EVENTS.SOLUTION_SUCCESS,
        subscription
      )
    }
  },
  onUnauthorized: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.UNAUTHORIZED, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.UNAUTHORIZED, subscription)
    }
  },
  moveWindowLeft: () => ipcRenderer.invoke("move-window-left"),
  moveWindowRight: () => ipcRenderer.invoke("move-window-right"),
  moveWindowUp: () => ipcRenderer.invoke("move-window-up"),
  moveWindowDown: () => ipcRenderer.invoke("move-window-down"),
  windowMinimize: () => ipcRenderer.invoke("window-minimize"),
  windowMaximize: () => ipcRenderer.invoke("window-maximize"),
  windowClose: () => ipcRenderer.invoke("window-close"),
  windowIsMaximized: () => ipcRenderer.invoke("window-is-maximized"),

  analyzeImageFile: (path: string) => ipcRenderer.invoke("analyze-image-file", path),
  quitApp: () => ipcRenderer.invoke("quit-app"),
  toggleWindow: () => ipcRenderer.invoke("toggle-window"),
  showWindow: (inactive?: boolean) => ipcRenderer.invoke("show-window", inactive),
  hideWindow: () => ipcRenderer.invoke("hide-window"),
  showOverlay: () => ipcRenderer.invoke("show-overlay"),
  hideOverlay: () => ipcRenderer.invoke("hide-overlay"),
  getMeetingActive: () => ipcRenderer.invoke("get-meeting-active"),
  onMeetingStateChanged: (callback: (data: { isActive: boolean }) => void) => {
    const subscription = (_: any, data: { isActive: boolean }) => callback(data);
    ipcRenderer.on('meeting-state-changed', subscription);
    return () => { ipcRenderer.removeListener('meeting-state-changed', subscription); };
  },
  onWindowMaximizedChanged: (callback: (isMaximized: boolean) => void) => {
    const subscription = (_: any, isMaximized: boolean) => callback(isMaximized);
    ipcRenderer.on('window-maximized-changed', subscription);
    return () => { ipcRenderer.removeListener('window-maximized-changed', subscription); };
  },
  onEnsureExpanded: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('ensure-expanded', subscription);
    return () => { ipcRenderer.removeListener('ensure-expanded', subscription); };
  },
  toggleAdvancedSettings: () => ipcRenderer.invoke("toggle-advanced-settings"),
  openExternal: (url: string) => ipcRenderer.invoke("open-external", url),
  setUndetectable: (state: boolean) => ipcRenderer.invoke("set-undetectable", state),
  getUndetectable: () => ipcRenderer.invoke("get-undetectable"),
  // v2.16.2: returns { capability: 'full'|'partial'|'unsupported', warning?: string }
  getStealthCapability: () => ipcRenderer.invoke("get-stealth-capability"),
  // v2.16.2: triggers a self-capture of the screen; saves PNG to Desktop and opens Explorer there.
  stealthSelfCapture: () => ipcRenderer.invoke("stealth:self-capture"),
  setOverlayMousePassthrough: (enabled: boolean) => ipcRenderer.invoke("set-overlay-mouse-passthrough", enabled),
  toggleOverlayMousePassthrough: () => ipcRenderer.invoke("toggle-overlay-mouse-passthrough"),
  getOverlayMousePassthrough: () => ipcRenderer.invoke("get-overlay-mouse-passthrough"),
  setOpenAtLogin: (open: boolean) => ipcRenderer.invoke("set-open-at-login", open),
  getOpenAtLogin: () => ipcRenderer.invoke("get-open-at-login"),
  onSettingsVisibilityChange: (callback: (isVisible: boolean) => void) => {
    const subscription = (_: any, isVisible: boolean) => callback(isVisible)
    ipcRenderer.on("settings-visibility-changed", subscription)
    return () => {
      ipcRenderer.removeListener("settings-visibility-changed", subscription)
    }
  },

  onToggleExpand: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("toggle-expand", subscription)
    return () => {
      ipcRenderer.removeListener("toggle-expand", subscription)
    }
  },

  // LLM Model Management
  getCurrentLlmConfig: () => ipcRenderer.invoke("get-current-llm-config"),
  getAvailableOllamaModels: () => ipcRenderer.invoke("get-available-ollama-models"),
  switchToOllama: (model?: string, url?: string) => ipcRenderer.invoke("switch-to-ollama", model, url),
  switchToGemini: (apiKey?: string, modelId?: string) => ipcRenderer.invoke("switch-to-gemini", apiKey, modelId),
  testLlmConnection: (provider: 'gemini' | 'groq' | 'openai' | 'claude', apiKey: string) => ipcRenderer.invoke("test-llm-connection", provider, apiKey),
  selectServiceAccount: () => ipcRenderer.invoke("select-service-account"),

  // API Key Management
  setGeminiApiKey: (apiKey: string) => ipcRenderer.invoke("set-gemini-api-key", apiKey),
  setGroqApiKey: (apiKey: string) => ipcRenderer.invoke("set-groq-api-key", apiKey),
  setOpenaiApiKey: (apiKey: string) => ipcRenderer.invoke("set-openai-api-key", apiKey),
  setClaudeApiKey: (apiKey: string) => ipcRenderer.invoke("set-claude-api-key", apiKey),
  setNativelyApiKey: (apiKey: string) => ipcRenderer.invoke("set-natively-api-key", apiKey),

  // sensi M1 Step 4 — typed provider+model vault bindings.
  getConfiguredProviders: () => ipcRenderer.invoke("llm:get-configured-providers"),
  setActiveProviderAndModel: (provider: ProviderId, model: string) =>
    ipcRenderer.invoke("llm:set-active-provider-and-model", provider, model),
  getActiveProviderAndModel: () => ipcRenderer.invoke("llm:get-active-provider-and-model"),
  onLlmActiveChanged: (callback: (payload: { provider: ProviderId; model: string }) => void) => {
    const subscription = (_event: any, payload: { provider: ProviderId; model: string }) => callback(payload);
    ipcRenderer.on("llm-active-changed", subscription);
    return () => {
      ipcRenderer.removeListener("llm-active-changed", subscription);
    };
  },
  getNativelyUsage: () => ipcRenderer.invoke("get-natively-usage"),
  getStoredCredentials: () => ipcRenderer.invoke("get-stored-credentials"),

  // Permissions
  checkPermissions:    () => ipcRenderer.invoke("permissions:check"),
  requestMicPermission: () => ipcRenderer.invoke("permissions:request-mic"),

  // Free Trial
  startTrial:       () => ipcRenderer.invoke("trial:start"),
  getTrialStatus:   () => ipcRenderer.invoke("trial:status"),
  getLocalTrial:    () => ipcRenderer.invoke("trial:get-local"),
  convertTrial:     (choice: string) => ipcRenderer.invoke("trial:convert", choice),
  endTrialByok:        () => ipcRenderer.invoke("trial:end-byok"),
  wipeTrialProfileData: () => ipcRenderer.invoke("trial:wipe-profile-data"),
  onTrialEnded:     (cb: (data: { choice: string }) => void) => {
    const sub = (_: any, data: any) => cb(data);
    ipcRenderer.on('trial-ended', sub);
    return () => ipcRenderer.removeListener('trial-ended', sub);
  },

  // STT Provider Management
  setSttProvider: (provider: 'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'natively') => ipcRenderer.invoke("set-stt-provider", provider),
  getSttProvider: () => ipcRenderer.invoke("get-stt-provider"),
  setGroqSttApiKey: (apiKey: string) => ipcRenderer.invoke("set-groq-stt-api-key", apiKey),
  setOpenAiSttApiKey: (apiKey: string) => ipcRenderer.invoke("set-openai-stt-api-key", apiKey),
  setDeepgramApiKey: (apiKey: string) => ipcRenderer.invoke("set-deepgram-api-key", apiKey),
  setElevenLabsApiKey: (apiKey: string) => ipcRenderer.invoke("set-elevenlabs-api-key", apiKey),
  setAzureApiKey: (apiKey: string) => ipcRenderer.invoke("set-azure-api-key", apiKey),
  setAzureRegion: (region: string) => ipcRenderer.invoke("set-azure-region", region),
  setIbmWatsonApiKey: (apiKey: string) => ipcRenderer.invoke("set-ibmwatson-api-key", apiKey),
  setGroqSttModel: (model: string) => ipcRenderer.invoke("set-groq-stt-model", model),
  setSonioxApiKey: (apiKey: string) => ipcRenderer.invoke("set-soniox-api-key", apiKey),
  setIbmWatsonRegion: (region: string) => ipcRenderer.invoke("set-ibmwatson-region", region),
  testSttConnection: (provider: 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox', apiKey: string, region?: string) => ipcRenderer.invoke("test-stt-connection", provider, apiKey, region),

  // STT Config Events (Adapted from public PR #173 — verify premium interaction)
  onSttConfigChanged: (callback: (data: { configured: boolean; provider: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('stt-config-changed', subscription);
    return () => { ipcRenderer.removeListener('stt-config-changed', subscription); };
  },
  onCredentialsChanged: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('credentials-changed', subscription);
    return () => { ipcRenderer.removeListener('credentials-changed', subscription); };
  },

  // Native Audio Service Events
  onNativeAudioTranscript: (callback: (transcript: { speaker: string; text: string; final: boolean }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("native-audio-transcript", subscription)
    return () => {
      ipcRenderer.removeListener("native-audio-transcript", subscription)
    }
  },
  onNativeAudioSuggestion: (callback: (suggestion: { context: string; lastQuestion: string; confidence: number }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("native-audio-suggestion", subscription)
    return () => {
      ipcRenderer.removeListener("native-audio-suggestion", subscription)
    }
  },
  onNativeAudioConnected: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("native-audio-connected", subscription)
    return () => {
      ipcRenderer.removeListener("native-audio-connected", subscription)
    }
  },
  onNativeAudioDisconnected: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("native-audio-disconnected", subscription)
    return () => {
      ipcRenderer.removeListener("native-audio-disconnected", subscription)
    }
  },
  onSuggestionGenerated: (callback: (data: { question: string; suggestion: string; confidence: number }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("suggestion-generated", subscription)
    return () => {
      ipcRenderer.removeListener("suggestion-generated", subscription)
    }
  },
  onSuggestionProcessingStart: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("suggestion-processing-start", subscription)
    return () => {
      ipcRenderer.removeListener("suggestion-processing-start", subscription)
    }
  },
  onSuggestionError: (callback: (error: { error: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("suggestion-error", subscription)
    return () => {
      ipcRenderer.removeListener("suggestion-error", subscription)
    }
  },
  generateSuggestion: (context: string, lastQuestion: string) =>
    ipcRenderer.invoke("generate-suggestion", context, lastQuestion),

  getNativeAudioStatus: () => ipcRenderer.invoke("native-audio-status"),
  getInputDevices: () => ipcRenderer.invoke("get-input-devices"),
  getOutputDevices: () => ipcRenderer.invoke("get-output-devices"),
  setRecognitionLanguage: (key: string) => ipcRenderer.invoke("set-recognition-language", key),
  getAiResponseLanguages: () => ipcRenderer.invoke("get-ai-response-languages"),
  setAiResponseLanguage: (language: string) => ipcRenderer.invoke("set-ai-response-language", language),
  getSttLanguage: () => ipcRenderer.invoke("get-stt-language"),
  getAiResponseLanguage: () => ipcRenderer.invoke("get-ai-response-language"),
  onSttLanguageAutoDetected: (callback: (bcp47: string) => void) => {
    const subscription = (_: any, bcp47: string) => callback(bcp47);
    ipcRenderer.on('stt-language-auto-detected', subscription);
    return () => { ipcRenderer.removeListener('stt-language-auto-detected', subscription); };
  },
  onSystemAudioPermissionDenied: (callback: (message: string) => void) => {
    const subscription = (_: any, message: string) => callback(message);
    ipcRenderer.on('system-audio-permission-denied', subscription);
    return () => { ipcRenderer.removeListener('system-audio-permission-denied', subscription); };
  },

  // Intelligence Mode IPC
  generateAssist: () => ipcRenderer.invoke("generate-assist"),
  generateWhatToSay: (question?: string, imagePaths?: string[]) => ipcRenderer.invoke("generate-what-to-say", question, imagePaths),
  generateClarify: () => ipcRenderer.invoke("generate-clarify"),
  generateCodeHint: (imagePaths?: string[], problemStatement?: string) => ipcRenderer.invoke("generate-code-hint", imagePaths, problemStatement),
  generateBrainstorm: (imagePaths?: string[], problemStatement?: string) => ipcRenderer.invoke("generate-brainstorm", imagePaths, problemStatement),
  generateFollowUp: (intent: string, userRequest?: string) => ipcRenderer.invoke("generate-follow-up", intent, userRequest),
  generateFollowUpQuestions: () => ipcRenderer.invoke("generate-follow-up-questions"),
  generateRecap: () => ipcRenderer.invoke("generate-recap"),
  submitManualQuestion: (question: string) => ipcRenderer.invoke("submit-manual-question", question),
  getIntelligenceContext: () => ipcRenderer.invoke("get-intelligence-context"),
  resetIntelligence: () => ipcRenderer.invoke("reset-intelligence"),

  // Action Button Mode (Dynamic Recap / Brainstorm toggle)
  getActionButtonMode: () => ipcRenderer.invoke("get-action-button-mode"),
  setActionButtonMode: (mode: 'recap' | 'brainstorm') => ipcRenderer.invoke("set-action-button-mode", mode),
  onActionButtonModeChanged: (callback: (mode: 'recap' | 'brainstorm') => void) => {
    const subscription = (_: any, mode: 'recap' | 'brainstorm') => callback(mode);
    ipcRenderer.on('action-button-mode-changed', subscription);
    return () => { ipcRenderer.removeListener('action-button-mode-changed', subscription); };
  },

  // Meeting Lifecycle
  startMeeting: (metadata?: any) => ipcRenderer.invoke("start-meeting", metadata),
  endMeeting: () => ipcRenderer.invoke("end-meeting"),
  finalizeMicSTT: () => ipcRenderer.invoke("finalize-mic-stt"),
  getRecentMeetings: () => ipcRenderer.invoke("get-recent-meetings"),
  getMeetingDetails: (id: string) => ipcRenderer.invoke("get-meeting-details", id),
  updateMeetingTitle: (id: string, title: string) => ipcRenderer.invoke("update-meeting-title", { id, title }),
  updateMeetingSummary: (id: string, updates: any) => ipcRenderer.invoke("update-meeting-summary", { id, updates }),
  deleteMeeting: (id: string) => ipcRenderer.invoke("delete-meeting", id),

  onMeetingsUpdated: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("meetings-updated", subscription)
    return () => {
      ipcRenderer.removeListener("meetings-updated", subscription)
    }
  },

  // Window Mode
  setWindowMode: (mode: 'launcher' | 'overlay', inactive?: boolean) => ipcRenderer.invoke("set-window-mode", mode, inactive),

  // Intelligence Mode Events
  onIntelligenceAssistUpdate: (callback: (data: { insight: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("intelligence-assist-update", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence-assist-update", subscription)
    }
  },
  onIntelligenceSuggestedAnswerToken: (callback: (data: { token: string; question: string; confidence: number }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("intelligence-suggested-answer-token", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence-suggested-answer-token", subscription)
    }
  },
  onIntelligenceSuggestedAnswer: (callback: (data: { answer: string; question: string; confidence: number }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("intelligence-suggested-answer", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence-suggested-answer", subscription)
    }
  },
  onIntelligenceRefinedAnswerToken: (callback: (data: { token: string; intent: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("intelligence-refined-answer-token", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence-refined-answer-token", subscription)
    }
  },
  onIntelligenceRefinedAnswer: (callback: (data: { answer: string; intent: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("intelligence-refined-answer", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence-refined-answer", subscription)
    }
  },
  onIntelligenceRecapToken: (callback: (data: { token: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("intelligence-recap-token", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence-recap-token", subscription)
    }
  },
  onIntelligenceRecap: (callback: (data: { summary: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("intelligence-recap", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence-recap", subscription)
    }
  },
  onIntelligenceClarifyToken: (callback: (data: { token: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("intelligence-clarify-token", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence-clarify-token", subscription)
    }
  },
  onIntelligenceClarify: (callback: (data: { clarification: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("intelligence-clarify", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence-clarify", subscription)
    }
  },
  onIntelligenceFollowUpQuestionsToken: (callback: (data: { token: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("intelligence-follow-up-questions-token", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence-follow-up-questions-token", subscription)
    }
  },
  onIntelligenceFollowUpQuestionsUpdate: (callback: (data: { questions: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("intelligence-follow-up-questions-update", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence-follow-up-questions-update", subscription)
    }
  },
  onIntelligenceManualStarted: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("intelligence-manual-started", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence-manual-started", subscription)
    }
  },
  onIntelligenceManualResult: (callback: (data: { answer: string; question: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("intelligence-manual-result", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence-manual-result", subscription)
    }
  },
  onIntelligenceModeChanged: (callback: (data: { mode: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("intelligence-mode-changed", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence-mode-changed", subscription)
    }
  },
  onIntelligenceError: (callback: (data: { error: string; mode: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("intelligence-error", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence-error", subscription)
    }
  },
  onSessionReset: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("session-reset", subscription)
    return () => {
      ipcRenderer.removeListener("session-reset", subscription)
    }
  },

  // v2.15.0: fired when the rolling auto-answer is cancelled mid-stream
  // because the interviewer started speaking again. Renderer swaps the
  // "thinking…" indicator for "listening…" and waits for the next
  // UtteranceEnd-driven re-fire.
  onRollingStreamCancelled: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("rolling-stream-cancelled", subscription)
    return () => {
      ipcRenderer.removeListener("rolling-stream-cancelled", subscription)
    }
  },


  // Streaming Chat
  streamGeminiChat: (message: string, imagePaths?: string[], context?: string, options?: { skipSystemPrompt?: boolean, ignoreKnowledgeMode?: boolean }) => ipcRenderer.invoke("gemini-chat-stream", message, imagePaths, context, options),

  onGeminiStreamToken: (callback: (token: string) => void) => {
    const subscription = (_: any, token: string) => callback(token)
    ipcRenderer.on("gemini-stream-token", subscription)
    return () => {
      ipcRenderer.removeListener("gemini-stream-token", subscription)
    }
  },

  onGeminiStreamDone: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("gemini-stream-done", subscription)
    return () => {
      ipcRenderer.removeListener("gemini-stream-done", subscription)
    }
  },

  onGeminiStreamError: (callback: (error: string) => void) => {
    const subscription = (_: any, error: string) => callback(error)
    ipcRenderer.on("gemini-stream-error", subscription)
    return () => {
      ipcRenderer.removeListener("gemini-stream-error", subscription)
    }
  },

  // Model Management
  getDefaultModel: () => ipcRenderer.invoke('get-default-model'),
  setModel: (modelId: string) => ipcRenderer.invoke('set-model', modelId),
  setDefaultModel: (modelId: string) => ipcRenderer.invoke('set-default-model', modelId),
  toggleModelSelector: (coords: { x: number; y: number }) => ipcRenderer.invoke('toggle-model-selector', coords),
  forceRestartOllama: () => ipcRenderer.invoke('force-restart-ollama'),

  // Settings Window
  toggleSettingsWindow: (coords?: { x: number; y: number }) => ipcRenderer.invoke('toggle-settings-window', coords),

  // Groq Fast Text Mode
  getGroqFastTextMode: () => ipcRenderer.invoke('get-groq-fast-text-mode'),
  setGroqFastTextMode: (enabled: boolean) => ipcRenderer.invoke('set-groq-fast-text-mode', enabled),

  // Demo
  seedDemo: () => ipcRenderer.invoke('seed-demo'),

  // Custom Providers
  saveCustomProvider: (provider: any) => ipcRenderer.invoke('save-custom-provider', provider),
  getCustomProviders: () => ipcRenderer.invoke('get-custom-providers'),
  deleteCustomProvider: (id: string) => ipcRenderer.invoke('delete-custom-provider', id),

  // Follow-up Email
  generateFollowupEmail: (input: any) => ipcRenderer.invoke('generate-followup-email', input),
  extractEmailsFromTranscript: (transcript: Array<{ text: string }>) => ipcRenderer.invoke('extract-emails-from-transcript', transcript),
  openMailto: (params: { to: string; subject: string; body: string }) => ipcRenderer.invoke('open-mailto', params),

  // Audio Test
  startAudioTest: (deviceId?: string) => ipcRenderer.invoke('start-audio-test', deviceId),
  stopAudioTest: () => ipcRenderer.invoke('stop-audio-test'),
  onAudioTestLevel: (callback: (level: number) => void) => {
    const subscription = (_: any, level: number) => callback(level)
    ipcRenderer.on('audio-test-level', subscription)
    return () => {
      ipcRenderer.removeListener('audio-test-level', subscription)
    }
  },

  // Database
  flushDatabase: () => ipcRenderer.invoke('flush-database'),



  onUndetectableChanged: (callback: (state: boolean) => void) => {
    const subscription = (_: any, state: boolean) => callback(state)
    ipcRenderer.on('undetectable-changed', subscription)
    return () => {
      ipcRenderer.removeListener('undetectable-changed', subscription)
    }
  },

  onOverlayMousePassthroughChanged: (callback: (enabled: boolean) => void) => {
    const subscription = (_: any, enabled: boolean) => callback(enabled)
    ipcRenderer.on('overlay-mouse-passthrough-changed', subscription)
    return () => {
      ipcRenderer.removeListener('overlay-mouse-passthrough-changed', subscription)
    }
  },

  onGroqFastTextChanged: (callback: (enabled: boolean) => void) => {
    const subscription = (_: any, enabled: boolean) => callback(enabled)
    ipcRenderer.on('groq-fast-text-changed', subscription)
    return () => {
      ipcRenderer.removeListener('groq-fast-text-changed', subscription)
    }
  },

  onModelChanged: (callback: (modelId: string) => void) => {
    const subscription = (_: any, modelId: string) => callback(modelId)
    ipcRenderer.on('model-changed', subscription)
    return () => {
      ipcRenderer.removeListener('model-changed', subscription)
    }
  },

  onOllamaPullProgress: (callback: (data: { status: string; percent: number }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on('ollama:pull-progress', subscription)
    return () => {
      ipcRenderer.removeListener('ollama:pull-progress', subscription)
    }
  },

  onOllamaPullComplete: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on('ollama:pull-complete', subscription)
    return () => {
      ipcRenderer.removeListener('ollama:pull-complete', subscription)
    }
  },

  // Theme API
  getThemeMode: () => ipcRenderer.invoke('theme:get-mode'),
  setThemeMode: (mode: 'system' | 'light' | 'dark') => ipcRenderer.invoke('theme:set-mode', mode),
  onThemeChanged: (callback: (data: { mode: 'system' | 'light' | 'dark', resolved: 'light' | 'dark' }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on('theme:changed', subscription)
    return () => {
      ipcRenderer.removeListener('theme:changed', subscription)
    }
  },

  getOnlineAssessmentModeEnabled: () => ipcRenderer.invoke('get-online-assessment-mode-enabled'),
  setOnlineAssessmentModeEnabled: (enabled: boolean) => ipcRenderer.invoke('set-online-assessment-mode-enabled', enabled),
  onOnlineAssessmentModeChanged: (callback: (enabled: boolean) => void) => {
    const subscription = (_: any, enabled: boolean) => callback(!!enabled);
    ipcRenderer.on('online-assessment-mode-changed', subscription);
    return () => {
      ipcRenderer.removeListener('online-assessment-mode-changed', subscription);
    };
  },

  // Auto-Update
  onUpdateAvailable: (callback: (info: any) => void) => {
    const subscription = (_: any, info: any) => callback(info)
    ipcRenderer.on("update-available", subscription)
    return () => {
      ipcRenderer.removeListener("update-available", subscription)
    }
  },
  onUpdateDownloaded: (callback: (info: any) => void) => {
    const subscription = (_: any, info: any) => callback(info)
    ipcRenderer.on("update-downloaded", subscription)
    return () => {
      ipcRenderer.removeListener("update-downloaded", subscription)
    }
  },
  onUpdateChecking: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("update-checking", subscription)
    return () => {
      ipcRenderer.removeListener("update-checking", subscription)
    }
  },
  onUpdateNotAvailable: (callback: (info: any) => void) => {
    const subscription = (_: any, info: any) => callback(info)
    ipcRenderer.on("update-not-available", subscription)
    return () => {
      ipcRenderer.removeListener("update-not-available", subscription)
    }
  },
  onUpdateError: (callback: (err: string) => void) => {
    const subscription = (_: any, err: string) => callback(err)
    ipcRenderer.on("update-error", subscription)
    return () => {
      ipcRenderer.removeListener("update-error", subscription)
    }
  },
  onDownloadProgress: (callback: (progressObj: any) => void) => {
    const subscription = (_: any, progressObj: any) => callback(progressObj)
    ipcRenderer.on("download-progress", subscription)
    return () => {
      ipcRenderer.removeListener("download-progress", subscription)
    }
  },
  restartAndInstall: () => ipcRenderer.invoke("quit-and-install-update"),
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  downloadUpdate: () => ipcRenderer.invoke("download-update"),
  testReleaseFetch: () => ipcRenderer.invoke("test-release-fetch"),

  // RAG API
  ragQueryMeeting: (meetingId: string, query: string) => ipcRenderer.invoke('rag:query-meeting', { meetingId, query }),
  ragQueryLive: (query: string) => ipcRenderer.invoke('rag:query-live', { query }),
  ragQueryGlobal: (query: string) => ipcRenderer.invoke('rag:query-global', { query }),
  ragCancelQuery: (options: { meetingId?: string; global?: boolean }) => ipcRenderer.invoke('rag:cancel-query', options),
  ragIsMeetingProcessed: (meetingId: string) => ipcRenderer.invoke('rag:is-meeting-processed', meetingId),
  ragGetQueueStatus: () => ipcRenderer.invoke('rag:get-queue-status'),
  ragRetryEmbeddings: () => ipcRenderer.invoke('rag:retry-embeddings'),
  
  onIncompatibleProviderWarning: (callback: (data: { count: number, oldProvider: string, newProvider: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on('embedding:incompatible-provider-warning', subscription)
    return () => {
      ipcRenderer.removeListener('embedding:incompatible-provider-warning', subscription)
    }
  },
  reindexIncompatibleMeetings: () => ipcRenderer.invoke('rag:reindex-incompatible-meetings'),

  onRAGStreamChunk: (callback: (data: { meetingId?: string; global?: boolean; chunk: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on('rag:stream-chunk', subscription)
    return () => {
      ipcRenderer.removeListener('rag:stream-chunk', subscription)
    }
  },
  onRAGStreamComplete: (callback: (data: { meetingId?: string; global?: boolean }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on('rag:stream-complete', subscription)
    return () => {
      ipcRenderer.removeListener('rag:stream-complete', subscription)
    }
  },
  onRAGStreamError: (callback: (data: { meetingId?: string; global?: boolean; error: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on('rag:stream-error', subscription)
    return () => {
      ipcRenderer.removeListener('rag:stream-error', subscription)
    }
  },

  // Keybind Management
  getKeybinds: () => ipcRenderer.invoke('keybinds:get-all'),
  setKeybind: (id: string, accelerator: string) => ipcRenderer.invoke('keybinds:set', id, accelerator),
  resetKeybinds: () => ipcRenderer.invoke('keybinds:reset'),
  onKeybindsUpdate: (callback: (keybinds: Array<any>) => void) => {
    const subscription = (_: any, keybinds: any) => callback(keybinds)
    ipcRenderer.on('keybinds:update', subscription)
    return () => {
      ipcRenderer.removeListener('keybinds:update', subscription)
    }
  },
  onKeybindRegistrationFailed: (callback: (data: { id: string; accelerator: string }) => void) => {
    const subscription = (_: any, data: { id: string; accelerator: string }) => callback(data)
    ipcRenderer.on('keybinds:registration-failed', subscription)
    return () => {
      ipcRenderer.removeListener('keybinds:registration-failed', subscription)
    }
  },

  // Global shortcut listener — fired stealthily from main process without focusing the window
  onGlobalShortcut: (callback: (data: { action: string }) => void) => {
    const subscription = (_: any, data: { action: string }) => callback(data)
    ipcRenderer.on('global-shortcut', subscription)
    return () => {
      ipcRenderer.removeListener('global-shortcut', subscription)
    }
  },

  // Donation API
  getDonationStatus: () => ipcRenderer.invoke("get-donation-status"),
  markDonationToastShown: () => ipcRenderer.invoke("mark-donation-toast-shown"),
  setDonationComplete: () => ipcRenderer.invoke('set-donation-complete'),

  // Profile Engine API
  profileUploadResume: (filePath: string) => ipcRenderer.invoke('profile:upload-resume', filePath),
  profileGetStatus: () => ipcRenderer.invoke('profile:get-status'),
  profileSetMode: (enabled: boolean) => ipcRenderer.invoke('profile:set-mode', enabled),
  profileDelete: () => ipcRenderer.invoke('profile:delete'),
  profileGetProfile: () => ipcRenderer.invoke('profile:get-profile'),
  profileSelectFile: () => ipcRenderer.invoke('profile:select-file'),

  // JD & Research API
  profileUploadJD: (filePath: string) => ipcRenderer.invoke('profile:upload-jd', filePath),
  profileDeleteJD: () => ipcRenderer.invoke('profile:delete-jd'),
  profileResearchCompany: (companyName: string) => ipcRenderer.invoke('profile:research-company', companyName),
  profileGenerateNegotiation: (force?: boolean) => ipcRenderer.invoke('profile:generate-negotiation', force),
  profileGetNegotiationState: () => ipcRenderer.invoke('profile:get-negotiation-state'),
  profileResetNegotiation: () => ipcRenderer.invoke('profile:reset-negotiation'),

  // Tavily Search API
  setTavilyApiKey: (apiKey: string) => ipcRenderer.invoke('set-tavily-api-key', apiKey),

  // sensi M7 / RESEARCH-01: Standalone research (Tavily -> LLM brief)
  researchRun: (query: string, scope?: 'company' | 'general') => ipcRenderer.invoke('research:run', query, scope ?? 'general'),

  // sensi M8 / PASS B (v2.13.0): sensi-cloud auth
  authSignIn: () => ipcRenderer.invoke('auth:sign-in'),
  authSignOut: () => ipcRenderer.invoke('auth:sign-out'),
  authGetState: () => ipcRenderer.invoke('auth:get-state'),
  authRefreshMe: () => ipcRenderer.invoke('auth:refresh-me'),
  authOpenCheckout: () => ipcRenderer.invoke('auth:open-checkout'),
  authOpenPortal: () => ipcRenderer.invoke('auth:open-portal'),

  // MEMORY-01 (v2.17.0) — cross-meeting memory engine
  memoryGetEnabled: () => ipcRenderer.invoke('memory:get-enabled'),
  memorySetEnabled: (enabled: boolean) => ipcRenderer.invoke('memory:set-enabled', enabled),
  memoryGetQueueSize: () => ipcRenderer.invoke('memory:get-queue-size'),
  memoryPurge: () => ipcRenderer.invoke('memory:purge'),

  // PERF-03 (v2.17.0) — low-resource mode
  perfGetProfile: () => ipcRenderer.invoke('perf:get-profile'),
  perfSetLowResource: (enabled: boolean) => ipcRenderer.invoke('perf:set-low-resource', enabled),
  // PERF-04 (v2.18.0) — live broadcast so renderers can flip animations etc. without restart.
  onLowResourceModeChanged: (callback: (enabled: boolean) => void) => {
    const sub = (_: unknown, enabled: boolean) => callback(!!enabled);
    ipcRenderer.on('low-resource-mode-changed', sub);
    return () => ipcRenderer.removeListener('low-resource-mode-changed', sub);
  },

  onAuthStateChanged: (callback: (state: unknown) => void) => {
    const sub = (_: unknown, state: unknown) => callback(state);
    ipcRenderer.on('auth-state-changed', sub);
    return () => ipcRenderer.removeListener('auth-state-changed', sub);
  },

  // Dynamic Model Discovery
  fetchProviderModels: (provider: 'gemini' | 'groq' | 'openai' | 'claude', apiKey: string) => ipcRenderer.invoke('fetch-provider-models', provider, apiKey),
  setProviderPreferredModel: (provider: 'gemini' | 'groq' | 'openai' | 'claude', modelId: string) => ipcRenderer.invoke('set-provider-preferred-model', provider, modelId),

  // License Management
  licenseActivate: (key: string) => ipcRenderer.invoke('license:activate', key),
  licenseCheckPremium: () => ipcRenderer.invoke('license:check-premium'),
  licenseGetDetails: () => ipcRenderer.invoke('license:get-details'),
  licenseCheckPremiumAsync: () => ipcRenderer.invoke('license:check-premium-async'),
  licenseDeactivate: () => ipcRenderer.invoke('license:deactivate'),
  licenseGetHardwareId: () => ipcRenderer.invoke('license:get-hardware-id'),
  onLicenseStatusChanged: (callback: (data: { isPremium: boolean, plan?: string }) => void) => {
    const subscription = (_: any, data: { isPremium: boolean, plan?: string }) => callback(data);
    ipcRenderer.on('license-status-changed', subscription);
    return () => {
      ipcRenderer.removeListener('license-status-changed', subscription);
    };
  },

  // Overlay Opacity (Stealth Mode)
  setOverlayOpacity: (opacity: number) => ipcRenderer.invoke('set-overlay-opacity', opacity),
  onOverlayOpacityChanged: (callback: (opacity: number) => void) => {
    const subscription = (_: any, opacity: number) => callback(opacity)
    ipcRenderer.on('overlay-opacity-changed', subscription)
    return () => {
      ipcRenderer.removeListener('overlay-opacity-changed', subscription)
    }
  },

  // Verbose / Debug Logging
  getVerboseLogging: () => ipcRenderer.invoke('get-verbose-logging'),
  setVerboseLogging: (enabled: boolean) => ipcRenderer.invoke('set-verbose-logging', enabled),
  getLogFilePath: () => ipcRenderer.invoke('get-log-file-path'),
  openLogFile: () => ipcRenderer.invoke('open-log-file'),
  
  // Arch
  getArch: () => ipcRenderer.invoke('get-arch'),

  // Cropper API
  cropperConfirmed: (bounds: Electron.Rectangle) => ipcRenderer.send('cropper-confirmed', bounds),
  cropperCancelled: () => ipcRenderer.send('cropper-cancelled'),
  onResetCropper: (callback: (data: { hudPosition: { x: number; y: number } }) => void) => {
    const subscription = (_: Electron.IpcRendererEvent, data: { hudPosition: { x: number; y: number } }) => callback(data)
    ipcRenderer.on('reset-cropper', subscription)
    return () => {
      ipcRenderer.removeListener('reset-cropper', subscription)
    }
  },

  // Platform
  platform: process.platform,

  // sensi M4-T8 — Knowledge base (eight narrow typed channels).
  // These mirror the eight public methods of the M4-T6
  // KnowledgeOrchestrator 1:1, except getDocumentText which is
  // replaced by the bounded `knowledgeGetDocumentPreview` handler.
  // Raw unbounded document text is never exposed to the renderer.
  // See DECISIONS.md D021.
  knowledgeIngestDocument: (filePath: string) =>
    ipcRenderer.invoke('knowledge-ingest-document', filePath),
  knowledgeListDocuments: () =>
    ipcRenderer.invoke('knowledge-list-documents'),
  knowledgeDeleteDocument: (id: string) =>
    ipcRenderer.invoke('knowledge-delete-document', id),
  knowledgePinDocument: (id: string) =>
    ipcRenderer.invoke('knowledge-pin-document', id),
  knowledgeUnpinDocument: (id: string) =>
    ipcRenderer.invoke('knowledge-unpin-document', id),
  knowledgeListPinned: () =>
    ipcRenderer.invoke('knowledge-list-pinned'),
  knowledgeQuery: (payload: {
    query: string;
    topK: number;
    includePinned?: boolean;
    documentIds?: string[];
  }) => ipcRenderer.invoke('knowledge-query', payload),
  knowledgeGetDocumentPreview: (id: string, maxChars?: number) =>
    ipcRenderer.invoke('knowledge-get-document-preview', id, maxChars),

  // sensi M4-T10 — Knowledge base export/import (four channels total).
  // Renderer calls the pick-* helpers to open a save/open dialog in
  // main (paths stay on the main side), then calls export/import with
  // the returned filePath. Separation of dialog from IO keeps the
  // transfer module pure and DI-testable.
  knowledgeExport: (filePath: string) =>
    ipcRenderer.invoke('knowledge-export', filePath),
  knowledgeImport: (filePath: string) =>
    ipcRenderer.invoke('knowledge-import', filePath),
  knowledgePickExportPath: () =>
    ipcRenderer.invoke('knowledge-pick-export-path'),
  knowledgePickImportPath: () =>
    ipcRenderer.invoke('knowledge-pick-import-path'),

  // sensi M7 / PERSONA-01 — lightweight resume persona
  personaPickFile: () => ipcRenderer.invoke('persona:pick-file'),
  personaUploadResume: (filePath: string) => ipcRenderer.invoke('persona:upload-resume', filePath),
  personaGetSummary: () => ipcRenderer.invoke('persona:get-summary'),
  personaClear: () => ipcRenderer.invoke('persona:clear'),

  // sensi M5-T5 — Rolling-response trigger mode (two channels, persisted via SettingsManager)
  setRollingTriggerMode: (mode: 'off' | 'on-silence' | 'on-demand') =>
    ipcRenderer.invoke('set-rolling-trigger-mode', mode),
  getRollingTriggerMode: () =>
    ipcRenderer.invoke('get-rolling-trigger-mode'),
  // v2.14.8 — auto-answer sensitivity (silence threshold in ms)
  setRollingTriggerSilenceMs: (ms: number) =>
    ipcRenderer.invoke('set-rolling-trigger-silence-ms', ms),
  getRollingTriggerSilenceMs: () =>
    ipcRenderer.invoke('get-rolling-trigger-silence-ms'),
  onRollingTriggerModeChanged: (
    callback: (mode: 'off' | 'on-silence' | 'on-demand') => void
  ) => {
    const listener = (_e: any, data: { mode: 'off' | 'on-silence' | 'on-demand' }) => callback(data.mode);
    ipcRenderer.on('rolling-trigger-mode-changed', listener);
    return () => {
      ipcRenderer.removeListener('rolling-trigger-mode-changed', listener);
    };
  },
} as ElectronAPI)

// Renderer-side console forwarding to main-process log file.
// When verbose logging is on, patch console.log/warn/error so that renderer
// output appears in ~/Documents/sensi_debug.log alongside main-process logs.
;(function patchRendererConsole() {
  let _verbose = false;

  const _origLog = console.log.bind(console);
  const _origWarn = console.warn.bind(console);
  const _origError = console.error.bind(console);

  function serialize(...args: any[]): string {
    return args.map(a => {
      if (a instanceof Error) return a.stack || a.message;
      if (typeof a === 'object') { try { return JSON.stringify(a); } catch { return String(a); } }
      return String(a);
    }).join(' ');
  }

  console.log = (...args: any[]) => {
    _origLog(...args);
    if (_verbose) ipcRenderer.send('forward-log-to-file', 'log', serialize(...args));
  };
  console.warn = (...args: any[]) => {
    _origWarn(...args);
    if (_verbose) ipcRenderer.send('forward-log-to-file', 'warn', serialize(...args));
  };
  console.error = (...args: any[]) => {
    _origError(...args);
    if (_verbose) ipcRenderer.send('forward-log-to-file', 'error', serialize(...args));
  };

  // Sync verbose flag from main process at startup
  ipcRenderer.invoke('get-verbose-logging').then((v: boolean) => { _verbose = v; }).catch(() => {});

  // Keep flag in sync when the user toggles verbose in settings
  ipcRenderer.on('verbose-logging-changed', (_event: any, enabled: boolean) => {
    _verbose = enabled;
  });
})()

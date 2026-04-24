// sensi M1 Step 4 — typed provider status shared with the main process.
// Imported via the @providers Vite alias (see vite.config.mts + tsconfig paths).
import type { ProviderId, ProviderStatus } from '@providers/types'

export interface ElectronAPI {
  updateContentDimensions: (dimensions: {
    width: number
    height: number
  }) => Promise<void>
  onToggleExpand: (callback: () => void) => () => void
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
  takeScreenshot: () => Promise<{ path: string; preview: string }>
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
  toggleWindow: () => Promise<void>
  showWindow: (inactive?: boolean) => Promise<void>
  hideWindow: () => Promise<void>
  showOverlay: () => Promise<void>
  hideOverlay: () => Promise<void>
  getMeetingActive: () => Promise<boolean>
  onMeetingStateChanged: (callback: (data: { isActive: boolean }) => void) => () => void
  onWindowMaximizedChanged: (callback: (isMaximized: boolean) => void) => () => void
  onEnsureExpanded: (callback: () => void) => () => void
  openExternal: (url: string) => Promise<void>
  setUndetectable: (state: boolean) => Promise<{ success: boolean; error?: string }>
  getUndetectable: () => Promise<boolean>
  setOverlayMousePassthrough: (enabled: boolean) => Promise<{ success: boolean }>
  toggleOverlayMousePassthrough: () => Promise<{ success: boolean; enabled: boolean }>
  getOverlayMousePassthrough: () => Promise<boolean>
  onOverlayMousePassthroughChanged: (callback: (enabled: boolean) => void) => () => void
  setDisguise: (mode: 'terminal' | 'settings' | 'activity' | 'none') => Promise<{ success: boolean; error?: string }>
  getDisguise: () => Promise<'none' | 'terminal' | 'settings' | 'activity'>
  onDisguiseChanged: (callback: (mode: 'terminal' | 'settings' | 'activity' | 'none') => void) => () => void
  setOpenAtLogin: (open: boolean) => Promise<{ success: boolean; error?: string }>
  getOpenAtLogin: () => Promise<boolean>
  onSettingsVisibilityChange: (callback: (isVisible: boolean) => void) => () => void
  toggleSettingsWindow: (coords?: { x: number; y: number }) => Promise<void>
  closeSettingsWindow: () => Promise<void>
  toggleAdvancedSettings: () => Promise<void>
  closeAdvancedSettings: () => Promise<void>

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
  // Never bare booleans — see DECISIONS.md D007.
  getConfiguredProviders: () => Promise<ProviderStatus[]>
  setActiveProviderAndModel: (provider: ProviderId, model: string) => Promise<ProviderStatus>
  getActiveProviderAndModel: () => Promise<{ provider: ProviderId | null; model: string | null }>
  onLlmActiveChanged: (callback: (payload: { provider: ProviderId; model: string }) => void) => () => void
  getNativelyUsage: () => Promise<{ ok: boolean; error?: string; plan?: string; quota?: { transcription: { used: number; limit: number; remaining: number }; ai: { used: number; limit: number; remaining: number }; search: { used: number; limit: number; remaining: number }; resets_at: string }; member_since?: string }>
  getStoredCredentials: () => Promise<{ hasNativelyKey?: boolean; hasGeminiKey: boolean; hasGroqKey: boolean; hasOpenaiKey: boolean; hasClaudeKey: boolean; googleServiceAccountPath: string | null; sttProvider: 'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'natively'; hasSttGroqKey: boolean; hasSttOpenaiKey: boolean; hasDeepgramKey: boolean; hasElevenLabsKey: boolean; hasAzureKey: boolean; azureRegion: string; hasIbmWatsonKey: boolean; ibmWatsonRegion: string; groqSttModel?: string; hasSonioxKey?: boolean; hasTavilyKey?: boolean; geminiPreferredModel?: string; groqPreferredModel?: string; openaiPreferredModel?: string; claudePreferredModel?: string; sttGroqKey?: string; sttOpenaiKey?: string; sttDeepgramKey?: string; sttElevenLabsKey?: string; sttAzureKey?: string; sttIbmKey?: string; sttSonioxKey?: string }>
  // Permissions
  checkPermissions:     () => Promise<{ microphone: 'granted'|'denied'|'not-determined'|'restricted'; screen: 'granted'|'denied'|'not-determined'|'restricted'; platform: string }>
  requestMicPermission: () => Promise<boolean>

  // Free Trial
  startTrial:     () => Promise<{ ok: boolean; trial_token?: string; started_at?: string; expires_at?: string; expired?: boolean; already_used?: boolean; converted_to?: string | null; usage?: { ai: number; stt_seconds: number; search: number }; limits?: { duration_ms: number; ai_requests: number; stt_minutes: number; search_requests: number }; error?: string; status?: number }>
  getTrialStatus: () => Promise<{ ok: boolean; expired?: boolean; remaining_ms?: number; started_at?: string; expires_at?: string; converted_to?: string | null; usage?: { ai: number; stt_seconds: number; search: number }; limits?: object; error?: string }>
  getLocalTrial:  () => Promise<{ hasToken: boolean; expiresAt?: string; startedAt?: string; expired?: boolean }>
  convertTrial:   (choice: string) => Promise<{ ok: boolean }>
  endTrialByok:        () => Promise<{ success: boolean; error?: string }>
  wipeTrialProfileData: () => Promise<{ success: boolean; error?: string }>
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

  // STT Config Events (fired when STT provider/key changes during a meeting)
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

  getNativeAudioStatus: () => Promise<{ connected: boolean }>

  // Intelligence Mode IPC
  generateAssist: () => Promise<{ insight: string | null }>
  generateWhatToSay: (question?: string, imagePaths?: string[]) => Promise<{ answer: string | null; question?: string; error?: string }>
  generateClarify: () => Promise<{ clarification: string | null }>
  generateCodeHint: (imagePaths?: string[], problemStatement?: string) => Promise<{ hint: string | null }>
  generateBrainstorm: (imagePaths?: string[], problemStatement?: string) => Promise<{ script: string | null }>
  generateFollowUp: (intent: string, userRequest?: string) => Promise<{ refined: string | null; intent: string }>
  generateFollowUpQuestions: () => Promise<{ questions: string | null }>
  generateRecap: () => Promise<{ summary: string | null }>
  submitManualQuestion: (question: string) => Promise<{ answer: string | null; question: string }>
  getIntelligenceContext: () => Promise<{ context: string; lastAssistantMessage: string | null; activeMode: string }>
  resetIntelligence: () => Promise<{ success: boolean; error?: string }>

  // Dynamic Action Button Mode
  getActionButtonMode: () => Promise<'recap' | 'brainstorm'>
  setActionButtonMode: (mode: 'recap' | 'brainstorm') => Promise<{ success: boolean }>
  onActionButtonModeChanged: (callback: (mode: 'recap' | 'brainstorm') => void) => () => void

  // Meeting Lifecycle
  startMeeting: (metadata?: any) => Promise<{ success: boolean; error?: string }>
  endMeeting: () => Promise<{ success: boolean; error?: string }>
  finalizeMicSTT: () => Promise<void>
  getRecentMeetings: () => Promise<Array<{ id: string; title: string; date: string; duration: string; summary: string }>>
  getMeetingDetails: (id: string) => Promise<any>
  updateMeetingTitle: (id: string, title: string) => Promise<boolean>
  updateMeetingSummary: (id: string, updates: { overview?: string, actionItems?: string[], keyPoints?: string[], actionItemsTitle?: string, keyPointsTitle?: string }) => Promise<boolean>
  deleteMeeting: (id: string) => Promise<boolean>
  setWindowMode: (mode: 'launcher' | 'overlay', inactive?: boolean) => Promise<void>

  // Intelligence Mode Events
  onIntelligenceAssistUpdate: (callback: (data: { insight: string }) => void) => () => void
  onIntelligenceSuggestedAnswerToken: (callback: (data: { token: string; question: string; confidence: number }) => void) => () => void
  onIntelligenceSuggestedAnswer: (callback: (data: { answer: string; question: string; confidence: number }) => void) => () => void
  onIntelligenceRefinedAnswerToken: (callback: (data: { token: string; intent: string }) => void) => () => void
  onIntelligenceRefinedAnswer: (callback: (data: { answer: string; intent: string }) => void) => () => void
  onIntelligenceFollowUpQuestionsUpdate: (callback: (data: { questions: string }) => void) => () => void
  onIntelligenceFollowUpQuestionsToken: (callback: (data: { token: string }) => void) => () => void
  onIntelligenceRecap: (callback: (data: { summary: string }) => void) => () => void
  onIntelligenceRecapToken: (callback: (data: { token: string }) => void) => () => void
  onIntelligenceClarify: (callback: (data: { clarification: string }) => void) => () => void
  onIntelligenceClarifyToken: (callback: (data: { token: string }) => void) => () => void
  onIntelligenceManualStarted: (callback: () => void) => () => void
  onIntelligenceManualResult: (callback: (data: { answer: string; question: string }) => void) => () => void
  onIntelligenceModeChanged: (callback: (data: { mode: string }) => void) => () => void
  onIntelligenceError: (callback: (data: { error: string, mode: string }) => void) => () => void;
  // Session Management
  onSessionReset: (callback: () => void) => () => void;
  // v2.15.0: cancel-on-speech notifier. Fires when the rolling stream
  // is aborted because the interviewer resumed speaking mid-answer.
  onRollingStreamCancelled: (callback: () => void) => () => void;

  // Streaming listeners
  streamGeminiChat: (message: string, imagePaths?: string[], context?: string, options?: { skipSystemPrompt?: boolean, ignoreKnowledgeMode?: boolean }) => Promise<void>
  onGeminiStreamToken: (callback: (token: string) => void) => () => void
  onGeminiStreamDone: (callback: () => void) => () => void
  onGeminiStreamError: (callback: (error: string) => void) => () => void;

  // Model Management
  getDefaultModel: () => Promise<{ model: string }>;
  setModel: (modelId: string) => Promise<{ success: boolean; error?: string }>;
  setDefaultModel: (modelId: string) => Promise<{ success: boolean; error?: string }>;
  toggleModelSelector: (coords: { x: number; y: number }) => Promise<void>;
  forceRestartOllama: () => Promise<void>;

  // Settings Window
  toggleSettingsWindow: (coords?: { x: number; y: number }) => Promise<void>;

  // Groq Fast Text Mode
  getGroqFastTextMode: () => Promise<{ enabled: boolean }>;
  setGroqFastTextMode: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;

  // Demo
  seedDemo: () => Promise<{ success: boolean }>;

  // Custom Providers
  saveCustomProvider: (provider: any) => Promise<{ success: boolean; id?: string; error?: string }>;
  getCustomProviders: () => Promise<any[]>;
  deleteCustomProvider: (id: string) => Promise<{ success: boolean; error?: string }>;

  // Follow-up Email
  generateFollowupEmail: (input: any) => Promise<string>;
  extractEmailsFromTranscript: (transcript: Array<{ text: string }>) => Promise<string[]>;
  getCalendarAttendees: (eventId: string) => Promise<Array<{ email: string; name: string }>>;
  openMailto: (params: { to: string; subject: string; body: string }) => Promise<{ success: boolean; error?: string }>;

  // Audio Test
  startAudioTest: (deviceId?: string) => Promise<{ success: boolean }>;
  stopAudioTest: () => Promise<{ success: boolean }>;
  onAudioTestLevel: (callback: (level: number) => void) => () => void;

  // Database
  flushDatabase: () => Promise<{ success: boolean }>;

  onUndetectableChanged: (callback: (state: boolean) => void) => () => void;
  onGroqFastTextChanged: (callback: (enabled: boolean) => void) => () => void;
  onModelChanged: (callback: (modelId: string) => void) => () => void;

  onOllamaPullProgress: (callback: (data: { status: string; percent: number }) => void) => () => void;
  onOllamaPullComplete: (callback: () => void) => () => void;

  onMeetingsUpdated: (callback: () => void) => () => void

  // Provider Compatibility
  onIncompatibleProviderWarning: (callback: (data: { count: number, oldProvider: string, newProvider: string }) => void) => () => void;
  reindexIncompatibleMeetings: () => Promise<void>;

  // Theme API
  getThemeMode: () => Promise<{ mode: 'system' | 'light' | 'dark', resolved: 'light' | 'dark' }>
  setThemeMode: (mode: 'system' | 'light' | 'dark') => Promise<void>
  onThemeChanged: (callback: (data: { mode: 'system' | 'light' | 'dark', resolved: 'light' | 'dark' }) => void) => () => void

  // Calendar
  calendarConnect: () => Promise<{ success: boolean; error?: string }>
  calendarDisconnect: () => Promise<{ success: boolean; error?: string }>
  getCalendarStatus: () => Promise<{ connected: boolean; email?: string }>
  getUpcomingEvents: () => Promise<Array<{ id: string; title: string; startTime: string; endTime: string; link?: string; source: 'google' }>>
  calendarRefresh: () => Promise<{ success: boolean; error?: string }>
  getGoogleOauthStatus: () => Promise<{ configured: boolean; maskedClientId: string | null }>
  setGoogleOauthCredentials: (payload: { clientId: string; clientSecret: string }) => Promise<{ success: boolean; error?: string }>
  clearGoogleOauthCredentials: () => Promise<{ success: boolean; error?: string }>

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

  // Donation API
  getDonationStatus: () => Promise<{ shouldShow: boolean; hasDonated: boolean; lifetimeShows: number }>;
  markDonationToastShown: () => Promise<{ success: boolean }>;
  setDonationComplete: () => Promise<{ success: boolean }>;

  // Keybind Management
  getKeybinds: () => Promise<Array<{ id: string; label: string; accelerator: string; isGlobal: boolean; defaultAccelerator: string }>>
  setKeybind: (id: string, accelerator: string) => Promise<boolean>
  resetKeybinds: () => Promise<Array<{ id: string; label: string; accelerator: string; isGlobal: boolean; defaultAccelerator: string }>>
  onKeybindsUpdate: (callback: (keybinds: Array<any>) => void) => () => void
  onKeybindRegistrationFailed: (callback: (data: { id: string; accelerator: string }) => void) => () => void
  onGlobalShortcut: (callback: (data: { action: string }) => void) => () => void

  // Profile Engine API
  profileUploadResume: (filePath: string) => Promise<{ success: boolean; error?: string }>
  profileGetStatus: () => Promise<{ hasProfile: boolean; profileMode: boolean; name?: string; role?: string; totalExperienceYears?: number }>
  profileSetMode: (enabled: boolean) => Promise<{ success: boolean; error?: string }>
  profileDelete: () => Promise<{ success: boolean; error?: string }>
  profileGetProfile: () => Promise<any>
  profileSelectFile: () => Promise<{ success?: boolean; cancelled?: boolean; filePath?: string; error?: string }>

  // JD & Research API
  profileUploadJD: (filePath: string) => Promise<{ success: boolean; error?: string }>
  profileDeleteJD: () => Promise<{ success: boolean; error?: string }>
  profileResearchCompany: (companyName: string) => Promise<{ success: boolean; dossier?: any; error?: string; searchQuotaExhausted?: boolean }>
  profileGenerateNegotiation: (force?: boolean) => Promise<{ success: boolean; script?: any; error?: string }>
  profileGetNegotiationState: () => Promise<{ success: boolean; state?: any; isActive?: boolean; error?: string }>
  profileResetNegotiation: () => Promise<{ success: boolean; error?: string }>

  // Tavily Search API
  setTavilyApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>

  // sensi M8 / PASS B (v2.13.0): sensi-cloud auth
  authSignIn: () => Promise<{ success: true } | { success: false; error: string }>
  authSignOut: () => Promise<{ success: true } | { success: false; error: string }>
  authGetState: () => Promise<
    | { success: true; state: SensiAuthStateIpc }
    | { success: false; error: string }
  >
  authRefreshMe: () => Promise<
    | { success: true; me: SensiMeIpc | null }
    | { success: false; error: string }
  >
  authOpenCheckout: () => Promise<{ success: true } | { success: false; error: string }>
  authOpenPortal: () => Promise<{ success: true } | { success: false; error: string }>

  // MEMORY-01 (v2.17.0) — cross-meeting memory engine
  memoryGetEnabled: () => Promise<{ enabled: boolean }>
  memorySetEnabled: (enabled: boolean) => Promise<{ success: boolean }>
  memoryGetQueueSize: () => Promise<{ pending: number }>
  memoryPurge: () => Promise<{ success: boolean; deleted?: number; error?: string }>

  // PERF-03 (v2.17.0) — low-resource mode
  perfGetProfile: () => Promise<{
    cores: number
    gbRam: number
    autoIsLowResource: boolean
    autoReason: string | null
    currentLowResource: boolean
  }>
  perfSetLowResource: (enabled: boolean) => Promise<{ success: boolean }>

  onAuthStateChanged: (callback: (state: SensiAuthStateIpc) => void) => () => void
  onCalendarConnectionChanged: (
    callback: (status: { connected: boolean; email?: string }) => void,
  ) => () => void

  // sensi M7 / RESEARCH-01: Standalone research
  researchRun: (query: string, scope?: 'company' | 'general') => Promise<{
    success: boolean
    brief?: string
    query?: string
    scope?: 'company' | 'general'
    sources?: Array<{ title: string; url: string }>
    error?: string
  }>

  // Dynamic Model Discovery
  fetchProviderModels: (provider: 'gemini' | 'groq' | 'openai' | 'claude', apiKey: string) => Promise<{ success: boolean; models?: {id: string, label: string}[]; error?: string }>
  setProviderPreferredModel: (provider: 'gemini' | 'groq' | 'openai' | 'claude', modelId: string) => Promise<void>

  // License Management
  licenseActivate: (key: string) => Promise<{ success: boolean; error?: string }>
  licenseCheckPremium: () => Promise<boolean>
  licenseGetDetails: () => Promise<{ isPremium: boolean; plan?: string; provider?: string }>
  /** Async startup check — calls Dodo validate endpoint to detect server-side revocations. */
  licenseCheckPremiumAsync: () => Promise<boolean>
  onLicenseStatusChanged: (callback: (data: { isPremium: boolean, plan?: string }) => void) => () => void
  licenseDeactivate: () => Promise<void>
  licenseGetHardwareId: () => Promise<string>

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
  cropperConfirmed: (bounds: { x: number; y: number; width: number; height: number }) => void;
  cropperCancelled: () => void;
  onResetCropper: (callback: (data: { hudPosition: { x: number; y: number } }) => void) => () => void;

  // Platform
  platform: NodeJS.Platform;

  // sensi M4-T8 — Knowledge base IPC surface.
  // All eight channels use the `{ success: true, ...data } |
  // { success: false, error: string, errorType: KnowledgeIpcErrorType }`
  // discriminated-union result shape (matches existing codebase
  // convention for ipcHandlers). Renderer patterns:
  //   const r = await window.electronAPI.knowledgeListDocuments();
  //   if (r.success) { r.documents.forEach(...) }
  //   else { showError(r.error, r.errorType) }
  knowledgeIngestDocument: (filePath: string) => Promise<
    | {
        success: true;
        documentId: string;
        chunkCount: number;
        embeddingModel: string;
        embeddingProvider: 'ollama' | 'gemini';
      }
    | KnowledgeIpcFailure
  >;
  knowledgeListDocuments: () => Promise<
    | { success: true; documents: KnowledgeDocumentMetadata[] }
    | KnowledgeIpcFailure
  >;
  knowledgeDeleteDocument: (id: string) => Promise<
    { success: true } | KnowledgeIpcFailure
  >;
  knowledgePinDocument: (id: string) => Promise<
    { success: true; pinnedAt: string | null } | KnowledgeIpcFailure
  >;
  knowledgeUnpinDocument: (id: string) => Promise<
    { success: true; pinnedAt: string | null } | KnowledgeIpcFailure
  >;
  knowledgeListPinned: () => Promise<
    | { success: true; documents: KnowledgeDocumentMetadata[] }
    | KnowledgeIpcFailure
  >;
  knowledgeQuery: (payload: {
    query: string;
    topK: number;
    includePinned?: boolean;
    documentIds?: string[];
  }) => Promise<
    | { success: true; hits: KnowledgeRetrievedChunk[] }
    | KnowledgeIpcFailure
  >;
  knowledgeGetDocumentPreview: (
    id: string,
    maxChars?: number
  ) => Promise<
    | { success: true; id: string; text: string; truncated: boolean }
    | KnowledgeIpcFailure
  >;

  // sensi M4-T10 — Knowledge base export/import
  //
  // Four channels: two operations (export/import) and two dialog
  // helpers (pick-export-path / pick-import-path). The renderer
  // owns the two-step flow: pick a path, then invoke the operation.
  // Main-process dialog wrappers keep dialog state out of renderer
  // and match the existing file-picker IPC pattern.
  knowledgeExport: (filePath: string) => Promise<
    | {
        success: true;
        filePath: string;
        documentCount: number;
        chunkCount: number;
      }
    | KnowledgeIpcFailure
  >;
  knowledgeImport: (filePath: string) => Promise<
    | {
        success: true;
        filePath: string;
        replaced: number;
        imported: number;
        chunkCount: number;
        backupPath: string | null;
      }
    | KnowledgeIpcFailure
  >;
  knowledgePickExportPath: () => Promise<
    | { cancelled: true }
    | { cancelled: false; filePath: string; error?: undefined }
    | { cancelled: false; filePath?: undefined; error: string }
  >;
  knowledgePickImportPath: () => Promise<
    | { cancelled: true }
    | { cancelled: false; filePath: string; error?: undefined }
    | { cancelled: false; filePath?: undefined; error: string }
  >;

  // sensi M7 / PERSONA-01 — lightweight resume persona.
  personaPickFile: () => Promise<
    | { cancelled: true; filePath?: undefined }
    | { cancelled: false; filePath: string; error?: undefined }
    | { cancelled: false; filePath?: undefined; error: string }
  >
  personaUploadResume: (filePath: string) => Promise<
    { success: true; summary: PersonaSummaryIpc }
    | { success: false; error: string }
  >
  personaGetSummary: () => Promise<
    { success: true; summary: PersonaSummaryIpc | null }
    | { success: false; error: string }
  >
  personaClear: () => Promise<
    { success: true } | { success: false; error: string }
  >

  // sensi M7 / PERSONA-02 — per-meeting JD binding
  personaPickJDFile: () => Promise<
    | { cancelled: true; filePath?: undefined }
    | { cancelled: false; filePath: string; error?: undefined }
    | { cancelled: false; filePath?: undefined; error: string }
  >
  personaUploadJD: (filePath: string, eventId: string) => Promise<
    { success: true; summary: PersonaSummaryIpc }
    | { success: false; error: string }
  >
  personaGetJDForEvent: (eventId: string) => Promise<
    { success: true; summary: PersonaSummaryIpc | null }
    | { success: false; error: string }
  >
  personaClearJD: (eventId: string) => Promise<
    { success: true } | { success: false; error: string }
  >

  // sensi M7 / PREP-01 — pre-meeting briefing
  prepGetBriefing: (payload: { eventId: string; title: string; description?: string; force?: boolean }) => Promise<
    | { success: true; briefing: PrepBriefingIpc }
    | { success: false; error: string }
  >
  prepInvalidate: (eventId: string) => Promise<
    { success: true } | { success: false; error: string }
  >

  // sensi M7 / KNOWLEDGE-02 — per-meeting document binding.
  // `document` is the same shape the renderer already uses for
  // `knowledgeListDocuments` (KnowledgeDocumentMetadata). We keep the type
  // loose as `unknown` for the suggestions array to avoid cross-file
  // coupling — the UI casts to `KnowledgeDocumentMetadata` on consumption.
  knowledgeAttachToEvent: (docId: string, eventId: string) => Promise<
    { success: true } | { success: false; error: string }
  >;
  knowledgeDetachFromEvent: (docId: string, eventId: string) => Promise<
    { success: true } | { success: false; error: string }
  >;
  knowledgeListForEvent: (eventId: string) => Promise<
    | { success: true; documents: KnowledgeDocumentMetadata[] }
    | { success: false; error: string }
  >;
  knowledgeListEventsForDocument: (docId: string) => Promise<
    { success: true; eventIds: string[] } | { success: false; error: string }
  >;
  knowledgeSuggestForEvent: (eventId: string, searchText: string, topK?: number) => Promise<
    | { success: true; suggestions: Array<{ document: KnowledgeDocumentMetadata; distance: number }> }
    | { success: false; error: string }
  >;

  // sensi M5-T5 — Rolling-response trigger mode (3 channels)
  //
  // Persistent cadence selector for the rolling-response loop.
  //   'off'         — never auto-fires (keyboard shortcut still works)
  //   'on-silence'  — auto-fires after ~1.5s of no final transcripts
  //   'on-demand'   — only fires on explicit user action
  // Persisted via SettingsManager; default is 'on-silence'. See
  // DECISIONS.md D030 for the policy spec.
  setRollingTriggerMode: (mode: 'off' | 'on-silence' | 'on-demand') => Promise<
    { success: true } | { success: false; error: string }
  >;
  getRollingTriggerMode: () => Promise<'off' | 'on-silence' | 'on-demand'>;
  // v2.14.8: auto-answer sensitivity (silence threshold in ms, 500–10_000).
  setRollingTriggerSilenceMs: (ms: number) => Promise<
    { success: true; silenceMs: number } | { success: false; error: string }
  >;
  getRollingTriggerSilenceMs: () => Promise<number>;
  /**
   * Subscribe to mode-change broadcasts. Returns an unsubscribe
   * function. Fires when another window (or a keyboard shortcut)
   * changes the mode so every visible mode-selector UI re-syncs.
   */
  onRollingTriggerModeChanged: (
    callback: (mode: 'off' | 'on-silence' | 'on-demand') => void
  ) => () => void;
}

// ─────────────────────────────────────────────────────────────────
// sensi M4-T8 — Knowledge IPC shared types
//
// Mirror the main-process types from
// electron/knowledge/knowledgeIpcHelpers.ts and KnowledgeStore.ts.
// Defined here rather than imported because the renderer cannot
// import main-process modules directly.
// ─────────────────────────────────────────────────────────────────
export type KnowledgeIpcErrorType =
  | 'invalid_input'
  | 'ingest_failed'
  | 'query_failed'
  | 'model_mismatch'
  | 'provider_unavailable'
  | 'not_found'
  | 'dimension_mismatch'
  | 'export_failed'
  | 'import_failed'
  | 'incompatible_format'
  | 'internal';

export interface KnowledgeIpcFailure {
  success: false;
  error: string;
  errorType: KnowledgeIpcErrorType;
}

/**
 * sensi M8 / PASS B — auth state + /me shapes shared with AuthManager.
 */
export interface SensiMeUsageIpc {
  used: number
  cap: number | null
}

export interface SensiMeIpc {
  id: string
  email: string
  name: string | null
  avatar_url: string | null
  subscription: {
    tier: 'free' | 'pro'
    expires_at: string | null
    has_stripe_customer: boolean
  }
  usage: {
    what_to_answer: SensiMeUsageIpc
    research: SensiMeUsageIpc
    prep_briefing: SensiMeUsageIpc
    // v2.16.0: optional — only present when backend supports it.
    stt_seconds?: SensiMeUsageIpc
  }
}

export interface SensiAuthStateIpc {
  signedIn: boolean
  userId: string | null
  tier: 'free' | 'pro' | null
  me: SensiMeIpc | null
}

export interface KnowledgeDocumentMetadata {
  id: string;
  name: string;
  mime: string;
  bytes: number;
  embeddingModel: string;
  embeddingDim: number;
  pinned: boolean;
  pinnedAt: string | null;
  ingestedAt: string;
  chunkCount: number;
}

/**
 * sensi M7 / PERSONA-01 — Resume persona shape.
 */
export interface ResumePersonaIpc {
  name: string
  currentRole: string
  yearsExperience: number
  skills: string[]
  education: string[]
  topAchievements: string[]
}

/**
 * sensi M7 / PERSONA-02 — JD persona shape.
 */
export interface JDPersonaIpc {
  company: string
  role: string
  level: string
  requiredSkills: string[]
  niceToHaves: string[]
  interviewRounds: string[]
}

/**
 * sensi M7 / PERSONA-01/02 — IPC shape for the latest persona summary.
 * `persona` is the union of Resume (kind='resume') and JD (kind='jd').
 * Callers that need to discriminate check `kind` and narrow on
 * `in`-tests before reading shape-specific fields.
 */
export interface PersonaSummaryIpc {
  id: number
  kind: 'resume' | 'jd'
  sourceName: string | null
  eventId: string | null
  updatedAt: string
  persona: ResumePersonaIpc | JDPersonaIpc
}

/**
 * sensi M7 / PREP-01 — pre-meeting briefing shape.
 */
export interface PrepBriefingIpc {
  eventId: string
  title: string
  generatedAt: number
  brief: string
  inputs: {
    hasResume: boolean
    hasJD: boolean
    attachedDocCount: number
    hasResearch: boolean
    company?: string
  }
}

export interface KnowledgeRetrievedChunk {
  documentId: string;
  documentName: string;
  chunkIndex: number;
  text: string;
  distance: number;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
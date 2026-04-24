import { app } from 'electron';
import fs from 'fs';
import path from 'path';

export interface AppSettings {
    // Only boot-critical or non-encrypted settings should live here.
    // In the future, other non-secret data like 'language' or 'theme'
    // can be moved here from CredentialsManager to allow early boot access.
    isUndetectable?: boolean;
    verboseLogging?: boolean;
    actionButtonMode?: 'recap' | 'brainstorm';
    groqFastTextMode?: boolean;
    knowledgeMode?: boolean;
    // M5-T5: rolling-response trigger cadence.
    //   'off'         — never auto-fires (keyboard shortcut still works)
    //   'on-silence'  — auto-fires after ~1.5s of no final transcripts
    //   'on-demand'   — only fires on explicit user action
    // Default when unset: 'on-silence'.
    rollingTriggerMode?: 'off' | 'on-silence' | 'on-demand';
    // v2.14.8: how many milliseconds of silence after the interviewer's
    // last final transcript segment before on-silence auto-answer fires.
    // Lower = more responsive, higher = waits for the full question.
    // Typical range 1500–4000 ms. Default 2500 ms.
    rollingTriggerSilenceMs?: number;
    // v2.6.2: Online Assessment mode — for LeetCode / HackerRank / coding
    // assessments done solo (no interviewer watching). When on, pressing
    // "What to answer?" takes a fresh screenshot and asks the LLM for a
    // FULL solution (approach, code, complexity) rather than a hint. No
    // continuous streaming — screen is sampled only on user action. Off
    // by default; independent of Live Coding mode.
    onlineAssessmentModeEnabled?: boolean;
    // MEMORY-01 (v2.17.0): when signed in, auto-feed every finalised
    // meeting to the cross-meeting memory engine (sensi-cloud → Graphiti).
    // Default ON for signed-in users, no effect when signed out.
    memoryEngineEnabled?: boolean;
    // PERF-03 (v2.17.0): when true, sensi skips heavy features and
    // animations to stay responsive on slow laptops. Auto-seeded once
    // on first launch from HardwareProfile; user can override in
    // Settings → General → Performance.
    lowResourceMode?: boolean;
    // PERF-03 internal: timestamp we first detected hardware class.
    // Used to know whether `lowResourceMode` was auto-seeded (never
    // overwrite a user-set value).
    hardwareDetectedAt?: number;
}

export class SettingsManager {
    private static instance: SettingsManager;
    private settings: AppSettings = {};
    private settingsPath: string;

    private constructor() {
        if (!app.isReady()) {
            throw new Error('[SettingsManager] Cannot initialize before app.whenReady()');
        }
        this.settingsPath = path.join(app.getPath('userData'), 'settings.json');
        this.loadSettings();
    }

    public static getInstance(): SettingsManager {
        if (!SettingsManager.instance) {
            SettingsManager.instance = new SettingsManager();
        }
        return SettingsManager.instance;
    }

    public get<K extends keyof AppSettings>(key: K): AppSettings[K] {
        return this.settings[key];
    }

    public set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
        this.settings[key] = value;
        this.saveSettings();
    }

    private loadSettings(): void {
        try {
            if (fs.existsSync(this.settingsPath)) {
                const data = fs.readFileSync(this.settingsPath, 'utf8');
                try {
                    const parsed = JSON.parse(data);
                    // Minimal validation to ensure it's an object before assigning
                    if (typeof parsed === 'object' && parsed !== null) {
                        this.settings = parsed;
                        console.log('[SettingsManager] Settings loaded successfully:', JSON.stringify(this.settings));
                    } else {
                        throw new Error('Settings JSON is not a valid object');
                    }
                } catch (parseError) {
                    console.error('[SettingsManager] Failed to parse settings.json. Continuing with empty settings. Error:', parseError);
                    this.settings = {};
                }
                console.log('[SettingsManager] Settings loaded');
            }
        } catch (e) {
            console.error('[SettingsManager] Failed to read settings file:', e);
            this.settings = {};
        }
    }

    private saveSettings(): void {
        try {
            const tmpPath = this.settingsPath + '.tmp';
            fs.writeFileSync(tmpPath, JSON.stringify(this.settings, null, 2));
            fs.renameSync(tmpPath, this.settingsPath);
        } catch (e) {
            console.error('[SettingsManager] Failed to save settings:', e);
        }
    }
}

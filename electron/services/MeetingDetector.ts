/**
 * MeetingDetector — polls for active meeting applications and emits an
 * "meeting-started" event the first time one is detected, so sensi can
 * prompt the user with "Bring sensi? Yes / No" the moment they join a
 * call (independent of any calendar event).
 *
 * Detection strategy (Windows-first, cheap):
 *   1. Every POLL_MS, enumerate running processes via `tasklist` (built-in,
 *      no native deps).
 *   2. Match process basename against a whitelist of meeting apps
 *      (Zoom.exe, Teams.exe, ms-teams.exe, ...). Browser tabs for
 *      Meet/Zoom-web aren't detected here — a future pass can add
 *      window-title heuristics if needed.
 *   3. When a matched process ENTERS the running set (wasn't there last
 *      tick), fire `meeting-started` with the app name. Debounce so
 *      flicker or process-restart during a meeting doesn't double-fire.
 *   4. When the matched process LEAVES the running set, fire
 *      `meeting-ended` so callers can clear "is-prompted" state.
 *
 * The detector is a no-op unless the user has enabled
 * `meetingAutoDetectEnabled` in SettingsManager (defaults to true in
 * v2.5.1, can be flipped off in Settings → General).
 */

import { EventEmitter } from 'events';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface DetectedMeeting {
    app: 'zoom' | 'teams' | 'meet' | 'slack' | 'discord' | 'webex' | 'gotomeeting' | 'bluejeans' | 'skype' | 'other';
    appLabel: string;
    processName: string;
    detectedAt: number;
}

// Windows-side process names. Mac/Linux extension is a future pass —
// the user is Windows-first so we start there.
const WINDOWS_PROCESS_MAP: Record<string, DetectedMeeting['app'] & string> = {
    'zoom.exe':          'zoom',
    'ms-teams.exe':      'teams',
    'teams.exe':         'teams',
    'meet.exe':          'meet',
    'googlemeet.exe':    'meet',
    'slack.exe':         'slack', // Slack huddles/calls
    'discord.exe':       'discord',
    'webexmta.exe':      'webex',
    'webex.exe':         'webex',
    'g2mlauncher.exe':   'gotomeeting',
    'gotomeeting.exe':   'gotomeeting',
    'bluejeans.exe':     'bluejeans',
    'skype.exe':         'skype',
    'lync.exe':          'skype', // legacy Skype for Business / Lync
};

/**
 * M6-A v2.6.0 — browser-tab title patterns. Catches web-based Meet / Zoom /
 * Teams / Webex etc. that process-name alone misses (everything runs under
 * chrome.exe / msedge.exe / firefox.exe). Each entry pairs a strict regex
 * with the canonical app id + label. Regexes are intentionally strict:
 *   - Require a known meeting-app keyword (not just "meeting")
 *   - Require presence of a separator char (—, -, |) to avoid file names
 *     like "Teams Meeting agenda.docx" triggering false positives.
 */
interface TitlePattern {
    pattern: RegExp;
    app: DetectedMeeting['app'];
}
const TITLE_PATTERNS: TitlePattern[] = [
    // Google Meet — tab title forms include "Meet – abc-defg-hij" or "Meet — Stand-up"
    { pattern: /^Meet\s+[\u2013\u2014\-]\s+/i,                                   app: 'meet' },
    { pattern: /\s[\u2013\u2014\|\-]\s+Google Meet\b/i,                          app: 'meet' },
    // Zoom web client — "Zoom Meeting" or "Zoom - <title>"
    { pattern: /\bZoom\s+Meeting\b/i,                                            app: 'zoom' },
    { pattern: /^Zoom\s+[\u2013\u2014\-]\s+/i,                                   app: 'zoom' },
    // Microsoft Teams web — "Microsoft Teams | Call with ..." or "... | Microsoft Teams"
    { pattern: /Microsoft\s+Teams\s*[\u2013\u2014\|\-]\s*(Call|Meeting)/i,       app: 'teams' },
    { pattern: /\|\s*Microsoft\s+Teams\s*$/i,                                    app: 'teams' },
    // Webex web — "Webex | Meeting ..."
    { pattern: /^Webex\s*[\u2013\u2014\|\-]\s*Meeting/i,                         app: 'webex' },
    // Whereby / Jitsi / other web meets (generic catch — only if 'Meeting' is
    // preceded by a clear conferencing term)
    { pattern: /^(Whereby|Jitsi|Daily|8x8)\s*[\u2013\u2014\|\-]/i,                app: 'other' },
];

// Browser process names that host web-based meetings. Only these are scanned
// for window titles — we don't want to scan every process's title.
const BROWSER_PROCESSES = new Set([
    'chrome.exe',
    'msedge.exe',
    'brave.exe',
    'firefox.exe',
    'opera.exe',
    'vivaldi.exe',
    'arc.exe',
]);

const APP_LABELS: Record<DetectedMeeting['app'], string> = {
    zoom:         'Zoom',
    teams:        'Microsoft Teams',
    meet:         'Google Meet',
    slack:        'Slack',
    discord:      'Discord',
    webex:        'Webex',
    gotomeeting:  'GoToMeeting',
    bluejeans:    'BlueJeans',
    skype:        'Skype',
    other:        'Meeting',
};

/**
 * Minimal CSV parser — handles quoted fields and escaped quotes ("").
 * Exported for the MeetingDetector tests. Not attempting full RFC 4180;
 * tasklist output is well-formed so this is sufficient.
 */
export function parseCsvLine(line: string): string[] {
    const out: string[] = [];
    let i = 0;
    while (i < line.length) {
        if (line[i] === '"') {
            // Quoted field
            i++;
            let value = '';
            while (i < line.length) {
                if (line[i] === '"' && line[i + 1] === '"') {
                    value += '"';
                    i += 2;
                } else if (line[i] === '"') {
                    i++;
                    break;
                } else {
                    value += line[i];
                    i++;
                }
            }
            out.push(value);
            // skip trailing ,
            if (line[i] === ',') i++;
        } else {
            // Unquoted field (rare in tasklist output but handle anyway)
            let value = '';
            while (i < line.length && line[i] !== ',') {
                value += line[i];
                i++;
            }
            out.push(value);
            if (line[i] === ',') i++;
        }
    }
    return out;
}

const POLL_MS = 8_000;
// Detection debounce: meeting must be observed for this long before we
// fire meeting-started, to filter out a quick process restart or one-off
// spawn. 15 s is long enough to suppress noise but short enough that a
// user who joins a call sees the prompt promptly.
const ENTER_DEBOUNCE_MS = 15_000;

export class MeetingDetector extends EventEmitter {
    private static instance: MeetingDetector;
    private timer: NodeJS.Timeout | null = null;
    private running: Set<string> = new Set();          // process names seen last tick
    private firstSeenAt: Map<string, number> = new Map();  // process → first-seen timestamp
    private announced: Set<string> = new Set();        // process names we've fired meeting-started for
    private enabled: boolean = true;

    private constructor() {
        super();
    }

    public static getInstance(): MeetingDetector {
        if (!MeetingDetector.instance) {
            MeetingDetector.instance = new MeetingDetector();
        }
        return MeetingDetector.instance;
    }

    public setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        if (!enabled) {
            this.stop();
            this.running.clear();
            this.firstSeenAt.clear();
            this.announced.clear();
        } else {
            this.start();
        }
    }

    public start(): void {
        if (this.timer) return;
        if (!this.enabled) return;
        if (process.platform !== 'win32') {
            console.log('[MeetingDetector] Non-Windows platform — detection disabled (Windows-first policy).');
            return;
        }
        // Run once immediately, then on interval
        void this.poll();
        this.timer = setInterval(() => { void this.poll(); }, POLL_MS);
    }

    public stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    private async poll(): Promise<void> {
        try {
            const entries = await this.enumerateProcesses();
            const now = Date.now();
            const seenThisTick = new Set<string>();

            // Pass 1 — process-name matches (native Zoom / Teams / etc.)
            const matchedApps = new Set<DetectedMeeting['app']>();
            for (const entry of entries) {
                const lower = entry.name.toLowerCase();
                if (!(lower in WINDOWS_PROCESS_MAP)) continue;
                seenThisTick.add(lower);

                if (!this.firstSeenAt.has(lower)) {
                    this.firstSeenAt.set(lower, now);
                }

                const firstAt = this.firstSeenAt.get(lower)!;
                if (!this.announced.has(lower) && (now - firstAt) >= ENTER_DEBOUNCE_MS) {
                    const app = WINDOWS_PROCESS_MAP[lower];
                    matchedApps.add(app);
                    const detection: DetectedMeeting = {
                        app,
                        appLabel: APP_LABELS[app] ?? APP_LABELS.other,
                        processName: entry.name,
                        detectedAt: now,
                    };
                    console.log(`[MeetingDetector] meeting-started: ${detection.appLabel} (${entry.name})`);
                    this.announced.add(lower);
                    this.emit('meeting-started', detection);
                }
            }

            // Pass 2 — browser-tab titles (M6-A v2.6.0). Catches web-based Meet /
            // Zoom / Teams hosted inside chrome.exe / msedge.exe / firefox.exe.
            // De-dupe against Pass 1: if a native process already fired for the
            // same app this tick, skip to prevent double prompts.
            for (const entry of entries) {
                if (!entry.title) continue;
                if (!BROWSER_PROCESSES.has(entry.name.toLowerCase())) continue;

                for (const { pattern, app } of TITLE_PATTERNS) {
                    if (!pattern.test(entry.title)) continue;
                    // Synthetic key distinct from process-name keys. Includes app id
                    // so switching from Meet to Zoom in the same browser emits both.
                    const key = `browser:${app}`;
                    seenThisTick.add(key);

                    if (matchedApps.has(app)) break; // already announced via native path
                    if (!this.firstSeenAt.has(key)) {
                        this.firstSeenAt.set(key, now);
                    }
                    const firstAt = this.firstSeenAt.get(key)!;
                    if (!this.announced.has(key) && (now - firstAt) >= ENTER_DEBOUNCE_MS) {
                        const detection: DetectedMeeting = {
                            app,
                            appLabel: APP_LABELS[app] ?? APP_LABELS.other,
                            processName: `${entry.name} · ${entry.title.slice(0, 60)}`,
                            detectedAt: now,
                        };
                        console.log(`[MeetingDetector] meeting-started (browser): ${detection.appLabel} ("${entry.title.slice(0, 80)}")`);
                        this.announced.add(key);
                        this.emit('meeting-started', detection);
                    }
                    break; // one match per entry is enough
                }
            }

            // Cleanup: anything we were tracking that's no longer seen this tick
            for (const prev of this.running) {
                if (!seenThisTick.has(prev)) {
                    this.firstSeenAt.delete(prev);
                    if (this.announced.has(prev)) {
                        console.log(`[MeetingDetector] meeting-ended: ${prev}`);
                        this.announced.delete(prev);
                        this.emit('meeting-ended', prev);
                    }
                }
            }

            this.running = seenThisTick;
        } catch (err) {
            console.error('[MeetingDetector] poll failed:', err);
        }
    }

    /**
     * Enumerate running processes with their main window titles using
     * `tasklist /V`. Returns `{ name, title }` rows.
     *
     * v2.6.0: upgraded from /NH (no title) to /V (with title) so we can
     * inspect browser tab titles for web-based meetings. Slightly slower
     * (~200-500ms) but runs every 8s — well within budget.
     */
    private async enumerateProcesses(): Promise<Array<{ name: string; title: string }>> {
        try {
            const { stdout } = await execFileAsync('tasklist', ['/V', '/FO', 'CSV', '/NH'], {
                windowsHide: true,
                maxBuffer: 16 * 1024 * 1024,
            });
            const rows: Array<{ name: string; title: string }> = [];
            for (const line of stdout.split(/\r?\n/)) {
                if (!line) continue;
                // CSV with /V:
                // "Image Name","PID","Session Name","Session#","Mem Usage","Status","User Name","CPU Time","Window Title"
                const fields = parseCsvLine(line);
                if (fields.length < 9) continue;
                const name = fields[0];
                const title = fields[8] ?? '';
                rows.push({ name, title: title === 'N/A' ? '' : title });
            }
            return rows;
        } catch {
            return [];
        }
    }

    /**
     * Public helper for tests / diagnostics — reset all tracking so a
     * subsequent detection fires fresh.
     */
    public reset(): void {
        this.running.clear();
        this.firstSeenAt.clear();
        this.announced.clear();
    }
}

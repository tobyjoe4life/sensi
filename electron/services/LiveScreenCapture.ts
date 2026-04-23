/**
 * LiveScreenCapture — M6-A (v2.6.0)
 *
 * While a meeting is active AND the user has Live Coding Mode enabled,
 * this service captures a full-screen frame every ~12 seconds into a
 * ring buffer (last 3 frames on disk). IntelligenceEngine.runCodeHint()
 * and runWhatShouldISay() auto-attach the most recent frame when the
 * caller provided no explicit `imagePaths` — so "Ctrl+6 after seeing
 * something interesting" works without a manual Ctrl+H first.
 *
 * Design contract:
 *   - No egress. Frames stay on disk in `${userData}/live_frames`.
 *     The LLM only sees a frame when the user invokes a feature that
 *     attaches one.
 *   - Self-throttling. Overlapping captures are skipped, not queued.
 *   - Bounded disk. Ring buffer caps at 3 frames; oldest auto-deleted.
 *   - Visible. Emits `capture` events so the overlay UI can show a
 *     LIVE pill so the user always knows sensi is watching.
 *   - Disabled by default. Settings toggle opt-in.
 *
 * Singleton — mirrors the pattern used by MeetingDetector and
 * CalendarManager. Started from main.ts when a meeting becomes
 * active, stopped when the meeting ends.
 */

import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

const DEFAULT_INTERVAL_MS = 12_000;
const RING_BUFFER_SIZE = 3;

export interface LiveFrame {
    path: string;
    capturedAt: number;
}

export class LiveScreenCapture extends EventEmitter {
    private static instance: LiveScreenCapture;
    private timer: NodeJS.Timeout | null = null;
    private frames: LiveFrame[] = [];
    private capturing = false;             // re-entrancy guard
    private enabled = false;                // Settings-driven
    private meetingActive = false;          // meeting lifecycle
    private takeFrameFn: (() => Promise<string>) | null = null;

    private constructor() { super(); }

    public static getInstance(): LiveScreenCapture {
        if (!LiveScreenCapture.instance) {
            LiveScreenCapture.instance = new LiveScreenCapture();
        }
        return LiveScreenCapture.instance;
    }

    /**
     * DI: main.ts wires this to ScreenshotHelper.takeLiveFrame. We don't
     * import ScreenshotHelper directly to avoid a circular main-module graph.
     */
    public bindCaptureFn(fn: () => Promise<string>): void {
        this.takeFrameFn = fn;
    }

    public setEnabled(enabled: boolean): void {
        if (this.enabled === enabled) return;
        this.enabled = enabled;
        console.log(`[LiveScreenCapture] enabled=${enabled}`);
        this.reevaluate();
    }

    public onMeetingStateChanged(active: boolean): void {
        if (this.meetingActive === active) return;
        this.meetingActive = active;
        console.log(`[LiveScreenCapture] meetingActive=${active}`);
        if (!active) {
            this.purgeAllFrames();
        }
        this.reevaluate();
    }

    public getLatestFrame(): LiveFrame | null {
        if (this.frames.length === 0) return null;
        return this.frames[this.frames.length - 1];
    }

    public isRunning(): boolean {
        return this.timer !== null;
    }

    /**
     * Start/stop based on combined (enabled && meetingActive) state.
     * Idempotent — safe to call many times.
     */
    private reevaluate(): void {
        const shouldRun = this.enabled && this.meetingActive;
        if (shouldRun && !this.timer) this.start();
        else if (!shouldRun && this.timer) this.stop();
    }

    private start(): void {
        if (this.timer) return;
        if (!this.takeFrameFn) {
            console.warn('[LiveScreenCapture] start() called without bound capture fn — aborting');
            return;
        }
        console.log(`[LiveScreenCapture] starting (interval=${DEFAULT_INTERVAL_MS}ms, bufSize=${RING_BUFFER_SIZE})`);
        // Fire one immediately so the buffer has a frame for the first Code Hint
        void this.captureOne();
        this.timer = setInterval(() => { void this.captureOne(); }, DEFAULT_INTERVAL_MS);
        this.emit('running', true);
    }

    private stop(): void {
        if (!this.timer) return;
        clearInterval(this.timer);
        this.timer = null;
        console.log('[LiveScreenCapture] stopped');
        this.emit('running', false);
    }

    private async captureOne(): Promise<void> {
        if (this.capturing) {
            // Previous capture is still in flight — skip this tick rather than
            // queueing, to avoid backlog under CPU pressure.
            return;
        }
        if (!this.takeFrameFn) return;
        this.capturing = true;
        try {
            const frame: LiveFrame = {
                path: await this.takeFrameFn(),
                capturedAt: Date.now(),
            };
            this.frames.push(frame);
            // Ring-buffer eviction — delete the oldest file on disk.
            while (this.frames.length > RING_BUFFER_SIZE) {
                const evicted = this.frames.shift();
                if (evicted) this.unlinkSafe(evicted.path);
            }
            console.log(`[LiveScreenCapture] captured frame ${this.frames.length}/${RING_BUFFER_SIZE}`);
            this.emit('captured', frame);
        } catch (err) {
            console.error('[LiveScreenCapture] capture failed:', err);
        } finally {
            this.capturing = false;
        }
    }

    private purgeAllFrames(): void {
        for (const frame of this.frames) {
            this.unlinkSafe(frame.path);
        }
        this.frames = [];
    }

    private unlinkSafe(filePath: string): void {
        try {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (err) {
            console.warn('[LiveScreenCapture] failed to unlink frame:', err);
        }
    }

    /**
     * Test-only — lets vitest drive captureOne deterministically.
     */
    public _debugGetFrames(): LiveFrame[] {
        return [...this.frames];
    }

    /**
     * Diagnostic — reveals where frames live for user support.
     */
    public getFramesDir(): string {
        return path.join(app.getPath('userData'), 'live_frames');
    }
}

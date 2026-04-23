/**
 * MotionCaptureManager — sensi M7 / MOTION-01 (v2.8.0)
 *
 * Captures a bounded sequence of screen frames for video / GIF assessments.
 * User-driven (manual start/stop) — NOT the continuous background capture
 * that LiveScreenCapture does. Two modes served by the same primitive:
 *
 *   - Video Summary: user records one clip, model summarizes it.
 *   - Clip Comparison: user records clip A, then clip B, model compares
 *     them side-by-side.
 *
 * Design contract:
 *   - No egress. Frames stay on disk until a summarize/compare/discard IPC.
 *   - Bounded frames. Hard cap at MAX_FRAMES to keep token cost sane and
 *     prevent runaway disk usage.
 *   - Bounded duration. Auto-stops at MAX_FRAMES * FRAME_INTERVAL_MS.
 *   - Independent of LiveScreenCapture's ring buffer — uses its own list.
 *   - Shares the capture function with LiveScreenCapture (same bound fn)
 *     so we reuse the platform-specific desktopCapturer path.
 *
 * Singleton, same pattern as LiveScreenCapture.
 */

import { EventEmitter } from 'events';
import fs from 'fs';

const FRAME_INTERVAL_MS = 1500;
const MAX_FRAMES = 20;

export interface MotionFrame {
    path: string;
    capturedAt: number;
}

export class MotionCaptureManager extends EventEmitter {
    private static instance: MotionCaptureManager;
    private timer: NodeJS.Timeout | null = null;
    private frames: MotionFrame[] = [];
    private capturing = false;
    private recording = false;
    private startedAt: number | null = null;
    private takeFrameFn: (() => Promise<string>) | null = null;

    private constructor() { super(); }

    public static getInstance(): MotionCaptureManager {
        if (!MotionCaptureManager.instance) {
            MotionCaptureManager.instance = new MotionCaptureManager();
        }
        return MotionCaptureManager.instance;
    }

    /**
     * DI: main.ts wires this to ScreenshotHelper.takeLiveFrame (same low-latency
     * path that LiveScreenCapture uses). Lazy so ScreenshotHelper doesn't have
     * to be constructed first.
     */
    public bindCaptureFn(fn: () => Promise<string>): void {
        this.takeFrameFn = fn;
    }

    public isRecording(): boolean {
        return this.recording;
    }

    public getFrameCount(): number {
        return this.frames.length;
    }

    public getElapsedMs(): number {
        return this.startedAt ? Date.now() - this.startedAt : 0;
    }

    public getMaxFrames(): number {
        return MAX_FRAMES;
    }

    public getFrameIntervalMs(): number {
        return FRAME_INTERVAL_MS;
    }

    /**
     * Start a new recording. Silently resets any previous in-progress recording
     * (the previous frames are returned via stop() — this just starts fresh).
     */
    public start(): { ok: true; maxFrames: number; intervalMs: number } | { ok: false; error: string } {
        if (!this.takeFrameFn) {
            return { ok: false, error: 'Motion capture not initialized. Try again in a moment.' };
        }
        if (this.recording) {
            return { ok: false, error: 'Already recording. Stop the current clip first.' };
        }

        this.frames = [];
        this.startedAt = Date.now();
        this.recording = true;

        // Fire one immediately so frame 0 = start-of-clip.
        void this.captureOne();
        this.timer = setInterval(() => { void this.captureOne(); }, FRAME_INTERVAL_MS);
        console.log(`[MotionCapture] started (interval=${FRAME_INTERVAL_MS}ms, cap=${MAX_FRAMES})`);
        this.emit('started');
        return { ok: true, maxFrames: MAX_FRAMES, intervalMs: FRAME_INTERVAL_MS };
    }

    /**
     * Stop the recording and return the captured frames in chronological order.
     * Does NOT delete the frame files — the caller owns them until they call
     * discard().
     */
    public stop(): { frames: string[]; durationMs: number } {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        const durationMs = this.getElapsedMs();
        const framePaths = this.frames.map(f => f.path);
        this.recording = false;
        this.startedAt = null;
        // Keep this.frames as-is so the caller can still hit frames-by-ref if
        // needed; next start() resets it.
        console.log(`[MotionCapture] stopped (frames=${framePaths.length}, duration=${durationMs}ms)`);
        this.emit('stopped', { frames: framePaths, durationMs });
        return { frames: framePaths, durationMs };
    }

    /**
     * Unlink the given frame files. Safe: missing files are ignored.
     */
    public discardFrames(framePaths: string[]): void {
        for (const p of framePaths) {
            this.unlinkSafe(p);
        }
    }

    private async captureOne(): Promise<void> {
        if (this.capturing) return;
        if (!this.takeFrameFn) return;
        if (!this.recording) return;
        if (this.frames.length >= MAX_FRAMES) {
            // Auto-stop at cap.
            console.log('[MotionCapture] reached frame cap — auto-stopping');
            this.stop();
            this.emit('auto-stopped');
            return;
        }
        this.capturing = true;
        try {
            const frame: MotionFrame = {
                path: await this.takeFrameFn(),
                capturedAt: Date.now(),
            };
            this.frames.push(frame);
            this.emit('captured', { index: this.frames.length - 1, frame });
        } catch (err) {
            console.error('[MotionCapture] capture failed:', err);
        } finally {
            this.capturing = false;
        }
    }

    private unlinkSafe(filePath: string): void {
        try {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (err) {
            console.warn('[MotionCapture] failed to unlink frame:', err);
        }
    }
}

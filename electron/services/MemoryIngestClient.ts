/**
 * MemoryIngestClient — MEMORY-01 (v2.17.0).
 *
 * Fire-and-forget client that posts finalised meetings to sensi-cloud's
 * `/memory/ingest`. sensi-cloud forwards to the internal `sensi-memory`
 * service which runs Graphiti + Neo4j extraction.
 *
 * Reliability:
 *   - Queue-on-disk under `userData/memory-queue/pending.json`
 *   - Append on enqueue, remove on 2xx
 *   - Exponential back-off (60s, 5m, 30m, 4h) then drop after 5 attempts
 *   - Drains on app start and after every new enqueue
 *
 * Trust boundary: main-process only. Uses AuthManager for bearer tokens.
 * Never called when signed out — the MeetingPersistence hook guards that.
 */

import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { AuthManager } from './AuthManager';
import { SettingsManager } from './SettingsManager';

const SENSI_API_BASE = 'https://api.sensi.cloudfrontiers.co.uk';
const BACKOFFS_MS = [60_000, 5 * 60_000, 30 * 60_000, 4 * 3600_000, 24 * 3600_000];
const MAX_ATTEMPTS = BACKOFFS_MS.length;

export interface MemoryIngestPayload {
    meeting_id: string;
    title: string;
    summary?: string;
    transcript_segments: Array<{ speaker: string; content: string; timestamp_ms: number }>;
    started_at_ms: number;
    source: 'manual' | 'calendar';
}

interface QueueEntry {
    id: string;
    payload: MemoryIngestPayload;
    attempts: number;
    lastErrorAt: number | null;
    nextAttemptAt: number;
}

export class MemoryIngestClient {
    private static instance: MemoryIngestClient | null = null;
    private queue: QueueEntry[] = [];
    private queuePath: string;
    private drainTimer: NodeJS.Timeout | null = null;
    private draining = false;

    private constructor() {
        const dir = path.join(app.getPath('userData'), 'memory-queue');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        this.queuePath = path.join(dir, 'pending.json');
        this.loadQueue();
    }

    public static getInstance(): MemoryIngestClient {
        if (!MemoryIngestClient.instance) {
            MemoryIngestClient.instance = new MemoryIngestClient();
        }
        return MemoryIngestClient.instance;
    }

    /**
     * Queue a finalised meeting for upload. Silently no-ops when memory
     * engine is off OR user is signed out — the caller doesn't need to check.
     */
    public enqueue(payload: MemoryIngestPayload): void {
        if (!this.shouldIngest()) return;
        const entry: QueueEntry = {
            id: `${payload.meeting_id}-${Date.now()}`,
            payload,
            attempts: 0,
            lastErrorAt: null,
            nextAttemptAt: Date.now(),
        };
        this.queue.push(entry);
        this.saveQueue();
        this.scheduleDrain(0);
    }

    /** Kick the queue (called by main.ts on app start). */
    public bootstrap(): void {
        if (this.queue.length === 0) return;
        this.scheduleDrain(1000);
    }

    public pendingCount(): number {
        return this.queue.length;
    }

    // ─────────────────────────────────────────────────────────────
    // Internal
    // ─────────────────────────────────────────────────────────────

    private shouldIngest(): boolean {
        if (!AuthManager.getInstance().getAuthState().signedIn) return false;
        const enabled = SettingsManager.getInstance().get('memoryEngineEnabled');
        return enabled !== false; // default ON when unset
    }

    private scheduleDrain(delayMs: number): void {
        if (this.drainTimer) clearTimeout(this.drainTimer);
        this.drainTimer = setTimeout(() => void this.drain(), delayMs);
    }

    private async drain(): Promise<void> {
        if (this.draining) return;
        this.draining = true;
        try {
            while (this.queue.length > 0) {
                const head = this.queue[0]!;
                const now = Date.now();
                if (head.nextAttemptAt > now) {
                    this.scheduleDrain(head.nextAttemptAt - now);
                    return;
                }
                const ok = await this.attemptOne(head);
                if (ok) {
                    this.queue.shift();
                    this.saveQueue();
                    continue;
                }
                head.attempts += 1;
                head.lastErrorAt = now;
                if (head.attempts >= MAX_ATTEMPTS) {
                    console.warn(
                        `[MemoryIngest] dropping meeting ${head.payload.meeting_id} after ${MAX_ATTEMPTS} failed attempts`,
                    );
                    this.queue.shift();
                    this.saveQueue();
                    continue;
                }
                head.nextAttemptAt = now + BACKOFFS_MS[Math.min(head.attempts - 1, BACKOFFS_MS.length - 1)]!;
                this.saveQueue();
                this.scheduleDrain(head.nextAttemptAt - now);
                return;
            }
        } finally {
            this.draining = false;
        }
    }

    private async attemptOne(entry: QueueEntry): Promise<boolean> {
        const access = await AuthManager.getInstance().getFreshAccessToken();
        if (!access) return false;
        try {
            const res = await fetch(`${SENSI_API_BASE}/memory/ingest`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    authorization: `Bearer ${access}`,
                },
                body: JSON.stringify(entry.payload),
            });
            // 202 Accepted is the success contract; 200 is also fine if the
            // backend ever changes.
            if (res.status >= 200 && res.status < 300) return true;
            // 401 → token bad; let AuthManager rotate on the next attempt.
            // 4xx (other) → permanent failure, drop after logging.
            if (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 429) {
                console.warn(
                    `[MemoryIngest] permanent failure for ${entry.payload.meeting_id}: ${res.status}`,
                );
                return true; // treat as "done" so we drop instead of retrying forever
            }
            return false;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[MemoryIngest] network error: ${msg}`);
            return false;
        }
    }

    private loadQueue(): void {
        try {
            if (!fs.existsSync(this.queuePath)) return;
            const raw = fs.readFileSync(this.queuePath, 'utf8');
            const parsed = JSON.parse(raw) as unknown;
            if (Array.isArray(parsed)) {
                this.queue = parsed.filter(
                    (e): e is QueueEntry =>
                        typeof e === 'object' &&
                        e !== null &&
                        typeof (e as QueueEntry).id === 'string' &&
                        typeof (e as QueueEntry).payload === 'object',
                );
            }
        } catch (err) {
            console.warn('[MemoryIngest] failed to load queue, starting empty:', err);
            this.queue = [];
        }
    }

    private saveQueue(): void {
        try {
            fs.writeFileSync(this.queuePath, JSON.stringify(this.queue, null, 2), 'utf8');
        } catch (err) {
            console.warn('[MemoryIngest] failed to persist queue:', err);
        }
    }
}

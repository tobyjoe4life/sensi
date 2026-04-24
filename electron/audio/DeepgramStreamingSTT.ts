/**
 * DeepgramStreamingSTT - WebSocket-based streaming Speech-to-Text using Deepgram Nova-3
 *
 * Implements the same EventEmitter interface as GoogleSTT:
 *   Events: 'transcript' ({ text, isFinal, confidence }), 'error' (Error)
 *   Methods: start(), stop(), write(chunk), setSampleRate(), setAudioChannelCount()
 *
 * Sends raw PCM (linear16, 16-bit LE) over WebSocket — NO WAV header.
 * Receives interim and final transcription results in real time.
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { RECOGNITION_LANGUAGES } from '../config/languages';

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const RECONNECT_MAX_ATTEMPTS = 10;
const KEEPALIVE_INTERVAL_MS = 5000;

/**
 * Function used by managed-mode to fetch a fresh Deepgram scoped token
 * per connect attempt. Returning a rejected promise aborts the connect
 * and emits 'error'.
 */
export type DeepgramTokenGetter = () => Promise<string>;

export class DeepgramStreamingSTT extends EventEmitter {
    private apiKey: string;
    private tokenGetter: DeepgramTokenGetter | null;
    private ws: WebSocket | null = null;
    private isActive = false;
    private shouldReconnect = false;

    private sampleRate = 16000;
    private numChannels = 1;
    private languageCode: string | null = 'en'; // null = auto-detect via detect_language=true

    private reconnectAttempts = 0;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private keepAliveTimer: NodeJS.Timeout | null = null;
    private buffer: Buffer[] = [];
    private isConnecting = false;

    /**
     * Construct with either a static BYOK key OR a token getter that
     * returns a live Deepgram scoped key (for sensi managed mode).
     * Exactly one path is used per connect; passing both means the
     * getter wins. An empty string in BYOK mode is treated as "no key".
     */
    constructor(apiKey: string, tokenGetter?: DeepgramTokenGetter) {
        super();
        this.apiKey = apiKey;
        this.tokenGetter = tokenGetter ?? null;
    }

    // =========================================================================
    // Configuration (match GoogleSTT / RestSTT interface)
    // =========================================================================

    public setSampleRate(rate: number): void {
        if (this.sampleRate === rate) return;
        this.sampleRate = rate;
        console.log(`[DeepgramStreaming] Sample rate set to ${rate}`);

        if (this.isActive) {
            console.log('[DeepgramStreaming] Sample rate changed while active. Restarting...');
            const savedBuffer = [...this.buffer];
            this.stop();
            this.start();
            if (savedBuffer.length > 0) {
                this.buffer = [...savedBuffer, ...this.buffer];
            }
        }
    }

    public setAudioChannelCount(count: number): void {
        this.numChannels = count;
        console.log(`[DeepgramStreaming] Channel count set to ${count}`);
    }

    /** Set recognition language using ISO-639-1 code, or 'auto' for detect_language mode */
    public setRecognitionLanguage(key: string): void {
        const restartIfActive = () => {
            if (this.isActive) {
                console.log('[DeepgramStreaming] Language changed while active. Restarting...');
                const savedBuffer = [...this.buffer];
                this.stop();
                this.start();
                if (savedBuffer.length > 0) {
                    this.buffer = [...savedBuffer, ...this.buffer];
                }
            }
        };

        if (key === 'auto') {
            this.languageCode = null;
            console.log('[DeepgramStreaming] Language set to auto-detect (detect_language=true)');
            restartIfActive();
            return;
        }

        const config = RECOGNITION_LANGUAGES[key];
        if (config) {
            this.languageCode = config.iso639;
            console.log(`[DeepgramStreaming] Language set to ${this.languageCode}`);
            restartIfActive();
        }
    }

    /** No-op — no Google credentials needed */
    public setCredentials(_path: string): void { }

    // =========================================================================
    // Lifecycle
    // =========================================================================

    public start(): void {
        if (this.isActive) return;
        // Mark active immediately so write() buffers chunks
        // instead of dropping them during WebSocket handshake (~500ms).
        this.isActive = true;
        this.shouldReconnect = true;
        this.reconnectAttempts = 0;
        void this.connect();
    }

    public stop(): void {
        this.shouldReconnect = false;
        this.clearTimers();

        if (this.ws) {
            try {
                // Send Deepgram's graceful close message
                if (this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({ type: 'CloseStream' }));
                }
            } catch {
                // Ignore send errors during shutdown
            }
            this.ws.close();
            this.ws = null;
        }

        this.isActive = false;
        this.isConnecting = false;
        this.buffer = [];
        console.log('[DeepgramStreaming] Stopped');
    }

    // =========================================================================
    // Audio Data
    // =========================================================================

    public write(chunk: Buffer): void {
        if (!this.isActive) return;

        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.buffer.push(chunk);
            if (this.buffer.length > 500) this.buffer.shift(); // Cap buffer size
            
            if (!this.isConnecting && this.shouldReconnect && !this.reconnectTimer) {
                console.log('[DeepgramStreaming] WS not ready. Lazy connecting on new audio...');
                void this.connect();
            }
            return;
        }

        this.ws.send(chunk);
    }

    // =========================================================================
    // WebSocket Connection
    // =========================================================================

    private async connect(): Promise<void> {
        if (this.isConnecting) return;
        this.isConnecting = true;

        // v2.16.0: resolve the authorization token lazily so managed-mode
        // users get a fresh Deepgram scoped key on every (re)connect. BYOK
        // users keep the static key passed at construction. A token-getter
        // failure aborts the connect cleanly via 'error'.
        let resolvedToken = this.apiKey;
        if (this.tokenGetter) {
            try {
                resolvedToken = await this.tokenGetter();
            } catch (err) {
                this.isConnecting = false;
                const msg = err instanceof Error ? err.message : String(err);
                console.error('[DeepgramStreaming] Token getter failed:', msg);
                this.emit('error', err instanceof Error ? err : new Error(msg));
                return;
            }
        }
        if (!resolvedToken) {
            this.isConnecting = false;
            const err = new Error('DeepgramStreamingSTT: no API key or token available.');
            console.error('[DeepgramStreaming]', err.message);
            this.emit('error', err);
            return;
        }

        // v2.5.7: Deepgram's detect_language=true is ONLY supported on the
        // nova-2 family, NOT nova-3. Using nova-3 + detect_language returns
        // HTTP 400 on every connect, killing STT entirely. Route based on
        // language selection:
        //   - 'auto' (detect_language)      → nova-2-general (auto-detect)
        //   - specific supported language   → nova-3 (best accuracy)
        const isAutoDetect = this.languageCode === null;
        const model = isAutoDetect ? 'nova-2-general' : 'nova-3';
        const langParam = isAutoDetect
            ? '&detect_language=true'
            : `&language=${this.languageCode}`;

        // v2.17.6: bumped `endpointing` 800 → 1500 ms. The 800 ms threshold
        // was splitting natural questions on mid-sentence thinking pauses
        // ("Tell me about a time… [800 ms thinking] …you led a team") into
        // two separate finals, which fed the auto-answer a fragment and
        // produced "Take your time." spam. 1500 ms keeps the segment
        // coalesced through normal thinking pauses while still finalizing
        // promptly when the speaker truly stops.
        //
        // `utterance_end_ms=1200` is now informational only (gated in
        // RollingTriggerPolicy v2.17.5) — the silence detector is the
        // single source of truth for "speaker has stopped."
        const url =
            `wss://api.deepgram.com/v1/listen` +
            `?model=${model}` +
            `&encoding=linear16` +
            `&sample_rate=${this.sampleRate}` +
            `&channels=${this.numChannels}` +
            langParam +
            `&smart_format=true` +
            `&interim_results=true` +
            `&endpointing=1500` +
            `&utterance_end_ms=1200` +
            `&keepalive=true`;

        console.log(`[DeepgramStreaming] Connecting model=${model}, rate=${this.sampleRate}, ch=${this.numChannels}, lang=${this.languageCode ?? 'auto'}`);

        this.ws = new WebSocket(url, {
            headers: {
                Authorization: `Token ${resolvedToken}`,
            },
        });

        this.ws.on('open', () => {
            this.isActive = true;
            this.isConnecting = false;
            this.reconnectAttempts = 0;
            console.log('[DeepgramStreaming] Connected');

            // Send buffered audio
            while (this.buffer.length > 0) {
                const chunk = this.buffer.shift();
                if (chunk && this.ws?.readyState === WebSocket.OPEN) {
                    this.ws.send(chunk);
                }
            }

            // Start keep-alive pings
            this.startKeepAlive();
        });

        // v2.5.3 diagnostic: track whether Deepgram is returning ANY Results
        // messages at all (even empty ones). If chunks flow in but zero
        // Results come back, it means the mic is quiet / muted / disconnected
        // on the hardware side. Log a warning so the user can check their
        // Jabra/device mute button.
        let resultsReceived = 0;
        let transcriptsEmitted = 0;
        const quietWarnTimer = setTimeout(() => {
            if (resultsReceived === 0) {
                console.warn('[DeepgramStreaming] ⚠️ 20s elapsed, Deepgram has not returned any Results — mic is likely muted or audio is silent. Check your headset mute button + Windows input level.');
            } else if (transcriptsEmitted === 0) {
                console.warn(`[DeepgramStreaming] ⚠️ 20s elapsed, Deepgram returned ${resultsReceived} Results but all were empty — audio is reaching the server but too quiet to transcribe. Check mic input gain.`);
            }
        }, 20_000);
        this.ws.on('close', () => clearTimeout(quietWarnTimer));

        this.ws.on('message', (data: WebSocket.Data) => {
            try {
                const msg = JSON.parse(data.toString());

                // Deepgram `UtteranceEnd` fires when its own VAD confirms
                // the speaker has stopped for `utterance_end_ms`. This is
                // the reliable turn-end signal — the auto-answer policy
                // consumes it instead of our blind silence timer.
                if (msg.type === 'UtteranceEnd') {
                    this.emit('utterance-end', { lastWordEnd: msg.last_word_end ?? null });
                    return;
                }

                // Deepgram response structure:
                // { type: "Results", channel: { alternatives: [{ transcript, confidence }] }, is_final }
                if (msg.type !== 'Results') return;
                resultsReceived++;

                const transcript = msg.channel?.alternatives?.[0]?.transcript;
                if (!transcript) return;
                transcriptsEmitted++;

                // Log first transcript + every 20th thereafter so users (and
                // us, debugging) can see STT is alive without log spam.
                if (transcriptsEmitted === 1 || transcriptsEmitted % 20 === 0) {
                    console.log(`[DeepgramStreaming] Transcript #${transcriptsEmitted} (${msg.is_final ? 'final' : 'interim'}): "${transcript.substring(0, 60)}${transcript.length > 60 ? '…' : ''}"`);
                }

                this.emit('transcript', {
                    text: transcript,
                    isFinal: msg.is_final ?? false,
                    confidence: msg.channel?.alternatives?.[0]?.confidence ?? 1.0,
                });
            } catch (err) {
                console.error('[DeepgramStreaming] Parse error:', err);
            }
        });

        this.ws.on('error', (err: Error) => {
            console.error('[DeepgramStreaming] WebSocket error:', err.message);
            this.emit('error', err);
        });

        this.ws.on('close', (code: number, reason: Buffer) => {
            // Do not force isActive=false; let write() trigger reconnect if isActive is still true
            this.isConnecting = false;
            this.clearKeepAlive();
            console.log(`[DeepgramStreaming] Closed (code=${code}, reason=${reason.toString()})`);

            // Auto-reconnect on unexpected close (excluding silence timeout 1000)
            if (this.shouldReconnect && code !== 1000) {
                this.scheduleReconnect();
            }
        });
    }

    // =========================================================================
    // Reconnection
    // =========================================================================

    private scheduleReconnect(): void {
        if (!this.shouldReconnect) return;

        if (this.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
            console.error(`[DeepgramStreaming] Max reconnect attempts (${RECONNECT_MAX_ATTEMPTS}) reached — giving up`);
            this.emit('error', new Error('DeepgramStreamingSTT: max reconnect attempts exceeded'));
            return;
        }

        const delay = Math.min(
            RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts),
            RECONNECT_MAX_DELAY_MS
        );
        this.reconnectAttempts++;

        console.log(`[DeepgramStreaming] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${RECONNECT_MAX_ATTEMPTS})...`);

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.shouldReconnect) {
                void this.connect();
            }
        }, delay);
    }

    // =========================================================================
    // Keep-alive
    // =========================================================================

    private startKeepAlive(): void {
        this.clearKeepAlive();
        this.keepAliveTimer = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                try {
                    // Send KeepAlive JSON instead of raw ping frame for Deepgram API idle prevention
                    this.ws.send(JSON.stringify({ type: 'KeepAlive' }));
                } catch {
                    // Ignore errors
                }
            }
        }, KEEPALIVE_INTERVAL_MS);
    }

    private clearKeepAlive(): void {
        if (this.keepAliveTimer) {
            clearInterval(this.keepAliveTimer);
            this.keepAliveTimer = null;
        }
    }

    private clearTimers(): void {
        this.clearKeepAlive();
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
}

import React, { useEffect, useRef } from 'react';

interface RollingTranscriptProps {
    text: string;
    isActive?: boolean;
    surfaceStyle?: React.CSSProperties;
    /**
     * v2.6.1: eyebrow label for the other-party speaker. Defaults to
     * "Speaker" (generic). Callers set this to "Interviewer" when
     * Interview Mode is on (actionButtonMode === 'brainstorm').
     */
    speakerLabel?: string;
}

/**
 * RollingTranscript — interviewer-speech transcript bar for the overlay.
 *
 * v2.5.0 redesign for readability:
 *   - Multi-line block (max 2 lines) — you can actually read what the
 *     interviewer said, not just the last 4 words scrolling past.
 *   - Upright (not italic) — italic at small sizes is harder to read.
 *   - Larger 14.5 px type, warm off-white on a tinted container so it
 *     reads at a glance under time pressure.
 *   - Eyebrow label "INTERVIEWER" with brand-brass tint + animated ping
 *     when they're currently speaking.
 *   - Auto-scrolls to reveal latest content but clamps to 2 lines so it
 *     never balloons the overlay height.
 */
const RollingTranscript: React.FC<RollingTranscriptProps> = ({ text, isActive = true, surfaceStyle, speakerLabel = 'Speaker' }) => {
    const textRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to show the latest tokens as the line grows. 2-line clamp
    // means we drop the earliest line when new content overflows — caller
    // already maintains the "recent enough" text window.
    useEffect(() => {
        if (textRef.current) {
            textRef.current.scrollTop = textRef.current.scrollHeight;
        }
    }, [text]);

    if (!text) return null;

    return (
        <div
            className="mx-3 mt-3 mb-1 rounded-[10px] border border-[var(--accent-primary)]/15 bg-[var(--accent-primary)]/[0.04] px-3 py-2"
            style={surfaceStyle}
        >
            {/* Eyebrow */}
            <div className="flex items-center gap-2 mb-1">
                <div className="relative flex items-center justify-center w-1.5 h-1.5">
                    {isActive && (
                        <div className="absolute inset-0 rounded-full bg-[var(--accent-primary)] opacity-40 animate-ping" />
                    )}
                    <div className={`relative w-1 h-1 rounded-full bg-[var(--accent-primary)] ${isActive ? '' : 'opacity-50'}`} />
                </div>
                <span className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-[var(--accent-primary)]">
                    {speakerLabel} {isActive ? '· live' : ''}
                </span>
            </div>

            {/* Body — 2-line clamp, upright, high-contrast warm-white */}
            <div
                ref={textRef}
                className="overflow-hidden text-[14px] leading-[1.45] tracking-[-0.005em] text-[var(--overlay-text-strong)] font-normal"
                style={{
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    maxHeight: '2.9em',
                }}
            >
                {text}
            </div>
        </div>
    );
};

export default RollingTranscript;

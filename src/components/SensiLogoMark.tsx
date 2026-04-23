import React from 'react';

/**
 * sensi brand mark — brush-s monogram (POLISH-01 / D028b).
 *
 * A lowercase "s" traced as a single calligraphic brushstroke inscribed
 * in an optional circle. Replaces the upstream Natively "N" lettermark
 * that shipped as the first-pass placeholder when the repo was forked
 * (see M2-T2 tombstone comments + prior versions of this file for
 * history).
 *
 * The component is rendered as inline SVG so it inherits `color`
 * (currentColor) and can be styled freely with className. Exposes the
 * same `size` and `className` props as the upstream placeholder so
 * every existing call site works unchanged. `SensiLogoMark` is kept as
 * a named export for backward compatibility with consumers that still
 * import the old symbol; new code should import `SensiMark` and use
 * the `variant` prop for the mark / wordmark / lockup modes.
 */

export type SensiMarkVariant = 'mark' | 'wordmark' | 'lockup';

export interface SensiMarkProps {
    size?: number;
    className?: string;
    variant?: SensiMarkVariant;
    /**
     * Draw the outer circle around the brush-s glyph. Defaults to true
     * for the `mark` and `lockup` variants, false for `wordmark`.
     */
    withCircle?: boolean;
}

/**
 * Pure brush-s glyph. The path is authored as a single quadratic-Bezier
 * path so it renders as one continuous stroke — a single "s" drawn
 * without lifting the brush. Stroke caps and joins are round to keep
 * the mark crisp at small sizes (≥14 px tested).
 *
 * viewBox is 100×100 to match the prior `SensiLogoMark` so the new
 * glyph slots into every existing consumer without re-tuning size.
 */
const BrushSGlyph: React.FC<{ strokeWidth?: number }> = ({ strokeWidth = 10 }) => (
    <g>
        {/* Top curve of the s: starts top-right, sweeps down-left through the upper lobe. */}
        <path
            d="M 72 30
               C 72 18, 58 14, 46 18
               C 30 24, 26 40, 40 46
               L 60 54
               C 74 60, 70 76, 54 82
               C 42 86, 28 82, 28 70"
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
        />
    </g>
);

/**
 * Canonical wordmark: lowercase `sensi` in the Celeb Light typeface
 * already loaded by the app (used on the Launcher header). Rendered
 * as SVG text so it inherits `color` and scales cleanly.
 */
const SensiWordmark: React.FC<{ size: number }> = ({ size }) => (
    <text
        x="0"
        y={size * 0.78}
        fontFamily="'Celeb Light', system-ui, -apple-system, sans-serif"
        fontSize={size * 0.9}
        fontWeight={300}
        letterSpacing="0.02em"
        fill="currentColor"
    >
        sensi
    </text>
);

export const SensiMark: React.FC<SensiMarkProps> = ({
    size = 18,
    className = '',
    variant = 'mark',
    withCircle,
}) => {
    const drawCircle = withCircle ?? (variant !== 'wordmark');

    if (variant === 'wordmark') {
        // Wordmark width ~ 2.6× the glyph height for the 5-letter word.
        const width = Math.round(size * 2.6);
        return (
            <svg
                width={width}
                height={size}
                viewBox={`0 0 ${Math.round(100 * 2.6)} 100`}
                xmlns="http://www.w3.org/2000/svg"
                className={className}
                aria-hidden="true"
            >
                <SensiWordmark size={100} />
            </svg>
        );
    }

    if (variant === 'lockup') {
        // Mark + wordmark side-by-side with a small gap.
        const markBox = 100;
        const gap = 16;
        const wordBox = Math.round(100 * 2.6);
        const totalWidth = markBox + gap + wordBox;
        const renderWidth = Math.round(size * (totalWidth / 100));
        return (
            <svg
                width={renderWidth}
                height={size}
                viewBox={`0 0 ${totalWidth} 100`}
                xmlns="http://www.w3.org/2000/svg"
                className={className}
                aria-hidden="true"
            >
                {drawCircle && (
                    <circle cx="50" cy="50" r="47" stroke="currentColor" strokeWidth="5" fill="none" />
                )}
                <BrushSGlyph strokeWidth={10} />
                <g transform={`translate(${markBox + gap}, 0)`}>
                    <SensiWordmark size={100} />
                </g>
            </svg>
        );
    }

    // Default: mark-only
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 100 100"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={className}
            aria-hidden="true"
        >
            {drawCircle && (
                <circle cx="50" cy="50" r="47" stroke="currentColor" strokeWidth="5" />
            )}
            <BrushSGlyph strokeWidth={10} />
        </svg>
    );
};

/**
 * Back-compat alias: the prior component was exported as `SensiLogoMark`
 * with only `size` and `className` props. New code should use
 * `SensiMark`; legacy imports continue to work against the same glyph
 * (mark variant, circle on).
 */
export const SensiLogoMark: React.FC<{ size?: number; className?: string }> = (props) => (
    <SensiMark {...props} variant="mark" />
);

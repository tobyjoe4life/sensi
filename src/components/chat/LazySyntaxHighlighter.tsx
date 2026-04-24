/**
 * LazySyntaxHighlighter — defers the ~250 KB gzipped `react-syntax-highlighter`
 * chunk + Prism grammars out of the initial renderer bundle. First time a
 * code fence is actually rendered, we kick off the dynamic import; while
 * it's loading we show the code text unstyled inside a bare `<pre><code>`
 * so nothing flashes empty.
 *
 * Usage: drop-in replacement for `<Prism as SyntaxHighlighter>` — same
 * common props (`language`, `style`, `PreTag`, `showLineNumbers`,
 * `customStyle`, `codeTagProps`, `lineNumberStyle`). Extra props are
 * forwarded through.
 */

import React, { lazy, Suspense } from 'react';
import type { CSSProperties } from 'react';

// Keep these at build-time: they're small object literals, not the Prism
// runtime itself. The Prism component + grammar loader stays deferred.
export { vscDarkPlus, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';

// Lazy-load only the Prism component. `Prism as SyntaxHighlighter` from the
// root package entry is what pulls in the full grammar bundle; isolating it
// here keeps the initial chunk lean.
const PrismAsync = lazy(async () => {
    const mod = await import('react-syntax-highlighter');
    return { default: mod.Prism as unknown as React.ComponentType<HighlighterProps> };
});

export interface HighlighterProps {
    children?: React.ReactNode;
    language?: string;
    // Style objects from react-syntax-highlighter's prism theme files
    // typed loosely because the library itself ships no public type for the shape.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    style?: any;
    showLineNumbers?: boolean;
    PreTag?: keyof JSX.IntrinsicElements | React.ComponentType<React.HTMLAttributes<HTMLElement>>;
    customStyle?: CSSProperties;
    codeTagProps?: React.HTMLAttributes<HTMLElement>;
    lineNumberStyle?: CSSProperties;
    wrapLines?: boolean;
    wrapLongLines?: boolean;
    className?: string;
}

/**
 * Renders unstyled code during the brief async import window. Keeps layout
 * stable and content visible.
 */
const FallbackPre: React.FC<HighlighterProps> = ({
    children,
    PreTag = 'pre',
    customStyle,
    codeTagProps,
    className,
}) => {
    const Tag = PreTag as React.ElementType;
    return (
        <Tag className={className} style={customStyle}>
            <code {...codeTagProps}>{children}</code>
        </Tag>
    );
};

export const LazySyntaxHighlighter: React.FC<HighlighterProps> = (props) => {
    return (
        <Suspense fallback={<FallbackPre {...props} />}>
            <PrismAsync {...props} />
        </Suspense>
    );
};

export default LazySyntaxHighlighter;

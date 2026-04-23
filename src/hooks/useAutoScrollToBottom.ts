import { useEffect, useRef, useCallback, RefObject } from 'react';

/**
 * Shared auto-scroll hook for streaming chat surfaces (POLISH-01 / D028c).
 *
 * Follows new content to the bottom of a scroll container ONLY while
 * the user's viewport is already near the bottom. When the user
 * intentionally scrolls up past the threshold the follow pauses;
 * when they scroll back into range the follow resumes automatically
 * on the next content update. No scroll fighting, no smooth-animation
 * lag during token bursts.
 *
 * Shared across `SensiInterface.tsx`, `GlobalChatOverlay.tsx`, and
 * `MeetingChatOverlay.tsx` — all three had the same regression
 * (scroll-on-user-send only; nothing during streaming). See
 * DECISIONS.md D028 for the spec rationale.
 *
 * Design notes:
 *   - Token-driven auto-scroll uses `behavior: 'auto'` (instant). At
 *     30 tokens/s the `smooth` animation lags behind content arrival
 *     and looks broken. User-send scrolls in the components keep
 *     their existing `behavior: 'smooth'` call — those are once-per-
 *     intent and benefit from the animation.
 *   - Uses rAF to schedule scrolls after React commits + browser
 *     layout, so `scrollHeight` is the post-update value.
 *   - ResizeObserver handles window/layout reflow (devtools toggle,
 *     font load, sidebar resize) — recomputes `isAtBottom` once
 *     and snaps to bottom if still pinned.
 *   - No programmatic scroll when the container doesn't overflow
 *     (short responses) — keeps short-thread UX identical to pre-fix.
 */

const DEFAULT_THRESHOLD_PX = 48;

/**
 * Pure predicate — exported for unit testing. Given the three scroll
 * numbers, returns true iff the viewport is within `threshold` px of
 * the bottom. Handles non-overflowing containers by treating them as
 * always "at bottom" (nothing to follow).
 */
export function isWithinBottomThreshold(
    scrollTop: number,
    clientHeight: number,
    scrollHeight: number,
    threshold: number = DEFAULT_THRESHOLD_PX
): boolean {
    if (scrollHeight <= clientHeight) return true;
    const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
    return distanceFromBottom <= threshold;
}

export interface UseAutoScrollToBottomOptions {
    thresholdPx?: number;
}

export interface UseAutoScrollToBottomResult {
    /** Current "near bottom" state — exposed for optional UI hints. */
    isAtBottom: boolean;
    /**
     * Imperative jump to bottom. `smooth` defaults to false (instant);
     * callers that want animation (e.g. a "Jump to latest" button) can
     * pass true.
     */
    scrollToBottom: (smooth?: boolean) => void;
}

/**
 * Auto-scroll hook. Call from a React component that renders a
 * scrollable chat container.
 *
 * @param scrollRef - ref to the overflowing scroll container
 * @param trigger   - any value whose identity-change means "content
 *                    updated"; typically `messages` array or a derived
 *                    primitive like `messages.length + latestText.length`
 * @param opts      - optional threshold override (default 48 px)
 */
export function useAutoScrollToBottom(
    scrollRef: RefObject<HTMLElement | null>,
    trigger: unknown,
    opts: UseAutoScrollToBottomOptions = {}
): UseAutoScrollToBottomResult {
    const threshold = opts.thresholdPx ?? DEFAULT_THRESHOLD_PX;

    // Ref (not state) so we don't re-render on every scroll event —
    // the value is only read at content-update time.
    const isAtBottomRef = useRef(true);
    const isAtBottomStateRef = useRef(true);

    const scrollToBottom = useCallback((smooth: boolean = false) => {
        const el = scrollRef.current;
        if (!el) return;
        // Only scroll when there is something to scroll to.
        if (el.scrollHeight <= el.clientHeight) return;
        if (smooth) {
            el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
        } else {
            el.scrollTop = el.scrollHeight;
        }
    }, [scrollRef]);

    const recompute = useCallback(() => {
        const el = scrollRef.current;
        if (!el) return;
        isAtBottomRef.current = isWithinBottomThreshold(
            el.scrollTop,
            el.clientHeight,
            el.scrollHeight,
            threshold
        );
        isAtBottomStateRef.current = isAtBottomRef.current;
    }, [scrollRef, threshold]);

    // Attach scroll + resize listeners once per mount / scrollRef change.
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;

        // Initial sync so isAtBottom reflects actual DOM on mount.
        recompute();

        const onScroll = () => recompute();
        el.addEventListener('scroll', onScroll, { passive: true });

        // ResizeObserver catches window resize, font load, devtools
        // toggle — all of which reflow content without firing scroll.
        let resizeObserver: ResizeObserver | null = null;
        if (typeof ResizeObserver !== 'undefined') {
            resizeObserver = new ResizeObserver(() => {
                recompute();
                if (isAtBottomRef.current) {
                    // If the user was pinned to bottom pre-reflow,
                    // keep them pinned after reflow.
                    requestAnimationFrame(() => scrollToBottom(false));
                }
            });
            resizeObserver.observe(el);
        }

        return () => {
            el.removeEventListener('scroll', onScroll);
            resizeObserver?.disconnect();
        };
    }, [scrollRef, recompute, scrollToBottom]);

    // On every content change, if the user was near bottom at the time
    // of the change, scroll to the new bottom after paint. rAF
    // guarantees we read scrollHeight post-layout.
    useEffect(() => {
        if (!isAtBottomRef.current) return;
        const el = scrollRef.current;
        if (!el) return;
        const raf = requestAnimationFrame(() => {
            // Re-check post-layout: the content update might have
            // pushed us over the threshold even though we were inside
            // it at event time. For token streaming this is still
            // "at bottom" because the user hasn't moved.
            scrollToBottom(false);
        });
        return () => cancelAnimationFrame(raf);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [trigger, scrollRef, scrollToBottom]);

    return {
        isAtBottom: isAtBottomStateRef.current,
        scrollToBottom,
    };
}

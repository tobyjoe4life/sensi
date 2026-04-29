import { useEffect, useState } from 'react';

/**
 * useLowResourceMode — PERF-04 (v2.18.0).
 *
 * Reads the persisted `lowResourceMode` flag (auto-seeded by
 * HardwareProfile on first launch when ≤4 cores OR <7.7 GB RAM) and
 * subscribes to live changes. Components branch on this to:
 *
 *   - skip framer-motion `AnimatePresence` transitions (CSS instant)
 *   - drop `scroll-bounce` and other GPU-heavy webPreferences
 *   - disable verbose logging streams
 *
 * Defaults to `false` until the IPC resolves so first paint is stable.
 *
 * Reads ipc only — main is the source of truth.
 */
export function useLowResourceMode(): boolean {
    const [lowResource, setLowResource] = useState<boolean>(() => {
        // Seed from localStorage if main has previously broadcast a value.
        // Fast path so the very first paint already matches; main will
        // confirm via the IPC below.
        try {
            const cached = localStorage.getItem('sensi:lowResourceMode');
            return cached === 'true';
        } catch {
            return false;
        }
    });

    useEffect(() => {
        let mounted = true;
        if (window.electronAPI?.perfGetProfile) {
            window.electronAPI.perfGetProfile()
                .then((p) => {
                    if (!mounted) return;
                    setLowResource(p.currentLowResource);
                    try { localStorage.setItem('sensi:lowResourceMode', String(p.currentLowResource)); } catch { /* */ }
                })
                .catch(() => { /* keep cached value */ });
        }
        let off: (() => void) | undefined;
        if (window.electronAPI?.onLowResourceModeChanged) {
            off = window.electronAPI.onLowResourceModeChanged((enabled) => {
                setLowResource(enabled);
                try { localStorage.setItem('sensi:lowResourceMode', String(enabled)); } catch { /* */ }
            });
        }
        return () => {
            mounted = false;
            if (off) off();
        };
    }, []);

    return lowResource;
}

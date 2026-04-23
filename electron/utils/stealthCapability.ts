/**
 * Windows stealth-capability probe (v2.16.2).
 *
 * Electron's `BrowserWindow.setContentProtection(true)` calls Windows'
 * `SetWindowDisplayAffinity` under the hood. The effective behaviour
 * depends on the Windows build number:
 *
 *   - Windows 10 20H1 (build 19041, May 2020) or later  → `WDA_EXCLUDEFROMCAPTURE`
 *     blocks BOTH BitBlt capture AND modern DXGI Desktop Duplication,
 *     which is what Zoom/Teams/Meet/Discord/OBS use. Stealth works.
 *   - Windows 10 pre-20H1 → falls back to `WDA_MONITOR` which blocks only
 *     BitBlt. Modern screen-sharing tools still see the window.
 *   - Windows 11 any build → full `WDA_EXCLUDEFROMCAPTURE`.
 *   - macOS → `NSWindow.sharingType = NSWindowSharingNone` works on all
 *     supported versions.
 *   - Linux → best-effort; depends on the compositor.
 *
 * This probe returns a verdict the renderer can surface via a warning
 * toast when the user enables "Undetectable" on an incapable OS.
 */

import os from 'node:os';

export type StealthCapability = 'full' | 'partial' | 'unsupported';

export interface StealthProbe {
    capability: StealthCapability;
    platform: NodeJS.Platform;
    osRelease: string;
    /** Build number parsed from os.release(), Windows only. */
    buildNumber: number | null;
    /** Human-readable explanation shown to the user if capability != 'full'. */
    warning: string | null;
}

/**
 * Parse the Windows build number out of `os.release()`.
 * Returns `null` on other platforms or parse failures.
 *
 * Format varies but typically:
 *   "10.0.22621" (Windows 11 22H2)
 *   "10.0.19044" (Windows 10 21H2)
 *   "10.0.18363" (Windows 10 1909)
 */
export function parseWindowsBuild(release: string): number | null {
    const m = release.match(/^10\.0\.(\d+)/);
    if (!m) return null;
    const n = parseInt(m[1]!, 10);
    return Number.isFinite(n) ? n : null;
}

const MIN_WDA_EXCLUDEFROMCAPTURE_BUILD = 19041; // Windows 10 20H1, May 2020

export function probeStealthCapability(): StealthProbe {
    const platform = process.platform;
    const osRelease = os.release();

    if (platform === 'darwin') {
        return {
            capability: 'full',
            platform,
            osRelease,
            buildNumber: null,
            warning: null,
        };
    }

    if (platform === 'win32') {
        const buildNumber = parseWindowsBuild(osRelease);
        if (buildNumber === null) {
            // Could not parse — assume the OS is too old to be safe.
            return {
                capability: 'partial',
                platform,
                osRelease,
                buildNumber: null,
                warning:
                    'Undetectable mode is active but your Windows version could not be detected. Modern screen-sharing tools may still see sensi.',
            };
        }
        if (buildNumber >= MIN_WDA_EXCLUDEFROMCAPTURE_BUILD) {
            return {
                capability: 'full',
                platform,
                osRelease,
                buildNumber,
                warning: null,
            };
        }
        return {
            capability: 'partial',
            platform,
            osRelease,
            buildNumber,
            warning:
                'Your Windows version (pre-May-2020) does not fully support screen-share stealth. Undetectable mode blocks old capture APIs, but Zoom, Teams and Meet may still see sensi. Update Windows to 20H1 or later for full stealth.',
        };
    }

    // Linux / other — best-effort.
    return {
        capability: 'partial',
        platform,
        osRelease,
        buildNumber: null,
        warning:
            'Undetectable mode is active but the effect on Linux depends on your compositor. Some screen-share tools may still see sensi.',
    };
}

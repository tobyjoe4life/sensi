/**
 * HardwareProfile — PERF-03 (v2.17.0).
 *
 * Detects whether sensi is running on a resource-constrained machine and
 * auto-seeds the `lowResourceMode` setting on first launch only. Never
 * overwrites a user-set value.
 *
 * Thresholds (an OR of either triggers low-res mode):
 *   - CPU cores     ≤ 4 logical cores
 *   - Physical RAM  < 8 GB
 *
 * Notes:
 * - Uses `os.cpus().length` for logical core count (reasonable proxy; we
 *   don't need a perfect physical-core number to make a UX call).
 * - Uses `os.totalmem()` for RAM; Electron running on Windows sometimes
 *   reports slightly less than installed, so the threshold is set with a
 *   small margin (7.7 GB boundary — hosts with 8 GB sticks will pass).
 */

import os from 'node:os';
import { SettingsManager } from './SettingsManager';

export interface HardwareProfile {
    cores: number;
    gbRam: number;
    isLowResource: boolean;
    reason: string | null;
}

const CORE_THRESHOLD = 4;
const RAM_GB_THRESHOLD = 7.7;

export function detectHardware(): HardwareProfile {
    const cores = os.cpus().length;
    const gbRam = os.totalmem() / 1024 ** 3;
    const reasons: string[] = [];
    if (cores <= CORE_THRESHOLD) reasons.push(`${cores} cores`);
    if (gbRam < RAM_GB_THRESHOLD) reasons.push(`${gbRam.toFixed(1)} GB RAM`);
    const isLowResource = reasons.length > 0;
    return {
        cores,
        gbRam,
        isLowResource,
        reason: isLowResource ? reasons.join(' and ') : null,
    };
}

/**
 * Runs on app boot. If hardware was already detected, no-ops. Otherwise
 * seeds `lowResourceMode` to the detected value (without overriding any
 * explicit user setting written later).
 */
export function bootstrapHardwareProfile(): HardwareProfile {
    const settings = SettingsManager.getInstance();
    const profile = detectHardware();
    const alreadyDetected = settings.get('hardwareDetectedAt');
    if (!alreadyDetected) {
        const existing = settings.get('lowResourceMode');
        if (existing === undefined) {
            settings.set('lowResourceMode', profile.isLowResource);
        }
        settings.set('hardwareDetectedAt', Date.now());
        console.log(
            `[HardwareProfile] first launch: cores=${profile.cores}, ram=${profile.gbRam.toFixed(1)}GB → lowResourceMode=${profile.isLowResource}${profile.reason ? ` (${profile.reason})` : ''}`,
        );
    }
    return profile;
}

export function isLowResourceMode(): boolean {
    return SettingsManager.getInstance().get('lowResourceMode') === true;
}

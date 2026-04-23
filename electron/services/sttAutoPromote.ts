/**
 * sensi M3-T2 — STT provider auto-promotion helper.
 *
 * When a user saves an STT provider API key while no STT provider is
 * selected (fresh install default is 'none'), promote that provider to
 * active automatically. Without this, saving a Deepgram key alone is a
 * dead-end UX — the "Transcription Not Configured" banner stays up until
 * the user manually opens the STT dropdown and picks Deepgram, even
 * though a valid key is already persisted.
 *
 * The guard only fires when sttProvider === 'none' so an explicit user
 * choice is never overridden. A user with Google selected who pastes a
 * Deepgram key for later should stay on Google.
 *
 * Pure function, extracted from the ipcHandlers.ts handler so it can be
 * unit-tested in isolation without pulling in the ipcMain.handle
 * registration side effects at module load time.
 */

import type { CredentialsManager } from './CredentialsManager';

export function maybeAutoPromoteDeepgram(
  cm: CredentialsManager,
  apiKey: string
): boolean {
  if (apiKey && cm.getSttProvider() === 'none') {
    cm.setSttProvider('deepgram');
    return true;
  }
  return false;
}

/**
 * sensi M4-T9 — Renderer-side mapping from typed `KnowledgeIpcErrorType`
 * values to short, user-facing messages.
 *
 * The renderer MUST switch on `errorType` (not the free-form `error`
 * string) per the M4-T8 contract (DECISIONS.md D021). This module is the
 * single place where those error categories become display text, so that:
 *   1. The mapping is exhaustive (compile-time check via the exhaustive
 *      `never` default branch).
 *   2. It's pure and testable from the vitest harness without a DOM.
 *   3. Tests catch any future addition to `KnowledgeIpcErrorType` that
 *      forgets to add a user-facing message.
 *
 * No stack traces, no raw path leaks, no free-form string parsing.
 */

import type { KnowledgeIpcErrorType } from '../types/electron';

export function errorTypeToMessage(errorType: KnowledgeIpcErrorType): string {
    switch (errorType) {
        case 'invalid_input':
            return 'Invalid input. Check the file path or query and try again.';
        case 'ingest_failed':
            return 'Could not ingest this document. Check that the file exists and is a PDF, DOCX, Markdown, or plain-text file.';
        case 'query_failed':
            return 'The knowledge query failed. Try again, or check that your embedding provider (Ollama or Gemini) is reachable.';
        case 'model_mismatch':
            return 'Stored documents use a different embedding model than the active one. Re-enable the original provider or re-ingest these documents.';
        case 'provider_unavailable':
            return 'No embedding provider is available. Start Ollama (`ollama serve`) or add a Gemini API key in Settings → AI Providers.';
        case 'not_found':
            return 'Document not found. It may have been deleted.';
        case 'dimension_mismatch':
            return 'Embedding dimension mismatch. This document needs to be re-ingested with a compatible provider.';
        case 'export_failed':
            return 'Export failed. Check that the selected location is writable and try again.';
        case 'import_failed':
            return 'Import failed. Check that the file is readable and has not been modified, then try again.';
        case 'incompatible_format':
            return 'This file is not a supported sensi knowledge export. Confirm it was produced by this version and try again.';
        case 'internal':
            return 'An unexpected error occurred. Check the application logs for details.';
        default: {
            // Exhaustiveness check — surfaces a TS compile error if a new
            // `KnowledgeIpcErrorType` variant is added without updating
            // this switch.
            const _exhaustive: never = errorType;
            return `Unknown error (${String(_exhaustive)}).`;
        }
    }
}

/**
 * Ordered list of every `KnowledgeIpcErrorType` value used as the source
 * of truth for the exhaustiveness test in `providers.test.ts`. Keeping
 * this in sync with `KnowledgeIpcErrorType` is the test's job.
 */
export const ALL_KNOWLEDGE_ERROR_TYPES: readonly KnowledgeIpcErrorType[] = [
    'invalid_input',
    'ingest_failed',
    'query_failed',
    'model_mismatch',
    'provider_unavailable',
    'not_found',
    'dimension_mismatch',
    'export_failed',
    'import_failed',
    'incompatible_format',
    'internal',
];

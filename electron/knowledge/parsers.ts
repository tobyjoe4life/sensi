/**
 * sensi M4-T2 — Document parser helpers.
 *
 * Four narrow, pure-ish helpers that convert a `Buffer` of file bytes into
 * plain text ready for downstream chunking (M4-T3) and embedding (M4-T5).
 *
 * Contract for every helper:
 *   - Input is a `Buffer` of file bytes. The helper NEVER reads from the
 *     filesystem — callers (main-process orchestrator in M4-T6) are
 *     responsible for reading files and passing the buffer here.
 *   - Output is a normalized string: line endings normalized to LF,
 *     3+ consecutive blank lines collapsed to exactly 2 (preserving
 *     paragraph boundaries), outer whitespace trimmed.
 *   - Empty buffer → empty string. Near-empty inputs return trimmed
 *     content consistently. Malformed PDF/DOCX buffers throw — callers
 *     should wrap in try/catch and surface the error to the user.
 *   - No provider calls, no IPC, no DB writes, no MIME detection.
 *     M4-T6 handles routing by MIME; this file handles one format per
 *     helper.
 *
 * Trust boundary: this file lives in main-process code (electron/).
 * Parsers are invoked by the M4-T6 orchestrator, which is in turn invoked
 * by the M4-T8 IPC handler. Renderer never imports this module. See
 * SECURITY.md B3/B4.
 */

import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

/**
 * Normalize parser output for downstream chunking:
 *  - Normalize CRLF / CR line endings to LF
 *  - Collapse runs of 3+ newlines to exactly 2 (keeps paragraph breaks)
 *  - Trim outer whitespace
 */
function normalize(text: string): string {
    return text
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Extract plain text from PDF bytes using `pdf-parse` (which delegates to
 * pdfjs-dist under the hood). Empty buffer returns an empty string without
 * invoking the parser. All other parse failures throw — let the caller
 * decide whether to surface the error.
 */
export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
    if (buffer.length === 0) return '';

    // pdf-parse v2 exposes a class-based API: construct with `data`, call
    // `getText()`, then `destroy()` to release the pdfjs document handle.
    // The constructor auto-converts `Buffer` to `Uint8Array` internally.
    // `verbosity: 0` silences pdfjs's console noise in tests + production.
    const parser = new PDFParse({ data: buffer, verbosity: 0 });
    try {
        const result = await parser.getText();
        return normalize(result.text ?? '');
    } finally {
        try {
            await parser.destroy();
        } catch {
            /* best-effort cleanup; destroy errors are non-fatal */
        }
    }
}

/**
 * Extract plain text from DOCX bytes using `mammoth.extractRawText`.
 * Empty buffer returns an empty string without invoking the parser.
 * Raw text mode strips all formatting — paragraph boundaries become
 * newlines, nothing else is preserved. Perfect for embedding.
 */
export async function extractTextFromDocx(buffer: Buffer): Promise<string> {
    if (buffer.length === 0) return '';

    const result = await mammoth.extractRawText({ buffer });
    return normalize(result.value ?? '');
}

/**
 * Extract plain text from a Markdown buffer. Markdown text is returned
 * verbatim — headings (`#`), lists, emphasis, etc. survive into the
 * output. Downstream chunking and embedding can handle markdown
 * formatting fine, and stripping it would lose signal the model can
 * use to understand document structure.
 *
 * Decoded as UTF-8. Empty buffer returns empty string.
 */
export function extractTextFromMarkdown(buffer: Buffer): string {
    if (buffer.length === 0) return '';
    return normalize(buffer.toString('utf-8'));
}

/**
 * Extract plain text from a plain-text buffer. Decoded as UTF-8. Empty
 * buffer returns empty string.
 */
export function extractTextFromPlain(buffer: Buffer): string {
    if (buffer.length === 0) return '';
    return normalize(buffer.toString('utf-8'));
}

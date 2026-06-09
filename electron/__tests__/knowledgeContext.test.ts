import { describe, expect, it, vi } from 'vitest';
import { buildKnowledgeContextBlock } from '../knowledge/buildKnowledgeContext';
import type { KnowledgeDocument, RetrievedChunk } from '../knowledge/KnowledgeStore';

describe('buildKnowledgeContextBlock', () => {
    it('does not inject or retrieve unpinned uploads', async () => {
        const queryKnowledge = vi.fn(async (): Promise<RetrievedChunk[]> => []);
        const listDocuments = vi.fn(() => [makeDoc('u1', 'Unpinned.pdf', false)]);
        const orchestrator = {
            listPinned: (): KnowledgeDocument[] => [],
            listDocuments,
            getDocumentText: () => 'unpinned content',
            queryKnowledge,
        } as any;

        const block = await buildKnowledgeContextBlock({
            orchestrator,
            query: 'Tell me about the uploaded file',
        });

        expect(block).toBe('');
        expect(listDocuments).not.toHaveBeenCalled();
        expect(queryKnowledge).not.toHaveBeenCalled();
    });

    it('includes pinned documents with the pinned heading', async () => {
        const pinned = makeDoc('p1', 'Pinned.pdf', true);
        const block = await buildKnowledgeContextBlock({
            orchestrator: {
                listPinned: () => [pinned],
                getDocumentText: () => 'Pinned content that should be injected.',
                queryKnowledge: async () => [],
            },
            query: '',
        });

        expect(block).toContain('[Pinned Knowledge]');
        expect(block).toContain('Pinned.pdf');
        expect(block).toContain('Pinned content');
        expect(block).not.toContain('[Uploaded Knowledge]');
    });

    it('restricts retrieval to pinned document ids only', async () => {
        const pinned = makeDoc('p1', 'Pinned.pdf', true);
        const queryKnowledge = vi.fn(async (): Promise<RetrievedChunk[]> => [
            {
                documentId: 'p1',
                documentName: 'Pinned.pdf',
                chunkIndex: 0,
                text: 'Retrieved pinned content.',
                distance: 0.1,
            },
            {
                documentId: 'u1',
                documentName: 'Unpinned.pdf',
                chunkIndex: 0,
                text: 'This should not enter context.',
                distance: 0.05,
            },
        ]);

        const block = await buildKnowledgeContextBlock({
            orchestrator: {
                listPinned: () => [pinned],
                getDocumentText: () => 'Pinned top-level content.',
                queryKnowledge,
            },
            query: 'recent question',
        });

        expect(queryKnowledge).toHaveBeenCalledWith(
            expect.objectContaining({ documentIds: ['p1'] })
        );
        expect(block).toContain('Retrieved pinned content');
        expect(block).not.toContain('This should not enter context');
    });
});

function makeDoc(id: string, name: string, pinned: boolean): KnowledgeDocument {
    return {
        id,
        name,
        mime: 'application/pdf',
        bytes: 1234,
        embeddingModel: 'nomic-embed-text',
        embeddingDim: 768,
        pinned,
        pinnedAt: pinned ? '2026-06-05T00:00:00.000Z' : null,
        ingestedAt: '2026-06-05T00:00:00.000Z',
        chunkCount: 1,
    };
}

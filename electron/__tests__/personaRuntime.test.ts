import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRuntime = vi.hoisted(() => ({
    db: null as unknown,
    orchestrator: {
        listDocuments: vi.fn(),
        listPinned: vi.fn(),
        resolveEmbeddingProvider: vi.fn(),
    },
    personaManager: {
        bind: vi.fn(),
        isBound: vi.fn(),
        getLatest: vi.fn(),
    },
}));

vi.mock('../db/DatabaseManager', () => ({
    DatabaseManager: {
        getInstance: () => ({
            getDb: () => mockRuntime.db,
            getKnowledgeOrchestrator: () => mockRuntime.orchestrator,
        }),
    },
}));

vi.mock('../persona/PersonaManager', () => ({
    PersonaManager: {
        getInstance: () => mockRuntime.personaManager,
    },
}));

describe('personaRuntime', () => {
    beforeEach(() => {
        mockRuntime.db = null;
        vi.clearAllMocks();
        mockRuntime.orchestrator.listDocuments.mockReturnValue([]);
        mockRuntime.orchestrator.listPinned.mockReturnValue([]);
        mockRuntime.orchestrator.resolveEmbeddingProvider.mockResolvedValue({
            provider: 'openai',
            model: 'text-embedding-3-small',
            dimension: 768,
        });
        mockRuntime.personaManager.isBound.mockReturnValue(true);
        mockRuntime.personaManager.getLatest.mockReturnValue(null);
    });

    it('throws a clear unavailable error when the database is not ready', async () => {
        const { bindPersonaManagerFromDatabase, PersonaRuntimeUnavailableError } =
            await import('../persona/personaRuntime');

        expect(() =>
            bindPersonaManagerFromDatabase({ llmHelperProvider: () => null })
        ).toThrow(PersonaRuntimeUnavailableError);
    });

    it('binds PersonaManager to the live database handle', async () => {
        const { bindPersonaManagerFromDatabase } = await import('../persona/personaRuntime');
        const db = { prepare: vi.fn(), exec: vi.fn() };
        mockRuntime.db = db;

        const manager = bindPersonaManagerFromDatabase({ llmHelperProvider: () => null });

        expect(manager).toBe(mockRuntime.personaManager);
        expect(mockRuntime.personaManager.bind).toHaveBeenCalledWith({
            db,
            llmHelperProvider: expect.any(Function),
        });
    });

    it('reports profile context health', async () => {
        const { getProfileContextHealth } = await import('../persona/personaRuntime');
        mockRuntime.db = { prepare: vi.fn(), exec: vi.fn() };
        mockRuntime.personaManager.getLatest.mockReturnValue({ id: 1 });
        mockRuntime.orchestrator.listDocuments.mockReturnValue([{ id: 'd1' }, { id: 'd2' }]);
        mockRuntime.orchestrator.listPinned.mockReturnValue([{ id: 'd1' }]);

        const health = await getProfileContextHealth({ llmHelperProvider: () => null });

        expect(health).toMatchObject({
            dbReady: true,
            personaBound: true,
            personaPresent: true,
            knowledgeDocumentCount: 2,
            pinnedKnowledgeCount: 1,
            embeddingProvider: 'openai',
            embeddingModel: 'text-embedding-3-small',
            embeddingReady: true,
            error: null,
        });
    });
});

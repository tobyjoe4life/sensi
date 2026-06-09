import { DatabaseManager } from '../db/DatabaseManager';
import type { LLMHelper } from '../LLMHelper';
import type { EmbeddingConfig } from '../knowledge/EmbeddingAdapter';
import { PersonaManager } from './PersonaManager';

export class PersonaRuntimeUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PersonaRuntimeUnavailableError';
    }
}

export interface PersonaRuntimeDeps {
    llmHelperProvider: () => LLMHelper | null;
}

export interface ProfileContextHealth {
    dbReady: boolean;
    personaBound: boolean;
    personaPresent: boolean;
    knowledgeDocumentCount: number;
    pinnedKnowledgeCount: number;
    embeddingProvider: EmbeddingConfig['provider'] | null;
    embeddingModel: string | null;
    embeddingReady: boolean;
    error: string | null;
}

export function bindPersonaManagerFromDatabase(
    deps: PersonaRuntimeDeps
): PersonaManager {
    const db = DatabaseManager.getInstance().getDb();
    if (!db) {
        throw new PersonaRuntimeUnavailableError(
            'The local Sensi database is unavailable, so persona and knowledge cannot bind yet. Restart Sensi or install the repaired Windows build.'
        );
    }

    const manager = PersonaManager.getInstance();
    manager.bind({
        db: db as any,
        llmHelperProvider: deps.llmHelperProvider,
    });
    return manager;
}

export async function getProfileContextHealth(
    deps: PersonaRuntimeDeps
): Promise<ProfileContextHealth> {
    const health: ProfileContextHealth = {
        dbReady: false,
        personaBound: false,
        personaPresent: false,
        knowledgeDocumentCount: 0,
        pinnedKnowledgeCount: 0,
        embeddingProvider: null,
        embeddingModel: null,
        embeddingReady: false,
        error: null,
    };

    const db = DatabaseManager.getInstance().getDb();
    if (!db) {
        health.error =
            'Local database is unavailable. Persona and knowledge context cannot bind until SQLite starts successfully.';
        return health;
    }

    health.dbReady = true;

    try {
        const manager = bindPersonaManagerFromDatabase(deps);
        health.personaBound = manager.isBound();
        health.personaPresent = manager.getLatest('resume') !== null;
    } catch (e) {
        health.error = getPersonaRuntimeErrorMessage(e);
    }

    try {
        const orchestrator = DatabaseManager.getInstance().getKnowledgeOrchestrator() as any;
        const docs = orchestrator.listDocuments();
        const pinned = orchestrator.listPinned();
        health.knowledgeDocumentCount = Array.isArray(docs) ? docs.length : 0;
        health.pinnedKnowledgeCount = Array.isArray(pinned) ? pinned.length : 0;

        if (typeof orchestrator.resolveEmbeddingProvider === 'function') {
            const config = await orchestrator.resolveEmbeddingProvider();
            health.embeddingProvider = config.provider;
            health.embeddingModel = config.model;
            health.embeddingReady = true;
        }
    } catch (e) {
        health.embeddingReady = false;
        health.error = health.error ?? getErrorMessage(e);
    }

    return health;
}

export function getPersonaRuntimeErrorMessage(
    error: unknown,
    fallback = 'Persona and knowledge context are unavailable right now.'
): string {
    if (error instanceof PersonaRuntimeUnavailableError) return error.message;
    if (error instanceof Error && error.message === 'PersonaManager not bound') {
        return (
            'PersonaManager could not bind to the local database. Restart Sensi or install the repaired Windows build so persona and knowledge context can load.'
        );
    }
    return getErrorMessage(error, fallback);
}

function getErrorMessage(
    error: unknown,
    fallback = 'Unknown profile-context error.'
): string {
    return error instanceof Error ? error.message || fallback : fallback;
}

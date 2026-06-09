import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
    app: {
        getPath: () => process.cwd(),
    },
    safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: (value: string) => Buffer.from(value, 'utf8'),
        decryptString: (value: Buffer) => value.toString('utf8'),
    },
}));

describe('EmbeddingAdapter OpenAI fallback', () => {
    it('uses OpenAI when Ollama is unavailable and Gemini has no key', async () => {
        const { EmbeddingAdapter } = await import('../knowledge/EmbeddingAdapter');
        const embedWithOpenAI = vi.fn(async (texts: readonly string[], apiKey: string) => {
            expect(apiKey).toBe('sk-test');
            return texts.map(() => new Float32Array(768));
        });

        const adapter = new EmbeddingAdapter({
            probeOllama: async () => false,
            getGeminiApiKey: () => null,
            getOpenaiApiKey: () => 'sk-test',
            embedWithOpenAI,
        });

        const vectors = await adapter.embed(['hello']);

        expect(embedWithOpenAI).toHaveBeenCalledWith(['hello'], 'sk-test');
        expect(vectors).toHaveLength(1);
        expect(vectors[0]).toHaveLength(768);
        expect(adapter.getActiveEmbeddingConfig()).toEqual({
            provider: 'openai',
            model: 'text-embedding-3-small',
            dimension: 768,
        });
    });

    it('resolves OpenAI without consuming an embedding request', async () => {
        const { EmbeddingAdapter } = await import('../knowledge/EmbeddingAdapter');
        const embedWithOpenAI = vi.fn(async (): Promise<Float32Array[]> => []);
        const adapter = new EmbeddingAdapter({
            probeOllama: async () => false,
            getGeminiApiKey: () => null,
            getOpenaiApiKey: () => 'sk-test',
            embedWithOpenAI,
        });

        await expect(adapter.resolveProvider()).resolves.toEqual({
            provider: 'openai',
            model: 'text-embedding-3-small',
            dimension: 768,
        });
        expect(embedWithOpenAI).not.toHaveBeenCalled();
    });
});

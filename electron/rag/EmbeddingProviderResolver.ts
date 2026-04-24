import { IEmbeddingProvider } from './providers/IEmbeddingProvider';
import { OpenAIEmbeddingProvider } from './providers/OpenAIEmbeddingProvider';
import { GeminiEmbeddingProvider } from './providers/GeminiEmbeddingProvider';
import { OllamaEmbeddingProvider } from './providers/OllamaEmbeddingProvider';

export interface AppAPIConfig {
  openaiKey?: string;
  geminiKey?: string;
  ollamaUrl?: string; // e.g. 'http://localhost:11434'
}

export class EmbeddingProviderResolver {
  /**
   * Returns the best available provider.
   * Runs isAvailable() checks in priority order: OpenAI → Gemini → Ollama.
   * v2.17.1: LocalEmbeddingProvider (Xenova/all-MiniLM via
   * @xenova/transformers) was removed — the 95 MB dep + ~250 MB ONNX
   * download was too expensive for a fallback that only triggered when
   * every cloud key + Ollama was missing. If no cloud key is set and
   * Ollama isn't running, RAG is disabled rather than silently falling
   * back to on-device. Run `ollama serve` or add an OpenAI/Gemini key
   * in Settings → AI Providers to enable embeddings.
   */
  static async resolve(config: AppAPIConfig): Promise<IEmbeddingProvider> {
    const candidates: IEmbeddingProvider[] = [];

    if (config.openaiKey) {
      candidates.push(new OpenAIEmbeddingProvider(config.openaiKey));
    }
    if (config.geminiKey) {
      candidates.push(new GeminiEmbeddingProvider(config.geminiKey));
    }

    candidates.push(new OllamaEmbeddingProvider(config.ollamaUrl || 'http://localhost:11434'));

    for (const provider of candidates) {
      const available = await provider.isAvailable();
      if (available) {
        console.log(`[EmbeddingProviderResolver] Selected provider: ${provider.name} (${provider.dimensions}d)`);
        return provider;
      }
      console.log(`[EmbeddingProviderResolver] Provider ${provider.name} unavailable, trying next...`);
    }

    throw new Error(
      'No embedding provider available. Add an OpenAI or Gemini API key in Settings → AI Providers, or start Ollama locally.',
    );
  }
}

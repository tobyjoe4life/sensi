// v2.17.1: @xenova/transformers was removed. Both models that this
// script used to pre-fetch (all-MiniLM for embeddings, mobilebert for
// intent classification) are no longer used. The script is kept as a
// no-op so the `postinstall` script reference in package.json continues
// to resolve without error; we can delete it after the next install.

console.log('[download-models] No models to pre-fetch (xenova/transformers removed in v2.17.1). Skipping.');

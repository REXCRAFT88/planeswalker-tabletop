// Thin facade over the provider registry. Kept so the rest of the server can import
// a stable surface regardless of which LLM provider(s) are configured.
export { callLLM, anyEnabled as aiEnabled, availableProviders, defaultProvider } from './providers';
export type { LLMRequest, LLMResult, NormMessage } from './providers';

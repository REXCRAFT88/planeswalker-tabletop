import type { LLMProvider, LLMRequest, LLMResult, AiProviderId } from './types';
import { anthropicProvider } from './anthropic';
import { openaiProvider } from './openai';
import { geminiProvider } from './gemini';

const PROVIDERS: Record<AiProviderId, LLMProvider> = {
    anthropic: anthropicProvider,
    openai: openaiProvider,
    gemini: geminiProvider,
};

const ORDER: AiProviderId[] = ['anthropic', 'openai', 'gemini'];

// The default provider: honor AI_PROVIDER if its key is set, else the first
// provider that has a key.
export function defaultProvider(): AiProviderId | null {
    const pref = process.env.AI_PROVIDER as AiProviderId | undefined;
    if (pref && PROVIDERS[pref]?.enabled()) return pref;
    for (const id of ORDER) if (PROVIDERS[id].enabled()) return id;
    return null;
}

export function availableProviders(): { id: AiProviderId; label: string }[] {
    return ORDER.filter(id => PROVIDERS[id].enabled()).map(id => ({ id, label: PROVIDERS[id].label }));
}

export function anyEnabled(): boolean {
    return defaultProvider() !== null;
}

// Resolve a provider, preferring the requested one when it's available.
function pickProvider(requested?: AiProviderId): LLMProvider | null {
    if (requested && PROVIDERS[requested]?.enabled()) return PROVIDERS[requested];
    const def = defaultProvider();
    return def ? PROVIDERS[def] : null;
}

export async function callLLM(req: LLMRequest, provider?: AiProviderId): Promise<LLMResult & { provider: AiProviderId }> {
    const p = pickProvider(provider);
    if (!p) throw new Error('No AI provider is configured (set an API key).');
    const result = await p.generate(req);
    return { ...result, provider: p.id };
}

export type { LLMRequest, LLMResult, NormMessage, NormTool } from './types';

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

// Hard ceiling on a single provider call. Kept under typical hosting proxy limits
// (~100s) so we surface a clean error instead of letting the platform 502 us.
const LLM_TIMEOUT_MS = parseInt(process.env.AI_TIMEOUT_MS || '75000', 10);

class TimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const t = setTimeout(() => reject(new TimeoutError(`${label} timed out after ${ms}ms`)), ms);
        promise.then(
            v => { clearTimeout(t); resolve(v); },
            e => { clearTimeout(t); reject(e); },
        );
    });
}

// Transient failures (5xx, overload, timeouts, network) are worth one retry;
// 4xx (bad key, bad request) are not.
function isRetryable(e: any): boolean {
    if (e instanceof TimeoutError) return true;
    const status = e?.status ?? e?.statusCode;
    if (typeof status === 'number') return status >= 500 || status === 429;
    // No HTTP status → network/stream error; retry once.
    return true;
}

export async function callLLM(req: LLMRequest, provider?: AiProviderId): Promise<LLMResult & { provider: AiProviderId }> {
    const p = pickProvider(provider);
    if (!p) throw new Error('No AI provider is configured (set an API key).');

    const started = Date.now();
    let lastErr: any;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const result = await withTimeout(p.generate(req), LLM_TIMEOUT_MS, `${p.id} generate`);
            console.log(`[AI] ${p.id} ok in ${Date.now() - started}ms (attempt ${attempt + 1})`);
            return { ...result, provider: p.id };
        } catch (e: any) {
            lastErr = e;
            const status = e?.status ?? e?.statusCode ?? '—';
            console.error(`[AI] ${p.id} attempt ${attempt + 1} failed after ${Date.now() - started}ms: status=${status} ${e?.message || e}`);
            if (attempt === 0 && isRetryable(e)) continue;
            break;
        }
    }
    throw lastErr;
}

export type { LLMRequest, LLMResult, NormMessage, NormTool } from './types';

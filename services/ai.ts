// Browser-side client for the server AI endpoints (/api/ai/*). The API is served
// by the same Node process as Socket.IO: same origin in production, localhost:3001
// in dev.
import type {
    GameStateView, AiDeckCard, AiToolResult, AiTurnResponse, AiMulliganResponse,
    AiPersonaId, AiDifficulty, AiCardRef, AiProviderId,
} from './aiTypes';

const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';

export interface AiStatus {
    enabled: boolean;
    providers: { id: AiProviderId; label: string }[];
    defaultProvider: AiProviderId | null;
    realtimeVoice: boolean; // OpenAI Realtime voice backend available
    configured?: { anthropic: boolean; openai: boolean; gemini: boolean };
}

export interface AiConfigUpdate {
    anthropicKey?: string;
    openaiKey?: string;
    geminiKey?: string;
    defaultProvider?: AiProviderId | '';
    adminPin?: string;
}

export function getLocalAiKeys(): Record<string, string> {
    try {
        const stored = localStorage.getItem('planeswalker_ai_keys');
        return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
}

export function saveLocalAiKeys(keys: Record<string, string>) {
    localStorage.setItem('planeswalker_ai_keys', JSON.stringify(keys));
}

// Push provider keys to the server (held in server memory only, never returned).
export async function saveAiConfig(update: AiConfigUpdate): Promise<AiStatus> {
    const { adminPin, ...body } = update;

    const localKeys = getLocalAiKeys();
    if (body.anthropicKey !== undefined) localKeys.anthropic = body.anthropicKey;
    if (body.openaiKey !== undefined) localKeys.openai = body.openaiKey;
    if (body.geminiKey !== undefined) localKeys.gemini = body.geminiKey;
    saveLocalAiKeys(localKeys);

    const resp = await fetch(`${API_BASE}/api/ai/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(adminPin ? { 'x-admin-pin': adminPin } : {}) },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        let detail = '';
        try { detail = (await resp.json())?.error || ''; } catch { /* ignore */ }
        throw new Error(detail || `Failed to save AI settings (${resp.status})`);
    }
    return resp.json();
}

// fetch() has no default timeout, so a stalled network request would hang an AI
// turn forever. Bound each call (a little above the server's own 75s ceiling so
// the server's structured error wins the race when it can) and abort otherwise.
const CLIENT_TIMEOUT_MS = 90_000;

async function post<T>(path: string, body: any): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CLIENT_TIMEOUT_MS);
    let resp: Response;
    try {
        const fullBody = { ...body, apiKeys: getLocalAiKeys() };
        resp = await fetch(`${API_BASE}/api/ai${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fullBody),
            signal: ctrl.signal,
        });
    } catch (e: any) {
        if (e?.name === 'AbortError') throw new Error('AI request timed out');
        throw e;
    } finally {
        clearTimeout(timer);
    }
    if (!resp.ok) {
        let detail = '';
        try { detail = (await resp.json())?.error || ''; } catch { /* ignore */ }
        throw new Error(detail || `AI request failed (${resp.status})`);
    }
    return resp.json();
}

let cachedEnabled: boolean | null = null;

// Whether the server has any provider configured, and which are available.
export async function aiStatus(): Promise<AiStatus> {
    try {
        const resp = await fetch(`${API_BASE}/api/ai/status`);
        if (!resp.ok) return { enabled: false, providers: [], defaultProvider: null, realtimeVoice: false };
        const data = await resp.json();
        
        const localKeys = getLocalAiKeys();
        const localEnabled = !!localKeys.anthropic || !!localKeys.openai || !!localKeys.gemini;
        cachedEnabled = !!data.enabled || localEnabled;
        
        const providers = [...(data.providers || [])];
        if (localKeys.anthropic && !providers.find(p => p.id === 'anthropic')) providers.push({ id: 'anthropic', label: 'Claude' });
        if (localKeys.openai && !providers.find(p => p.id === 'openai')) providers.push({ id: 'openai', label: 'ChatGPT' });
        if (localKeys.gemini && !providers.find(p => p.id === 'gemini')) providers.push({ id: 'gemini', label: 'Gemini' });

        return { 
            enabled: cachedEnabled, 
            providers, 
            defaultProvider: data.defaultProvider ?? null, 
            realtimeVoice: !!data.realtimeVoice || !!localKeys.openai 
        };
    } catch {
        cachedEnabled = false;
        return { enabled: false, providers: [], defaultProvider: null, realtimeVoice: false };
    }
}

export function aiKnownEnabled(): boolean | null {
    return cachedEnabled;
}

export interface MulliganArgs {
    seatName: string;
    persona: AiPersonaId;
    difficulty: AiDifficulty;
    deckSummary: string;
    hand: AiCardRef[];
    provider?: AiProviderId;
    model?: string;
    apiKeys?: Record<string, string>;
}

export function requestMulligan(args: MulliganArgs): Promise<AiMulliganResponse> {
    return post<AiMulliganResponse>('/mulligan', args);
}

export interface TurnArgs {
    seatName: string;
    persona: AiPersonaId;
    difficulty: AiDifficulty;
    deck: AiDeckCard[];
    stateView: GameStateView;
    provider?: AiProviderId;
    model?: string;
    apiKeys?: Record<string, string>;
}

export function requestTurn(args: TurnArgs): Promise<AiTurnResponse> {
    return post<AiTurnResponse>('/turn', args);
}

export function continueTurn(conversationId: string, toolResults: AiToolResult[]): Promise<AiTurnResponse> {
    return post<AiTurnResponse>('/continue', { conversationId, toolResults });
}

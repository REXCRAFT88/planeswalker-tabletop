import express from 'express';
import { aiEnabled, callLLM, availableProviders, defaultProvider } from './client';
import type { NormMessage } from './client';
import { TURN_TOOLS, MULLIGAN_TOOL } from './tools';
import { buildTurnSystemPrompt, buildMulliganSystemPrompt, formatStateView } from './prompts';
import { runVoiceReply, consultStrategist, buildVoiceInstructions, REALTIME_TOOLS } from './voice';
import type {
    AiDeckCard, GameStateView, AiToolResult, AiPersonaId, AiUsage, AiProviderId, VoiceChatTurn,
} from '../../services/aiTypes';

const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime';
const REALTIME_VOICE = process.env.OPENAI_REALTIME_VOICE || 'alloy';
const REALTIME_CALLS_URL = process.env.OPENAI_REALTIME_URL || 'https://api.openai.com/v1/realtime/calls';

const MAX_ROUNDS = parseInt(process.env.AI_MAX_ROUNDS || '12', 10);
const CONVO_TTL_MS = 90 * 1000;
const MAX_BODY = 200 * 1024; // ~200 KB per request

interface Conversation {
    system: string;
    tools: any[];
    messages: NormMessage[];
    effort: 'low' | 'medium' | 'high';
    provider?: AiProviderId;
    rounds: number;
    lastUsed: number;
}

const conversations = new Map<string, Conversation>();

// Reap idle conversations so the in-memory store can't grow unbounded.
const reaper: any = setInterval(() => {
    const now = Date.now();
    for (const [id, c] of conversations) {
        if (now - c.lastUsed > CONVO_TTL_MS) conversations.delete(id);
    }
}, 30 * 1000);
reaper.unref?.();

function newId(): string {
    return 'aiconv-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function effortFor(difficulty: string | undefined): 'low' | 'medium' | 'high' {
    return difficulty === 'competitive' ? 'high' : 'medium';
}

// Turn a provider error into a structured response so the client never has to
// parse prose or hang. Timeouts map to 504 and are flagged retryable.
function errorResponse(res: express.Response, e: any, label: string, extra: Record<string, any> = {}) {
    const msg = String(e?.message || e || 'unknown error');
    const isTimeout = /timed out/i.test(msg);
    const status = e?.status ?? e?.statusCode;
    const retryable = isTimeout || (typeof status === 'number' && (status >= 500 || status === 429)) || status === undefined;
    console.error(`[AI] ${label} error (status=${status ?? '—'} retryable=${retryable}):`, msg);
    res.status(isTimeout ? 504 : 502).json({ error: `AI ${label} failed`, detail: msg, retryable, ...extra });
}

export function createAiRouter(): express.Router {
    const router = express.Router();
    router.use(express.json({ limit: MAX_BODY }));

    // Lets the client hide/disable AI features and pick a provider / voice backend.
    router.get('/status', (_req, res) => {
        const providers = availableProviders();
        res.json({
            enabled: aiEnabled(),
            providers,
            defaultProvider: defaultProvider(),
            realtimeVoice: !!process.env.OPENAI_API_KEY, // OpenAI Realtime voice backend
        });
    });

    router.use((req, res, next) => {
        if (req.path === '/status') return next();
        if (!aiEnabled()) {
            return res.status(503).json({ error: 'AI is unavailable: the server has no API key configured for any provider.' });
        }
        next();
    });

    router.post('/mulligan', async (req, res) => {
        try {
            const { seatName, persona, difficulty, deckSummary, hand, provider } = req.body || {};
            if (!Array.isArray(hand)) return res.status(400).json({ error: 'hand[] required' });

            const system = buildMulliganSystemPrompt((persona as AiPersonaId) || 'balanced', seatName || 'AI', deckSummary || '');
            const handText = hand.map((c: any) => `- ${c.name}${c.typeLine ? ' (' + c.typeLine + ')' : ''}`).join('\n');
            const result = await callLLM({
                system,
                messages: [{ role: 'user', text: `Your opening hand:\n${handText}\n\nDecide.` }],
                tools: [MULLIGAN_TOOL],
                toolChoice: 'mulligan_decision',
                effort: effortFor(difficulty),
                maxTokens: 2048,
            }, provider as AiProviderId);
            const call = result.toolCalls.find(t => t.name === 'mulligan_decision');
            const input = call?.input || {};
            res.json({
                keep: input.keep !== false,
                bottomCards: Array.isArray(input.bottomCards) ? input.bottomCards : [],
                comment: input.comment || '',
                usage: result.usage,
                provider: result.provider,
            });
        } catch (e: any) {
            errorResponse(res, e, 'mulligan');
        }
    });

    router.post('/turn', async (req, res) => {
        try {
            const { seatName, persona, difficulty, deck, stateView, provider } = req.body || {};
            if (!stateView || !stateView.you) return res.status(400).json({ error: 'stateView required' });

            const system = buildTurnSystemPrompt((persona as AiPersonaId) || 'balanced', seatName || 'AI', (deck as AiDeckCard[]) || []);
            const effort = effortFor(difficulty);
            const messages: NormMessage[] = [{ role: 'user', text: formatStateView(stateView as GameStateView) }];

            const result = await callLLM({ system, messages, tools: TURN_TOOLS, effort }, provider as AiProviderId);
            messages.push({ role: 'assistant', text: result.text, toolCalls: result.toolCalls });

            const id = newId();
            conversations.set(id, { system, tools: TURN_TOOLS, messages, effort, provider: result.provider, rounds: 1, lastUsed: Date.now() });

            const endTurn = result.toolCalls.some(t => t.name === 'end_turn');
            res.json({
                conversationId: id,
                toolCalls: result.toolCalls,
                text: result.text,
                done: endTurn || result.done,
                usage: result.usage,
                provider: result.provider,
            });
        } catch (e: any) {
            errorResponse(res, e, 'turn');
        }
    });

    router.post('/continue', async (req, res) => {
        try {
            const { conversationId, toolResults } = req.body || {};
            const convo = conversations.get(conversationId);
            if (!convo) return res.status(404).json({ error: 'conversation expired or not found', done: true });
            if (!Array.isArray(toolResults)) return res.status(400).json({ error: 'toolResults[] required' });

            if (convo.rounds >= MAX_ROUNDS) {
                conversations.delete(conversationId);
                return res.json({ conversationId, toolCalls: [], text: '', done: true, usage: emptyUsage() });
            }

            convo.messages.push({ role: 'tool_results', results: toolResults as AiToolResult[] });
            const result = await callLLM({ system: convo.system, messages: convo.messages, tools: convo.tools, effort: convo.effort }, convo.provider);
            convo.messages.push({ role: 'assistant', text: result.text, toolCalls: result.toolCalls });
            convo.rounds += 1;
            convo.lastUsed = Date.now();

            const endTurn = result.toolCalls.some(t => t.name === 'end_turn');
            const done = endTurn || result.done;
            if (done) conversations.delete(conversationId);

            res.json({ conversationId, toolCalls: result.toolCalls, text: result.text, done, usage: result.usage, provider: result.provider });
        } catch (e: any) {
            errorResponse(res, e, 'continue', { done: true });
        }
    });

    // OpenAI Realtime: mint a short-lived client token bound to a session configured
    // with the negotiator instructions (PUBLIC state only) + the consult/deal tools.
    // The real OpenAI key never leaves the server; the browser gets only the ephemeral
    // token. Hidden state is not placed in the instructions — the Realtime model must
    // call consult_strategist (relayed to /consult) to learn anything about its hand.
    router.post('/realtime/token', async (req, res) => {
        if (!process.env.OPENAI_API_KEY) {
            return res.status(503).json({ error: 'OpenAI Realtime voice requires OPENAI_API_KEY on the server.' });
        }
        try {
            const { seatName, persona, view, dealLog } = req.body || {};
            if (!view || !view.you) return res.status(400).json({ error: 'view required' });
            const instructions = buildVoiceInstructions((persona as AiPersonaId) || 'balanced', seatName || 'AI', view as GameStateView, Array.isArray(dealLog) ? dealLog : []);
            const session = {
                type: 'realtime',
                model: REALTIME_MODEL,
                instructions,
                audio: {
                    input: { transcription: { model: 'whisper-1' }, turn_detection: null },
                    output: { voice: REALTIME_VOICE },
                },
                tools: REALTIME_TOOLS,
                tool_choice: 'auto',
            };
            const r = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
                method: 'POST',
                headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ session }),
            });
            const data: any = await r.json().catch(() => ({}));
            if (!r.ok) return res.status(502).json({ error: 'realtime token failed', detail: data?.error?.message || `HTTP ${r.status}` });
            const token = data?.value || data?.client_secret?.value;
            if (!token) return res.status(502).json({ error: 'realtime token missing in response' });
            res.json({ token, model: REALTIME_MODEL, voice: REALTIME_VOICE, callsUrl: REALTIME_CALLS_URL });
        } catch (e: any) {
            console.error('[AI] realtime token error', e?.message || e);
            res.status(502).json({ error: 'realtime token failed', detail: e?.message });
        }
    });

    // Firewall bridge for the Realtime negotiator: it calls consult_strategist, the
    // client relays the question here, and the brain (which sees the hand) answers.
    router.post('/consult', async (req, res) => {
        try {
            const { question, view, persona, seatName, dealLog, provider } = req.body || {};
            if (!view || !view.you) return res.status(400).json({ error: 'view required' });
            const guidance = await consultStrategist(
                String(question || ''),
                view as GameStateView,
                (persona as AiPersonaId) || 'balanced',
                seatName || 'AI',
                Array.isArray(dealLog) ? dealLog : [],
                provider as AiProviderId,
            );
            res.json({ guidance });
        } catch (e: any) {
            console.error('[AI] consult error', e?.message || e);
            res.status(502).json({ error: 'consult failed', detail: e?.message, guidance: 'Stay vague and reveal nothing specific.' });
        }
    });

    // Voice / negotiation: the player talks to an AI opponent's voice model, which is
    // firewalled from hidden info and consults the strategist (brain) as needed.
    router.post('/voice', async (req, res) => {
        try {
            const { seatName, persona, provider, view, dealLog, history, userText } = req.body || {};
            if (!view || !view.you) return res.status(400).json({ error: 'view required' });
            if (typeof userText !== 'string' || !userText.trim()) return res.status(400).json({ error: 'userText required' });

            const result = await runVoiceReply({
                seatName: seatName || 'AI',
                persona: (persona as AiPersonaId) || 'balanced',
                provider: provider as AiProviderId,
                view: view as GameStateView,
                dealLog: Array.isArray(dealLog) ? dealLog : [],
                history: (Array.isArray(history) ? history : []) as VoiceChatTurn[],
                userText: userText.slice(0, 2000),
            });
            res.json(result);
        } catch (e: any) {
            console.error('[AI] voice error', e?.message || e);
            res.status(502).json({ error: 'AI voice failed', detail: e?.message, speak: false, text: '', consulted: false });
        }
    });

    return router;
}

function emptyUsage(): AiUsage {
    return { inputTokens: 0, cacheReadTokens: 0, outputTokens: 0 };
}

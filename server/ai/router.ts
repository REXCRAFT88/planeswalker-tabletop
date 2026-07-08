import express from 'express';
import { aiEnabled, callLLM, availableProviders, defaultProvider } from './client';
import type { NormMessage } from './client';
import { TURN_TOOLS, MULLIGAN_TOOL } from './tools';
import { buildTurnSystemPrompt, buildMulliganSystemPrompt, formatStateView } from './prompts';
import { runVoiceReply } from './voice';
import type {
    AiDeckCard, GameStateView, AiToolResult, AiPersonaId, AiUsage, AiProviderId, VoiceChatTurn,
} from '../../services/aiTypes';

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

export function createAiRouter(): express.Router {
    const router = express.Router();
    router.use(express.json({ limit: MAX_BODY }));

    // Lets the client hide/disable AI features and pick a provider.
    router.get('/status', (_req, res) => {
        const providers = availableProviders();
        res.json({
            enabled: aiEnabled(),
            providers,
            defaultProvider: defaultProvider(),
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
            console.error('[AI] mulligan error', e?.message || e);
            res.status(502).json({ error: 'AI mulligan failed', detail: e?.message });
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
            console.error('[AI] turn error', e?.message || e);
            res.status(502).json({ error: 'AI turn failed', detail: e?.message });
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
            console.error('[AI] continue error', e?.message || e);
            res.status(502).json({ error: 'AI continue failed', detail: e?.message, done: true });
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

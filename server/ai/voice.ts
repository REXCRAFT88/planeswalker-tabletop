// The "voice" model: the AI's table-talk / negotiation personality. It is walled off
// from hidden information — it never sees the AI's hand or plan. To learn anything about
// its own side or to strike a deal, it must consult the strategist (the brain model),
// which decides what, if anything, is safe to reveal. This is the information firewall
// that lets the AI negotiate without leaking its hand unless it chooses to.
import { callLLM } from './providers';
import type { NormMessage } from './providers';
import { PERSONAS } from './personas';
import { formatStateView } from './prompts';
import type { AiPersonaId, AiProviderId, GameStateView, VoiceChatTurn } from '../../services/aiTypes';

const objSchema = (properties: any, required: string[]) => ({ type: 'object', properties, required, additionalProperties: false });

const VOICE_TOOLS = [
    {
        name: 'consult_strategist',
        description: 'Privately ask your strategist (who knows your hand and plan) a question — e.g. what you may reveal, whether to accept a deal, or what you want from this opponent. Only the strategist sees your hidden cards; you only get back what it decides to tell you.',
        input_schema: objSchema({ question: { type: 'string' } }, ['question']),
    },
    {
        name: 'commit_deal',
        description: 'Record a binding agreement you are making with an opponent (e.g. "no attacks between us next turn"). Only do this after consulting your strategist and getting approval. Keep it short.',
        input_schema: objSchema({ summary: { type: 'string' } }, ['summary']),
    },
    {
        name: 'say',
        description: 'Speak your reply out loud to the opponent. Keep it short and in character.',
        input_schema: objSchema({ message: { type: 'string' } }, ['message']),
    },
    {
        name: 'stay_silent',
        description: 'Say nothing. Use this when there is nothing worth responding to, or you prefer not to engage.',
        input_schema: objSchema({ reason: { type: 'string' } }, []),
    },
];

const STRATEGIST_TOOL = {
    name: 'provide_guidance',
    description: 'Tell your negotiator how to handle the opponent. Reveal hidden information only when it is strategically worth it — anything you put in "guidance" may be repeated to opponents.',
    input_schema: objSchema({
        guidance: { type: 'string', description: 'What the negotiator should know or do. This is all it will learn.' },
        mayReveal: { type: 'boolean', description: 'Whether the guidance intentionally discloses hidden info.' },
    }, ['guidance']),
};

export function voiceSystemPrompt(personaId: AiPersonaId, seatName: string, publicState: string, dealLog: string[]): string {
    const persona = PERSONAS[personaId] || PERSONAS.balanced;
    const deals = dealLog.length ? `\nAgreements currently in effect:\n${dealLog.map(d => `- ${d}`).join('\n')}` : '';
    return `You are the voice and table-talk personality of an AI Magic: The Gathering Commander player named "${seatName}". Persona: ${persona.name}. ${persona.blurb}

You are speaking with the human opponents at the table — negotiating, bluffing, answering questions, trash talk.

CRITICAL RULES:
- You do NOT know your own hand or exact plan. To learn anything about your side's cards or strategy, or to make/accept a deal, call consult_strategist. Never invent details about your hand or plan.
- Reveal only what the strategist authorizes. Being vague, deflecting, or bluffing is fine and often smart.
- Your goal is for your side to WIN. Negotiate in your favor. Don't agree to anything that hurts your win chance. When you do strike a deal, use commit_deal so the game holds you to it.
- Don't ramble or talk for the sake of talking. If there is nothing worth saying, use stay_silent. Keep spoken replies to a sentence or two, in character.
- Finish every exchange with exactly one of: say (to speak) or stay_silent (to stay quiet).

Public game state (what everyone can see):
${publicState}${deals}`;
}

// A public-only summary for the voice model: board, life, commanders, opponents — but
// never the AI's hand or library.
export function formatPublicForVoice(view: GameStateView): string {
    const you = view.you;
    const board = you.battlefield.length ? you.battlefield.map(b => `${b.name}${b.tapped ? '(tapped)' : ''}${b.quantity > 1 ? ' x' + b.quantity : ''}`).join(', ') : 'nothing';
    const cmd = you.commandZone.length ? you.commandZone.map(c => c.name).join(', ') : 'none';
    const opps = view.opponents.map(o => {
        const obf = o.battlefield.length ? o.battlefield.map(b => b.name).join(', ') : 'nothing';
        return `- ${o.name} [${o.seatId}]: ${o.life} life, ${o.handCount} cards in hand. Board: ${obf}. Commanders: ${o.commanders.join(', ') || 'none out'}.`;
    }).join('\n');
    return `You are "${you.name}" with ${you.life} life. Your battlefield: ${board}. Your commander(s): ${cmd}.
Opponents:
${opps}`;
}

export async function consultStrategist(
    question: string,
    view: GameStateView,
    personaId: AiPersonaId,
    seatName: string,
    dealLog: string[],
    provider?: AiProviderId,
): Promise<string> {
    const persona = PERSONAS[personaId] || PERSONAS.balanced;
    const deals = dealLog.length ? `\nAgreements in effect:\n${dealLog.map(d => `- ${d}`).join('\n')}` : '';
    const system = `You are the strategist for the AI Commander player "${seatName}" (persona: ${persona.name}). You know the full hidden game state. Your negotiator is talking to opponents and has asked you a question. Answer to maximize your chance to WIN.

You MAY reveal hidden information to your negotiator, but remember: anything you put in "guidance" may be repeated to opponents. Reveal only what is strategically worth it — usually keep your hand and combo hidden, bluff when useful, and only make concessions that help you win. Decide, then call provide_guidance.`;
    const messages: NormMessage[] = [{
        role: 'user',
        text: `${formatStateView(view)}${deals}\n\nYour negotiator asks: "${question}"\n\nDecide what to tell them via provide_guidance.`,
    }];
    const res = await callLLM({ system, messages, tools: [STRATEGIST_TOOL], toolChoice: 'provide_guidance', effort: 'medium', maxTokens: 1024 }, provider);
    const call = res.toolCalls.find(t => t.name === 'provide_guidance');
    return (call?.input?.guidance as string) || 'Stay vague and do not reveal anything specific.';
}

export interface VoiceReplyInput {
    seatName: string;
    persona: AiPersonaId;
    provider?: AiProviderId;
    view: GameStateView;        // full view (hidden info used ONLY inside consultStrategist)
    dealLog: string[];
    history: VoiceChatTurn[];
    userText: string;
}

export interface VoiceReplyOutput {
    speak: boolean;
    text: string;
    deal?: string;
    consulted: boolean;
    usage: { inputTokens: number; cacheReadTokens: number; outputTokens: number };
    provider?: AiProviderId;
}

export async function runVoiceReply(input: VoiceReplyInput): Promise<VoiceReplyOutput> {
    const publicState = formatPublicForVoice(input.view);
    const system = voiceSystemPrompt(input.persona, input.seatName, publicState, input.dealLog);
    const messages: NormMessage[] = [
        ...input.history.map(h => ({ role: h.role, text: h.text } as NormMessage)),
        { role: 'user', text: input.userText },
    ];

    const usage = { inputTokens: 0, cacheReadTokens: 0, outputTokens: 0 };
    let consulted = false;
    let deal: string | undefined;
    let provider: AiProviderId | undefined;

    for (let round = 0; round < 6; round++) {
        const res = await callLLM({ system, messages, tools: VOICE_TOOLS, effort: 'low', maxTokens: 1024 }, input.provider);
        provider = res.provider;
        usage.inputTokens += res.usage.inputTokens;
        usage.cacheReadTokens += res.usage.cacheReadTokens;
        usage.outputTokens += res.usage.outputTokens;

        const sayCall = res.toolCalls.find(t => t.name === 'say');
        const silentCall = res.toolCalls.find(t => t.name === 'stay_silent');
        if (sayCall) return { speak: true, text: String(sayCall.input?.message || '').trim(), deal, consulted, usage, provider };
        if (silentCall) return { speak: false, text: '', deal, consulted, usage, provider };

        // Otherwise process intermediate tool calls (consult / commit) and loop.
        messages.push({ role: 'assistant', text: res.text, toolCalls: res.toolCalls });
        const results = [] as { id: string; ok: boolean; detail?: string }[];
        for (const call of res.toolCalls) {
            if (call.name === 'consult_strategist') {
                consulted = true;
                const guidance = await consultStrategist(String(call.input?.question || ''), input.view, input.persona, input.seatName, input.dealLog, input.provider);
                results.push({ id: call.id, ok: true, detail: guidance });
            } else if (call.name === 'commit_deal') {
                deal = String(call.input?.summary || '').trim() || undefined;
                results.push({ id: call.id, ok: true, detail: 'Deal recorded. Now say something to the opponent.' });
            } else {
                results.push({ id: call.id, ok: false, detail: `Unknown tool ${call.name}. End with say or stay_silent.` });
            }
        }
        if (results.length === 0) {
            // No actionable tool call and no say/stay_silent — nudge and retry once more.
            messages.push({ role: 'user', text: 'End your turn with say(...) or stay_silent(...).' });
        } else {
            messages.push({ role: 'tool_results', results: results as any });
        }
    }

    // Ran out of rounds without a final say — stay quiet rather than blurt.
    return { speak: false, text: '', deal, consulted, usage, provider };
}

// --- OpenAI Realtime support ---
// When the voice model runs on OpenAI Realtime (in the browser), the same firewall
// applies: Realtime is the negotiator and only receives the PUBLIC state in its
// instructions; to learn hidden info or strike a deal it must call these function
// tools, which the client relays to /api/ai/consult (brain) — hidden state never
// enters the Realtime session.
export function buildVoiceInstructions(personaId: AiPersonaId, seatName: string, view: GameStateView, dealLog: string[]): string {
    return voiceSystemPrompt(personaId, seatName, formatPublicForVoice(view), dealLog)
        + `\n\nYou are speaking over live voice. Keep replies to a sentence or two. When you need to know something about your own side or want to make a deal, call consult_strategist (and commit_deal to lock in an agreement) — never guess at your hidden cards.`;
}

// Realtime uses a flat function-tool shape (type/name/description/parameters).
export const REALTIME_TOOLS = [
    {
        type: 'function',
        name: 'consult_strategist',
        description: 'Privately ask your strategist (who knows your hand and plan) what you may reveal, whether to accept a deal, or what you want. Only the strategist sees your hidden cards; you only get back what it decides to tell you.',
        parameters: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
    },
    {
        type: 'function',
        name: 'commit_deal',
        description: 'Record a binding agreement with an opponent (e.g. "no attacks between us next turn"). Only after consulting your strategist. Keep it short.',
        parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
    },
];

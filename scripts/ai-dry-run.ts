/**
 * Offline harness for iterating on the AI prompt/serialization layer without the app.
 *
 *   npx tsx scripts/ai-dry-run.ts            # offline: validate prompts + tool schemas
 *   ANTHROPIC_API_KEY=... npx tsx scripts/ai-dry-run.ts --live   # runs one real turn loop
 *
 * The --live path exercises the full /turn -> /continue loop against Claude using a
 * mocked "apply" that just echoes success, so you can watch the model play a turn.
 */
import { buildTurnSystemPrompt, formatStateView } from '../server/ai/prompts';
import { suggestPersona } from '../server/ai/personas';
import { TURN_TOOLS } from '../server/ai/tools';
import { aiEnabled, callLLM } from '../server/ai/client';
import { availableProviders } from '../server/ai/providers';
import type { NormMessage } from '../server/ai/providers';
import { toAnthropicMessages } from '../server/ai/providers/anthropic';
import { toOpenAIMessages } from '../server/ai/providers/openai';
import { toGeminiContents } from '../server/ai/providers/gemini';
import { formatPublicForVoice } from '../server/ai/voice';
import type { GameStateView, AiDeckCard, AiToolResult } from '../services/aiTypes';

const DECK: AiDeckCard[] = [
    { name: 'Sol Ring', manaCost: '{1}', typeLine: 'Artifact', oracleText: '{T}: Add {C}{C}.' },
    { name: 'Llanowar Elves', manaCost: '{G}', typeLine: 'Creature — Elf Druid', oracleText: '{T}: Add {G}.' },
    { name: 'Grizzly Bears', manaCost: '{1}{G}', typeLine: 'Creature — Bear', oracleText: '' },
    { name: 'Cultivate', manaCost: '{2}{G}', typeLine: 'Sorcery', oracleText: 'Search your library for up to two basic land cards...' },
];

const VIEW: GameStateView = {
    turn: 3, phase: 'MAIN',
    you: {
        seatId: 'ai-1', name: 'Bot Alice', life: 40, commanderTax: 0,
        hand: [
            { id: 'c1', name: 'Grizzly Bears', manaCost: '{1}{G}', typeLine: 'Creature — Bear' },
            { id: 'c2', name: 'Forest', manaCost: '', typeLine: 'Basic Land — Forest' },
            { id: 'c3', name: 'Cultivate', manaCost: '{2}{G}', typeLine: 'Sorcery', oracleText: 'Search your library for up to two basic land cards...' },
        ],
        battlefield: [{ id: 'b1', name: 'Forest', tapped: false, quantity: 3, typeLine: 'Basic Land — Forest' }],
        graveyard: [], exileCount: 0, libraryCount: 60,
        commandZone: [{ id: 'cmd1', name: 'Marwyn, the Nurturer', manaCost: '{2}{G}' }],
        landsPlayedThisTurn: 0,
    },
    opponents: [{
        seatId: 'p0', name: 'Human', life: 38, poison: 0,
        battlefield: [{ id: 'x', name: 'Island', tapped: true, quantity: 2 }],
        handCount: 5, graveyardTop: [], commanders: ['Talrand'], commanderDamageTakenFromYou: 0,
    }],
    recentLog: ['Human passed the turn', "It is now Bot Alice's turn"],
};

function offlineChecks(): boolean {
    const sys = buildTurnSystemPrompt('timmy', 'Bot Alice', DECK);
    const state = formatStateView(VIEW);
    const checks: [string, boolean][] = [
        ['system prompt includes persona', sys.includes('Timmy')],
        ['system prompt includes rules of engagement', sys.includes('one land drop')],
        ['system prompt includes commander rules digest', sys.includes('COMMANDER RULES DIGEST') && sys.includes('21 or more combat damage')],
        ['state view includes card oracle text', state.includes('Search your library for up to two basic land cards')],
        ['state shows hand card ids', state.includes('[c1] Grizzly Bears')],
        ['state shows opponents', state.includes('Human [p0]: 38 life')],
        ['persona suggest aggro -> timmy', suggestPersona(4.0, 0.5) === 'timmy'],
        ['persona suggest control -> johnny', suggestPersona(3.0, 0.1) === 'johnny'],
        ['13 turn tools', TURN_TOOLS.length === 13],
        ['tool schemas well-formed', TURN_TOOLS.every(t => t.input_schema?.type === 'object' && Array.isArray(t.input_schema.required))],
    ];

    // Provider message-conversion round-trip: a user turn, an assistant tool call,
    // and a tool result must convert to each provider's wire format correctly.
    const convo: NormMessage[] = [
        { role: 'user', text: 'play your turn' },
        { role: 'assistant', text: 'ok', toolCalls: [{ id: 'play_land##0', name: 'play_land', input: { cardId: 'c2' } }] },
        { role: 'tool_results', results: [{ id: 'play_land##0', ok: true, detail: 'Played Forest.' }] },
    ];
    const a = toAnthropicMessages(convo);
    const o = toOpenAIMessages('sys', convo);
    const g = toGeminiContents(convo);
    checks.push(
        ['anthropic: tool_use + tool_result blocks', a[1].content.some((b: any) => b.type === 'tool_use') && a[2].content[0].type === 'tool_result'],
        ['openai: assistant tool_calls + tool role', !!o.find((m: any) => m.role === 'assistant' && m.tool_calls) && !!o.find((m: any) => m.role === 'tool' && m.tool_call_id === 'play_land##0')],
        ['gemini: functionCall + functionResponse name recovered', g[1].parts.some((p: any) => p.functionCall?.name === 'play_land') && g[2].parts[0].functionResponse?.name === 'play_land'],
    );

    // Voice information firewall: the public view the negotiator sees must NOT contain
    // hand-only cards (Cultivate is in hand only), but should show board + opponents.
    const pub = formatPublicForVoice(VIEW);
    checks.push(
        ['voice firewall: hand-only card hidden from negotiator', !pub.includes('Cultivate')],
        ['voice public view: shows board + opponents', pub.includes('Forest') && pub.includes('Human')],
    );
    let ok = true;
    for (const [name, pass] of checks) {
        console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
        if (!pass) ok = false;
    }
    return ok;
}

async function liveRun(): Promise<void> {
    if (!aiEnabled()) {
        console.log('\n--live requested but no provider API key is set (ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY). Skipping.');
        return;
    }
    console.log('\n=== LIVE TURN ===  providers:', availableProviders().map(p => p.id).join(', '));
    const system = buildTurnSystemPrompt('balanced', 'Bot Alice', DECK);
    const messages: NormMessage[] = [{ role: 'user', text: formatStateView(VIEW) }];
    for (let round = 0; round < 12; round++) {
        const res = await callLLM({ system, messages, tools: TURN_TOOLS, effort: 'medium' });
        if (res.text) console.log(`  [${res.provider} says] ${res.text}`);
        for (const tc of res.toolCalls) console.log(`  [tool] ${tc.name}(${JSON.stringify(tc.input)})`);
        messages.push({ role: 'assistant', text: res.text, toolCalls: res.toolCalls });
        if (res.toolCalls.some(t => t.name === 'end_turn') || res.done) {
            console.log('  [turn ended]');
            break;
        }
        // Mock apply: echo success for every tool call.
        const results: AiToolResult[] = res.toolCalls.map(tc => ({ id: tc.id, ok: true, detail: 'applied (dry-run)' }));
        messages.push({ role: 'tool_results', results });
    }
}

(async () => {
    const ok = offlineChecks();
    if (process.argv.includes('--live')) await liveRun();
    process.exit(ok ? 0 : 1);
})();

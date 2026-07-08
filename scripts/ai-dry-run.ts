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
import { aiEnabled, callClaude } from '../server/ai/client';
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
            { id: 'c3', name: 'Cultivate', manaCost: '{2}{G}', typeLine: 'Sorcery' },
        ],
        battlefield: [{ id: 'b1', name: 'Forest', tapped: false, quantity: 3, typeLine: 'Basic Land — Forest' }],
        graveyard: [], exileCount: 0, libraryCount: 60,
        commandZone: [{ id: 'cmd1', name: 'Marwyn, the Nurturer', manaCost: '{2}{G}' }],
        manaAvailable: { W: 0, U: 0, B: 0, R: 0, G: 3, C: 0 }, landsPlayedThisTurn: 0,
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
        ['system prompt includes oracle text', sys.includes('Add {C}{C}')],
        ['system prompt includes rules of engagement', sys.includes('one land drop')],
        ['state shows available mana', state.includes('G:3')],
        ['state shows hand card ids', state.includes('[c1] Grizzly Bears')],
        ['state shows opponents', state.includes('Human [p0]: 38 life')],
        ['persona suggest aggro -> timmy', suggestPersona(4.0, 0.5) === 'timmy'],
        ['persona suggest control -> johnny', suggestPersona(3.0, 0.1) === 'johnny'],
        ['13 turn tools', TURN_TOOLS.length === 13],
        ['tool schemas well-formed', TURN_TOOLS.every(t => t.input_schema?.type === 'object' && Array.isArray(t.input_schema.required))],
    ];
    let ok = true;
    for (const [name, pass] of checks) {
        console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
        if (!pass) ok = false;
    }
    return ok;
}

async function liveRun(): Promise<void> {
    if (!aiEnabled()) {
        console.log('\n--live requested but ANTHROPIC_API_KEY is not set. Skipping.');
        return;
    }
    console.log('\n=== LIVE TURN ===');
    const system = buildTurnSystemPrompt('balanced', 'Bot Alice', DECK);
    const messages: any[] = [{ role: 'user', content: formatStateView(VIEW) }];
    for (let round = 0; round < 12; round++) {
        const res = await callClaude({ system, messages, tools: TURN_TOOLS, effort: 'medium' });
        if (res.text) console.log(`  [says] ${res.text}`);
        for (const tc of res.toolCalls) console.log(`  [tool] ${tc.name}(${JSON.stringify(tc.input)})`);
        messages.push({ role: 'assistant', content: res.content });
        if (res.toolCalls.some(t => t.name === 'end_turn') || res.stopReason !== 'tool_use') {
            console.log('  [turn ended]');
            break;
        }
        // Mock apply: echo success for every tool call.
        const results: AiToolResult[] = res.toolCalls.map(tc => ({ id: tc.id, ok: true, detail: 'applied (dry-run)' }));
        messages.push({
            role: 'user',
            content: results.map(r => ({ type: 'tool_result', tool_use_id: r.id, content: JSON.stringify(r), is_error: false })),
        });
    }
}

(async () => {
    const ok = offlineChecks();
    if (process.argv.includes('--live')) await liveRun();
    process.exit(ok ? 0 : 1);
})();

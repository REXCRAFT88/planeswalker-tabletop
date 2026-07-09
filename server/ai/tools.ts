// Tool definitions offered to Claude for playing a turn. The host validates and
// applies each call; these schemas only need to describe the shape of the input.
// Keep the array order and keys stable so the request prefix stays cache-friendly.

interface ToolDef {
    name: string;
    description: string;
    input_schema: any;
}

const obj = (properties: any, required: string[]): any => ({
    type: 'object',
    properties,
    required,
    additionalProperties: false,
});

export const TURN_TOOLS: ToolDef[] = [
    {
        name: 'play_land',
        description: 'Play a land from your hand onto the battlefield. You may only play one land per turn.',
        input_schema: obj({ cardId: { type: 'string', description: 'The id of the land card in your hand.' } }, ['cardId']),
    },
    {
        name: 'cast_spell',
        description: 'Cast a spell from your hand. Mana is tapped automatically from your available sources; if you cannot afford it the call fails. Permanents enter the battlefield; instants/sorceries go to the graveyard after resolving.',
        input_schema: obj({
            cardId: { type: 'string', description: 'The id of the card in your hand.' },
            xValue: { type: 'integer', description: 'Value chosen for {X} in the cost, if any.' },
            targetsDescription: { type: 'string', description: 'Plain-language description of targets/choices, shown to the table.' },
        }, ['cardId']),
    },
    {
        name: 'cast_commander',
        description: 'Cast your commander from the command zone. Commander tax (2 generic mana per prior cast) is added automatically.',
        input_schema: obj({
            cardId: { type: 'string', description: 'The id of the commander in your command zone.' },
            targetsDescription: { type: 'string' },
        }, ['cardId']),
    },
    {
        name: 'activate_mana',
        description: 'Tap a mana source you control for mana without casting anything (e.g. to float mana or use a mana ability).',
        input_schema: obj({ objectId: { type: 'string', description: 'The id of the permanent on the battlefield.' } }, ['objectId']),
    },
    {
        name: 'tap_permanent',
        description: 'Tap a permanent you control (e.g. to use an ability or attack).',
        input_schema: obj({ objectId: { type: 'string' } }, ['objectId']),
    },
    {
        name: 'untap_permanent',
        description: 'Untap a permanent you control.',
        input_schema: obj({ objectId: { type: 'string' } }, ['objectId']),
    },
    {
        name: 'create_token',
        description: 'Create one or more copies of a token from your token list.',
        input_schema: obj({
            name: { type: 'string', description: 'The token name, matched against your available tokens.' },
            quantity: { type: 'integer', description: 'How many to create (default 1).' },
        }, ['name']),
    },
    {
        name: 'add_counter',
        description: 'Add or remove counters on a permanent you control.',
        input_schema: obj({
            objectId: { type: 'string' },
            counterType: { type: 'string', description: 'e.g. "+1/+1", "loyalty", "charge".' },
            delta: { type: 'integer', description: 'Positive to add, negative to remove.' },
        }, ['objectId', 'counterType', 'delta']),
    },
    {
        name: 'move_card',
        description: 'Move a card between your zones (battlefield, graveyard, exile, hand, library-top, library-bottom).',
        input_schema: obj({
            cardId: { type: 'string' },
            from: { type: 'string', enum: ['battlefield', 'graveyard', 'exile', 'hand', 'library'] },
            to: { type: 'string', enum: ['battlefield', 'graveyard', 'exile', 'hand', 'library-top', 'library-bottom'] },
        }, ['cardId', 'from', 'to']),
    },
    {
        name: 'declare_attackers',
        description: 'Declare attackers. Each entry taps the attacker and announces the attack against a defending seat.',
        input_schema: obj({
            attacks: {
                type: 'array',
                items: obj({
                    objectId: { type: 'string', description: 'Your attacking creature.' },
                    defenderSeatId: { type: 'string', description: 'The seat being attacked.' },
                }, ['objectId', 'defenderSeatId']),
            },
        }, ['attacks']),
    },
    {
        name: 'adjust_life',
        description: "Change a player's life total (life gain, life loss, or paying life).",
        input_schema: obj({
            seatId: { type: 'string', description: 'The seat whose life changes.' },
            delta: { type: 'integer', description: 'Positive to gain, negative to lose.' },
            reason: { type: 'string' },
        }, ['seatId', 'delta']),
    },
    {
        name: 'announce',
        description: 'Say something to the table. Use for triggers, targeting, rules choices, or brief table talk that the tools cannot express. Keep it short.',
        input_schema: obj({ message: { type: 'string' } }, ['message']),
    },
    {
        name: 'end_turn',
        description: 'End your turn. Provide a one-line summary of what you did.',
        input_schema: obj({ summary: { type: 'string' } }, ['summary']),
    },
];

export const MULLIGAN_TOOL: ToolDef = {
    name: 'mulligan_decision',
    description: 'Decide whether to keep your opening hand.',
    input_schema: obj({
        keep: { type: 'boolean', description: 'true to keep, false to mulligan.' },
        bottomCards: {
            type: 'array',
            items: { type: 'string' },
            description: 'If keeping after one or more mulligans, the names of cards to put on the bottom (London mulligan).',
        },
        comment: { type: 'string', description: 'One short sentence explaining the decision.' },
    }, ['keep', 'comment']),
};

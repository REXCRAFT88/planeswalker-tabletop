import { BoardObject } from '../types';

// --- Mana Symbol Types ---
export type ManaColor = 'W' | 'U' | 'B' | 'R' | 'G' | 'C'; // White, Blue, Black, Red, Green, Colorless
export type ManaSymbol = {
    type: 'colored';
    color: ManaColor;
} | {
    type: 'generic';
    count: number;
} | {
    type: 'hybrid';
    options: ManaColor[];
} | {
    type: 'x';
};

export interface ManaPool {
    W: number;
    U: number;
    B: number;
    R: number;
    G: number;
    C: number; // True colorless (from Wastes, Sol Ring, etc.)
}

export interface ManaCost {
    symbols: ManaSymbol[];
    cmc: number;
    hasX: boolean;
}

export const EMPTY_POOL: ManaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

export const MANA_COLORS: ManaColor[] = ['W', 'U', 'B', 'R', 'G', 'C'];

export const MANA_DISPLAY: Record<ManaColor, { symbol: string; color: string; bg: string }> = {
    W: { symbol: '☀', color: '#FFF9E6', bg: '#F9E4B7' },
    U: { symbol: '💧', color: '#0E68AB', bg: '#AAD4F5' },
    B: { symbol: '💀', color: '#150B00', bg: '#BAB1A8' },
    R: { symbol: '🔥', color: '#D32029', bg: '#F9AA8F' },
    G: { symbol: '🌲', color: '#00733E', bg: '#9BD3AE' },
    C: { symbol: '◇', color: '#CBC2BF', bg: '#CBC2BF' },
};

// --- Mana Cost Parsing ---
// Parses a mana cost string like "{2}{G}{G}" into structured ManaCost
export const parseManaCost = (manaCostStr: string): ManaCost => {
    if (!manaCostStr) return { symbols: [], cmc: 0, hasX: false };

    const symbols: ManaSymbol[] = [];
    let cmc = 0;
    let hasX = false;

    // Match each {X} symbol
    const regex = /\{([^}]+)\}/g;
    let match;

    while ((match = regex.exec(manaCostStr)) !== null) {
        const value = match[1].toUpperCase();

        if (value === 'X') {
            symbols.push({ type: 'x' });
            hasX = true;
        } else if (/^\d+$/.test(value)) {
            const num = parseInt(value);
            symbols.push({ type: 'generic', count: num });
            cmc += num;
        } else if (value.includes('/')) {
            // Hybrid mana like {W/U} or {2/W}
            const parts = value.split('/');
            const colors = parts.filter(p => MANA_COLORS.includes(p as ManaColor)) as ManaColor[];
            if (colors.length > 0) {
                symbols.push({ type: 'hybrid', options: colors });
                cmc += 1;
            }
        } else if (MANA_COLORS.includes(value as ManaColor)) {
            symbols.push({ type: 'colored', color: value as ManaColor });
            cmc += 1;
        }
    }

    return { symbols, cmc, hasX };
};

// --- Produced Mana Parsing ---
// Convert Scryfall produced_mana array to our format  
export const parseProducedMana = (producedMana: string[] | undefined): ManaColor[] => {
    if (!producedMana || producedMana.length === 0) return [];
    return producedMana
        .map(m => m.toUpperCase())
        .filter(m => MANA_COLORS.includes(m as ManaColor)) as ManaColor[];
};

// --- Available Mana Calculation ---
// Calculate total available (untapped) mana from board objects
// Now separates 'tap' sources (free to tap) from 'activated'/'complex' sources (require extra cost)
export const calculateAvailableMana = (
    boardObjects: BoardObject[],
    controllerId: string,
    defaultRotation: number
): { pool: ManaPool; potentialPool: ManaPool; sources: ManaSource[]; potentialSources: ManaSource[] } => {
    const pool: ManaPool = { ...EMPTY_POOL };
    const potentialPool: ManaPool = { ...EMPTY_POOL };
    const sources: ManaSource[] = [];
    const potentialSources: ManaSource[] = [];

    boardObjects.forEach(obj => {
        if (obj.type !== 'CARD') return;
        if (obj.controllerId !== controllerId) return;
        if (!obj.cardData.producedMana || obj.cardData.producedMana.length === 0) return;

        // Check if untapped (rotation matches default = untapped)
        const isTapped = obj.rotation !== defaultRotation || obj.tappedQuantity > 0;
        if (isTapped) return;

        const produced = obj.cardData.producedMana as ManaColor[];
        const isBasic = isBasicLand(obj.cardData.name);
        const isFlexible = produced.length > 2 || produced.includes('W' as ManaColor) && produced.includes('U' as ManaColor) && produced.includes('B' as ManaColor);
        const abilityType = obj.cardData.manaAbilityType || 'tap';
        const activationCost = obj.cardData.manaActivationCost;

        const source: ManaSource = {
            objectId: obj.id,
            cardName: obj.cardData.name,
            producedMana: produced,
            isBasic,
            isFlexible,
            priority: isBasic ? 0 : (produced.length === 1 ? 1 : (isFlexible ? 3 : 2)),
            abilityType,
            activationCost,
        };

        // Only simple 'tap' sources count as readily available
        if (abilityType === 'tap') {
            sources.push(source);
            produced.forEach(c => { pool[c] += 1; });
        } else {
            // activated, multi, complex — goes to potential pool
            potentialSources.push(source);
            produced.forEach(c => { potentialPool[c] += 1; });
        }
    });

    return { pool, potentialPool, sources, potentialSources };
};

export interface ManaSource {
    objectId: string;
    cardName: string;
    producedMana: ManaColor[];
    isBasic: boolean;
    isFlexible: boolean; // Can produce 3+ colors
    priority: number; // 0=basic, 1=single-nonbasic, 2=dual, 3=flexible/any
    abilityType: 'tap' | 'activated' | 'multi' | 'complex'; // How this source produces mana
    activationCost?: string; // Mana cost to activate, if any
}

// --- Basic Land Detection ---
const BASIC_LAND_NAMES = ['plains', 'island', 'swamp', 'mountain', 'forest', 'wastes',
    'snow-covered plains', 'snow-covered island', 'snow-covered swamp', 'snow-covered mountain', 'snow-covered forest'];

export const isBasicLand = (name: string): boolean => {
    return BASIC_LAND_NAMES.includes(name.toLowerCase());
};

// Map basic land names to their produced color
const BASIC_LAND_COLOR: Record<string, ManaColor> = {
    'plains': 'W', 'snow-covered plains': 'W',
    'island': 'U', 'snow-covered island': 'U',
    'swamp': 'B', 'snow-covered swamp': 'B',
    'mountain': 'R', 'snow-covered mountain': 'R',
    'forest': 'G', 'snow-covered forest': 'G',
    'wastes': 'C',
};

export const getBasicLandColor = (name: string): ManaColor | null => {
    return BASIC_LAND_COLOR[name.toLowerCase()] || null;
};

// --- Auto-Tap Algorithm ---
// Given a mana cost and available sources, determine which objects to tap
export const autoTapForCost = (
    cost: ManaCost,
    sources: ManaSource[],
    xValue: number = 0
): { tappedIds: string[]; success: boolean; floatingMana: ManaPool } => {
    if (cost.symbols.length === 0 && !cost.hasX) {
        return { tappedIds: [], success: true, floatingMana: { ...EMPTY_POOL } };
    }

    // Sort sources by priority: basics first (0), then single-color (1), duals (2), flexible (3)
    const availableSources = [...sources].sort((a, b) => a.priority - b.priority);
    const tappedIds: string[] = [];
    const floatingMana: ManaPool = { ...EMPTY_POOL };

    // Phase 1: Pay colored costs first (most restrictive)
    const coloredCosts: ManaColor[] = [];
    const hybridCosts: ManaColor[][] = [];
    let genericCost = 0;

    for (const sym of cost.symbols) {
        if (sym.type === 'colored') {
            coloredCosts.push(sym.color);
        } else if (sym.type === 'generic') {
            genericCost += sym.count;
        } else if (sym.type === 'hybrid') {
            hybridCosts.push(sym.options);
        } else if (sym.type === 'x') {
            genericCost += xValue;
        }
    }

    // Sort colored costs so rarest colors are paid first
    const colorCounts: Record<ManaColor, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    availableSources.forEach(s => s.producedMana.forEach(c => colorCounts[c]++));
    coloredCosts.sort((a, b) => colorCounts[a] - colorCounts[b]);

    // Pay each colored cost
    for (const color of coloredCosts) {
        const sourceIdx = availableSources.findIndex(s =>
            !tappedIds.includes(s.objectId) && s.producedMana.includes(color)
        );
        if (sourceIdx === -1) {
            return { tappedIds: [], success: false, floatingMana: { ...EMPTY_POOL } };
        }
        const source = availableSources[sourceIdx];
        tappedIds.push(source.objectId);

        // Any extra mana this source produces becomes floating
        if (source.producedMana.length === 1) {
            // Single producer - the color is "spent," but if it produces multiple (like Sol Ring),
            // extra goes to floating
            // Actually for single-color sources, just mark the color as used
        } else {
            // Multi-color: the player "chose" this color, extra mana doesn't apply for tap-for-one sources
        }
    }

    // Pay hybrid costs (pick whichever color we have more of)
    for (const options of hybridCosts) {
        // Try each option, prefer the one with more available sources
        let paid = false;
        const sortedOptions = [...options].sort((a, b) => colorCounts[b] - colorCounts[a]);
        for (const color of sortedOptions) {
            const sourceIdx = availableSources.findIndex(s =>
                !tappedIds.includes(s.objectId) && s.producedMana.includes(color)
            );
            if (sourceIdx !== -1) {
                tappedIds.push(availableSources[sourceIdx].objectId);
                paid = true;
                break;
            }
        }
        if (!paid) {
            return { tappedIds: [], success: false, floatingMana: { ...EMPTY_POOL } };
        }
    }

    // Pay generic costs with remaining untapped sources (basics first, flex last)
    for (let i = 0; i < genericCost; i++) {
        const sourceIdx = availableSources.findIndex(s => !tappedIds.includes(s.objectId));
        if (sourceIdx === -1) {
            return { tappedIds: [], success: false, floatingMana: { ...EMPTY_POOL } };
        }
        tappedIds.push(availableSources[sourceIdx].objectId);
    }

    // Calculate floating mana from tapped sources
    // Each tapped source contributes its primary color to the floating pool
    for (const id of tappedIds) {
        const source = availableSources.find(s => s.objectId === id);
        if (source) {
            if (source.isBasic) {
                const basicColor = getBasicLandColor(source.cardName);
                if (basicColor) floatingMana[basicColor]++;
            } else if (source.producedMana.length === 1) {
                floatingMana[source.producedMana[0]]++;
            } else {
                // For multi-color sources, we assigned a specific color above
                // For simplicity, add the first produced color
                // In a perfect implementation, we'd track which color was chosen
                floatingMana[source.producedMana[0]]++;
            }
        }
    }

    // Now subtract the cost from floating mana
    const spent: ManaPool = { ...EMPTY_POOL };
    for (const color of coloredCosts) { spent[color]++; }
    for (const options of hybridCosts) { spent[options[0]]++; } // simplified
    // Generic: spent from whatever was tapped
    // The floating mana shows what's produced minus what's spent for the cost

    MANA_COLORS.forEach(c => {
        floatingMana[c] = Math.max(0, floatingMana[c] - spent[c]);
    });

    return { tappedIds, success: true, floatingMana };
};

// --- Floating Mana from Manual Taps ---
// When a player manually taps a mana source, add its production to the floating mana pool
export const addToManaPool = (pool: ManaPool, source: ManaSource): ManaPool => {
    const newPool = { ...pool };
    if (source.isBasic) {
        const basicColor = getBasicLandColor(source.cardName);
        if (basicColor) newPool[basicColor]++;
    } else if (source.producedMana.length === 1) {
        newPool[source.producedMana[0]]++;
    }
    // For multi-color sources, the caller should determine which color to add
    return newPool;
};

// Subtract a mana cost from a pool (for spending)
export const subtractFromPool = (pool: ManaPool, cost: ManaCost): ManaPool | null => {
    const newPool = { ...pool };

    for (const sym of cost.symbols) {
        if (sym.type === 'colored') {
            if (newPool[sym.color] <= 0) return null; // Can't pay
            newPool[sym.color]--;
        } else if (sym.type === 'generic') {
            let remaining = sym.count;
            // Pay generic with colorless first, then whatever has most
            if (newPool.C >= remaining) {
                newPool.C -= remaining;
                remaining = 0;
            } else {
                remaining -= newPool.C;
                newPool.C = 0;
            }
            // Pay remaining from most abundant color
            while (remaining > 0) {
                const maxColor = MANA_COLORS.reduce((best, c) =>
                    newPool[c] > newPool[best] ? c : best, 'W' as ManaColor);
                if (newPool[maxColor] <= 0) return null;
                newPool[maxColor]--;
                remaining--;
            }
        }
    }

    return newPool;
};

// Calculate total mana in pool
export const poolTotal = (pool: ManaPool): number => {
    return MANA_COLORS.reduce((sum, c) => sum + pool[c], 0);
};

// --- Undo System ---
export type UndoableAction = {
    type: 'TAP_CARD';
    objectId: string;
    previousRotation: number;
    previousTappedQuantity: number;
} | {
    type: 'UNTAP_ALL';
    objects: { id: string; previousRotation: number; previousTappedQuantity: number }[];
} | {
    type: 'PLAY_CARD';
    objectId: string;
    card: any; // CardData
    fromZone: 'HAND' | 'COMMAND';
} | {
    type: 'MOVE_CARD';
    objectId: string;
    previousX: number;
    previousY: number;
} | {
    type: 'SEND_TO_ZONE';
    objectId: string;
    card: any;
    fromZone: string;
    toZone: string;
} | {
    type: 'AUTO_TAP';
    tappedIds: string[];
    previousStates: { id: string; rotation: number; tappedQuantity: number }[];
    floatingManaAdded: ManaPool;
};

export const MAX_UNDO_HISTORY = 6;

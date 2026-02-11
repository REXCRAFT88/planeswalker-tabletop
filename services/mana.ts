import { BoardObject, ManaRule, ManaColor as ManaColorType, CardData } from '../types';

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
// Also accepts optional manaRules for custom per-card rules
export const calculateAvailableMana = (
    boardObjects: BoardObject[],
    controllerId: string,
    defaultRotation: number,
    commanderColors?: ManaColor[],
    manaRules?: Record<string, ManaRule>
): { pool: ManaPool; potentialPool: ManaPool; sources: ManaSource[]; potentialSources: ManaSource[] } => {
    const pool: ManaPool = { ...EMPTY_POOL };
    const potentialPool: ManaPool = { ...EMPTY_POOL };
    const sources: ManaSource[] = [];
    const potentialSources: ManaSource[] = [];

    // 1. Scan for Global Rules (Applies To All ...)
    const globalRules: { rule: ManaRule, sourceId: string }[] = [];
    if (manaRules) {
        boardObjects.forEach(obj => {
            if (obj.controllerId !== controllerId || obj.type !== 'CARD') return;
            const rule = manaRules[obj.cardData.scryfallId];
            if (rule && rule.appliesTo && rule.appliesTo.length > 0 && !rule.disabled) {
                globalRules.push({ rule, sourceId: obj.id });
            }
        });
    }

    // Pre-compute board counts for custom rule calcModes
    let creatureCount = -1; // lazy
    let basicLandCount = -1; // lazy
    const getCreatureCount = () => {
        if (creatureCount < 0) {
            creatureCount = boardObjects.filter(o =>
                o.type === 'CARD' && o.controllerId === controllerId &&
                o.cardData.typeLine?.toLowerCase().includes('creature')
            ).length;
        }
        return creatureCount;
    };
    const getBasicLandCount = () => {
        if (basicLandCount < 0) {
            basicLandCount = boardObjects.filter(o =>
                o.type === 'CARD' && o.controllerId === controllerId &&
                isBasicLand(o.cardData.name)
            ).length;
        }
        return basicLandCount;
    };

    boardObjects.forEach(obj => {
        if (obj.type !== 'CARD') return;
        if (obj.controllerId !== controllerId) return;

        // Check for custom mana rule
        const customRule = manaRules?.[obj.cardData.scryfallId];

        let produced: ManaColor[];
        let abilityType: 'tap' | 'activated' | 'multi' | 'complex' | 'passive';
        let sourcePriority: number;

        if (customRule) {
            // --- Custom rule path ---
            // Skip disabled rules entirely
            if (customRule.disabled) return;

            // Calculate the multiplier from calcMode
            let calcAmount = 1;
            switch (customRule.calcMode) {
                case 'set':
                    calcAmount = 1;
                    break;
                case 'counters': {
                    let counters = obj.counters?.['+1/+1'] || obj.counters?.['counter'] || 0;
                    // Include base power if option is enabled
                    if (customRule.includeBasePower) {
                        const powerMatch = obj.cardData.power?.match(/^\d+/);
                        if (powerMatch) counters += parseInt(powerMatch[0]);
                    }
                    calcAmount = counters * (customRule.calcMultiplier || 1);
                    break;
                }
                case 'creatures':
                    calcAmount = getCreatureCount() * (customRule.calcMultiplier || 1);
                    break;
                case 'basicLands':
                    calcAmount = getBasicLandCount() * (customRule.calcMultiplier || 1);
                    break;
            }

            // Build produced mana array from rule
            produced = [];
            if (customRule.prodMode === 'standard') {
                const amount = customRule.calcMode === 'set' ? 1 : calcAmount;
                for (const [color, count] of Object.entries(customRule.produced)) {
                    const total = count * amount;
                    for (let i = 0; i < total; i++) {
                        produced.push(color as ManaColor);
                    }
                }
                // Add alt colors as additional options (for flexible sources)
                if (customRule.producedAlt) {
                    for (const [color, count] of Object.entries(customRule.producedAlt)) {
                        if (count > 0 && !produced.includes(color as ManaColor)) {
                            produced.push(color as ManaColor);
                        }
                    }
                }
            } else if (customRule.prodMode === 'available') {
                // Available mode: produces mana of any color matching your lands
                const landColors = new Set<ManaColor>();
                boardObjects.forEach(lo => {
                    if (lo.type !== 'CARD' || lo.controllerId !== controllerId) return;
                    const tl = (lo.cardData.typeLine || '').toLowerCase();
                    if (!tl.includes('land')) return;
                    if (tl.includes('plains')) landColors.add('W');
                    if (tl.includes('island')) landColors.add('U');
                    if (tl.includes('swamp')) landColors.add('B');
                    if (tl.includes('mountain')) landColors.add('R');
                    if (tl.includes('forest')) landColors.add('G');
                    // Check produced_mana for non-basic lands
                    if (lo.cardData.producedMana) {
                        lo.cardData.producedMana.forEach(m => {
                            const uc = m.toUpperCase() as ManaColor;
                            if (['W', 'U', 'B', 'R', 'G'].includes(uc)) landColors.add(uc);
                        });
                    }
                });
                const amount = customRule.calcMode === 'set'
                    ? Math.max(1, Object.values(customRule.produced).reduce((a, b) => a + b, 0))
                    : calcAmount;
                landColors.forEach(c => {
                    for (let i = 0; i < amount; i++) produced.push(c);
                });
            } else if (customRule.prodMode === 'chooseColor') {
                // Choose Color mode: at runtime, player picks a color via modal.
                // For auto-tap/pool purposes, default to colorless placeholder.
                // Choose Color mode: at runtime, player picks a color via modal.
                // We use produced['C'] to store the quantity X
                const amount = customRule.calcMode === 'set'
                    ? (customRule.produced['C'] || 1)
                    : calcAmount;
                // Push all 5 colors as potential options (like "any color")
                for (const c of ['W', 'U', 'B', 'R', 'G'] as ManaColor[]) {
                    for (let i = 0; i < amount; i++) produced.push(c);
                }
            } else if (customRule.prodMode === 'commander') {
                const amount = customRule.calcMode === 'set'
                    ? (customRule.produced['C'] || 1)
                    : calcAmount;
                if (commanderColors && commanderColors.length > 0) {
                    for (const c of commanderColors) {
                        for (let i = 0; i < amount; i++) produced.push(c);
                    }
                } else {
                    for (let i = 0; i < amount; i++) produced.push('C');
                }
            } else {
                // Multiplied mode: produce calcAmount of each specified color
                for (const [color, count] of Object.entries(customRule.produced)) {
                    const total = count * calcAmount;
                    for (let i = 0; i < total; i++) {
                        produced.push(color as ManaColor);
                    }
                }
            }

            if (produced.length === 0) return; // No mana production

            // Map trigger to abilityType
            abilityType = customRule.trigger === 'tap' ? 'tap' :
                customRule.trigger === 'activated' ? 'activated' :
                    customRule.trigger === 'passive' ? 'passive' : 'tap';

            // Use custom priority if auto-tap enabled
            sourcePriority = customRule.autoTap ? customRule.autoTapPriority : 999;

        } else {
            // --- Default path (existing logic) ---
            produced = obj.cardData.producedMana as ManaColor[];

            // Tracking fix: Estimate if missing
            if (!produced || produced.length === 0) {
                const estimated = estimateProducedMana(obj.cardData as any);
                if (estimated && estimated.length > 0) {
                    produced = estimated as ManaColor[];
                } else {
                    return;
                }
            }

            // Handle Command Tower (filter by commander colors)
            if (obj.cardData.name === 'Command Tower' && commanderColors) {
                produced = produced.filter(c => commanderColors.includes(c));
            }

            abilityType = (obj.cardData.manaAbilityType || 'tap') as typeof abilityType;

            sourcePriority = getManaPriority(obj.cardData, produced);
        }

        // --- Apply Global Rules (Granted Abilities) ---
        // Check if this object matches any global rule criteria
        if (globalRules.length > 0) {
            const myTypeLine = (obj.cardData.typeLine || '').toLowerCase();
            const hasCounters = (obj.counters?.['+1/+1'] || 0) > 0 || (obj.counters?.['counter'] || 0) > 0;
            const myId = obj.id;

            for (const { rule, sourceId } of globalRules) {
                // Don't apply to self via this mechanism (own rule handled above)
                // Actually, if own rule existed, we used it. If not, we used default.
                // Global rule is ADDITIVE.
                if (sourceId === myId) continue;

                // Check Criteria
                let matches = false;
                if (rule.appliesTo?.includes('creatures') && myTypeLine.includes('creature')) matches = true;
                if (rule.appliesTo?.includes('lands') && myTypeLine.includes('land')) matches = true;

                // Check Condition (e.g. Rishkar requires counters)
                if (matches && rule.appliesToCondition === 'counters' && !hasCounters) matches = false;

                if (matches) {
                    // Logic duplication from Custom Rule path (simplified)
                    // We need to calculate production for THIS rule on THIS object
                    let calcAmount = 1;
                    switch (rule.calcMode) {
                        case 'set': calcAmount = 1; break;
                        case 'counters': {
                            let c = obj.counters?.['+1/+1'] || obj.counters?.['counter'] || 0;
                            if (rule.includeBasePower) {
                                const pm = obj.cardData.power?.match(/^\d+/);
                                if (pm) c += parseInt(pm[0]);
                            }
                            calcAmount = c * (rule.calcMultiplier || 1);
                            break;
                        }
                        case 'creatures': calcAmount = getCreatureCount() * (rule.calcMultiplier || 1); break;
                        case 'basicLands': calcAmount = getBasicLandCount() * (rule.calcMultiplier || 1); break;
                    }

                    // Append produced colors
                    if (rule.prodMode === 'standard') {
                        const amount = rule.calcMode === 'set' ? 1 : calcAmount;
                        for (const [color, count] of Object.entries(rule.produced)) {
                            for (let i = 0; i < count * amount; i++) produced.push(color as ManaColor);
                        }
                    } else if (rule.prodMode === 'available') {
                        const landColors = new Set<ManaColor>();
                        boardObjects.forEach(lo => {
                            if (lo.type !== 'CARD' || lo.controllerId !== controllerId) return;
                            const tl = (lo.cardData.typeLine || '').toLowerCase();
                            if (!tl.includes('land')) return;
                            if (tl.includes('plains')) landColors.add('W');
                            if (tl.includes('island')) landColors.add('U');
                            if (tl.includes('swamp')) landColors.add('B');
                            if (tl.includes('mountain')) landColors.add('R');
                            if (tl.includes('forest')) landColors.add('G');
                            if (lo.cardData.producedMana) lo.cardData.producedMana.forEach(m => {
                                if (['W', 'U', 'B', 'R', 'G'].includes(m)) landColors.add(m as ManaColor);
                            });
                        });
                        landColors.forEach(c => produced.push(c));
                    } else if (rule.prodMode === 'chooseColor') {
                        ['W', 'U', 'B', 'R', 'G'].forEach(c => produced.push(c as ManaColor));
                    } else {
                        ['W', 'U', 'B', 'R', 'G'].forEach(c => produced.push(c as ManaColor));
                    }
                }
            }
        }

        // Determine ability type for Global Rules (if any applied) which might override default 'tap'
        // If multiple rules apply, we might need a way to distinguish.
        // For now, if we have global rules, let's assume valid abilityType is derived from the *last* applied rule or just 'tap' if mixed?
        // Actually, we need to associate the produced mana with the SOURCE, but `calculateAvailableMana` returns aggregated sources?
        // Wait, `sources` array entries have `abilityType`.
        // We aren't pushing to `sources` inside the global rules loop! We are just pushing to `produced` array.
        // The `sources` array creation happens AFTER this block using `produced`.
        // We need to determine `abilityType` for the *object* based on the rule that produced the mana.
        // If Global Rules added mana, we should probably set `abilityType` based on that rule?
        // Issues: 
        // 1. `abilityType` is defined earlier (line 277 or 252).
        // 2. We are augmenting `produced` array.
        // 3. The `ManaSource` object is created at end of loop using `abilityType`.

        // Fix: Update `abilityType` if global rules found a match and it wasn't already set by a custom rule on item itself.
        if (globalRules.length > 0) {
            for (const { rule, sourceId } of globalRules) {
                if (sourceId === obj.id) continue;
                const myTypeLine = (obj.cardData.typeLine || '').toLowerCase();
                let matches = false;
                if (rule.appliesTo?.includes('creatures') && myTypeLine.includes('creature')) matches = true;
                if (rule.appliesTo?.includes('lands') && myTypeLine.includes('land')) matches = true;
                const hasCounters = (obj.counters?.['+1/+1'] || 0) > 0 || (obj.counters?.['counter'] || 0) > 0;
                if (matches && rule.appliesToCondition === 'counters' && !hasCounters) matches = false;

                if (matches) {
                    // Found a matching rule. Update abilityType from this rule's trigger.
                    // Note: If multiple rules apply with different triggers, this might be ambiguous.
                    // We'll trust the last one or favor 'tap'.
                    abilityType = rule.trigger === 'tap' ? 'tap' : rule.trigger === 'activated' ? 'activated' : 'tap';
                }
            }
        }

        // Check availability based on stacking
        const untappedCount = Math.max(0, obj.quantity - obj.tappedQuantity);
        if (untappedCount === 0 && (!customRule || customRule.trigger !== 'passive')) return;

        const isBasic = isBasicLand(obj.cardData.name);
        const uniqueColors = new Set(produced);
        const isFlexible = uniqueColors.size > 1;

        const activationCost = customRule ? undefined : obj.cardData.manaActivationCost;

        const source: ManaSource = {
            objectId: obj.id,
            cardName: obj.cardData.name,
            producedMana: produced,
            isBasic,
            isFlexible,
            priority: sourcePriority,
            abilityType,
            activationCost,
        };

        // Passive sources always contribute to pool
        if (customRule?.trigger === 'passive') {
            sources.push(source);
            produced.forEach(c => { pool[c] = (pool[c] || 0) + 1; });
            return;
        }

        // Only simple 'tap' sources count as readily available
        // Creatures/artifacts with custom tap rules go to potential (user taps deliberately)
        const isCreatureOrArtifact = customRule && !obj.cardData.typeLine?.toLowerCase().includes('land');
        if (abilityType === 'tap' && !isCreatureOrArtifact) {
            for (let i = 0; i < untappedCount; i++) {
                sources.push(source);
                produced.forEach(c => { pool[c] = (pool[c] || 0) + 1; });
            }
        } else {
            // activated, multi, complex, or creature/artifact tap — goes to potential pool
            for (let i = 0; i < untappedCount; i++) {
                potentialSources.push(source);
                produced.forEach(c => { potentialPool[c] = (potentialPool[c] || 0) + 1; });
            }
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
    abilityType: 'tap' | 'activated' | 'multi' | 'complex' | 'passive'; // How this source produces mana
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

// Helper to determine auto-tap priority
export const getManaPriority = (card: CardData, produced: ManaColor[]): number => {
    const isBasic = isBasicLand(card.name);
    const uniqueColors = new Set(produced);
    // 0 = Basic Land
    // 1 = Single color producer
    // 2 = Dual/Tri color (limited options)
    // 3 = Flexible / Any Color
    if (isBasic) return 0;
    if (produced.length <= 1) return 1;
    if (uniqueColors.size > 1) return 3;
    return 2;
};

// --- Auto-Tap Algorithm ---
// Given a mana cost and available sources, determine which objects to tap
export const autoTapForCost = (
    cost: ManaCost,
    sources: ManaSource[],
    initialFloatingMana: ManaPool = { ...EMPTY_POOL },
    xValue: number = 0
): {
    tappedIds: string[];
    success: boolean;
    floatingManaRemaining: ManaPool;
    manaProducedFromTap: ManaPool;
    manaUsed: ManaPool;
} => {
    // 1. Calculate stats tracking
    const manaProducedFromTap: ManaPool = { ...EMPTY_POOL };
    const manaUsed: ManaPool = { ...EMPTY_POOL };
    const currentFloating = { ...initialFloatingMana };

    // Helper to pay with floating
    const payWithFloating = (color: ManaColor, count: number): number => {
        const available = currentFloating[color] || 0;
        const paid = Math.min(available, count);
        currentFloating[color] -= paid;
        manaUsed[color] += paid;
        return paid;
    };

    // 2. Flatten cost to individual requirements
    const costToPay: { type: 'colored' | 'generic' | 'hybrid', color?: ManaColor, options?: ManaColor[] }[] = [];

    for (const sym of cost.symbols) {
        if (sym.type === 'colored') {
            costToPay.push({ type: 'colored', color: sym.color });
        } else if (sym.type === 'generic') {
            for (let i = 0; i < sym.count; i++) costToPay.push({ type: 'generic' });
        } else if (sym.type === 'hybrid') {
            costToPay.push({ type: 'hybrid', options: sym.options });
        } else if (sym.type === 'x') {
            for (let i = 0; i < xValue; i++) costToPay.push({ type: 'generic' });
        }
    }

    // 3. Pay cost using Floating Mana first
    const finalCostToTap: typeof costToPay = [];

    for (const req of costToPay) {
        let paid = false;
        if (req.type === 'colored' && req.color) {
            if ((currentFloating[req.color] || 0) > 0) {
                payWithFloating(req.color, 1);
                paid = true;
            }
        } else if (req.type === 'hybrid' && req.options) {
            // Prefer the option we have most of?
            const best = req.options.sort((a, b) => (currentFloating[b] || 0) - (currentFloating[a] || 0))[0];
            if ((currentFloating[best] || 0) > 0) {
                payWithFloating(best, 1);
                paid = true;
            }
        } else if (req.type === 'generic') {
            // Pay with Colorless first
            if ((currentFloating.C || 0) > 0) {
                payWithFloating('C', 1);
                paid = true;
            } else {
                // Pay with any available floating
                const available = MANA_COLORS.find(c => (currentFloating[c] || 0) > 0);
                if (available) {
                    payWithFloating(available, 1);
                    paid = true;
                }
            }
        }

        if (!paid) finalCostToTap.push(req);
    }

    if (finalCostToTap.length === 0) {
        return { tappedIds: [], success: true, floatingManaRemaining: currentFloating, manaProducedFromTap, manaUsed };
    }

    // 4. Tap Sources for Remainder
    const availableSources = [...sources].sort((a, b) => a.priority - b.priority);
    const tappedIds: string[] = [];

    // Helpers for Tapping
    // Helpers for Tapping
    const processTap = (reqColor: ManaColor): boolean => {
        const sourceIdx = availableSources.findIndex(s => s.producedMana.includes(reqColor));
        if (sourceIdx === -1) return false;

        const source = availableSources[sourceIdx];

        // Passive check: Don't add to tappedIds if passive
        if (source.abilityType !== 'passive') {
            tappedIds.push(source.objectId);
        }

        // Remove from availableSources to prevent reuse of this specific instance
        availableSources.splice(sourceIdx, 1);

        const unique = new Set(source.producedMana);
        if (unique.size === 1) {
            // Fixed producer (e.g. Land or Sol Ring)
            const color = source.producedMana[0] as ManaColor;
            const count = source.producedMana.length;
            manaProducedFromTap[color] += count; // Stats
            currentFloating[color] += count; // Add to pool

            // Spend 1 for requirement
            currentFloating[reqColor]--;
            manaUsed[reqColor]++;
        } else {
            // Flexible producer (e.g. City of Brass)
            manaProducedFromTap[reqColor] += 1; // Stats
            // Implicitly produced and used 1
            manaUsed[reqColor]++;
        }
        return true;
    };

    // Separate requirements
    const colorReqs = finalCostToTap.filter(r => r.type === 'colored');
    const hybridReqs = finalCostToTap.filter(r => r.type === 'hybrid');
    const genReqs = finalCostToTap.filter(r => r.type === 'generic');

    // Tap for Colored
    for (const req of colorReqs) {
        if (!req.color || !processTap(req.color)) return { tappedIds: [], success: false, floatingManaRemaining: initialFloatingMana, manaProducedFromTap: { ...EMPTY_POOL }, manaUsed: { ...EMPTY_POOL } };
    }

    // Tap for Hybrid
    for (const req of hybridReqs) {
        if (!req.options) continue;
        let done = false;
        // Try paying with floating (if new mana was produced?)
        for (const opt of req.options) {
            if ((currentFloating[opt] || 0) > 0) {
                payWithFloating(opt, 1);
                done = true;
                break;
            }
        }
        if (!done) {
            for (const opt of req.options) {
                if (processTap(opt)) {
                    done = true;
                    break;
                }
            }
        }
        if (!done) return { tappedIds: [], success: false, floatingManaRemaining: initialFloatingMana, manaProducedFromTap: { ...EMPTY_POOL }, manaUsed: { ...EMPTY_POOL } };
    }

    // Tap for Generic
    for (const req of genReqs) {
        // Try paying with floating
        const anyFloat = MANA_COLORS.find(c => (currentFloating[c] || 0) > 0);
        if (anyFloat) {
            payWithFloating(anyFloat, 1);
            continue;
        }

        // Tap generic
        const sourceIdx = availableSources.findIndex(s => !tappedIds.includes(s.objectId));
        if (sourceIdx === -1) return { tappedIds: [], success: false, floatingManaRemaining: initialFloatingMana, manaProducedFromTap: { ...EMPTY_POOL }, manaUsed: { ...EMPTY_POOL } };

        const source = availableSources[sourceIdx];
        tappedIds.push(source.objectId);

        const unique = new Set(source.producedMana);
        if (unique.size === 1) {
            const color = source.producedMana[0] as ManaColor;
            const count = source.producedMana.length;
            manaProducedFromTap[color] += count;
            currentFloating[color] += count;

            currentFloating[color]--;
            manaUsed[color]++;
        } else {
            const color = source.producedMana[0] as ManaColor;
            manaProducedFromTap[color] += 1;
            manaUsed[color]++;
        }
    }

    return { tappedIds, success: true, floatingManaRemaining: currentFloating, manaProducedFromTap, manaUsed };
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
    previousFloatingMana: ManaPool;
};

export const MAX_UNDO_HISTORY = 20;


// --- Mana Production Estimation ---
// Heuristic to determine produced mana colors if Scryfall data is missing
export const estimateProducedMana = (card: { name: string; typeLine: string; oracleText: string; producedMana?: string[] }): import('../types').CardData['producedMana'] => {
    // If we already have confirmed data from Scryfall, trust it (with exceptions)
    if (card.producedMana && card.producedMana.length > 0) {
        if (card.name === 'Sol Ring') {
            const cCount = card.producedMana.filter(m => m === 'C').length;
            if (cCount < 2) return [...card.producedMana, 'C'];
        }
        return card.producedMana;
    }

    const produced: string[] = [];
    const typeLine = card.typeLine.toLowerCase();
    const text = card.oracleText ? card.oracleText.toLowerCase() : "";

    // 1. Basic Land Types (intrinsic ability)
    if (typeLine.includes('plains')) produced.push('W');
    if (typeLine.includes('island')) produced.push('U');
    if (typeLine.includes('swamp')) produced.push('B');
    if (typeLine.includes('mountain')) produced.push('R');
    if (typeLine.includes('forest')) produced.push('G');
    if (typeLine.includes('wastes')) produced.push('C');

    // 2. Oracle Text Analysis "Add {X}"
    // Match specific symbols
    const matches = text.match(/add\s*((?:\{[wubrgc0-9]\})+)/g);
    if (matches) {
        matches.forEach(match => {
            if (match.includes('{w}')) produced.push('W');
            if (match.includes('{u}')) produced.push('U');
            if (match.includes('{b}')) produced.push('B');
            if (match.includes('{r}')) produced.push('R');
            if (match.includes('{g}')) produced.push('G');
            if (match.includes('{c}')) produced.push('C');
            // Duplicate handling for {C}{C} (Sol Ring)
            // If the string has multiple of same char, push multiple?
            // "add {c}{c}" -> match group "{c}{c}"
            const cCount = (match.match(/\{c\}/g) || []).length;
            // We already pushed one C if includes('{c}').
            // If cCount > 1, push extra.
            for (let i = 1; i < cCount; i++) produced.push('C');
        });
    }

    // 3. "Add one mana of any color" or Command Tower / Arcane Signet
    if (text.includes('one mana of any color') || text.includes('add one mana of any type') || card.name === 'Command Tower' || card.name === 'Arcane Signet') {
        const anyColor = ['W', 'U', 'B', 'R', 'G'];
        // We return ALL colors as "potential" production
        // But for flexible sources, we usually want to know OPTIONS.
        // producedMana usually stores OPTIONS for multi.
        // For Sol Ring, it stores ['C', 'C'].
        // For Arcane Signet, it stores ['W', 'U', 'B', 'R', 'G'].
        anyColor.forEach(c => {
            if (!produced.includes(c)) produced.push(c);
        });
    }

    // 4. Common keywords/patterns
    if (card.name === 'Sol Ring') {
        // Ensure at least 2 C
        const cCount = produced.filter(c => c === 'C').length;
        if (cCount < 2) produced.push('C'); // Add missing C
    }

    if (produced.length > 0) return produced;
    return undefined;
};

import { BoardObject, ManaRule, ManaColor as ManaColorType, CardData } from '../types';

// --- Mana Symbol Types ---
export type ManaColor = 'W' | 'U' | 'B' | 'R' | 'G' | 'C' | 'WUBRG' | 'CMD'; // White, Blue, Black, Red, Green, Colorless, All, Commander
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
    C: number;
    WUBRG: number; // Any color
    CMD: number; // Any commander color
}

export interface ManaCost {
    symbols: ManaSymbol[];
    cmc: number;
    hasX: boolean;
}

export const EMPTY_POOL: ManaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, WUBRG: 0, CMD: 0 };

export const MANA_COLORS: ManaColor[] = ['W', 'U', 'B', 'R', 'G', 'C', 'WUBRG', 'CMD'];
export const BASE_COLORS: ManaColor[] = ['W', 'U', 'B', 'R', 'G', 'C'];

export const MANA_DISPLAY: Record<ManaColor, { symbol: string; color: string; bg: string }> = {
    W: { symbol: '☀', color: '#FFF9E6', bg: '#F9E4B7' },
    U: { symbol: '💧', color: '#0E68AB', bg: '#AAD4F5' },
    B: { symbol: '💀', color: '#150B00', bg: '#BAB1A8' },
    R: { symbol: '🔥', color: '#D32029', bg: '#F9AA8F' },
    G: { symbol: '🌲', color: '#00733E', bg: '#9BD3AE' },
    C: { symbol: '◇', color: '#CBC2BF', bg: '#CBC2BF' },
    WUBRG: { symbol: '🌈', color: '#FFFFFF', bg: '#FFFFFF' },
    CMD: { symbol: '👑', color: '#FFD700', bg: '#B8860B' },
};

// --- Mana Cost Parsing ---
export const parseManaCost = (manaCostStr: string): ManaCost => {
    if (!manaCostStr) return { symbols: [], cmc: 0, hasX: false };

    const symbols: ManaSymbol[] = [];
    let cmc = 0;
    let hasX = false;

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
export const parseProducedMana = (producedMana: string[] | undefined): ManaColor[] => {
    if (!producedMana || producedMana.length === 0) return [];
    return producedMana
        .map(m => m.toUpperCase())
        .filter(m => MANA_COLORS.includes(m as ManaColor)) as ManaColor[];
};

export interface ManaSource {
    objectId: string;
    cardName: string;
    producedMana: ManaColor[];
    isBasic: boolean;
    isFlexible: boolean;
    priority: number;
    abilityType: 'tap' | 'activated' | 'multi' | 'complex' | 'passive';
    activationCost?: string;
    manaCount?: number;
    alternativeRule?: ManaRule;
    hideManaButton?: boolean;
    // New fields for categorization
    isLand: boolean;
    hasOROption: boolean; // True if this source has an OR ability
    orColors?: ManaColor[][]; // Array of color options for OR abilities
    autoTap?: boolean; // Whether this source is allowed to be auto-tapped
    quantity: number; // Number of objects in the stack
}

// NEW: Categorized mana info for the new display
export interface CategorizedManaInfo {
    // Available: Untapped lands that can produce mana (auto-counted)
    available: ManaPool;
    availableTotal: number;
    availableSources: ManaSource[];

    // Potential: Creatures/artifacts/other tap sources (blue number)
    potential: ManaPool;
    potentialTotal: number;
    potentialSources: ManaSource[];

    // NEW: Total mana capacity of the board (all sources, regardless of tapped state)
    totalBoardPotential: number;

    // Combined sources for reference
    sources: ManaSource[];
    cmdColors?: ManaColor[];
}

// --- Available Mana Calculation (REFACTORED) ---
export const calculateAvailableMana = (
    boardObjects: BoardObject[],
    controllerId: string,
    defaultRotation: number,
    commanderColors?: ManaColor[],
    manaRules?: Record<string, ManaRule>
): CategorizedManaInfo => {
    const available: ManaPool = { ...EMPTY_POOL };
    const potential: ManaPool = { ...EMPTY_POOL };
    const availableSources: ManaSource[] = [];
    const potentialSources: ManaSource[] = [];
    const allSources: ManaSource[] = [];

    // Track OR sources for correct total counting
    let orSourceCount = 0;

    // Global rules scan
    const globalRules: { rule: ManaRule, sourceId: string }[] = [];
    const multipliers: { factor: number, appliesTo: ('creatures' | 'lands' | 'basics')[] }[] = [];

    if (manaRules) {
        boardObjects.forEach(obj => {
            if (obj.controllerId !== controllerId || obj.type !== 'CARD') return;
            const rule = manaRules[obj.cardData.scryfallId];
            if (!rule || rule.disabled) return;
            if (rule.appliesTo && rule.appliesTo.length > 0) {
                globalRules.push({ rule, sourceId: obj.id });
            }
            if (rule.manaMultiplier && rule.manaMultiplier > 1) {
                multipliers.push({
                    factor: rule.manaMultiplier,
                    appliesTo: rule.appliesTo as any || ['lands', 'creatures']
                });
            }
        });
    }

    // Pre-compute board counts
    let creatureCount = -1;
    let basicLandCount = -1;
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

        const customRule = manaRules?.[obj.cardData.scryfallId];
        const myTypeLine = (obj.cardData.typeLine || '').toLowerCase();
        let isLand = myTypeLine.includes('land');
        if (customRule && customRule.isLandOverride !== undefined) {
            isLand = customRule.isLandOverride;
        }

        let produced: ManaColor[] = [];
        let abilityType: 'tap' | 'activated' | 'multi' | 'complex' | 'passive' = 'tap';
        let sourcePriority: number = 2;
        let manaCountScored = 0;
        let hideManaButton = customRule?.hideManaButton ?? false;
        let hasOROption = false;
        let orColors: ManaColor[][] | undefined;

        if (customRule && !customRule.disabled) {
            // Custom rule path
            let calcAmount = 1;
            switch (customRule.calcMode) {
                case 'set':
                    calcAmount = 1;
                    break;
                case 'counters': {
                    let totalCounters = 0;
                    if (obj.counters) {
                        Object.values(obj.counters).forEach(count => totalCounters += count);
                    }
                    if (customRule.includeBasePower) {
                        const powerMatch = obj.cardData.power?.match(/^\d+/);
                        if (powerMatch) totalCounters += parseInt(powerMatch[0]);
                    }
                    calcAmount = totalCounters * (customRule.calcMultiplier || 1);
                    break;
                }
                case 'creatures':
                    calcAmount = getCreatureCount() * (customRule.calcMultiplier || 1);
                    break;
                case 'basicLands':
                    calcAmount = getBasicLandCount() * (customRule.calcMultiplier || 1);
                    break;
            }

            produced = [];

            // Check for OR abilities (alternativeRule means OR option)
            if (customRule.alternativeRule) {
                hasOROption = true;
                orColors = [];

                // Primary side - calculate total mana count
                let primaryTotal = 0;
                const primaryColors: ManaColor[] = [];
                for (const [color, count] of Object.entries(customRule.produced)) {
                    if (count > 0) {
                        primaryTotal += count;
                        if (color === 'WUBRG') {
                            primaryColors.push('W', 'U', 'B', 'R', 'G');
                        } else if (color === 'CMD') {
                            if (commanderColors) primaryColors.push(...commanderColors);
                        } else {
                            primaryColors.push(color as ManaColor);
                        }
                    }
                }
                orColors.push(primaryColors);

                // Alternative side - calculate total mana count
                let altTotal = 0;
                const altColors: ManaColor[] = [];
                if (customRule.alternativeRule.produced) {
                    for (const [color, count] of Object.entries(customRule.alternativeRule.produced)) {
                        if (count > 0) {
                            altTotal += count;
                            if (color === 'WUBRG') {
                                altColors.push('W', 'U', 'B', 'R', 'G');
                            } else if (color === 'CMD') {
                                if (commanderColors) altColors.push(...commanderColors);
                            } else {
                                altColors.push(color as ManaColor);
                            }
                        }
                    }
                }
                orColors.push(altColors);

                // For display, show all unique colors from both options
                const allColors = new Set<ManaColor>([...primaryColors, ...altColors]);
                produced = Array.from(allColors);

                // OR sources: total = max(primary side, alt side)
                // Example: "W2 OR G2" -> max(2, 2) = 2
                // Example: "R1 G1 B1 OR W2" -> max(3, 2) = 3
                manaCountScored = Math.max(primaryTotal, altTotal);
            } else if (customRule.prodMode === 'standard') {
                const amount = customRule.calcMode === 'set' ? 1 : calcAmount;
                for (const [color, count] of Object.entries(customRule.produced)) {
                    const total = count * amount;
                    if (total <= 0) continue;
                    manaCountScored += total;
                    if (color === 'WUBRG' || color === 'CMD') {
                        for (let i = 0; i < total; i++) produced.push(color);
                    } else {
                        for (let i = 0; i < total; i++) produced.push(color as ManaColor);
                    }
                }
            } else if (customRule.prodMode === 'available') {
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
                    if (lo.cardData.producedMana) {
                        lo.cardData.producedMana.forEach(m => {
                            const uc = m.toUpperCase() as ManaColor;
                            if (uc === 'WUBRG') ['W', 'U', 'B', 'R', 'G'].forEach(c => landColors.add(c as ManaColor));
                            else if (uc === 'CMD') (commanderColors || []).forEach(c => landColors.add(c));
                            else if (MANA_COLORS.includes(uc)) landColors.add(uc);
                        });
                    }
                });
                const amount = customRule.calcMode === 'set'
                    ? Math.max(1, Object.values(customRule.produced).reduce((a, b) => a + b, 0))
                    : calcAmount;
                landColors.forEach(c => {
                    for (let i = 0; i < amount; i++) produced.push(c);
                });
                manaCountScored = amount;
            } else if (customRule.prodMode === 'chooseColor') {
                const amount = customRule.calcMode === 'set'
                    ? (customRule.produced['C'] || 1)
                    : calcAmount;
                for (const c of ['W', 'U', 'B', 'R', 'G'] as ManaColor[]) {
                    for (let i = 0; i < amount; i++) produced.push(c);
                }
                manaCountScored = amount;
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
                manaCountScored = amount;
            } else if (customRule.prodMode === 'sameAsCard') {
                const cardProducedMana = obj.cardData.producedMana || [];
                const multiplier = customRule.calcMultiplier || 1;
                if (cardProducedMana.length > 0) {
                    for (const color of cardProducedMana) {
                        for (let i = 0; i < multiplier; i++) {
                            produced.push(color as ManaColor);
                        }
                    }
                    manaCountScored = cardProducedMana.length * multiplier;
                }
            } else {
                // Multiplied mode
                for (const [color, count] of Object.entries(customRule.produced)) {
                    const total = count * calcAmount;
                    if (total <= 0) continue;
                    manaCountScored += total;
                    if (color === 'WUBRG') {
                        for (let i = 0; i < total; i++) produced.push('W', 'U', 'B', 'R', 'G');
                    } else if (color === 'CMD') {
                        if (commanderColors) {
                            for (let i = 0; i < total; i++) produced.push(...commanderColors);
                        }
                    } else {
                        for (let i = 0; i < total; i++) produced.push(color as ManaColor);
                    }
                }
            }

            // if (produced.length === 0) return;

            abilityType = customRule.trigger === 'tap' ? 'tap' :
                customRule.trigger === 'activated' ? 'activated' :
                    customRule.trigger === 'passive' ? 'passive' : 'tap';
            sourcePriority = customRule.autoTap ? customRule.autoTapPriority : 999;

            // Calculate Net Mana for Available/Potential counts (subtract activation cost)
            let totalCost = 0;
            if (customRule.genericActivationCost) totalCost += customRule.genericActivationCost;
            if (customRule.activationCost) {
                Object.values(customRule.activationCost).forEach(v => totalCost += v);
            }
            if (totalCost > 0) {
                manaCountScored = Math.max(0, manaCountScored - totalCost);
            }

        } else {
            // Default path
            // Default path - start with card's native mana production
            produced = (obj.cardData.producedMana || []) as ManaColor[];

            // If no native production, try to estimate
            if (produced.length === 0) {
                const estimated = estimateProducedMana(obj.cardData as any);
                if (estimated && estimated.length > 0) {
                    produced = estimated as ManaColor[];
                }
            }

            const isBas = isBasicLand(obj.cardData.name);
            if (isBas) {
                hideManaButton = true;
                isLand = true; // Basics are always lands
                if (produced.length === 0) {
                    const color = getBasicLandColor(obj.cardData.name);
                    if (color) produced = [color];
                }
            }

            if ((obj.cardData.name === 'Command Tower' || obj.cardData.name === 'Arcane Signet') && commanderColors) {
                // If it produces CMD, it's already "any color in commander's identity"
                // If it produces WUBRG, we filter it to ONLY commander colors
                if (produced.includes('WUBRG')) {
                    produced = produced.filter(c => c !== 'WUBRG');
                    produced.push(...commanderColors);
                } else if (!produced.includes('CMD')) {
                    produced = produced.filter(c => commanderColors.includes(c) || c === 'C');
                }
            }

            abilityType = (obj.cardData.manaAbilityType || 'tap') as typeof abilityType;
            sourcePriority = getManaPriority(obj.cardData, produced);

            const unique = new Set(produced);
            if (unique.size > 1 || unique.has('WUBRG') || unique.has('CMD')) {
                manaCountScored = 1;
            } else {
                manaCountScored = produced.length;
            }

            // --- Utility Land Detection ---
            // If it's a land and has non-mana tap abilities, we should show the button and avoid auto-tapping
            if (isLand) {
                const text = (obj.cardData.oracleText || '').toLowerCase();
                // Regex for a tap ability that isn't just "Add {mana}"
                // Matches patterns like "{T}: [actions]" where actions don't start with "Add"
                // Or patterns like "Tap an untapped [thing] you control: Add..." (mana-related but complex)
                const hasNonManaTap = text.match(/\{t\},?\s*(?![^:]*add)/i);

                if (hasNonManaTap) {
                    hideManaButton = false;
                    sourcePriority = 999;
                    // We'll set a flag on the source later
                } else if (isBas && !obj.cardData.isToken) {
                    // Basics stay hidden
                    hideManaButton = true;
                }
            }
        }

        // Apply global rules (granted abilities)
        if (globalRules.length > 0) {
            const hasCounters = obj.counters && Object.values(obj.counters).some(v => v > 0);
            const myId = obj.id;

            for (const { rule, sourceId } of globalRules) {
                if (sourceId === myId) continue;

                let matches = false;
                if (rule.appliesTo?.includes('creatures') && myTypeLine.includes('creature')) matches = true;
                if (rule.appliesTo?.includes('lands') && myTypeLine.includes('land')) matches = true;
                if (matches && rule.appliesToCondition === 'counters' && !hasCounters) matches = false;

                if (matches) {
                    let ruleCalcAmount = 1;
                    switch (rule.calcMode) {
                        case 'set': ruleCalcAmount = 1; break;
                        case 'counters': {
                            let c = 0;
                            if (obj.counters) Object.values(obj.counters).forEach(v => c += v);
                            if (rule.includeBasePower) {
                                const pm = obj.cardData.power?.match(/^\d+/);
                                if (pm) c += parseInt(pm[0]);
                            }
                            ruleCalcAmount = c * (rule.calcMultiplier || 1);
                            break;
                        }
                        case 'creatures': ruleCalcAmount = getCreatureCount() * (rule.calcMultiplier || 1); break;
                        case 'basicLands': ruleCalcAmount = getBasicLandCount() * (rule.calcMultiplier || 1); break;
                    }

                    if (rule.prodMode === 'standard') {
                        const amount = rule.calcMode === 'set' ? 1 : ruleCalcAmount;
                        for (const [color, count] of Object.entries(rule.produced)) {
                            for (let i = 0; i < count * amount; i++) produced.push(color as ManaColor);
                        }
                    } else {
                        ['W', 'U', 'B', 'R', 'G'].forEach(c => produced.push(c as ManaColor));
                    }

                    if (abilityType === 'passive') {
                        abilityType = rule.trigger === 'activated' ? 'activated' : 'tap';
                    }
                }
            }
        }

        if (produced.length === 0) return;

        // Apply multipliers
        if (multipliers.length > 0 && manaCountScored > 0) {
            const isBas = isBasicLand(obj.cardData.name);
            multipliers.forEach(m => {
                let applies = false;
                if (m.appliesTo?.includes('basics' as any) && isBas) applies = true;
                else if (m.appliesTo?.includes('nonbasics' as any) && isLand && !isBas) applies = true;
                else if (m.appliesTo?.includes('lands') && isLand) applies = true;
                else if (m.appliesTo?.includes('creatures') && myTypeLine.includes('creature')) applies = true;

                if (applies) {
                    const originalProduced = [...produced];
                    for (let i = 1; i < m.factor; i++) {
                        produced.push(...originalProduced);
                    }
                    manaCountScored *= m.factor;
                }
            });
        }

        const isBasic = isBasicLand(obj.cardData.name);
        const isFlexible = isFlexibleMana(produced);

        let activationCostStr: string | undefined;
        if (customRule) {
            const parts: string[] = [];
            if (customRule.genericActivationCost && customRule.genericActivationCost > 0) {
                parts.push(`{${customRule.genericActivationCost}}`);
            }
            Object.entries(customRule.activationCost).forEach(([color, count]) => {
                if (count > 0) parts.push(Array(count).fill(`{${color}}`).join(''));
            });
            activationCostStr = parts.join('');
        } else {
            activationCostStr = obj.cardData.manaActivationCost;
        }

        const source: ManaSource = {
            objectId: obj.id,
            cardName: obj.cardData.name,
            producedMana: produced,
            isBasic,
            isFlexible,
            priority: sourcePriority,
            abilityType,
            activationCost: activationCostStr,
            manaCount: manaCountScored,
            alternativeRule: customRule?.alternativeRule,
            hideManaButton,
            isLand,
            hasOROption,
            orColors,
            autoTap: customRule ? customRule.autoTap : (sourcePriority < 999),
            quantity: obj.quantity
        };

        allSources.push(source);

        const isNowTapped = (obj.quantity === 1)
            ? (obj.rotation !== defaultRotation)
            : (obj.tappedQuantity === obj.quantity);

        const untappedCount = isNowTapped ? 0 : Math.max(0, obj.quantity - obj.tappedQuantity);
        if (untappedCount === 0 && abilityType !== 'passive') return;

        // Categorize: Lands go to Available, others go to Potential
        // Correction: All Lands (tap, activated, etc) should ideally go to Available to show "Land Mana"
        // But we need to be careful with activated abilities that cost mana.
        // For now, if it's a Land, put it in Available.

        if (abilityType === 'passive') {
            // Passive sources add to available directly
            availableSources.push(source);
            if (isFlexible) {
                produced.forEach(c => {
                    if (c === 'WUBRG') ['W', 'U', 'B', 'R', 'G'].forEach(color => available[color as ManaColor] = (available[color as ManaColor] || 0) + 1);
                    else if (c === 'CMD') (commanderColors || []).forEach(color => available[color] = (available[color] || 0) + 1);
                    else available[c] = (available[c] || 0) + 1;
                });
            } else {
                produced.forEach(c => { available[c] = (available[c] || 0) + 1; });
            }
        } else if (isLand) {
            // Land sources = Available (regardless of ability type being tap or activated for now, to support filter lands)
            // Note: complex activated abilities might be tricky, but for Sungrass Prairie it is `activated`.
            for (let i = 0; i < untappedCount; i++) {
                availableSources.push(source);
                if (isFlexible) {
                    if (hasOROption && orColors) {
                        // USER REQUEST: Show all branches in individual counters
                        // availableTotal will still only count manaCountScored (max of branches)
                        orSourceCount++;
                        orColors.forEach(branch => {
                            branch.forEach(c => {
                                available[c] = (available[c] || 0) + 1;
                            });
                        });
                    } else {
                        // Standard WUBRG handling for wildcards
                        if (produced.includes('WUBRG')) available['WUBRG'] = (available['WUBRG'] || 0) + 1;
                        else if (produced.includes('CMD') && commanderColors) available['CMD'] = (available['CMD'] || 0) + 1;
                        else {
                            // Dual lands etc - add to individual counts so they show up in counters
                            const unique = Array.from(new Set(produced));
                            unique.forEach(c => {
                                available[c] = (available[c] || 0) + 1;
                            });
                        }
                    }
                } else {
                    produced.forEach(c => { available[c] = (available[c] || 0) + 1; });
                }
            }
        } else {
            // Creatures, artifacts = Potential
            for (let i = 0; i < untappedCount; i++) {
                potentialSources.push(source);
                if (isFlexible) {
                    if (hasOROption) {
                        potential['WUBRG'] = (potential['WUBRG'] || 0) + 1;
                    } else {
                        if (produced.includes('WUBRG')) potential['WUBRG'] = (potential['WUBRG'] || 0) + 1;
                        else if (produced.includes('CMD') && commanderColors) potential['CMD'] = (potential['CMD'] || 0) + 1;
                        else {
                            potential['WUBRG'] = (potential['WUBRG'] || 0) + 1;
                        }
                    }
                } else {
                    produced.forEach(c => { potential[c] = (potential[c] || 0) + 1; });
                }
            }
        }
    });

    // Calculate totals
    // For available: use manaCount (already set to max(primary, alt) for OR sources)
    const availableTotal = availableSources.reduce((sum, s) => {
        return sum + (s.manaCount || 1);
    }, 0);

    const potentialTotal = potentialSources.reduce((sum, s) => sum + (s.manaCount || 1), 0);
    const totalBoardPotential = allSources.reduce((sum, s) => sum + ((s.manaCount || 1) * s.quantity), 0);

    return {
        available,
        availableTotal,
        availableSources,
        potential,
        potentialTotal,
        potentialSources,
        totalBoardPotential,
        sources: allSources,
        cmdColors: commanderColors
    };
};

// Helper to determine if mana production is flexible (requires choice)
const isFlexibleMana = (produced: ManaColorType[]): boolean => {
    const unique = new Set(produced);
    return unique.size > 1 || unique.has('WUBRG') || unique.has('CMD');
};

// --- Basic Land Detection ---
const BASIC_LAND_NAMES = [
    'plains', 'island', 'swamp', 'mountain', 'forest', 'wastes',
    'snow-covered plains', 'snow-covered island', 'snow-covered swamp', 'snow-covered mountain', 'snow-covered forest', 'snow-covered wastes'
];

export const isBasicLand = (name: string): boolean => {
    return BASIC_LAND_NAMES.includes(name.toLowerCase());
};

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
    if (isBasic) return 0;

    // Check if it's a land
    const typeLine = (card.typeLine || '').toLowerCase();
    const isLand = typeLine.includes('land');

    if (isLand) {
        if (produced.length <= 1) return 1; // Basic non-basic (e.g. specialized land)
        return 2; // Dual/Tri lands
    }

    // Non-lands (rocks/dorks)
    if (produced.length <= 1) return 3;
    const uniqueColors = new Set(produced);
    if (uniqueColors.size > 1) return 4;
    return 3;
};

// --- Auto-Tap Algorithm ---
export const autoTapForCost = (
    cost: ManaCost,
    sources: ManaSource[],
    initialFloatingMana: ManaPool = { ...EMPTY_POOL },
    xValue: number = 0,
    commanderColors?: ManaColor[]
): {
    tappedIds: string[];
    success: boolean;
    floatingManaRemaining: ManaPool;
    manaProducedFromTap: ManaPool;
    manaUsed: ManaPool;
} => {
    const manaProducedFromTap: ManaPool = { ...EMPTY_POOL };
    const manaUsed: ManaPool = { ...EMPTY_POOL };
    const currentFloating = { ...initialFloatingMana };

    const payWithFloating = (reqColor: ManaColor, count: number, options?: ManaColor[]): number => {
        let remainingToPay = count;

        // 1. Try exact match
        if (reqColor !== 'WUBRG' && reqColor !== 'CMD') {
            const available = currentFloating[reqColor] || 0;
            const paid = Math.min(available, remainingToPay);
            currentFloating[reqColor] -= paid;
            manaUsed[reqColor] += paid;
            remainingToPay -= paid;
        }

        // 2. Try hybrid options index exact
        if (remainingToPay > 0 && options) {
            for (const opt of options) {
                const available = currentFloating[opt] || 0;
                const paid = Math.min(available, remainingToPay);
                currentFloating[opt] -= paid;
                manaUsed[opt] += paid;
                remainingToPay -= paid;
                if (remainingToPay <= 0) break;
            }
        }

        // 3. Try WUBRG wildcard
        if (remainingToPay > 0 && (currentFloating.WUBRG || 0) > 0) {
            const paid = Math.min(currentFloating.WUBRG, remainingToPay);
            currentFloating.WUBRG -= paid;
            // For stats, we don't know the exact color used, use reqColor if specific
            const statColor = (reqColor !== 'WUBRG' && reqColor !== 'CMD') ? reqColor : 'WUBRG' as ManaColor;
            manaUsed[statColor] += paid;
            remainingToPay -= paid;
        }

        // 4. Try CMD wildcard
        if (remainingToPay > 0 && (currentFloating.CMD || 0) > 0) {
            // Only if it's generic OR if reqColor is in identity
            const isMatch = (reqColor as any) === 'CMD' || (reqColor as any) === 'WUBRG' || (reqColor !== 'WUBRG' && commanderColors?.includes(reqColor));
            if (isMatch) {
                const paid = Math.min(currentFloating.CMD, remainingToPay);
                currentFloating.CMD -= paid;
                const statColor = (reqColor !== 'WUBRG' && reqColor !== 'CMD') ? reqColor : 'CMD' as ManaColor;
                manaUsed[statColor] += paid;
                remainingToPay -= paid;
            }
        }

        return count - remainingToPay;
    };

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

    const finalCostToTap: typeof costToPay = [];

    for (const req of costToPay) {
        let paid = 0;
        if (req.type === 'colored' && req.color) {
            paid = payWithFloating(req.color, 1);
        } else if (req.type === 'hybrid' && req.options) {
            paid = payWithFloating('WUBRG', 1, req.options); // Use generic search with options
        } else if (req.type === 'generic') {
            // For generic, we can use colorless first
            if ((currentFloating.C || 0) > 0) {
                currentFloating.C--;
                manaUsed.C++;
                paid = 1;
            } else {
                // Try any color we have
                const anyColor = BASE_COLORS.find(c => (currentFloating[c] || 0) > 0) ||
                    (currentFloating.WUBRG > 0 ? 'WUBRG' as ManaColor : null) ||
                    (currentFloating.CMD > 0 ? 'CMD' as ManaColor : null);
                if (anyColor) {
                    paid = payWithFloating(anyColor, 1);
                }
            }
        }
        if (paid === 0) finalCostToTap.push(req);
    }

    if (finalCostToTap.length === 0) {
        return { tappedIds: [], success: true, floatingManaRemaining: currentFloating, manaProducedFromTap, manaUsed };
    }

    const availableSources = [...sources].sort((a, b) => a.priority - b.priority);
    const tappedIds: string[] = [];

    const canSatisfy = (produced: ManaColor[], reqColor: ManaColor): boolean => {
        if (produced.includes(reqColor)) return true;
        if (reqColor === 'WUBRG') {
            return produced.some(p => ['W', 'U', 'B', 'R', 'G', 'WUBRG', 'CMD'].includes(p));
        }
        if (produced.includes('WUBRG') && ['W', 'U', 'B', 'R', 'G'].includes(reqColor)) return true;
        if (produced.includes('CMD') && (commanderColors || []).includes(reqColor)) return true;
        return false;
    };

    const processTap = (reqColor: ManaColor): boolean => {
        const sourceIdx = availableSources.findIndex(s => s.autoTap !== false && canSatisfy(s.producedMana, reqColor));
        if (sourceIdx === -1) return false;

        const source = availableSources[sourceIdx];
        if (source.abilityType !== 'passive') {
            tappedIds.push(source.objectId);
        }
        availableSources.splice(sourceIdx, 1);

        const unique = new Set(source.producedMana);
        if (unique.size === 1 && !unique.has('WUBRG') && !unique.has('CMD')) {
            const color = source.producedMana[0] as ManaColor;
            const count = source.producedMana.length;
            manaProducedFromTap[color] += count;
            currentFloating[color] += count;
            currentFloating[reqColor]--;
            manaUsed[reqColor]++;
        } else {
            const count = source.manaCount || 1;
            manaProducedFromTap[reqColor] += count;
            currentFloating[reqColor] += (count - 1); // We use 1 immediately for the requirement
            manaUsed[reqColor]++;
        }
        return true;
    };

    const colorReqs = finalCostToTap.filter(r => r.type === 'colored');
    const hybridReqs = finalCostToTap.filter(r => r.type === 'hybrid');
    const genReqs = finalCostToTap.filter(r => r.type === 'generic');

    for (const req of colorReqs) {
        if (!req.color || !processTap(req.color)) return { tappedIds: [], success: false, floatingManaRemaining: initialFloatingMana, manaProducedFromTap: { ...EMPTY_POOL }, manaUsed: { ...EMPTY_POOL } };
    }

    for (const req of hybridReqs) {
        if (!req.options) continue;
        let done = false;
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

    for (const req of genReqs) {
        const anyFloat = BASE_COLORS.find(c => (currentFloating[c] || 0) > 0);
        if (anyFloat) {
            payWithFloating(anyFloat, 1);
            continue;
        }

        const sourceIdx = availableSources.findIndex(s => s.autoTap !== false && !tappedIds.includes(s.objectId));
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
            const count = source.manaCount || 1;
            manaProducedFromTap[color] += count;
            currentFloating[color] += (count - 1); // We use 1 immediately for the generic requirement
            manaUsed[color]++;
        }
    }

    return { tappedIds, success: true, floatingManaRemaining: currentFloating, manaProducedFromTap, manaUsed };
};

// --- Floating Mana ---
export const addToManaPool = (pool: ManaPool, source: ManaSource): ManaPool => {
    const newPool = { ...pool };
    if (source.isBasic) {
        const basicColor = getBasicLandColor(source.cardName);
        if (basicColor) newPool[basicColor]++;
    } else if (source.producedMana.length === 1) {
        newPool[source.producedMana[0]]++;
    }
    return newPool;
};

export const subtractFromPool = (pool: ManaPool, cost: ManaCost, commanderColors?: ManaColor[]): ManaPool | null => {
    const newPool = { ...pool };

    // Function to pay a specific color (or hybrid) from floating mana wildcards
    const payWildcard = (color: ManaColor): boolean => {
        // 1. Try WUBRG
        if (newPool.WUBRG > 0) {
            newPool.WUBRG--;
            return true;
        }
        // 2. Try CMD if color is in identity
        if (newPool.CMD > 0) {
            const isMatch = color === ('CMD' as any) || color === ('WUBRG' as any) || (commanderColors?.includes(color));
            if (isMatch) {
                newPool.CMD--;
                return true;
            }
        }
        return false;
    };

    for (const sym of cost.symbols) {
        if (sym.type === 'colored') {
            if (newPool[sym.color] > 0) {
                newPool[sym.color]--;
            } else if (!payWildcard(sym.color)) {
                return null;
            }
        } else if (sym.type === 'hybrid') {
            // Try to find a match among options
            let paid = false;
            for (const opt of sym.options) {
                if (newPool[opt] > 0) {
                    newPool[opt]--;
                    paid = true;
                    break;
                }
            }
            if (!paid) {
                // Try wildcards - if any option is in identity for CMD, or just WUBRG
                let wildcardPaid = false;
                if (newPool.WUBRG > 0) {
                    newPool.WUBRG--;
                    wildcardPaid = true;
                } else if (newPool.CMD > 0) {
                    if (sym.options.some(opt => commanderColors?.includes(opt))) {
                        newPool.CMD--;
                        wildcardPaid = true;
                    }
                }
                if (!wildcardPaid) return null;
            }
        } else if (sym.type === 'generic') {
            let remaining = sym.count;
            // Use colorless first
            if (newPool.C >= remaining) {
                newPool.C -= remaining;
                remaining = 0;
            } else {
                remaining -= newPool.C;
                newPool.C = 0;
            }
            // Use colored/wildcard mana for remaining generic
            while (remaining > 0) {
                const colors: ManaColor[] = ['W', 'U', 'B', 'R', 'G', 'WUBRG', 'CMD'];
                const bestColor = colors.reduce((best, c) =>
                    (newPool[c] || 0) > (newPool[best] || 0) ? c : best, 'W' as ManaColor);

                if ((newPool[bestColor] || 0) <= 0) return null;
                newPool[bestColor]--;
                remaining--;
            }
        }
    }

    return newPool;
};

export const poolTotal = (pool: ManaPool): number => {
    return MANA_COLORS.reduce((sum, c) => sum + (pool[c] || 0), 0);
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
    card: any;
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
export const estimateProducedMana = (card: { name: string; typeLine: string; oracleText: string; producedMana?: string[] }): import('../types').CardData['producedMana'] => {
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

    if (typeLine.includes('plains')) produced.push('W');
    if (typeLine.includes('island')) produced.push('U');
    if (typeLine.includes('swamp')) produced.push('B');
    if (typeLine.includes('mountain')) produced.push('R');
    if (typeLine.includes('forest')) produced.push('G');
    if (typeLine.includes('wastes')) produced.push('C');

    const matches = text.match(/add\s*((?:\{[wubrgc0-9]\})+)/g);
    if (matches) {
        matches.forEach(match => {
            if (match.includes('{w}')) produced.push('W');
            if (match.includes('{u}')) produced.push('U');
            if (match.includes('{b}')) produced.push('B');
            if (match.includes('{r}')) produced.push('R');
            if (match.includes('{g}')) produced.push('G');
            if (match.includes('{c}')) produced.push('C');
            const cCount = (match.match(/\{c\}/g) || []).length;
            for (let i = 1; i < cCount; i++) produced.push('C');
        });
    }

    if (text.includes('one mana of any color') || text.includes('add one mana of any type') || card.name === 'Command Tower' || card.name === 'Arcane Signet') {
        const anyColor = ['W', 'U', 'B', 'R', 'G'];
        anyColor.forEach(c => {
            if (!produced.includes(c)) produced.push(c);
        });
    }

    if (card.name === 'Sol Ring') {
        const cCount = produced.filter(c => c === 'C').length;
        if (cCount < 2) produced.push('C');
    }

    if (produced.length > 0) return produced;
    return undefined;
};
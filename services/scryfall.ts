import { CardData } from '../types';
import { estimateProducedMana } from './mana';

const BASE_URL = 'https://api.scryfall.com';

// Cache to prevent spamming Scryfall
const cardCache: { [name: string]: any } = {};

export const fetchCardByName = async (name: string): Promise<CardData | null> => {
    const cleanName = name.trim();
    if (cardCache[cleanName]) {
        return transformScryfallData(cardCache[cleanName]);
    }

    const doFetch = async (retryCount = 0): Promise<CardData | null> => {
        try {
            // Using fuzzy search for better user experience with typos
            const response = await fetch(`${BASE_URL}/cards/named?fuzzy=${encodeURIComponent(cleanName)}`, {
                mode: 'cors',
                credentials: 'omit',
                headers: { 'Accept': 'application/json' }
            });

            // Handle 404 specifically
            if (response.status === 404) {
                // 404 is valid "not found", don't log as error
                return null;
            }

            if (!response.ok) {
                throw new Error(`Scryfall API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            cardCache[cleanName] = data;
            return transformScryfallData(data);
        } catch (error) {
            if (retryCount < 2) {
                // Wait 500ms before retrying
                await new Promise(res => setTimeout(res, 500));
                return doFetch(retryCount + 1);
            }
            console.error(`Error fetching card ${name}:`, error);
            return null;
        }
    };

    return doFetch();
};

export const searchFirstCard = async (query: string): Promise<CardData | null> => {
    const results = await searchCards(query, 1);
    return results.length > 0 ? results[0] : null;
}

export const searchCards = async (query: string, limit = 30): Promise<CardData[]> => {
    try {
        // Use the search endpoint for complex queries (like tokens)
        // unique=prints ensures we see different art/versions
        const response = await fetch(`${BASE_URL}/cards/search?q=${encodeURIComponent(query)}&unique=prints&include_extras=true`, {
            mode: 'cors',
            credentials: 'omit',
            headers: { 'Accept': 'application/json' }
        });

        if (response.status === 404) return [];
        if (!response.ok) throw new Error(`Scryfall search error: ${response.status}`);

        const data = await response.json();
        if (data.data && data.data.length > 0) {
            return data.data.slice(0, limit).map((c: any) => transformScryfallData(c));
        }
        return [];
    } catch (error) {
        console.error(`Error searching cards ${query}:`, error);
        return [];
    }
}

export const fetchBatch = async (names: string[], onProgress?: (current: number, total: number) => void): Promise<Map<string, CardData>> => {
    const uniqueNames = Array.from(new Set(names.map(n => n.trim())));
    const cardMap = new Map<string, CardData>();
    const toFetch: string[] = [];

    // Check Cache First
    uniqueNames.forEach(name => {
        const cachedKey = Object.keys(cardCache).find(key => key.toLowerCase() === name.toLowerCase());
        if (cachedKey) {
            cardMap.set(name.toLowerCase(), transformScryfallData(cardCache[cachedKey]));
        } else {
            toFetch.push(name);
        }
    });

    // Chunk into 75 (Scryfall limit)
    const chunks = [];
    for (let i = 0; i < toFetch.length; i += 75) {
        chunks.push(toFetch.slice(i, i + 75));
    }

    let processedCount = uniqueNames.length - toFetch.length;
    if (onProgress) onProgress(processedCount, uniqueNames.length);

    for (const chunk of chunks) {
        try {
            const body = { identifiers: chunk.map(n => ({ name: n })) };
            const resp = await fetch(`${BASE_URL}/cards/collection`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(body),
                mode: 'cors',
                credentials: 'omit'
            });

            if (!resp.ok) throw new Error('Batch failed');

            const data = await resp.json();

            // Successes
            data.data.forEach((c: any) => {
                const transformed = transformScryfallData(c);
                cardMap.set(c.name.toLowerCase(), transformed);
                cardCache[c.name] = c; // Update cache
            });

            // Fallbacks for Not Found (Try fuzzy individually)
            if (data.not_found && data.not_found.length > 0) {
                for (const nf of data.not_found) {
                    // 75ms delay for individual fallbacks to be safe
                    await new Promise(r => setTimeout(r, 75));
                    const fallback = await fetchCardByName(nf.name);
                    if (fallback) {
                        cardMap.set(nf.name.toLowerCase(), fallback);
                        // Also map the original requested name if it differs
                        const requested = chunk.find(n => n.toLowerCase() === nf.name.toLowerCase());
                        if (requested) cardMap.set(requested.toLowerCase(), fallback);
                    }
                }
            }

        } catch (e) {
            console.error("Batch error, falling back to individual", e);
            // Critical Failure Fallback: Try fetching entire chunk individually
            for (const name of chunk) {
                await new Promise(r => setTimeout(r, 75));
                const fallback = await fetchCardByName(name);
                if (fallback) cardMap.set(name.toLowerCase(), fallback);
            }
        }

        processedCount += chunk.length;
        if (onProgress) onProgress(processedCount, uniqueNames.length);

        // Respect API rate limits
        await new Promise(r => setTimeout(r, 100));
    }

    return cardMap;
}

const transformScryfallData = (data: any): CardData => {
    // Handle double-faced cards (transform)
    let imageUrl = 'https://i.imgur.com/32R3w2i.png'; // Fallback back of card
    if (data.image_uris && data.image_uris.normal) {
        imageUrl = data.image_uris.normal;
    } else if (data.card_faces && data.card_faces[0].image_uris) {
        imageUrl = data.card_faces[0].image_uris.normal;
    }

    return {
        id: crypto.randomUUID(),
        scryfallId: data.id,
        name: data.name,
        imageUrl: imageUrl,
        backImageUrl: data.card_faces && data.card_faces[1] && data.card_faces[1].image_uris
            ? data.card_faces[1].image_uris.normal
            : undefined,
        typeLine: data.type_line,
        oracleText: data.oracle_text || "",
        manaCost: data.mana_cost,
        cmc: data.cmc,
        isLand: data.type_line.toLowerCase().includes('land'),
        isManaSource: data.type_line.toLowerCase().includes('land') ||
            !!(data.produced_mana && data.produced_mana.length > 0) ||
            !!(data.oracle_text && (
                data.oracle_text.includes('{T}: Add') ||
                data.oracle_text.includes('Add {')
            )),
        producedMana: estimateProducedMana({
            name: data.name,
            typeLine: data.type_line,
            oracleText: data.oracle_text || "",
            producedMana: data.produced_mana
        }),
        ...detectManaAbilityType(data),
        power: data.power,
        toughness: data.toughness,
    };
};

// Detect how this card produces mana
const detectManaAbilityType = (data: any): { manaAbilityType?: 'tap' | 'activated' | 'multi' | 'complex'; manaActivationCost?: string } => {
    const text = data.oracle_text || '';
    const typeLine = (data.type_line || '').toLowerCase();

    // Basic lands always have simple tap
    if (typeLine.includes('basic') && typeLine.includes('land')) {
        return { manaAbilityType: 'tap' };
    }

    // Not a mana source
    if (!data.produced_mana && !text.includes('Add {') && !text.includes('{T}: Add')) {
        return {};
    }

    // Check for complex/variable output (Nykthos, Cabal Coffers, etc.)
    if (text.match(/add.*for each/i) || text.match(/add.*equal to/i) || text.match(/add.*X/i)) {
        return { manaAbilityType: 'complex' };
    }

    // Count how many separate "{T}:" or "tap:" abilities exist
    const tapAbilities = text.match(/\{T\}\s*:/g) || [];

    // Check for mana cost in the activation (e.g., "{1}, {T}: Add" or "{G}, {T}: Add")  
    const activatedMatch = text.match(/(\{[^}]+\}(?:\s*,\s*\{[^}]+\})*)\s*,\s*\{T\}\s*:\s*Add/);
    const activatedMatch2 = text.match(/\{T\}\s*,\s*(\{[^}]+\}(?:\s*,\s*\{[^}]+\})*)\s*:\s*Add/);
    // Also detect sacrifice or other costs before tap
    const hasSacrifice = text.match(/sacrifice.*:\s*add/i) || text.match(/,\s*sacrifice.*{T}/i);

    if (hasSacrifice) {
        return { manaAbilityType: 'complex' }; // Don't auto-tap things that sacrifice
    }

    if (tapAbilities.length > 1) {
        // Multiple tap abilities — check if any produce mana
        const manaAbilities = text.match(/\{T\}\s*:\s*Add/g) || [];
        if (manaAbilities.length > 1) {
            return { manaAbilityType: 'multi' };
        }
        // Multiple tap abilities but only one produces mana — might still be activated
        if (activatedMatch || activatedMatch2) {
            const cost = (activatedMatch?.[1] || activatedMatch2?.[1] || '').trim();
            return { manaAbilityType: 'activated', manaActivationCost: cost };
        }
        return { manaAbilityType: 'tap' };
    }

    // Check if it requires mana to activate
    if (activatedMatch || activatedMatch2) {
        const cost = (activatedMatch?.[1] || activatedMatch2?.[1] || '').trim();
        // If the cost is ONLY tap ({T}: Add), it's simple
        if (!cost || cost === '{T}') {
            return { manaAbilityType: 'tap' };
        }
        return { manaAbilityType: 'activated', manaActivationCost: cost };
    }

    // Simple "{T}: Add" with no additional cost
    if (text.includes('{T}: Add') || typeLine.includes('land')) {
        return { manaAbilityType: 'tap' };
    }

    // Fallback — if Scryfall says it produces mana but we can't parse it
    if (data.produced_mana && data.produced_mana.length > 0) {
        return { manaAbilityType: 'tap' };
    }

    return {};
};

// --- Auto-Generate Default Mana Rule ---
// Attempts to create a ManaRule from a card's oracle text and Scryfall data.
// Returns null if the card doesn't produce mana or is a basic land (no rule needed).
import { ManaRule, ManaColor as ManaColorType, EMPTY_MANA_RULE } from '../types';

const ZERO_POOL: Record<ManaColorType, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
const COLOR_MAP: Record<string, ManaColorType> = { w: 'W', u: 'U', b: 'B', r: 'R', g: 'G', c: 'C' };

export const generateDefaultManaRule = (card: CardData): ManaRule | null => {
    const text = card.oracleText || '';
    const typeLine = (card.typeLine || '').toLowerCase();

    // Skip basic lands — handled natively by the mana system
    if (typeLine.includes('basic') && typeLine.includes('land')) return null;

    // Skip non-mana-producing cards
    if (!card.isManaSource) return null;

    // Start from empty rule
    const rule: ManaRule = { ...EMPTY_MANA_RULE, produced: { ...ZERO_POOL } };

    // --- Trigger Detection ---
    const abilityInfo = detectManaAbilityType({
        oracle_text: text,
        type_line: card.typeLine,
        produced_mana: card.producedMana,
    });

    if (abilityInfo.manaAbilityType === 'tap') {
        rule.trigger = 'tap';
    } else if (abilityInfo.manaAbilityType === 'activated') {
        rule.trigger = 'activated';
        // Parse activation cost
        if (abilityInfo.manaActivationCost) {
            const costStr = abilityInfo.manaActivationCost.toLowerCase();
            for (const [key, color] of Object.entries(COLOR_MAP)) {
                const re = new RegExp(`\\{${key}\\}`, 'gi');
                const matches = costStr.match(re);
                if (matches) rule.activationCost[color] = matches.length;
            }
            // Generic mana cost
            const genericMatch = costStr.match(/\{(\d+)\}/);
            if (genericMatch) rule.activationCost.C += parseInt(genericMatch[1]);
        }
    } else if (abilityInfo.manaAbilityType === 'complex') {
        // Complex sources — try to detect "for each" patterns
        rule.trigger = 'tap';
    } else if (abilityInfo.manaAbilityType === 'multi') {
        rule.trigger = 'tap';
    } else {
        // No mana ability detected
        return null;
    }

    // --- CalcMode Detection ---
    const lowerText = text.toLowerCase();
    if (lowerText.match(/for each creature/i)) {
        rule.calcMode = 'creatures';
        rule.prodMode = 'multiplied';
        rule.calcMultiplier = 1;
    } else if (lowerText.match(/for each (basic )?land/i)) {
        rule.calcMode = 'basicLands';
        rule.prodMode = 'multiplied';
        rule.calcMultiplier = 1;
    } else if (lowerText.match(/equal to.*counter/i) || lowerText.match(/for each.*counter/i)) {
        rule.calcMode = 'counters';
        rule.prodMode = 'multiplied';
        rule.calcMultiplier = 1;
    } else {
        rule.calcMode = 'set';
        rule.prodMode = 'standard';
    }

    // --- Produced Mana Detection ---
    // Match "Add {X}{Y}" patterns
    const addMatches = text.match(/[Aa]dd\s+((?:\{[WUBRGC]\})+)/g);
    if (addMatches) {
        for (const m of addMatches) {
            const symbols = m.match(/\{([WUBRGC])\}/gi) || [];
            for (const sym of symbols) {
                const color = COLOR_MAP[sym.replace(/[{}]/g, '').toLowerCase()];
                if (color) rule.produced[color]++;
            }
        }
    }

    // "Add one mana of any color" — mark as flexible (W:1 as default, with alt showing all colors)
    if (lowerText.includes('one mana of any color') || lowerText.includes('mana of any type') || lowerText.includes('mana of any one color')) {
        // Set all to 1 so user sees full flexibility
        rule.produced = { W: 1, U: 1, B: 1, R: 1, G: 1, C: 0 };
    }

    // "Add {C}{C}" (Sol Ring pattern) — check for multiple of same color
    if (card.name === 'Sol Ring') {
        rule.produced = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 2 };
    }

    // Non-basic lands that tap for one color (no oracle text for basic land types)
    if (typeLine.includes('land') && !typeLine.includes('basic')) {
        if (typeLine.includes('plains') && rule.produced.W === 0) rule.produced.W = 1;
        if (typeLine.includes('island') && rule.produced.U === 0) rule.produced.U = 1;
        if (typeLine.includes('swamp') && rule.produced.B === 0) rule.produced.B = 1;
        if (typeLine.includes('mountain') && rule.produced.R === 0) rule.produced.R = 1;
        if (typeLine.includes('forest') && rule.produced.G === 0) rule.produced.G = 1;
    }

    // If we still have no produced mana but Scryfall says it produces, use that
    const totalProduced = Object.values(rule.produced).reduce((a, b) => a + b, 0);
    if (totalProduced === 0 && card.producedMana && card.producedMana.length > 0) {
        for (const m of card.producedMana) {
            const color = m.toUpperCase() as ManaColorType;
            if (color in rule.produced) {
                rule.produced[color]++;
            }
        }
    }

    // Final check — if still no production, skip
    const finalTotal = Object.values(rule.produced).reduce((a, b) => a + b, 0);
    if (finalTotal === 0) return null;

    // --- Auto-tap settings ---
    rule.autoTap = rule.trigger === 'tap';
    // Non-basic, non-creature sources get higher priority (tapped last)
    if (typeLine.includes('land') && !typeLine.includes('basic')) {
        rule.autoTapPriority = 2; // Non-basic lands
    } else if (typeLine.includes('creature')) {
        rule.autoTapPriority = 5; // Creatures that produce mana (tap last)
    } else {
        rule.autoTapPriority = 3; // Artifacts, etc.
    }

    return rule;
};

export const parseDeckList = (text: string): { count: number; name: string }[] => {
    const lines = text.split('\n');
    const cards: { count: number; name: string }[] = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Match "1 Sol Ring" or "1x Sol Ring"
        // Also strip set codes like "(SET) 123" or "[SET] #123" at the end
        const match = trimmed.match(/^(\d+x?|x\d+)?\s*(.+?)(?:\s*[\(\[]\w+[\)\]]\s*\S+)?$/);

        if (match) {
            const countStr = match[1] ? match[1].replace('x', '') : '1';
            const count = parseInt(countStr, 10) || 1;
            let name = match[2].trim();

            // Additional cleanup for specific formats if regex didn't catch all
            // Remove trailing set codes in parentheses if they are at the end
            name = name.replace(/\s*\(.*?\)\s*\d+.*$/, '');
            name = name.replace(/\s*\[.*?\]\s*#?\d+.*$/, '');

            cards.push({ count, name });
        }
    }
    return cards;
};
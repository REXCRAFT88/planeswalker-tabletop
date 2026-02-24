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


export interface ParsedDeck {
    main: { count: number; name: string }[];
    sideboard: { count: number; name: string }[];
    commander: { count: number; name: string }[];
}

export const parseDeckList = (text: string): ParsedDeck => {
    const lines = text.split('\n');
    const result: ParsedDeck = { main: [], sideboard: [], commander: [] };
    let currentSection: keyof ParsedDeck = 'main';

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const lower = trimmed.toLowerCase();
        if (lower === 'sideboard') { currentSection = 'sideboard'; continue; }
        if (lower === 'commander') { currentSection = 'commander'; continue; }
        if (lower === 'deck' || lower === 'mainboard') { currentSection = 'main'; continue; }
        if (lower === 'maybeboard') continue; // Skip maybeboard for now

        // Check for "Sideboard:" format
        if (lower.startsWith('sideboard:')) { currentSection = 'sideboard'; continue; }
        if (lower.startsWith('commander:')) { currentSection = 'commander'; continue; }

        // Match "1 Sol Ring" or "1x Sol Ring"
        const match = trimmed.match(/^(\d+x?|x\d+)?\s*(.+?)(?:\s*[\(\[]\w+[\)\]]\s*\S+)?$/);

        if (match) {
            const countStr = match[1] ? match[1].replace('x', '') : '1';
            const count = parseInt(countStr, 10) || 1;
            let name = match[2].trim();

            // Additional cleanup
            name = name.replace(/\s*\(.*?\)\s*\d+.*$/, '');
            name = name.replace(/\s*\[.*?\]\s*#?\d+.*$/, '');

            result[currentSection].push({ count, name });
        }
    }
    return result;
};
import { CardData } from '../types';

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
                         if(requested) cardMap.set(requested.toLowerCase(), fallback);
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
    power: data.power,
    toughness: data.toughness,
  };
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
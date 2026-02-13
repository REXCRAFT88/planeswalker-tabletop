import React, { useState, useEffect } from 'react';
import { parseDeckList, fetchBatch, searchCards, generateDefaultManaRule } from '../services/scryfall';
import { getManaPriority, parseProducedMana, getBasicLandColor } from '../services/mana';
import { CardData, ManaRule, ManaColor } from '../types';
import { ManaRulesModal } from './ManaRulesModal';
import { Loader2, Download, AlertCircle, Crown, Check, Search, Trash2, Plus, X, ArrowRight, Zap, Filter, Share2, Clipboard } from 'lucide-react';

interface DeckBuilderProps {
    initialDeck: CardData[];
    initialTokens: CardData[];
    initialManaRules?: Record<string, ManaRule>;
    initialName?: string;
    initialId?: string; // ID of the deck being edited
    onDeckReady: (deck: CardData[], tokens: CardData[], shouldSave?: boolean, name?: string, manaRules?: Record<string, ManaRule>, id?: string) => void;
    onBack: () => void;
}

export const DeckBuilder: React.FC<DeckBuilderProps> = ({ initialDeck, initialTokens, initialManaRules, initialName, initialId, onDeckReady, onBack }) => {
    const [deckText, setDeckText] = useState('');
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState<{ current: number, total: number } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');

    // Tabs: DECK -> TOKENS -> MANA
    const [activeTab, setActiveTab] = useState<'DECK' | 'TOKENS' | 'MANA'>('DECK');

    // Token Search State
    const [tokenQuery, setTokenQuery] = useState('');
    const [tokenResults, setTokenResults] = useState<CardData[]>([]);
    const [isSearchingTokens, setIsSearchingTokens] = useState(false);
    const [suggestedTokens, setSuggestedTokens] = useState<CardData[]>([]);
    const [isFetchingSuggestions, setIsFetchingSuggestions] = useState(false);

    const isNewDeck = !initialDeck || initialDeck.length === 0;

    const [deckName, setDeckName] = useState(initialName || (isNewDeck ? 'New Deck' : ''));
    const [manaRules, setManaRules] = useState<Record<string, ManaRule>>(initialManaRules || {});
    const [manaRulesCard, setManaRulesCard] = useState<CardData | null>(null);
    const [hoveredCardId, setHoveredCardId] = useState<string | null>(null);
    const [showManaFilter, setShowManaFilter] = useState(false);

    const [stagedDeck, setStagedDeck] = useState<CardData[] | null>(initialDeck && initialDeck.length > 0 ? initialDeck : null);
    const [stagedTokens, setStagedTokens] = useState<CardData[]>(initialTokens || []);

    // Card search-to-add state
    const [cardSearchQuery, setCardSearchQuery] = useState('');
    const [cardSearchResults, setCardSearchResults] = useState<CardData[]>([]);
    const [isSearchingCards, setIsSearchingCards] = useState(false);

    const searchCardsToAdd = async () => {
        if (!cardSearchQuery.trim()) return;
        setIsSearchingCards(true);
        try {
            const results = await searchCards(cardSearchQuery);
            setCardSearchResults(results);
        } catch (e) {
            console.error("Failed to search cards", e);
        }
        setIsSearchingCards(false);
    };

    const addCardToDeck = (card: CardData) => {
        if (!stagedDeck) return;
        const newCard = { ...card, id: crypto.randomUUID() };
        setStagedDeck([...stagedDeck, newCard]);
        setCardSearchQuery('');
        setCardSearchResults([]);
    };

    const removeCardFromDeck = (cardId: string) => {
        if (!stagedDeck) return;
        // Remove only one instance (the first matching scryfallId)
        const idx = stagedDeck.findIndex(c => c.id === cardId);
        if (idx !== -1) {
            const newDeck = [...stagedDeck];
            newDeck.splice(idx, 1);
            setStagedDeck(newDeck);
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            const file = files[0];
            if (file.type === "text/plain" || file.name.endsWith('.txt')) {
                const text = await file.text();
                setDeckText(text);
            } else {
                alert("Please drop a valid .txt file");
            }
        }
    };

    // Auto-generate default mana rules for new cards
    useEffect(() => {
        if (!stagedDeck) return;

        const newRules = { ...manaRules };
        let changed = false;

        stagedDeck.forEach(card => {
            if (card.isManaSource && !newRules[card.scryfallId]) {
                const defaultRule = generateDefaultManaRule(card);
                if (defaultRule) {
                    newRules[card.scryfallId] = defaultRule;
                    changed = true;
                }
            }
        });

        if (changed) {
            setManaRules(newRules);
        }
    }, [stagedDeck]);

    const handleImport = async () => {
        if (!deckText.trim()) return;
        setLoading(true);
        setError(null);
        setProgress(null);

        try {
            const parsed = parseDeckList(deckText);
            if (parsed.length === 0) {
                setError("No cards found in the list.");
                setLoading(false);
                return;
            }

            const names = parsed.map(p => p.name);
            const cardMap = await fetchBatch(names, (current, total) => {
                setProgress({ current, total });
            });

            const existingCommanderId = stagedDeck?.find(c => c.isCommander)?.scryfallId;

            const newDeck: CardData[] = [];
            let commanderFound = false;

            for (const item of parsed) {
                const data = cardMap.get(item.name.toLowerCase());
                if (data) {
                    for (let i = 0; i < item.count; i++) {
                        const isCmd = !commanderFound && data.scryfallId === existingCommanderId;
                        if (isCmd) commanderFound = true;

                        newDeck.push({
                            ...data,
                            id: crypto.randomUUID(),
                            isCommander: isCmd
                        });
                    }

                    if (data.isManaSource && !manaRules[data.scryfallId]) {
                        const defaultRule = generateDefaultManaRule(data);
                        if (defaultRule) {
                            setManaRules(prev => ({ ...prev, [data.scryfallId]: defaultRule }));
                        }
                    }
                }
            }

            setStagedDeck(newDeck);
            setDeckText('');
            setActiveTab('DECK');
        } catch (err) {
            console.error(err);
            setError("Failed to import deck. Please check your internet connection.");
        } finally {
            setLoading(false);
            setProgress(null);
        }
    };

    const setCommander = (id: string) => {
        if (!stagedDeck) return;
        const updated = stagedDeck.map(c => ({
            ...c,
            isCommander: c.id === id ? !c.isCommander : c.isCommander
        }));
        setStagedDeck(updated);
    };

    const handleTabChange = (newTab: 'DECK' | 'TOKENS' | 'MANA') => {
        if (!stagedDeck) return;
        setActiveTab(newTab);
        if (newTab === 'TOKENS' && suggestedTokens.length === 0) {
            fetchSuggestedTokens();
        }
    };

    const fetchSuggestedTokens = async () => {
        if (!stagedDeck || isFetchingSuggestions) return;
        setIsFetchingSuggestions(true);

        const tokenIds = new Set<string>();
        stagedDeck.forEach(c => {
            c.relatedTokens?.forEach(t => tokenIds.add(t.id));
        });

        if (tokenIds.size === 0) {
            setIsFetchingSuggestions(false);
            return;
        }

        try {
            const body = { identifiers: Array.from(tokenIds).map(id => ({ id })) };
            const resp = await fetch('https://api.scryfall.com/cards/collection', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                mode: 'cors'
            });

            if (resp.ok) {
                const data = await resp.json();
                const fetched: CardData[] = data.data.map((c: any) => ({
                    scryfallId: c.id,
                    id: crypto.randomUUID(),
                    name: c.name,
                    imageUrl: c.image_uris?.normal || c.card_faces?.[0]?.image_uris?.normal,
                    typeLine: c.type_line,
                    oracleText: c.oracle_text || '',
                    manaCost: c.mana_cost || '',
                    cmc: c.cmc || 0,
                    isLand: c.type_line?.toLowerCase().includes('land'),
                    isToken: true
                }));
                setSuggestedTokens(fetched);
            }
        } catch (e) {
            console.error("Failed to fetch suggested tokens", e);
        } finally {
            setIsFetchingSuggestions(false);
        }
    };

    const finalizeDeck = () => {
        if (!stagedDeck) return;
        onDeckReady(stagedDeck, stagedTokens, isNewDeck, deckName, manaRules, initialId);
    };

    const clearDeck = () => {
        if (confirm("Are you sure you want to clear this deck and import a new one?")) {
            setStagedDeck(null);
            setStagedTokens([]);
            setDeckText('');
            setActiveTab('DECK');
        }
    };

    const searchTokensFunc = async () => {
        if (!tokenQuery) return;
        setIsSearchingTokens(true);
        let results = await searchCards(tokenQuery + " t:token");
        if (results.length === 0) {
            results = await searchCards(tokenQuery);
        }
        setTokenResults(results.map(c => ({ ...c, isToken: true })));
        setIsSearchingTokens(false);
    };

    const addToken = (card: CardData) => {
        setStagedTokens(prev => [...prev, { ...card, id: crypto.randomUUID() }]);
    };

    const removeToken = (id: string) => {
        setStagedTokens(prev => prev.filter(t => t.id !== id));
    };

    const filteredDeck = stagedDeck
        ? stagedDeck.filter(c => {
            const matchesSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase());
            const rule = manaRules[c.scryfallId];
            const hasActiveRule = rule && !rule.disabled;
            const matchesManaFilter = !showManaFilter ||
                (hasActiveRule) ||
                (c.isManaSource && !rule?.disabled) ||
                (c.producedMana && c.producedMana.length > 0 && !rule?.disabled);
            return matchesSearch && matchesManaFilter;
        })
        : [];

    const groupedDeck = (() => {
        const map = new Map<string, { card: CardData; count: number }>();
        for (const card of filteredDeck) {
            const existing = map.get(card.scryfallId);
            if (existing) {
                existing.count++;
            } else {
                map.set(card.scryfallId, { card, count: 1 });
            }
        }
        return Array.from(map.values());
    })();

    return (
        <div className="flex flex-col h-full p-4 md:p-8 max-w-6xl mx-auto overflow-hidden">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 shrink-0">
                <h1 className="text-xl md:text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
                    {stagedDeck ? 'Deck Editor' : 'Import Deck'}
                </h1>
                {stagedDeck && (
                    <div className="flex-1 md:mx-4 flex items-center gap-3">
                        <input
                            className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                            placeholder="Deck Name"
                            value={deckName}
                            onChange={e => setDeckName(e.target.value)}
                        />
                        <span className="bg-gray-700 px-3 py-2 rounded text-sm text-gray-300 font-bold whitespace-nowrap">
                            {stagedDeck.length} cards
                        </span>
                    </div>
                )}
                <div className="flex gap-2">
                    {stagedDeck && (
                        <button onClick={finalizeDeck} className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold shadow-lg shadow-green-900/20">
                            <Check size={20} /> Finish & Save
                        </button>
                    )}
                    <button onClick={onBack} className="text-gray-400 hover:text-white px-2 transition">
                        {stagedDeck ? 'Exit' : 'Back'}
                    </button>
                </div>
            </div>

            {!stagedDeck ? (
                <div className="bg-gray-800 rounded-xl p-3 md:p-6 shadow-lg border border-gray-700 flex-1 flex flex-col min-h-0">
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                        Paste Deck List (Moxfield/Arena format)
                    </label>
                    <div
                        className="flex-1 flex flex-col relative"
                        onDragOver={handleDragOver}
                        onDrop={handleDrop}
                    >
                        <textarea
                            className="flex-1 w-full bg-gray-900 border border-gray-600 rounded-lg p-4 text-gray-200 font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none"
                            placeholder={`1 Sol Ring\n1 Arcane Signet\n1 Command Tower...`}
                            value={deckText}
                            onChange={(e) => setDeckText(e.target.value)}
                            disabled={loading}
                        />
                        {deckText.length === 0 && (
                            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                                <div className="text-gray-600 text-sm text-center">
                                    <span className="block mb-1 opacity-50">Drag & Drop .txt file here</span>
                                </div>
                            </div>
                        )}
                    </div>

                    {error && (
                        <div className="mt-4 p-3 bg-red-900/50 border border-red-700 rounded-lg flex items-center gap-2 text-red-200 shrink-0">
                            <AlertCircle size={18} />
                            <span>{error}</span>
                        </div>
                    )}

                    <div className="mt-6 flex items-center justify-end gap-4 shrink-0">
                        {loading ? (
                            <div className="flex items-center gap-3 text-blue-400">
                                <Loader2 className="animate-spin" />
                                <span>Loading... {progress ? `${progress.current}/${progress.total} unique cards` : ''}</span>
                            </div>
                        ) : (
                            <button
                                onClick={handleImport}
                                className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors shadow-lg hover:shadow-blue-500/25"
                            >
                                <Download size={20} />
                                Load Deck
                            </button>
                        )}
                    </div>
                </div>
            ) : (
                <div className="flex-1 flex flex-col bg-gray-800 rounded-xl border border-gray-700 overflow-hidden min-h-0 shadow-2xl">
                    <div className="bg-gray-900 border-b border-gray-700 p-2 flex flex-col md:flex-row items-center gap-4 shrink-0">
                        <div className="flex gap-1 bg-gray-800 p-1 rounded-lg">
                            {(['DECK', 'TOKENS', 'MANA'] as const).map((t) => (
                                <button
                                    key={t}
                                    onClick={() => handleTabChange(t)}
                                    className={`px-4 py-1.5 rounded-md text-xs md:text-sm font-bold transition-all ${activeTab === t ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700'}`}
                                >
                                    {t === 'DECK' ? 'Main Deck' : t === 'TOKENS' ? 'Tokens' : 'Mana Rules'}
                                </button>
                            ))}
                        </div>
                        <div className="flex-1" />
                        <button
                            onClick={clearDeck}
                            className="flex items-center gap-2 px-3 py-1.5 bg-red-900/10 hover:bg-red-900/30 border border-red-800/30 text-red-400 rounded-lg font-bold transition-colors text-xs"
                        >
                            <Trash2 size={14} /> Reset/Clear
                        </button>
                    </div>

                    <div className="flex-1 overflow-hidden flex flex-col min-h-0">
                        {activeTab === 'DECK' && (
                            <div className="flex-1 flex flex-col min-h-0">
                                <div className="p-4 bg-gray-900/50 border-b border-gray-700 flex flex-col gap-4 shrink-0">
                                    {/* Add cards via search */}
                                    <div className="flex gap-2">
                                        <div className="flex-1 relative">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                                            <input
                                                type="text"
                                                value={cardSearchQuery}
                                                onChange={(e) => setCardSearchQuery(e.target.value)}
                                                onKeyDown={(e) => e.key === 'Enter' && searchCardsToAdd()}
                                                placeholder="Search cards to add to deck..."
                                                className="w-full bg-gray-800 border border-gray-600 rounded-lg py-2 pl-10 pr-4 text-white focus:ring-2 focus:ring-green-500 focus:outline-none text-sm"
                                            />
                                        </div>
                                        <button
                                            onClick={searchCardsToAdd}
                                            disabled={isSearchingCards}
                                            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white rounded-lg font-bold transition-all text-sm"
                                        >
                                            {isSearchingCards ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />} Add Card
                                        </button>
                                    </div>
                                    {/* Card search results */}
                                    {cardSearchResults.length > 0 && (
                                        <div className="bg-gray-800 rounded-lg border border-gray-600 p-3 max-h-48 overflow-y-auto">
                                            <div className="flex justify-between items-center mb-2">
                                                <span className="text-xs text-gray-400 font-bold">Search Results - Click to add</span>
                                                <button onClick={() => setCardSearchResults([])} className="text-gray-500 hover:text-white"><X size={14} /></button>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                {cardSearchResults.slice(0, 8).map(card => (
                                                    <div
                                                        key={card.scryfallId}
                                                        onClick={() => addCardToDeck(card)}
                                                        className="flex items-center gap-2 bg-gray-700 hover:bg-green-600 p-2 rounded cursor-pointer transition-colors"
                                                    >
                                                        <img src={card.imageUrl} className="w-8 h-11 rounded object-cover" />
                                                        <span className="text-sm text-white font-medium">{card.name}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {/* Filter controls */}
                                    <div className="flex flex-col md:flex-row gap-4">
                                        <div className="flex-1 relative">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                                            <input
                                                type="text"
                                                value={searchQuery}
                                                onChange={(e) => setSearchQuery(e.target.value)}
                                                placeholder="Filter cards in deck..."
                                                className="w-full bg-gray-800 border border-gray-600 rounded-lg py-2 pl-10 pr-4 text-white focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm"
                                            />
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => setShowManaFilter(prev => !prev)}
                                                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border transition-all ${showManaFilter ? 'bg-amber-600 border-amber-500 text-white' : 'bg-gray-800 border-gray-600 text-gray-400 hover:border-gray-500'}`}
                                            >
                                                <Filter size={14} /> Mana Sources
                                            </button>
                                            <button
                                                onClick={() => handleTabChange('TOKENS')}
                                                className="flex items-center gap-2 px-4 py-2 bg-blue-600/20 hover:bg-blue-600/40 border border-blue-500/50 text-blue-200 rounded-lg font-bold transition-all text-sm"
                                            >
                                                Add Tokens <ArrowRight size={16} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                                    <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 md:gap-4">
                                        {groupedDeck.map(({ card, count }) => (
                                            <div
                                                key={card.scryfallId}
                                                onClick={() => setCommander(card.id)}
                                                onMouseEnter={() => setHoveredCardId(card.id)}
                                                onMouseLeave={() => setHoveredCardId(null)}
                                                className={`relative aspect-[2.5/3.5] rounded-lg cursor-pointer transition-all border-4 ${card.isCommander ? 'border-amber-500 scale-105 shadow-amber-500/50 shadow-lg z-10' : 'border-transparent hover:border-gray-500'}`}
                                            >
                                                <img src={card.imageUrl} className="w-full h-full object-cover rounded-md" />
                                                {card.isCommander && (
                                                    <div className="absolute -top-2 -right-2 bg-amber-500 text-black p-1.5 rounded-full shadow-lg border-2 border-gray-900">
                                                        <Crown size={18} fill="black" />
                                                    </div>
                                                )}
                                                {count > 1 && (
                                                    <div className="absolute bottom-6 left-1 bg-gray-900/90 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-lg border border-gray-600">
                                                        ×{count}
                                                    </div>
                                                )}
                                                {manaRules[card.scryfallId] && (
                                                    <div className="absolute top-2 left-2 bg-purple-600 text-white p-1 rounded-full shadow-lg border border-purple-400" title="Custom mana rules set">
                                                        <Zap size={10} />
                                                    </div>
                                                )}
                                                {hoveredCardId === card.id && (
                                                    <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center p-2 rounded-md">
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); setManaRulesCard(card); }}
                                                            className="w-full mb-2 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-[10px] font-bold rounded-lg flex items-center justify-center gap-1 shadow-lg"
                                                        >
                                                            <Zap size={10} /> Mana Rules
                                                        </button>
                                                        <span className="text-white font-bold text-[10px] text-center">{card.isCommander ? 'Dismiss Cmd' : 'Set Commander'}</span>
                                                    </div>
                                                )}
                                                <div className="absolute bottom-0 left-0 right-0 bg-black/80 p-1 text-center text-[10px] truncate rounded-b-md">
                                                    {card.name}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'TOKENS' && (
                            <div className="flex-1 flex flex-col md:flex-row gap-6 p-4 min-h-0 bg-gray-900/30">
                                <div className="flex-1 flex flex-col gap-4 bg-gray-800/80 rounded-xl p-4 border border-gray-700 min-h-[300px] md:min-h-0 shadow-inner">
                                    <div className="flex gap-2 shrink-0">
                                        <div className="flex-1 relative">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                                            <input
                                                className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 pl-10 pr-4 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                                                placeholder="Search all tokens (Scryfall)..."
                                                value={tokenQuery}
                                                onChange={e => setTokenQuery(e.target.value)}
                                                onKeyDown={e => e.key === 'Enter' && searchTokensFunc()}
                                            />
                                        </div>
                                        <button onClick={searchTokensFunc} className="bg-blue-600 hover:bg-blue-700 px-6 rounded-lg text-white font-bold transition-colors">
                                            {isSearchingTokens ? <Loader2 className="animate-spin" /> : 'Search'}
                                        </button>
                                    </div>
                                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                                        {suggestedTokens.length > 0 && (
                                            <div className="mb-6">
                                                <h3 className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-3 flex items-center gap-2">
                                                    <span className="w-2 h-2 bg-blue-500 rounded-full" /> Suggested for your Deck
                                                </h3>
                                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                                                    {suggestedTokens.map(card => (
                                                        <div key={card.scryfallId} className="relative group cursor-pointer" onClick={() => addToken(card)}>
                                                            <img src={card.imageUrl} className="w-full rounded shadow-md group-hover:ring-2 ring-blue-500 transition-all" />
                                                            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-blue-600/20 transition-opacity rounded">
                                                                <div className="bg-blue-600 p-2 rounded-full shadow-xl">
                                                                    <Plus className="text-white" size={24} />
                                                                </div>
                                                            </div>
                                                            <div className="absolute bottom-0 left-0 right-0 bg-black/60 p-1 text-center text-[8px] truncate rounded-b">
                                                                {card.name}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        <h3 className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-3 flex items-center gap-2">
                                            <span className="w-2 h-2 bg-gray-600 rounded-full" /> Search Results
                                        </h3>
                                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                                            {tokenResults.map(card => (
                                                <div key={card.scryfallId} className="relative group cursor-pointer" onClick={() => addToken(card)}>
                                                    <img src={card.imageUrl} className="w-full rounded shadow-md group-hover:ring-2 ring-blue-500 transition-all" />
                                                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-blue-600/20 transition-opacity rounded">
                                                        <Plus className="text-white" size={32} />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="w-full md:w-1/3 bg-gray-900/50 rounded-xl p-4 border border-gray-700 flex flex-col min-h-[200px] md:min-h-0 shadow-lg">
                                    <h3 className="text-white font-bold mb-4 flex justify-between shrink-0">
                                        <span>Selected Tokens</span>
                                        <span className="bg-blue-600/20 text-blue-400 px-2 py-0.5 rounded text-xs">{stagedTokens.length}</span>
                                    </h3>
                                    <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar">
                                        {stagedTokens.map((token) => (
                                            <div key={token.id} className="flex items-center gap-2 bg-gray-800/50 p-2 rounded border border-gray-700 hover:border-gray-600 transition-colors">
                                                <img src={token.imageUrl} className="w-8 h-11 rounded object-cover shadow" />
                                                <span className="text-sm text-gray-300 truncate flex-1 font-medium">{token.name}</span>
                                                <button onClick={() => removeToken(token.id)} className="text-gray-500 hover:text-red-400 transition-colors p-1"><X size={16} /></button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'MANA' && (
                            <div className="flex-1 overflow-y-auto p-6 bg-gray-900/30 custom-scrollbar">
                                <div className="max-w-4xl mx-auto">
                                    <div className="flex items-center justify-between mb-6">
                                        <h3 className="text-gray-400 text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                                            <Zap size={14} /> Mana Rule Configuration
                                        </h3>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => {
                                                    navigator.clipboard.writeText(JSON.stringify(manaRules, null, 2));
                                                    alert("Rules exported!");
                                                }}
                                                className="text-blue-400 hover:text-blue-300 text-xs font-bold flex items-center gap-1"
                                            >
                                                <Share2 size={12} /> Export JSON
                                            </button>
                                        </div>
                                    </div>
                                    <div className="grid gap-4">
                                        {stagedDeck?.filter(c => c.isManaSource || (c.producedMana && c.producedMana.length > 0) || c.typeLine.toLowerCase().includes('land') || !!manaRules[c.scryfallId]).map(card => {
                                            const rule = manaRules[card.scryfallId];
                                            return (
                                                <div key={card.id} className="flex items-center gap-4 bg-gray-800/80 p-4 rounded-xl border border-gray-700 shadow-lg hover:border-purple-500/30 transition-all">
                                                    <img src={card.imageUrl} className="w-12 h-16 rounded shadow-md border border-gray-700" />
                                                    <div className="flex-1">
                                                        <div className="text-white font-bold">{card.name}</div>
                                                        <div className="text-xs text-gray-400">{card.typeLine}</div>
                                                        {rule && (
                                                            <div className="mt-1 flex gap-2">
                                                                <span className="text-[10px] bg-purple-900/30 text-purple-300 px-2 py-0.5 rounded border border-purple-500/20 font-bold uppercase">Priority {rule.autoTapPriority}</span>
                                                                {rule.disabled && <span className="text-[10px] bg-red-900/30 text-red-300 px-2 py-0.5 rounded border border-red-500/20 font-bold uppercase">Disabled</span>}
                                                            </div>
                                                        )}
                                                    </div>
                                                    <button
                                                        onClick={() => setManaRulesCard(card)}
                                                        className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-bold shadow-lg transition-all flex items-center gap-2"
                                                    >
                                                        <Zap size={14} /> Edit Rule
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {manaRulesCard && (
                <ManaRulesModal
                    card={manaRulesCard}
                    existingRule={manaRules[manaRulesCard.scryfallId]}
                    commanderColors={(() => {
                        const commander = stagedDeck?.find(c => c.isCommander);
                        if (!commander?.manaCost) return undefined;
                        const colors: ManaColor[] = [];
                        if (commander.manaCost.includes('W')) colors.push('W');
                        if (commander.manaCost.includes('U')) colors.push('U');
                        if (commander.manaCost.includes('B')) colors.push('B');
                        if (commander.manaCost.includes('R')) colors.push('R');
                        if (commander.manaCost.includes('G')) colors.push('G');
                        return colors.length > 0 ? colors : undefined;
                    })()}
                    onSave={(rule) => {
                        const newRules = { ...manaRules };
                        if (rule === null) {
                            delete newRules[manaRulesCard.scryfallId];
                        } else {
                            newRules[manaRulesCard.scryfallId] = rule;
                        }
                        setManaRules(newRules);
                    }}
                    onClose={() => setManaRulesCard(null)}
                    allSources={stagedDeck
                        ?.filter(c => c.isManaSource || (c.producedMana && c.producedMana.length > 0) || c.typeLine.toLowerCase().includes('land') || !!manaRules[c.scryfallId])
                        .map(c => {
                            const rule = manaRules[c.scryfallId];
                            let priority = rule?.autoTapPriority;

                            if (priority === undefined) {
                                let produced: ManaColor[] = [];
                                if (rule) {
                                    if (rule.prodMode === 'standard' || rule.prodMode === 'multiplied' || rule.prodMode === 'available') {
                                        Object.entries(rule.produced).forEach(([color, count]) => {
                                            if (count > 0) produced.push(color as ManaColor);
                                        });
                                    } else {
                                        produced = ['W', 'U'];
                                    }
                                } else {
                                    produced = parseProducedMana(c.producedMana);
                                    if (produced.length === 0) {
                                        const basic = getBasicLandColor(c.name);
                                        if (basic) produced = [basic];
                                    }
                                }
                                priority = getManaPriority(c, produced);
                            }
                            return { id: c.id, name: c.name, priority };
                        }) || []
                    }
                />
            )}
        </div>
    );
};
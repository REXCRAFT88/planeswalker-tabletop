import React, { useState, useEffect, useMemo, useRef } from 'react';
import { parseDeckList, fetchBatch, searchCards, fetchCardsByIds, splitSideboard } from '../services/scryfall';
import { CardData } from '../types';
import { Loader2, Download, AlertCircle, Crown, Check, Search, Trash2, Plus, X, ArrowRight, Zap, Filter, Shield, Image as ImageIcon } from 'lucide-react';
import { ArtPickerModal } from './ArtPickerModal';

interface DeckBuilderProps {
    initialDeck: CardData[];
    initialTokens: CardData[];
    initialSideboard?: CardData[];
    initialName?: string;
    initialId?: string; // ID of the deck being edited
    onDeckReady: (deck: CardData[], tokens: CardData[], shouldSave?: boolean, name?: string, id?: string, sideboard?: CardData[]) => void;
    onBack: () => void;
}

export const DeckBuilder: React.FC<DeckBuilderProps> = ({ initialDeck, initialTokens, initialSideboard, initialName, initialId, onDeckReady, onBack }) => {
    const [deckText, setDeckText] = useState('');
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState<{ current: number, total: number } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');

    // Steps: DECK -> TOKENS
    const [step, setStep] = useState<'DECK' | 'TOKENS'>('DECK');

    // Token Search State
    const [tokenQuery, setTokenQuery] = useState('');
    const [tokenResults, setTokenResults] = useState<CardData[]>([]);
    const [isSearchingTokens, setIsSearchingTokens] = useState(false);

    const isNewDeck = !initialDeck || initialDeck.length === 0;
    // Fix: If initialId is missing, treat as new deck even if cards exist (e.g. import)
    // Actually, if we passed cards but no ID, it might be an imported deck or a clone.

    const [deckName, setDeckName] = useState(initialName || (isNewDeck ? 'New Deck' : ''));
    const [hoveredCardId, setHoveredCardId] = useState<string | null>(null);
    const [showManaFilter, setShowManaFilter] = useState(false);

    // Staging area after fetching but before confirming commander
    // If initialDeck has cards, we assume we are in "Edit/Select Commander" mode
    const [stagedDeck, setStagedDeck] = useState<CardData[] | null>(initialDeck && initialDeck.length > 0 ? initialDeck : null);
    const [stagedTokens, setStagedTokens] = useState<CardData[]>(initialTokens || []);
    const [stagedSideboard, setStagedSideboard] = useState<CardData[]>(initialSideboard || []);
    const [autoTokenMsg, setAutoTokenMsg] = useState<string | null>(null);
    const [artPickerCard, setArtPickerCard] = useState<CardData | null>(null);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const handleDrop = async (e: React.DragEvent) => {
        // ... (existing drop logic)
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

    const handleImport = async () => {
        if (!deckText.trim()) {
            setError("Please paste a deck list first.");
            return;
        }

        setLoading(true);
        setError(null);
        setProgress(null);

        try {
            // Separate the main deck from an optional sideboard section first.
            const { main, side } = splitSideboard(deckText);
            const parsed = parseDeckList(main);
            const parsedSide = parseDeckList(side);
            if (parsed.length === 0) {
                setError("No valid cards found in the list.");
                return;
            }

            const uniqueNames = Array.from(new Set([...parsed, ...parsedSide].map(p => p.name)));
            const cardMap = await fetchBatch(uniqueNames, (current, total) => setProgress({ current, total }));

            const deck: CardData[] = [];
            const tokens: CardData[] = [];
            const missing: string[] = [];

            for (const item of parsed) {
                const data = cardMap.get(item.name.toLowerCase());
                if (!data) {
                    missing.push(item.name);
                    continue;
                }
                for (let i = 0; i < item.count; i++) {
                    const instance = { ...data, id: crypto.randomUUID() };
                    if (data.isToken) tokens.push(instance);
                    else deck.push(instance);
                }
            }

            // Build the sideboard from its own section (tokens there go to tokens).
            const sideboard: CardData[] = [];
            for (const item of parsedSide) {
                const data = cardMap.get(item.name.toLowerCase());
                if (!data) continue;
                for (let i = 0; i < item.count; i++) {
                    const instance = { ...data, id: crypto.randomUUID() };
                    if (data.isToken) tokens.push(instance); else sideboard.push(instance);
                }
            }
            setStagedSideboard(sideboard);

            if (deck.length === 0 && tokens.length === 0) {
                setError("Could not load any cards. Please check the card names.");
                return;
            }


            setStagedDeck(deck);

            // --- Token auto-import (Moxfield-style) ---
            // Collect the token/emblem ids every card in the deck can create, drop any
            // we already have (existing tokens + those pasted in the list), fetch the
            // rest, and add them so players don't have to hunt for tokens by hand.
            const haveTokenIds = new Set<string>([...stagedTokens, ...tokens].map(t => t.scryfallId));
            const wantedIds = Array.from(new Set(
                [...deck, ...tokens].flatMap(c => c.tokenParts || [])
            )).filter(id => !haveTokenIds.has(id));

            let autoTokens: CardData[] = [];
            if (wantedIds.length > 0) {
                try {
                    const fetched = await fetchCardsByIds(wantedIds);
                    const seen = new Set(haveTokenIds);
                    autoTokens = fetched
                        .filter(t => { if (seen.has(t.scryfallId)) return false; seen.add(t.scryfallId); return true; })
                        .map(t => ({ ...t, isToken: true, id: crypto.randomUUID() }));
                } catch (e) {
                    console.error('Token auto-import failed', e);
                }
            }

            setStagedTokens(prev => [...prev, ...tokens, ...autoTokens]);
            setAutoTokenMsg(autoTokens.length > 0 ? `${autoTokens.length} token${autoTokens.length > 1 ? 's' : ''} auto-added — review in the next step.` : null);

            if (missing.length > 0) {
                const preview = missing.slice(0, 8).join(", ");
                const extra = missing.length > 8 ? ` (+${missing.length - 8} more)` : "";
                setError(`Imported ${deck.length} cards. Could not find: ${preview}${extra}`);
            }
        } catch (e) {
            console.error("Deck import failed", e);
            setError("Failed to import deck. Please try again.");
        } finally {
            setLoading(false);
            setProgress(null);
        }
    };

    const setCommander = (id: string) => {
        if (!stagedDeck) return;
        const target = stagedDeck.find(c => c.id === id);
        if (!target) return;
        
        const updated = stagedDeck.map(c => ({
            ...c,
            isCommander: c.id === id ? !c.isCommander : false,
            isCompanion: c.id === id ? false : c.isCompanion,
        }));
        setStagedDeck(updated);
    };

    const makeCompanion = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (!stagedDeck) return;
        const updated = stagedDeck.map(c => ({
            ...c,
            isCompanion: c.id === id ? true : false,
            isCommander: c.id === id ? false : c.isCommander,
        }));
        setStagedDeck(updated);
    };

    const removeCompanion = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (!stagedDeck) return;
        const updated = stagedDeck.map(c => ({
            ...c,
            isCompanion: c.id === id ? false : c.isCompanion,
        }));
        setStagedDeck(updated);
    };

    const handleSelectArt = (newArt: CardData) => {
        if (!stagedDeck || !artPickerCard) return;
        setStagedDeck(stagedDeck.map(c => c.id === artPickerCard.id ? { ...c, imageUrl: newArt.imageUrl, scryfallId: newArt.scryfallId } : c));
        setArtPickerCard(null);
    };

    const proceedToTokens = () => {
        if (!stagedDeck) return;
        setStep('TOKENS');
    };

    const finalizeDeck = () => {
        if (!stagedDeck) return;
        // Pass initialId back
        onDeckReady(stagedDeck, stagedTokens, isNewDeck, deckName, initialId, stagedSideboard);
    };


    const clearDeck = () => {
        if (confirm("Are you sure you want to clear this deck and import a new one?")) {
            setStagedDeck(null);
            setStagedTokens([]);
            setDeckText('');
            setStep('DECK');
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
            const matchesManaFilter = !showManaFilter || c.isManaSource || (c.producedMana && c.producedMana.length > 0);
            return matchesSearch && matchesManaFilter;
        })
        : [];

    // Group cards by scryfallId for compact display
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

    if (step === 'TOKENS') {
        return (
            <div className="flex flex-col h-full p-4 md:p-8 max-w-6xl mx-auto overflow-y-auto">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 shrink-0">
                    <h1 className="text-xl text-center md:text-left md:text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-orange-500">
                        Add Tokens
                    </h1>
                    <div className="w-full md:flex-1 md:mx-4">
                        <input
                            className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white focus:ring-2 focus:ring-green-500 outline-none"
                            placeholder="Deck Name"
                            value={deckName}
                            onChange={e => setDeckName(e.target.value)}
                        />
                    </div>
                    <button onClick={finalizeDeck} className="w-full md:w-auto flex items-center justify-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold shadow-lg shrink-0">
                        <Check size={20} /> Finish & Save
                    </button>
                </div>

                <div className="flex flex-col md:flex-row gap-6 flex-1 min-h-0">
                    {/* Search Side */}
                    <div className="flex-1 flex flex-col gap-4 bg-gray-800 rounded-xl p-4 border border-gray-700 min-h-[300px] md:min-h-0">
                        <div className="flex gap-2 shrink-0">
                            <input
                                className="flex-1 bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                                placeholder="Search tokens (e.g. Treasure, Goblin)..."
                                value={tokenQuery}
                                onChange={e => setTokenQuery(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && searchTokensFunc()}
                            />
                            <button onClick={searchTokensFunc} className="bg-blue-600 px-4 rounded text-white font-bold">
                                {isSearchingTokens ? <Loader2 className="animate-spin" /> : <Search />}
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                {tokenResults.map(card => (
                                    <div key={card.scryfallId} className="relative group cursor-pointer" onClick={() => addToken(card)}>
                                        <img src={card.imageUrl} className="w-full rounded shadow-md hover:scale-105 transition-transform" />
                                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/40 transition-opacity">
                                            <Plus className="text-white" size={32} />
                                        </div>
                                    </div>
                                ))}
                                {tokenResults.length === 0 && !isSearchingTokens && (
                                    <div className="col-span-full text-center text-gray-500 mt-10">Search for tokens to add them to your deck.</div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Selected Side */}
                    <div className="w-full md:w-1/3 bg-gray-900 rounded-xl p-4 border border-gray-700 flex flex-col min-h-[200px] md:min-h-0 pb-8 md:pb-4">
                        <h3 className="text-white font-bold mb-4 flex justify-between shrink-0">
                            <span>Selected Tokens</span>
                            <span className="text-blue-400">{stagedTokens.length}</span>
                        </h3>
                        {autoTokenMsg && (
                            <div className="mb-3 p-2 bg-green-900/40 border border-green-700 rounded text-green-200 text-xs flex items-center gap-2 shrink-0">
                                <Check size={14} /> {autoTokenMsg}
                            </div>
                        )}
                        {stagedSideboard.length > 0 && (
                            <div className="mb-3 p-2 bg-indigo-900/40 border border-indigo-700 rounded text-indigo-200 text-xs flex items-center gap-2 shrink-0">
                                <Shield size={14} /> Sideboard: {stagedSideboard.length} card{stagedSideboard.length > 1 ? 's' : ''} (saved with the deck).
                            </div>
                        )}
                        <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar">
                            {stagedTokens.map((token, idx) => (
                                <div key={token.id} className="flex items-center gap-2 bg-gray-800 p-2 rounded border border-gray-700">
                                    <img src={token.imageUrl} className="w-8 h-11 rounded object-cover" />
                                    <span className="text-sm text-gray-300 truncate flex-1">{token.name}</span>
                                    <button onClick={() => removeToken(token.id)} className="text-red-400 hover:text-red-300"><X size={16} /></button>
                                </div>
                            ))}
                            {stagedTokens.length === 0 && <div className="text-gray-600 text-center italic mt-10">No tokens added.</div>}
                        </div>
                        <button onClick={() => setStep('DECK')} className="mt-4 w-full py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded font-bold shrink-0">
                            Back to Deck
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full p-4 md:p-8 max-w-6xl mx-auto overflow-hidden">
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-xl md:text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
                    {stagedDeck ? 'Select Commander' : 'Import Deck'}
                </h1>
                <button onClick={onBack} className="text-gray-400 hover:text-white transition">
                    Back to Menu
                </button>
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
                <div className="flex-1 flex flex-col bg-gray-800 rounded-xl border border-gray-700 overflow-hidden min-h-0">
                    <div className="p-4 bg-gray-900 border-b border-gray-700 flex flex-col gap-4 shrink-0">
                        <div className="flex flex-col md:flex-row justify-between items-center gap-2">
                            <span className="text-gray-300 text-xs md:text-base">Click a card to toggle Commander/Companion.</span>
                            <div className="flex gap-2">
                                <button
                                    onClick={clearDeck}
                                    className="flex items-center gap-2 px-3 py-2 bg-red-900/50 hover:bg-red-900 border border-red-800 text-white rounded-lg font-bold transition-colors text-xs md:text-sm"
                                >
                                    <Trash2 size={16} /> New Deck
                                </button>
                                <button
                                    onClick={proceedToTokens}
                                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold shadow-lg shadow-blue-900/20 text-xs md:text-sm"
                                >
                                    Next: Add Tokens <ArrowRight size={16} />
                                </button>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search cards..."
                                    className="w-full bg-gray-800 border border-gray-600 rounded-lg py-2 pl-10 pr-4 text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                />
                            </div>
                            <button
                                onClick={() => setShowManaFilter(prev => !prev)}
                                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border transition-all ${showManaFilter ? 'bg-amber-600 border-amber-500 text-white' : 'bg-gray-800 border-gray-600 text-gray-400 hover:border-gray-500'}`}
                                title="Filter to mana-producing cards only"
                            >
                                <Filter size={14} /> Mana
                            </button>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                        <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 md:gap-4">
                            {groupedDeck.map(({ card, count }) => (
                                <div
                                    key={card.scryfallId}
                                    onClick={() => setCommander(card.id)}
                                    onMouseEnter={() => setHoveredCardId(card.id)}
                                    onMouseLeave={() => setHoveredCardId(null)}
                                    className={`relative aspect-[2.5/3.5] rounded-lg cursor-pointer transition-all border-4 ${card.isCommander ? 'border-amber-500 scale-105 shadow-amber-500/50 shadow-lg' : card.isCompanion ? 'border-indigo-400 scale-105 shadow-indigo-400/50 shadow-lg' : 'border-transparent hover:border-gray-500'}`}
                                >
                                    <img src={card.imageUrl} className="w-full h-full object-cover rounded-md" />
                                    {card.isCommander && (
                                        <div 
                                            className="absolute top-2 right-2 bg-amber-500 text-black p-1 rounded-full shadow-lg cursor-pointer hover:scale-110 hover:bg-indigo-400 transition-all"
                                            onClick={(e) => makeCompanion(e, card.id)}
                                            title="Click to make Companion"
                                        >
                                            <Crown size={16} />
                                        </div>
                                    )}
                                    {card.isCompanion && (
                                        <div 
                                            className="absolute top-2 right-2 bg-indigo-500 text-white p-1 rounded-full shadow-lg cursor-pointer hover:scale-110 hover:bg-indigo-400 transition-all"
                                            onClick={(e) => removeCompanion(e, card.id)}
                                            title="Click to remove Companion"
                                        >
                                            <Shield size={16} />
                                        </div>
                                    )}
                                    {hoveredCardId === card.id && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setArtPickerCard(card); }}
                                            title="Change Art"
                                            className="absolute top-2 left-2 p-1.5 rounded-full bg-black/70 text-white hover:bg-blue-600 transition-colors shadow-lg"
                                        >
                                            <ImageIcon size={16} />
                                        </button>
                                    )}
                                    {/* Count badge */}
                                    {count > 1 && (
                                        <div className="absolute bottom-8 left-1 bg-gray-900/90 text-white text-[11px] font-bold px-1.5 py-0.5 rounded shadow-lg border border-gray-600">
                                            ×{count}
                                        </div>
                                    )}
                                    <div className="absolute bottom-0 left-0 right-0 bg-black/70 p-1 text-center text-xs truncate">
                                        {card.name}
                                    </div>
                                </div>
                            ))}
                            {groupedDeck.length === 0 && (
                                <div className="col-span-full text-center text-gray-500 py-12">
                                    No cards found matching "{searchQuery}"
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {artPickerCard && (
                <ArtPickerModal card={artPickerCard} onClose={() => setArtPickerCard(null)} onSelectArt={handleSelectArt} />
            )}
        </div>
    );
};
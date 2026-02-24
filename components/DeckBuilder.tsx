import React, { useState } from 'react';
import { parseDeckList, fetchBatch, searchCards } from '../services/scryfall';
import { CardData } from '../types';
import { Loader2, Download, AlertCircle, Crown, Check, Search, Trash2, Plus, X, ArrowRight } from 'lucide-react';

interface DeckBuilderProps {
    initialDeck: CardData[];
    initialTokens: CardData[];
    onDeckReady: (deck: CardData[], tokens: CardData[], shouldSave?: boolean, name?: string) => void;
    onBack: () => void;
}

export const DeckBuilder: React.FC<DeckBuilderProps> = ({ initialDeck, initialTokens, onDeckReady, onBack }) => {
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
    const [deckName, setDeckName] = useState(isNewDeck ? 'New Deck' : '');

    // Staging area after fetching but before confirming commander
    // If initialDeck has cards, we assume we are in "Edit/Select Commander" mode
    const [stagedDeck, setStagedDeck] = useState<CardData[] | null>(initialDeck && initialDeck.length > 0 ? initialDeck : null);
    const [stagedTokens, setStagedTokens] = useState<CardData[]>(initialTokens || []);

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

    const handleImport = async () => {
        setLoading(true);
        setError(null);
        const parsed = parseDeckList(deckText);

        if (parsed.length === 0) {
            setError("No cards found. Please paste a valid deck list (e.g., '1 Sol Ring').");
            setLoading(false);
            return;
        }

        const deck: CardData[] = [];
        const tokens: CardData[] = [];
        const uniqueNames = parsed.map(p => p.name);

        try {
            const cardMap = await fetchBatch(uniqueNames, (curr, total) => {
                // Show progress of unique cards fetched
                setProgress({ current: curr, total: total });
            });

            // Assemble Deck
            let missingCount = 0;
            for (const item of parsed) {
                // Try strict match then lowercase match
                let data = cardMap.get(item.name.toLowerCase());

                // If strictly not found, try to find by key inclusion (heuristic for complex names)
                if (!data) {
                    const key = Array.from(cardMap.keys()).find(k => k.includes(item.name.toLowerCase()) || item.name.toLowerCase().includes(k));
                    if (key) data = cardMap.get(key);
                }

                if (data) {
                    for (let i = 0; i < item.count; i++) {
                        const cardInstance = { ...data, id: crypto.randomUUID(), isCommander: false };
                        if (data.isToken) {
                            tokens.push(cardInstance);
                        } else {
                            deck.push(cardInstance);
                        }
                    }
                } else {
                    console.warn(`Could not find card data for: ${item.name}`);
                    missingCount++;
                }
            }

            if (missingCount > 0 && deck.length === 0 && tokens.length === 0) {
                setError("Could not load any cards. Please check your card names.");
            } else {
                setStagedDeck(deck);
                // Append new tokens found in the imported list to the existing tokens
                setStagedTokens(prev => [...prev, ...tokens]);
            }

        } catch (e) {
            console.error(e);
            setError("Failed to load deck. Please try again.");
        } finally {
            setLoading(false);
            setProgress(null);
        }
    };

    const setCommander = (id: string) => {
        if (!stagedDeck) return;
        const updated = stagedDeck.map(c => ({
            ...c,
            isCommander: c.id === id ? !c.isCommander : c.isCommander // Toggle or set
        }));
        setStagedDeck(updated);
    };

    const proceedToTokens = () => {
        if (!stagedDeck) return;
        setStep('TOKENS');
    };

    const finalizeDeck = () => {
        if (!stagedDeck) return;
        onDeckReady(stagedDeck, stagedTokens, isNewDeck, deckName);
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
        ? stagedDeck.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
        : [];

    if (step === 'TOKENS') {
        return (
            <div className="flex flex-col h-full p-4 md:p-8 max-w-6xl mx-auto overflow-y-auto">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 shrink-0">
                    <h1 className="text-xl text-center md:text-left md:text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-orange-500">
                        Add Tokens
                    </h1>
                    {isNewDeck && (
                        <div className="w-full md:flex-1 md:mx-4">
                            <input
                                className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white focus:ring-2 focus:ring-green-500 outline-none"
                                placeholder="Deck Name"
                                value={deckName}
                                onChange={e => setDeckName(e.target.value)}
                            />
                        </div>
                    )}
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
                            <span className="text-gray-300 text-xs md:text-base">Click a card to designate it as Commander.</span>
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
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search for your commander..."
                                className="w-full bg-gray-800 border border-gray-600 rounded-lg py-2 pl-10 pr-4 text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            />
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                        <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 md:gap-4">
                            {filteredDeck.map(card => (
                                <div
                                    key={card.id}
                                    onClick={() => setCommander(card.id)}
                                    className={`relative aspect-[2.5/3.5] rounded-lg cursor-pointer transition-all border-4 ${card.isCommander ? 'border-amber-500 scale-105 shadow-amber-500/50 shadow-lg' : 'border-transparent hover:border-gray-500'}`}
                                >
                                    <img src={card.imageUrl} className="w-full h-full object-cover rounded-md" />
                                    {card.isCommander && (
                                        <div className="absolute top-2 right-2 bg-amber-500 text-black p-1 rounded-full shadow-lg">
                                            <Crown size={20} fill="black" />
                                        </div>
                                    )}
                                    <div className="absolute bottom-0 left-0 right-0 bg-black/70 p-1 text-center text-xs truncate">
                                        {card.name}
                                    </div>
                                </div>
                            ))}
                            {filteredDeck.length === 0 && (
                                <div className="col-span-full text-center text-gray-500 py-12">
                                    No cards found matching "{searchQuery}"
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
import React, { useState } from 'react';
import { parseDeckList, fetchBatch, searchCards } from '../services/scryfall';
import { CardData } from '../types';
import { Loader2, Download, AlertCircle, Crown, Check, Search, Trash2, Plus, X, ArrowRight, Layers } from 'lucide-react';

interface DeckBuilderProps {
    initialDeck: CardData[];
    initialTokens: CardData[];
    initialSideboard?: CardData[];
    onDeckReady: (deck: CardData[], tokens: CardData[], sideboard: CardData[], shouldSave?: boolean, name?: string) => void;
    onBack: () => void;
}

export const DeckBuilder: React.FC<DeckBuilderProps> = ({ initialDeck, initialTokens, initialSideboard, onDeckReady, onBack }) => {
    const [deckText, setDeckText] = useState('');
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState<{ current: number, total: number } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');

    // Steps: DECK -> TOKENS
    const [step, setStep] = useState<'DECK' | 'TOKENS'>('DECK');
    const [activeSection, setActiveSection] = useState<'main' | 'sideboard'>('main');

    // Token Search State
    const [tokenQuery, setTokenQuery] = useState('');
    const [tokenResults, setTokenResults] = useState<CardData[]>([]);
    const [isSearchingTokens, setIsSearchingTokens] = useState(false);
    const [tokenTab, setTokenTab] = useState<'search' | 'from_deck'>('search');

    // Card Search (add cards by search in DECK step)
    const [addCardQuery, setAddCardQuery] = useState('');
    const [addCardResults, setAddCardResults] = useState<CardData[]>([]);
    const [isSearchingAdd, setIsSearchingAdd] = useState(false);
    const [alternateArts, setAlternateArts] = useState<CardData[] | null>(null);
    const [artTargetId, setArtTargetId] = useState<string | null>(null);
    const [isSearchingArt, setIsSearchingArt] = useState(false);

    const isNewDeck = !initialDeck || initialDeck.length === 0;
    const [deckName, setDeckName] = useState(isNewDeck ? 'New Deck' : '');

    // Staging area after fetching but before confirming commander
    const [stagedDeck, setStagedDeck] = useState<CardData[] | null>(initialDeck && initialDeck.length > 0 ? initialDeck : null);
    const [stagedSideboard, setStagedSideboard] = useState<CardData[]>(initialSideboard || []);
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

        try {
            if (parsed.main.length === 0 && parsed.sideboard.length === 0 && parsed.commander.length === 0) {
                setError("No cards found. Please paste a valid deck list (e.g., '1 Sol Ring').");
                setLoading(false);
                return;
            }

            const deck: CardData[] = [];
            const sideboard: CardData[] = [];
            const tokens: CardData[] = [];

            const allNames = [
                ...parsed.main.map(p => p.name),
                ...parsed.sideboard.map(p => p.name),
                ...parsed.commander.map(p => p.name)
            ];

            const cardMap = await fetchBatch(allNames, (curr, total) => {
                setProgress({ current: curr, total: total });
            });

            const processSection = (items: { count: number; name: string }[], target: CardData[], isSideboard = false) => {
                for (const item of items) {
                    let data = cardMap.get(item.name.toLowerCase());
                    if (!data) {
                        const key = Array.from(cardMap.keys()).find(k => k.includes(item.name.toLowerCase()) || item.name.toLowerCase().includes(k));
                        if (key) data = cardMap.get(key);
                    }
                    if (data) {
                        for (let i = 0; i < item.count; i++) {
                            const cardInstance = { ...data, id: crypto.randomUUID(), isCommander: false };
                            if (data.isToken) tokens.push(cardInstance);
                            else target.push(cardInstance);
                        }
                    }
                }
            };

            processSection(parsed.main, deck);
            processSection(parsed.sideboard, sideboard, true);
            processSection(parsed.commander, deck); // Commanders go to main deck but marked later

            // Auto-mark commanders from commander section
            parsed.commander.forEach(c => {
                const found = deck.find(d => d.name === c.name);
                if (found) found.isCommander = true;
            });

            if (deck.length === 0 && tokens.length === 0 && sideboard.length === 0) {
                setError("Could not load any cards. Please check your card names.");
            } else {
                setStagedDeck(deck);
                setStagedSideboard(sideboard);
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
            isCommander: c.id === id ? !c.isCommander : c.isCommander
        }));
        setStagedDeck(updated);
    };

    const removeCardFromDeck = (id: string) => {
        if (!stagedDeck) return;
        setStagedDeck(stagedDeck.filter(c => c.id !== id));
    };

    const addCardToDeck = (card: CardData) => {
        const newCard = { ...card, id: crypto.randomUUID(), isCommander: false };
        if (activeSection === 'main') {
            setStagedDeck(prev => prev ? [...prev, newCard] : [newCard]);
        } else {
            setStagedSideboard(prev => [...prev, newCard]);
        }
    };

    const removeCardFromSideboard = (id: string) => {
        setStagedSideboard(prev => prev.filter(c => c.id !== id));
    };

    const searchAddCards = async () => {
        if (!addCardQuery.trim()) return;
        setIsSearchingAdd(true);
        const results = await searchCards(addCardQuery, 20);
        setAddCardResults(results);
        setIsSearchingAdd(false);
    };

    const proceedToTokens = () => {
        if (!stagedDeck) return;
        setStep('TOKENS');
    };

    const finalizeDeck = () => {
        if (!stagedDeck) return;
        onDeckReady(stagedDeck, stagedTokens, stagedSideboard, isNewDeck, deckName);
    };

    const clearDeck = () => {
        if (confirm("Are you sure you want to clear this deck and import a new one?")) {
            setStagedDeck(null);
            setStagedSideboard([]);
            setStagedTokens([]);
            setDeckText('');
            setStep('DECK');
            setAddCardResults([]);
            setAddCardQuery('');
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
        setStagedTokens(prev => [...prev, { ...card, id: crypto.randomUUID(), isToken: true }]);
    };

    const addTokenFromDeck = (card: CardData) => {
        // Add a token copy of this deck card
        setStagedTokens(prev => [...prev, { ...card, id: crypto.randomUUID(), isToken: true }]);
    };

    const removeToken = (id: string) => {
        setStagedTokens(prev => prev.filter(t => t.id !== id));
    };

    const handleRightClick = async (e: React.MouseEvent, card: CardData) => {
        e.preventDefault();
        setArtTargetId(card.id);
        setIsSearchingArt(true);
        const results = await searchCards(`!"${card.name}" unique:prints`);
        setAlternateArts(results);
        setIsSearchingArt(false);
    };

    const changeArt = (newImageUrl: string) => {
        if (!artTargetId) return;
        if (activeSection === 'main' && stagedDeck) {
            setStagedDeck(prev => prev ? prev.map(c => c.id === artTargetId ? { ...c, imageUrl: newImageUrl } : c) : null);
        } else {
            setStagedSideboard(prev => prev.map(c => c.id === artTargetId ? { ...c, imageUrl: newImageUrl } : c));
        }
        setAlternateArts(null);
        setArtTargetId(null);
    };

    const filteredDeck = stagedDeck
        ? stagedDeck.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
        : [];

    const filteredSideboard = stagedSideboard.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()));

    const totalDeckSize = (stagedDeck?.length || 0) + stagedSideboard.length;

    // ===================== TOKENS STEP =====================
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
                    {/* Left: Search / Pick From Deck */}
                    <div className="flex-1 flex flex-col gap-4 bg-gray-800 rounded-xl p-4 border border-gray-700 min-h-[300px] md:min-h-0">
                        {/* Tab Switcher */}
                        <div className="flex gap-1 bg-gray-900 rounded-lg p-1 shrink-0">
                            <button
                                onClick={() => setTokenTab('search')}
                                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-bold transition ${tokenTab === 'search' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
                            >
                                <Search size={14} /> Scryfall Search
                            </button>
                            <button
                                onClick={() => setTokenTab('from_deck')}
                                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-bold transition ${tokenTab === 'from_deck' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}
                            >
                                <Layers size={14} /> Pick From Deck
                            </button>
                        </div>

                        {tokenTab === 'search' ? (
                            <>
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
                                            <div key={card.scryfallId + '-' + card.id} className="relative group cursor-pointer" onClick={() => addToken(card)}>
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
                            </>
                        ) : (
                            /* Pick From Deck tab */
                            <div className="flex-1 overflow-y-auto custom-scrollbar">
                                {stagedDeck && stagedDeck.length > 0 ? (
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                        {stagedDeck.map(card => {
                                            const alreadyAdded = stagedTokens.some(t => t.name === card.name);
                                            return (
                                                <div
                                                    key={card.id}
                                                    className={`relative group cursor-pointer ${alreadyAdded ? 'ring-2 ring-green-500 rounded' : ''}`}
                                                    onClick={() => addTokenFromDeck(card)}
                                                >
                                                    <img src={card.imageUrl} className="w-full rounded shadow-md hover:scale-105 transition-transform" />
                                                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/40 transition-opacity rounded">
                                                        <Plus className="text-white" size={32} />
                                                    </div>
                                                    {alreadyAdded && (
                                                        <div className="absolute top-1 right-1 bg-green-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                                                            Added
                                                        </div>
                                                    )}
                                                    <div className="absolute bottom-0 left-0 right-0 bg-black/70 p-1 text-center text-xs truncate rounded-b">
                                                        {card.name}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="text-center text-gray-500 mt-10">No cards in deck yet.</div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Right: Selected Tokens */}
                    <div className="w-full md:w-1/3 bg-gray-900 rounded-xl p-4 border border-gray-700 flex flex-col min-h-[200px] md:min-h-0 pb-8 md:pb-4">
                        <h3 className="text-white font-bold mb-4 flex justify-between shrink-0">
                            <span>Selected Tokens</span>
                            <span className="text-blue-400">{stagedTokens.length}</span>
                        </h3>
                        <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar">
                            {stagedTokens.map((token) => (
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

    // ===================== DECK STEP =====================
    return (
        <div className="flex flex-col h-full p-4 md:p-8 max-w-6xl mx-auto overflow-hidden">
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-xl md:text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
                    {stagedDeck ? 'Edit Deck' : 'Import Deck'}
                </h1>
                <div className="flex items-center gap-3">
                    {stagedDeck && (
                        <span className="text-sm text-gray-400 bg-gray-800 px-3 py-1 rounded-full border border-gray-700 font-mono">
                            {stagedDeck.length} cards
                        </span>
                    )}
                    <button onClick={onBack} className="text-gray-400 hover:text-white transition">
                        Back to Menu
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
                <div className="flex-1 flex flex-col bg-gray-800 rounded-xl border border-gray-700 overflow-hidden min-h-0">
                    <div className="p-4 bg-gray-900 border-b border-gray-700 flex flex-col gap-4 shrink-0">
                        <div className="flex flex-col md:flex-row justify-between items-center gap-2">
                            <div className="flex items-center gap-3">
                                <span className="text-gray-300 text-xs md:text-base">Click a card to set Commander. Use ✕ to remove.</span>
                                <span className="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded font-mono">{stagedDeck.length} cards</span>
                            </div>
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

                        {/* Two search bars: filter existing + add new */}
                        <div className="flex flex-col md:flex-row gap-2">
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder={activeSection === 'main' ? "Filter main deck..." : "Filter sideboard..."}
                                    className="w-full bg-gray-800 border border-gray-600 rounded-lg py-2 pl-10 pr-4 text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                />
                            </div>
                            {/* Section Switcher */}
                            <div className="flex bg-gray-800 rounded-lg p-1 border border-gray-700">
                                <button
                                    onClick={() => setActiveSection('main')}
                                    className={`px-3 py-1 rounded-md text-xs font-bold transition ${activeSection === 'main' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'}`}
                                >
                                    Main ({stagedDeck?.length || 0})
                                </button>
                                <button
                                    onClick={() => setActiveSection('sideboard')}
                                    className={`px-3 py-1 rounded-md text-xs font-bold transition ${activeSection === 'sideboard' ? 'bg-purple-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'}`}
                                >
                                    Side ({stagedSideboard.length})
                                </button>
                            </div>
                            <div className="flex gap-2">
                                <div className="relative flex-1 md:flex-none">
                                    <Plus className="absolute left-3 top-1/2 -translate-y-1/2 text-green-400" size={18} />
                                    <input
                                        type="text"
                                        value={addCardQuery}
                                        onChange={(e) => setAddCardQuery(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && searchAddCards()}
                                        placeholder={activeSection === 'main' ? "Add to Main..." : "Add to Sideboard..."}
                                        className="w-full bg-gray-800 border border-green-900/50 rounded-lg py-2 pl-10 pr-4 text-white focus:ring-2 focus:ring-green-500 focus:outline-none md:w-48"
                                    />
                                </div>
                                <button
                                    onClick={searchAddCards}
                                    disabled={isSearchingAdd}
                                    className="px-3 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg font-bold disabled:opacity-50 flex items-center gap-1"
                                >
                                    {isSearchingAdd ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Add card search results dropdown */}
                    {addCardResults.length > 0 && (
                        <div className="bg-gray-900 border-b border-gray-700 px-4 py-3 shrink-0">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs text-gray-400 font-bold uppercase">Search Results — Click to Add</span>
                                <button onClick={() => setAddCardResults([])} className="text-gray-500 hover:text-white"><X size={14} /></button>
                            </div>
                            <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
                                {addCardResults.map(card => (
                                    <div
                                        key={card.scryfallId + '-add'}
                                        className="flex-shrink-0 w-24 cursor-pointer group relative"
                                        onClick={() => addCardToDeck(card)}
                                    >
                                        <img src={card.imageUrl} className="w-full rounded shadow-md group-hover:scale-105 transition-transform" />
                                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/50 transition-opacity rounded">
                                            <Plus className="text-green-400" size={24} />
                                        </div>
                                        <div className="text-[10px] text-gray-400 truncate mt-1 text-center">{card.name}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                        <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 md:gap-4">
                            {activeSection === 'main' ? (
                                filteredDeck.map(card => (
                                    <div
                                        key={card.id}
                                        className={`relative aspect-[2.5/3.5] rounded-lg cursor-pointer transition-all border-4 group ${card.isCommander ? 'border-amber-500 scale-105 shadow-amber-500/50 shadow-lg' : 'border-transparent hover:border-gray-500'}`}
                                    >
                                        <img
                                            src={card.imageUrl}
                                            className="w-full h-full object-cover rounded-md"
                                            onClick={() => setCommander(card.id)}
                                            onContextMenu={(e) => handleRightClick(e, card)}
                                        />
                                        {card.isCommander && (
                                            <div className="absolute top-2 right-2 bg-amber-500 text-black p-1 rounded-full shadow-lg">
                                                <Crown size={20} fill="black" />
                                            </div>
                                        )}
                                        {/* Remove button */}
                                        <button
                                            onClick={(e) => { e.stopPropagation(); removeCardFromDeck(card.id); }}
                                            className="absolute top-1 left-1 bg-red-600/80 hover:bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity z-10"
                                            title="Remove card"
                                        >
                                            <X size={14} />
                                        </button>
                                        <div className="absolute bottom-0 left-0 right-0 bg-black/70 p-1 text-center text-xs truncate">
                                            {card.name}
                                        </div>
                                    </div>
                                ))
                            ) : (
                                filteredSideboard.map(card => (
                                    <div
                                        key={card.id}
                                        className="relative aspect-[2.5/3.5] rounded-lg cursor-pointer transition-all border-4 border-transparent hover:border-purple-500 group"
                                    >
                                        <img
                                            src={card.imageUrl}
                                            className="w-full h-full object-cover rounded-md"
                                            onContextMenu={(e) => handleRightClick(e, card)}
                                        />
                                        <button
                                            onClick={(e) => { e.stopPropagation(); removeCardFromSideboard(card.id); }}
                                            className="absolute top-1 left-1 bg-red-600/80 hover:bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity z-10"
                                            title="Remove card"
                                        >
                                            <X size={14} />
                                        </button>
                                        <div className="absolute bottom-0 left-0 right-0 bg-black/70 p-1 text-center text-xs truncate">
                                            {card.name}
                                        </div>
                                    </div>
                                ))
                            )}

                            {((activeSection === 'main' && filteredDeck.length === 0) || (activeSection === 'sideboard' && filteredSideboard.length === 0)) && (
                                <div className="col-span-full text-center text-gray-500 py-12">
                                    {searchQuery ? `No cards found matching "${searchQuery}"` : 'This section is empty.'}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
            {/* Art Selection Overlay */}
            {artTargetId && (
                <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
                    <div className="bg-gray-800 border border-gray-600 rounded-xl w-full max-w-4xl max-h-[80vh] flex flex-col shadow-2xl overflow-hidden">
                        <div className="p-4 border-b border-gray-700 flex justify-between items-center bg-gray-900">
                            <h3 className="font-bold text-white flex items-center gap-2">Select New Art</h3>
                            <button onClick={() => { setArtTargetId(null); setAlternateArts(null); }} className="text-gray-400 hover:text-white"><X size={20} /></button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                            {isSearchingArt ? (
                                <div className="flex flex-col items-center justify-center py-20 gap-4">
                                    <Loader2 className="animate-spin text-blue-500" size={48} />
                                    <p className="text-gray-400">Fetching alternate versions...</p>
                                </div>
                            ) : alternateArts && alternateArts.length > 0 ? (
                                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-4">
                                    {alternateArts.map((art, idx) => (
                                        <div
                                            key={`${art.scryfallId}-${idx}`}
                                            onClick={() => changeArt(art.imageUrl)}
                                            className="cursor-pointer group relative"
                                        >
                                            <img src={art.imageUrl} className="w-full rounded shadow-md group-hover:ring-2 ring-blue-500 transition-all" />
                                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity rounded">
                                                <Check className="text-white" size={32} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-20 text-gray-500">No alternate art found for this card.</div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
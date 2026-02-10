import React, { useState } from 'react';
import { CardData } from '../types';
import { parseDeckList, fetchBatch } from '../services/scryfall';
import { Plus, Trash2, Play, Loader2, User, ArrowLeft, Crown, Check } from 'lucide-react';
import { PLAYER_COLORS } from '../constants';
import { SavedDeck } from '../App';

interface LocalOpponent {
    id: string;
    name: string;
    deck: CardData[];
    tokens: CardData[];
    color: string;
    type: 'ai' | 'human_local' | 'open_slot';

}

interface LocalSetupProps {
    onStartGame: (opponents: LocalOpponent[], isLocalTable: boolean) => void;
    onBack: () => void;
    savedDecks: SavedDeck[];
}

export const LocalSetup: React.FC<LocalSetupProps> = ({ onStartGame, onBack, savedDecks }) => {
    const [opponents, setOpponents] = useState<LocalOpponent[]>([]);
    const [isImporting, setIsImporting] = useState(false);
    const [isLocalTable, setIsLocalTable] = useState(false);

    // Temporary state for adding a new opponent
    const [newName, setNewName] = useState('');
    const [deckText, setDeckText] = useState('');
    const [importError, setImportError] = useState<string | null>(null);

    // Staging state for commander selection
    const [stagedOpponent, setStagedOpponent] = useState<{ name: string, deck: CardData[], tokens: CardData[] } | null>(null);
    const [showLibrary, setShowLibrary] = useState(false);

    const handleSelectFromLibrary = (saved: SavedDeck) => {
        setStagedOpponent({
            name: saved.name,
            deck: saved.deck,
            tokens: saved.tokens
        });
        setShowLibrary(false);
    };

    const handleImportDeck = async () => {
        if (!newName) return;
        if (!deckText) {
            setImportError("Please enter a deck list.");
            return;
        }

        setIsImporting(true);
        setImportError(null);

        try {
            const parsed = parseDeckList(deckText);
            if (parsed.length === 0) {
                setImportError("No valid cards found.");
                setIsImporting(false);
                return;
            }

            const uniqueNames = parsed.map(p => p.name);
            const cardMap = await fetchBatch(uniqueNames);

            const deck: CardData[] = [];
            const tokens: CardData[] = [];

            parsed.forEach(item => {
                const data = cardMap.get(item.name.toLowerCase());
                if (data) {
                    for (let i = 0; i < item.count; i++) {
                        const instance = { ...data, id: crypto.randomUUID(), isCommander: false };
                        if (data.isToken) tokens.push(instance);
                        else deck.push(instance);
                    }
                }
            });

            if (deck.length === 0) {
                setImportError("Could not load any cards.");
            } else {
                // Move to staging to select commander
                setStagedOpponent({
                    name: newName,
                    deck,
                    tokens
                });
            }
        } catch (e) {
            setImportError("Failed to import deck.");
        } finally {
            setIsImporting(false);
        }
    };

    const toggleCommander = (cardId: string) => {
        if (!stagedOpponent) return;
        const newDeck = stagedOpponent.deck.map(c =>
            c.id === cardId ? { ...c, isCommander: !c.isCommander } : c
        );
        setStagedOpponent({ ...stagedOpponent, deck: newDeck });
    };

    const confirmOpponent = () => {
        if (!stagedOpponent) return;
        const newOpponent: LocalOpponent = {
            id: `local-opponent-${Date.now()}`,
            name: stagedOpponent.name,
            deck: stagedOpponent.deck,
            tokens: stagedOpponent.tokens,
            color: PLAYER_COLORS[(opponents.length + 1) % PLAYER_COLORS.length],
            type: 'ai' // Default to AI for now, could add Human/AI toggle later if needed for non-local-table
        };
        setOpponents([...opponents, newOpponent]);
        setStagedOpponent(null);
        setNewName('');
        setDeckText('');
    };

    const removeOpponent = (index: number) => {
        setOpponents(opponents.filter((_, i) => i !== index));
    };

    const addOpenSlot = () => {
        if (opponents.length >= 5) return;
        const newOpponent: LocalOpponent = {
            id: `open-slot-${Date.now()}`,
            name: `Open Slot ${opponents.length + 1}`,
            deck: [],
            tokens: [],
            color: PLAYER_COLORS[(opponents.length + 1) % PLAYER_COLORS.length],
            type: 'open_slot'
        };
        setOpponents([...opponents, newOpponent]);
    };

    return (
        <div className="flex flex-col h-full p-4 md:p-8 max-w-4xl mx-auto animate-in fade-in pb-20 overflow-y-auto">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                    <User className="text-green-500" /> Local Game Setup
                </h1>
                <button onClick={onBack} className="text-gray-400 hover:text-white flex items-center gap-2">
                    <ArrowLeft size={20} /> Back
                </button>
                <button onClick={onBack} className="text-gray-400 hover:text-white flex items-center gap-2">
                    <ArrowLeft size={20} /> Back
                </button>
            </div>

            {/* Local Table Toggle */}
            <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 mb-6 flex items-center justify-between">
                <div>
                    <h3 className="text-white font-bold flex items-center gap-2">
                        Local Table Mode <span className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded-full">New</span>
                    </h3>
                    <p className="text-xs text-gray-400">
                        Use this device as a main board. Players join with their phones to control their hands.
                    </p>
                </div>
                <div
                    onClick={() => {
                        setIsLocalTable(!isLocalTable);
                        // Optional: Clear opponents or convert them if switching modes? 
                        // For now, let's keep them but maybe warn or just handle it.
                    }}
                    className={`w-12 h-6 rounded-full p-1 cursor-pointer transition-colors ${isLocalTable ? 'bg-green-500' : 'bg-gray-600'}`}
                >
                    <div className={`w-4 h-4 bg-white rounded-full transition-transform ${isLocalTable ? 'translate-x-6' : 'translate-x-0'}`} />
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-8 flex-1">
                {/* Add Opponent Form */}
                <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 flex flex-col">
                    <h2 className="text-xl font-bold text-white mb-4">
                        {stagedOpponent ? 'Select Commander' : 'Add Opponent'}
                    </h2>

                    {!stagedOpponent ? (
                        <div className="space-y-4 flex-1 flex flex-col">
                            {isLocalTable && (
                                <button
                                    onClick={addOpenSlot}
                                    disabled={opponents.length >= 5}
                                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold rounded-lg flex items-center justify-center gap-2"
                                >
                                    <Plus size={20} /> Add Open Slot (For Mobile Join)
                                </button>
                            )}

                            <div className="flex items-center gap-2 my-2">
                                <div className="h-px bg-gray-700 flex-1" /> <span className="text-xs text-gray-500">OR ADD BOT/LOCAL DECK</span> <div className="h-px bg-gray-700 flex-1" />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Name</label>
                                <input
                                    className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white focus:border-green-500 outline-none"
                                    value={newName}
                                    onChange={e => setNewName(e.target.value)}
                                    placeholder="Opponent Name"
                                />
                            </div>

                            <div className="flex-1 flex flex-col">
                                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Deck List</label>
                                <textarea
                                    className="w-full h-full bg-gray-900 border border-gray-600 rounded p-2 text-xs font-mono text-gray-300 focus:border-green-500 outline-none resize-none"
                                    value={deckText}
                                    onChange={e => setDeckText(e.target.value)}
                                    placeholder={`1 Sol Ring\n1 Command Tower...`}
                                />
                            </div>

                            {importError && <div className="text-red-400 text-sm">{importError}</div>}

                            <button
                                onClick={handleImportDeck}
                                disabled={isImporting || opponents.length >= 5}
                                className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold rounded-lg flex items-center justify-center gap-2"
                            >
                                {isImporting ? <Loader2 className="animate-spin" /> : <Plus />}
                                Import Deck
                            </button>
                            <div className="flex items-center gap-2 my-2">
                                <div className="h-px bg-gray-700 flex-1" /> <span className="text-xs text-gray-500">OR</span> <div className="h-px bg-gray-700 flex-1" />
                            </div>
                            <button
                                onClick={() => setShowLibrary(true)}
                                disabled={opponents.length >= 5}
                                className="w-full py-3 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 text-white font-bold rounded-lg"
                            >
                                Select from Library
                            </button>
                            {opponents.length >= 5 && <p className="text-xs text-center text-gray-500">Max 5 opponents reached.</p>}
                        </div>
                    ) : (
                        <div className="flex flex-col flex-1">
                            <p className="text-xs text-gray-400 mb-2">Click cards to toggle Commander status.</p>
                            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 mb-4 max-h-[60vh]">
                                <div className="grid grid-cols-3 gap-2">
                                    {stagedOpponent.deck.map(card => (
                                        <div
                                            key={card.id}
                                            onClick={() => toggleCommander(card.id)}
                                            className={`relative aspect-[2.5/3.5] cursor-pointer rounded border-2 transition-all ${card.isCommander ? 'border-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]' : 'border-transparent hover:border-gray-500'}`}
                                        >
                                            <img src={card.imageUrl} className="w-full h-full object-cover rounded-sm" />
                                            {card.isCommander && <div className="absolute top-1 right-1 bg-amber-500 text-black p-0.5 rounded-full"><Crown size={12} /></div>}
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => setStagedOpponent(null)} className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-bold">Cancel</button>
                                <button onClick={confirmOpponent} className="flex-1 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg font-bold flex items-center justify-center gap-2"><Check size={16} /> Confirm</button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Opponent List */}
                <div className="flex flex-col gap-4">
                    <h2 className="text-xl font-bold text-white">Opponents ({opponents.length})</h2>
                    <div className="flex-1 overflow-y-auto space-y-3">
                        {opponents.length === 0 && (
                            <div className="text-gray-500 italic text-center py-10 border-2 border-dashed border-gray-700 rounded-xl">
                                No opponents added yet.
                            </div>
                        )}
                        {opponents.map((opp, idx) => (
                            <div key={opp.id} className="bg-gray-800 p-4 rounded-xl border border-gray-700 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full border-2 border-white/20 flex items-center justify-center font-bold text-white" style={{ backgroundColor: opp.color }}>
                                        {opp.name.charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                        <div className="font-bold text-white">{opp.name}</div>
                                        <div className="text-xs text-gray-400 flex gap-2">
                                            {opp.type === 'open_slot' ? (
                                                <span className="text-indigo-400 font-bold animate-pulse">Waiting for player...</span>
                                            ) : (
                                                <>
                                                    <span>{opp.deck.length} cards</span>
                                                    {opp.deck.some(c => c.isCommander) && <span className="text-amber-500 flex items-center gap-0.5"><Crown size={10} /> Commander</span>}
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <button onClick={() => removeOpponent(idx)} className="text-red-400 hover:text-red-300 p-2">
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        ))}
                    </div>

                    <button
                        onClick={() => onStartGame(opponents, isLocalTable)}
                        disabled={opponents.length === 0}
                        className="w-full py-4 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold rounded-xl shadow-lg flex items-center justify-center gap-2 mt-auto"
                    >
                        <Play size={20} /> Start Local Game
                    </button>
                </div>
            </div>

            {/* Library Modal */}
            {showLibrary && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="bg-gray-800 border border-gray-600 w-full max-w-2xl rounded-xl shadow-2xl flex flex-col max-h-[80vh]">
                        <div className="p-4 border-b border-gray-700 flex justify-between items-center bg-gray-900">
                            <h3 className="font-bold text-white">Select Deck</h3>
                            <button onClick={() => setShowLibrary(false)} className="text-gray-400 hover:text-white"><ArrowLeft size={20} /></button>
                        </div>
                        <div className="p-4 overflow-y-auto grid grid-cols-1 gap-2">
                            {savedDecks.map(deck => (
                                <button key={deck.id} onClick={() => handleSelectFromLibrary(deck)} className="flex items-center gap-4 bg-gray-700/50 p-3 rounded-lg border border-gray-600 hover:bg-gray-600 hover:border-blue-500 transition text-left">
                                    <div className="font-bold text-white flex-1">{deck.name}</div>
                                    <div className="text-xs text-gray-400">{deck.deck.length} cards</div>
                                </button>
                            ))}
                            {savedDecks.length === 0 && <div className="text-center text-gray-500 py-8">No saved decks.</div>}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
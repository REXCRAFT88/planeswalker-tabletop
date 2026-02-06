import React, { useState } from 'react';
import { CardData } from '../types';
import { parseDeckList, fetchBatch } from '../services/scryfall';
import { Plus, Trash2, Play, Loader2, User, ArrowLeft } from 'lucide-react';
import { PLAYER_COLORS } from '../constants';

interface LocalOpponent {
    id: string;
    name: string;
    deck: CardData[];
    tokens: CardData[];
    color: string;
}

interface LocalSetupProps {
    onStartGame: (opponents: LocalOpponent[]) => void;
    onBack: () => void;
}

export const LocalSetup: React.FC<LocalSetupProps> = ({ onStartGame, onBack }) => {
    const [opponents, setOpponents] = useState<LocalOpponent[]>([]);
    const [isImporting, setIsImporting] = useState(false);
    
    // Temporary state for adding a new opponent
    const [newName, setNewName] = useState('');
    const [deckText, setDeckText] = useState('');
    const [importError, setImportError] = useState<string | null>(null);

    const handleAddOpponent = async () => {
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
                const newOpponent: LocalOpponent = {
                    id: `local-opponent-${Date.now()}`,
                    name: newName,
                    deck,
                    tokens,
                    color: PLAYER_COLORS[(opponents.length + 1) % PLAYER_COLORS.length]
                };
                setOpponents([...opponents, newOpponent]);
                setNewName('');
                setDeckText('');
            }
        } catch (e) {
            setImportError("Failed to import deck.");
        } finally {
            setIsImporting(false);
        }
    };

    const removeOpponent = (index: number) => {
        setOpponents(opponents.filter((_, i) => i !== index));
    };

    return (
        <div className="flex flex-col h-full p-8 max-w-4xl mx-auto animate-in fade-in">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                    <User className="text-green-500" /> Local Game Setup
                </h1>
                <button onClick={onBack} className="text-gray-400 hover:text-white flex items-center gap-2">
                    <ArrowLeft size={20} /> Back
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 flex-1 overflow-hidden">
                {/* Add Opponent Form */}
                <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 flex flex-col overflow-y-auto">
                    <h2 className="text-xl font-bold text-white mb-4">Add Opponent</h2>
                    
                    <div className="space-y-4">
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
                                className="w-full h-40 bg-gray-900 border border-gray-600 rounded p-2 text-xs font-mono text-gray-300 focus:border-green-500 outline-none resize-none"
                                value={deckText}
                                onChange={e => setDeckText(e.target.value)}
                                placeholder={`1 Sol Ring\n1 Command Tower...`}
                            />
                        </div>

                        {importError && <div className="text-red-400 text-sm">{importError}</div>}

                        <button 
                            onClick={handleAddOpponent}
                            disabled={isImporting || opponents.length >= 3}
                            className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold rounded-lg flex items-center justify-center gap-2"
                        >
                            {isImporting ? <Loader2 className="animate-spin" /> : <Plus />}
                            Add Opponent
                        </button>
                        {opponents.length >= 3 && <p className="text-xs text-center text-gray-500">Max 3 opponents reached.</p>}
                    </div>
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
                                    <div className="w-8 h-8 rounded-full border-2 border-white/20 flex items-center justify-center font-bold text-white" style={{backgroundColor: opp.color}}>
                                        {opp.name.charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                        <div className="font-bold text-white">{opp.name}</div>
                                        <div className="text-xs text-gray-400">{opp.deck.length} cards</div>
                                    </div>
                                </div>
                                <button onClick={() => removeOpponent(idx)} className="text-red-400 hover:text-red-300 p-2">
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        ))}
                    </div>

                    <button 
                        onClick={() => onStartGame(opponents)}
                        disabled={opponents.length === 0}
                        className="w-full py-4 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold rounded-xl shadow-lg flex items-center justify-center gap-2 mt-auto"
                    >
                        <Play size={20} /> Start Local Game
                    </button>
                </div>
            </div>
        </div>
    );
};
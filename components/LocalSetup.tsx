import React, { useState } from 'react';
import { Users, ArrowLeft, Plus, X, Bot, User, Laptop, Play, Crown } from 'lucide-react';
import { CardData } from '../types';
import { SavedDeck } from '../App';
import { PLAYER_COLORS } from '../constants';

interface Participant {
    id: string;
    name: string;
    deck: CardData[];
    sideboard: CardData[];
    tokens: CardData[];
    color: string;
    type: 'human_local';
}

interface LocalSetupProps {
    onStartGame: (participants: Participant[]) => void;
    onBack: () => void;
    savedDecks: SavedDeck[];
    playerName: string;
    playerSleeve: string;
    activeDeck: CardData[];
    activeSideboard: CardData[];
    activeTokens: CardData[];
}

export const LocalSetup: React.FC<LocalSetupProps> = ({
    onStartGame, onBack, savedDecks,
    playerName, playerSleeve, activeDeck, activeSideboard, activeTokens
}) => {
    const [participants, setParticipants] = useState<Participant[]>([
        { id: 'player-0', name: playerName, deck: activeDeck, sideboard: activeSideboard, tokens: activeTokens, color: playerSleeve, type: 'human_local' }
    ]);
    const [showColorPicker, setShowColorPicker] = useState<number | null>(null);

    const addParticipant = () => {
        if (participants.length >= 6) return;

        const colorIndex = participants.length % PLAYER_COLORS.length;
        const defaultName = `Player ${participants.length + 1}`;

        setParticipants(prev => [...prev, {
            id: `human-${Date.now()}`,
            name: defaultName,
            deck: [],
            sideboard: [],
            tokens: [],
            color: PLAYER_COLORS[colorIndex],
            type: 'human_local'
        }]);
    };

    const removeParticipant = (index: number) => {
        if (index === 0) return; // Cannot remove host
        setParticipants(prev => prev.filter((_, i) => i !== index));
    };

    const updateParticipant = (index: number, updates: Partial<Participant>) => {
        setParticipants(prev => prev.map((p, i) => i === index ? { ...p, ...updates } : p));
    };

    const handleStart = () => {
        const validated = participants.map(p => {
            // If participant is not host and has no deck, default to the first saved deck
            if (p.id !== 'player-0' && p.deck.length === 0 && savedDecks.length > 0) {
                return {
                    ...p,
                    deck: [...savedDecks[0].deck],
                    sideboard: [...(savedDecks[0].sideboard || [])],
                    tokens: [...savedDecks[0].tokens],
                };
            }
            return p;
        });
        onStartGame(validated);
    };

    return (
        <div className="w-full h-full overflow-y-auto">
            <div className="min-h-full flex flex-col items-center justify-start p-4 md:p-8 animate-in fade-in duration-500">
                <div className="w-full max-w-2xl">

                    {/* Header */}
                    <div className="flex items-center gap-4 mb-8">
                        <button
                            onClick={onBack}
                            className="p-2 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white rounded-lg transition-colors border border-gray-700"
                        >
                            <ArrowLeft size={20} />
                        </button>
                        <div>
                            <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-orange-300 to-red-500">
                                Local Game Setup
                            </h1>
                            <p className="text-gray-400 text-sm mt-1">Configure your players for solo or pass-and-play</p>
                        </div>
                    </div>

                    {/* Participants */}
                    <div className="bg-gray-800/60 backdrop-blur-sm border border-gray-700 rounded-2xl p-6 mb-6 shadow-xl">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider">
                                Players ({participants.length})
                            </h2>
                            <span className="text-xs text-gray-500">Max 6 local players</span>
                        </div>

                        <div className="space-y-3 mb-4">
                            {participants.map((p, idx) => (
                                <div
                                    key={p.id}
                                    className={`flex items-center gap-3 bg-gray-900/60 rounded-xl p-3 border group ${idx === 0 ? 'border-orange-500/50 shadow-[0_0_10px_rgba(249,115,22,0.1)]' : 'border-gray-700'}`}
                                >
                                    {/* Color dot */}
                                    <div className="relative">
                                        <button
                                            className="w-8 h-8 rounded-full border-2 border-white/20 flex-shrink-0 transition-transform hover:scale-110 shadow-lg"
                                            style={{ backgroundColor: p.color }}
                                            onClick={() => setShowColorPicker(showColorPicker === idx ? null : idx)}
                                        />
                                        {showColorPicker === idx && (
                                            <div className="absolute top-full left-0 z-50 mt-2 p-2 bg-gray-800 border border-gray-600 rounded-lg shadow-2xl grid grid-cols-4 gap-2 min-w-[140px] animate-in zoom-in-95 duration-200">
                                                {PLAYER_COLORS.map(color => (
                                                    <button
                                                        key={color}
                                                        className="w-8 h-8 rounded-full border border-white/10 hover:scale-110 transition-transform shadow-inner"
                                                        style={{ backgroundColor: color }}
                                                        onClick={() => {
                                                            updateParticipant(idx, { color });
                                                            setShowColorPicker(null);
                                                        }}
                                                    />
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    {/* Type icon */}
                                    <div className="flex items-center gap-1.5 flex-shrink-0">
                                        <User size={16} className="text-blue-400" />
                                    </div>

                                    {/* Name input */}
                                    <input
                                        type="text"
                                        value={p.name}
                                        onChange={e => updateParticipant(idx, { name: e.target.value })}
                                        className="flex-1 bg-transparent text-white font-semibold border-none outline-none text-sm placeholder:text-gray-600 min-w-0"
                                        placeholder="Name..."
                                    />

                                    {/* Deck selector */}
                                    {savedDecks.length > 0 && (
                                        <select
                                            className="bg-gray-800 border border-gray-600 text-gray-300 text-xs rounded-lg px-2 py-1.5 truncate max-w-[130px] outline-none focus:ring-1 focus:ring-blue-500"
                                            value={savedDecks.find(sd => sd.deck === p.deck)?.id || ''}
                                            onChange={e => {
                                                const deck = savedDecks.find(d => d.id === e.target.value);
                                                if (deck) {
                                                    updateParticipant(idx, {
                                                        deck: [...deck.deck],
                                                        sideboard: [...(deck.sideboard || [])],
                                                        tokens: [...deck.tokens]
                                                    });
                                                }
                                            }}
                                        >
                                            <option value="">{p.deck.length > 0 ? (idx === 0 ? 'Current Deck' : 'Deck Loaded') : 'Pick deck...'}</option>
                                            {savedDecks.map(d => (
                                                <option key={d.id} value={d.id}>{d.name}</option>
                                            ))}
                                        </select>
                                    )}

                                    {/* Commander badge for deck */}
                                    {p.deck.length > 0 && (
                                        <div className="flex items-center gap-1 text-[10px] text-amber-400 flex-shrink-0 bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/20">
                                            <Crown size={10} />
                                            <span className="hidden sm:inline truncate max-w-[50px]">
                                                {p.deck.find(c => c.isCommander)?.name?.split(' ')[0] || 'Deck'}
                                            </span>
                                        </div>
                                    )}

                                    {/* Remove button (not for host) */}
                                    {idx > 0 && (
                                        <button
                                            onClick={() => removeParticipant(idx)}
                                            className="p-1.5 text-gray-500 hover:text-red-400 transition-colors flex-shrink-0 md:opacity-0 group-hover:opacity-100"
                                        >
                                            <X size={18} />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* Add buttons */}
                        <div className="flex flex-wrap gap-2">
                            <button
                                onClick={addParticipant}
                                className="flex items-center gap-2 px-4 py-2 bg-blue-900/30 hover:bg-blue-900/40 border border-blue-700/50 text-blue-300 rounded-lg text-sm font-medium transition-colors"
                            >
                                <Plus size={16} /> Add Local Player
                            </button>
                        </div>
                    </div>

                    <div className="bg-orange-950/20 border border-orange-500/20 rounded-xl p-4 mb-6 text-sm text-orange-200/70">
                        <p className="flex gap-2">
                            <span className="font-bold text-orange-400">Solo Play:</span>
                            Simply start the game with yourself as the only player.
                        </p>
                    </div>

                    {/* Start button */}
                    <button
                        onClick={handleStart}
                        className="w-full py-4 bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-400 hover:to-red-500 text-white font-extrabold rounded-2xl shadow-xl shadow-orange-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-3 text-lg"
                    >
                        <Play size={22} />
                        Start Local Game
                    </button>
                </div>
            </div>
        </div>
    );
};

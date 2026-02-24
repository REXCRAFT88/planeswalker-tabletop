import React, { useState } from 'react';
import { Users, ArrowLeft, Plus, X, Bot, User, Laptop, Play, Crown } from 'lucide-react';
import { CardData } from '../types';
import { SavedDeck } from '../App';
import { PLAYER_COLORS } from '../constants';

interface Opponent {
    name: string;
    deck: CardData[];
    tokens: CardData[];
    color: string;
    type: 'ai' | 'human_local' | 'open_slot';
}

interface LocalSetupProps {
    onStartGame: (opponents: Opponent[], isLocalTable?: boolean) => void;
    onBack: () => void;
    savedDecks: SavedDeck[];
}

export const LocalSetup: React.FC<LocalSetupProps> = ({ onStartGame, onBack, savedDecks }) => {
    const [opponents, setOpponents] = useState<Opponent[]>([
        { name: 'AI Opponent', deck: [], tokens: [], color: PLAYER_COLORS[1], type: 'ai' }
    ]);
    const [gameMode, setGameMode] = useState<'solo' | 'local_table'>('solo');

    const addOpponent = (type: 'ai' | 'human_local' | 'open_slot') => {
        if (opponents.length >= 5) return; // Max 6 players total (1 host + 5 opponents)

        const colorIndex = (opponents.length + 1) % PLAYER_COLORS.length;
        const defaultName = type === 'ai' ? `AI ${opponents.filter(o => o.type === 'ai').length + 1}`
            : type === 'human_local' ? `Player ${opponents.filter(o => o.type === 'human_local').length + 2}`
                : 'Open Slot';

        setOpponents(prev => [...prev, {
            name: defaultName,
            deck: [],
            tokens: [],
            color: PLAYER_COLORS[colorIndex],
            type
        }]);
    };

    const removeOpponent = (index: number) => {
        setOpponents(prev => prev.filter((_, i) => i !== index));
    };

    const updateOpponentName = (index: number, name: string) => {
        setOpponents(prev => prev.map((o, i) => i === index ? { ...o, name } : o));
    };

    const updateOpponentDeck = (index: number, deck: SavedDeck) => {
        setOpponents(prev => prev.map((o, i) => i === index ? {
            ...o,
            deck: [...deck.deck],
            tokens: [...deck.tokens],
            name: o.name
        } : o));
    };

    const handleStart = () => {
        const validOpponents = opponents.map(o => ({
            ...o,
            deck: o.type !== 'ai' ? o.deck : (savedDecks.length > 0 ? [...savedDecks[0].deck] : []),
            tokens: o.type !== 'ai' ? o.tokens : (savedDecks.length > 0 ? [...savedDecks[0].tokens] : []),
        }));
        onStartGame(validOpponents, gameMode === 'local_table');
    };

    const opponentTypeIcon = (type: Opponent['type']) => {
        if (type === 'ai') return <Bot size={16} className="text-purple-400" />;
        if (type === 'human_local') return <User size={16} className="text-blue-400" />;
        return <Laptop size={16} className="text-green-400" />;
    };

    const opponentTypeLabel = (type: Opponent['type']) => {
        if (type === 'ai') return 'AI';
        if (type === 'human_local') return 'Local Player';
        return 'Open Slot (Online)';
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
                            <p className="text-gray-400 text-sm mt-1">Configure your opponents and table options</p>
                        </div>
                    </div>

                    {/* Game Mode */}
                    <div className="bg-gray-800/60 backdrop-blur-sm border border-gray-700 rounded-2xl p-6 mb-6 shadow-xl">
                        <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">Game Mode</h2>
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                onClick={() => setGameMode('solo')}
                                className={`p-4 rounded-xl border-2 text-left transition-all ${gameMode === 'solo'
                                    ? 'border-orange-500 bg-orange-500/10'
                                    : 'border-gray-600 bg-gray-900/50 hover:border-gray-500'}`}
                            >
                                <Users className={`mb-2 ${gameMode === 'solo' ? 'text-orange-400' : 'text-gray-400'}`} size={24} />
                                <div className="font-bold text-white">Solo Table</div>
                                <div className="text-xs text-gray-400 mt-1">Play against AI or pass-and-play locally</div>
                            </button>
                            <button
                                onClick={() => setGameMode('local_table')}
                                className={`p-4 rounded-xl border-2 text-left transition-all ${gameMode === 'local_table'
                                    ? 'border-blue-500 bg-blue-500/10'
                                    : 'border-gray-600 bg-gray-900/50 hover:border-gray-500'}`}
                            >
                                <Laptop className={`mb-2 ${gameMode === 'local_table' ? 'text-blue-400' : 'text-gray-400'}`} size={24} />
                                <div className="font-bold text-white">Local Table (Host)</div>
                                <div className="text-xs text-gray-400 mt-1">Generate a room code for others to join on their devices</div>
                            </button>
                        </div>
                    </div>

                    {/* Opponents */}
                    <div className="bg-gray-800/60 backdrop-blur-sm border border-gray-700 rounded-2xl p-6 mb-6 shadow-xl">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider">
                                Opponents ({opponents.length})
                            </h2>
                            <span className="text-xs text-gray-500">Max 5 opponents</span>
                        </div>

                        <div className="space-y-3 mb-4">
                            {opponents.map((opp, idx) => (
                                <div
                                    key={idx}
                                    className="flex items-center gap-3 bg-gray-900/60 rounded-xl p-3 border border-gray-700 group"
                                >
                                    {/* Color dot */}
                                    <div
                                        className="w-6 h-6 rounded-full border-2 border-white/20 flex-shrink-0"
                                        style={{ backgroundColor: opp.color }}
                                    />

                                    {/* Type icon + label */}
                                    <div className="flex items-center gap-1.5 flex-shrink-0">
                                        {opponentTypeIcon(opp.type)}
                                        <span className="text-xs text-gray-500 hidden sm:inline">
                                            {opponentTypeLabel(opp.type)}
                                        </span>
                                    </div>

                                    {/* Name input */}
                                    <input
                                        type="text"
                                        value={opp.name}
                                        onChange={e => updateOpponentName(idx, e.target.value)}
                                        className="flex-1 bg-transparent text-white font-semibold border-none outline-none text-sm placeholder:text-gray-600 min-w-0"
                                        placeholder="Name..."
                                    />

                                    {/* Deck selector (non-AI) */}
                                    {opp.type !== 'ai' && savedDecks.length > 0 && (
                                        <select
                                            className="bg-gray-800 border border-gray-600 text-gray-300 text-xs rounded-lg px-2 py-1 truncate max-w-[120px]"
                                            value={opp.deck.length > 0 ? '' : ''}
                                            onChange={e => {
                                                const deck = savedDecks.find(d => d.id === e.target.value);
                                                if (deck) updateOpponentDeck(idx, deck);
                                            }}
                                        >
                                            <option value="">Pick deck...</option>
                                            {savedDecks.map(d => (
                                                <option key={d.id} value={d.id}>{d.name}</option>
                                            ))}
                                        </select>
                                    )}

                                    {/* Commander badge for deck */}
                                    {opp.deck.length > 0 && (
                                        <div className="flex items-center gap-1 text-xs text-amber-400 flex-shrink-0">
                                            <Crown size={10} />
                                            <span className="hidden sm:inline truncate max-w-[60px]">
                                                {opp.deck.find(c => c.isCommander)?.name?.split(' ')[0] || 'Loaded'}
                                            </span>
                                        </div>
                                    )}

                                    {/* Remove button */}
                                    <button
                                        onClick={() => removeOpponent(idx)}
                                        className="p-1 text-gray-600 hover:text-red-400 transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100"
                                    >
                                        <X size={16} />
                                    </button>
                                </div>
                            ))}
                        </div>

                        {/* Add opponent buttons */}
                        {opponents.length < 5 && (
                            <div className="flex flex-wrap gap-2">
                                <button
                                    onClick={() => addOpponent('ai')}
                                    className="flex items-center gap-2 px-3 py-2 bg-purple-900/30 hover:bg-purple-900/50 border border-purple-700/50 text-purple-300 rounded-lg text-sm font-medium transition-colors"
                                >
                                    <Bot size={14} /> Add AI Opponent
                                </button>
                                <button
                                    onClick={() => addOpponent('human_local')}
                                    className="flex items-center gap-2 px-3 py-2 bg-blue-900/30 hover:bg-blue-900/50 border border-blue-700/50 text-blue-300 rounded-lg text-sm font-medium transition-colors"
                                >
                                    <User size={14} /> Add Local Player
                                </button>
                                {gameMode === 'local_table' && (
                                    <button
                                        onClick={() => addOpponent('open_slot')}
                                        className="flex items-center gap-2 px-3 py-2 bg-green-900/30 hover:bg-green-900/50 border border-green-700/50 text-green-300 rounded-lg text-sm font-medium transition-colors"
                                    >
                                        <Plus size={14} /> Add Open Slot
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Info box */}
                    {gameMode === 'local_table' && (
                        <div className="bg-blue-900/20 border border-blue-700/40 rounded-xl p-4 mb-6 text-sm text-blue-300">
                            <p className="font-semibold mb-1">Local Table Mode</p>
                            <p className="text-blue-400/80">A room code will be generated that other players can use to join from their own devices. You'll control the table as the host.</p>
                        </div>
                    )}

                    {/* Start button */}
                    <button
                        onClick={handleStart}
                        className="w-full py-4 bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-400 hover:to-red-500 text-white font-extrabold rounded-2xl shadow-xl shadow-orange-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-3 text-lg"
                    >
                        <Play size={22} />
                        Start Game
                    </button>
                </div>
            </div>
        </div>
    );
};

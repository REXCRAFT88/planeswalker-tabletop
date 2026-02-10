import React, { useState, useEffect, useRef } from 'react';
import { Shield, Play, Plus, Edit3, Layers, Search, X, Loader, Users, BookOpen, Save, Trash2, Check, Crown, Maximize } from 'lucide-react';
import { PLAYER_COLORS } from '../constants';
import { CardData } from '../types';
import { searchCards, parseDeckList, fetchBatch } from '../services/scryfall';
import { connectSocket } from '../services/socket';
import { SavedDeck } from '../App';

interface LobbyProps {
    playerName: string;
    setPlayerName: (name: string) => void;
    playerSleeve: string;
    setPlayerSleeve: (color: string) => void;
    onJoin: (code?: string, isStarted?: boolean, gameType?: string) => void;
    onLocalGame: () => void;
    onImportDeck: () => void;
    savedDeckCount: number;
    currentTokens: CardData[];
    activeDeck: CardData[];
    onTokensChange: (tokens: CardData[]) => void;
    savedDecks: SavedDeck[];
    onSaveDeck: (deck: SavedDeck) => void;
    onDeleteDeck: (id: string) => void;
    onLoadDeck: (deck: CardData[], tokens: CardData[], shouldSave?: boolean, name?: string) => void;
}

export const Lobby: React.FC<LobbyProps> = ({
    playerName, setPlayerName,
    playerSleeve, setPlayerSleeve,
    onJoin, onLocalGame, onImportDeck, savedDeckCount,
    currentTokens, onTokensChange, activeDeck,
    savedDecks, onSaveDeck, onDeleteDeck, onLoadDeck
}) => {
    const [isSearching, setIsSearching] = useState(false);
    const [importText, setImportText] = useState('');
    const [isImporting, setIsImporting] = useState(false);
    const [roomCode, setRoomCode] = useState('');
    const [isJoining, setIsJoining] = useState(false);
    const [joinStatus, setJoinStatus] = useState('');
    const [showReconnectModal, setShowReconnectModal] = useState(false);
    const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
    const hasAutoAttempted = useRef(false);

    // Library State
    const [isLibraryOpen, setIsLibraryOpen] = useState(false);
    const [editingDeck, setEditingDeck] = useState<SavedDeck | null>(null);
    const [isEditingTokens, setIsEditingTokens] = useState(false);
    const [tokenImportText, setTokenImportText] = useState('');
    const [isImportingTokens, setIsImportingTokens] = useState(false);
    const [tokenImportError, setTokenImportError] = useState<string | null>(null);

    // Auto-join if session exists
    useEffect(() => {
        const activeSession = sessionStorage.getItem('active_game_session');
        if (activeSession && playerName && savedDeckCount > 0 && !hasAutoAttempted.current) {
            // If there is a userId for this session, we can try to reconnect.
            if (getUserIdForRoom(activeSession)) {
                hasAutoAttempted.current = true;
                setPendingSessionId(activeSession);
                setShowReconnectModal(true);
            } else {
                // Stale session with no user ID, clear it.
                sessionStorage.removeItem('active_game_session');
            }
        }
    }, [playerName, savedDeckCount]);

    // Load tokens from local storage on mount
    useEffect(() => {
        const savedTokens = localStorage.getItem('planeswalker_tokens');
        if (savedTokens) {
            try {
                const parsed = JSON.parse(savedTokens);
                if (Array.isArray(parsed) && parsed.length > 0 && currentTokens.length === 0) {
                    onTokensChange(parsed);
                }
            } catch (e) { console.error("Failed to load tokens", e); }
        }
    }, []);

    // Save tokens to local storage when they change
    useEffect(() => {
        localStorage.setItem('planeswalker_tokens', JSON.stringify(currentTokens));
    }, [currentTokens]);

    const getUserIdForRoom = (room: string) => {
        return localStorage.getItem(`planeswalker_user_id_${room}`);
    };

    const handleTokenImport = async () => {
        setIsImportingTokens(true);
        setTokenImportError(null);
        const parsed = parseDeckList(tokenImportText);

        if (parsed.length === 0) {
            setTokenImportError("No cards found in list.");
            setIsImportingTokens(false);
            return;
        }

        const uniqueNames = parsed.map(p => p.name);

        try {
            // Here, we don't care about type, as any card can be a token.
            const cardMap = await fetchBatch(uniqueNames);
            const newTokens: CardData[] = [];
            for (const item of parsed) {
                let data = cardMap.get(item.name.toLowerCase());
                if (data) {
                    for (let i = 0; i < item.count; i++) {
                        newTokens.push({ ...data, id: crypto.randomUUID(), isToken: true });
                    }
                }
            }
            // Replace instead of append, to make it a manager
            onTokensChange(newTokens);
            setTokenImportText('');
            setIsEditingTokens(false);
        } catch (e) {
            console.error(e);
            setTokenImportError("Failed to load tokens from list.");
        } finally {
            setIsImportingTokens(false);
        }
    };

    const joinRoom = (code: string) => {
        if (savedDeckCount === 0) {
            alert("Please import a deck first!");
            return;
        }
        if (!playerName) {
            alert("Please enter a name!");
            return;
        }

        setIsJoining(true);
        setJoinStatus('Connecting...');
        const socket = connectSocket();

        socket.off('join_error');
        socket.off('join_pending');
        socket.off('join_success');

        const randomColor = PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];
        const userId = getUserIdForRoom(code);
        socket.emit('join_room', { room: code, name: playerName, color: randomColor, userId });

        socket.on('join_error', ({ message }) => {
            alert(message);
            setIsJoining(false);
            setJoinStatus('');
            socket.disconnect();
        });

        socket.on('join_pending', ({ message }) => {
            setJoinStatus(message);
        });

        socket.on('join_success', ({ room, isGameStarted, userId, gameType }) => {
            if (userId) {
                localStorage.setItem(`planeswalker_user_id_${room}`, userId);
            }
            setIsJoining(false);
            onJoin(room, isGameStarted, gameType);
        });
    };

    const handleReconnect = () => {
        if (pendingSessionId) {
            joinRoom(pendingSessionId);
            setShowReconnectModal(false);
        }
    };

    const handleNewSession = () => {
        if (pendingSessionId) {
            localStorage.removeItem(`planeswalker_user_id_${pendingSessionId}`);
        }
        sessionStorage.removeItem('active_game_session');
        setPendingSessionId(null);
        setShowReconnectModal(false);
    };

    const handleCreateRoom = () => {
        const code = Math.random().toString(36).substring(2, 6).toUpperCase();
        setRoomCode(code); // Ideally pass this up or store in URL
        joinRoom(code);
    };

    const handleLocalGame = () => {
        if (savedDeckCount === 0) {
            alert("Please import a deck first!");
            return;
        }

        // If no deck is active, load the most recent one.
        if (activeDeck.length === 0 && savedDecks.length > 0) {
            const mostRecentDeck = [...savedDecks].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
            onLoadDeck(mostRecentDeck.deck, mostRecentDeck.tokens);
        }

        onLocalGame();
    };

    const handleJoinRoom = () => {
        if (!roomCode) {
            alert("Please enter a room code");
            return;
        }
        joinRoom(roomCode);
    };

    const handleLoadDeck = (deck: SavedDeck) => {
        onLoadDeck([...deck.deck], [...deck.tokens]);
        setIsLibraryOpen(false);
    };

    // Since I missed adding `onLoadDeck` in App.tsx diff, I will add it now in the App.tsx diff above?
    // No, I can't go back. I will add it to the LobbyProps and assume App passes it.
    // Actually, I can just edit the App.tsx diff to include it.
    // Let's assume I will add `onLoadDeck` to LobbyProps and pass `handleDeckReady` from App.

    const toggleCommanderInEdit = (cardId: string) => {
        if (!editingDeck) return;
        const newCards = editingDeck.deck.map(c =>
            c.id === cardId ? { ...c, isCommander: !c.isCommander } : c
        );
        setEditingDeck({ ...editingDeck, deck: newCards });
    };

    const handleEditDeck = (deck: SavedDeck) => {
        // Load the deck first so it's active
        onLoadDeck(deck.deck, deck.tokens);
        // Then go to builder
        onImportDeck();
    };

    const handleCreateNewDeck = () => {
        // Clear current active deck if needed, or just go to builder
        onLoadDeck([], []);
        onImportDeck();
    };

    const toggleFullScreen = () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(e => console.log(e));
        } else {
            document.exitFullscreen();
        }
    };

    const activeCommander = activeDeck.find(c => c.isCommander) || activeDeck[0];

    return (
        <div className="w-full h-full overflow-y-auto relative pb-32">
            <div className="min-h-full flex flex-col items-center justify-center p-4 md:p-6 animate-in fade-in duration-700">
                <div className="w-full max-w-md">
                    <div className="absolute top-4 right-4">
                        <button onClick={toggleFullScreen} className="p-2 bg-gray-800 rounded-full text-white shadow-lg border border-gray-700">
                            <Maximize size={20} />
                        </button>
                    </div>
                    <div className="text-center mb-8">
                        {activeCommander ? (
                            <div className="w-32 h-44 mx-auto mb-4 rounded-xl shadow-2xl shadow-orange-500/20 rotate-3 border-2 border-orange-500/50 overflow-hidden">
                                <img src={activeCommander.imageUrl} className="w-full h-full object-cover" alt="Commander" />
                            </div>
                        ) : (
                            <div className="w-20 h-20 bg-gradient-to-br from-orange-500 to-red-600 rounded-2xl mx-auto mb-4 flex items-center justify-center shadow-lg shadow-orange-500/30 rotate-3"><Shield size={40} className="text-white" /></div>
                        )}
                        <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-orange-200 to-red-400 mb-2">
                            Planeswalker Tabletop
                        </h1>
                        <p className="text-gray-400">
                            The ultimate browser-based commander interface.
                        </p>
                    </div>

                    <div className="w-full space-y-4 bg-gray-800/50 backdrop-blur-sm p-6 rounded-2xl border border-gray-700 shadow-xl relative z-10">

                        {/* Name Input */}
                        <div>
                            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Player Name</label>
                            <div className="relative">
                                <UserIcon className="absolute left-3 top-3 text-gray-500" size={18} />
                                <input
                                    type="text"
                                    value={playerName}
                                    onChange={(e) => setPlayerName(e.target.value)}
                                    className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2.5 pl-10 text-white focus:ring-2 focus:ring-orange-500 focus:outline-none transition-all"
                                />
                            </div>
                        </div>

                        <div className="pt-4 border-t border-gray-700">

                            <div className="flex flex-col md:flex-row gap-4 mb-4">
                                <button
                                    onClick={handleLocalGame}
                                    className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 px-4 rounded-xl shadow-lg transition-transform active:scale-95 flex items-center justify-center gap-2"
                                >
                                    <Users size={20} /> Local Game
                                </button>
                                <button
                                    onClick={handleCreateRoom}
                                    disabled={isJoining}
                                    className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 px-4 rounded-xl shadow-lg transition-transform active:scale-95 flex items-center justify-center gap-2"
                                >
                                    {isJoining ? <Loader className="animate-spin" /> : <Play size={20} />}
                                    {isJoining ? (joinStatus || 'Joining...') : 'Create Online Table'}
                                </button>
                            </div>

                            <div className="flex items-center gap-3 mb-4">
                                <div className="h-px bg-gray-700 flex-1" />
                                <span className="text-gray-500 text-xs uppercase font-bold">OR</span>
                                <div className="h-px bg-gray-700 flex-1" />
                            </div>

                            {/* Join Existing Game */}
                            <div className="bg-gray-900 p-3 rounded-xl border border-gray-700 mb-4">
                                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Join Existing Table</label>
                                <div className="flex flex-col md:flex-row gap-2">
                                    <input
                                        type="text"
                                        placeholder="Room Code"
                                        value={roomCode}
                                        onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                                        className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 text-white focus:ring-2 focus:ring-blue-500 outline-none uppercase font-mono tracking-widest placeholder:normal-case placeholder:tracking-normal"
                                        maxLength={6}
                                    />
                                    <button
                                        onClick={handleJoinRoom}
                                        disabled={isJoining || !roomCode}
                                        className="bg-blue-600 hover:bg-blue-500 text-white px-4 rounded-lg font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        Join
                                    </button>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 gap-3">
                                <button
                                    onClick={() => setIsLibraryOpen(true)}
                                    className="flex items-center justify-center gap-3 p-4 bg-gray-900 hover:bg-gray-750 border border-gray-700 hover:border-purple-500 rounded-xl transition-all group"
                                >
                                    <BookOpen className="text-purple-500 group-hover:scale-110 transition-transform" size={18} />
                                    <span className="text-sm font-medium text-gray-300">Deck Library / Manage Decks</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Reconnect Modal */}
            {showReconnectModal && (
                <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
                    <div className="bg-gray-800 border border-gray-600 rounded-xl p-8 shadow-2xl max-w-md w-full text-center">
                        <h3 className="text-2xl font-bold text-white mb-4">Active Session Found</h3>
                        <p className="text-gray-300 mb-8">You were disconnected from a game. Do you want to reconnect?</p>
                        <div className="flex flex-col gap-3">
                            <button onClick={handleReconnect} className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold flex items-center justify-center gap-2">
                                <Play size={18} /> Reconnect
                            </button>
                            <button onClick={handleNewSession} className="w-full py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-bold flex items-center justify-center gap-2">
                                <Plus size={18} /> Start New Session
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Deck Library Modal */}
            {isLibraryOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
                    <div className="bg-gray-800 border border-gray-600 w-full max-w-4xl rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] h-[90vh] md:h-auto">
                        <div className="p-4 border-b border-gray-700 flex justify-between items-center bg-gray-900">
                            <h3 className="font-bold text-white flex items-center gap-2"><BookOpen className="text-purple-500" /> {isEditingTokens ? 'Manage Global Tokens' : 'Deck Library'}</h3>
                            <button onClick={() => { setIsLibraryOpen(false); setEditingDeck(null); setIsEditingTokens(false); }} className="text-gray-400 hover:text-white"><X size={20} /></button>
                        </div>

                        <div className="flex-1 overflow-y-auto flex flex-col min-h-0">
                            {isEditingTokens ? (
                                <div className="p-4 flex flex-col gap-4 h-full min-h-0 overflow-y-auto">
                                    <h4 className="text-sm font-bold text-gray-400">Paste Token List</h4>
                                    <textarea
                                        className="flex-1 w-full bg-gray-900 border border-gray-600 rounded-lg p-4 text-gray-200 font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none"
                                        placeholder={`1 Goblin\n2 Treasure\n1 Food...`}
                                        value={tokenImportText}
                                        onChange={(e) => setTokenImportText(e.target.value)}
                                        disabled={isImportingTokens}
                                    />
                                    {tokenImportError && <p className="text-red-400 text-xs">{tokenImportError}</p>}
                                    <div className="flex justify-end gap-4">
                                        <button onClick={() => setIsEditingTokens(false)} className="text-gray-400 hover:text-white">Cancel</button>
                                        <button onClick={handleTokenImport} disabled={isImportingTokens} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold flex items-center gap-2 disabled:opacity-50">
                                            {isImportingTokens ? <Loader className="animate-spin" size={16} /> : <Check size={16} />}
                                            {isImportingTokens ? 'Loading...' : 'Save Tokens'}
                                        </button>
                                    </div>
                                </div>
                            ) : !editingDeck ? (
                                <div className="p-4 overflow-y-auto custom-scrollbar grid grid-cols-1 md:grid-cols-2 gap-4 pb-8">
                                    <div className="col-span-full flex flex-col md:flex-row gap-2">
                                        <button onClick={handleCreateNewDeck} className="flex-1 flex items-center justify-center gap-2 p-4 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold shadow-lg transition-transform active:scale-95">
                                            <Plus size={20} /> Create New Deck
                                        </button>
                                        <button onClick={() => setIsEditingTokens(true)} className="flex-1 flex items-center justify-center gap-2 p-4 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-bold shadow-lg transition-transform active:scale-95">
                                            <Layers size={20} /> Manage Global Tokens
                                        </button>
                                    </div>

                                    {savedDecks.map(deck => {
                                        const commander = deck.deck.find(c => c.isCommander) || deck.deck[0];
                                        return (
                                            <div key={deck.id} className="bg-gray-700/50 border border-gray-600 rounded-xl p-4 flex flex-col sm:flex-row gap-4 hover:border-gray-500 transition group relative overflow-hidden">
                                                <div className="w-20 h-28 bg-black rounded mx-auto sm:mx-0 overflow-hidden flex-shrink-0 relative">
                                                    {commander ? <img src={commander.imageUrl} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-gray-800" />}
                                                    {deck.deck.some(c => c.isCommander) && <div className="absolute top-0 right-0 bg-amber-500 p-0.5 rounded-bl"><Crown size={8} className="text-black" /></div>}
                                                </div>
                                                <div className="flex-1 min-w-0 text-center sm:text-left">
                                                    <h4 className="font-bold text-white truncate">{deck.name}</h4>
                                                    <p className="text-xs text-gray-400 mb-2">{deck.deck.length} cards • {deck.tokens.length} tokens</p>
                                                    <div className="flex gap-2 flex-wrap justify-center sm:justify-start">
                                                        <button onClick={() => handleLoadDeck(deck)} className="px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white text-xs font-bold rounded flex items-center gap-1">
                                                            <Play size={12} /> Load
                                                        </button>
                                                        <button onClick={() => handleEditDeck(deck)} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded flex items-center gap-1">
                                                            <Edit3 size={12} /> Edit
                                                        </button>
                                                        <button onClick={() => onDeleteDeck(deck.id)} className="px-3 py-1.5 bg-red-900/50 hover:bg-red-900 text-red-200 text-xs font-bold rounded flex items-center gap-1">
                                                            <Trash2 size={12} /> Delete
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                    {savedDecks.length === 0 && <div className="col-span-full text-center text-gray-500 py-10">No saved decks found.</div>}
                                </div>
                            ) : (
                                <div className="flex flex-col h-full">
                                    <div className="p-4 border-b border-gray-700 flex gap-4 items-center bg-gray-800">
                                        <button onClick={() => setEditingDeck(null)} className="text-gray-400 hover:text-white"><X /></button>
                                        <input
                                            className="bg-gray-900 border border-gray-600 rounded px-3 py-1 text-white font-bold flex-1"
                                            value={editingDeck.name}
                                            onChange={e => setEditingDeck({ ...editingDeck, name: e.target.value })}
                                        />
                                        <button onClick={() => { onSaveDeck(editingDeck); setEditingDeck(null); }} className="bg-green-600 hover:bg-green-500 text-white px-4 py-1 rounded font-bold flex items-center gap-2">
                                            <Save size={16} /> Save Changes
                                        </button>
                                    </div>
                                    <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
                                        <div className="flex-1 overflow-y-auto p-4 border-r border-gray-700 min-h-0">
                                            <h4 className="text-xs font-bold text-gray-400 uppercase mb-2">Cards (Click to set Commander)</h4>
                                            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                                                {editingDeck.deck.map(card => (
                                                    <div
                                                        key={card.id}
                                                        onClick={() => toggleCommanderInEdit(card.id)}
                                                        className={`relative aspect-[2.5/3.5] rounded cursor-pointer border-2 ${card.isCommander ? 'border-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]' : 'border-transparent hover:border-gray-500'}`}
                                                    >
                                                        <img src={card.imageUrl} className="w-full h-full object-cover rounded-sm" />
                                                        {card.isCommander && <div className="absolute top-1 right-1 bg-amber-500 text-black p-0.5 rounded-full"><Crown size={10} /></div>}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="w-full md:w-1/3 p-4 overflow-y-auto bg-gray-900/50 min-h-[150px]">
                                            <h4 className="text-xs font-bold text-gray-400 uppercase mb-2 flex flex-col gap-2">
                                                <span>Tokens ({editingDeck.tokens.length})</span>
                                                <div className="text-[10px] text-gray-500 font-normal">
                                                    To add tokens, please use the "Edit" button in the library to open the Deck Builder, where you can add tokens in the final step.
                                                </div>
                                                <button onClick={() => setEditingDeck({ ...editingDeck, tokens: [] })} className="text-red-400 text-[10px] self-start hover:underline">
                                                    Clear All Tokens
                                                </button>
                                            </h4>
                                            <div className="space-y-2">
                                                {editingDeck.tokens.map(token => (
                                                    <div key={token.id} className="flex items-center gap-2 bg-gray-800 p-2 rounded border border-gray-700">
                                                        <img src={token.imageUrl} className="w-8 h-11 rounded object-cover" />
                                                        <span className="text-xs text-gray-300 truncate flex-1">{token.name}</span>
                                                        <button onClick={() => setEditingDeck({ ...editingDeck, tokens: editingDeck.tokens.filter(t => t.id !== token.id) })} className="text-red-400 hover:text-red-300"><X size={14} /></button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const UserIcon = ({ className, size }: { className?: string, size?: number }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
    >
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
        <circle cx="12" cy="7" r="4"></circle>
    </svg>
);
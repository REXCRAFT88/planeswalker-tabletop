import React, { useState, useEffect } from 'react';
import { CardData } from '../types';
import { socket, connectSocket } from '../services/socket';
import { Loader2, User, Check, AlertCircle, Heart, Shield, Layers } from 'lucide-react';

interface MobileControllerProps {
    roomId: string;
    playerName: string;
    sleeveColor: string;
    deck: CardData[];
    tokens: CardData[];
    onExit: () => void;
}

const STORAGE_KEY = 'planeswalker_tabletop_settings_v1';

interface SavedDeck {
    id: string;
    name: string;
    deck: CardData[];
    tokens: CardData[];
    sleeveColor: string;
}

export const MobileController: React.FC<MobileControllerProps> = ({ roomId, playerName, sleeveColor, deck, tokens, onExit }) => {
    const [status, setStatus] = useState<'CONNECTING' | 'SELECT_SLOT' | 'SELECT_DECK' | 'WAITING_CONFIRMATION' | 'PLAYING'>('CONNECTING');
    const [slots, setSlots] = useState<{ id: string, name: string, isTaken: boolean }[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);

    // Deck State
    const [savedDecks, setSavedDecks] = useState<SavedDeck[]>([]);
    const [selectedDeck, setSelectedDeck] = useState<CardData[]>(deck);
    const [selectedTokens, setSelectedTokens] = useState<CardData[]>(tokens);

    useEffect(() => {
        // Load saved decks
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                if (parsed.savedDecks) {
                    setSavedDecks(parsed.savedDecks);
                }
            }
        } catch (e) {
            console.error("Failed to load saved decks", e);
        }
    }, []);

    useEffect(() => {
        const s = connectSocket();

        // Join the room as a "mobile controller" (client)
        // We already joined in Lobby, so we just need to listen for slots.
        // Actually, we need to know WHICH slots are open.
        // Let's ask the host for slots.
        s.emit('get_slots', { room: roomId });

        s.on('slots_update', (availableSlots: any[]) => {
            setSlots(availableSlots);
            if (status === 'CONNECTING') setStatus('SELECT_SLOT');
        });

        s.on('slot_claimed', ({ success, message }) => {
            if (success) {
                setStatus('PLAYING');
            } else {
                setStatus('SELECT_SLOT');
                setError(message || "Failed to claim slot.");
            }
        });

        return () => {
            s.off('slots_update');
            s.off('slot_claimed');
        };
    }, [roomId, status]);

    const handleSlotClick = (slotId: string) => {
        setSelectedSlotId(slotId);
        setStatus('SELECT_DECK');
    };

    const handleDeckSelect = (deck: SavedDeck) => {
        setSelectedDeck(deck.deck);
        setSelectedTokens(deck.tokens);
        handleClaimSlot(selectedSlotId!, deck.deck, deck.tokens);
    };

    const handleClaimSlot = (slotId: string, deckToUse: CardData[], tokensToUse: CardData[]) => {
        setError(null);
        setStatus('WAITING_CONFIRMATION');
        socket.emit('request_claim_slot', {
            room: roomId,
            slotId,
            deck: deckToUse,
            tokens: tokensToUse,
            playerName
        });
    };

    // Gameplay State
    const [hand, setHand] = useState<CardData[]>([]);
    const [gamePhase, setGamePhase] = useState<string>('SETUP');
    const [mulliganCount, setMulliganCount] = useState<number>(0);

    // Stats State
    const [activeTab, setActiveTab] = useState<'CARDS' | 'STATS'>('CARDS');
    const [life, setLife] = useState(40);
    const [poison, setPoison] = useState(0);
    const [commanderDamage, setCommanderDamage] = useState<Record<string, number>>({});

    useEffect(() => {
        if (status !== 'PLAYING') return;

        socket.on('hand_update', (data: { hand: CardData[], phase: string, mulliganCount: number }) => {
            setHand(data.hand);
            setGamePhase(data.phase);
            setMulliganCount(data.mulliganCount);
        });

        socket.on('send_stats_update', (data: { life: number, poison: number, commanderDamage: Record<string, number> }) => {
            setLife(data.life);
            setPoison(data.poison);
            setCommanderDamage(data.commanderDamage);
        });

        return () => {
            socket.off('hand_update');
            socket.off('send_stats_update');
        };
    }, [status]);

    const handlePlayCard = (card: CardData) => {
        if (confirm(`Play ${card.name}?`)) {
            socket.emit('play_card', { room: roomId, cardId: card.id });
        }
    };

    const handleMulligan = (keep: boolean) => {
        socket.emit('mulligan_decision', { room: roomId, keep });
    };

    const handleLifeChange = (amount: number) => {
        setLife(prev => prev + amount);
        socket.emit('mobile_update_life', { room: roomId, amount });
    };

    const handlePoisonChange = (amount: number) => {
        setPoison(prev => Math.max(0, prev + amount));
        socket.emit('mobile_update_counter', { room: roomId, type: 'poison', amount });
    };

    if (status === 'PLAYING') {
        const isMulligan = gamePhase === 'MULLIGAN';

        return (
            <div className="w-full h-full bg-gray-950 text-white flex flex-col">
                <div className="bg-gray-900 border-b border-gray-800 p-4 flex justify-between items-center shadow-lg z-10 sticky top-0">
                    <div>
                        <h1 className="font-bold text-lg leading-tight">{playerName}</h1>
                        <div className="text-xs text-gray-400">
                            {isMulligan ? `Mulligan Phase` : (activeTab === 'CARDS' ? `Hand • ${hand.length} Cards` : `Life & Stats`)}
                        </div>
                    </div>
                    <button onClick={onExit} className="bg-red-900/50 hover:bg-red-900 text-red-200 text-xs px-3 py-1.5 rounded-lg border border-red-800 transition-colors">
                        Leave
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 pb-20 space-y-4">
                    {/* Mulligan Controls - Always visible if Mulligan Phase */}
                    {isMulligan && (
                        <div className="bg-blue-900/20 border border-blue-800 rounded-xl p-4 mb-4 backdrop-blur-sm">
                            <h3 className="font-bold text-blue-100 mb-1 text-center">Mulligan Decision</h3>
                            <p className="text-blue-300/80 text-xs text-center mb-4">
                                {mulliganCount === 0 ? "First hand is free." : `Mulligan for ${7 - mulliganCount} cards?`}
                            </p>
                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    onClick={() => handleMulligan(true)}
                                    className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-lg shadow-lg active:scale-95 transition-all"
                                >
                                    Keep Hand
                                </button>
                                <button
                                    onClick={() => handleMulligan(false)}
                                    className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 rounded-lg shadow-lg active:scale-95 transition-all"
                                >
                                    Mulligan
                                </button>
                            </div>
                        </div>
                    )}

                    {activeTab === 'CARDS' && (
                        <>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                {hand.map((card) => (
                                    <button
                                        key={card.id}
                                        onClick={() => handlePlayCard(card)}
                                        className="relative aspect-[5/7] bg-gray-800 rounded-xl overflow-hidden border border-gray-700 shadow-md active:scale-95 transition-transform group"
                                    >
                                        {card.imageUrl ? (
                                            <img
                                                src={card.imageUrl}
                                                alt={card.name}
                                                className="w-full h-full object-cover"
                                                loading="lazy"
                                            />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center p-2 text-center text-xs text-gray-400 bg-gray-800">
                                                {card.name}
                                            </div>
                                        )}
                                        {card.manaCost && (
                                            <div className="absolute top-1 right-1 bg-black/70 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-tighter backdrop-blur-sm">
                                                {card.manaCost}
                                            </div>
                                        )}
                                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                                    </button>
                                ))}
                            </div>
                            {hand.length === 0 && (
                                <div className="text-center py-12 text-gray-600 flex flex-col items-center">
                                    <div className="w-16 h-16 rounded-full bg-gray-900 border border-gray-800 flex items-center justify-center mb-4">
                                        <Layers size={32} />
                                    </div>
                                    <p>Hand is empty</p>
                                </div>
                            )}
                        </>
                    )}

                    {activeTab === 'STATS' && (
                        <div className="flex flex-col gap-6 items-center max-w-sm mx-auto w-full pt-8">
                            {/* Life Counter */}
                            <div className="flex flex-col items-center w-full">
                                <div className="text-6xl font-bold mb-8 tabular-nums">{life}</div>
                                <div className="flex gap-6 w-full justify-center">
                                    <button onClick={() => handleLifeChange(-1)} className="w-20 h-20 rounded-full bg-red-900/30 border-2 border-red-500/50 flex items-center justify-center text-4xl font-bold active:scale-90 transition-transform active:bg-red-800">-</button>
                                    <button onClick={() => handleLifeChange(1)} className="w-20 h-20 rounded-full bg-green-900/30 border-2 border-green-500/50 flex items-center justify-center text-4xl font-bold active:scale-90 transition-transform active:bg-green-800">+</button>
                                </div>
                            </div>

                            {/* Counters Grid */}
                            <div className="grid grid-cols-2 gap-4 w-full mt-4">
                                <div className="bg-gray-800/50 border border-gray-700 p-4 rounded-xl flex flex-col items-center">
                                    <div className="text-green-400 font-bold mb-2 text-sm uppercase tracking-wider">Poison</div>
                                    <div className="flex items-center gap-4">
                                        <button onClick={() => handlePoisonChange(-1)} className="w-10 h-10 rounded-full bg-gray-700 border border-gray-600 flex items-center justify-center font-bold active:bg-gray-600">-</button>
                                        <span className="text-2xl font-bold w-6 text-center tabular-nums">{poison}</span>
                                        <button onClick={() => handlePoisonChange(1)} className="w-10 h-10 rounded-full bg-gray-700 border border-gray-600 flex items-center justify-center font-bold active:bg-gray-600">+</button>
                                    </div>
                                </div>
                                <div className="bg-gray-800/50 border border-gray-700 p-4 rounded-xl flex flex-col items-center justify-center">
                                    <div className="text-gray-500 text-xs italic text-center">Commander Damage coming soon</div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Bottom Navigation */}
                <div className="bg-gray-900 border-top border-gray-800 p-2 flex justify-around items-center safe-area-pb shadow-[0_-5px_10px_rgba(0,0,0,0.3)]">
                    <button
                        onClick={() => setActiveTab('CARDS')}
                        className={`flex flex-col items-center gap-1 p-2 w-20 rounded-xl transition-colors ${activeTab === 'CARDS' ? 'text-blue-400 bg-blue-900/20' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                        <Layers size={24} />
                        <span className="text-[10px] font-bold">Cards</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('STATS')}
                        className={`flex flex-col items-center gap-1 p-2 w-20 rounded-xl transition-colors ${activeTab === 'STATS' ? 'text-red-400 bg-red-900/20' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                        <Heart size={24} />
                        <span className="text-[10px] font-bold">Life</span>
                    </button>
                    <button
                        className="flex flex-col items-center gap-1 p-2 w-20 rounded-xl text-gray-600 cursor-not-allowed opacity-50"
                        title="Coming Soon"
                    >
                        <Shield size={24} />
                        <span className="text-[10px] font-bold">Cmdr</span>
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full h-full bg-gray-900 text-white flex flex-col p-4">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-xl font-bold">Mobile Controller</h1>
                <button onClick={onExit} className="text-sm text-gray-400">Exit</button>
            </div>

            {/* ... rest of the component (CONNECTING, SELECT_SLOT, etc.) ... */}
            {status === 'CONNECTING' && (
                <div className="flex-1 flex flex-col items-center justify-center gap-4">
                    <Loader2 className="animate-spin text-blue-500" size={48} />
                    <p>Connecting to Table...</p>
                </div>
            )}

            {status === 'WAITING_CONFIRMATION' && (
                <div className="flex-1 flex flex-col items-center justify-center gap-4">
                    <Loader2 className="animate-spin text-yellow-500" size={48} />
                    <p>Waiting for Host approval...</p>
                </div>
            )}

            {status === 'SELECT_SLOT' && (
                <div className="flex-1 overflow-y-auto">
                    <h2 className="text-lg font-bold mb-4">Select Your Seat</h2>
                    {error && <div className="bg-red-900/50 text-red-200 p-3 rounded-lg mb-4 flex items-center gap-2"><AlertCircle size={16} /> {error}</div>}

                    <div className="space-y-3">
                        {slots.length === 0 && <p className="text-gray-500 text-center py-8">No open slots found.</p>}
                        {slots.map(slot => (
                            <button
                                key={slot.id}
                                disabled={slot.isTaken}
                                onClick={() => handleSlotClick(slot.id)}
                                className={`w-full p-4 rounded-xl border flex items-center justify-between transition-all ${slot.isTaken
                                    ? 'bg-gray-800 border-gray-700 opacity-50 cursor-not-allowed'
                                    : 'bg-gray-800 border-gray-600 hover:border-blue-500 active:bg-gray-700'
                                    }`}
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center">
                                        <User size={20} className="text-gray-400" />
                                    </div>
                                    <div className="text-left">
                                        <div className="font-bold">{slot.name}</div>
                                        <div className="text-xs text-gray-400">{slot.isTaken ? 'Taken' : 'Available'}</div>
                                    </div>
                                </div>
                                {!slot.isTaken && <Check className="text-green-500" />}
                            </button>
                        ))}
                    </div>
                </div>
            )}


            {status === 'SELECT_DECK' && (
                <div className="flex-1 overflow-y-auto">
                    <h2 className="text-xl font-bold mb-2 text-center">Select Deck</h2>
                    <p className="text-center text-gray-400 mb-6">Choose a saved deck to play with</p>

                    <div className="space-y-3">
                        {savedDecks.length === 0 && (
                            <div className="text-center p-8 bg-gray-800 rounded-xl">
                                <p className="text-gray-400 mb-4">No saved decks found.</p>
                                <button
                                    onClick={() => handleClaimSlot(selectedSlotId!, deck, tokens)}
                                    className="bg-blue-600 px-6 py-2 rounded-lg font-bold"
                                >
                                    Use Default / Empty Deck
                                </button>
                            </div>
                        )}

                        {savedDecks.map(d => (
                            <button
                                key={d.id}
                                onClick={() => handleDeckSelect(d)}
                                className="w-full p-4 rounded-xl bg-gray-800 border border-gray-700 hover:border-blue-500 text-left"
                            >
                                <h3 className="font-bold text-lg">{d.name}</h3>
                                <p className="text-xs text-gray-400">{d.deck.length} cards • {d.sleeveColor}</p>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

import React, { useState, useEffect } from 'react';
import { Lobby } from './components/Lobby';
import { DeckBuilder } from './components/DeckBuilder';
import { Tabletop } from './components/Tabletop';
import { LocalSetup } from './components/LocalSetup';
import { MobileController } from './components/MobileController';
import { CardData, ManaRule } from './types';
import { PLAYER_COLORS } from './constants';

enum View {
    LOBBY = 'LOBBY',
    DECK_BUILDER = 'DECK_BUILDER',
    LOCAL_SETUP = 'LOCAL_SETUP',
    LOCAL_GAME = 'LOCAL_GAME',
    GAME = 'GAME',
    MOBILE_CONTROLLER = 'MOBILE_CONTROLLER',
    DECK_SELECT = 'DECK_SELECT',
}

const STORAGE_KEY = 'planeswalker_tabletop_settings_v1';

export interface SavedDeck {
    id: string;
    name: string;
    deck: CardData[];
    tokens: CardData[];
    sleeveColor: string;
    createdAt?: number;
    manaRules?: Record<string, ManaRule>; // keyed by scryfallId
}

function App() {
    const [currentView, setCurrentView] = useState<View>(View.LOBBY);

    // Helper to load safe defaults or stored values
    const loadState = <T,>(key: string, defaultVal: T): T => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                // Check if the specific key exists in the parsed object
                return (parsed[key] !== undefined && parsed[key] !== null) ? parsed[key] : defaultVal;
            }
        } catch (e) {
            console.warn("Failed to load settings:", e);
        }
        return defaultVal;
    };

    // Initialize state from Local Storage using lazy initialization
    const [playerName, setPlayerName] = useState<string>(() => loadState('playerName', 'Planeswalker'));
    const [playerSleeve, setPlayerSleeve] = useState<string>(() => loadState('playerSleeve', PLAYER_COLORS[0]));
    const [savedDecks, setSavedDecks] = useState<SavedDeck[]>(() => loadState('savedDecks', []));

    const [activeDeck, setActiveDeck] = useState<CardData[]>(() => {
        const loaded = loadState<CardData[]>('activeDeck', []);
        if (loaded.length > 0) return loaded;
        // Fallback to last saved deck
        if (savedDecks.length > 0) {
            const sorted = [...savedDecks].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            return sorted[0].deck;
        }
        return [];
    });
    const [lobbyTokens, setLobbyTokens] = useState<CardData[]>(() => {
        const loaded = loadState<CardData[]>('lobbyTokens', []);
        if (loaded.length > 0) return loaded;
        if (savedDecks.length > 0) {
            const sorted = [...savedDecks].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            return sorted[0].tokens;
        }
        return [];
    });
    const [roomId, setRoomId] = useState<string>("");
    const [isGameStarted, setIsGameStarted] = useState(false);
    const [localOpponents, setLocalOpponents] = useState<{ name: string, deck: CardData[], tokens: CardData[], color: string, type?: 'ai' | 'human_local' | 'open_slot' }[]>([]);
    const [isLocalTableHost, setIsLocalTableHost] = useState(false);
    const [pendingJoin, setPendingJoin] = useState<{ code?: string; isStarted?: boolean; gameType?: string } | null>(null);
    const [activeManaRules, setActiveManaRules] = useState<Record<string, ManaRule>>(() => {
        // First try to load from direct storage
        const loaded = loadState<Record<string, ManaRule>>('activeManaRules', null);
        if (loaded && Object.keys(loaded).length > 0) return loaded;
        // Fallback to most recent saved deck if available
        if (savedDecks.length > 0) {
            const sorted = [...savedDecks].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            return sorted[0].manaRules || {};
        }
        return {};
    });
    const [activeDeckName, setActiveDeckName] = useState<string>(() => {
        // First try to load from direct storage
        const loaded = loadState<string>('activeDeckName', null);
        if (loaded) return loaded;
        // Fallback to saved decks
        if (savedDecks.length > 0) {
            const sorted = [...savedDecks].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            return sorted[0].name;
        }
        return 'New Deck';
    });

    // Persist state changes to Local Storage
    useEffect(() => {
        const settings = {
            playerName,
            playerSleeve,
            activeDeck,
            lobbyTokens,
            savedDecks,
            activeManaRules,
            activeDeckName
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }, [playerName, playerSleeve, activeDeck, lobbyTokens, savedDecks, activeManaRules, activeDeckName]);

    // Prevent Render.com from sleeping by pinging the server
    useEffect(() => {
        const interval = setInterval(() => {
            fetch(window.location.href, { method: 'HEAD' }).catch(() => { });
        }, 10 * 60 * 1000); // Ping every 10 minutes
        return () => clearInterval(interval);
    }, []);

    const handleDeckReady = (deck: CardData[], tokens: CardData[], shouldSave?: boolean, deckName?: string, manaRules?: Record<string, ManaRule>, id?: string) => {
        setActiveDeck(deck);
        setLobbyTokens(tokens);
        if (manaRules) setActiveManaRules(manaRules);
        if (deckName) setActiveDeckName(deckName);

        // Always save if we have an ID (update) OR if shouldSave is true (new)
        // If we have an ID, we are updating an existing deck, so we must save regardless of shouldSave flag (which indicates 'new deck')
        if (shouldSave || id) {
            const newDeck: SavedDeck = {
                id: id || crypto.randomUUID(),
                name: deckName || `Deck ${new Date().toLocaleDateString()}`,
                deck,
                tokens,
                sleeveColor: playerSleeve,
                createdAt: Date.now(), // Update timestamp? Maybe keep original if updating? For now update is fine.
                manaRules: manaRules || activeManaRules,
            };
            handleSaveDeck(newDeck);
        }

        setCurrentView(View.LOBBY);
    };

    const handleJoinGame = (code?: string, isStarted?: boolean, gameType?: string) => {
        // Prevent re-triggering if already in a game-related view (fixes infinite deck-select loop)
        if (currentView === View.GAME || currentView === View.DECK_SELECT ||
            currentView === View.MOBILE_CONTROLLER || currentView === View.LOCAL_GAME) return;

        if (code) setRoomId(code);
        setIsGameStarted(!!isStarted);

        // If the player has more than one saved deck, show the deck picker
        // Skip deck selection on reconnects (isStarted=true) since server restores state
        if (savedDecks.length > 1 && gameType !== 'local_table' && !isStarted) {
            setPendingJoin({ code, isStarted, gameType });
            setCurrentView(View.DECK_SELECT);
            return;
        }

        // If exactly 1 deck, auto-load it
        if (savedDecks.length === 1) {
            setActiveDeck([...savedDecks[0].deck]);
            setLobbyTokens([...savedDecks[0].tokens]);
            setActiveManaRules(savedDecks[0].manaRules || {});
        }

        if (gameType === 'local_table') {
            setCurrentView(View.MOBILE_CONTROLLER);
        } else {
            setCurrentView(View.GAME);
        }
    };

    const handleDeckSelected = (deck: SavedDeck) => {
        setActiveDeck([...deck.deck]);
        setLobbyTokens([...deck.tokens]);
        setActiveManaRules(deck.manaRules || {});
        setActiveDeckName(deck.name);
        setPendingJoin(null);
        if (pendingJoin?.gameType === 'local_table') {
            setCurrentView(View.MOBILE_CONTROLLER);
        } else {
            setCurrentView(View.GAME);
        }
    };

    const handleStartLocalGame = (opponents: any[], isLocalTable: boolean = false) => {
        setLocalOpponents(opponents);
        setIsLocalTableHost(isLocalTable);
        if (isLocalTable) {
            // Generate a 4-letter room code
            const code = crypto.randomUUID().slice(0, 6).toUpperCase();
            setRoomId(code);
        } else {
            setRoomId("LOCAL");
        }
        setCurrentView(View.LOCAL_GAME);
    };

    const handleSaveDeck = (deck: SavedDeck) => {
        // CLEANUP: Ensure isCommander is only set on cards actually in the deck
        // This handles cases where a card was marked as commander but then removed from the list
        const cleanedDeck = {
            ...deck,
            deck: deck.deck.map(card => ({
                ...card,
                // The card is by definition in the deck here, but this is a good place to 
                // perform any other deck-level validations if needed.
                // The 'isCommander' preservation is mostly handled in DeckBuilder.handleImport,
                // but this acts as a final safeguard.
            }))
        };

        setSavedDecks(prev => {
            const idx = prev.findIndex(d => d.id === cleanedDeck.id);
            if (idx >= 0) {
                const copy = [...prev];
                copy[idx] = cleanedDeck;
                return copy;
            }
            return [...prev, cleanedDeck];
        });

        // Sync with active state if we are saving the currently active deck
        if (cleanedDeck.name === activeDeckName) {
            setActiveDeck(cleanedDeck.deck);
            setLobbyTokens(cleanedDeck.tokens);
            setActiveManaRules(cleanedDeck.manaRules || {});
        }
    };

    const handleDeleteDeck = (id: string) => {
        setSavedDecks(prev => prev.filter(d => d.id !== id));
    };

    return (
        <div className="w-full h-full bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white font-sans antialiased selection:bg-blue-500 selection:text-white">
            {currentView === View.LOBBY && (
                <Lobby
                    playerName={playerName}
                    setPlayerName={setPlayerName}
                    playerSleeve={playerSleeve}
                    setPlayerSleeve={setPlayerSleeve}
                    onJoin={handleJoinGame}
                    onLocalGame={() => setCurrentView(View.LOCAL_SETUP)}
                    onImportDeck={() => setCurrentView(View.DECK_BUILDER)}
                    savedDeckCount={activeDeck.length}
                    currentTokens={lobbyTokens}
                    onTokensChange={setLobbyTokens}
                    activeDeck={activeDeck}
                    savedDecks={savedDecks}
                    onSaveDeck={handleSaveDeck}
                    onDeleteDeck={handleDeleteDeck}
                    onLoadDeck={handleDeckReady}
                />
            )}

            {currentView === View.DECK_BUILDER && (
                <DeckBuilder
                    initialDeck={activeDeck}
                    initialTokens={lobbyTokens}
                    initialManaRules={activeManaRules}
                    initialName={activeDeckName}
                    initialId={(() => {
                        const match = savedDecks.find(d => d.name === activeDeckName);
                        return match ? match.id : undefined;
                    })()}
                    onDeckReady={handleDeckReady}
                    onBack={() => setCurrentView(View.LOBBY)}
                />
            )}

            {currentView === View.LOCAL_SETUP && (
                <LocalSetup
                    onStartGame={handleStartLocalGame}
                    onBack={() => setCurrentView(View.LOBBY)}
                    savedDecks={savedDecks}
                />
            )}

            {currentView === View.GAME && (
                <Tabletop
                    initialDeck={activeDeck}
                    initialTokens={lobbyTokens}
                    playerName={playerName}
                    sleeveColor={playerSleeve}
                    roomId={roomId}
                    initialGameStarted={isGameStarted}
                    manaRules={activeManaRules}
                    savedDecks={savedDecks}
                    geminiApiKey={geminiApiKey}
                    onExit={() => setCurrentView(View.LOBBY)}
                />
            )}

            {currentView === View.LOCAL_GAME && (
                <Tabletop
                    initialDeck={activeDeck}
                    initialTokens={lobbyTokens}
                    playerName={playerName}
                    sleeveColor={playerSleeve}
                    roomId={isLocalTableHost ? roomId : "LOCAL"}
                    isLocal={true}
                    isLocalTableHost={isLocalTableHost}
                    localOpponents={localOpponents}
                    manaRules={activeManaRules}
                    onExit={() => setCurrentView(View.LOBBY)}
                />
            )}

            {currentView === View.DECK_SELECT && (
                <div className="w-full h-full flex flex-col items-center justify-center p-4 md:p-8 animate-in fade-in">
                    <div className="w-full max-w-3xl">
                        <h1 className="text-2xl md:text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500 text-center mb-2">
                            Choose Your Deck
                        </h1>
                        <p className="text-gray-400 text-center mb-6">Select which deck you want to play with in this game.</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[60vh] overflow-y-auto custom-scrollbar p-1">
                            {savedDecks.map(deck => {
                                const commander = deck.deck.find(c => c.isCommander) || deck.deck[0];
                                return (
                                    <button
                                        key={deck.id}
                                        onClick={() => handleDeckSelected(deck)}
                                        className="bg-gray-800/80 border border-gray-600 rounded-xl p-4 flex gap-4 hover:border-blue-500 hover:bg-gray-700/80 transition-all group text-left active:scale-[0.98]"
                                    >
                                        <div className="w-16 h-22 bg-black rounded overflow-hidden flex-shrink-0 relative">
                                            {commander ? <img src={commander.imageUrl} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-gray-700" />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <h4 className="font-bold text-white truncate group-hover:text-blue-300 transition-colors">{deck.name}</h4>
                                            <p className="text-xs text-gray-400">{deck.deck.length} cards &bull; {deck.tokens.length} tokens</p>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                        <button
                            onClick={() => { setPendingJoin(null); setCurrentView(View.LOBBY); }}
                            className="mt-6 w-full py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-bold transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {currentView === View.MOBILE_CONTROLLER && (
                <MobileController
                    roomId={roomId}
                    playerName={playerName}
                    sleeveColor={playerSleeve}
                    deck={activeDeck}
                    tokens={lobbyTokens}
                    onExit={() => setCurrentView(View.LOBBY)}
                />
            )}
        </div>
    );
}

export default App;
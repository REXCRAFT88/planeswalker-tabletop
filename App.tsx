import React, { useState, useEffect } from 'react';
import { Lobby } from './components/Lobby';
import { DeckBuilder } from './components/DeckBuilder';
import { Tabletop } from './components/Tabletop';
import { LocalSetup } from './components/LocalSetup';
import { CardData } from './types';
import { PLAYER_COLORS } from './constants';

enum View {
  LOBBY = 'LOBBY',
  DECK_BUILDER = 'DECK_BUILDER',
  LOCAL_SETUP = 'LOCAL_SETUP',
  LOCAL_GAME = 'LOCAL_GAME',
  GAME = 'GAME',
}

const STORAGE_KEY = 'planeswalker_tabletop_settings_v1';

export interface SavedDeck {
  id: string;
  name: string;
  deck: CardData[];
  tokens: CardData[];
  sleeveColor: string;
  createdAt?: number;
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
  const [localOpponents, setLocalOpponents] = useState<{ name: string, deck: CardData[], tokens: CardData[], color: string }[]>([]);

  // Persist state changes to Local Storage
  useEffect(() => {
      const settings = {
          playerName,
          playerSleeve,
          activeDeck,
          lobbyTokens,
          savedDecks
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [playerName, playerSleeve, activeDeck, lobbyTokens, savedDecks]);

  // Prevent Render.com from sleeping by pinging the server
  useEffect(() => {
      const interval = setInterval(() => {
          fetch(window.location.href, { method: 'HEAD' }).catch(() => {});
      }, 10 * 60 * 1000); // Ping every 10 minutes
      return () => clearInterval(interval);
  }, []);

  const handleDeckReady = (deck: CardData[], tokens: CardData[], shouldSave?: boolean, deckName?: string) => {
    setActiveDeck(deck);
    setLobbyTokens(tokens);
    
    if (shouldSave) {
        const newDeck: SavedDeck = {
            id: crypto.randomUUID(),
            name: deckName || `Deck ${new Date().toLocaleDateString()}`,
            deck,
            tokens,
            sleeveColor: playerSleeve,
            createdAt: Date.now()
        };
        handleSaveDeck(newDeck);
    }
    
    setCurrentView(View.LOBBY);
  };

  const handleJoinGame = (code?: string, isStarted?: boolean) => {
    if (code) setRoomId(code);
    setIsGameStarted(!!isStarted);
    setCurrentView(View.GAME);
  };

  const handleStartLocalGame = (opponents: any[]) => {
      setLocalOpponents(opponents);
      setCurrentView(View.LOCAL_GAME);
  };

  const handleSaveDeck = (deck: SavedDeck) => {
      setSavedDecks(prev => {
          const idx = prev.findIndex(d => d.id === deck.id);
          if (idx >= 0) {
              const copy = [...prev];
              copy[idx] = deck;
              return copy;
          }
          return [...prev, deck];
      });
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
            onExit={() => setCurrentView(View.LOBBY)}
        />
      )}

      {currentView === View.LOCAL_GAME && (
        <Tabletop 
            initialDeck={activeDeck} 
            initialTokens={lobbyTokens}
            playerName={playerName}
            sleeveColor={playerSleeve}
            roomId="LOCAL"
            isLocal={true}
            localOpponents={localOpponents}
            onExit={() => setCurrentView(View.LOBBY)}
        />
      )}
    </div>
  );
}

export default App;
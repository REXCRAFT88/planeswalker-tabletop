import React, { useState, useEffect } from 'react';
import { Lobby } from './components/Lobby';
import { DeckBuilder } from './components/DeckBuilder';
import { Tabletop } from './components/Tabletop';
import { CardData } from './types';
import { PLAYER_COLORS } from './constants';

enum View {
  LOBBY = 'LOBBY',
  DECK_BUILDER = 'DECK_BUILDER',
  GAME = 'GAME',
}

const STORAGE_KEY = 'planeswalker_tabletop_settings_v1';

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
  const [activeDeck, setActiveDeck] = useState<CardData[]>(() => loadState('activeDeck', []));
  const [lobbyTokens, setLobbyTokens] = useState<CardData[]>(() => loadState('lobbyTokens', []));

  // Persist state changes to Local Storage
  useEffect(() => {
      const settings = {
          playerName,
          playerSleeve,
          activeDeck,
          lobbyTokens
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [playerName, playerSleeve, activeDeck, lobbyTokens]);

  const handleDeckReady = (deck: CardData[]) => {
    setActiveDeck(deck);
    setCurrentView(View.LOBBY);
  };

  const handleJoinGame = () => {
    setCurrentView(View.GAME);
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
            onImportDeck={() => setCurrentView(View.DECK_BUILDER)}
            savedDeckCount={activeDeck.length}
            currentTokens={lobbyTokens}
            onTokensChange={setLobbyTokens}
        />
      )}
      
      {currentView === View.DECK_BUILDER && (
        <DeckBuilder 
            initialDeck={activeDeck}
            onDeckReady={handleDeckReady} 
            onBack={() => setCurrentView(View.LOBBY)} 
        />
      )}
      
      {currentView === View.GAME && (
        <Tabletop 
            initialDeck={activeDeck} 
            initialTokens={lobbyTokens}
            playerName={playerName}
            sleeveColor={playerSleeve}
            onExit={() => setCurrentView(View.LOBBY)}
        />
      )}
    </div>
  );
}

export default App;
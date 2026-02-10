import React, { useState } from 'react';
import { Shield, Users, Play, Plus, Palette, Edit3, Layers, Search, X, Loader2 } from 'lucide-react';
import { PLAYER_COLORS } from '../constants';
import { CardData } from '../types';
import { searchCards } from '../services/scryfall';

interface LobbyProps {
  playerName: string;
  setPlayerName: (name: string) => void;
  playerSleeve: string;
  setPlayerSleeve: (color: string) => void;
  onJoin: () => void;
  onImportDeck: () => void;
  savedDeckCount: number;
  currentTokens: CardData[];
  onTokensChange: (tokens: CardData[]) => void;
}

export const Lobby: React.FC<LobbyProps> = ({ 
    playerName, setPlayerName, 
    playerSleeve, setPlayerSleeve,
    onJoin, onImportDeck, savedDeckCount,
    currentTokens, onTokensChange
}) => {
  const [isTokenModalOpen, setIsTokenModalOpen] = useState(false);
  const [tokenSearchTerm, setTokenSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<CardData[]>([]);

  const handleStart = () => {
    if (savedDeckCount === 0) {
      alert("Please import a deck first!");
      return;
    }
    onJoin(); 
  };

  const searchToken = async () => {
      if (!tokenSearchTerm) return;
      setIsSearching(true);
      setSearchResults([]);
      
      const query = tokenSearchTerm.toLowerCase().includes('t:token') 
        ? tokenSearchTerm 
        : `${tokenSearchTerm} t:token`;

      let results = await searchCards(query);
      
      if (results.length === 0) {
          // Fallback: Try searching just the name
          const fallback = await searchCards(tokenSearchTerm);
          if (fallback.length > 0) results = fallback;
      }

      const resultsAsTokens = results.map(r => ({...r, isToken: true}));
      setSearchResults(resultsAsTokens);
      setIsSearching(false);
  };

  const addToken = (token: CardData) => {
      const newToken = { ...token, id: crypto.randomUUID() };
      onTokensChange([...currentTokens, newToken]);
      setSearchResults([]);
      setTokenSearchTerm('');
      setIsTokenModalOpen(false); // Optional: close on selection if desired, or keep open for multiple add
  };

  const removeToken = (id: string) => {
      onTokensChange(currentTokens.filter(t => t.id !== id));
  };

  return (
    <div className="flex flex-col items-center justify-center h-full max-w-md mx-auto p-6 animate-in fade-in duration-700 relative">
      <div className="text-center mb-10">
        <div className="w-20 h-20 bg-gradient-to-br from-orange-500 to-red-600 rounded-2xl mx-auto mb-4 flex items-center justify-center shadow-lg shadow-orange-500/30 rotate-3">
          <Shield size={40} className="text-white" />
        </div>
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

        {/* Sleeve Selector */}
        <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Player Color</label>
            <div className="flex flex-wrap gap-3 justify-center bg-gray-900 p-3 rounded-lg border border-gray-600">
                {PLAYER_COLORS.map((color) => (
                    <button
                        key={color}
                        onClick={() => setPlayerSleeve(color)}
                        className={`w-8 h-8 rounded-full shadow-sm border-2 transition-transform hover:scale-110 ${playerSleeve === color ? 'border-white scale-110' : 'border-transparent opacity-70'}`}
                        style={{ backgroundColor: color }}
                        title="Preset Color"
                    />
                ))}
                {/* Custom Color Input */}
                <div className="relative flex items-center justify-center w-8 h-8 rounded-full overflow-hidden border-2 border-gray-500 hover:border-white transition-colors">
                    <input 
                        type="color" 
                        value={playerSleeve}
                        onChange={(e) => setPlayerSleeve(e.target.value)}
                        className="absolute inset-0 w-[150%] h-[150%] -top-[25%] -left-[25%] cursor-pointer p-0 border-0"
                    />
                    <Palette size={14} className="pointer-events-none text-white mix-blend-difference z-10"/>
                </div>
            </div>
        </div>
        
        {/* Token Pre-Select */}
         <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex justify-between items-center">
                <span>Tokens ({currentTokens.length})</span>
                <button onClick={() => setIsTokenModalOpen(true)} className="text-blue-400 hover:text-blue-300 text-[10px] flex items-center gap-1">
                    <Plus size={10} /> Add
                </button>
            </label>
            <div className="flex gap-2 overflow-x-auto pb-2 min-h-[3rem]">
                {currentTokens.length === 0 ? (
                    <div className="text-xs text-gray-500 italic w-full text-center py-2 bg-gray-900 rounded border border-gray-700 border-dashed">No tokens selected</div>
                ) : (
                    currentTokens.map(token => (
                        <div key={token.id} className="relative w-10 h-14 flex-shrink-0 group">
                            <img src={token.imageUrl} className="w-full h-full object-cover rounded shadow border border-gray-600" />
                            <button 
                                onClick={() => removeToken(token.id)}
                                className="absolute -top-1 -right-1 bg-red-600 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                <X size={8} />
                            </button>
                        </div>
                    ))
                )}
            </div>
         </div>

        <div className="pt-4 border-t border-gray-700">
           <div className="flex gap-4 mb-4">
              <button 
                onClick={handleStart}
                className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-bold py-3 px-4 rounded-xl shadow-lg transition-transform active:scale-95 flex items-center justify-center gap-2"
              >
                <Play size={20} />
                {savedDeckCount > 0 ? 'Create Table' : 'Import Deck to Play'}
              </button>
           </div>
           
           <div className="grid grid-cols-2 gap-3">
               {savedDeckCount > 0 ? (
                   <button 
                    onClick={onImportDeck}
                    className="flex flex-col items-center justify-center p-4 bg-gray-900 hover:bg-gray-750 border border-gray-700 hover:border-blue-500 rounded-xl transition-all group"
                   >
                       <Edit3 className="text-blue-500 mb-2 group-hover:scale-110 transition-transform" size={24} />
                       <span className="text-sm font-medium text-gray-300">Edit Commanders</span>
                       <span className="text-xs text-gray-500 mt-1">or Change Deck</span>
                   </button>
               ) : (
                   <button 
                    onClick={onImportDeck}
                    className="flex flex-col items-center justify-center p-4 bg-gray-900 hover:bg-gray-750 border border-gray-700 hover:border-blue-500 rounded-xl transition-all group"
                   >
                       <Plus className="text-blue-500 mb-2 group-hover:scale-110 transition-transform" size={24} />
                       <span className="text-sm font-medium text-gray-300">Import Deck</span>
                       <span className="text-xs text-gray-500 mt-1">Start Here</span>
                   </button>
               )}
               
               <button className="flex flex-col items-center justify-center p-4 bg-gray-900 border border-gray-700 rounded-xl opacity-50 cursor-not-allowed">
                   <Users className="text-green-500 mb-2" size={24} />
                   <span className="text-sm font-medium text-gray-300">Join Table</span>
                   <span className="text-xs text-gray-500 mt-1">Coming Soon</span>
               </button>
           </div>
        </div>
      </div>

      {/* Token Modal - Centered and in front */}
      {isTokenModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
              <div className="bg-gray-800 border border-gray-600 w-full max-w-[95vw] lg:max-w-6xl rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] h-[85vh]">
                  <div className="p-4 border-b border-gray-700 flex justify-between items-center bg-gray-900">
                      <h3 className="font-bold text-white flex items-center gap-2"><Layers className="text-yellow-500"/> Select Tokens</h3>
                      <button onClick={() => setIsTokenModalOpen(false)} className="text-gray-400 hover:text-white"><X size={20}/></button>
                  </div>
                  
                  <div className="p-4 bg-gray-800 flex flex-col gap-4 flex-1 overflow-hidden">
                      <div className="flex gap-2">
                          <input 
                            className="flex-1 bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                            placeholder="e.g. Goblin, Treasure, Clue..."
                            value={tokenSearchTerm}
                            onChange={(e) => setTokenSearchTerm(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && searchToken()}
                          />
                          <button onClick={searchToken} className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded text-white font-bold flex items-center gap-2">
                             {isSearching ? <Loader2 className="animate-spin" size={16}/> : <Search size={16} />}
                             Search
                          </button>
                      </div>

                      <div className="flex-1 border-2 border-dashed border-gray-700 rounded-lg bg-gray-900/50 p-4 overflow-y-auto">
                          {isSearching ? (
                              <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-2">
                                  <Loader2 className="animate-spin" size={32}/>
                                  <span>Searching Scryfall...</span>
                              </div>
                          ) : searchResults.length > 0 ? (
                              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                                  {searchResults.map((card) => (
                                       <div key={card.scryfallId} className="flex flex-col items-center gap-2 bg-gray-800 p-3 rounded-xl hover:bg-gray-700 transition shadow-md hover:shadow-xl border border-transparent hover:border-gray-600">
                                          <div className="relative w-full aspect-[2.5/3.5]">
                                             <img src={card.imageUrl} className="w-full h-full object-cover rounded-lg shadow-black/50 shadow-lg" alt={card.name} loading="lazy" />
                                          </div>
                                          <button 
                                            onClick={() => addToken(card)}
                                            className="w-full bg-green-600 hover:bg-green-500 text-white text-sm py-2 rounded-lg font-bold shadow flex items-center justify-center gap-2 mt-2"
                                          >
                                              <Plus size={16}/> Add
                                          </button>
                                          <div className="text-xs text-gray-400 truncate w-full text-center font-medium">{card.typeLine}</div>
                                      </div>
                                  ))}
                              </div>
                          ) : (
                              <div className="h-full flex items-center justify-center text-gray-500 text-sm">Search for a token to add it to your collection</div>
                          )}
                      </div>
                  </div>
              </div>
          </div>
      )}

    </div>
  );
};

const UserIcon = ({className, size}: {className?: string, size?: number}) => (
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
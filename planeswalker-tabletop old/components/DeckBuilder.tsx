import React, { useState } from 'react';
import { parseDeckList, fetchBatch } from '../services/scryfall';
import { CardData } from '../types';
import { Loader2, Download, AlertCircle, Crown, Check, Search, Trash2 } from 'lucide-react';

interface DeckBuilderProps {
  initialDeck: CardData[];
  onDeckReady: (deck: CardData[]) => void;
  onBack: () => void;
}

export const DeckBuilder: React.FC<DeckBuilderProps> = ({ initialDeck, onDeckReady, onBack }) => {
  const [deckText, setDeckText] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{current: number, total: number} | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Staging area after fetching but before confirming commander
  // If initialDeck has cards, we assume we are in "Edit/Select Commander" mode
  const [stagedDeck, setStagedDeck] = useState<CardData[] | null>(initialDeck && initialDeck.length > 0 ? initialDeck : null);
  
  const handleImport = async () => {
    setLoading(true);
    setError(null);
    const parsed = parseDeckList(deckText);
    
    if (parsed.length === 0) {
      setError("No cards found. Please paste a valid deck list (e.g., '1 Sol Ring').");
      setLoading(false);
      return;
    }

    const deck: CardData[] = [];
    const uniqueNames = parsed.map(p => p.name);

    try {
        const cardMap = await fetchBatch(uniqueNames, (curr, total) => {
             // Show progress of unique cards fetched
             setProgress({ current: curr, total: total });
        });

        // Assemble Deck
        let missingCount = 0;
        for (const item of parsed) {
            // Try strict match then lowercase match
            let data = cardMap.get(item.name.toLowerCase());
            
            // If strictly not found, try to find by key inclusion (heuristic for complex names)
            if (!data) {
                const key = Array.from(cardMap.keys()).find(k => k.includes(item.name.toLowerCase()) || item.name.toLowerCase().includes(k));
                if (key) data = cardMap.get(key);
            }

            if (data) {
                for (let i = 0; i < item.count; i++) {
                    deck.push({ ...data, id: crypto.randomUUID(), isCommander: false }); // Ensure clean state
                }
            } else {
                console.warn(`Could not find card data for: ${item.name}`);
                missingCount++;
            }
        }
        
        if (missingCount > 0 && deck.length === 0) {
            setError("Could not load any cards. Please check your card names.");
        } else {
            setStagedDeck(deck);
        }

    } catch (e) {
        console.error(e);
        setError("Failed to load deck. Please try again.");
    } finally {
        setLoading(false);
        setProgress(null);
    }
  };

  const setCommander = (id: string) => {
      if (!stagedDeck) return;
      const updated = stagedDeck.map(c => ({
          ...c,
          isCommander: c.id === id ? !c.isCommander : c.isCommander // Toggle or set
      }));
      setStagedDeck(updated);
  };

  const finalizeDeck = () => {
      if (!stagedDeck) return;
      onDeckReady(stagedDeck);
  };

  const clearDeck = () => {
      if (confirm("Are you sure you want to clear this deck and import a new one?")) {
          setStagedDeck(null);
          setDeckText('');
      }
  };

  const filteredDeck = stagedDeck 
    ? stagedDeck.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : [];

  return (
    <div className="flex flex-col h-full p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
          {stagedDeck ? 'Select Commander' : 'Import Deck'}
        </h1>
        <button onClick={onBack} className="text-gray-400 hover:text-white transition">
          Back to Menu
        </button>
      </div>

      {!stagedDeck ? (
        <div className="bg-gray-800 rounded-xl p-6 shadow-lg border border-gray-700 flex-1 flex flex-col">
            <label className="block text-sm font-medium text-gray-300 mb-2">
            Paste Deck List (Moxfield/Arena format)
            </label>
            <textarea
            className="flex-1 w-full bg-gray-900 border border-gray-600 rounded-lg p-4 text-gray-200 font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none"
            placeholder={`1 Sol Ring\n1 Arcane Signet\n1 Command Tower...`}
            value={deckText}
            onChange={(e) => setDeckText(e.target.value)}
            disabled={loading}
            />
            
            {error && (
                <div className="mt-4 p-3 bg-red-900/50 border border-red-700 rounded-lg flex items-center gap-2 text-red-200">
                    <AlertCircle size={18} />
                    <span>{error}</span>
                </div>
            )}

            <div className="mt-6 flex items-center justify-end gap-4">
            {loading ? (
                <div className="flex items-center gap-3 text-blue-400">
                <Loader2 className="animate-spin" />
                <span>Loading... {progress ? `${progress.current}/${progress.total} unique cards` : ''}</span>
                </div>
            ) : (
                <button
                onClick={handleImport}
                className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors shadow-lg hover:shadow-blue-500/25"
                >
                <Download size={20} />
                Load Deck
                </button>
            )}
            </div>
        </div>
      ) : (
          <div className="flex-1 flex flex-col bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
              <div className="p-4 bg-gray-900 border-b border-gray-700 flex flex-col gap-4">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-300">Click a card to designate it as Commander. (Click again to unselect)</span>
                    <div className="flex gap-2">
                         <button 
                            onClick={clearDeck}
                            className="flex items-center gap-2 px-4 py-2 bg-red-900/50 hover:bg-red-900 border border-red-800 text-white rounded-lg font-bold transition-colors"
                        >
                            <Trash2 size={16} /> New Deck
                        </button>
                        <button 
                            onClick={finalizeDeck}
                            className="flex items-center gap-2 px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold shadow-lg shadow-green-900/20"
                        >
                            <Check size={20} /> Save & Return
                        </button>
                    </div>
                  </div>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input 
                        type="text" 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search for your commander..."
                        className="w-full bg-gray-800 border border-gray-600 rounded-lg py-2 pl-10 pr-4 text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                      {filteredDeck.map(card => (
                          <div 
                            key={card.id} 
                            onClick={() => setCommander(card.id)}
                            className={`relative aspect-[2.5/3.5] rounded-lg cursor-pointer transition-all border-4 ${card.isCommander ? 'border-amber-500 scale-105 shadow-amber-500/50 shadow-lg' : 'border-transparent hover:border-gray-500'}`}
                          >
                              <img src={card.imageUrl} className="w-full h-full object-cover rounded-md" />
                              {card.isCommander && (
                                  <div className="absolute top-2 right-2 bg-amber-500 text-black p-1 rounded-full shadow-lg">
                                      <Crown size={20} fill="black" />
                                  </div>
                              )}
                              <div className="absolute bottom-0 left-0 right-0 bg-black/70 p-1 text-center text-xs truncate">
                                  {card.name}
                              </div>
                          </div>
                      ))}
                      {filteredDeck.length === 0 && (
                          <div className="col-span-full text-center text-gray-500 py-12">
                              No cards found matching "{searchQuery}"
                          </div>
                      )}
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};
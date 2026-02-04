import React, { useState, useRef, useEffect } from 'react';
import { CardData, BoardObject, LogEntry } from '../types';
import { Card } from './Card';
import { JudgeChat } from './JudgeChat';
import { fetchCardByName, searchCards } from '../services/scryfall';
import { CARD_WIDTH, CARD_HEIGHT } from '../constants';
import { 
    LogOut, MessageSquare, Search, ZoomIn, ZoomOut, History, ArrowUp, ArrowDown, 
    Archive, X, Eye, Shuffle, Crown, Dices, Layers, ChevronRight, Hand, Play, Settings, Swords,
    Clock, RefreshCw, Users, CheckCircle, Ban, ArrowRight, Disc, ChevronLeft, Trash2, ArrowLeft, Minus, Plus, Keyboard
} from 'lucide-react';

interface TabletopProps {
    initialDeck: CardData[];
    initialTokens: CardData[];
    playerName: string;
    sleeveColor?: string;
    onExit: () => void;
}

interface ViewState {
    x: number;
    y: number;
    scale: number;
}

interface SearchState {
    isOpen: boolean;
    source: 'LIBRARY' | 'GRAVEYARD' | 'EXILE' | 'TOKENS';
    items: { card: CardData; isRevealed: boolean }[];
    tray: CardData[];
    tokenQuery?: string;
}

interface LibraryActionState {
    isOpen: boolean;
    cardId: string;
}

// --- Layout Constants ---
const MAT_W = 700;
const MAT_H = 400;
const GAP = 300; 

// World Coordinates (Centered around 0,0)
const LOCAL_MAT_POS = { x: -MAT_W / 2, y: GAP }; 
const TOP_MAT_POS = { x: -MAT_W / 2, y: -MAT_H - GAP };
const SIDE_MAT_OFFSET = (MAT_W / 2) + GAP + (MAT_H / 2);
const LEFT_MAT_POS = { x: -SIDE_MAT_OFFSET - (MAT_W / 2), y: -MAT_H / 2 }; 
const RIGHT_MAT_POS = { x: SIDE_MAT_OFFSET - (MAT_W / 2), y: -MAT_H / 2 };

// Zone Offsets (Relative to Mat Top-Left)
const ZONE_OFFSET_X = MAT_W + 30; 
const ZONE_LIBRARY_OFFSET = { x: ZONE_OFFSET_X, y: 0 };
const ZONE_GRAVEYARD_OFFSET = { x: ZONE_OFFSET_X, y: CARD_HEIGHT + 20 };
// Exile to the RIGHT of Graveyard (L-shape)
const ZONE_EXILE_OFFSET = { x: ZONE_OFFSET_X + CARD_WIDTH + 20, y: CARD_HEIGHT + 20 };
const ZONE_COMMAND_OFFSET = { x: -160, y: 0 }; 

// --- Hand Card Component ---
const HandCard: React.FC<{
  card: CardData;
  scale: number;
  onInspect: (card: CardData) => void;
  onPlay: (card: CardData) => void;
  onSendToZone: (card: CardData, zone: 'GRAVEYARD' | 'EXILE') => void;
}> = ({ card, scale, onInspect, onPlay, onSendToZone }) => {
  const width = 140 * scale; 
  const height = 196 * scale; 

  return (
    <div 
        className="relative flex-shrink-0 transition-transform duration-200 ease-out cursor-pointer group hover:-translate-y-4 hover:z-50"
        style={{ width, height }}
    >
        <div className="relative w-full h-full rounded-xl overflow-hidden shadow-2xl border border-black/50 bg-gray-800">
            <img src={card.imageUrl} className="w-full h-full object-cover" alt={card.name} />
            
            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                <button onClick={() => onPlay(card)} className="px-4 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-full font-bold text-sm shadow-lg transform hover:scale-105 flex items-center gap-1">
                    <Play size={12} /> Play
                </button>
                <div className="flex gap-2">
                    <button onClick={() => onInspect(card)} className="p-2 bg-gray-700 hover:bg-gray-600 text-white rounded-full" title="Inspect">
                        <ZoomIn size={16} />
                    </button>
                    <button onClick={() => onSendToZone(card, 'EXILE')} className="p-2 bg-gray-700 hover:bg-gray-600 text-white rounded-full" title="Exile">
                        <X size={16} />
                    </button>
                    <button onClick={() => onSendToZone(card, 'GRAVEYARD')} className="p-2 bg-red-900/80 hover:bg-red-800 text-white rounded-full" title="Discard">
                         <Archive size={16} />
                    </button>
                </div>
            </div>
        </div>
    </div>
  );
};

const PlaymatGhost: React.FC<{
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  playerName: string;
}> = ({ x, y, width, height, rotation, playerName }) => {
  return (
    <div
      className="absolute border-2 border-dashed border-white/10 rounded-3xl flex items-center justify-center bg-white/5 pointer-events-none"
      style={{
        left: x,
        top: y,
        width,
        height,
        transform: `rotate(${rotation}deg)`,
      }}
    >
      <div className="text-2xl font-bold text-white/20">{playerName}</div>
    </div>
  );
};

const Playmat: React.FC<{
  x: number;
  y: number;
  width: number;
  height: number;
  playerName: string;
  rotation: number;
  zones: any;
  counts: any;
  sleeveColor: string;
  topGraveyardCard?: CardData;
  isShuffling: boolean;
  commanders: CardData[];
  onDraw: () => void;
  onShuffle: () => void;
  onOpenSearch: (source: 'LIBRARY' | 'GRAVEYARD' | 'EXILE' | 'TOKENS') => void;
  onPlayCommander: (card: CardData) => void;
  onPlayTopLibrary: () => void;
  onPlayTopGraveyard: () => void;
}> = ({
  x, y, width, height, playerName, zones, counts, sleeveColor,
  topGraveyardCard, isShuffling, commanders,
  onDraw, onShuffle, onOpenSearch, onPlayCommander, onPlayTopLibrary, onPlayTopGraveyard
}) => {
  return (
    <div
      className="absolute bg-gray-900/40 rounded-3xl border"
      style={{
        left: x, top: y, width, height,
        borderColor: sleeveColor,
        boxShadow: `0 0 15px ${sleeveColor}20` 
      }}
    >
      <div className="absolute bottom-4 left-6 text-white/30 font-bold text-xl uppercase tracking-widest pointer-events-none">
        {playerName}
      </div>

      {/* Library Zone */}
      <div
        className="absolute group"
        style={{ left: zones.library.x, top: zones.library.y, width: CARD_WIDTH, height: CARD_HEIGHT }}
      >
        <div 
            className="w-full h-full rounded bg-gray-800 border-2 border-white/20 flex items-center justify-center hover:border-blue-400 transition relative overflow-hidden cursor-pointer"
            onClick={onDraw}
            style={{ backgroundColor: sleeveColor }}
        >
            <div className="text-white font-bold text-2xl z-10 pointer-events-none">{counts.library}</div>
            {isShuffling && <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs text-white z-20">Shuffling...</div>}
            
             <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 z-30"
                onClick={(e) => e.stopPropagation()}
             >
                 <button onClick={onDraw} className="px-3 py-1 bg-green-600 hover:bg-green-500 text-white rounded-full text-xs font-bold shadow-lg w-20 flex items-center justify-center gap-1">
                    <Hand size={12}/> Draw
                 </button>
                 <button onClick={onPlayTopLibrary} className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-full text-xs font-bold shadow-lg w-20 flex items-center justify-center gap-1">
                    <Play size={12}/> Play
                 </button>
                <div className="flex gap-2">
                    <button onClick={onShuffle} className="p-2 bg-gray-700 hover:bg-gray-600 text-white rounded-full" title="Shuffle">
                        <Shuffle size={14} />
                    </button>
                    <button onClick={() => onOpenSearch('LIBRARY')} className="p-2 bg-gray-700 hover:bg-gray-600 text-white rounded-full" title="Search">
                        <Search size={14} />
                    </button>
                </div>
            </div>
        </div>
        <div className="absolute -top-6 w-full text-center text-xs text-gray-500 font-bold uppercase">Library</div>
      </div>

      {/* Graveyard Zone */}
      <div
        className="absolute group"
        style={{ left: zones.graveyard.x, top: zones.graveyard.y, width: CARD_WIDTH, height: CARD_HEIGHT }}
      >
        <div 
            className="w-full h-full rounded bg-gray-800/50 border-2 border-white/10 flex items-center justify-center relative overflow-hidden cursor-pointer"
            onClick={() => onOpenSearch('GRAVEYARD')}
        >
            {topGraveyardCard ? (
                <img src={topGraveyardCard.imageUrl} className="w-full h-full object-cover rounded opacity-80 hover:opacity-100" alt="Graveyard" />
            ) : (
                 <div className="text-white/20 text-3xl"><Archive /></div>
            )}
             <div className="absolute top-0 right-0 bg-black/80 text-white text-xs px-1.5 rounded-bl font-bold z-10">{counts.graveyard}</div>

             <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 z-20"
                onClick={(e) => e.stopPropagation()}
             >
                 {topGraveyardCard && (
                    <button onClick={onPlayTopGraveyard} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded-full text-xs font-bold shadow-lg w-20">
                        Play Top
                    </button>
                 )}
                 <button onClick={() => onOpenSearch('GRAVEYARD')} className="p-2 bg-gray-700 hover:bg-gray-600 text-white rounded-full" title="View All">
                    <Search size={14} />
                </button>
             </div>
        </div>
        <div className="absolute -top-6 w-full text-center text-xs text-gray-500 font-bold uppercase">Graveyard</div>
      </div>

      {/* Exile Zone */}
      <div
        className="absolute group"
        style={{ left: zones.exile.x, top: zones.exile.y, width: CARD_WIDTH, height: CARD_HEIGHT }}
      >
         <div 
            className="w-full h-full rounded bg-black/40 border-2 border-dashed border-white/10 flex items-center justify-center cursor-pointer hover:border-red-400/50"
            onClick={() => onOpenSearch('EXILE')}
        >
             <div className="text-white/20 text-sm rotate-45">Exile</div>
             <div className="absolute top-0 right-0 bg-black/80 text-white text-xs px-1.5 rounded-bl font-bold">{counts.exile}</div>
        </div>
        <div className="absolute -top-6 w-full text-center text-xs text-gray-500 font-bold uppercase">Exile</div>
      </div>

      {/* Command Zone */}
      <div
        className="absolute flex flex-col gap-2"
        style={{ left: zones.command.x, top: zones.command.y }}
      >
          {commanders.map(cmd => (
              <div 
                key={cmd.id}
                className="relative bg-gray-800 border border-amber-500/30 cursor-pointer hover:scale-105 transition-transform"
                style={{ width: CARD_WIDTH, height: CARD_HEIGHT }}
                onClick={() => onPlayCommander(cmd)}
                title="Click to Cast Commander"
              >
                  <img src={cmd.imageUrl} className="w-full h-full object-cover rounded opacity-90" alt={cmd.name} />
                  <div className="absolute -top-2 -right-2 bg-amber-600 text-black p-1 rounded-full shadow-lg">
                      <Crown size={16} />
                  </div>
              </div>
          ))}
          {commanders.length === 0 && (
             <div 
                className="rounded border-2 border-dashed border-white/10 flex items-center justify-center text-center p-2 text-white/20 text-xs"
                style={{ width: CARD_WIDTH, height: CARD_HEIGHT }}
            >
                 Command Zone Empty
             </div>
          )}
      </div>
    </div>
  );
};

export const Tabletop: React.FC<TabletopProps> = ({ initialDeck, initialTokens, playerName, sleeveColor = '#ef4444', onExit }) => {
    // --- Game Phases & Setup ---
    const [gamePhase, setGamePhase] = useState<'SETUP' | 'MULLIGAN' | 'PLAYING'>('SETUP');
    const [mulligansAllowed, setMulligansAllowed] = useState(true);
    const [freeMulligan, setFreeMulligan] = useState(true);
    const [mulliganCount, setMulliganCount] = useState(0);
    // New Mulligan state
    const [mulliganSelectionMode, setMulliganSelectionMode] = useState(false);
    const [cardsToBottom, setCardsToBottom] = useState<CardData[]>([]);

    // --- Time & Turn State ---
    const [turnStartTime, setTurnStartTime] = useState(Date.now());
    const [elapsedTime, setElapsedTime] = useState(0);
    const [round, setRound] = useState(1);
    const [turn, setTurn] = useState(1);
    const [activePlayerIndex, setActivePlayerIndex] = useState(0);

    // --- Players & Board State ---
    const [playersList, setPlayersList] = useState([
        { id: 'local-player', name: playerName, color: sleeveColor },
        { id: 'opponent-top', name: 'Opponent 1', color: '#3b82f6' },
        { id: 'opponent-right', name: 'Opponent 2', color: '#22c55e' },
        { id: 'opponent-left', name: 'Opponent 3', color: '#a855f7' }
    ]);
    const [boardObjects, setBoardObjects] = useState<BoardObject[]>([]);
    const [hand, setHand] = useState<CardData[]>([]);
    const [tokens, setTokens] = useState<CardData[]>(initialTokens); // Init with props
    const [library, setLibrary] = useState<CardData[]>([]);
    const [graveyard, setGraveyard] = useState<CardData[]>([]);
    const [exile, setExile] = useState<CardData[]>([]);
    const [commandZone, setCommandZone] = useState<CardData[]>([]);
    const [life, setLife] = useState(40);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [commanderDamage, setCommanderDamage] = useState<Record<string, Record<string, number>>>({}); 
    
    // --- UI State ---
    const [isJudgeOpen, setIsJudgeOpen] = useState(false);
    const [isLogOpen, setIsLogOpen] = useState(false);
    const [showShortcuts, setShowShortcuts] = useState(false);
    const [view, setView] = useState<ViewState>({ x: window.innerWidth / 2, y: window.innerHeight / 2, scale: 0.5 });
    const [maxZ, setMaxZ] = useState(100);
    const [isShuffling, setIsShuffling] = useState(false);
    const [statusMessage, setStatusMessage] = useState<string>("");
    const [handScale, setHandScale] = useState(1);
    
    // --- Modal States ---
    const [inspectCard, setInspectCard] = useState<CardData | null>(null);
    const [searchModal, setSearchModal] = useState<SearchState>({ isOpen: false, source: 'LIBRARY', items: [], tray: [] });
    const [tokenSearchTerm, setTokenSearchTerm] = useState("token");
    const [libraryAction, setLibraryAction] = useState<LibraryActionState>({ isOpen: false, cardId: '' });
    const [showCmdrDamage, setShowCmdrDamage] = useState(false);

    // --- Refs ---
    const dragStartRef = useRef<{ x: number, y: number } | null>(null);
    const isSpacePressed = useRef(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // --- Initialization ---
    useEffect(() => {
        // Prepare deck but don't draw yet (wait for Start Game)
        const commanders = initialDeck.filter(c => c.isCommander);
        const deck = initialDeck.filter(c => !c.isCommander);
        const shuffled = [...deck].sort(() => Math.random() - 0.5);
        
        setLibrary(shuffled);
        setCommandZone(commanders);
        // Reset hands/etc
        setHand([]);
        setGraveyard([]);
        setExile([]);

        // Calculate view to center on Local Player Mat
        const matCenterY = LOCAL_MAT_POS.y + MAT_H / 2;
        // We want (0, matCenterY) to be at screen center
        // ScreenCenter = view.x + (WorldPoint * scale) -- if view.x was top-left
        // Using transform logic: translate(view.x, view.y) scale(view.scale)
        // We need the visual center of the screen to map to LOCAL_MAT_POS
        
        const startScale = 0.8;
        setView({
            x: window.innerWidth / 2, 
            y: window.innerHeight / 2 - (matCenterY * startScale),
            scale: startScale
        });
    }, [initialDeck]);

    // --- Keyboard Shortcuts ---
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (['input', 'textarea'].includes((e.target as HTMLElement).tagName.toLowerCase())) return;

            switch(e.key.toLowerCase()) {
                case 'd': 
                    drawCard(1); 
                    break;
                case 'u': 
                    untapAll(); 
                    break;
                case 's': 
                    shuffleLibrary(); 
                    break;
                case 'l': 
                    setIsLogOpen(prev => !prev); 
                    break;
                case 'j': 
                    setIsJudgeOpen(prev => !prev); 
                    break;
                case '?': 
                case '/':
                    setShowShortcuts(prev => !prev);
                    break;
                case 'space':
                    // Space logic is handled by navigation listener, just ensuring no conflict
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [library]); // Dependencies if actions need fresh state, though most use setState setters

    // --- Timer Tick ---
    useEffect(() => {
        if (gamePhase === 'SETUP') return;
        const interval = setInterval(() => {
            setElapsedTime(Date.now() - turnStartTime);
        }, 1000);
        return () => clearInterval(interval);
    }, [turnStartTime, gamePhase]);

    // --- Helper Logic ---
    const addLog = (message: string, type: 'ACTION' | 'SYSTEM' = 'ACTION') => {
        const entry: LogEntry = {
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            playerId: 'local',
            playerName: playerName,
            message,
            type
        };
        setLogs(prev => [entry, ...prev]);
        setStatusMessage(`${playerName} ${message.toLowerCase()}`);
        setTimeout(() => setStatusMessage(""), 3000);
    };

    const formatTime = (ms: number) => {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    // --- Game Flow Actions ---
    const startGame = () => {
        // Draw Initial 7
        const initialHand = library.slice(0, 7);
        const remainingLib = library.slice(7);
        setHand(initialHand);
        setLibrary(remainingLib);
        addLog("Game Started. Drew 7 cards.");
        
        setTurnStartTime(Date.now());
        
        if (mulligansAllowed) {
            setGamePhase('MULLIGAN');
        } else {
            setGamePhase('PLAYING');
        }
    };

    const handleMulliganChoice = (keep: boolean) => {
        if (keep) {
            // Determine how many cards to bottom
            // With Free Mulligan: 0th mulligan = 0, 1st mulligan = 0 bottom, 2nd mulligan = 1 bottom
            let toBottomCount = mulliganCount;
            if (freeMulligan && mulliganCount > 0) {
                 toBottomCount = mulliganCount - 1;
            }

            if (toBottomCount > 0) {
                // Enter selection mode
                setMulliganSelectionMode(true);
                setCardsToBottom([]);
            } else {
                setGamePhase('PLAYING');
                addLog(`kept hand with ${mulliganCount} mulligans`);
            }
        } else {
            // London Mulligan: Shuffle hand back, draw 7
            const cardsToShuffle = [...hand, ...library].sort(() => Math.random() - 0.5);
            const newHand = cardsToShuffle.slice(0, 7);
            const newLib = cardsToShuffle.slice(7);
            setHand(newHand);
            setLibrary(newLib);
            setMulliganCount(prev => prev + 1);
            addLog("took a mulligan");
        }
    };

    const toggleBottomCard = (card: CardData) => {
        const requiredCount = freeMulligan ? Math.max(0, mulliganCount - 1) : mulliganCount;
        
        if (cardsToBottom.find(c => c.id === card.id)) {
            // Remove from bottom list (return to potential hand)
            setCardsToBottom(prev => prev.filter(c => c.id !== card.id));
        } else {
            // Add to bottom list (if limit not reached)
            if (cardsToBottom.length < requiredCount) {
                setCardsToBottom(prev => [...prev, card]);
            }
        }
    };

    const confirmKeepHand = () => {
        const requiredCount = freeMulligan ? Math.max(0, mulliganCount - 1) : mulliganCount;
        if (cardsToBottom.length !== requiredCount) return;
        
        // Remove bottom cards from hand
        const newHand = hand.filter(h => !cardsToBottom.find(b => b.id === h.id));
        setHand(newHand);
        
        // Add bottom cards to bottom of library (in order added)
        setLibrary(prev => [...prev, ...cardsToBottom]);
        
        setGamePhase('PLAYING');
        addLog(`kept hand and put ${requiredCount} cards on bottom`);
        setMulliganSelectionMode(false);
    };

    const randomizeTurnOrder = () => {
        setPlayersList(prev => [...prev].sort(() => Math.random() - 0.5));
    };

    const movePlayerUp = (index: number) => {
        if (index === 0) return;
        setPlayersList(prev => {
            const copy = [...prev];
            [copy[index - 1], copy[index]] = [copy[index], copy[index - 1]];
            return copy;
        });
    };

    const nextTurn = () => {
        const currentPlayer = playersList[activePlayerIndex];
        const duration = Date.now() - turnStartTime;
        addLog(`${currentPlayer.name}'s turn ended (Length: ${formatTime(duration)})`);
        
        const nextIndex = (activePlayerIndex + 1) % playersList.length;
        setActivePlayerIndex(nextIndex);
        setTurn(t => t + 1);
        if (nextIndex === 0) {
            setRound(r => r + 1);
        }
        setTurnStartTime(Date.now());
        addLog(`passed turn to ${playersList[nextIndex].name}`);
    };

    // --- Card Interaction Actions ---
    const untapAll = () => {
        setBoardObjects(prev => prev.map(o => o.controllerId === 'local-player' ? { ...o, rotation: 0, tappedQuantity: 0 } : o));
        addLog("untapped all permanents");
    };

    const unstackCards = (id: string) => {
        const obj = boardObjects.find(o => o.id === id);
        if (!obj || obj.quantity <= 1) return;
     
        const newObjects: BoardObject[] = [];
        // Leave the original as 1 quantity
        // Create qty-1 new objects spread out
        for(let i = 1; i < obj.quantity; i++) {
            newObjects.push({
                ...obj,
                id: crypto.randomUUID(),
                quantity: 1,
                tappedQuantity: 0,
                x: obj.x + (i * 20),
                y: obj.y + (i * 20),
                z: maxZ + i
            });
        }
        
        setMaxZ(prev => prev + obj.quantity);
        setBoardObjects(prev => [
            ...prev.map(o => o.id === id ? {...o, quantity: 1, tappedQuantity: 0} : o),
            ...newObjects
        ]);
        addLog(`unstacked ${obj.cardData.name}`);
    };

    const updateBoardObject = (id: string, updates: Partial<BoardObject>) => {
        setBoardObjects(prev => {
            const movingObj = prev.find(o => o.id === id);
            
            // If we are moving a card, we check if there are counters on top of it to move along
            if (movingObj && movingObj.type === 'CARD' && updates.x !== undefined && updates.y !== undefined) {
                 const dx = updates.x - movingObj.x;
                 const dy = updates.y - movingObj.y;
                 
                 // If moved a significant amount, check for attached counters
                 if (dx !== 0 || dy !== 0) {
                     return prev.map(obj => {
                         if (obj.id === id) return { ...obj, ...updates };
                         
                         // Check if object is a counter sitting on the card
                         if (obj.type === 'COUNTER') {
                             // Simple collision detection: Is the center of the counter roughly within the card's box?
                             // Card box: [movingObj.x, movingObj.x + CARD_WIDTH], [movingObj.y, movingObj.y + CARD_HEIGHT]
                             // Counter is ~40px wide.
                             const counterCenterX = obj.x + 20;
                             const counterCenterY = obj.y + 20;
                             
                             if (counterCenterX >= movingObj.x && counterCenterX <= movingObj.x + CARD_WIDTH &&
                                 counterCenterY >= movingObj.y && counterCenterY <= movingObj.y + CARD_HEIGHT) {
                                     // Move counter along
                                     return { ...obj, x: obj.x + dx, y: obj.y + dy, z: obj.z + 10 }; // Bump z to stay on top
                                 }
                         }
                         return obj;
                     });
                 }
            }
            
            return prev.map(obj => obj.id === id ? { ...obj, ...updates } : obj)
        });
    };
    
    // Updated Logic: Tracking INCOMING damage from a specific Commander TO a specific Player (Victim)
    const updateCommanderDamage = (commanderId: string, victimId: string, delta: number) => {
        setCommanderDamage(prev => {
            const cmdrRecord = prev[commanderId] || {};
            const currentVal = cmdrRecord[victimId] || 0;
            return {
                ...prev,
                [commanderId]: {
                    ...cmdrRecord,
                    [victimId]: Math.max(0, currentVal + delta)
                }
            };
        });
    };

    const playCardFromHand = (card: CardData, spawnX?: number, spawnY?: number) => {
        const defaultX = LOCAL_MAT_POS.x + MAT_W / 2 - CARD_WIDTH / 2;
        const defaultY = LOCAL_MAT_POS.y + MAT_H / 2 - CARD_HEIGHT / 2;

        const newObject: BoardObject = {
            id: crypto.randomUUID(),
            type: 'CARD',
            cardData: card,
            x: spawnX ?? (defaultX + (Math.random() * 40 - 20)),
            y: spawnY ?? (defaultY + (Math.random() * 40 - 20)),
            z: maxZ + 1,
            rotation: 0,
            isFaceDown: false,
            isTransformed: false,
            counters: {},
            commanderDamage: {}, 
            controllerId: 'local-player',
            quantity: 1,
            tappedQuantity: 0
        };
        setMaxZ(prev => prev + 1);
        setBoardObjects(prev => [...prev, newObject]);

        if (!card.isToken) {
            setHand(prev => prev.filter(c => c.id !== card.id));
        }
        addLog(`played ${card.name} ${card.isToken ? '(Token)' : ''}`);
    };

    const spawnCounter = () => {
        const defaultX = LOCAL_MAT_POS.x + MAT_W / 2 - 20;
        const defaultY = LOCAL_MAT_POS.y + MAT_H / 2 - 20;
        const newObject: BoardObject = {
             id: crypto.randomUUID(),
             type: 'COUNTER',
             cardData: { ...initialTokens[0] || initialDeck[0], name: "Counter", id: "counter" }, // Dummy data
             x: defaultX + (Math.random() * 40 - 20),
             y: defaultY + (Math.random() * 40 - 20),
             z: maxZ + 1,
             rotation: 0,
             isFaceDown: false,
             isTransformed: false,
             counters: {},
             commanderDamage: {},
             controllerId: 'local-player',
             quantity: 1,
             tappedQuantity: 0
        };
        setMaxZ(prev => prev + 1);
        setBoardObjects(prev => [...prev, newObject]);
        addLog("added a counter");
    };

    // ... (keep standard card movement methods same as before) ...
    const playTopLibrary = () => {
        if (library.length === 0) return;
        const card = library[0];
        setLibrary(prev => prev.slice(1));
        const spawnX = LOCAL_MAT_POS.x + MAT_W / 2 - CARD_WIDTH / 2;
        const spawnY = LOCAL_MAT_POS.y + MAT_H / 2 - CARD_HEIGHT / 2;
        const newObject: BoardObject = {
            id: crypto.randomUUID(),
            type: 'CARD',
            cardData: card,
            x: spawnX,
            y: spawnY,
            z: maxZ + 1,
            rotation: 0,
            isFaceDown: false,
            isTransformed: false,
            counters: {},
            commanderDamage: {},
            controllerId: 'local-player',
            quantity: 1,
            tappedQuantity: 0
        };
        setMaxZ(prev => prev + 1);
        setBoardObjects(prev => [...prev, newObject]);
        addLog(`played top card of library`);
    };

    const playTopGraveyard = () => {
        if (graveyard.length === 0) return;
        const card = graveyard[0];
        setGraveyard(prev => prev.slice(1));
        const spawnX = LOCAL_MAT_POS.x + MAT_W / 2 - CARD_WIDTH / 2;
        const spawnY = LOCAL_MAT_POS.y + MAT_H / 2 - CARD_HEIGHT / 2;
        const newObject: BoardObject = {
            id: crypto.randomUUID(),
            type: 'CARD',
            cardData: card,
            x: spawnX,
            y: spawnY,
            z: maxZ + 1,
            rotation: 0,
            isFaceDown: false,
            isTransformed: false,
            counters: {},
            commanderDamage: {},
            controllerId: 'local-player',
            quantity: 1,
            tappedQuantity: 0
        };
        setMaxZ(prev => prev + 1);
        setBoardObjects(prev => [...prev, newObject]);
        addLog(`returned ${card.name} from graveyard to battlefield`);
    };

    const returnToHand = (id: string) => {
        const obj = boardObjects.find(o => o.id === id);
        if (!obj) return;
        
        if (obj.type === 'COUNTER') {
            setBoardObjects(prev => prev.filter(o => o.id !== id));
            return;
        }

        if (obj.quantity > 1) {
            const newQty = obj.quantity - 1;
            const newTapped = Math.min(obj.tappedQuantity, newQty);
            updateBoardObject(id, { quantity: newQty, tappedQuantity: newTapped });
            setHand(prev => [...prev, { ...obj.cardData, id: crypto.randomUUID() }]);
            addLog(`returned a ${obj.cardData.name} from stack to hand`);
        } else {
            setBoardObjects(prev => prev.filter(o => o.id !== id));
            if (obj.cardData.isToken) {
                 addLog(`returned token ${obj.cardData.name} to hand (it vanished)`);
            } else {
                setHand(prev => [...prev, obj.cardData]);
                addLog(`returned ${obj.cardData.name} to hand`);
            }
        }
    };

    const rollDice = () => {
        const result = Math.floor(Math.random() * 6) + 1;
        addLog(`rolled a ${result} on a D6`);
        alert(`Rolled a ${result}!`);
    };

    const sendToZone = (card: CardData, zone: 'GRAVEYARD' | 'EXILE') => {
        if (zone === 'GRAVEYARD') {
            setGraveyard(prev => [card, ...prev]);
            addLog(`moved ${card.name} to graveyard`);
        } else {
            setExile(prev => [card, ...prev]);
            addLog(`exiled ${card.name}`);
        }
        if (!card.isToken) {
            setHand(prev => prev.filter(c => c.id !== card.id));
        }
    };

    const handleCardRelease = (id: string, x: number, y: number) => {
        const obj = boardObjects.find(o => o.id === id);
        if (!obj) return;
        
        // Don't do zone logic for Counters
        if (obj.type === 'COUNTER') return;

        const centerX = x + CARD_WIDTH / 2;
        const centerY = y + CARD_HEIGHT / 2;

        const isLocalMat = centerX >= LOCAL_MAT_POS.x && centerX <= LOCAL_MAT_POS.x + MAT_W &&
                           centerY >= LOCAL_MAT_POS.y && centerY <= LOCAL_MAT_POS.y + MAT_H;

        if (isLocalMat) {
            const collision = boardObjects.find(target => 
                target.id !== id && 
                target.type === 'CARD' &&
                target.controllerId === obj.controllerId &&
                target.cardData.name === obj.cardData.name &&
                x < target.x + CARD_WIDTH && x + CARD_WIDTH > target.x &&
                y < target.y + CARD_HEIGHT && y + CARD_HEIGHT > target.y
            );
            if (collision) {
                const newQuantity = collision.quantity + obj.quantity;
                const newTapped = collision.tappedQuantity + obj.tappedQuantity;
                updateBoardObject(collision.id, { quantity: newQuantity, tappedQuantity: newTapped });
                setBoardObjects(prev => prev.filter(o => o.id !== id));
                addLog(`stacked ${obj.cardData.name} onto pile`);
                return;
            }
        }

        const checkRect = (rectX: number, rectY: number, w: number, h: number) => {
            return centerX >= rectX && centerX <= rectX + w && centerY >= rectY && centerY <= rectY + h;
        };

        const libX = LOCAL_MAT_POS.x + ZONE_LIBRARY_OFFSET.x;
        const libY = LOCAL_MAT_POS.y + ZONE_LIBRARY_OFFSET.y;
        if (checkRect(libX, libY, CARD_WIDTH, CARD_HEIGHT)) {
            setLibraryAction({ isOpen: true, cardId: id });
            return;
        }

        const gyX = LOCAL_MAT_POS.x + ZONE_GRAVEYARD_OFFSET.x;
        const gyY = LOCAL_MAT_POS.y + ZONE_GRAVEYARD_OFFSET.y;
        if (checkRect(gyX, gyY, CARD_WIDTH, CARD_HEIGHT)) {
            setGraveyard(prev => [obj.cardData, ...prev]);
            setBoardObjects(prev => prev.filter(o => o.id !== id));
            addLog(`moved ${obj.cardData.name} from battlefield to graveyard`);
            return;
        }

        const exX = LOCAL_MAT_POS.x + ZONE_EXILE_OFFSET.x;
        const exY = LOCAL_MAT_POS.y + ZONE_EXILE_OFFSET.y;
        if (checkRect(exX, exY, CARD_WIDTH, CARD_HEIGHT)) {
            setExile(prev => [obj.cardData, ...prev]);
            setBoardObjects(prev => prev.filter(o => o.id !== id));
            addLog(`exiled ${obj.cardData.name} from battlefield`);
            return;
        }
        
        const cmdX = LOCAL_MAT_POS.x + ZONE_COMMAND_OFFSET.x;
        const cmdY = LOCAL_MAT_POS.y + ZONE_COMMAND_OFFSET.y;
        if (checkRect(cmdX, cmdY, CARD_WIDTH, CARD_HEIGHT) && obj.cardData.isCommander) {
             setCommandZone(prev => [obj.cardData, ...prev]);
             setBoardObjects(prev => prev.filter(o => o.id !== id));
             addLog(`returned commander ${obj.cardData.name} to command zone`);
             return;
        }

        if (checkRect(TOP_MAT_POS.x, TOP_MAT_POS.y, MAT_W, MAT_H)) {
             updateBoardObject(id, { controllerId: 'opponent-top', rotation: 180 });
             addLog(`gave control of ${obj.cardData.name} to Opponent 1`);
             return;
        }
        if (checkRect(LEFT_MAT_POS.x, LEFT_MAT_POS.y, MAT_H, MAT_W)) {
             updateBoardObject(id, { controllerId: 'opponent-left', rotation: 90 });
             addLog(`gave control of ${obj.cardData.name} to Opponent 3`);
             return;
        }
        if (checkRect(RIGHT_MAT_POS.x, RIGHT_MAT_POS.y, MAT_H, MAT_W)) {
             updateBoardObject(id, { controllerId: 'opponent-right', rotation: -90 });
             addLog(`gave control of ${obj.cardData.name} to Opponent 2`);
             return;
        }
        
        if (checkRect(LOCAL_MAT_POS.x, LOCAL_MAT_POS.y, MAT_W, MAT_H)) {
            if (obj.controllerId !== 'local-player') {
                updateBoardObject(id, { controllerId: 'local-player', rotation: 0 });
                addLog(`regained control of ${obj.cardData.name}`);
            }
        }
    };

    // --- Navigation ---
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.code === 'Space') {
                isSpacePressed.current = true;
                if (containerRef.current) containerRef.current.style.cursor = 'grab';
            }
        };
        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.code === 'Space') {
                isSpacePressed.current = false;
                if (containerRef.current) containerRef.current.style.cursor = 'default';
                dragStartRef.current = null;
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, []);

    const handleContainerPointerDown = (e: React.PointerEvent) => {
        if (isSpacePressed.current || e.button === 1) {
            dragStartRef.current = { x: e.clientX - view.x, y: e.clientY - view.y };
            if (containerRef.current) containerRef.current.style.cursor = 'grabbing';
        }
    };

    const handleContainerPointerMove = (e: React.PointerEvent) => {
        if (dragStartRef.current) {
            // Capture these values synchronously to avoid null reference in the state updater
            const startX = dragStartRef.current.x;
            const startY = dragStartRef.current.y;
            setView(prev => ({
                ...prev,
                x: e.clientX - startX,
                y: e.clientY - startY
            }));
        }
    };

    const handleContainerPointerUp = () => {
        dragStartRef.current = null;
        if (containerRef.current) containerRef.current.style.cursor = isSpacePressed.current ? 'grab' : 'default';
    };

    const handleWheel = (e: React.WheelEvent) => {
        // Change: Default behavior is ZOOM. Pan requires modifier or space.
        // However, if space/middle click is used for pan, we just let this be zoom.
        e.preventDefault();
        const scaleAmount = -e.deltaY * 0.001;
        const newScale = Math.min(Math.max(0.1, view.scale + scaleAmount), 3);
        setView(prev => ({ ...prev, scale: newScale }));
    };

    // --- Actions ---
    const drawCard = (count = 1) => {
        if (library.length < count) return;
        const drawn = library.slice(0, count);
        setLibrary(prev => prev.slice(count));
        setHand(prev => [...prev, ...drawn]);
        addLog(`drew ${count} card${count > 1 ? 's' : ''}`);
    };

    const shuffleLibrary = () => {
        setIsShuffling(true);
        setTimeout(() => {
            setLibrary(prev => [...prev].sort(() => Math.random() - 0.5));
            setIsShuffling(false);
            addLog("shuffled their library");
        }, 800);
    };

    const playCommander = (card: CardData) => {
        // Find if already exists (unlikely given logic, but safe)
        if (boardObjects.some(o => o.cardData.id === card.id)) return;
        
        // Remove from Command Zone
        setCommandZone(prev => prev.filter(c => c.id !== card.id));
        
        // Add to Board
        const defaultX = LOCAL_MAT_POS.x + MAT_W / 2 - CARD_WIDTH / 2;
        const defaultY = LOCAL_MAT_POS.y + MAT_H / 2 - CARD_HEIGHT / 2;
        
        const newObject: BoardObject = {
            id: crypto.randomUUID(),
            type: 'CARD',
            cardData: card,
            x: defaultX,
            y: defaultY,
            z: maxZ + 1,
            rotation: 0,
            isFaceDown: false,
            isTransformed: false,
            counters: {},
            commanderDamage: {},
            controllerId: 'local-player',
            quantity: 1,
            tappedQuantity: 0
        };
        setMaxZ(prev => prev + 1);
        setBoardObjects(prev => [...prev, newObject]);
        addLog(`cast commander ${card.name}`);
    };

    // --- Search / Modal Logic ---
    const openSearch = (source: 'LIBRARY' | 'GRAVEYARD' | 'EXILE' | 'TOKENS') => {
        let items: { card: CardData; isRevealed: boolean }[] = [];
        
        if (source === 'LIBRARY') {
            items = library.map(c => ({ card: c, isRevealed: false }));
        } else if (source === 'GRAVEYARD') {
            items = graveyard.map(c => ({ card: c, isRevealed: true }));
        } else if (source === 'EXILE') {
            items = exile.map(c => ({ card: c, isRevealed: true }));
        } else if (source === 'TOKENS') {
             // Init with common tokens if empty, or just empty
             items = []; 
        }

        setSearchModal({
            isOpen: true,
            source,
            items,
            tray: []
        });
    };

    const searchTokens = async () => {
        if (!tokenSearchTerm) return;
        const results = await searchCards(tokenSearchTerm);
        const tokenItems = results.map(c => ({ card: {...c, isToken: true, id: crypto.randomUUID()}, isRevealed: true }));
        setSearchModal(prev => ({ ...prev, items: tokenItems }));
    };

    const revealAll = () => {
        setSearchModal(prev => ({
            ...prev,
            items: prev.items.map(i => ({ ...i, isRevealed: true }))
        }));
        addLog("revealed their library");
    };

    const shuffleAndClose = () => {
        if (searchModal.source === 'LIBRARY') {
            shuffleLibrary();
        }
        setSearchModal(prev => ({ ...prev, isOpen: false }));
    };

    // Tray Logic
    const addToTray = (cardId: string) => {
        const itemIndex = searchModal.items.findIndex(i => i.card.id === cardId);
        if (itemIndex === -1) return;
        
        const item = searchModal.items[itemIndex];
        
        // Remove from items, add to tray
        setSearchModal(prev => ({
            ...prev,
            items: prev.items.filter(i => i.card.id !== cardId),
            tray: [...prev.tray, item.card]
        }));
    };

    const removeFromTray = (cardId: string) => {
        const card = searchModal.tray.find(c => c.id === cardId);
        if (!card) return;

        setSearchModal(prev => ({
            ...prev,
            tray: prev.tray.filter(c => c.id !== cardId),
            // Add back to items (at end is fine)
            items: [...prev.items, { card, isRevealed: true }]
        }));
    };

    const onTrayReorder = (index: number, direction: 'LEFT' | 'RIGHT') => {
        const newTray = [...searchModal.tray];
        const swapIndex = direction === 'LEFT' ? index - 1 : index + 1;
        
        if (swapIndex >= 0 && swapIndex < newTray.length) {
            [newTray[index], newTray[swapIndex]] = [newTray[swapIndex], newTray[index]];
            setSearchModal(prev => ({ ...prev, tray: newTray }));
        }
    };

    const handleTrayAction = (action: 'HAND' | 'TOP' | 'BOTTOM' | 'GRAVEYARD' | 'EXILE' | 'SHUFFLE') => {
        const trayCards = searchModal.tray;
        const trayIds = new Set(trayCards.map(c => c.id));
        if (trayCards.length === 0) return;

        // 1. Calculate Source Changes (Remove Tray Cards)
        let sourceList: CardData[] = [];
        if (searchModal.source === 'LIBRARY') sourceList = library;
        else if (searchModal.source === 'GRAVEYARD') sourceList = graveyard;
        else if (searchModal.source === 'EXILE') sourceList = exile;

        // "Rest" is the source list minus the cards currently in the tray
        const rest = sourceList.filter(c => !trayIds.has(c.id));

        let newLibrary = [...library];
        let newGraveyard = [...graveyard];
        let newExile = [...exile];
        let newHand = [...hand];

        // Apply removal to the specific source state variable copy
        if (searchModal.source === 'LIBRARY') newLibrary = rest;
        else if (searchModal.source === 'GRAVEYARD') newGraveyard = rest;
        else if (searchModal.source === 'EXILE') newExile = rest;

        // 2. Calculate Destination Changes (Add/Merge Tray Cards)
        if (action === 'HAND') {
            newHand = [...newHand, ...trayCards];
            addLog(`put ${trayCards.length} cards into hand from ${searchModal.source.toLowerCase()}`);
        } else if (action === 'TOP') {
            newLibrary = [...trayCards, ...newLibrary]; // Top is index 0
            addLog(`put ${trayCards.length} cards on top of library`);
        } else if (action === 'BOTTOM') {
            newLibrary = [...newLibrary, ...trayCards]; // Bottom is end
            addLog(`put ${trayCards.length} cards on bottom of library`);
        } else if (action === 'GRAVEYARD') {
            newGraveyard = [...trayCards, ...newGraveyard]; 
            addLog(`put ${trayCards.length} cards into graveyard`);
        } else if (action === 'EXILE') {
            newExile = [...trayCards, ...newExile];
            addLog(`exiled ${trayCards.length} cards`);
        } else if (action === 'SHUFFLE') {
            const combined = [...newLibrary, ...trayCards];
            newLibrary = combined.sort(() => Math.random() - 0.5);
            addLog(`shuffled ${trayCards.length} cards into library`);
        }

        // 3. Update Global State
        setLibrary(newLibrary);
        setGraveyard(newGraveyard);
        setExile(newExile);
        setHand(newHand);

        // 4. Update Modal View (Reload)
        let viewList: CardData[] | null = null;
        if (searchModal.source === 'LIBRARY') viewList = newLibrary;
        else if (searchModal.source === 'GRAVEYARD') viewList = newGraveyard;
        else if (searchModal.source === 'EXILE') viewList = newExile;

        if (viewList) {
             const revealedMap = new Map<string, boolean>();
             searchModal.items.forEach(i => revealedMap.set(i.card.id, i.isRevealed));
             
             const newItems = viewList.map(card => ({
                 card,
                 isRevealed: revealedMap.has(card.id) 
                    ? revealedMap.get(card.id)! 
                    : (searchModal.source !== 'LIBRARY') 
             }));

             setSearchModal(prev => ({
                 ...prev,
                 items: newItems,
                 tray: []
             }));
        } else {
             setSearchModal(prev => ({ ...prev, tray: [] }));
        }
    };

    const toggleRevealItem = (index: number) => {
        setSearchModal(prev => {
            const newItems = [...prev.items];
            if (newItems[index]) {
                const wasRevealed = newItems[index].isRevealed;
                newItems[index] = { ...newItems[index], isRevealed: !wasRevealed };
            }
            return { ...prev, items: newItems };
        });

        // Check the *current* state (which is technically old state but serves for the transition check)
        const item = searchModal.items[index];
        if (item && !item.isRevealed) {
             addLog(`revealed ${item.card.name} at position ${index + 1} of ${searchModal.source.toLowerCase()}`);
        }
    };

    const handleSearchAction = (cardId: string, action: 'HAND') => {
         const item = searchModal.items.find(i => i.card.id === cardId);
         if (!item) return;
         
         // For tokens, create new instance
         const newCard = { ...item.card, id: crypto.randomUUID() };
         
         if (action === 'HAND') {
             setHand(prev => [...prev, newCard]);
             addLog(`added ${newCard.name} to hand`);
         }
    };
    
    const resolveLibraryAction = (action: 'TOP' | 'BOTTOM' | 'SHUFFLE') => {
        const id = libraryAction.cardId;
        const obj = boardObjects.find(o => o.id === id);
        if (!obj) {
             setLibraryAction({ isOpen: false, cardId: '' });
             return;
        }

        // Remove from board
        setBoardObjects(prev => prev.filter(o => o.id !== id));
        const card = obj.cardData;

        if (action === 'TOP') {
            setLibrary(prev => [card, ...prev]);
            addLog(`put ${card.name} on top of library`);
        } else if (action === 'BOTTOM') {
            setLibrary(prev => [...prev, card]);
            addLog(`put ${card.name} on bottom of library`);
        } else if (action === 'SHUFFLE') {
            setLibrary(prev => [...prev, card]); 
            shuffleLibrary(); 
        }
        
        setLibraryAction({ isOpen: false, cardId: '' });
    };

    return (
        <div className="relative w-full h-full overflow-hidden select-none bg-[#1a1410]">
            {/* Wood Texture Background */}
            <div 
                className="absolute inset-0 opacity-100 pointer-events-none"
                style={{ 
                    backgroundImage: `url("table_texture.png")`,
                    backgroundRepeat: 'repeat',
                    backgroundSize: '512px',
                }} 
            />
             {/* Grain Texture Overlay */}
            <div 
                className="absolute inset-0 opacity-20 pointer-events-none mix-blend-overlay"
                style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg width='200' height='200' viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`
                }}
            />
            
            {/* --- Status Bar & Logs (Same as before) --- */}
            {statusMessage && (
                <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 pointer-events-none animate-in fade-in slide-in-from-top-4">
                    <div className="bg-black/70 backdrop-blur text-white px-4 py-1 rounded-full text-sm font-medium border border-white/10 shadow-xl">
                        {statusMessage}
                    </div>
                </div>
            )}
            
            {/* ... (Log Sidebar kept same) ... */}
            {isLogOpen && (
                <div className="fixed top-16 right-0 bottom-0 w-80 bg-gray-900/95 backdrop-blur border-l border-gray-700 z-[8000] flex flex-col animate-in slide-in-from-right">
                    <div className="p-4 border-b border-gray-700 flex justify-between items-center">
                        <h3 className="font-bold text-gray-200">Game Log</h3>
                        <button onClick={() => setIsLogOpen(false)} className="text-gray-400 hover:text-white"><X size={16} /></button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-2">
                        {logs.map(log => (
                            <div key={log.id} className="text-sm text-gray-300">
                                <span className="font-bold text-blue-400">{log.playerName}</span> {log.message}
                                <div className="text-[10px] text-gray-600">{new Date(log.timestamp).toLocaleTimeString()}</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* --- PREGAME SETUP OVERLAY --- */}
            {gamePhase === 'SETUP' && (
                <div className="fixed inset-0 z-[10000] bg-gray-900/90 backdrop-blur-md flex items-center justify-center p-8">
                     <div className="bg-gray-800 border border-gray-600 rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col overflow-hidden max-h-full">
                         {/* ... Header ... */}
                         <div className="bg-gray-900 p-6 border-b border-gray-700">
                            <h2 className="text-3xl font-bold text-white flex items-center gap-3">
                                <Users className="text-blue-500" /> Match Setup
                            </h2>
                            <p className="text-gray-400 mt-1">Configure your game before starting.</p>
                        </div>
                        
                        <div className="p-8 flex-1 overflow-y-auto grid grid-cols-2 gap-8">
                            <div className="space-y-4">
                                <div className="flex justify-between items-center">
                                    <h3 className="font-bold text-gray-200">Turn Order</h3>
                                    <button onClick={randomizeTurnOrder} className="text-xs bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded flex items-center gap-1">
                                        <Shuffle size={12}/> Randomize
                                    </button>
                                </div>
                                <div className="space-y-2">
                                    {playersList.map((p, idx) => (
                                        <div key={p.id} className="flex items-center gap-3 bg-gray-700/50 p-3 rounded-lg border border-gray-600">
                                            <span className="text-gray-400 font-mono w-4">{idx+1}.</span>
                                            <div className="w-8 h-8 rounded-full border-2 border-white/20 shadow-sm" style={{backgroundColor: p.color}} />
                                            <span className="flex-1 font-semibold text-white">{p.name}</span>
                                            {idx > 0 && (
                                                <button onClick={() => movePlayerUp(idx)} className="p-1 hover:bg-gray-600 rounded text-gray-400">
                                                    <ArrowUp size={14}/>
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-6">
                                <div className="space-y-2">
                                    <h3 className="font-bold text-gray-200">Game Rules</h3>
                                    <label className="flex items-center gap-3 bg-gray-700/30 p-4 rounded-lg cursor-pointer hover:bg-gray-700/50 transition">
                                        <div className={`w-5 h-5 rounded border flex items-center justify-center ${mulligansAllowed ? 'bg-blue-600 border-blue-500' : 'border-gray-500'}`}>
                                            {mulligansAllowed && <CheckCircle size={14} className="text-white"/>}
                                        </div>
                                        <input type="checkbox" className="hidden" checked={mulligansAllowed} onChange={() => setMulligansAllowed(!mulligansAllowed)} />
                                        <div>
                                            <div className="font-medium text-white">Enable Mulligans</div>
                                            <div className="text-xs text-gray-400">London Mulligan rules enabled</div>
                                        </div>
                                    </label>

                                    <label className={`flex items-center gap-3 bg-gray-700/30 p-4 rounded-lg cursor-pointer hover:bg-gray-700/50 transition ${!mulligansAllowed ? 'opacity-50 pointer-events-none' : ''}`}>
                                        <div className={`w-5 h-5 rounded border flex items-center justify-center ${freeMulligan ? 'bg-green-600 border-green-500' : 'border-gray-500'}`}>
                                            {freeMulligan && <CheckCircle size={14} className="text-white"/>}
                                        </div>
                                        <input type="checkbox" className="hidden" checked={freeMulligan} onChange={() => setFreeMulligan(!freeMulligan)} disabled={!mulligansAllowed} />
                                        <div>
                                            <div className="font-medium text-white">Free 1st Mulligan</div>
                                            <div className="text-xs text-gray-400">First mulligan doesn't cost a card</div>
                                        </div>
                                    </label>
                                </div>
                            </div>
                        </div>

                        <div className="p-6 bg-gray-900 border-t border-gray-700 flex justify-end gap-4">
                            <button onClick={onExit} className="px-6 py-3 text-gray-400 hover:text-white font-medium">Cancel</button>
                            <button 
                                onClick={startGame}
                                className="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl shadow-lg shadow-blue-900/30 flex items-center gap-2 transition-transform active:scale-95"
                            >
                                <Play size={20} /> Start Game
                            </button>
                        </div>
                     </div>
                </div>
            )}

            {/* --- MULLIGAN OVERLAY (UPDATED LARGER UI) --- */}
            {gamePhase === 'MULLIGAN' && (
                <div className="fixed inset-0 z-[9000] bg-black/95 backdrop-blur-sm flex flex-col items-center justify-center p-4 animate-in fade-in overflow-y-auto">
                     <h2 className="text-3xl font-bold text-white mb-2">
                         {mulliganSelectionMode ? 'Select Cards to Bottom' : 'Opening Hand'}
                     </h2>
                     <p className="text-gray-400 mb-8 text-center max-w-lg">
                        {mulliganSelectionMode 
                          ? `Select ${freeMulligan ? Math.max(0, mulliganCount - 1) : mulliganCount} cards to put on the bottom of your library.` 
                          : `You have drawn 7 cards. ${mulliganCount > 0 ? `(Mulligan #${mulliganCount}${freeMulligan && mulliganCount === 1 ? ' - Free' : ''})` : ''}`
                        }
                     </p>
                     
                     {!mulliganSelectionMode ? (
                        <>
                             {/* Larger Card Grid for visibility */}
                             <div className="flex justify-center gap-6 mb-12 flex-wrap max-w-[90vw]">
                                {hand.map((card, idx) => (
                                     <div 
                                        key={idx} 
                                        className="w-48 aspect-[2.5/3.5] rounded-xl overflow-hidden shadow-2xl transform hover:-translate-y-4 transition-transform cursor-pointer group relative"
                                        onClick={() => setInspectCard(card)}
                                     >
                                         <img src={card.imageUrl} className="w-full h-full object-cover"/>
                                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center">
                                              <span className="bg-black/80 px-2 py-1 rounded text-xs text-white">Click to Inspect</span>
                                          </div>
                                     </div>
                                ))}
                             </div>

                             <div className="flex gap-6">
                                 <button 
                                    onClick={() => handleMulliganChoice(false)}
                                    className="flex items-center gap-2 px-8 py-3 bg-red-600 hover:bg-red-500 text-white font-bold rounded-full shadow-lg"
                                 >
                                     <RefreshCw size={20}/> Mulligan
                                 </button>
                                 <button 
                                    onClick={() => handleMulliganChoice(true)}
                                    className="flex items-center gap-2 px-8 py-3 bg-green-600 hover:bg-green-500 text-white font-bold rounded-full shadow-lg"
                                 >
                                     <CheckCircle size={20}/> Keep Hand
                                 </button>
                             </div>
                        </>
                     ) : (
                         <div className="flex flex-col items-center w-full max-w-6xl h-full">
                             {/* Selection Area */}
                             <div className="flex gap-8 w-full mb-8 min-h-[400px]">
                                 
                                 {/* Current Hand */}
                                 <div className="flex-1 bg-gray-800/50 rounded-xl p-6 border border-gray-700 overflow-y-auto">
                                     <h3 className="text-gray-300 font-bold mb-4 uppercase text-xs tracking-wider">Hand</h3>
                                     <div className="flex flex-wrap gap-4">
                                         {hand.map((card) => {
                                             const isSelected = cardsToBottom.find(c => c.id === card.id);
                                             if (isSelected) return null; // Don't show if moved
                                             return (
                                                 <div 
                                                    key={card.id} 
                                                    onClick={() => toggleBottomCard(card)}
                                                    className="w-32 aspect-[2.5/3.5] rounded cursor-pointer hover:scale-105 transition-transform relative group"
                                                 >
                                                     <img src={card.imageUrl} className="w-full h-full object-cover rounded shadow-lg"/>
                                                     <div className="absolute inset-0 bg-blue-500/20 opacity-0 group-hover:opacity-100 transition-opacity rounded flex items-center justify-center">
                                                         <ArrowRight size={24} className="text-white drop-shadow-md"/>
                                                     </div>
                                                 </div>
                                             )
                                         })}
                                     </div>
                                 </div>

                                 {/* To Bottom Area */}
                                 <div className="w-80 bg-gray-800/50 rounded-xl p-6 border border-gray-700 flex flex-col">
                                      <h3 className="text-gray-300 font-bold mb-4 uppercase text-xs tracking-wider flex justify-between">
                                          <span>Bottom of Library</span>
                                          <span className={cardsToBottom.length === (freeMulligan ? Math.max(0, mulliganCount - 1) : mulliganCount) ? 'text-green-400' : 'text-yellow-400'}>
                                              {cardsToBottom.length} / {freeMulligan ? Math.max(0, mulliganCount - 1) : mulliganCount}
                                          </span>
                                      </h3>
                                      <div className="flex-1 flex flex-col gap-2 overflow-y-auto">
                                          {cardsToBottom.map((card, idx) => (
                                              <div 
                                                key={card.id}
                                                onClick={() => toggleBottomCard(card)}
                                                className="flex items-center gap-2 bg-gray-700 p-2 rounded cursor-pointer hover:bg-red-900/50 group"
                                              >
                                                  <span className="text-gray-500 font-mono w-4">{idx+1}.</span>
                                                  <img src={card.imageUrl} className="w-8 h-11 rounded object-cover"/>
                                                  <span className="text-sm font-medium truncate">{card.name}</span>
                                                  <X size={16} className="ml-auto opacity-0 group-hover:opacity-100 text-red-400"/>
                                              </div>
                                          ))}
                                          {cardsToBottom.length === 0 && (
                                              <div className="text-gray-600 text-sm italic text-center mt-10">Select cards from your hand to place here.</div>
                                          )}
                                      </div>
                                 </div>
                             </div>

                             <button 
                                onClick={confirmKeepHand}
                                disabled={cardsToBottom.length !== (freeMulligan ? Math.max(0, mulliganCount - 1) : mulliganCount)}
                                className="px-10 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold rounded-full shadow-lg transition-all"
                             >
                                 Confirm & Start Game
                             </button>
                         </div>
                     )}
                </div>
            )}


            {/* --- World Container --- */}
            <div 
                ref={containerRef}
                className="w-full h-full touch-none"
                style={{ cursor: isSpacePressed.current ? 'grab' : 'default' }}
                onPointerDown={handleContainerPointerDown}
                onPointerMove={handleContainerPointerMove}
                onPointerUp={handleContainerPointerUp}
                onWheel={handleWheel}
            >
                {/* Background Grid (Less visible now with wood) */}
                <div 
                    className="absolute inset-0 opacity-10 pointer-events-none bg-[radial-gradient(#ffffff33_1px,transparent_1px)]"
                    style={{ 
                        backgroundSize: `${20 * view.scale}px ${20 * view.scale}px`,
                        backgroundPosition: `${view.x}px ${view.y}px`
                    }} 
                />

                <div 
                    style={{ 
                        transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
                        transformOrigin: '0 0',
                        width: '0px', 
                        height: '0px',
                    }}
                >
                    <Playmat 
                        x={LOCAL_MAT_POS.x} y={LOCAL_MAT_POS.y} width={MAT_W} height={MAT_H} 
                        playerName={playerName} rotation={0}
                        zones={{library: ZONE_LIBRARY_OFFSET, graveyard: ZONE_GRAVEYARD_OFFSET, exile: ZONE_EXILE_OFFSET, command: ZONE_COMMAND_OFFSET}}
                        counts={{library: library.length, graveyard: graveyard.length, exile: exile.length, command: commandZone.length}}
                        sleeveColor={sleeveColor}
                        topGraveyardCard={graveyard[0]}
                        isShuffling={isShuffling}
                        commanders={commandZone}
                        onDraw={() => drawCard(1)}
                        onShuffle={shuffleLibrary}
                        onOpenSearch={openSearch}
                        onPlayCommander={playCommander}
                        onPlayTopLibrary={playTopLibrary}
                        onPlayTopGraveyard={playTopGraveyard}
                    />
                    <PlaymatGhost x={TOP_MAT_POS.x} y={TOP_MAT_POS.y} width={MAT_W} height={MAT_H} rotation={180} playerName="Opponent 1" />
                    <PlaymatGhost x={RIGHT_MAT_POS.x} y={RIGHT_MAT_POS.y} width={MAT_W} height={MAT_H} rotation={-90} playerName="Opponent 2" />
                    <PlaymatGhost x={LEFT_MAT_POS.x} y={LEFT_MAT_POS.y} width={MAT_W} height={MAT_H} rotation={90} playerName="Opponent 3" />

                    {boardObjects.map(obj => (
                        <div key={obj.id} className="pointer-events-auto"> 
                            <Card 
                                object={obj} 
                                sleeveColor={sleeveColor}
                                players={playersList} 
                                onUpdate={updateBoardObject} 
                                onBringToFront={(id) => { setMaxZ(p => p+1); updateBoardObject(id, {z: maxZ+1}); }}
                                onRelease={handleCardRelease}
                                onInspect={(card) => setInspectCard(card)}
                                onReturnToHand={returnToHand}
                                onUnstack={unstackCards}
                                onLog={addLog}
                            />
                        </div>
                    ))}
                </div>
            </div>

            {/* --- UI: Top Bar & Hand --- */}
            <div className="absolute top-0 left-0 right-0 h-16 bg-gray-900/90 border-b border-gray-700 flex items-center justify-between px-6 z-50 backdrop-blur-md">
                 <div className="flex items-center gap-6">
                    {/* ... (Existing Top Bar Content) ... */}
                    <div className="flex items-center gap-2">
                        <div 
                            className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg border-2 border-white/20 shadow-lg"
                            style={{ backgroundColor: sleeveColor }}
                        >
                            {playerName.charAt(0).toUpperCase()}
                        </div>
                        <div>
                            <div className="font-bold text-sm text-gray-200">{playerName}</div>
                            <div className="flex gap-2 text-xs">
                                <span className="text-gray-400">Life: {life}</span>
                                {/* Top Bar Incoming Commander Damage Indicators */}
                                <div className="flex gap-1 items-center ml-2 border-l border-gray-700 pl-2">
                                     {playersList.filter(p => p.id !== 'local-player').map(p => {
                                         const dmg = (commanderDamage[`cmd-${p.id}`] || {})['local-player'] || 0;
                                         if (dmg === 0) return null;
                                         return (
                                             <div key={p.id} className="flex items-center gap-0.5" title={`Damage from ${p.name}'s Commander`}>
                                                 <div className="w-2 h-2 rounded-full" style={{backgroundColor: p.color}}></div>
                                                 <span className={`font-bold ${dmg >= 21 ? 'text-red-500' : 'text-white'}`}>{dmg}</span>
                                             </div>
                                         )
                                     })}
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-3 bg-gray-800 rounded-lg p-1 px-3 border border-gray-600 shadow-inner">
                        <button onClick={() => {setLife(l => l - 1); addLog("lost 1 life");}} className="text-red-400 hover:text-red-300 font-bold text-xl px-2 active:scale-90 transition">-</button>
                        <div className="flex flex-col items-center min-w-[30px]">
                            <span className="text-xl font-bold text-white">{life}</span>
                            <span className="text-[9px] uppercase text-gray-400 tracking-wider">Life</span>
                        </div>
                        <button onClick={() => {setLife(l => l + 1); addLog("gained 1 life");}} className="text-green-400 hover:text-green-300 font-bold text-xl px-2 active:scale-90 transition">+</button>
                    </div>
                    
                    {/* Commanders & Turn Tracker */}
                    <div className="flex items-center gap-2 bg-gray-800 rounded-lg p-1 border border-gray-600 mx-2">
                         <div className="flex items-center gap-2 px-2 border-r border-gray-600">
                             <Clock size={16} className="text-gray-400"/>
                             <span className="text-sm font-bold text-white">Turn {turn}</span>
                         </div>
                         <div className="px-2 text-sm text-blue-400 font-bold max-w-[100px] truncate">
                             {playersList[activePlayerIndex].name}
                         </div>
                         <button onClick={nextTurn} className="p-1 hover:bg-gray-700 rounded text-green-400" title="Pass Turn">
                             <ChevronRight size={16} />
                         </button>
                    </div>
                    
                    <button 
                        onClick={() => setShowCmdrDamage(true)}
                        className="flex items-center gap-2 px-3 py-1 bg-gray-800 border border-gray-600 rounded hover:bg-gray-700 text-red-400"
                        title="Commander Damage"
                    >
                        <Swords size={20} />
                        <span className="text-xs font-bold uppercase hidden md:inline">Cmdr Dmg</span>
                    </button>
                    
                    <div className="w-px h-6 bg-gray-700 mx-2" />
                    
                    <button onClick={rollDice} className="flex items-center gap-2 px-3 py-1 bg-gray-800 border border-gray-600 rounded hover:bg-gray-700 text-yellow-500">
                        <Dices size={20} />
                        <span className="text-xs font-bold uppercase">Roll D6</span>
                    </button>
                    
                     <button onClick={spawnCounter} className="flex items-center gap-2 px-3 py-1 bg-gray-800 border border-gray-600 rounded hover:bg-gray-700 text-cyan-400">
                        <Disc size={20} />
                        <span className="text-xs font-bold uppercase">Add Counter</span>
                    </button>
                 </div>

                 <div className="flex items-center gap-3">
                    <button onClick={() => setView(v => ({...v, scale: Math.min(v.scale + 0.1, 3)}))} className="p-2 hover:bg-gray-700 rounded text-gray-300"><ZoomIn size={18}/></button>
                    <button onClick={() => setView(v => ({...v, scale: Math.max(v.scale - 0.1, 0.1)}))} className="p-2 hover:bg-gray-700 rounded text-gray-300"><ZoomOut size={18}/></button>
                    <div className="w-px h-6 bg-gray-700 mx-2" />
                    <button 
                         onClick={() => setShowShortcuts(true)}
                         className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white"
                         title="Keyboard Shortcuts"
                    >
                        <Keyboard size={20} />
                    </button>
                    <button 
                        onClick={() => setIsLogOpen(!isLogOpen)}
                        className={`p-2 rounded-lg transition-colors ${isLogOpen ? 'bg-blue-600 text-white' : 'hover:bg-gray-800 text-gray-400'}`}
                        title="Game Log"
                    >
                        <History size={20} />
                    </button>
                    <button 
                        onClick={() => setIsJudgeOpen(!isJudgeOpen)} 
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${isJudgeOpen ? 'bg-purple-600 border-purple-500 text-white' : 'bg-gray-800 border-gray-600 text-gray-300 hover:bg-gray-700'}`}
                    >
                        <MessageSquare size={16} />
                        Judge
                    </button>
                    <button onClick={onExit} className="flex items-center gap-2 px-4 py-2 bg-red-900/50 hover:bg-red-900/80 border border-red-800 text-red-200 rounded-lg transition-colors">
                        <LogOut size={16} />
                        Leave
                    </button>
                 </div>
            </div>

            {gamePhase !== 'SETUP' && (
                <>
                <div className="absolute bottom-0 left-0 right-0 z-50 flex flex-col items-center pointer-events-none">
                    <div className="w-full h-48 bg-gradient-to-t from-black via-black/80 to-transparent pointer-events-none absolute bottom-0" />
                    <div className="relative w-full px-8 pb-4 flex items-end justify-center pointer-events-auto">
                        <div className="flex gap-2 items-end min-w-min px-4 overflow-x-auto overflow-y-hidden custom-scrollbar pb-2" style={{ maxWidth: '85vw' }}>
                            {hand.map((card, idx) => (
                                <HandCard 
                                    key={card.id} 
                                    card={card} 
                                    scale={handScale}
                                    onInspect={setInspectCard} 
                                    onPlay={playCardFromHand} 
                                    onSendToZone={sendToZone}
                                />
                            ))}
                        </div>
                        {hand.length === 0 && tokens.length === 0 && <div className="h-48 flex items-center text-gray-500 italic relative z-10">Hand is empty</div>}
                    </div>
                </div>
                
                <div className="absolute bottom-6 right-6 z-[60] flex flex-col items-center bg-gray-800/80 backdrop-blur rounded-lg p-2 border border-gray-600">
                    <Settings size={16} className="text-gray-400 mb-2" />
                    <input 
                        type="range" 
                        min="0.5" 
                        max="1.5" 
                        step="0.1" 
                        value={handScale}
                        onChange={(e) => setHandScale(parseFloat(e.target.value))}
                        className="h-24 w-1 bg-gray-600 rounded-lg appearance-none cursor-pointer vertical-range"
                        style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
                    />
                </div>

                <div className="absolute bottom-60 right-6 z-40 flex flex-col items-end gap-2">
                    {tokens.length > 0 && (
                        <div className="flex flex-col items-end pointer-events-auto">
                            <div className="text-yellow-500 text-xs font-bold uppercase mb-2 mr-2 bg-black/50 px-2 rounded">Tokens</div>
                            <div className="flex gap-2">
                                {tokens.map((card, idx) => (
                                    <div 
                                        key={card.id}
                                        className="relative w-24 h-32 hover:scale-125 hover:z-50 cursor-pointer shadow-lg rounded-lg border border-yellow-500 bg-gray-800 origin-bottom-right transition-transform"
                                        onClick={() => setInspectCard(card)}
                                    >
                                        <img src={card.imageUrl} className="w-full h-full object-cover rounded-lg" alt={card.name} />
                                        <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 bg-black/60 rounded-lg">
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); playCardFromHand(card); }}
                                                className="bg-yellow-600 text-black font-bold text-xs px-2 py-1 rounded"
                                            >
                                                Create
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    <button 
                        onClick={() => openSearch('TOKENS')}
                        className="flex items-center gap-2 bg-yellow-600/20 border border-yellow-600/50 hover:bg-yellow-600/40 text-yellow-200 px-4 py-2 rounded-full backdrop-blur transition shadow-lg pointer-events-auto"
                    >
                        <Layers size={18} /> Tokens
                    </button>
                </div>
                </>
            )}

            <JudgeChat isOpen={isJudgeOpen} onClose={() => setIsJudgeOpen(false)} />
            
            {showCmdrDamage && (
                 <div className="fixed inset-0 z-[10000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                     <div className="bg-gray-900 border border-red-900/50 rounded-xl w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95">
                         <div className="bg-red-900/20 p-4 border-b border-red-900/30 flex justify-between items-center">
                             <h3 className="font-bold text-red-100 flex items-center gap-2"><Swords className="text-red-500"/> Incoming Commander Damage</h3>
                             <button onClick={() => setShowCmdrDamage(false)} className="hover:text-white text-gray-400"><X /></button>
                         </div>
                         <div className="p-6 grid gap-4 max-h-[60vh] overflow-y-auto">
                            <p className="text-gray-400 text-xs italic text-center mb-2">Track damage YOU have taken from Opponent Commanders.</p>
                            {playersList.filter(p => p.id !== 'local-player').map(p => {
                                 // Simulate Opponent Commander IDs since they don't exist as objects in this local-only view
                                 const oppCommanderId = `cmd-${p.id}`; 
                                 const currentDmg = (commanderDamage[oppCommanderId] || {})['local-player'] || 0;
                                 
                                 return (
                                    <div key={p.id} className="flex items-center justify-between bg-gray-800 p-3 rounded border border-gray-700">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full border-2 border-white/20" style={{backgroundColor: p.color}} />
                                            <div>
                                                <div className="font-bold text-gray-300">{p.name}</div>
                                                <div className="text-[10px] text-gray-500 uppercase">Damage Source</div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                             <button 
                                                onClick={() => updateCommanderDamage(oppCommanderId, 'local-player', -1)}
                                                className="w-8 h-8 rounded bg-gray-700 hover:bg-gray-600 flex items-center justify-center text-red-400"
                                             >
                                                 <Minus size={16}/>
                                             </button>
                                             <span className={`text-xl font-bold w-8 text-center ${currentDmg >= 21 ? 'text-red-500' : 'text-white'}`}>{currentDmg}</span>
                                             <button 
                                                onClick={() => updateCommanderDamage(oppCommanderId, 'local-player', 1)}
                                                className="w-8 h-8 rounded bg-gray-700 hover:bg-gray-600 flex items-center justify-center text-green-400"
                                             >
                                                 <Plus size={16}/>
                                             </button>
                                        </div>
                                    </div>
                                 )
                            })}
                            {playersList.filter(p => p.id !== 'local-player').length === 0 && <div className="text-center text-gray-500">No opponents found.</div>}
                         </div>
                     </div>
                 </div>
            )}
            
            {showShortcuts && (
                <div className="fixed inset-0 z-[11000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowShortcuts(false)}>
                    <div className="bg-gray-800 border border-gray-600 rounded-xl p-6 shadow-2xl max-w-md w-full animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                <Keyboard className="text-blue-400"/> Keyboard Shortcuts
                            </h3>
                            <button onClick={() => setShowShortcuts(false)} className="text-gray-400 hover:text-white"><X size={20}/></button>
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded">
                                <span className="text-gray-300">Draw Card</span>
                                <kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">D</kbd>
                            </div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded">
                                <span className="text-gray-300">Untap All</span>
                                <kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">U</kbd>
                            </div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded">
                                <span className="text-gray-300">Shuffle Library</span>
                                <kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">S</kbd>
                            </div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded">
                                <span className="text-gray-300">Toggle Log</span>
                                <kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">L</kbd>
                            </div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded">
                                <span className="text-gray-300">Judge Chat</span>
                                <kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">J</kbd>
                            </div>
                             <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded">
                                <span className="text-gray-300">Help / Shortcuts</span>
                                <kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">?</kbd>
                            </div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded col-span-2">
                                <span className="text-gray-300">Pan Camera</span>
                                <kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">Space (Hold) + Drag</kbd>
                            </div>
                             <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded col-span-2">
                                <span className="text-gray-300">Zoom Camera</span>
                                <kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">Mouse Wheel</kbd>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {libraryAction.isOpen && (
                <div className="fixed inset-0 z-[10000] bg-black/50 backdrop-blur-sm flex items-center justify-center">
                    <div className="bg-gray-800 border border-gray-600 rounded-xl p-6 shadow-2xl max-w-sm w-full">
                        <h3 className="text-xl font-bold text-white mb-4">Move to Library</h3>
                        <p className="text-gray-400 mb-6">Where should this card go?</p>
                        <div className="flex flex-col gap-3">
                            <button onClick={() => resolveLibraryAction('TOP')} className="flex items-center gap-3 bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-lg"><ArrowUp /> Top of Library</button>
                            <button onClick={() => resolveLibraryAction('BOTTOM')} className="flex items-center gap-3 bg-gray-700 hover:bg-gray-600 text-white p-3 rounded-lg"><ArrowDown /> Bottom of Library</button>
                            <button onClick={() => resolveLibraryAction('SHUFFLE')} className="flex items-center gap-3 bg-purple-600 hover:bg-purple-700 text-white p-3 rounded-lg"><Shuffle /> Shuffle In</button>
                        </div>
                        <button onClick={() => setLibraryAction({isOpen: false, cardId: ''})} className="mt-4 w-full text-center text-gray-500 hover:text-white">Cancel</button>
                    </div>
                </div>
            )}
            
            {inspectCard && (
                <div 
                    className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 backdrop-blur-sm p-8 animate-in fade-in duration-200"
                    onClick={() => setInspectCard(null)}
                >
                    <div className="relative flex flex-col items-center">
                        <img 
                            src={inspectCard.imageUrl || "https://i.imgur.com/32R3w2i.png"} 
                            className="max-h-[80vh] rounded-xl shadow-2xl"
                            alt="Preview"
                        />
                        <button className="mt-4 bg-red-600 text-white px-6 py-2 rounded-full font-semibold hover:bg-red-500" onClick={() => setInspectCard(null)}>Close</button>
                    </div>
                </div>
            )}

             {searchModal.isOpen && (
                <div className="fixed inset-0 z-[9000] bg-gray-900/95 backdrop-blur-xl flex flex-col p-8 animate-in fade-in">
                    {/* Sticky Header */}
                    <div className="flex justify-between items-center mb-6 pb-4 border-b border-gray-700 sticky top-0 bg-gray-900/95 z-10">
                        <div className="flex items-center gap-4">
                            <Search className="text-blue-400" size={32} />
                            <div>
                                <h2 className="text-3xl font-bold text-white capitalize flex items-center gap-3">
                                    {searchModal.source === 'TOKENS' ? 'Search Tokens' : searchModal.source.toLowerCase()}
                                    {searchModal.source !== 'TOKENS' && <span className="text-gray-500 text-lg">({searchModal.items.length} cards)</span>}
                                </h2>
                                {searchModal.source === 'TOKENS' && (
                                    <div className="flex gap-2 mt-2">
                                        <input 
                                            className="bg-gray-800 border border-gray-600 rounded px-3 py-1 text-white"
                                            placeholder="e.g. Goblin, Treasure"
                                            value={tokenSearchTerm}
                                            onChange={(e) => setTokenSearchTerm(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && searchTokens()}
                                        />
                                        <button onClick={searchTokens} className="bg-blue-600 px-3 py-1 rounded text-white">Search</button>
                                    </div>
                                )}
                            </div>
                        </div>
                        
                        <div className="flex items-center gap-4">
                            {searchModal.source === 'LIBRARY' && (
                                <>
                                    <button onClick={revealAll} className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-white transition">
                                        <Eye size={16}/> Reveal All
                                    </button>
                                    <button onClick={shuffleAndClose} className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-white transition shadow-lg shadow-purple-900/50">
                                        <Shuffle size={16}/> Shuffle & Close
                                    </button>
                                </>
                            )}
                            <button onClick={() => setSearchModal({...searchModal, isOpen: false})} className="p-2 hover:bg-gray-800 rounded-full text-gray-400 hover:text-white"><X size={32} /></button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto pr-2 pb-60">
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
                            {searchModal.items.map((item, idx) => (
                                <div key={item.card.id} className="relative group aspect-[2.5/3.5] bg-gray-800 rounded-lg">
                                    {/* Position Badge */}
                                    {searchModal.source !== 'TOKENS' && (
                                        <div className="absolute top-2 left-2 z-10 bg-black/70 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-white/20">
                                            #{idx + 1}
                                        </div>
                                    )}

                                    {item.isRevealed ? (
                                        <img src={item.card.imageUrl} className="w-full h-full object-cover rounded-lg border border-gray-700 group-hover:border-blue-500 transition-colors" alt={item.card.name} />
                                    ) : (
                                        <div 
                                            className="w-full h-full rounded-lg border-2 border-white/10 flex items-center justify-center cursor-pointer hover:border-blue-400 transition"
                                            style={{ backgroundColor: sleeveColor }}
                                            onClick={() => toggleRevealItem(idx)}
                                        >
                                            <div className="w-10 h-10 rounded-full bg-black/20" />
                                        </div>
                                    )}
                                    <div className={`absolute inset-0 bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-center items-center gap-2 p-2 rounded-lg ${!item.isRevealed && 'pointer-events-none'}`}>
                                        {item.isRevealed ? (
                                            <>
                                                <div className="text-xs text-gray-300 font-semibold mb-1 text-center line-clamp-1">{item.card.name}</div>
                                                {searchModal.source === 'TOKENS' ? (
                                                    <button onClick={() => handleSearchAction(item.card.id, 'HAND')} className="w-full text-xs flex items-center gap-2 bg-blue-700 hover:bg-blue-600 px-2 py-1.5 rounded"><Hand size={12} /> Add to Hand</button>
                                                ) : (
                                                    <button onClick={() => addToTray(item.card.id)} className="w-full text-xs flex items-center gap-2 bg-green-700 hover:bg-green-600 px-2 py-1.5 rounded"><ArrowDown size={12} /> Add to Tray</button>
                                                )}
                                            </>
                                        ) : (
                                            <div className="text-white text-xs font-bold pointer-events-auto">Click to Reveal</div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* --- Bottom Tray --- */}
                    {searchModal.source !== 'TOKENS' && (
                        <div className="absolute bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-700 p-4 h-80 flex flex-col shadow-2xl z-20">
                            <div className="flex justify-between items-center mb-2">
                                <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wide flex items-center gap-2">
                                    <Layers size={14} /> Selected Cards Tray ({searchModal.tray.length})
                                </h3>
                                <div className="flex gap-2">
                                    <button onClick={() => handleTrayAction('HAND')} disabled={searchModal.tray.length===0} className="px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-xs text-white font-bold flex items-center gap-1"><Hand size={12}/> Hand</button>
                                    <button onClick={() => handleTrayAction('GRAVEYARD')} disabled={searchModal.tray.length===0} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded text-xs text-white font-bold flex items-center gap-1"><Archive size={12}/> Grave</button>
                                    <button onClick={() => handleTrayAction('EXILE')} disabled={searchModal.tray.length===0} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded text-xs text-white font-bold flex items-center gap-1"><X size={12}/> Exile</button>
                                    <div className="w-px h-6 bg-gray-700 mx-2" />
                                    <button onClick={() => handleTrayAction('TOP')} disabled={searchModal.tray.length===0} className="px-3 py-1 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded text-xs text-white font-bold flex items-center gap-1"><ArrowUp size={12}/> Top Lib</button>
                                    <button onClick={() => handleTrayAction('BOTTOM')} disabled={searchModal.tray.length===0} className="px-3 py-1 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded text-xs text-white font-bold flex items-center gap-1"><ArrowDown size={12}/> Bot Lib</button>
                                    <button onClick={() => handleTrayAction('SHUFFLE')} disabled={searchModal.tray.length===0} className="px-3 py-1 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded text-xs text-white font-bold flex items-center gap-1"><Shuffle size={12}/> Shuffle In</button>
                                </div>
                            </div>
                            
                            <div className="flex-1 bg-gray-800/50 rounded-lg border-2 border-dashed border-gray-700 flex items-center px-4 overflow-x-auto gap-4">
                                {searchModal.tray.length === 0 ? (
                                    <div className="text-gray-500 text-sm italic w-full text-center">Add cards from above to perform actions on them. Left is Top, Right is Bottom.</div>
                                ) : (
                                    searchModal.tray.map((card, idx) => (
                                        <div key={card.id} className="relative flex-shrink-0 group w-24 aspect-[2.5/3.5] bg-gray-800 rounded">
                                            <img src={card.imageUrl} className="w-full h-full object-cover rounded" />
                                            {/* Hover Controls */}
                                            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex flex-col justify-between p-1 transition-opacity">
                                                 <div className="flex justify-end">
                                                     <button onClick={() => removeFromTray(card.id)} className="bg-red-500 hover:bg-red-400 p-1 rounded-full text-white"><X size={10}/></button>
                                                 </div>
                                                 <div className="flex justify-between mt-auto">
                                                     <button onClick={() => onTrayReorder(idx, 'LEFT')} disabled={idx===0} className="bg-gray-700 hover:bg-gray-600 disabled:opacity-30 p-1 rounded text-white"><ChevronLeft size={12}/></button>
                                                     <button onClick={() => onTrayReorder(idx, 'RIGHT')} disabled={idx===searchModal.tray.length-1} className="bg-gray-700 hover:bg-gray-600 disabled:opacity-30 p-1 rounded text-white"><ChevronRight size={12}/></button>
                                                 </div>
                                            </div>
                                            {/* Order Badge */}
                                            <div className="absolute -top-2 -left-2 bg-blue-600 text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full border border-gray-900 z-10">
                                                {idx + 1}
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
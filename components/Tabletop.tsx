import React, { useState, useRef, useEffect } from 'react';
import { CardData, BoardObject, LogEntry } from '../types';
import { Card } from './Card';
import { JudgeChat } from './JudgeChat';
import { searchCards } from '../services/scryfall';
import { socket } from '../services/socket';
import { CARD_WIDTH, CARD_HEIGHT } from '../constants';
import { 
    LogOut, MessageSquare, Search, ZoomIn, ZoomOut, History, ArrowUp, ArrowDown, 
    Archive, X, Eye, Shuffle, Crown, Dices, Layers, ChevronRight, Hand, Play, Settings, Swords,
    Clock, Users, CheckCircle, Ban, ArrowRight, Disc, ChevronLeft, Trash2, ArrowLeft, Minus, Plus, Keyboard, RefreshCw
} from 'lucide-react';

interface TabletopProps {
    initialDeck: CardData[];
    initialTokens: CardData[];
    playerName: string;
    sleeveColor?: string;
    roomId: string;
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

export const Tabletop: React.FC<TabletopProps> = ({ initialDeck, initialTokens, playerName, sleeveColor = '#ef4444', roomId, onExit }) => {
    // --- State Declarations (Consolidated) ---
    const [gamePhase, setGamePhase] = useState<'SETUP' | 'MULLIGAN' | 'PLAYING'>('SETUP');
    const [mulligansAllowed, setMulligansAllowed] = useState(true);
    const [freeMulligan, setFreeMulligan] = useState(true);
    const [mulliganCount, setMulliganCount] = useState(0);
    const [mulliganSelectionMode, setMulliganSelectionMode] = useState(false);
    const [cardsToBottom, setCardsToBottom] = useState<CardData[]>([]);

    const [turnStartTime, setTurnStartTime] = useState(Date.now());
    const [elapsedTime, setElapsedTime] = useState(0);
    const [round, setRound] = useState(1);
    const [turn, setTurn] = useState(1);
    const [activePlayerIndex, setActivePlayerIndex] = useState(0);

    const [playersList, setPlayersList] = useState<{id: string, name: string, color: string, socketId?: string}[]>([
        { id: 'local-player', name: playerName, color: sleeveColor }
    ]);

    const [boardObjects, setBoardObjects] = useState<BoardObject[]>([]);
    const [hand, setHand] = useState<CardData[]>([]);
    const [tokens, setTokens] = useState<CardData[]>(initialTokens); 
    const [library, setLibrary] = useState<CardData[]>([]);
    const [graveyard, setGraveyard] = useState<CardData[]>([]);
    const [exile, setExile] = useState<CardData[]>([]);
    const [commandZone, setCommandZone] = useState<CardData[]>([]);
    const [life, setLife] = useState(40);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [commanderDamage, setCommanderDamage] = useState<Record<string, Record<string, number>>>({}); 
    
    // UI State
    const [isJudgeOpen, setIsJudgeOpen] = useState(false);
    const [isLogOpen, setIsLogOpen] = useState(false);
    const [showShortcuts, setShowShortcuts] = useState(false);
    const [view, setView] = useState<ViewState>({ x: window.innerWidth / 2, y: window.innerHeight / 2, scale: 0.5 });
    
    // Opponent View State
    const [isOpponentViewOpen, setIsOpponentViewOpen] = useState(false);
    const [opponentView, setOpponentView] = useState<ViewState>({ x: 0, y: 0, scale: 0.6 });
    const [selectedOpponentIndex, setSelectedOpponentIndex] = useState(0);
    const opponentIds = ['opponent-top', 'opponent-right', 'opponent-left'];

    const [maxZ, setMaxZ] = useState(100);
    const [isShuffling, setIsShuffling] = useState(false);
    const [statusMessage, setStatusMessage] = useState<string>("");
    const [handScale, setHandScale] = useState(1);
    
    // Modal States
    const [inspectCard, setInspectCard] = useState<CardData | null>(null);
    const [searchModal, setSearchModal] = useState<SearchState>({ isOpen: false, source: 'LIBRARY', items: [], tray: [] });
    const [tokenSearchTerm, setTokenSearchTerm] = useState("token");
    const [libraryAction, setLibraryAction] = useState<LibraryActionState>({ isOpen: false, cardId: '' });
    const [showCmdrDamage, setShowCmdrDamage] = useState(false);
    const [isHost, setIsHost] = useState(false);

    // Refs
    const dragStartRef = useRef<{ x: number, y: number } | null>(null);
    const opponentDragStartRef = useRef<{ x: number, y: number } | null>(null);
    const isSpacePressed = useRef(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const opponentContainerRef = useRef<HTMLDivElement>(null);
    
    // View Control Refs
    const isDraggingView = useRef(false);
    const lastMousePos = useRef({ x: 0, y: 0 });
    const isDraggingOpponentView = useRef(false);
    const lastOpponentMousePos = useRef({ x: 0, y: 0 });
    
    // State Refs for Socket Handlers
    const libraryRef = useRef(library);
    const activePlayerIndexRef = useRef(activePlayerIndex);
    const playersListRef = useRef(playersList);
    
    useEffect(() => { libraryRef.current = library; }, [library]);
    useEffect(() => { activePlayerIndexRef.current = activePlayerIndex; }, [activePlayerIndex]);
    useEffect(() => { playersListRef.current = playersList; }, [playersList]);

    // --- Helper Logic ---
    const emitAction = (action: string, data: any) => {
        let payload = data;
        if (action === 'ADD_OBJECT' && data.controllerId === 'local-player') {
            payload = { ...data, controllerId: socket.id };
        } else if (action === 'UPDATE_OBJECT' && data.updates && data.updates.controllerId === 'local-player') {
            payload = { ...data, updates: { ...data.updates, controllerId: socket.id } };
        }
        socket.emit('game_action', { room: roomId, action, data: payload });
    };

    const addLog = (message: string, type: 'ACTION' | 'SYSTEM' = 'ACTION', overrideName?: string) => {
        const entry: LogEntry = {
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            playerId: overrideName ? 'remote' : 'local',
            playerName: overrideName || playerName,
            message,
            type
        };
        setLogs(prev => [entry, ...prev]);
        setStatusMessage(`${overrideName || playerName} ${message.toLowerCase()}`);
        setTimeout(() => setStatusMessage(""), 3000);
        
        if (!overrideName) {
             emitAction('LOG', { message });
        }
    };

    // --- Socket Logic ---
    useEffect(() => {
        const handleRoomUpdate = (roomPlayers: any[]) => {
            console.log("Room Update Received:", roomPlayers); // LOG
            const myId = socket.id;
            const myIndex = roomPlayers.findIndex(p => p.id === myId);
            if (myIndex === -1) {
                console.warn("Local player not found in room update!"); // LOG
                return;
            }

            const isNowHost = myIndex === 0;
            console.log(`Setting isHost to ${isNowHost} (Index: ${myIndex})`); // LOG
            setIsHost(isNowHost);

            const count = roomPlayers.length;
            const getPlayerAt = (offset: number) => roomPlayers[(myIndex + offset) % count];

            const newPlayers = [];
            newPlayers.push({ id: 'local-player', name: roomPlayers[myIndex].name, color: roomPlayers[myIndex].color, socketId: roomPlayers[myIndex].id });

            if (count > 1) {
                const p = getPlayerAt(1);
                newPlayers.push({ id: 'opponent-left', name: p.name, color: p.color, socketId: p.id });
            }
            if (count > 2) {
                const p = getPlayerAt(2);
                newPlayers.push({ id: 'opponent-top', name: p.name, color: p.color, socketId: p.id });
            }
            if (count > 3) {
                const p = getPlayerAt(3);
                newPlayers.push({ id: 'opponent-right', name: p.name, color: p.color, socketId: p.id });
            }
            setPlayersList(newPlayers);
        };

        const handleAction = ({ action, data, playerId }: { action: string, data: any, playerId: string }) => {
             console.log(`Game Action Received: ${action} from ${playerId}`, data); // LOG
             const currentPlayers = playersListRef.current;
             const sender = currentPlayers.find(p => p.socketId === playerId);
             const senderId = sender ? sender.id : 'unknown';

             if (action === 'START_GAME') {
                 console.log("START_GAME action triggering handleStartGameLogic"); // LOG
                 handleStartGameLogic(data);
             }
             else if (action === 'PASS_TURN') {
                 if (data.nextPlayerIndex !== undefined) {
                     setActivePlayerIndex(data.nextPlayerIndex);
                     setTurn(data.turnNumber);
                     setTurnStartTime(Date.now());
                     const nextName = currentPlayers[data.nextPlayerIndex]?.name || 'Unknown';
                     addLog(`Turn passed to ${nextName}`);
                 }
             }
             else if (action === 'ADD_OBJECT') {
                setBoardObjects(prev => {
                    if (prev.some(o => o.id === data.id)) return prev; 
                    
                    // TRANSFORM COORDINATES
                    let x = data.x;
                    let y = data.y;
                    let rotation = data.rotation;
                    
                    // Transform based on who sent it relative to us
                    if (senderId === 'opponent-top') {
                        x = -x; y = -y; rotation = (rotation + 180) % 360;
                    } else if (senderId === 'opponent-left') {
                        // If sender is Left (-X), their UP is our RIGHT (+X). 
                        // It's a 90 deg rotation relative to center?
                        // If I am at Bottom. Left is -90 deg.
                        // If they send (0,0), it's center.
                        // If they send (0, 100) (Up for them), it should go Right for me? No.
                        // Standard: Rotate (x,y) by the seat difference angle.
                        // Left is +90 or -90?
                        // Let's assume standard math rotation.
                        // Rotate 90 deg CW: (x, y) -> (-y, x).
                        // Rotate 90 deg CCW: (x, y) -> (y, -x).
                        
                        // If sender is 'opponent-left' (Left side).
                        // We need to rotate their coords so they appear on the left?
                        // No, they are SENDING coords in THEIR canonical view (Bottom).
                        // We need to move them to the LEFT.
                        // So rotate -90 deg?
                        // (0, 100) [Their Up] -> (100, 0) [My Right].
                        // Wait, if they push UP (towards center), it should go towards center.
                        // Their UP is (0, -100) in DOM coords (Y is down).
                        // If they send (0, -100).
                        // I want to see it coming from Left (-100, 0).
                        // (0, -100) -> (-100, 0).
                        // This is swap and sign change.
                        // If x=0, y=-100 -> x'=-100, y'=0. => x'=y, y'=x? No.
                        
                        // Let's stick to simple:
                        // Top: x' = -x, y' = -y.
                        // Left: x' = y, y' = -x.
                        // Right: x' = -y, y' = x.
                        
                        const tempX = x;
                        x = y;
                        y = -tempX;
                        rotation = (rotation + 90) % 360;
                    } else if (senderId === 'opponent-right') {
                        const tempX = x;
                        x = -y;
                        y = tempX;
                        rotation = (rotation - 90) % 360;
                    }

                    const mappedObj = { ...data, x, y, rotation, controllerId: senderId };
                    return [...prev, mappedObj];
                });
            } else if (action === 'UPDATE_OBJECT') {
                 setBoardObjects(prev => prev.map(o => {
                     if (o.id === data.id) {
                         let updates = { ...data.updates };
                         
                         // Transform Updates if position changed
                         if (updates.x !== undefined || updates.y !== undefined) {
                             let x = updates.x !== undefined ? updates.x : o.x;
                             let y = updates.y !== undefined ? updates.y : o.y;
                             let rotation = updates.rotation !== undefined ? updates.rotation : o.rotation;
                             
                             // We need to transform the INCOMING raw coordinates again?
                             // Sender sends RAW (their view).
                             // We re-apply transform.
                             
                             if (senderId === 'opponent-top') {
                                 if(updates.x !== undefined) updates.x = -updates.x;
                                 if(updates.y !== undefined) updates.y = -updates.y;
                                 if(updates.rotation !== undefined) updates.rotation = (updates.rotation + 180) % 360;
                             } else if (senderId === 'opponent-left') {
                                 if(updates.x !== undefined || updates.y !== undefined) {
                                     // Need both to rotate
                                     const rawX = updates.x !== undefined ? updates.x : 0; // Delta? No absolute.
                                     const rawY = updates.y !== undefined ? updates.y : 0;
                                     // This is tricky for partial updates.
                                     // Assume full position update or sync drift.
                                     // Let's just apply the transform logic to the updates if present.
                                     // But UPDATE_OBJECT sends absolute new pos.
                                     const tx = rawX; const ty = rawY;
                                     updates.x = ty;
                                     updates.y = -tx;
                                 }
                                 if(updates.rotation !== undefined) updates.rotation = (updates.rotation + 90) % 360;
                             } else if (senderId === 'opponent-right') {
                                 if(updates.x !== undefined || updates.y !== undefined) {
                                     const rawX = updates.x !== undefined ? updates.x : 0;
                                     const rawY = updates.y !== undefined ? updates.y : 0;
                                     updates.x = -rawY;
                                     updates.y = rawX;
                                 }
                                 if(updates.rotation !== undefined) updates.rotation = (updates.rotation - 90) % 360;
                             }
                         }

                         if (updates.controllerId) {
                             const newController = currentPlayers.find(p => p.socketId === updates.controllerId);
                             updates.controllerId = newController ? newController.id : updates.controllerId;
                         }
                         return { ...o, ...updates };
                     }
                     return o;
                 }));
            } else if (action === 'REMOVE_OBJECT') {
                setBoardObjects(prev => prev.filter(o => o.id !== data.id));
            } else if (action === 'LOG') {
                addLog(data.message, 'ACTION', sender ? sender.name : 'Unknown');
            }
        };

        socket.on('room_players_update', handleRoomUpdate);
        socket.on('game_action', handleAction);
        
        socket.emit('get_players', { room: roomId });

        return () => {
            socket.off('room_players_update', handleRoomUpdate);
            socket.off('game_action', handleAction);
        };
    }, []);

    // --- Initialization ---
    useEffect(() => {
        const commanders = initialDeck.filter(c => c.isCommander);
        const deck = initialDeck.filter(c => !c.isCommander);
        const shuffled = [...deck].sort(() => Math.random() - 0.5);
        
        setLibrary(shuffled);
        setCommandZone(commanders);
        setHand([]);
        setGraveyard([]);
        setExile([]);

        const matCenterY = LOCAL_MAT_POS.y + MAT_H / 2;
        const startScale = 0.8;
        setView({
            x: window.innerWidth / 2, 
            y: window.innerHeight / 2 - (matCenterY * startScale),
            scale: startScale
        });
    }, [initialDeck]);
    
    // Auto-center opponent view
    useEffect(() => {
        if (isOpponentViewOpen) {
            const oppId = opponentIds[selectedOpponentIndex];
            let targetX = 0; let targetY = 0; let rotation = 0;

            if (oppId === 'opponent-top') {
                targetX = TOP_MAT_POS.x + MAT_W / 2; targetY = TOP_MAT_POS.y + MAT_H / 2; rotation = 180;
            } else if (oppId === 'opponent-right') {
                targetX = RIGHT_MAT_POS.x + MAT_W / 2; targetY = RIGHT_MAT_POS.y + MAT_H / 2; rotation = -90;
            } else if (oppId === 'opponent-left') {
                targetX = LEFT_MAT_POS.x + MAT_W / 2; targetY = LEFT_MAT_POS.y + MAT_H / 2; rotation = 90;
            }

            const paneW = window.innerWidth / 2;
            const paneH = window.innerHeight;
            const rad = rotation * Math.PI / 180;
            const rx = targetX * Math.cos(rad) - targetY * Math.sin(rad);
            const ry = targetX * Math.sin(rad) + targetY * Math.cos(rad);
            const s = 0.6;
            const vx = (paneW / 2) - s * rx;
            const vy = (paneH / 2) - s * ry;
            
            setOpponentView({ x: vx, y: vy, scale: s });
        }
    }, [isOpponentViewOpen, selectedOpponentIndex]);

    // Timer
    useEffect(() => {
        if (gamePhase === 'SETUP') return;
        const interval = setInterval(() => {
            setElapsedTime(Date.now() - turnStartTime);
        }, 1000);
        return () => clearInterval(interval);
    }, [turnStartTime, gamePhase]);

    // --- Game Flow Methods ---
    const handleStartGameLogic = (options?: { mulligansAllowed: boolean }) => {
         const shouldUseMulligans = options?.mulligansAllowed ?? true;
         setMulligansAllowed(shouldUseMulligans);
         
         const lib = libraryRef.current;
         if (lib.length >= 7) {
             const initialHand = lib.slice(0, 7);
             const remaining = lib.slice(7);
             setHand(initialHand);
             setLibrary(remaining);
         }
         
         setTurnStartTime(Date.now());
         addLog("Game Started", "SYSTEM", "Host");

         if (shouldUseMulligans) {
             setGamePhase('MULLIGAN');
         } else {
             setGamePhase('PLAYING');
         }
    };

    const startGame = () => {
        if (!isHost) return;
        emitAction('START_GAME', { mulligansAllowed });
        handleStartGameLogic({ mulligansAllowed });
    };

    const handleMulliganChoice = (keep: boolean) => {
        if (keep) {
            let toBottomCount = mulliganCount;
            if (freeMulligan && mulliganCount > 0) {
                 toBottomCount = mulliganCount - 1;
            }

            if (toBottomCount > 0) {
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
            setCardsToBottom(prev => prev.filter(c => c.id !== card.id));
        } else {
            if (cardsToBottom.length < requiredCount) {
                setCardsToBottom(prev => [...prev, card]);
            }
        }
    };

    const confirmKeepHand = () => {
        const requiredCount = freeMulligan ? Math.max(0, mulliganCount - 1) : mulliganCount;
        if (cardsToBottom.length !== requiredCount) return;
        
        const newHand = hand.filter(h => !cardsToBottom.find(b => b.id === h.id));
        setHand(newHand);
        
        setLibrary(prev => [...prev, ...cardsToBottom]);
        
        setGamePhase('PLAYING');
        addLog(`kept hand and put ${requiredCount} cards on bottom`);
        setMulliganSelectionMode(false);
    };
    
    const nextTurn = () => {
        const nextIndex = (activePlayerIndex + 1) % playersList.length;
        const nextTurnNum = nextIndex === 0 ? turn + 1 : turn;
        emitAction('PASS_TURN', { nextPlayerIndex: nextIndex, turnNumber: nextTurnNum });
    };

    const formatTime = (ms: number) => {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    // ... (Keep existing interaction methods: updateBoardObject, playCardFromHand, etc. - I will paste them below) ...
    // NOTE: For brevity in this write_file, I am pasting the previously implemented logic but ensuring no duplication.

    const untapAll = () => {
        setBoardObjects(prev => prev.map(o => o.controllerId === 'local-player' ? { ...o, rotation: 0, tappedQuantity: 0 } : o));
        addLog("untapped all permanents");
    };

    const unstackCards = (id: string) => {
        const obj = boardObjects.find(o => o.id === id);
        if (!obj || obj.quantity <= 1) return;
        const newObjects: BoardObject[] = [];
        for(let i = 1; i < obj.quantity; i++) {
            newObjects.push({
                ...obj, id: crypto.randomUUID(), quantity: 1, tappedQuantity: 0,
                x: obj.x + (i * 20), y: obj.y + (i * 20), z: maxZ + i
            });
        }
        setMaxZ(prev => prev + obj.quantity);
        setBoardObjects(prev => [
            ...prev.map(o => o.id === id ? {...o, quantity: 1, tappedQuantity: 0} : o),
            ...newObjects
        ]);
        emitAction('UPDATE_OBJECT', { id, updates: { quantity: 1, tappedQuantity: 0 } });
        newObjects.forEach(newObj => emitAction('ADD_OBJECT', newObj));
        addLog(`unstacked ${obj.cardData.name}`);
    };

    const updateBoardObject = (id: string, updates: Partial<BoardObject>) => {
        setBoardObjects(prev => {
            const movingObj = prev.find(o => o.id === id);
            let nextState = prev;
            const changes: {id: string, updates: Partial<BoardObject>}[] = [];
            
            if (movingObj && movingObj.type === 'CARD' && updates.x !== undefined && updates.y !== undefined) {
                 const dx = updates.x - movingObj.x;
                 const dy = updates.y - movingObj.y;
                 if (dx !== 0 || dy !== 0) {
                     nextState = prev.map(obj => {
                         if (obj.id === id) {
                             changes.push({ id, updates });
                             return { ...obj, ...updates };
                         }
                         if (obj.type === 'COUNTER') {
                             const counterCenterX = obj.x + 20;
                             const counterCenterY = obj.y + 20;
                             if (counterCenterX >= movingObj.x && counterCenterX <= movingObj.x + CARD_WIDTH &&
                                 counterCenterY >= movingObj.y && counterCenterY <= movingObj.y + CARD_HEIGHT) {
                                     const newPos = { x: obj.x + dx, y: obj.y + dy, z: obj.z + 10 };
                                     changes.push({ id: obj.id, updates: newPos });
                                     return { ...obj, ...newPos };
                                 }
                         }
                         return obj;
                     });
                 } else {
                      changes.push({ id, updates });
                      nextState = prev.map(obj => obj.id === id ? { ...obj, ...updates } : obj);
                 }
            } else {
                 changes.push({ id, updates });
                 nextState = prev.map(obj => obj.id === id ? { ...obj, ...updates } : obj);
            }
            
            changes.forEach(change => {
                emitAction('UPDATE_OBJECT', change);
            });
            return nextState;
        });
    };

    const updateCommanderDamage = (commanderId: string, victimId: string, delta: number) => {
        setCommanderDamage(prev => {
            const cmdrRecord = prev[commanderId] || {};
            const currentVal = cmdrRecord[victimId] || 0;
            return { ...prev, [commanderId]: { ...cmdrRecord, [victimId]: Math.max(0, currentVal + delta) } };
        });
    };

    const playCardFromHand = (card: CardData, spawnX?: number, spawnY?: number) => {
        const defaultX = LOCAL_MAT_POS.x + MAT_W / 2 - CARD_WIDTH / 2;
        const defaultY = LOCAL_MAT_POS.y + MAT_H / 2 - CARD_HEIGHT / 2;
        const newObject: BoardObject = {
            id: crypto.randomUUID(), type: 'CARD', cardData: card,
            x: spawnX ?? (defaultX + (Math.random() * 40 - 20)),
            y: spawnY ?? (defaultY + (Math.random() * 40 - 20)),
            z: maxZ + 1, rotation: 0, isFaceDown: false, isTransformed: false,
            counters: {}, commanderDamage: {}, controllerId: 'local-player',
            quantity: 1, tappedQuantity: 0
        };
        setMaxZ(prev => prev + 1);
        setBoardObjects(prev => [...prev, newObject]);
        emitAction('ADD_OBJECT', newObject);
        if (!card.isToken) setHand(prev => prev.filter(c => c.id !== card.id));
        addLog(`played ${card.name} ${card.isToken ? '(Token)' : ''}`);
    };

    const spawnCounter = () => {
        const defaultX = LOCAL_MAT_POS.x + MAT_W / 2 - 20;
        const defaultY = LOCAL_MAT_POS.y + MAT_H / 2 - 20;
        const newObject: BoardObject = {
             id: crypto.randomUUID(), type: 'COUNTER',
             cardData: { ...initialTokens[0] || initialDeck[0], name: "Counter", id: "counter" },
             x: defaultX + (Math.random() * 40 - 20),
             y: defaultY + (Math.random() * 40 - 20),
             z: maxZ + 1, rotation: 0, isFaceDown: false, isTransformed: false,
             counters: {}, commanderDamage: {}, controllerId: 'local-player',
             quantity: 1, tappedQuantity: 0
        };
        setMaxZ(prev => prev + 1);
        setBoardObjects(prev => [...prev, newObject]);
        emitAction('ADD_OBJECT', newObject);
        addLog("added a counter");
    };

    const shuffleLibrary = () => {
        setLibrary(prev => {
            const newLib = [...prev];
            for (let i = newLib.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [newLib[i], newLib[j]] = [newLib[j], newLib[i]];
            }
            return newLib;
        });
        setIsShuffling(true);
        setTimeout(() => setIsShuffling(false), 500);
        addLog("shuffled library");
    };

    const drawCard = (count: number = 1) => {
        if (library.length < count) {
             addLog(`tried to draw ${count} but only ${library.length} in library`);
             return;
        }
        setLibrary(prev => {
             const drawn = prev.slice(0, count);
             setHand(h => [...h, ...drawn]);
             return prev.slice(count);
        });
        addLog(`drew ${count} card${count > 1 ? 's' : ''}`);
    };

    const playCommander = (card: CardData) => {
        setCommandZone(prev => prev.filter(c => c.id !== card.id));
        const defaultX = LOCAL_MAT_POS.x + MAT_W / 2 - CARD_WIDTH / 2;
        const defaultY = LOCAL_MAT_POS.y + MAT_H / 2 - CARD_HEIGHT / 2;
        const newObject: BoardObject = {
            id: crypto.randomUUID(), type: 'CARD', cardData: card,
            x: defaultX, y: defaultY, z: maxZ + 1, rotation: 0, isFaceDown: false, isTransformed: false,
            counters: {}, commanderDamage: {}, controllerId: 'local-player',
            quantity: 1, tappedQuantity: 0
        };
        setMaxZ(prev => prev + 1);
        setBoardObjects(prev => [...prev, newObject]);
        emitAction('ADD_OBJECT', newObject);
        addLog(`cast commander ${card.name}`);
    };

    const playTopLibrary = () => {
        if (library.length === 0) return;
        const card = library[0];
        setLibrary(prev => prev.slice(1));
        const spawnX = LOCAL_MAT_POS.x + MAT_W / 2 - CARD_WIDTH / 2;
        const spawnY = LOCAL_MAT_POS.y + MAT_H / 2 - CARD_HEIGHT / 2;
        const newObject: BoardObject = {
            id: crypto.randomUUID(), type: 'CARD', cardData: card,
            x: spawnX, y: spawnY, z: maxZ + 1, rotation: 0, isFaceDown: false, isTransformed: false,
            counters: {}, commanderDamage: {}, controllerId: 'local-player',
            quantity: 1, tappedQuantity: 0
        };
        setMaxZ(prev => prev + 1);
        setBoardObjects(prev => [...prev, newObject]);
        emitAction('ADD_OBJECT', newObject);
        addLog(`played top card of library`);
    };

    const playTopGraveyard = () => {
        if (graveyard.length === 0) return;
        const card = graveyard[0];
        setGraveyard(prev => prev.slice(1));
        const spawnX = LOCAL_MAT_POS.x + MAT_W / 2 - CARD_WIDTH / 2;
        const spawnY = LOCAL_MAT_POS.y + MAT_H / 2 - CARD_HEIGHT / 2;
        const newObject: BoardObject = {
            id: crypto.randomUUID(), type: 'CARD', cardData: card,
            x: spawnX, y: spawnY, z: maxZ + 1, rotation: 0, isFaceDown: false, isTransformed: false,
            counters: {}, commanderDamage: {}, controllerId: 'local-player',
            quantity: 1, tappedQuantity: 0
        };
        setMaxZ(prev => prev + 1);
        setBoardObjects(prev => [...prev, newObject]);
        emitAction('ADD_OBJECT', newObject);
        addLog(`returned ${card.name} from graveyard to battlefield`);
    };

    const returnToHand = (id: string) => {
        const obj = boardObjects.find(o => o.id === id);
        if (!obj) return;
        if (obj.type === 'COUNTER') {
            setBoardObjects(prev => prev.filter(o => o.id !== id));
            emitAction('REMOVE_OBJECT', { id });
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
            emitAction('REMOVE_OBJECT', { id });
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
        if (!card.isToken) setHand(prev => prev.filter(c => c.id !== card.id));
    };

    const handleCardRelease = (id: string, x: number, y: number) => {
        const obj = boardObjects.find(o => o.id === id);
        if (!obj) return;
        if (obj.type === 'COUNTER') return;

        const centerX = x + CARD_WIDTH / 2;
        const centerY = y + CARD_HEIGHT / 2;
        const checkRect = (rectX: number, rectY: number, w: number, h: number) => {
            return centerX >= rectX && centerX <= rectX + w && centerY >= rectY && centerY <= rectY + h;
        };

        // Zone checks (Local only)
        const libX = LOCAL_MAT_POS.x + ZONE_LIBRARY_OFFSET.x;
        const libY = LOCAL_MAT_POS.y + ZONE_LIBRARY_OFFSET.y;
        if (checkRect(libX, libY, CARD_WIDTH, CARD_HEIGHT)) { setLibraryAction({ isOpen: true, cardId: id }); return; }

        const gyX = LOCAL_MAT_POS.x + ZONE_GRAVEYARD_OFFSET.x;
        const gyY = LOCAL_MAT_POS.y + ZONE_GRAVEYARD_OFFSET.y;
        if (checkRect(gyX, gyY, CARD_WIDTH, CARD_HEIGHT)) {
            setGraveyard(prev => [obj.cardData, ...prev]);
            setBoardObjects(prev => prev.filter(o => o.id !== id));
            emitAction('REMOVE_OBJECT', { id });
            addLog(`moved ${obj.cardData.name} from battlefield to graveyard`);
            return;
        }

        const exX = LOCAL_MAT_POS.x + ZONE_EXILE_OFFSET.x;
        const exY = LOCAL_MAT_POS.y + ZONE_EXILE_OFFSET.y;
        if (checkRect(exX, exY, CARD_WIDTH, CARD_HEIGHT)) {
            setExile(prev => [obj.cardData, ...prev]);
            setBoardObjects(prev => prev.filter(o => o.id !== id));
            emitAction('REMOVE_OBJECT', { id });
            addLog(`exiled ${obj.cardData.name} from battlefield`);
            return;
        }
        
        const cmdX = LOCAL_MAT_POS.x + ZONE_COMMAND_OFFSET.x;
        const cmdY = LOCAL_MAT_POS.y + ZONE_COMMAND_OFFSET.y;
        if (checkRect(cmdX, cmdY, CARD_WIDTH, CARD_HEIGHT) && obj.cardData.isCommander) {
             setCommandZone(prev => [obj.cardData, ...prev]);
             setBoardObjects(prev => prev.filter(o => o.id !== id));
             emitAction('REMOVE_OBJECT', { id });
             addLog(`returned commander ${obj.cardData.name} to command zone`);
             return;
        }

        // --- Giving Control ---
        // Map Local IDs to Socket IDs for emit
        if (checkRect(TOP_MAT_POS.x, TOP_MAT_POS.y, MAT_W, MAT_H)) {
             const targetPlayer = playersList.find(p => p.id === 'opponent-top');
             if (targetPlayer?.socketId) {
                  updateBoardObject(id, { controllerId: targetPlayer.socketId, rotation: 180 });
                  addLog(`gave control of ${obj.cardData.name} to ${targetPlayer.name}`);
             }
             return;
        }
        if (checkRect(LEFT_MAT_POS.x, LEFT_MAT_POS.y, MAT_H, MAT_W)) {
             const targetPlayer = playersList.find(p => p.id === 'opponent-left');
             if (targetPlayer?.socketId) {
                  updateBoardObject(id, { controllerId: targetPlayer.socketId, rotation: 90 });
                  addLog(`gave control of ${obj.cardData.name} to ${targetPlayer.name}`);
             }
             return;
        }
        if (checkRect(RIGHT_MAT_POS.x, RIGHT_MAT_POS.y, MAT_H, MAT_W)) {
             const targetPlayer = playersList.find(p => p.id === 'opponent-right');
             if (targetPlayer?.socketId) {
                  updateBoardObject(id, { controllerId: targetPlayer.socketId, rotation: -90 });
                  addLog(`gave control of ${obj.cardData.name} to ${targetPlayer.name}`);
             }
             return;
        }
        
        if (checkRect(LOCAL_MAT_POS.x, LOCAL_MAT_POS.y, MAT_W, MAT_H)) {
            if (obj.controllerId !== 'local-player' && obj.controllerId !== socket.id) {
                updateBoardObject(id, { controllerId: 'local-player', rotation: 0 });
                addLog(`regained control of ${obj.cardData.name}`);
            }
        }
    };

    // --- Search / Tray / Library Action Helpers ---
    // (Consolidated/Shortened for file limit, logic remains same)
    const openSearch = (source: any) => {
        let items: any[] = [];
        if (source === 'LIBRARY') items = library.map(c => ({ card: c, isRevealed: false }));
        else if (source === 'GRAVEYARD') items = graveyard.map(c => ({ card: c, isRevealed: true }));
        else if (source === 'EXILE') items = exile.map(c => ({ card: c, isRevealed: true }));
        setSearchModal({ isOpen: true, source, items, tray: [] });
    };
    const searchTokens = async () => {
        if (!tokenSearchTerm) return;
        const results = await searchCards(tokenSearchTerm);
        setSearchModal(prev => ({ ...prev, items: results.map(c => ({ card: {...c, isToken: true, id: crypto.randomUUID()}, isRevealed: true })) }));
    };
    const revealAll = () => setSearchModal(prev => ({ ...prev, items: prev.items.map(i => ({ ...i, isRevealed: true })) }));
    const shuffleAndClose = () => { if (searchModal.source === 'LIBRARY') shuffleLibrary(); setSearchModal(prev => ({ ...prev, isOpen: false })); };
    const addToTray = (id: string) => {
        const item = searchModal.items.find(i => i.card.id === id);
        if (item) setSearchModal(prev => ({ ...prev, items: prev.items.filter(i => i.card.id !== id), tray: [...prev.tray, item.card] }));
    };
    const removeFromTray = (id: string) => {
        const card = searchModal.tray.find(c => c.id === id);
        if (card) setSearchModal(prev => ({ ...prev, tray: prev.tray.filter(c => c.id !== id), items: [...prev.items, { card, isRevealed: true }] }));
    };
    const onTrayReorder = (idx: number, dir: 'LEFT' | 'RIGHT') => {
        const newTray = [...searchModal.tray];
        const swapIdx = dir === 'LEFT' ? idx - 1 : idx + 1;
        if (swapIdx >= 0 && swapIdx < newTray.length) {
            [newTray[idx], newTray[swapIdx]] = [newTray[swapIdx], newTray[idx]];
            setSearchModal(prev => ({ ...prev, tray: newTray }));
        }
    };
    const handleTrayAction = (action: any) => {
        const trayCards = searchModal.tray;
        const trayIds = new Set(trayCards.map(c => c.id));
        if (trayCards.length === 0) return;
        let sourceList = searchModal.source === 'LIBRARY' ? library : searchModal.source === 'GRAVEYARD' ? graveyard : exile;
        const rest = sourceList.filter(c => !trayIds.has(c.id));
        
        let newLib = [...library], newGrave = [...graveyard], newExile = [...exile], newHand = [...hand];
        if (searchModal.source === 'LIBRARY') newLib = rest;
        else if (searchModal.source === 'GRAVEYARD') newGrave = rest;
        else if (searchModal.source === 'EXILE') newExile = rest;

        if (action === 'HAND') newHand = [...newHand, ...trayCards];
        else if (action === 'TOP') newLib = [...trayCards, ...newLib];
        else if (action === 'BOTTOM') newLib = [...newLib, ...trayCards];
        else if (action === 'GRAVEYARD') newGrave = [...trayCards, ...newGrave];
        else if (action === 'EXILE') newExile = [...trayCards, ...newExile];
        else if (action === 'SHUFFLE') newLib = [...newLib, ...trayCards].sort(() => Math.random() - 0.5);

        setLibrary(newLib); setGraveyard(newGrave); setExile(newExile); setHand(newHand);
        // Refresh view
        if (searchModal.source === 'LIBRARY') openSearch('LIBRARY'); // Re-open to refresh
        else setSearchModal(prev => ({ ...prev, tray: [] })); // Simple close tray
    };
    const toggleRevealItem = (idx: number) => {
        setSearchModal(prev => {
            const newItems = [...prev.items];
            if (newItems[idx]) newItems[idx] = { ...newItems[idx], isRevealed: !newItems[idx].isRevealed };
            return { ...prev, items: newItems };
        });
    };
    const handleSearchAction = (id: string, action: 'HAND') => {
         const item = searchModal.items.find(i => i.card.id === id);
         if (!item) return;
         const newCard = { ...item.card, id: crypto.randomUUID() };
         if (action === 'HAND') { setHand(prev => [...prev, newCard]); addLog(`added ${newCard.name} to hand`); }
    };
    const resolveLibraryAction = (action: 'TOP' | 'BOTTOM' | 'SHUFFLE') => {
        const id = libraryAction.cardId;
        const obj = boardObjects.find(o => o.id === id);
        if (!obj) { setLibraryAction({ isOpen: false, cardId: '' }); return; }
        setBoardObjects(prev => prev.filter(o => o.id !== id));
        const card = obj.cardData;
        if (action === 'TOP') setLibrary(prev => [card, ...prev]);
        else if (action === 'BOTTOM') setLibrary(prev => [...prev, card]);
        else if (action === 'SHUFFLE') { setLibrary(prev => [...prev, card]); shuffleLibrary(); }
        setLibraryAction({ isOpen: false, cardId: '' });
    };

    // --- Rendering Helpers ---

    const handleContainerPointerDown = (e: React.PointerEvent) => {
        if (e.button === 1 || (e.button === 0 && isSpacePressed.current)) {
             isDraggingView.current = true;
             lastMousePos.current = { x: e.clientX, y: e.clientY };
             (e.target as HTMLElement).setPointerCapture(e.pointerId);
             e.preventDefault();
        }
    };

    const handleContainerPointerMove = (e: React.PointerEvent) => {
        if (isDraggingView.current) {
            const dx = e.clientX - lastMousePos.current.x;
            const dy = e.clientY - lastMousePos.current.y;
            setView(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
            lastMousePos.current = { x: e.clientX, y: e.clientY };
        }
    };

    const handleContainerPointerUp = (e: React.PointerEvent) => {
        if (isDraggingView.current) {
            isDraggingView.current = false;
            (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        }
    };

    const handleWheel = (e: React.WheelEvent) => {
        const scaleAmount = -e.deltaY * 0.001;
        const newScale = Math.min(Math.max(0.1, view.scale + scaleAmount), 5); 
        setView(prev => ({ ...prev, scale: newScale }));
    };

    const handleOpponentPointerDown = (e: React.PointerEvent) => {
         if (e.button === 1 || (e.button === 0 && isSpacePressed.current)) {
            isDraggingOpponentView.current = true;
            lastOpponentMousePos.current = { x: e.clientX, y: e.clientY };
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            e.preventDefault();
        }
    };

    const handleOpponentPointerMove = (e: React.PointerEvent) => {
        if (isDraggingOpponentView.current) {
            const dx = e.clientX - lastOpponentMousePos.current.x;
            const dy = e.clientY - lastOpponentMousePos.current.y;
            setOpponentView(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
            lastOpponentMousePos.current = { x: e.clientX, y: e.clientY };
        }
    };

    const handleOpponentPointerUp = (e: React.PointerEvent) => {
        if (isDraggingOpponentView.current) {
            isDraggingOpponentView.current = false;
            (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        }
    };

     const handleOpponentWheel = (e: React.WheelEvent) => {
        const scaleAmount = -e.deltaY * 0.001;
        const newScale = Math.min(Math.max(0.1, opponentView.scale + scaleAmount), 5);
        setOpponentView(prev => ({ ...prev, scale: newScale }));
    };

    const renderWorld = (viewState: ViewState, containerRefToUse: React.RefObject<HTMLDivElement>, handlers: any, rotation: number = 0, isOpponent: boolean = false) => (
        <div 
            ref={containerRefToUse}
            className="w-full h-full touch-none relative overflow-hidden bg-[#1a1410]"
            style={{ cursor: isSpacePressed.current ? 'grab' : 'default' }}
            onPointerDown={handlers.onDown}
            onPointerMove={handlers.onMove}
            onPointerUp={handlers.onUp}
            onWheel={handlers.onWheel}
        >
            <div 
                className="absolute inset-0 opacity-100 pointer-events-none"
                style={{ 
                    backgroundImage: `url("/table_texture.png")`, // Fixed path
                    backgroundRepeat: 'repeat',
                    backgroundSize: '512px',
                }} 
            />
            <div 
                className="absolute inset-0 opacity-20 pointer-events-none mix-blend-overlay"
                style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg width='200' height='200' viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`
                }}
            />
            <div 
                className="absolute inset-0 opacity-10 pointer-events-none bg-[radial-gradient(#ffffff33_1px,transparent_1px)]"
                style={{ 
                    backgroundSize: `${20 * viewState.scale}px ${20 * viewState.scale}px`,
                    backgroundPosition: `${viewState.x}px ${viewState.y}px`
                }} 
            />

            <div 
                style={{ 
                    transform: `translate(${viewState.x}px, ${viewState.y}px) scale(${viewState.scale}) rotate(${rotation}deg)`,
                    transformOrigin: '0 0',
                    width: '0px', height: '0px',
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
                            viewScale={viewState.scale}
                            viewRotation={rotation}
                        />
                    </div>
                ))}
            </div>
        </div>
    );

    return (
        <div className="relative w-full h-full overflow-hidden select-none bg-[#1a1410] flex flex-col">
            
            {/* --- Lobby / Waiting Room Overlay --- */}
            {gamePhase === 'SETUP' && (
                <div className="absolute inset-0 z-[100] bg-gray-900/95 backdrop-blur-md flex items-center justify-center animate-in fade-in">
                    <div className="max-w-2xl w-full bg-gray-800 rounded-2xl shadow-2xl border border-gray-700 p-8">
                        <div className="text-center mb-8">
                            <h2 className="text-3xl font-extrabold text-white mb-2">Waiting for Players</h2>
                            <p className="text-gray-400">Share the room code below to invite friends.</p>
                        </div>
                        
                        <div className="flex justify-center mb-8">
                            <div className="bg-black/50 rounded-xl px-8 py-4 border border-gray-600 flex flex-col items-center gap-2">
                                <span className="text-xs uppercase font-bold text-gray-500 tracking-widest">Room Code</span>
                                <div className="text-5xl font-mono font-bold text-blue-400 tracking-widest select-all cursor-pointer" onClick={() => navigator.clipboard.writeText(roomId)}>
                                    {roomId}
                                </div>
                                <span className="text-[10px] text-gray-500">(Click to Copy)</span>
                            </div>
                        </div>

                        <div className="mb-8">
                            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wide mb-4">Connected Players ({playersList.length})</h3>
                            <div className="space-y-2">
                                {playersList.map((player) => (
                                    <div key={player.id} className="flex items-center gap-4 bg-gray-700/50 p-3 rounded-lg border border-gray-600">
                                        <div className="w-10 h-10 rounded-full border-2 border-white/20 shadow-lg flex items-center justify-center font-bold text-white text-lg" style={{backgroundColor: player.color}}>
                                            {player.name.charAt(0).toUpperCase()}
                                        </div>
                                        <div className="flex-1">
                                            <div className="font-bold text-white text-lg">{player.name}</div>
                                            <div className="text-xs text-gray-400">{player.id === 'local-player' ? '(You)' : 'Opponent'}</div>
                                        </div>
                                        {player.id === 'local-player' && (
                                            <div className="text-green-400 text-xs font-bold uppercase flex items-center gap-1">
                                                <CheckCircle size={14}/> Ready
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="mb-8">
                            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wide mb-4">Game Rules</h3>
                            <div className="flex gap-4">
                                <label className="flex-1 flex items-center gap-3 bg-gray-700/50 p-3 rounded-lg cursor-pointer border border-gray-600 hover:bg-gray-700 transition">
                                    <div className={`w-5 h-5 rounded border flex items-center justify-center ${mulligansAllowed ? 'bg-blue-600 border-blue-500' : 'border-gray-500'}`}>
                                        {mulligansAllowed && <CheckCircle size={14} className="text-white"/>}
                                    </div>
                                    <input type="checkbox" className="hidden" checked={mulligansAllowed} onChange={() => setMulligansAllowed(!mulligansAllowed)} disabled={!isHost} />
                                    <div>
                                        <div className="font-bold text-white text-sm">Enable Mulligans</div>
                                    </div>
                                </label>

                                <label className={`flex-1 flex items-center gap-3 bg-gray-700/50 p-3 rounded-lg cursor-pointer border border-gray-600 hover:bg-gray-700 transition ${!mulligansAllowed ? 'opacity-50 pointer-events-none' : ''}`}>
                                    <div className={`w-5 h-5 rounded border flex items-center justify-center ${freeMulligan ? 'bg-green-600 border-green-500' : 'border-gray-500'}`}>
                                        {freeMulligan && <CheckCircle size={14} className="text-white"/>}
                                    </div>
                                    <input type="checkbox" className="hidden" checked={freeMulligan} onChange={() => setFreeMulligan(!freeMulligan)} disabled={!isHost || !mulligansAllowed} />
                                    <div>
                                        <div className="font-bold text-white text-sm">Free 1st Mulligan</div>
                                    </div>
                                </label>
                            </div>
                            {!isHost && <p className="text-xs text-gray-500 mt-2 text-center italic">Only the host can change these settings.</p>}
                        </div>

                        {isHost ? (
                            <button 
                                onClick={startGame}
                                className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-4 rounded-xl text-xl shadow-lg transition-transform active:scale-95 flex items-center justify-center gap-3"
                            >
                                <Play size={24} fill="currentColor" /> Start Game
                            </button>
                        ) : (
                            <div className="w-full bg-gray-700/50 text-gray-400 font-bold py-4 rounded-xl text-lg flex items-center justify-center gap-2 border border-gray-600 border-dashed">
                                <Loader2 className="animate-spin" /> Waiting for Host to Start...
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* --- MULLIGAN OVERLAY --- */}
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

            {/* --- UI: Top Bar --- */}
            <div className="flex-none h-16 bg-gray-900/90 border-b border-gray-700 flex items-center justify-between px-6 z-50 backdrop-blur-md relative">
                 <div className="flex items-center gap-6">
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
                    <button 
                        onClick={() => setIsOpponentViewOpen(!isOpponentViewOpen)}
                        className={`p-2 rounded-lg transition-colors ${isOpponentViewOpen ? 'bg-blue-600 text-white' : 'hover:bg-gray-800 text-gray-400'}`}
                        title="Toggle Opponent View"
                    >
                        <Users size={20} />
                    </button>
                    
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

            {/* --- Main Content Area --- */}
            <div className="flex-1 flex overflow-hidden relative">
                
                {/* Left / Main Pane */}
                <div className={`${isOpponentViewOpen ? 'w-1/2 border-r border-gray-700' : 'w-full'} relative h-full transition-all duration-300`}>
                     {renderWorld(view, containerRef, {
                         onDown: handleContainerPointerDown,
                         onMove: handleContainerPointerMove,
                         onUp: handleContainerPointerUp,
                         onWheel: handleWheel
                     }, 0, false)}

                    {/* Controls Overlay (Zoom) */}
                    <div className="absolute top-4 right-4 flex flex-col gap-2 z-10">
                         <button onClick={() => setView(v => ({...v, scale: Math.min(v.scale + 0.1, 3)}))} className="p-2 bg-gray-800/80 border border-gray-600 hover:bg-gray-700 rounded text-gray-300"><ZoomIn size={18}/></button>
                        <button onClick={() => setView(v => ({...v, scale: Math.max(v.scale - 0.1, 0.1)}))} className="p-2 bg-gray-800/80 border border-gray-600 hover:bg-gray-700 rounded text-gray-300"><ZoomOut size={18}/></button>
                    </div>

                    {/* Hand UI (Only visible in Setup/Playing) */}
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
                </div>
                
                {/* Right / Opponent Pane */}
                {isOpponentViewOpen && (
                    <div className="w-1/2 h-full relative bg-gray-900 border-l border-gray-700 flex flex-col">
                        <div className="h-12 bg-gray-800 border-b border-gray-700 flex items-center justify-between px-4 z-20 shadow-md">
                            <div className="flex items-center gap-3">
                                <button 
                                    onClick={() => setSelectedOpponentIndex(prev => (prev - 1 + opponentIds.length) % opponentIds.length)}
                                    className="p-1 hover:bg-gray-700 rounded text-gray-300"
                                >
                                    <ChevronLeft size={20}/>
                                </button>
                                <div className="font-bold text-white flex items-center gap-2">
                                    <div className="w-3 h-3 rounded-full bg-blue-500" /> {/* Should match selected opponent color */}
                                    {playersList.find(p => p.id === opponentIds[selectedOpponentIndex])?.name || 'Unknown'}
                                </div>
                                <button 
                                    onClick={() => setSelectedOpponentIndex(prev => (prev + 1) % opponentIds.length)}
                                    className="p-1 hover:bg-gray-700 rounded text-gray-300"
                                >
                                    <ChevronRight size={20}/>
                                </button>
                            </div>
                            <div className="flex items-center gap-2">
                                <button onClick={() => setOpponentView(v => ({...v, scale: Math.min(v.scale + 0.1, 3)}))} className="p-1.5 hover:bg-gray-700 rounded text-gray-300"><ZoomIn size={16}/></button>
                                <button onClick={() => setOpponentView(v => ({...v, scale: Math.max(v.scale - 0.1, 0.1)}))} className="p-1.5 hover:bg-gray-700 rounded text-gray-300"><ZoomOut size={16}/></button>
                            </div>
                        </div>

                        {/* Opponent Viewport */}
                        <div className="flex-1 relative overflow-hidden">
                             {renderWorld(opponentView, opponentContainerRef, {
                                 onDown: handleOpponentPointerDown,
                                 onMove: handleOpponentPointerMove,
                                 onUp: handleOpponentPointerUp,
                                 onWheel: handleOpponentWheel
                             }, 
                             opponentIds[selectedOpponentIndex] === 'opponent-top' ? 180 :
                             opponentIds[selectedOpponentIndex] === 'opponent-right' ? -90 : 
                             90 
                             , true)}
                        </div>
                    </div>
                )}
            </div>
            
            {/* Status Message */}
            {statusMessage && (
                <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[9000] pointer-events-none animate-in fade-in slide-in-from-top-4">
                    <div className="bg-black/70 backdrop-blur text-white px-4 py-1 rounded-full text-sm font-medium border border-white/10 shadow-xl">
                        {statusMessage}
                    </div>
                </div>
            )}

            {/* Modals */}
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
                                             <button onClick={() => updateCommanderDamage(oppCommanderId, 'local-player', -1)} className="w-8 h-8 rounded bg-gray-700 hover:bg-gray-600 flex items-center justify-center text-red-400"><Minus size={16}/></button>
                                             <span className={`text-xl font-bold w-8 text-center ${currentDmg >= 21 ? 'text-red-500' : 'text-white'}`}>{currentDmg}</span>
                                             <button onClick={() => updateCommanderDamage(oppCommanderId, 'local-player', 1)} className="w-8 h-8 rounded bg-gray-700 hover:bg-gray-600 flex items-center justify-center text-green-400"><Plus size={16}/></button>
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
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded"><span className="text-gray-300">Draw Card</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">D</kbd></div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded"><span className="text-gray-300">Untap All</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">U</kbd></div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded"><span className="text-gray-300">Shuffle Library</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">S</kbd></div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded"><span className="text-gray-300">Toggle Log</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">L</kbd></div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded"><span className="text-gray-300">Judge Chat</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">J</kbd></div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded"><span className="text-gray-300">Help / Shortcuts</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">?</kbd></div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded col-span-2"><span className="text-gray-300">Pan Camera</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">Space (Hold) + Drag</kbd></div>
                            <div className="flex justify-between items-center p-2 bg-gray-700/50 rounded col-span-2"><span className="text-gray-300">Zoom Camera</span><kbd className="bg-black/50 px-2 py-1 rounded text-white font-mono border border-gray-600">Mouse Wheel</kbd></div>
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
                                            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex flex-col justify-between p-1 transition-opacity">
                                                 <div className="flex justify-end">
                                                     <button onClick={() => removeFromTray(card.id)} className="bg-red-500 hover:bg-red-400 p-1 rounded-full text-white"><X size={10}/></button>
                                                 </div>
                                                 <div className="flex justify-between mt-auto">
                                                     <button onClick={() => onTrayReorder(idx, 'LEFT')} disabled={idx===0} className="bg-gray-700 hover:bg-gray-600 disabled:opacity-30 p-1 rounded text-white"><ChevronLeft size={12}/></button>
                                                     <button onClick={() => onTrayReorder(idx, 'RIGHT')} disabled={idx===searchModal.tray.length-1} className="bg-gray-700 hover:bg-gray-600 disabled:opacity-30 p-1 rounded text-white"><ChevronRight size={12}/></button>
                                                 </div>
                                            </div>
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
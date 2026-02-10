import React, { useState, useRef } from 'react';
import { BoardObject, CardData } from '../types';
import { CARD_WIDTH, CARD_HEIGHT } from '../constants';
import { RotateCw, EyeOff, X, Maximize2, RefreshCcw, PlusCircle, MinusCircle, Reply, Layers, Copy, Plus, Minus } from 'lucide-react';

interface PlayerProfile {
    id: string;
    name: string;
    color: string;
}

interface CardProps {
  object: BoardObject;
  sleeveColor: string;
  players?: PlayerProfile[];
  onUpdate: (id: string, updates: Partial<BoardObject>) => void;
  onBringToFront: (id: string) => void;
  onRelease: (id: string, x: number, y: number) => void;
  onInspect: (card: CardData) => void; 
  onReturnToHand: (id: string) => void;
  onUnstack: (id: string) => void;
  onLog: (msg: string) => void;
  scale?: number;
  initialDragEvent?: React.PointerEvent | null; 
}

export const Card: React.FC<CardProps> = ({ object, sleeveColor, players = [], onUpdate, onBringToFront, onRelease, onInspect, onReturnToHand, onUnstack, onLog, scale = 1, initialDragEvent }) => {
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number, y: number, initialX: number, initialY: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Handle immediate drag from hand/zones
  React.useEffect(() => {
      if (initialDragEvent && cardRef.current) {
         onBringToFront(object.id);
         setIsDragging(true);
         dragStartRef.current = {
             x: (initialDragEvent.clientX) - object.x, 
             y: (initialDragEvent.clientY) - object.y,
             initialX: object.x,
             initialY: object.y
         };
         (cardRef.current as Element).setPointerCapture(initialDragEvent.pointerId);
      }
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('.interactive-ui')) {
        return;
    }

    e.preventDefault();
    e.stopPropagation();
    onBringToFront(object.id);
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX - object.x,
      y: e.clientY - object.y,
      initialX: object.x,
      initialY: object.y
    };
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !dragStartRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const newX = e.clientX - dragStartRef.current.x;
    const newY = e.clientY - dragStartRef.current.y;
    onUpdate(object.id, { x: newX, y: newY });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    
    const moveX = Math.abs(object.x - dragStartRef.current.initialX);
    const moveY = Math.abs(object.y - dragStartRef.current.initialY);
    const totalMove = Math.sqrt(moveX * moveX + moveY * moveY);

    setIsDragging(false);
    dragStartRef.current = null;
    if(e.target) (e.target as Element).releasePointerCapture(e.pointerId);
    
    onRelease(object.id, object.x, object.y);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
      // Prevent double click if clicking UI
      if ((e.target as HTMLElement).closest('.interactive-ui')) return;
      e.stopPropagation();
      toggleTap(e);
  }

  const toggleTap = (e: React.MouseEvent | null) => {
    if (e) e.stopPropagation();
    
    if (object.quantity > 1) {
        // For stacks, Double Click / Toggle Tap attempts to Tap/Untap ALL
        const allTapped = object.tappedQuantity === object.quantity;
        const newTappedCount = allTapped ? 0 : object.quantity;
        onUpdate(object.id, { tappedQuantity: newTappedCount });
        onLog(`${allTapped ? 'untapped' : 'tapped'} stack of ${object.quantity} ${object.cardData.name}s`);
    } else {
        const newRotation = object.rotation === 0 ? 90 : 0;
        onUpdate(object.id, { rotation: newRotation });
        onLog(`${newRotation === 90 ? 'tapped' : 'untapped'} ${object.cardData.name}`);
    }
  };

  const adjustStackTap = (delta: number) => {
      const newTapped = Math.min(Math.max(0, object.tappedQuantity + delta), object.quantity);
      if (newTapped !== object.tappedQuantity) {
          onUpdate(object.id, { tappedQuantity: newTapped });
          const action = delta > 0 ? 'tapped' : 'untapped';
          onLog(`${action} 1 ${object.cardData.name} (Total Tapped: ${newTapped}/${object.quantity})`);
      }
  }

  const toggleFaceDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    onUpdate(object.id, { isFaceDown: !object.isFaceDown });
  };

  const toggleTransform = (e: React.MouseEvent) => {
    e.stopPropagation();
    onUpdate(object.id, { isTransformed: !object.isTransformed });
  };
  
  const updateCounter = (e: React.MouseEvent, delta: number) => {
      e.preventDefault(); // Stop double click
      e.stopPropagation();
      const current = object.counters["+1/+1"] || 0;
      const newVal = Math.max(0, current + delta);
      onUpdate(object.id, { counters: { ...object.counters, "+1/+1": newVal } });
  };

  const handleContextMenu = (e: React.MouseEvent) => {
      e.preventDefault(); 
      e.stopPropagation();
  };

  // Determine Image to Show
  let displayImage = object.cardData.imageUrl;
  if (object.isFaceDown) {
      displayImage = ""; 
  } else if (object.isTransformed && object.cardData.backImageUrl) {
      displayImage = object.cardData.backImageUrl;
  }

  // Stack Visualization Calculation
  const isStack = object.quantity > 1;
  const untappedCount = object.quantity - object.tappedQuantity;
  // If whole stack is tapped, we rotate. Otherwise, keep upright but show counts
  const effectiveRotation = (isStack && object.tappedQuantity === object.quantity) ? 90 : object.rotation;

  // Counter Object Rendering
  if (object.type === 'COUNTER') {
      return (
          <div
            ref={cardRef}
            className={`absolute touch-none select-none rounded-full flex items-center justify-center font-bold text-white shadow-lg cursor-grab active:cursor-grabbing group ${isDragging ? 'z-[9999] scale-110' : ''}`}
            style={{
                left: object.x,
                top: object.y,
                width: 25 * scale,
                height: 25 * scale,
                zIndex: object.z,
                background: 'radial-gradient(circle at 30% 30%, #4facfe, #00f2fe)',
                boxShadow: '0 2px 4px rgba(0,0,0,0.3), inset 1px 1px 3px rgba(255,255,255,0.4)',
                border: '1px solid rgba(255,255,255,0.2)',
                transition: isDragging ? 'none' : 'transform 0.1s',
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onContextMenu={(e) => { 
                e.preventDefault(); 
                e.stopPropagation(); 
                onReturnToHand(object.id); // Triggers removal logic in Tabletop
            }} 
            title="Drag to move. Right click to remove."
          >
             <span className="text-xs drop-shadow-md z-10 pointer-events-none select-none">{object.quantity}</span>

             {/* Controls (visible on hover) */}
             <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-20 bg-gray-900/80 rounded-full p-0.5 border border-gray-600">
                 <button 
                    className="w-4 h-4 bg-gray-700 text-white rounded-full flex items-center justify-center hover:bg-red-500 border border-gray-600 transition-colors"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); onUpdate(object.id, { quantity: Math.max(1, object.quantity - 1) }); }}
                 >
                     <Minus size={8} />
                 </button>
                 <button 
                    className="w-4 h-4 bg-gray-700 text-white rounded-full flex items-center justify-center hover:bg-green-500 border border-gray-600 transition-colors"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); onUpdate(object.id, { quantity: object.quantity + 1 }); }}
                 >
                     <Plus size={8} />
                 </button>
             </div>

             <div className="pointer-events-none">
                 {/* Visual Shine */}
                 <div className="absolute top-1 left-1.5 w-1.5 h-1 bg-white/40 rounded-full rotate-45" />
             </div>
          </div>
      )
  }

  return (
      <div
        ref={cardRef}
        className={`absolute touch-none select-none transition-shadow ${isDragging ? 'z-[9999] shadow-2xl scale-105' : 'shadow-md'} cursor-grab active:cursor-grabbing`}
        style={{
          left: object.x,
          top: object.y,
          width: CARD_WIDTH * scale,
          height: CARD_HEIGHT * scale,
          zIndex: object.z,
          transform: `rotate(${effectiveRotation}deg)`,
          transition: isDragging ? 'none' : 'transform 0.2s ease-out, box-shadow 0.2s',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
      >
        {/* Stack Layers (Behind) */}
        {isStack && (
             <>
                <div className="absolute top-1 left-1 w-full h-full bg-gray-700 rounded border border-gray-600 -z-10" />
                <div className="absolute top-2 left-2 w-full h-full bg-gray-600 rounded border border-gray-500 -z-20" />
             </>
        )}

        <div className="relative w-full h-full group perspective-1000">
          <div className={`relative w-full h-full rounded-[4px] overflow-hidden bg-gray-800 border ${object.cardData.isToken ? 'border-yellow-400' : 'border-black/50'}`}>
             {object.isFaceDown ? (
               // Render Sleeve
               <div 
                className="w-full h-full flex items-center justify-center border-4 border-white/10"
                style={{ backgroundColor: sleeveColor }}
               >
                   <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center">
                       <div className="w-12 h-12 rounded-full border-2 border-white/20" />
                   </div>
               </div>
             ) : (
               <img 
                src={displayImage} 
                alt={object.cardData.name}
                className="w-full h-full object-cover pointer-events-none"
               />
             )}

             {/* Counters Visual */}
             {(object.counters["+1/+1"] || 0) > 0 && (
                 <div className="absolute top-2 right-2 bg-white text-black font-bold rounded-full w-8 h-8 flex items-center justify-center border-2 border-blue-500 shadow-lg z-10 pointer-events-none">
                     {object.counters["+1/+1"]}
                 </div>
             )}
             
             {/* Hover Actions */}
             <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-1">
                
                {/* Stack Controls */}
                {isStack ? (
                    <div className="flex flex-col gap-1 items-center interactive-ui mb-1">
                         <div className="flex items-center gap-1">
                             <span className="text-[10px] text-gray-300 font-bold uppercase">Tap</span>
                             <div className="flex items-center gap-1 bg-gray-800/80 rounded-full px-2 py-0.5">
                                <button onClick={(e) => { e.stopPropagation(); adjustStackTap(1); }} className="text-gray-300 hover:text-white"><RotateCw size={14} /></button>
                                <span className="text-xs font-mono min-w-[2rem] text-center">{object.tappedQuantity}/{object.quantity}</span>
                                <button onClick={(e) => { e.stopPropagation(); adjustStackTap(-1); }} className="text-gray-300 hover:text-white"><RefreshCcw size={14} /></button>
                             </div>
                         </div>
                         <button 
                            onClick={(e) => { e.stopPropagation(); onUnstack(object.id); }}
                            className="flex items-center gap-1 px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-full text-[10px] font-bold"
                         >
                             <Copy size={10} /> Unstack
                         </button>
                    </div>
                ) : (
                    <div className="flex gap-1 interactive-ui">
                        <button onClick={toggleTap} className="p-1.5 bg-gray-800 text-white rounded-full hover:bg-blue-600" title="Tap/Untap">
                            <RotateCw size={12} />
                        </button>
                    </div>
                )}

                <div className="flex gap-1 interactive-ui">
                    <button onClick={() => onReturnToHand(object.id)} className="p-1.5 bg-gray-800 text-white rounded-full hover:bg-blue-500" title="Return to Hand">
                        <Reply size={12} />
                    </button>
                    <button onClick={toggleFaceDown} className="p-1.5 bg-gray-800 text-white rounded-full hover:bg-purple-600" title="Flip Face Down/Up">
                        <EyeOff size={12} />
                    </button>
                    <button 
                        onClick={(e) => { e.stopPropagation(); onInspect(object.cardData); }} 
                        className="p-1.5 bg-gray-800 text-white rounded-full hover:bg-green-600" 
                        title="Inspect"
                    >
                        <Maximize2 size={12} />
                    </button>
                </div>

                {object.cardData.backImageUrl && (
                    <button onClick={toggleTransform} className="p-1 px-3 bg-gray-800 text-white rounded-full hover:bg-amber-600 flex items-center gap-1 text-[10px] interactive-ui" title="Transform">
                        <RefreshCcw size={10} /> Transform
                    </button>
                )}
                
                {/* Counter Controls */}
                <div className="flex items-center gap-2 mt-1 interactive-ui pointer-events-auto" onDoubleClick={(e) => e.stopPropagation()}>
                    <button onPointerDown={(e) => e.stopPropagation()} onClick={(e) => updateCounter(e, -1)} className="text-red-400 hover:text-red-200 p-1"><MinusCircle size={20}/></button>
                    <span className="text-white text-xs font-bold select-none">+1/+1</span>
                    <button onPointerDown={(e) => e.stopPropagation()} onClick={(e) => updateCounter(e, 1)} className="text-green-400 hover:text-green-200 p-1"><PlusCircle size={20}/></button>
                </div>
             </div>
          </div>
          
           {/* Stack Count Badge - Moved outside overflow-hidden */}
           {isStack && (
                 <div className="absolute -top-3 -right-3 bg-red-600 text-white font-mono rounded-lg px-2 h-6 border-2 border-gray-900 shadow-xl z-20 flex items-center justify-center text-xs font-bold pointer-events-none whitespace-nowrap">
                     {object.tappedQuantity} / {object.quantity}
                 </div>
           )}
        </div>
      </div>
  );
};
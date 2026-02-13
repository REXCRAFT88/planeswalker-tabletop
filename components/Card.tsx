import React, { useState, useRef, useEffect } from 'react';
import { BoardObject, CardData, ManaColor, ManaRule } from '../types';
import { ManaSource } from '../services/mana';
import { CARD_WIDTH, CARD_HEIGHT } from '../constants';
import { RotateCw, EyeOff, X, Maximize2, RefreshCcw, PlusCircle, MinusCircle, Reply, Layers, Copy, Plus, Minus, Zap, Trash2, Hand } from 'lucide-react';

interface PlayerProfile {
    id: string;
    name: string;
    color: string;
}

interface CardProps {
    object: BoardObject;
    sleeveColor: string;
    players?: PlayerProfile[];
    isControlledByMe: boolean;
    onUpdate: (id: string, updates: Partial<BoardObject>) => void;
    onBringToFront: (id: string) => void;
    onRelease: (id: string, x: number, y: number) => void;
    onInspect: (card: CardData) => void;
    onReturnToHand: (id: string) => void;
    onUnstack: (id: string) => void;
    onRemoveOne: (id: string) => void;
    onDelete: (id: string) => void;
    onLog: (msg: string) => void;
    onCopy?: (id: string) => void;
    onRequestControl?: (id: string, cardName: string, controllerId: string) => void;
    scale?: number;
    viewScale?: number;
    viewRotation?: number;
    viewX?: number;
    viewY?: number;
    onPan?: (dx: number, dy: number) => void;
    initialDragEvent?: React.PointerEvent | null;
    onLongPress?: (id: string) => void;
    isMobile?: boolean;
    isSelected?: boolean;
    isAnySelected?: boolean;
    onSelect?: () => void;
    defaultRotation?: number;
    isHandVisible?: boolean;
    onHover?: (id: string | null) => void;
    manaSource?: ManaSource;
    onManaClick?: () => void;
    manaRule?: ManaRule;
    onDragChange?: (isDragging: boolean) => void;
    showManaCalculator?: boolean;
    sleeveImage?: string;
}

export const Card: React.FC<CardProps> = ({ object, sleeveColor, players = [], isControlledByMe, onUpdate, onBringToFront, onRelease, onInspect, onReturnToHand, onUnstack, onRemoveOne, onDelete, onLog, onCopy, onRequestControl, scale = 1, viewScale = 1, viewRotation = 0, viewX = 0, viewY = 0, onPan, initialDragEvent, onLongPress, isMobile, isSelected, isAnySelected, onSelect, defaultRotation = 0, isHandVisible = true, onHover, manaSource, onManaClick, manaRule, onDragChange, showManaCalculator = true, sleeveImage }) => {
    const [isDragging, setIsDragging] = useState(false);
    const dragStartRef = useRef<{ offsetX: number, offsetY: number, startX: number, startY: number } | null>(null);
    const cardRef = useRef<HTMLDivElement>(null);
    const [showOverlay, setShowOverlay] = useState(false);
    const longPressTimer = useRef<NodeJS.Timeout | null>(null);
    const [hasMoved, setHasMoved] = useState(false);
    const [isOverHand, setIsOverHand] = useState(false);
    const lastTapRef = useRef(0);

    // Debug logging for mana source - only log once per card when it first mounts or when button visibility changes
    const loggedCardId = useRef<string | null>(null);
    useEffect(() => {
        // Only log once per card ID to avoid spam
        if (manaSource && isControlledByMe && loggedCardId.current !== object.id) {
            loggedCardId.current = object.id;
            console.log(`[Card] ${object.cardData.name} manaSource:`, {
                abilityType: manaSource.abilityType,
                hideManaButton: manaSource.hideManaButton,
                producedMana: manaSource.producedMana,
                hasRule: !!manaRule,
                ruleTrigger: manaRule?.trigger,
                isLand: object.cardData.isLand
            });
        }
    }, [object.id]); // Only re-run if card ID changes

    // Handle immediate drag from hand/zones
    React.useEffect(() => {
        if (initialDragEvent && cardRef.current) {
            const dx = initialDragEvent.clientX - viewX;
            const dy = initialDragEvent.clientY - viewY;
            const scaledX = dx / viewScale;
            const scaledY = dy / viewScale;
            const rad = -viewRotation * (Math.PI / 180);
            const worldX = scaledX * Math.cos(rad) - scaledY * Math.sin(rad);
            const worldY = scaledX * Math.sin(rad) + scaledY * Math.cos(rad);

            onBringToFront(object.id);
            setIsDragging(true);
            if (onDragChange) onDragChange(true);

            dragStartRef.current = {
                offsetX: worldX - object.x,
                offsetY: worldY - object.y,
                startX: object.x,
                startY: object.y
            };
            (cardRef.current as Element).setPointerCapture(initialDragEvent.pointerId);
        }
    }, []);

    const handlePointerDown = (e: React.PointerEvent) => {
        if (!isControlledByMe || (e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('.interactive-ui')) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        onBringToFront(object.id);
        setHasMoved(false);

        // Start Long Press Timer
        longPressTimer.current = setTimeout(() => {
            if (onLongPress) {
                onLongPress(object.id);
            } else {
                setShowOverlay(true);
            }
        }, 500);

        const dx = e.clientX - viewX;
        const dy = e.clientY - viewY;
        const scaledX = dx / viewScale;
        const scaledY = dy / viewScale;
        const rad = -viewRotation * (Math.PI / 180);
        const worldX = scaledX * Math.cos(rad) - scaledY * Math.sin(rad);
        const worldY = scaledX * Math.sin(rad) + scaledY * Math.cos(rad);

        dragStartRef.current = {
            offsetX: worldX - object.x,
            offsetY: worldY - object.y,
            startX: object.x,
            startY: object.y
        };
        (e.target as Element).setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!dragStartRef.current) return;
        e.preventDefault();
        e.stopPropagation();

        // Edge Pan Logic
        if (onPan) {
            const EDGE_THRESHOLD = 50;
            const PAN_SPEED = 8;
            let panX = 0;
            let panY = 0;

            if (e.clientX < EDGE_THRESHOLD) panX = PAN_SPEED;
            else if (e.clientX > window.innerWidth - EDGE_THRESHOLD) panX = -PAN_SPEED;

            if (e.clientY < EDGE_THRESHOLD) panY = PAN_SPEED;
            else if (e.clientY > window.innerHeight - EDGE_THRESHOLD) panY = -PAN_SPEED;

            if (panX !== 0 || panY !== 0) onPan(panX, panY);
        }

        const dx = e.clientX - viewX;
        const dy = e.clientY - viewY;
        const scaledX = dx / viewScale;
        const scaledY = dy / viewScale;
        const rad = -viewRotation * (Math.PI / 180);
        const worldX = scaledX * Math.cos(rad) - scaledY * Math.sin(rad);
        const worldY = scaledX * Math.sin(rad) + scaledY * Math.cos(rad);

        const newX = worldX - dragStartRef.current.offsetX;
        const newY = worldY - dragStartRef.current.offsetY;

        // Threshold check for movement to prevent accidental drags when tapping
        if (!hasMoved) {
            const dist = Math.hypot(newX - dragStartRef.current.startX, newY - dragStartRef.current.startY);
            if (dist < 5) return; // Deadzone

            // Cancel long press if moved significantly
            if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }

            setIsDragging(true);
            if (onDragChange) onDragChange(true);
            setHasMoved(true);
        }

        // Check if over hand (Mobile only feature for drag-to-hand)
        if (isMobile && isControlledByMe) {
            const threshold = isHandVisible ? 150 : 40; // Adjust threshold based on hand visibility
            const isOver = e.clientY > window.innerHeight - threshold;
            if (isOver !== isOverHand) setIsOverHand(isOver);
        }

        onUpdate(object.id, { x: newX, y: newY });
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }

        if (!dragStartRef.current) return;

        // Manual Double Tap Detection for Mobile
        if (!isDragging && !hasMoved && isMobile && isControlledByMe) {
            const now = Date.now();
            if (now - lastTapRef.current < 300) {
                if (object.type === 'COUNTER') {
                    const nextColor = ((object.counters?.colorIndex || 0) + 1) % 7;
                    onUpdate(object.id, { counters: { ...object.counters, colorIndex: nextColor } });
                } else {
                    toggleTap(null);
                }
            } else {
                // Single tap to switch selection if menu is open
                if (isAnySelected && onSelect && !isSelected) {
                    onSelect();
                }
            }
            lastTapRef.current = now;
        }

        if (isOverHand && isMobile && isControlledByMe) {
            onReturnToHand(object.id);
        }

        setIsDragging(false);
        if (onDragChange) onDragChange(false);
        setIsOverHand(false);
        setHasMoved(false);
        dragStartRef.current = null;
        if (e.target) (e.target as Element).releasePointerCapture(e.pointerId);

        if (hasMoved) onRelease(object.id, object.x, object.y);
    };

    const handleDoubleClick = (e: React.MouseEvent) => {
        // Prevent double click if clicking UI
        if ((e.target as HTMLElement).closest('.interactive-ui')) return;
        e.stopPropagation();

        if (isMobile) {
            if (isControlledByMe) {
                toggleTap(null);
            } else {
                onInspect(object.cardData);
            }
        } else {
            onInspect(object.cardData);
        }
    }

    const toggleTap = (e: React.MouseEvent | null) => {
        if (!isControlledByMe) return;
        if (e) e.stopPropagation();

        if (object.quantity > 1) {
            // For stacks, Double Click / Toggle Tap attempts to Tap/Untap ALL
            const allTapped = object.tappedQuantity === object.quantity;
            const newTappedCount = allTapped ? 0 : object.quantity;
            onUpdate(object.id, { tappedQuantity: newTappedCount });
            onLog(`${allTapped ? 'untapped' : 'tapped'} stack of ${object.quantity} ${object.cardData.name}s`);
        } else {
            const isTapped = object.rotation !== defaultRotation;
            const newRotation = isTapped ? defaultRotation : (defaultRotation + 90) % 360;
            onUpdate(object.id, { rotation: newRotation });
            onLog(`${!isTapped ? 'tapped' : 'untapped'} ${object.cardData.name}`);
        }
    };

    const adjustStackTap = (delta: number) => {
        if (!isControlledByMe) return;
        const newTapped = Math.min(Math.max(0, object.tappedQuantity + delta), object.quantity);
        if (newTapped !== object.tappedQuantity) {
            onUpdate(object.id, { tappedQuantity: newTapped });
            const action = delta > 0 ? 'tapped' : 'untapped';
            onLog(`${action} 1 ${object.cardData.name} (Untapped: ${untappedCount + (delta > 0 ? -1 : 1)}/${object.quantity})`);
        }
    }

    const toggleFaceDown = (e: React.MouseEvent) => {
        if (!isControlledByMe) return;
        e.stopPropagation();
        onUpdate(object.id, { isFaceDown: !object.isFaceDown });
    };

    const toggleTransform = (e: React.MouseEvent) => {
        if (!isControlledByMe) return;
        e.stopPropagation();
        onUpdate(object.id, { isTransformed: !object.isTransformed });
    };

    const updateCounter = (e: React.MouseEvent, delta: number) => {
        if (!isControlledByMe) return;
        e.preventDefault(); // Stop double click
        e.stopPropagation();
        const current = object.counters["+1/+1"] || 0;
        const newVal = current + delta;
        onUpdate(object.id, { counters: { ...object.counters, "+1/+1": newVal } });
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        if (!isControlledByMe) return;
        e.preventDefault();
        e.stopPropagation();
        if (!isMobile) toggleTap(e);
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
        const colorIndex = object.counters?.colorIndex || 0;
        const isNegative = object.quantity < 0;

        const getBackground = () => {
            switch (colorIndex) {
                case 1: return 'radial-gradient(circle at 30% 30%, #43e97b, #38f9d7)'; // Green
                case 2: return 'radial-gradient(circle at 30% 30%, #f6d365, #fda085)'; // Gold
                case 3: return 'radial-gradient(circle at 30% 30%, #a18cd1, #fbc2eb)'; // Purple
                case 4: return 'radial-gradient(circle at 30% 30%, #434343, #000000)'; // Black
                case 5: return 'radial-gradient(circle at 30% 30%, #e0e0e0, #ffffff)'; // White
                case 6: return 'radial-gradient(circle at 30% 30%, #ff9a9e, #fecfef)'; // Orange
                default: return isNegative
                    ? 'radial-gradient(circle at 30% 30%, #ff416c, #ff4b2b)' // Red
                    : 'radial-gradient(circle at 30% 30%, #4facfe, #00f2fe)'; // Blue
            }
        };

        const handleCounterDoubleClick = (e: React.MouseEvent) => {
            if (!isControlledByMe) return;
            e.stopPropagation();
            const nextColor = (colorIndex + 1) % 7;
            onUpdate(object.id, { counters: { ...object.counters, colorIndex: nextColor } });
        };

        return (
            <div
                ref={cardRef}
                className={`absolute touch-none select-none rounded-full flex items-center justify-center font-bold shadow-lg cursor-grab active:cursor-grabbing group ${isDragging ? 'z-[9999] scale-110' : ''} ${colorIndex === 5 ? 'text-black' : 'text-white'}`}
                style={{
                    left: object.x,
                    top: object.y,
                    width: 25 * scale,
                    height: 25 * scale,
                    zIndex: object.z,
                    background: getBackground(),
                    boxShadow: '0 2px 4px rgba(0,0,0,0.3), inset 1px 1px 3px rgba(255,255,255,0.4)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    transition: isDragging ? 'none' : 'transform 0.1s',
                }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onDoubleClick={handleCounterDoubleClick}
                onContextMenu={(e) => {
                    if (!isControlledByMe) return;
                    e.preventDefault();
                    e.stopPropagation();
                    onDelete(object.id);
                }}
                title="Drag to move. Double click to change color. Right click to remove."
            >
                <span
                    className="text-xs drop-shadow-md z-10 pointer-events-none select-none"
                    style={{ transform: `rotate(${-viewRotation}deg)` }}
                >{object.quantity}</span>

                {/* Controls (visible on hover) - Only if controlled */}
                {isControlledByMe && (
                    <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-20 bg-gray-900/80 rounded-full p-0.5 border border-gray-600">
                        <button
                            className="w-4 h-4 bg-gray-700 text-white rounded-full flex items-center justify-center hover:bg-red-500 border border-gray-600 transition-colors"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); onUpdate(object.id, { quantity: object.quantity - 1 }); }}
                            onDoubleClick={(e) => e.stopPropagation()}
                        >
                            <Minus size={8} />
                        </button>
                        <button
                            className="w-4 h-4 bg-gray-700 text-white rounded-full flex items-center justify-center hover:bg-green-500 border border-gray-600 transition-colors"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); onUpdate(object.id, { quantity: object.quantity + 1 }); }}
                            onDoubleClick={(e) => e.stopPropagation()}
                        >
                            <Plus size={8} />
                        </button>
                    </div>
                )}

                <div className="pointer-events-none">
                    {/* Visual Shine */}
                    <div className="absolute top-1 left-1.5 w-1.5 h-1 bg-white/40 rounded-full rotate-45" />
                </div>
            </div>
        )
    }

    const rad = (viewRotation || 0) * (Math.PI / 180);
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const s = viewScale || 1;
    const vx = viewX || 0;
    const vy = viewY || 0;

    // Determine if mana button should be shown
    // Show button when:
    // 1. Card has a mana source (produces mana)
    // 2. Card is controlled by me
    // 3. NOT passive (passive auto-adds mana)
    // 4. hideManaButton is FALSE (user wants to see the button)
    // 5. NOT a land (lands produce mana on tap automatically, no button needed)
    // 
    // When button is hidden but card has tap ability:
    // - The card still produces mana when tapped via tap-to-mana detection in Tabletop

    const isPassive = manaSource?.abilityType === 'passive' || manaRule?.trigger === 'passive';
    const isLand = object.cardData.isLand;

    // For lands without custom rules, default to hiding the button
    const effectiveHideButton = manaSource?.hideManaButton ?? (isLand && !manaRule);

    // Show mana button if:
    // - Has mana source AND controlled by me AND not passive
    // - AND (hideManaButton is false OR (it's NOT a land AND we don't have a specific override))
    // We want utility lands (hideManaButton === false) to show their button.
    const shouldShowManaButton = showManaCalculator &&
        manaSource &&
        isControlledByMe &&
        !isPassive &&
        !effectiveHideButton;

    // Log for debugging - only log once per card ID when visibility changes
    const loggedButtonId = useRef<string | null>(null);
    useEffect(() => {
        // Only log when button visibility actually changes for a card
        if (manaSource && isControlledByMe && loggedButtonId.current !== object.id) {
            loggedButtonId.current = object.id;
            console.log(`[Card] ${object.cardData.name} shouldShowManaButton: ${shouldShowManaButton}`, {
                hasSource: !!manaSource,
                isControlledByMe,
                isPassive,
                hideManaButton: manaSource.hideManaButton,
                isLand,
                effectiveHideButton,
                trigger: manaRule?.trigger
            });
        }
    }, [object.id]); // Only re-run if card ID changes

    // Get the primary mana color for display
    const getPrimaryManaIcon = () => {
        if (!manaSource) return '/mana/colorless.png';
        let produced = manaSource.producedMana;

        // Fallback for empty produced array if rule exists (e.g. conditional production currently 0)
        if (produced.length === 0 && manaRule && manaRule.produced) {
            produced = Object.keys(manaRule.produced).filter(k => manaRule.produced[k] > 0) as any[];
        }

        // If flexible (multiple options or WUBRG/CMD), show rainbow
        if (manaSource.isFlexible || produced.includes('WUBRG') || produced.includes('CMD')) {
            return '/mana/all.png';
        }

        // If single color, show that color
        if (produced.length > 0) {
            const color = produced[0];
            const colorMap: Record<string, string> = {
                'W': 'white', 'U': 'blue', 'B': 'black', 'R': 'red', 'G': 'green', 'C': 'colorless'
            };
            return `/mana/${colorMap[color] || 'colorless'}.png`;
        }

        return '/mana/colorless.png';
    };

    const cardContent = (
        <div
            ref={cardRef}
            className={`absolute touch-none select-none transition-shadow ${isDragging ? 'z-[9999] shadow-2xl' : 'shadow-md'} ${isControlledByMe ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'} ${isOverHand ? 'ring-4 ring-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.8)]' : ''} ${isSelected ? 'ring-4 ring-yellow-400 shadow-[0_0_20px_rgba(250,204,21,0.6)]' : ''}`}
            style={{
                left: object.x,
                top: object.y,
                width: CARD_WIDTH * scale,
                height: CARD_HEIGHT * scale,
                zIndex: object.z,
                transform: isDragging && isMobile ? `rotate(${effectiveRotation}deg) scale(1)` : `rotate(${effectiveRotation}deg)`,
                transition: isDragging ? 'none' : 'transform 0.2s ease-out, box-shadow 0.2s',
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onDoubleClick={handleDoubleClick}
            onContextMenu={handleContextMenu}
            onClick={() => !isMobile && setShowOverlay(false)} // Tap to close overlay if open (desktop only)
            onMouseEnter={() => onHover && onHover(object.id)}
            onMouseLeave={() => onHover && onHover(null)}
            data-object-id={object.id}
        >
            {/* Stack Layers (Behind) */}
            {isStack && (
                <>
                    <div className="absolute top-1 left-1 w-full h-full bg-gray-700 rounded border border-gray-600 -z-10" />
                    <div className="absolute top-2 left-2 w-full h-full bg-gray-600 rounded border border-gray-500 -z-20" />
                </>
            )}

            <div className="relative w-full h-full group perspective-1000">
                <div className={`relative w-full h-full rounded-[4px] overflow-hidden bg-gray-800 border-2 ${object.isCopy ? 'border-white px-[1px] py-[1px]' : (object.cardData.isToken ? 'border-yellow-400' : 'border-black/50')}`}>
                    {object.isFaceDown ? (
                        // Render Sleeve
                        <div
                            className="w-full h-full flex items-center justify-center border-4 border-white/10 overflow-hidden"
                            style={{ backgroundColor: sleeveColor }}
                        >
                            {sleeveImage ? (
                                <img src={sleeveImage} className="w-full h-full object-cover" alt="Sleeve" />
                            ) : (
                                <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center">
                                    <div className="w-12 h-12 rounded-full border-2 border-white/20" />
                                </div>
                            )}
                        </div>
                    ) : (
                        <img
                            src={displayImage}
                            alt={object.cardData.name}
                            className="w-full h-full object-cover pointer-events-none"
                        />
                    )}

                    {/* Counters Visual */}
                    {(object.counters["+1/+1"] || 0) !== 0 && (
                        <div className={`absolute top-2 right-2 font-bold rounded-full w-8 h-8 flex items-center justify-center border-2 shadow-lg z-10 pointer-events-none ${(object.counters["+1/+1"] || 0) > 0 ? "bg-white text-black border-blue-500" : "bg-red-600 text-white border-red-800"
                            }`}>
                            {object.counters["+1/+1"]}
                        </div>
                    )}

                    {/* Mana Button Overlay (Top-Left) - Shows on hover only */}
                    {shouldShowManaButton && (
                        <div
                            className="absolute top-2 left-2 z-30 transition-opacity opacity-0 group-hover:opacity-100"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                                e.stopPropagation();
                                console.log(`[Card] Mana button clicked for ${object.cardData.name}`);
                                onManaClick?.();
                            }}
                            onDoubleClick={(e) => e.stopPropagation()}
                        >
                            <button className="w-8 h-8 rounded-full bg-gray-900/90 border-2 border-amber-500/50 shadow-[0_0_10px_rgba(245,158,11,0.5)] flex items-center justify-center hover:scale-110 active:scale-95 transition-transform">
                                <img src={getPrimaryManaIcon()} className="w-5 h-5 object-contain drop-shadow-md" alt="Mana" />
                            </button>
                            {/* Mana count indicator */}
                            {manaSource.manaCount && manaSource.manaCount > 1 && (
                                <span className="absolute -bottom-1 -right-1 bg-amber-500 text-black text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                                    {manaSource.manaCount}
                                </span>
                            )}
                        </div>
                    )}

                    {/* Hover Actions */}
                    <div className={`absolute inset-0 bg-black/60 transition-opacity flex flex-col items-center justify-center gap-2 p-1 ${!isMobile && showOverlay ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} ${isMobile ? 'hidden' : ''}`}>

                        {/* Stack Controls */}
                        {isStack && isControlledByMe ? (
                            <div className="flex flex-col gap-1 items-center interactive-ui mb-1">
                                <div className="flex items-center gap-1">
                                    <span className="text-[10px] text-gray-300 font-bold uppercase">Untapped</span>
                                    <div className="flex items-center gap-1 bg-gray-800/80 rounded-full px-2 py-0.5">
                                        <button onClick={(e) => { e.stopPropagation(); adjustStackTap(1); }} className="text-gray-300 hover:text-white"><RotateCw size={14} /></button>
                                        <span className="text-xs font-mono min-w-[2rem] text-center">{untappedCount}/{object.quantity}</span>
                                        <button onClick={(e) => { e.stopPropagation(); adjustStackTap(-1); }} className="text-gray-300 hover:text-white"><RefreshCcw size={14} /></button>
                                    </div>
                                </div>
                                <div className="flex gap-1">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); onRemoveOne(object.id); }}
                                        className="flex items-center gap-1 px-2 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded-full text-[10px] font-bold"
                                        title="Split 1"
                                    >
                                        <Minus size={10} /> 1
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); onUnstack(object.id); }}
                                        className="flex items-center gap-1 px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-full text-[10px] font-bold"
                                        title="Unstack All"
                                    >
                                        <Copy size={10} /> All
                                    </button>
                                </div>
                            </div>
                        ) : isControlledByMe ? (
                            <div className="flex gap-1 interactive-ui">
                                <button onClick={toggleTap} className="p-1.5 bg-gray-800 text-white rounded-full hover:bg-blue-600" title="Tap/Untap">
                                    <RotateCw size={12} />
                                </button>
                            </div>
                        ) : null}

                        <div className="flex gap-1 interactive-ui flex-wrap justify-center">
                            {isControlledByMe && (
                                <>
                                    {/* Tokens and Copies only get Delete button, no return to hand */}
                                    {(object.cardData.isToken || object.isCopy) ? (
                                        <button onClick={() => onDelete(object.id)} className="p-1.5 bg-red-900/80 text-white rounded-full hover:bg-red-600" title="Delete">
                                            <Trash2 size={12} />
                                        </button>
                                    ) : (
                                        <>
                                            <button onClick={() => onReturnToHand(object.id)} className="p-1.5 bg-gray-800 text-white rounded-full hover:bg-blue-500" title="Return to Hand">
                                                <Reply size={12} />
                                            </button>
                                            <button onClick={toggleFaceDown} className="p-1.5 bg-gray-800 text-white rounded-full hover:bg-purple-600" title="Flip Face Down/Up">
                                                <EyeOff size={12} />
                                            </button>
                                        </>
                                    )}
                                    {/* Face down option for tokens/copies too */}
                                    {(object.cardData.isToken || object.isCopy) && (
                                        <button onClick={toggleFaceDown} className="p-1.5 bg-gray-800 text-white rounded-full hover:bg-purple-600" title="Flip Face Down/Up">
                                            <EyeOff size={12} />
                                        </button>
                                    )}
                                </>
                            )}
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (!isControlledByMe) onLog(`inspected ${object.cardData.name}`);
                                    onInspect(object.cardData);
                                }}
                                className="p-1.5 bg-gray-800 text-white rounded-full hover:bg-green-600"
                                title="Inspect"
                            >
                                <Maximize2 size={12} />
                            </button>
                            {/* Copy button - available for all cards */}
                            {onCopy && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); onCopy(object.id); }}
                                    className="p-1.5 bg-cyan-700 text-white rounded-full hover:bg-cyan-500"
                                    title="Create Copy"
                                >
                                    <Copy size={12} />
                                </button>
                            )}
                            {/* Steal/Request Control button - only for opponent's cards */}
                            {!isControlledByMe && onRequestControl && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); onRequestControl(object.id, object.cardData.name, object.controllerId); }}
                                    className="p-1.5 bg-amber-700 text-white rounded-full hover:bg-amber-500"
                                    title="Request Control"
                                >
                                    <Hand size={12} />
                                </button>
                            )}
                        </div>

                        {object.cardData.backImageUrl && isControlledByMe && (
                            <button onClick={toggleTransform} className="p-1 px-3 bg-gray-800 text-white rounded-full hover:bg-amber-600 flex items-center gap-1 text-[10px] interactive-ui" title="Transform">
                                <RefreshCcw size={10} /> Transform
                            </button>
                        )}

                        {/* Counter Controls */}
                        {isControlledByMe && (
                            <div className="flex items-center gap-2 mt-1 interactive-ui pointer-events-auto" onDoubleClick={(e) => e.stopPropagation()}>
                                <button onPointerDown={(e) => e.stopPropagation()} onClick={(e) => updateCounter(e, -1)} className="text-red-400 hover:text-red-200 p-1"><MinusCircle size={20} /></button>
                                <span className="text-white text-xs font-bold select-none">+1/+1</span>
                                <button onPointerDown={(e) => e.stopPropagation()} onClick={(e) => updateCounter(e, 1)} className="text-green-400 hover:text-green-200 p-1"><PlusCircle size={20} /></button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Stack Count Badge - Moved outside overflow-hidden */}
                {isStack && (
                    <div className="absolute -top-3 -right-3 bg-red-600 text-white font-mono rounded-lg px-2 h-6 border-2 border-gray-900 shadow-xl z-20 flex items-center justify-center text-xs font-bold pointer-events-none whitespace-nowrap">
                        {untappedCount} / {object.quantity}
                    </div>
                )}
            </div>
        </div >
    );

    return cardContent;
};
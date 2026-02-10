export enum CardState {
  UNTAPPED = 'UNTAPPED',
  TAPPED = 'TAPPED',
}

export interface CardData {
  id: string; // Unique instance ID
  scryfallId: string;
  name: string;
  imageUrl: string;
  backImageUrl?: string; // For transform cards
  typeLine: string;
  oracleText: string;
  manaCost: string;
  cmc: number;
  isLand: boolean;
  power?: string;
  toughness?: string;
  isCommander?: boolean;
  isToken?: boolean;
  shortcutKey?: string;
}

export interface BoardObject {
  id: string;
  type: 'CARD' | 'COUNTER'; // Distinguish between cards and physical counters
  cardData: CardData;
  x: number;
  y: number;
  z: number;
  rotation: number; // in degrees, usually 0 or 90
  isFaceDown: boolean; // Morph/Manifest state (Sleeve visible)
  isTransformed: boolean; // DFC state (Back face visible)
  counters: { [key: string]: number }; // e.g., "+1/+1": 2
  commanderDamage: { [playerId: string]: number }; // Damage dealt BY this commander TO specific players
  controllerId: string;
  // Stacking properties
  quantity: number; 
  tappedQuantity: number;
}

export interface Player {
  id: string;
  name: string;
  sleeveColor: string; // Hex code for sleeve
  color: string;
  life: number;
  poison: number;
  commanderDamage: { [commanderId: string]: number };
  hand: CardData[];
  library: CardData[];
  graveyard: CardData[];
  exile: CardData[];
  commandZone: CardData[];
}

export interface PlayerStats {
  damageDealt: Record<string, number>; // opponentId -> amount
  damageReceived: number;
  healingGiven: number;
  healingReceived: number;
  selfHealing: number;
  tappedCounts: Record<string, number>; // cardName -> count
  totalTurnTime: number; // ms
  cardsPlayed: number;
  cardsSentToGraveyard: number;
  cardsExiled: number;
  cardsDrawn: number;
}

export interface GameState {
  roomId: string;
  players: Player[];
  boardObjects: BoardObject[];
  currentPlayerId: string;
}

export interface DragItem {
  type: 'CARD' | 'DICE';
  id: string;
  offsetX: number;
  offsetY: number;
}

export interface LogEntry {
  id: string;
  timestamp: number;
  playerId: string;
  playerName: string;
  message: string;
  type: 'ACTION' | 'CHAT' | 'SYSTEM';
}

export type ManaColor = 'W' | 'U' | 'B' | 'R' | 'G' | 'C' | 'WUBRG' | 'CMD';

export interface ManaRule {
  // Disable mana production from this card entirely
  disabled?: boolean;
  // Activation trigger
  trigger: 'tap' | 'activated' | 'passive';
  // Activation cost (mana required to activate ability)
  activationCost: Record<ManaColor, number>;
  genericActivationCost?: number; // Generic mana cost (e.g. {1})
  // How the mana amount is calculated
  calcMode: 'set' | 'counters' | 'creatures' | 'basicLands';
  calcMultiplier: number; // default 1
  includeBasePower?: boolean; // when counters mode: add creature's base power to counter count
  // How the mana is produced
  prodMode: 'standard' | 'multiplied' | 'available' | 'chooseColor' | 'commander';
  // 'available' = one mana of any color you have lands for
  // 'chooseColor' = player picks a color at runtime via modal
  produced: Record<ManaColor, number>; // e.g. {W:0,U:0,B:0,R:0,G:2,C:0}
  producedAlt?: Record<ManaColor, number>; // "or" choice
  includeNonBasics?: boolean; // for multiplied mode
  // Alternative rule set (opens modal for player to choose which rule to apply)
  alternativeRule?: ManaRule;
  // Persistence of produced mana
  persistence: 'permanent' | 'untilNextTurn' | 'untilEndOfTurn';
  // Global application (e.g. "All Creatures have...")
  appliesTo?: ('creatures' | 'lands')[];
  appliesToCondition?: 'counters'; // Only applies if card has counters (e.g. Rishkar)

  // Global Multipliers (e.g. Virtue of Strength)
  manaMultiplier?: number; // e.g. 3 for "triples mana produced by basic lands"

  // Auto-tap settings
  autoTap: boolean;
  autoTapPriority: number; // decimal allowed
  // UI settings
  hideManaButton?: boolean;
}

export const EMPTY_MANA_RULE: ManaRule = {
  trigger: 'tap',
  activationCost: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, WUBRG: 0, CMD: 0 },
  genericActivationCost: 0,
  calcMode: 'set',
  calcMultiplier: 1,
  prodMode: 'standard',
  produced: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, WUBRG: 0, CMD: 0 },
  persistence: 'permanent',
  manaMultiplier: 1,
  autoTap: true,
  autoTapPriority: 1,
  hideManaButton: true,
};

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
  isManaSource?: boolean;
  producedMana?: string[]; // e.g. ['G'], ['C','C'], ['W','U','B','R','G']
  manaAbilityType?: 'tap' | 'activated' | 'multi' | 'complex'; // How this card produces mana
  manaActivationCost?: string; // Cost to activate mana ability e.g. '{1}' for '{1}, {T}: Add {G}{G}'
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
  manaUsed: Record<string, number>; // color -> total spent (W, U, B, R, G, C)
  manaProduced: Record<string, number>; // color -> total produced
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

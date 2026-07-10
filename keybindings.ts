// Shared keybinding definitions used by both Tabletop and LobbySettingsModal.
// Extracted to its own module to avoid circular imports.

export interface KeyActionDef { id: string; label: string; defaultKey: string; group: string; }
export const KEY_ACTIONS: KeyActionDef[] = [
    { id: 'tapHovered', label: 'Tap / untap hovered card', defaultKey: 't', group: 'Board' },
    { id: 'untapAll', label: 'Untap all', defaultKey: 'u', group: 'Board' },
    { id: 'draw', label: 'Draw a card', defaultKey: 'd', group: 'Board' },
    { id: 'shuffle', label: 'Shuffle library', defaultKey: 's', group: 'Board' },
    { id: 'playCommander', label: 'Play / return commander', defaultKey: 'c', group: 'Board' },
    { id: 'rollDice', label: 'Roll a d6', defaultKey: 'r', group: 'Board' },
    { id: 'spawnCounter', label: 'Create a counter', defaultKey: 'f', group: 'Board' },
    { id: 'nextTurn', label: 'Pass turn / advance phase', defaultKey: 'enter', group: 'Turn' },
    { id: 'lifeUp', label: 'Life +1', defaultKey: 'arrowup', group: 'Turn' },
    { id: 'lifeDown', label: 'Life -1', defaultKey: 'arrowdown', group: 'Turn' },
    { id: 'searchLibrary', label: 'Search library', defaultKey: 'x', group: 'Zones' },
    { id: 'searchGraveyard', label: 'View graveyard', defaultKey: 'g', group: 'Zones' },
    { id: 'searchExile', label: 'View exile', defaultKey: 'e', group: 'Zones' },
    { id: 'searchTokens', label: 'Token search', defaultKey: 'k', group: 'Zones' },
    { id: 'toggleLog', label: 'Toggle log', defaultKey: 'l', group: 'Panels' },
    { id: 'toggleStats', label: 'Toggle stats', defaultKey: 'q', group: 'Panels' },
    { id: 'toggleCmdrDamage', label: 'Toggle commander damage', defaultKey: 'w', group: 'Panels' },
    { id: 'toggleOpponentView', label: 'Toggle opponent view', defaultKey: 'v', group: 'Panels' },
    { id: 'toggleShortcuts', label: 'Open controls / help', defaultKey: '?', group: 'Panels' },
];
export const KEYBINDINGS_STORAGE = 'planeswalker_keybindings_v1';

export const defaultKeyBindings = (): Record<string, string> => {
    const m: Record<string, string> = {};
    KEY_ACTIONS.forEach(a => { m[a.id] = a.defaultKey; });
    return m;
};

export const loadKeyBindings = (): Record<string, string> => {
    const defaults = defaultKeyBindings();
    try {
        const stored = JSON.parse(localStorage.getItem(KEYBINDINGS_STORAGE) || '{}');
        return { ...defaults, ...stored };
    } catch { return defaults; }
};

// Human-readable label for a bound key ('arrowup' -> '↑', 'enter' -> 'Enter').
export const keyLabel = (key: string): string => {
    if (!key) return '—';
    const map: Record<string, string> = {
        arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→',
        enter: 'Enter', ' ': 'Space', escape: 'Esc',
    };
    return map[key] || key.toUpperCase();
};

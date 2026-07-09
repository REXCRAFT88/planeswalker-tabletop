// A compact Commander rules digest baked into the brain's system prompt. It rides
// in the cached system prefix (see the Anthropic provider's cache_control), so it
// costs almost nothing per turn after the first. The goal isn't to teach the model
// Magic from scratch — it's to pin down the Commander-specific rules and the
// numbers it must get right (commander damage, tax, starting life), plus the turn
// structure this tabletop uses.
export const RULES_DIGEST = `MAGIC: THE GATHERING — COMMANDER RULES DIGEST

Game structure (each turn, in order):
1. Beginning: untap your permanents, then upkeep triggers, then draw a card
   (the player going first skips their first draw in 1v1; in multiplayer
   everyone draws normally).
2. Precombat main phase: play up to one land, cast sorcery-speed spells.
3. Combat: declare attackers (tap them unless they have vigilance), then the
   defending players declare blockers, then combat damage is dealt
   simultaneously. A creature deals damage equal to its power.
4. Postcombat main phase: play a land if you haven't, cast more spells.
5. End: end-of-turn triggers, then discard down to your maximum hand size
   (7 by default), then "until end of turn" effects wear off.

Priority & the stack:
- Spells and activated/triggered abilities go on the stack and resolve
  last-in-first-out. Instants and abilities can be cast/activated any time you
  have priority; sorceries, creatures, and most other permanents only during
  your own main phase with an empty stack.
- You may respond to something before it resolves.

Combat math:
- Damage is dealt all at once. A creature with lethal damage (>= its
  toughness) is destroyed as a state-based action. Deathtouch makes any
  amount lethal. First strike deals damage in a separate earlier step.
- Trample assigns only lethal to blockers and the rest to the player.
- Multiple blockers: the attacker's controller orders them and assigns damage.

Commander-specific rules:
- Start at 40 life. Decks are 100 cards, singleton (max one of each card
  except basic lands), all within the commander's color identity.
- Your commander starts in the command zone. You may cast it from there; each
  time it has been cast from the command zone before, it costs an extra {2}
  (commander tax). If it would go to graveyard/exile/hand/library, you may
  instead move it to the command zone.
- Partners / "choose a Background": a deck may have two commanders. Companion:
  a card that starts outside the game; if your deck meets its condition you may
  pay {3} once to put it into your hand.
- Commander damage: a player who takes 21 or more combat damage from a single
  commander loses. Track it per commander.
- Losing: 0 or less life, drawing from an empty library, 10+ poison counters,
  or 21 commander damage from one commander.

Mulligans (London): draw 7, decide to keep or mulligan; each mulligan reshuffles
and redraws 7, then you put N cards on the bottom where N = number of mulligans
taken. Keepable hands usually have 2-4 lands and a workable curve.

This tabletop is honor-system: nothing is auto-enforced except mana when you
cast. Announce anything the tools can't express, and play at a normal, fair
level.`;

// Deck definition for the AI-themed card deck living in /cards.
// Colors: amber, blue, clay, green  (+ wild)
// Kinds:  number | skip | reverse | draw2 | wild | wild_draw4
//
// Every card object:
//   { id, file, color, kind, value?, special?, label? }
//   - file:    svg/png basename (without extension) under /cards
//   - color:   'amber' | 'blue' | 'clay' | 'green' | 'wild'
//   - kind:    game mechanic
//   - value:   number 0-9 for number cards
//   - special: theme id for the special "x-" cards (drives a flavour toast)
//   - label:   Turkish flavour text shown when a special card is played

export const COLORS = ['amber', 'blue', 'clay', 'green'];

export const COLOR_HEX = {
  amber: '#E0A53D',
  blue: '#4E7FB5',
  clay: '#D9764A',
  green: '#6E9457',
  wild: '#2A2520',
};

// The 10 special "x-" cards mapped onto concrete card mechanics + flavour.
// They behave exactly like their `kind` (so matching stays well-defined),
// but display a Turkish toast and a small badge.
const SPECIALS = [
  { file: 'x-chain-of-thought', color: 'blue',  kind: 'draw2',      label: 'chain-of-thought açık' },
  { file: 'x-context-full',     color: 'blue',  kind: 'skip',       label: 'context window doldu' },
  { file: 'x-deep-think',       color: 'wild',  kind: 'wild_draw4', label: 'extended thinking on' },
  { file: 'x-fine-tune',        color: 'clay',  kind: 'reverse',    label: 'fine-tune, düzelttim' },
  { file: 'x-hallucinate',      color: 'clay',  kind: 'skip',       label: 'hallucination alarmı' },
  { file: 'x-infinite-context', color: 'wild',  kind: 'wild',       label: 'infinite context açık' },
  { file: 'x-rate-limit',       color: 'amber', kind: 'skip',       label: '429 rate limited' },
  { file: 'x-system-prompt',    color: 'green', kind: 'draw2',      label: "system prompt'a dön" },
  { file: 'x-token-budget',     color: 'amber', kind: 'draw2',      label: 'token budget bitti' },
  { file: 'x-where-were-we',    color: 'green', kind: 'reverse',    label: 'nerede kalmıştık?' },
];

let _uid = 0;
const nextId = () => `c${(_uid++).toString(36)}`;

// Build a fresh, fully-identified deck (each entry is a unique physical card).
// Options let game modes reshape the deck without touching the base rules:
//   decks       — how many full decks to shuffle together (Çift Deste = 2)
//   extraWilds  — extra joker / +4 joker cards mixed in (Bol Joker)
// ids stay unique across every call because nextId() is a monotonic counter.
export function buildDeck({ decks = 1, extraWilds = 0 } = {}) {
  const cards = [];
  const add = (c) => cards.push({ id: nextId(), ...c });

  for (let d = 0; d < Math.max(1, decks); d++) {
    for (const color of COLORS) {
      // single 0
      add({ file: `${color}-0`, color, kind: 'number', value: 0 });
      // 1..9 have two copies (-a, -b)
      for (let n = 1; n <= 9; n++) {
        add({ file: `${color}-${n}-a`, color, kind: 'number', value: n });
        add({ file: `${color}-${n}-b`, color, kind: 'number', value: n });
      }
      // action cards, two copies each
      for (const kind of ['skip', 'reverse', 'draw2']) {
        add({ file: `${color}-${kind}-a`, color, kind });
        add({ file: `${color}-${kind}-b`, color, kind });
      }
    }

    // wilds (4 face variants each)
    for (let i = 1; i <= 4; i++) add({ file: `wild-${i}`, color: 'wild', kind: 'wild' });
    for (let i = 1; i <= 4; i++) add({ file: `wild-draw4-${i}`, color: 'wild', kind: 'wild_draw4' });

    // special AI cards
    for (const s of SPECIALS) {
      add({ file: s.file, color: s.color, kind: s.kind, special: s.file.replace(/^x-/, ''), label: s.label });
    }
  }

  // Bol Joker: half plain jokers, half +4 jokers, cycling the 4 face variants.
  for (let i = 0; i < extraWilds; i++) {
    const v = (i % 4) + 1;
    if (i % 2 === 0) add({ file: `wild-${v}`, color: 'wild', kind: 'wild' });
    else add({ file: `wild-draw4-${v}`, color: 'wild', kind: 'wild_draw4' });
  }

  return cards;
}

// Fisher-Yates shuffle in place.
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Can `card` legally be played on `top`, given the current active color?
export function canPlay(card, top, activeColor) {
  if (!card || !top) return false;
  if (card.kind === 'wild' || card.kind === 'wild_draw4') return true;
  if (card.color === activeColor) return true;
  if (card.kind === 'number' && top.kind === 'number' && card.value === top.value) return true;
  // same action symbol of a different colour is playable (classic rule)
  if (card.kind !== 'number' && card.kind === top.kind) return true;
  return false;
}

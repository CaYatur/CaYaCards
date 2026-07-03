// Card asset helpers. Cards live in /cards/svg/<file>.svg (240x360).
import * as THREE from 'three';

export const CARD_W = 240;
export const CARD_H = 360;
export const CARD_RATIO = CARD_H / CARD_W; // 1.5

export const COLOR_HEX = {
  amber: '#E0A53D', blue: '#4E7FB5', clay: '#D9764A', green: '#6E9457', wild: '#2A2520',
};

export function svgPath(file) { return `/cards/svg/${file}.svg`; }
export function backPath() { return '/cards/svg/back.svg'; }

// ---- three.js texture cache (SVG rasterised onto a canvas) ----------------
const texCache = new Map();  // file -> Promise<Texture|null>  (in-flight or done)
const texReady = new Map();  // file -> Texture                (resolved, ready now)
const TEX_W = 384, TEX_H = 576;

function rasterize(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = TEX_W; cv.height = TEX_H;
      const ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, TEX_W, TEX_H);
      ctx.drawImage(img, 0, 0, TEX_W, TEX_H);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      tex.needsUpdate = true;
      resolve(tex);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export function getTexture(file) {
  if (texCache.has(file)) return texCache.get(file);
  const p = rasterize(svgPath(file)).then((t) => { if (t) texReady.set(file, t); return t; });
  texCache.set(file, p);
  return p;
}

// Synchronous lookup: returns the decoded texture if it is already cached,
// otherwise null. Lets callers render a card fully-textured on the same frame
// (after preload) instead of flashing a placeholder while the SVG loads.
export function getTextureSync(file) {
  return texReady.get(file) || null;
}

export function getBackTexture() {
  if (texCache.has('__back')) return texCache.get('__back');
  const p = rasterize(backPath()).then((t) => { if (t) texReady.set('__back', t); return t; });
  texCache.set('__back', p);
  return p;
}

export function isWild(card) {
  return card && (card.kind === 'wild' || card.kind === 'wild_draw4');
}

// Mirror of the server rule, used to highlight playable cards in the hand.
export function canPlay(card, top, activeColor, pendingDraw = 0) {
  if (!card || !top) return false;
  // an open +2/+4 stack: only another draw card may be stacked
  if (pendingDraw > 0) return card.kind === 'draw2' || card.kind === 'wild_draw4';
  if (card.kind === 'wild' || card.kind === 'wild_draw4') return true;
  if (card.color === activeColor) return true;
  if (card.kind === 'number' && top.kind === 'number' && card.value === top.value) return true;
  if (card.kind !== 'number' && card.kind === top.kind) return true;
  return false;
}

// Every card-face basename in the deck (mirrors server/deck.js). Kept here so
// the client can warm the texture cache without waiting for a game state.
const PRELOAD_COLORS = ['amber', 'blue', 'clay', 'green'];
const PRELOAD_SPECIALS = [
  'x-chain-of-thought', 'x-context-full', 'x-deep-think', 'x-fine-tune', 'x-hallucinate',
  'x-infinite-context', 'x-rate-limit', 'x-system-prompt', 'x-token-budget', 'x-where-were-we',
];

export function allCardFiles() {
  const files = [];
  for (const c of PRELOAD_COLORS) {
    files.push(`${c}-0`);
    for (let n = 1; n <= 9; n++) files.push(`${c}-${n}-a`, `${c}-${n}-b`);
    for (const k of ['skip', 'reverse', 'draw2']) files.push(`${c}-${k}-a`, `${c}-${k}-b`);
  }
  for (let i = 1; i <= 4; i++) files.push(`wild-${i}`);
  for (let i = 1; i <= 4; i++) files.push(`wild-draw4-${i}`);
  files.push(...PRELOAD_SPECIALS);
  return files;
}

// Rasterise every card face into the cache, a few at a time so the network /
// canvas work is spread over a handful of frames instead of one big burst.
export function preloadAll(concurrency = 8) {
  const files = allCardFiles();
  let i = 0;
  const pump = () => {
    if (i >= files.length) return;
    getTexture(files[i++]).finally(pump);
  };
  for (let k = 0; k < concurrency && k < files.length; k++) pump();
}

// Preload the back (needed first) then warm the whole deck so cards never flash
// black while their texture streams in — for new hands and for played cards.
export function preloadCommon() {
  getBackTexture();
  preloadAll();
}

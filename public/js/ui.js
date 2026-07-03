// HTML overlay UI: 3D customizer, menu, lobby, in-game HUD (hand rail, action
// buttons, colour picker, turn timer, toasts, chat, winner). Talks to the app
// through a set of handlers wired in bind().
import { svgPath, canPlay, isWild } from './cards.js';
import { BODY_COLORS, HATS, GLASSES, FACES, AURAS } from './cosmetics.js';
import { CharCreator } from './charcreator.js';
import { sfx } from './sound.js';

const $ = (id) => document.getElementById(id);

const MODE_ICON = { party: '🎉', chaos: '🌀', classic: '🎴', turbo: '⚡', nomercy: '☠️', wildparty: '🃏', doubledeck: '🔢', bomb: '💣' };
const MODE_LABEL = { party: '🎉 Eğlence', chaos: '🌀 Kaos', classic: '🎴 Klasik', turbo: '⚡ Turbo', nomercy: '☠️ Acımasız', wildparty: '🃏 Bol Joker', doubledeck: '🔢 Çift Deste', bomb: '💣 Bomba' };
const modeIcon = (m) => MODE_ICON[m] || MODE_ICON.classic;
const modeLabel = (m) => MODE_LABEL[m] || MODE_LABEL.classic;

let H = {};
let lastEventSeq = -1;
let pendingWild = null;     // cardId awaiting colour choice
let charCreator = null;
let prevMyTurn = false;

let turnActive = false;
let turnIsMine = false;
let turnDeadline = 0;
let turnDuration = 30000;
let lastTickSec = 99;
let layoutHand = null;
let waitActive = false;
let waitDeadline = 0;
let waitNames = [];

// Reconnect/waiting overlay — shown to everyone while a player has dropped.
export function renderWait(state) {
  if (state && state.frozen) {
    waitActive = true; waitDeadline = state.reconnectEndsAt || 0; waitNames = state.disconnectedNames || [];
    $('wait-title').textContent = `${waitNames.join(', ') || 'Oyuncu'} bağlantısı koptu`;
    $('wait-overlay').classList.add('show');
  } else {
    waitActive = false;
    $('wait-overlay').classList.remove('show');
  }
}

// Fan the hand so every card fits the width without scrolling (no shrinking) —
// cards overlap more as the hand grows; very large hands fall back to scroll.
function fitHand(hand, cardEls) {
  const n = cardEls.length;
  if (!n) return;
  const cardW = innerWidth >= 760 ? 96 : 84;
  const avail = (hand.clientWidth || innerWidth) - 6;
  const comfortableStep = cardW * 0.66;
  const minStep = 22;
  let step = comfortableStep;
  if (n > 1) step = Math.min(comfortableStep, Math.max(minStep, (avail - cardW) / (n - 1)));
  const overlap = Math.round(cardW - step);
  cardEls.forEach((el, i) => { el.style.marginLeft = i === 0 ? '0px' : `-${overlap}px`; });
}

export function showScreen(name) {
  for (const s of document.querySelectorAll('.screen')) s.classList.remove('active');
  $('hud').classList.remove('active');
  if (name === 'menu') $('screen-menu').classList.add('active');
  else if (name === 'lobby') $('screen-lobby').classList.add('active');
  else if (name === 'game') $('hud').classList.add('active');
  // on the menu, hide the empty in-game table behind a clean gradient
  document.body.classList.toggle('menu-bg', name === 'menu');
  // pause the 3D preview when it isn't on screen
  if (charCreator) { if (name === 'menu') charCreator.start(); else charCreator.stop(); }
}

export function hideLoader() { $('loader').classList.add('hide'); }

// ---- 3D customizer ---------------------------------------------------------
export function buildCustomizer(cos, onChange) {
  const stage = $('cz-stage');
  const opts = $('cz-options');
  stage.innerHTML = '';
  opts.innerHTML = '';

  const canvas = document.createElement('canvas');
  canvas.className = 'cz-canvas';
  stage.appendChild(canvas);
  const hint = document.createElement('div');
  hint.className = 'cz-hint';
  hint.textContent = 'karakterini döndürmek için sürükle';
  stage.appendChild(hint);

  charCreator = new CharCreator(canvas);
  charCreator.setCosmetics(cos);
  charCreator.start();

  function row(label, items, key, isColor) {
    const r = document.createElement('div'); r.className = 'cz-row row-' + key;
    const h = document.createElement('span'); h.textContent = label; r.appendChild(h);
    const opts = document.createElement('div'); opts.className = 'cz-opts';
    for (const it of items) {
      const b = document.createElement('button');
      b.className = 'cz-opt' + (isColor ? ' swatch' : '');
      const val = isColor ? it : it.id;
      if (isColor) b.style.background = it; else b.textContent = it.emoji;
      if (cos[key] === val) b.classList.add('sel');
      b.onclick = () => {
        cos[key] = val;
        opts.querySelectorAll('.cz-opt').forEach((x) => x.classList.remove('sel'));
        b.classList.add('sel');
        sfx.play('click');
        if (charCreator) charCreator.setCosmetics({ ...cos });
        onChange({ ...cos });
      };
      opts.appendChild(b);
    }
    r.appendChild(opts); return r;
  }

  opts.appendChild(row('Renk', BODY_COLORS, 'body', true));
  opts.appendChild(row('Şapka', HATS, 'hat'));
  opts.appendChild(row('Gözlük', GLASSES, 'glasses'));
  opts.appendChild(row('Yüz', FACES, 'face'));
  opts.appendChild(row('Aura', AURAS, 'aura'));
}

// ---- public room list ------------------------------------------------------
export function renderRooms(list) {
  const ul = $('room-list');
  if (!list || !list.length) {
    ul.innerHTML = '<li class="empty">Henüz açık oda yok — ilkini sen kur!</li>';
    return;
  }
  ul.innerHTML = '';
  for (const r of list) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${modeIcon(r.mode)} <b>${escapeHtml(r.name)}</b> <span class="rl-meta">· ${r.code}</span></span>
      <span class="rl-meta">${r.playerCount} oyuncu · ${r.phase === 'lobby' ? 'bekliyor' : 'oyunda'}</span>`;
    const btn = document.createElement('button'); btn.className = 'ghost sm'; btn.textContent = 'Katıl';
    if (r.phase !== 'lobby') btn.disabled = true;
    btn.onclick = () => H.join(r.code);
    li.appendChild(btn);
    ul.appendChild(li);
  }
}

// ---- lobby -----------------------------------------------------------------
export function renderLobby(state, localId) {
  $('lobby-name').textContent = state.name || 'CaYa Cards Odası';
  $('lobby-code').textContent = state.code || '----';
  $('lobby-vis').textContent = `${state.isPublic ? 'açık' : 'özel'} · ${modeLabel(state.mode)}`;
  const isHost = state.hostId === localId;

  const ul = $('lobby-players'); ul.innerHTML = '';
  for (const p of state.players) {
    const li = document.createElement('li');
    const dot = document.createElement('div'); dot.className = 'dot';
    dot.style.background = (p.cosmetics && p.cosmetics.body) || '#5b8fd6';
    dot.textContent = p.isBot ? '🤖' : '🙂';
    const nm = document.createElement('div'); nm.className = 'pn';
    nm.textContent = p.isYou ? `${p.name} (sen)` : p.name;
    li.appendChild(dot); li.appendChild(nm);
    if (p.id === state.hostId) li.appendChild(tag('kurucu', 'host'));
    if (p.isBot && isHost) {
      const x = document.createElement('button'); x.className = 'link'; x.textContent = 'çıkar';
      x.onclick = () => H.removeBot(p.id); li.appendChild(x);
    }
    ul.appendChild(li);
  }

  $('lobby-actions').style.display = isHost ? 'flex' : 'none';
  $('btn-start').disabled = state.players.length < 2;
  $('btn-add-bot').disabled = state.players.length >= 8;
  $('lobby-hint').textContent = isHost
    ? (state.players.length < 2 ? 'Başlatmak için en az 2 oyuncu gerekli (bot ekleyebilirsin).' : 'Hazır olunca Başlat’a bas.')
    : 'Kurucunun başlatması bekleniyor…';
}

function tag(text, cls) { const s = document.createElement('span'); s.className = 'tag ' + (cls || ''); s.textContent = text; return s; }

// ---- in-game HUD -----------------------------------------------------------
export function renderHUD(state, localId) {
  const me = state.players.find((p) => p.isYou);
  const myTurn = state.currentPlayerId === localId;
  const top = state.top;
  const pending = state.pendingDraw || 0;

  // turn banner
  const banner = $('turn-banner');
  if (state.phase === 'finished') {
    banner.textContent = ''; banner.classList.remove('you');
  } else if (myTurn) {
    if (pending > 0) banner.textContent = `Sana +${pending} geldi! +kart at ya da çek`;
    else banner.textContent = state.turnState === 'drawn' ? 'Çektiğin kartı oyna ya da pas geç' : 'Sıra sende!';
    banner.classList.add('you');
  } else {
    const cur = state.players.find((p) => p.id === state.currentPlayerId);
    banner.textContent = cur ? `${cur.isBot ? '🤖 ' : ''}${cur.name} oynuyor…` : '';
    banner.classList.remove('you');
  }

  // your-turn sound (rising edge)
  if (myTurn && !prevMyTurn && state.phase === 'playing') sfx.play('turn');
  prevMyTurn = myTurn && state.phase === 'playing';

  // turn timer — everyone sees the current player's countdown
  if (state.phase === 'playing' && state.turnEndsAt) {
    turnActive = true; turnIsMine = myTurn;
    turnDeadline = state.turnEndsAt; turnDuration = state.turnDuration || 30000;
    if (lastTickSec === 99) lastTickSec = 99;
    $('turn-timer').classList.add('show');
  } else {
    turnActive = false;
    $('turn-timer').classList.remove('show');
  }

  // hand
  const hand = $('hand'); hand.innerHTML = '';
  const cardEls = [];
  for (const card of (state.hand || [])) {
    const playable = myTurn && state.phase === 'playing' &&
      canPlay(card, top, state.activeColor, pending) &&
      (pending > 0 || state.turnState !== 'drawn' || card.id === state.drawnCardId);
    const div = document.createElement('div');
    div.className = 'card' + (playable ? ' playable' : (myTurn ? ' disabled' : ''));
    const img = document.createElement('img');
    img.src = svgPath(card.file); img.alt = card.file; img.draggable = false;
    div.appendChild(img);
    if (playable) div.onclick = () => playCard(card);
    hand.appendChild(div);
    cardEls.push(div);
  }
  layoutHand = () => fitHand(hand, cardEls);
  layoutHand();

  // action buttons
  const drawBtn = $('btn-draw');
  const showDraw = myTurn && state.phase === 'playing' && state.turnState === 'play';
  toggle(drawBtn, showDraw);
  drawBtn.textContent = pending > 0 ? `+${pending} Çek` : 'Kart Çek';
  drawBtn.classList.toggle('danger-btn', pending > 0);
  toggle($('btn-pass'), myTurn && state.phase === 'playing' && state.turnState === 'drawn' && pending === 0);
  toggle($('btn-lastcard'), !!state.canCallLastCard && state.phase === 'playing');

  handleEvent(state);
}

function toggle(el, on) { el.classList.toggle('hidden', !on); }

function playCard(card) {
  if (isWild(card)) { pendingWild = card.id; $('color-picker').classList.add('show'); }
  else H.play(card.id, null);
}

const SPECIAL_EMOJI = {
  'chain-of-thought': '🧠', 'context-full': '📦', 'deep-think': '🤔', 'fine-tune': '🔧',
  'hallucinate': '🌀', 'infinite-context': '♾️', 'rate-limit': '🚦', 'system-prompt': '⚙️',
  'token-budget': '💸', 'where-were-we': '❓',
};

function nameOf(state, id) { const p = state.players.find((x) => x.id === id); return p ? (p.isYou ? 'Sen' : p.name) : '?'; }

function handleEvent(state) {
  const ev = state.event;
  if (!ev || ev.seq === lastEventSeq) return;
  lastEventSeq = ev.seq;
  if (ev.type === 'play' && ev.card) {
    sfx.play('play');
    const c = ev.card;
    if (c.special) toast(`${nameOf(state, ev.playerId)} · ${c.label}`, SPECIAL_EMOJI[c.special] || '✨');
    else if (c.kind === 'wild_draw4') toast(`${nameOf(state, ev.playerId)} +4 Joker!`, '🎨');
    else if (c.kind === 'wild') toast(`${nameOf(state, ev.playerId)} Joker — renk değişti`, '🎨');
    else if (c.kind === 'draw2') toast(`${nameOf(state, ev.playerId)} +2!`, '➕');
    else if (c.kind === 'skip') toast(`${nameOf(state, ev.playerId)} pas geçirtti`, '⛔');
    else if (c.kind === 'reverse') toast(`${nameOf(state, ev.playerId)} yön değişti`, '🔄');
    // chaos mode (7 = swap, 0 = rotate)
    if (ev.chaos) {
      if (ev.chaos.kind === 'swap') toast(`${escapeHtml(ev.chaos.a)} ↔ ${escapeHtml(ev.chaos.b)} el değiştirdi!`, '🔀');
      else if (ev.chaos.kind === 'rotate') toast('Herkes elini devretti! 🌀', '🌀');
    }
  } else if (ev.type === 'draw') {
    if (ev.busted) { sfx.play('penalty'); toast(`${nameOf(state, ev.playerId)} +${ev.count} çekti 💥`, '💥'); }
    else sfx.play('draw');
  } else if (ev.type === 'lastcardPenalty') {
    sfx.play('caught'); toast(`${nameOf(state, ev.playerId)} "Son kart" demedi · +2 ceza`, '😈');
  } else if (ev.type === 'lastcard') {
    sfx.play('lastcard'); toast(`${nameOf(state, ev.playerId)}: Son kart!`, '🔥');
  }
}

// ---- colour picker ---------------------------------------------------------
function initColorPicker() {
  for (const b of document.querySelectorAll('#color-picker .swatches button')) {
    b.onclick = () => {
      $('color-picker').classList.remove('show');
      sfx.play('click');
      if (pendingWild) { H.play(pendingWild, b.dataset.c); pendingWild = null; }
    };
  }
}

// ---- turn-timer animation loop --------------------------------------------
function timerLoop() {
  const bar = $('turn-timer');
  if (turnActive) {
    const remaining = Math.max(0, turnDeadline - Date.now());
    const frac = Math.max(0, Math.min(1, remaining / turnDuration));
    bar.querySelector('i').style.transform = `scaleX(${frac})`;
    bar.classList.toggle('low', frac < 0.34);
    const sec = Math.ceil(remaining / 1000);
    if (turnIsMine && sec <= 5 && sec !== lastTickSec) { sfx.play('tick'); }
    lastTickSec = sec;
  }
  if (waitActive) {
    const rem = Math.max(0, Math.ceil((waitDeadline - Date.now()) / 1000));
    const el = $('wait-msg');
    if (el) el.textContent = `Geri dönmesi bekleniyor… ${rem} sn · gelmezse oyundan çıkarılır`;
  }
  requestAnimationFrame(timerLoop);
}

// ---- toasts ----------------------------------------------------------------
export function toast(text, emoji) {
  const stack = $('toast-stack');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `${emoji ? `<span class="em">${emoji}</span>` : ''}${escapeHtml(text)}`;
  stack.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 2600);
  while (stack.children.length > 4) stack.firstChild.remove();
}

// ---- chat ------------------------------------------------------------------
export function addChat(msg) {
  const log = $('chat-log');
  const m = document.createElement('div'); m.className = 'm';
  m.innerHTML = `<b>${escapeHtml(msg.name)}:</b> ${escapeHtml(msg.text)}`;
  log.appendChild(m); log.scrollTop = log.scrollHeight;
  while (log.children.length > 60) log.firstChild.remove();
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---- winner celebration (podium overlay) -----------------------------------
let confettiBuilt = false;
function buildConfetti() {
  if (confettiBuilt) return;
  confettiBuilt = true;
  const wrap = $('celeb-confetti');
  const colors = ['#E0A53D', '#4E7FB5', '#D9764A', '#6E9457', '#e06a8b', '#7a5cff', '#52c2c2', '#f2d04a'];
  for (let i = 0; i < 70; i++) {
    const p = document.createElement('i');
    p.className = 'cfp';
    p.style.left = Math.random() * 100 + '%';
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = (-Math.random() * 4) + 's';
    p.style.animationDuration = (2.6 + Math.random() * 2.4) + 's';
    p.style.transform = `rotate(${Math.random() * 360}deg)`;
    if (Math.random() > 0.5) p.style.borderRadius = '50%';
    wrap.appendChild(p);
  }
}

export function showCelebration(winner, youWon) {
  buildConfetti();
  $('celeb-name').textContent = winner ? (youWon ? `${winner.name} (Sen!) 🎉` : winner.name) : '—';
  $('celebration').classList.add('show');
}
export function hideCelebration() { $('celebration').classList.remove('show'); }

// ---- winner's finisher picker (8 cartoon finales, drawn SVG icons) ----------
const FINISHERS = [
  { id: 'podium',  title: 'Podyum',    desc: 'Klasik: kupaya çık, dans et',    hue: '#E0A53D',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h10v4a5 5 0 0 1-10 0z"/><path d="M17 5h2.4v1a2.4 2.4 0 0 1-2.4 2.4"/><path d="M7 5H4.6v1A2.4 2.4 0 0 0 7 8.4"/><path d="M12 13v3"/><path d="M8.5 20h7l-1-4h-5z"/></svg>' },
  { id: 'anvil',   title: 'Örs',       desc: 'Kafalarına örs düşür',           hue: '#9aa0a8',
    svg: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="3.5" y="6.5" width="15" height="3.2" rx="1.2"/><rect x="9" y="9.7" width="4" height="3"/><rect x="5.5" y="12.7" width="11" height="2.6" rx="1.2"/></svg>' },
  { id: 'flatten', title: 'Silindir',  desc: 'Silindirle hepsini ez',          hue: '#D9764A',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="15" r="5.2"/><path d="M14 12l4.5-4.5M15 6h4v4"/></svg>' },
  { id: 'chicken', title: 'Dev Tavuk', desc: 'Dev tavuk onları yer',           hue: '#f2d04a',
    svg: '<svg viewBox="0 0 24 24"><circle cx="10" cy="13" r="6" fill="currentColor"/><circle cx="12.4" cy="11" r="1.2" fill="#14110d"/><path d="M15.5 12l4.5 1.2-4.5 2z" fill="currentColor"/><path d="M6 6l2 3.2M9.2 4.6l1.5 3.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>' },
  { id: 'launch',  title: 'Fırlatma',  desc: 'Roketle göğe fırlat',            hue: '#ff7a3a',
    svg: '<svg viewBox="0 0 24 24"><path d="M12 2.5c3 2.2 4.2 6 4.2 9.3L14 15h-4l-2.2-3.2C7.8 8.5 9 4.7 12 2.5z" fill="currentColor"/><path d="M8 15l-2.2 4.2 3.4-1.2M16 15l2.2 4.2-3.4-1.2" fill="currentColor"/><circle cx="12" cy="9" r="1.6" fill="#14110d"/></svg>' },
  { id: 'tnt',     title: 'TNT',       desc: 'Dinamitle havaya uçur',          hue: '#ff5a2a',
    svg: '<svg viewBox="0 0 24 24"><circle cx="11" cy="15" r="6" fill="currentColor"/><path d="M15 9c1-1.6 3.2-1.6 3.2-3.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M17.4 3.8l1.6 1.2M19.4 4.2l-1.4 1.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' },
  { id: 'freeze',  title: 'Dondurma',  desc: 'Hepsini buza çevir',             hue: '#7ac6ff',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9"/><path d="M12 6l2 2-2 2-2-2zM12 18l2-2-2-2-2 2z"/></svg>' },
  { id: 'pie',     title: 'Pasta',     desc: 'Suratlarına pasta yapıştır',     hue: '#f7f3ea',
    svg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12.5" r="6" fill="currentColor"/><path d="M7 16l-1.2 3.4M12 18.5v3.2M17 16l1.2 3.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>' },
];

export function showFinisherPicker(onPick) {
  const ov = $('finisher-picker');
  if (!ov || ov.classList.contains('show')) return; // don't rebuild while already up
  const grid = $('fin-grid'); grid.innerHTML = ''; grid.dataset.picked = '';
  for (const f of FINISHERS) {
    const b = document.createElement('button');
    b.className = 'fin-opt'; b.type = 'button'; b.style.setProperty('--fh', f.hue);
    b.innerHTML = `<span class="fin-ico">${f.svg}</span><span class="fin-txt"><b>${escapeHtml(f.title)}</b><small>${escapeHtml(f.desc)}</small></span>`;
    b.onclick = () => {
      if (grid.dataset.picked) return;
      grid.dataset.picked = f.id; sfx.play('click'); onPick(f.id);
      for (const x of grid.children) x.disabled = true;
      b.classList.add('picked');
      $('fin-hint').textContent = 'Seçildi — sahne hazırlanıyor…';
    };
    grid.appendChild(b);
  }
  $('fin-hint').textContent = '30 saniye içinde seç — yoksa podyum otomatik gelir.';
  ov.classList.add('show');
}
export function hideFinisherPicker() { const ov = $('finisher-picker'); if (ov) ov.classList.remove('show'); }
export function showFinisherWait(name) { const ov = $('finisher-wait'); if (!ov) return; $('fin-wait-name').textContent = name || 'Kazanan'; ov.classList.add('show'); }
export function hideFinisherWait() { const ov = $('finisher-wait'); if (ov) ov.classList.remove('show'); }

// ---- winner ----------------------------------------------------------------
export function showWinner(name, isHost) {
  $('winner-name').textContent = name;
  $('btn-rematch').style.display = isHost ? '' : 'none';
  $('winner-info').textContent = isHost
    ? 'Yeniden Oyna’ya basınca herkes yeni tura alınır.'
    : 'Kurucu yeni tur başlatabilir — beklersen otomatik katılırsın. Ayrılmak istersen Menü.';
  $('btn-back-menu').textContent = isHost ? 'Menü' : 'Ayrıl';
  $('dlg-winner').classList.add('show');
  sfx.play('win');
}
export function hideWinner() { $('dlg-winner').classList.remove('show'); }

// ---- wiring ----------------------------------------------------------------
export function bind(handlers) {
  H = handlers;
  initColorPicker();
  requestAnimationFrame(timerLoop);
  addEventListener('resize', () => { if (layoutHand) layoutHand(); });

  // mute button
  const mute = $('btn-mute');
  mute.textContent = sfx.isMuted() ? '🔇' : '🔊';
  mute.onclick = () => { mute.textContent = sfx.toggleMute() ? '🔇' : '🔊'; };

  // mobile menu tabs (Karakter / Oyna)
  for (const tab of document.querySelectorAll('.menu-tab')) {
    tab.onclick = () => {
      const panel = document.querySelector('.menu-panel');
      panel.classList.remove('tab-a', 'tab-b');
      panel.classList.add('tab-' + tab.dataset.tab);
      document.querySelectorAll('.menu-tab').forEach((x) => x.classList.toggle('active', x === tab));
      sfx.play('click');
    };
  }

  $('btn-create').onclick = () => { sfx.play('click'); $('dlg-create').classList.add('show'); };
  $('btn-create-cancel').onclick = () => $('dlg-create').classList.remove('show');
  let selectedMode = 'classic';
  for (const b of document.querySelectorAll('#mode-select .mode-opt')) {
    b.onclick = () => {
      selectedMode = b.dataset.mode;
      document.querySelectorAll('#mode-select .mode-opt').forEach((x) => x.classList.toggle('sel', x === b));
      sfx.play('click');
    };
  }
  $('btn-create-go').onclick = () => {
    const name = $('inp-room-name').value.trim() || 'CaYa Cards Odası';
    const isPublic = $('chk-public').checked;
    $('dlg-create').classList.remove('show');
    H.create(name, isPublic, selectedMode);
  };
  $('btn-join').onclick = () => {
    const code = $('inp-code').value.trim().toUpperCase();
    if (code.length === 4) H.join(code);
    else toast('4 haneli oda kodu gir', '⚠️');
  };
  $('inp-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });
  $('btn-refresh').onclick = () => H.refresh();

  $('btn-start').onclick = () => { sfx.play('click'); H.start(); };
  $('btn-add-bot').onclick = () => { sfx.play('click'); H.addBot(); };
  $('btn-copy').onclick = () => { navigator.clipboard?.writeText($('lobby-code').textContent); toast('Kod kopyalandı', '📋'); };
  $('btn-leave-lobby').onclick = () => H.leave();
  $('btn-leave-game').onclick = () => H.leave();

  $('btn-draw').onclick = () => { sfx.play('click'); H.draw(); };
  $('btn-pass').onclick = () => { sfx.play('click'); H.pass(); };
  $('btn-lastcard').onclick = () => { sfx.play('lastcard'); H.callLastCard(); };
  $('btn-cam').onclick = () => H.resetCamera();

  $('btn-back-menu').onclick = () => { hideWinner(); H.leave(); };
  $('btn-rematch').onclick = () => { hideWinner(); H.rematch(); };

  $('celeb-skip').onclick = () => { sfx.play('click'); if (H.skipCelebration) H.skipCelebration(); };

  $('chat-toggle').onclick = () => { $('chat').classList.remove('collapsed'); setTimeout(() => $('chat-input').focus(), 50); };
  $('chat-close').onclick = () => $('chat').classList.add('collapsed');
  $('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('chat-input').value.trim();
    if (v) { H.chat(v); }
    $('chat-input').value = '';
    $('chat-input').focus();
  });
}

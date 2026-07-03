// Authoritative card game engine. All rules live server-side; clients only
// send intents (play / draw / pass / chooseColor / callLastCard).
import { buildDeck, shuffle, canPlay, COLORS } from './deck.js';

const DEFAULT_HAND_SIZE = 7;

// Per-mode tuning. Everything the engine needs to reshape a match lives here, so
// adding a mode is mostly a new row plus (optionally) a small rule hook below.
//   handSize   — starting cards
//   turnMs     — human turn time limit (client countdown honours this too)
//   botDelay   — how snappy bots feel
//   decks      — full decks shuffled together (deck.js)
//   extraWilds — extra jokers mixed in (deck.js)
//   drawToMatch— ☠️ Acımasız: on a normal draw, keep drawing until playable
//   bomb       — 💣 Bomba: chance a normal draw "explodes" for +2 more (0..1)
export const MODE_CONFIG = {
  classic:    { handSize: 7, turnMs: 30000, botDelay: 1100 },
  party:      { handSize: 7, turnMs: 30000, botDelay: 1100 },
  chaos:      { handSize: 7, turnMs: 30000, botDelay: 1100 },
  turbo:      { handSize: 5, turnMs: 15000, botDelay: 650 },
  nomercy:    { handSize: 7, turnMs: 30000, botDelay: 1100, drawToMatch: true },
  wildparty:  { handSize: 7, turnMs: 30000, botDelay: 1100, extraWilds: 14 },
  doubledeck: { handSize: 8, turnMs: 32000, botDelay: 1000, decks: 2 },
  bomb:       { handSize: 7, turnMs: 30000, botDelay: 1100, bomb: 0.15 },
};
export const MODES = Object.keys(MODE_CONFIG);

// Winner-chosen end-of-game "finisher": the podium climb, or a cartoon gag the
// losers all watch. The 3D choreography for each lives in public/js/scene3d.js.
export const FINISHERS = ['podium', 'anvil', 'flatten', 'chicken', 'launch', 'tnt', 'freeze', 'pie'];

// party-mode "penalty task" timing + prompts
export const TASK_DRAW_MS = 35000;
export const TASK_VOTE_MS = 16000;
export const TASK_RESULT_MS = 7000;
const EMOJI_PROMPTS = [
  'Titanik filmi', 'futbol maçı', 'pizza partisi', 'uzay yolculuğu', 'deniz tatili',
  'korku filmi', 'doğum günü', 'süt ve kurabiye', 'yağmurlu gün', 'aşk hikayesi',
  'spor salonu', 'kahvaltı keyfi', 'rock konseri', 'sınav stresi', 'kış uykusu',
  'plaj voleybolu', 'gece kuşu', 'tatlı krizi', 'maraton koşusu', 'çılgın parti',
];
const TRIVIA = [
  { q: "Türkiye'nin başkenti?", o: ['İstanbul', 'Ankara', 'İzmir', 'Bursa'], c: 1 },
  { q: 'Bir haftada kaç gün vardır?', o: ['5', '6', '7', '8'], c: 2 },
  { q: 'Güneş hangi yönden doğar?', o: ['Batı', 'Kuzey', 'Doğu', 'Güney'], c: 2 },
  { q: 'Buz kaç °C de erir?', o: ['0', '10', '50', '100'], c: 0 },
  { q: 'En büyük gezegen?', o: ['Mars', 'Jüpiter', 'Venüs', 'Dünya'], c: 1 },
  { q: 'Dünyada kaç kıta vardır?', o: ['5', '6', '7', '8'], c: 2 },
  { q: 'Gökkuşağında kaç renk vardır?', o: ['5', '6', '7', '9'], c: 2 },
  { q: 'Bir futbol takımı sahada kaç kişidir?', o: ['9', '10', '11', '12'], c: 2 },
  { q: 'Kanın rengi nedir?', o: ['Mavi', 'Kırmızı', 'Yeşil', 'Sarı'], c: 1 },
  { q: "Ay'a ilk ayak basan kişi?", o: ['Gagarin', 'Armstrong', 'Edison', 'Newton'], c: 1 },
  { q: 'Suyun kimyasal formülü?', o: ['CO₂', 'H₂O', 'O₂', 'NaCl'], c: 1 },
  { q: 'Bir yılda kaç ay vardır?', o: ['10', '11', '12', '13'], c: 2 },
  { q: 'En hızlı kara hayvanı?', o: ['Aslan', 'Çita', 'At', 'Kanguru'], c: 1 },
  { q: "Mona Lisa'yı kim yaptı?", o: ['Picasso', 'Van Gogh', 'Da Vinci', 'Monet'], c: 2 },
  { q: "Dünya'nın doğal uydusu?", o: ['Güneş', 'Ay', 'Mars', 'Venüs'], c: 1 },
  { q: 'Hangisi bir programlama dili?', o: ['Piton', 'Python', 'Kobra', 'Engerek'], c: 1 },
];
const MEMORY_COLORS = ['amber', 'blue', 'clay', 'green'];
// draw/emoji = vote-based · everything else = skill-based (no knowledge except trivia).
// The reflex/party games (reaction..hold) run in the performer's browser and just
// submit a 0..1 score — no server-side rules needed, so adding one is a one-liner here.
const TASK_TYPES = ['draw', 'emoji', 'trivia', 'memory', 'reaction', 'tap', 'timing', 'whack', 'pop', 'chase', 'sort', 'hold'];
const CLIENT_GAMES = ['reaction', 'tap', 'timing', 'whack', 'pop', 'chase', 'sort', 'hold']; // performer's browser runs these and submits a score
// drawing is the headline mini-game, so it's weighted to come up more often than
// the rest (weight 3 -> ~33%, every other type ~11%). Tune TASK_WEIGHTS to taste.
const TASK_WEIGHTS = { draw: 3 };
const TASK_POOL = TASK_TYPES.flatMap((t) => Array(TASK_WEIGHTS[t] || 1).fill(t));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export class Game {
  constructor(room) {
    this.room = room;                 // back-reference (for code / meta)
    this.players = [];                // {id,name,isBot,connected,seat,cosmetics,hand:[]}
    this.drawPile = [];
    this.discardPile = [];
    this.currentIndex = 0;
    this.direction = 1;               // 1 = clockwise, -1 = ccw
    this.activeColor = null;          // colour in effect (wilds set this)
    this.phase = 'lobby';             // lobby | playing | finished
    this.winnerId = null;
    this.finisher = null;             // winner-chosen end screen (party finale)
    this.turnState = 'play';          // play | drawn (current player drew, may play it or pass)
    this.drawnCardId = null;          // the card just drawn (current player only)
    this.pendingDraw = 0;             // accumulated +2/+4 stack the current player must answer
    this.lastcardPending = new Set();      // playerIds at 1 card who still owe an "last card" call
    this.turnEndsAt = null;           // ms timestamp the current human turn auto-resolves
    this.mode = (room && room.mode) || 'classic'; // classic | party | chaos | turbo | nomercy | wildparty | doubledeck | bomb
    this.cfg = MODE_CONFIG[this.mode] || MODE_CONFIG.classic;
    this.task = null;                 // active penalty task (party mode)
    this.paused = false;              // true while a task is running
    this.disconnected = new Set();    // playerIds who dropped mid-game (game freezes for them)
    this.reconnectEndsAt = null;      // ms timestamp the dropped player is auto-removed
    this.seq = 0;                     // event sequence for client animations
    this.lastEvent = null;
    this.chaosEvent = null;           // chaos-mode 7/0 swap/rotate, attached to play events
    this.log = [];
  }

  // ---- players -------------------------------------------------------------
  addPlayer(p) {
    p.hand = [];
    p.seat = this.players.length;
    this.players.push(p);
  }

  getPlayer(id) { return this.players.find((p) => p.id === id); }

  removePlayer(id) {
    const i = this.players.findIndex((p) => p.id === id);
    if (i === -1) return;
    if (this.phase === 'playing') {
      this.players[i].connected = false;
      this.players[i].isBot = true; // bot takes over so the game flows
    } else {
      this.players.splice(i, 1);
      this.players.forEach((p, idx) => (p.seat = idx));
      if (this.currentIndex >= this.players.length) this.currentIndex = 0;
    }
  }

  activeHumans() { return this.players.filter((p) => p.connected && !p.isBot); }

  // ---- lifecycle -----------------------------------------------------------
  start() {
    if (this.players.length < 2) return { error: 'En az 2 oyuncu gerekli.' };
    this.cfg = MODE_CONFIG[this.mode] || MODE_CONFIG.classic; // re-resolve in case mode changed
    const handSize = this.cfg.handSize || DEFAULT_HAND_SIZE;
    this.drawPile = shuffle(buildDeck({ decks: this.cfg.decks, extraWilds: this.cfg.extraWilds }));
    this.discardPile = [];
    this.direction = 1;
    this.winnerId = null;
    this.finisher = null;
    this.turnState = 'play';
    this.drawnCardId = null;
    this.pendingDraw = 0;
    this.lastcardPending.clear();
    this.task = null;
    this.paused = false;
    this.disconnected.clear();
    this.reconnectEndsAt = null;
    this.log = [];
    for (const p of this.players) p.hand = [];

    for (let n = 0; n < handSize; n++) {
      for (const p of this.players) p.hand.push(this.drawPile.pop());
    }
    let first = this.drawPile.pop();
    while (first.kind !== 'number') { this.drawPile.unshift(first); first = this.drawPile.pop(); }
    this.discardPile.push(first);
    this.activeColor = first.color;
    this.currentIndex = Math.floor(Math.random() * this.players.length);
    this.phase = 'playing';
    this.pushLog(`Oyun başladı. İlk kart: ${first.color} ${first.value}.`);
    this.emit('start', {});
    return { ok: true };
  }

  get top() { return this.discardPile[this.discardPile.length - 1]; }
  get currentPlayer() { return this.players[this.currentIndex]; }

  // mode-driven timing, read by the server loop (index.js)
  get turnMs() { return this.cfg.turnMs || 30000; }
  get botDelay() { return this.cfg.botDelay || 1100; }

  // ---- helpers -------------------------------------------------------------
  emit(type, data) { this.lastEvent = { type, seq: ++this.seq, ...data }; }
  pushLog(msg) { this.log.push(msg); if (this.log.length > 30) this.log.shift(); }

  reshuffleIfNeeded() {
    if (this.drawPile.length > 0) return;
    const top = this.discardPile.pop();
    this.drawPile = shuffle(this.discardPile);
    this.discardPile = top ? [top] : [];
  }

  drawN(player, n) {
    const drawn = [];
    for (let i = 0; i < n; i++) {
      this.reshuffleIfNeeded();
      if (this.drawPile.length === 0) break;
      const c = this.drawPile.pop();
      player.hand.push(c);
      drawn.push(c);
    }
    if (player.hand.length !== 1) this.lastcardPending.delete(player.id);
    return drawn;
  }

  refreshLastCard(player) {
    if (player.hand.length === 1) this.lastcardPending.add(player.id);
    else this.lastcardPending.delete(player.id);
  }

  // ---- Last-card penalty enforcement --------------------------------------------
  lastcardPenalty(player) {
    this.lastcardPending.delete(player.id);
    this.drawN(player, 2);
    this.pushLog(`${player.name} "Son kart" demedi, +2 ceza!`);
    this.emit('lastcardPenalty', { playerId: player.id });
  }
  // Before a player's own action: their turn returned and they never called last card.
  preActionLastCard(playerId) {
    const p = this.getPlayer(playerId);
    if (p && this.lastcardPending.has(playerId)) this.lastcardPenalty(p);
  }
  // After any action: every OTHER player who owed a last-card call failed to make it in time.
  postActionLastCard(actorId) {
    for (const pid of [...this.lastcardPending]) {
      if (pid !== actorId) { const p = this.getPlayer(pid); if (p) this.lastcardPenalty(p); }
    }
  }

  indexFrom(idx, steps) {
    const N = this.players.length;
    return (((idx + this.direction * steps) % N) + N) % N;
  }

  isDrawCard(card) { return card.kind === 'draw2' || card.kind === 'wild_draw4'; }

  // ---- intents -------------------------------------------------------------
  playCard(playerId, cardId, chosenColor) {
    if (this.phase !== 'playing') return { error: 'Oyun aktif değil.' };
    if (this.frozen) return { error: 'Kopan oyuncu bekleniyor…' };
    if (this.paused) return { error: 'Ceza görevi sürüyor, bekle.' };
    if (this.currentPlayer.id !== playerId) return { error: 'Sıra sende değil.' };
    this.preActionLastCard(playerId); // forced draw if they never called last card (can't win this turn)
    const player = this.currentPlayer;
    const idx = player.hand.findIndex((c) => c.id === cardId);
    if (idx === -1) return { error: 'O kart elinde yok.' };
    const card = player.hand[idx];
    const isWild = card.kind === 'wild' || card.kind === 'wild_draw4';

    if (this.pendingDraw > 0) {
      if (!this.isDrawCard(card)) return { error: `Önce +${this.pendingDraw} cevap ver: +kart at ya da kart çek.` };
    } else {
      if (this.turnState === 'drawn' && card.id !== this.drawnCardId) {
        return { error: 'Sadece çektiğin kartı oynayabilirsin ya da pas geç.' };
      }
      if (!canPlay(card, this.top, this.activeColor)) return { error: 'Bu kart oynanamaz.' };
    }
    if (isWild && !COLORS.includes(chosenColor)) return { error: 'Renk seçmelisin.' };

    this.chaosEvent = null; // reset per play; set by chaos-mode 7/0 effects
    player.hand.splice(idx, 1);
    this.discardPile.push(card);
    this.activeColor = isWild ? chosenColor : card.color;
    this.turnState = 'play';
    this.drawnCardId = null;

    const label = card.label ? ` (${card.label})` : '';
    this.pushLog(`${player.name}: ${this.cardName(card)}${label}.`);

    if (player.hand.length === 0) {
      this.phase = 'finished';
      this.winnerId = player.id;
      this.turnEndsAt = null;
      this.pushLog(`🏆 ${player.name} kazandı!`);
      this.emit('win', { playerId: player.id, card });
      return { ok: true };
    }

    this.refreshLastCard(player);
    this.applyEffectsAndAdvance(card);
    this.emit('play', { playerId: player.id, card, color: this.activeColor, pendingDraw: this.pendingDraw, chaos: this.chaosEvent });
    this.postActionLastCard(playerId);
    return { ok: true };
  }

  applyEffectsAndAdvance(card) {
    const N = this.players.length;
    // chaos mode house rule: a 7 swaps hands, a 0 rotates everyone's hand
    if (this.mode === 'chaos' && card.kind === 'number') {
      if (card.value === 7) this.chaosSwap();
      else if (card.value === 0) this.chaosRotate();
    }
    let skipNext = false;
    if (card.kind === 'reverse') { this.direction *= -1; if (N === 2) skipNext = true; }
    else if (card.kind === 'skip') skipNext = true;
    else if (card.kind === 'draw2' || card.kind === 'wild_draw4') this.pendingDraw += card.kind === 'draw2' ? 2 : 4;
    this.currentIndex = this.indexFrom(this.currentIndex, skipNext ? 2 : 1);
  }

  // ---- chaos mode (7 = swap, 0 = rotate) -----------------------------------
  // involuntary hand changes can't be punished with a forgotten-last-card penalty
  chaosClearLastCard(ids) { for (const id of ids) this.lastcardPending.delete(id); }

  chaosSwap() {
    const actor = this.currentPlayer;
    const others = this.players.filter((p) => p.id !== actor.id);
    if (!others.length) return;
    const target = others[Math.floor(Math.random() * others.length)];
    const tmp = actor.hand; actor.hand = target.hand; target.hand = tmp;
    this.chaosClearLastCard([actor.id, target.id]);
    this.pushLog(`🔄 ${actor.name} ↔ ${target.name} el değiştirdi!`);
    this.chaosEvent = { kind: 'swap', a: actor.name, b: target.name };
  }

  chaosRotate() {
    const N = this.players.length;
    if (N < 2) return;
    const dir = this.direction;
    const hands = this.players.map((p) => p.hand);
    // each player receives the hand of the previous player in the play direction
    this.players.forEach((p, i) => { p.hand = hands[((i - dir) % N + N) % N]; });
    this.chaosClearLastCard(this.players.map((p) => p.id));
    this.pushLog(`🌀 Herkes elini ${dir > 0 ? 'sonraki' : 'önceki'} oyuncuya verdi!`);
    this.chaosEvent = { kind: 'rotate', dir };
  }

  drawCard(playerId) {
    if (this.phase !== 'playing') return { error: 'Oyun aktif değil.' };
    if (this.frozen) return { error: 'Kopan oyuncu bekleniyor…' };
    if (this.paused) return { error: 'Ceza görevi sürüyor, bekle.' };
    if (this.currentPlayer.id !== playerId) return { error: 'Sıra sende değil.' };
    // note: no preActionLastCard here — a forgotten last-card call is already punished when
    // opponents act (postActionLastCard); drawing must not stack a surprise +2.
    const player = this.currentPlayer;

    if (this.pendingDraw > 0) {
      const n = this.pendingDraw;
      this.pendingDraw = 0;
      this.drawN(player, n);
      this.pushLog(`${player.name} +${n} kart çekti (zincir patladı).`);
      this.turnState = 'play';
      this.drawnCardId = null;
      this.currentIndex = this.indexFrom(this.currentIndex, 1);
      this.emit('draw', { playerId, count: n, busted: true });
      this.postActionLastCard(playerId);
      return { ok: true };
    }

    if (this.turnState === 'drawn') return { error: 'Zaten kart çektin.' };

    // ☠️ Acımasız: keep drawing until you pull something playable (draw-to-match).
    if (this.cfg.drawToMatch) {
      let card = null, drew = 0;
      const cap = this.drawPile.length + this.discardPile.length + 2; // hard safety bound
      while (drew < cap) {
        const [c] = this.drawN(player, 1);
        if (!c) break;
        card = c; drew++;
        if (canPlay(card, this.top, this.activeColor)) break;
      }
      this.pushLog(`${player.name} ${drew} kart çekti (eşleşene kadar).`);
      this.emit('draw', { playerId, count: drew });
      if (card && canPlay(card, this.top, this.activeColor)) {
        this.turnState = 'drawn'; this.drawnCardId = card.id;
      } else {
        this.turnState = 'play'; this.drawnCardId = null;
        this.currentIndex = this.indexFrom(this.currentIndex, 1);
      }
      this.postActionLastCard(playerId);
      return { ok: true, drawnCardId: card ? card.id : null };
    }

    const [card] = this.drawN(player, 1);
    if (!card) return { error: 'Deste boş.' };
    // 💣 Bomba: a normal draw can "explode" and cost +2 more.
    let bomb = false;
    if (this.cfg.bomb && Math.random() < this.cfg.bomb) bomb = this.drawN(player, 2).length > 0;
    this.pushLog(bomb ? `${player.name} çekti — 💣 deste patladı, +2 daha!` : `${player.name} kart çekti.`);
    this.emit('draw', { playerId, count: bomb ? 3 : 1, bomb });

    if (canPlay(card, this.top, this.activeColor)) {
      this.turnState = 'drawn';
      this.drawnCardId = card.id;
    } else {
      this.turnState = 'play';
      this.drawnCardId = null;
      this.currentIndex = this.indexFrom(this.currentIndex, 1);
    }
    this.postActionLastCard(playerId);
    return { ok: true, drawnCardId: card.id };
  }

  pass(playerId) {
    if (this.phase !== 'playing') return { error: 'Oyun aktif değil.' };
    if (this.frozen) return { error: 'Kopan oyuncu bekleniyor…' };
    if (this.paused) return { error: 'Ceza görevi sürüyor, bekle.' };
    if (this.currentPlayer.id !== playerId) return { error: 'Sıra sende değil.' };
    if (this.turnState !== 'drawn') return { error: 'Pas geçmek için önce kart çekmelisin.' };
    this.turnState = 'play';
    this.drawnCardId = null;
    this.pushLog(`${this.currentPlayer.name} pas geçti.`);
    this.currentIndex = this.indexFrom(this.currentIndex, 1);
    this.emit('pass', { playerId });
    this.postActionLastCard(playerId);
    return { ok: true };
  }

  // Auto-resolve a human turn that ran out of time.
  timeoutMove(playerId) {
    if (this.phase !== 'playing' || this.currentPlayer.id !== playerId) return { error: 'no-op' };
    if (this.pendingDraw > 0) return this.drawCard(playerId);
    if (this.turnState === 'drawn') return this.pass(playerId);
    const r = this.drawCard(playerId);
    if (this.turnState === 'drawn') this.pass(playerId);
    return r;
  }

  callLastCard(playerId) {
    const p = this.getPlayer(playerId);
    if (!p) return { error: 'Oyuncu yok.' };
    if (p.hand.length === 1) {
      this.lastcardPending.delete(playerId);
      this.pushLog(`${p.name}: Son kart!`);
      this.emit('lastcard', { playerId });
      return { ok: true };
    }
    return { error: '"Son kart" sadece tek kartın kalınca denir.' };
  }

  // ---- winner's end-of-game finisher pick ----------------------------------
  chooseFinisher(playerId, id) {
    if (this.phase !== 'finished' || !this.winnerId) return { error: 'Oyun bitmedi.' };
    if (playerId !== this.winnerId) return { error: 'Sadece kazanan seçebilir.' };
    if (this.finisher) return { error: 'Zaten seçildi.' };
    if (!FINISHERS.includes(id)) return { error: 'Geçersiz seçim.' };
    this.finisher = id;
    this.pushLog(`🏆 ${this.getPlayer(playerId)?.name || 'Kazanan'} bitirişi seçti: ${id}.`);
    this.emit('finisher', { id, playerId });
    return { ok: true };
  }

  // ---- disconnect / reconnect (game freezes while someone is away) ---------
  get frozen() { return this.phase === 'playing' && this.disconnected.size > 0; }

  markDisconnected(pid) {
    const p = this.getPlayer(pid);
    if (!p || this.phase !== 'playing') return false;
    p.connected = false;
    this.disconnected.add(pid);
    this.turnEndsAt = null;
    this.pushLog(`${p.name} bağlantısı koptu — bekleniyor.`);
    this.emit('disconnect', { playerId: pid });
    return true;
  }

  markReconnected(pid) {
    const p = this.getPlayer(pid);
    if (!p) return;
    p.connected = true;
    if (this.disconnected.delete(pid)) {
      this.pushLog(`${p.name} geri döndü.`);
      this.emit('reconnect', { playerId: pid });
    }
  }

  // remove a player who never came back; abort the round if too few remain
  removeMidGame(pid) {
    const idx = this.players.findIndex((p) => p.id === pid);
    if (idx === -1) return;
    const name = this.players[idx].name;
    this.disconnected.delete(pid);
    this.lastcardPending.delete(pid);
    this.players.splice(idx, 1);
    this.players.forEach((p, i) => (p.seat = i));
    if (idx < this.currentIndex) this.currentIndex--;
    if (this.currentIndex >= this.players.length) this.currentIndex = 0;
    this.pushLog(`${name} oyundan çıkarıldı.`);
    if (this.players.length < 2) {
      this.phase = 'finished';
      this.winnerId = this.players.length === 1 ? this.players[0].id : null;
      this.turnEndsAt = null;
      this.emit('aborted', {});
    } else {
      this.emit('removed', { name });
    }
  }

  // ---- party mode: penalty mini-games --------------------------------------
  usesVote(type) { return type === 'draw' || type === 'emoji'; }

  startTask(performerId, penaltyCount = 0) {
    const p = this.getPlayer(performerId);
    if (!p) return;
    this.paused = true;
    this.turnEndsAt = null;
    const type = pick(TASK_POOL);
    const t = {
      id: 't' + (++this.seq), type,
      drawerId: performerId, drawerName: p.name,
      phase: 'perform', endsAt: Date.now() + TASK_DRAW_MS,
      penaltyCount, cardDelta: 0, votes: {}, avg: 0, score: 0, total: 0,
      strokes: [], emojis: [], answers: {}, input: [], clientFrac: null, scoreLabel: '',
    };
    // draw = free-form, no topic; players draw whatever they want
    if (type === 'emoji') { t.prompt = pick(EMOJI_PROMPTS); t.endsAt = Date.now() + 30000; }
    else if (type === 'trivia') {
      t.questions = shuffle(TRIVIA.slice()).slice(0, 4).map((x) => ({ q: x.q, o: x.o, c: x.c }));
      t.total = t.questions.length; t.endsAt = Date.now() + 30000;
    } else if (type === 'memory') {
      const len = 5;
      t.seq = Array.from({ length: len }, () => pick(MEMORY_COLORS));
      t.total = len; t.endsAt = Date.now() + 26000;
    } else if (type === 'reaction') { t.total = 3; t.endsAt = Date.now() + 22000; }
    else if (type === 'tap') { t.endsAt = Date.now() + 13000; }
    else if (type === 'timing') { t.total = 3; t.endsAt = Date.now() + 18000; }
    // client-run reflex games below submit their own score early; these are just
    // safety fallbacks that end the task if the performer never finishes.
    else if (type === 'whack') { t.endsAt = Date.now() + 18000; }
    else if (type === 'pop') { t.endsAt = Date.now() + 19000; }
    else if (type === 'chase') { t.endsAt = Date.now() + 16000; }
    else if (type === 'sort') { t.endsAt = Date.now() + 24000; }
    else if (type === 'hold') { t.endsAt = Date.now() + 24000; }
    this.task = t;
    this.pushLog(`🎲 ${p.name} ceza görevi (${type}). Ceza: ${penaltyCount} kart.`);
    this.emit('taskStart', { type, drawerId: performerId });
  }
  // back-compat alias
  startDrawTask(id, n) { return this.startTask(id, n); }

  // put cards from a hand back into the draw pile (never below 1 card)
  removeN(player, n) {
    let removed = 0;
    while (removed < n && player.hand.length > 1) { this.drawPile.push(player.hand.pop()); removed++; }
    if (removed) shuffle(this.drawPile);
    return removed;
  }

  addStroke(playerId, stroke) {
    const t = this.task;
    if (!t || t.type !== 'draw' || t.phase !== 'perform' || playerId !== t.drawerId || !stroke) return;
    if (stroke.clear) { t.strokes = []; return; }
    let s = t.strokes.find((x) => x.id === stroke.id);
    if (!s) {
      if (t.strokes.length > 400) return;
      s = { id: stroke.id, color: String(stroke.color || '#fff').slice(0, 9), w: Math.min(12, Math.max(1, stroke.w || 3)), pts: [] };
      t.strokes.push(s);
    }
    if (Array.isArray(stroke.pts)) for (const p of stroke.pts) { if (s.pts.length < 600) s.pts.push([+p[0] || 0, +p[1] || 0]); }
  }

  addEmoji(playerId, emoji) {
    const t = this.task;
    if (!t || t.type !== 'emoji' || t.phase !== 'perform' || playerId !== t.drawerId) return;
    if (emoji === '<<undo>>') { t.emojis.pop(); return; }
    if (typeof emoji === 'string' && t.emojis.length < 16) t.emojis.push(emoji.slice(0, 8));
  }

  answerTrivia(playerId, qi, choice) {
    const t = this.task;
    if (!t || t.type !== 'trivia' || t.phase !== 'perform' || playerId !== t.drawerId) return;
    if (qi < 0 || qi >= t.questions.length || t.answers[qi] != null) return;
    t.answers[qi] = choice;
    if (Object.keys(t.answers).length >= t.questions.length) return { done: true };
  }

  tapMemory(playerId, color) {
    const t = this.task;
    if (!t || t.type !== 'memory' || t.phase !== 'perform' || playerId !== t.drawerId) return;
    const i = t.input.length;
    t.input.push(color);
    if (color !== t.seq[i] || t.input.length >= t.seq.length) return { done: true };
  }

  // client-run skill games (reaction / tap / timing) submit a 0..1 score
  submitScore(playerId, frac, label) {
    const t = this.task;
    if (!t || !CLIENT_GAMES.includes(t.type) || t.phase !== 'perform' || playerId !== t.drawerId) return;
    t.clientFrac = Math.max(0, Math.min(1, +frac || 0));
    if (label) t.scoreLabel = String(label).slice(0, 24);
    return { done: true };
  }

  taskVoters() {
    if (!this.task) return [];
    return this.players.filter((p) => p.connected && !p.isBot && p.id !== this.task.drawerId).map((p) => p.id);
  }

  castVote(playerId, score) {
    const t = this.task;
    if (!t || t.phase !== 'vote' || playerId === t.drawerId) return { error: 'Şu an oylayamazsın.' };
    if (!this.taskVoters().includes(playerId)) return { error: 'Oylayamazsın.' };
    t.votes[playerId] = Math.max(1, Math.min(5, Math.round(score)));
    this.emit('taskVoteUpdate', {});
    return { ok: true, allIn: Object.keys(t.votes).length >= this.taskVoters().length };
  }

  // perform phase ended -> vote (vote types) or straight to result (skill types)
  finishPerform() {
    if (!this.task || this.task.phase !== 'perform') return;
    if (this.usesVote(this.task.type)) {
      this.task.phase = 'vote';
      this.task.endsAt = Date.now() + TASK_VOTE_MS;
      this.emit('taskVotePhase', {});
    } else {
      this.finishTask();
    }
  }
  // back-compat alias
  finishDrawPhase() { return this.finishPerform(); }

  // returns a 0..1 performance fraction depending on task type
  performanceFraction() {
    const t = this.task;
    if (this.usesVote(t.type)) {
      const s = Object.values(t.votes);
      if (!s.length) return null; // no jury
      t.avg = s.reduce((a, b) => a + b, 0) / s.length;
      return (t.avg - 1) / 4; // 1★->0, 5★->1
    }
    if (t.type === 'trivia') {
      t.score = t.questions.filter((q, i) => t.answers[i] === q.c).length;
      return t.total ? t.score / t.total : 0;
    }
    if (t.type === 'memory') {
      let k = 0; while (k < t.input.length && t.input[k] === t.seq[k]) k++;
      t.score = k;
      return t.total ? t.score / t.total : 0;
    }
    if (CLIENT_GAMES.includes(t.type)) return t.clientFrac == null ? 0 : t.clientFrac;
    return 0;
  }

  finishTask() {
    if (!this.task || this.task.phase === 'result') return;
    const t = this.task;
    const N = t.penaltyCount || 0;
    const frac = this.performanceFraction(); // 0..1, or null for "no jury"
    let delta = 0;
    if (frac !== null) {
      // frac>=0.5 refunds up to all N cards; frac<0.5 adds up to +4 extra
      if (frac >= 0.5) delta = -Math.round(N * (frac - 0.5) / 0.5);
      else delta = Math.round((0.5 - frac) / 0.5 * 4);
    }
    const performer = this.getPlayer(t.drawerId);
    let applied = 0;
    if (performer) {
      if (delta < 0) applied = -this.removeN(performer, -delta);
      else if (delta > 0) { this.drawN(performer, delta); applied = delta; }
      // the hand changed automatically (refund/penalty), so the player can't be
      // expected to have called last card — never leave them owing a forced +2 here.
      this.lastcardPending.delete(performer.id);
    }
    t.cardDelta = applied;
    t.phase = 'result';
    t.endsAt = Date.now() + TASK_RESULT_MS;
    const verdict = applied === 0 ? 'ceza aynı' : (applied < 0 ? `${-applied} iade` : `+${applied}`);
    this.pushLog(`🎨 ${t.drawerName}: ${verdict}.`);
    this.emit('taskResult', { cardDelta: applied });
  }

  clearTask() { this.task = null; this.paused = false; }

  publicTask(viewerId) {
    const t = this.task;
    if (!t) return null;
    const reveal = t.phase === 'result';
    const out = {
      id: t.id, type: t.type, drawerId: t.drawerId, drawerName: t.drawerName,
      phase: t.phase, endsAt: t.endsAt,
      penaltyCount: t.penaltyCount, cardDelta: t.cardDelta,
      avg: t.avg, score: t.score, total: t.total,
      votesCount: Object.keys(t.votes).length, voterCount: this.taskVoters().length,
      youAreDrawer: viewerId === t.drawerId,
      youVoted: Object.prototype.hasOwnProperty.call(t.votes, viewerId),
      usesVote: this.usesVote(t.type),
      scoreLabel: t.scoreLabel,
    };
    if (t.type === 'draw') { out.strokes = t.strokes; }
    else if (t.type === 'emoji') { out.prompt = t.prompt; out.emojis = t.emojis; }
    else if (t.type === 'trivia') {
      out.questions = t.questions.map((q, i) => ({ q: q.q, o: q.o, answered: t.answers[i] != null,
        chosen: t.answers[i] != null ? t.answers[i] : null, correct: reveal ? q.c : null }));
      out.answeredCount = Object.keys(t.answers).length;
    } else if (t.type === 'memory') { out.seq = t.seq; out.inputLen = t.input.length; }
    return out;
  }

  // ---- simple bot ----------------------------------------------------------
  botMove() {
    if (this.phase !== 'playing') return null;
    const p = this.currentPlayer;
    if (!p.isBot) return null;
    const top = this.top;

    if (this.pendingDraw > 0) {
      const dc = p.hand.find((c) => this.isDrawCard(c));
      if (dc) return this.botPlay(p, dc);
      return { action: 'draw', playerId: p.id };
    }
    if (this.turnState === 'drawn') {
      const c = p.hand.find((x) => x.id === this.drawnCardId);
      if (c && canPlay(c, top, this.activeColor)) return this.botPlay(p, c);
      return { action: 'pass', playerId: p.id };
    }
    const playable = p.hand.filter((c) => canPlay(c, top, this.activeColor));
    const nonWild = playable.filter((c) => c.color !== 'wild');
    const choice = (nonWild[0] || playable[0]);
    if (choice) return this.botPlay(p, choice);
    return { action: 'draw', playerId: p.id };
  }

  botPlay(p, card) {
    let chosenColor;
    if (card.color === 'wild') {
      const counts = { amber: 0, blue: 0, clay: 0, green: 0 };
      for (const c of p.hand) if (counts[c.color] !== undefined) counts[c.color]++;
      chosenColor = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    }
    return { action: 'play', playerId: p.id, cardId: card.id, chosenColor };
  }

  // ---- serialization -------------------------------------------------------
  cardName(c) {
    if (c.kind === 'number') return `${c.color} ${c.value}`;
    if (c.kind === 'wild') return 'Joker';
    if (c.kind === 'wild_draw4') return '+4 Joker';
    return `${c.color} ${c.kind}`;
  }

  publicPlayers(viewerId) {
    return this.players.map((p) => ({
      id: p.id,
      name: p.name,
      isBot: p.isBot,
      connected: p.connected,
      seat: p.seat,
      cosmetics: p.cosmetics || {},
      handCount: p.hand.length,
      lastcardPending: this.lastcardPending.has(p.id),
      disconnected: this.disconnected.has(p.id),
      isYou: p.id === viewerId,
      isCurrent: this.phase === 'playing' && this.currentPlayer.id === p.id,
    }));
  }

  getStateFor(viewerId) {
    const me = this.getPlayer(viewerId);
    return {
      code: this.room.code,
      name: this.room.name,
      isPublic: this.room.isPublic,
      hostId: this.room.hostId,
      mode: this.mode,
      paused: this.paused,
      task: this.publicTask(viewerId),
      phase: this.phase,
      direction: this.direction,
      activeColor: this.activeColor,
      top: this.top || null,
      drawCount: this.drawPile.length,
      discardCount: this.discardPile.length,
      currentPlayerId: this.phase === 'playing' ? this.currentPlayer.id : null,
      turnState: this.turnState,
      pendingDraw: this.pendingDraw,
      turnEndsAt: this.turnEndsAt,
      turnDuration: this.turnMs,
      frozen: this.frozen,
      reconnectEndsAt: this.reconnectEndsAt,
      disconnectedNames: [...this.disconnected].map((id) => { const p = this.getPlayer(id); return p ? p.name : ''; }).filter(Boolean),
      drawnCardId: me && this.currentPlayer && this.currentPlayer.id === viewerId ? this.drawnCardId : null,
      canCallLastCard: !!(me && me.hand.length === 1 && this.lastcardPending.has(viewerId)),
      winnerId: this.winnerId,
      finisher: this.finisher,
      players: this.publicPlayers(viewerId),
      hand: me ? me.hand : [],
      log: this.log.slice(-12),
      event: this.lastEvent,
    };
  }
}

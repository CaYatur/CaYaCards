// Party-mode penalty mini-games overlay: drawing, emoji-charades, trivia and
// colour-memory. The penalised player performs while everyone watches; the
// result (vote or score) decides how many cards are refunded / drawn.
import { net } from './net.js';
import { sfx } from './sound.js';

const $ = (id) => document.getElementById(id);
const COLORS = ['#ffffff', '#1a1a1a', '#e64a4a', '#4e8fd6', '#5fbf6a', '#f2c043', '#e06a8b', '#e08552'];
const CANVAS_BG = '#f7f3ea'; // eraser paints with the canvas background colour
const EMOJI_PALETTE = ['😀','😂','😍','😎','😭','😱','😈','🤖','👽','💀','👍','👏','🙏','💪','🔥','💧','⚡','🌈','⭐','🌙','☀️','❄️','🍕','🍔','🍟','🎂','🍺','☕','⚽','🏀','🎸','🎤','🎬','📱','💻','🚀','✈️','🚗','🏖️','🏔️','❤️','💔','🎉','🎈','👻','🐱','🐶','🦄'];
const MEM_HEX = { amber: '#E0A53D', blue: '#4E7FB5', clay: '#D9764A', green: '#6E9457' };
const TYPE_LABEL = { draw: '🎨 Çizim', emoji: '😀 Emoji Anlatımı', trivia: '🧠 Bilgi Yarışması', memory: '🎯 Renk Hafızası', reaction: '⚡ Hızlı Tepki', tap: '👆 Hızlı Tıkla', timing: '🎯 Dur!', whack: '🎯 Nişancı', pop: '🎈 Balon Patlat', chase: '🧲 Takip Et', sort: '🔢 Sırala', hold: '✋ Tam Zamanı' };
// reflex/party games the performer's browser runs end-to-end, then submits a 0..1 score
const CLIENT_GAME_RUNNERS = { reaction: 'runReaction', tap: 'runTap', timing: 'runTiming', whack: 'runWhack', pop: 'runPop', chase: 'runChase', sort: 'runSort', hold: 'runHold' };
const BALLOON_COLORS = ['#e64a4a', '#4e8fd6', '#5fbf6a', '#f2c043', '#e06a8b', '#b07be0', '#e08552'];
const WHACK_FACES = ['🎯', '🔴', '⭐', '🟢', '💥'];

class TaskMode {
  constructor() {
    this.strokes = new Map(); this.order = [];
    this.taskId = null; this.phase = null; this.type = null;
    this.isDrawer = false; this.color = '#1a1a1a'; this.width = 4; this.eraser = false;
    this.drawing = false; this.cur = null; this.unsent = []; this.lastSend = 0;
    this.voted = false; this.endsAt = 0; this.visible = false; this.memFlashed = null; this.memBusy = false;
    this._timers = []; this._raf = null; this.gameStartedFor = null;
  }

  // timer helpers so client mini-games clean up properly
  t(fn, ms) { const id = setTimeout(fn, ms); this._timers.push(id); return id; }
  clearGame() { this._timers.forEach(clearTimeout); this._timers = []; if (this._raf) cancelAnimationFrame(this._raf); this._raf = null; this.memBusy = false; }

  init() {
    this.canvas = $('task-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.wrap = this.canvas.parentNode; // .task-canvas-wrap
    this.content = document.createElement('div');
    this.content.id = 'task-content'; this.content.className = 'task-content';
    this.wrap.parentNode.insertBefore(this.content, this.wrap.nextSibling);

    this.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onMove(e));
    addEventListener('pointerup', () => this.onUp());
    this.canvas.addEventListener('pointerleave', () => this.onUp());
    const tick = () => { this.tickTimer(); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }

  update(state) {
    const t = state && state.task;
    if (!t) { this.hide(); return; }
    const fresh = t.id !== this.taskId;
    this.taskId = t.id; this.type = t.type; this.isDrawer = !!t.youAreDrawer; this.endsAt = t.endsAt;
    if (fresh) { this.voted = false; this.memFlashed = null; this.gameStartedFor = null; this.eraser = false; this.clearGame(); if (t.type === 'draw') this.loadStrokes(t.strokes); }
    if (t.type === 'draw' && (t.phase === 'vote' || t.phase === 'result')) this.loadStrokes(t.strokes);
    this.phase = t.phase;
    if (t.youVoted) this.voted = true;
    this.show();
    this.render(t);
  }

  render(t) {
    // canvas only for the drawing game
    this.wrap.style.display = t.type === 'draw' ? '' : 'none';
    this.content.style.display = t.type === 'draw' ? 'none' : '';
    if (t.type === 'draw') this.redraw();
    if (t.phase === 'perform') this.renderPerform(t);
    else if (t.phase === 'vote') this.renderVote(t);
    else this.renderResult(t);
  }

  // ---- PERFORM -------------------------------------------------------------
  renderPerform(t) {
    const title = $('task-title'), tools = $('task-tools'), foot = $('task-foot');
    const who = t.youAreDrawer ? 'Sen' : t.drawerName;
    const stake = t.penaltyCount ? `<span class="task-stake">İyi yaparsan ${t.penaltyCount} karta kadar iade · kötüyse ekstra ceza</span>` : '';
    tools.style.display = 'none'; tools.innerHTML = ''; foot.innerHTML = '';

    if (t.type === 'draw') {
      title.innerHTML = `🎨 <b>${esc(who)}</b> çiziyor — <span class="prompt">serbest çizim ✏️</span>${stake}`;
      if (t.youAreDrawer) { this.drawTools(tools); foot.append(
        mkBtn('Temizle', 'ghost', () => { this.strokes.clear(); this.order = []; this.redraw(); net.taskStroke({ clear: true }); }),
        mkBtn('Bitti ✓', 'primary', () => net.taskDone())); }
      else foot.innerHTML = `<span class="task-watch">👀 ${esc(t.drawerName)} çiziyor…</span>`;

    } else if (t.type === 'emoji') {
      title.innerHTML = `😀 <b>${esc(who)}</b> emojiyle anlatıyor: <span class="prompt">“${esc(t.prompt)}”</span>${stake}`;
      this.content.innerHTML = `<div class="emoji-strip">${(t.emojis || []).map((e) => `<span>${e}</span>`).join('') || '<i class="ph">emoji ekle…</i>'}</div>`;
      if (t.youAreDrawer) {
        const pal = document.createElement('div'); pal.className = 'emoji-pal';
        for (const e of EMOJI_PALETTE) { const b = document.createElement('button'); b.textContent = e; b.onclick = () => { sfx.play('click'); net.taskEmoji(e); }; pal.appendChild(b); }
        this.content.appendChild(pal);
        foot.append(mkBtn('↩︎ Geri', 'ghost', () => net.taskEmoji('<<undo>>')), mkBtn('Bitti ✓', 'primary', () => net.taskDone()));
      } else foot.innerHTML = `<span class="task-watch">👀 ${esc(t.drawerName)} anlatıyor…</span>`;

    } else if (t.type === 'trivia') {
      title.innerHTML = `🧠 <b>${esc(who)}</b> bilgi yarışmasında${stake}`;
      const qs = t.questions || [];
      let qi = qs.findIndex((q) => !q.answered); if (qi < 0) qi = qs.length - 1;
      const q = qs[qi] || { q: '', o: [] };
      this.content.innerHTML = `<div class="trivia-prog">Soru ${Math.min(qi + 1, qs.length)}/${qs.length}</div>
        <div class="trivia-q">${esc(q.q)}</div>`;
      const opts = document.createElement('div'); opts.className = 'trivia-opts';
      q.o.forEach((opt, i) => {
        const b = document.createElement('button'); b.className = 'trivia-opt'; b.textContent = opt;
        if (t.youAreDrawer && !q.answered) b.onclick = () => { sfx.play('click'); net.taskAnswer(qi, i); };
        else b.disabled = true;
        opts.appendChild(b);
      });
      this.content.appendChild(opts);
      if (!t.youAreDrawer) foot.innerHTML = `<span class="task-watch">${esc(t.drawerName)} cevaplıyor… (${t.answeredCount || 0}/${qs.length})</span>`;

    } else if (t.type === 'memory') {
      title.innerHTML = `🎯 <b>${esc(who)}</b> renk dizisini hatırlıyor${stake}`;
      this.renderMemory(t, title, foot);

    } else if (CLIENT_GAME_RUNNERS[t.type]) {
      title.innerHTML = `${TYPE_LABEL[t.type] || '🎮'} — <b>${esc(who)}</b>${stake}`;
      foot.innerHTML = '';
      if (t.youAreDrawer) {
        if (this.gameStartedFor !== t.id) {
          this.gameStartedFor = t.id; this.clearGame();
          this[CLIENT_GAME_RUNNERS[t.type]]();
        }
      } else {
        this.content.innerHTML = `<div class="task-watch big">🎮 ${esc(t.drawerName)} oynuyor…</div>`;
      }
    }
  }

  // ---- client-run reflex games (performer only) ----------------------------
  runReaction() {
    const c = this.content; c.innerHTML = '';
    const box = document.createElement('div'); box.className = 'rx-box rx-wait'; box.textContent = 'Hazır ol…';
    c.appendChild(box);
    let round = 0, armed = false, t0 = 0, armTimer = null; const total = 3, times = [];
    const finish = () => { const avg = times.reduce((a, b) => a + b, 0) / times.length; net.taskScore(clamp01((900 - avg) / 600), `${Math.round(avg)} ms`); };
    const next = () => {
      if (round >= total) { finish(); return; }
      armed = false; box.className = 'rx-box rx-wait'; box.textContent = `Tur ${round + 1}/${total} — yeşili bekle…`;
      armTimer = this.t(() => { armed = true; t0 = performance.now(); box.className = 'rx-box rx-go'; box.textContent = 'BAS!'; sfx.play('tick'); }, 900 + Math.random() * 2000);
    };
    box.onclick = () => {
      if (!armed) { this.ct(armTimer); box.className = 'rx-box rx-early'; box.textContent = 'Erken! 😅'; times.push(900); round++; this.t(next, 700); return; }
      const ms = performance.now() - t0; times.push(ms); armed = false; round++;
      box.className = 'rx-box rx-done'; box.textContent = `${Math.round(ms)} ms`; sfx.play('click'); this.t(next, 750);
    };
    next();
  }
  ct(id) { clearTimeout(id); this._timers = this._timers.filter((x) => x !== id); }

  runTap() {
    const c = this.content; c.innerHTML = '';
    const info = document.createElement('div'); info.className = 'tap-info'; info.textContent = 'Butona bas, 6 saniye olabildiğince hızlı tıkla!';
    const btn = document.createElement('button'); btn.className = 'tap-btn'; btn.textContent = '👆 TIKLA!';
    c.append(info, btn);
    let count = 0, started = false, endT = 0; const TARGET = 40, DUR = 6000;
    const loop = () => {
      const left = endT - performance.now();
      if (left <= 0) { info.textContent = `Bitti! ${count} tık`; btn.disabled = true; net.taskScore(clamp01(count / TARGET), `${count} tık`); return; }
      info.textContent = `${count} tık · ${Math.ceil(left / 1000)} sn`;
      this._raf = requestAnimationFrame(loop);
    };
    btn.onclick = () => {
      if (!started) { started = true; endT = performance.now() + DUR; loop(); }
      if (performance.now() > endT) return;
      count++; sfx.play('tick'); btn.style.transform = 'scale(0.95)'; this.t(() => (btn.style.transform = ''), 50);
    };
  }

  runTiming() {
    const c = this.content; c.innerHTML = '';
    const total = 3;
    const info = document.createElement('div'); info.className = 'tim-info';
    const bar = document.createElement('div'); bar.className = 'tim-bar';
    const zone = document.createElement('div'); zone.className = 'tim-zone';
    const marker = document.createElement('div'); marker.className = 'tim-marker';
    bar.append(zone, marker);
    const btn = document.createElement('button'); btn.className = 'primary tim-btn'; btn.textContent = 'DUR!';
    c.append(info, bar, btn);
    let pos = 0, dir = 1, round = 0, stopped = false, done = false; const scores = [], speed = 0.02;
    const setInfo = () => { info.textContent = `Deneme ${Math.min(round + 1, total)}/${total} — işaretçiyi yeşilde durdur!`; };
    setInfo();
    const anim = () => { if (stopped) return; pos += dir * speed; if (pos >= 1) { pos = 1; dir = -1; } if (pos <= 0) { pos = 0; dir = 1; } marker.style.left = (pos * 100) + '%'; this._raf = requestAnimationFrame(anim); };
    btn.onclick = () => {
      if (done || stopped) return;
      stopped = true; if (this._raf) cancelAnimationFrame(this._raf);
      const acc = clamp01(1 - Math.abs(pos - 0.5) * 2); scores.push(acc); round++;
      marker.style.background = acc > 0.7 ? '#5fbf6a' : '#e64a4a'; sfx.play(acc > 0.7 ? 'lastcard' : 'click');
      if (round >= total) {
        done = true; btn.disabled = true;
        const f = scores.reduce((a, b) => a + b, 0) / scores.length;
        info.textContent = `Bitti! Ortalama %${Math.round(f * 100)}`;
        net.taskScore(f, `%${Math.round(f * 100)} isabet`); // finish now, don't wait for the timer
        return;
      }
      info.textContent = `${round}. deneme: %${Math.round(acc * 100)} — sıradaki…`;
      this.t(() => { stopped = false; marker.style.background = ''; setInfo(); anim(); }, 700);
    };
    anim();
  }

  // 🎯 Nişancı — targets pop up at random spots; tap them before they vanish.
  runWhack() {
    const c = this.content; c.innerHTML = '';
    const info = document.createElement('div'); info.className = 'wk-info'; info.textContent = 'Hedefler çıkınca hemen dokun!';
    const field = document.createElement('div'); field.className = 'wk-field';
    c.append(info, field);
    const DUR = 13000, TARGET = 14;
    let hits = 0, cur = null, hideTimer = null; const endT = performance.now() + DUR;
    const clearTarget = () => { if (cur) { cur.remove(); cur = null; } };
    const spawn = () => {
      if (performance.now() >= endT) return;
      clearTarget();
      const b = document.createElement('button'); b.className = 'wk-target'; b.textContent = pick(WHACK_FACES);
      b.style.left = (8 + Math.random() * 84) + '%'; b.style.top = (10 + Math.random() * 78) + '%';
      b.onpointerdown = (e) => {
        e.stopPropagation(); if (b.classList.contains('hit')) return;
        hits++; sfx.play('tick'); b.classList.add('hit'); this.ct(hideTimer);
        this.t(() => { clearTarget(); spawn(); }, 110);
      };
      field.appendChild(b); cur = b;
      hideTimer = this.t(() => { clearTarget(); spawn(); }, Math.max(520, 1150 - hits * 45));
    };
    const loop = () => {
      const left = endT - performance.now();
      if (left <= 0) { clearTarget(); info.textContent = `Bitti! ${hits} isabet`; net.taskScore(clamp01(hits / TARGET), `${hits} isabet`); return; }
      info.textContent = `🎯 ${hits} isabet · ${Math.ceil(left / 1000)} sn`;
      this._raf = requestAnimationFrame(loop);
    };
    this.t(spawn, 500); loop();
  }

  // 🎈 Balon Patlat — balloons float up; pop as many as you can before they escape.
  runPop() {
    const c = this.content; c.innerHTML = '';
    const info = document.createElement('div'); info.className = 'wk-info'; info.textContent = 'Balonları patlat!';
    const field = document.createElement('div'); field.className = 'pop-field';
    c.append(info, field);
    const DUR = 14000, TARGET = 16; let popped = 0; const endT = performance.now() + DUR;
    const spawn = () => {
      if (performance.now() >= endT) return;
      const b = document.createElement('div'); b.className = 'balloon'; b.textContent = '🎈'; b.style.color = pick(BALLOON_COLORS);
      b.style.left = (8 + Math.random() * 84) + '%';
      const dur = 2500 + Math.random() * 1500; b.style.animationDuration = dur + 'ms';
      b.onpointerdown = () => { if (b._done) return; b._done = true; popped++; sfx.play('tick'); b.classList.add('pop'); this.t(() => b.remove(), 200); };
      field.appendChild(b);
      this.t(() => { if (!b._done) b.remove(); }, dur + 80);
      this.t(spawn, 420 + Math.random() * 340);
    };
    const loop = () => {
      const left = endT - performance.now();
      if (left <= 0) { info.textContent = `Bitti! ${popped} balon patlattın`; net.taskScore(clamp01(popped / TARGET), `${popped} balon`); this.t(() => field.querySelectorAll('.balloon').forEach((x) => x.remove()), 500); return; }
      info.textContent = `🎈 ${popped} · ${Math.ceil(left / 1000)} sn`;
      this._raf = requestAnimationFrame(loop);
    };
    this.t(spawn, 350); loop();
  }

  // 🧲 Takip Et — a dot drifts around; keep your pointer/finger on it. Score = time on target.
  runChase() {
    const c = this.content; c.innerHTML = '';
    const info = document.createElement('div'); info.className = 'wk-info'; info.textContent = 'Noktayı takip et — üstünde kal!';
    const field = document.createElement('div'); field.className = 'chase-field';
    const dot = document.createElement('div'); dot.className = 'chase-dot';
    field.append(dot); c.append(info, field);
    const DUR = 11000; let x = 50, y = 50, tx = 50, ty = 50, on = 0, samples = 0, ptr = null; const endT = performance.now() + DUR;
    const setPtr = (e) => { const r = field.getBoundingClientRect(); ptr = [(e.clientX - r.left) / r.width * 100, (e.clientY - r.top) / r.height * 100]; };
    field.addEventListener('pointerdown', (e) => { field.setPointerCapture(e.pointerId); setPtr(e); });
    field.addEventListener('pointermove', setPtr);
    field.addEventListener('pointerup', () => { ptr = null; });
    field.addEventListener('pointerleave', () => { ptr = null; });
    const retarget = () => { tx = 12 + Math.random() * 76; ty = 12 + Math.random() * 76; };
    retarget();
    const loop = () => {
      const now = performance.now();
      if (now >= endT) { const f = samples ? on / samples : 0; info.textContent = `Bitti! %${Math.round(f * 100)} takip`; net.taskScore(clamp01(f), `%${Math.round(f * 100)} takip`); return; }
      x += (tx - x) * 0.045; y += (ty - y) * 0.045;
      if (Math.abs(tx - x) < 2 && Math.abs(ty - y) < 2) retarget();
      dot.style.left = x + '%'; dot.style.top = y + '%';
      samples++;
      const hit = ptr && Math.hypot(ptr[0] - x, ptr[1] - y) < 9;
      if (hit) on++;
      dot.classList.toggle('on', !!hit);
      info.textContent = `Takip: %${Math.round((on / samples) * 100)} · ${Math.ceil((endT - now) / 1000)} sn`;
      this._raf = requestAnimationFrame(loop);
    };
    loop();
  }

  // 🔢 Sırala — 9 scrambled tiles; tap them 1→9 in order as fast as you can.
  runSort() {
    const c = this.content; c.innerHTML = '';
    const info = document.createElement('div'); info.className = 'wk-info'; info.textContent = '1’den 9’a sırayla bas!';
    const grid = document.createElement('div'); grid.className = 'sort-grid';
    c.append(info, grid);
    const LIMIT = 18; let next = 1, wrong = 0, startT = 0, started = false, done = false;
    for (const n of shuffleArr([1, 2, 3, 4, 5, 6, 7, 8, 9])) {
      const b = document.createElement('button'); b.className = 'sort-cell'; b.textContent = n;
      b.onpointerdown = () => {
        if (done || b.disabled) return;
        if (!started) { started = true; startT = performance.now(); }
        if (n === next) {
          b.classList.add('done'); b.disabled = true; sfx.play('tick'); next++;
          if (next > 9) {
            done = true;
            const elapsed = (performance.now() - startT) / 1000;
            const speed = clamp01((LIMIT - elapsed) / (LIMIT - 4));
            const frac = clamp01(0.6 + speed * 0.4 - wrong * 0.05);
            info.textContent = `Bitti! ${elapsed.toFixed(1)} sn · ${wrong} hata`;
            net.taskScore(frac, `${elapsed.toFixed(1)} sn`);
          } else info.textContent = `Sıradaki: ${next}`;
        } else { wrong++; b.classList.add('bad'); sfx.play('click'); this.t(() => b.classList.remove('bad'), 260); }
      };
      grid.appendChild(b);
    }
  }

  // ✋ Tam Zamanı — hold the pad for exactly the shown seconds; no on-screen timer.
  runHold() {
    const c = this.content; c.innerHTML = '';
    const info = document.createElement('div'); info.className = 'wk-info';
    const pad = document.createElement('button'); pad.className = 'hold-pad'; pad.textContent = 'BAS & TUT';
    c.append(info, pad);
    const total = 3; const scores = []; let round = 0, target = 0, downT = 0, holding = false, done = false;
    const start = () => { target = 1.5 + Math.random() * 2.5; pad.className = 'hold-pad'; pad.textContent = 'BAS & TUT'; info.innerHTML = `Deneme ${Math.min(round + 1, total)}/${total} — tam <b>${target.toFixed(1)} sn</b> basılı tut (sayaç yok!)`; };
    pad.onpointerdown = () => { if (done || holding) return; holding = true; downT = performance.now(); pad.classList.add('holding'); pad.textContent = '… bırakma …'; };
    const release = () => {
      if (!holding || done) return; holding = false;
      const held = (performance.now() - downT) / 1000;
      const acc = clamp01(1 - Math.abs(held - target) / 1.5); scores.push(acc); round++;
      pad.classList.remove('holding'); pad.textContent = `${held.toFixed(1)}s (hedef ${target.toFixed(1)})`;
      sfx.play(acc > 0.7 ? 'lastcard' : 'click');
      if (round >= total) {
        done = true; pad.disabled = true;
        const f = scores.reduce((a, b) => a + b, 0) / scores.length;
        info.textContent = `Bitti! Ortalama %${Math.round(f * 100)} isabet`;
        net.taskScore(f, `%${Math.round(f * 100)} isabet`);
      } else { info.textContent = `%${Math.round(acc * 100)} — sıradaki…`; this.t(start, 950); }
    };
    pad.onpointerup = release; pad.onpointerleave = release;
    start();
  }

  drawTools(tools) {
    tools.style.display = 'flex';
    const sw = document.createElement('div'); sw.className = 'task-swatches';
    for (const c of COLORS) { const b = document.createElement('button'); b.className = 'tsw' + (!this.eraser && c === this.color ? ' sel' : ''); b.style.background = c; b.title = 'Kalem rengi'; b.onclick = () => { this.color = c; this.eraser = false; this.drawTools(tools); }; sw.appendChild(b); }
    const er = document.createElement('button'); er.className = 'task-eraser' + (this.eraser ? ' on' : ''); er.innerHTML = `🧽 <span>${this.eraser ? 'Silgi açık' : 'Silgi'}</span>`; er.title = 'Silgi — çizimi sil (tekrar bas: kalem)'; er.setAttribute('aria-pressed', this.eraser ? 'true' : 'false'); er.onclick = () => { sfx.play('click'); this.eraser = !this.eraser; this.drawTools(tools); }; sw.appendChild(er);
    const sz = document.createElement('div'); sz.className = 'task-sizes';
    for (const w of [2, 4, 8, 14]) { const b = document.createElement('button'); b.className = 'tsz' + (w === this.width ? ' sel' : ''); b.textContent = '•'; b.style.fontSize = (8 + w) + 'px'; b.onclick = () => { this.width = w; this.drawTools(tools); }; sz.appendChild(b); }
    tools.innerHTML = ''; tools.append(sw, sz);
  }

  renderMemory(t, title, foot) {
    const tiles = document.createElement('div'); tiles.className = 'mem-tiles';
    const btns = {};
    for (const c of ['amber', 'blue', 'clay', 'green']) {
      const b = document.createElement('button'); b.className = 'mem-tile'; b.style.background = MEM_HEX[c];
      btns[c] = b; tiles.appendChild(b);
    }
    this.content.innerHTML = '';
    const info = document.createElement('div'); info.className = 'mem-info';
    this.content.append(info, tiles);

    const flash = async () => {
      this.memBusy = true; info.textContent = 'Diziyi izle…';
      await sleep(500);
      for (const c of t.seq) { btns[c].classList.add('lit'); sfx.play('tick'); await sleep(520); btns[c].classList.remove('lit'); await sleep(180); }
      this.memBusy = false;
      info.textContent = t.youAreDrawer ? 'Şimdi sırayla tekrarla!' : `${t.drawerName} tekrarlıyor…`;
    };

    if (this.memFlashed !== t.id) { this.memFlashed = t.id; flash(); }
    else info.textContent = t.youAreDrawer ? `Tekrarla! (${t.inputLen || 0}/${t.total})` : `${t.drawerName} tekrarlıyor… (${t.inputLen || 0}/${t.total})`;

    if (t.youAreDrawer) {
      for (const c of ['amber', 'blue', 'clay', 'green']) btns[c].onclick = () => {
        if (this.memBusy) return;
        btns[c].classList.add('lit'); setTimeout(() => btns[c].classList.remove('lit'), 180);
        sfx.play('click'); net.taskTap(c);
      };
    }
    foot.innerHTML = `<span class="task-watch">${t.total} renklik dizi · doğru hatırladığın kadar kart iade</span>`;
  }

  // ---- VOTE (draw / emoji) -------------------------------------------------
  renderVote(t) {
    this.clearGame();
    const title = $('task-title'), tools = $('task-tools'), foot = $('task-foot');
    tools.style.display = 'none'; tools.innerHTML = '';
    const votePrompt = t.prompt ? ` · “${esc(t.prompt)}”` : '';
    title.innerHTML = `🗳️ <b>${esc(t.drawerName)}</b>${votePrompt} — puanla!`;
    if (t.type === 'emoji') this.content.innerHTML = `<div class="emoji-strip big">${(t.emojis || []).map((e) => `<span>${e}</span>`).join('') || '<i class="ph">(boş)</i>'}</div>`;
    if (t.youAreDrawer) foot.innerHTML = `<span class="task-watch">Oylar toplanıyor… (${t.votesCount}/${t.voterCount})</span>`;
    else if (this.voted) foot.innerHTML = `<span class="task-watch">Oyun verildi ✓ (${t.votesCount}/${t.voterCount})</span>`;
    else {
      foot.innerHTML = ''; const stars = document.createElement('div'); stars.className = 'task-stars';
      for (let s = 1; s <= 5; s++) { const b = document.createElement('button'); b.className = 'star'; b.textContent = '★'; b.onclick = () => { this.voted = true; sfx.play('click'); net.taskVote(s); this.render(t); }; stars.appendChild(b); }
      foot.appendChild(stars);
    }
  }

  // ---- RESULT --------------------------------------------------------------
  renderResult(t) {
    this.clearGame();
    const title = $('task-title'), tools = $('task-tools'), foot = $('task-foot');
    tools.style.display = 'none'; tools.innerHTML = '';
    title.innerHTML = `🏁 Sonuç · ${TYPE_LABEL[t.type] || '🎲'} — <b>${esc(t.drawerName)}</b>`;

    let scoreHtml = '';
    if (t.usesVote) {
      const avg = t.avg || 0, full = Math.round(avg);
      scoreHtml = `<div class="task-score">${'★★★★★'.slice(0, full)}${'☆☆☆☆☆'.slice(0, 5 - full)} <b>${avg.toFixed(1)}</b>/5</div>
        <div class="task-msg">${esc(voteMsg(avg, t.votesCount))}</div>`;
      if (t.type === 'emoji') this.content.innerHTML = `<div class="emoji-strip big">${(t.emojis || []).map((e) => `<span>${e}</span>`).join('')}</div>`;
    } else if (t.type === 'trivia') {
      scoreHtml = `<div class="task-score">${t.score}/${t.total} doğru</div>`;
      this.content.innerHTML = `<div class="trivia-review">${(t.questions || []).map((q) =>
        `<div class="tr-row ${q.chosen === q.correct ? 'ok' : 'no'}">${q.chosen === q.correct ? '✅' : '❌'} ${esc(q.q)} <b>${esc(q.o[q.correct] ?? '')}</b></div>`).join('')}</div>`;
    } else if (t.type === 'memory') {
      scoreHtml = `<div class="task-score">${t.score}/${t.total} renk hatırladı</div>`;
      this.content.innerHTML = `<div class="mem-review">${(t.seq || []).map((c, i) =>
        `<span class="mem-dot ${i < t.score ? 'ok' : 'no'}" style="background:${MEM_HEX[c]}"></span>`).join('')}</div>`;
    } else {
      scoreHtml = `<div class="task-score">${esc(t.scoreLabel || '—')}</div>`;
      this.content.innerHTML = '';
    }

    const d = t.cardDelta || 0; let cardLine, cls;
    if (!hasJury(t)) { cardLine = 'Jüri/skor yok — ceza aynı kaldı'; cls = 'neutral'; }
    else if (d < 0) { cardLine = `🎉 ${-d} kart iade — ${d === -(t.penaltyCount || 0) ? 'ceza silindi!' : 'aferin!'}`; cls = 'good'; }
    else if (d > 0) { cardLine = `😬 +${d} kart ceza — bir dahakine!`; cls = 'bad'; }
    else { cardLine = 'Ceza aynı kaldı'; cls = 'neutral'; }
    foot.innerHTML = `<div class="task-result">${scoreHtml}<div class="task-cards ${cls}">${cardLine}</div></div>`;
  }

  // ---- drawing canvas ------------------------------------------------------
  loadStrokes(strokes) { this.strokes.clear(); this.order = []; for (const s of (strokes || [])) { this.strokes.set(s.id, { color: s.color, w: s.w, pts: s.pts.slice() }); this.order.push(s.id); } }
  addRemoteStroke(stroke) {
    if (!this.visible || this.isDrawer || this.type !== 'draw') return;
    if (stroke.clear) { this.strokes.clear(); this.order = []; this.redraw(); return; }
    let s = this.strokes.get(stroke.id);
    if (!s) { s = { color: stroke.color, w: stroke.w, pts: [] }; this.strokes.set(stroke.id, s); this.order.push(stroke.id); }
    if (Array.isArray(stroke.pts)) for (const p of stroke.pts) s.pts.push(p);
    this.redraw();
  }
  norm(e) { const r = this.canvas.getBoundingClientRect(); return [clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height)]; }
  canDraw() { return this.isDrawer && this.type === 'draw' && this.phase === 'perform'; }
  onDown(e) { if (!this.canDraw()) return; e.preventDefault(); this.drawing = true; const id = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); const color = this.eraser ? CANVAS_BG : this.color; const w = this.eraser ? 12 : this.width; this.cur = { id, color, w, pts: [this.norm(e)] }; this.strokes.set(id, this.cur); this.order.push(id); this.unsent = [this.cur.pts[0]]; this.flush(true); this.redraw(); }
  onMove(e) { if (!this.drawing || !this.canDraw()) return; const p = this.norm(e); this.cur.pts.push(p); this.unsent.push(p); this.redraw(); if (performance.now() - this.lastSend > 80) this.flush(); }
  onUp() { if (!this.drawing) return; this.drawing = false; this.flush(true); this.cur = null; }
  flush(force) { if (!this.cur || !this.unsent.length) { if (!force) return; if (!this.unsent.length) return; } net.taskStroke({ id: this.cur.id, color: this.cur.color, w: this.cur.w, pts: this.unsent }); this.unsent = []; this.lastSend = performance.now(); }
  redraw() {
    if (this.type !== 'draw') return;
    const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = CANVAS_BG; ctx.fillRect(0, 0, W, H);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const id of this.order) { const s = this.strokes.get(id); if (!s || !s.pts.length) continue; ctx.strokeStyle = s.color; ctx.lineWidth = s.w; ctx.beginPath(); ctx.moveTo(s.pts[0][0] * W, s.pts[0][1] * H); for (let i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i][0] * W, s.pts[i][1] * H); if (s.pts.length === 1) ctx.lineTo(s.pts[0][0] * W + 0.1, s.pts[0][1] * H); ctx.stroke(); }
  }

  tickTimer() {
    if (!this.visible) return;
    const remaining = Math.max(0, Math.ceil((this.endsAt - Date.now()) / 1000));
    const el = $('task-timer'); if (el) { el.textContent = remaining; el.classList.toggle('low', remaining <= 5 && this.phase !== 'result'); }
  }
  show() { if (!this.visible) { this.visible = true; $('task-overlay').classList.add('show'); sfx.play('turn'); } }
  hide() { if (!this.visible) return; this.clearGame(); this.visible = false; this.taskId = null; this.phase = null; this.type = null; this.gameStartedFor = null; this.strokes.clear(); this.order = []; this.content.innerHTML = ''; $('task-overlay').classList.remove('show'); }
}

function mkBtn(text, cls, fn) { const b = document.createElement('button'); b.className = cls; b.textContent = text; b.onclick = fn; return b; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function clamp(v) { return Math.max(0, Math.min(1, v)); }
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
function shuffleArr(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function hasJury(t) { return t.usesVote ? t.votesCount > 0 : true; }
function voteMsg(avg, n) { if (!n) return 'Kimse oylamadı 🤷'; if (avg >= 4.5) return 'Şaheser! 🏆'; if (avg >= 3.5) return 'Çok iyi! 👏'; if (avg >= 2.5) return 'Fena değil 🙂'; if (avg >= 1.5) return 'Eh işte… 😅'; return 'Olmamış 😂'; }

export const taskMode = new TaskMode();

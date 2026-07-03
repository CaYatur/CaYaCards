// App entry: player identity, screen routing, and wiring between the network,
// the 3D scene and the HTML UI.
import { net } from './net.js';
import * as ui from './ui.js';
import { Scene3D } from './scene3d.js';
import { defaultCosmetics } from './cosmetics.js';
import { preloadCommon } from './cards.js';
import { taskMode } from './taskmode.js';

// ---- player identity (persisted) ------------------------------------------
function loadPlayer() {
  let p;
  try { p = JSON.parse(localStorage.getItem('cayacards.player') || 'null'); } catch { p = null; }
  if (!p || !p.id) {
    p = {
      id: (crypto.randomUUID ? crypto.randomUUID() : 'p' + Math.random().toString(36).slice(2)),
      name: 'Oyuncu' + Math.floor(Math.random() * 1000),
      cosmetics: defaultCosmetics(),
    };
  }
  if (!p.cosmetics) p.cosmetics = defaultCosmetics();
  return p;
}
const player = loadPlayer();
function savePlayer() { localStorage.setItem('cayacards.player', JSON.stringify(player)); }
savePlayer();

let currentCode = sessionStorage.getItem('cayacards.code') || null;
let currentState = null;

// ---- 3D scene --------------------------------------------------------------
const scene = new Scene3D();
scene.init(document.getElementById('scene'), document.getElementById('labels'));
preloadCommon();
scene.onDrawPile = () => {
  if (currentState && currentState.currentPlayerId === player.id && currentState.turnState === 'play' && !currentState.paused) net.draw();
};
taskMode.init();
net.on('taskStroke', (s) => taskMode.addRemoteStroke(s));

// ---- UI handlers -----------------------------------------------------------
ui.bind({
  create: async (name, isPublic, mode) => {
    const res = await net.createRoom({ name, isPublic, mode, player });
    if (res.error) return ui.toast(res.error, '⚠️');
    setCode(res.code);
  },
  join: async (code) => {
    const res = await net.joinRoom({ code, player });
    if (res.error) return ui.toast(res.error, '⚠️');
    setCode(res.code);
  },
  refresh: async () => ui.renderRooms(await net.listRooms()),
  start: async () => { const r = await net.startGame(); if (r.error) ui.toast(r.error, '⚠️'); },
  addBot: () => net.addBot(),
  removeBot: (id) => net.removeBot(id),
  draw: () => net.draw(),
  pass: () => net.pass(),
  callLastCard: () => net.callLastCard(),
  chat: (text) => net.chat(text),
  resetCamera: () => scene.resetCamera(),
  skipCelebration: () => scene.skipCelebration(),
  rematch: () => net.restart(),
  play: async (cardId, color) => { const r = await net.play(cardId, color); if (r.error) ui.toast(r.error, '⚠️'); },
  leave: () => {
    net.leaveRoom();
    setCode(null);
    currentState = null;
    finisherPlayed = false;
    ui.hideWinner();
    ui.hideCelebration();
    ui.hideFinisherPicker();
    ui.hideFinisherWait();
    scene.endCelebration();
    ui.showScreen('menu');
    net.listRooms().then(ui.renderRooms);
  },
});

function setCode(code) {
  currentCode = code;
  if (code) sessionStorage.setItem('cayacards.code', code);
  else sessionStorage.removeItem('cayacards.code');
}

// ---- menu name + customizer ------------------------------------------------
const nameInput = document.getElementById('inp-name');
nameInput.value = player.name;
nameInput.addEventListener('input', () => {
  player.name = nameInput.value.trim().slice(0, 14) || 'Oyuncu';
  savePlayer();
  if (currentCode) net.updateCosmetics(player.cosmetics, player.name);
});
ui.buildCustomizer(player.cosmetics, (cos) => {
  player.cosmetics = cos; savePlayer();
  if (currentCode) net.updateCosmetics(cos, player.name);
});

// ---- network events --------------------------------------------------------
net.on('connect', () => {
  if (currentCode) net.joinRoom({ code: currentCode, player }).then((r) => { if (r.error) setCode(null); });
  net.listRooms().then(ui.renderRooms);
});
net.on('roomList', ui.renderRooms);
net.on('chat', ui.addChat);

let prevPhase = null;
let finisherPlayed = false;
net.on('state', (state) => {
  currentState = state;
  setCode(state.code);
  scene.setState(state);
  taskMode.update(state);
  ui.renderWait(state);

  if (state.phase === 'lobby') {
    if (prevPhase === 'finished') ui.toast('Yeni tur başlıyor — lobidesin!', '🔄');
    finisherPlayed = false;
    ui.showScreen('lobby');
    ui.renderLobby(state, player.id);
    ui.hideWinner();
    ui.hideCelebration();
    ui.hideFinisherPicker();
    ui.hideFinisherWait();
    scene.endCelebration();
  } else {
    ui.showScreen('game');
    ui.renderHUD(state, player.id);
    if (state.phase === 'finished' && state.winnerId) {
      const w = state.players.find((p) => p.id === state.winnerId);
      const isHost = state.hostId === player.id;
      const iWon = !!(w && w.isYou);
      const name = w ? (iWon ? 'Sen 🎉' : w.name) : '?';
      if (!state.finisher) {
        // selection stage: the winner picks a finale; everyone else waits
        finisherPlayed = false;
        if (iWon) { ui.hideFinisherWait(); ui.showFinisherPicker((id) => net.chooseFinisher(id)); }
        else { ui.hideFinisherPicker(); ui.showFinisherWait(w ? w.name : '?'); }
      } else if (!finisherPlayed) {
        // chosen → play the finisher once, then reveal the winner dialog
        finisherPlayed = true;
        ui.hideFinisherPicker();
        ui.hideFinisherWait();
        const losers = state.players.filter((p) => p.id !== state.winnerId);
        ui.showCelebration(w, iWon);
        scene.celebrateWinner(w, losers, state.finisher, () => { ui.hideCelebration(); ui.showWinner(name, isHost); });
      }
    } else {
      finisherPlayed = false;
      ui.hideWinner();
      ui.hideCelebration();
      ui.hideFinisherPicker();
      ui.hideFinisherWait();
      scene.endCelebration();
    }
  }
  prevPhase = state.phase;
});

// keep the public-room list fresh while sitting on the menu (fallback if a
// broadcast was missed)
setInterval(() => {
  if (document.getElementById('screen-menu').classList.contains('active')) net.listRooms().then(ui.renderRooms);
}, 5000);

// ---- boot ------------------------------------------------------------------
ui.showScreen('menu');
ui.hideLoader();

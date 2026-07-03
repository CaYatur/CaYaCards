// Express + Socket.IO server. Serves the client, /cards assets and a local
// copy of three.js, and runs the authoritative multiplayer card game.
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { Server } from 'socket.io';
import { RoomManager } from './rooms.js';
import { FINISHERS } from './game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const manager = new RoomManager();

// --- static assets --------------------------------------------------------
app.use(express.static(path.join(ROOT, 'public')));
app.use('/cards', express.static(path.join(ROOT, 'cards')));
// local three.js so the game works without external CDNs
app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules/three/build')));
app.use('/vendor/three/jsm', express.static(path.join(ROOT, 'node_modules/three/examples/jsm')));

app.get('/health', (_req, res) => res.json({ ok: true, rooms: manager.rooms.size }));

// --- realtime --------------------------------------------------------------
const RECONNECT_MS = 90000; // how long a dropped player's seat is held before removal

function broadcast(room) {
  if (!room) return;
  for (const p of room.game.players) {
    const sock = room.sockets.get(p.id);
    if (sock && p.connected && !p.isBot) sock.emit('state', room.game.getStateFor(p.id));
  }
}

function runBot(room) {
  room.botTimer = null;
  const g = room.game;
  const move = g.botMove();
  if (move) {
    if (move.action === 'play') g.playCard(move.playerId, move.cardId, move.chosenColor);
    else if (move.action === 'draw') g.drawCard(move.playerId);
    else if (move.action === 'pass') g.pass(move.playerId);
    if (g.lastcardPending.has(move.playerId)) g.callLastCard(move.playerId); // bots remember last card
  }
  afterAction(room);
}

// Arrange the next mover: a bot acts after a short delay; a human gets a 30s
// countdown that auto-resolves their turn. Sets game.turnEndsAt for the client.
function setTimers(room) {
  const g = room.game;
  clearTimeout(room.turnTimer); room.turnTimer = null;
  clearTimeout(room.botTimer); room.botTimer = null;
  g.turnEndsAt = null;
  if (g.phase !== 'playing' || g.paused || g.frozen || !room.hasHumans()) return;
  const cur = g.currentPlayer;
  if (!cur) return;
  if (cur.isBot) {
    // give a human who just reached 1 card time to press last card before a bot acts
    const humanOwesLastCard = [...g.lastcardPending].some((id) => { const p = g.getPlayer(id); return p && !p.isBot; });
    room.botTimer = setTimeout(() => runBot(room), humanOwesLastCard ? 2800 : g.botDelay);
  } else {
    const turnMs = g.turnMs;
    g.turnEndsAt = Date.now() + turnMs;
    const turnId = cur.id;
    room.turnTimer = setTimeout(() => {
      room.turnTimer = null;
      g.timeoutMove(turnId);
      afterAction(room);
    }, turnMs + 250);
  }
}

function afterAction(room) {
  maybeTriggerTask(room);
  maybeFinisherFallback(room);
  setTimers(room);
  broadcast(room);
}

// When the game ends, the winner has a window to pick a finisher; if they don't
// (or dropped), auto-pick the podium so the losers aren't stuck watching a menu.
// A bot winner shouldn't make everyone wait out that window — it picks randomly right away.
const FINISHER_CHOICE_MS = 30000;
function maybeFinisherFallback(room) {
  const g = room.game;
  if (g.phase === 'finished' && g.winnerId && !g.finisher) {
    const winner = g.getPlayer(g.winnerId);
    if (winner && winner.isBot) {
      const pick = FINISHERS[Math.floor(Math.random() * FINISHERS.length)];
      g.chooseFinisher(g.winnerId, pick);
      return;
    }
    if (!room.finisherTimer) {
      room.finisherTimer = setTimeout(() => {
        room.finisherTimer = null;
        if (g.phase === 'finished' && g.winnerId && !g.finisher) { g.chooseFinisher(g.winnerId, 'podium'); broadcast(room); }
      }, FINISHER_CHOICE_MS);
    }
  } else if (room.finisherTimer) {
    clearTimeout(room.finisherTimer); room.finisherTimer = null;
  }
}

// party mode: a heavy penalty (busting a +4 or more, or a last-card fail) starts a
// live drawing task that everyone watches and then rates.
const TASK_COOLDOWN = 25000; // don't chain penalty tasks back-to-back
function maybeTriggerTask(room) {
  const g = room.game;
  if (g.mode !== 'party' || g.task || g.paused || g.phase !== 'playing') return;
  const ev = g.lastEvent;
  if (!ev || ev.seq === room._lastTaskSeq) return;
  // a real penalty: busting a +2/+4 stack, or failing to call last card
  const trigger = (ev.type === 'draw' && ev.busted && ev.count >= 2) || ev.type === 'lastcardPenalty';
  if (!trigger) return;
  const drawer = g.getPlayer(ev.playerId);
  if (!drawer || drawer.isBot || !drawer.connected) return; // only human drawers
  if (Date.now() - (room._lastTaskAt || 0) < TASK_COOLDOWN) { room._lastTaskSeq = ev.seq; return; }
  room._lastTaskSeq = ev.seq;
  room._lastTaskAt = Date.now();
  const penaltyCount = ev.type === 'draw' ? (ev.count || 0) : 2;
  g.startDrawTask(ev.playerId, penaltyCount);
  clearTimeout(room.botTimer); room.botTimer = null;
  clearTimeout(room.turnTimer); room.turnTimer = null;
  scheduleTaskPhase(room);
}

function scheduleTaskPhase(room) {
  clearTimeout(room.taskTimer);
  const g = room.game;
  if (!g.task) return;
  const delay = Math.max(200, g.task.endsAt - Date.now());
  room.taskTimer = setTimeout(() => {
    room.taskTimer = null;
    const t = g.task;
    if (!t) return;
    if (t.phase === 'perform') { g.finishPerform(); broadcast(room); scheduleTaskPhase(room); }
    else if (t.phase === 'vote') { g.finishTask(); broadcast(room); scheduleTaskPhase(room); }
    else { g.clearTask(); afterAction(room); } // result done -> resume game
  }, delay);
}

// keep a public-room list pushed to anyone on the menu
function pushLobbyList() {
  io.emit('roomList', manager.listPublic());
}

io.on('connection', (socket) => {
  socket.on('listRooms', (cb) => { if (cb) cb(manager.listPublic()); });

  socket.on('createRoom', ({ name, isPublic, mode, player }, cb) => {
    const room = manager.create({ name, isPublic, mode, hostId: player.id });
    joinPlayer(room, socket, player);
    cb && cb({ ok: true, code: room.code, state: room.game.getStateFor(player.id) });
    afterAction(room);
    pushLobbyList();
  });

  socket.on('joinRoom', ({ code, player }, cb) => {
    const room = manager.get(code);
    if (!room) return cb && cb({ error: 'Oda bulunamadı.' });
    const g = room.game;
    const existing = g.getPlayer(player.id);
    if (!existing) {
      if (g.phase !== 'lobby') return cb && cb({ error: 'Oyun başladı, bu odaya katılamazsın.' });
      if (g.players.length >= 8) return cb && cb({ error: 'Oda dolu (maks 8).' });
    }
    joinPlayer(room, socket, player);
    cb && cb({ ok: true, code: room.code, state: g.getStateFor(player.id) });
    afterAction(room);
    pushLobbyList();
  });

  function joinPlayer(room, sock, player) {
    if (room.cleanupTimer) { clearTimeout(room.cleanupTimer); room.cleanupTimer = null; } // a human is (back)
    const g = room.game;
    let p = g.getPlayer(player.id);
    if (p) {
      // reclaim seat (reconnect)
      p.connected = true;
      p.isBot = false;
      p.name = player.name || p.name;
      if (player.cosmetics) p.cosmetics = player.cosmetics;
      // cancel the pending removal and unfreeze if they were the one we waited for
      if (room.reconnectTimers && room.reconnectTimers[p.id]) { clearTimeout(room.reconnectTimers[p.id]); delete room.reconnectTimers[p.id]; }
      g.markReconnected(p.id);
      if (!g.frozen) g.reconnectEndsAt = null;
    } else {
      p = {
        id: player.id,
        name: player.name || 'Oyuncu',
        isBot: false,
        connected: true,
        cosmetics: player.cosmetics || {},
      };
      g.addPlayer(p);
      if (!room.hostId) room.hostId = p.id;
    }
    room.sockets.set(p.id, sock);
    sock.data.code = room.code;
    sock.data.playerId = p.id;
    sock.join(room.code);
  }

  const withRoom = (fn) => (payload, cb) => {
    const room = manager.get(socket.data.code);
    if (!room) return cb && cb({ error: 'Oda yok.' });
    fn(room, payload || {}, cb);
  };

  socket.on('startGame', withRoom((room, _p, cb) => {
    if (room.hostId !== socket.data.playerId) return cb && cb({ error: 'Sadece kurucu başlatabilir.' });
    const r = room.game.start();
    if (r.error) return cb && cb(r);
    cb && cb({ ok: true });
    afterAction(room);
    pushLobbyList();
  }));

  socket.on('addBot', withRoom((room, _p, cb) => {
    if (room.hostId !== socket.data.playerId) return cb && cb({ error: 'Sadece kurucu.' });
    if (room.game.phase !== 'lobby') return cb && cb({ error: 'Oyun başladı.' });
    if (room.game.players.length >= 8) return cb && cb({ error: 'Oda dolu.' });
    manager.addBot(room);
    cb && cb({ ok: true });
    afterAction(room);
  }));

  socket.on('removeBot', withRoom((room, { botId }, cb) => {
    if (room.hostId !== socket.data.playerId) return cb && cb({ error: 'Sadece kurucu.' });
    const p = room.game.getPlayer(botId);
    if (p && p.isBot) room.game.removePlayer(botId);
    cb && cb({ ok: true });
    afterAction(room);
  }));

  socket.on('updateCosmetics', withRoom((room, { cosmetics, name }, cb) => {
    const p = room.game.getPlayer(socket.data.playerId);
    if (p) {
      if (cosmetics) p.cosmetics = cosmetics;
      if (name) p.name = String(name).slice(0, 14) || p.name;
    }
    cb && cb({ ok: true });
    afterAction(room);
  }));

  socket.on('play', withRoom((room, { cardId, chosenColor }, cb) => {
    const r = room.game.playCard(socket.data.playerId, cardId, chosenColor);
    cb && cb(r);
    afterAction(room);
    if (room.game.phase === 'finished') pushLobbyList();
  }));

  socket.on('draw', withRoom((room, _p, cb) => {
    const r = room.game.drawCard(socket.data.playerId);
    cb && cb(r);
    afterAction(room);
  }));

  socket.on('pass', withRoom((room, _p, cb) => {
    const r = room.game.pass(socket.data.playerId);
    cb && cb(r);
    afterAction(room);
  }));

  socket.on('callLastCard', withRoom((room, _p, cb) => {
    const r = room.game.callLastCard(socket.data.playerId);
    cb && cb(r);
    afterAction(room);
  }));

  // winner picks how they celebrate / finish off the losers
  socket.on('chooseFinisher', withRoom((room, { id }, cb) => {
    const r = room.game.chooseFinisher(socket.data.playerId, id);
    if (r && r.ok) { clearTimeout(room.finisherTimer); room.finisherTimer = null; }
    cb && cb(r || {});
    broadcast(room);
  }));

  // ---- party-mode penalty mini-games ----
  socket.on('taskStroke', withRoom((room, { stroke }) => {
    const g = room.game;
    if (!g.task || g.task.type !== 'draw' || g.task.phase !== 'perform' || g.task.drawerId !== socket.data.playerId) return;
    g.addStroke(socket.data.playerId, stroke);
    socket.to(room.code).emit('taskStroke', stroke); // live relay to watchers
  }));

  socket.on('taskEmoji', withRoom((room, { emoji }) => {
    room.game.addEmoji(socket.data.playerId, emoji);
    broadcast(room);
  }));

  socket.on('taskAnswer', withRoom((room, { qi, choice }) => {
    const g = room.game;
    const r = g.answerTrivia(socket.data.playerId, qi, choice);
    if (r && r.done) { g.finishTask(); scheduleTaskPhase(room); }
    broadcast(room);
  }));

  socket.on('taskTap', withRoom((room, { color }) => {
    const g = room.game;
    const r = g.tapMemory(socket.data.playerId, color);
    if (r && r.done) { g.finishTask(); scheduleTaskPhase(room); }
    broadcast(room);
  }));

  socket.on('taskScore', withRoom((room, { frac, label }) => {
    const g = room.game;
    const r = g.submitScore(socket.data.playerId, frac, label);
    if (r && r.done) { g.finishTask(); scheduleTaskPhase(room); }
    broadcast(room);
  }));

  socket.on('taskDone', withRoom((room, _p, cb) => {
    const g = room.game;
    if (g.task && g.task.phase === 'perform' && g.task.drawerId === socket.data.playerId) {
      g.finishPerform();
      broadcast(room);
      scheduleTaskPhase(room);
    }
    cb && cb({ ok: true });
  }));

  socket.on('taskVote', withRoom((room, { score }, cb) => {
    const g = room.game;
    const r = g.castVote(socket.data.playerId, score);
    if (r && r.allIn) { g.finishTask(); scheduleTaskPhase(room); }
    broadcast(room);
    cb && cb(r || {});
  }));

  socket.on('restart', withRoom((room, _p, cb) => {
    if (room.hostId !== socket.data.playerId) return cb && cb({ error: 'Sadece kurucu.' });
    // drop disconnected players, then back to lobby
    room.game.players = room.game.players.filter((p) => p.connected || p.isBot);
    room.game.phase = 'lobby';
    room.game.winnerId = null;
    room.game.finisher = null;
    clearTimeout(room.finisherTimer); room.finisherTimer = null;
    cb && cb({ ok: true });
    afterAction(room);
    pushLobbyList();
  }));

  socket.on('chat', withRoom((room, { text }, _cb) => {
    const p = room.game.getPlayer(socket.data.playerId);
    if (!p || !text) return;
    const msg = { name: p.name, text: String(text).slice(0, 200), t: Date.now() };
    io.to(room.code).emit('chat', msg);
  }));

  socket.on('leaveRoom', () => handleLeave(socket));
  socket.on('disconnect', () => handleLeave(socket));

  function handleLeave(sock) {
    const room = manager.get(sock.data.code);
    if (!room) return;
    const pid = sock.data.playerId;
    room.sockets.delete(pid);
    const g = room.game;
    const p = g.getPlayer(pid);
    if (p) {
      if (g.phase === 'lobby' || g.phase === 'finished') {
        g.removePlayer(pid);
        if (room.hostId === pid) {
          const next = g.players.find((x) => !x.isBot);
          room.hostId = next ? next.id : null;
        }
      } else {
        // mid-game: freeze and wait for them to return; remove after a while
        g.markDisconnected(pid);
        g.reconnectEndsAt = Date.now() + RECONNECT_MS;
        clearTimeout(room.turnTimer); room.turnTimer = null;
        clearTimeout(room.botTimer); room.botTimer = null;
        room.reconnectTimers = room.reconnectTimers || {};
        clearTimeout(room.reconnectTimers[pid]);
        room.reconnectTimers[pid] = setTimeout(() => {
          delete room.reconnectTimers[pid];
          g.removeMidGame(pid);
          if (room.hostId === pid) { const n = g.players.find((x) => !x.isBot && x.connected); room.hostId = n ? n.id : null; }
          if (!g.frozen) g.reconnectEndsAt = null;
          afterAction(room);
          pushLobbyList();
        }, RECONNECT_MS);
      }
    }
    // clean up: remove truly empty rooms now; if only bots / no live human
    // remain, keep briefly for reconnect then remove
    const hasHuman = g.players.some((x) => x.connected && !x.isBot);
    if (g.players.length === 0) {
      manager.remove(room.code);
    } else if (!hasHuman) {
      clearTimeout(room.cleanupTimer);
      room.cleanupTimer = setTimeout(() => {
        if (!room.game.players.some((x) => x.connected && !x.isBot)) { manager.remove(room.code); pushLobbyList(); }
      }, 60000);
      afterAction(room);
    } else {
      afterAction(room);
    }
    pushLobbyList();
    sock.data.code = null;
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n  🎴  CaYa Cards çalışıyor:`);
  console.log(`      Bu cihaz:        http://localhost:${PORT}`);
  // print LAN addresses so phones/other PCs on the same network can join
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const ni of nets[name]) {
        if (ni.family === 'IPv4' && !ni.internal) {
          console.log(`      Aynı ağdaki cihaz: http://${ni.address}:${PORT}  (telefon/tablet bunu açsın)`);
        }
      }
    }
  } catch {}
  console.log('');
});

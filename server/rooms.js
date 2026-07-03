// Room registry: create / join / list public rooms, bot management.
import { customAlphabet } from 'nanoid';
import { Game, MODES } from './game.js';

const makeCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 4);

const BOT_NAMES = ['Opus', 'Sonnet', 'Haiku', 'Fable', 'Nova', 'GPT-9000', 'Llama', 'Mistral'];

class Room {
  constructor({ name, isPublic, hostId, mode }) {
    this.code = makeCode();
    this.name = name || 'CaYa Cards Odası';
    this.isPublic = !!isPublic;
    this.mode = MODES.includes(mode) ? mode : 'classic';
    this.hostId = hostId;
    this.game = new Game(this);
    this.sockets = new Map(); // playerId -> socket
    this.botTimer = null;
    this.turnTimer = null;
    this.taskTimer = null;
    this.finisherTimer = null;
    this.cleanupTimer = null;
    this.reconnectTimers = {};
    this.createdAt = Date.now();
  }

  hasHumans() {
    return this.game.players.some((p) => p.connected && !p.isBot);
  }
}

export class RoomManager {
  constructor() {
    this.rooms = new Map(); // code -> Room
  }

  create({ name, isPublic, hostId, mode }) {
    let room = new Room({ name, isPublic, hostId, mode });
    while (this.rooms.has(room.code)) room = new Room({ name, isPublic, hostId, mode });
    this.rooms.set(room.code, room);
    return room;
  }

  get(code) { return this.rooms.get((code || '').toUpperCase()); }

  remove(code) {
    const r = this.rooms.get(code);
    if (r && r.botTimer) clearTimeout(r.botTimer);
    if (r && r.turnTimer) clearTimeout(r.turnTimer);
    if (r && r.taskTimer) clearTimeout(r.taskTimer);
    if (r && r.finisherTimer) clearTimeout(r.finisherTimer);
    if (r && r.cleanupTimer) clearTimeout(r.cleanupTimer);
    if (r && r.reconnectTimers) Object.values(r.reconnectTimers).forEach(clearTimeout);
    this.rooms.delete(code);
  }

  listPublic() {
    return [...this.rooms.values()]
      .filter((r) => r.isPublic && r.game.phase !== 'finished'
        && r.game.players.some((p) => p.connected && !p.isBot)) // only rooms with a live human
      .map((r) => ({
        code: r.code,
        name: r.name,
        mode: r.mode,
        playerCount: r.game.players.length,
        phase: r.game.phase,
        humans: r.game.players.filter((p) => !p.isBot).length,
      }))
      .sort((a, b) => b.playerCount - a.playerCount)
      .slice(0, 40);
  }

  addBot(room) {
    const used = new Set(room.game.players.map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) || `Bot${room.game.players.length}`;
    const colors = ['#e7b24a', '#5b8fd6', '#e08552', '#79b06a', '#b069d6', '#52c2c2'];
    const id = `bot-${room.code}-${room.game.players.length}-${Math.random().toString(36).slice(2, 6)}`;
    room.game.addPlayer({
      id,
      name,
      isBot: true,
      connected: true,
      cosmetics: {
        body: colors[room.game.players.length % colors.length],
        hat: ['none', 'cap', 'tophat', 'crown', 'beanie'][room.game.players.length % 5],
        glasses: ['none', 'round', 'shades'][room.game.players.length % 3],
        face: 'happy',
      },
    });
    return id;
  }
}

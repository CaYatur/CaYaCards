// Thin wrapper over the socket.io client (loaded globally via /socket.io/socket.io.js).
const socket = window.io({ transports: ['websocket', 'polling'] });

function emitAck(event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, (res) => resolve(res || {}));
  });
}

export const net = {
  socket,
  id: () => socket.id,
  on: (ev, fn) => socket.on(ev, fn),
  off: (ev, fn) => socket.off(ev, fn),

  createRoom: (data) => emitAck('createRoom', data),
  joinRoom: (data) => emitAck('joinRoom', data),
  listRooms: () => emitAck('listRooms'),
  startGame: () => emitAck('startGame'),
  addBot: () => emitAck('addBot'),
  removeBot: (botId) => emitAck('removeBot', { botId }),
  updateCosmetics: (cosmetics, name) => emitAck('updateCosmetics', { cosmetics, name }),
  play: (cardId, chosenColor) => emitAck('play', { cardId, chosenColor }),
  draw: () => emitAck('draw'),
  pass: () => emitAck('pass'),
  callLastCard: () => emitAck('callLastCard'),
  chooseFinisher: (id) => emitAck('chooseFinisher', { id }),
  restart: () => emitAck('restart'),
  leaveRoom: () => socket.emit('leaveRoom'),
  chat: (text) => socket.emit('chat', { text }),
  // party-mode penalty mini-games
  taskStroke: (stroke) => socket.emit('taskStroke', { stroke }),
  taskEmoji: (emoji) => socket.emit('taskEmoji', { emoji }),
  taskAnswer: (qi, choice) => socket.emit('taskAnswer', { qi, choice }),
  taskTap: (color) => socket.emit('taskTap', { color }),
  taskScore: (frac, label) => socket.emit('taskScore', { frac, label }),
  taskDone: () => emitAck('taskDone'),
  taskVote: (score) => emitAck('taskVote', { score }),
};

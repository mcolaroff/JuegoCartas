// Servidor del juego: guarda las partidas en memoria y sincroniza a todos por Socket.IO.
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const CARDS = require('./cards');

// ---------- Reglas (ajustables) ----------
const MIN_PLAYERS = 3;
const ACCEPT_MS = 20_000;     // tiempo para aceptar el turno
const VOTE_MS = 30_000;       // tiempo para el primer voto (después se puede votar igual)
const GRACE_MS = 10_000;      // margen antes de considerar que alguien se fue (celular bloqueado, etc.)
const ROOM_TTL_MS = 30 * 60_000; // se borra una partida sin nadie conectado

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.send('ok'));

/** @type {Map<string, any>} */
const rooms = new Map();

// ---------- Utilidades ----------
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const newId = () => crypto.randomBytes(8).toString('hex');
const norm = (s) => s.trim().toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '');
function newCode() {
  for (let i = 0; i < 1000; i++) {
    const c = String(Math.floor(1000 + Math.random() * 9000));
    if (!rooms.has(c)) return c;
  }
  throw new Error('Sin códigos libres');
}
const connected = (room) => [...room.players.values()].filter((p) => p.connected);
const inGame = (room) => ['offer', 'reading', 'voting'].includes(room.phase);

function cleanName(raw) {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return { error: 'Escribí un nombre o apodo.' };
  if (name.length > 20) return { error: 'Máximo 20 caracteres.' };
  return { name };
}

// ---------- Estado que ve cada jugador ----------
function viewFor(room, playerId) {
  const me = room.players.get(playerId);
  const isReader = room.readerId === playerId;
  const players = [...room.players.values()]
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .map((p) => ({ id: p.id, name: p.name, connected: p.connected, isHost: p.id === room.hostId, vote: room.votes.get(p.id) || null }));
  return {
    code: room.code,
    phase: room.phase,
    meId: playerId,
    isHost: room.hostId === playerId,
    hostName: room.players.get(room.hostId)?.name || '',
    players,
    connectedCount: connected(room).length,
    minPlayers: MIN_PLAYERS,
    readerId: room.readerId,
    readerName: room.players.get(room.readerId)?.name || '',
    // La carta solo la ve el lector. El resto no la necesita: la escucha.
    card: isReader && room.card ? room.card : null,
    cardNumber: room.cardsUsed,
    deckTotal: CARDS.length,
    round: room.round,
    turn: room.turn,
    myVote: room.votes.get(playerId) || null,
    offerDeadline: room.offerDeadline,
    voteDeadline: room.voteDeadline,
    serverNow: Date.now(),
    stats: { discussed: room.discussed, players: room.players.size },
    me: me ? { name: me.name } : null,
  };
}

function broadcast(room) {
  for (const p of room.players.values()) {
    if (p.socketId) io.to(p.socketId).emit('state', viewFor(room, p.id));
  }
}

function clearTimers(room) {
  clearTimeout(room.offerTimer); room.offerTimer = null;
}

// ---------- Turnos ----------
function refillQueue(room) {
  const ids = shuffle(connected(room).map((p) => p.id));
  // Que el primero de la ronda nueva no sea quien acaba de leer.
  if (ids.length > 1 && ids[0] === room.lastReaderId) {
    const j = 1 + Math.floor(Math.random() * (ids.length - 1));
    [ids[0], ids[j]] = [ids[j], ids[0]];
  }
  room.queue = ids;
  room.round += 1;
}

function chooseReader(room) {
  for (let attempts = 0; attempts < 2; attempts++) {
    if (!room.queue.length) refillQueue(room);
    while (room.queue.length) {
      const id = room.queue.shift();
      const p = room.players.get(id);
      if (!p || !p.connected) continue;
      if (id === room.lastReaderId && connected(room).length > 1) { continue; }
      return id;
    }
  }
  // Último recurso: cualquiera conectado que no sea el último lector.
  const others = connected(room).filter((p) => p.id !== room.lastReaderId);
  return (others.length ? pick(others) : pick(connected(room)))?.id || null;
}

function nextTurn(room) {
  clearTimers(room);
  room.votes = new Map();
  room.card = null;
  room.readerId = null;
  room.offerDeadline = null;
  room.voteDeadline = null;
  if (room.phase === 'ended') return broadcast(room);
  if (connected(room).length < MIN_PLAYERS) { room.phase = 'paused'; return broadcast(room); }
  if (!room.deck.length) return endGame(room);
  room.readerId = chooseReader(room);
  room.phase = 'offer';
  room.offerDeadline = Date.now() + ACCEPT_MS;
  const offered = room.readerId;
  room.offerTimer = setTimeout(() => {
    // No aceptó a tiempo: pasa a otra persona (sin contar como lectura).
    if (room.phase === 'offer' && room.readerId === offered) nextTurn(room);
  }, ACCEPT_MS);
  broadcast(room);
}

function endGame(room) {
  clearTimers(room);
  room.phase = 'ended';
  room.readerId = null;
  room.card = null;
  broadcast(room);
}

function assignNewHostIfNeeded(room) {
  const host = room.players.get(room.hostId);
  if (host && host.connected) return;
  const candidates = connected(room);
  if (candidates.length) room.hostId = pick(candidates).id; // al azar, como se definió
}

// Alguien ya no está (se fue o no volvió a tiempo).
function handleGone(room, playerId, removed) {
  const wasReader = room.readerId === playerId;
  if (removed) {
    room.players.delete(playerId);
    room.queue = room.queue.filter((id) => id !== playerId);
  }
  if (room.hostId === playerId || !room.players.has(room.hostId)) assignNewHostIfNeeded(room);
  if (room.phase === 'ended' || room.phase === 'lobby') return broadcast(room);
  if (inGame(room) && connected(room).length < MIN_PLAYERS) {
    if (room.phase === 'reading' || room.phase === 'voting') room.lastReaderId = room.readerId;
    return nextTurn(room); // queda en pausa
  }
  if (wasReader && inGame(room)) {
    if (room.phase !== 'offer') room.lastReaderId = playerId;
    return nextTurn(room);
  }
  broadcast(room);
}

function maybeResume(room) {
  if (room.phase === 'paused' && connected(room).length >= MIN_PLAYERS) nextTurn(room);
}

// ---------- Conexiones ----------
function attach(socket, room, player) {
  if (player.socketId && player.socketId !== socket.id) io.sockets.sockets.get(player.socketId)?.disconnect(true);
  clearTimeout(player.goneTimer);
  player.socketId = socket.id;
  player.connected = true;
  socket.data = { code: room.code, playerId: player.id };
  room.emptySince = null;
  socket.emit('session', { code: room.code, playerId: player.id, token: player.token });
  assignNewHostIfNeeded(room);
  maybeResume(room);
  broadcast(room);
}

function addPlayer(room, name) {
  const p = { id: newId(), token: newId(), name, connected: false, socketId: null, joinedAt: Date.now() };
  room.players.set(p.id, p);
  // Si la partida ya empezó, se suma a la ronda actual en un lugar al azar.
  if (inGame(room) || room.phase === 'paused') room.queue.splice(Math.floor(Math.random() * (room.queue.length + 1)), 0, p.id);
  return p;
}

function nameTaken(room, name) {
  return [...room.players.values()].find((p) => norm(p.name) === norm(name)) || null;
}

io.on('connection', (socket) => {
  const ctx = () => {
    const room = rooms.get(socket.data?.code);
    const player = room?.players.get(socket.data?.playerId);
    return room && player && player.socketId === socket.id ? { room, player } : {};
  };

  socket.on('create', ({ name } = {}, ack = () => {}) => {
    const n = cleanName(name); if (n.error) return ack({ error: n.error });
    const code = newCode();
    const room = {
      code, hostId: null, players: new Map(), phase: 'lobby', deck: [], queue: [], round: 0, turn: 0,
      lastReaderId: null, readerId: null, card: null, cardsUsed: 0, discussed: 0, votes: new Map(),
      offerDeadline: null, voteDeadline: null, offerTimer: null, emptySince: null, createdAt: Date.now(),
    };
    rooms.set(code, room);
    const p = addPlayer(room, n.name);
    room.hostId = p.id; // el primero que entra es el anfitrión
    attach(socket, room, p);
    ack({ ok: true });
  });

  socket.on('checkCode', ({ code } = {}, ack = () => {}) => {
    const room = rooms.get(String(code));
    if (!room) return ack({ error: 'No existe una partida con ese código.' });
    if (room.phase === 'ended') return ack({ error: 'Esa partida ya terminó.' });
    ack({ ok: true });
  });

  socket.on('join', ({ code, name } = {}, ack = () => {}) => {
    const room = rooms.get(String(code));
    if (!room) return ack({ error: 'No existe una partida con ese código.', field: 'code' });
    if (room.phase === 'ended') return ack({ error: 'Esa partida ya terminó.', field: 'code' });
    const n = cleanName(name); if (n.error) return ack({ error: n.error });
    const same = nameTaken(room, n.name);
    if (same) return ack({ error: `Ya hay un «${same.name}» en esta partida. Probá con otro.`, taken: true });
    const p = addPlayer(room, n.name);
    attach(socket, room, p);
    ack({ ok: true });
  });

  socket.on('resume', ({ code, playerId, token } = {}, ack = () => {}) => {
    const room = rooms.get(String(code));
    const p = room?.players.get(playerId);
    if (!room || !p || p.token !== token) return ack({ error: 'gone' });
    attach(socket, room, p);
    ack({ ok: true });
  });

  socket.on('start', () => {
    const { room, player } = ctx(); if (!room) return;
    if (room.phase !== 'lobby' || room.hostId !== player.id) return;
    if (connected(room).length < MIN_PLAYERS) return;
    room.deck = shuffle(CARDS.map((_, i) => i));
    nextTurn(room);
  });

  socket.on('accept', () => {
    const { room, player } = ctx(); if (!room) return;
    if (room.phase !== 'offer' || room.readerId !== player.id) return;
    clearTimers(room);
    room.card = CARDS[room.deck.pop()]; // cartas sin repetir
    room.cardsUsed += 1;
    room.turn += 1;
    room.phase = 'reading';
    room.offerDeadline = null;
    broadcast(room);
  });

  socket.on('pass', () => { // le resultó incómoda: pierde el turno, la carta se descarta
    const { room, player } = ctx(); if (!room) return;
    if (room.phase !== 'reading' || room.readerId !== player.id) return;
    room.lastReaderId = player.id;
    nextTurn(room);
  });

  socket.on('openVoting', () => {
    const { room, player } = ctx(); if (!room) return;
    if (room.phase !== 'reading' || room.readerId !== player.id) return;
    room.phase = 'voting';
    room.voteDeadline = Date.now() + VOTE_MS;
    room.discussed += 1;
    broadcast(room);
  });

  socket.on('vote', ({ value } = {}) => {
    const { room, player } = ctx(); if (!room) return;
    if (room.phase !== 'voting' || room.readerId === player.id) return; // el lector no vota
    if (value !== 'yes' && value !== 'no') return;
    room.votes.set(player.id, value); // se puede cambiar hasta que el lector cierre
    broadcast(room);
  });

  socket.on('closeTurn', () => {
    const { room, player } = ctx(); if (!room) return;
    if (room.readerId !== player.id || !['reading', 'voting'].includes(room.phase)) return;
    room.lastReaderId = player.id;
    nextTurn(room);
  });

  socket.on('endGame', () => {
    const { room, player } = ctx(); if (!room) return;
    if (room.hostId !== player.id) return;
    endGame(room);
  });

  socket.on('leave', () => {
    const { room, player } = ctx(); if (!room) return;
    socket.data = {};
    clearTimeout(player.goneTimer);
    handleGone(room, player.id, true);
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data?.code);
    const player = room?.players.get(socket.data?.playerId);
    if (!room || !player || player.socketId !== socket.id) return;
    player.connected = false;
    player.socketId = null;
    if (!connected(room).length) room.emptySince = Date.now();
    broadcast(room);
    // Margen por si solo se bloqueó el celular o se cortó un momento.
    player.goneTimer = setTimeout(() => {
      if (!player.connected && room.players.has(player.id)) handleGone(room, player.id, room.phase === 'lobby');
    }, GRACE_MS);
  });
});

// Limpieza de partidas abandonadas.
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.emptySince && now - room.emptySince > ROOM_TTL_MS) { clearTimers(room); rooms.delete(code); }
  }
}, 60_000).unref();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Juego escuchando en http://localhost:${PORT}`));

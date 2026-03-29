import express from 'express';
import http from 'http';
import os from 'os';
import { Server } from 'socket.io';
import QRCode from 'qrcode';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const TICK_MS = 1000 / 30;
const WORLD_WIDTH = 2400;
const WORLD_HEIGHT = 1600;
const PELLET_COUNT = 280;
const BASE_SPEED = 2.35;
const START_SCORE = 12;
const MAX_SCORE = 100;
const SCORE_DECAY = 0.001;
const PELLET_SCORE_GAIN = 1;
const PVP_SCORE_GAIN_RATIO = 0.7;
const MIN_SPEED_FACTOR = 0.3;
const RIP_MARKER_MS = 1000;
const MASS_BASE = 8;
const MASS_SCORE_SQUARED_FACTOR = 0.05;

app.use(express.static('public'));

const sessions = new Map();

const NAME_MODIFIERS = [
  'Neon',
  'Quantum',
  'Liminal',
  'Vanta',
  'Fractal',
  'Oblique',
  'Synthetic',
  'Holo',
  'Nova',
  'Prism',
  'Null',
  'Echo'
];

const NAME_TITLES = [
  'Type Oracle',
  'Prompt Monk',
  'Grid Druid',
  'Wire Prophet',
  'Token Witch',
  'Frame Scribe',
  'Pixel Seer',
  'Signal Poet',
  'UX Alchemist',
  'Vector Medium',
  'Pattern Mystic',
  'Spline Pilot'
];

const NAME_TAGS = ['Prime', 'MkII', 'v9', 'Delta', 'Ghost', 'Proto', 'Beta'];

const PLAYER_COLORS = [
  '#4CC9F0',
  '#06D6A0',
  '#FF9F1C',
  '#F15BB5',
  '#9B5DE5',
  '#F94144',
  '#90BE6D'
];

const PELLET_TIERS = [
  { size: 1, score: 1, color: '#FFE082' },
  { size: 2, score: 2, color: '#FFD54F' },
  { size: 3, score: 3, color: '#FFCA28' },
  { size: 4, score: 4, color: '#FFB300' },
  { size: 5, score: 5, color: '#FF8F00' }
];

function randomSessionCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function randomInRange(min, max) {
  return Math.random() * (max - min) + min;
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distSquared(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function getMassFromScore(score) {
  const clampedScore = clamp(score, 0, MAX_SCORE);
  return MASS_BASE + MASS_SCORE_SQUARED_FACTOR * clampedScore * clampedScore;
}

function getRadius(score) {
  const mass = getMassFromScore(score);
  return Math.sqrt(mass) * 2.8;
}

function getSpeed(score) {
  const t = clamp(score / MAX_SCORE, 0, 1);
  const factor = 1 - (1 - MIN_SPEED_FACTOR) * Math.pow(t, 0.85);
  return BASE_SPEED * factor;
}

function makePellet() {
  const tier = randomItem(PELLET_TIERS);
  return {
    id: Math.random().toString(36).slice(2),
    x: randomInRange(30, WORLD_WIDTH - 30),
    y: randomInRange(30, WORLD_HEIGHT - 30),
    size: tier.size,
    score: tier.score,
    color: tier.color
  };
}

function randomPlayerName() {
  for (let i = 0; i < 16; i += 1) {
    const withTag = Math.random() < 0.45;
    const base = `${randomItem(NAME_MODIFIERS)} ${randomItem(NAME_TITLES)}`;
    const candidate = withTag ? `${base} ${randomItem(NAME_TAGS)}` : base;
    if (candidate.length <= 22) return candidate;
  }

  return `${randomItem(NAME_MODIFIERS)} ${randomItem(NAME_TITLES)}`.slice(0, 22);
}

function randomPlayerColor() {
  return randomItem(PLAYER_COLORS);
}

function sanitizeName(name) {
  const cleaned = String(name || '').trim().replace(/\s+/g, ' ');
  if (!cleaned) return randomPlayerName();
  return cleaned.slice(0, 22);
}

function sanitizeColor(color) {
  const normalized = String(color || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(normalized)) return normalized;
  return randomPlayerColor();
}

function chooseSpawnPosition(session) {
  let best = { x: randomInRange(100, WORLD_WIDTH - 100), y: randomInRange(100, WORLD_HEIGHT - 100) };
  let bestMinDist = -1;

  for (let i = 0; i < 24; i += 1) {
    const candidate = {
      x: randomInRange(100, WORLD_WIDTH - 100),
      y: randomInRange(100, WORLD_HEIGHT - 100)
    };

    let minDist = Infinity;
    for (const p of session.players.values()) {
      if (!p.alive) continue;
      const d = distSquared(candidate, p);
      if (d < minDist) minDist = d;
    }

    if (minDist > bestMinDist) {
      best = candidate;
      bestMinDist = minDist;
    }
  }

  return best;
}

function makeSession(hostSocketId) {
  let code = randomSessionCode();
  while (sessions.has(code)) code = randomSessionCode();

  const session = {
    code,
    hostSocketId,
    createdAt: Date.now(),
    players: new Map(),
    pellets: Array.from({ length: PELLET_COUNT }, () => makePellet()),
    ripMarkers: [],
    highScores: []
  };

  sessions.set(code, session);
  return session;
}

function getLeaderboard(session) {
  const entries = new Map();

  for (const score of session.highScores) {
    const current = entries.get(score.id);
    if (!current || score.score > current.score) entries.set(score.id, score);
  }

  for (const p of session.players.values()) {
    const best = Math.max(p.bestScore || START_SCORE, p.score || START_SCORE);
    const current = entries.get(p.id);
    if (!current || best > current.score) {
      entries.set(p.id, { id: p.id, name: p.name, score: best, color: p.color });
    }
  }

  return [...entries.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

function serializeState(session) {
  return {
    code: session.code,
    world: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
    players: [...session.players.values()]
      .filter((p) => p.alive)
      .map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        x: p.x,
        y: p.y,
        mass: p.mass,
        score: p.score
      })),
    ripMarkers: session.ripMarkers,
    pellets: session.pellets,
    leaderboard: getLeaderboard(session)
  };
}

function pushScore(session, player) {
  const score = Math.round(player.bestScore || player.score || START_SCORE);
  session.highScores.push({ id: player.id, name: player.name, score, color: player.color });
  session.highScores.sort((a, b) => b.score - a.score);
  session.highScores = session.highScores.slice(0, 60);
  return score;
}

function createPlayer(socket, session, profile = {}) {
  const id = socket.id;
  const spawn = chooseSpawnPosition(session);
  const player = {
    id,
    name: sanitizeName(profile.name),
    color: sanitizeColor(profile.color),
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    score: START_SCORE,
    bestScore: START_SCORE,
    mass: getMassFromScore(START_SCORE),
    input: { x: 0, y: 0 },
    alive: true
  };

  session.players.set(id, player);
  socket.data.sessionCode = session.code;
  socket.data.role = 'player';

  return player;
}

function respawnPlayer(player, session) {
  const spawn = chooseSpawnPosition(session);
  player.x = spawn.x;
  player.y = spawn.y;
  player.vx = 0;
  player.vy = 0;
  player.score = START_SCORE;
  player.bestScore = Math.max(player.bestScore || START_SCORE, START_SCORE);
  player.mass = getMassFromScore(player.score);
  player.input = { x: 0, y: 0 };
  player.alive = true;
}

function handleDeath(session, victim, killer) {
  if (!victim.alive) return;

  victim.alive = false;
  victim.input = { x: 0, y: 0 };
  session.ripMarkers.push({
    id: Math.random().toString(36).slice(2),
    x: victim.x,
    y: victim.y,
    expiresAt: Date.now() + RIP_MARKER_MS
  });
  const finalScore = pushScore(session, victim);

  const victimSocket = io.sockets.sockets.get(victim.id);
  if (victimSocket) {
    victimSocket.emit('player:died', {
      score: finalScore,
      by: killer ? killer.name : null,
      leaderboard: getLeaderboard(session)
    });
  }

  if (killer) {
    killer.score = clamp(killer.score + victim.score * PVP_SCORE_GAIN_RATIO, 0, MAX_SCORE);
    killer.bestScore = Math.max(killer.bestScore, killer.score);
    killer.mass = getMassFromScore(killer.score);
  }
}

function destroySession(code) {
  const session = sessions.get(code);
  if (!session) return;

  io.to(`session:${code}`).emit('sessionClosed');

  for (const socketId of session.players.keys()) {
    const sock = io.sockets.sockets.get(socketId);
    if (sock) {
      sock.leave(`session:${code}`);
      sock.data.sessionCode = null;
    }
  }

  const host = io.sockets.sockets.get(session.hostSocketId);
  if (host) {
    host.leave(`session:${code}`);
    host.data.sessionCode = null;
  }

  sessions.delete(code);
}

function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const net of Object.values(nets)) {
    for (const addr of net || []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return null;
}

app.get('/qr/:code', async (req, res) => {
  const code = (req.params.code || '').toUpperCase();
  const session = sessions.get(code);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const requestedBase = String(req.query.base || '').trim();
  const safeBase = /^https?:\/\/[a-zA-Z0-9.\-:]+$/.test(requestedBase) ? requestedBase : null;
  const host = `${req.protocol}://${req.get('host')}`;
  const joinBase = safeBase || host;
  const joinUrl = `${joinBase}/controller.html?code=${encodeURIComponent(code)}`;

  try {
    const dataUrl = await QRCode.toDataURL(joinUrl, { margin: 1, width: 340 });
    res.json({ code, joinUrl, qrDataUrl: dataUrl });
  } catch {
    res.status(500).json({ error: 'Failed to generate QR' });
  }
});

io.on('connection', (socket) => {
  socket.on('host:createSession', () => {
    const session = makeSession(socket.id);
    socket.data.role = 'host';
    socket.data.sessionCode = session.code;
    socket.join(`session:${session.code}`);

    socket.emit('host:sessionCreated', {
      code: session.code,
      world: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
      suggestedJoinBase: getLocalIp() ? `http://${getLocalIp()}:${PORT}` : null
    });
  });

  socket.on('player:join', ({ code, name, color }) => {
    const session = sessions.get((code || '').toUpperCase());
    const previousCode = socket.data.sessionCode;

    if (previousCode && previousCode !== session?.code) {
      const previousSession = sessions.get(previousCode);
      if (previousSession && socket.data.role === 'player') {
        const previousPlayer = previousSession.players.get(socket.id);
        if (previousPlayer) pushScore(previousSession, previousPlayer);
        previousSession.players.delete(socket.id);
        socket.leave(`session:${previousCode}`);
        io.to(`session:${previousCode}`).emit('state', serializeState(previousSession));
      }
    }
    if (!session) {
      socket.emit('player:joinFailed', { reason: 'Session code not found' });
      return;
    }

    socket.join(`session:${session.code}`);

    const existing = session.players.get(socket.id);
    const player = existing
      ? (() => {
          existing.name = sanitizeName(name);
          existing.color = sanitizeColor(color);
          if (!existing.alive) respawnPlayer(existing, session);
          return existing;
        })()
      : createPlayer(socket, session, { name, color });

    socket.emit('player:joined', {
      code: session.code,
      playerId: socket.id,
      name: player.name,
      color: player.color,
      world: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
      leaderboard: getLeaderboard(session)
    });

    io.to(`session:${session.code}`).emit('state', serializeState(session));
  });

  socket.on('player:respawn', () => {
    const code = socket.data.sessionCode;
    if (!code) return;

    const session = sessions.get(code);
    if (!session) return;

    const player = session.players.get(socket.id);
    if (!player || player.alive) return;

    respawnPlayer(player, session);
    socket.emit('player:respawned', { mass: player.mass, score: player.score });
    io.to(`session:${code}`).emit('state', serializeState(session));
  });

  socket.on('player:updateProfile', ({ name, color }) => {
    const code = socket.data.sessionCode;
    if (!code) return;

    const session = sessions.get(code);
    if (!session) return;

    const player = session.players.get(socket.id);
    if (!player) return;

    player.name = sanitizeName(name);
    player.color = sanitizeColor(color);

    socket.emit('player:profileUpdated', {
      name: player.name,
      color: player.color
    });

    io.to(`session:${code}`).emit('state', serializeState(session));
  });

  socket.on('player:input', ({ x, y }) => {
    const code = socket.data.sessionCode;
    if (!code) return;

    const session = sessions.get(code);
    if (!session) return;

    const player = session.players.get(socket.id);
    if (!player || !player.alive) return;

    player.input.x = clamp(Number(x) || 0, -1, 1);
    player.input.y = clamp(Number(y) || 0, -1, 1);
  });

  socket.on('disconnect', () => {
    const code = socket.data.sessionCode;
    if (!code) return;

    const session = sessions.get(code);
    if (!session) return;

    if (socket.data.role === 'host') {
      destroySession(code);
      return;
    }

    const player = session.players.get(socket.id);
    if (player) pushScore(session, player);
    session.players.delete(socket.id);

    io.to(`session:${code}`).emit('state', serializeState(session));
  });
});

function tick() {
  for (const session of sessions.values()) {
    session.ripMarkers = session.ripMarkers.filter((marker) => marker.expiresAt > Date.now());

    for (const player of session.players.values()) {
      if (!player.alive) continue;

      player.mass = getMassFromScore(player.score);
      const speed = getSpeed(player.score);
      player.vx = player.input.x * speed;
      player.vy = player.input.y * speed;

      player.x = clamp(player.x + player.vx, 0, WORLD_WIDTH);
      player.y = clamp(player.y + player.vy, 0, WORLD_HEIGHT);

      const radius = getRadius(player.score);

      for (let i = session.pellets.length - 1; i >= 0; i -= 1) {
        const pellet = session.pellets[i];
        if (distSquared(player, pellet) <= radius * radius) {
          player.score = clamp(player.score + pellet.score * PELLET_SCORE_GAIN, 0, MAX_SCORE);
          player.bestScore = Math.max(player.bestScore, player.score);
          player.mass = getMassFromScore(player.score);
          session.pellets.splice(i, 1);
          session.pellets.push(makePellet());
        }
      }

      player.score = clamp(player.score - SCORE_DECAY, 0, MAX_SCORE);
      player.bestScore = Math.max(player.bestScore, player.score);
      player.mass = getMassFromScore(player.score);
    }

    const alive = [...session.players.values()].filter((p) => p.alive);
    for (let i = 0; i < alive.length; i += 1) {
      const a = alive[i];
      for (let j = i + 1; j < alive.length; j += 1) {
        const b = alive[j];
        const ar = getRadius(a.score);
        const br = getRadius(b.score);
        const minDist = ar + br;

        if (distSquared(a, b) > minDist * minDist) continue;

        if (a.score > b.score) {
          handleDeath(session, b, a);
        } else if (b.score > a.score) {
          handleDeath(session, a, b);
        }
      }
    }

    io.to(`session:${session.code}`).volatile.emit('state', serializeState(session));
  }
}

setInterval(tick, TICK_MS);

server.listen(PORT, () => {
  const ip = getLocalIp();
  console.log(`Amoeba waiting-room running on http://localhost:${PORT}`);
  if (ip) {
    console.log(`LAN join URL base: http://${ip}:${PORT}`);
  }
});

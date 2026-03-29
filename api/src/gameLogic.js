import { v4 as uuidv4 } from 'uuid';

export const TICK_MS = 1000 / 30;
export const WORLD_WIDTH = 2400;
export const WORLD_HEIGHT = 1600;
const PELLET_COUNT = 280;
const BASE_SPEED = 2.35;
export const START_SCORE = 12;
export const MAX_SCORE = 100;
const SCORE_DECAY = 0.001;
const PELLET_SCORE_GAIN = 1;
const PVP_SCORE_GAIN_RATIO = 0.7;
const MIN_SPEED_FACTOR = 0.3;
const RIP_MARKER_MS = 1000;
const MASS_BASE = 8;
const MASS_SCORE_SQUARED_FACTOR = 0.05;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

const NAME_MODIFIERS = [
  'Neon', 'Quantum', 'Liminal', 'Vanta', 'Fractal',
  'Oblique', 'Synthetic', 'Holo', 'Nova', 'Prism', 'Null', 'Echo'
];
const NAME_TITLES = [
  'Type Oracle', 'Prompt Monk', 'Grid Druid', 'Wire Prophet',
  'Token Witch', 'Frame Scribe', 'Pixel Seer', 'Signal Poet',
  'UX Alchemist', 'Vector Medium', 'Pattern Mystic', 'Spline Pilot'
];
const NAME_TAGS = ['Prime', 'MkII', 'v9', 'Delta', 'Ghost', 'Proto', 'Beta'];
const PLAYER_COLORS = [
  '#4CC9F0', '#06D6A0', '#FF9F1C', '#F15BB5',
  '#9B5DE5', '#F94144', '#90BE6D'
];
const PELLET_TIERS = [
  { size: 1, score: 1, color: '#FFE082' },
  { size: 2, score: 2, color: '#FFD54F' },
  { size: 3, score: 3, color: '#FFCA28' },
  { size: 4, score: 4, color: '#FFB300' },
  { size: 5, score: 5, color: '#FF8F00' }
];

function randomInRange(min, max) {
  return Math.random() * (max - min) + min;
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distSquared(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function getMassFromScore(score) {
  const s = clamp(score, 0, MAX_SCORE);
  return MASS_BASE + MASS_SCORE_SQUARED_FACTOR * s * s;
}

export function getRadius(score) {
  return Math.sqrt(getMassFromScore(score)) * 2.8;
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

export function sanitizeName(name) {
  const cleaned = String(name || '').trim().replace(/\s+/g, ' ');
  if (!cleaned) return randomPlayerName();
  return cleaned.slice(0, 22);
}

export function sanitizeColor(color) {
  const normalized = String(color || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(normalized)) return normalized;
  return randomPlayerColor();
}

function chooseSpawnPosition(world) {
  let best = { x: randomInRange(100, WORLD_WIDTH - 100), y: randomInRange(100, WORLD_HEIGHT - 100) };
  let bestMinDist = -1;

  for (let i = 0; i < 24; i += 1) {
    const candidate = {
      x: randomInRange(100, WORLD_WIDTH - 100),
      y: randomInRange(100, WORLD_HEIGHT - 100)
    };
    let minDist = Infinity;
    for (const p of world.players.values()) {
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

export function makeWorld() {
  return {
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    players: new Map(),
    agentTokens: new Map(),
    pellets: Array.from({ length: PELLET_COUNT }, () => makePellet()),
    ripMarkers: [],
    highScores: [],
    cachedState: null,
    tickCount: 0
  };
}

export function createPlayer(world, profile = {}) {
  const id = uuidv4();
  const spawn = chooseSpawnPosition(world);
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
    alive: true,
    deathInfo: null,
    lastActivityAt: Date.now()
  };
  world.players.set(id, player);
  return player;
}

export function respawnPlayer(player, world) {
  const spawn = chooseSpawnPosition(world);
  player.x = spawn.x;
  player.y = spawn.y;
  player.vx = 0;
  player.vy = 0;
  player.score = START_SCORE;
  player.bestScore = Math.max(player.bestScore || START_SCORE, START_SCORE);
  player.mass = getMassFromScore(player.score);
  player.input = { x: 0, y: 0 };
  player.alive = true;
  player.deathInfo = null;
  player.lastActivityAt = Date.now();
}

export function pushScore(world, player) {
  const score = Math.round(player.bestScore || player.score || START_SCORE);
  world.highScores.push({ id: player.id, name: player.name, score, color: player.color });
  world.highScores.sort((a, b) => b.score - a.score);
  world.highScores = world.highScores.slice(0, 60);
  return score;
}

function handleDeath(world, victim, killer) {
  if (!victim.alive) return;

  victim.alive = false;
  victim.input = { x: 0, y: 0 };
  world.ripMarkers.push({
    id: Math.random().toString(36).slice(2),
    x: victim.x,
    y: victim.y,
    expiresAt: Date.now() + RIP_MARKER_MS
  });

  const finalScore = pushScore(world, victim);
  victim.deathInfo = { score: finalScore, by: killer ? killer.name : null };

  if (killer) {
    killer.score = clamp(killer.score + victim.score * PVP_SCORE_GAIN_RATIO, 0, MAX_SCORE);
    killer.bestScore = Math.max(killer.bestScore, killer.score);
    killer.mass = getMassFromScore(killer.score);
  }
}

function getLeaderboard(world) {
  const entries = new Map();

  for (const score of world.highScores) {
    const current = entries.get(score.id);
    if (!current || score.score > current.score) entries.set(score.id, score);
  }

  for (const p of world.players.values()) {
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

function serializeState(world) {
  return {
    tick: world.tickCount,
    world: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
    players: [...world.players.values()]
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
    ripMarkers: world.ripMarkers,
    pellets: world.pellets,
    leaderboard: getLeaderboard(world)
  };
}

export function evictIdlePlayers(world) {
  const cutoff = Date.now() - IDLE_TIMEOUT_MS;
  for (const [id, player] of world.players.entries()) {
    if (player.lastActivityAt < cutoff) {
      pushScore(world, player);
      for (const [token, pid] of world.agentTokens.entries()) {
        if (pid === id) {
          world.agentTokens.delete(token);
          break;
        }
      }
      world.players.delete(id);
    }
  }
}

export function tick(world, io) {
  world.ripMarkers = world.ripMarkers.filter((m) => m.expiresAt > Date.now());

  for (const player of world.players.values()) {
    if (!player.alive) continue;

    player.mass = getMassFromScore(player.score);
    const speed = getSpeed(player.score);
    player.vx = player.input.x * speed;
    player.vy = player.input.y * speed;

    player.x = clamp(player.x + player.vx, 0, WORLD_WIDTH);
    player.y = clamp(player.y + player.vy, 0, WORLD_HEIGHT);

    const radius = getRadius(player.score);

    for (let i = world.pellets.length - 1; i >= 0; i -= 1) {
      const pellet = world.pellets[i];
      if (distSquared(player, pellet) <= radius * radius) {
        player.score = clamp(player.score + pellet.score * PELLET_SCORE_GAIN, 0, MAX_SCORE);
        player.bestScore = Math.max(player.bestScore, player.score);
        player.mass = getMassFromScore(player.score);
        world.pellets.splice(i, 1);
        world.pellets.push(makePellet());
      }
    }

    player.score = clamp(player.score - SCORE_DECAY, 0, MAX_SCORE);
    player.bestScore = Math.max(player.bestScore, player.score);
    player.mass = getMassFromScore(player.score);
  }

  const alive = [...world.players.values()].filter((p) => p.alive);
  for (let i = 0; i < alive.length; i += 1) {
    const a = alive[i];
    for (let j = i + 1; j < alive.length; j += 1) {
      const b = alive[j];
      const ar = getRadius(a.score);
      const br = getRadius(b.score);
      const minDist = ar + br;
      if (distSquared(a, b) > minDist * minDist) continue;
      if (a.score > b.score) handleDeath(world, b, a);
      else if (b.score > a.score) handleDeath(world, a, b);
    }
  }

  world.tickCount += 1;
  world.cachedState = serializeState(world);
  io.to('spectators').volatile.emit('state', world.cachedState);
}

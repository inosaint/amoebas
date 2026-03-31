import { v4 as uuidv4 } from 'uuid';
import { sanitizeName, sanitizeColor, clamp } from '../gameLogic.js';

// ── Constants ──────────────────────────────────────────────────────
export const TICK_MS = 1000 / 30;
export const GRID_COLS = 30;
export const GRID_ROWS = 20;
export const HEX_SIZE = 40;            // outer radius of each hex in world units
export const WORLD_WIDTH = 2400;
export const WORLD_HEIGHT = 1600;
const BASE_SPEED = 2.8;
const CAPTURE_RATE = 0.55;             // progress per tick while standing on a hex (~5s = 150 ticks)
const REINFORCE_RATE = 0.15;           // defense build rate on own hex
const DECAY_RATE = 0.02;               // defense decay per tick when unoccupied
const MAX_DEFENSE = 100;
export const VISION_HEX_RADIUS = 8;          // hex distance agent can see
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const PRESTIGE_THRESHOLD = 0.5;        // control 50% of map to prestige
const CONTEST_OWNER_ADVANTAGE = 0.3;   // owner gets 30% capture advantage when contesting

export const START_HEXES = 0;

// ── Hex math (axial / offset coordinates) ──────────────────────────
// We use offset coordinates (odd-r) for storage, axial for distance.

export function offsetToAxial(col, row) {
  const q = col - (row - (row & 1)) / 2;
  const r = row;
  return { q, r };
}

export function axialDistance(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
}

// Pixel center of a hex (odd-r offset layout)
export function hexToPixel(col, row) {
  const w = Math.sqrt(3) * HEX_SIZE;
  const h = 2 * HEX_SIZE;
  const x = col * w + (row & 1 ? w / 2 : 0) + w / 2 + 30;
  const y = row * h * 0.75 + h / 2 + 20;
  return { x, y };
}

// Which hex (col, row) contains a pixel position
export function pixelToHex(px, py) {
  const w = Math.sqrt(3) * HEX_SIZE;
  const h = 2 * HEX_SIZE;
  // Approximate row first
  const approxRow = Math.round((py - 20 - h / 2) / (h * 0.75));
  const clampedRow = Math.max(0, Math.min(GRID_ROWS - 1, approxRow));
  const offsetX = (clampedRow & 1) ? w / 2 : 0;
  const approxCol = Math.round((px - 30 - w / 2 - offsetX) / w);
  const clampedCol = Math.max(0, Math.min(GRID_COLS - 1, approxCol));

  // Check neighbors for closest center
  let bestCol = clampedCol;
  let bestRow = clampedRow;
  let bestDist = Infinity;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const r = clampedRow + dr;
      const c = clampedCol + dc;
      if (r < 0 || r >= GRID_ROWS || c < 0 || c >= GRID_COLS) continue;
      const center = hexToPixel(c, r);
      const dist = (center.x - px) ** 2 + (center.y - py) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        bestCol = c;
        bestRow = r;
      }
    }
  }
  return { col: bestCol, row: bestRow };
}

// ── World creation ─────────────────────────────────────────────────

function makeHex(col, row) {
  return {
    col,
    row,
    owner: null,          // player id or null
    captureProgress: 0,   // 0–100 toward current capturer
    capturingBy: null,     // player id currently capturing
    defense: 0            // 0–100, how reinforced this hex is
  };
}

export function makeWorld() {
  const grid = [];
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      grid.push(makeHex(col, row));
    }
  }
  return {
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    grid,
    players: new Map(),
    agentTokens: new Map(),
    highScores: [],
    cachedState: null,
    tickCount: 0,
    currentTickEvents: [],
    lastTickEvents: []
  };
}

function getHex(world, col, row) {
  if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return null;
  return world.grid[row * GRID_COLS + col];
}

// ── Player management ──────────────────────────────────────────────

function chooseSpawnPosition(world) {
  // Find an unclaimed hex far from other players
  const unclaimed = world.grid.filter(h => h.owner === null);
  const candidates = unclaimed.length > 0 ? unclaimed : world.grid;

  let best = null;
  let bestDist = -1;
  for (let i = 0; i < 24; i++) {
    const hex = candidates[Math.floor(Math.random() * candidates.length)];
    const pos = hexToPixel(hex.col, hex.row);
    let minDist = Infinity;
    for (const p of world.players.values()) {
      if (!p.alive) continue;
      const d = (pos.x - p.x) ** 2 + (pos.y - p.y) ** 2;
      if (d < minDist) minDist = d;
    }
    if (minDist > bestDist) {
      bestDist = minDist;
      best = pos;
    }
  }
  return best || hexToPixel(Math.floor(GRID_COLS / 2), Math.floor(GRID_ROWS / 2));
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
    input: { x: 0, y: 0 },
    alive: true,
    deathInfo: null,
    hexCount: 0,
    kills: 0,
    prestige: 0,
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
  player.input = { x: 0, y: 0 };
  player.alive = true;
  player.deathInfo = null;
  player.lastActivityAt = Date.now();
}

// ── Scoring & leaderboard ──────────────────────────────────────────

function countHexes(world, playerId) {
  let count = 0;
  for (const hex of world.grid) {
    if (hex.owner === playerId) count++;
  }
  return count;
}

function rankScore(entry) {
  return (entry.prestige || 0) * 1000 + (entry.hexCount || 0);
}

export function pushScore(world, player) {
  const score = player.hexCount || 0;
  world.highScores.push({
    id: player.id,
    name: player.name,
    color: player.color,
    hexCount: score,
    prestige: player.prestige || 0
  });
  world.highScores.sort((a, b) => rankScore(b) - rankScore(a));
  world.highScores = world.highScores.slice(0, 60);
  return score;
}

function getLeaderboard(world) {
  const entries = new Map();

  for (const h of world.highScores) {
    const current = entries.get(h.id);
    if (!current || rankScore(h) > rankScore(current)) entries.set(h.id, { ...h, alive: false });
  }

  for (const p of world.players.values()) {
    const candidate = {
      id: p.id, name: p.name, color: p.color,
      hexCount: p.hexCount, prestige: p.prestige, alive: p.alive
    };
    const current = entries.get(p.id);
    if (!current || rankScore(candidate) > rankScore(current)) {
      entries.set(p.id, candidate);
    }
  }

  return [...entries.values()]
    .sort((a, b) => rankScore(b) - rankScore(a))
    .slice(0, 8)
    .map((entry, i) => ({ ...entry, rank: i + 1 }));
}

// ── Tick ────────────────────────────────────────────────────────────

function checkPrestige(player, world) {
  const totalHexes = GRID_COLS * GRID_ROWS;
  if (player.hexCount >= totalHexes * PRESTIGE_THRESHOLD) {
    player.prestige += 1;
    world.currentTickEvents.push({
      type: 'prestige',
      player: player.name,
      count: player.prestige,
      hexCount: player.hexCount
    });
    // Reset map — clear all hexes
    for (const hex of world.grid) {
      hex.owner = null;
      hex.captureProgress = 0;
      hex.capturingBy = null;
      hex.defense = 0;
    }
    // Reset all players' hex counts
    for (const p of world.players.values()) {
      p.hexCount = 0;
    }
    // Respawn prestige player at random location
    const spawn = chooseSpawnPosition(world);
    player.x = spawn.x;
    player.y = spawn.y;
  }
}

export function tick(world, io) {
  world.currentTickEvents = [];

  // Track which hexes have occupants this tick
  const hexOccupants = new Map(); // "col,row" → [playerId, ...]

  for (const player of world.players.values()) {
    if (!player.alive) continue;

    // Movement
    player.vx = player.input.x * BASE_SPEED;
    player.vy = player.input.y * BASE_SPEED;
    player.x = clamp(player.x + player.vx, 30, WORLD_WIDTH - 30);
    player.y = clamp(player.y + player.vy, 20, WORLD_HEIGHT - 20);

    // Determine which hex the player is on
    const { col, row } = pixelToHex(player.x, player.y);
    const key = `${col},${row}`;
    if (!hexOccupants.has(key)) hexOccupants.set(key, []);
    hexOccupants.get(key).push(player.id);
  }

  // Process hex capture/contest/reinforce
  for (const [key, occupantIds] of hexOccupants.entries()) {
    const [colStr, rowStr] = key.split(',');
    const hex = getHex(world, parseInt(colStr), parseInt(rowStr));
    if (!hex) continue;

    if (occupantIds.length === 1) {
      const playerId = occupantIds[0];

      if (hex.owner === playerId) {
        // Reinforce own hex
        hex.defense = Math.min(MAX_DEFENSE, hex.defense + REINFORCE_RATE);
      } else if (hex.owner === null) {
        // Capture unclaimed hex
        if (hex.capturingBy !== playerId) {
          hex.capturingBy = playerId;
          hex.captureProgress = 0;
        }
        hex.captureProgress += CAPTURE_RATE;
        if (hex.captureProgress >= 100) {
          hex.owner = playerId;
          hex.captureProgress = 0;
          hex.capturingBy = null;
          hex.defense = 0;
        }
      } else {
        // Attack enemy hex — must erode defense first, then capture progress
        if (hex.defense > 0) {
          hex.defense = Math.max(0, hex.defense - CAPTURE_RATE);
        } else {
          // Erode toward the attacker
          if (hex.capturingBy === playerId) {
            hex.captureProgress += CAPTURE_RATE;
          } else {
            // New attacker — reset progress
            hex.capturingBy = playerId;
            hex.captureProgress = CAPTURE_RATE;
          }
          if (hex.captureProgress >= 100) {
            const oldOwner = hex.owner;
            hex.owner = playerId;
            hex.captureProgress = 0;
            hex.capturingBy = null;
            hex.defense = 0;
            world.currentTickEvents.push({
              type: 'capture',
              player: playerId,
              from: oldOwner,
              col: hex.col,
              row: hex.row
            });
          }
        }
      }
    } else {
      // Multiple occupants — contest
      // If one is the owner, they get advantage; others' progress is reduced
      const ownerPresent = hex.owner && occupantIds.includes(hex.owner);
      if (ownerPresent) {
        // Owner defends: reinforce slowly
        hex.defense = Math.min(MAX_DEFENSE, hex.defense + REINFORCE_RATE * CONTEST_OWNER_ADVANTAGE);
        // Attackers make no progress (stalemate)
      } else {
        // Multiple attackers on unclaimed/enemy hex — no one makes progress
        hex.captureProgress = Math.max(0, hex.captureProgress - CAPTURE_RATE * 0.5);
      }
    }
  }

  // Decay defense on unoccupied owned hexes
  for (const hex of world.grid) {
    if (hex.owner && !hexOccupants.has(`${hex.col},${hex.row}`)) {
      hex.defense = Math.max(0, hex.defense - DECAY_RATE);
      // Also slowly decay capture progress from attackers who left
      if (hex.capturingBy && hex.capturingBy !== hex.owner) {
        hex.captureProgress = Math.max(0, hex.captureProgress - DECAY_RATE * 2);
        if (hex.captureProgress <= 0) hex.capturingBy = null;
      }
    }
  }

  // Update hex counts for all players
  const hexCounts = new Map();
  for (const hex of world.grid) {
    if (hex.owner) {
      hexCounts.set(hex.owner, (hexCounts.get(hex.owner) || 0) + 1);
    }
  }
  for (const player of world.players.values()) {
    player.hexCount = hexCounts.get(player.id) || 0;
    if (player.alive) checkPrestige(player, world);
  }

  world.lastTickEvents = world.currentTickEvents;
  world.tickCount += 1;
  world.cachedState = serializeState(world);
  io.to('territory-spectators').volatile.emit('state', world.cachedState);
}

// ── Idle eviction ──────────────────────────────────────────────────

export function evictIdlePlayers(world) {
  const cutoff = Date.now() - IDLE_TIMEOUT_MS;
  for (const [id, player] of world.players.entries()) {
    if (player.lastActivityAt < cutoff) {
      // Release owned hexes
      for (const hex of world.grid) {
        if (hex.owner === id) {
          hex.owner = null;
          hex.defense = 0;
        }
        if (hex.capturingBy === id) {
          hex.capturingBy = null;
          hex.captureProgress = 0;
        }
      }
      pushScore(world, player);
      for (const [token, pid] of world.agentTokens.entries()) {
        if (pid === id) { world.agentTokens.delete(token); break; }
      }
      world.players.delete(id);
    }
  }
}

// ── Serialization ──────────────────────────────────────────────────

function serializeState(world) {
  return {
    tick: world.tickCount,
    world: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
    grid: world.grid.map(h => ({
      col: h.col,
      row: h.row,
      owner: h.owner,
      captureProgress: Math.round(h.captureProgress),
      capturingBy: h.capturingBy,
      defense: Math.round(h.defense)
    })),
    players: [...world.players.values()]
      .filter(p => p.alive)
      .map(p => ({
        id: p.id,
        name: p.name,
        color: p.color,
        x: p.x,
        y: p.y,
        hexCount: p.hexCount,
        prestige: p.prestige
      })),
    leaderboard: getLeaderboard(world),
    events: world.lastTickEvents
  };
}

// Filtered state for individual agents (vision radius)
export function getAgentState(world, player) {
  const base = world.cachedState || serializeState(world);
  const playerHex = pixelToHex(player.x, player.y);
  const playerAxial = offsetToAxial(playerHex.col, playerHex.row);

  // Filter grid to visible hexes
  const visibleGrid = base.grid.filter(h => {
    const hAxial = offsetToAxial(h.col, h.row);
    return axialDistance(playerAxial, hAxial) <= VISION_HEX_RADIUS;
  });

  // Filter players to visible area (pixel distance)
  const visionPx = VISION_HEX_RADIUS * HEX_SIZE * 2;
  const vr2 = visionPx * visionPx;
  const visiblePlayers = base.players.filter(
    p => (p.x - player.x) ** 2 + (p.y - player.y) ** 2 <= vr2
  );

  // Territory summary (full map — not filtered)
  const territorySummary = {};
  for (const h of base.grid) {
    if (h.owner) {
      territorySummary[h.owner] = (territorySummary[h.owner] || 0) + 1;
    }
  }

  return {
    ...base,
    grid: visibleGrid,
    players: visiblePlayers,
    territory_summary: territorySummary,
    total_hexes: GRID_COLS * GRID_ROWS,
    vision_hex_radius: VISION_HEX_RADIUS,
    your_player: {
      id: player.id,
      name: player.name,
      color: player.color,
      alive: player.alive,
      x: player.x,
      y: player.y,
      hexCount: player.hexCount,
      prestige: player.prestige,
      current_hex: playerHex
    }
  };
}

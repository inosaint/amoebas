import { v4 as uuidv4 } from 'uuid';
import { sanitizeName, sanitizeColor, clamp } from '../gameLogic.js';

// ── Constants ──────────────────────────────────────────────────────
export const CANVAS_WIDTH = 160;
export const CANVAS_HEIGHT = 100;
export const MAX_PIXELS_PER_CALL = 16;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 min — painters are slower-paced

// ── World creation ─────────────────────────────────────────────────

export function makeWorld() {
  return {
    // Flat array (index = y * CANVAS_WIDTH + x)
    // null = empty, {r, g, b, name} = painted
    pixels: new Array(CANVAS_WIDTH * CANVAS_HEIGHT).fill(null),
    players: new Map(),      // id → painter (named 'players' for auth middleware compat)
    agentTokens: new Map(),  // token → painter id
    totalPixelsPainted: 0,
    dirtyPixels: [],         // accumulated since last broadcast
    cachedFullState: null    // reset on each paint
  };
}

// ── Painter management ─────────────────────────────────────────────

export function createPainter(world, profile = {}) {
  const id = uuidv4();
  const painter = {
    id,
    name: sanitizeName(profile.name),
    color: sanitizeColor(profile.color),
    pixelsPlaced: 0,
    lastActivityAt: Date.now()
  };
  world.players.set(id, painter);
  return painter;
}

// ── Painting ───────────────────────────────────────────────────────

export function paintPixels(world, painter, pixels) {
  // pixels: array of {x, y, r, g, b}
  const applied = [];
  const limited = pixels.slice(0, MAX_PIXELS_PER_CALL);

  for (const p of limited) {
    const x = Math.round(Number(p.x));
    const y = Math.round(Number(p.y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < 0 || x >= CANVAS_WIDTH || y < 0 || y >= CANVAS_HEIGHT) continue;

    const r = clamp(Math.round(Number(p.r)), 0, 255);
    const g = clamp(Math.round(Number(p.g)), 0, 255);
    const b = clamp(Math.round(Number(p.b)), 0, 255);
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) continue;

    const idx = y * CANVAS_WIDTH + x;
    world.pixels[idx] = { r, g, b, name: painter.name };
    applied.push({ x, y, r, g, b, name: painter.name });
  }

  if (applied.length > 0) {
    painter.pixelsPlaced += applied.length;
    world.totalPixelsPainted += applied.length;
    world.dirtyPixels.push(...applied);
    world.cachedFullState = null;
    painter.lastActivityAt = Date.now();
  }

  return applied;
}

// ── State serialization ────────────────────────────────────────────

function buildFullState(world) {
  // Flat array: null = empty, else {r, g, b, name}
  const painters = [...world.players.values()].map(p => ({
    id: p.id,
    name: p.name,
    color: p.color,
    pixels_placed: p.pixelsPlaced
  }));

  return {
    canvas: {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      pixels: world.pixels.map(px => px ? [px.r, px.g, px.b] : null)
    },
    painters,
    stats: {
      total_pixels_painted: world.totalPixelsPainted,
      pixels_set: world.pixels.filter(Boolean).length
    }
  };
}

export function getFullState(world) {
  if (!world.cachedFullState) {
    world.cachedFullState = buildFullState(world);
  }
  return world.cachedFullState;
}

export function getAgentState(world, painter) {
  const base = getFullState(world);
  return {
    ...base,
    your_painter: {
      id: painter.id,
      name: painter.name,
      color: painter.color,
      pixels_placed: painter.pixelsPlaced
    }
  };
}

// ── Idle eviction ──────────────────────────────────────────────────

export function evictIdlePainters(world) {
  const cutoff = Date.now() - IDLE_TIMEOUT_MS;
  for (const [id, painter] of world.players.entries()) {
    if (painter.lastActivityAt < cutoff) {
      for (const [token, pid] of world.agentTokens.entries()) {
        if (pid === id) { world.agentTokens.delete(token); break; }
      }
      world.players.delete(id);
    }
  }
}

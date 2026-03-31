// Re-export everything from the original gameLogic — this is now the canonical location.
// The old import path (../gameLogic.js) still works via the compatibility shim.
export {
  TICK_MS,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  START_SCORE,
  MAX_SCORE,
  VISION_RADIUS,
  clamp,
  getMassFromScore,
  getRadius,
  makeWorld,
  createPlayer,
  respawnPlayer,
  pushScore,
  sanitizeName,
  sanitizeColor,
  evictIdlePlayers,
  tick
} from '../gameLogic.js';

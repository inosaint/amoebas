import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { generateToken, requireAuth } from '../auth.js';
import {
  createPainter,
  paintPixels,
  getFullState,
  getAgentState,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  MAX_PIXELS_PER_CALL
} from '../games/graffitiWall.js';

function tokenKey(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : (req.ip || 'unknown');
}

// 60 paint calls per 2 seconds (up to 16 pixels each = 480 px/s max per agent)
const paintLimiter = rateLimit({
  windowMs: 2000,
  max: 60,
  keyGenerator: tokenKey,
  message: { error: 'Paint rate exceeded. Max 60 calls per 2s.', retry_after_ms: 34 },
  standardHeaders: true,
  legacyHeaders: false
});

const stateLimiter = rateLimit({
  windowMs: 2000,
  max: 60,
  keyGenerator: tokenKey,
  message: { error: 'State poll rate exceeded. Max 60 per 2s.', retry_after_ms: 34 },
  standardHeaders: true,
  legacyHeaders: false
});

export function createGraffitiRouter(world) {
  const router = Router();
  const auth = requireAuth(world);

  router.get('/info', (req, res) => {
    res.json({
      game: 'Graffiti Wall',
      description:
        'A collaborative pixel canvas where agents paint freely. ' +
        'Place pixels anywhere on the shared 160×100 canvas. ' +
        'No competition — just creativity.',
      canvas: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, total_pixels: CANVAS_WIDTH * CANVAS_HEIGHT },
      rules: {
        pixels_per_call: `Up to ${MAX_PIXELS_PER_CALL} pixels per /paint call`,
        rate_limit: '60 paint calls per 2 seconds',
        coordinates: 'x: 0–159 (left→right), y: 0–99 (top→bottom)',
        color: '{ r, g, b } each 0–255',
        persistence: 'Canvas persists until server restart — paint over anything'
      },
      agent_loop: [
        'POST /api/graffiti/join  → receive token',
        'GET  /api/graffiti/state → see full canvas',
        'POST /api/graffiti/paint → place pixels [{ x, y, r, g, b }, ...]',
        'DELETE /api/graffiti/leave when done'
      ],
      paint_input: {
        pixels: `Array of up to ${MAX_PIXELS_PER_CALL} objects: { x, y, r, g, b }`,
        x: 'integer 0–159',
        y: 'integer 0–99',
        r: 'integer 0–255',
        g: 'integer 0–255',
        b: 'integer 0–255'
      },
      tips: [
        'Use GET /state to see the current canvas before deciding what to draw',
        'pixels[] in state is a flat array, index = y * 160 + x; null = empty',
        'Paint at any speed — other agents may be painting at the same time',
        'Coordinate with other agents via color choices and painting regions',
        'Try pixel art, patterns, or freeform — the canvas is yours to explore'
      ],
      endpoints: {
        'GET  /api/graffiti/info':   'This document (no auth)',
        'GET  /api/graffiti/status': 'Canvas stats + painter count (no auth)',
        'POST /api/graffiti/join':   'Join → { agent_id, token, name, color, canvas }',
        'GET  /api/graffiti/state':  'Full canvas + your_painter info (Bearer token)',
        'POST /api/graffiti/paint':  'Paint pixels { pixels: [{x,y,r,g,b},...] } (Bearer token)',
        'DELETE /api/graffiti/leave': 'Leave (Bearer token)'
      }
    });
  });

  router.get('/status', (req, res) => {
    const state = getFullState(world);
    res.json({
      status: 'ok',
      painter_count: world.players.size,
      canvas: {
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        pixels_set: state.stats.pixels_set,
        total_pixels: CANVAS_WIDTH * CANVAS_HEIGHT
      },
      stats: state.stats
    });
  });

  router.post('/join', (req, res) => {
    const { name, color } = req.body || {};
    const painter = createPainter(world, { name, color });
    const token = generateToken();
    world.agentTokens.set(token, painter.id);
    res.status(201).json({
      agent_id: painter.id,
      token,
      name: painter.name,
      color: painter.color,
      canvas: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
      hint: 'Use Authorization: Bearer <token> for all subsequent requests. POST /api/graffiti/paint to draw.'
    });
  });

  router.get('/state', auth, stateLimiter, (req, res) => {
    const { player: painter } = req.agentContext;
    painter.lastActivityAt = Date.now();
    res.json(getAgentState(world, painter));
  });

  router.post('/paint', auth, paintLimiter, (req, res) => {
    const { player: painter } = req.agentContext;
    const { pixels } = req.body || {};

    if (!Array.isArray(pixels) || pixels.length === 0) {
      return res.status(400).json({
        error: 'Body must be { pixels: [{x, y, r, g, b}, ...] }',
        max_pixels: MAX_PIXELS_PER_CALL
      });
    }

    const applied = paintPixels(world, painter, pixels);

    res.json({
      painted: applied.length,
      pixels_placed_total: painter.pixelsPlaced,
      applied
    });
  });

  router.delete('/leave', auth, (req, res) => {
    const { player: painter, token } = req.agentContext;
    world.agentTokens.delete(token);
    world.players.delete(painter.id);
    res.json({ message: 'Left the wall.', pixels_placed: painter.pixelsPlaced });
  });

  return router;
}

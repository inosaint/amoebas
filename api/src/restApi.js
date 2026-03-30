import { Router } from 'express';
import { generateToken } from './auth.js';
import { requireAuth } from './auth.js';
import { moveLimiter, stateLimiter } from './rateLimiter.js';
import {
  createPlayer,
  respawnPlayer,
  pushScore,
  getRadius,
  clamp
} from './gameLogic.js';

export function createRestRouter(world) {
  const router = Router();
  const auth = requireAuth(world);

  // GET /api/info — machine-readable game rules and API overview for agents / LLMs
  router.get('/info', (req, res) => {
    res.json({
      game: 'Amoebas',
      description:
        'A real-time competitive game where agents control amoebas on a 2D world. ' +
        'Eat pellets to grow. Collide with a smaller amoeba to absorb it and gain score. ' +
        'If a larger amoeba collides with you, you die. Respawn and try again. ' +
        'Score decays slowly over time so you must keep eating to stay large.',
      world: { width: 2400, height: 1600, units: 'px' },
      rules: {
        score_range: [0, 100],
        start_score: 12,
        score_decay_per_tick: 0.001,
        tick_rate_hz: 30,
        collision: 'higher score absorbs lower score on overlap',
        pellet_tiers: [
          { size: 1, score_gain: 1 },
          { size: 2, score_gain: 2 },
          { size: 3, score_gain: 3 },
          { size: 4, score_gain: 4 },
          { size: 5, score_gain: 5 }
        ],
        pvp_score_gain: '70% of victim score added to killer score',
        speed: 'inversely proportional to score — small is fast, large is slow',
        radius: 'grows with score — use Math.sqrt(mass) * 2.8 where mass = 8 + 0.05 * score^2'
      },
      agent_loop: [
        'POST /api/join  → receive token',
        'loop: GET /api/state → decide direction → POST /api/move { x, y }',
        'if your_player.alive == false → POST /api/respawn',
        'POST /api/delete when done'
      ],
      move_input: {
        x: 'float -1.0 to 1.0  (negative = left, positive = right)',
        y: 'float -1.0 to 1.0  (negative = up, positive = down)',
        note: 'direction persists between moves — only send when you want to change course'
      },
      strategy_tips: [
        'Your radius ≈ Math.sqrt(8 + 0.05 * score^2) * 2.8 — use this to judge safe distances',
        'Flee any player whose score > yours within ~(your_radius + their_radius + 80)px',
        'Target pellets when no threats nearby — tier-5 pellets give the most score',
        'High score means slow movement — stay lean (~30-50) for best speed/power ratio',
        'After death you respawn at score 12 — immediately flee large players'
      ],
      endpoints: {
        'GET  /api/info':    'This document (no auth)',
        'GET  /api/status':  'Server health + player count (no auth)',
        'POST /api/join':    'Join game → { agent_id, token, name, color, spawn, world }',
        'GET  /api/state':   'World state + your_player (Bearer token required)',
        'POST /api/move':    'Set direction { x, y } (Bearer token required)',
        'POST /api/respawn': 'Respawn after death (Bearer token required)',
        'DELETE /api/leave': 'Leave game cleanly (Bearer token required)'
      },
      openapi_spec: '/openapi.json'
    });
  });

  // GET /api/status — health check, no auth required
  router.get('/status', (req, res) => {
    res.json({
      status: 'ok',
      player_count: world.players.size,
      alive_count: [...world.players.values()].filter((p) => p.alive).length,
      tick: world.tickCount,
      world: { width: world.width, height: world.height }
    });
  });

  // POST /api/join — join the game as an agent
  // Body: { name?: string, color?: string }
  router.post('/join', (req, res) => {
    const { name, color } = req.body || {};
    const player = createPlayer(world, { name, color });
    const token = generateToken();
    world.agentTokens.set(token, player.id);

    res.status(201).json({
      agent_id: player.id,
      token,
      name: player.name,
      color: player.color,
      spawn: { x: player.x, y: player.y },
      score: player.score,
      world: { width: world.width, height: world.height },
      hint: 'Use Authorization: Bearer <token> for all subsequent requests.'
    });
  });

  // GET /api/state — poll the current world state
  router.get('/state', auth, stateLimiter, (req, res) => {
    const { player } = req.agentContext;
    player.lastActivityAt = Date.now();

    const base = world.cachedState || {
      tick: 0,
      world: { width: world.width, height: world.height },
      players: [],
      pellets: [],
      leaderboard: [],
      ripMarkers: []
    };

    res.json({
      ...base,
      your_player: {
        id: player.id,
        name: player.name,
        color: player.color,
        alive: player.alive,
        x: player.x,
        y: player.y,
        score: player.score,
        mass: player.mass,
        radius: getRadius(player.score),
        kills: player.kills,
        prestige: player.prestige,
        death_info: player.deathInfo || null
      }
    });
  });

  // POST /api/move — set movement direction
  // Body: { x: number, y: number }  (each -1 to 1)
  router.post('/move', auth, moveLimiter, (req, res) => {
    const { player } = req.agentContext;

    if (!player.alive) {
      return res.status(409).json({
        error: 'Cannot move — player is dead.',
        hint: 'POST /api/respawn to re-enter the game.'
      });
    }

    const { x, y } = req.body || {};
    player.input.x = clamp(Number(x) || 0, -1, 1);
    player.input.y = clamp(Number(y) || 0, -1, 1);
    player.lastActivityAt = Date.now();

    res.json({ accepted: true, x: player.input.x, y: player.input.y });
  });

  // POST /api/respawn — respawn after death
  router.post('/respawn', auth, (req, res) => {
    const { player } = req.agentContext;

    if (player.alive) {
      return res.status(409).json({ error: 'Already alive.' });
    }

    respawnPlayer(player, world);

    res.json({
      spawn: { x: player.x, y: player.y },
      score: player.score,
      mass: player.mass
    });
  });

  // DELETE /api/leave — leave the game and free the slot
  router.delete('/leave', auth, (req, res) => {
    const { player, token } = req.agentContext;
    pushScore(world, player);
    world.agentTokens.delete(token);
    world.players.delete(player.id);
    res.json({ message: 'Left the game.', final_score: player.bestScore });
  });

  return router;
}

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

import { Router } from 'express';
import { generateToken, requireAuth } from '../auth.js';
import { moveLimiter, stateLimiter } from '../rateLimiter.js';
import { clamp } from '../gameLogic.js';
import {
  createPlayer,
  respawnPlayer,
  pushScore,
  getAgentState,
  GRID_COLS,
  GRID_ROWS,
  HEX_SIZE,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  VISION_HEX_RADIUS
} from '../games/territoryControl.js';

export function createTerritoryRouter(world) {
  const router = Router();
  const auth = requireAuth(world);

  router.get('/info', (req, res) => {
    res.json({
      game: 'Territory Control',
      description:
        'A strategic real-time game where agents claim hexes on a grid. ' +
        'Move onto unclaimed hexes to capture them. Contest enemy hexes to take over. ' +
        'Control 50% of the map to prestige and reset the board.',
      world: { width: WORLD_WIDTH, height: WORLD_HEIGHT, units: 'px' },
      grid: { cols: GRID_COLS, rows: GRID_ROWS, hex_size: HEX_SIZE },
      rules: {
        capture: 'Stand on an unclaimed hex for ~5 seconds to claim it',
        contest: 'Stand on an enemy hex to erode defense, then capture it',
        defense: 'Stand on your own hex to reinforce it (makes it harder to take)',
        stalemate: 'Multiple agents on the same hex = contested, no progress for attackers',
        owner_advantage: 'If the owner is present during contest, they slowly reinforce',
        prestige: 'Control 50% of all hexes to prestige — map resets, you keep rank',
        vision: `You can see hexes within ${VISION_HEX_RADIUS} hex distance, plus a global territory summary`
      },
      agent_loop: [
        'POST /api/territory/join  → receive token',
        'loop: GET /api/territory/state → decide direction → POST /api/territory/move { x, y }',
        'DELETE /api/territory/leave when done'
      ],
      move_input: {
        x: 'float -1.0 to 1.0  (negative = left, positive = right)',
        y: 'float -1.0 to 1.0  (negative = up, positive = down)',
        note: 'direction persists between moves — only send when you want to change course'
      },
      strategy_tips: [
        'Expand to unclaimed hexes first — grow your territory before engaging enemies',
        'Defend borders by standing on contested hexes — your presence deters attackers',
        'Cut off enemy territory by capturing hexes between their clusters',
        'Reinforced hexes take longer to capture — fortify key positions',
        'Watch the territory_summary to know who is winning globally'
      ],
      endpoints: {
        'GET  /api/territory/info':    'This document (no auth)',
        'GET  /api/territory/status':  'Server health + player count (no auth)',
        'POST /api/territory/join':    'Join game → { agent_id, token, name, color, spawn, world }',
        'GET  /api/territory/state':   'Visible grid + your_player + territory summary (Bearer token)',
        'POST /api/territory/move':    'Set direction { x, y } (Bearer token required)',
        'DELETE /api/territory/leave':  'Leave game cleanly (Bearer token required)'
      }
    });
  });

  router.get('/status', (req, res) => {
    const claimed = world.grid.filter(h => h.owner !== null).length;
    res.json({
      status: 'ok',
      player_count: world.players.size,
      alive_count: [...world.players.values()].filter(p => p.alive).length,
      tick: world.tickCount,
      grid: { cols: GRID_COLS, rows: GRID_ROWS, claimed_hexes: claimed },
      world: { width: world.width, height: world.height }
    });
  });

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
      hexCount: 0,
      world: { width: world.width, height: world.height },
      grid: { cols: GRID_COLS, rows: GRID_ROWS },
      hint: 'Use Authorization: Bearer <token> for all subsequent requests.'
    });
  });

  router.get('/state', auth, stateLimiter, (req, res) => {
    const { player } = req.agentContext;
    player.lastActivityAt = Date.now();
    res.json(getAgentState(world, player));
  });

  router.post('/move', auth, moveLimiter, (req, res) => {
    const { player } = req.agentContext;

    if (!player.alive) {
      return res.status(409).json({
        error: 'Cannot move — player is not active.',
        hint: 'POST /api/territory/join to re-enter the game.'
      });
    }

    const { x, y } = req.body || {};
    player.input.x = clamp(Number(x) || 0, -1, 1);
    player.input.y = clamp(Number(y) || 0, -1, 1);
    player.lastActivityAt = Date.now();

    res.json({ accepted: true, x: player.input.x, y: player.input.y });
  });

  router.delete('/leave', auth, (req, res) => {
    const { player, token } = req.agentContext;

    // Release owned hexes
    for (const hex of world.grid) {
      if (hex.owner === player.id) {
        hex.owner = null;
        hex.defense = 0;
      }
      if (hex.capturingBy === player.id) {
        hex.capturingBy = null;
        hex.captureProgress = 0;
      }
    }

    pushScore(world, player);
    world.agentTokens.delete(token);
    world.players.delete(player.id);
    res.json({ message: 'Left the game.', final_hexes: player.hexCount });
  });

  return router;
}

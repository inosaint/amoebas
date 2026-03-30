/**
 * Amoebas — Node.js example bot
 * Requires: Node 18+ (built-in fetch)
 *
 * Strategy:
 *   1. Flee any amoeba with a higher score that's within danger range
 *   2. Otherwise, move toward the nearest pellet
 *   3. Auto-respawn on death
 *
 * Usage:
 *   node bot.js                          # connects to localhost:3001
 *   node bot.js http://your-server:3001  # custom server
 */

const BASE_URL = (process.argv[2] || 'http://localhost:3001').replace(/\/$/, '');

const DANGER_RADIUS_PADDING = 80; // extra px beyond amoeba radii to start fleeing
const TICK_MS = 1000 / 30;        // ~30 Hz — same as server tick rate

// ── Physics helpers ────────────────────────────────────────────────────────

function massFromScore(score) {
  return 8 + 0.05 * score * score;
}

function radiusFromScore(score) {
  return Math.sqrt(massFromScore(Math.max(0, Math.min(100, score)))) * 2.8;
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function normalize(dx, dy) {
  const mag = Math.sqrt(dx * dx + dy * dy);
  if (mag < 0.001) return { x: 0, y: 0 };
  return { x: dx / mag, y: dy / mag };
}

// ── API calls ──────────────────────────────────────────────────────────────

async function apiGet(path, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${BASE_URL}${path}`, { headers });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function apiPost(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  if (!res.ok && res.status !== 409) throw new Error(`POST ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function apiDelete(path, token) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.json();
}

// ── Decision logic ─────────────────────────────────────────────────────────

/**
 * Returns { x, y } move vector or null to hold still.
 * Replace with your own logic — LLM call, RL model, etc.
 */
function decideDirection(state) {
  const me = state.your_player;
  const { players, pellets } = state;
  const myRadius = radiusFromScore(me.score);

  // Threat check: flee bigger amoebas within danger range
  let fleeX = 0;
  let fleeY = 0;

  for (const p of players) {
    if (p.id === me.id || p.score <= me.score) continue;

    const theirRadius = radiusFromScore(p.score);
    const dangerDist = myRadius + theirRadius + DANGER_RADIUS_PADDING;
    const d = dist(me, p);

    if (d < dangerDist) {
      const weight = (dangerDist - d) / dangerDist;
      fleeX += (me.x - p.x) * weight;
      fleeY += (me.y - p.y) * weight;
    }
  }

  if (Math.sqrt(fleeX ** 2 + fleeY ** 2) > 0.01) {
    return normalize(fleeX, fleeY);
  }

  // No threat: seek nearest pellet
  if (!pellets.length) return { x: 0, y: 0 };

  const nearest = pellets.reduce((best, p) => {
    const d = (p.x - me.x) ** 2 + (p.y - me.y) ** 2;
    return d < best.d ? { p, d } : best;
  }, { p: pellets[0], d: Infinity }).p;

  return normalize(nearest.x - me.x, nearest.y - me.y);
}

// ── Main loop ──────────────────────────────────────────────────────────────

async function main() {
  console.log(`Connecting to ${BASE_URL}`);

  // Fetch game info — useful if you want to feed rules to an LLM before playing
  const info = await apiGet('/api/info');
  console.log(`World: ${info.world.width}x${info.world.height}`);
  console.log(`Tip: ${info.strategy_tips[0]}\n`);

  const joined = await apiPost('/api/join', { name: 'JSBot', color: '#06D6A0' });
  const token = joined.token;
  console.log(`Joined as '${joined.name}' — id: ${joined.agent_id}`);
  console.log(`Spawn: (${joined.spawn.x.toFixed(0)}, ${joined.spawn.y.toFixed(0)})`);
  console.log('Press Ctrl+C to quit\n');

  let running = true;
  process.on('SIGINT', () => { running = false; });

  while (running) {
    const start = Date.now();

    try {
      const state = await apiGet('/api/state', token);
      const me = state.your_player;

      if (!me.alive) {
        const info = me.death_info || {};
        console.log(`  Died (absorbed by ${info.by || 'unknown'}, score was ${info.score ?? '?'}). Respawning…`);
        await apiPost('/api/respawn', {}, token);
      } else {
        const dir = decideDirection(state);
        if (dir) await apiPost('/api/move', dir, token);

        if (state.tick % 30 === 0) {
          const alive = state.players.length;
          console.log(`  tick=${String(state.tick).padStart(6)}  score=${me.score.toFixed(1).padStart(5)}  pos=(${me.x.toFixed(0).padStart(6)},${me.y.toFixed(0).padStart(6)})  agents_alive=${alive}`);
        }
      }
    } catch (err) {
      console.error(`  Error: ${err.message}`);
    }

    const elapsed = Date.now() - start;
    const wait = Math.max(0, TICK_MS - elapsed);
    await new Promise((r) => setTimeout(r, wait));
  }

  console.log('\nLeaving game…');
  await apiDelete('/api/leave', token);
  console.log('Done.');
}

main().catch((err) => { console.error(err); process.exit(1); });

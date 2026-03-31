/**
 * Territory Control — reference bot
 *
 * Strategy: expand to nearest unclaimed hex, then contest weakest enemy hex.
 *
 * Usage:
 *   node api/examples/territory-bot.js                         # localhost:3001
 *   node api/examples/territory-bot.js http://your-server:3001 # custom host
 */

const BASE = process.argv[2] || 'http://localhost:3001';
const API = `${BASE}/api/territory`;
const TICK = 33; // ms

async function post(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  return res.json();
}

async function get(path, token) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { headers });
  return res.json();
}

async function del(path, token) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { method: 'DELETE', headers });
  return res.json();
}

// Hex pixel center (odd-r offset, matching server)
const HEX_SIZE = 40;
function hexToPixel(col, row) {
  const w = Math.sqrt(3) * HEX_SIZE;
  const h = 2 * HEX_SIZE;
  return {
    x: col * w + (row & 1 ? w / 2 : 0) + w / 2 + 30,
    y: row * h * 0.75 + h / 2 + 20
  };
}

function dist(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function moveToward(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1) return { x: 0, y: 0 };
  return { x: dx / d, y: dy / d };
}

// ── Main loop ──────────────────────────────────────────────────────

async function main() {
  // Print game info
  const info = await get('/info');
  console.log(`Game: ${info.game}`);
  console.log(`Grid: ${info.grid.cols}×${info.grid.rows} hexes\n`);

  // Join
  const join = await post('/join', { name: 'TerriBot', color: '#4CC9F0' });
  console.log(`Joined as ${join.name} (${join.agent_id})`);
  console.log(`Token: ${join.token.slice(0, 8)}...`);

  const token = join.token;
  const myId = join.agent_id;
  let running = true;

  process.on('SIGINT', () => { running = false; });

  while (running) {
    try {
      const state = await get('/state', token);
      const me = state.your_player;
      if (!me) break;

      const myPos = { x: me.x, y: me.y };

      // Find target hex
      let target = null;
      let targetDist = Infinity;

      // Priority 1: nearest unclaimed hex
      for (const hex of state.grid) {
        if (hex.owner === null && hex.capturingBy !== myId) {
          const center = hexToPixel(hex.col, hex.row);
          const d = dist(myPos, center);
          if (d < targetDist) {
            targetDist = d;
            target = center;
          }
        }
      }

      // Priority 2: weakest enemy hex (if no unclaimed found)
      if (!target) {
        let weakest = null;
        let weakestDefense = Infinity;
        for (const hex of state.grid) {
          if (hex.owner && hex.owner !== myId) {
            if (hex.defense < weakestDefense) {
              weakestDefense = hex.defense;
              weakest = hex;
            }
          }
        }
        if (weakest) {
          target = hexToPixel(weakest.col, weakest.row);
        }
      }

      // Move toward target
      if (target) {
        const dir = moveToward(myPos, target);
        await post('/move', dir, token);
      }

      // Log status periodically
      if (state.tick % 150 === 0) {
        const summary = state.territory_summary || {};
        const myHexes = summary[myId] || 0;
        console.log(`Tick ${state.tick} | Hexes: ${myHexes} | Prestige: ${me.prestige}`);
      }
    } catch (err) {
      console.error('Error:', err.message);
    }

    await new Promise(r => setTimeout(r, TICK));
  }

  // Clean exit
  console.log('\nLeaving...');
  const leave = await del('/leave', token);
  console.log(`Final hexes: ${leave.final_hexes}`);
}

main().catch(console.error);

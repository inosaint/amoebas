import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { makeWorld as makeAmoebasWorld, tick as amoebaTick, evictIdlePlayers as evictAmoebas, TICK_MS as AMOEBA_TICK_MS } from './src/gameLogic.js';
import { makeWorld as makeTerritoryWorld, tick as territoryTick, evictIdlePlayers as evictTerritory, TICK_MS as TERRITORY_TICK_MS } from './src/games/territoryControl.js';
import { makeWorld as makeGraffitiWorld, evictIdlePainters, getFullState as getGraffitiFullState } from './src/games/graffitiWall.js';
import { createAmoebasRouter } from './src/routes/amoebas.js';
import { createTerritoryRouter } from './src/routes/territory.js';
import { createGraffitiRouter } from './src/routes/graffiti.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ── Game worlds ────────────────────────────────────────────────────
const amoebasWorld = makeAmoebasWorld();
const territoryWorld = makeTerritoryWorld();
const graffitiWorld = makeGraffitiWorld();

app.use(express.json());

// ── Backward compat redirects (before static) ─────────────────────
app.get('/screen.html', (req, res) => res.redirect('/amoebas/'));
app.get('/screen.js', (req, res) => res.redirect('/amoebas/screen.js'));
app.get('/skill.md', (req, res) => res.redirect('/amoebas/skill.md'));

// ── Static files ───────────────────────────────────────────────────
app.use(express.static(join(__dirname, 'public')));

// ── API routes ─────────────────────────────────────────────────────
app.use('/api/amoebas', createAmoebasRouter(amoebasWorld));
app.use('/api/territory', createTerritoryRouter(territoryWorld));
app.use('/api/graffiti', createGraffitiRouter(graffitiWorld));

// Backward compatibility: /api/join → /api/amoebas/join etc.
const legacyEndpoints = ['/join', '/state', '/move', '/respawn', '/leave', '/info', '/status'];
for (const ep of legacyEndpoints) {
  app.all(`/api${ep}`, (req, res, next) => {
    req.url = `/api/amoebas${ep}`;
    app._router.handle(req, res, next);
  });
}

// ── Games list API ─────────────────────────────────────────────────
app.get('/api/games', (req, res) => {
  res.json({
    games: [
      {
        id: 'amoebas',
        name: 'Amoebas',
        description: 'Real-time competitive arena. Eat pellets to grow, absorb smaller amoebas, flee larger ones.',
        spectate_url: '/amoebas/',
        api_base: '/api/amoebas',
        skill_url: '/amoebas/skill.md',
        player_count: amoebasWorld.players.size,
        alive_count: [...amoebasWorld.players.values()].filter(p => p.alive).length
      },
      {
        id: 'territory',
        name: 'Territory Control',
        description: 'Strategic hex-grid game. Claim hexes, expand territory, defend borders, contest enemy land.',
        spectate_url: '/territory/',
        api_base: '/api/territory',
        skill_url: '/territory/skill.md',
        player_count: territoryWorld.players.size,
        alive_count: [...territoryWorld.players.values()].filter(p => p.alive).length
      },
      {
        id: 'graffiti',
        name: 'Graffiti Wall',
        description: 'A shared 160×100 pixel canvas. Join, read the canvas, paint anything you like. Collaborative and creative.',
        spectate_url: '/graffiti/',
        api_base: '/api/graffiti',
        skill_url: '/graffiti/skill.md',
        player_count: graffitiWorld.players.size,
        alive_count: graffitiWorld.players.size
      }
    ]
  });
});

// ── WebSocket spectators ───────────────────────────────────────────
io.on('connection', (socket) => {
  // Default: join amoebas spectators (backward compat)
  socket.join('amoebas-spectators');
  if (amoebasWorld.cachedState) {
    socket.emit('state', amoebasWorld.cachedState);
  }

  socket.on('spectate', (game) => {
    socket.leave('amoebas-spectators');
    socket.leave('territory-spectators');
    socket.leave('graffiti-spectators');
    if (game === 'territory') {
      socket.join('territory-spectators');
      if (territoryWorld.cachedState) {
        socket.emit('state', territoryWorld.cachedState);
      }
    } else if (game === 'graffiti') {
      socket.join('graffiti-spectators');
      socket.emit('graffiti-full', getGraffitiFullState(graffitiWorld));
    } else {
      socket.join('amoebas-spectators');
      if (amoebasWorld.cachedState) {
        socket.emit('state', amoebasWorld.cachedState);
      }
    }
  });
});

// ── Game loops ─────────────────────────────────────────────────────
setInterval(() => amoebaTick(amoebasWorld, io), AMOEBA_TICK_MS);
setInterval(() => evictAmoebas(amoebasWorld), 60_000);

setInterval(() => territoryTick(territoryWorld, io), TERRITORY_TICK_MS);
setInterval(() => evictTerritory(territoryWorld), 60_000);

// Graffiti: broadcast dirty pixels every 100ms (event-driven, no tick loop)
setInterval(() => {
  if (graffitiWorld.dirtyPixels.length > 0) {
    io.to('graffiti-spectators').emit('graffiti-delta', {
      pixels: graffitiWorld.dirtyPixels,
      painters: [...graffitiWorld.players.values()].map(p => ({
        id: p.id, name: p.name, color: p.color, pixels_placed: p.pixelsPlaced
      }))
    });
    graffitiWorld.dirtyPixels = [];
  }
}, 100);
setInterval(() => evictIdlePainters(graffitiWorld), 60_000);

// ── Start ──────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`Game Arena running on http://localhost:${PORT}`);
  console.log('');
  console.log('Games:');
  console.log(`  Amoebas:           http://localhost:${PORT}/amoebas/`);
  console.log(`  Territory Control: http://localhost:${PORT}/territory/`);
  console.log(`  Graffiti Wall:     http://localhost:${PORT}/graffiti/`);
  console.log('');
  console.log('Agent quick-start:');
  console.log(`  GET  http://localhost:${PORT}/api/games              (list all games)`);
  console.log(`  POST http://localhost:${PORT}/api/amoebas/join       { "name": "MyBot", "color": "#FF9F1C" }`);
  console.log(`  POST http://localhost:${PORT}/api/territory/join     { "name": "MyBot", "color": "#FF9F1C" }`);
});

import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { makeWorld, tick, evictIdlePlayers, TICK_MS } from './src/gameLogic.js';
import { createRestRouter } from './src/restApi.js';
import { registerSocketHandlers } from './src/socketHandlers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { perMessageDeflate: true });
const world = makeWorld();

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));
app.use('/api', createRestRouter(world));
app.get('/', (req, res) => res.redirect('/screen.html'));

registerSocketHandlers(io, world);

// Push to spectators at 10 FPS to reduce egress (game logic still runs at 30 FPS)
let spectatorTick = 0;
setInterval(() => {
  tick(world, io);
  spectatorTick++;
  if (spectatorTick % 3 === 0) {
    io.to('spectators').volatile.emit('state', world.cachedState);
    world.currentTickEvents = [];
  }
}, TICK_MS);
setInterval(() => evictIdlePlayers(world), 60_000);

server.listen(PORT, () => {
  console.log(`Amoebas API running on http://localhost:${PORT}`);
  console.log(`Spectator view: http://localhost:${PORT}/screen.html`);
  console.log('');
  console.log('Agent quick-start:');
  console.log(`  POST http://localhost:${PORT}/api/join          { "name": "MyBot", "color": "#FF9F1C" }`);
  console.log(`  GET  http://localhost:${PORT}/api/state         Authorization: Bearer <token>`);
  console.log(`  POST http://localhost:${PORT}/api/move          { "x": 1, "y": 0 }`);
  console.log(`  POST http://localhost:${PORT}/api/respawn       (after death)`);
  console.log(`  DELETE http://localhost:${PORT}/api/leave       (clean exit)`);
});

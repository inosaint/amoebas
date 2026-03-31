// Socket handlers are now inline in server.js to support multi-game spectating.
// This file is kept for backward compatibility but is no longer imported.
export function registerSocketHandlers(io, world) {
  io.on('connection', (socket) => {
    socket.join('spectators');
    if (world.cachedState) {
      socket.emit('state', world.cachedState);
    }
  });
}

export function registerSocketHandlers(io, world) {
  io.on('connection', (socket) => {
    socket.join('spectators');

    // Send the latest cached state immediately so the display isn't blank
    if (world.cachedState) {
      socket.emit('state', world.cachedState);
    }
  });
}

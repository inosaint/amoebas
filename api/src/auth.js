import { v4 as uuidv4 } from 'uuid';

export function generateToken() {
  return uuidv4();
}

export function requireAuth(world) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      return res.status(401).json({ error: 'Missing Authorization: Bearer <token> header' });
    }

    const playerId = world.agentTokens.get(token);
    if (!playerId) {
      return res.status(403).json({ error: 'Invalid or expired token. POST /api/join to get a new one.' });
    }

    const player = world.players.get(playerId);
    if (!player) {
      return res.status(403).json({ error: 'Player not found. POST /api/join to re-join.' });
    }

    req.agentContext = { player, token };
    next();
  };
}

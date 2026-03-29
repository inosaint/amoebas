import rateLimit from 'express-rate-limit';

function tokenKey(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : (req.ip || 'unknown');
}

// 60 move requests per 2 seconds — 2× the 30 FPS tick rate
export const moveLimiter = rateLimit({
  windowMs: 2000,
  max: 60,
  keyGenerator: tokenKey,
  message: { error: 'Move rate exceeded. Max 60 per 2s.', retry_after_ms: 34 },
  standardHeaders: true,
  legacyHeaders: false
});

// 120 state polls per 2 seconds
export const stateLimiter = rateLimit({
  windowMs: 2000,
  max: 120,
  keyGenerator: tokenKey,
  message: { error: 'State poll rate exceeded. Max 120 per 2s.', retry_after_ms: 17 },
  standardHeaders: true,
  legacyHeaders: false
});

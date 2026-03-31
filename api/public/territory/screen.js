const socket = io();
socket.emit('spectate', 'territory');

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const leaderboardEl = document.getElementById('leaderboard');
const agentCountEl = document.getElementById('agent-count');
const lbPanel = document.getElementById('leaderboard-panel');
const lbHeader = document.getElementById('leaderboard-header');
const howtoPanel = document.getElementById('howto-panel');
const howtoHeader = document.getElementById('howto-header');

const GRID_COLS = 30;
const GRID_ROWS = 20;
const HEX_SIZE = 40;

const world = { width: 2400, height: 1600 };
let state = { grid: [], players: [], leaderboard: [] };

lbHeader.addEventListener('click', () => lbPanel.classList.toggle('collapsed'));
howtoHeader.addEventListener('click', () => howtoPanel.classList.toggle('collapsed'));

const skillUrl = `${location.origin}/territory/skill.md`;
const skillUrlEl = document.getElementById('skill-url');
const copyBtn = document.getElementById('copy-skill-btn');
if (skillUrlEl) skillUrlEl.textContent = skillUrl;
if (copyBtn) {
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(skillUrl).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1800);
    });
  });
}

// ── Hex rendering helpers ──────────────────────────────────────────

function hexToPixel(col, row) {
  const w = Math.sqrt(3) * HEX_SIZE;
  const h = 2 * HEX_SIZE;
  const x = col * w + (row & 1 ? w / 2 : 0) + w / 2 + 30;
  const y = row * h * 0.75 + h / 2 + 20;
  return { x, y };
}

function drawHexPath(cx, cy, size) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    const px = cx + size * Math.cos(angle);
    const py = cy + size * Math.sin(angle);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

// Build a color map from player IDs to colors
function buildPlayerColors() {
  const map = {};
  for (const p of state.players) {
    map[p.id] = p.color;
  }
  for (const entry of state.leaderboard || []) {
    if (!map[entry.id]) map[entry.id] = entry.color;
  }
  return map;
}

function stringHash(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i++) hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  return hash;
}

function drawBlob(x, y, radius, color, seed, timeSec) {
  const points = 14;
  const wobble = Math.max(2, radius * 0.12);
  ctx.beginPath();
  for (let i = 0; i <= points; i++) {
    const t = (i / points) * Math.PI * 2;
    const wave = Math.sin(t * 3 + timeSec * 2.4 + seed * 0.17) * 0.55;
    const wave2 = Math.sin(t * 5 - timeSec * 1.8 + seed * 0.09) * 0.45;
    const r = radius + (wave + wave2) * wobble;
    const px = x + Math.cos(t) * r;
    const py = y + Math.sin(t) * r;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  const g = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.35, radius * 0.15, x, y, radius * 1.1);
  g.addColorStop(0, 'rgba(255,255,255,0.3)');
  g.addColorStop(1, `${color}d6`);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawEyes(x, y, radius, seed, timeSec) {
  const blink = Math.max(0.16, 1 - Math.max(0, Math.sin(timeSec * 3 + seed * 0.71)) * 0.92);
  const wobbleX = Math.sin(timeSec * 2.6 + seed * 0.33) * (radius * 0.06);
  const wobbleY = Math.sin(timeSec * 2.1 + seed * 0.57) * (radius * 0.05);
  const eyeOffsetX = radius * 0.3;
  const eyeOffsetY = radius * 0.15;
  const eyeR = Math.max(3, radius * 0.18);
  const centers = [
    { x: x - eyeOffsetX + wobbleX, y: y - eyeOffsetY + wobbleY },
    { x: x + eyeOffsetX + wobbleX, y: y - eyeOffsetY + wobbleY }
  ];
  for (const eye of centers) {
    ctx.beginPath();
    ctx.fillStyle = 'rgba(245,251,255,0.96)';
    ctx.ellipse(eye.x, eye.y, eyeR, eyeR * blink, 0, 0, Math.PI * 2);
    ctx.fill();
    const pupilR = Math.max(1.5, eyeR * 0.35);
    const pupilX = eye.x + Math.sin(timeSec * 2 + seed * 0.12) * (eyeR * 0.2);
    const pupilY = eye.y + Math.cos(timeSec * 1.7 + seed * 0.2) * (eyeR * 0.18);
    ctx.beginPath();
    ctx.fillStyle = '#102036';
    ctx.ellipse(pupilX, pupilY, pupilR, Math.max(1, pupilR * blink), 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── Main render ────────────────────────────────────────────────────

function resize() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function render() {
  const viewW = canvas.clientWidth;
  const viewH = canvas.clientHeight;
  if (!viewW || !viewH) { requestAnimationFrame(render); return; }

  const padding = 18;
  const mapW = viewW - padding * 2;
  const mapH = viewH - padding * 2;
  const offsetX = padding;
  const offsetY = padding;
  const scaleX = mapW / world.width;
  const scaleY = mapH / world.height;

  ctx.clearRect(0, 0, viewW, viewH);

  // World border
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.strokeRect(offsetX, offsetY, mapW, mapH);

  const playerColors = buildPlayerColors();
  const timeSec = performance.now() / 1000;

  // Draw hex grid
  for (const hex of state.grid) {
    const center = hexToPixel(hex.col, hex.row);
    const sx = offsetX + center.x * scaleX;
    const sy = offsetY + center.y * scaleY;
    const hexScreenSize = HEX_SIZE * Math.min(scaleX, scaleY);

    drawHexPath(sx, sy, hexScreenSize * 0.92);

    if (hex.owner) {
      const color = playerColors[hex.owner] || '#666';
      const defenseAlpha = 0.2 + (hex.defense / 100) * 0.45;
      ctx.fillStyle = color;
      ctx.globalAlpha = defenseAlpha;
      ctx.fill();
      ctx.globalAlpha = 1;
    } else if (hex.capturingBy) {
      const color = playerColors[hex.capturingBy] || '#666';
      const progress = hex.captureProgress / 100;
      ctx.fillStyle = color;
      ctx.globalAlpha = progress * 0.3;
      ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.02)';
      ctx.fill();
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  // Draw players as amoeba blobs
  for (const p of state.players) {
    const sx = offsetX + p.x * scaleX;
    const sy = offsetY + p.y * scaleY;
    const blobRadius = Math.max(8, HEX_SIZE * 0.45 * Math.min(scaleX, scaleY));
    const seed = stringHash(p.id);

    drawBlob(sx, sy, blobRadius, p.color, seed, timeSec);
    drawEyes(sx, sy, blobRadius, seed, timeSec);

    // Name label
    ctx.fillStyle = '#f4f8ff';
    ctx.font = '600 12px "Avenir Next", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.name, sx, sy - blobRadius - 8);
  }

  requestAnimationFrame(render);
}

function renderLeaderboard() {
  const top5 = (state.leaderboard || []).slice(0, 5);
  if (!top5.length) {
    leaderboardEl.innerHTML = '<div class="muted">No agents yet.</div>';
    return;
  }
  leaderboardEl.innerHTML = top5.map(item => {
    const prestige = item.prestige > 0 ? `<span class="lb-prestige" title="Prestige">&#10022;${item.prestige}</span>` : '';
    return `<div class="leader-item" style="opacity:${item.alive ? 1 : 0.35}">
      <span class="lb-name"><span class="dot" style="background:${item.color}"></span><span>#${item.rank} ${item.name}</span></span>
      <span class="lb-meta">${prestige}<span class="lb-hexes">${item.hexCount || 0} hex</span></span>
    </div>`;
  }).join('');
}

socket.on('state', (incoming) => {
  if (incoming.world) {
    world.width = incoming.world.width;
    world.height = incoming.world.height;
  }
  state = incoming;
  agentCountEl.textContent = `Agents: ${state.players.length}`;
  renderLeaderboard();
});

window.addEventListener('resize', resize);
resize();
requestAnimationFrame(render);

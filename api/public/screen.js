const socket = io();
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const leaderboardEl = document.getElementById('leaderboard');
const agentCountEl = document.getElementById('agent-count');
const toggleBtn = document.getElementById('toggle-btn');
const layout = document.getElementById('layout');

const world = { width: 2400, height: 1600 };
let state = { players: [], pellets: [], ripMarkers: [], leaderboard: [] };

toggleBtn.addEventListener('click', () => {
  layout.classList.toggle('collapsed');
});

function resize() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawGrid(viewW, viewH, offsetX, offsetY, mapW, mapH) {
  const spacing = 80;
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;

  const scaleX = mapW / world.width;
  const scaleY = mapH / world.height;

  for (let x = 0; x <= world.width; x += spacing) {
    const sx = offsetX + x * scaleX;
    ctx.beginPath();
    ctx.moveTo(sx, offsetY);
    ctx.lineTo(sx, offsetY + mapH);
    ctx.stroke();
  }

  for (let y = 0; y <= world.height; y += spacing) {
    const sy = offsetY + y * scaleY;
    ctx.beginPath();
    ctx.moveTo(offsetX, sy);
    ctx.lineTo(offsetX + mapW, sy);
    ctx.stroke();
  }
}

function stringHash(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function drawBlob(x, y, radius, color, seed, timeSec) {
  const points = 18;
  const wobble = Math.max(3.5, radius * 0.11);

  ctx.beginPath();
  for (let i = 0; i <= points; i += 1) {
    const t = (i / points) * Math.PI * 2;
    const wave = Math.sin(t * 3 + timeSec * 2.4 + seed * 0.17) * 0.55;
    const wave2 = Math.sin(t * 5 - timeSec * 1.8 + seed * 0.09) * 0.45;
    const r = radius + (wave + wave2) * wobble;
    const px = x + Math.cos(t) * r;
    const py = y + Math.sin(t) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();

  const g = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.4, radius * 0.2, x, y, radius * 1.2);
  g.addColorStop(0, 'rgba(255,255,255,0.28)');
  g.addColorStop(1, `${color}d6`);
  ctx.fillStyle = g;
  ctx.fill();

  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1.8;
  ctx.stroke();
}

function drawEyes(x, y, radius, seed, timeSec) {
  const blink = Math.max(0.16, 1 - Math.max(0, Math.sin(timeSec * 3 + seed * 0.71)) * 0.92);
  const wobbleX = Math.sin(timeSec * 2.6 + seed * 0.33) * (radius * 0.06);
  const wobbleY = Math.sin(timeSec * 2.1 + seed * 0.57) * (radius * 0.05);

  const eyeOffsetX = radius * 0.32;
  const eyeOffsetY = radius * 0.18;
  const eyeR = Math.max(5, radius * 0.2);

  const centers = [
    { x: x - eyeOffsetX + wobbleX, y: y - eyeOffsetY + wobbleY },
    { x: x + eyeOffsetX + wobbleX, y: y - eyeOffsetY + wobbleY }
  ];

  for (const eye of centers) {
    ctx.beginPath();
    ctx.fillStyle = 'rgba(245,251,255,0.96)';
    ctx.ellipse(eye.x, eye.y, eyeR, eyeR * blink, 0, 0, Math.PI * 2);
    ctx.fill();

    const pupilR = Math.max(2.2, eyeR * 0.33);
    const pupilX = eye.x + Math.sin(timeSec * 2 + seed * 0.12) * (eyeR * 0.25);
    const pupilY = eye.y + Math.cos(timeSec * 1.7 + seed * 0.2) * (eyeR * 0.2);

    ctx.beginPath();
    ctx.fillStyle = '#102036';
    ctx.ellipse(pupilX, pupilY, pupilR, Math.max(1.5, pupilR * blink), 0, 0, Math.PI * 2);
    ctx.fill();
  }
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
  drawGrid(viewW, viewH, offsetX, offsetY, mapW, mapH);

  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.strokeRect(offsetX, offsetY, mapW, mapH);

  for (const pellet of state.pellets) {
    const x = offsetX + pellet.x * scaleX;
    const y = offsetY + pellet.y * scaleY;
    const pelletSize = Math.max(1, Number(pellet.size) || 1);
    const pelletRadius = 1.2 + pelletSize * 0.75;
    ctx.beginPath();
    ctx.fillStyle = pellet.color || 'rgba(255, 225, 130, 0.9)';
    ctx.arc(x, y, pelletRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  const now = Date.now();
  for (const marker of state.ripMarkers || []) {
    const x = offsetX + marker.x * scaleX;
    const y = offsetY + marker.y * scaleY;
    const alpha = Math.max(0, Math.min(1, (marker.expiresAt - now) / 1000));
    if (alpha <= 0) continue;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = '20px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🪦', x, y + 7);
    ctx.restore();
  }

  const timeSec = performance.now() / 1000;
  for (const p of state.players) {
    const worldRadius = Math.sqrt(p.mass) * 2.8;
    const radius = Math.max(6, worldRadius * Math.min(scaleX, scaleY));
    const x = offsetX + p.x * scaleX;
    const y = offsetY + p.y * scaleY;
    const seed = stringHash(p.id);

    drawBlob(x, y, radius, p.color, seed, timeSec);
    drawEyes(x, y, radius, seed, timeSec);

    ctx.fillStyle = '#f4f8ff';
    ctx.font = '600 13px "Avenir Next", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.name, x, y - radius - 10);
  }

  requestAnimationFrame(render);
}

function renderLeaderboard() {
  if (!state.leaderboard || !state.leaderboard.length) {
    leaderboardEl.innerHTML = '<div class="muted">No agents yet.</div>';
    return;
  }

  leaderboardEl.innerHTML = state.leaderboard
    .map(
      (item) =>
        `<div class="leader-item">
          <span class="name"><span class="dot" style="background:${item.color}"></span>#${item.rank} ${item.name}</span>
          <strong>${Math.round(item.score)}</strong>
        </div>`
    )
    .join('');
}

socket.on('state', (incoming) => {
  world.width = incoming.world.width;
  world.height = incoming.world.height;
  state = incoming;
  agentCountEl.textContent = `Agents: ${state.players.length}`;
  renderLeaderboard();
});

window.addEventListener('resize', resize);
resize();
requestAnimationFrame(render);

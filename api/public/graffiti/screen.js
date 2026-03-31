const socket = io();
socket.emit('spectate', 'graffiti');

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const gameWrap = document.getElementById('game-wrap');
const painterCountEl = document.getElementById('painter-count');
const paintersListEl = document.getElementById('painters-list');
const activityFeed = document.getElementById('activity-feed');
const pixelTip = document.getElementById('pixel-tip');

const CANVAS_W = 160;
const CANVAS_H = 100;
const BG_COLOR = { r: 18, g: 20, b: 30 }; // dark canvas background

// ── Off-screen pixel buffer ────────────────────────────────────────

const offscreen = document.createElement('canvas');
offscreen.width = CANVAS_W;
offscreen.height = CANVAS_H;
const offCtx = offscreen.getContext('2d');
const imageData = offCtx.createImageData(CANVAS_W, CANVAS_H);
const buf = imageData.data; // RGBA flat array

// painter name per pixel (for hover tooltip)
const pixelNames = new Array(CANVAS_W * CANVAS_H).fill(null);

function clearBuffer() {
  for (let i = 0; i < CANVAS_W * CANVAS_H; i++) {
    const base = i * 4;
    buf[base]     = BG_COLOR.r;
    buf[base + 1] = BG_COLOR.g;
    buf[base + 2] = BG_COLOR.b;
    buf[base + 3] = 255;
  }
  pixelNames.fill(null);
}

clearBuffer();

function setPixel(x, y, r, g, b, name) {
  if (x < 0 || x >= CANVAS_W || y < 0 || y >= CANVAS_H) return;
  const idx = y * CANVAS_W + x;
  const base = idx * 4;
  buf[base]     = r;
  buf[base + 1] = g;
  buf[base + 2] = b;
  buf[base + 3] = 255;
  pixelNames[idx] = name || null;
}

// ── Layout ─────────────────────────────────────────────────────────

let pixelSize = 1;
let canvasOffsetX = 0;
let canvasOffsetY = 0;

function resize() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Fit canvas with padding, maintaining aspect ratio
  const padding = 28;
  const scaleX = Math.floor((vw - padding * 2) / CANVAS_W);
  const scaleY = Math.floor((vh - padding * 2) / CANVAS_H);
  pixelSize = Math.max(1, Math.min(scaleX, scaleY));

  const displayW = CANVAS_W * pixelSize;
  const displayH = CANVAS_H * pixelSize;

  gameWrap.style.width  = displayW + 'px';
  gameWrap.style.height = displayH + 'px';

  canvas.width  = displayW * dpr;
  canvas.height = displayH * dpr;
  canvas.style.width  = displayW + 'px';
  canvas.style.height = displayH + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const rect = canvas.getBoundingClientRect();
  canvasOffsetX = rect.left;
  canvasOffsetY = rect.top;
}

// ── Render loop ────────────────────────────────────────────────────

let dirty = false;

function render() {
  if (dirty) {
    offCtx.putImageData(imageData, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(offscreen, 0, 0, CANVAS_W * pixelSize, CANVAS_H * pixelSize);
    dirty = false;
  }
  requestAnimationFrame(render);
}

// ── Hover tooltip ──────────────────────────────────────────────────

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const px = Math.floor(mx / pixelSize);
  const py = Math.floor(my / pixelSize);

  if (px >= 0 && px < CANVAS_W && py >= 0 && py < CANVAS_H) {
    const idx = py * CANVAS_W + px;
    const name = pixelNames[idx];
    const base = idx * 4;
    const r = buf[base], g = buf[base + 1], b = buf[base + 2];
    const isEmpty = r === BG_COLOR.r && g === BG_COLOR.g && b === BG_COLOR.b && !name;

    if (!isEmpty) {
      const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
      pixelTip.style.display = 'block';
      pixelTip.style.left = (e.clientX + 12) + 'px';
      pixelTip.style.top  = (e.clientY - 8) + 'px';
      pixelTip.textContent = name ? `${name} · (${px}, ${py}) · ${hex}` : `(${px}, ${py}) · ${hex}`;
    } else {
      pixelTip.style.display = 'none';
    }
  } else {
    pixelTip.style.display = 'none';
  }
});

canvas.addEventListener('mouseleave', () => {
  pixelTip.style.display = 'none';
});

// ── Activity feed ──────────────────────────────────────────────────

const MAX_FEED_ITEMS = 6;

function addActivity(text, color) {
  const item = document.createElement('div');
  item.className = 'activity-item';
  item.innerHTML = color
    ? `<span class="activity-name" style="color:${color}">${text}</span>`
    : text;
  activityFeed.prepend(item);
  while (activityFeed.children.length > MAX_FEED_ITEMS) {
    activityFeed.removeChild(activityFeed.lastChild);
  }
}

// ── Painters list ──────────────────────────────────────────────────

function renderPainters(painters) {
  if (!painters || painters.length === 0) {
    paintersListEl.innerHTML = '<div class="muted">No painters yet.</div>';
    return;
  }
  paintersListEl.innerHTML = painters
    .slice()
    .sort((a, b) => b.pixels_placed - a.pixels_placed)
    .slice(0, 8)
    .map(p => `
      <div class="painter-item">
        <span class="painter-name">
          <span class="dot" style="background:${p.color}"></span>
          <span>${p.name}</span>
        </span>
        <span class="px-count">${p.pixels_placed}px</span>
      </div>
    `).join('');
}

// ── Socket events ──────────────────────────────────────────────────

socket.on('graffiti-full', (data) => {
  clearBuffer();
  const pixels = data.canvas.pixels;
  for (let i = 0; i < pixels.length; i++) {
    const px = pixels[i];
    if (px) {
      const x = i % CANVAS_W;
      const y = Math.floor(i / CANVAS_W);
      setPixel(x, y, px[0], px[1], px[2], null);
    }
  }
  dirty = true;
  painterCountEl.textContent = `Painters: ${data.painters.length}`;
  renderPainters(data.painters);
});

socket.on('graffiti-delta', (data) => {
  const pixels = data.pixels;
  if (!pixels || pixels.length === 0) return;

  for (const p of pixels) {
    setPixel(p.x, p.y, p.r, p.g, p.b, p.name);
  }
  dirty = true;

  // Activity feed — group by painter
  const groups = new Map();
  for (const p of pixels) {
    if (p.name) {
      groups.set(p.name, (groups.get(p.name) || 0) + 1);
    }
  }
  for (const [name, count] of groups.entries()) {
    addActivity(`${name} painted ${count} px`);
  }

  if (data.painters) {
    painterCountEl.textContent = `Painters: ${data.painters.length}`;
    renderPainters(data.painters);
  }
});

// ── Skill URL copy ─────────────────────────────────────────────────

const skillUrl = `${location.origin}/graffiti/skill.md`;
const skillUrlEl = document.getElementById('skill-url');
const copyBtn = document.getElementById('copy-skill-btn');
const howtoHeader = document.getElementById('howto-header');
const howtoPanel = document.getElementById('howto-panel');
const paintersHeader = document.getElementById('painters-header');
const paintersPanel = document.getElementById('painters-panel');

if (skillUrlEl) skillUrlEl.textContent = skillUrl;
if (copyBtn) {
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(skillUrl).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1800);
    });
  });
}

howtoHeader.addEventListener('click', () => howtoPanel.classList.toggle('collapsed'));
paintersHeader.addEventListener('click', () => paintersPanel.classList.toggle('collapsed'));

// ── Init ───────────────────────────────────────────────────────────

window.addEventListener('resize', () => {
  resize();
  dirty = true;
});

resize();
requestAnimationFrame(render);

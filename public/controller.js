const socket = io();

const statusEl = document.getElementById('status');
const nameEl = document.getElementById('name');
const nameRandomEl = document.getElementById('name-random');
const colorEl = document.getElementById('color');
const codeEl = document.getElementById('code');
const joinBtn = document.getElementById('join');
const joinUiEl = document.getElementById('join-ui');
const aliveUi = document.getElementById('alive-ui');
const deathUi = document.getElementById('death-ui');
const deathMessageEl = document.getElementById('death-message');
const deathScoreEl = document.getElementById('death-score');
const respawnBtn = document.getElementById('respawn');
const leaderHintEl = document.getElementById('leader-hint');

const joy = document.getElementById('joy');
const knob = document.getElementById('knob');

const params = new URLSearchParams(window.location.search);
if (params.get('code')) {
  codeEl.value = String(params.get('code')).toUpperCase().slice(0, 5);
}

let joined = false;
let alive = false;
let joyPointer = null;
let currentInput = { x: 0, y: 0 };
let profileTimer = null;

const NAME_MODIFIERS = [
  'Neon',
  'Quantum',
  'Liminal',
  'Vanta',
  'Fractal',
  'Oblique',
  'Synthetic',
  'Holo',
  'Nova',
  'Prism',
  'Null',
  'Echo'
];

const NAME_TITLES = [
  'Type Oracle',
  'Prompt Monk',
  'Grid Druid',
  'Wire Prophet',
  'Token Witch',
  'Frame Scribe',
  'Pixel Seer',
  'Signal Poet',
  'UX Alchemist',
  'Vector Medium',
  'Pattern Mystic',
  'Spline Pilot'
];

const NAME_TAGS = ['Prime', 'MkII', 'v9', 'Delta', 'Ghost', 'Proto', 'Beta'];

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function randomDesignerTitle() {
  for (let i = 0; i < 16; i += 1) {
    const withTag = Math.random() < 0.45;
    const base = `${randomItem(NAME_MODIFIERS)} ${randomItem(NAME_TITLES)}`;
    const candidate = withTag ? `${base} ${randomItem(NAME_TAGS)}` : base;
    if (candidate.length <= 22) return candidate;
  }
  return `${randomItem(NAME_MODIFIERS)} ${randomItem(NAME_TITLES)}`.slice(0, 22);
}

function setJoinUi(isJoined) {
  joinUiEl.classList.toggle('hidden', isJoined);
  codeEl.disabled = isJoined;
  joinBtn.disabled = isJoined;
}

function setAliveState(nextAlive) {
  alive = nextAlive;
  aliveUi.classList.toggle('hidden', !alive);
  deathUi.classList.toggle('hidden', alive);
}

function sendInput(x, y) {
  currentInput = { x, y };
  socket.emit('player:input', currentInput);
}

function resetJoystick() {
  knob.style.left = '74px';
  knob.style.top = '74px';
  sendInput(0, 0);
}

function updateLeaderboardHint(board) {
  if (!board || !board.length) {
    leaderHintEl.textContent = '';
    return;
  }

  const top = board[0];
  leaderHintEl.textContent = `Top score: ${top.name} (${Math.round(top.score)})`;
}

function scheduleProfileUpdate() {
  if (!joined) return;
  clearTimeout(profileTimer);
  profileTimer = setTimeout(() => {
    socket.emit('player:updateProfile', {
      name: nameEl.value,
      color: colorEl.value
    });
  }, 180);
}

function join() {
  const code = codeEl.value.trim().toUpperCase();
  if (!code) {
    statusEl.textContent = 'Enter session code';
    return;
  }

  socket.emit('player:join', {
    code,
    name: nameEl.value,
    color: colorEl.value
  });
  statusEl.textContent = 'Joining...';
}

joinBtn.addEventListener('click', join);
codeEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') join();
});
nameEl.addEventListener('input', scheduleProfileUpdate);
colorEl.addEventListener('input', scheduleProfileUpdate);
nameRandomEl.addEventListener('click', () => {
  nameEl.value = randomDesignerTitle();
  scheduleProfileUpdate();
});
respawnBtn.addEventListener('click', () => {
  socket.emit('player:respawn');
  statusEl.textContent = 'Respawning...';
});

joy.addEventListener('pointerdown', (e) => {
  if (!alive) return;
  joyPointer = e.pointerId;
  joy.setPointerCapture(e.pointerId);
});

joy.addEventListener('pointermove', (e) => {
  if (!alive || e.pointerId !== joyPointer) return;

  const rect = joy.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = e.clientX - cx;
  const dy = e.clientY - cy;

  const maxDist = rect.width * 0.36;
  const dist = Math.hypot(dx, dy);
  const scale = dist > maxDist ? maxDist / dist : 1;

  const px = dx * scale;
  const py = dy * scale;
  knob.style.left = `${74 + px}px`;
  knob.style.top = `${74 + py}px`;

  const inputX = px / maxDist;
  const inputY = py / maxDist;
  sendInput(inputX, inputY);
});

function releaseJoystick(e) {
  if (e.pointerId !== joyPointer) return;
  joyPointer = null;
  resetJoystick();
}

joy.addEventListener('pointerup', releaseJoystick);
joy.addEventListener('pointercancel', releaseJoystick);

socket.on('connect', () => {
  statusEl.textContent = 'Connected';
});

socket.on('disconnect', () => {
  statusEl.textContent = 'Disconnected';
  joined = false;
  setJoinUi(false);
  setAliveState(false);
  resetJoystick();
});

socket.on('player:joined', (payload) => {
  joined = true;
  setJoinUi(true);
  setAliveState(true);
  statusEl.textContent = `In ${payload.code}`;
  nameEl.value = payload.name;
  colorEl.value = payload.color;
  updateLeaderboardHint(payload.leaderboard);
});

socket.on('player:joinFailed', (payload) => {
  statusEl.textContent = payload.reason || 'Join failed';
  setJoinUi(false);
});

socket.on('player:profileUpdated', (profile) => {
  nameEl.value = profile.name;
  colorEl.value = profile.color;
});

socket.on('player:died', (data) => {
  setAliveState(false);
  statusEl.textContent = 'You died';
  deathMessageEl.textContent = data.by ? `Absorbed by ${data.by}` : 'You were absorbed';
  deathScoreEl.textContent = `Your score: ${Math.round(data.score)}`;
  updateLeaderboardHint(data.leaderboard);
  resetJoystick();
});

socket.on('player:respawned', () => {
  setAliveState(true);
  statusEl.textContent = 'Back in!';
});

socket.on('state', (incoming) => {
  updateLeaderboardHint(incoming.leaderboard);
});

socket.on('sessionClosed', () => {
  joined = false;
  setJoinUi(false);
  setAliveState(false);
  statusEl.textContent = 'Session ended';
  resetJoystick();
});

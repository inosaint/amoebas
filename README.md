# Amoeba Mixer

Multiplayer party game for a shared screen + phone controllers.

- Host runs the game screen and shows a QR code.
- Players scan QR on their phones to join as amoebas.
- Eat pellets and smaller amoebas to grow and climb the leaderboard.

## Requirements

- Node.js 18+ (recommended)
- Devices on the same Wi-Fi/LAN as the host machine

## Setup

From the project root:

```bash
npm install
npm start
```

Dev mode (auto-restart server on changes):

```bash
npm run dev
```

## Run The Game

1. Open host screen on the machine connected to the TV/projector:
   - `http://localhost:3000/screen.html`
2. Players scan the QR and open controller page:
   - `http://<host-ip>:3000/controller.html?code=XXXXX`
3. Enter/refresh name, pick color, tap **Join**.
4. Move with joystick and survive.

## Gameplay Rules

- Score range: `0` to `100` (hard cap at `100`).
- Bigger score => bigger amoeba and slower movement.
- On touch overlap, higher-score amoeba absorbs lower-score amoeba.
- Pellet tiers:
  - Size 1 => +1 score
  - Size 2 => +2 score
  - Size 3 => +3 score
  - Size 4 => +4 score
  - Size 5 => +5 score
- If absorbed, press **Respawn** on phone.
- A short `🪦` marker appears on host map where an amoeba dies.

## UI Notes

- Host Wi-Fi name is editable inline on the left panel and persists in browser storage.
- Controller name field has an inline `✦` button to generate random futuristic designer-style names.
- On successful join, room-code join UI hides on phone to reduce clutter.

## Networking Tips (Important)

- Best practice: open the host screen with the actual LAN IP:
  - `http://<host-ip>:3000/screen.html`
- If you switch Wi-Fi networks:
  1. Restart server (`npm start`)
  2. Hard refresh host screen (`Cmd/Ctrl + Shift + R`)
  3. Re-scan QR from phones

This avoids stale IPs in QR codes after network changes.

## Troubleshooting

- **QR scans but phone cannot join**
  - Confirm host and phone are on same network.
  - Check VPN/hotspot is off (can cause wrong interface/IP).
  - Restart server + reload screen page to regenerate session/QR.

- **Players not showing on screen**
  - Confirm session code matches.
  - Ensure WebSocket traffic is allowed on local network.
  - Reload host and controller pages.

- **Name/appearance not updating**
  - Check controller is still connected.
  - Rejoin session from phone if needed.

## Project Structure

- `server.js` - Express + Socket.IO game server and game loop
- `public/screen.html` + `public/screen.js` - Host display UI and rendering
- `public/controller.html` + `public/controller.js` - Phone controller UI and input


"""
Amoebas — Python example bot
Requires: Python 3.8+, requests library  (pip install requests)

Strategy:
  1. Flee any amoeba with a higher score that's within danger range
  2. Otherwise, move toward the nearest pellet
  3. Auto-respawn on death

Usage:
  python bot.py                          # connects to localhost:3001
  python bot.py http://your-server:3001  # custom server
"""

import sys
import time
import math
import requests

BASE_URL = sys.argv[1].rstrip('/') if len(sys.argv) > 1 else 'http://localhost:3001'

DANGER_RADIUS_PADDING = 80   # extra px beyond amoeba radii to start fleeing
TICK_SLEEP = 1 / 30          # aim for ~30 Hz (server also ticks at 30 Hz)


def mass_from_score(score):
    return 8 + 0.05 * score * score


def radius_from_score(score):
    return math.sqrt(mass_from_score(max(0, min(100, score)))) * 2.8


def dist(a, b):
    dx = a['x'] - b['x']
    dy = a['y'] - b['y']
    return math.sqrt(dx * dx + dy * dy)


def normalize(dx, dy):
    mag = math.sqrt(dx * dx + dy * dy)
    if mag < 0.001:
        return 0.0, 0.0
    return dx / mag, dy / mag


def join(name, color):
    r = requests.post(f'{BASE_URL}/api/join', json={'name': name, 'color': color}, timeout=5)
    r.raise_for_status()
    return r.json()


def get_state(token):
    r = requests.get(
        f'{BASE_URL}/api/state',
        headers={'Authorization': f'Bearer {token}'},
        timeout=5
    )
    r.raise_for_status()
    return r.json()


def send_move(token, x, y):
    requests.post(
        f'{BASE_URL}/api/move',
        json={'x': x, 'y': y},
        headers={'Authorization': f'Bearer {token}'},
        timeout=5
    )


def respawn(token):
    r = requests.post(
        f'{BASE_URL}/api/respawn',
        headers={'Authorization': f'Bearer {token}'},
        timeout=5
    )
    return r.json()


def leave(token):
    requests.delete(
        f'{BASE_URL}/api/leave',
        headers={'Authorization': f'Bearer {token}'},
        timeout=5
    )


def decide_direction(state):
    """
    Returns (x, y) move vector, or None to hold still.
    Replace this function with your own logic — LLM, RL model, etc.
    """
    me = state['your_player']
    players = state['players']
    pellets = state['pellets']

    my_radius = radius_from_score(me['score'])

    # --- Threat check: flee any bigger amoeba within danger range ---
    flee_x, flee_y = 0.0, 0.0
    for p in players:
        if p['id'] == me['id']:
            continue
        if p['score'] <= me['score']:
            continue

        their_radius = radius_from_score(p['score'])
        danger_dist = my_radius + their_radius + DANGER_RADIUS_PADDING
        d = dist(me, p)

        if d < danger_dist:
            # Flee: vector pointing away from threat, weighted by proximity
            weight = (danger_dist - d) / danger_dist
            flee_x += (me['x'] - p['x']) * weight
            flee_y += (me['y'] - p['y']) * weight

    if math.sqrt(flee_x ** 2 + flee_y ** 2) > 0.01:
        return normalize(flee_x, flee_y)

    # --- No threat: seek nearest pellet ---
    if not pellets:
        return 0.0, 0.0

    nearest = min(pellets, key=lambda p: (p['x'] - me['x']) ** 2 + (p['y'] - me['y']) ** 2)
    dx = nearest['x'] - me['x']
    dy = nearest['y'] - me['y']
    return normalize(dx, dy)


def main():
    print(f'Connecting to {BASE_URL}')

    # Fetch game info so the bot (or an LLM driver) can read the rules
    info = requests.get(f'{BASE_URL}/api/info', timeout=5).json()
    print(f"World: {info['world']['width']}x{info['world']['height']}")
    print(f"Tips: {info['strategy_tips'][0]}")

    data = join('PyBot', '#4CC9F0')
    token = data['token']
    print(f"Joined as '{data['name']}' — id: {data['agent_id']}")
    print(f"Spawn: ({data['spawn']['x']:.0f}, {data['spawn']['y']:.0f})")
    print('Press Ctrl+C to quit\n')

    try:
        while True:
            state = get_state(token)
            me = state['your_player']

            if not me['alive']:
                info = me.get('death_info') or {}
                killer = info.get('by') or 'unknown'
                print(f"  Died (absorbed by {killer}, score was {info.get('score', '?')}). Respawning…")
                respawn(token)
            else:
                direction = decide_direction(state)
                if direction:
                    send_move(token, direction[0], direction[1])

                # Print status every ~second (every 30 ticks)
                tick = state.get('tick', 0)
                if tick % 30 == 0:
                    alive = len(state['players'])
                    print(f"  tick={tick:6d}  score={me['score']:5.1f}  pos=({me['x']:6.0f},{me['y']:6.0f})  agents_alive={alive}")

            time.sleep(TICK_SLEEP)

    except KeyboardInterrupt:
        print('\nLeaving game…')
        leave(token)
        print('Done.')


if __name__ == '__main__':
    main()

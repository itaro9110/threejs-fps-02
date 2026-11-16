[![make.fun threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/itaro9110/threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/itaro9110/threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02)

# DUSTLINE — Tactical FPS

A round-based tactical first-person shooter in the style Counter-Strike made famous —
an original game: its own map, names, art and sounds. Built on three.js 0.187.0, it runs
entirely from static files with no network requests.

**Bounty:** [make.fun — Best three.js tactical FPS (threejs-fps-02)](https://make.fun/bounty/threejs-fps-02)

## How to play

You lead the DUSTLINE attackers against the FOUNDRY defenders in the Foundry Yard,
a dusk-lit industrial yard with two bomb sites (A: crate yard, B: warehouse), a mid
connector and two lanes per site. First to **5 round wins** (max 9 rounds) takes the match.

**Win a round** by eliminating the enemy team, or by planting the charge at Site A or B
and defending it until the 35-second fuse blows. The defenders win by defusing the charge
(5-second channel), wiping your squad, or running out the 100-second round timer with no plant.

**Economy:** start with $800. Kills pay +$300, a plant pays +$300, a round win pays +$3000,
a round loss pays +$1500. Spend it in the buy menu (**B**) during buy time.

**Weapons** (all hitscan, all with recoil, spread and reloads):

| Weapon | Price | Notes |
|---|---|---|
| P9 Sidearm | free | Always owned, infinite reserve |
| Kestrel Rifle | $2700 | Full-auto workhorse |
| Jackal SMG | $1500 | Very fast, close lanes |
| Longbow DMR | $4000 | Huge damage, headshots ×4, right-click scope |
| Mauler Shotgun | $2100 | Eight pellets, brutal up close |
| Frag grenade | $300 | Bounces, then shreds an area |
| Flash grenade | $200 | Whites out anyone looking at it — bots too |

A quiet synth pad plays under the action (M mutes everything), and your squad calls
out its moves on the radio — pushes, holds, rotations, plants and defuses — with the
same intent drawn on the minimap.

**Controls:** WASD move · mouse aim · click fire · R reload · Ctrl crouch (steadier aim,
lower profile) · Shift sprint · Space jump · 1/2 weapons · 4 frag · 5 flash · B buy menu ·
E plant / defuse (hold) · right-click scope (Longbow) · M mute · Esc pause · arrow keys turn
the view if pointer lock is unavailable.

**Gunplay:** headshots deal double damage (×4 with the Longbow), spread grows while moving,
airborne or firing and shrinks when still and crouched, recoil kicks the view and blooms the
crosshair — stopping to aim pays. Bots follow waypoint routes, hold angles, rotate toward
gunfire they hear, peek, retreat when hurt, plant when a site is clear and defuse when yours
is live. They react with a delay and imperfect aim: fair, not aimbot.

## How to run

Serve `game/` with any static file server and open `index.html` in desktop Chrome:

```sh
cd game
python3 -m http.server 8080
# open http://localhost:8080
```

No build step, no network: three.js 0.187.0 is vendored under `game/vendor/three/`.

## Build the entry

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` (Node 22 stdlib only) copies `game/` and `screenshots/` into the output
directory and writes `dossier.json` with `buildDossier` from `vendor/makefun-threejs.ts`.

## Layout

- `game/index.html` — page, HUD DOM and CSS
- `game/src/main.js` — bootstrap, input, fixed-step (60 Hz) loop
- `game/src/world.js` — Foundry Yard map, AABB collision, raycasts, waypoint graph
- `game/src/player.js` — movement, camera, viewmodel gun
- `game/src/weapon.js` — weapon defs, hitscan firing, tracers, grenades
- `game/src/bots.js` — bot AI
- `game/src/game.js` — round state machine, economy, damage
- `game/src/hud.js` — HUD, minimap, killfeed, buy menu
- `game/src/audio.js` — synthesized WebAudio sounds
- `game/vendor/three/` — three.js 0.187.0 (vendored, untouched)

## License

MIT — see `LICENSE`.

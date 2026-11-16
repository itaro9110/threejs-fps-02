// game.js — one shared state object, the round state machine, economy, damage.
import { WEAPONS, GRENADE_PRICE, autoReload, fireWeapon } from './weapon.js';
import { createPlayer } from './player.js';
import { createBot } from './bots.js';

export const BUY_TIME = 15, ROUND_TIME = 100, WIN_ROUNDS = 5, MAX_ROUNDS = 9;
export const PLANT_TIME = 3, DEFUSE_TIME = 5, FUSE_TIME = 35;

export function createGame() {
  const g = {
    phase: 'title', // title | buy | live | roundEnd | matchEnd
    round: 1, scoreAtk: 0, scoreDef: 0,
    timer: 0, phaseT: 0, time: 0,
    money: 800,
    plant: { state: 'none', site: null, x: 0, z: 0, fuse: 0, progress: 0, defuseProgress: 0, planter: null },
    player: null, bots: [],
    world: null, scene: null, camera: null, hud: null, audio: null,
    input: null, lastShot: null,
    roundWinner: null, roundReason: '',
    matchWinner: null, history: [], // 'W'/'L' per round, shown on the end screen
    stats: { kills: 0, deaths: 0, plants: 0, defuses: 0 },
    chargeMesh: null,
    // hooks filled in by main.js / hud.js
    damage: null, onPlant: null, onDefuse: null,
  };
  return g;
}

export function spawnTeams(g) {
  const w = g.world;
  // drop last round's bot meshes from the scene before replacing the bots
  for (const b of g.bots) if (b.mesh) g.scene.remove(b.mesh);
  // player + 3 friendly attackers
  if (!g.player) g.player = createPlayer(w, w.spawns.atk[0]);
  const p = g.player;
  p.pos.set(w.spawns.atk[0][0], 0, w.spawns.atk[0][1]);
  p.vel.set(0, 0, 0);
  p.hp = 100; p.alive = true;
  p.yaw = -Math.PI / 2; p.pitch = 0; p.recoil = 0; p.bloom = 0;
  p.cooldown = 0; p.reloading = false; p.flashT = 0; p.blindT = 0;
  if (!p.ammo.p9) p.ammo.p9 = { mag: 12, reserve: Infinity };
  if (!p.weapons.primary) { p.current = 'p9'; }
  // keep owned weapons between rounds; if dead last round, primary is lost
  if (p.diedLastRound) {
    p.weapons.primary = null; p.current = 'p9';
    p.ammo = { p9: { mag: 12, reserve: Infinity } };
    p.diedLastRound = false;
  }
  // bots
  g.bots = [];
  for (let i = 0; i < 3; i++) {
    const b = createBot(g, 'atk', i, w.spawns.atk[i + 1]);
    g.bots.push(b);
  }
  for (let i = 0; i < 4; i++) {
    const b = createBot(g, 'def', i, w.spawns.def[i]);
    g.bots.push(b);
  }
}

export function startMatch(g) {
  g.round = 1; g.scoreAtk = 0; g.scoreDef = 0;
  g.money = 800;
  g.stats = { kills: 0, deaths: 0, plants: 0, defuses: 0 };
  g.matchWinner = null;
  g.history = [];
  const p = g.player;
  p.weapons = { primary: null, sidearm: 'p9', frag: 0, flash: 0 };
  p.ammo = { p9: { mag: 12, reserve: Infinity } };
  p.current = 'p9'; p.armor = 0;
  p.diedLastRound = false;
  startRound(g);
}

export function startRound(g) {
  spawnTeams(g);
  g.plant = { state: 'none', site: null, x: 0, z: 0, fuse: 0, progress: 0, defuseProgress: 0, planter: null };
  if (g.chargeMesh) g.chargeMesh.visible = false;
  g.phase = 'buy';
  g.timer = BUY_TIME; g.phaseT = 0;
  g.lastShot = null;
  g.hud.showBuy(true);
  g.hud.banner('', '');
  g.hud.setObjective('Buy up — the round starts soon. Plant at A or B.');
  g.audio.roundStart();
}

function aliveCount(g, team) {
  let n = g.player.team === team && g.player.alive ? 1 : 0;
  for (const b of g.bots) if (b.team === team && b.alive) n++;
  return n;
}

export function endRound(g, winner, reason) {
  if (g.phase === 'roundEnd' || g.phase === 'matchEnd') return;
  g.roundWinner = winner;
  g.roundReason = reason;
  g.phase = 'roundEnd';
  g.phaseT = 0;
  g.history.push(winner === 'atk' ? 'W' : 'L');
  if (winner === 'atk') {
    g.scoreAtk++;
    g.money += 3000;
    g.hud.banner('ROUND WON', reason + '  ·  DUSTLINE ' + g.scoreAtk + '–' + g.scoreDef + ' FOUNDRY', true);
    g.audio.sting(true);
  } else {
    g.scoreDef++;
    g.money += 1500;
    g.hud.banner('ROUND LOST', reason + '  ·  DUSTLINE ' + g.scoreAtk + '–' + g.scoreDef + ' FOUNDRY', false);
    g.audio.sting(false);
  }
  g.hud.showBuy(false);
  g.hud.setObjective(reason);
  // mark the player dead-or-alive for the next round's loadout rule
  g.player.diedLastRound = !g.player.alive;
}

function checkMatchEnd(g) {
  if (g.scoreAtk >= WIN_ROUNDS || g.scoreDef >= WIN_ROUNDS || g.round >= MAX_ROUNDS) {
    g.phase = 'matchEnd';
    g.matchWinner = g.scoreAtk > g.scoreDef ? 'atk' : (g.scoreDef > g.scoreAtk ? 'def' : 'draw');
    g.hud.showMatchEnd(g);
    return true;
  }
  return false;
}

export function updateGame(g, dt) {
  g.time += dt;
  if (g.phase === 'buy') {
    g.timer -= dt;
    g.phaseT += dt;
    if (g.timer <= 0) {
      g.phase = 'live';
      g.timer = ROUND_TIME;
      g.hud.showBuy(false);
      g.hud.setObjective('Plant the charge at A or B — or eliminate the defenders.');
      g.audio.beep(true);
    }
    return;
  }
  if (g.phase === 'roundEnd') {
    g.phaseT += dt;
    if (g.phaseT > 4) {
      if (checkMatchEnd(g)) return;
      g.round++;
      startRound(g);
    }
    return;
  }
  if (g.phase !== 'live') return;

  // round timer
  g.timer -= dt;
  if (g.timer <= 0) {
    if (g.plant.state === 'planted') { /* fuse still decides it */ }
    else endRound(g, 'def', 'Time expired — the defenders held the yard.');
    g.timer = 0;
  }

  // plant fuse
  if (g.plant.state === 'planted') {
    g.plant.fuse -= dt;
    g.timer = Math.max(0, g.plant.fuse); // the clock now shows the fuse
    if (Math.ceil(g.plant.fuse) !== Math.ceil(g.plant.fuse + dt)) g.audio.beep(g.plant.fuse < 10);
    if (g.plant.fuse <= 0) {
      g.audio.explosion();
      g.hud.explosionFlash({ x: g.plant.x, y: 0, z: g.plant.z });
      // blast hurts everyone near the site
      const targets = [g.player, ...g.bots];
      for (const t of targets) {
        if (!t.alive) continue;
        const d = Math.hypot(t.pos.x - g.plant.x, t.pos.z - g.plant.z);
        if (d < 8) applyDamage(g, t, 120, false, g.plant.planter || g.player);
      }
      endRound(g, 'atk', 'The charge detonated at Site ' + g.plant.site + '.');
      return;
    }
  }

  // player plant / defuse channel (hold E near the objective)
  const p = g.player;
  let playerChanneling = false;
  if (p.alive && g.input.plantHeld) {
    if (g.plant.state === 'none') {
      for (const name of ['A', 'B']) {
        const s = g.world.sites[name];
        if (Math.hypot(p.pos.x - s.x, p.pos.z - s.z) < s.r) {
          playerChanneling = true;
          g.plant.progress += dt;
          g.plant.site = name;
          g.plant.planter = p;
          g.hud.plantBar(g.plant.progress / PLANT_TIME, 'PLANTING…');
          if (g.plant.progress >= PLANT_TIME) {
            g.hud.plantBar(0, '');
            onPlant(g, p);
          }
          break;
        }
      }
    } else if (g.plant.state === 'planted') {
      const d = Math.hypot(p.pos.x - g.plant.x, p.pos.z - g.plant.z);
      if (d < 2.2) {
        playerChanneling = true;
        g.plant.defuseProgress += dt;
        g.hud.plantBar(g.plant.defuseProgress / DEFUSE_TIME, 'DEFUSING…');
        if (g.plant.defuseProgress >= DEFUSE_TIME) onDefuse(g, p); // onDefuse counts the stat
      }
    }
  }
  // a channel nobody is working bleeds away (interrupted planter, walked-off defuser)
  if (g.plant.state === 'none' && !playerChanneling && !g.bots.some((b) => b.alive && b.planting)) {
    g.plant.progress = Math.max(0, g.plant.progress - dt * 2);
    g.hud.plantBar(0, '');
  }
  if (g.plant.state === 'planted' && !playerChanneling && !g.bots.some((b) => b.alive && b.defusing)) {
    g.plant.defuseProgress = Math.max(0, g.plant.defuseProgress - dt * 2);
    g.hud.plantBar(0, '');
  }

  // elimination win checks
  if (aliveCount(g, 'def') === 0) {
    if (g.plant.state === 'planted') {
      // defenders all dead with a live charge: attackers win at detonation, but
      // the round is already decided — end it now as a plant win in waiting.
      endRound(g, 'atk', 'Defenders eliminated — the charge will finish the job.');
    } else endRound(g, 'atk', 'Enemy team eliminated.');
    return;
  }
  if (aliveCount(g, 'atk') === 0) {
    // with a live charge the fuse (or a defuse) decides the round, not the wipe
    if (g.plant.state !== 'planted') endRound(g, 'def', 'Your squad was eliminated.');
  }
}

function showCharge(g) {
  if (g.chargeMesh) {
    g.chargeMesh.position.set(g.plant.x, 0.4, g.plant.z);
    g.chargeMesh.visible = true;
  }
}

// --- damage & death (shared hook used by weapon.js and bots.js) ---
export function applyDamage(g, target, dmg, head, attacker) {
  if (!target.alive || g.phase !== 'live') return;
  let remaining = dmg;
  if (target.armor > 0) {
    const absorbed = Math.min(target.armor, remaining * 0.5);
    target.armor -= absorbed;
    remaining -= absorbed;
  }
  target.hp -= remaining;
  if (target.isPlayer) {
    g.audio.hurt();
    g.hud.damageFrom(attacker);
  }
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    target.deaths++;
    if (attacker) {
      // only enemy kills count: no credit for friendly fire or your own charge
      const foe = attacker.team !== target.team;
      if (foe) attacker.kills++;
      if (foe && attacker.isPlayer) {
        g.money += 300;
        g.stats.kills++;
        g.hud.feed('You  ▸  ' + target.name + (head ? '  [HEADSHOT]' : ''), 'atk', head);
      } else if (target.isPlayer) {
        g.stats.deaths++;
        g.hud.feed(attacker.name + '  ▸  You' + (head ? '  [HEADSHOT]' : ''), 'def', head);
      } else {
        g.hud.feed(attacker.name + '  ▸  ' + target.name, attacker.team, head);
      }
    }
    if (target.isPlayer) {
      g.hud.banner('YOU ARE DOWN', 'Your squad fights on — spectate from above.', false);
      g.hud.setObjective('You are down. Your squad fights on.');
    }
    if (target.mesh) target.mesh.visible = false;
    // drop the plant/defuse channel if the carrier dies
    if (g.plant.planter === target) g.plant.progress = 0;
  }
}

export function onPlant(g, planter) {
  if (g.plant.state !== 'none') return; // already planted / defused
  g.plant.state = 'planted';
  g.plant.x = planter.pos.x; g.plant.z = planter.pos.z;
  g.plant.fuse = FUSE_TIME;
  if (planter.isPlayer) { g.stats.plants++; g.money += 300; }
  g.audio.plantDone();
  g.hud.feed(planter.name + ' planted the charge at Site ' + g.plant.site, 'atk');
  g.hud.setObjective('Charge planted at ' + g.plant.site + ' — defend it!', true);
  showCharge(g);
}

export function onDefuse(g, defuser) {
  if (g.plant.state !== 'planted') return; // fuse already blew or round already over
  g.plant.state = 'defused';
  if (g.chargeMesh) g.chargeMesh.visible = false;
  if (defuser.isPlayer) g.stats.defuses++;
  g.audio.beep(true);
  g.hud.feed(defuser.name + ' defused the charge', 'def');
  endRound(g, 'def', 'The charge was defused.');
}

// --- economy / shop ---
export function buyItem(g, item) {
  if (g.phase !== 'buy') return false;
  const p = g.player;
  if (item.kind === 'weapon') {
    const def = WEAPONS[item.id];
    if (!def || p.weapons.primary === item.id || g.money < def.price) return false;
    g.money -= def.price;
    p.weapons.primary = item.id;
    p.ammo[item.id] = { mag: def.mag, reserve: def.reserve };
    p.current = item.id;
    g.audio.buy();
    return true;
  }
  if (item.kind === 'grenade') {
    const price = GRENADE_PRICE[item.id];
    if (g.money < price || p.weapons[item.id] >= 2) return false;
    g.money -= price;
    p.weapons[item.id]++;
    g.audio.buy();
    return true;
  }
  if (item.kind === 'armor') {
    if (g.money < 650 || p.armor >= 100) return false;
    g.money -= 650;
    p.armor = 100;
    g.audio.buy();
    return true;
  }
  return false;
}

export function switchWeapon(g, id) {
  const p = g.player;
  if (!p.alive || p.reloading) return;
  if (id === 'p9') p.current = 'p9';
  else if (id === p.weapons.primary) p.current = id;
  else return;
  p.reloading = false;
  g.audio.click();
}

export function tryFire(g, held) {
  const p = g.player;
  if (!p.alive || g.phase !== 'live' || p.reloading) return;
  if (p.blindT > 0) return;
  const def = WEAPONS[p.current];
  if (!def) return;
  if (!def.auto && !held) return;
  if (p.current === 'longbow' && g.input.scoped) {
    // scoped shots are steadier
  }
  const fired = fireWeapon(g, p, null);
  if (fired) g.lastShot = { x: p.pos.x, z: p.pos.z, t: g.time, team: 'atk' };
}

export function tryReload(g) {
  if (g.player.alive && g.phase === 'live') autoReload(g, g.player);
}

// bots.js — teammate and enemy AI: waypoint routes, vision, hearing, planting,
// retreating, and deliberately imperfect aim (reaction delay + error, never aimbot).
import * as THREE from 'three';
import { moveBody, losBlocked, nearestWaypoint, findPath } from './world.js';
import { WEAPONS, fireWeapon, autoReload } from './weapon.js';

const BOT_SPEED = 4.3;
const VIEW_RANGE = 55;
const FOV_DOT = 0.55; // ~123 deg total vision cone
const _d = new THREE.Vector3();
const _t = new THREE.Vector3();

const FRIEND_NAMES = ['Vex', 'Rook', 'Hale'];
const ENEMY_NAMES = ['Dagger', 'Wraith', 'Nomad', 'Sable'];
const BOT_LOADOUTS = ['kestrel', 'kestrel', 'jackal', 'longbow'];

export function createBot(g, team, idx, spawn) {
  const isAtk = team === 'atk';
  const b = {
    isPlayer: false, team, idx,
    name: isAtk ? FRIEND_NAMES[idx] : ENEMY_NAMES[idx],
    pos: new THREE.Vector3(spawn[0], 0, spawn[1]),
    vel: new THREE.Vector3(),
    yaw: isAtk ? -Math.PI / 2 : Math.PI / 2,
    hp: 100, armor: isAtk ? 25 : 0, alive: true,
    crouched: false, sprinting: false, grounded: true, moving: false,
    spreadMove: 0, eyeH: 1.62, bloom: 0,
    current: BOT_LOADOUTS[idx % BOT_LOADOUTS.length],
    ammo: {}, cooldown: 0, reloading: false, reloadT: 0,
    blindT: 0, flashT: 0,
    state: isAtk ? 'push' : 'hold',
    site: isAtk ? (idx % 2 === 0 ? 'A' : 'B') : (idx < 2 ? 'A' : 'B'),
    holdWp: 0, path: [], pathI: 0, waitT: 0,
    enemy: null, lastSeen: new THREE.Vector3(), lastSeenT: -99,
    reactT: 0, aimT: 0, burstLeft: 0, burstPause: 0, strafeDir: 1, strafeT: 0,
    planting: false, defusing: false, channelT: 0,
    mesh: null, kills: 0, deaths: 0,
  };
  const def = WEAPONS[b.current];
  b.ammo[b.current] = { mag: def.mag, reserve: Infinity };
  b.ammo.p9 = { mag: 12, reserve: Infinity };
  return b;
}

export function buildBotMesh(scene, bot) {
  const g = new THREE.Group();
  const teamCol = bot.team === 'atk' ? 0xd88a2a : 0x3a6ad8;
  const cloth = new THREE.MeshLambertMaterial({ color: teamCol });
  const dark = new THREE.MeshLambertMaterial({ color: 0x22242a });
  const skin = new THREE.MeshLambertMaterial({ color: 0xc8a080 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.36), cloth);
  body.position.y = 1.05;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), skin);
  head.position.y = 1.62;
  const helm = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.14, 0.38), dark);
  helm.position.y = 1.82;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.68, 0.24), dark);
  legL.position.set(-0.16, 0.34, 0);
  const legR = legL.clone();
  legR.position.x = 0.16;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.7), dark);
  gun.position.set(0.3, 1.25, 0.3);
  // team marker: small floating chevron above the head
  const mark = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.3, 4),
    new THREE.MeshBasicMaterial({ color: teamCol }));
  mark.position.y = 2.15; mark.rotation.x = Math.PI;
  g.add(body, head, helm, legL, legR, gun, mark);
  g.position.copy(bot.pos);
  scene.add(g);
  bot.mesh = g;
  bot.mark = mark;
  return g;
}

function setPath(g, bot, targetWp) {
  const from = nearestWaypoint(g.world, bot.pos.x, bot.pos.z);
  bot.path = findPath(g.world, from, targetWp);
  bot.pathI = 0;
}

function callout(g, bot, text) {
  if (g.hud && g.hud.radio) g.hud.radio(bot.name, text, bot.team);
}

function nearestEnemy(g, bot) {
  let best = null, bestD = Infinity;
  const consider = (e) => {
    if (e === bot || !e.alive || e.team === bot.team) return;
    const d = Math.hypot(e.pos.x - bot.pos.x, e.pos.z - bot.pos.z);
    if (d < bestD) { bestD = d; best = e; }
  };
  consider(g.player);
  for (const b of g.bots) consider(b);
  return best ? { ent: best, dist: bestD } : null;
}

// Can bot see ent right now? Range + FOV + line of sight + not blinded.
function canSee(g, bot, ent) {
  if (bot.blindT > 0) return false;
  _d.set(ent.pos.x - bot.pos.x, 0, ent.pos.z - bot.pos.z);
  const dist = _d.length();
  if (dist > VIEW_RANGE) return false;
  _d.multiplyScalar(1 / dist);
  const fwdX = -Math.sin(bot.yaw), fwdZ = -Math.cos(bot.yaw);
  if (_d.x * fwdX + _d.z * fwdZ < FOV_DOT && dist > 4) return false;
  const eyeY = bot.pos.y + 1.5;
  return !losBlocked(g.world, bot.pos.x, eyeY, bot.pos.z,
    ent.pos.x, ent.pos.y + 1.2, ent.pos.z);
}

function siteWaypoint(g, site) {
  return site === 'A' ? 6 : 16;
}
function holdWaypoint(g, bot) {
  // defenders hold just outside their site, watching a lane
  if (bot.site === 'A') return bot.idx % 2 === 0 ? 19 : 21;
  return bot.idx % 2 === 0 ? 20 : 22;
}

export function updateBots(g, dt) {
  const now = g.time;
  for (const bot of g.bots) {
    if (!bot.alive) { if (bot.mesh) bot.mesh.visible = false; continue; }
    if (bot.blindT > 0) bot.blindT -= dt;
    if (bot.cooldown > 0) bot.cooldown -= dt;
    if (bot.strafeT > 0) bot.strafeT -= dt;

    // --- decide what to do ---
    const plant = g.plant;
    if (bot.team === 'atk') {
      if (plant.state === 'planted') bot.state = 'defend';
      else if (bot.state === 'push' || bot.state === 'plant') {
        const s = g.world.sites[bot.site];
        const dSite = Math.hypot(bot.pos.x - s.x, bot.pos.z - s.z);
        const near = nearestEnemy(g, bot);
        const siteClear = !near || near.dist > 14;
        if (dSite < 4.5 && siteClear && plant.state === 'none') bot.state = 'plant';
        else if (bot.state === 'plant' && (dSite > 6 || !siteClear)) bot.state = 'push';
      }
    } else {
      if (plant.state === 'planted') {
        // closest living defender goes to defuse, the rest cover the site
        const defs = g.bots.filter((b) => b.alive && b.team === 'def');
        defs.sort((a, b) => Math.hypot(a.pos.x - plant.x, a.pos.z - plant.z) - Math.hypot(b.pos.x - plant.x, b.pos.z - plant.z));
        bot.state = (defs[0] === bot) ? 'defuse' : 'defend';
      } else if (bot.state === 'defend') bot.state = 'hold';
    }

    // --- announce intent: tactics the player can see and hear ---
    const sig = bot.state + ':' + (bot.state === 'push' || bot.state === 'plant' || bot.state === 'defend' ? bot.site : '');
    if (sig !== bot._called) {
      bot._called = sig;
      if (bot.state === 'push') callout(g, bot, 'pushing Site ' + bot.site);
      else if (bot.state === 'plant') callout(g, bot, 'planting at Site ' + bot.site + ' — cover me');
      else if (bot.state === 'defuse') callout(g, bot, 'defusing the charge!');
      else if (bot.state === 'defend') callout(g, bot, 'defending Site ' + (plant.site || bot.site));
      else if (bot.state === 'rotate') callout(g, bot, 'rotating — heard shots');
      else if (bot.state === 'hold') callout(g, bot, 'holding Site ' + bot.site);
    }

    // --- sensing: nearest VISIBLE enemy wins, not just the nearest one ---
    let seen = null, seenD = Infinity;
    const scan = (e) => {
      if (!e.alive || e.team === bot.team) return;
      const d = Math.hypot(e.pos.x - bot.pos.x, e.pos.z - bot.pos.z);
      if (d < seenD && d < VIEW_RANGE && canSee(g, bot, e)) { seenD = d; seen = e; }
    };
    scan(g.player);
    for (const b of g.bots) scan(b);
    if (seen) {
      bot.lastSeen.set(seen.pos.x, seen.pos.y, seen.pos.z);
      bot.lastSeenT = now;
      if (bot.enemy !== seen) { bot.enemy = seen; bot.reactT = 0.38 + Math.random() * 0.28; bot.aimT = 0; }
    }
    if (bot.enemy && (!bot.enemy.alive || now - bot.lastSeenT > 2.5)) bot.enemy = null;
    // hearing: recent gunfire pulls defenders toward it
    if (!seen && bot.team === 'def' && g.lastShot && now - g.lastShot.t < 1.2 &&
        g.lastShot.team !== 'def' && bot.state === 'hold') {
      const d = Math.hypot(g.lastShot.x - bot.pos.x, g.lastShot.z - bot.pos.z);
      if (d < 38) {
        bot.state = 'rotate';
        setPath(g, bot, nearestWaypoint(g.world, g.lastShot.x, g.lastShot.z));
        bot.waitT = 2.5;
      }
    }
    if (bot.state === 'rotate') {
      bot.waitT -= dt;
      if (bot.waitT <= 0) { bot.state = 'hold'; setPath(g, bot, holdWaypoint(g, bot)); }
    }

    // --- movement target ---
    let targetWp = -1, speedMul = 1;
    if (bot.enemy && bot.state !== 'plant' && bot.state !== 'defuse') {
      // combat: hold ground, strafe; only advance if far and unseen for a while
      const d = Math.hypot(bot.enemy.pos.x - bot.pos.x, bot.enemy.pos.z - bot.pos.z);
      if (d > 26 && now - bot.lastSeenT > 1.0) {
        targetWp = nearestWaypoint(g.world, bot.enemy.pos.x, bot.enemy.pos.z);
      }
    } else if (bot.state === 'push') {
      targetWp = siteWaypoint(g, bot.site);
    } else if (bot.state === 'hold') {
      targetWp = holdWaypoint(g, bot);
    } else if (bot.state === 'defend') {
      targetWp = siteWaypoint(g, plant.site || bot.site);
    } else if (bot.state === 'defuse') {
      // waypoint-route while far, then steer straight at the charge
      const dCh = Math.hypot(plant.x - bot.pos.x, plant.z - bot.pos.z);
      targetWp = dCh > 3 ? nearestWaypoint(g.world, plant.x, plant.z) : -1;
    } else if (bot.state === 'plant') {
      targetWp = -1; // stand still and channel
    }
    // retreat when badly hurt and an enemy is close (also stops any channel)
    bot.retreating = bot.hp < 35 && !!bot.enemy;
    if (bot.retreating) {
      if (!bot._retreatSaid) { bot._retreatSaid = true; callout(g, bot, 'falling back — hurt'); }
      const away = nearestWaypoint(g.world,
        bot.pos.x + (bot.pos.x - bot.enemy.pos.x),
        bot.pos.z + (bot.pos.z - bot.enemy.pos.z));
      targetWp = away;
      speedMul = 1.15;
    }

    // --- follow path ---
    bot.moving = false;
    if (targetWp >= 0) {
      if (bot.path.length === 0 || bot.path[bot.path.length - 1] !== targetWp) setPath(g, bot, targetWp);
      const wp = g.world.waypoints[bot.path[bot.pathI]];
      if (!wp) {
        // path finished but still far from its goal (shoved off course): re-path
        const goal = g.world.waypoints[bot.path[bot.path.length - 1]];
        if (goal && Math.hypot(bot.pos.x - goal.x, bot.pos.z - goal.z) > 1.5) bot.path = [];
      } else {
        const dx = wp.x - bot.pos.x, dz = wp.z - bot.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.9) { bot.pathI++; }
        else {
          bot.moving = true;
          // strafe perpendicular while in combat
          let mx = dx / d, mz = dz / d;
          if (bot.enemy && bot.strafeT > 0) {
            const px = -mz * bot.strafeDir, pz = mx * bot.strafeDir;
            mx = (mx + px * 0.8); mz = (mz + pz * 0.8);
            const l = Math.hypot(mx, mz) || 1; mx /= l; mz /= l;
          }
          bot.vel.x = mx * BOT_SPEED * speedMul;
          bot.vel.z = mz * BOT_SPEED * speedMul;
          bot.yaw = Math.atan2(-mx, -mz);
        }
      }
    }
    // defuser close to the charge steers straight at it, not at a waypoint
    else if (targetWp === -1 && bot.state === 'defuse' && plant.state === 'planted') {
      const dx = plant.x - bot.pos.x, dz = plant.z - bot.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 1.6) {
        bot.moving = true;
        bot.vel.x = (dx / d) * BOT_SPEED;
        bot.vel.z = (dz / d) * BOT_SPEED;
        bot.yaw = Math.atan2(-(dx / d), -(dz / d));
      }
    }
    if (!bot.moving) { bot.vel.x = 0; bot.vel.z = 0; }
    bot.spreadMove = bot.moving ? 0.6 : 0;
    moveBody(g.world, bot.pos, 0.38, 1.75, bot.vel, dt);

    // --- plant / defuse channels ---
    bot.planting = false; bot.defusing = false;
    if (bot.state === 'plant' && plant.state === 'none' && !bot.retreating) {
      // only channel while actually standing on the site
      const s = g.world.sites[bot.site];
      if (Math.hypot(bot.pos.x - s.x, bot.pos.z - s.z) < 5.5) {
        bot.planting = true;
        plant.progress += dt;
        plant.planter = bot;
        if (plant.progress >= 3) {
          plant.site = bot.site;
          g.onPlant(bot); // onPlant sets state/fuse and guards against a double plant
        }
      }
    }
    if (bot.state === 'defuse' && plant.state === 'planted') {
      const d = Math.hypot(bot.pos.x - plant.x, bot.pos.z - plant.z);
      if (d < 2.2) {
        bot.defusing = true;
        plant.defuseProgress += dt;
        if (plant.defuseProgress >= 5) g.onDefuse(bot);
      }
    }

    // --- combat ---
    if (bot.enemy && bot.reactT > 0) bot.reactT -= dt;
    if (seen) bot.aimT += dt;
    else bot.aimT = Math.max(0, bot.aimT - dt * 2); // aim error grows back once LOS breaks
    if (bot.enemy && bot.reactT <= 0 && bot.state !== 'plant' && bot.state !== 'defuse') {
      if (bot.ammo[bot.current].mag === 0 && !bot.reloading) autoReload(g, bot);
      // face the enemy
      const e = bot.enemy;
      bot.yaw = Math.atan2(-(e.pos.x - bot.pos.x), -(e.pos.z - bot.pos.z));
      const dist = Math.hypot(e.pos.x - bot.pos.x, e.pos.z - bot.pos.z);
      if (bot.burstPause > 0) bot.burstPause -= dt;
      else if (bot.burstLeft <= 0) {
        bot.burstLeft = 3 + Math.floor(Math.random() * 3);
        bot.burstPause = 0.15;
        if (Math.random() < 0.4) { bot.strafeDir *= -1; bot.strafeT = 0.7; }
      } else if (canSee(g, bot, e) || now - bot.lastSeenT < 0.4) {
        // aim with error that shrinks as the bot settles on target
        const err = Math.max(0.012, 0.055 - bot.aimT * 0.012) + dist * 0.00045 + (bot.moving ? 0.02 : 0);
        _t.set(e.pos.x - bot.pos.x, e.pos.y + 1.1 - (bot.pos.y + 1.5), e.pos.z - bot.pos.z).normalize();
        _t.x += (Math.random() - 0.5) * 2 * err;
        _t.y += (Math.random() - 0.5) * 2 * err * 0.8;
        _t.z += (Math.random() - 0.5) * 2 * err;
        _t.normalize();
        // only count a shot as fired if the weapon actually goes off
        if (fireWeapon(g, bot, _t)) {
          bot.burstLeft--;
          g.lastShot = { x: bot.pos.x, z: bot.pos.z, t: now, team: bot.team };
          if (bot.ammo[bot.current].mag === 0) autoReload(g, bot);
        }
        if (bot.burstLeft <= 0) bot.burstPause = 0.55 + Math.random() * 0.5;
      }
    }

    // --- separation: don't stack on teammates ---
    for (const o of g.bots) {
      if (o === bot || !o.alive) continue;
      const dx = bot.pos.x - o.pos.x, dz = bot.pos.z - o.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 0.64 && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        bot.pos.x += (dx / d) * (0.8 - d) * 0.5;
        bot.pos.z += (dz / d) * (0.8 - d) * 0.5;
      }
    }

    // --- mesh sync ---
    if (bot.mesh) {
      bot.mesh.position.copy(bot.pos);
      bot.mesh.rotation.y = bot.yaw;
      bot.mesh.visible = bot.alive;
      if (bot.mark) {
        bot.mark.visible = bot.team === 'atk';
        bot.mark.position.y = 2.15 + Math.sin(now * 2 + bot.idx) * 0.08;
      }
    }
  }
}

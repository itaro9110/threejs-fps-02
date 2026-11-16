// weapon.js — weapon definitions, hitscan firing, tracers, reload, grenades.
import * as THREE from 'three';
import { rayWorld, losBlocked } from './world.js';
import { eyeDir } from './player.js';

// id, name, price, damage, headshot multiplier, fire interval (s), mag, reserve,
// reload time (s), spread base (rad), move spread, auto?, zoom?
export const WEAPONS = {
  p9:      { id: 'p9', name: 'P9 SIDEARM', price: 0, dmg: 26, hs: 2, rate: 0.16, mag: 12, reserve: Infinity, reload: 1.1, spread: 0.011, moveSpread: 0.02, auto: false, kick: 0.011, range: 60 },
  kestrel: { id: 'kestrel', name: 'KESTREL RIFLE', price: 2700, dmg: 30, hs: 2, rate: 0.11, mag: 30, reserve: 90, reload: 2.2, spread: 0.008, moveSpread: 0.028, auto: true, kick: 0.016, range: 90 },
  jackal:  { id: 'jackal', name: 'JACKAL SMG', price: 1500, dmg: 21, hs: 2, rate: 0.075, mag: 28, reserve: 84, reload: 1.9, spread: 0.013, moveSpread: 0.024, auto: true, kick: 0.010, range: 55 },
  longbow: { id: 'longbow', name: 'LONGBOW DMR', price: 4000, dmg: 82, hs: 4, rate: 0.95, mag: 5, reserve: 15, reload: 2.8, spread: 0.001, moveSpread: 0.05, auto: false, kick: 0.055, range: 120, scope: true },
  mauler:  { id: 'mauler', name: 'MAULER SHOTGUN', price: 2100, dmg: 15, hs: 2, rate: 0.85, mag: 6, reserve: 24, reload: 2.6, spread: 0.045, moveSpread: 0.03, auto: false, kick: 0.05, range: 30, pellets: 8 },
};
export const GRENADE_PRICE = { frag: 300, flash: 200 };
export const SHOP = [
  { kind: 'weapon', id: 'kestrel', desc: 'Full-auto rifle. The workhorse: steady, lethal, honest at every range.' },
  { kind: 'weapon', id: 'jackal', desc: 'Fast SMG for close lanes. Huge fire rate, hungry for ammo.' },
  { kind: 'weapon', id: 'longbow', desc: 'Heavy DMR. One chest shot nearly kills; a headshot always does. Right-click to scope.' },
  { kind: 'weapon', id: 'mauler', desc: 'Pump shotgun. Eight pellets at once — brutal up close, useless past mid-range.' },
  { kind: 'grenade', id: 'frag', desc: 'Fragmentation grenade. Bounces, then shreds everyone nearby.' },
  { kind: 'grenade', id: 'flash', desc: 'Flashbang. Whites out anyone looking at it — bots included.' },
];

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _tmp = new THREE.Vector3();

// Ray vs sphere. Returns t or Infinity.
function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return Infinity;
  return tca - Math.sqrt(r2 - d2);
}

// Find the nearest entity hit by a ray. Returns {ent, t, head} or null.
function rayEntities(g, shooter, ox, oy, oz, dx, dy, dz, maxD) {
  let best = null, bestT = maxD;
  const test = (ent) => {
    if (ent === shooter || !ent.alive) return;
    const px = ent.pos.x, pz = ent.pos.z, py = ent.pos.y;
    const th = raySphere(ox, oy, oz, dx, dy, dz, px, py + 1.52, pz, 0.24);
    if (th < bestT) { bestT = th; best = { ent, t: th, head: true }; return; }
    const tb = raySphere(ox, oy, oz, dx, dy, dz, px, py + 0.9, pz, 0.45);
    if (tb < bestT) { bestT = tb; best = { ent, t: tb, head: false }; }
  };
  test(g.player);
  for (const b of g.bots) test(b);
  return best;
}

// Spread: base + movement + airborne + firing bloom. Returns radians.
export function spreadFor(shooter, def) {
  let s = def.spread + shooter.spreadMove * def.moveSpread;
  if (!shooter.grounded) s += def.moveSpread * 1.4;
  if (shooter.crouched) s *= 0.6;
  if (shooter.isPlayer && shooter.bloom) s += shooter.bloom;
  return s;
}

function applySpread(dir, spread) {
  const a = Math.random() * Math.PI * 2;
  const r = Math.random() * spread;
  // perturb in a plane perpendicular to dir (approx via yaw/pitch jitter)
  const yaw = Math.atan2(-dir.x, -dir.z) + Math.cos(a) * r;
  const pitch = Math.asin(Math.max(-1, Math.min(1, dir.y))) + Math.sin(a) * r;
  const cp = Math.cos(pitch);
  dir.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}

// Fire one hitscan shot. shooter: player or bot. dirOverride for bots.
export function fireWeapon(g, shooter, dirOverride) {
  const def = WEAPONS[shooter.current];
  if (!def || shooter.cooldown > 0 || shooter.reloading) return false;
  const ammo = shooter.ammo[def.id];
  if (!ammo || ammo.mag <= 0) {
    if (shooter.isPlayer) { g.audio.dry(); autoReload(g, shooter); }
    return false;
  }
  ammo.mag--;
  shooter.cooldown = def.rate;
  if (shooter.isPlayer) {
    shooter.bloom = Math.min(0.03, (shooter.bloom || 0) + (def.id === 'longbow' ? 0.02 : 0.006));
    shooter.recoilVel += def.kick * 55;
    shooter.vmKick = 1;
  }

  // One trigger pull = one ray per pellet (shotguns fire 8 at once).
  const pellets = def.pellets || 1;
  let tracerDone = false;
  for (let pi = 0; pi < pellets; pi++) {
    if (shooter.isPlayer) eyeDir(g, _o, _d);
    else {
      _o.set(shooter.pos.x, shooter.pos.y + 1.5, shooter.pos.z);
      _d.copy(dirOverride);
    }
    applySpread(_d, spreadFor(shooter, def));
    const wallT = rayWorld(g.world, _o.x, _o.y, _o.z, _d.x, _d.y, _d.z, def.range);
    const hit = rayEntities(g, shooter, _o.x, _o.y, _o.z, _d.x, _d.y, _d.z, Math.min(wallT, def.range));
    let endT = wallT;
    if (hit) {
      endT = hit.t;
      const falloff = Math.max(0.55, 1 - hit.t / (def.range * 1.6));
      const dmg = def.dmg * falloff * (hit.head ? def.hs : 1);
      g.damage(hit.ent, dmg, hit.head, shooter);
      if (shooter.isPlayer) g.hud.hitmark(hit.head);
    }
    if (!tracerDone) {
      tracerDone = true;
      _hit.copy(_o).addScaledVector(_d, Math.min(endT, def.range));
      spawnTracer(g, _o, _hit);
    }
  }
  g.audio.shot(def.id, !shooter.isPlayer);
  return true;
}

export function autoReload(g, shooter) {
  const def = WEAPONS[shooter.current];
  const ammo = shooter.ammo[def.id];
  if (!def || !ammo || shooter.reloading) return;
  if (ammo.reserve === 0 || ammo.mag === def.mag) return;
  shooter.reloading = true;
  shooter.reloadT = def.reload;
  if (shooter.isPlayer) g.audio.reload();
}

// Called every fixed step: finish reloads.
export function updateWeapons(g, dt) {
  const tick = (e) => {
    if (!e.reloading) return;
    e.reloadT -= dt;
    if (e.reloadT <= 0) {
      e.reloading = false;
      const def = WEAPONS[e.current];
      const ammo = e.ammo[def.id];
      const need = def.mag - ammo.mag;
      if (ammo.reserve === Infinity) ammo.mag = def.mag;
      else { const take = Math.min(need, ammo.reserve); ammo.mag += take; ammo.reserve -= take; }
    }
  };
  tick(g.player);
  for (const b of g.bots) tick(b);
  // bloom decay
  const p = g.player;
  if (p.bloom) p.bloom = Math.max(0, p.bloom - dt * 0.05);
  updateProjectiles(g, dt);
  updateTracers(g, dt);
}

// --- tracers: pooled lines, no per-frame allocation ---
let tracerPool = null;
export function initTracers(scene) {
  tracerPool = [];
  for (let i = 0; i < 24; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0 });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    line.visible = false;
    scene.add(line);
    tracerPool.push({ line, life: 0 });
  }
}
function spawnTracer(g, from, to) {
  if (!tracerPool) return;
  for (const t of tracerPool) {
    if (t.life > 0) continue;
    const pos = t.line.geometry.attributes.position.array;
    pos[0] = from.x; pos[1] = from.y; pos[2] = from.z;
    pos[3] = to.x; pos[4] = to.y; pos[5] = to.z;
    t.line.geometry.attributes.position.needsUpdate = true;
    t.line.material.opacity = 0.9;
    t.line.visible = true;
    t.life = 0.08;
    return;
  }
}
function updateTracers(g, dt) {
  if (!tracerPool) return;
  for (const t of tracerPool) {
    if (t.life <= 0) continue;
    t.life -= dt;
    t.line.material.opacity = Math.max(0, t.life / 0.08) * 0.9;
    if (t.life <= 0) t.line.visible = false;
  }
}

// --- grenades ---
const grenades = [];
let grenadeMeshes = [];
export function initGrenades(scene) {
  grenadeMeshes = [];
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6),
      new THREE.MeshLambertMaterial({ color: 0x2a2d33 }));
    m.visible = false;
    scene.add(m);
    grenadeMeshes.push(m);
  }
}
export function throwGrenade(g, shooter, type) {
  if (shooter.isPlayer) {
    if (shooter.weapons[type] <= 0) return false;
    shooter.weapons[type]--;
  }
  const mesh = grenadeMeshes.find((m) => !m.visible);
  if (!mesh) return false;
  let dir;
  if (shooter.isPlayer) { eyeDir(g, _o, _d); dir = _d; }
  else { dir = _tmp.set(Math.sin(shooter.yaw) * -1, 0.25, Math.cos(shooter.yaw) * -1).normalize(); }
  const pos = shooter.isPlayer
    ? new THREE.Vector3(_o.x, _o.y - 0.1, _o.z)
    : new THREE.Vector3(shooter.pos.x, shooter.pos.y + 1.4, shooter.pos.z);
  grenades.push({
    type, mesh, pos, vel: new THREE.Vector3(dir.x * 15, dir.y * 15 + 3.5, dir.z * 15),
    fuse: type === 'frag' ? 1.7 : 1.3, owner: shooter,
  });
  mesh.visible = true;
  mesh.position.copy(pos);
  if (shooter.isPlayer) g.audio.click();
  return true;
}
function updateProjectiles(g, dt) {
  for (let i = grenades.length - 1; i >= 0; i--) {
    const gr = grenades[i];
    gr.vel.y -= 16 * dt;
    gr.pos.addScaledVector(gr.vel, dt);
    // bounce off world boxes (cheap: sample point vs colliders)
    for (const c of g.world.colliders) {
      if (gr.pos.x > c.min.x - 0.09 && gr.pos.x < c.max.x + 0.09 &&
          gr.pos.y > c.min.y - 0.09 && gr.pos.y < c.max.y + 0.09 &&
          gr.pos.z > c.min.z - 0.09 && gr.pos.z < c.max.z + 0.09) {
        // push out on smallest penetration axis, reflect that component
        const dxl = gr.pos.x - (c.min.x - 0.09), dxr = (c.max.x + 0.09) - gr.pos.x;
        const dyl = gr.pos.y - (c.min.y - 0.09), dyr = (c.max.y + 0.09) - gr.pos.y;
        const dzl = gr.pos.z - (c.min.z - 0.09), dzr = (c.max.z + 0.09) - gr.pos.z;
        const m = Math.min(dxl, dxr, dyl, dyr, dzl, dzr);
        if (m === dxl) { gr.pos.x = c.min.x - 0.09; gr.vel.x = -Math.abs(gr.vel.x) * 0.45; }
        else if (m === dxr) { gr.pos.x = c.max.x + 0.09; gr.vel.x = Math.abs(gr.vel.x) * 0.45; }
        else if (m === dyl) { gr.pos.y = c.min.y - 0.09; gr.vel.y = -Math.abs(gr.vel.y) * 0.45; }
        else if (m === dyr) { gr.pos.y = c.max.y + 0.09; gr.vel.y = Math.abs(gr.vel.y) * 0.45; }
        else if (m === dzl) { gr.pos.z = c.min.z - 0.09; gr.vel.z = -Math.abs(gr.vel.z) * 0.45; }
        else { gr.pos.z = c.max.z + 0.09; gr.vel.z = Math.abs(gr.vel.z) * 0.45; }
      }
    }
    if (gr.pos.y < 0.09) { gr.pos.y = 0.09; gr.vel.y = Math.abs(gr.vel.y) * 0.45; gr.vel.x *= 0.7; gr.vel.z *= 0.7; }
    gr.mesh.position.copy(gr.pos);
    gr.fuse -= dt;
    if (gr.fuse <= 0) {
      explode(g, gr);
      gr.mesh.visible = false;
      grenades.splice(i, 1);
    }
  }
}
function explode(g, gr) {
  if (gr.type === 'frag') {
    g.audio.explosion();
    g.hud.explosionFlash(gr.pos);
    const targets = [g.player, ...g.bots];
    for (const t of targets) {
      if (!t.alive || t === gr.owner) continue;
      const d = Math.hypot(t.pos.x - gr.pos.x, t.pos.y + 0.9 - gr.pos.y, t.pos.z - gr.pos.z);
      if (d > 9) continue;
      if (losBlocked(g.world, gr.pos.x, gr.pos.y, gr.pos.z, t.pos.x, t.pos.y + 0.9, t.pos.z)) continue;
      g.damage(t, Math.max(12, 110 * (1 - d / 9)), false, gr.owner);
    }
  } else {
    g.audio.flashbang();
    g.hud.flashEffect(gr.pos);
    const targets = [g.player, ...g.bots];
    for (const t of targets) {
      if (!t.alive || t === gr.owner) continue;
      const d = Math.hypot(t.pos.x - gr.pos.x, t.pos.y + 1.4 - gr.pos.y, t.pos.z - gr.pos.z);
      if (d > 26) continue;
      if (losBlocked(g.world, gr.pos.x, gr.pos.y, gr.pos.z, t.pos.x, t.pos.y + 1.4, t.pos.z)) continue;
      // facing factor: looking toward the flash blinds harder
      let facing = 1;
      if (t.isPlayer) {
        eyeDir(g, _o, _d);
        _tmp.set(gr.pos.x - _o.x, gr.pos.y - _o.y, gr.pos.z - _o.z).normalize();
        facing = Math.max(0.25, _d.dot(_tmp));
      } else {
        _tmp.set(gr.pos.x - t.pos.x, 0, gr.pos.z - t.pos.z).normalize();
        const fwd = { x: -Math.sin(t.yaw), z: -Math.cos(t.yaw) };
        facing = Math.max(0.25, fwd.x * _tmp.x + fwd.z * _tmp.z);
      }
      const dur = (2.6 * (1 - d / 30) + 0.4) * facing;
      if (t.isPlayer) { t.flashT = Math.max(t.flashT, dur); t.blindT = Math.max(t.blindT, dur * 0.7); }
      else t.blindT = Math.max(t.blindT || 0, dur);
    }
  }
}

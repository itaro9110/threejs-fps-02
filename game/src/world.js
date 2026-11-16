// world.js — the Foundry Yard map, AABB collision, raycasts, waypoint graph.
import * as THREE from 'three';

const _v = new THREE.Vector3(); // reused scratch
const _v2 = new THREE.Vector3();

function makeMats() {
  const cache = new Map();
  return (color, emissive = 0) => {
    const key = color + ':' + emissive;
    if (!cache.has(key)) {
      cache.set(key, new THREE.MeshLambertMaterial({
        color, emissive, emissiveIntensity: emissive ? 0.9 : 0,
      }));
    }
    return cache.get(key);
  };
}

export function createWorld(scene) {
  const mat = makeMats();
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const world = {
    colliders: [], sites: {}, spawns: {}, waypoints: [], bounds: { x: 42, z: 32 },
  };

  // --- lights & sky (dusk palette) ---
  scene.background = new THREE.Color(0x232c3d);
  scene.fog = new THREE.Fog(0x232c3d, 55, 130);
  const hemi = new THREE.HemisphereLight(0xffd9a8, 0x2a313e, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb36b, 1.6);
  sun.position.set(-30, 42, -18);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x6f86b8, 0.35);
  fill.position.set(25, 30, 25);
  scene.add(fill);

  // --- ground ---
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(84, 64),
    new THREE.MeshLambertMaterial({ color: 0x3b4048 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = false;
  scene.add(ground);
  // darker yard patches for readability
  const patch = (x, z, w, d, c) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
      new THREE.MeshLambertMaterial({ color: c }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.02, z); scene.add(m);
  };
  patch(0, 0, 30, 20, 0x343942);
  patch(28, -20, 18, 16, 0x3e332a); // site A yard
  patch(28, 20, 18, 16, 0x2f363e);  // site B yard

  // --- box helper: adds mesh + collider (unless deco) ---
  function box(x, y, z, w, h, d, color, solid = true, emissive = 0) {
    const m = new THREE.Mesh(boxGeo, mat(color, emissive));
    m.position.set(x, y + h / 2, z);
    m.scale.set(w, h, d);
    scene.add(m);
    if (solid) world.colliders.push({
      min: new THREE.Vector3(x - w / 2, y, z - d / 2),
      max: new THREE.Vector3(x + w / 2, y + h, z + d / 2),
    });
    return m;
  }
  function wall(x, z, w, d, h = 3.4, color = 0x5a6068) { box(x, 0, z, w, h, d, color); }
  function crate(x, z, s, h, color = 0x7a5a34) { box(x, 0, z, s, h, s, color); }

  // --- perimeter ---
  wall(0, -32.5, 85, 1, 5, 0x4a5058);
  wall(0, 32.5, 85, 1, 5, 0x4a5058);
  wall(-42.5, 0, 1, 66, 5, 0x4a5058);
  wall(42.5, 0, 1, 66, 5, 0x4a5058);

  // --- lane divider walls (gaps are the rotations) ---
  wall(-8, -10, 12, 1); wall(8, -10, 12, 1);          // north divider, gap x -2..2
  wall(-8, 10, 12, 1); wall(8, 10, 12, 1);           // south divider, gap x -2..2
  wall(16, -25, 1, 14); wall(16, -12, 1, 4);         // A approach wall, gap z -18..-14
  wall(16, 12, 1, 4); wall(16, 25, 1, 14);           // B approach wall, gap z 14..18
  // spawn cover
  wall(-28, -5, 1, 6); wall(-28, 5, 1, 6);
  wall(28, -5, 1, 6); wall(28, 5, 1, 6);
  // site B warehouse shell (open west side)
  wall(36, 20, 1, 18, 4, 0x525a64);
  wall(28, 28.5, 17, 1, 4, 0x525a64);
  wall(28, 11.5, 17, 1, 4, 0x525a64);

  // --- crates & containers (cover) ---
  crate(-20, -20, 2.4, 2.2); crate(-19, -17.4, 1.6, 1.2, 0x8a6a3a);
  crate(8, -20, 2.2, 1.8); crate(9.5, -22, 1.4, 1.1, 0x6a7a8a);
  crate(-4, 3, 2.6, 2.4); crate(-1.5, 4.5, 1.5, 1.2, 0x8a6a3a);
  crate(5, -4, 2.2, 1.6); crate(7, -2, 1.4, 1.1, 0x5a7a6a);
  crate(-8, -3, 1.8, 1.4, 0x6a7a8a);
  crate(-20, 20, 2.4, 2.2); crate(-19, 17.4, 1.6, 1.2, 0x8a6a3a);
  crate(8, 20, 2.2, 1.8); crate(9.5, 22, 1.4, 1.1, 0x6a7a8a);
  crate(0, -20, 2.0, 1.5, 0x5a7a6a); crate(0, 20, 2.0, 1.5, 0x5a7a6a);
  // site A yard
  box(24, 0, -26, 6, 2.6, 2.4, 0xb05a28);             // rust container
  box(32, 0, -15, 2.4, 2.2, 2.4, 0x3a6a7a);           // teal container
  crate(26, -15, 1.8, 1.4); crate(35, -24, 1.6, 1.2, 0x8a6a3a);
  crate(22, -24, 1.5, 1.1, 0x6a7a8a);
  // site B yard
  box(24, 0, 26, 6, 2.6, 2.4, 0x2a5a8a);              // blue container
  box(32, 0, 15, 2.4, 2.2, 2.4, 0xb05a28);
  crate(26, 15, 1.8, 1.4); crate(35, 24, 1.6, 1.2, 0x8a6a3a);
  crate(22, 24, 1.5, 1.1, 0x6a7a8a);
  // mid-east cover
  crate(12, -5, 1.8, 1.4); crate(12, 5, 1.8, 1.4, 0x6a7a8a);
  crate(-12, -6, 1.6, 1.2, 0x5a7a6a); crate(-12, 6, 1.6, 1.2);

  // --- site markers: glowing ring + beacon poles ---
  function site(name, x, z) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.2, 4.2, 40),
      new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.75, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.05, z); scene.add(ring);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(3.2, 40),
      new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.10 }));
    disc.rotation.x = -Math.PI / 2; disc.position.set(x, 0.04, z); scene.add(disc);
    box(x - 4.4, 0, z - 4.4, 0.3, 2.6, 0.3, 0xff8a2a, false, 0xff8a2a);
    box(x + 4.4, 0, z - 4.4, 0.3, 2.6, 0.3, 0xff8a2a, false, 0xff8a2a);
    box(x - 4.4, 0, z + 4.4, 0.3, 2.6, 0.3, 0xff8a2a, false, 0xff8a2a);
    box(x + 4.4, 0, z + 4.4, 0.3, 2.6, 0.3, 0xff8a2a, false, 0xff8a2a);
    world.sites[name] = { x, z, r: 5 };
  }
  site('A', 28, -20);
  site('B', 28, 20);

  // --- lamp poles (visual landmarks, non-solid above 3m) ---
  function lamp(x, z) {
    box(x, 0, z, 0.25, 5, 0.25, 0x2c313a, false);
    box(x, 5, z, 1.2, 0.3, 0.5, 0xffd9a0, false, 0xffc06a);
  }
  lamp(-20, 0); lamp(0, 0); lamp(20, 0); lamp(28, -20); lamp(28, 20);

  // --- spawns & waypoints ---
  world.spawns.atk = [[-38, 0], [-38, -3], [-38, 3], [-35, -2]];
  world.spawns.def = [[38, -3], [38, 0], [38, 3], [35, 2]];
  const WP = [
    [-36, 0], [-28, 0], [-20, -20], [-8, -20], [6, -20], [14, -16], [28, -20], [34, -24],
    [-20, 0], [0, 0], [8, 0], [16, 0], [-20, 20], [-8, 20], [6, 20], [14, 16],
    [28, 20], [34, 24], [36, 0], [28, -8], [28, 8], [22, -20], [22, 20], [0, -20], [0, 20],
  ];
  const LINKS = [
    [0, 1], [1, 2], [1, 8], [1, 12], [2, 3], [3, 23], [3, 4], [4, 5], [5, 21], [21, 6],
    [6, 7], [6, 19], [19, 18], [18, 20], [20, 16], [20, 11], [11, 10], [10, 9], [9, 8],
    [8, 12], [12, 13], [13, 24], [13, 14], [14, 15], [15, 22], [22, 16], [16, 17],
    [15, 20], [9, 23], [9, 24], [23, 2], [24, 12], [5, 19], [14, 20],
  ];
  world.waypoints = WP.map(([x, z]) => ({ x, z, links: [] }));
  for (const [a, b] of LINKS) {
    world.waypoints[a].links.push(b);
    world.waypoints[b].links.push(a);
  }
  return world;
}

// Axis-separated AABB move. p = feet position (Vector3), half = x/z half extent,
// height = body height. vel is mutated to 0 on blocked axes. Returns {grounded}.
export function moveBody(world, p, half, height, vel, dt) {
  const out = { grounded: false };
  const cols = world.colliders;
  // X
  p.x += vel.x * dt;
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    if (p.x + half > c.min.x && p.x - half < c.max.x &&
        p.y + height > c.min.y && p.y < c.max.y &&
        p.z + half > c.min.z && p.z - half < c.max.z) {
      p.x = vel.x > 0 ? c.min.x - half : c.max.x + half;
      vel.x = 0;
    }
  }
  // Z
  p.z += vel.z * dt;
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    if (p.x + half > c.min.x && p.x - half < c.max.x &&
        p.y + height > c.min.y && p.y < c.max.y &&
        p.z + half > c.min.z && p.z - half < c.max.z) {
      p.z = vel.z > 0 ? c.min.z - half : c.max.z + half;
      vel.z = 0;
    }
  }
  // Y
  p.y += vel.y * dt;
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    if (p.x + half > c.min.x && p.x - half < c.max.x &&
        p.y + height > c.min.y && p.y < c.max.y &&
        p.z + half > c.min.z && p.z - half < c.max.z) {
      if (vel.y <= 0) { p.y = c.max.y; out.grounded = true; }
      else p.y = c.min.y - height;
      vel.y = 0;
    }
  }
  if (p.y <= 0) { p.y = 0; if (vel.y < 0) vel.y = 0; out.grounded = true; }
  // hard bounds
  p.x = Math.max(-41.4, Math.min(41.4, p.x));
  p.z = Math.max(-31.4, Math.min(31.4, p.z));
  return out;
}

// Slab ray vs AABB. Returns nearest t in [0, maxD] or Infinity.
export function rayWorld(world, ox, oy, oz, dx, dy, dz, maxD) {
  let best = Infinity;
  const cols = world.colliders;
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    let t0 = 0, t1 = maxD;
    // X slab
    if (Math.abs(dx) < 1e-9) { if (ox < c.min.x || ox > c.max.x) continue; }
    else {
      let ta = (c.min.x - ox) / dx, tb = (c.max.x - ox) / dx;
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    if (Math.abs(dy) < 1e-9) { if (oy < c.min.y || oy > c.max.y) continue; }
    else {
      let ta = (c.min.y - oy) / dy, tb = (c.max.y - oy) / dy;
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    if (Math.abs(dz) < 1e-9) { if (oz < c.min.z || oz > c.max.z) continue; }
    else {
      let ta = (c.min.z - oz) / dz, tb = (c.max.z - oz) / dz;
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    if (t0 < best) best = t0;
  }
  return best;
}

// True when the segment a->b is blocked by world geometry.
export function losBlocked(world, ax, ay, az, bx, by, bz) {
  _v.set(bx - ax, by - ay, bz - az);
  const d = _v.length();
  if (d < 0.01) return false;
  _v.multiplyScalar(1 / d);
  return rayWorld(world, ax, ay, az, _v.x, _v.y, _v.z, d - 0.05) !== Infinity;
}

export function nearestWaypoint(world, x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < world.waypoints.length; i++) {
    const w = world.waypoints[i];
    const d = (w.x - x) * (w.x - x) + (w.z - z) * (w.z - z);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// BFS over the waypoint graph. Returns array of waypoint indices from->to.
export function findPath(world, from, to) {
  if (from === to) return [to];
  const prev = new Int16Array(world.waypoints.length).fill(-1);
  const q = [from];
  prev[from] = from;
  while (q.length) {
    const cur = q.shift();
    if (cur === to) break;
    for (const n of world.waypoints[cur].links) {
      if (prev[n] === -1) { prev[n] = cur; q.push(n); }
    }
  }
  if (prev[to] === -1) return [to];
  const path = [];
  let c = to;
  while (c !== from) { path.unshift(c); c = prev[c]; }
  return path;
}

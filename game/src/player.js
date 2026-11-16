// player.js — first-person movement, camera, viewmodel gun.
import * as THREE from 'three';
import { moveBody } from './world.js';

const WALK = 5.2, SPRINT = 7.4, CROUCH = 2.6, ACCEL = 42, FRICTION = 11;
const GRAV = 22, JUMP = 7.4, EYE_STAND = 1.62, EYE_CROUCH = 1.12;
const _fwd = new THREE.Vector3();
const _rgt = new THREE.Vector3();

export function createPlayer(world, spawn) {
  const p = {
    isPlayer: true, team: 'atk', name: 'You',
    pos: new THREE.Vector3(spawn[0], 0, spawn[1]),
    vel: new THREE.Vector3(),
    yaw: -Math.PI / 2, pitch: 0, // face east (+x) toward mid
    hp: 100, armor: 0, alive: true,
    crouched: false, sprinting: false, grounded: true, moving: false,
    eyeH: EYE_STAND, eyeTarget: EYE_STAND,
    recoil: 0, recoilVel: 0, spreadMove: 0,
    weapons: { primary: null, sidearm: 'p9', frag: 0, flash: 0 },
    current: 'p9',
    ammo: {}, // weaponId -> {mag, reserve}
    cooldown: 0, reloadT: 0, reloading: false,
    flashT: 0, blindT: 0, lastHurtDir: 0, hurtT: 0,
    stepT: 0, kills: 0, deaths: 0,
    viewmodel: null, vmKick: 0,
  };
  return p;
}

// Build the simple viewmodel gun attached to the camera.
export function buildViewmodel(camera) {
  const g = new THREE.Group();
  const dark = new THREE.MeshLambertMaterial({ color: 0x1c1e24 });
  const mid = new THREE.MeshLambertMaterial({ color: 0x3a3f48 });
  const accent = new THREE.MeshLambertMaterial({ color: 0xb05a28 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.55), dark);
  body.position.set(0, 0, -0.15);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.3), mid);
  barrel.position.set(0, 0.02, -0.55);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.1), dark);
  grip.position.set(0, -0.13, 0.02); grip.rotation.x = 0.35;
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.08), accent);
  sight.position.set(0, 0.1, -0.2);
  g.add(body, barrel, grip, sight);
  g.position.set(0.28, -0.24, -0.5);
  camera.add(g);
  return g;
}

export function updatePlayer(g, dt, input) {
  const p = g.player;
  if (!p.alive) return;
  const w = g.world;

  // --- look (mouse delta already applied to yaw/pitch by input; arrows here) ---
  const lookSpeed = 2.4 * dt;
  if (input.keys.has('ArrowLeft')) p.yaw += lookSpeed;
  if (input.keys.has('ArrowRight')) p.yaw -= lookSpeed;
  if (input.keys.has('ArrowUp')) p.pitch = Math.min(1.5, p.pitch + lookSpeed * 0.7);
  if (input.keys.has('ArrowDown')) p.pitch = Math.max(-1.5, p.pitch - lookSpeed * 0.7);

  // --- stance ---
  p.crouched = input.keys.has('ControlLeft') || input.keys.has('ControlRight');
  p.sprinting = (input.keys.has('ShiftLeft') || input.keys.has('ShiftRight'))
    && !p.crouched && input.moveF > 0;
  p.eyeTarget = p.crouched ? EYE_CROUCH : EYE_STAND;
  p.eyeH += (p.eyeTarget - p.eyeH) * Math.min(1, dt * 12);

  // --- wish direction (camera-relative) ---
  const f = (input.keys.has('KeyW') ? 1 : 0) - (input.keys.has('KeyS') ? 1 : 0);
  const s = (input.keys.has('KeyD') ? 1 : 0) - (input.keys.has('KeyA') ? 1 : 0);
  input.moveF = f;
  _fwd.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
  _rgt.set(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
  const speed = p.crouched ? CROUCH : (p.sprinting ? SPRINT : WALK);
  const wishX = _fwd.x * f + _rgt.x * s;
  const wishZ = _fwd.z * f + _rgt.z * s;
  const wl = Math.hypot(wishX, wishZ) || 1;
  p.moving = (f !== 0 || s !== 0);

  // --- accelerate toward wish velocity, friction when no input ---
  if (p.moving) {
    p.vel.x += (wishX / wl) * ACCEL * dt;
    p.vel.z += (wishZ / wl) * ACCEL * dt;
    // clamp horizontal speed
    const hs = Math.hypot(p.vel.x, p.vel.z);
    if (hs > speed) { p.vel.x *= speed / hs; p.vel.z *= speed / hs; }
  } else {
    const fr = Math.max(0, 1 - FRICTION * dt);
    p.vel.x *= fr; p.vel.z *= fr;
    if (Math.hypot(p.vel.x, p.vel.z) < 0.05) { p.vel.x = 0; p.vel.z = 0; }
  }
  // spread grows with speed
  const hs = Math.hypot(p.vel.x, p.vel.z);
  p.spreadMove = Math.min(1, hs / SPRINT);

  // --- jump & gravity ---
  if (input.jumpQueued && p.grounded) {
    p.vel.y = JUMP; p.grounded = false;
    input.jumpQueued = false;
  }
  p.vel.y -= GRAV * dt;
  if (p.vel.y < -18) p.vel.y = -18;

  const res = moveBody(w, p.pos, 0.38, p.crouched ? 1.25 : 1.75, p.vel, dt);
  p.grounded = res.grounded;

  // --- footsteps ---
  if (p.moving && p.grounded) {
    p.stepT -= dt * (p.sprinting ? 1.6 : 1);
    if (p.stepT <= 0) { p.stepT = 0.42; g.audio.footstep(p.sprinting); }
  }

  // --- recoil spring (view kick decays) ---
  p.recoilVel += -p.recoil * 90 * dt;
  p.recoilVel *= Math.max(0, 1 - 10 * dt);
  p.recoil += p.recoilVel * dt;
  if (p.recoil < 0) { p.recoil = 0; p.recoilVel = 0; }
  p.vmKick = Math.max(0, p.vmKick - dt * 6);

  // --- timers ---
  if (p.cooldown > 0) p.cooldown -= dt;
  if (p.flashT > 0) p.flashT -= dt;
  if (p.blindT > 0) p.blindT -= dt;
  if (p.hurtT > 0) p.hurtT -= dt;

  // --- camera ---
  const cam = g.camera;
  cam.position.set(p.pos.x, p.pos.y + p.eyeH, p.pos.z);
  cam.rotation.order = 'YXZ';
  cam.rotation.y = p.yaw;
  cam.rotation.x = p.pitch + p.recoil;
  cam.rotation.z = 0;
  if (p.viewmodel) {
    p.viewmodel.position.z = -0.5 + p.vmKick * 0.09;
    p.viewmodel.position.y = -0.24 + p.vmKick * 0.02;
    p.viewmodel.rotation.x = p.vmKick * 0.25;
  }
}

// Eye position + forward dir (reused vectors live on g for hot loops).
export function eyeDir(g, outPos, outDir) {
  const p = g.player;
  outPos.set(p.pos.x, p.pos.y + p.eyeH, p.pos.z);
  outDir.set(-Math.sin(p.yaw) * Math.cos(p.pitch + p.recoil),
    Math.sin(p.pitch + p.recoil),
    -Math.cos(p.yaw) * Math.cos(p.pitch + p.recoil));
}

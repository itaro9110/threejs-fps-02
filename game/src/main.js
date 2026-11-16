// main.js — bootstrap: renderer, scene, input, fixed-step loop, render.
// Simulation runs at a fixed 60 Hz, apart from rendering.
import * as THREE from 'three';
import { createWorld } from './world.js';
import { createGame, startMatch, spawnTeams, updateGame, applyDamage, onPlant, onDefuse, buyItem, switchWeapon, tryFire, tryReload } from './game.js';
import { createPlayer, buildViewmodel, updatePlayer } from './player.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';
import { buildBotMesh, updateBots } from './bots.js';
import { initTracers, initGrenades, updateWeapons, throwGrenade, SHOP } from './weapon.js';

const STEP = 1 / 60;
const app = document.getElementById('app');

// --- renderer / scene / camera ---
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  document.getElementById('webglerr').classList.remove('hidden');
  const btn = document.getElementById('playbtn');
  btn.disabled = true;
  btn.textContent = 'WEBGL UNAVAILABLE';
  throw e;
}
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.domElement.className = 'webgl';
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.08, 220);
camera.rotation.order = 'YXZ';
scene.add(camera);

// --- world & game state ---
const world = createWorld(scene);
const g = createGame();
g.world = world; g.scene = scene; g.camera = camera;
g.audio = createAudio();
g.player = createPlayer(world, world.spawns.atk[0]);
g.player.viewmodel = buildViewmodel(camera);
g.hud = createHud(g);
g.damage = (t, d, h, a) => applyDamage(g, t, d, h, a);
g.onPlant = (b) => onPlant(g, b);
g.onDefuse = (b) => onDefuse(g, b);
g.buyItem = (item) => buyItem(g, item);
initTracers(scene);
initGrenades(scene);
// charge mesh (the planted bomb)
const charge = new THREE.Group();
const chargeBody = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.35),
  new THREE.MeshLambertMaterial({ color: 0x8a2a1a, emissive: 0xff2a00, emissiveIntensity: 0.7 }));
const chargeLight = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6),
  new THREE.MeshBasicMaterial({ color: 0xff3020 }));
chargeLight.position.set(0, 0.2, 0);
charge.add(chargeBody, chargeLight);
charge.visible = false;
scene.add(charge);
g.chargeMesh = charge;

// --- input ---
const input = {
  keys: new Set(), moveF: 0, jumpQueued: false, plantHeld: false,
  fireHeld: false, scoped: false, locked: false,
};
g.input = input;

addEventListener('keydown', (e) => {
  if (e.repeat) return;
  input.keys.add(e.code);
  if (e.code === 'Space') { input.jumpQueued = true; e.preventDefault(); }
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'KeyB' && g.phase === 'buy') toggleBuy();
  if (e.code === 'KeyR') tryReload(g);
  if (e.code === 'KeyE') input.plantHeld = true;
  if (g.phase === 'buy') {
    // quick-buy keys during buy time (digits buy; they do not switch or throw)
    if (e.code === 'Digit2') buyKey('kestrel');
    else if (e.code === 'Digit3') buyKey('jackal');
    else if (e.code === 'Digit4') buyKey('longbow');
    else if (e.code === 'Digit5') buyKey('mauler');
  } else {
    if (e.code === 'Digit1') switchWeapon(g, 'p9');
    if (e.code === 'Digit2' && g.player.weapons.primary) switchWeapon(g, g.player.weapons.primary);
    if (e.code === 'Digit4') throwGrenade(g, g.player, 'frag');
    if (e.code === 'Digit5') throwGrenade(g, g.player, 'flash');
  }
});
addEventListener('keyup', (e) => {
  input.keys.delete(e.code);
  if (e.code === 'KeyE') input.plantHeld = false;
});
function buyKey(id) {
  const item = SHOP.find((s) => s.id === id);
  if (item && g.buyItem(item)) g.hud.refreshBuy();
}
addEventListener('blur', () => { input.keys.clear(); input.fireHeld = false; input.plantHeld = false; });

renderer.domElement.addEventListener('mousedown', (e) => {
  if (g.phase !== 'live' || !g.player.alive) return;
  if (e.button === 0) {
    input.fireHeld = true;
    tryFire(g, true); // fresh trigger pull (semi-auto fires here)
  }
  if (e.button === 2) {
    input.scoped = true;
    if (g.player.current === 'longbow') camera.fov = 32;
    else camera.fov = 62;
    camera.updateProjectionMatrix();
  }
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) input.fireHeld = false;
  if (e.button === 2) {
    input.scoped = false;
    camera.fov = 78;
    camera.updateProjectionMatrix();
  }
});
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('wheel', (e) => {
  const p = g.player;
  if (!p.alive) return;
  const order = ['p9', p.weapons.primary].filter(Boolean);
  if (order.length < 2) return;
  const i = order.indexOf(p.current);
  switchWeapon(g, order[(i + (e.deltaY > 0 ? 1 : -1) + order.length) % order.length]);
}, { passive: true });
document.addEventListener('mousemove', (e) => {
  if (!input.locked || !g.player.alive) return;
  const p = g.player;
  const sens = input.scoped ? 0.0009 : 0.0022;
  p.yaw -= e.movementX * sens;
  p.pitch = Math.max(-1.5, Math.min(1.5, p.pitch - e.movementY * sens));
});
document.addEventListener('pointerlockchange', () => {
  input.locked = document.pointerLockElement === renderer.domElement;
  // Esc pressed mid-round unlocks the pointer: pause (an open buy menu is intentional)
  if (!input.locked && g.phase === 'live' && g.player.alive && g.hud.els.buy.classList.contains('hidden')) {
    showPause(true);
  }
});
function lockPointer() {
  g.audio.ensure();
  const r = renderer.domElement.requestPointerLock();
  if (r && r.catch) r.catch(() => {}); // headless / denied lock is not fatal
}

// --- screens & buttons ---
const playBtn = document.getElementById('playbtn');
playBtn.addEventListener('click', () => {
  g.audio.ensure();
  g.audio.startMusic();
  g.audio.click();
  g.hud.showTitle(false);
  g.hud.showHud(true);
  startMatch(g);
  lockPointer();
});
document.getElementById('resumebtn').addEventListener('click', () => {
  showPause(false);
  lockPointer();
});
document.getElementById('quitbtn').addEventListener('click', () => {
  g.audio.click();
  g.phase = 'title';
  g.hud.showPause(false);
  g.hud.showBuy(false);
  g.hud.showHud(false);
  g.hud.showTitle(true);
  document.exitPointerLock();
});
document.getElementById('againbtn').addEventListener('click', () => {
  g.audio.click();
  g.hud.hideMatchEnd();
  startMatch(g);
  lockPointer();
});
document.getElementById('mutebtn').addEventListener('click', toggleMute);
function toggleMute() {
  g.audio.ensure();
  g.audio.setMuted(!g.audio.muted);
  document.getElementById('mutebtn').textContent = g.audio.muted ? '✕' : '♪';
}
function toggleBuy() {
  const buy = g.hud.els.buy;
  const show = buy.classList.contains('hidden');
  if (show) { g.hud.showBuy(true); document.exitPointerLock(); }
  else { g.hud.showBuy(false); lockPointer(); }
}
function showPause(show) {
  g.hud.showPause(show);
  if (show) document.exitPointerLock();
}

// --- title-screen orbit camera ---
let orbitT = 0;
function titleCamera(dt) {
  orbitT += dt;
  const a = orbitT * 0.07;
  camera.position.set(Math.sin(a) * 34, 17, Math.cos(a) * 26);
  camera.lookAt(8, 0, 0);
}

// --- fixed-step loop ---
let last = performance.now();
let acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;
  if (g.phase === 'title' || g.phase === 'matchEnd') {
    titleCamera(dt);
    if (g.phase === 'matchEnd') updateGame(g, dt); // let banners settle
  } else if (g.hud.els.pause.classList.contains('hidden')) {
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 5) {
      step(STEP);
      acc -= STEP;
      n++;
    }
    if (n === 5) acc = 0; // drop backlog rather than spiral
  }
  // charge blink
  if (charge.visible) {
    chargeLight.material.color.setHex(Math.sin(now * 0.012) > 0 ? 0xff3020 : 0x551008);
  }
  renderer.render(scene, camera);
}

function step(dt) {
  if (g.phase === 'buy' || g.phase === 'live' || g.phase === 'roundEnd') {
    updateGame(g, dt);
  }
  if (g.phase === 'live' || g.phase === 'buy') {
    updatePlayer(g, dt, input);
    updateBots(g, dt);
    updateWeapons(g, dt);
    if (input.fireHeld && g.player.alive) tryFire(g, false); // auto weapons keep firing
    if (g.player.alive && (g.phase === 'live' || g.phase === 'buy')) {
      // bots were (re)created this round: build meshes once
      for (const b of g.bots) if (!b.mesh) buildBotMesh(scene, b);
    }
  }
  g.hud.update(dt);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// spawn the first round's bots so the title backdrop has life (they idle in buy)
spawnTeams(g);
for (const b of g.bots) buildBotMesh(scene, b);
g.phase = 'title';

// debug / playtest handle (also handy for the coordinator's screenshots)
window.__dustline = g;

requestAnimationFrame(frame);

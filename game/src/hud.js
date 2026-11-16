// hud.js — all DOM HUD: health/ammo/money, timer, score, killfeed, crosshair,
// hitmarker, damage direction, minimap, buy menu, banners, screens.
import { WEAPONS, SHOP, GRENADE_PRICE } from './weapon.js';

const $ = (id) => document.getElementById(id);
const _lastSeen = new Map(); // bot id -> {x, z, t}

export function createHud(g) {
  const hud = {
    els: {}, lastHp: -1, lastAmmo: '', lastMoney: -1, lastTimer: '',
    lastScore: '', lastObj: '', lastSquad: '', mapT: 0, boomT: 0,
  };
  for (const id of ['hud', 'crosshair', 'hitmarker', 'dmgdir', 'dmgvin', 'flash', 'topbar',
    'score', 'timer', 'objective', 'squad', 'radio', 'plantbar', 'feed', 'minimap', 'hpnum', 'hpfill',
    'arnum', 'arfill', 'money', 'ammo', 'wname', 'gren', 'hint', 'banner', 'title',
    'buy', 'buycash', 'buygrid', 'buyround', 'buysquad', 'pause', 'pausescore', 'matchend', 'endtitle', 'endstats', 'mutebtn']) {
    hud.els[id] = $(id);
  }
  hud.els.crossLines = [...hud.els.crosshair.querySelectorAll('.l')];
  hud.els.plantFill = hud.els.plantbar.querySelector('.fill');
  hud.els.plantLbl = hud.els.plantbar.querySelector('.lbl');
  hud.els.bannerBig = hud.els.banner.querySelector('.big');
  hud.els.bannerSub = hud.els.banner.querySelector('.sub');
  hud.els.mapCtx = hud.els.minimap.getContext('2d');

  // --- buy menu cards ---
  const grid = hud.els.buygrid;
  const cards = [];
  for (const item of SHOP) {
    const def = item.kind === 'weapon' ? WEAPONS[item.id] : null;
    const price = item.kind === 'weapon' ? def.price : GRENADE_PRICE[item.id];
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `<h3>${item.kind === 'weapon' ? def.name : item.id.toUpperCase() + ' GRENADE'}</h3>` +
      `<div class="price">$${price}</div><div class="desc">${item.desc}</div>` +
      `<div class="key">${item.kind === 'weapon' ? 'KEY ' + (['kestrel', 'jackal', 'longbow', 'mauler'].indexOf(item.id) + 2) + ' — BUY' : 'CLICK TO BUY'}</div>`;
    el.addEventListener('click', () => {
      if (g.buyItem(item)) { g.audio.buy(); refreshCards(); }
      else g.audio.dry();
    });
    grid.appendChild(el);
    cards.push({ item, el, price });
  }
  const armorCard = document.createElement('div');
  armorCard.className = 'card';
  armorCard.innerHTML = `<h3>KEVLAR VEST</h3><div class="price">$650</div>` +
    `<div class="desc">Full armor. Soaks half of every hit until it breaks.</div><div class="key">BUY</div>`;
  armorCard.addEventListener('click', () => {
    if (g.buyItem({ kind: 'armor' })) { g.audio.buy(); refreshCards(); }
    else g.audio.dry();
  });
  grid.appendChild(armorCard);
  cards.push({ item: { kind: 'armor' }, el: armorCard, price: 650 });

  function refreshCards() {
    for (const c of cards) {
      const owned = c.item.kind === 'weapon' ? g.player.weapons.primary === c.item.id
        : c.item.kind === 'grenade' ? g.player.weapons[c.item.id] >= 2
        : g.player.armor >= 100;
      c.el.classList.toggle('owned', owned);
      c.el.classList.toggle('cant', !owned && g.money < c.price);
    }
    hud.els.buycash.textContent = '$' + g.money;
  }
  hud.refreshBuy = refreshCards;

  hud.showBuy = (show) => {
    hud.els.buy.classList.toggle('hidden', !show);
    if (show) {
      hud.els.buyround.textContent = 'ROUND ' + g.round + '  ·  DUSTLINE ' + g.scoreAtk + ' : ' + g.scoreDef + ' FOUNDRY  ·  FIRST TO 5';
      const squad = g.bots.filter((b) => b.team === 'atk' && b.alive)
        .map((b) => b.name + ' — ' + (WEAPONS[b.current] ? WEAPONS[b.current].name : 'P9')).join('   ·   ');
      hud.els.buysquad.textContent = 'Squad: ' + squad;
      refreshCards();
    }
  };
  hud.showPause = (show) => {
    hud.els.pause.classList.toggle('hidden', !show);
    if (show) hud.els.pausescore.textContent = 'ROUND ' + g.round + '  ·  DUSTLINE ' + g.scoreAtk + ' : ' + g.scoreDef + ' FOUNDRY';
  };
  hud.showTitle = (show) => hud.els.title.classList.toggle('hidden', !show);
  hud.showHud = (show) => hud.els.hud.classList.toggle('hidden', !show);

  // Squad radio: bots call out what they are doing, so tactics are visible.
  hud.radio = (name, text, team) => {
    const div = document.createElement('div');
    div.innerHTML = `<span class="${team === 'atk' ? 'atk' : 'def'}">▸ ${name}:</span> ${text}`;
    hud.els.radio.prepend(div);
    while (hud.els.radio.children.length > 4) hud.els.radio.lastChild.remove();
    setTimeout(() => div.remove(), 5200);
  };

  hud.showMatchEnd = () => {
    const w = g.matchWinner;
    hud.els.endtitle.textContent = w === 'atk' ? 'VICTORY' : w === 'def' ? 'DEFEAT' : 'DRAW';
    hud.els.endtitle.style.color = w === 'atk' ? '#7be495' : w === 'def' ? '#ff7a5c' : '#ffd9a0';
    const dots = g.history.map((h) => `<span style="color:${h === 'W' ? '#7be495' : '#ff7a5c'}">●</span>`).join(' ');
    hud.els.endstats.innerHTML =
      `Final score — DUSTLINE ${g.scoreAtk} : ${g.scoreDef} FOUNDRY<br>` +
      `Rounds: ${dots}<br>` +
      `Your kills: ${g.stats.kills} &nbsp;·&nbsp; Deaths: ${g.stats.deaths}<br>` +
      `Plants: ${g.stats.plants} &nbsp;·&nbsp; Defuses: ${g.stats.defuses}<br>` +
      `Cash left: $${g.money}`;
    hud.els.matchend.classList.remove('hidden');
  };
  hud.hideMatchEnd = () => hud.els.matchend.classList.add('hidden');

  hud.banner = (big, sub, win) => {
    if (!big) { hud.els.banner.style.opacity = 0; return; }
    hud.els.bannerBig.textContent = big;
    hud.els.bannerSub.textContent = sub || '';
    hud.els.banner.className = win === true ? 'win' : win === false ? 'lose' : '';
    hud.els.banner.style.opacity = 1;
    setTimeout(() => { hud.els.banner.style.opacity = 0; }, 3600);
  };

  hud.setObjective = (text, hot) => {
    hud.els.objective.textContent = text;
    hud.els.objective.classList.toggle('hot', !!hot);
  };

  hud.plantBar = (frac, label) => {
    if (!label) { hud.els.plantbar.classList.add('hidden'); return; }
    hud.els.plantbar.classList.remove('hidden');
    hud.els.plantFill.style.width = Math.round(frac * 100) + '%';
    hud.els.plantLbl.textContent = label;
  };

  hud.feed = (text, team, head) => {
    const div = document.createElement('div');
    div.innerHTML = `<span class="${team}">${text}</span>` + (head ? ' <span class="hs">HEADSHOT</span>' : '');
    hud.els.feed.prepend(div);
    while (hud.els.feed.children.length > 5) hud.els.feed.lastChild.remove();
    setTimeout(() => div.remove(), 6000);
  };

  hud.hitmark = (head) => {
    const h = hud.els.hitmarker;
    h.classList.toggle('head', !!head);
    h.style.opacity = 1;
    setTimeout(() => { h.style.opacity = 0; }, 120);
  };

  hud.damageFrom = (attacker) => {
    hud.els.dmgvin.style.opacity = 0.9;
    setTimeout(() => { hud.els.dmgvin.style.opacity = 0; }, 350);
    if (!attacker) return;
    const p = g.player;
    const ang = Math.atan2(attacker.pos.x - p.pos.x, attacker.pos.z - p.pos.z);
    const rel = ang + p.yaw + Math.PI; // 0 = ahead
    const arc = hud.els.dmgdir.querySelector('.arc');
    arc.style.transform = `rotate(${rel}rad)`;
    hud.els.dmgdir.style.opacity = 1;
    setTimeout(() => { hud.els.dmgdir.style.opacity = 0; }, 600);
  };

  // the white-out itself is driven by player.flashT in hud.update; this is
  // called at detonation so the overlay can start on the same frame.
  hud.flashEffect = () => {};

  hud.explosionFlash = (pos) => {
    const p = g.player;
    if (!p.alive) return;
    const d = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z);
    if (d < 30) hud.boomT = 0.26;
  };

  // --- per-frame update ---
  hud.update = (dt) => {
    const p = g.player;
    // health / armor
    if (p.hp !== hud.lastHp) {
      hud.lastHp = p.hp;
      hud.els.hpnum.textContent = Math.max(0, Math.ceil(p.hp));
      hud.els.hpfill.style.width = Math.max(0, p.hp) + '%';
    }
    hud.els.arnum.textContent = Math.ceil(p.armor);
    hud.els.arfill.style.width = Math.min(100, p.armor) + '%';
    // money
    if (g.money !== hud.lastMoney) {
      hud.lastMoney = g.money;
      hud.els.money.textContent = '$' + g.money;
    }
    // score + timer
    const score = `${g.scoreAtk} : ${g.scoreDef}`;
    if (score !== hud.lastScore) { hud.lastScore = score; hud.els.score.textContent = score; }
    const t = Math.max(0, Math.ceil(g.timer));
    const ts = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    const label = g.phase === 'buy' ? 'BUY ' + ts : ts;
    if (label !== hud.lastTimer) {
      hud.lastTimer = label;
      hud.els.timer.textContent = label;
      hud.els.timer.classList.toggle('low', g.phase === 'live' && t <= 15);
    }
    // squad status: what each friendly bot is doing right now
    if (g.phase === 'live' || g.phase === 'buy') {
      const verb = { push: 'pushing', hold: 'holding', plant: 'planting', defuse: 'defusing', defend: 'defending', rotate: 'rotating' };
      const s = g.bots.filter((b) => b.alive && b.team === 'atk')
        .map((b) => b.name + ' ' + (verb[b.state] || b.state) + (b.site ? ' ' + b.site : '')).join('   ·   ');
      if (s !== hud.lastSquad) { hud.lastSquad = s; hud.els.squad.textContent = s; }
    } else if (hud.lastSquad !== '') { hud.lastSquad = ''; hud.els.squad.textContent = ''; }
    // weapon + ammo
    const def = WEAPONS[p.current];
    const ammo = p.ammo[p.current];
    const ammoStr = def && ammo ? `${ammo.mag} / ${ammo.reserve === Infinity ? '∞' : ammo.reserve}` : '';
    if (ammoStr !== hud.lastAmmo) {
      hud.lastAmmo = ammoStr;
      hud.els.ammo.innerHTML = def && ammo
        ? `${ammo.mag} <small>/ ${ammo.reserve === Infinity ? '∞' : ammo.reserve}</small>`
        : '';
      hud.els.wname.textContent = def ? def.name + (p.reloading ? ' — RELOADING' : '') : '';
      hud.els.gren.textContent = `FRAG ×${p.weapons.frag}   FLASH ×${p.weapons.flash}   [4] frag   [5] flash`;
    }
    // crosshair spread
    const spread = (def ? def.spread : 0.01) + p.spreadMove * 0.03 + (p.bloom || 0) + (p.sprinting ? 0.02 : 0);
    const gap = 6 + spread * 900;
    const len = 9;
    const L = hud.els.crossLines;
    L[0].style.cssText = `left:-${gap + len}px;top:-1px;width:${len}px;height:2px`;
    L[1].style.cssText = `left:${gap}px;top:-1px;width:${len}px;height:2px`;
    L[2].style.cssText = `top:-${gap + len}px;left:-1px;width:2px;height:${len}px`;
    L[3].style.cssText = `top:${gap}px;left:-1px;width:2px;height:${len}px`;
    hud.els.crosshair.style.opacity = p.alive && g.phase === 'live' ? 1 : 0;
    // flash overlay: explosion flash first, then the flashbang white-out
    if (hud.boomT > 0) {
      hud.boomT -= dt;
      hud.els.flash.style.opacity = 0.85;
    } else if (p.flashT > 0) {
      hud.els.flash.style.opacity = Math.min(1, 0.3 + p.flashT / 2.5);
    } else {
      hud.els.flash.style.opacity = 0;
    }
    // scoped zoom indicator
    if (g.input && g.input.scoped) hud.els.crosshair.style.opacity = 0.35;
    // minimap, throttled to ~10 Hz
    hud.mapT -= dt;
    if (hud.mapT <= 0) { hud.mapT = 0.1; drawMinimap(g, hud); }
  };

  return hud;
}

function drawMinimap(g, hud) {
  const ctx = hud.els.mapCtx;
  const W = 168, H = 126;
  ctx.clearRect(0, 0, W, H);
  const sx = (x) => (x + 42) / 84 * W;
  const sz = (z) => (z + 32) / 64 * H;
  // walls
  ctx.fillStyle = 'rgba(200,205,215,0.55)';
  for (const c of g.world.colliders) {
    if (c.max.y < 2.5) continue; // skip low crates on the map? keep walls only
    ctx.fillRect(sx(c.min.x), sz(c.min.z), Math.max(1, sx(c.max.x) - sx(c.min.x)), Math.max(1, sz(c.max.z) - sz(c.min.z)));
  }
  // sites
  for (const name of ['A', 'B']) {
    const s = g.world.sites[name];
    ctx.fillStyle = g.plant.state === 'planted' && g.plant.site === name ? '#ff3c2a' : '#ff8a2a';
    ctx.beginPath(); ctx.arc(sx(s.x), sz(s.z), 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0b0d12';
    ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(name, sx(s.x), sz(s.z));
  }
  // charge
  if (g.plant.state === 'planted') {
    ctx.fillStyle = '#ff3c2a';
    ctx.beginPath(); ctx.arc(sx(g.plant.x), sz(g.plant.z), 4, 0, Math.PI * 2); ctx.fill();
  }
  // remember enemy last-seen positions
  for (const b of g.bots) {
    if (b.team === 'def' && b.alive && g.player.alive) {
      const d = Math.hypot(b.pos.x - g.player.pos.x, b.pos.z - g.player.pos.z);
      if (d < 30) _lastSeen.set(b.idx, { x: b.pos.x, z: b.pos.z, t: g.time });
    }
  }
  const dot = (x, z, color, r) => {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(sx(x), sz(z), r, 0, Math.PI * 2); ctx.fill();
  };
  // enemies: last-seen only (fades after 3s)
  for (const [id, s] of _lastSeen) {
    if (g.time - s.t > 3) { _lastSeen.delete(id); continue; }
    dot(s.x, s.z, 'rgba(255,80,60,0.9)', 3);
  }
  // teammates
  for (const b of g.bots) if (b.alive && b.team === 'atk') dot(b.pos.x, b.pos.z, '#57d977', 3);
  // intent: attackers draw a line toward the site they push; holders show a ring
  for (const b of g.bots) {
    if (!b.alive) continue;
    if (b.team === 'atk' && (b.state === 'push' || b.state === 'plant')) {
      const s = g.world.sites[b.site];
      ctx.strokeStyle = 'rgba(255,179,71,0.5)';
      ctx.beginPath(); ctx.moveTo(sx(b.pos.x), sz(b.pos.z)); ctx.lineTo(sx(s.x), sz(s.z)); ctx.stroke();
    }
    if (b.team === 'def' && b.state === 'hold') {
      ctx.strokeStyle = 'rgba(127,184,255,0.7)';
      ctx.beginPath(); ctx.arc(sx(b.pos.x), sz(b.pos.z), 5 + Math.sin(g.time * 3) * 1.5, 0, Math.PI * 2); ctx.stroke();
    }
  }
  // player: arrow showing facing
  const p = g.player;
  if (p.alive) {
    ctx.fillStyle = '#ffd76a';
    ctx.save();
    ctx.translate(sx(p.pos.x), sz(p.pos.z));
    ctx.rotate(Math.atan2(-Math.sin(p.yaw), -Math.cos(p.yaw)) + Math.PI / 2);
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}

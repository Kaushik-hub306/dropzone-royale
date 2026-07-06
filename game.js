'use strict';
/* ============================================================
   DROPZONE ROYALE
   An original 2D browser battle royale. Pure canvas, no deps.

   25 fighters drop in. Scavenge weapons, harvest materials,
   build walls, outlast the Zone. Last one standing wins.

   Everything is tunable from the constants below.
   ============================================================ */

/* ---------------- Tunables ---------------- */
const WORLD = 3200;              // world is WORLD x WORLD px
const BOT_COUNT = 24;
const PLAYER_SPEED = 235;
const BOT_SPEED = 212;
const FIGHTER_R = 15;
const MAX_MATS = 300;
const WALL_COST = 10;
const WALL_HP = 150;
const MELEE_DMG = 30;
const MELEE_RANGE = 60;
const MELEE_CD = 0.45;
const HARVEST_MATS = 7;
const OBSTACLE_MELEE_DMG = 25;

const WEAPONS = {
  pistol : { key: 'pistol',  name: 'Pistol',       dmg: 22, rof: 0.34,  spread: 0.050, speed: 950,  range: 620,  pellets: 1, tier: 1, color: '#b0bec5', auto: false },
  smg    : { key: 'smg',     name: 'SMG',          dmg: 13, rof: 0.085, spread: 0.100, speed: 880,  range: 470,  pellets: 1, tier: 2, color: '#66bb6a', auto: true  },
  shotgun: { key: 'shotgun', name: 'Shotgun',      dmg: 11, rof: 0.90,  spread: 0.240, speed: 820,  range: 340,  pellets: 6, tier: 2, color: '#ffa726', auto: false },
  rifle  : { key: 'rifle',   name: 'Battle Rifle', dmg: 27, rof: 0.21,  spread: 0.035, speed: 1050, range: 780,  pellets: 1, tier: 3, color: '#42a5f5', auto: true  },
  sniper : { key: 'sniper',  name: 'Sniper',       dmg: 72, rof: 1.50,  spread: 0.008, speed: 1500, range: 1300, pellets: 1, tier: 4, color: '#ab47bc', auto: false },
};
const WEAPON_DROPS = [['pistol', 30], ['smg', 22], ['shotgun', 22], ['rifle', 18], ['sniper', 8]];

// Zone phases: wait (target ring visible), then shrink. dps applies outside.
const PHASES = [
  { wait: 14, shrink: 16, mult: 0.68, dps: 2  },
  { wait: 12, shrink: 14, mult: 0.65, dps: 4  },
  { wait: 10, shrink: 12, mult: 0.60, dps: 7  },
  { wait: 9,  shrink: 10, mult: 0.55, dps: 10 },
  { wait: 8,  shrink: 9,  mult: 0.50, dps: 14 },
  { wait: 7,  shrink: 8,  mult: 0.40, dps: 18 },
  { wait: 6,  shrink: 8,  mult: 0.00, dps: 24 },
];

const BOT_NAMES = ['Wren', 'Moss', 'Byte', 'Juno', 'Rook', 'Flick', 'Sable', 'Nova', 'Piko', 'Dune', 'Vex', 'Mara', 'Tock', 'Grit', 'Lux', 'Fenn', 'Ivo', 'Zephyr', 'Kip', 'Onyx', 'Rue', 'Slate', 'Tansy', 'Bram'];

/* ---------------- Utils ---------------- */
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };

function pickWeighted(table) {
  let total = 0;
  for (const [, w] of table) total += w;
  let roll = Math.random() * total;
  for (const [key, w] of table) { roll -= w; if (roll <= 0) return key; }
  return table[0][0];
}

/* ---------------- Canvas & DOM ---------------- */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let VW = 0, VH = 0, DPR = 1;
function resize() {
  DPR = window.devicePixelRatio || 1;
  VW = window.innerWidth; VH = window.innerHeight;
  canvas.width = Math.round(VW * DPR);
  canvas.height = Math.round(VH * DPR);
  canvas.style.width = VW + 'px';
  canvas.style.height = VH + 'px';
}
window.addEventListener('resize', resize);
resize();

const $ = (id) => document.getElementById(id);
const ui = {
  alive: $('alive'), kills: $('kills'), zoneMsg: $('zoneMsg'), killfeed: $('killfeed'),
  hpFill: $('hpFill'), hpText: $('hpText'), shFill: $('shFill'), shText: $('shText'),
  matsVal: $('matsVal'), weaponName: $('weaponName'), prompt: $('prompt'),
  overlay: $('overlay'), ovTitle: $('ovTitle'), ovSub: $('ovSub'),
  ovControls: $('ovControls'), ovBtn: $('ovBtn'),
};

/* ---------------- Audio (tiny synth) ---------------- */
let audioCtx = null, muted = false;
function sfx(freq, dur, type = 'square', vol = 0.12, slideTo = 0) {
  if (muted) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(t); o.stop(t + dur + 0.02);
  } catch (e) { /* audio unavailable */ }
}
function sfxNear(x, y, freq, dur, type, vol, slideTo) {
  if (dist2(x, y, cam.x, cam.y) < 1000 * 1000) sfx(freq, dur, type, vol, slideTo);
}

/* ---------------- Game state ---------------- */
let state = 'menu'; // 'menu' | 'play'
let matchOver = false;
let playerDead = false;
let fighters = [], bullets = [], pickups = [], obstacles = [], particles = [], feed = [];
let player = null, specTarget = null, placement = 0;
let zone = null;
let cam = { x: WORLD / 2, y: WORLD / 2, shake: 0 };
let groundPatches = [];
let swapTarget = null;
let promptText = '', promptT = 0;
let feedDirty = false;

/* ---------------- Input ---------------- */
const keys = {};
let mouseX = VW / 2, mouseY = VH / 2, mouseDown = false;

window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  if (e.code === 'KeyM') { muted = !muted; setPrompt(muted ? 'Sound muted' : 'Sound on', 1.2); return; }
  if (state !== 'play') {
    if (e.code === 'KeyR' || e.code === 'Enter') startMatch();
    return;
  }
  if (player && player.alive) {
    if (e.code === 'KeyF') melee(player);
    if (e.code === 'KeyQ' || e.code === 'Space') buildWall(player);
    if (e.code === 'KeyE' && swapTarget) swapWeapon(player, swapTarget);
  }
  if (e.code === 'KeyR' && (playerDead || matchOver)) startMatch();
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('mousemove', (e) => { mouseX = e.clientX; mouseY = e.clientY; });
window.addEventListener('mousedown', (e) => {
  if (state !== 'play' || !player || !player.alive) return;
  if (e.button === 0) {
    mouseDown = true;
    if (!player.weapon) melee(player);
    else if (!player.weapon.auto) fireWeapon(player);
  }
  if (e.button === 2) buildWall(player);
});
window.addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; });
window.addEventListener('contextmenu', (e) => e.preventDefault());

/* ---------------- World generation ---------------- */
function genWorld() {
  obstacles = []; groundPatches = []; pickups = [];
  for (let i = 0; i < 140; i++) {
    groundPatches.push({
      x: rand(0, WORLD), y: rand(0, WORLD),
      rx: rand(40, 160), ry: rand(30, 120),
      c: Math.random() < 0.55 ? 'rgba(58,92,60,0.5)' : 'rgba(122,140,74,0.35)',
    });
  }
  const blocked = (x, y, r) => obstacles.some(o => o.r
    ? dist2(x, y, o.x, o.y) < Math.pow(o.r + r + 40, 2)
    : dist2(x, y, o.x, o.y) < Math.pow(Math.max(o.hw, o.hh) + r + 40, 2));
  const tryPlace = (fn, count, tries = 10) => {
    for (let i = 0; i < count; i++) {
      for (let t = 0; t < tries; t++) {
        const x = rand(80, WORLD - 80), y = rand(80, WORLD - 80);
        if (!blocked(x, y, 40)) { fn(x, y); break; }
      }
    }
  };
  tryPlace((x, y) => obstacles.push({ type: 'tree', x, y, r: rand(14, 20), canopy: rand(38, 58), hp: 80 }), 95);
  tryPlace((x, y) => obstacles.push({ type: 'rock', x, y, r: rand(18, 32), hp: 130 }), 40);
  tryPlace((x, y) => { const s = rand(17, 23); obstacles.push({ type: 'crate', x, y, hw: s, hh: s, hp: 45 }); }, 55);

  for (let i = 0; i < 70; i++) pickups.push(makePickup('weapon', rand(60, WORLD - 60), rand(60, WORLD - 60), pickWeighted(WEAPON_DROPS)));
  for (let i = 0; i < 30; i++) pickups.push(makePickup('med', rand(60, WORLD - 60), rand(60, WORLD - 60)));
  for (let i = 0; i < 25; i++) pickups.push(makePickup('shield', rand(60, WORLD - 60), rand(60, WORLD - 60)));
  for (let i = 0; i < 20; i++) pickups.push(makePickup('mats', rand(60, WORLD - 60), rand(60, WORLD - 60)));
}

function makePickup(type, x, y, wkey) {
  return { type, wkey: wkey || null, x: clamp(x, 30, WORLD - 30), y: clamp(y, 30, WORLD - 30), bob: rand(0, TAU), r: 15, taken: false };
}

function makeFighter(name, isPlayer, color) {
  return {
    name, isPlayer, color,
    x: 0, y: 0, r: FIGHTER_R, dir: rand(0, TAU),
    hp: 100, shield: 0, mats: 50, weapon: null,
    alive: true, kills: 0,
    cool: 0, mcool: 0, muzzle: 0, swing: 0, hitFlash: 0,
    think: rand(0, 0.3), enemy: null, loot: null, los: false,
    wanderT: 0, wanderA: rand(0, TAU), strafeP: rand(0, TAU), aimErr: rand(0.05, 0.16),
  };
}

function spawnFighters() {
  player = makeFighter('You', true, '#ffd54f');
  fighters = [player];
  for (let i = 0; i < BOT_COUNT; i++) {
    const hue = Math.round((i * 360) / BOT_COUNT + rand(-10, 10));
    fighters.push(makeFighter(BOT_NAMES[i % BOT_NAMES.length], false, 'hsl(' + hue + ' 55% 58%)'));
  }
  for (const f of fighters) {
    for (let t = 0; t < 40; t++) {
      const a = rand(0, TAU), d = rand(350, 1350);
      const x = clamp(WORLD / 2 + Math.cos(a) * d, 60, WORLD - 60);
      const y = clamp(WORLD / 2 + Math.sin(a) * d, 60, WORLD - 60);
      if (t === 39 || fighters.every(o => o === f || dist2(o.x, o.y, x, y) > 240 * 240)) { f.x = x; f.y = y; break; }
    }
  }
}

/* ---------------- Zone ---------------- */
function initZone() {
  zone = { x: WORLD / 2, y: WORLD / 2, r: 1500, phase: 0, mode: 'wait', t: PHASES[0].wait, to: null, from: null };
  computeZoneTarget();
}
function computeZoneTarget() {
  const P = PHASES[zone.phase];
  const tr = Math.max(0, zone.r * P.mult);
  const maxOff = Math.max(0, (zone.r - tr) * 0.85);
  const a = rand(0, TAU), d = rand(0, maxOff);
  zone.to = {
    x: clamp(zone.x + Math.cos(a) * d, 200, WORLD - 200),
    y: clamp(zone.y + Math.sin(a) * d, 200, WORLD - 200),
    r: tr,
  };
}
function updateZone(dt) {
  if (matchOver) return;
  const P = PHASES[zone.phase];
  zone.t -= dt;
  if (zone.mode === 'wait') {
    if (zone.t <= 0 && zone.r > 1) {
      zone.from = { x: zone.x, y: zone.y, r: zone.r };
      zone.mode = 'shrink';
      zone.t = P.shrink;
      addFeed('The Zone is closing');
      sfx(520, 0.4, 'triangle', 0.14, 260);
    }
  } else {
    const k = clamp(1 - zone.t / P.shrink, 0, 1);
    zone.x = lerp(zone.from.x, zone.to.x, k);
    zone.y = lerp(zone.from.y, zone.to.y, k);
    zone.r = lerp(zone.from.r, zone.to.r, k);
    if (zone.t <= 0) {
      zone.x = zone.to.x; zone.y = zone.to.y; zone.r = zone.to.r;
      zone.phase = Math.min(zone.phase + 1, PHASES.length - 1);
      zone.mode = 'wait';
      zone.t = PHASES[zone.phase].wait;
      computeZoneTarget();
    }
  }
  for (const f of fighters) {
    if (!f.alive) continue;
    if (dist2(f.x, f.y, zone.x, zone.y) > zone.r * zone.r) {
      f.hp -= P.dps * dt;
      if (f.hp <= 0) killFighter(f, null);
    }
  }
}

/* ---------------- Combat ---------------- */
function fireWeapon(f) {
  const w = f.weapon;
  if (!w || f.cool > 0 || !f.alive) return;
  f.cool = w.rof;
  const bx = f.x + Math.cos(f.dir) * (f.r + 10);
  const by = f.y + Math.sin(f.dir) * (f.r + 10);
  for (let i = 0; i < w.pellets; i++) {
    const a = f.dir + rand(-w.spread, w.spread);
    bullets.push({ x: bx, y: by, vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed, dmg: w.dmg, owner: f, traveled: 0, max: w.range, color: w.color });
  }
  f.muzzle = 0.06;
  const base = { pistol: 300, smg: 420, shotgun: 160, rifle: 240, sniper: 120 }[w.key] || 250;
  sfxNear(f.x, f.y, base, 0.09, (w.key === 'shotgun' || w.key === 'sniper') ? 'sawtooth' : 'square', 0.10, base * 0.4);
}

function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    const stepLen = Math.hypot(b.vx, b.vy) * dt;
    const n = Math.max(1, Math.ceil(stepLen / 9));
    let dead = false;
    for (let s = 0; s < n && !dead; s++) {
      b.x += (b.vx * dt) / n;
      b.y += (b.vy * dt) / n;
      if (b.x < 0 || b.y < 0 || b.x > WORLD || b.y > WORLD) { dead = true; break; }
      for (let oi = obstacles.length - 1; oi >= 0; oi--) {
        const o = obstacles[oi];
        if (o.r) {
          if (dist2(b.x, b.y, o.x, o.y) < o.r * o.r) { dead = true; spawnSparks(b.x, b.y, '#c8b98a', 3); break; }
        } else if (Math.abs(b.x - o.x) < o.hw && Math.abs(b.y - o.y) < o.hh) {
          dead = true;
          o.hp -= b.dmg;
          spawnSparks(b.x, b.y, o.type === 'wall' ? '#d7ccc8' : '#c8a165', 3);
          if (o.hp <= 0) destroyObstacle(oi);
          break;
        }
      }
      if (dead) break;
      for (const f of fighters) {
        if (!f.alive || f === b.owner) continue;
        const rr = f.r + 3;
        if (dist2(b.x, b.y, f.x, f.y) < rr * rr) { damageFighter(f, b.dmg, b.owner); dead = true; break; }
      }
    }
    b.traveled += stepLen;
    if (dead || b.traveled >= b.max) bullets.splice(i, 1);
  }
}

function destroyObstacle(oi) {
  const o = obstacles[oi];
  obstacles.splice(oi, 1);
  spawnPuff(o.x, o.y, o.type === 'rock' ? '#9e9e9e' : '#a1887f');
  if (o.type === 'crate') {
    const roll = Math.random();
    if (roll < 0.5) pickups.push(makePickup('weapon', o.x, o.y, pickWeighted(WEAPON_DROPS)));
    else if (roll < 0.7) pickups.push(makePickup('med', o.x, o.y));
    else if (roll < 0.85) pickups.push(makePickup('shield', o.x, o.y));
    else pickups.push(makePickup('mats', o.x, o.y));
  }
}

function damageFighter(f, dmg, attacker) {
  if (!f.alive) return;
  let d = dmg;
  if (f.shield > 0) { const absorbed = Math.min(f.shield, d); f.shield -= absorbed; d -= absorbed; }
  f.hp -= d;
  f.hitFlash = 0.14;
  spawnSparks(f.x, f.y, '#ff8a80', 5);
  if (f === player) { cam.shake = Math.min(9, cam.shake + 3.5); sfx(140, 0.12, 'sawtooth', 0.16, 60); }
  else sfxNear(f.x, f.y, 200, 0.06, 'square', 0.05, 100);
  if (!f.isPlayer && attacker && attacker.alive) { f.enemy = attacker; f.think = rand(0.4, 0.8); }
  if (f.hp <= 0) killFighter(f, attacker);
}

function killFighter(f, attacker) {
  if (!f.alive) return;
  f.alive = false;
  f.hp = 0;
  spawnPuff(f.x, f.y, f.color);
  if (f.weapon) { pickups.push(makePickup('weapon', f.x + rand(-24, 24), f.y + rand(-24, 24), f.weapon.key)); f.weapon = null; }
  if (f.mats >= 20) pickups.push(makePickup('mats', f.x + rand(-24, 24), f.y + rand(-24, 24)));
  if (attacker && attacker !== f) { attacker.kills++; addFeed(attacker.name + ' eliminated ' + f.name); }
  else addFeed(f.name + ' was claimed by the Zone');
  sfxNear(f.x, f.y, 90, 0.25, 'sawtooth', 0.14, 40);

  if (f === player) {
    playerDead = true;
    placement = fighters.filter(x => x.alive).length + 1;
    specTarget = (attacker && attacker.alive && attacker !== player) ? attacker : null;
    showOverlay('ELIMINATED', 'You placed #' + placement + ' with ' + player.kills + ' elims. Spectating...', 'DROP AGAIN', true);
  }
  checkWin();
}

function checkWin() {
  const alive = fighters.filter(x => x.alive);
  if (alive.length <= 1 && !matchOver) {
    matchOver = true;
    const w = alive[0] || null;
    if (w === player) {
      showOverlay('#1 — LAST ONE STANDING', player.kills + ' eliminations. The dropzone is yours.', 'PLAY AGAIN', false);
      sfx(523, 0.12, 'square', 0.12);
      setTimeout(() => sfx(659, 0.12, 'square', 0.12), 130);
      setTimeout(() => sfx(784, 0.25, 'square', 0.12), 260);
    } else if (w) {
      showOverlay('MATCH OVER', w.name + ' wins the match. You placed #' + (placement || 2) + '.', 'PLAY AGAIN', false);
    }
  }
}

function melee(f) {
  if (f.mcool > 0 || !f.alive) return;
  f.mcool = MELEE_CD;
  f.swing = 0.18;
  sfxNear(f.x, f.y, 180, 0.08, 'triangle', 0.1, 80);
  const px = f.x + Math.cos(f.dir) * MELEE_RANGE * 0.7;
  const py = f.y + Math.sin(f.dir) * MELEE_RANGE * 0.7;
  for (const t of fighters) {
    if (!t.alive || t === f) continue;
    if (dist2(px, py, t.x, t.y) < Math.pow(MELEE_RANGE * 0.85, 2)) damageFighter(t, MELEE_DMG, f);
  }
  for (let oi = obstacles.length - 1; oi >= 0; oi--) {
    const o = obstacles[oi];
    const hit = o.r
      ? dist2(px, py, o.x, o.y) < Math.pow(o.r + 26, 2)
      : (Math.abs(px - o.x) < o.hw + 24 && Math.abs(py - o.y) < o.hh + 24);
    if (hit) {
      o.hp -= OBSTACLE_MELEE_DMG;
      if (o.type !== 'wall') {
        f.mats = Math.min(MAX_MATS, f.mats + HARVEST_MATS);
        if (f === player) setPrompt('+' + HARVEST_MATS + ' materials', 0.6);
      }
      spawnSparks(px, py, o.type === 'rock' ? '#cfd8dc' : '#d7b98a', 4);
      if (o.hp <= 0) destroyObstacle(oi);
      break;
    }
  }
}

function buildWall(f) {
  if (!f.alive) return;
  if (f.mats < WALL_COST) { if (f === player) setPrompt('Not enough materials — harvest with F', 1.2); return; }
  const d = 58;
  const cx = clamp(f.x + Math.cos(f.dir) * d, 20, WORLD - 20);
  const cy = clamp(f.y + Math.sin(f.dir) * d, 20, WORLD - 20);
  const facingX = Math.abs(Math.cos(f.dir)) > Math.abs(Math.sin(f.dir));
  const hw = facingX ? 9 : 52, hh = facingX ? 52 : 9;
  for (const t of fighters) {
    if (t.alive && Math.abs(t.x - cx) < hw + t.r && Math.abs(t.y - cy) < hh + t.r) {
      if (f === player) setPrompt('Blocked', 0.8);
      return;
    }
  }
  for (const o of obstacles) {
    const overlap = o.r
      ? (Math.abs(o.x - cx) < hw + o.r && Math.abs(o.y - cy) < hh + o.r)
      : (Math.abs(o.x - cx) < hw + o.hw && Math.abs(o.y - cy) < hh + o.hh);
    if (overlap) { if (f === player) setPrompt('Blocked', 0.8); return; }
  }
  obstacles.push({ type: 'wall', x: cx, y: cy, hw, hh, hp: WALL_HP });
  f.mats -= WALL_COST;
  sfxNear(f.x, f.y, 320, 0.1, 'square', 0.1, 480);
}

function swapWeapon(f, p) {
  if (!p || p.taken) return;
  const old = f.weapon;
  f.weapon = WEAPONS[p.wkey];
  p.taken = true;
  if (old) pickups.push(makePickup('weapon', f.x + rand(-14, 14), f.y + rand(-14, 14), old.key));
  sfxNear(f.x, f.y, 660, 0.1, 'sine', 0.12, 880);
  if (f === player) setPrompt('Picked up ' + f.weapon.name, 1);
}

/* ---------------- Pickups ---------------- */
function updatePickups(dt) {
  swapTarget = null;
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    p.bob += dt * 3;
    if (p.taken) { pickups.splice(i, 1); continue; }
    for (const f of fighters) {
      if (!f.alive) continue;
      if (dist2(f.x, f.y, p.x, p.y) > Math.pow(f.r + p.r + 6, 2)) continue;
      if (p.type === 'med') {
        if (f.hp < 100) {
          f.hp = Math.min(100, f.hp + 55); p.taken = true;
          if (f === player) { setPrompt('+55 HP', 0.8); sfx(600, 0.1, 'sine', 0.1, 900); }
        }
      } else if (p.type === 'shield') {
        if (f.shield < 100) {
          f.shield = Math.min(100, f.shield + 50); p.taken = true;
          if (f === player) { setPrompt('+50 shield', 0.8); sfx(700, 0.1, 'sine', 0.1, 1000); }
        }
      } else if (p.type === 'mats') {
        if (f.mats < MAX_MATS) {
          f.mats = Math.min(MAX_MATS, f.mats + 40); p.taken = true;
          if (f === player) setPrompt('+40 materials', 0.8);
        }
      } else if (p.type === 'weapon') {
        const w = WEAPONS[p.wkey];
        if (!f.weapon) swapWeapon(f, p);
        else if (!f.isPlayer && w.tier > f.weapon.tier) swapWeapon(f, p);
        else if (f.isPlayer && p.wkey !== f.weapon.key) swapTarget = p;
      }
      if (p.taken) break;
    }
    if (p.taken) pickups.splice(i, 1);
  }
}

/* ---------------- Bot AI ---------------- */
function nearestEnemy(f, maxD) {
  let best = null, bd = maxD * maxD;
  for (const t of fighters) {
    if (!t.alive || t === f) continue;
    const d = dist2(f.x, f.y, t.x, t.y);
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}
function nearestPickup(f, filter, maxD) {
  let best = null, bd = maxD * maxD;
  for (const p of pickups) {
    if (p.taken || !filter(p)) continue;
    const d = dist2(f.x, f.y, p.x, p.y);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
function hasLOS(a, tx, ty) {
  const d = dist(a.x, a.y, tx, ty);
  const steps = Math.max(2, Math.floor(d / 42));
  for (let i = 1; i < steps; i++) {
    const x = lerp(a.x, tx, i / steps), y = lerp(a.y, ty, i / steps);
    for (const o of obstacles) {
      if (o.r) { if (dist2(x, y, o.x, o.y) < o.r * o.r) return false; }
      else if (Math.abs(x - o.x) < o.hw && Math.abs(y - o.y) < o.hh) return false;
    }
  }
  return true;
}

function botUpdate(f, dt) {
  f.think -= dt;
  const dz = dist(f.x, f.y, zone.x, zone.y);
  let mx = 0, my = 0;
  const urgentZone = dz > zone.r - 120;

  if (f.think <= 0) {
    f.think = rand(0.18, 0.4);
    if (!f.enemy || !f.enemy.alive || dist2(f.x, f.y, f.enemy.x, f.enemy.y) > 700 * 700) f.enemy = nearestEnemy(f, 620);
    if (!f.weapon) f.loot = nearestPickup(f, p => p.type === 'weapon', 1500);
    else if (f.hp < 45) f.loot = nearestPickup(f, p => p.type === 'med', 800);
    else if (f.shield < 25) f.loot = nearestPickup(f, p => p.type === 'shield', 600);
    else f.loot = null;
    f.los = f.enemy ? hasLOS(f, f.enemy.x, f.enemy.y) : false;
  }

  if (urgentZone) {
    const a = Math.atan2(zone.y - f.y, zone.x - f.x) + Math.sin(f.strafeP + performance.now() / 900) * 0.4;
    mx = Math.cos(a); my = Math.sin(a);
    f.dir = a;
  } else if (f.enemy && f.weapon) {
    const e = f.enemy;
    const d = dist(f.x, f.y, e.x, e.y);
    const want = f.weapon.range * 0.5;
    const toE = Math.atan2(e.y - f.y, e.x - f.x);
    f.dir = toE;
    const strafe = Math.sin(performance.now() / 500 + f.strafeP) > 0 ? 1 : -1;
    let ax = 0, ay = 0;
    if (d > want) { ax += Math.cos(toE); ay += Math.sin(toE); }
    else if (d < want * 0.55) { ax -= Math.cos(toE); ay -= Math.sin(toE); }
    ax += Math.cos(toE + Math.PI / 2) * 0.7 * strafe;
    ay += Math.sin(toE + Math.PI / 2) * 0.7 * strafe;
    const len = Math.hypot(ax, ay) || 1;
    mx = ax / len; my = ay / len;
    if (f.los && f.cool <= 0 && d < f.weapon.range * 0.92) {
      f.dir = toE + rand(-f.aimErr, f.aimErr);
      fireWeapon(f);
      f.dir = toE;
    }
  } else if (f.enemy && !f.weapon) {
    const e = f.enemy;
    const d = dist(f.x, f.y, e.x, e.y);
    const toE = Math.atan2(e.y - f.y, e.x - f.x);
    if (d < 70) { f.dir = toE; melee(f); mx = Math.cos(toE); my = Math.sin(toE); }
    else if (f.loot) { const a = Math.atan2(f.loot.y - f.y, f.loot.x - f.x); mx = Math.cos(a); my = Math.sin(a); f.dir = a; }
    else { const a = toE + Math.PI; mx = Math.cos(a); my = Math.sin(a); f.dir = a; }
  } else if (f.loot && !f.loot.taken) {
    const a = Math.atan2(f.loot.y - f.y, f.loot.x - f.x);
    mx = Math.cos(a); my = Math.sin(a);
    f.dir = a;
  } else {
    f.wanderT -= dt;
    if (f.wanderT <= 0) {
      f.wanderT = rand(1.2, 3);
      f.wanderA = rand(0, TAU);
      if (dz > zone.r * 0.7) f.wanderA = Math.atan2(zone.y - f.y, zone.x - f.x) + rand(-0.9, 0.9);
    }
    mx = Math.cos(f.wanderA); my = Math.sin(f.wanderA);
    f.dir = f.wanderA;
  }
  moveFighter(f, mx, my, BOT_SPEED, dt);
}

/* ---------------- Movement & collision ---------------- */
function moveFighter(f, mx, my, speed, dt) {
  f.x += mx * speed * dt;
  f.y += my * speed * dt;
  f.x = clamp(f.x, f.r, WORLD - f.r);
  f.y = clamp(f.y, f.r, WORLD - f.r);
  for (const o of obstacles) {
    if (o.r) {
      const rr = f.r + o.r;
      const dx = f.x - o.x, dy = f.y - o.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < rr * rr && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        const push = (rr - d) / d;
        f.x += dx * push; f.y += dy * push;
      }
    } else {
      const nx = clamp(f.x, o.x - o.hw, o.x + o.hw);
      const ny = clamp(f.y, o.y - o.hh, o.y + o.hh);
      const dx = f.x - nx, dy = f.y - ny;
      const d2 = dx * dx + dy * dy;
      if (d2 < f.r * f.r) {
        if (d2 < 0.0001) {
          const ox = o.hw - Math.abs(f.x - o.x), oy = o.hh - Math.abs(f.y - o.y);
          if (ox < oy) f.x = o.x + Math.sign(f.x - o.x || 1) * (o.hw + f.r);
          else f.y = o.y + Math.sign(f.y - o.y || 1) * (o.hh + f.r);
        } else {
          const d = Math.sqrt(d2);
          const push = (f.r - d) / d;
          f.x += dx * push; f.y += dy * push;
        }
      }
    }
  }
  for (const t of fighters) {
    if (t === f || !t.alive) continue;
    const rr = f.r + t.r;
    const dx = f.x - t.x, dy = f.y - t.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < rr * rr && d2 > 0.0001) {
      const d = Math.sqrt(d2);
      const push = ((rr - d) / d) * 0.5;
      f.x += dx * push; f.y += dy * push;
    }
  }
}

function playerUpdate(dt) {
  if (!player.alive) return;
  let mx = 0, my = 0;
  if (keys['KeyW'] || keys['ArrowUp']) my -= 1;
  if (keys['KeyS'] || keys['ArrowDown']) my += 1;
  if (keys['KeyA'] || keys['ArrowLeft']) mx -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) mx += 1;
  const len = Math.hypot(mx, my);
  if (len > 0) { mx /= len; my /= len; }
  moveFighter(player, mx, my, PLAYER_SPEED, dt);
  const wx = cam.x - VW / 2 + mouseX, wy = cam.y - VH / 2 + mouseY;
  player.dir = Math.atan2(wy - player.y, wx - player.x);
  if (mouseDown && player.weapon && player.weapon.auto) fireWeapon(player);
}

/* ---------------- Particles & feed ---------------- */
function spawnSparks(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), s = rand(40, 190);
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.15, 0.4), color, r: rand(1.5, 3) });
  }
}
function spawnPuff(x, y, color) {
  for (let i = 0; i < 14; i++) {
    const a = rand(0, TAU), s = rand(20, 120);
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.3, 0.8), color, r: rand(2, 5) });
  }
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 0.9; p.vy *= 0.9;
  }
}

function addFeed(text) {
  feed.push({ text, t: 6 });
  if (feed.length > 6) feed.shift();
  feedDirty = true;
}
function updateFeed(dt) {
  let changed = feedDirty;
  for (let i = feed.length - 1; i >= 0; i--) {
    feed[i].t -= dt;
    if (feed[i].t <= 0) { feed.splice(i, 1); changed = true; }
  }
  if (changed) {
    ui.killfeed.innerHTML = feed.map(k => '<div class="kf">' + k.text + '</div>').join('');
    feedDirty = false;
  }
}

function setPrompt(text, t) { promptText = text; promptT = t; }

/* ---------------- Overlay & flow ---------------- */
function showOverlay(title, sub, btnLabel, dimmed) {
  ui.ovTitle.textContent = title;
  ui.ovSub.textContent = sub;
  ui.ovBtn.textContent = btnLabel;
  ui.ovControls.style.display = state === 'menu' ? 'flex' : 'none';
  ui.overlay.classList.remove('hidden');
  ui.overlay.classList.toggle('dim', !!dimmed);
}
function hideOverlay() { ui.overlay.classList.add('hidden'); }

function startMatch() {
  genWorld();
  spawnFighters();
  initZone();
  bullets = []; particles = []; feed = []; feedDirty = true;
  matchOver = false; playerDead = false; placement = 0; specTarget = null;
  state = 'play';
  hideOverlay();
  cam.x = player.x; cam.y = player.y; cam.shake = 0;
  addFeed('Welcome to the dropzone');
  sfx(440, 0.15, 'sine', 0.1, 660);
}
ui.ovBtn.addEventListener('click', startMatch);

/* ---------------- Update ---------------- */
function update(dt) {
  for (const f of fighters) {
    if (!f.alive) continue;
    f.cool = Math.max(0, f.cool - dt);
    f.mcool = Math.max(0, f.mcool - dt);
    f.muzzle = Math.max(0, f.muzzle - dt);
    f.swing = Math.max(0, f.swing - dt);
    f.hitFlash = Math.max(0, f.hitFlash - dt);
    if (f.isPlayer) playerUpdate(dt);
    else if (!matchOver) botUpdate(f, dt);
  }
  updateBullets(dt);
  updatePickups(dt);
  updateZone(dt);
  updateParticles(dt);
  updateFeed(dt);

  let target = player;
  if (playerDead) {
    if (!specTarget || !specTarget.alive) specTarget = fighters.find(f => f.alive) || player;
    target = specTarget;
  }
  const ease = 1 - Math.pow(0.001, dt);
  cam.x = lerp(cam.x, target.x, ease);
  cam.y = lerp(cam.y, target.y, ease);
  cam.shake = Math.max(0, cam.shake - 30 * dt);
  updateHUD(dt);
}

function updateHUD(dt) {
  ui.alive.textContent = fighters.filter(f => f.alive).length;
  ui.kills.textContent = player.kills;
  ui.hpFill.style.width = clamp(player.hp, 0, 100) + '%';
  ui.hpText.textContent = Math.ceil(clamp(player.hp, 0, 100));
  ui.shFill.style.width = clamp(player.shield, 0, 100) + '%';
  ui.shText.textContent = Math.ceil(clamp(player.shield, 0, 100));
  ui.matsVal.textContent = Math.floor(player.mats);
  ui.weaponName.textContent = player.weapon ? player.weapon.name : 'Fists';
  ui.weaponName.style.color = player.weapon ? player.weapon.color : '#eceff1';

  if (matchOver) ui.zoneMsg.textContent = '';
  else if (zone.mode === 'wait' && zone.r > 1) ui.zoneMsg.textContent = 'ZONE SHRINKS IN ' + Math.max(0, Math.ceil(zone.t));
  else if (zone.mode === 'shrink') ui.zoneMsg.textContent = 'ZONE CLOSING';
  else ui.zoneMsg.textContent = 'FINAL ZONE';

  if (promptT > 0) { promptT -= dt; ui.prompt.textContent = promptText; }
  else if (swapTarget && player.alive) ui.prompt.textContent = 'E — swap to ' + WEAPONS[swapTarget.wkey].name;
  else ui.prompt.textContent = '';
}

/* ---------------- Render ---------------- */
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawPickup(p) {
  const y = p.y + Math.sin(p.bob) * 3;
  ctx.save();
  ctx.translate(p.x, y);
  let color, label;
  if (p.type === 'weapon') { color = WEAPONS[p.wkey].color; label = WEAPONS[p.wkey].name[0]; }
  else if (p.type === 'med') { color = '#ef5350'; label = '+'; }
  else if (p.type === 'shield') { color = '#29b6f6'; label = 'S'; }
  else { color = '#ffb74d'; label = 'M'; }
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.fillStyle = 'rgba(15,22,16,0.85)';
  roundRect(-11, -11, 22, 22, 5);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  roundRect(-11, -11, 22, 22, 5);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = 'bold 12px "Chakra Petch", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 0, 1);
  ctx.restore();
}

function drawCrate(o) {
  ctx.fillStyle = '#8d6e63';
  ctx.fillRect(o.x - o.hw, o.y - o.hh, o.hw * 2, o.hh * 2);
  ctx.strokeStyle = '#5d4037';
  ctx.lineWidth = 3;
  ctx.strokeRect(o.x - o.hw, o.y - o.hh, o.hw * 2, o.hh * 2);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(o.x - o.hw, o.y - o.hh); ctx.lineTo(o.x + o.hw, o.y + o.hh);
  ctx.moveTo(o.x + o.hw, o.y - o.hh); ctx.lineTo(o.x - o.hw, o.y + o.hh);
  ctx.stroke();
}
function drawWall(o) {
  ctx.fillStyle = '#a1887f';
  ctx.fillRect(o.x - o.hw, o.y - o.hh, o.hw * 2, o.hh * 2);
  ctx.strokeStyle = '#6d4c41';
  ctx.lineWidth = 2;
  ctx.strokeRect(o.x - o.hw, o.y - o.hh, o.hw * 2, o.hh * 2);
  if (o.hp < WALL_HP) {
    ctx.fillStyle = 'rgba(40,20,10,' + (0.5 * (1 - o.hp / WALL_HP)).toFixed(3) + ')';
    ctx.fillRect(o.x - o.hw, o.y - o.hh, o.hw * 2, o.hh * 2);
  }
}
function drawRock(o) {
  ctx.fillStyle = '#8e9aa3';
  ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath(); ctx.arc(o.x - o.r * 0.25, o.y - o.r * 0.3, o.r * 0.45, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#5f6b73';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, TAU); ctx.stroke();
}
function drawTree(o) {
  ctx.fillStyle = '#6d4c41';
  ctx.beginPath(); ctx.arc(o.x, o.y, o.r * 0.55, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(46, 96, 46, 0.92)';
  ctx.beginPath(); ctx.arc(o.x, o.y, o.canopy, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(84, 140, 70, 0.5)';
  ctx.beginPath(); ctx.arc(o.x - o.canopy * 0.25, o.y - o.canopy * 0.25, o.canopy * 0.55, 0, TAU); ctx.fill();
}

function drawFighter(f) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(f.x, f.y + f.r * 0.75, f.r * 0.9, f.r * 0.45, 0, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(f.x, f.y, f.r, 0, TAU);
  ctx.fillStyle = f.hitFlash > 0 ? '#ffffff' : f.color;
  ctx.fill();
  ctx.lineWidth = f.isPlayer ? 3 : 2;
  ctx.strokeStyle = f.isPlayer ? '#fff8e1' : 'rgba(0,0,0,0.4)';
  ctx.stroke();

  ctx.translate(f.x, f.y);
  ctx.rotate(f.dir);
  if (f.weapon) {
    ctx.fillStyle = '#263238';
    ctx.fillRect(f.r - 4, -3, 16 + f.weapon.tier * 2, 6);
    ctx.fillStyle = f.weapon.color;
    ctx.fillRect(f.r + 4, -2, 8 + f.weapon.tier * 2, 4);
  } else {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.arc(f.r - 2, -7, 4, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(f.r - 2, 7, 4, 0, TAU); ctx.fill();
  }
  if (f.swing > 0) {
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, MELEE_RANGE * 0.8, -0.7, 0.7); ctx.stroke();
  }
  if (f.muzzle > 0) {
    ctx.fillStyle = '#ffe082';
    ctx.beginPath();
    ctx.arc(f.r + (f.weapon ? 14 + f.weapon.tier * 2 : 10), 0, 5, 0, TAU);
    ctx.fill();
  }
  ctx.restore();

  ctx.font = '11px "Chakra Petch", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = f.isPlayer ? '#ffd54f' : 'rgba(255,255,255,0.85)';
  ctx.fillText(f.name, f.x, f.y - f.r - 12);
  const bw = 34;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(f.x - bw / 2, f.y - f.r - 9, bw, 4);
  ctx.fillStyle = '#66bb6a';
  ctx.fillRect(f.x - bw / 2, f.y - f.r - 9, bw * clamp(f.hp / 100, 0, 1), 4);
  if (f.shield > 0) {
    ctx.fillStyle = '#4fc3f7';
    ctx.fillRect(f.x - bw / 2, f.y - f.r - 4, bw * clamp(f.shield / 100, 0, 1), 2);
  }
}

function drawMinimap() {
  const S = 168, M = 14;
  const x0 = VW - S - M, y0 = VH - S - M;
  const k = S / WORLD;
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = 'rgba(10,16,12,0.72)';
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  roundRect(x0 - 4, y0 - 4, S + 8, S + 8, 8);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(87,129,79,0.5)';
  ctx.fillRect(x0, y0, S, S);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, S, S);
  ctx.clip();
  ctx.strokeStyle = 'rgba(178,124,255,0.95)';
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(x0 + zone.x * k, y0 + zone.y * k, Math.max(zone.r * k, 1), 0, TAU); ctx.stroke();
  if (zone.to && zone.to.r > 1) {
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.arc(x0 + zone.to.x * k, y0 + zone.to.y * k, zone.to.r * k, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
  }
  const pf = (playerDead && specTarget) ? specTarget : player;
  ctx.fillStyle = '#ffd54f';
  ctx.beginPath(); ctx.arc(x0 + pf.x * k, y0 + pf.y * k, 3.4, 0, TAU); ctx.fill();
  ctx.restore();
  ctx.restore();
  ctx.globalAlpha = 1;
}

function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, VW, VH);
  const shx = cam.shake ? rand(-cam.shake, cam.shake) : 0;
  const shy = cam.shake ? rand(-cam.shake, cam.shake) : 0;
  const camL = cam.x - VW / 2 + shx, camT = cam.y - VH / 2 + shy;
  ctx.save();
  ctx.translate(-camL, -camT);

  ctx.fillStyle = '#20301f';
  ctx.fillRect(camL, camT, VW, VH);
  ctx.fillStyle = '#57814f';
  ctx.fillRect(0, 0, WORLD, WORLD);

  for (const g of groundPatches) {
    if (g.x < camL - 200 || g.x > camL + VW + 200 || g.y < camT - 200 || g.y > camT + VH + 200) continue;
    ctx.fillStyle = g.c;
    ctx.beginPath();
    ctx.ellipse(g.x, g.y, g.rx, g.ry, 0, 0, TAU);
    ctx.fill();
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.045)';
  ctx.lineWidth = 1;
  const gs = 200;
  ctx.beginPath();
  for (let x = Math.floor(camL / gs) * gs; x < camL + VW; x += gs) { ctx.moveTo(x, camT); ctx.lineTo(x, camT + VH); }
  for (let y = Math.floor(camT / gs) * gs; y < camT + VH; y += gs) { ctx.moveTo(camL, y); ctx.lineTo(camL + VW, y); }
  ctx.stroke();

  if (!matchOver && zone.to && zone.to.r > 1) {
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 10]);
    ctx.beginPath(); ctx.arc(zone.to.x, zone.to.y, zone.to.r, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
  }

  for (const p of pickups) drawPickup(p);
  for (const o of obstacles) {
    if (o.type === 'crate') drawCrate(o);
    else if (o.type === 'wall') drawWall(o);
    else if (o.type === 'rock') drawRock(o);
  }

  ctx.lineCap = 'round';
  for (const b of bullets) {
    ctx.strokeStyle = b.color;
    ctx.lineWidth = 3;
    const k = 0.02;
    ctx.beginPath();
    ctx.moveTo(b.x - b.vx * k, b.y - b.vy * k);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  for (const f of fighters) if (f.alive) drawFighter(f);
  for (const o of obstacles) if (o.type === 'tree') drawTree(o);

  for (const p of particles) {
    ctx.globalAlpha = clamp(p.life * 3, 0, 1);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = 'rgba(84, 44, 140, 0.40)';
  ctx.beginPath();
  ctx.rect(camL - 50, camT - 50, VW + 100, VH + 100);
  ctx.arc(zone.x, zone.y, Math.max(zone.r, 0.1), 0, TAU, true);
  ctx.fill();
  ctx.strokeStyle = 'rgba(178, 124, 255, 0.9)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(zone.x, zone.y, Math.max(zone.r, 0.1), 0, TAU); ctx.stroke();

  ctx.restore();

  drawMinimap();
  if (player && player.alive && dist2(player.x, player.y, zone.x, zone.y) > zone.r * zone.r) {
    ctx.fillStyle = 'rgba(120, 40, 200, 0.10)';
    ctx.fillRect(0, 0, VW, VH);
  }
}

/* ---------------- Main loop ---------------- */
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  if (state === 'play') update(dt);
  render();
  requestAnimationFrame(frame);
}

genWorld();
spawnFighters();
initZone();
showOverlay('DROPZONE ROYALE', '25 drop in. One walks out. Outlast the Zone.', 'DROP IN', false);
requestAnimationFrame(frame);

// Integration: boot, menu wiring, fixed-timestep loop, human input, HUD.
// The simulation itself (phases, AI, physics) lives in engine.js.

import { CONFIG } from './config.js';
import { createMatchState, setupKickoff } from './entities.js';
import { createMatch, step } from './engine.js';
import { playerSpeedMult } from './ai.js';
import { attemptSteal, canKick, doPass, doShoot } from './actions.js';
import { createInput } from './input.js';
import { createRenderer } from './render.js';
import { initBuilder } from './builder.js';
import { initLeague, publishFlow } from './league.js';

const $ = (id) => document.getElementById(id);

const dom = {
  menu: $('menu'),
  hud: $('hud'),
  hudTeam0: $('hud-team0'),
  hudTeam1: $('hud-team1'),
  hudScore: $('hud-score'),
  hudClock: $('hud-clock'),
  hudHalf: $('hud-half'),
  banner: $('banner'),
  bannerText: $('banner-text'),
  btnAgain: $('btn-again'),
  btn1p: $('btn-1p'),
  btn2p: $('btn-2p'),
  btnPause: $('btn-pause'),
  difficulty: $('difficulty'),
  switchmode: $('switchmode'),
  controlsmode: $('controlsmode'),
  goaliemode: $('goaliemode'),
  aimarrow: $('aimarrow'),
  keeperbox: $('keeperbox'),
  legend: $('controls-legend'),
  legendPause: $('legend-pause'),
  legendP1Keys: $('legend-p1-keys'),
  legendP1Mouse: $('legend-p1-mouse'),
  replayNote: $('replay-note'),
  pauseActions: $('pause-actions'),
  btnMenu: $('btn-menu'),
  guide: $('guide'),
  btnGuide: $('btn-guide'),
  btnGuidePause: $('btn-guide-pause'),
  btnGuideBack: $('btn-guide-back'),
};

const input = createInput(window, $('game'));
const renderer = createRenderer($('game'));

let state = null;
let paused = false;
const replayNoteDefault = dom.replayNote.textContent; // stale-engine message
let selectedDifficulty = 'normal';
let selectedSwitchMode = 'auto'; // 'auto' = nearest-to-ball | 'stay' = follow possession only
let selectedControls = 'keys';   // P1: 'keys' | 'mouse'
let selectedGoalie = 'swap';     // 'swap' = goalie key/click works | 'ai' = keeper always AI
let selectedAimArrow = 'on';     // aim arrow in mouse mode
let selectedKeeperBox = 'on';    // protected keeper possession in the inner box
let mouseSwapConsumed = false; // this LMB press was a teammate swap, not a shot

// ---------- Menu wiring ----------

for (const btn of dom.difficulty.querySelectorAll('.btn-diff')) {
  btn.addEventListener('click', () => {
    for (const b of dom.difficulty.querySelectorAll('.btn-diff')) {
      b.classList.remove('selected');
    }
    btn.classList.add('selected');
    selectedDifficulty = btn.dataset.difficulty;
  });
}

for (const btn of dom.switchmode.querySelectorAll('.btn-switch')) {
  btn.addEventListener('click', () => {
    for (const b of dom.switchmode.querySelectorAll('.btn-switch')) {
      b.classList.remove('selected');
    }
    btn.classList.add('selected');
    selectedSwitchMode = btn.dataset.switch;
  });
}

function wireToggleRow(container, btnSelector, onPick) {
  for (const btn of container.querySelectorAll(btnSelector)) {
    btn.addEventListener('click', () => {
      for (const b of container.querySelectorAll(btnSelector)) {
        b.classList.remove('selected');
      }
      btn.classList.add('selected');
      onPick(btn);
    });
  }
}

wireToggleRow(dom.controlsmode, '.btn-controls', (btn) => {
  selectedControls = btn.dataset.controls;
  dom.legendP1Keys.classList.toggle('hidden', selectedControls === 'mouse');
  dom.legendP1Mouse.classList.toggle('hidden', selectedControls !== 'mouse');
});
wireToggleRow(dom.goaliemode, '.btn-goalie', (btn) => {
  selectedGoalie = btn.dataset.goalie;
});
wireToggleRow(dom.aimarrow, '.btn-arrow', (btn) => {
  selectedAimArrow = btn.dataset.arrow;
});
wireToggleRow(dom.keeperbox, '.btn-keeperbox', (btn) => {
  selectedKeeperBox = btn.dataset.keeperbox;
});

function togglePause() {
  if (state && state.phase !== 'fulltime') paused = !paused;
}

dom.btnPause.addEventListener('click', () => {
  togglePause();
  dom.btnPause.blur(); // keep keyboard input on the pitch
});

dom.btn1p.addEventListener('click', () => startMatch('single'));
dom.btn2p.addEventListener('click', () => startMatch('two'));

// Team builder: watch = user's team vs a chosen opponent, AI vs AI; play =
// human (blue, default team) vs the chosen opponent config.
initBuilder({
  onWatch: (mine, opp) => startMatch('watch', [mine, opp], [mine.name, opp.name]),
  onPlay: (opp) => startMatch('single', [null, opp], [null, opp.name]),
  onPublish: (team) => publishFlow(team),
});

// League replays: re-run the deterministic sim from the stored seed +
// config snapshots; oldEngine flags a match recorded by an older engine,
// expected is the stored score (a mismatch shows the diverged notice).
// Play = unranked human match vs any published team, straight off the board.
initLeague({
  onReplay: (cfgA, cfgB, seed, oldEngine, expected) =>
    startMatch('watch', [cfgA, cfgB], [cfgA.name, cfgB.name], seed, oldEngine, expected),
  onPlay: (cfg, name) => startMatch('single', [null, cfg], [null, name]),
});
function returnToMenu() {
  state = null;
  paused = false;
  // Reclaim the legend if the pause screen borrowed it; with state null the
  // overlay sync that normally moves it back no longer runs.
  dom.menu.insertBefore(dom.legend, dom.legendPause);
  dom.menu.classList.remove('hidden');
  dom.hud.classList.add('hidden');
  dom.banner.classList.add('hidden');
  dom.btnAgain.classList.add('hidden');
  dom.replayNote.classList.add('hidden');
}
dom.btnAgain.addEventListener('click', returnToMenu);
dom.btnMenu.addEventListener('click', returnToMenu);

// Guide overlay: openable from the main menu and the pause screen.
dom.btnGuide.addEventListener('click', () => dom.guide.classList.remove('hidden'));
dom.btnGuidePause.addEventListener('click', () => dom.guide.classList.remove('hidden'));
dom.btnGuideBack.addEventListener('click', () => dom.guide.classList.add('hidden'));

// mode 'watch' renders an AI-vs-AI test match (no human input); teamConfigs
// [a, b] feed the team tactics/attributes, names label the HUD. seed makes
// the match a replay; oldEngine shows the stale-engine notice; expectedScore
// is the recorded result a replay must reproduce.
function startMatch(mode, teamConfigs = null, names = null, seed = undefined, oldEngine = false, expectedScore = null) {
  if (mode === 'watch') {
    state = createMatch(teamConfigs[0], teamConfigs[1], seed);
    state.replayScore = expectedScore; // render-only: divergence check at FT
  } else {
    state = createMatchState({ mode, difficulty: selectedDifficulty });
    if (teamConfigs) state.teamConfig = teamConfigs;
  }
  dom.hudTeam0.textContent = ((names && names[0]) || 'Blue').toUpperCase();
  dom.hudTeam1.textContent = ((names && names[1]) || 'Red').toUpperCase();
  state.switchMode = selectedSwitchMode;
  state.controlsMode = selectedControls;
  state.goalieMode = selectedGoalie;
  state.aimArrowOn = selectedAimArrow === 'on';
  // The keeper-box toggle changes sim behavior; watch matches (and replays)
  // must keep the keeperBoxOn=true that createMatch/the server used.
  if (mode !== 'watch') state.keeperBoxOn = selectedKeeperBox === 'on';
  state.keeperProtect = null;
  state.stamina = [1, 1];
  state.staminaLock = [false, false];
  state.stealCooldown = [0, 0];
  state.stealFx = null;
  mouseSwapConsumed = false;
  switchCycle[0].list = switchCycle[1].list = null;
  switchCycle[0].age = switchCycle[1].age = Infinity;
  stayCarrier[0] = stayCarrier[1] = null;
  setupKickoff(state, 0);
  renderer.reset();
  paused = false;
  dom.menu.classList.add('hidden');
  dom.hud.classList.remove('hidden');
  dom.banner.classList.add('hidden');
  dom.btnAgain.classList.add('hidden');
  dom.replayNote.textContent = replayNoteDefault; // undo any diverged message
  dom.replayNote.classList.toggle('hidden', !oldEngine);
}

// ---------- Controlled-player switching ----------

function outfieldersByBallDistance(team) {
  const idxs = [team * 4 + 1, team * 4 + 2, team * 4 + 3];
  return idxs.sort((a, b) => {
    const pa = state.players[a];
    const pb = state.players[b];
    return (
      Math.hypot(pa.x - state.ball.x, pa.y - state.ball.y) -
      Math.hypot(pb.x - state.ball.x, pb.y - state.ball.y)
    );
  });
}

function nearestOutfielder(team) {
  return outfieldersByBallDistance(team)[0];
}

// Manual switch key: first press picks the teammate nearest the ball; quick
// re-presses cycle through a snapshot of that order so every teammate is
// reachable and targets don't shuffle mid-cycle.
const SWITCH_CYCLE_WINDOW_S = 1.5;
const switchCycle = [
  { list: null, pos: -1, age: Infinity },
  { list: null, pos: -1, age: Infinity },
];
const stayCarrier = [null, null]; // teammate currently at the ball (stay mode)

function switchControlTo(team, idx) {
  state.controlled[team] = idx;
  state.switchTimer[team] = 0;
  state.charge[team] = 0;
}

// Nearest teammate first; quick re-presses cycle through a snapshot of that
// order so every teammate is reachable.
function manualSwitch(team) {
  const idx = state.controlled[team];
  const cyc = switchCycle[team];
  if (!cyc.list || cyc.age > SWITCH_CYCLE_WINDOW_S) {
    cyc.list = outfieldersByBallDistance(team);
    cyc.pos = -1;
  }
  for (let step = 1; step <= cyc.list.length; step++) {
    const cand = cyc.list[(cyc.pos + step) % cyc.list.length];
    if (cand !== idx) {
      cyc.pos = cyc.list.indexOf(cand);
      switchControlTo(team, cand);
      break;
    }
  }
  cyc.age = 0;
}

function resolveControlled(team, dt) {
  const idx = state.controlled[team];
  if (idx === null || idx === undefined) return;

  switchCycle[team].age += dt;

  // Goalie key toggles keeper control on/off at any time (unless the menu
  // says the keeper is always AI).
  const keeperIdx = team * 4;
  if (input.goaliePressed(team) && state.goalieMode !== 'ai') {
    switchControlTo(team, idx === keeperIdx ? nearestOutfielder(team) : keeperIdx);
    return;
  }

  // Manual switch key (both modes, works from the keeper too).
  if (input.switchPressed(team)) {
    manualSwitch(team);
    return;
  }

  // Keeper control was an explicit choice — never auto-switch away from it.
  if (state.players[idx].isKeeper) return;

  const nearest = nearestOutfielder(team);

  if (state.switchMode === 'stay') {
    // Control stays put; it follows possession only when a teammate NEWLY
    // takes the ball — so a manual pick isn't stolen back mid-dribble.
    const np = state.players[nearest];
    const d = Math.hypot(np.x - state.ball.x, np.y - state.ball.y);
    const carrier = d < CONFIG.DRIBBLE_RANGE ? nearest : null;
    if (carrier !== null && carrier !== idx && carrier !== stayCarrier[team]) {
      switchControlTo(team, carrier);
    }
    stayCarrier[team] = carrier;
    return;
  }

  // A fresh manual pick sticks for the cycle window before auto reclaims it.
  if (switchCycle[team].age < SWITCH_CYCLE_WINDOW_S) return;

  // Auto: nearest outfielder, but don't yank control mid-charge; switch only
  // after sustained hysteresis.
  if (nearest === idx || input.shootHeld(team)) {
    state.switchTimer[team] = 0;
    return;
  }
  state.switchTimer[team] += dt;
  if (state.switchTimer[team] >= CONFIG.SWITCH_HYSTERESIS_S) {
    switchControlTo(team, nearest);
  }
}

// Sprint: hold the sprint key to move faster while the meter drains; an
// emptied meter locks until it refills part-way. A completed pass refills it.
function sprintSpeed(team, moving, dt) {
  const s = state.stamina;
  const lock = state.staminaLock;
  if (input.sprintHeld(team) && moving && !lock[team] && s[team] > 0) {
    s[team] = Math.max(0, s[team] - dt / CONFIG.SPRINT_MAX_S);
    if (s[team] === 0) lock[team] = true;
    return CONFIG.PLAYER_SPEED * CONFIG.SPRINT_MULT;
  }
  s[team] = Math.min(1, s[team] + dt / CONFIG.SPRINT_REGEN_S);
  if (lock[team] && s[team] >= CONFIG.SPRINT_UNLOCK_FRAC) lock[team] = false;
  return CONFIG.PLAYER_SPEED;
}

function refillStamina(team) {
  state.stamina[team] = 1;
  state.staminaLock[team] = false;
}

// Off-ball shoot button = steal attempt. Real attempts start the cooldown;
// out-of-range presses are free. attemptSteal draws the outcome pulse itself;
// here we only flash red when pressed during cooldown.
function trySteal(team) {
  const idx = state.controlled[team];
  if (idx === null || idx === undefined) return;
  const p = state.players[idx];
  if (state.stealCooldown[team] > 0) {
    state.stealFx = { x: p.x, y: p.y, ttl: 0.2, max: 0.2, color: 'rgba(224, 69, 47, 0.8)' };
    return;
  }
  if (attemptSteal(state, idx) !== null) {
    state.stealCooldown[team] = CONFIG.STEAL_COOLDOWN_S;
  }
}

// P1 mouse scheme: follow the cursor; LMB hold-charge then release shoots at
// the cursor; RMB passes toward it; LMB down on a teammate swaps to them.
function applyMouseInput(team, dt) {
  const idx = state.controlled[team];
  if (idx === null || idx === undefined) return;
  const p = state.players[idx];
  const m = input.getMouse();
  const cur = renderer.toLogical(m.x, m.y);

  // Follow the cursor with arrival slow-down and a deadzone (no orbiting).
  const dx = cur.x - p.x;
  const dy = cur.y - p.y;
  const d = Math.hypot(dx, dy);
  const speed = sprintSpeed(team, d > 8, dt) * playerSpeedMult(state, p);
  if (d > 8) {
    const sp = speed * Math.min(1, (d - 8) / 40);
    p.vx = (dx / d) * sp;
    p.vy = (dy / d) * sp;
  } else {
    p.vx = 0;
    p.vy = 0;
  }

  // LMB down on a teammate = swap; that press can never become a shot.
  if (m.downPressed) {
    mouseSwapConsumed = false;
    for (let i = team * 4; i < team * 4 + 4; i++) {
      if (i === idx) continue;
      const mate = state.players[i];
      if (state.goalieMode === 'ai' && mate.isKeeper) continue;
      if (Math.hypot(cur.x - mate.x, cur.y - mate.y) <= mate.r + 8) {
        switchControlTo(team, i);
        switchCycle[team].age = 0; // manual pick gets the same grace window
        mouseSwapConsumed = true;
        return;
      }
    }
    // Off the ball, LMB is a steal attempt instead of a shot.
    if (!canKick(state, idx)) trySteal(team);
  }

  if (m.passPressed) {
    if (doPass(state, idx, dx, dy)) refillStamina(team);
  }

  if (m.held && !mouseSwapConsumed) {
    state.charge[team] = Math.min(state.charge[team] + dt, CONFIG.SHOT_CHARGE_MAX_S);
  } else if (m.released) {
    if (!mouseSwapConsumed) doShoot(state, idx, state.charge[team], 0, cur.x, cur.y);
    state.charge[team] = 0;
    mouseSwapConsumed = false;
  } else {
    state.charge[team] = 0;
  }

  if (state.aimArrowOn && canKick(state, idx)) {
    state.aimArrow = {
      x: p.x,
      y: p.y,
      tx: cur.x,
      ty: cur.y,
      charge: state.charge[team] / CONFIG.SHOT_CHARGE_MAX_S,
    };
  }
}

function applyHumanInput(team, dt) {
  if (team === 0 && state.controlsMode === 'mouse') {
    applyMouseInput(team, dt);
    return;
  }
  const idx = state.controlled[team];
  if (idx === null || idx === undefined) return;
  const p = state.players[idx];
  const mv = input.getMove(team);
  const speed = sprintSpeed(team, mv.x !== 0 || mv.y !== 0, dt) * playerSpeedMult(state, p);
  p.vx = mv.x * speed;
  p.vy = mv.y * speed;

  // Off the ball, the shoot button is a steal attempt.
  if (input.shootPressed(team) && !canKick(state, idx)) {
    trySteal(team);
  }

  // Pass button doubles as switch: with the ball it passes, without it it
  // selects the nearest teammate (re-press cycles).
  if (input.passPressed(team)) {
    if (canKick(state, idx)) {
      if (doPass(state, idx, mv.x, mv.y)) refillStamina(team);
    } else {
      manualSwitch(team);
      return;
    }
  }
  if (input.shootHeld(team)) {
    state.charge[team] = Math.min(
      state.charge[team] + dt,
      CONFIG.SHOT_CHARGE_MAX_S
    );
  } else if (input.shootReleased(team)) {
    doShoot(state, idx, state.charge[team]);
    state.charge[team] = 0;
  } else {
    state.charge[team] = 0; // charge dropped (e.g. window blur) — cancel
  }
}

// ---------- Simulation tick ----------

function tick(dt) {
  if (!state) {
    input.endTick();
    return;
  }

  if (input.pausePressed()) {
    togglePause();
  }
  if (paused || state.phase === 'fulltime') {
    input.endTick();
    return;
  }

  state.aimArrow = null; // re-set each tick by mouse input while playing
  if (state.phase !== 'playing') state.keeperProtect = null;
  for (const t of [0, 1]) {
    state.stealCooldown[t] = Math.max(0, state.stealCooldown[t] - dt);
  }
  if (state.stealFx) {
    state.stealFx.ttl -= dt;
    if (state.stealFx.ttl <= 0) state.stealFx = null;
  }

  // Human control + input run before the sim step; the engine never reads
  // input, it only sees the velocities/actions already applied to state.
  if (state.phase === 'kickoff') {
    // Allow goalie-key swaps during the freeze ("at any time").
    resolveControlled(0, dt);
    resolveControlled(1, dt);
  } else if (state.phase === 'playing') {
    resolveControlled(0, dt);
    resolveControlled(1, dt);
    applyHumanInput(0, dt);
    applyHumanInput(1, dt);
  }

  step(state, dt);

  input.endTick();
}

// ---------- HUD / banner DOM sync ----------

function formatClock(s) {
  const total = Math.max(0, Math.floor(s));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function updateOverlays() {
  if (!state) return;

  dom.hudScore.textContent = `${state.score[0]} – ${state.score[1]}`;
  dom.hudClock.textContent = formatClock(state.clockS);
  dom.hudHalf.textContent = state.half === 1 ? '1st Half' : '2nd Half';

  let text = null;
  let showAgain = false;
  if (paused) {
    text = 'Paused';
  } else if (state.phase === 'kickoff') {
    text = 'Kick Off';
  } else if (state.phase === 'goal') {
    text = 'GOAL!';
  } else if (state.phase === 'halftime') {
    text = 'Half Time';
  } else if (state.phase === 'fulltime') {
    const [a, b] = state.score;
    text =
      a === b
        ? `Draw ${a} – ${b}`
        : a > b
          ? `Blue Wins ${a} – ${b}`
          : `Red Wins ${b} – ${a}`;
    showAgain = true;
    // Determinism is per-JS-engine at the last floating-point bit; if this
    // browser re-simulated a different score, say so instead of lying.
    if (
      state.replayScore &&
      (a !== state.replayScore[0] || b !== state.replayScore[1])
    ) {
      dom.replayNote.textContent = `Replay diverged — recorded score was ${state.replayScore[0]} – ${state.replayScore[1]} (browser floating-point differs from the server).`;
      dom.replayNote.classList.remove('hidden');
    }
  }

  dom.banner.classList.toggle('hidden', text === null);
  if (text !== null) dom.bannerText.textContent = text;
  dom.btnAgain.classList.toggle('hidden', !showAgain);
  dom.pauseActions.classList.toggle('hidden', !paused);
  dom.btnPause.textContent = paused ? '▶' : '❚❚';
  dom.btnPause.classList.toggle('hidden', state.phase === 'fulltime');

  // Show the controls legend on the pause screen; the same node moves back
  // to the menu when unpaused so the two can never drift apart.
  if (paused && dom.legend.parentElement !== dom.banner) {
    dom.banner.insertBefore(dom.legend, dom.btnAgain);
  } else if (!paused && dom.legend.parentElement !== dom.menu) {
    dom.menu.insertBefore(dom.legend, dom.legendPause);
  }
}

// ---------- Main loop: fixed timestep with accumulator ----------

let lastTime = performance.now();
let accumulator = 0;

function frame(now) {
  let delta = (now - lastTime) / 1000;
  lastTime = now;
  if (delta > 0.25) delta = 0.25; // tab-switch / hiccup clamp
  accumulator += delta;

  while (accumulator >= CONFIG.TICK_DT) {
    tick(CONFIG.TICK_DT);
    accumulator -= CONFIG.TICK_DT;
  }

  if (state) renderer.render(state);
  updateOverlays();
  requestAnimationFrame(frame);
}

renderer.resize();
window.addEventListener('resize', () => renderer.resize());
requestAnimationFrame(frame);

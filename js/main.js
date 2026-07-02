// Integration: boot, menu wiring, fixed-timestep loop, human input, phases, HUD.

import { CONFIG } from './config.js';
import { createMatchState, setupKickoff, applyHalftime } from './entities.js';
import { stepPhysics } from './physics.js';
import { doPass, doShoot } from './actions.js';
import { updateAI } from './ai.js';
import { createInput } from './input.js';
import { createRenderer } from './render.js';

const $ = (id) => document.getElementById(id);

const dom = {
  menu: $('menu'),
  hud: $('hud'),
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
};

const input = createInput(window);
const renderer = createRenderer($('game'));

let state = null;
let paused = false;
let selectedDifficulty = 'normal';
let selectedSwitchMode = 'auto'; // 'auto' = nearest-to-ball | 'stay' = follow possession only
let pendingKickoffTeam = 0; // conceding team, restarts play after a goal

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

function togglePause() {
  if (state && state.phase !== 'fulltime') paused = !paused;
}

dom.btnPause.addEventListener('click', () => {
  togglePause();
  dom.btnPause.blur(); // keep keyboard input on the pitch
});

dom.btn1p.addEventListener('click', () => startMatch('single'));
dom.btn2p.addEventListener('click', () => startMatch('two'));
dom.btnAgain.addEventListener('click', () => {
  state = null;
  paused = false;
  dom.menu.classList.remove('hidden');
  dom.hud.classList.add('hidden');
  dom.banner.classList.add('hidden');
  dom.btnAgain.classList.add('hidden');
});

function startMatch(mode) {
  state = createMatchState({ mode, difficulty: selectedDifficulty });
  state.switchMode = selectedSwitchMode;
  setupKickoff(state, 0);
  renderer.reset();
  paused = false;
  dom.menu.classList.add('hidden');
  dom.hud.classList.remove('hidden');
  dom.banner.classList.add('hidden');
  dom.btnAgain.classList.add('hidden');
}

// ---------- Controlled-player switching ----------

function nearestOutfielder(team) {
  let nearest = -1;
  let nearestD = Infinity;
  for (let i = team * 4 + 1; i < team * 4 + 4; i++) {
    const p = state.players[i];
    const d = Math.hypot(p.x - state.ball.x, p.y - state.ball.y);
    if (d < nearestD) {
      nearestD = d;
      nearest = i;
    }
  }
  return nearest;
}

function switchControlTo(team, idx) {
  state.controlled[team] = idx;
  state.switchTimer[team] = 0;
  state.charge[team] = 0;
}

function resolveControlled(team, dt) {
  const idx = state.controlled[team];
  if (idx === null || idx === undefined) return;

  // Goalie key toggles keeper control on/off at any time.
  const keeperIdx = team * 4;
  if (input.goaliePressed(team)) {
    switchControlTo(team, idx === keeperIdx ? nearestOutfielder(team) : keeperIdx);
    return;
  }
  // Keeper control was an explicit choice — never auto-switch away from it.
  if (state.players[idx].isKeeper) return;

  const nearest = nearestOutfielder(team);

  if (state.switchMode === 'stay') {
    // Control stays put; it only follows possession — switch when a teammate
    // takes the ball at their feet.
    if (nearest !== idx) {
      const np = state.players[nearest];
      const d = Math.hypot(np.x - state.ball.x, np.y - state.ball.y);
      if (d < CONFIG.DRIBBLE_RANGE) switchControlTo(team, nearest);
    }
    return;
  }

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

function applyHumanInput(team, dt) {
  const idx = state.controlled[team];
  if (idx === null || idx === undefined) return;
  const p = state.players[idx];
  const mv = input.getMove(team);
  p.vx = mv.x * CONFIG.PLAYER_SPEED;
  p.vy = mv.y * CONFIG.PLAYER_SPEED;

  if (input.passPressed(team)) {
    doPass(state, idx, mv.x, mv.y);
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

  switch (state.phase) {
    case 'kickoff': {
      // Allow goalie-key swaps during the freeze ("at any time").
      resolveControlled(0, dt);
      resolveControlled(1, dt);
      updateAI(state, dt); // drift-to-position only outside 'playing'
      stepPhysics(state, dt);
      // Ball stays dead on the spot until the freeze ends; incidental contact
      // while it's pinned must not count as a touch.
      state.ball.x = CONFIG.PITCH_W / 2;
      state.ball.y = CONFIG.PITCH_H / 2;
      state.ball.vx = 0;
      state.ball.vy = 0;
      state.lastTouchTeam = null;
      state.phaseTimer -= dt;
      if (state.phaseTimer <= 0) {
        state.phase = 'playing';
        state.phaseTimer = 0;
      }
      break;
    }

    case 'goal': {
      updateAI(state, dt);
      stepPhysics(state, dt);
      state.phaseTimer -= dt;
      if (state.phaseTimer <= 0) {
        setupKickoff(state, pendingKickoffTeam);
      }
      break;
    }

    case 'halftime': {
      updateAI(state, dt);
      stepPhysics(state, dt);
      state.phaseTimer -= dt;
      if (state.phaseTimer <= 0) {
        applyHalftime(state); // flips attackDir, kickoff for team 1
      }
      break;
    }

    case 'playing': {
      resolveControlled(0, dt);
      resolveControlled(1, dt);
      applyHumanInput(0, dt);
      applyHumanInput(1, dt);
      updateAI(state, dt);
      const events = stepPhysics(state, dt);

      for (const ev of events) {
        if (ev.type === 'goal') {
          state.score[ev.scoringTeam] += 1;
          state.charge[0] = 0;
          state.charge[1] = 0;
          pendingKickoffTeam = 1 - ev.scoringTeam;
          state.phase = 'goal';
          state.phaseTimer = CONFIG.GOAL_PAUSE_S;
        }
      }

      if (state.phase === 'playing') {
        state.clockS += dt;
        if (state.half === 1 && state.clockS >= CONFIG.HALF_LENGTH_S) {
          state.phase = 'halftime';
          state.phaseTimer = CONFIG.GOAL_PAUSE_S;
        } else if (
          state.half === 2 &&
          state.clockS >= 2 * CONFIG.HALF_LENGTH_S
        ) {
          state.phase = 'fulltime';
          state.phaseTimer = 0;
        }
      }
      break;
    }
  }

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
  }

  dom.banner.classList.toggle('hidden', text === null);
  if (text !== null) dom.bannerText.textContent = text;
  dom.btnAgain.classList.toggle('hidden', !showAgain);
  dom.btnPause.textContent = paused ? '▶' : '❚❚';
  dom.btnPause.classList.toggle('hidden', state.phase === 'fulltime');
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

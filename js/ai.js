// AI brains: teammate positioning, opponent team roles, goalkeepers.
// Controls every player not listed in state.controlled.

import { CONFIG, keeperBox } from './config.js';
import { attemptSteal, canKick, findPassTarget, doPass, doShoot, doClear } from './actions.js';

// AI-only tuning (module-local; gameplay-wide constants live in config.js).
const SHOT_RANGE = 340;        // distance to goal center that triggers a shot
const PRESS_DIST = 85;         // opponent-within distance that counts as "pressed"
const KICK_COOLDOWN_S = 0.45;  // min time between deliberate kicks per AI player
const BALL_SHIFT_X = 0.22;     // how much anchors slide toward the ball (x)
const BALL_SHIFT_Y = 0.35;     // how much anchors slide toward the ball (y)
const POSSESSION_PUSH = 0.11;  // pitch-widths anchors push up / drop back
const OPEN_OFFSET = 60;        // desired separation from nearest opponent when open
const ARRIVE_RADIUS = 12;      // slow-down radius to stop anchor jitter
const THROUGH_PASS_GAIN = 120; // teammate must be this much further upfield to earn a pass

// Formation slots per outfield index-within-team (index 0 is the keeper).
const SLOTS = [
  null,
  { xFrac: 0.22, yFrac: 0.50 }, // defender
  { xFrac: 0.46, yFrac: 0.28 }, // upper mid
  { xFrac: 0.46, yFrac: 0.72 }, // lower mid / striker
];

function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Set velocity toward a target with arrival slow-down; never produces NaN.
function seek(p, tx, ty, speed) {
  const dx = tx - p.x;
  const dy = ty - p.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) {
    p.vx = 0;
    p.vy = 0;
    return;
  }
  const sp = d < ARRIVE_RADIUS ? speed * (d / ARRIVE_RADIUS) : speed;
  p.vx = (dx / d) * sp;
  p.vy = (dy / d) * sp;
}

function brainOf(state) {
  if (!state._ai) {
    state._ai = {
      perceived: [null, null],       // possession each team's brain believes in
      reactT: [0, 0],                // time spent noticing a possession change
      cooldown: new Array(8).fill(0),
      stealCd: new Array(8).fill(0),
      keeperHold: new Array(8).fill(0),
      keeperTy: new Array(8).fill(null), // lagged keeper tracking target
    };
  }
  return state._ai;
}

function difficultyFor(state, team) {
  // Fully AI-run teams use the selected difficulty; AI teammates of a human
  // (either mode) play at 'normal'.
  const key = state.controlled[team] == null ? state.difficulty : 'normal';
  return CONFIG.DIFFICULTY[key] || CONFIG.DIFFICULTY.normal;
}

function goalCenter(state, team, own) {
  const dir = state.attackDir[team];
  const attackX = dir === 1 ? CONFIG.PITCH_W : 0;
  return { x: own ? CONFIG.PITCH_W - attackX : attackX, y: CONFIG.PITCH_H / 2 };
}

// Actual possession right now: team of the player touching-distance to the
// ball, otherwise the last team to touch it.
function actualPossession(state) {
  let best = null;
  let bestD = CONFIG.DRIBBLE_RANGE + 8;
  for (const p of state.players) {
    const d = dist(p.x, p.y, state.ball.x, state.ball.y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best ? best.team : state.lastTouchTeam;
}

function carrierIndex(state) {
  let best = -1;
  let bestD = CONFIG.DRIBBLE_RANGE + 8;
  state.players.forEach((p, i) => {
    const d = dist(p.x, p.y, state.ball.x, state.ball.y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

// Formation anchor for an outfielder, shifted with the ball and by the
// perceived possession posture.
function anchor(state, p, posture) {
  const slot = SLOTS[p.id % 4];
  const dir = state.attackDir[p.team];
  const ownGoalX = dir === 1 ? 0 : CONFIG.PITCH_W;
  let x = ownGoalX + dir * slot.xFrac * CONFIG.PITCH_W;
  let y = slot.yFrac * CONFIG.PITCH_H;
  x += (state.ball.x - x) * BALL_SHIFT_X;
  y += (state.ball.y - y) * BALL_SHIFT_Y;
  x += dir * posture * POSSESSION_PUSH * CONFIG.PITCH_W;
  const m = CONFIG.PLAYER_RADIUS + 4;
  return {
    x: clamp(x, m, CONFIG.PITCH_W - m),
    y: clamp(y, m, CONFIG.PITCH_H - m),
  };
}

function nearestOpponent(state, p) {
  let best = null;
  let bestD = Infinity;
  for (const o of state.players) {
    if (o.team === p.team) continue;
    const d = dist(o.x, o.y, p.x, p.y);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return { opp: best, d: bestD };
}

// Progress toward that player's attacking goal (bigger = more advanced).
function progress(state, p) {
  return state.attackDir[p.team] === 1 ? p.x : CONFIG.PITCH_W - p.x;
}

function driftToFormation(state, p, speedMult) {
  const home = p.isKeeper
    ? keeperHome(state, p)
    : anchor(state, p, 0);
  seek(p, home.x, home.y, CONFIG.PLAYER_SPEED * 0.9 * speedMult);
}

function keeperHome(state, p) {
  const dir = state.attackDir[p.team];
  const ownGoalX = dir === 1 ? 0 : CONFIG.PITCH_W;
  return { x: ownGoalX + dir * CONFIG.KEEPER_LINE_OFFSET, y: CONFIG.PITCH_H / 2 };
}

function updateKeeper(state, idx, diff, brain, dt) {
  const p = state.players[idx];
  const ball = state.ball;
  const dir = state.attackDir[p.team];
  const ownGoalX = dir === 1 ? 0 : CONFIG.PITCH_W;
  const lineX = ownGoalX + dir * CONFIG.KEEPER_LINE_OFFSET;
  const goalTop = (CONFIG.PITCH_H - CONFIG.GOAL_W) / 2;
  const goalBot = goalTop + CONFIG.GOAL_W;
  const speed = CONFIG.KEEPER_SPEED * diff.aiSpeedMult;

  if (canKick(state, idx)) {
    // Smothered the ball: pause, then distribute. Under box protection the
    // keeper holds longer and looks for an open teammate (opponents have
    // backed off) before falling back to a clear.
    brain.keeperHold[idx] += dt;
    p.vx = 0;
    p.vy = 0;
    const protectedNow = state.keeperProtect === p.team;
    const hold = protectedNow ? CONFIG.KEEPER_PROTECT_HOLD_S : CONFIG.KEEPER_CLEAR_DELAY_S;
    if (brain.keeperHold[idx] >= hold && brain.cooldown[idx] <= 0) {
      let passed = false;
      if (protectedNow) {
        const mate = findPassTarget(state, idx, dir, 0);
        if (mate != null) passed = doPass(state, idx, dir, 0, diff.passError);
      }
      if (!passed) doClear(state, idx);
      brain.keeperHold[idx] = 0;
      brain.cooldown[idx] = KICK_COOLDOWN_S;
    }
    return;
  }
  brain.keeperHold[idx] = 0;

  const ballDepth = Math.abs(ball.x - ownGoalX);
  const nearMouth = ball.y > goalTop - 50 && ball.y < goalBot + 50;
  const close = dist(p.x, p.y, ball.x, ball.y) < CONFIG.KEEPER_SMOTHER_RANGE;
  if (ballDepth < CONFIG.KEEPER_RANGE_X && nearMouth && close) {
    seek(p, ball.x, ball.y, speed); // come out and smother
    return;
  }

  // Track the ball's y along the line, with slight anticipation but a
  // difficulty-scaled reaction lag so keepers are beatable in the corners.
  const idealY = clamp(
    ball.y + ball.vy * 0.12,
    goalTop + p.r,
    goalBot - p.r
  );
  const lag = Math.max(diff.keeperLagS || 0.2, dt);
  if (brain.keeperTy[idx] == null) brain.keeperTy[idx] = idealY;
  brain.keeperTy[idx] += (idealY - brain.keeperTy[idx]) * Math.min(1, dt / lag);
  seek(p, lineX, brain.keeperTy[idx], speed);
}

function updateCarrier(state, idx, diff, brain, dt) {
  const p = state.players[idx];
  const goal = goalCenter(state, p.team, false);
  const dGoal = dist(p.x, p.y, goal.x, goal.y);
  const gx = goal.x - p.x;
  const gy = goal.y - p.y;
  const gd = Math.max(1e-6, Math.hypot(gx, gy));
  const dirX = gx / gd;
  const dirY = gy / gd;

  if (canKick(state, idx) && brain.cooldown[idx] <= 0) {
    if (dGoal < SHOT_RANGE) {
      const charge = clamp(dGoal / SHOT_RANGE, 0.45, 1) * CONFIG.SHOT_CHARGE_MAX_S;
      doShoot(state, idx, charge, diff.shotError);
      brain.cooldown[idx] = KICK_COOLDOWN_S;
      return;
    }
    const { d: oppD } = nearestOpponent(state, p);
    if (oppD < PRESS_DIST) {
      if (doPass(state, idx, dirX, dirY, diff.passError)) {
        brain.cooldown[idx] = KICK_COOLDOWN_S;
        return;
      }
    } else {
      // Unpressed: occasionally release a clearly better-placed teammate.
      const mate = findPassTarget(state, idx, dirX, dirY);
      if (
        mate != null &&
        progress(state, state.players[mate]) - progress(state, p) > THROUGH_PASS_GAIN &&
        Math.random() < dt * 0.9
      ) {
        if (doPass(state, idx, dirX, dirY, diff.passError)) {
          brain.cooldown[idx] = KICK_COOLDOWN_S;
          return;
        }
      }
    }
  }

  // Collect the ball before turning upfield — "in kick range" is wider than
  // dribble contact, and walking goalward without the ball causes a limit
  // cycle straddling the range boundary (visible as full-speed vibration).
  const sp = CONFIG.PLAYER_SPEED * diff.aiSpeedMult;
  const dBall = dist(p.x, p.y, state.ball.x, state.ball.y);
  if (dBall > CONFIG.DRIBBLE_RANGE * 0.75) {
    seek(p, state.ball.x, state.ball.y, sp);
    return;
  }
  p.vx = dirX * sp;
  p.vy = dirY * sp;
}

// Position between the ball and the most dangerous opposing receiver.
function coverLanePoint(state, team, carrierIdx) {
  const ball = state.ball;
  let receiver = null;
  let bestProg = -Infinity;
  for (const o of state.players) {
    if (o.team === team || o.isKeeper) continue;
    if (state.players[carrierIdx] === o) continue;
    const pr = progress(state, o);
    if (pr > bestProg) {
      bestProg = pr;
      receiver = o;
    }
  }
  const target = receiver || goalCenter(state, team, true);
  return {
    x: ball.x + (target.x - ball.x) * 0.45,
    y: ball.y + (target.y - ball.y) * 0.45,
  };
}

function updateTeam(state, team, brain, dt) {
  const diff = difficultyFor(state, team);
  const speed = CONFIG.PLAYER_SPEED * diff.aiSpeedMult;
  const perceived = brain.perceived[team];
  const carIdx = carrierIndex(state);
  const humanIdx = state.controlled[team];

  // AI outfielders on this team, nearest-to-ball first.
  const outfield = [];
  for (let i = team * 4 + 1; i < team * 4 + 4; i++) {
    if (i === humanIdx) continue;
    outfield.push(i);
  }
  outfield.sort(
    (a, b) =>
      dist(state.players[a].x, state.players[a].y, state.ball.x, state.ball.y) -
      dist(state.players[b].x, state.players[b].y, state.ball.x, state.ball.y)
  );

  const assigned = new Set();

  if (state.keeperBoxOn && state.keeperProtect === 1 - team) {
    // Opponent keeper has protected possession: concede and retreat behind
    // their outer box; no pressing or steals until the ball is distributed.
    const dir = state.attackDir[team];
    const outer = keeperBox(state, 1 - team, 'outer');
    const edge = dir === 1 ? outer.x0 : outer.x1;
    const margin = CONFIG.PLAYER_RADIUS + 10;
    for (const i of outfield) {
      const p = state.players[i];
      const a = anchor(state, p, -1);
      a.x = dir === 1 ? Math.min(a.x, edge - margin) : Math.max(a.x, edge + margin);
      seek(p, a.x, a.y, speed);
    }
  } else if (perceived === team) {
    // We (believe we) have the ball.
    if (carIdx >= 0 && state.players[carIdx].team === team) {
      if (outfield.includes(carIdx)) {
        updateCarrier(state, carIdx, diff, brain, dt);
        assigned.add(carIdx);
      }
      // Everyone else pushes up and stays open (handled below).
    } else if (outfield.length > 0) {
      // Ball loose but ours: nearest AI collects it (unless the human is closer).
      const chaser = outfield[0];
      const cp = state.players[chaser];
      const humanCloser =
        humanIdx != null &&
        dist(state.players[humanIdx].x, state.players[humanIdx].y, state.ball.x, state.ball.y) <
          dist(cp.x, cp.y, state.ball.x, state.ball.y);
      if (!humanCloser) {
        seek(cp, state.ball.x, state.ball.y, speed);
        assigned.add(chaser);
      }
    }
    for (const i of outfield) {
      if (assigned.has(i)) continue;
      const p = state.players[i];
      const a = anchor(state, p, 1);
      // Stay open: step away from a tight marker.
      const { opp, d } = nearestOpponent(state, p);
      if (opp && d < OPEN_OFFSET && d > 1e-6) {
        const k = (OPEN_OFFSET - d) / d;
        a.x = clamp(a.x + (p.x - opp.x) * k, p.r, CONFIG.PITCH_W - p.r);
        a.y = clamp(a.y + (p.y - opp.y) * k, p.r, CONFIG.PITCH_H - p.r);
      }
      seek(p, a.x, a.y, speed);
    }
  } else {
    // Defending (perceived opponent ball) or loose ball.
    const posture = perceived == null ? 0 : -1;
    if (outfield.length > 0) {
      const presser = outfield[0];
      const pp = state.players[presser];
      const humanCloser =
        humanIdx != null &&
        dist(state.players[humanIdx].x, state.players[humanIdx].y, state.ball.x, state.ball.y) <
          dist(pp.x, pp.y, state.ball.x, state.ball.y);
      if (!humanCloser) {
        // Press the ball, leading it slightly. On easier settings, hold a
        // standoff goal-side of a carried ball instead of diving straight in.
        let tx = state.ball.x + state.ball.vx * 0.15;
        let ty = state.ball.y + state.ball.vy * 0.15;
        if (
          diff.pressStandoff > 0 &&
          carIdx >= 0 &&
          state.players[carIdx].team !== team
        ) {
          const own = goalCenter(state, team, true);
          const dx = own.x - tx;
          const dy = own.y - ty;
          const dd = Math.hypot(dx, dy);
          if (dd > 1e-6) {
            tx += (dx / dd) * diff.pressStandoff;
            ty += (dy / dd) * diff.pressStandoff;
          }
        }
        seek(pp, tx, ty, speed);
        assigned.add(presser);
        // In lunge range of an opposing carrier: try the same steal move
        // humans have, at a difficulty-scaled rate.
        if (
          brain.stealCd[presser] <= 0 &&
          carIdx >= 0 &&
          state.players[carIdx].team !== team &&
          dist(pp.x, pp.y, state.ball.x, state.ball.y) <= CONFIG.STEAL_RANGE
        ) {
          if (attemptSteal(state, presser) !== null) {
            brain.stealCd[presser] = diff.stealCooldownS || 1.6;
          }
        }
        // If the presser reaches the ball, it may hoof it forward.
        if (canKick(state, presser) && brain.cooldown[presser] <= 0) {
          updateCarrier(state, presser, diff, brain, dt);
        }
      }
      if (perceived != null && carIdx >= 0 && outfield.length > 1) {
        const cover = outfield.find((i) => !assigned.has(i));
        if (cover != null) {
          const cpnt = coverLanePoint(state, team, carIdx);
          seek(state.players[cover], cpnt.x, cpnt.y, speed);
          assigned.add(cover);
        }
      }
    }
    for (const i of outfield) {
      if (assigned.has(i)) continue;
      const p = state.players[i];
      const a = anchor(state, p, posture);
      seek(p, a.x, a.y, speed);
    }
  }

  // Keeper is always AI.
  const keeperIdx = team * 4;
  if (keeperIdx !== humanIdx) {
    updateKeeper(state, keeperIdx, diff, brain, dt);
  }
}

export function updateAI(state, dt) {
  const brain = brainOf(state);

  for (let i = 0; i < 8; i++) {
    if (brain.cooldown[i] > 0) brain.cooldown[i] -= dt;
    if (brain.stealCd[i] > 0) brain.stealCd[i] -= dt;
  }

  // Perception with reaction delay: a team's brain only accepts a possession
  // change after its difficulty's reaction time has elapsed.
  const actual = actualPossession(state);
  for (const t of [0, 1]) {
    if (brain.perceived[t] !== actual) {
      brain.reactT[t] += dt;
      // Floor the delay at 2+ ticks so possession flapping (e.g. a player
      // oscillating on the range boundary) can't flip postures every tick.
      if (brain.reactT[t] >= Math.max(difficultyFor(state, t).reactionDelayS, 0.12)) {
        brain.perceived[t] = actual;
        brain.reactT[t] = 0;
      }
    } else {
      brain.reactT[t] = 0;
    }
  }

  // Outside open play: no actions. During the kickoff freeze everyone holds
  // the staged positions from setupKickoff; in the other pauses AI players
  // drift toward formation spots and controlled players are stopped (input
  // is not applied outside 'playing', so their velocity would go stale).
  if (state.phase !== 'playing') {
    for (let i = 0; i < 8; i++) {
      const p = state.players[i];
      if (state.phase === 'kickoff' || i === state.controlled[p.team]) {
        p.vx = 0;
        p.vy = 0;
        continue;
      }
      driftToFormation(state, p, difficultyFor(state, p.team).aiSpeedMult);
    }
    return;
  }

  updateTeam(state, 0, brain, dt);
  updateTeam(state, 1, brain, dt);
}

// Shared ball-action helpers used by human input (main.js) and ai.js.

import { CONFIG, keeperBox, pointInBox } from './config.js';

function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

function normalize(x, y) {
  const len = Math.hypot(x, y);
  if (len < 1e-9) return { x: 0, y: 0, len: 0 };
  return { x: x / len, y: y / len, len };
}

function rotate(x, y, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: x * c - y * s, y: x * s + y * c };
}

function goalCenterX(state, playerIdx) {
  const dir = state.attackDir[state.players[playerIdx].team];
  return dir === 1 ? CONFIG.PITCH_W : 0;
}

function nearestOpponentDist(state, x, y, team) {
  let best = Infinity;
  for (const p of state.players) {
    if (p.team === team) continue;
    const d = dist(p.x, p.y, x, y);
    if (d < best) best = d;
  }
  return best;
}

function kickBall(state, playerIdx, vx, vy) {
  const ball = state.ball;
  const speed = Math.hypot(vx, vy);
  if (speed > CONFIG.BALL_MAX_SPEED) {
    const k = CONFIG.BALL_MAX_SPEED / speed;
    vx *= k;
    vy *= k;
  }
  ball.vx = vx;
  ball.vy = vy;
  state.lastTouchTeam = state.players[playerIdx].team;
  // A deliberate kick releases the dribble-carry grip, so the widened carry
  // radius can't reel a slowing pass or weak shot straight back in.
  if (state._carry) {
    state._carry.idx = -1;
    state._carry.t = 0;
  }
}

// Which team (if any) currently has protected keeper possession: their keeper
// is holding the ball inside its own inner box. Null if neither.
export function computeKeeperProtect(state) {
  for (const team of [0, 1]) {
    const keeper = state.players[team * 4];
    const box = keeperBox(state, team, 'inner');
    if (
      dist(keeper.x, keeper.y, state.ball.x, state.ball.y) <= CONFIG.KICK_RANGE &&
      pointInBox(keeper.x, keeper.y, box) &&
      pointInBox(state.ball.x, state.ball.y, box, CONFIG.BALL_RADIUS)
    ) {
      return team;
    }
  }
  return null;
}

export function canKick(state, playerIdx) {
  const p = state.players[playerIdx];
  return dist(p.x, p.y, state.ball.x, state.ball.y) <= CONFIG.KICK_RANGE;
}

// Score teammates by alignment with the intended direction and by openness
// (distance from nearest opponent). Returns the best index or null.
export function findPassTarget(state, playerIdx, dirX, dirY) {
  const passer = state.players[playerIdx];
  const team = passer.team;
  const attackDir = state.attackDir[team];
  let dir = normalize(dirX, dirY);
  const neutral = dir.len < 0.1;
  if (neutral) dir = { x: attackDir, y: 0 }; // default to "forward"

  let bestIdx = null;
  let bestScore = -Infinity;
  for (let i = 0; i < state.players.length; i++) {
    const mate = state.players[i];
    if (i === playerIdx || mate.team !== team) continue;

    const dx = mate.x - passer.x;
    const dy = mate.y - passer.y;
    const d = Math.hypot(dx, dy);
    if (d < CONFIG.PLAYER_RADIUS * 2) continue; // on top of each other

    const align = (dx * dir.x + dy * dir.y) / d; // -1..1
    if (align < (neutral ? 0 : -0.2)) continue;  // behind the intended direction

    const openness = Math.min(nearestOpponentDist(state, mate.x, mate.y, team), 200) / 200;
    // Prefer aligned, open teammates at a comfortable (not extreme) distance.
    const distPenalty = Math.abs(d - 260) / 700;
    const score = align * 1.4 + openness * 1.0 - distPenalty;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export function doPass(state, playerIdx, dirX, dirY, error = 0) {
  if (!canKick(state, playerIdx)) return false;
  const targetIdx = findPassTarget(state, playerIdx, dirX, dirY);
  if (targetIdx === null) return false;

  const mate = state.players[targetIdx];
  // Lead the pass toward where the receiver is heading.
  const tx = mate.x + mate.vx * CONFIG.PASS_LEAD_S;
  const ty = mate.y + mate.vy * CONFIG.PASS_LEAD_S;

  let aim = normalize(tx - state.ball.x, ty - state.ball.y);
  if (aim.len === 0) return false;
  if (error > 0) {
    aim = rotate(aim.x, aim.y, (Math.random() * 2 - 1) * error);
  }
  kickBall(state, playerIdx, aim.x * CONFIG.PASS_SPEED, aim.y * CONFIG.PASS_SPEED);
  return true;
}

// aimX/aimY: explicit target (e.g. mouse cursor) — shot goes exactly there,
// with no movement bend. Omitted: auto-aim at the corner away from the keeper.
export function doShoot(state, playerIdx, chargeS, error = 0, aimX = null, aimY = null) {
  if (!canKick(state, playerIdx)) return;
  const p = state.players[playerIdx];

  let aim;
  if (aimX !== null && aimY !== null) {
    aim = normalize(aimX - state.ball.x, aimY - state.ball.y);
    if (aim.len === 0) aim = { x: state.attackDir[p.team], y: 0 };
  } else {
    const gx = goalCenterX(state, playerIdx);
    // Aim for the corner away from the keeper — dead center is where they stand.
    const keeper = state.players[(1 - p.team) * 4];
    const mouthTop = (CONFIG.PITCH_H - CONFIG.GOAL_W) / 2;
    const inset = CONFIG.BALL_RADIUS * 2 + 14;
    const gy = keeper.y >= CONFIG.PITCH_H / 2
      ? mouthTop + inset
      : mouthTop + CONFIG.GOAL_W - inset;

    aim = normalize(gx - state.ball.x, gy - state.ball.y);
    if (aim.len === 0) aim = { x: state.attackDir[p.team], y: 0 };

    // Movement bends the aim: lateral velocity relative to the shot direction.
    const speed = Math.hypot(p.vx, p.vy);
    if (speed > 1) {
      const lateral = (p.vx * -aim.y + p.vy * aim.x) / CONFIG.PLAYER_SPEED;
      aim = rotate(aim.x, aim.y, lateral * CONFIG.SHOT_BEND);
    }
  }
  if (error > 0) {
    aim = rotate(aim.x, aim.y, (Math.random() * 2 - 1) * error);
  }

  const t = Math.min(Math.max(chargeS / CONFIG.SHOT_CHARGE_MAX_S, 0), 1);
  const shotSpeed = CONFIG.SHOT_SPEED_MIN + t * (CONFIG.SHOT_SPEED_MAX - CONFIG.SHOT_SPEED_MIN);
  kickBall(state, playerIdx, aim.x * shotSpeed, aim.y * shotSpeed);
}

// Steal attempt by an off-ball player against an opposing carrier.
// Returns 'win' | 'knock' | 'whiff', or null when there is nothing to steal
// (no opposing carrier, or the ball is out of lunge range) — null attempts
// are free, they don't consume the cooldown.
export function attemptSteal(state, playerIdx) {
  const p = state.players[playerIdx];
  const ball = state.ball;
  if (dist(p.x, p.y, ball.x, ball.y) > CONFIG.STEAL_RANGE) return null;

  // An opponent must actually be carrying (touching-distance to the ball).
  let carrier = null;
  let carrierDist = CONFIG.DRIBBLE_RANGE + 4;
  for (const o of state.players) {
    if (o.team === p.team) continue;
    const d = dist(o.x, o.y, ball.x, ball.y);
    if (d < carrierDist) {
      carrierDist = d;
      carrier = o;
    }
  }
  if (!carrier) return null;

  const roll = Math.random();
  let result;
  if (roll < CONFIG.STEAL_WIN_P) {
    // Clean steal: ball lands at the stealer's feet with carry grip.
    const away = normalize(p.x - carrier.x, p.y - carrier.y);
    const off = away.len > 0 ? away : { x: 0, y: -1 };
    ball.x = p.x + off.x * (CONFIG.PLAYER_RADIUS + CONFIG.BALL_RADIUS + 2);
    ball.y = p.y + off.y * (CONFIG.PLAYER_RADIUS + CONFIG.BALL_RADIUS + 2);
    ball.vx = p.vx;
    ball.vy = p.vy;
    state.lastTouchTeam = p.team;
    if (state._carry) {
      state._carry.idx = playerIdx;
      state._carry.t = 0.3;
    }
    result = 'win';
  } else if (roll < CONFIG.STEAL_WIN_P + CONFIG.STEAL_KNOCK_P) {
    // Toe-poke: ball squirts loose in a random direction.
    const a = Math.random() * Math.PI * 2;
    ball.vx = Math.cos(a) * CONFIG.STEAL_KNOCK_SPEED;
    ball.vy = Math.sin(a) * CONFIG.STEAL_KNOCK_SPEED;
    state.lastTouchTeam = p.team;
    if (state._carry) {
      state._carry.idx = -1;
      state._carry.t = 0;
    }
    result = 'knock';
  } else {
    result = 'whiff';
  }
  // Outcome pulse for whoever attempted — human or AI.
  state.stealFx = { x: p.x, y: p.y, ttl: 0.28, max: 0.28, color: STEAL_FX_COLORS[result] };
  return result;
}

const STEAL_FX_COLORS = {
  win: 'rgba(105, 221, 138, 0.9)',
  knock: 'rgba(255, 255, 255, 0.9)',
  whiff: 'rgba(160, 160, 160, 0.7)',
};

export function doClear(state, playerIdx) {
  if (!canKick(state, playerIdx)) return;
  const p = state.players[playerIdx];
  const attackDir = state.attackDir[p.team];

  // Prefer an upfield teammate; otherwise blast straight upfield with a
  // slight vertical spread away from the pitch center.
  const targetIdx = findPassTarget(state, playerIdx, attackDir, 0);
  let aim;
  if (targetIdx !== null) {
    const mate = state.players[targetIdx];
    aim = normalize(mate.x - state.ball.x, mate.y - state.ball.y);
    // Bias the clear upfield even when the teammate is square.
    aim = normalize(aim.x + attackDir * 0.8, aim.y);
  } else {
    const ySpread = p.y < CONFIG.PITCH_H / 2 ? -0.35 : 0.35;
    aim = normalize(attackDir, ySpread);
  }
  if (aim.len === 0) aim = { x: attackDir, y: 0 };
  kickBall(state, playerIdx, aim.x * CONFIG.CLEAR_SPEED, aim.y * CONFIG.CLEAR_SPEED);
}

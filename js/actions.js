// Shared ball-action helpers used by human input (main.js) and ai.js.

import { CONFIG } from './config.js';

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

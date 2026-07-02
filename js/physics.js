// Physics: integration, ball-wall/goal handling, player separation, dribbling.
// stepPhysics mutates state and returns an array of events (currently only goals).

import { CONFIG } from './config.js';

const EPS = 1e-6;

function isFiniteNum(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

function sanitizeBody(b) {
  if (!isFiniteNum(b.x)) b.x = CONFIG.PITCH_W / 2;
  if (!isFiniteNum(b.y)) b.y = CONFIG.PITCH_H / 2;
  if (!isFiniteNum(b.vx)) b.vx = 0;
  if (!isFiniteNum(b.vy)) b.vy = 0;
}

function clampSpeed(b, max) {
  const sp = Math.hypot(b.vx, b.vy);
  if (sp > max) {
    const k = max / sp;
    b.vx *= k;
    b.vy *= k;
  }
}

// Vertical extent of the goal mouth openings.
function goalMouth() {
  const top = (CONFIG.PITCH_H - CONFIG.GOAL_W) / 2;
  return { top, bottom: top + CONFIG.GOAL_W };
}

function stepPlayers(state, dt) {
  const { PITCH_W, PITCH_H } = CONFIG;
  for (const p of state.players) {
    sanitizeBody(p);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.x < p.r) p.x = p.r;
    if (p.x > PITCH_W - p.r) p.x = PITCH_W - p.r;
    if (p.y < p.r) p.y = p.r;
    if (p.y > PITCH_H - p.r) p.y = PITCH_H - p.r;
  }
}

function clampPlayerToPitch(p) {
  const { PITCH_W, PITCH_H } = CONFIG;
  if (p.x < p.r) p.x = p.r;
  if (p.x > PITCH_W - p.r) p.x = PITCH_W - p.r;
  if (p.y < p.r) p.y = p.r;
  if (p.y > PITCH_H - p.r) p.y = PITCH_H - p.r;
}

function separatePlayers(state) {
  const ps = state.players;
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i];
      const b = ps[j];
      const minDist = a.r + b.r;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist = Math.hypot(dx, dy);
      if (dist >= minDist) continue;
      if (dist < EPS) {
        // Perfectly overlapping: deterministic nudge apart along x.
        dx = 1;
        dy = 0;
        dist = 1;
      }
      const push = (minDist - dist) / 2;
      const nx = dx / dist;
      const ny = dy / dist;
      a.x -= nx * push;
      a.y -= ny * push;
      b.x += nx * push;
      b.y += ny * push;
      // Separation must not shove anyone through the boundary walls.
      clampPlayerToPitch(a);
      clampPlayerToPitch(b);
    }
  }
}

function stepBall(state, dt) {
  const ball = state.ball;
  sanitizeBody(ball);
  const decay = Math.pow(CONFIG.BALL_FRICTION, dt);
  ball.vx *= decay;
  ball.vy *= decay;
  if (Math.hypot(ball.vx, ball.vy) < 2) {
    ball.vx = 0;
    ball.vy = 0;
  }
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
}

// Dribble capture + hard ball-player collision. Nearest touching player wins.
function ballPlayerContact(state) {
  const ball = state.ball;
  let nearest = null;
  let nearestDist = Infinity;
  for (const p of state.players) {
    const d = Math.hypot(ball.x - p.x, ball.y - p.y);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = p;
    }
  }
  if (!nearest) return;

  const p = nearest;
  const pSpeed = Math.hypot(p.vx, p.vy);
  const ballSpeed = Math.hypot(ball.vx, ball.vy);
  // A freshly kicked ball outruns capture so shots/passes escape the kicker.
  const captureMax = pSpeed * CONFIG.DRIBBLE_PUSH + 150;

  // Contested ball — an opponent is also in touching range. Skip the spring
  // capture (which re-aims ball velocity outright each tick and ping-pongs
  // the ball between the two nearest players) and let hard collisions decide.
  let contested = false;
  for (const q of state.players) {
    if (q.team === p.team) continue;
    if (Math.hypot(ball.x - q.x, ball.y - q.y) < CONFIG.DRIBBLE_RANGE) {
      contested = true;
      break;
    }
  }

  if (
    !contested &&
    nearestDist < CONFIG.DRIBBLE_RANGE &&
    pSpeed > 10 &&
    ballSpeed <= captureMax
  ) {
    // Dribble: nudge the ball to a spot ahead of the movement direction.
    const dirX = p.vx / pSpeed;
    const dirY = p.vy / pSpeed;
    const tx = p.x + dirX * CONFIG.DRIBBLE_LEAD;
    const ty = p.y + dirY * CONFIG.DRIBBLE_LEAD;
    const gain = 6; // spring toward the lead point, stable at 60 Hz
    ball.vx = dirX * pSpeed * CONFIG.DRIBBLE_PUSH + (tx - ball.x) * gain;
    ball.vy = dirY * pSpeed * CONFIG.DRIBBLE_PUSH + (ty - ball.y) * gain;
    state.lastTouchTeam = p.team;
    return;
  }

  // Hard collision: push the ball out and reflect its velocity.
  const minDist = p.r + ball.r;
  if (nearestDist < minDist) {
    let nx = ball.x - p.x;
    let ny = ball.y - p.y;
    const d = Math.hypot(nx, ny);
    if (d < EPS) {
      nx = 1;
      ny = 0;
    } else {
      nx /= d;
      ny /= d;
    }
    ball.x = p.x + nx * minDist;
    ball.y = p.y + ny * minDist;
    const vn = ball.vx * nx + ball.vy * ny;
    if (vn < 0) {
      const rest = 0.6;
      ball.vx -= (1 + rest) * vn * nx;
      ball.vy -= (1 + rest) * vn * ny;
    }
    // Body motion imparts a shove so a running player wins loose balls.
    ball.vx += p.vx * 0.5;
    ball.vy += p.vy * 0.5;
    state.lastTouchTeam = p.team;
  }
}

// Walls, goal-mouth openings, goal cavity, and goal detection.
function ballWorldCollisions(state, wasFullyAcross, dt) {
  const ball = state.ball;
  const { PITCH_W, PITCH_H, WALL_BOUNCE, GOAL_DEPTH } = CONFIG;
  const r = ball.r;
  const mouth = goalMouth();
  const events = [];

  // Top/bottom walls (also cap the mouth cavity vertically below).
  if (ball.y < r) {
    ball.y = r;
    ball.vy = Math.abs(ball.vy) * WALL_BOUNCE;
  } else if (ball.y > PITCH_H - r) {
    ball.y = PITCH_H - r;
    ball.vy = -Math.abs(ball.vy) * WALL_BOUNCE;
  }

  const inMouth = ball.y > mouth.top && ball.y < mouth.bottom;
  const NET_BOUNCE = 0.25; // nets deaden the ball so it settles after a goal

  // Left side.
  if (ball.x < r) {
    if (!inMouth && ball.x > -r) {
      ball.x = r;
      ball.vx = Math.abs(ball.vx) * WALL_BOUNCE;
    } else {
      // Inside the left goal cavity: back wall and inner side walls.
      const back = -GOAL_DEPTH + r;
      if (ball.x < back) {
        ball.x = back;
        ball.vx = Math.abs(ball.vx) * NET_BOUNCE;
      }
      if (ball.x < r) {
        if (ball.y < mouth.top + r) {
          ball.y = mouth.top + r;
          ball.vy = Math.abs(ball.vy) * NET_BOUNCE;
        } else if (ball.y > mouth.bottom - r) {
          ball.y = mouth.bottom - r;
          ball.vy = -Math.abs(ball.vy) * NET_BOUNCE;
        }
      }
      if (!wasFullyAcross && ball.x + r < 0) {
        // Left goal is scored on by the team attacking left (attackDir -1).
        const scoringTeam = state.attackDir[0] === -1 ? 0 : 1;
        events.push({ type: 'goal', scoringTeam });
      }
    }
  }

  // Right side (mirror).
  if (ball.x > PITCH_W - r) {
    if (!inMouth && ball.x < PITCH_W + r) {
      ball.x = PITCH_W - r;
      ball.vx = -Math.abs(ball.vx) * WALL_BOUNCE;
    } else {
      const back = PITCH_W + GOAL_DEPTH - r;
      if (ball.x > back) {
        ball.x = back;
        ball.vx = -Math.abs(ball.vx) * NET_BOUNCE;
      }
      if (ball.x > PITCH_W - r) {
        if (ball.y < mouth.top + r) {
          ball.y = mouth.top + r;
          ball.vy = Math.abs(ball.vy) * NET_BOUNCE;
        } else if (ball.y > mouth.bottom - r) {
          ball.y = mouth.bottom - r;
          ball.vy = -Math.abs(ball.vy) * NET_BOUNCE;
        }
      }
      if (!wasFullyAcross && ball.x - r > PITCH_W) {
        const scoringTeam = state.attackDir[0] === 1 ? 0 : 1;
        events.push({ type: 'goal', scoringTeam });
      }
    }
  }

  // Once fully in a net, kill momentum fast so the ball stays put.
  if (ball.x + r < 0 || ball.x - r > PITCH_W) {
    const damp = Math.pow(0.001, dt);
    ball.vx *= damp;
    ball.vy *= damp;
  }

  return events;
}

export function stepPhysics(state, dt) {
  if (!isFiniteNum(dt) || dt <= 0) return [];
  dt = Math.min(dt, 0.05); // never integrate a runaway step

  const ball = state.ball;
  sanitizeBody(ball);
  // Was the ball already fully across a line before this step? Prevents
  // re-firing the goal event every tick while it sits in the net.
  const wasFullyAcross =
    ball.x + ball.r < 0 || ball.x - ball.r > CONFIG.PITCH_W;

  stepPlayers(state, dt);
  separatePlayers(state);
  stepBall(state, dt);
  ballPlayerContact(state);
  const events = ballWorldCollisions(state, wasFullyAcross, dt);

  clampSpeed(ball, CONFIG.BALL_MAX_SPEED);
  sanitizeBody(ball);
  for (const p of state.players) sanitizeBody(p);

  return events;
}

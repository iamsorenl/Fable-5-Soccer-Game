// Canvas renderer: gameplay visuals only (menus/HUD/banners live in the DOM).
import { CONFIG } from './config.js';

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  // logical-units -> canvas-pixels scale, recomputed on resize
  let scale = 1;
  // remembered facing per player id so the indicator holds while standing still
  const facing = new Map();

  // total drawn area includes the recessed goal nets on either side
  const DRAW_W = CONFIG.PITCH_W + CONFIG.GOAL_DEPTH * 2;
  const DRAW_H = CONFIG.PITCH_H;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const aspect = DRAW_W / DRAW_H;
    const margin = 0.96; // small breathing room around the pitch
    let cssW = window.innerWidth * margin;
    let cssH = cssW / aspect;
    if (cssH > window.innerHeight * margin) {
      cssH = window.innerHeight * margin;
      cssW = cssH * aspect;
    }
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    scale = canvas.width / DRAW_W;
  }

  function drawPitch() {
    const { PITCH_W: W, PITCH_H: H, GOAL_W, GOAL_DEPTH } = CONFIG;
    const C = CONFIG.COLORS;

    ctx.fillStyle = C.pitch;
    ctx.fillRect(0, 0, W, H);

    // mow stripes
    const stripes = 10;
    const stripeW = W / stripes;
    ctx.fillStyle = C.pitchDark;
    for (let i = 0; i < stripes; i += 2) {
      ctx.fillRect(i * stripeW, 0, stripeW, H);
    }

    ctx.strokeStyle = C.lines;
    ctx.lineWidth = 3;

    // outer boundary
    ctx.strokeRect(1.5, 1.5, W - 3, H - 3);

    // halfway line + center circle + spot
    ctx.beginPath();
    ctx.moveTo(W / 2, 0);
    ctx.lineTo(W / 2, H);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 80, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 5, 0, Math.PI * 2);
    ctx.fillStyle = C.lines;
    ctx.fill();

    // goal boxes
    const boxW = 140;
    const boxH = GOAL_W + 140;
    ctx.strokeRect(0, (H - boxH) / 2, boxW, boxH);
    ctx.strokeRect(W - boxW, (H - boxH) / 2, boxW, boxH);

    // goal mouths: openings drawn as recessed nets behind each goal line
    const gTop = (H - GOAL_W) / 2;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.30)';
    ctx.fillRect(-GOAL_DEPTH, gTop, GOAL_DEPTH, GOAL_W);
    ctx.fillRect(W, gTop, GOAL_DEPTH, GOAL_W);
    ctx.strokeStyle = C.lines;
    ctx.lineWidth = 4;
    for (const gx of [0, W]) {
      ctx.beginPath();
      ctx.moveTo(gx, gTop);
      ctx.lineTo(gx, gTop + GOAL_W);
      ctx.stroke();
    }
  }

  function drawPlayer(p, isControlled) {
    const C = CONFIG.COLORS;

    // update remembered facing from velocity
    const speed = Math.hypot(p.vx, p.vy);
    if (speed > 1) facing.set(p.id, Math.atan2(p.vy, p.vx));
    const angle = facing.has(p.id) ? facing.get(p.id) : (p.team === 0 ? 0 : Math.PI);

    if (isControlled) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r + 6, 0, Math.PI * 2);
      ctx.strokeStyle = C.ring;
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = p.team === 0 ? C.team0 : C.team1;
    ctx.fill();
    ctx.strokeStyle = p.isKeeper ? '#ffffff' : 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // facing indicator: a short notch from center toward the facing direction
    ctx.beginPath();
    ctx.moveTo(p.x + Math.cos(angle) * p.r * 0.35, p.y + Math.sin(angle) * p.r * 0.35);
    ctx.lineTo(p.x + Math.cos(angle) * (p.r - 2), p.y + Math.sin(angle) * (p.r - 2));
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  function drawBall(ball) {
    const C = CONFIG.COLORS;
    ctx.beginPath();
    ctx.ellipse(ball.x + 3, ball.y + 4, ball.r, ball.r * 0.8, 0, 0, Math.PI * 2);
    ctx.fillStyle = C.ballShadow;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fillStyle = C.ball;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function drawChargeBar(p, chargeS) {
    const C = CONFIG.COLORS;
    const frac = Math.min(1, chargeS / CONFIG.SHOT_CHARGE_MAX_S);
    const barW = 44;
    const barH = 7;
    const bx = p.x - barW / 2;
    const by = p.y - p.r - 20;
    ctx.fillStyle = C.chargeBarBg;
    ctx.fillRect(bx, by, barW, barH);
    ctx.fillStyle = C.chargeBar;
    ctx.fillRect(bx + 1, by + 1, (barW - 2) * frac, barH - 2);
  }

  function render(state) {
    // logical origin (pitch top-left) sits GOAL_DEPTH in from the canvas edge
    ctx.setTransform(scale, 0, 0, scale, CONFIG.GOAL_DEPTH * scale, 0);
    ctx.clearRect(-CONFIG.GOAL_DEPTH, 0, DRAW_W, DRAW_H);
    drawPitch();

    for (let i = 0; i < state.players.length; i++) {
      const p = state.players[i];
      const isControlled = state.controlled[p.team] === i;
      drawPlayer(p, isControlled);
    }

    drawBall(state.ball);

    // shot-charge bar above each charging controlled player
    for (let team = 0; team < 2; team++) {
      const idx = state.controlled[team];
      if (idx === null || idx === undefined) continue;
      if (state.charge[team] > 0) drawChargeBar(state.players[idx], state.charge[team]);
    }
  }

  // Forget remembered facings so a new match doesn't inherit the old one's.
  function reset() {
    facing.clear();
  }

  return { render, resize, reset };
}

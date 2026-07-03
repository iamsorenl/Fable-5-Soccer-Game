// Canvas renderer: gameplay visuals only (menus/HUD/banners live in the DOM).
import { CONFIG } from './config.js';

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  // logical-units -> canvas-pixels scale, recomputed on resize
  let scale = 1;
  // remembered facing per player id so the indicator holds while standing still
  const facing = new Map();

  // Player sprites (Kenney Sports Pack, CC0). Sprites face +x; circles are
  // drawn as a fallback until both images finish loading.
  const sprites = { team: [new Image(), new Image()], ready: 0 };
  sprites.team[0].src = 'assets/player-blue.png';
  sprites.team[1].src = 'assets/player-red.png';
  for (const img of sprites.team) {
    img.addEventListener('load', () => { sprites.ready += 1; });
  }
  const spritesReady = () => sprites.ready === 2;

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

    if (spritesReady()) {
      // soft contact shadow
      ctx.beginPath();
      ctx.ellipse(p.x + 2, p.y + 3, p.r * 0.95, p.r * 0.75, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
      ctx.fill();

      // keepers keep their white marker as a ground ring under the sprite
      if (p.isKeeper) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + 2, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      const img = sprites.team[p.team];
      const h = p.r * 2.4; // shoulder span slightly wider than the physics circle
      const w = h * (img.width / img.height);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(angle);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      ctx.restore();
      return;
    }

    // Fallback while sprites load: flat circles with a facing notch.
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = p.team === 0 ? C.team0 : C.team1;
    ctx.fill();
    ctx.strokeStyle = p.isKeeper ? '#ffffff' : 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(p.x + Math.cos(angle) * p.r * 0.35, p.y + Math.sin(angle) * p.r * 0.35);
    ctx.lineTo(p.x + Math.cos(angle) * (p.r - 2), p.y + Math.sin(angle) * (p.r - 2));
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // Convert a client (CSS pixel) point to logical pitch coordinates,
  // inverting the render transform (scale + goal-depth x offset).
  function toLogical(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const px = (clientX - rect.left) * (canvas.width / rect.width);
    const py = (clientY - rect.top) * (canvas.height / rect.height);
    return { x: px / scale - CONFIG.GOAL_DEPTH, y: py / scale };
  }

  // Ground arrow from the ball toward the aim point; brightens with charge.
  function drawAimArrow(arrow) {
    const dx = arrow.tx - arrow.x;
    const dy = arrow.ty - arrow.y;
    const d = Math.hypot(dx, dy);
    if (d < 24) return;
    const ux = dx / d;
    const uy = dy / d;
    const len = Math.min(d, 170);
    const x0 = arrow.x + ux * 18;
    const y0 = arrow.y + uy * 18;
    const x1 = arrow.x + ux * len;
    const y1 = arrow.y + uy * len;

    const alpha = 0.35 + 0.5 * (arrow.charge || 0);
    ctx.strokeStyle = `rgba(255, 235, 120, ${alpha})`;
    ctx.lineWidth = 4;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = `rgba(255, 235, 120, ${alpha})`;
    ctx.beginPath();
    ctx.moveTo(x1 + ux * 12, y1 + uy * 12);
    ctx.lineTo(x1 - uy * 7, y1 + ux * 7);
    ctx.lineTo(x1 + uy * 7, y1 - ux * 7);
    ctx.closePath();
    ctx.fill();
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

    if (state.aimArrow) drawAimArrow(state.aimArrow);

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

  return { render, resize, reset, toLogical };
}

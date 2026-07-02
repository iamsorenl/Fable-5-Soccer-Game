// Match state and kickoff placement. (Open-play formation anchors live in
// ai.js.) Kickoff stances are team-relative: { x, y } where x is the offset
// from the pitch center measured along the team's attack direction (negative
// = toward own goal) and y is an absolute pitch y.
// World x = PITCH_W/2 + attackDir * x.

import { CONFIG } from './config.js';

const CX = CONFIG.PITCH_W / 2;
const CY = CONFIG.PITCH_H / 2;

// Kickoff stances: everyone in their own half, outside the center circle.
// The kicking team's forward is moved onto the center spot instead.
const KICKOFF = [
  { x: -(CX - CONFIG.KEEPER_LINE_OFFSET), y: CY },
  { x: -330, y: CY },
  { x: -180, y: CY - 140 },
  { x: -130, y: CY + 120 },
];

export function homeToWorld(home, attackDir) {
  return { x: CX + attackDir * home.x, y: home.y };
}

export function createMatchState({ mode, difficulty }) {
  const players = [];
  for (let i = 0; i < 8; i++) {
    const team = i < 4 ? 0 : 1;
    const slot = i % 4;
    players.push({
      id: i,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      r: CONFIG.PLAYER_RADIUS,
      team,
      isKeeper: slot === 0,
    });
  }

  const state = {
    difficulty: mode === 'single' ? difficulty : 'normal',
    ball: { x: CX, y: CY, vx: 0, vy: 0, r: CONFIG.BALL_RADIUS },
    players,
    controlled: [3, mode === 'two' ? 7 : null],
    switchTimer: [0, 0],
    charge: [0, 0],
    score: [0, 0],
    half: 1,
    clockS: 0,
    phase: 'kickoff',
    phaseTimer: CONFIG.KICKOFF_FREEZE_S,
    attackDir: [1, -1],
    lastTouchTeam: null,
  };

  setupKickoff(state, 0);
  return state;
}

export function setupKickoff(state, kickoffTeam) {
  state.ball.x = CX;
  state.ball.y = CY;
  state.ball.vx = 0;
  state.ball.vy = 0;

  for (const p of state.players) {
    const dir = state.attackDir[p.team];
    const slot = p.id % 4;
    let pos = homeToWorld(KICKOFF[slot], dir);
    // Kicking team's forward takes the center spot, just behind the ball.
    if (p.team === kickoffTeam && slot === 3) {
      pos = { x: CX - dir * (p.r + CONFIG.BALL_RADIUS + 4), y: CY };
    }
    p.x = pos.x;
    p.y = pos.y;
    p.vx = 0;
    p.vy = 0;
  }

  state.phase = 'kickoff';
  state.phaseTimer = CONFIG.KICKOFF_FREEZE_S;
  state.lastTouchTeam = null;
  state.charge[0] = 0;
  state.charge[1] = 0;
}

export function applyHalftime(state) {
  state.attackDir[0] *= -1;
  state.attackDir[1] *= -1;
  state.half = 2;
  setupKickoff(state, 1);
}

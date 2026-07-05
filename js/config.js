// All tuning constants for the arcade soccer game.
// Logical pitch coordinates: origin top-left, +x right, +y down.

export const CONFIG = {
  // Pitch geometry (logical units)
  PITCH_W: 1050,
  PITCH_H: 680,
  GOAL_W: 180,            // goal mouth height (opening in left/right walls)
  GOAL_DEPTH: 40,         // visual depth of the goal behind the line

  // Keeper boxes (both goal ends). Inner = protected zone: while the keeper
  // holds the ball inside it, opponents can't enter or touch the ball. Outer
  // = the line opponents must retreat behind during that protection.
  GOAL_AREA_W: 96,        // inner (protected) box: width from the goal line
  GOAL_AREA_H: 250,       // inner box height (a bit taller than the mouth)
  PENALTY_AREA_W: 196,    // outer box: width from the goal line
  PENALTY_AREA_H: 380,    // outer box height

  // Entity sizes
  PLAYER_RADIUS: 16,
  BALL_RADIUS: 9,

  // Movement
  PLAYER_SPEED: 260,      // units/s for a human-controlled player

  // Sprinting (human-controlled players only)
  SPRINT_MULT: 1.45,        // speed multiplier while sprinting
  SPRINT_MAX_S: 2.0,        // seconds of sprint in a full meter
  SPRINT_REGEN_S: 4.5,      // seconds to refill an empty meter
  SPRINT_UNLOCK_FRAC: 0.35, // an emptied meter must refill to here before reuse

  // Ball
  BALL_FRICTION: 0.38,    // fraction of velocity retained per second (exp decay base)
  BALL_ROLL_DECEL: 45,    // constant rolling resistance (units/s^2) — kills the slow tail
  BALL_STOP_SPEED: 8,     // below this the ball settles to a stop
  BALL_MAX_SPEED: 900,
  WALL_BOUNCE: 0.72,      // restitution off boundary walls

  // Dribbling
  DRIBBLE_RANGE: 34,      // player-center to ball-center distance for dribble contact
  DRIBBLE_LEAD: 26,       // how far ahead of the player the ball is nudged
  DRIBBLE_PUSH: 1.15,     // ball speed multiplier relative to player speed while dribbling

  // Stealing (shoot button while not on the ball)
  STEAL_RANGE: 52,        // max player-to-ball distance for a steal attempt
  STEAL_COOLDOWN_S: 0.9,  // time between attempts (out-of-range presses are free)
  STEAL_WIN_P: 0.35,      // ball comes to the stealer's feet
  STEAL_KNOCK_P: 0.35,    // ball flies off loose (remainder = whiff)
  STEAL_KNOCK_SPEED: 340,

  // Kicking
  KICK_RANGE: 38,         // max distance to act on the ball (pass/shoot/clear)
  PASS_SPEED: 520,
  PASS_LEAD_S: 0.25,      // seconds of receiver movement to lead a pass by
  SHOT_SPEED_MIN: 480,
  SHOT_SPEED_MAX: 860,
  SHOT_CHARGE_MAX_S: 1.0, // hold time for a full-power shot
  SHOT_BEND: 0.22,        // radians of aim bend per unit of lateral movement
  CLEAR_SPEED: 700,

  // Match timing
  HALF_LENGTH_S: 120,
  TICK_DT: 1 / 60,
  KICKOFF_FREEZE_S: 1.0,
  GOAL_PAUSE_S: 2.0,

  // Player switching
  SWITCH_HYSTERESIS_S: 0.35,

  // Goalkeeper
  KEEPER_SPEED: 220,          // units/s tracking along the goal line
  KEEPER_LINE_OFFSET: 30,     // distance the keeper stands off their goal line
  KEEPER_RANGE_X: 130,        // how far off the line a keeper will come to smother
  KEEPER_SMOTHER_RANGE: 90,   // loose-ball distance that triggers coming out
  KEEPER_CLEAR_DELAY_S: 0.4,  // pause holding the ball before clearing
  KEEPER_PROTECT_HOLD_S: 1.5, // hold before distributing under box protection

  COLORS: {
    pitch: '#2e8b3d',
    pitchDark: '#287935',     // alternating mow stripes
    lines: '#e8f5e9',
    team0: '#2f6fe0',
    team1: '#e0452f',
    ball: '#ffffff',
    ballShadow: 'rgba(0, 0, 0, 0.25)',
    ring: '#ffffff',
    chargeBar: '#ffd23f',
    chargeBarBg: 'rgba(0, 0, 0, 0.45)',
  },

  // keeperLagS: how slowly the keeper's tracking target follows the ball.
  // pressStandoff: how far goal-side of a carried ball the presser holds
  // instead of diving straight in (0 = press the ball directly).
  DIFFICULTY: {
    easy:   { aiSpeedMult: 0.68, reactionDelayS: 0.60, shotError: 0.34, passError: 0.26, keeperLagS: 0.50, pressStandoff: 48, stealCooldownS: 2.6 },
    normal: { aiSpeedMult: 0.90, reactionDelayS: 0.25, shotError: 0.16, passError: 0.12, keeperLagS: 0.26, pressStandoff: 0, stealCooldownS: 1.6 },
    hard:   { aiSpeedMult: 1.00, reactionDelayS: 0.10, shotError: 0.07, passError: 0.05, keeperLagS: 0.10, pressStandoff: 0, stealCooldownS: 1.1 },
  },
};

// Rect for a team's inner (protected) or outer (retreat) keeper box, placed
// against that team's own goal line per its current attack direction.
export function keeperBox(state, team, which) {
  const dir = state.attackDir[team];
  const w = which === 'inner' ? CONFIG.GOAL_AREA_W : CONFIG.PENALTY_AREA_W;
  const h = which === 'inner' ? CONFIG.GOAL_AREA_H : CONFIG.PENALTY_AREA_H;
  const y0 = (CONFIG.PITCH_H - h) / 2;
  const x0 = dir === 1 ? 0 : CONFIG.PITCH_W - w; // own goal on the -dir side
  return { x0, x1: x0 + w, y0, y1: y0 + h };
}

export function pointInBox(x, y, box, margin = 0) {
  return (
    x >= box.x0 - margin && x <= box.x1 + margin &&
    y >= box.y0 - margin && y <= box.y1 + margin
  );
}

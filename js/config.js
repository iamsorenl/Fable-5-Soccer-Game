// All tuning constants for the arcade soccer game.
// Logical pitch coordinates: origin top-left, +x right, +y down.

export const CONFIG = {
  // Pitch geometry (logical units)
  PITCH_W: 1050,
  PITCH_H: 680,
  GOAL_W: 180,            // goal mouth height (opening in left/right walls)
  GOAL_DEPTH: 40,         // visual depth of the goal behind the line

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
    easy:   { aiSpeedMult: 0.68, reactionDelayS: 0.60, shotError: 0.34, passError: 0.26, keeperLagS: 0.50, pressStandoff: 48 },
    normal: { aiSpeedMult: 0.90, reactionDelayS: 0.25, shotError: 0.16, passError: 0.12, keeperLagS: 0.26, pressStandoff: 0 },
    hard:   { aiSpeedMult: 1.00, reactionDelayS: 0.10, shotError: 0.07, passError: 0.05, keeperLagS: 0.10, pressStandoff: 0 },
  },
};

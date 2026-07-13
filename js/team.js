// Team config documents: schema constants, validation, presets, formations.
// A team doc is the flat object the engine consumes as state.teamConfig[t]
// (tactical fields + slots + players) plus name/version metadata. The
// validator is pure and self-contained — the exact same code will run
// server-side later to re-check published teams.

import { DEFAULT_TEAM_CONFIG } from './ai.js';

export const CONFIG_VERSION = 1; // schema version, bumped on breaking changes
export const ATTR_BUDGET = 80;   // shared attribute points across all 4 players
export const ATTR_MAX = 10;      // per-attribute range 0..10 (5 = neutral)
export const ATTR_NAMES = ['pace', 'stamina', 'power', 'control'];

// Allowed range per tactical field (defaults live in DEFAULT_TEAM_CONFIG;
// labels/steps drive the builder sliders).
export const TACTIC_RANGES = {
  shotRange:          { min: 150, max: 500,  step: 10,   label: 'Shot range' },
  pressDist:          { min: 40,  max: 160,  step: 5,    label: 'Press distance' },
  possessionPush:     { min: 0,   max: 0.25, step: 0.01, label: 'Possession push' },
  throughPassGain:    { min: 40,  max: 240,  step: 10,   label: 'Through-pass gain' },
  stealCooldownS:     { min: 0.5, max: 4,    step: 0.1,  label: 'Steal cooldown (s)' },
  keeperClearDelayS:  { min: 0.1, max: 2,    step: 0.1,  label: 'Keeper clear delay (s)' },
  keeperProtectHoldS: { min: 0.2, max: 3,    step: 0.1,  label: 'Keeper hold (s)' },
};

// Named formations: outfield slot fractions from own goal (keeper excluded).
export const FORMATIONS = {
  Standard:  [{ xFrac: 0.22, yFrac: 0.50 }, { xFrac: 0.46, yFrac: 0.28 }, { xFrac: 0.46, yFrac: 0.72 }],
  Attacking: [{ xFrac: 0.30, yFrac: 0.50 }, { xFrac: 0.60, yFrac: 0.30 }, { xFrac: 0.60, yFrac: 0.70 }],
  Defensive: [{ xFrac: 0.14, yFrac: 0.50 }, { xFrac: 0.30, yFrac: 0.28 }, { xFrac: 0.30, yFrac: 0.72 }],
  Wide:      [{ xFrac: 0.22, yFrac: 0.50 }, { xFrac: 0.48, yFrac: 0.16 }, { xFrac: 0.48, yFrac: 0.84 }],
};

// A fresh team: the engine defaults plus doc metadata. Deep-copied so edits
// never leak back into DEFAULT_TEAM_CONFIG.
export function defaultTeam(name = 'My Team') {
  return Object.assign(
    { configVersion: CONFIG_VERSION, version: 1, name },
    JSON.parse(JSON.stringify(DEFAULT_TEAM_CONFIG))
  );
}

function preset(name, overrides) {
  return Object.assign(defaultTeam(name), overrides);
}

// Preset opponents (pacai staff-team style). Attribute splits spend the same
// 80-point budget as user teams — 20 per player.
export const PRESETS = {
  default: preset('Default AI', {}),
  balanced: preset('Balanced', {
    shotRange: 320,
    pressDist: 95,
    possessionPush: 0.13,
    stealCooldownS: 1.6,
  }),
  aggressive: preset('Aggressive', {
    shotRange: 400,
    pressDist: 130,
    possessionPush: 0.18,
    throughPassGain: 80,
    stealCooldownS: 0.7,
    keeperClearDelayS: 0.2,
    slots: FORMATIONS.Attacking.map((s) => ({ ...s })),
    players: [
      { pace: 5, stamina: 5, power: 6, control: 4 },
      { pace: 8, stamina: 4, power: 7, control: 1 },
      { pace: 8, stamina: 4, power: 7, control: 1 },
      { pace: 8, stamina: 4, power: 7, control: 1 },
    ],
  }),
  wall: preset('The Wall', {
    shotRange: 260,
    pressDist: 55,
    possessionPush: 0.04,
    throughPassGain: 180,
    stealCooldownS: 2.0,
    keeperProtectHoldS: 2.5,
    slots: FORMATIONS.Defensive.map((s) => ({ ...s })),
    players: [
      { pace: 4, stamina: 5, power: 6, control: 5 },
      { pace: 3, stamina: 7, power: 4, control: 6 },
      { pace: 3, stamina: 7, power: 4, control: 6 },
      { pace: 3, stamina: 7, power: 4, control: 6 },
    ],
  }),
};

// Total attribute points spent across a players array (missing/junk = 0).
export function attrTotal(players) {
  let sum = 0;
  for (const p of players || []) {
    for (const k of ATTR_NAMES) {
      if (p && typeof p[k] === 'number') sum += p[k];
    }
  }
  return sum;
}

// Full schema check: budget + ranges. Returns { ok, errors }.
export function validateTeam(cfg) {
  if (!cfg || typeof cfg !== 'object') {
    return { ok: false, errors: ['config must be an object'] };
  }
  const errors = [];

  if (cfg.configVersion !== CONFIG_VERSION) {
    errors.push(`configVersion must be ${CONFIG_VERSION}`);
  }
  if (!Number.isInteger(cfg.version) || cfg.version < 1) {
    errors.push('version must be a positive integer');
  }
  if (typeof cfg.name !== 'string' || cfg.name.trim().length < 1 || cfg.name.length > 24) {
    errors.push('name must be 1-24 characters');
  }

  for (const [key, r] of Object.entries(TACTIC_RANGES)) {
    const v = cfg[key];
    if (key === 'stealCooldownS' && v === null) continue; // null = difficulty default
    if (typeof v !== 'number' || !Number.isFinite(v) || v < r.min || v > r.max) {
      errors.push(`${key} must be a number in [${r.min}, ${r.max}]`);
    }
  }

  if (!Array.isArray(cfg.slots) || cfg.slots.length !== 3) {
    errors.push('slots must be an array of 3 outfield positions');
  } else {
    cfg.slots.forEach((s, i) => {
      for (const k of ['xFrac', 'yFrac']) {
        const v = s ? s[k] : undefined;
        if (typeof v !== 'number' || v < 0.05 || v > 0.95) {
          errors.push(`slots[${i}].${k} must be a number in [0.05, 0.95]`);
        }
      }
    });
  }

  if (!Array.isArray(cfg.players) || cfg.players.length !== 4) {
    errors.push('players must be an array of 4 attribute splits');
  } else {
    cfg.players.forEach((p, i) => {
      for (const k of ATTR_NAMES) {
        const v = p ? p[k] : undefined;
        if (!Number.isInteger(v) || v < 0 || v > ATTR_MAX) {
          errors.push(`players[${i}].${k} must be an integer in [0, ${ATTR_MAX}]`);
        }
      }
    });
    if (attrTotal(cfg.players) > ATTR_BUDGET) {
      errors.push(`attribute total exceeds the ${ATTR_BUDGET}-point budget`);
    }
  }

  return { ok: errors.length === 0, errors };
}

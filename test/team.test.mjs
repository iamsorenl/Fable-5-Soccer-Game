// Team schema checks: budget/range validation and attribute plumbing.
// Run with: node test/team.test.mjs

import assert from 'node:assert/strict';
import { ATTR_BUDGET, PRESETS, attrTotal, defaultTeam, validateTeam } from '../js/team.js';
import { simulateMatch } from '../js/engine.js';

// Defaults and every preset must validate within the budget.
assert.ok(validateTeam(defaultTeam()).ok, 'default team must validate');
for (const [key, preset] of Object.entries(PRESETS)) {
  const res = validateTeam(preset);
  assert.ok(res.ok, `preset ${key}: ${res.errors.join('; ')}`);
  assert.ok(attrTotal(preset.players) <= ATTR_BUDGET, `preset ${key} over budget`);
}

// Over-budget config rejected.
const over = defaultTeam();
over.players[1].pace = 10; // +5 points, nothing given back
assert.equal(validateTeam(over).ok, false, 'over-budget must be rejected');

// Out-of-range tactic rejected.
const bad = defaultTeam();
bad.pressDist = 9999;
assert.equal(validateTeam(bad).ok, false, 'out-of-range tactic must be rejected');

// Attribute splits must reach gameplay: same seed, different attrs => a
// different match.
const fingerprint = (r) =>
  JSON.stringify([r.score, r.state.ball.x, r.state.ball.y]);
const base = simulateMatch(defaultTeam(), defaultTeam(), 99);
const quick = defaultTeam();
quick.players = quick.players.map(() => ({ pace: 10, stamina: 5, power: 5, control: 0 }));
const boosted = simulateMatch(quick, defaultTeam(), 99);
assert.notEqual(fingerprint(base), fingerprint(boosted), 'attributes must affect the sim');

console.log(`ok — presets valid, budget enforced, attrs change seed 99 from ${base.score.join('-')} to ${boosted.score.join('-')}`);

// Team builder screen: sliders and pickers over the team.js schema with a
// live budget meter, persisted to localStorage. Launches local test matches
// through the onWatch (AI vs AI) and onPlay (human vs AI) callbacks.

import {
  ATTR_BUDGET, ATTR_MAX, ATTR_NAMES, FORMATIONS, PRESETS, TACTIC_RANGES,
  attrTotal, defaultTeam, validateTeam,
} from './team.js';

const STORAGE_KEY = 'arcade-soccer-team';
const POSITIONS = ['GK', 'DF', 'MF', 'FW']; // index-within-team, matches slots

const $ = (id) => document.getElementById(id);

function loadTeam() {
  try {
    const cfg = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (validateTeam(cfg).ok) return cfg;
  } catch {
    // corrupt or missing — start fresh below
  }
  return defaultTeam();
}

// Label + range input + live value readout, appended to parent. onInput may
// return a corrected value (budget clamp) to write back into the slider.
function sliderRow(parent, label, { min, max, step }, value, onInput) {
  const row = document.createElement('label');
  row.className = 'slider-row';
  const name = document.createElement('span');
  name.className = 'slider-name';
  name.textContent = label;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = min;
  input.max = max;
  input.step = step;
  input.value = value;
  const val = document.createElement('span');
  val.className = 'slider-val';
  val.textContent = String(value);
  input.addEventListener('input', () => {
    const corrected = onInput(Number(input.value));
    if (corrected !== undefined) input.value = corrected;
    val.textContent = input.value;
  });
  row.append(name, input, val);
  parent.appendChild(row);
}

export function initBuilder({ onWatch, onPlay }) {
  const root = $('builder');
  const team = loadTeam();

  function save() {
    team.version += 1; // every edit bumps the config version
    localStorage.setItem(STORAGE_KEY, JSON.stringify(team));
  }

  // Team name.
  const nameInput = $('team-name');
  nameInput.value = team.name;
  nameInput.addEventListener('input', () => {
    team.name = nameInput.value.trim().slice(0, 24) || 'My Team';
    save();
  });

  // Formation picker: named slot layouts; the matching one shows selected.
  const formRow = $('formation-row');
  const formBtns = [];
  for (const [key, slots] of Object.entries(FORMATIONS)) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-formation';
    btn.textContent = key;
    btn.addEventListener('click', () => {
      team.slots = slots.map((s) => ({ ...s }));
      save();
      markFormation();
    });
    formRow.appendChild(btn);
    formBtns.push([btn, slots]);
  }
  function markFormation() {
    for (const [btn, slots] of formBtns) {
      btn.classList.toggle(
        'selected',
        JSON.stringify(slots) === JSON.stringify(team.slots)
      );
    }
  }
  markFormation();

  // Tactics sliders.
  const tactics = $('tactics');
  for (const [key, r] of Object.entries(TACTIC_RANGES)) {
    // stealCooldownS starts null (= use the difficulty's value) until touched.
    const start = team[key] == null ? 1.1 : team[key];
    sliderRow(tactics, r.label, r, start, (v) => {
      team[key] = v;
      save();
    });
  }

  // Per-player attribute splits under the shared budget.
  const budgetText = $('budget-text');
  const budgetFill = $('budget-fill');
  function updateBudget() {
    const total = attrTotal(team.players);
    budgetText.textContent = `Points ${total} / ${ATTR_BUDGET}`;
    budgetFill.style.width = `${Math.min(100, (total / ATTR_BUDGET) * 100)}%`;
  }

  const attrsBox = $('attrs');
  for (let i = 0; i < 4; i++) {
    const col = document.createElement('div');
    col.className = 'attr-col';
    const h = document.createElement('div');
    h.className = 'attr-pos';
    h.textContent = POSITIONS[i];
    col.appendChild(h);
    for (const attr of ATTR_NAMES) {
      sliderRow(col, attr, { min: 0, max: ATTR_MAX, step: 1 }, team.players[i][attr], (v) => {
        team.players[i][attr] = v;
        const over = attrTotal(team.players) - ATTR_BUDGET;
        if (over > 0) team.players[i][attr] = v - over; // cap at the budget
        updateBudget();
        save();
        return team.players[i][attr];
      });
    }
    attrsBox.appendChild(col);
  }
  updateBudget();

  // Opponent picker: presets plus the user's own team.
  const oppSel = $('opponent');
  for (const [key, preset] of Object.entries(PRESETS)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = preset.name;
    oppSel.appendChild(opt);
  }
  const mine = document.createElement('option');
  mine.value = 'mine';
  mine.textContent = 'My Team';
  oppSel.appendChild(mine);
  const opponent = () => (oppSel.value === 'mine' ? team : PRESETS[oppSel.value]);

  // Open/close + test-match launch buttons.
  $('btn-builder').addEventListener('click', () => root.classList.remove('hidden'));
  $('btn-builder-back').addEventListener('click', () => root.classList.add('hidden'));
  $('btn-watch').addEventListener('click', () => {
    root.classList.add('hidden');
    onWatch(team, opponent());
  });
  $('btn-playteam').addEventListener('click', () => {
    root.classList.add('hidden');
    onPlay(opponent());
  });
}

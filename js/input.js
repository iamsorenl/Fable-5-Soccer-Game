// Keyboard input: two independent control slots on one keyboard.
// Slot 0 (P1): WASD move, C pass, V shoot. Slot 1 (P2): arrows, comma, period.
// No top-level side effects — listeners attach inside createInput().

const MOVE_KEYS = [
  { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' },
  { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' },
];
const PASS_KEYS = ['KeyC', 'Comma'];
const SHOOT_KEYS = ['KeyV', 'Period'];
const GOALIE_KEYS = ['KeyQ', 'Slash'];
const SWITCH_KEYS = ['KeyE', 'KeyM'];

// Keys whose default behavior (scrolling) must be suppressed. Space is not a
// game control and must stay usable to activate focused menu buttons.
const PREVENT_DEFAULT = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Slash', // Firefox quick-find
]);

// mouseTarget (usually the game canvas) scopes button presses so clicks on
// HUD/menu elements never register as game input; movement and release are
// tracked window-wide so drags ending off-canvas still count.
export function createInput(target = window, mouseTarget = null) {
  const held = new Set();

  // Edge-trigger flags, cleared by endTick().
  const edges = {
    pass: [false, false],
    shootReleased: [false, false],
    goalie: [false, false],
    switch: [false, false],
    pause: false,
  };

  const mouse = {
    x: 0,
    y: 0,
    lmbHeld: false,
    downEdge: false,
    releaseEdge: false,
    rmbEdge: false,
  };

  function onMouseMove(e) {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  }

  function onMouseDown(e) {
    mouse.x = e.clientX; // buttons carry coordinates too — never act on stale ones
    mouse.y = e.clientY;
    if (e.button === 0) {
      mouse.lmbHeld = true;
      mouse.downEdge = true;
    } else if (e.button === 2) {
      mouse.rmbEdge = true;
    }
  }

  function onMouseUp(e) {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    if (e.button === 0) {
      if (mouse.lmbHeld) mouse.releaseEdge = true;
      mouse.lmbHeld = false;
    }
  }

  function onContextMenu(e) {
    e.preventDefault(); // right-click is "pass" on the pitch
  }

  function onKeyDown(e) {
    if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    held.add(e.code);
    for (let slot = 0; slot < 2; slot++) {
      if (e.code === PASS_KEYS[slot]) edges.pass[slot] = true;
      if (e.code === GOALIE_KEYS[slot]) edges.goalie[slot] = true;
      if (e.code === SWITCH_KEYS[slot]) edges.switch[slot] = true;
    }
    if (e.code === 'Escape') edges.pause = true;
  }

  function onKeyUp(e) {
    if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
    for (let slot = 0; slot < 2; slot++) {
      // Only counts as a release if the key was actually held (not eaten by blur).
      if (e.code === SHOOT_KEYS[slot] && held.has(e.code)) {
        edges.shootReleased[slot] = true;
      }
    }
    held.delete(e.code);
  }

  // Clear all held keys on blur so players don't run forever after tab-switch.
  function onBlur() {
    held.clear();
    mouse.lmbHeld = false;
  }

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('blur', onBlur);
  if (mouseTarget) {
    target.addEventListener('mousemove', onMouseMove);
    target.addEventListener('mouseup', onMouseUp);
    mouseTarget.addEventListener('mousedown', onMouseDown);
    mouseTarget.addEventListener('contextmenu', onContextMenu);
  }

  return {
    getMove(slot) {
      const keys = MOVE_KEYS[slot];
      let x = (held.has(keys.right) ? 1 : 0) - (held.has(keys.left) ? 1 : 0);
      let y = (held.has(keys.down) ? 1 : 0) - (held.has(keys.up) ? 1 : 0);
      const len = Math.hypot(x, y);
      if (len > 1) {
        x /= len;
        y /= len;
      }
      return { x, y };
    },

    passPressed(slot) {
      return edges.pass[slot];
    },

    shootHeld(slot) {
      return held.has(SHOOT_KEYS[slot]);
    },

    shootReleased(slot) {
      return edges.shootReleased[slot];
    },

    goaliePressed(slot) {
      return edges.goalie[slot];
    },

    switchPressed(slot) {
      return edges.switch[slot];
    },

    pausePressed() {
      return edges.pause;
    },

    // Mouse state in client (CSS pixel) coordinates; caller converts to
    // pitch coordinates via the renderer.
    getMouse() {
      return {
        x: mouse.x,
        y: mouse.y,
        held: mouse.lmbHeld,
        downPressed: mouse.downEdge,
        released: mouse.releaseEdge,
        passPressed: mouse.rmbEdge,
      };
    },

    endTick() {
      edges.pass[0] = edges.pass[1] = false;
      edges.shootReleased[0] = edges.shootReleased[1] = false;
      edges.goalie[0] = edges.goalie[1] = false;
      edges.switch[0] = edges.switch[1] = false;
      edges.pause = false;
      mouse.downEdge = false;
      mouse.releaseEdge = false;
      mouse.rmbEdge = false;
    },

    // Detach listeners (useful for tests / teardown).
    destroy() {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('blur', onBlur);
      if (mouseTarget) {
        target.removeEventListener('mousemove', onMouseMove);
        target.removeEventListener('mouseup', onMouseUp);
        mouseTarget.removeEventListener('mousedown', onMouseDown);
        mouseTarget.removeEventListener('contextmenu', onContextMenu);
      }
    },
  };
}

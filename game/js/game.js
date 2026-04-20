'use strict';

// ── Global game state ─────────────────────────────────────────────────────────
const GAME = (() => {
  let tiles       = null;
  let player      = null;
  let camera      = { x: 0, y: 0 };
  let _turn       = 0;
  let mode        = 'explore';   // 'explore' | 'combat' | 'dead'
  let combatCtx   = null;        // { enemy, tile }
  let highlights  = new Map();
  let dirty       = true;

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    tiles  = MAP.generate();
    player = new Player(CFG.START_COL, CFG.START_ROW);
    player.recomputeStats();
    _turn = 1;

    centreCamera();
    updateVision();
    buildHighlights();

    UI.log('Добро пожаловать в СЕВЕРНЫЙ РУБЕЖ', 'system');
    UI.log('Вы очнулись в старом бункере. Исследуйте территорию.', 'system');
    UI.log('WASD/стрелки — движение  |  F/Пробел — подобрать', 'system');
    refreshUI();

    document.getElementById('btn-attack').onclick = combatPlayerAttack;
    document.getElementById('btn-item').onclick   = () =>
      UI.showCombatItemMenu(player, useCombatItem);
    document.getElementById('btn-flee').onclick   = combatFlee;
  }

  // ── Camera ─────────────────────────────────────────────────────────────────
  function centreCamera() {
    const p = HEX.toPixel(player.col, player.row, CFG.HEX_SIZE);
    const cv = document.getElementById('game-canvas');
    camera.x = p.x - cv.width  / 2;
    camera.y = p.y - cv.height / 2;
    clampCamera();
  }

  function clampCamera() {
    const cv = document.getElementById('game-canvas');
    camera.x = Math.max(0, Math.min(camera.x,
      CFG.MAP_COLS * RENDERER.HEX_W - cv.width));
    camera.y = Math.max(0, Math.min(camera.y,
      CFG.MAP_ROWS * RENDERER.V_STEP - cv.height));
  }

  // ── Vision ─────────────────────────────────────────────────────────────────
  function updateVision() {
    const W = CFG.MAP_COLS, H = CFG.MAP_ROWS, R = CFG.VISION_RANGE;
    const r0 = Math.max(0, player.row-R-1), r1 = Math.min(H-1, player.row+R+1);
    const c0 = Math.max(0, player.col-R-1), c1 = Math.min(W-1, player.col+R+1);
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++)
        tiles[r*W+c].visible = false;

    for (let r = Math.max(0,player.row-R); r <= Math.min(H-1,player.row+R); r++)
      for (let c = Math.max(0,player.col-R); c <= Math.min(W-1,player.col+R); c++)
        if (HEX.distance(c,r,player.col,player.row) <= R) {
          tiles[r*W+c].visible  = true;
          tiles[r*W+c].explored = true;
        }
  }

  // ── Highlights ─────────────────────────────────────────────────────────────
  function buildHighlights() {
    highlights.clear();
    for (const { col, row } of HEX.neighbors(player.col, player.row)) {
      const t = MAP.getTile(tiles, col, row);
      if (!t || !MAP.passable(t)) continue;
      highlights.set(`${col},${row},${t.enemy ? 'attack' : 'move'}`, true);
    }
  }

  // ── Movement ───────────────────────────────────────────────────────────────
  function moveToHex(col, row) {
    if (mode !== 'explore') return;
    if (HEX.distance(col, row, player.col, player.row) !== 1) return;

    if (player.stun > 0) {
      UI.log('Вы оглушены и пропускаете ход!', 'damage');
      endTurn(); return;
    }

    const tile = MAP.getTile(tiles, col, row);
    if (!tile || !MAP.passable(tile)) return;

    if (tile.enemy) { startCombat(tile.enemy, tile); return; }

    player.col = col;
    player.row = row;

    applyBiomeEffects(tile);
    UI.hidePickup();
    if (tile.items.length) UI.showPickup(tile.items[0]);

    centreCamera();
    updateVision();
    enemyTurns();
    endTurn();
  }

  // WASD → hex direction accounting for odd-row offset
  // Hex odd-row offset neighbour deltas
  // even row: [[1,0],[0,-1],[-1,-1],[-1,0],[-1,1],[0,1]]
  // odd  row: [[1,0],[1,-1],[0,-1], [-1,0],[0,1], [1,1]]
  const DIR_MAP = {
    w:  { even:[0,-1],  odd:[0,-1]  },   // up
    s:  { even:[0,1],   odd:[0,1]   },   // down
    a:  { even:[-1,0],  odd:[-1,0]  },   // left
    d:  { even:[1,0],   odd:[1,0]   },   // right
    q:  { even:[-1,-1], odd:[0,-1]  },   // upper-left
    e:  { even:[0,-1],  odd:[1,-1]  },   // upper-right
    z:  { even:[-1,1],  odd:[0,1]   },   // lower-left
    c:  { even:[0,1],   odd:[1,1]   },   // lower-right
  };

  function handleKey(code) {
    if (mode === 'dead') { location.reload(); return; }
    if (mode === 'combat') return;

    const parity = player.row & 1 ? 'odd' : 'even';
    const dirs   = {
      'ArrowLeft': DIR_MAP.a, 'KeyA': DIR_MAP.a,
      'ArrowRight':DIR_MAP.d, 'KeyD': DIR_MAP.d,
      'ArrowUp':   DIR_MAP.q, 'KeyW': DIR_MAP.w,
      'ArrowDown': DIR_MAP.z, 'KeyS': DIR_MAP.s,
      'KeyQ': DIR_MAP.q, 'KeyE': DIR_MAP.e,
      'KeyZ': DIR_MAP.z, 'KeyC': DIR_MAP.c,
    };

    // Numpad support
    const numpad = {
      'Numpad4':DIR_MAP.a, 'Numpad6':DIR_MAP.d,
      'Numpad8':DIR_MAP.w, 'Numpad2':DIR_MAP.s,
      'Numpad7':DIR_MAP.q, 'Numpad9':DIR_MAP.e,
      'Numpad1':DIR_MAP.z, 'Numpad3':DIR_MAP.c,
    };
    Object.assign(dirs, numpad);

    if (dirs[code]) {
      const [dc, dr] = dirs[code][parity];
      moveToHex(player.col + dc, player.row + dr);
      return;
    }

    if (code === 'Space' || code === 'KeyF') { tryPickup(); return; }

    if (code.startsWith('Digit')) {
      const n = parseInt(code.replace('Digit','')) - 1;
      const item = player.inventory[n];
      if (item) handleInventoryAction(n, item.type==='weapon'||item.type==='armor' ? 'equip' : 'use');
    }
  }

  // ── Biome effects ──────────────────────────────────────────────────────────
  function applyBiomeEffects(tile) {
    if (tile.biome === 'irradiated') {
      const rad = Math.max(0, 8 - player.rad_res);
      if (rad) { player.radiation += rad; UI.log(`☢ Радиация! +${rad} RAD`, 'damage'); }
    }
    if (tile.biome === 'snow') {
      const cold = Math.max(0, 4 - Math.floor(player.cold_res / 8));
      if (cold) { player.cold += cold; UI.log(`❄ Холод! +${cold} COLD`, 'damage'); }
    }
    if (tile.biome === 'swamp' && Math.random() < 0.2) {
      player.hp -= 2; UI.log('Болото: -2 HP', 'damage');
    }
  }

  // ── Pickup ─────────────────────────────────────────────────────────────────
  function tryPickup() {
    if (mode !== 'explore') return;
    const tile = MAP.getTile(tiles, player.col, player.row);
    if (!tile || !tile.items.length) return;
    const item = tile.items[0];
    if (player.addItem(item)) {
      tile.items.shift();
      UI.log(`Подобрано: ${item.name}`, 'pickup');
      tile.items.length ? UI.showPickup(tile.items[0]) : UI.hidePickup();
      refreshUI();
    } else {
      UI.log('Инвентарь переполнен!', 'system');
    }
  }

  // ── Inventory ──────────────────────────────────────────────────────────────
  function handleInventoryAction(idxOrSlot, action) {
    if (action === 'equip') {
      const msg = player.equip(idxOrSlot);
      if (msg) UI.log(msg, 'pickup');
    } else if (action === 'use') {
      const item = player.inventory[idxOrSlot];
      if (!item) return;
      if (item.use) {
        const msg = item.use(player, { revealArea });
        if (msg) UI.log(msg, 'pickup');
        player.removeItem(idxOrSlot);
      } else UI.log(`${item.name} — нельзя использовать.`, 'system');
    } else if (action === 'unequip') {
      const msg = player.unequip(idxOrSlot);
      if (msg) UI.log(msg, 'pickup');
    }
    refreshUI();
  }

  function revealArea(col, row, radius) {
    const W = CFG.MAP_COLS, H = CFG.MAP_ROWS;
    for (let r=Math.max(0,row-radius); r<=Math.min(H-1,row+radius); r++)
      for (let c=Math.max(0,col-radius); c<=Math.min(W-1,col+radius); c++)
        if (HEX.distance(c,r,col,row)<=radius) tiles[r*W+c].explored=true;
    dirty=true;
  }

  // ── Enemy AI ───────────────────────────────────────────────────────────────
  function enemyTurns() {
    const W = CFG.MAP_COLS, R = CFG.VISION_RANGE + 5;
    const r0=Math.max(0,player.row-R), r1=Math.min(CFG.MAP_ROWS-1,player.row+R);
    const c0=Math.max(0,player.col-R), c1=Math.min(W-1,player.col+R);
    for (let r=r0; r<=r1; r++)
      for (let c=c0; c<=c1; c++) {
        const t = tiles[r*W+c];
        if (t.enemy) tickEnemy(t.enemy, t);
      }
  }

  function tickEnemy(e, tile) {
    if (e.stun > 0) { e.stun--; return; }
    const dist = HEX.distance(e.col, e.row, player.col, player.row);
    if (dist <= e.vision) e.state = 'chase';
    if (e.state !== 'chase') return;

    if (dist === 1) {
      const res = COMBAT.resolveAttack(e, player, false);
      UI.log(res.msg, 'damage');
      if (!player.isAlive()) { mode='dead'; UI.showDeath(_turn); }
      return;
    }

    // Move toward player
    const nbs = HEX.neighbors(e.col, e.row).filter(n => {
      const t = MAP.getTile(tiles, n.col, n.row);
      return t && MAP.passable(t) && !t.enemy
          && !(n.col===player.col && n.row===player.row);
    });
    if (!nbs.length) return;
    nbs.sort((a,b) =>
      HEX.distance(a.col,a.row,player.col,player.row) -
      HEX.distance(b.col,b.row,player.col,player.row));
    const best = nbs[0];
    tile.enemy = null;
    e.col = best.col; e.row = best.row;
    tiles[best.row*CFG.MAP_COLS+best.col].enemy = e;
  }

  // ── Turn end ───────────────────────────────────────────────────────────────
  function endTurn() {
    _turn++;
    player.tickEffects().forEach(m => UI.log(m, 'damage'));
    if (!player.isAlive()) { mode='dead'; UI.showDeath(_turn); return; }
    buildHighlights();
    refreshUI();
    dirty = true;
  }

  // ── Combat ─────────────────────────────────────────────────────────────────
  function startCombat(enemy, tile) {
    mode = 'combat';
    combatCtx = { enemy, tile };
    UI.showCombat(player, enemy);
    UI.addCombatLog(`► ${enemy.name} — HP ${enemy.hp}`, 'system');
  }

  function combatPlayerAttack() {
    if (mode !== 'combat' || !combatCtx) return;
    const { enemy } = combatCtx;
    if (player.stun > 0) {
      UI.addCombatLog('Вы оглушены! Пропускаете атаку.', 'stun');
      player.stun--;
    } else {
      const r = COMBAT.resolveAttack(player, enemy, true);
      UI.addCombatLog(r.msg, r.dmg > 0 ? 'player-atk' : '');
    }
    UI.updateCombatHP(player, enemy);
    if (enemy.hp <= 0) { endCombatVictory(); return; }
    enemyCombatAttack();
  }

  function enemyCombatAttack() {
    if (!combatCtx) return;
    const { enemy } = combatCtx;
    const r = COMBAT.resolveAttack(enemy, player, false);
    UI.addCombatLog(r.msg, 'enemy-atk');
    UI.updateCombatHP(player, enemy);
    if (!player.isAlive()) {
      UI.addCombatLog('Вы погибли…', 'death');
      UI.hideCombat();
      mode = 'dead';
      UI.showDeath(_turn);
    }
  }

  function useCombatItem(idx) {
    if (mode !== 'combat') return;
    const item = player.inventory[idx];
    if (!item || !item.use) return;
    const msg = item.use(player, { revealArea });
    player.removeItem(idx);
    UI.addCombatLog(msg, 'item');
    UI.updateCombatHP(player, combatCtx.enemy);
    refreshUI();
    enemyCombatAttack();
  }

  function combatFlee() {
    if (mode !== 'combat' || !combatCtx) return;
    if (COMBAT.tryFlee(combatCtx.enemy)) {
      UI.addCombatLog('Вы отступили!', 'flee');
      endCombatFlee();
    } else {
      UI.addCombatLog('Не удалось отступить!', 'flee');
      enemyCombatAttack();
    }
  }

  function endCombatVictory() {
    const { enemy, tile } = combatCtx;
    UI.addCombatLog(`✓ ${enemy.name} уничтожен!`, 'victory');
    COMBAT.rollLoot(enemy).forEach(it => {
      tile.items.push(it);
      UI.addCombatLog(`  Выпало: ${it.name}`, 'loot');
    });
    const xpMsg = player.gainXP(enemy.xp);
    UI.addCombatLog(`+${enemy.xp} XP`, 'xp');
    if (xpMsg) { UI.addCombatLog(`★ ${xpMsg}`, 'levelup'); UI.flashLevelUp(`★ ${xpMsg}`); }
    tile.enemy = null;
    UI.log(`Победа над ${enemy.name} (+${enemy.xp} XP)`, 'combat');
    player.col = tile.col; player.row = tile.row;
    closeCombat();
    applyBiomeEffects(tile);
    centreCamera();
    updateVision();
    endTurn();
    if (tile.items.length) UI.showPickup(tile.items[0]);
  }

  function endCombatFlee() {
    closeCombat();
    endTurn();
  }

  function closeCombat() {
    mode = 'explore';
    const c = combatCtx;
    combatCtx = null;
    setTimeout(UI.hideCombat, 600);
  }

  // ── Refresh all UI ─────────────────────────────────────────────────────────
  function refreshUI() {
    UI.updateStats(player);
    UI.updateInventory(player, handleInventoryAction, null);
  }

  // ── Render loop ────────────────────────────────────────────────────────────
  function startLoop() {
    function loop() {
      dirty = true; // always redraw (enemies move, etc.)
      if (dirty) {
        RENDERER.render(tiles, player, camera, highlights, null);
        const mm = document.getElementById('minimap');
        if (mm) RENDERER.renderMinimap(tiles, player, camera, mm);
        dirty = false;
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    get turn() { return _turn; },
    init,
    startLoop,
    handleKey,
    onCanvasClick(e) {
      if (mode !== 'explore') return;
      const cv   = document.getElementById('game-canvas');
      const rect = cv.getBoundingClientRect();
      const px   = e.clientX - rect.left + camera.x;
      const py   = e.clientY - rect.top  + camera.y;
      const { col, row } = HEX.fromPixel(px, py, CFG.HEX_SIZE);
      const dist = HEX.distance(col, row, player.col, player.row);
      if (dist === 1) moveToHex(col, row);
      else if (dist === 0) tryPickup();
    },
  };
})();

// ── Bootstrap ──────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('game-canvas');
  RENDERER.init(canvas);
  window.addEventListener('resize', () => {
    RENDERER.resize();
  });

  const startScreen = document.getElementById('start-screen');
  const loadingEl   = document.getElementById('start-loading');
  let started = false;

  function beginGame() {
    if (started) return;
    started = true;
    loadingEl.classList.remove('hidden');

    // Small timeout so the "loading" text paints before heavy map gen
    setTimeout(() => {
      startScreen.style.display = 'none';
      GAME.init();
      GAME.startLoop();

      window.addEventListener('keydown', e => {
        GAME.handleKey(e.code);
        e.preventDefault();
      });
      canvas.addEventListener('click', e => GAME.onCanvasClick(e));
    }, 80);
  }

  startScreen.addEventListener('click', beginGame);
  window.addEventListener('keydown', function once(e) {
    window.removeEventListener('keydown', once);
    beginGame();
  });
});

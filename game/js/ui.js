'use strict';

const UI = (() => {

  const MAX_LOG = CFG.MAX_LOG;
  const logEntries = [];

  // ── Log ──────────────────────────────────────────────────────────────────
  function log(msg, type = '') {
    logEntries.push({ msg, type });
    if (logEntries.length > MAX_LOG) logEntries.shift();
    _renderLog();
  }

  function _renderLog() {
    const el = document.getElementById('log-entries');
    if (!el) return;
    el.innerHTML = logEntries.slice(-20).map(e =>
      `<div class="log-entry ${e.type}">${e.msg}</div>`
    ).join('');
    el.scrollTop = el.scrollHeight;
  }

  // ── Stats bar ─────────────────────────────────────────────────────────────
  function updateStats(player) {
    const set = (id, val) => { const e=document.getElementById(id); if(e) e.textContent=val; };
    const setW = (id, pct) => { const e=document.getElementById(id); if(e) e.style.width=pct+'%'; };

    set('hp-text',     `${player.hp}/${player.max_hp}`);
    set('rad-text',    player.radiation);
    set('cold-text',   player.cold);
    set('turn-text',   window.GAME ? GAME.turn : '—');
    set('armor-text',  player.armor);
    set('weapon-text', player.weaponName());
    set('pos-text',    `${player.col},${player.row}`);

    setW('hp-bar',   (player.hp / player.max_hp) * 100);
    setW('rad-bar',  Math.min(100, player.radiation));
    setW('cold-bar', Math.min(100, player.cold));

    // Colour hp bar
    const hpBar = document.getElementById('hp-bar');
    if (hpBar) {
      const ratio = player.hp / player.max_hp;
      hpBar.style.background = ratio > 0.5 ? '#3a8a3a' : ratio > 0.25 ? '#c8a020' : '#c03020';
    }
  }

  // ── Inventory panel ───────────────────────────────────────────────────────
  function updateInventory(player, onUse, onDrop) {
    const slotsEl = document.getElementById('inventory-slots');
    if (!slotsEl) return;

    const cells = [];
    for (let i = 0; i < CFG.MAX_INVENTORY; i++) {
      const item = player.inventory[i];
      if (item) {
        cells.push(`
          <div class="inv-slot" data-idx="${i}" title="${item.desc || ''}">
            <span class="inv-slot-type">${_typeShort(item.type)}</span>
            <span class="inv-slot-icon" style="color:${item.clr||'#aaa'}">${item.icon||'?'}</span>
            <span class="inv-slot-name">${item.name}</span>
          </div>`);
      } else {
        cells.push(`<div class="inv-slot empty" data-idx="${i}"><span class="inv-slot-name" style="opacity:.3">—</span></div>`);
      }
    }
    slotsEl.innerHTML = cells.join('');

    // Right-click handlers
    slotsEl.querySelectorAll('.inv-slot:not(.empty)').forEach(el => {
      el.addEventListener('contextmenu', e => {
        e.preventDefault();
        const idx = parseInt(el.dataset.idx);
        const item = player.inventory[idx];
        if (!item) return;
        if (item.type === 'weapon' || item.type === 'armor') {
          onUse(idx, 'equip');
        } else if (item.type === 'consumable' || item.type === 'misc') {
          onUse(idx, 'use');
        }
      });
      el.addEventListener('click', e => {
        e.preventDefault();
        const idx = parseInt(el.dataset.idx);
        const item = player.inventory[idx];
        if (!item) return;
        showItemTooltip(item, e.clientX, e.clientY);
      });
    });

    // Equipped slots
    const slots = ['weapon','body','head'];
    const ids   = ['equip-weapon','equip-armor','equip-head'];
    slots.forEach((slot, i) => {
      const el  = document.getElementById(ids[i]);
      const it  = player.equipped[slot];
      if (el) {
        el.textContent = it ? it.name : '—';
        el.style.color = it ? (it.clr || PAL.UI_BRIGHT) : PAL.UI_DIM;
        el.onclick = it ? () => onUse(slot, 'unequip') : null;
        el.style.cursor = it ? 'pointer' : 'default';
      }
    });
  }

  function _typeShort(t) {
    return { consumable:'ИСП', weapon:'ОРЖ', armor:'БРН', misc:'МСЦ', upgrade:'АПГ' }[t] || '?';
  }

  // ── Tooltip ───────────────────────────────────────────────────────────────
  let tooltipEl = null;
  function showItemTooltip(item, x, y) {
    removeTooltip();
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'item-tooltip';
    tooltipEl.innerHTML = `
      <div class="tt-name" style="color:${item.clr||'#aaa'}">${item.icon||''} ${item.name}</div>
      <div class="tt-type">${_typeShort(item.type)}</div>
      <div class="tt-desc">${item.desc||''}</div>
      ${item.damage ? `<div class="tt-stat">Урон: ${item.damage[0]}–${item.damage[1]}</div>`:''}
      ${item.armor  ? `<div class="tt-stat">Броня: +${item.armor}</div>`:''}
      <div class="tt-hint">ПКМ: Использовать/Надеть</div>`;
    tooltipEl.style.cssText = `position:fixed;left:${x+8}px;top:${y+8}px;z-index:200;`;
    document.body.appendChild(tooltipEl);
    setTimeout(removeTooltip, 3000);
  }
  function removeTooltip() {
    if (tooltipEl) { tooltipEl.remove(); tooltipEl = null; }
  }
  document.addEventListener('click', removeTooltip);

  // ── Pickup prompt ─────────────────────────────────────────────────────────
  function showPickup(item) {
    const el = document.getElementById('pickup-prompt');
    const tx = document.getElementById('pickup-text');
    if (!el || !tx) return;
    tx.textContent = `Подобрать: ${item.name} [E / Пробел]`;
    el.classList.remove('hidden');
  }
  function hidePickup() {
    const el = document.getElementById('pickup-prompt');
    if (el) el.classList.add('hidden');
  }

  // ── Combat overlay ────────────────────────────────────────────────────────
  let combatLogEl = null;
  function showCombat(player, enemy) {
    const ov = document.getElementById('combat-overlay');
    if (!ov) return;
    ov.classList.remove('hidden');
    document.getElementById('combat-title').textContent = `БОЙ — ${enemy.name.toUpperCase()}`;
    const nameEl = document.getElementById('enemy-combat-name');
    if (nameEl) nameEl.textContent = enemy.name;
    combatLogEl = document.getElementById('combat-log');
    if (combatLogEl) combatLogEl.innerHTML = '';
    updateCombatHP(player, enemy);
  }

  function updateCombatHP(player, enemy) {
    const set = (id, val) => { const e=document.getElementById(id); if(e) e.textContent=val; };
    set('player-combat-hp', `${Math.max(0,player.hp)} / ${player.max_hp}`);
    set('enemy-combat-hp',  `${Math.max(0,enemy.hp)} / ${enemy.max_hp}`);
  }

  function addCombatLog(msg, cls='') {
    if (!combatLogEl) return;
    const d = document.createElement('div');
    d.className = 'clog-line ' + cls;
    d.textContent = msg;
    combatLogEl.appendChild(d);
    combatLogEl.scrollTop = combatLogEl.scrollHeight;
  }

  function hideCombat() {
    const ov = document.getElementById('combat-overlay');
    if (ov) ov.classList.add('hidden');
  }

  // ── Combat item submenu ───────────────────────────────────────────────────
  function showCombatItemMenu(player, onSelect) {
    const existing = document.getElementById('combat-item-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.id = 'combat-item-menu';
    menu.className = 'combat-item-menu';

    const consumables = player.inventory
      .map((it, i) => ({ it, i }))
      .filter(({ it }) => it.type === 'consumable');

    if (consumables.length === 0) {
      menu.innerHTML = '<div class="cim-empty">Нет расходников</div>';
    } else {
      consumables.forEach(({ it, i }) => {
        const btn = document.createElement('button');
        btn.className = 'cim-btn';
        btn.innerHTML = `<span style="color:${it.clr||'#aaa'}">${it.icon}</span> ${it.name}`;
        btn.onclick = () => { menu.remove(); onSelect(i); };
        menu.appendChild(btn);
      });
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'cim-btn cim-cancel';
    cancelBtn.textContent = '✕ Отмена';
    cancelBtn.onclick = () => menu.remove();
    menu.appendChild(cancelBtn);

    document.getElementById('combat-panel').appendChild(menu);
  }

  // ── Death screen ──────────────────────────────────────────────────────────
  function showDeath(turn) {
    const el = document.getElementById('start-screen');
    if (!el) return;
    el.style.background = 'rgba(20,0,0,0.95)';
    document.getElementById('game-title').textContent   = 'ВЫ ПОГИБЛИ';
    document.getElementById('game-title').style.color   = '#c03020';
    document.getElementById('game-subtitle').textContent = `Выжили ${turn} ходов`;
    document.getElementById('start-hint').textContent   = '[ НАЖМИТЕ ЛЮБУЮ КЛАВИШУ ДЛЯ РЕСТАРТА ]';
    el.classList.remove('hidden');
    el.style.display = 'flex';
  }

  // ── Level-up flash ────────────────────────────────────────────────────────
  function flashLevelUp(msg) {
    const flash = document.createElement('div');
    flash.className = 'levelup-flash';
    flash.textContent = msg;
    document.getElementById('game-wrapper').appendChild(flash);
    setTimeout(() => flash.remove(), 2500);
  }

  return {
    log, updateStats, updateInventory,
    showPickup, hidePickup,
    showCombat, hideCombat, updateCombatHP, addCombatLog, showCombatItemMenu,
    showDeath, flashLevelUp,
  };
})();

'use strict';

// ── Player ────────────────────────────────────────────────────────────────────
class Player {
  constructor(col, row) {
    this.col       = col;
    this.row       = row;
    this.hp        = 100;
    this.max_hp    = 100;
    this.radiation = 0;
    this.cold      = 0;
    this.bleed     = 0;          // turns of bleeding
    this.stun      = 0;          // turns stunned
    this.xp        = 0;
    this.level     = 1;

    // inventory: array of item objects (max CFG.MAX_INVENTORY)
    this.inventory = [];

    // equipped slots
    this.equipped  = { weapon: null, body: null, head: null };

    // derived stats (recomputed after equip)
    this.armor     = 0;
    this.cold_res  = 0;
    this.rad_res   = 0;
    this.weapon_dmg = [1, 4];    // unarmed

    // temp buffs
    this.buff_dmg   = 0;
    this.buff_turns = 0;
    this.debuff_accuracy = 0;
  }

  recomputeStats() {
    this.armor    = 0;
    this.cold_res = 0;
    this.rad_res  = 0;
    this.weapon_dmg = [1, 4];

    for (const slot of ['weapon', 'body', 'head']) {
      const it = this.equipped[slot];
      if (!it) continue;
      if (it.armor)    this.armor    += it.armor;
      if (it.cold_res) this.cold_res += it.cold_res;
      if (it.rad_res)  this.rad_res  += it.rad_res;
      if (it.damage)   this.weapon_dmg = [...it.damage];
    }
  }

  weaponName() {
    return this.equipped.weapon ? this.equipped.weapon.name : 'Кулаки';
  }

  rollDamage() {
    const [mn, mx] = this.weapon_dmg;
    let dmg = mn + Math.floor(Math.random() * (mx - mn + 1));
    if (this.buff_turns > 0) dmg += this.buff_dmg;
    if (this.debuff_accuracy > 0 && Math.random() < 0.25) dmg = Math.floor(dmg * 0.6);
    return Math.max(1, dmg);
  }

  addItem(item) {
    if (this.inventory.length >= CFG.MAX_INVENTORY) return false;
    this.inventory.push(item);
    return true;
  }

  removeItem(idx) {
    this.inventory.splice(idx, 1);
  }

  equip(idx) {
    const item = this.inventory[idx];
    if (!item || (item.type !== 'weapon' && item.type !== 'armor')) return null;
    const slot = item.slot || 'body';
    const prev = this.equipped[slot];
    this.equipped[slot] = item;
    this.inventory.splice(idx, 1);
    if (prev) this.inventory.push(prev);
    this.recomputeStats();
    return `Экипировано: ${item.name}`;
  }

  unequip(slot) {
    const item = this.equipped[slot];
    if (!item) return null;
    if (this.inventory.length >= CFG.MAX_INVENTORY) return 'Инвентарь переполнен!';
    this.inventory.push(item);
    this.equipped[slot] = null;
    this.recomputeStats();
    return `Снято: ${item.name}`;
  }

  tickEffects() {
    const msgs = [];
    // Radiation damage
    if (this.radiation > 0) {
      const dmg = Math.floor(this.radiation / 25);
      if (dmg > 0) { this.hp -= dmg; msgs.push(`Радиация: -${dmg} HP`); }
    }
    // Cold damage
    if (this.cold > 0) {
      const dmg = Math.floor(this.cold / 30);
      if (dmg > 0) { this.hp -= dmg; msgs.push(`Обморожение: -${dmg} HP`); }
    }
    // Bleeding
    if (this.bleed > 0) {
      this.hp -= 3; this.bleed--;
      msgs.push(`Кровотечение: -3 HP`);
    }
    // Buff decay
    if (this.buff_turns > 0) {
      this.buff_turns--;
      if (this.buff_turns === 0) this.buff_dmg = 0;
    }
    if (this.debuff_accuracy > 0) this.debuff_accuracy--;
    if (this.stun > 0) this.stun--;
    this.hp = Math.max(0, this.hp);
    return msgs;
  }

  gainXP(amount) {
    this.xp += amount;
    const needed = this.level * 80;
    if (this.xp >= needed) {
      this.xp -= needed;
      this.level++;
      this.max_hp += 15;
      this.hp = Math.min(this.hp + 20, this.max_hp);
      return `Уровень ${this.level}! +15 max HP`;
    }
    return null;
  }

  isAlive() { return this.hp > 0; }
}

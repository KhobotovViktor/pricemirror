'use strict';

const COMBAT = (() => {

  // Single attack roll: attacker hits defender
  // Returns { dmg, msg, special }
  function resolveAttack(attacker, defender, isPlayer) {
    const [mn, mx] = attacker.damage || attacker.weapon_dmg || [1,4];
    let raw = mn + Math.floor(Math.random() * (mx - mn + 1));

    // Player buff
    if (isPlayer && attacker.buff_turns > 0) raw += attacker.buff_dmg;
    // Player debuff (vodka)
    if (isPlayer && attacker.debuff_accuracy > 0 && Math.random() < 0.25) raw = Math.floor(raw * 0.6);

    const armor  = defender.armor || 0;
    const dmg    = Math.max(1, raw - armor);
    defender.hp -= dmg;

    let msg = isPlayer
      ? `→ Вы атакуете ${defender.name}: ${dmg} урона (${raw}−${armor})`
      : `← ${attacker.name} атакует вас: ${dmg} урона`;

    // Special effects (enemy only)
    let special = null;
    if (!isPlayer && attacker.special) {
      if (attacker.special === 'stun' && Math.random() < 0.30) {
        defender.stun = (defender.stun || 0) + 1;
        special = 'stun'; msg += ' [ОГЛУШЕНИЕ!]';
      }
      if (attacker.special === 'irradiate' && Math.random() < 0.40) {
        defender.radiation = (defender.radiation || 0) + 12;
        special = 'irradiate'; msg += ' [+12 RAD!]';
      }
      if (attacker.special === 'bleed' && Math.random() < 0.35) {
        defender.bleed = (defender.bleed || 0) + 2;
        special = 'bleed'; msg += ' [КРОВОТЕЧЕНИЕ!]';
      }
    }

    return { dmg, msg, special };
  }

  // Generate loot from killed enemy
  function rollLoot(enemy) {
    const loot = [];
    if (!enemy.loot || enemy.loot.length === 0) return loot;
    if (Math.random() < enemy.loot_chance) {
      const id = enemy.loot[Math.floor(Math.random() * enemy.loot.length)];
      if (ITEM_DEFS[id]) loot.push({ ...ITEM_DEFS[id] });
    }
    // Small bonus: chance for extra item
    if (Math.random() < 0.15 && enemy.loot.length > 1) {
      const id = enemy.loot[Math.floor(Math.random() * enemy.loot.length)];
      if (ITEM_DEFS[id]) loot.push({ ...ITEM_DEFS[id] });
    }
    return loot;
  }

  // Flee chance: 40% base, +10% if enemy is stunned
  function tryFlee(enemy) {
    const chance = 0.40 + (enemy.stun > 0 ? 0.20 : 0);
    return Math.random() < chance;
  }

  return { resolveAttack, rollLoot, tryFlee };
})();

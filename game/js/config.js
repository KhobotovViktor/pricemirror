'use strict';

const CFG = {
  MAP_COLS: 300,
  MAP_ROWS: 220,
  HEX_SIZE: 36,
  MAP_SEED: 1955,
  VISION_RANGE: 4,
  START_COL: 150,
  START_ROW: 110,
  MAX_INVENTORY: 10,
  MAX_LOG: 60,
  BIOME: {
    FOREST:'forest', SWAMP:'swamp', WATER:'water', RUINS:'ruins',
    IRRADIATED:'irradiated', SNOW:'snow', PLAIN:'plain',
    MOUNTAIN:'mountain', BUNKER:'bunker',
  },
};

const PAL = {
  FOREST:      '#1b3815', FOREST_LT:  '#2d5a27', FOREST_DK: '#0f2209',
  SWAMP:       '#283312', SWAMP_LT:   '#3d4a1a', SWAMP_DK:  '#171d09',
  WATER:       '#0d2336', WATER_LT:   '#1a3d5c', WATER_DK:  '#070f18',
  RUINS:       '#2c2820', RUINS_LT:   '#4a4038', RUINS_DK:  '#161410',
  IRRADIATED:  '#253810', IRRAD_LT:   '#3d5a15', IRRAD_DK:  '#131d07',
  SNOW:        '#5a6a78', SNOW_LT:    '#9ab0c0', SNOW_DK:   '#2e3840',
  PLAIN:       '#384218', PLAIN_LT:   '#5a6a2a', PLAIN_DK:  '#1c2109',
  MOUNTAIN:    '#3a3030', MOUNTAIN_LT:'#5a5050', MOUNTAIN_DK:'#1e1818',
  BUNKER:      '#28281a', BUNKER_LT:  '#484838', BUNKER_DK:  '#141409',

  UI_BG:    '#060d04', UI_PANEL: '#0a1408', UI_BORDER: '#234a16',
  UI_TEXT:  '#72a86a', UI_BRIGHT:'#b0e0a8', UI_DIM:    '#334a30',
  UI_AMBER: '#c8a020', UI_RED:   '#c03020', UI_CYAN:   '#30a8b0',

  PLAYER:   '#e0d898', MARAUDER: '#c08040', WOLF:    '#808060',
  ROBOT:    '#5878b8', MUTANT:   '#70b838', SOLDIER: '#507838',
  BEAR:     '#705028',

  FOG:      'rgba(0,0,0,0.88)', SEEN:   'rgba(0,0,0,0.45)',
  HL_MOVE:  'rgba(90,190,80,0.22)', HL_ATK: 'rgba(200,70,50,0.3)',
  HL_SEL:   'rgba(200,180,60,0.28)',

  GRID:     'rgba(0,0,0,0.35)',
};

// ── Item definitions ─────────────────────────────────────────────────────────
const ITEM_DEFS = {
  medkit: {
    id:'medkit', name:'Аптечка', type:'consumable', icon:'✛', clr:'#d84040',
    desc:'Восстанавливает 35 HP.',
    use(p){ const h=Math.min(35,p.max_hp-p.hp); p.hp+=h; return `Аптечка: +${h} HP`; }
  },
  antirads: {
    id:'antirads', name:'Антирады', type:'consumable', icon:'☢', clr:'#40d0a0',
    desc:'Снижает радиацию на 30.',
    use(p){ const r=Math.min(30,p.radiation); p.radiation-=r; return `Антирады: -${r} RAD`; }
  },
  canned_food: {
    id:'canned_food', name:'Тушёнка', type:'consumable', icon:'⊞', clr:'#c07838',
    desc:'Восстанавливает 20 HP.',
    use(p){ const h=Math.min(20,p.max_hp-p.hp); p.hp+=h; return `Тушёнка: +${h} HP`; }
  },
  thermos: {
    id:'thermos', name:'Термос', type:'consumable', icon:'◈', clr:'#7878c8',
    desc:'Снижает холод на 20.',
    use(p){ const c=Math.min(20,p.cold); p.cold-=c; return `Горячий чай: -${c} COLD`; }
  },
  vodka: {
    id:'vodka', name:'Водка', type:'consumable', icon:'◇', clr:'#a8d0f0',
    desc:'+10 HP, −10 COLD.',
    use(p){ const h=Math.min(10,p.max_hp-p.hp); p.hp+=h; p.cold=Math.max(0,p.cold-10); return `Водка: +${h} HP, -10 COLD`; }
  },
  stimpak: {
    id:'stimpak', name:'Стимулятор', type:'consumable', icon:'⚕', clr:'#f0e040',
    desc:'+50 HP, +2 урон на 5 ходов.',
    use(p){ const h=Math.min(50,p.max_hp-p.hp); p.hp+=h; p.buff_dmg=(p.buff_dmg||0)+2; p.buff_turns=(p.buff_turns||0)+5; return `Стимулятор: +${h} HP, +2 ATK × 5 ходов`; }
  },
  crowbar: {
    id:'crowbar', name:'Монтировка', type:'weapon', icon:'/', clr:'#b0b0b0',
    desc:'Ближний бой. Урон 8–14.', damage:[8,14], range:1, slot:'weapon'
  },
  knife: {
    id:'knife', name:'Нож НР-40', type:'weapon', icon:'†', clr:'#d0d0d0',
    desc:'Нож. Урон 5–10.', damage:[5,10], range:1, slot:'weapon'
  },
  pistol: {
    id:'pistol', name:'ТТ-55', type:'weapon', icon:'⌐', clr:'#c0a050',
    desc:'Пистолет. Урон 12–20.', damage:[12,20], range:2, slot:'weapon'
  },
  shotgun: {
    id:'shotgun', name:'Дробовик', type:'weapon', icon:'⊣', clr:'#a05828',
    desc:'Дробовик. Урон 22–38, дальность 1.', damage:[22,38], range:1, slot:'weapon'
  },
  assault_rifle: {
    id:'assault_rifle', name:'АК-Р', type:'weapon', icon:'≡', clr:'#787858',
    desc:'Штурмовая винтовка. Урон 18–28.', damage:[18,28], range:3, slot:'weapon'
  },
  vatnik: {
    id:'vatnik', name:'Ватник', type:'armor', icon:'◧', clr:'#806040',
    desc:'Броня +3, Холод −15.', armor:3, cold_res:15, slot:'body'
  },
  winter_coat: {
    id:'winter_coat', name:'Полушубок', type:'armor', icon:'◩', clr:'#806858',
    desc:'Броня +2, Холод −25.', armor:2, cold_res:25, slot:'body'
  },
  gasmask: {
    id:'gasmask', name:'Противогаз', type:'armor', icon:'◉', clr:'#406060',
    desc:'Броня +1, Рад защита +20.', armor:1, rad_res:20, slot:'head'
  },
  bulletproof: {
    id:'bulletproof', name:'Бронежилет', type:'armor', icon:'▣', clr:'#405060',
    desc:'Броня +12.', armor:12, slot:'body'
  },
  hazmat: {
    id:'hazmat', name:'ОЗК', type:'armor', icon:'⊙', clr:'#508048',
    desc:'Броня +4, Рад защита +35, Холод −5.', armor:4, rad_res:35, cold_res:5, slot:'body'
  },
  tools: {
    id:'tools', name:'Инструменты', type:'misc', icon:'⚙', clr:'#c0c080',
    desc:'Нужны для ремонта и улучшений.'
  },
  parts: {
    id:'parts', name:'Детали', type:'misc', icon:'⊕', clr:'#80c0c0',
    desc:'Запасные части механизмов.'
  },
  map_fragment: {
    id:'map_fragment', name:'Карта района', type:'misc', icon:'▦', clr:'#d4b870',
    desc:'Открывает туман войны в радиусе 10 клеток.',
    use(p, game){ game.revealArea(p.col, p.row, 10); return 'Карта изучена — область разведана!'; }
  },
};

// ── Enemy definitions ─────────────────────────────────────────────────────────
const ENEMY_DEFS = {
  marauder: {
    id:'marauder', name:'Мародёр', clr:PAL.MARAUDER,
    hp:30, armor:2, damage:[5,12], attack:8,
    vision:4, biomes:['ruins','plain'],
    loot:['medkit','knife','canned_food','pistol'], loot_chance:0.55, xp:15,
    desc:'Вооружённый выживший.'
  },
  wolf: {
    id:'wolf', name:'Волк', clr:PAL.WOLF,
    hp:22, armor:0, damage:[6,14], attack:10,
    vision:5, biomes:['forest','snow','plain'],
    loot:['canned_food'], loot_chance:0.25, xp:10, special:'bleed',
    desc:'Дикий волк. Вызывает кровотечение.'
  },
  robot: {
    id:'robot', name:'Жестяной Иван', clr:PAL.ROBOT,
    hp:55, armor:9, damage:[10,18], attack:12,
    vision:3, biomes:['ruins','irradiated'],
    loot:['parts','tools'], loot_chance:0.7, xp:30, special:'stun',
    desc:'Устаревший боевой робот. Может оглушить.'
  },
  mutant: {
    id:'mutant', name:'Мутант', clr:PAL.MUTANT,
    hp:42, armor:3, damage:[12,22], attack:14,
    vision:4, biomes:['swamp','irradiated'],
    loot:['antirads','parts'], loot_chance:0.5, xp:25, special:'irradiate',
    desc:'Облучённое существо. Атаки заражают радиацией.'
  },
  soldier: {
    id:'soldier', name:'Солдат', clr:PAL.SOLDIER,
    hp:50, armor:7, damage:[14,24], attack:16,
    vision:5, biomes:['plain','ruins','snow'],
    loot:['bulletproof','pistol','medkit','canned_food'], loot_chance:0.65, xp:35,
    desc:'Солдат неизвестной армии.'
  },
  bear: {
    id:'bear', name:'Медведь', clr:PAL.BEAR,
    hp:75, armor:4, damage:[18,30], attack:18,
    vision:3, biomes:['forest','mountain'],
    loot:['canned_food'], loot_chance:0.2, xp:40, special:'bleed',
    desc:'Огромный медведь. Атаки вызывают кровотечение.'
  },
};

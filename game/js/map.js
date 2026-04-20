'use strict';

const MAP = (() => {

  // ── Seeded PRNG (Mulberry32) ───────────────────────────────────────────────
  function makePRNG(seed) {
    let s = seed >>> 0;
    return function() {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ── Value noise ───────────────────────────────────────────────────────────
  function makeNoiseFn(rng, gridSize) {
    const G = gridSize;
    const g = new Float32Array(G * G);
    for (let i = 0; i < g.length; i++) g[i] = rng();
    return function sample(x, y) {
      const ix = Math.floor(x) & (G - 1), iy = Math.floor(y) & (G - 1);
      const fx = x - Math.floor(x),       fy = y - Math.floor(y);
      const ux = fx * fx * (3 - 2 * fx),  uy = fy * fy * (3 - 2 * fy);
      const a = g[iy * G + ix],         b = g[iy * G + ((ix+1)&(G-1))];
      const c = g[((iy+1)&(G-1))*G+ix], d = g[((iy+1)&(G-1))*G+((ix+1)&(G-1))];
      return a + ux*(b-a) + uy*(c-a) + ux*uy*(a-b-c+d);
    };
  }

  function fbm(fn, x, y, oct=4) {
    let v=0, amp=0.5, freq=1, max=0;
    for (let i=0; i<oct; i++) {
      v   += fn(x*freq, y*freq) * amp;
      max += amp; amp*=0.5; freq*=2;
    }
    return v / max;
  }

  // ── Tile factory ──────────────────────────────────────────────────────────
  function makeTile(col, row, biome) {
    return { col, row, biome, items:[], enemy:null, explored:false, visible:false };
  }

  // ── Main generation ───────────────────────────────────────────────────────
  function generate() {
    const { MAP_COLS: W, MAP_ROWS: H, MAP_SEED, START_COL, START_ROW } = CFG;
    const rng = makePRNG(MAP_SEED);

    // Build noise layers
    const elev_fn  = makeNoiseFn(rng, 256);
    const moist_fn = makeNoiseFn(rng, 256);
    const rad_fn   = makeNoiseFn(rng, 256);

    const ELEV_SC  = 0.018, MOIST_SC = 0.013, RAD_SC = 0.028;

    // Pre-compute per-tile elevation & moisture into typed arrays (fast)
    const elev  = new Float32Array(W * H);
    const moist = new Float32Array(W * H);
    const rad   = new Float32Array(W * H);

    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const i = r * W + c;
        elev[i]  = fbm(elev_fn,  c * ELEV_SC,  r * ELEV_SC,  4);
        moist[i] = fbm(moist_fn, c * MOIST_SC, r * MOIST_SC, 4);
        rad[i]   = fbm(rad_fn,   c * RAD_SC,   r * RAD_SC,   3);
      }
    }

    // ── Assign biomes ────────────────────────────────────────────────────────
    const B = CFG.BIOME || {
      FOREST:'forest', SWAMP:'swamp', WATER:'water', RUINS:'ruins',
      IRRADIATED:'irradiated', SNOW:'snow', PLAIN:'plain', MOUNTAIN:'mountain', BUNKER:'bunker'
    };

    const tiles = new Array(W * H);
    const northThresh = H * 0.22;
    const snowZone    = H * 0.38;

    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const i = r * W + c;
        const e = elev[i], m = moist[i], rv = rad[i];
        let biome;

        if      (e < 0.26)               biome = 'water';
        else if (e > 0.80)               biome = 'mountain';
        else if (rv > 0.72)              biome = 'irradiated';
        else if (r < northThresh && e > 0.34) biome = 'snow';
        else if (r < snowZone && e > 0.55 && m < 0.45) biome = 'snow';
        else if (e < 0.42 && m > 0.62)  biome = 'swamp';
        else if (e > 0.56 && m > 0.44)  biome = 'forest';
        else if (e > 0.46 && m > 0.60)  biome = 'forest';
        else                             biome = 'plain';

        tiles[i] = makeTile(c, r, biome);
      }
    }

    // ── Scatter ruins clusters ────────────────────────────────────────────────
    const RUIN_CLUSTERS = 65;
    for (let k = 0; k < RUIN_CLUSTERS; k++) {
      const cc = Math.floor(rng() * W);
      const cr = Math.floor(rng() * H);
      const size = 4 + Math.floor(rng() * 14);
      let col = cc, row = cr;
      for (let s = 0; s < size; s++) {
        if (col >= 0 && col < W && row >= 0 && row < H) {
          const ti = row * W + col;
          if (tiles[ti].biome !== 'water' && tiles[ti].biome !== 'mountain') {
            tiles[ti].biome = 'ruins';
          }
        }
        const nb = HEX.neighbors(col, row);
        const next = nb[Math.floor(rng() * 6)];
        col = next.col; row = next.row;
      }
    }

    // ── Place start bunker ────────────────────────────────────────────────────
    const bunkRing = HEX.neighbors(START_COL, START_ROW);
    tiles[START_ROW * W + START_COL].biome = 'bunker';
    bunkRing.forEach(n => {
      if (n.col >= 0 && n.col < W && n.row >= 0 && n.row < H)
        tiles[n.row * W + n.col].biome = 'bunker';
    });

    // ── Spawn enemies ─────────────────────────────────────────────────────────
    const DENSITY = {
      forest:     { wolf:0.0035, bear:0.0015, marauder:0.0015 },
      swamp:      { mutant:0.005, wolf:0.002 },
      ruins:      { marauder:0.007, robot:0.004 },
      irradiated: { mutant:0.007, robot:0.003 },
      plain:      { marauder:0.003, soldier:0.002, wolf:0.002 },
      snow:       { wolf:0.004, soldier:0.0015 },
      mountain:   { bear:0.003, wolf:0.002 },
      water:      {},
      bunker:     {},
    };

    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const dist = HEX.distance(c, r, START_COL, START_ROW);
        if (dist < 8) continue;                 // safe start zone
        const tile = tiles[r * W + c];
        const den  = DENSITY[tile.biome] || {};
        for (const [id, prob] of Object.entries(den)) {
          if (rng() < prob && ENEMY_DEFS[id]) {
            tile.enemy = spawnEnemy(id, c, r);
            break;
          }
        }
      }
    }

    // ── Spawn items ───────────────────────────────────────────────────────────
    const ITEM_POOLS = {
      forest:     ['canned_food','thermos','knife','tools'],
      swamp:      ['antirads','canned_food','parts'],
      ruins:      ['medkit','pistol','crowbar','tools','parts','map_fragment'],
      irradiated: ['antirads','hazmat','parts','stimpak'],
      plain:      ['canned_food','vodka','vatnik','knife'],
      snow:       ['thermos','winter_coat','canned_food','vodka'],
      mountain:   ['tools','parts','shotgun'],
      bunker:     ['medkit','antirads','canned_food','thermos','vatnik'],
      water:      [],
    };
    const ITEM_RATE = 0.018;

    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const tile = tiles[r * W + c];
        if (tile.enemy) continue;
        const pool = ITEM_POOLS[tile.biome] || [];
        if (pool.length && rng() < ITEM_RATE) {
          const id = pool[Math.floor(rng() * pool.length)];
          if (ITEM_DEFS[id]) tile.items.push({ ...ITEM_DEFS[id] });
        }
      }
    }

    // Extra goodies in bunker
    const bStart = tiles[START_ROW * W + START_COL];
    bStart.items.push({ ...ITEM_DEFS.medkit });
    bStart.items.push({ ...ITEM_DEFS.vatnik });
    bStart.items.push({ ...ITEM_DEFS.canned_food });

    return tiles;
  }

  function spawnEnemy(id, col, row) {
    const def = ENEMY_DEFS[id];
    return {
      id, col, row,
      name:   def.name,
      clr:    def.clr,
      hp:     def.hp,
      max_hp: def.hp,
      armor:  def.armor,
      damage: [...def.damage],
      attack: def.attack,
      vision: def.vision,
      loot:   def.loot,
      loot_chance: def.loot_chance,
      xp:     def.xp,
      special:def.special || null,
      state:  'idle',   // idle | chase | combat
      stun:   0,
    };
  }

  function getTile(tiles, col, row) {
    if (col < 0 || col >= CFG.MAP_COLS || row < 0 || row >= CFG.MAP_ROWS) return null;
    return tiles[row * CFG.MAP_COLS + col];
  }

  function setTile(tiles, col, row, data) {
    if (col < 0 || col >= CFG.MAP_COLS || row < 0 || row >= CFG.MAP_ROWS) return;
    Object.assign(tiles[row * CFG.MAP_COLS + col], data);
  }

  // Passable for movement (water and mountain block)
  function passable(tile) {
    return tile && tile.biome !== 'water' && tile.biome !== 'mountain';
  }

  return { generate, getTile, setTile, passable, spawnEnemy };
})();

'use strict';

const RENDERER = (() => {

  let canvas, ctx;
  const SIZE    = CFG.HEX_SIZE;
  const HEX_W   = HEX.hexW(SIZE);
  const HEX_H   = HEX.hexH(SIZE);
  const V_STEP  = HEX_H * 0.75;

  function init(canvasEl) {
    canvas = canvasEl;
    ctx    = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    resize();
  }

  function resize() {
    canvas.width  = window.innerWidth  - 260;   // leave room for right panel
    canvas.height = window.innerHeight - 54 - 24; // top bar + bottom bar
  }

  // ── Camera helpers ────────────────────────────────────────────────────────
  // camera = { x, y } pixel offset of top-left

  function hexCenter(col, row, cam) {
    const p = HEX.toPixel(col, row, SIZE);
    return { x: p.x - cam.x, y: p.y - cam.y };
  }

  function visibleRange(cam) {
    const pad = 2;
    const colMin = Math.max(0, Math.floor(cam.x / HEX_W) - pad);
    const colMax = Math.min(CFG.MAP_COLS - 1, Math.ceil((cam.x + canvas.width)  / HEX_W) + pad);
    const rowMin = Math.max(0, Math.floor(cam.y / V_STEP) - pad);
    const rowMax = Math.min(CFG.MAP_ROWS - 1, Math.ceil((cam.y + canvas.height) / V_STEP) + pad);
    return { colMin, colMax, rowMin, rowMax };
  }

  // ── Biome fill colours ────────────────────────────────────────────────────
  const BIOME_FILLS = {
    forest:     ['#0f2209','#1b3815','#243f1c'],
    swamp:      ['#171d09','#283312','#313d18'],
    water:      ['#070f18','#0d2336','#112a42'],
    ruins:      ['#161410','#2c2820','#3a342c'],
    irradiated: ['#131d07','#253810','#304715'],
    snow:       ['#2e3840','#5a6a78','#7a8e9c'],
    plain:      ['#1c2109','#384218','#485428'],
    mountain:   ['#1e1818','#3a3030','#4a3e3e'],
    bunker:     ['#141409','#28281a','#3a3a28'],
  };

  // Biome detail pattern (pixel-art micro-texture drawn on each tile)
  function drawBiomeDetail(col, row, biome, cx, cy) {
    const r = ((col * 7 + row * 13) & 0xffff);
    ctx.save();
    ctx.globalAlpha = 0.55;

    switch (biome) {
      case 'forest': {
        // Small triangular trees
        const count = 2 + (r % 2);
        for (let i = 0; i < count; i++) {
          const tx = cx - 10 + (((r >> i*3) & 0xf) / 15) * 20;
          const ty = cy - 6  + (((r >> (i*3+4)) & 0x7) / 7) * 10;
          ctx.fillStyle = i % 2 ? '#1e4a14' : '#2a6020';
          ctx.beginPath();
          ctx.moveTo(tx, ty - 7); ctx.lineTo(tx-5, ty+3); ctx.lineTo(tx+5, ty+3);
          ctx.closePath(); ctx.fill();
        }
        break;
      }
      case 'swamp': {
        ctx.fillStyle = '#2a3a10';
        for (let i = 0; i < 4; i++) {
          const sx = cx - 12 + (((r >> i*4) & 0xf) / 15) * 24;
          const sy = cy - 4  + (((r >> (i*4+2)) & 0x7) / 7) * 8;
          ctx.fillRect(sx, sy, 2, 4 + (r >> i & 3));
        }
        break;
      }
      case 'water': {
        ctx.strokeStyle = '#1a4a6a';
        ctx.lineWidth = 1;
        for (let i = 0; i < 2; i++) {
          const wy = cy - 5 + i * 8 + ((r >> i*3) & 3);
          ctx.beginPath();
          ctx.moveTo(cx - 12, wy);
          ctx.bezierCurveTo(cx-4, wy-3, cx+4, wy+3, cx+12, wy);
          ctx.stroke();
        }
        break;
      }
      case 'ruins': {
        ctx.strokeStyle = '#5a4a38';
        ctx.lineWidth = 1;
        const bx = cx + (((r & 0xf) / 15) * 12 - 10);
        const by = cy + (((r >> 4 & 0x7) / 7) * 8 - 6);
        const bw = 8 + (r >> 8 & 7);
        const bh = 8 + (r >> 12 & 5);
        ctx.strokeRect(bx, by - bh, bw, bh);
        // Window
        ctx.fillStyle = '#1a1408';
        ctx.fillRect(bx+2, by - bh + 2, 3, 3);
        break;
      }
      case 'irradiated': {
        ctx.fillStyle = `rgba(80,180,20,${0.15 + ((r & 0xf) / 15) * 0.2})`;
        ctx.beginPath();
        ctx.arc(cx + ((r & 0xf)/15)*16-8, cy + ((r>>4 & 0x7)/7)*10-5,
                3 + (r>>8 & 3), 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'snow': {
        ctx.fillStyle = '#c0d8e8';
        for (let i = 0; i < 5; i++) {
          const sx = cx - 14 + (((r >> i*4) & 0xf) / 15) * 28;
          const sy = cy - 8  + (((r >> (i*4+2)) & 0x7) / 7) * 16;
          ctx.fillRect(sx, sy, 2, 2);
        }
        break;
      }
      case 'mountain': {
        ctx.fillStyle = '#5a5050';
        ctx.beginPath();
        ctx.moveTo(cx, cy - 12); ctx.lineTo(cx-10, cy+4); ctx.lineTo(cx+10, cy+4);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#9a9090';
        ctx.beginPath();
        ctx.moveTo(cx, cy - 12); ctx.lineTo(cx-3, cy-5); ctx.lineTo(cx+3, cy-5);
        ctx.closePath(); ctx.fill();
        break;
      }
      case 'bunker': {
        ctx.strokeStyle = '#c8a020';
        ctx.lineWidth = 1;
        ctx.strokeRect(cx-8, cy-6, 16, 12);
        ctx.fillStyle = '#c8a020';
        ctx.fillRect(cx-1, cy-6, 2, 12);
        ctx.fillRect(cx-8, cy-1, 16, 2);
        break;
      }
      default: {
        // Plain: small grass tufts
        ctx.fillStyle = '#4a5a20';
        for (let i = 0; i < 3; i++) {
          const gx = cx - 8 + (((r >> i*4) & 0xf) / 15) * 16;
          const gy = cy - 2 + ((r >> (i*4+2) & 3));
          ctx.fillRect(gx, gy, 1, 4);
          ctx.fillRect(gx+2, gy+1, 1, 3);
        }
      }
    }
    ctx.restore();
  }

  // ── Entity sprites ────────────────────────────────────────────────────────
  const SPR = {
    // 8×8 grids: 0=transparent, 1=primary, 2=dark, 3=light, 4=accent
    player: [
      0,0,1,1,1,1,0,0,
      0,0,3,1,1,3,0,0,
      0,0,2,1,1,2,0,0,
      0,1,1,1,1,1,1,0,
      0,2,1,1,1,1,2,0,
      0,0,2,1,1,2,0,0,
      0,0,1,0,0,1,0,0,
      0,0,2,0,0,2,0,0,
    ],
    human: [
      0,0,1,1,1,0,0,0,
      0,0,1,3,1,0,0,0,
      0,0,2,1,2,0,0,0,
      0,1,1,1,1,1,0,0,
      0,2,1,1,1,2,0,0,
      0,0,2,1,2,0,0,0,
      0,0,1,0,1,0,0,0,
      0,0,2,0,2,0,0,0,
    ],
    robot: [
      0,1,1,1,1,1,0,0,
      0,1,3,1,3,1,0,0,
      0,1,1,1,1,1,0,0,
      1,1,1,1,1,1,1,0,
      1,2,1,1,1,2,1,0,
      0,1,1,1,1,1,0,0,
      0,2,1,0,1,2,0,0,
      0,2,0,0,0,2,0,0,
    ],
    mutant: [
      0,1,1,1,1,0,0,0,
      1,1,3,1,3,1,0,0,
      1,2,1,1,2,1,0,0,
      1,1,1,1,1,1,1,0,
      0,1,2,1,2,1,0,0,
      0,1,1,1,1,0,0,0,
      1,0,1,0,1,0,1,0,
      1,0,0,0,0,0,1,0,
    ],
    wolf: [
      0,0,1,1,0,0,0,0,
      0,1,1,1,1,0,0,0,
      1,1,3,1,3,1,0,0,
      1,1,1,1,1,1,1,0,
      0,2,1,1,1,1,1,0,
      0,0,1,1,1,1,0,0,
      0,1,0,0,0,1,0,0,
      0,2,0,0,0,2,0,0,
    ],
    bear: [
      0,1,1,1,1,1,0,0,
      1,1,3,1,3,1,1,0,
      1,2,1,1,1,2,1,0,
      1,1,1,1,1,1,1,0,
      1,2,1,1,1,2,1,0,
      0,1,1,1,1,1,0,0,
      0,1,0,1,0,1,0,0,
      0,2,0,0,0,2,0,0,
    ],
  };

  function drawSprite(sprKey, cx, cy, colors) {
    const spr = SPR[sprKey] || SPR.human;
    const SC  = 3;   // pixel scale
    const OW  = 8 * SC, OH = 8 * SC;
    const ox  = cx - OW / 2, oy = cy - OH / 2;
    for (let i = 0; i < 64; i++) {
      const v = spr[i];
      if (v === 0) continue;
      ctx.fillStyle = colors[v] || colors[1];
      ctx.fillRect(ox + (i%8)*SC, oy + Math.floor(i/8)*SC, SC, SC);
    }
  }

  function entityColors(e) {
    if (!e) return {};
    const c = e.clr || '#aaa';
    return {
      1: c,
      2: shadeColor(c, -50),
      3: shadeColor(c, +60),
      4: '#ffffff',
    };
  }

  function playerColors() {
    return {
      1: PAL.PLAYER,
      2: '#8a7840',
      3: '#f8f0c8',
      4: '#e04040',
    };
  }

  function shadeColor(hex, amt) {
    const n = parseInt(hex.replace('#',''), 16);
    const r = Math.min(255,Math.max(0, (n>>16)       + amt));
    const g = Math.min(255,Math.max(0, ((n>>8)&0xff) + amt));
    const b = Math.min(255,Math.max(0, (n&0xff)      + amt));
    return `rgb(${r},${g},${b})`;
  }

  function spriteKey(enemy) {
    const map = { robot:'robot', mutant:'mutant', wolf:'wolf', bear:'bear' };
    return map[enemy.id] || 'human';
  }

  // ── HP bar under entity ───────────────────────────────────────────────────
  function drawHPBar(cx, cy, hp, maxHp) {
    const w = 28, h = 3, x = cx - w/2, y = cy + 16;
    ctx.fillStyle = '#200a00';
    ctx.fillRect(x, y, w, h);
    const ratio = Math.max(0, hp / maxHp);
    ctx.fillStyle = ratio > 0.5 ? '#30a830' : ratio > 0.25 ? '#c8a020' : '#c02020';
    ctx.fillRect(x, y, Math.floor(w * ratio), h);
  }

  // ── Item dot ──────────────────────────────────────────────────────────────
  function drawItemDot(cx, cy, item) {
    ctx.fillStyle = item.clr || '#c8c820';
    ctx.beginPath();
    ctx.arc(cx + 10, cy + 10, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(item.icon || '?', cx + 10, cy + 10);
  }

  // ── Main render ───────────────────────────────────────────────────────────
  function render(tiles, player, cam, highlightSet, activeEnemies) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const { colMin, colMax, rowMin, rowMax } = visibleRange(cam);

    // ── Pass 1: tile fills + details ──────────────────────────────────────
    for (let r = rowMin; r <= rowMax; r++) {
      for (let c = colMin; c <= colMax; c++) {
        const tile = MAP.getTile(tiles, c, r);
        if (!tile) continue;

        const { x: sx, y: sy } = hexCenter(c, r, cam);

        if (!tile.explored) {
          // Completely unexplored – draw dark fill only
          HEX.path(ctx, sx, sy, SIZE - 1);
          ctx.fillStyle = '#050805';
          ctx.fill();
          continue;
        }

        // Pick colour variant by position hash
        const variant = (c * 3 + r * 7) % 3;
        const fills   = BIOME_FILLS[tile.biome] || BIOME_FILLS.plain;

        HEX.path(ctx, sx, sy, SIZE - 1);
        ctx.fillStyle = fills[variant];
        ctx.fill();

        // Biome detail
        if (tile.visible) {
          drawBiomeDetail(c, r, tile.biome, sx, sy);
        }

        // Grid lines
        HEX.path(ctx, sx, sy, SIZE - 1);
        ctx.strokeStyle = PAL.GRID;
        ctx.lineWidth   = 0.8;
        ctx.stroke();

        // Fog of war tint (explored but not visible)
        if (!tile.visible) {
          HEX.path(ctx, sx, sy, SIZE - 1);
          ctx.fillStyle = PAL.SEEN;
          ctx.fill();
        }
      }
    }

    // ── Pass 2: highlights ────────────────────────────────────────────────
    if (highlightSet) {
      for (const key of highlightSet.keys()) {
        const parts = key.split(',');
        const c = parseInt(parts[0]), r = parseInt(parts[1]), type = parts[2];
        const { x: sx, y: sy } = hexCenter(c, r, cam);
        HEX.path(ctx, sx, sy, SIZE - 1);
        ctx.fillStyle = type === 'attack' ? PAL.HL_ATK : PAL.HL_MOVE;
        ctx.fill();
      }
    }

    // ── Pass 3: items, enemies, player ────────────────────────────────────
    for (let r = rowMin; r <= rowMax; r++) {
      for (let c = colMin; c <= colMax; c++) {
        const tile = MAP.getTile(tiles, c, r);
        if (!tile || !tile.explored) continue;

        const { x: sx, y: sy } = hexCenter(c, r, cam);

        // Items (show dot for top item)
        if (tile.items.length > 0 && tile.visible) {
          drawItemDot(sx, sy, tile.items[0]);
        }

        // Enemy
        if (tile.enemy && tile.visible) {
          const e = tile.enemy;
          drawSprite(spriteKey(e), sx, sy, entityColors(e));
          drawHPBar(sx, sy, e.hp, e.max_hp);
        }
      }
    }

    // Player
    const { x: px, y: py } = hexCenter(player.col, player.row, cam);
    drawSprite('player', px, py, playerColors());

    // Player HP bar
    drawHPBar(px, py, player.hp, player.max_hp);

    // Player selection ring
    HEX.path(ctx, px, py, SIZE - 2);
    ctx.strokeStyle = 'rgba(220,200,80,0.6)';
    ctx.lineWidth   = 2;
    ctx.stroke();
  }

  // ── Minimap ───────────────────────────────────────────────────────────────
  const MINI_COLORS = {
    forest:'#1b3815', swamp:'#283312', water:'#0d2336', ruins:'#2c2820',
    irradiated:'#253810', snow:'#5a6a78', plain:'#384218', mountain:'#3a3030',
    bunker:'#c8a020',
  };

  function renderMinimap(tiles, player, cam, minimapCanvas) {
    const mc = minimapCanvas.getContext('2d');
    const mw = minimapCanvas.width, mh = minimapCanvas.height;
    const scx = mw / CFG.MAP_COLS, scy = mh / CFG.MAP_ROWS;
    const W   = CFG.MAP_COLS, H = CFG.MAP_ROWS;

    mc.fillStyle = '#000';
    mc.fillRect(0, 0, mw, mh);

    // Draw tile dots
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const tile = tiles[r * W + c];
        if (!tile.explored) continue;
        mc.fillStyle = MINI_COLORS[tile.biome] || '#333';
        if (!tile.visible) mc.globalAlpha = 0.5;
        mc.fillRect(Math.floor(c * scx), Math.floor(r * scy),
                    Math.max(1, Math.floor(scx)), Math.max(1, Math.floor(scy)));
        mc.globalAlpha = 1;
      }
    }

    // Player dot
    mc.fillStyle = '#e8e050';
    mc.fillRect(Math.floor(player.col * scx) - 1, Math.floor(player.row * scy) - 1, 3, 3);

    // Viewport rectangle
    const vx = Math.floor(cam.x / HEX.hexW(SIZE) * scx);
    const vy = Math.floor(cam.y / V_STEP * scy);
    const vw = Math.floor(canvas.width  / HEX.hexW(SIZE) * scx);
    const vh = Math.floor(canvas.height / V_STEP * scy);
    mc.strokeStyle = 'rgba(200,200,100,0.5)';
    mc.lineWidth   = 1;
    mc.strokeRect(vx, vy, vw, vh);
  }

  function getCanvas() { return canvas; }

  return { init, resize, render, renderMinimap, hexCenter, visibleRange, getCanvas, HEX_W, V_STEP };
})();

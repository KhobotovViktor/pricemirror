'use strict';

const HEX = (() => {
  // Pointy-top hexes, odd-row offset coordinate system
  function hexW(size) { return Math.sqrt(3) * size; }
  function hexH(size) { return 2 * size; }

  function toPixel(col, row, size) {
    const w = hexW(size), h = hexH(size);
    return {
      x: col * w + (row & 1 ? w / 2 : 0),
      y: row * h * 0.75,
    };
  }

  // Offset → axial
  function toAxial(col, row) {
    return { q: col - (row - (row & 1)) / 2, r: row };
  }

  // Axial → offset
  function toOffset(q, r) {
    return { col: q + (r - (r & 1)) / 2, row: r };
  }

  // Cube round (for pixel→hex)
  function cubeRound(x, y, z) {
    let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
    const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
    if (dx > dy && dx > dz) rx = -ry - rz;
    else if (dy > dz)       ry = -rx - rz;
    else                    rz = -rx - ry;
    return { x: rx, y: ry, z: rz };
  }

  function fromPixel(px, py, size) {
    // pixel → axial fractional
    const q = ( Math.sqrt(3)/3 * px - 1/3 * py) / size;
    const r = (                        2/3 * py) / size;
    const s = -q - r;
    const c = cubeRound(q, r, s);
    return toOffset(c.x, c.y);
  }

  // 6 neighbours in odd-row offset
  const DIRS_EVEN = [[1,0],[0,-1],[-1,-1],[-1,0],[-1,1],[0,1]];
  const DIRS_ODD  = [[1,0],[1,-1],[0,-1],[-1,0],[0,1],[1,1]];
  function neighbors(col, row) {
    const dirs = (row & 1) ? DIRS_ODD : DIRS_EVEN;
    return dirs.map(([dc,dr]) => ({ col: col+dc, row: row+dr }));
  }

  function distance(c1, r1, c2, r2) {
    const a = toAxial(c1, r1), b = toAxial(c2, r2);
    const dq = b.q - a.q, dr = b.r - a.r;
    return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(-dq - dr));
  }

  // Draw a pointy-top hex path on ctx centred at (cx,cy)
  function path(ctx, cx, cy, size) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 180 * (60 * i - 30);
      const x = cx + size * Math.cos(a);
      const y = cy + size * Math.sin(a);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  return { toPixel, toAxial, toOffset, fromPixel, neighbors, distance, path, hexW, hexH };
})();

'use strict';
/* Campus map on one canvas: basemap, terrain (flat or terraced 3-D), road network, walked/cycled roads,
   simulated walkers & riders, the race, reach maps and labels. World units are metres east / north of the
   study origin; a camera (centre, zoom, rotation, squash, lift) maps them onto the 1600×900 stage. */
const DATA = window.WRW;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeIO = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const FONT = '"InterDeck", "Inter", "Segoe UI", "Noto Sans", Arial, sans-serif';

/* =================================================================== network & routing */
const NET = (() => {
  const E = DATA.edges.map((r, id) => {
    const [a, b, len, flat, cls, cw, cb, cp, sup] = r;
    const xs = [], ys = [], cs = [0];
    for (let i = 0; i < flat.length; i += 2) { xs.push(flat[i]); ys.push(flat[i + 1]); }
    for (let i = 1; i < xs.length; i++) cs.push(cs[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]));
    const mid = Math.floor(xs.length / 2);
    return { id, a, b, len, xs, ys, cs, L: cs[cs.length - 1] || 0.01, cls, cost: { w: cw, b: cb, p: cp }, sup, mx: xs[mid], my: ys[mid] };
  });
  const N = DATA.nodes, nodeXY = new Float64Array(N * 2).fill(NaN);
  E.forEach(e => {
    nodeXY[e.a * 2] = e.xs[0]; nodeXY[e.a * 2 + 1] = e.ys[0];
    nodeXY[e.b * 2] = e.xs[e.xs.length - 1]; nodeXY[e.b * 2 + 1] = e.ys[e.ys.length - 1];
  });
  const out = {};
  for (const m of ['w', 'b', 'p']) {
    const o = Array.from({ length: N }, () => []);
    E.forEach(e => {
      if (e.cost[m][0] != null) o[e.a].push([e.b, e.cost[m][0], e.id, 0]);
      if (e.cost[m][1] != null) o[e.b].push([e.a, e.cost[m][1], e.id, 1]);
    });
    out[m] = o;
  }
  return { E, N, nodeXY, out };
})();
const PLACES = DATA.places;
const PL = Object.fromEntries(PLACES.map((p, i) => [p.zh, Object.assign(p, { i })]));

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(k, v) {
    const a = this.a; a.push([k, v]); let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}
function dijkstra(mode, src) {
  const n = NET.N, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), pdir = new Int8Array(n), out = NET.out[mode];
  dist[src] = 0; const h = new Heap(); h.push(0, src);
  while (h.size) {
    const [d, u] = h.pop(); if (d > dist[u]) continue;
    for (const [v, c, eid, dir] of out[u]) { const nd = d + c; if (nd < dist[v]) { dist[v] = nd; prev[v] = eid; pdir[v] = dir; h.push(nd, v); } }
  }
  return { dist, prev, pdir };
}
function snapNode(mode, x, y) {
  let best = -1, bd = Infinity; const out = NET.out[mode];
  for (let i = 0; i < NET.N; i++) {
    if (!out[i].length) continue;
    const d = Math.hypot(NET.nodeXY[i * 2] - x, NET.nodeXY[i * 2 + 1] - y);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
/* fastest route between two places: polyline + cumulative model seconds */
function routeBetween(mode, fromZh, toZh) {
  const a = snapNode(mode, ...PL[fromZh].p), b = snapNode(mode, ...PL[toZh].p), R = dijkstra(mode, a);
  const arcs = []; let u = b;
  while (u !== a && R.prev[u] >= 0) { const e = NET.E[R.prev[u]], d = R.pdir[u]; arcs.push([e, d]); u = d ? e.b : e.a; }
  arcs.reverse();
  const xs = [PL[fromZh].p[0]], ys = [PL[fromZh].p[1]], tc = [0];
  const walkIn = Math.hypot(NET.nodeXY[a * 2] - xs[0], NET.nodeXY[a * 2 + 1] - ys[0]) / 1.17;
  xs.push(NET.nodeXY[a * 2]); ys.push(NET.nodeXY[a * 2 + 1]); tc.push(walkIn);
  for (const [e, d] of arcs) {
    const idx = [...e.xs.keys()]; if (d) idx.reverse();
    const c = e.cost[mode][d];
    for (let k = 1; k < idx.length; k++) {
      const dl = Math.abs(e.cs[idx[k]] - e.cs[idx[k - 1]]);
      tc.push(tc[tc.length - 1] + c * dl / e.L); xs.push(e.xs[idx[k]]); ys.push(e.ys[idx[k]]);
    }
  }
  const end = PL[toZh].p, lx = xs[xs.length - 1], ly = ys[ys.length - 1];
  tc.push(tc[tc.length - 1] + Math.hypot(end[0] - lx, end[1] - ly) / 1.17); xs.push(end[0]); ys.push(end[1]);
  return { xs, ys, tc, total: tc[tc.length - 1] };
}

/* =================================================================== terrain */
const TER = (() => {
  const T = DATA.terrain; if (!T) return null;
  const { nx, ny, x0, y0, step, h } = T;
  const at = (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny) ? null : h[j * nx + i];
  const sample = (x, y) => {
    const fx = (x - x0) / step, fy = (y - y0) / step, i = Math.floor(fx), j = Math.floor(fy), dx = fx - i, dy = fy - j;
    const v = [at(i, j), at(i + 1, j), at(i, j + 1), at(i + 1, j + 1)], w = [(1 - dx) * (1 - dy), dx * (1 - dy), (1 - dx) * dy, dx * dy];
    let s = 0, ws = 0; v.forEach((q, k) => { if (q != null) { s += q * w[k]; ws += w[k]; } });
    return ws > .2 ? s / ws : null;
  };
  const near = (x, y) => {          // nearest supported height within ~60 m (bridges, building blocks)
    const v = sample(x, y); if (v != null) return v;
    for (let r = 1; r <= 6; r++) for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2, s = sample(x + Math.cos(a) * r * step, y + Math.sin(a) * r * step);
      if (s != null) return s;
    }
    return null;
  };
  // contour paths (2 m minor, 10 m major) by marching squares
  const minor = new Path2D(), major = new Path2D();
  for (let lv = 4; lv <= 34; lv += 2) {
    const P = lv % 10 === 0 ? major : minor;
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
      if (a == null || b == null || c == null || d == null) continue;
      const idx = (a > lv) | (b > lv) << 1 | (c > lv) << 2 | (d > lv) << 3;
      if (idx === 0 || idx === 15) continue;
      const X = x0 + i * step, Y = y0 + j * step, f = (p, q) => (lv - p) / (q - p);
      const pt = { ab: [X + f(a, b) * step, Y], bc: [X + step, Y + f(b, c) * step], dc: [X + f(d, c) * step, Y + step], ad: [X, Y + f(a, d) * step] };
      const segs = { 1: ['ad', 'ab'], 2: ['ab', 'bc'], 3: ['ad', 'bc'], 4: ['bc', 'dc'], 5: ['ad', 'dc', 'ab', 'bc'], 6: ['ab', 'dc'], 7: ['ad', 'dc'],
        8: ['ad', 'dc'], 9: ['ab', 'dc'], 10: ['ab', 'ad', 'bc', 'dc'], 11: ['bc', 'dc'], 12: ['ad', 'bc'], 13: ['ab', 'bc'], 14: ['ad', 'ab'] }[idx];
      for (let s = 0; s < segs.length; s += 2) { P.moveTo(...pt[segs[s]]); P.lineTo(...pt[segs[s + 1]]); }
    }
  }
  const LEVELS = []; for (let lv = 4; lv <= 34; lv += 2) LEVELS.push(lv);
  // drawn layers only: fill enclosed gaps (building blocks) from their neighbours, then measure distance to the edge for a soft fade
  const hf = h.slice();
  for (let pass = 0; pass < 24; pass++) {
    const nxt = hf.slice();
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      if (hf[j * nx + i] != null) continue;
      let s = 0, n = 0, dirs = 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        for (let r = 1; r <= 30; r++) { const ii = i + di * r, jj = j + dj * r; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) break; const q = hf[jj * nx + ii]; if (q != null) { dirs++; if (r === 1) { s += q; n++; } break; } }
      }
      if (dirs >= 3 && n) nxt[j * nx + i] = s / n;
    }
    for (let k = 0; k < hf.length; k++) hf[k] = nxt[k];
  }
  const atF = (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny) ? null : hf[j * nx + i];
  const edge = new Float32Array(nx * ny).fill(9);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (atF(i, j) == null) { edge[j * nx + i] = 0; continue; }
    let d = 9;
    for (let dj = -4; dj <= 4; dj++) for (let di = -4; di <= 4; di++) if (atF(i + di, j + dj) == null) d = Math.min(d, Math.hypot(di, dj));
    edge[j * nx + i] = d;
  }
  const sampleF = (x, y) => {
    const fx = (x - x0) / step, fy = (y - y0) / step, i = Math.floor(fx), j = Math.floor(fy), dx = fx - i, dy = fy - j;
    const v = [atF(i, j), atF(i + 1, j), atF(i, j + 1), atF(i + 1, j + 1)], w = [(1 - dx) * (1 - dy), dx * (1 - dy), (1 - dx) * dy, dx * dy];
    let s = 0, ws = 0; v.forEach((q, k) => { if (q != null) { s += q * w[k]; ws += w[k]; } });
    return ws > .2 ? s / ws : null;
  };
  return { nx, ny, x0, y0, step, at, atF, edge, sample, sampleF, near, minor, major, LEVELS };
})();

/* =================================================================== themes */
const MAP_THEME = {
  light: {
    bld: 'rgba(48, 40, 28, .085)', bldEdge: 'rgba(48, 40, 28, .17)', water: '#d2e1eb', green: '#e3e8d6', trunk: '#d8d3c7',
    net: { major: '#b9b4a8', minor: '#c9c4b8', foot: '#d3cfc4', bridge: '#bfb9ac', steps: '#a29c8f' },
    contour: 'rgba(130, 108, 72, .30)', contourMajor: 'rgba(130, 108, 72, .55)',
    hypLo: [244, 240, 231], hypHi: [214, 196, 160], terLo: [242, 237, 226], terHi: [206, 184, 140], wall: .80,
    ink: '#141414', ink2: '#4d4c48', muted: '#85837c', halo: 'rgba(246, 244, 239, .92)', surface: '#f6f4ef',
    walk: '#2a78d6', bike: '#eb6834', bus: '#1baf7a', blend: 'source-over', flowA: .78,
  },
  dark: {
    bld: 'rgba(255, 255, 255, .05)', bldEdge: 'rgba(255, 255, 255, .09)', water: '#17222b', green: '#17201a', trunk: '#2c2d31',
    net: { major: '#57585d', minor: '#47484c', foot: '#3b3c40', bridge: '#4c4d52', steps: '#727378' },
    contour: 'rgba(168, 227, 201, .20)', contourMajor: 'rgba(168, 227, 201, .40)',
    hypLo: [24, 26, 28], hypHi: [52, 82, 70], terLo: [30, 33, 36], terHi: [74, 112, 96], wall: .62,
    ink: '#f3f1eb', ink2: '#c3c2b7', muted: '#8b8981', halo: 'rgba(20, 21, 23, .92)', surface: '#141517',
    walk: '#3987e5', bike: '#d95926', bus: '#199e70', blend: 'lighter', flowA: .9,
  },
};

/* =================================================================== renderer */
const MAP = (() => {
  const cv = document.getElementById('map'), ctx = cv.getContext('2d');
  let K = 1, TH = MAP_THEME.light;
  const CX = 40, CY = -30;                           // campus centre for reveal waves

  // ---- static world paths
  const poly = (P, flat) => { P.moveTo(flat[0], flat[1]); for (let i = 2; i < flat.length; i += 2) P.lineTo(flat[i], flat[i + 1]); };
  const base = { bld: new Path2D(), water: new Path2D(), green: new Path2D(), trunk: new Path2D() };
  DATA.base.bld.forEach(f => { poly(base.bld, f); base.bld.closePath(); });
  DATA.base.water.forEach(f => { poly(base.water, f); base.water.closePath(); });
  DATA.base.green.forEach(f => { poly(base.green, f); base.green.closePath(); });
  DATA.base.road.forEach(f => poly(base.trunk, f));
  const bldList = DATA.base.bld.map(f => {
    let sx = 0, sy = 0; const n = f.length / 2; for (let i = 0; i < f.length; i += 2) { sx += f[i]; sy += f[i + 1]; }
    const cx = sx / n, cy = sy / n; return { f, h: TER ? (TER.near(cx, cy) ?? 0) : 0 };
  });
  const net = { major: new Path2D(), minor: new Path2D(), foot: new Path2D(), bridge: new Path2D(), steps: new Path2D() };
  const addEdge = (P, e) => { P.moveTo(e.xs[0], e.ys[0]); for (let i = 1; i < e.xs.length; i++) P.lineTo(e.xs[i], e.ys[i]); };
  NET.E.forEach(e => addEdge(net[e.cls] || net.minor, e));
  // per-vertex heights for the lifted (3-D) view
  const vh = NET.E.map(e => e.xs.map((x, i) => TER ? (TER.near(x, e.ys[i]) ?? 0) : 0));
  // bucketed layers for reveal waves (by distance from campus centre)
  const NB = 24, RMAX = 1000;
  const bucket = list => {
    const B = Array.from({ length: NB }, () => new Path2D());
    list.forEach(e => { const r = Math.hypot(e.mx - CX, e.my - CY); addEdge(B[Math.min(NB - 1, Math.floor(r / RMAX * NB))], e); });
    return B;
  };
  const cover = { walk: bucket(NET.E.filter(e => e.sup[0])), bike: bucket(NET.E.filter(e => e.sup[1])) };
  const stepsB = bucket(NET.E.filter(e => e.cls === 'steps'));
  const stepPts = NET.E.filter(e => e.cls === 'steps' && Math.abs(e.mx - 120) < 560 && e.my > -700 && e.my < 650).map(e => [e.mx, e.my]);

  // ---- terrain rasters (per theme)
  const rasters = {};
  function buildRasters(name) {
    if (!TER || rasters[name]) return;
    const th = MAP_THEME[name], { nx, ny, atF: at, edge, step } = TER;
    // flat hypsometric tint with hill-shade (one pixel per cell; row 0 = south)
    const flat = document.createElement('canvas'); flat.width = nx; flat.height = ny;
    const g = flat.getContext('2d'), img = g.createImageData(nx, ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const v = at(i, j); if (v == null) continue;
      const t = clamp((v - 2) / 33, 0, 1);
      const gx = ((at(i + 1, j) ?? v) - (at(i - 1, j) ?? v)) / (2 * step), gy = ((at(i, j + 1) ?? v) - (at(i, j - 1) ?? v)) / (2 * step);
      const shade = clamp(1 + (-gx * .7 + gy * .7) * 4, .78, 1.18);
      const k = (j * nx + i) * 4;
      for (let c = 0; c < 3; c++) img.data[k + c] = clamp(lerp(th.hypLo[c], th.hypHi[c], t) * shade, 0, 255);
      img.data[k + 3] = 255 * (.5 + .5 * t) * clamp(edge[j * nx + i] / 4, 0, 1);
    }
    g.putImageData(img, 0, 0);
    // terraces: one mask per 2 m level at 2× resolution, top face + darker wall
    const S = 2, W = nx * S, H = ny * S, levels = [];
    const hh = new Float32Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const v = TER.sampleF(TER.x0 + (i + .5) / S * step - step / 2, TER.y0 + (j + .5) / S * step - step / 2);
      hh[j * W + i] = v == null ? -99 : v;
    }
    TER.LEVELS.forEach((lv, li) => {
      const t = li / (TER.LEVELS.length - 1);
      const top = th.terLo.map((c, k) => lerp(c, th.terHi[k], t)), wall = top.map(c => c * th.wall);
      const mk = col => {
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const gg = c.getContext('2d'), im = gg.createImageData(W, H);
        for (let p = 0; p < W * H; p++) {
          const a = clamp((hh[p] - lv + 2) / 1.2, 0, 1);   // soft 1.2 m edge
          if (a <= 0) continue;
          im.data[p * 4] = col[0]; im.data[p * 4 + 1] = col[1]; im.data[p * 4 + 2] = col[2]; im.data[p * 4 + 3] = 255 * a;
        }
        gg.putImageData(im, 0, 0); return c;
      };
      levels.push({ lv, top: mk(top), wall: mk(wall) });
    });
    rasters[name] = { flat, levels };
  }

  // ---- camera & layer state (tweened)
  const KEYS = ['cx', 'cy', 'ppm', 'sx', 'sy', 'rot', 'squash', 'lift', 'terrain', 'terrace', 'contour', 'water', 'bld', 'trunk', 'net', 'cover',
    'flow', 'race', 'iso', 'steps', 'labels', 'drift'];
  const BASE = { cx: 40, cy: -30, ppm: .62, sx: 800, sy: 450, rot: 0, squash: 1, lift: 0, terrain: 0, terrace: 0, contour: 0, water: 0, bld: 0, trunk: 0,
    net: 0, cover: 0, flow: 0, race: 0, iso: 0, steps: 0, labels: 0, drift: 0 };
  let cur = { ...BASE }, from = { ...BASE }, to = { ...BASE }, t0 = 0, dur = 1;
  let labelSet = new Set(), labelOpts = {};
  const labelA = PLACES.map(() => 0);
  let reveal = 1, revealT0 = 0, coverT0 = -1e9, stepsT0 = -1e9;

  function set(target, opts = {}) {
    from = { ...cur }; to = { ...BASE, ...target }; t0 = performance.now(); dur = REDUCED ? 1 : (opts.dur ?? 1700);
    labelSet = new Set(target.labelList || []); labelOpts = target.labelOpts || {};
    if (opts.reveal) { reveal = 0; revealT0 = performance.now(); }
    if (target.cover && !(from.cover > .5)) coverT0 = performance.now() + 300;
    if (target.steps && !(from.steps > .5)) stepsT0 = performance.now() + 500;
  }
  function setTheme(name) { TH = MAP_THEME[name]; buildRasters(name); }
  function resize(scale) {
    K = Math.min(2, (window.devicePixelRatio || 1) * scale);
    cv.width = Math.round(1600 * K); cv.height = Math.round(900 * K);
  }

  let M = [1, 0, 0, 1, 0, 0];
  function camera(c) {
    const r = c.rot * Math.PI / 180, co = Math.cos(r), si = Math.sin(r), p = c.ppm, q = c.ppm * c.squash;
    const a = p * co, cc = -p * si, b = -q * si, d = -q * co;
    M = [a, b, cc, d, c.sx - a * c.cx - cc * c.cy, c.sy - b * c.cx - d * c.cy];
  }
  const W2S = (x, y, h = 0) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5] - cur.lift * h];
  const devM = () => new DOMMatrix([K * M[0], K * M[1], K * M[2], K * M[3], K * M[4], K * M[5]]);
  function strokeWorld(P, color, width, alpha) {
    if (alpha <= .005) return;
    const Q = new Path2D(); Q.addPath(P, devM());
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width * K; ctx.stroke(Q);
  }
  // ---- lifted drawing (3-D hill view): per-vertex screen positions
  function liftedNet(alpha) {
    if (alpha <= .005) return;
    ctx.setTransform(K, 0, 0, K, 0, 0); ctx.lineCap = ctx.lineJoin = 'round';
    const groups = { major: new Path2D(), minor: new Path2D(), foot: new Path2D(), bridge: new Path2D(), steps: new Path2D() };
    NET.E.forEach((e, k) => {
      const P = groups[e.cls] || groups.minor, H = vh[k];
      for (let i = 0; i < e.xs.length; i++) { const [X, Y] = W2S(e.xs[i], e.ys[i], H[i]); i ? P.lineTo(X, Y) : P.moveTo(X, Y); }
    });
    for (const [k, w] of [['foot', .9], ['bridge', 1], ['steps', 1], ['minor', 1.3], ['major', 1.9]]) {
      ctx.globalAlpha = alpha; ctx.strokeStyle = TH.net[k]; ctx.lineWidth = w; ctx.stroke(groups[k]);
    }
  }
  function liftedBld(alpha) {
    if (alpha <= .005) return;
    ctx.setTransform(K, 0, 0, K, 0, 0);
    const P = new Path2D();
    bldList.forEach(b => { const f = b.f; for (let i = 0; i < f.length; i += 2) { const [X, Y] = W2S(f[i], f[i + 1], b.h); i ? P.lineTo(X, Y) : P.moveTo(X, Y); } P.closePath(); });
    ctx.globalAlpha = alpha; ctx.fillStyle = TH.bld; ctx.fill(P); ctx.strokeStyle = TH.bldEdge; ctx.lineWidth = .8; ctx.stroke(P);
  }
  function drawTerraces(alpha) {
    const R = rasters[themeName()]; if (!R || alpha <= .005) return;
    const { x0, y0, step, nx, ny } = TER;
    for (const L of R.levels) {
      for (const [img, h] of [[L.wall, L.lv - 2], [L.top, L.lv]]) {
        ctx.setTransform(K * M[0], K * M[1], K * M[2], K * M[3], K * M[4], K * (M[5] - cur.lift * h));
        ctx.globalAlpha = alpha; ctx.imageSmoothingEnabled = true;
        ctx.drawImage(img, x0 - step / 2, y0 - step / 2, nx * step, ny * step);
      }
    }
  }
  const themeName = () => TH === MAP_THEME.dark ? 'dark' : 'light';

  // ---- simulated walkers & riders
  const parts = [], TL = 30;
  const CORE = 620, inCore = e => Math.hypot(e.mx - CX - 40, e.my - CY) < CORE;
  const mobile = { w: NET.E.filter(e => inCore(e) && (e.cost.w[0] != null || e.cost.w[1] != null)), b: NET.E.filter(e => inCore(e) && (e.cost.b[0] != null || e.cost.b[1] != null)) };
  function pointAt(e, s) {
    const cs = e.cs; s = clamp(s, 0, e.L);
    let i = 1; while (i < cs.length - 1 && cs[i] < s) i++;
    const t = (s - cs[i - 1]) / ((cs[i] - cs[i - 1]) || 1);
    return [lerp(e.xs[i - 1], e.xs[i], t), lerp(e.ys[i - 1], e.ys[i], t)];
  }
  function spawn(p) {
    const list = mobile[p.m], e = list[(Math.random() * list.length) | 0];
    const dirs = [0, 1].filter(d => e.cost[p.m][d] != null); p.d = dirs[(Math.random() * dirs.length) | 0];
    p.e = e; p.s = Math.random() * e.L; p.life = 5 + Math.random() * 14; p.age = 0;
  }
  for (let i = 0; i < 560; i++) { const p = { m: i % 5 < 2 ? 'w' : 'b' }; spawn(p); p.age = 2; parts.push(p); }
  function stepParticles(dt) {
    for (const p of parts) {
      p.life -= dt; p.age += dt; if (p.life < 0) { spawn(p); continue; }
      const e = p.e, v = e.len / e.cost[p.m][p.d];
      p.v = v; p.s += (p.d ? -1 : 1) * v * dt * TL;
      if (p.s > e.L || p.s < 0) {
        const node = p.d ? e.a : e.b, opts = NET.out[p.m][node].filter(o => o[2] !== e.id);
        const nx = opts.length ? opts[(Math.random() * opts.length) | 0] : null;
        if (!nx || Math.hypot(NET.E[nx[2]].mx - CX - 40, NET.E[nx[2]].my - CY) > CORE * 1.3) { spawn(p); continue; }
        p.e = NET.E[nx[2]]; p.d = nx[3]; p.s = p.d ? p.e.L : 0;
      }
    }
  }
  function drawParticles(alpha) {
    if (alpha <= .01) return;
    ctx.setTransform(K, 0, 0, K, 0, 0); ctx.lineCap = 'round'; ctx.globalCompositeOperation = TH.blend;
    // comets: a bright head and a tail in three fading pieces (tail length ∝ speed); particles fade in and out over their life
    const TAIL = [[1, 2.6], [.45, 2], [.16, 1.5]];
    for (const m of ['w', 'b']) {
      const tails = TAIL.map(() => new Path2D()), heads = new Path2D();
      for (const p of parts) {
        if (p.m !== m || p.age < .4 || p.life < .4) continue;
        const tr = clamp(p.v * TL * .12, 8, 70), sg = p.d ? -1 : 1;
        const pts = [0, 1, 2, 3].map(k => { const q = pointAt(p.e, p.s - sg * tr * k / 3); return W2S(q[0], q[1]); });
        for (let k = 0; k < 3; k++) { tails[k].moveTo(pts[k][0], pts[k][1]); tails[k].lineTo(pts[k + 1][0], pts[k + 1][1]); }
        heads.moveTo(pts[0][0] + 2.2, pts[0][1]); heads.arc(pts[0][0], pts[0][1], 2.2, 0, Math.PI * 2);
      }
      const col = m === 'w' ? TH.walk : TH.bike; ctx.strokeStyle = ctx.fillStyle = col;
      TAIL.forEach(([a, w], k) => { ctx.globalAlpha = alpha * TH.flowA * a; ctx.lineWidth = w; ctx.stroke(tails[k]); });
      ctx.globalAlpha = alpha * TH.flowA; ctx.fill(heads);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---- overlays (set by slides)
  const overlay = { race: null, iso: null };
  function subPath(P, e, s0, s1) {
    if (s1 - s0 < .2) return;
    const p0 = pointAt(e, s0); P.moveTo(p0[0], p0[1]);
    for (let i = 1; i < e.cs.length - 1; i++) if (e.cs[i] > s0 && e.cs[i] < s1) P.lineTo(e.xs[i], e.ys[i]);
    const p1 = pointAt(e, s1); P.lineTo(p1[0], p1[1]);
  }
  function disc(X, Y, color, r = 7, glow = 0, alpha = 1) {
    ctx.setTransform(K, 0, 0, K, 0, 0); ctx.globalAlpha = alpha;
    if (glow) { const g = ctx.createRadialGradient(X, Y, 0, X, Y, glow); g.addColorStop(0, color + '66'); g.addColorStop(1, color + '00'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, Y, glow, 0, 7); ctx.fill(); }
    ctx.fillStyle = TH.surface; ctx.beginPath(); ctx.arc(X, Y, r + 2.5, 0, 7); ctx.fill();
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(X, Y, r, 0, 7); ctx.fill();
  }
  function drawRace(alpha) {
    const R = overlay.race; if (!R || alpha < .01) return;
    const tNow = R.clock();
    ctx.lineCap = ctx.lineJoin = 'round';
    for (const r of R.routes) {
      const col = TH[r.mode];
      strokeWorld(r.path, col, 7, alpha * .16);
      const f = clamp(tNow / r.T, 0, 1);
      strokeWorld(r.partial(f), col, 4.5, alpha);
    }
    for (const r of R.routes) {
      const f = clamp(tNow / r.T, 0, 1), pos = r.at(f), [X, Y] = W2S(pos[0], pos[1]), col = TH[r.mode];
      if (f >= 1) {
        const since = (tNow - r.T) / R.speed, pulse = clamp(since / 1.2, 0, 1);
        ctx.setTransform(K, 0, 0, K, 0, 0); ctx.globalAlpha = alpha * (1 - pulse); ctx.strokeStyle = col; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(X, Y, 10 + pulse * 40, 0, 7); ctx.stroke();
      }
      disc(X, Y, col, 7.5, f < 1 ? 30 : 0, alpha);
    }
    // the shuttle that never left: a dashed ghost at the start
    const s = R.routes[0], [SX, SY] = W2S(s.xs[0], s.ys[0]), ph = (performance.now() / 1000) % 2;
    ctx.setTransform(K, 0, 0, K, 0, 0); ctx.globalAlpha = alpha * .9; ctx.strokeStyle = TH.bus; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = -ph * 8; ctx.beginPath(); ctx.arc(SX, SY, 17, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = `700 13px ${FONT}`; ctx.fillStyle = TH.bus; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('?', SX + 18, SY - 18);
    ctx.globalAlpha = 1;
  }
  function drawIso(alpha) {
    const I = overlay.iso; if (!I || alpha < .01) return;
    const T = I.clock();
    ctx.lineCap = ctx.lineJoin = 'round';
    for (const L of I.layers) {          // bike underneath, walk on top
      const Tb = Math.min(T, L.limit); if (Tb <= 0) continue;
      const P = new Path2D(), dist = L.dist, m = L.key;
      for (const e of NET.E) {
        const ca = e.cost[m][0], cb = e.cost[m][1], da = dist[e.a], db = dist[e.b];
        const fa = ca != null && isFinite(da) ? clamp((Tb - da) / ca, 0, 1) : 0;
        const fb = cb != null && isFinite(db) ? clamp((Tb - db) / cb, 0, 1) : 0;
        if (fa + fb >= 1) subPath(P, e, 0, e.L);
        else { if (fa > 0) subPath(P, e, 0, fa * e.L); if (fb > 0) subPath(P, e, e.L - fb * e.L, e.L); }
      }
      strokeWorld(P, TH[L.mode], L.width, alpha * L.alpha);
    }
    const [X, Y] = W2S(...I.origin.p), pulse = (performance.now() / 1500) % 1;
    ctx.setTransform(K, 0, 0, K, 0, 0); ctx.globalAlpha = alpha * (1 - pulse); ctx.strokeStyle = TH.ink; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(X, Y, 9 + pulse * 46, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
  }
  function drawSteps(alpha, now) {
    if (alpha < .01) return;
    const R = clamp((now - stepsT0) / 2200, 0, 1) * RMAX * 1.05;
    ctx.lineCap = 'round';
    stepsB.forEach((P, k) => { const a = clamp((R - k * RMAX / NB) / (RMAX / NB), 0, 1); strokeWorld(P, TH.ink, 4.2, alpha * a); });
    ctx.setTransform(K, 0, 0, K, 0, 0);
    const pulse = (now / 1600) % 1;
    stepPts.forEach(([x, y]) => {
      const r = Math.hypot(x - CX, y - CY); if (r > R) return;
      const [X, Y] = W2S(x, y);
      ctx.globalAlpha = alpha * (1 - pulse) * .55; ctx.strokeStyle = TH.bike; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(X, Y, 5 + pulse * 14, 0, 7); ctx.stroke();
      ctx.globalAlpha = alpha; ctx.fillStyle = TH.surface; ctx.beginPath(); ctx.arc(X, Y, 5.5, 0, 7); ctx.fill();
      ctx.fillStyle = TH.bike; ctx.beginPath(); ctx.arc(X, Y, 3.6, 0, 7); ctx.fill();
    });
  }
  function drawLabels(now) {
    ctx.setTransform(K, 0, 0, K, 0, 0); ctx.textBaseline = 'middle';
    const iso = overlay.iso && cur.iso > .01 ? overlay.iso : null, isoT = iso ? iso.clock() : 0;
    PLACES.forEach((p, k) => {
      const tgt = labelSet.has(p.zh) || labelSet.has('*' + p.g) || labelSet.has('*') ? 1 : 0;
      labelA[k] += (tgt - labelA[k]) * .09;
      const a = labelA[k] * cur.labels; if (a < .02) return;
      const lifted = cur.lift > .05 && p.h != null;
      const [X0, Y0] = W2S(p.p[0], p.p[1]), [X, Y] = W2S(p.p[0], p.p[1], lifted ? p.h : 0);
      const reached = iso ? iso.placeAlpha(k, isoT) : 1;
      ctx.globalAlpha = a * reached;
      if (lifted) {         // pin from the ground to the building's height
        ctx.strokeStyle = TH.ink2; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(X0, Y0); ctx.lineTo(X, Y); ctx.stroke();
        ctx.fillStyle = TH.ink2; ctx.beginPath(); ctx.arc(X0, Y0, 2, 0, 7); ctx.fill();
      }
      const big = p.g === 'dorm' || p.g === 'teach';
      ctx.fillStyle = TH.surface; ctx.beginPath(); ctx.arc(X, Y, big ? 7.5 : 5.5, 0, 7); ctx.fill();
      if (p.g === 'dorm') { ctx.strokeStyle = TH.ink; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.arc(X, Y, 4.6, 0, 7); ctx.stroke(); }
      else { ctx.fillStyle = big ? TH.ink : TH.ink2; ctx.beginPath(); ctx.arc(X, Y, big ? 5 : 3.4, 0, 7); ctx.fill(); }
      const left = (labelOpts.left || []).includes(p.zh), txt = p.en;
      ctx.font = `${big ? 650 : 560} ${big ? 15 : 13}px ${FONT}`; ctx.textAlign = left ? 'right' : 'left';
      const tx = X + (left ? -13 : 13);
      ctx.lineWidth = 4.5; ctx.strokeStyle = TH.halo; ctx.lineJoin = 'round'; ctx.strokeText(txt, tx, Y);
      ctx.fillStyle = big ? TH.ink : TH.ink2; ctx.fillText(txt, tx, Y);
      if (labelOpts.height && p.h != null) {
        ctx.font = `600 12.5px ${FONT}`; const ht = Math.round(p.h) + ' m';
        ctx.strokeText(ht, tx, Y + 16); ctx.fillStyle = TH.muted; ctx.fillText(ht, tx, Y + 16);
      }
    });
    ctx.globalAlpha = 1;
  }

  let last = performance.now(), paused = false;
  function frame(now) {
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if (!paused) render(now, dt);
    requestAnimationFrame(frame);
  }
  function render(now, dt) {
    const t = clamp((now - t0) / dur, 0, 1), e = easeIO(t);
    for (const k of KEYS) cur[k] = lerp(from[k], to[k], e);
    const tt = now / 1000, dr = cur.drift;
    const cam = { ...cur, rot: cur.rot + dr * Math.sin(tt / 15) * 3, cx: cur.cx + dr * Math.sin(tt / 12) * 26, cy: cur.cy + dr * Math.cos(tt / 14) * 26 };
    camera(cam);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.clearRect(0, 0, cv.width, cv.height);
    const R = rasters[themeName()];
    const lifted = cur.lift > .05;
    if (R && cur.terrain > .01) {
      ctx.setTransform(K * M[0], K * M[1], K * M[2], K * M[3], K * M[4], K * M[5]); ctx.globalAlpha = cur.terrain; ctx.imageSmoothingEnabled = true;
      ctx.drawImage(R.flat, TER.x0 - TER.step / 2, TER.y0 - TER.step / 2, TER.nx * TER.step, TER.ny * TER.step);
    }
    if (cur.terrace > .01) drawTerraces(cur.terrace);
    const dev = [K * M[0], K * M[1], K * M[2], K * M[3], K * M[4], K * M[5]];
    if (!lifted) {
      if (cur.water > .01) { ctx.setTransform(...dev); ctx.globalAlpha = cur.water; ctx.fillStyle = TH.water; ctx.fill(base.water); ctx.fillStyle = TH.green; ctx.globalAlpha = cur.water * .9; ctx.fill(base.green); }
      if (TER && cur.contour > .01) { strokeWorld(TER.minor, TH.contour, .8, cur.contour); strokeWorld(TER.major, TH.contourMajor, 1.3, cur.contour); }
      if (cur.trunk > .01) strokeWorld(base.trunk, TH.trunk, 5, cur.trunk);
      if (cur.bld > .01) { ctx.setTransform(...dev); ctx.globalAlpha = cur.bld; ctx.fillStyle = TH.bld; ctx.fill(base.bld); strokeWorld(base.bld, TH.bldEdge, .8, cur.bld); }
      if (cur.net > .01) {
        ctx.lineCap = ctx.lineJoin = 'round';
        strokeWorld(net.foot, TH.net.foot, 1, cur.net); strokeWorld(net.bridge, TH.net.bridge, 1.3, cur.net); strokeWorld(net.steps, TH.net.steps, 1.3, cur.net);
        strokeWorld(net.minor, TH.net.minor, 1.5, cur.net); strokeWorld(net.major, TH.net.major, 2.2, cur.net);
      }
    } else {
      if (TER && cur.contour > .01) { /* contours are implied by the terraces */ }
      liftedBld(cur.bld); liftedNet(cur.net);
    }
    if (cur.cover > .01) {
      const Rr = clamp((now - coverT0) / 2600, 0, 1) * RMAX * 1.05;
      ctx.lineCap = ctx.lineJoin = 'round';
      for (const [k, w] of [['bike', 5], ['walk', 2.6]]) cover[k].forEach((P, i) => {
        const a = clamp((Rr - i * RMAX / NB) / (RMAX / NB), 0, 1); strokeWorld(P, TH[k], w, cur.cover * a);
      });
    }
    drawSteps(cur.steps, now);
    drawIso(cur.iso);
    drawRace(cur.race);
    stepParticles(dt); drawParticles(cur.flow);
    if (cur.labels > .01) drawLabels(now);

    // radial reveal (first slide / finale)
    const rv = reveal < 1 ? (reveal = clamp((now - revealT0) / 2600, 0, 1)) : 1;
    if (rv < 1) {
      ctx.setTransform(K, 0, 0, K, 0, 0); ctx.globalCompositeOperation = 'destination-in'; ctx.globalAlpha = 1;
      const [X, Y] = W2S(CX, CY), Rr = 30 + easeOut(rv) * 1500;
      const g = ctx.createRadialGradient(X, Y, Math.max(0, Rr - 300), X, Y, Rr); g.addColorStop(0, '#000'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 1600, 900); ctx.globalCompositeOperation = 'source-over';
    }
  }
  requestAnimationFrame(frame);
  return { set, setTheme, resize, overlay, W2S, cur: () => cur, pointAt, pause: v => { paused = v; } };
})();

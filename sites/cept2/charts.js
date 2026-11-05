'use strict';
/* Facts, charts and slide widgets. Every number shown on a slide is computed here from the data,
   so rebuilding with new tracks keeps text and charts consistent. */
const NS = 'http://www.w3.org/2000/svg';
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
function S(tag, attrs = {}, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
function T(parent, x, y, text, cls, attrs = {}) { const t = S('text', { x, y, class: cls, ...attrs }, parent); t.textContent = text; return t; }
const scale = (d0, d1, r0, r1) => v => r0 + (v - d0) / (d1 - d0) * (r1 - r0);
const median = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const fx = (v, d = 1) => v.toFixed(d);
const cssv = name => `var(--${name})`;
let STAGE_SCALE = 1;

const DORMS = ['斋区', '乔区', '南区', '海山楼一带'], TEACH = ['汇文楼', '科技楼', '致真楼', '致理楼', '致信楼', '计软楼'];
const SOUTH_CLUSTER = ['致理楼', '致真楼', '致信楼', '计软楼'];
const EN = zh => PL[zh].en;

/* ------------------------------------------------------------------ data views */
const PAIRS = DATA.pairs.map(([o, d, wt, wm, bt, bm, wup, bup, btp]) => ({ o: PLACES[o].zh, d: PLACES[d].zh, wt, wm, bt, bm, wup, bup, btp }));
const pair = (o, d) => PAIRS.find(p => p.o === o && p.d === d);
const teachOff = mode => DATA.teach.filter(r => r.mode === mode && r.per === 'off').map(r => ({ ...r, A: PLACES[r.a].zh, B: PLACES[r.b].zh }));
function linfit(xs, ys) {
  const n = xs.length, mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0; xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; });
  const b = sxy / sxx; return { a: my - b * mx, b };
}
const BREAKS = [5, 10, 20], IN_OUT = 1;

const F = (() => {
  const t = DATA.tracks, M = DATA.models, f = {};
  f.nTracks = t.n; f.nWalk = t.count.walk; f.nRun = t.count.run; f.nBike = t.count.bike; f.nFoot = t.count.walk + t.count.run;
  f.kmTotal = +(t.km.walk + t.km.run + t.km.bike).toFixed(1); f.kmFoot = fx(t.km.walk + t.km.run); f.kmBike = fx(t.km.bike);
  f.points = t.points.toLocaleString('en-US'); f.matchMin = Math.round(t.matched[0] * 100); f.commutes = t.commute;
  f.hHuiwen = Math.round(PL['汇文楼'].h);
  const hs = ['致理楼', '致真楼', '致信楼'].map(z => PL[z].h).filter(v => v != null);
  f.hSouth = `${Math.round(Math.min(...hs))}–${Math.round(Math.max(...hs))}`;
  f.nPairs = PAIRS.length;
  f.speedup = +median(PAIRS.map(p => p.wt / p.bt)).toFixed(1);
  f.fitWalk = linfit(PAIRS.map(p => p.wm), PAIRS.map(p => p.wt));
  f.fitBike = linfit(PAIRS.map(p => p.bm), PAIRS.map(p => p.bt));
  f.fitSaved = linfit(PAIRS.map(p => p.wm), PAIRS.map(p => p.wt - p.bt));
  f.per100 = fx(f.fitSaved.b * 100);
  f.breakEven = Math.round((2 - f.fitSaved.a) / f.fitSaved.b / 10) * 10;
  f.walkKmh = fx(M.walk.base_mps * 3.6);
  f.bikeKmh = Math.round(median(PAIRS.map(p => p.bm / 1000 / (p.bt / 60))));
  const race = pair('南区', '汇文楼');
  f.raceWalk = fx(race.wt); f.raceBike = fx(race.bt); f.raceUpW = Math.round(race.wup); f.raceUpB = Math.round(race.bup); f.raceSpeed = 80;
  f.raceSpare = fx(race.wt - race.bt);
  // between classes: slower direction of each teaching-building pair, +1 min in/out
  const worst = mode => teachOff(mode).map(r => ({ A: r.A, B: r.B, t: Math.max(r.ab, r.ba) }));
  f.breaks = { walk: BREAKS.map(b => worst('walk').filter(r => r.t + IN_OUT <= b).length), bike: BREAKS.map(b => worst('bike').filter(r => r.t + IN_OUT <= b).length) };
  f.nTeachPairs = worst('walk').length;
  const hw = m => worst(m).filter(r => (r.A === '汇文楼' && SOUTH_CLUSTER.includes(r.B)) || (r.B === '汇文楼' && SOUTH_CLUSTER.includes(r.A))).map(r => r.t);
  f.hwSouthWalk = `${Math.round(Math.min(...hw('walk')))}–${Math.round(Math.max(...hw('walk')))}`;
  f.hwSouthBike = `${Math.round(Math.min(...hw('bike')))}–${Math.round(Math.max(...hw('bike')))}`;
  // hills: asymmetry of hill-crossing pairs (≥ 15 m more climbing one way)
  const asym = teachOff('bike').filter(r => Math.abs(r.up_ab - r.up_ba) >= 15).map(r => Math.abs(r.ba - r.ab) / Math.min(r.ab, r.ba) * 100);
  f.asymRange = `${Math.round(Math.min(...asym))}–${Math.round(Math.max(...asym))}`;
  f.asymMin = teachOff('bike').filter(r => Math.abs(r.up_ab - r.up_ba) >= 15).map(r => Math.abs(r.ba - r.ab));
  f.asymWalk = fx(Math.max(...teachOff('walk').map(r => Math.abs(r.ba - r.ab) / Math.min(r.ab, r.ba) * 100)), 0);
  const curveAt = (m, g) => M[m].curve.reduce((b, p) => Math.abs(p.grade - g) < Math.abs(b.grade - g) ? p : b).learned;
  f.slope = { bikeUp: curveAt('bike', .05), bikeDown: curveAt('bike', -.05), walkUp: curveAt('walk', .05), walkDown: curveAt('walk', -.05) };
  f.stepsBike = fx(1 / M.bike.classes.steps_up); f.stepsWalk = fx(1 / M.walk.classes.steps_up);
  f.peakBike = +(1 / M.bike.peak.ped).toFixed(2); f.peakWalk = +(1 / M.walk.peak.ped).toFixed(2);
  f.nPeakBike = M.bike.n_peak.ped; f.nPeakWalk = M.walk.n_peak.ped;
  const err = (mode, k) => DATA.validation.filter(v => v.mode === mode).map(v => Math.abs(v[k]) * 100);
  f.err = { walk: median(err('walk', 'full')), bike: median(err('bike', 'full')), bikeCal: median(err('bike', 'cal')) };
  const zz = teachOff('walk').find(r => (r.A === '致理楼' && r.B === '致真楼') || (r.A === '致真楼' && r.B === '致理楼'));
  f.zlzzWalk = fx(Math.max(zz.ab, zz.ba));
  const hz = m => { const r = teachOff(m).find(q => q.A === '汇文楼' && q.B === '致理楼'); return r.ab; };
  f.hwzlWalk = fx(hz('walk')); f.hwzlBike = fx(hz('bike'));
  f.nSteps = DATA.meta.steps;
  f.generated = DATA.meta.generated.split(' ')[0];
  return f;
})();

/* fill [data-k] / [data-count] placeholders before headings are split into words */
function fillFacts() {
  $$('[data-k]').forEach(el => { const v = F[el.dataset.k]; if (v != null) el.textContent = v; });
  $$('[data-count]').forEach(el => { const k = el.dataset.count; if (F[k] != null) el.dataset.to = F[k]; });
}

/* ------------------------------------------------------------------ tooltip */
const tip = $('#tip'), stage = $('#stage');
function showTip(ev, title, rows) {
  tip.replaceChildren();
  const t = document.createElement('div'); t.className = 't'; t.textContent = title; tip.appendChild(t);
  for (const [color, val, label] of rows) {
    const r = document.createElement('div'); r.className = 'r';
    const i = document.createElement('i'); i.style.background = color || 'transparent'; r.appendChild(i);
    const b = document.createElement('b'); b.textContent = val; r.appendChild(b);
    const s = document.createElement('span'); s.textContent = label; r.appendChild(s);
    tip.appendChild(r);
  }
  const rc = stage.getBoundingClientRect(), x = (ev.clientX - rc.left) / STAGE_SCALE, y = (ev.clientY - rc.top) / STAGE_SCALE;
  tip.classList.add('on');
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = clamp(x + 16, 10, 1590 - w) + 'px'; tip.style.top = clamp(y - h - 14, 10, 890 - h) + 'px';
}
const hideTip = () => tip.classList.remove('on');
function hoverable(node, title, rows, mark) {
  const on = ev => { showTip(ev, typeof title === 'function' ? title() : title, typeof rows === 'function' ? rows() : rows); if (mark) mark.classList.add('on'); };
  node.addEventListener('pointermove', on);
  node.addEventListener('pointerleave', () => { hideTip(); if (mark) mark.classList.remove('on'); });
}
const barPath = (x, y, w, h, r = 4) => { r = Math.max(0, Math.min(r, w, h / 2)); return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`; };

/* ------------------------------------------------------------------ 4 · elevation bars */
function chartElev() {
  const rows = ['汇文楼', '科技楼', '斋区', '乔区', '海山楼一带', '致信楼', '致理楼', '南区'].map(z => [EN(z), PL[z].h, PL[z].g]);
  const W = 494, rh = 31, H = rows.length * rh + 6, svg = S('svg', { width: W, height: H }, $('#ch-elev'));
  const x = scale(0, 36, 132, W - 54);
  rows.forEach(([n, h, g], i) => {
    const y = i * rh + 3, mk = S('g', { class: 'mk' }, svg);
    T(svg, 120, y + 16, n, 't-2', { 'text-anchor': 'end', style: 'font-size:15px' });
    S('path', { d: barPath(x(0), y + 4, x(h) - x(0), 18), class: 'grow', style: `fill:${g === 'dorm' ? 'var(--ink-2)' : 'var(--ink)'}; opacity:${g === 'dorm' ? .45 : .82}; --d:${500 + i * 80}` }, mk);
    T(svg, x(h) + 8, y + 18, Math.round(h) + ' m', 't-ink', { class: 't-ink fade', style: `--d:${900 + i * 80}` });
    const hit = S('rect', { x: 0, y, width: W, height: rh, class: 'hit' }, svg);
    hoverable(hit, n, [[g === 'dorm' ? 'var(--ink-2)' : 'var(--ink)', Math.round(h) + ' m', g === 'dorm' ? 'dorm, above the lowest point' : 'teaching building']], mk);
  });
  S('line', { x1: x(0), x2: x(0), y1: 0, y2: H, style: 'stroke:var(--axis)' }, svg);
  const lg = document.createElement('div'); lg.className = 'legend'; lg.style.marginTop = '8px'; lg.style.fontSize = '13.5px';
  lg.innerHTML = '<span><i class="key k-ink" style="opacity:.82;height:8px;width:14px"></i>teaching building</span><span><i class="key k-ink" style="opacity:.45;height:8px;width:14px"></i>dorm</span>';
  $('#ch-elev').appendChild(lg);
}

/* ------------------------------------------------------------------ 5 · speed scatter */
function chartSpeed() {
  const W = 990, H = 540, m = { l: 58, r: 150, t: 14, b: 46 };
  const svg = S('svg', { width: W, height: H }, $('#ch-speed'));
  const x = scale(0, 1800, m.l, W - m.r), y = scale(0, 26, H - m.b, m.t), ax = S('g', { class: 'ax' }, svg);
  for (let v = 0; v <= 25; v += 5) { S('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: v === 0 ? 'base' : '' }, ax); T(ax, m.l - 12, y(v) + 4, v, '', { 'text-anchor': 'end' }); }
  for (let v = 0; v <= 1800; v += 300) T(ax, x(v), H - m.b + 22, v === 0 ? '0' : (v / 1000).toFixed(1) + (v === 1800 ? ' km' : ''), '', { 'text-anchor': 'middle' });
  T(svg, m.l, m.t - 2, 'minutes', 't-m', { dy: '-.2em', style: 'font-size:12.5px' });
  T(svg, (m.l + W - m.r) / 2, H - 4, 'route length', 't-m', { 'text-anchor': 'middle' });
  const gDots = S('g', {}, svg), pts = [];
  PAIRS.forEach((p, i) => {
    for (const [mode, d, t] of [['walk', p.wm, p.wt], ['bike', p.bm, p.bt]]) {
      const c = S('circle', { cx: x(d), cy: y(t), r: 3.6, class: `pop f-${mode} s-bg`, 'stroke-width': 1, 'fill-opacity': .72, style: `--d:${250 + Math.round(d / 1800 * 900) + (mode === 'walk' ? 120 : 0)}` }, gDots);
      pts.push({ X: x(d), Y: y(t), p, mode, c });
    }
  });
  // fits
  const lines = [['walk', F.fitWalk, 1650], ['bike', F.fitBike, 1800]];
  lines.forEach(([mode, fit, xmax], k) => {
    const x0 = 30, d = `M${x(x0)},${y(fit.a + fit.b * x0)}L${x(xmax)},${y(fit.a + fit.b * xmax)}`;
    S('path', { d, class: `draw s-${mode}`, fill: 'none', 'stroke-width': 2.5, 'stroke-linecap': 'round', pathLength: 1, style: `--d:${1300 + k * 200}` }, svg);
    const ex = x(xmax), ey = y(fit.a + fit.b * xmax);
    const g = S('g', { class: 'fade', style: `--d:${1900 + k * 200}` }, svg);
    T(g, ex + 10, ey - 6, mode === 'walk' ? 'Walk' : 'Ride', 't-ink', { style: 'font-size:15px' });
    T(g, ex + 10, ey + 12, `≈ ${fx(fit.b * 1000, 1)} min per km`, 't-2', { style: 'font-size:13px' });
  });
  // gap annotation at 1 km
  const xa = 1000, yw = F.fitWalk.a + F.fitWalk.b * xa, yb = F.fitBike.a + F.fitBike.b * xa;
  const ga = S('g', { class: 'fade', style: '--d:2300' }, svg);
  S('line', { x1: x(xa), x2: x(xa), y1: y(yw) + 6, y2: y(yb) - 6, class: 's-ink', 'stroke-width': 1.5, 'marker-end': '' }, ga);
  S('path', { d: `M${x(xa) - 5},${y(yw) + 12}l5,-6l5,6M${x(xa) - 5},${y(yb) - 12}l5,6l5,-6`, fill: 'none', class: 's-ink', 'stroke-width': 1.5 }, ga);
  const lbl = S('g', {}, ga);
  S('rect', { x: x(xa) + 10, y: y((yw + yb) / 2) - 26, width: 150, height: 44, rx: 8, style: 'fill:var(--card-solid); stroke:var(--hair-2)' }, lbl);
  T(lbl, x(xa) + 22, y((yw + yb) / 2) - 6, `−${fx(yw - yb, 1)} min`, 't-ink', { style: 'font-size:17px' });
  T(lbl, x(xa) + 22, y((yw + yb) / 2) + 11, 'by bike, at 1 km', 't-m');
  // nearest-point hover
  const hl = S('g', { style: 'pointer-events:none' }, svg);
  const hit = S('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, class: 'hit' }, svg);
  hit.addEventListener('pointermove', ev => {
    const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) / STAGE_SCALE, py = (ev.clientY - r.top) / STAGE_SCALE;
    let best = null, bd = 1e9; for (const q of pts) { const d = (q.X - px) ** 2 + (q.Y - py) ** 2; if (d < bd) { bd = d; best = q; } }
    hl.replaceChildren(); if (!best || bd > 900) { hideTip(); return; }
    const p = best.p, a = [x(p.wm), y(p.wt)], b = [x(p.bm), y(p.bt)];
    S('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: 's-2', 'stroke-width': 1.2, 'stroke-dasharray': '3 3' }, hl);
    S('circle', { cx: a[0], cy: a[1], r: 6, class: 'f-walk s-bg', 'stroke-width': 2 }, hl);
    S('circle', { cx: b[0], cy: b[1], r: 6, class: 'f-bike s-bg', 'stroke-width': 2 }, hl);
    showTip(ev, `${EN(p.o)} → ${EN(p.d)}`, [[cssv('walk'), fx(p.wt) + ' min', `walk · ${p.wm} m`], [cssv('bike'), fx(p.bt) + ' min', `ride · ${p.bm} m`], [null, fx(p.wt / p.bt) + '×', 'faster by bike']]);
  });
  hit.addEventListener('pointerleave', () => { hl.replaceChildren(); hideTip(); });
}

/* ------------------------------------------------------------------ 6 · race */
function buildRace() {
  const race = pair('南区', '汇文楼'), SPEED = F.raceSpeed;
  const defs = [['bike', 'b', race.bt], ['walk', 'w', race.wt]];
  const routes = defs.map(([mode, key, mins]) => {
    const r = routeBetween(key, '南区', '汇文楼'), T = mins * 60;
    const off = mode === 'bike' ? 5 : -5, xs = [], ys = [], n = r.xs.length;
    for (let i = 0; i < n; i++) {   // small sideways offset so the two lines don't hide each other
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1), dx = r.xs[b] - r.xs[a], dy = r.ys[b] - r.ys[a], L = Math.hypot(dx, dy) || 1;
      xs.push(r.xs[i] + dy / L * off); ys.push(r.ys[i] - dx / L * off);
    }
    const path = new Path2D(); xs.forEach((v, i) => i ? path.lineTo(v, ys[i]) : path.moveTo(v, ys[i]));
    const tf = r.tc.map(c => c / r.total);
    const locate = f => { let i = 1; while (i < tf.length - 1 && tf[i] < f) i++; const u = (f - tf[i - 1]) / ((tf[i] - tf[i - 1]) || 1); return [i, clamp(u, 0, 1)]; };
    const dist = [0]; for (let i = 1; i < n; i++) dist.push(dist[i - 1] + Math.hypot(r.xs[i] - r.xs[i - 1], r.ys[i] - r.ys[i - 1]));
    return {
      mode, T, mins, xs, ys, raw: r, path, dist, locate,
      at: f => { const [i, u] = locate(f); return [lerp(xs[i - 1], xs[i], u), lerp(ys[i - 1], ys[i], u)]; },
      partial: f => { const P = new Path2D(), [i, u] = locate(f); P.moveTo(xs[0], ys[0]); for (let k = 1; k < i; k++) P.lineTo(xs[k], ys[k]); P.lineTo(lerp(xs[i - 1], xs[i], u), lerp(ys[i - 1], ys[i], u)); return P; },
      distAt: f => { const [i, u] = locate(f); return lerp(dist[i - 1], dist[i], u); },
    };
  });
  let start = performance.now() + 1e9;
  const R = { routes, speed: SPEED, clock: () => Math.max(0, (performance.now() - start) / 1000 * SPEED) };
  MAP.overlay.race = R;

  // elevation profiles
  const W = 544, H = 150, m = { l: 34, r: 10, t: 10, b: 26 }, svg = S('svg', { width: W, height: H }, $('#ch-profile'));
  const Lmax = Math.max(...routes.map(r => r.dist[r.dist.length - 1])), x = scale(0, Lmax, m.l, W - m.r), y = scale(0, 40, H - m.b, m.t);
  const ax = S('g', { class: 'ax' }, svg);
  [0, 20, 40].forEach(v => { S('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: v === 0 ? 'base' : '' }, ax); T(ax, m.l - 8, y(v) + 4, v, '', { 'text-anchor': 'end' }); });
  for (let k = 0; k <= Lmax / 1000 + .01; k += .4) T(ax, x(k * 1000), H - 8, k.toFixed(1), '', { 'text-anchor': 'middle' });
  const prof = routes.map(r => {
    const pts = [], L = r.dist[r.dist.length - 1];
    for (let s = 0; s <= L; s += 10) {
      let i = 1; while (i < r.dist.length - 1 && r.dist[i] < s) i++;
      const u = (s - r.dist[i - 1]) / ((r.dist[i] - r.dist[i - 1]) || 1);
      pts.push([s, TER ? TER.near(lerp(r.raw.xs[i - 1], r.raw.xs[i], u), lerp(r.raw.ys[i - 1], r.raw.ys[i], u)) : 0]);
    }
    for (let i = 0; i < pts.length; i++) if (pts[i][1] == null) pts[i][1] = i ? pts[i - 1][1] : 5;
    // light smoothing (terrain grid is 10 m)
    const sm = pts.map((p, i) => [p[0], (pts[Math.max(0, i - 1)][1] + p[1] * 2 + pts[Math.min(pts.length - 1, i + 1)][1]) / 4]);
    return { L, pts: sm };
  });
  prof.forEach((P, k) => {
    const d = P.pts.map(([s, h], i) => (i ? 'L' : 'M') + x(s).toFixed(1) + ',' + y(h).toFixed(1)).join('');
    S('path', { d, fill: 'none', class: `s-${routes[k].mode}`, 'stroke-width': 2, 'stroke-linejoin': 'round', opacity: .9 }, svg);
  });
  T(svg, x(0) + 4, y(prof[0].pts[0][1]) - 10, 'South Dorms', 't-m');
  T(svg, W - m.r - 2, y(prof[0].pts[prof[0].pts.length - 1][1]) - 12, 'Huiwen', 't-m', { 'text-anchor': 'end' });
  const mk = routes.map(r => S('circle', { r: 6, class: `f-${r.mode} s-bg`, 'stroke-width': 2.5 }, svg));

  const els = { bike: $('#r-bike'), walk: $('#r-walk') };
  let raf = 0;
  function tick() {
    const tm = R.clock();
    routes.forEach((r, k) => {
      const f = clamp(tm / r.T, 0, 1), el = els[r.mode];
      el.querySelector('.tm span').textContent = fx(Math.min(tm, r.T) / 60);
      el.classList.toggle('done', f >= 1);
      const s = r.distAt(f), P = prof[k], i = clamp(Math.round(s / 10), 0, P.pts.length - 1);
      mk[k].setAttribute('cx', x(s)); mk[k].setAttribute('cy', y(P.pts[i][1]));
    });
    raf = requestAnimationFrame(tick);
  }
  els.bike.querySelector('.flag').textContent = `first · ${F.raceSpare} min to spare`;
  els.walk.querySelector('.flag').textContent = `arrived · ${fx(race.wt / race.bt)}× longer`;
  return {
    start(delay = 1600) { start = performance.now() + delay; cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); },
    stop() { cancelAnimationFrame(raf); },
    table: () => ({ title: 'South Dorms → Huiwen (model, off-peak)', cols: ['Mode', 'Minutes', 'Route m', 'Climb m'],
      rows: [['Ride', fx(race.bt, 2), race.bm, Math.round(race.bup)], ['Walk', fx(race.wt, 2), race.wm, Math.round(race.wup)], ['Shuttle', 'no data', '—', '—']] }),
  };
}

/* ------------------------------------------------------------------ 7 · departure board */
const FLAP_CHARS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-↑';
function buildBoard() {
  const host = $('#board-host'), board = document.createElement('div'); board.className = 'board'; host.appendChild(board);
  const mkFlaps = (n, cls = '') => {
    const w = document.createElement('div'); w.className = 'flaps';
    const cells = [];
    for (let i = 0; i < n; i++) {
      const c = document.createElement('span'); c.className = 'fl ' + cls;
      for (const [tag, k] of [['b', 't'], ['b', 'b'], ['i', 'lt'], ['i', 'lb']]) { const e = document.createElement(tag); e.className = k; const s = document.createElement('span'); s.textContent = ' '; e.appendChild(s); c.appendChild(e); }
      c._ch = ' '; cells.push(c); w.appendChild(c);
    }
    w._cells = cells; return w;
  };
  const setCh = (c, ch) => { c.children[0].firstChild.textContent = ch; c.children[1].firstChild.textContent = ch; c.children[2].firstChild.textContent = ch; c.children[3].firstChild.textContent = ch; c._ch = ch; };
  const timers = new Set();
  function flipTo(c, target, delay, steps) {
    const seq = []; for (let i = 0; i < steps; i++) seq.push(FLAP_CHARS[1 + ((Math.random() * (FLAP_CHARS.length - 1)) | 0)]); seq.push(target);
    if (c._ch === target && steps === 0) return;
    let k = 0;
    const one = () => {
      const old = c._ch, nw = seq[k++];
      c.children[0].firstChild.textContent = nw; c.children[1].firstChild.textContent = old;
      c.children[2].firstChild.textContent = old; c.children[3].firstChild.textContent = nw;
      c.classList.remove('go'); void c.offsetWidth; c.classList.add('go');
      const t = setTimeout(() => { timers.delete(t); c.children[1].firstChild.textContent = nw; c.children[2].firstChild.textContent = nw; c._ch = nw; c.classList.remove('go');
        if (k < seq.length) { const t2 = setTimeout(one, 12); timers.add(t2); } }, 150);
      timers.add(t);
    };
    const t0 = setTimeout(one, delay); timers.add(t0);
  }
  const write = (flaps, text, delay, instant) => {
    const s = text.toUpperCase().padEnd(flaps._cells.length).slice(0, flaps._cells.length);
    flaps._cells.forEach((c, i) => instant ? setCh(c, s[i]) : flipTo(c, s[i], delay + i * 28, s[i] === c._ch ? 0 : 2 + ((Math.random() * 4) | 0)));
  };
  // header
  const bh = document.createElement('div'); bh.className = 'bh';
  const ttl = document.createElement('div'); ttl.className = 'ttl';
  const lamp = document.createElement('i'); lamp.className = 'lamp'; ttl.appendChild(lamp);
  const lab = document.createElement('span'); lab.textContent = 'Departures from'; ttl.appendChild(lab);
  const dormF = mkFlaps(13, 'c-amber'); ttl.appendChild(dormF); bh.appendChild(ttl);
  const tabs = document.createElement('div'); tabs.className = 'tabs'; bh.appendChild(tabs); board.appendChild(bh);
  // column header
  const hd = document.createElement('div'); hd.className = 'row hd';
  [['To', null], ['Walk', 'walk'], ['Ride', 'bike'], ['Shuttle', 'bus'], ['Advice', null], ['Walk vs ride', null]].forEach(([t, m]) => {
    const s = document.createElement('span'); if (m) { const d = document.createElement('i'); d.className = 'dot k-' + m; d.style.margin = '0'; s.appendChild(d); }
    s.appendChild(document.createTextNode(t)); hd.appendChild(s);
  });
  board.appendChild(hd);
  const rows = TEACH.map(() => {
    const r = document.createElement('div'); r.className = 'row';
    const cols = { to: mkFlaps(10), walk: mkFlaps(4, 'c-walk'), bike: mkFlaps(4, 'c-bike'), bus: mkFlaps(7, 'c-amber'), adv: mkFlaps(6) };
    Object.values(cols).forEach(c => r.appendChild(c));
    const bars = document.createElement('div'); bars.style.cssText = 'display:grid; gap:5px;';
    const bw = document.createElement('i'), bb = document.createElement('i');
    bw.style.cssText = 'display:block;height:7px;border-radius:0 4px 4px 0;background:#8ab8f2;width:0;transition:width .9s var(--ease)';
    bb.style.cssText = 'display:block;height:7px;border-radius:0 4px 4px 0;background:#f6a17c;width:0;transition:width .9s var(--ease) .1s';
    bars.appendChild(bw); bars.appendChild(bb); r.appendChild(bars);
    board.appendChild(r);
    return { r, cols, bw, bb };
  });
  let dorm = 0, auto = true, timer = 0;
  const btns = DORMS.map((z, i) => {
    const b = document.createElement('button'); b.className = 'tab'; b.textContent = EN(z);
    b.onclick = () => { auto = false; show(i); b.blur(); }; tabs.appendChild(b); return b;
  });
  function show(i, instant = false) {
    dorm = i; btns.forEach((b, k) => b.classList.toggle('on', k === i));
    write(dormF, EN(DORMS[i]), 0, instant);
    TEACH.forEach((d, k) => {
      const p = pair(DORMS[i], d), R = rows[k], saved = p.wt - p.bt, adv = saved < 4 ? 'WALK' : p.bup >= 15 ? 'RIDE ↑' : 'RIDE';
      const dl = 120 + k * 90;
      write(R.cols.to, EN(d), dl, instant);
      write(R.cols.walk, fx(p.wt).padStart(4), dl + 160, instant);
      write(R.cols.bike, fx(p.bt).padStart(4), dl + 220, instant);
      write(R.cols.bus, 'NO DATA', dl + 280, instant);
      write(R.cols.adv, adv, dl + 360, instant);
      R.cols.adv._cells.forEach(c => { c.classList.toggle('c-walk', adv === 'WALK'); c.classList.toggle('c-bike', adv !== 'WALK'); });
      R.bw.style.width = (p.wt / 21 * 100).toFixed(1) + '%'; R.bb.style.width = (p.bt / 21 * 100).toFixed(1) + '%';
      R.r.onpointermove = ev => showTip(ev, `${EN(DORMS[i])} → ${EN(d)}`, [[cssv('walk'), fx(p.wt) + ' min', `walk · ${p.wm} m · climbs ${Math.round(p.wup)} m`],
        [cssv('bike'), fx(p.bt) + ' min', `ride · ${p.bm} m · climbs ${Math.round(p.bup)} m`], [null, fx(saved) + ' min', 'saved by riding']]);
      R.r.onpointerleave = hideTip;
    });
  }
  return {
    start() { clearInterval(timer); auto = true; show(0); timer = setInterval(() => { if (auto) show((dorm + 1) % DORMS.length); }, 7000); },
    stop() { clearInterval(timer); timers.forEach(t => clearTimeout(t)); timers.clear(); },
    reset() { show(0, true); },
    table: () => ({ title: 'Dorm → teaching building, off-peak (minutes)', cols: ['From', 'To', 'Walk', 'Ride', 'Climb (ride) m'],
      rows: DORMS.flatMap(o => TEACH.map(d => { const p = pair(o, d); return [EN(o), EN(d), fx(p.wt), fx(p.bt), Math.round(p.bup)]; })) }),
  };
}

/* ------------------------------------------------------------------ 8 · between classes */
function chartBreaks() {
  const walk = teachOff('walk'), bike = teachOff('bike');
  const rows = walk.map(r => {
    const b = bike.find(q => q.A === r.A && q.B === r.B);
    const wt = Math.max(r.ab, r.ba), bt = Math.max(b.ab, b.ba);
    const up = r.ab >= r.ba ? [r.A, r.B] : [r.B, r.A];
    return { A: r.A, B: r.B, wt, bt, from: up[0], to: up[1] };
  }).sort((a, b) => a.wt - b.wt);
  const W = 1000, rh = 26, m = { l: 210, r: 20, t: 42, b: 34 }, H = m.t + rows.length * rh + m.b;
  const svg = S('svg', { width: W, height: H }, $('#ch-breaks'));
  const x = scale(0, 26, m.l, W - m.r);
  // break bands (travel time + 1 min must fit)
  const bands = [[0, 4, '5-min break'], [4, 9, '10-min'], [9, 19, '20-min'], [19, 26, '✕ won’t make it']];
  bands.forEach(([a, b, name], i) => {
    S('rect', { x: x(a), y: m.t - 8, width: x(b) - x(a) - 2, height: H - m.t - m.b + 10, rx: 6, style: `fill:${i === 3 ? 'rgba(208,59,59,.07)' : 'var(--ink)'}; opacity:${i === 3 ? 1 : [.05, .035, .02][i]}` }, svg);
    T(svg, x(a) + 8, m.t - 16, name, i === 3 ? 't-ink' : 't-2', { style: `font-size:13px; ${i === 3 ? 'fill:var(--critical)' : ''}` });
  });
  const ax = S('g', { class: 'ax' }, svg);
  for (let v = 0; v <= 25; v += 5) T(ax, x(v), H - 10, v + (v === 25 ? ' min' : ''), '', { 'text-anchor': 'middle' });
  rows.forEach((r, i) => {
    const y = m.t + i * rh + rh / 2, d = 300 + i * 55, g = S('g', { class: 'mk' }, svg);
    T(svg, m.l - 14, y + 5, `${EN(r.A)} ⇄ ${EN(r.B)}`, 't-2', { 'text-anchor': 'end', style: 'font-size:14px' });
    S('line', { x1: x(r.bt), x2: x(r.wt), y1: y, y2: y, 'stroke-width': 2, class: 'fade', style: `stroke:var(--axis); --d:${d + 250}` }, g);
    S('circle', { cx: x(r.bt), cy: y, r: 6, class: 'pop f-bike s-bg', 'stroke-width': 2, style: `--d:${d}` }, g);
    S('circle', { cx: x(r.wt), cy: y, r: 6, class: 'pop f-walk s-bg', 'stroke-width': 2, style: `--d:${d + 120}` }, g);
    if (r.wt + IN_OUT > 20) T(svg, x(r.wt) + 12, y + 4.5, fx(r.wt) + ' min', 't-ink', { class: 't-ink fade', style: `--d:${d + 400}; font-size:13px` });
    const hit = S('rect', { x: 0, y: y - rh / 2, width: W, height: rh, class: 'hit' }, svg);
    hoverable(hit, `${EN(r.from)} → ${EN(r.to)} (slower way)`, [[cssv('walk'), fx(r.wt) + ' min', 'walk'], [cssv('bike'), fx(r.bt) + ' min', 'ride'],
      [null, `+${IN_OUT} min`, 'to leave and enter buildings']], g);
  });
  // summary table
  const tb = $('#breaks-table'), grid = document.createElement('div');
  grid.style.cssText = 'display:grid; grid-template-columns: 90px repeat(3, 1fr); gap:10px 12px; align-items:center;';
  const cell = (txt, css = '') => { const d = document.createElement('div'); d.style.cssText = css; d.textContent = txt; grid.appendChild(d); return d; };
  cell(''); BREAKS.forEach(b => cell(b + ' min', 'font-size:13px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted);'));
  [['walk', 'Walk'], ['bike', 'Ride']].forEach(([mode, name]) => {
    const h = cell('', 'display:flex; align-items:center; font-size:17px; font-weight:640;'); const dd = document.createElement('i'); dd.className = 'dot k-' + mode; h.appendChild(dd); h.appendChild(document.createTextNode(name));
    F.breaks[mode].forEach(n => {
      const c = cell('', 'display:grid; gap:6px;');
      const v = document.createElement('div'); v.style.cssText = 'font-size:30px; font-weight:700; letter-spacing:-.03em; line-height:1;';
      v.innerHTML = ''; v.appendChild(document.createTextNode(n)); const sm = document.createElement('span'); sm.style.cssText = 'font-size:14px; color:var(--muted); font-weight:500; margin-left:3px'; sm.textContent = '/ ' + F.nTeachPairs; v.appendChild(sm); c.appendChild(v);
      const track = document.createElement('div'); track.style.cssText = 'height:6px; border-radius:3px; background:var(--grid); overflow:hidden;';
      const fill = document.createElement('div'); fill.style.cssText = `height:100%; width:${n / F.nTeachPairs * 100}%; background:var(--${mode}); border-radius:3px;`; track.appendChild(fill); c.appendChild(track);
    });
  });
  tb.appendChild(grid);
  return { table: () => ({ title: 'Teaching-building pairs, slower direction, off-peak (minutes)', cols: ['Pair', 'Walk', 'Ride', 'Walk fits', 'Ride fits'],
    rows: rows.map(r => [`${EN(r.A)} ⇄ ${EN(r.B)}`, fx(r.wt), fx(r.bt), fitsTxt(r.wt), fitsTxt(r.bt)]) }) };
}
const fitsTxt = t => { const b = BREAKS.find(b => t + IN_OUT <= b); return b ? `${b}-min break` : 'none'; };

/* ------------------------------------------------------------------ 9 · reach */
function buildIso() {
  let origin = 1, t0 = performance.now() + 1e9;     // Qiao Dorms first: the starkest contrast
  const DUR = 9500, TMAX = 15 * 60, cache = {};
  const placeT = (o, mode) => PLACES.map(p => p.zh === DORMS[o] ? 0 : (pair(DORMS[o], p.zh)?.[mode === 'walk' ? 'wt' : 'bt'] ?? 99) * 60);
  function compute() {
    const z = DORMS[origin];
    if (!cache[z]) {
      const mk = key => dijkstra(key, snapNode(key, ...PL[z].p)).dist;
      cache[z] = { w: mk('w'), b: mk('b'), tw: placeT(origin, 'walk'), tb: placeT(origin, 'bike') };
    }
    const C = cache[z];
    const clock = () => clamp((performance.now() - t0) / DUR, 0, 1) * TMAX;
    MAP.overlay.iso = {
      origin: PL[z], clock,
      layers: [{ key: 'b', mode: 'bike', dist: C.b, limit: 10 * 60, width: 4.6, alpha: .85 }, { key: 'w', mode: 'walk', dist: C.w, limit: 15 * 60, width: 3, alpha: 1 }],
      placeAlpha: (k, T) => k === PL[z].i ? 1 : C.tw[k] <= T ? 1 : C.tb[k] <= T ? .72 : .3,
    };
    return C;
  }
  const rowsHost = $('#iso-rows'), clockEl = $('#iso-clock');
  const mkRow = (mode, name) => {
    const r = document.createElement('div'); r.style.cssText = 'display:grid; grid-template-columns: 120px 1fr 120px; gap:14px; align-items:center; padding:12px 0; border-bottom:1px solid var(--hair);';
    const n = document.createElement('div'); n.style.cssText = 'font-size:18px; font-weight:640; display:flex; align-items:center;'; const d = document.createElement('i'); d.className = 'dot k-' + mode; n.appendChild(d); n.appendChild(document.createTextNode(name));
    const tr = document.createElement('div'); tr.style.cssText = 'height:8px; border-radius:4px; background:var(--grid); overflow:hidden;';
    const fill = document.createElement('div'); fill.style.cssText = `height:100%; width:0; background:var(--${mode}); border-radius:4px;`; tr.appendChild(fill);
    const v = document.createElement('div'); v.style.cssText = 'text-align:right; font-size:30px; font-weight:700; letter-spacing:-.03em; font-variant-numeric:tabular-nums;';
    const vb = document.createElement('span'); vb.textContent = '0'; v.appendChild(vb); const vs = document.createElement('small'); vs.style.cssText = 'font-size:14px; color:var(--muted); font-weight:500; margin-left:4px;'; vs.textContent = '/ 19 places'; v.appendChild(vs);
    r.appendChild(n); r.appendChild(tr); r.appendChild(v); rowsHost.appendChild(r);
    return { fill, vb };
  };
  const RW = mkRow('walk', 'Walk'), RB = mkRow('bike', 'Ride');
  const cmp = document.createElement('div'); cmp.className = 'small'; cmp.style.cssText = 'margin-top:14px; font-size:15.5px; color:var(--ink-2);'; rowsHost.appendChild(cmp);
  const origBtns = $('#iso-origins');
  const btns = DORMS.map((z, i) => { const b = document.createElement('button'); b.className = 'btn'; b.textContent = EN(z); b.onclick = () => { origin = i; refresh(150); b.blur(); }; origBtns.appendChild(b); return b; });
  let raf = 0, C = null;
  function tick() {
    const T = clamp((performance.now() - t0) / DUR, 0, 1) * TMAX, nOther = PLACES.length - 1;
    const cw = C.tw.filter((t, k) => k !== PL[DORMS[origin]].i && t <= T).length, cb = C.tb.filter((t, k) => k !== PL[DORMS[origin]].i && t <= T).length;
    RW.vb.textContent = cw; RB.vb.textContent = cb; RW.fill.style.width = cw / nOther * 100 + '%'; RB.fill.style.width = cb / nOther * 100 + '%';
    const s = Math.round(T); clockEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    raf = requestAnimationFrame(tick);
  }
  function refresh(delay) {
    btns.forEach((b, i) => b.classList.toggle('on', i === origin));
    C = compute(); t0 = performance.now() + delay;
    const o = DORMS[origin], n = (mode, mins) => C[mode === 'walk' ? 'tw' : 'tb'].filter((t, k) => k !== PL[o].i && t <= mins * 60).length;
    cmp.replaceChildren();
    const add = (txt, b) => { const e = document.createElement(b ? 'b' : 'span'); e.textContent = txt; cmp.appendChild(e); };
    add('From ' + EN(o) + ': '); add(`${n('bike', 5)} places`, 1); add(' within 5 min by bike, '); add(`${n('walk', 15)}`, 1); add(' within 15 min on foot. In 10 minutes: '); add(`${n('bike', 10)} by bike`, 1); add(' vs '); add(`${n('walk', 10)} on foot`, 1); add('.');
    cancelAnimationFrame(raf); raf = requestAnimationFrame(tick);
  }
  return {
    start() { refresh(1500); }, stop() { cancelAnimationFrame(raf); }, replay() { refresh(150); },
    table: () => ({ title: 'Places reachable from each dorm (of 19), off-peak', cols: ['From', 'Walk 5', 'Walk 10', 'Walk 15', 'Ride 3', 'Ride 5', 'Ride 10'],
      rows: DORMS.map((z, i) => { const tw = placeT(i, 'walk'), tb = placeT(i, 'bike'), c = (arr, m) => arr.filter((t, k) => k !== PL[z].i && t <= m * 60).length;
        return [EN(z), c(tw, 5), c(tw, 10), c(tw, 15), c(tb, 3), c(tb, 5), c(tb, 10)]; }) }),
  };
}

/* ------------------------------------------------------------------ 10 · slope & road type */
function chartSlope() {
  const W = 720, H = 450, m = { l: 62, r: 96, t: 40, b: 50 }, svg = S('svg', { width: W, height: H }, $('#ch-slope'));
  const x = scale(-.08, .08, m.l, W - m.r), y = scale(.7, 1.5, H - m.b, m.t), ax = S('g', { class: 'ax' }, svg);
  T(svg, m.l, 16, 'Travel time vs. flat ground', 't-ink', { style: 'font-size:17px' });
  [.8, 1, 1.2, 1.4].forEach(v => { S('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: v === 1 ? 'base' : '' }, ax); T(ax, m.l - 10, y(v) + 4, '×' + v.toFixed(1), '', { 'text-anchor': 'end' }); });
  [-.08, -.04, 0, .04, .08].forEach(v => T(ax, x(v), H - m.b + 22, (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(Math.round(v * 100)) + '%', '', { 'text-anchor': 'middle' }));
  T(svg, (m.l + W - m.r) / 2, H - 6, 'downhill  ←  grade  →  uphill', 't-m', { 'text-anchor': 'middle' });
  const M = DATA.models;
  [['walk', 'Walk'], ['bike', 'Ride']].forEach(([mode, name], k) => {
    const pts = M[mode].curve.map(p => [p.grade, p.learned]);
    S('path', { d: pts.map(([g, v], i) => (i ? 'L' : 'M') + x(g).toFixed(1) + ',' + y(v).toFixed(1)).join(''), fill: 'none', class: `draw s-${mode}`, 'stroke-width': 2.5,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', pathLength: 1, style: `--d:${300 + k * 300}` }, svg);
    const [g, v] = pts[pts.length - 1];
    T(svg, x(g) + 10, y(v) + 5, name, 't-ink', { class: 't-ink fade', style: `--d:${1300 + k * 200}; font-size:15px` });
  });
  // labels sit on the side away from the curves: up-left of the rising bike line, below-right of its low end, under the walk line
  const ann = [['bike', .05, F.slope.bikeUp, -14, -22, 'end'], ['bike', -.05, F.slope.bikeDown, 14, 2, 'start'], ['walk', .05, F.slope.walkUp, 0, 30, 'middle']];
  ann.forEach(([mode, g, v, dx, dy, anchor], k) => {
    const a = S('g', { class: 'pop', style: `--d:${1500 + k * 180}` }, svg), pct = Math.round((v - 1) * 100);
    S('circle', { cx: x(g), cy: y(v), r: 5.5, class: `f-${mode} s-bg`, 'stroke-width': 2 }, a);
    const tx = x(g) + dx, ty = y(v) + dy;
    T(a, tx, ty, '×' + v.toFixed(2), 't-ink', { 'text-anchor': anchor, style: 'font-size:16px' });
    T(a, tx, ty + 16, `${g > 0 ? '+5%' : '−5%'}: ${pct >= 0 ? pct + '% slower' : -pct + '% faster'}`, 't-m', { 'text-anchor': anchor });
  });
  const cross = S('line', { y1: m.t, y2: H - m.b, style: 'stroke:var(--ink-2)', 'stroke-width': 1, opacity: 0 }, svg);
  const hit = S('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, class: 'hit' }, svg);
  hit.addEventListener('pointermove', ev => {
    const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) / STAGE_SCALE;
    const i = clamp(Math.round(((px - m.l) / (W - m.l - m.r) * .16) / .005), 0, M.walk.curve.length - 1), g = M.walk.curve[i].grade;
    cross.setAttribute('x1', x(g)); cross.setAttribute('x2', x(g)); cross.setAttribute('opacity', .5);
    showTip(ev, `Grade ${(g > 0 ? '+' : '') + (g * 100).toFixed(1)}%`, [[cssv('walk'), '×' + M.walk.curve[i].learned.toFixed(2), 'walk'], [cssv('bike'), '×' + M.bike.curve[i].learned.toFixed(2), 'ride']]);
  });
  hit.addEventListener('pointerleave', () => { hideTip(); cross.setAttribute('opacity', 0); });
}
function chartClass() {
  const W = 624, rowH = 84, cats = [['footway', 'Footway'], ['footbridge', 'Footbridge'], ['steps_down', 'Steps, down'], ['steps_up', 'Steps, up']];
  const H = 40 + cats.length * rowH + 30, svg = S('svg', { width: W, height: H }, $('#ch-class'));
  T(svg, 0, 16, 'Time on special paths vs. a normal road', 't-ink', { style: 'font-size:17px' });
  const x = scale(0, 7, 126, W - 70), ax = S('g', { class: 'ax' }, svg);
  [0, 1, 2, 4, 6].forEach(v => { S('line', { x1: x(v), x2: x(v), y1: 34, y2: H - 30, class: v === 0 ? 'base' : '' }, ax); T(ax, x(v), H - 8, '×' + v, '', { 'text-anchor': 'middle' }); });
  S('line', { x1: x(1), x2: x(1), y1: 34, y2: H - 30, style: 'stroke:var(--ink-2)', opacity: .55 }, svg);
  T(svg, x(1) + 5, 44, 'normal road', 't-m');
  const M = DATA.models;
  cats.forEach(([k, name], i) => {
    const y0 = 52 + i * rowH;
    T(svg, 112, y0 + 25, name, 't-2', { 'text-anchor': 'end', style: 'font-size:15px' });
    [['walk', 'Walk'], ['bike', 'Ride']].forEach(([mode, mn], j) => {
      const f = M[mode].classes[k]; if (f == null) return;
      const v = 1 / f, y = y0 + j * 26 + 4, g = S('g', { class: 'mk' }, svg);
      S('path', { d: barPath(x(0), y, x(v) - x(0), 20), class: `grow f-${mode}`, style: `--d:${300 + i * 130 + j * 60}` }, g);
      T(svg, x(v) + 8, y + 15, '×' + v.toFixed(1), 't-ink', { class: 't-ink fade', style: `--d:${900 + i * 130}; font-size:13.5px` });
      const hit = S('rect', { x: x(0), y: y - 2, width: W - x(0), height: 24, class: 'hit' }, svg);
      hoverable(hit, `${mn} · ${name}`, [[cssv(mode), '×' + v.toFixed(2), 'the time of a normal road'], [null, (f * 100).toFixed(0) + '%', 'of normal speed']], g);
    });
  });
  const lg = document.createElement('div'); lg.className = 'legend'; lg.style.cssText = 'margin-top:4px; font-size:14px;';
  lg.innerHTML = '<span><i class="key k-walk" style="height:8px"></i>Walk</span><span><i class="key k-bike" style="height:8px"></i>Ride (steps = pushing)</span>';
  $('#ch-class').appendChild(lg);
}

/* ------------------------------------------------------------------ 11 · peak & error */
function chartPeak() {
  const W = 600, H = 64, svg = S('svg', { width: W, height: H }, $('#ch-peak'));
  const x = scale(7 * 60, 22.5 * 60, 6, W - 6), ax = S('g', { class: 'ax' }, svg);
  S('line', { x1: x(420), x2: x(1350), y1: 34, y2: 34, class: 'base' }, ax);
  for (let h = 8; h <= 22; h += 2) { S('line', { x1: x(h * 60), x2: x(h * 60), y1: 30, y2: 38 }, ax); T(ax, x(h * 60), 56, `${h}:00`, '', { 'text-anchor': 'middle' }); }
  [...DATA.meta.peak].sort((a, b) => a[0] - b[0]).forEach(([a, b], i) => {
    S('rect', { x: x(a), y: 14, width: Math.max(3, x(b) - x(a)), height: 20, rx: 3, class: 'growy f-bike', opacity: .85, style: `--d:${400 + i * 35}` }, svg);
    const f = v => `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
    hoverable(S('rect', { x: x(a) - 4, y: 6, width: Math.max(3, x(b) - x(a)) + 8, height: 36, class: 'hit' }, svg), 'Class-change window', [[cssv('bike'), `${f(a)}–${f(b)}`, 'peak']]);
  });
}
function chartErr() {
  const V = DATA.validation, err = (mode, k) => V.filter(v => v.mode === mode).map(v => Math.abs(v[k]) * 100);
  const rows = [['walk', 'full', 'Walk'], ['bike', 'full', 'Ride'], ['bike', 'cal', 'Ride, once you know your pace']];
  const W = 724, rh = 78, m = { l: 214, r: 30, t: 8, b: 32 }, H = m.t + rows.length * rh + m.b;
  const svg = S('svg', { width: W, height: H }, $('#ch-err'));
  const x = scale(0, 40, m.l, W - m.r), ax = S('g', { class: 'ax' }, svg);
  [0, 10, 20, 30, 40].forEach(v => { S('line', { x1: x(v), x2: x(v), y1: 0, y2: H - m.b, class: v === 0 ? 'base' : '' }, ax); T(ax, x(v), H - 10, v + '%', '', { 'text-anchor': 'middle' }); });
  rows.forEach(([mode, k, name], i) => {
    const e = err(mode, k), md = median(e), y = m.t + i * rh + 30, g = S('g', { class: 'mk' }, svg);
    T(svg, m.l - 16, y + 5, name, i === 2 ? 't-2' : 't-ink', { 'text-anchor': 'end', style: `font-size:${i === 2 ? 13.5 : 16}px` });
    e.forEach((v, j) => S('circle', { cx: x(Math.min(v, 39.5)), cy: y + ((j % 3) - 1) * 9, r: 4.5, class: `pop f-${mode} s-bg`, 'stroke-width': 1.5, 'fill-opacity': i === 2 ? .55 : .9, style: `--d:${400 + i * 200 + j * 30}` }, g));
    S('line', { x1: x(md), x2: x(md), y1: y - 22, y2: y + 22, class: 'fade s-ink', 'stroke-width': 2.5, 'stroke-linecap': 'round', style: `--d:${900 + i * 200}` }, g);
    T(svg, x(md) + 8, y - 16, `median ${md.toFixed(0)}%`, 't-ink', { class: 't-ink fade', style: `--d:${1000 + i * 200}; font-size:13.5px` });
    const hit = S('rect', { x: 0, y: y - rh / 2, width: W, height: rh, class: 'hit' }, svg);
    hoverable(hit, name, [[cssv(mode), md.toFixed(1) + '%', `median error (${e.length} tracks)`], [null, Math.max(...e).toFixed(0) + '%', 'worst track']], g);
  });
}

/* ------------------------------------------------------------------ 12 · shuttle */
function chartAnatomy() {
  const p = pair('南区', '汇文楼'), W = 640, H = 236, m = { l: 92, r: 20 }, svg = S('svg', { width: W, height: H }, $('#ch-anatomy'));
  const x = scale(0, 22, m.l, W - m.r), ax = S('g', { class: 'ax' }, svg);
  [0, 5, 10, 15, 20].forEach(v => { S('line', { x1: x(v), x2: x(v), y1: 0, y2: H - 26, class: v === 0 ? 'base' : '' }, ax); T(ax, x(v), H - 8, v + (v === 20 ? ' min' : ''), '', { 'text-anchor': 'middle' }); });
  const row = (i, name, mode) => { const y = 12 + i * 66; T(svg, m.l - 14, y + 22, name, 't-ink', { 'text-anchor': 'end', style: 'font-size:15px' }); return y; };
  // walk
  let y = row(0, 'Walk', 'walk');
  S('path', { d: barPath(x(0), y + 6, x(p.wt) - x(0), 24), class: 'grow f-walk', style: '--d:300' }, svg);
  T(svg, x(p.wt) - 10, y + 23, fx(p.wt), 't-ink', { 'text-anchor': 'end', class: 't-ink fade', style: '--d:900; fill:#fff' });
  // ride: unlock? + ride + park?
  y = row(1, 'Ride', 'bike');
  S('path', { d: barPath(x(0), y + 6, x(p.bt) - x(0), 24), class: 'grow f-bike', style: '--d:450' }, svg);
  T(svg, x(p.bt) - 10, y + 23, fx(p.bt), 't-ink', { 'text-anchor': 'end', class: 't-ink fade', style: '--d:1000; fill:#141414' });
  const gq = S('g', { class: 'fade', style: '--d:1100' }, svg);
  S('rect', { x: x(p.bt) + 2, y: y + 6, width: x(1.5) - x(0), height: 24, rx: 4, style: 'fill:none; stroke:var(--bike); stroke-dasharray:3 3' }, gq);
  T(gq, x(p.bt) + 2 + (x(1.5) - x(0)) / 2, y + 23, '?', 't-ink', { 'text-anchor': 'middle' });
  T(gq, x(p.bt) + x(1.5) - x(0) + 12, y + 23, 'unlock + park: not timed', 't-m');
  // shuttle: the whole budget is the walking time
  y = row(2, 'Shuttle', 'bus');
  const gb = S('g', { class: 'fade', style: '--d:1300' }, svg);
  const parts = ['walk to stop', 'wait', 'ride', 'to door'], seg = (x(p.wt) - x(0)) / 4;
  parts.forEach((t, k) => {
    S('rect', { x: x(0) + k * seg + 1, y: y + 6, width: seg - 3, height: 24, rx: 5, style: 'fill:var(--bus-wash); stroke:var(--bus); stroke-dasharray:4 3' }, gb);
    T(gb, x(0) + k * seg + seg / 2, y + 22.5, t + ' ?', 't-2', { 'text-anchor': 'middle', style: 'font-size:12.5px' });
  });
  S('path', { d: `M${x(0)},${y + 40}V${y + 46}H${x(p.wt)}V${y + 40}`, fill: 'none', style: 'stroke:var(--bus)', 'stroke-width': 1.5 }, gb);
  T(gb, x(p.wt / 2), y + 60, `must add up to under ${fx(p.wt)} min to beat walking`, 't-2', { 'text-anchor': 'middle', style: 'font-size:13px' });
  const sh = document.createElement('div'); sh.className = 'shimmer'; sh.style.cssText = `position:absolute; left:${x(0)}px; top:${y + 6}px; width:${x(p.wt) - x(0)}px; height:24px; border-radius:5px; pointer-events:none;`;
  const host = $('#ch-anatomy'); host.style.position = 'relative'; host.appendChild(sh);
}
function chartBudget() {
  const allTrips = DORMS.flatMap(o => TEACH.map(d => ({ o, d, ...pair(o, d) }))).sort((a, b) => b.wt - a.wt), trips = allTrips.slice(0, 20);
  const W = 704, rh = 19.5, m = { l: 190, r: 64, t: 22, b: 28 }, H = m.t + trips.length * rh + m.b;
  const svg = S('svg', { width: W, height: H }, $('#ch-budget'));
  const x = scale(0, 18, m.l, W - m.r), ax = S('g', { class: 'ax' }, svg);
  [0, 5, 10, 15].forEach(v => { S('line', { x1: x(v), x2: x(v), y1: m.t - 6, y2: H - m.b, class: v === 0 ? 'base' : '' }, ax); T(ax, x(v), H - 8, v + (v === 15 ? ' min' : ''), '', { 'text-anchor': 'middle' }); });
  const els = trips.map((t, i) => {
    const y = m.t + i * rh, g = S('g', { class: 'mk' }, svg);
    T(svg, m.l - 12, y + 13.5, `${EN(t.o).replace(' Dorms', '').replace(' Halls', '')} → ${EN(t.d)}`, 't-2', { 'text-anchor': 'end', style: 'font-size:12.5px' });
    const bar = S('path', { class: 'f-walk', d: '' }, g);
    const tick = S('rect', { width: 4, height: rh - 3, y: y + 1.5, rx: 2, class: 'f-bike' }, g);
    const lab = T(svg, 0, y + 13.5, '', 't-m', { style: 'font-size:12px' });
    const hit = S('rect', { x: 0, y, width: W, height: rh, class: 'hit' }, svg);
    return { t, y, bar, tick, lab, hit, g, cur: { w: 0, b: 0 } };
  });
  let raf = 0, v = 15;
  const target = t => { const ride = t.bm / 1000 / v * 60; return { w: Math.max(0, t.wt - ride), b: t.bt - ride, ride }; };
  function draw(f) {
    els.forEach(e => {
      const w = e.cur.w, b = e.cur.b;
      e.bar.setAttribute('d', w > .02 ? barPath(x(0), e.y + 4, x(w) - x(0), rh - 8, 3) : '');
      e.tick.setAttribute('x', x(Math.max(0, b)) - 2); e.tick.setAttribute('opacity', b > 0 ? 1 : .35);
      e.lab.setAttribute('x', x(Math.max(w, 0)) + 8); e.lab.textContent = w > .05 ? fx(w) : '0';
    });
  }
  function animateTo(dur = 700) {
    const from = els.map(e => ({ ...e.cur })), to = els.map(e => target(e.t)), t0 = performance.now();
    cancelAnimationFrame(raf);
    const step = now => {
      const k = easeOut(clamp((now - t0) / dur, 0, 1));
      els.forEach((e, i) => { e.cur.w = lerp(from[i].w, to[i].w, k); e.cur.b = lerp(from[i].b, to[i].b, k); });
      draw(); if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }
  els.forEach(e => hoverable(e.hit, `${EN(e.t.o)} → ${EN(e.t.d)}`, () => {
    const tg = target(e.t);
    return [[cssv('walk'), fx(Math.max(0, tg.w)) + ' min', `to beat walking (${fx(e.t.wt)} min)`], [cssv('bike'), tg.b > 0 ? fx(tg.b) + ' min' : 'never', `to beat riding (${fx(e.t.bt)} min)`],
      [cssv('bus'), fx(tg.ride) + ' min', `ride, ${e.t.bm} m at ${v} km/h`]];
  }, e.g));
  const inp = $('#bus-speed'), out = $('#bus-speed-v');
  inp.addEventListener('input', () => { v = +inp.value; out.textContent = v + ' km/h'; animateTo(450); });
  inp.addEventListener('keydown', e => e.stopPropagation());
  return {
    start() { els.forEach(e => { e.cur = { w: 0, b: 0 }; }); draw(); setTimeout(() => animateTo(1400), 700); },
    table: () => ({ title: `Shuttle budget at ${v} km/h (minutes of walk-to-stop + waiting it can afford)`, cols: ['Trip', 'Walk', 'Ride', 'Beat walking', 'Beat riding'],
      rows: allTrips.map(t => { const tg = target(t); return [`${EN(t.o)} → ${EN(t.d)}`, fx(t.wt), fx(t.bt), fx(Math.max(0, tg.w)), tg.b > 0 ? fx(tg.b) : 'never']; }) }),
  };
}

/* ------------------------------------------------------------------ 13 · scorecard */
function buildScore() {
  const fpct = v => Math.round(v);
  const reachW = DORMS.map((z, i) => PAIRS.filter(p => p.o === z && p.wt <= 10).length), reachB = DORMS.map(z => PAIRS.filter(p => p.o === z && p.bt <= 10).length);
  const R = [
    ['Speed', 'door to door', [1, `${F.walkKmh} km/h`], [3, `≈ ${F.speedup}× faster`], ['?', 'quick ride, slow wait']],
    ['Reach in 10 min', 'from a dorm', [1, `${Math.min(...reachW)}–${Math.max(...reachW)} of 19 places`], [3, `${Math.min(...reachB)}–${Math.max(...reachB)} of 19 places`], ['e1', 'stops only']],
    ['Short breaks', 'pairs that fit 10 min', [1, `${F.breaks.walk[1]} of ${F.nTeachPairs}`], [3, `${F.breaks.bike[1]} of ${F.nTeachPairs}`], ['?', 'depends on timetable']],
    ['Hills', '+5% grade', [3, `+${fpct((F.slope.walkUp - 1) * 100)}% time`], [1, `+${fpct((F.slope.bikeUp - 1) * 100)}% time`], ['e3', 'the engine climbs']],
    ['Steps & bridges', 'vs. a normal road', [2, `steps ×${F.stepsWalk}`], [1, `steps ×${F.stepsBike} (push)`], ['e2', 'roads only']],
    ['Rush hour', 'at class change', [3, `×${F.peakWalk.toFixed(2)}, no slowdown`], [2, `×${F.peakBike.toFixed(2)} on shared paths`], ['?', 'crowding unknown']],
    ['Predictability', 'median error', [3, `±${fpct(F.err.walk)}%`], [2, `±${fpct(F.err.bike)}%`], ['?', 'waiting time unknown']],
    ['Effort & weather', 'sun, rain, bags', [1, 'sweat and rain'], [1, 'sweat and rain'], ['e3', 'seated, sheltered']],
  ];
  const host = $('#scorecard'), g = document.createElement('div'); g.className = 'score';
  const head = (cls, mode, name, sub) => {
    const d = document.createElement('div'); d.className = 'hd';
    if (mode) { const sv = document.createElementNS(NS, 'svg'); sv.setAttribute('class', `ico ico-${mode}`); sv.setAttribute('viewBox', '0 0 48 48'); sv.innerHTML = $(`#i-${mode}`).innerHTML; d.appendChild(sv); }
    d.appendChild(document.createTextNode(name)); if (sub) { const s = document.createElement('small'); s.textContent = sub; d.appendChild(s); } g.appendChild(d);
  };
  head('', null, ''); head('', 'walk', 'Walk'); head('', 'bike', 'Ride'); head('', 'bus', 'Shuttle', 'no data yet');
  const pips = (score, mode, delay) => {
    const p = document.createElement('span'); p.className = 'pips'; p.style.setProperty('--c', `var(--${mode})`);
    if (score === '?') { p.classList.add('unk'); p.textContent = '?'; return p; }
    const exp = typeof score === 'string', n = exp ? +score.slice(1) : score;
    for (let i = 0; i < 3; i++) { const e = document.createElement('i'); if (i < n) e.className = exp ? 'exp' : 'on'; e.style.setProperty('--pd', delay + i * 70); p.appendChild(e); }
    return p;
  };
  R.forEach(([crit, sub, w, b, s], i) => {
    const c = document.createElement('div'); c.className = 'crit'; c.textContent = crit; const sm = document.createElement('small'); sm.textContent = sub; c.appendChild(sm); g.appendChild(c);
    const best = Math.max(...[w[0], b[0]].map(v => typeof v === 'number' ? v : 0));
    [[w, 'walk'], [b, 'bike'], [s, 'bus']].forEach(([[score, note], mode], k) => {
      const d = document.createElement('div'); d.className = 'cell';
      d.appendChild(pips(score, mode, 300 + i * 90 + k * 40));
      const t = document.createElement('span'); t.textContent = note; if (typeof score === 'number' && score === best && score === 3) t.className = 'best'; d.appendChild(t);
      g.appendChild(d);
    });
  });
  host.appendChild(g);
  return { table: () => ({ title: 'Scorecard', cols: ['Criterion', 'Walk', 'Ride', 'Shuttle'], rows: R.map(([c, , w, b, s]) => [c, w[1], b[1], s[1] + ' (not measured)']) }) };
}

/* ------------------------------------------------------------------ 14 · advice cases */
function buildCases() {
  const qh = pair('乔区', '汇文楼'), zs = pair('斋区', '科技楼'), hx = teachOff('walk').find(r => r.A === '汇文楼' && r.B === '致信楼'), hxb = teachOff('bike').find(r => r.A === '汇文楼' && r.B === '致信楼');
  const cases = [
    ['walk', 'Zhili → Zhizhen, 5-min break', `${F.zlzzWalk} min on foot`],
    ['bike', 'Qiao Dorms → Huiwen, 8:30 class', `${fx(qh.wt)} vs ${fx(qh.bt)} min`],
    ['bus', 'South Dorms → Huiwen, heavy rain', 'check the wait'],
    ['walk', 'Zhai Dorms → Sci-Tech', `bike saves ${fx(zs.wt - zs.bt)} min`],
    ['bike', 'Huiwen → Zhixin, 10-min break', `${fx(hx.ab)} vs ${fx(hxb.ab)} min`],
  ];
  const host = $('#cases'), rules = $$('#rules .rule');
  const els = cases.map(([mode, txt, ev]) => {
    const d = document.createElement('div'); d.className = 'case';
    const dot = document.createElement('i'); dot.className = 'dot k-' + mode; d.appendChild(dot);
    const b = document.createElement('b'); b.textContent = txt; d.appendChild(b);
    const s = document.createElement('span'); s.textContent = '· ' + ev; d.appendChild(s);
    const a = document.createElement('span'); a.className = 'arrow'; a.style.color = `var(--${mode})`; a.textContent = { walk: 'Walk', bike: 'Ride', bus: 'Wait' }[mode] + ' →'; d.appendChild(a);
    host.appendChild(d); return { d, mode };
  });
  let i = -1, timer = 0;
  const step = () => {
    i = (i + 1) % els.length;
    els.forEach((e, k) => e.d.classList.toggle('lit', k === i));
    rules.forEach(r => r.classList.toggle('lit', r.dataset.mode === els[i].mode));
  };
  return {
    start() { clearInterval(timer); i = -1; setTimeout(step, 1300); timer = setInterval(step, 3200); },
    stop() { clearInterval(timer); els.forEach(e => e.d.classList.remove('lit')); rules.forEach(r => r.classList.remove('lit')); },
  };
}

/* ------------------------------------------------------------------ 16 · phone timer */
function buildPhone() {
  let t0 = 0, timer = 0; const el = $('#phone-timer');
  return {
    start() { t0 = performance.now() - 192000; clearInterval(timer); timer = setInterval(() => { const s = Math.floor((performance.now() - t0) / 1000); el.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }, 250); },
    stop() { clearInterval(timer); },
  };
}

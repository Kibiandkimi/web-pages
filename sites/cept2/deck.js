'use strict';
/* Deck engine: build, navigate, transitions, metro-line progress, notes, theme and data views. */
(() => {
  // ---- inline icon symbols so each icon's strokes can draw themselves
  $$('svg.ico use').forEach(u => {
    const id = (u.getAttribute('href') || '').slice(1), sym = document.getElementById(id); if (!sym) return;
    const svg = u.parentNode; svg.setAttribute('viewBox', sym.getAttribute('viewBox'));
    [...sym.children].forEach(ch => svg.appendChild(ch.cloneNode(true))); u.remove();
  });
  $$('svg.ico.drawme').forEach(svg => [...svg.children].forEach((p, i) => p.style.setProperty('--pd', i * 90)));

  fillFacts();

  // ---- kinetic headings: split into words (author text only)
  $$('.split').forEach(el => {
    let wi = 0;
    const walk = node => {
      [...node.childNodes].forEach(ch => {
        if (ch.nodeType === 3) {
          const frag = document.createDocumentFragment();
          ch.textContent.split(/(\s+)/).forEach(part => {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
            const w = document.createElement('span'); w.className = 'w';
            const s = document.createElement('span'); s.textContent = part; s.style.setProperty('--wd', 70 * wi++); w.appendChild(s); frag.appendChild(w);
          });
          ch.replaceWith(frag);
        } else if (ch.nodeType === 1 && ch.tagName !== 'BR' && !ch.classList.contains('qmark')) walk(ch);
      });
    };
    walk(el);
  });

  // ---- charts & widgets
  chartElev(); chartSpeed(); const RACE = buildRace(); const BOARD = buildBoard(); const BRK = chartBreaks(); const ISO = buildIso();
  chartSlope(); chartClass(); chartPeak(); chartErr(); chartAnatomy(); const BUDGET = chartBudget(); const SCORE = buildScore();
  const CASES = buildCases(); const PHONE = buildPhone();
  $('#race-replay').onclick = e => { RACE.start(200); e.currentTarget.blur(); };

  const tableRows = rows => rows;
  const HOOKS = {
    3: { table: () => ({ title: 'Tracks', cols: ['', 'Count', 'km'], rows: [['Walk', F.nWalk, DATA.tracks.km.walk], ['Run', F.nRun, DATA.tracks.km.run], ['Ride', F.nBike, DATA.tracks.km.bike],
      ['Total', F.nTracks, F.kmTotal]] }) },
    4: { table: () => ({ title: 'Height of places (m, DirMap shared terrain)', cols: ['Place', 'Height m'], rows: PLACES.filter(p => p.h != null).sort((a, b) => b.h - a.h).map(p => [p.en, fx(p.h)]) }) },
    5: { table: () => ({ title: `All ${F.nPairs} trips between campus places, off-peak (model)`, cols: ['From', 'To', 'Walk min', 'Walk m', 'Ride min', 'Ride m'],
      rows: tableRows([...PAIRS].sort((a, b) => b.wt - a.wt).map(p => [EN(p.o), EN(p.d), fx(p.wt), p.wm, fx(p.bt), p.bm])) }) },
    6: { enter: () => RACE.start(), leave: () => RACE.stop(), replay: () => RACE.start(200), table: () => RACE.table() },
    7: { enter: () => BOARD.start(), leave: () => BOARD.stop(), table: () => BOARD.table() },
    8: { table: () => BRK.table() },
    9: { enter: () => ISO.start(), leave: () => ISO.stop(), replay: () => ISO.replay(), table: () => ISO.table() },
    10: { table: () => ({ title: 'Slope and road-type effects (model)', cols: ['Effect', 'Walk', 'Ride'], rows: [
      ['+5% grade, time ×', fx(F.slope.walkUp, 2), fx(F.slope.bikeUp, 2)], ['−5% grade, time ×', fx(F.slope.walkDown, 2), fx(F.slope.bikeDown, 2)],
      ...['footway', 'footbridge', 'steps_down', 'steps_up'].map(k => [k.replace('_', ' ') + ', time ×', fx(1 / DATA.models.walk.classes[k], 2), fx(1 / DATA.models.bike.classes[k], 2)])] }) },
    11: { table: () => ({ title: 'Leave-one-track-out prediction error (|%|)', cols: ['Mode', 'Track length m', 'Full model', 'Knowing first 40%'],
      rows: DATA.validation.map(v => [v.mode === 'walk' ? 'Walk' : 'Ride', v.m, fx(Math.abs(v.full) * 100), fx(Math.abs(v.cal) * 100)]) }) },
    12: { enter: () => BUDGET.start(), table: () => BUDGET.table() },
    13: { table: () => SCORE.table() },
    14: { enter: () => CASES.start(), leave: () => CASES.stop() },
    16: { enter: () => PHONE.start(), leave: () => PHONE.stop() },
  };

  // ---- map states
  const BIG = ['*dorm', '*teach'];
  const MAP_STATES = {
    title: { cx: 70, cy: -40, ppm: .6, sx: 1110, sy: 480, rot: -24, squash: .6, terrain: 0.6, contour: .55, water: 1, bld: 1, trunk: .8, net: 1, flow: 1, drift: .8 },
    ambient: { cx: 70, cy: -40, ppm: .66, sx: 800, sy: 470, rot: 16, squash: .58, terrain: 0.6, contour: .55, water: 1, bld: 1, trunk: .6, net: 1, flow: .9, drift: 1 },
    cover: { cx: 95, cy: -28, ppm: .57, sx: 1160, sy: 452, terrain: .55, water: .9, bld: .75, trunk: .5, net: .75, cover: 1, labels: .95, labelList: BIG,
      labelOpts: { left: ['海山楼一带', '乔区', '汇文楼', '计软楼'] } },
    hill: { cx: 70, cy: -20, ppm: .6, sx: 500, sy: 520, rot: -14, squash: .5, lift: 3.6, terrace: 1, bld: .75, net: .6, labels: 1,
      labelList: [...BIG], labelOpts: { height: true, left: ['海山楼一带', '乔区', '汇文楼', '计软楼'] } },
    faint: { cx: 70, cy: -40, ppm: .62, sx: 800, sy: 460, rot: 10, squash: .6, terrain: 0.48, contour: .4, water: .8, bld: .7, trunk: .4, net: .8, flow: .7, drift: 1 },
    race: { cx: 178, cy: 222, ppm: .86, sx: 470, sy: 452, terrain: .7, water: .9, bld: .8, trunk: .5, net: .6, race: 1, labels: 1,
      labelList: ['南区', '汇文楼', '科技楼', '斋区', '图书馆北馆', '学生活动中心'], labelOpts: { left: ['汇文楼'] } },
    iso: { cx: 95, cy: -28, ppm: .6, sx: 470, sy: 452, terrain: .45, water: .8, bld: .55, trunk: .4, net: .45, iso: 1, labels: 1, labelList: ['*'],
      labelOpts: { left: ['海山楼一带', '乔区', '汇文楼', '计软楼', '荔山餐厅', '听山餐厅', '学生活动中心', '南校区餐厅', '文山湖餐厅', '图书馆北馆'] } },
    steps: { cx: 110, cy: -28, ppm: .56, sx: 1200, sy: 452, terrain: .45, water: .8, bld: .65, trunk: .4, net: .75, steps: 1, labels: .9, labelList: BIG,
      labelOpts: { left: ['海山楼一带', '乔区', '汇文楼', '计软楼'] } },
    finale: { cx: 70, cy: -40, ppm: .6, sx: 1110, sy: 480, rot: 22, squash: .6, terrain: 0.6, contour: .55, water: 1, bld: 1, trunk: .8, net: 1, flow: 1, drift: .8 },
  };

  // ---- deck state
  const slides = $$('.slide'), N = slides.length;
  const SECTIONS = [['Introduction', 'Part 1', 'Why and how'], ['Head to head', 'Part 2', 'Head to head'], ['The shuttle', 'Part 3', 'The missing mode'], ['Verdict', 'Part 4', 'Verdict & advice']];
  const secOf = s => s.dataset.sec;
  let cur = -1;

  // metro-line progress
  const metro = $('#metro'), Wm = 1408;
  const sx = i => i / (N - 1) * Wm;
  metro.innerHTML = '';
  const track = document.createElement('div'); track.className = 'track'; metro.appendChild(track);
  const SEG_BG = { 'Introduction': 'var(--axis)', 'Head to head': 'linear-gradient(90deg, var(--walk), var(--bike))', 'The shuttle': 'repeating-linear-gradient(90deg, var(--bus) 0 7px, transparent 7px 11px)', 'Verdict': 'var(--ink-2)' };
  SECTIONS.forEach(([name, part]) => {
    const idx = slides.map((s, i) => secOf(s) === name ? i : -1).filter(i => i >= 0); if (!idx.length) return;
    const a = idx[0], b = idx[idx.length - 1];
    const seg = document.createElement('div'); seg.className = 'seg'; seg.style.left = sx(a) + 'px'; seg.style.width = Math.max(10, sx(b) - sx(a) + (b < N - 1 ? sx(1) : 0)) + 'px';
    seg.style.background = SEG_BG[name]; metro.appendChild(seg);
    const lab = document.createElement('div'); lab.className = 'lab'; lab.style.left = sx(a) + 'px';
    const bb = document.createElement('b'); bb.textContent = part.replace('Part ', '') + ' '; lab.appendChild(bb); lab.appendChild(document.createTextNode(name.replace(/^The /, ''))); metro.appendChild(lab);
  });
  const tipName = document.createElement('div'); tipName.className = 'tipname'; metro.appendChild(tipName);
  const stations = slides.map((s, i) => {
    const st = document.createElement('button'); st.className = 'st'; st.style.left = sx(i) + 'px'; st.setAttribute('aria-label', `Slide ${i + 1}: ${s.dataset.title}`);
    st.onclick = e => { go(i); e.currentTarget.blur(); };
    st.onpointerenter = () => { tipName.textContent = `${String(i + 1).padStart(2, '0')} · ${s.dataset.title}`; tipName.style.left = sx(i) + 'px'; tipName.classList.add('on'); };
    st.onpointerleave = () => tipName.classList.remove('on');
    metro.appendChild(st); return st;
  });
  const train = document.createElement('div'); train.className = 'train'; metro.appendChild(train);

  // count-up numbers
  function countUp(root, delay) {
    $$('[data-count]', root).forEach(el => {
      const to = +(el.dataset.to ?? el.textContent), dec = +(el.dataset.dec || 0), t0 = performance.now() + delay + 250, dur = 1400;
      const fmt = v => v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
      if (REDUCED) { el.textContent = fmt(to); return; }
      el.textContent = fmt(0);
      const step = now => { const t = clamp((now - t0) / dur, 0, 1); el.textContent = fmt(to * easeOut(t)); if (t < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }
  function replayCharts(root, delay) {
    $$('svg', root).forEach(s => s.classList.remove('play'));
    void root.offsetWidth;
    setTimeout(() => $$('svg', root).forEach(s => s.classList.add('play')), delay);
  }

  const sweep = $('#sweep');
  function go(n, opts = {}) {
    n = clamp(n, 0, N - 1); if (n === cur) return;
    const dir = n > cur ? 1 : -1, old = slides[cur], nw = slides[n];
    const newSec = cur >= 0 && secOf(old) !== secOf(nw) && dir > 0 && !REDUCED && !opts.instant;
    if (old) {
      old.style.setProperty('--dir', dir); old.classList.remove('active'); old.classList.add('leaving');
      setTimeout(() => old.classList.remove('leaving'), 600);
      HOOKS[cur + 1]?.leave?.();
    }
    hideTip(); closeTable();
    if (newSec) {
      const S2 = SECTIONS.find(s => s[0] === secOf(nw));
      $('#sweep-k').textContent = S2[1]; $('#sweep-t').textContent = S2[2];
      sweep.classList.remove('run'); void sweep.offsetWidth; sweep.classList.add('run');
    }
    const enterDelay = newSec ? 1250 : 380;
    nw.classList.toggle('late', newSec);
    nw.style.setProperty('--dir', dir);
    nw.classList.remove('active'); void nw.offsetWidth; nw.classList.add('active');
    const first = cur < 0; cur = n;
    const st = MAP_STATES[nw.dataset.map] || MAP_STATES.faint;
    setTimeout(() => MAP.set(st, { dur: first ? 10 : 1800, reveal: first || nw.dataset.map === 'finale' }), newSec ? 420 : 0);
    const veil = $('#veil'); setTimeout(() => { veil.className = nw.dataset.veil || ''; }, newSec ? 420 : 0);
    replayCharts(nw, enterDelay); countUp(nw, enterDelay);
    const h = HOOKS[n + 1]; if (h?.enter) setTimeout(() => { if (cur === n) h.enter(); }, newSec ? 900 : 0);
    // chrome
    $('#sec-count').textContent = `${String(n + 1).padStart(2, '0')} / ${String(N).padStart(2, '0')}`;
    const sec = $('#section'); sec.style.opacity = 0;
    setTimeout(() => { $('#sec-name').textContent = n === 0 ? '' : secOf(nw); sec.style.opacity = n === 0 ? 0 : 1; }, 300);
    $('#brand').style.opacity = n === 0 ? 0 : 1;
    $('#hint').style.opacity = n === 0 ? 1 : 0;
    stations.forEach((s, i) => { s.classList.toggle('past', i < n); s.classList.toggle('now', i === n); });
    train.style.left = sx(n) + 'px';
    $('#notes-body').textContent = $('.notes', nw)?.textContent.trim() || '';
    $('#notes-n').textContent = `${n + 1} / ${N} · ${nw.dataset.title}`;
    history.replaceState(null, '', '#' + (n + 1));
  }

  // ---- data table overlay
  const tableEl = $('#table');
  function closeTable() { tableEl.classList.remove('on'); }
  function openTable() {
    const h = HOOKS[cur + 1], body = $('#table-body'); body.replaceChildren();
    const spec = h?.table?.();
    const t = document.createElement('h4'); t.textContent = spec ? spec.title : 'No chart data on this slide'; body.appendChild(t);
    if (spec) {
      const tb = document.createElement('table'), thr = document.createElement('tr');
      spec.cols.forEach((c, i) => { const th = document.createElement('th'); th.textContent = c; if (i) th.className = 'n'; thr.appendChild(th); });
      const thead = document.createElement('thead'); thead.appendChild(thr); tb.appendChild(thead);
      const tbody = document.createElement('tbody');
      spec.rows.forEach(r => { const tr = document.createElement('tr'); r.forEach((v, i) => { const td = document.createElement('td'); td.textContent = v; if (i) td.className = 'n'; tr.appendChild(td); }); tbody.appendChild(tr); });
      tb.appendChild(tbody); body.appendChild(tb);
    }
    tableEl.classList.add('on');
  }

  // ---- theme
  function setTheme(name) {
    document.documentElement.dataset.theme = name; MAP.setTheme(name);
    try { localStorage.setItem('wrw-theme', name); } catch (e) { /* file:// in some browsers */ }
  }
  let theme = 'light'; try { theme = localStorage.getItem('wrw-theme') || 'light'; } catch (e) { /* ignore */ }

  // ---- scaling
  function fit() {
    const s = Math.min(innerWidth / 1600, innerHeight / 900);
    STAGE_SCALE = s; stage.style.transform = `scale(${s})`; MAP.resize(s);
  }
  addEventListener('resize', fit);

  // ---- input
  addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target && e.target.tagName === 'INPUT') return;
    const k = e.key;
    if (['ArrowRight', 'PageDown', ' ', 'Enter', 'ArrowDown'].includes(k)) { e.preventDefault(); go(cur + 1); }
    else if (['ArrowLeft', 'PageUp', 'Backspace', 'ArrowUp'].includes(k)) { e.preventDefault(); go(cur - 1); }
    else if (k === 'Home') go(0);
    else if (k === 'End') go(N - 1);
    else if (k === 'n' || k === 'N') $('#notes').classList.toggle('on');
    else if (k === 'd' || k === 'D') tableEl.classList.contains('on') ? closeTable() : openTable();
    else if (k === 't' || k === 'T') setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    else if (k === 'f' || k === 'F') { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); }
    else if (k === '?') $('#help').classList.toggle('on');
    else if (k === 'r' || k === 'R') {
      const h = HOOKS[cur + 1], s = slides[cur];
      s.classList.remove('active', 'late'); void s.offsetWidth; s.classList.add('active'); replayCharts(s, 380); countUp(s, 380);
      if (h?.replay) h.replay(); else h?.enter?.();
      MAP.set(MAP_STATES[s.dataset.map] || MAP_STATES.faint, { dur: 10, reveal: s.dataset.map === 'title' || s.dataset.map === 'finale' });
    }
    else if (k === 'Escape') { $('#help').classList.remove('on'); $('#notes').classList.remove('on'); closeTable(); }
  });
  $('#prev').onclick = e => { go(cur - 1); e.currentTarget.blur(); };
  $('#next').onclick = e => { go(cur + 1); e.currentTarget.blur(); };
  $('#help').onclick = () => $('#help').classList.remove('on');
  let tx0 = null;
  addEventListener('touchstart', e => { tx0 = e.touches[0].clientX; }, { passive: true });
  addEventListener('touchend', e => { if (tx0 == null) return; const dx = e.changedTouches[0].clientX - tx0; if (Math.abs(dx) > 50) go(cur + (dx < 0 ? 1 : -1)); tx0 = null; });
  let wheelLock = 0;
  addEventListener('wheel', e => {
    if (e.target.closest && e.target.closest('#table')) return;
    const now = Date.now(); if (now < wheelLock || Math.abs(e.deltaY) < 30) return; wheelLock = now + 900; go(cur + (e.deltaY > 0 ? 1 : -1));
  }, { passive: true });

  // ---- start (after the embedded font is ready, so canvas labels and headings render in Inter)
  setTheme(theme); fit();
  const start = () => go(clamp((parseInt(location.hash.slice(1), 10) || 1) - 1, 0, N - 1), { instant: true });
  (document.fonts ? Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]) : Promise.resolve()).then(start);
  window.DECK = { go, N, slides: () => cur };
})();

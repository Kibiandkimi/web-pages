/* ==========================================================================
   Walk, Cycle, or Shuttle? — Interactive Engine, Animations & SVG Data Viz
   ========================================================================== */

(function () {
  'use strict';

  const DATA = window.DECK_DATA;
  const COLORS = {
    walk: '#AE700E',
    cycle: '#0B8F86',
    shuttle: '#6A55D6',
    red: '#C82828',
    ink: '#1C1A17',
    inkSec: '#4D4840',
    muted: '#787166',
    grid: 'rgba(28, 26, 23, 0.10)',
    surface: '#FFFFFF',
    bg: '#F5F0E6',
  };

  const slides = Array.from(document.querySelectorAll('.slide'));
  const total = slides.length;
  let current = 0;

  const stageEl = document.getElementById('stage');
  const progressFill = document.getElementById('progress-fill');
  const counterEl = document.getElementById('slide-counter');
  const sectionLabelEl = document.getElementById('footer-section');
  const brandDotEl = document.getElementById('footer-dot');
  const contoursEl = document.getElementById('ambient-contours');
  const tooltipEl = document.getElementById('viz-tooltip');
  const overviewModal = document.getElementById('overview-modal');

  // ------------------------------------------------------------------------
  // Responsive 16:9 Stage Scaler
  // ------------------------------------------------------------------------
  function fitStage() {
    const pad = 20;
    const scale = Math.min(
      (window.innerWidth - pad) / 1280,
      (window.innerHeight - pad) / 720,
      1.35
    );
    stageEl.style.transform = `scale(${Math.max(0.25, scale)})`;
  }
  window.addEventListener('resize', fitStage);
  fitStage();

  // ------------------------------------------------------------------------
  // Tooltip Helper (shared across all SVG visualizations)
  // ------------------------------------------------------------------------
  function showTooltip(evt, html) {
    tooltipEl.innerHTML = html;
    tooltipEl.classList.add('show');
    moveTooltip(evt);
  }
  function moveTooltip(evt) {
    const x = evt.clientX + 14;
    const y = evt.clientY - 12;
    const rect = tooltipEl.getBoundingClientRect();
    const clampedX = Math.min(x, window.innerWidth - rect.width - 14);
    const clampedY = Math.max(12, Math.min(y, window.innerHeight - rect.height - 14));
    tooltipEl.style.left = clampedX + 'px';
    tooltipEl.style.top = clampedY + 'px';
  }
  function hideTooltip() {
    tooltipEl.classList.remove('show');
  }

  // ------------------------------------------------------------------------
  // SVG Element Builder
  // ------------------------------------------------------------------------
  function svgEl(tag, attrs = {}, parent = null) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v !== undefined && v !== null) el.setAttribute(k, String(v));
    }
    if (parent) parent.appendChild(el);
    return el;
  }

  // ------------------------------------------------------------------------
  // Smooth Number Counter Animation
  // ------------------------------------------------------------------------
  function animateCounters(slide) {
    slide.querySelectorAll('[data-count]').forEach((el) => {
      const target = parseFloat(el.dataset.count);
      const decimals = parseInt(el.dataset.decimals || '0', 10);
      const suffix = el.dataset.suffix || '';
      const prefix = el.dataset.prefix || '';
      const dur = 950;
      const t0 = performance.now();
      function tick(now) {
        const p = Math.min(1, (now - t0) / dur);
        const eased = 1 - Math.pow(1 - p, 4);
        const val = target * eased;
        el.textContent = prefix + val.toFixed(decimals) + suffix;
        if (p < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }

  // ------------------------------------------------------------------------
  // Campus Map Renderer (used on Slide 1 Cover + Slide 8 Data Overview)
  // ------------------------------------------------------------------------
  function renderCampusMap(svgId, opts = {}) {
    const svg = document.getElementById(svgId);
    if (!svg || !DATA) return;
    svg.innerHTML = '';
    const W = DATA.canvas.w;
    const H = DATA.canvas.h;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

    // Subtle elevation wash (north campus higher than south)
    const defs = svgEl('defs', {}, svg);
    const grad = svgEl('linearGradient', { id: svgId + '-elev', x1: '0%', y1: '0%', x2: '0%', y2: '100%' }, defs);
    svgEl('stop', { offset: '0%', 'stop-color': '#AE700E', 'stop-opacity': '0.09' }, grad);
    svgEl('stop', { offset: '100%', 'stop-color': '#0B8F86', 'stop-opacity': '0.05' }, grad);
    svgEl('rect', { x: 0, y: 0, width: W, height: H, fill: `url(#${svgId}-elev)` }, svg);

    // Compass & elevation annotation
    svgEl('text', {
      x: 16, y: 24, fill: COLORS.muted, 'font-size': 10.5, 'font-weight': 700, 'letter-spacing': '0.08em'
    }, svg).textContent = 'NORTH · HIGHER (34m)';
    svgEl('text', {
      x: 16, y: H - 14, fill: COLORS.muted, 'font-size': 10.5, 'font-weight': 700, 'letter-spacing': '0.08em'
    }, svg).textContent = 'SOUTH · LOWER (4m)';

    // Road network
    const roadGroup = svgEl('g', { opacity: opts.dimRoads ? '0.45' : '0.68' }, svg);
    DATA.roads.forEach((pts) => {
      const d = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0] + ',' + p[1]).join(' ');
      svgEl('path', {
        d, fill: 'none', stroke: '#8E867B', 'stroke-width': 1.25, 'stroke-linecap': 'round'
      }, roadGroup);
    });

    // Shuttle loop (dashed track + animated glowing loop)
    const ringD = DATA.ring.map((p, i) => (i === 0 ? 'M' : 'L') + p[0] + ',' + p[1]).join(' ') + ' Z';
    svgEl('path', {
      d: ringD, fill: 'none', stroke: COLORS.shuttle, 'stroke-width': 3.2,
      'stroke-opacity': 0.24, 'stroke-linejoin': 'round'
    }, svg);
    const animRing = svgEl('path', {
      d: ringD, fill: 'none', stroke: COLORS.shuttle, 'stroke-width': 2.2,
      'stroke-dasharray': '7 5', 'stroke-linecap': 'round', class: 'shuttle-ring-path'
    }, svg);
    svgEl('animate', {
      attributeName: 'stroke-dashoffset', from: '0', to: '-48', dur: '3.2s', repeatCount: 'indefinite'
    }, animRing);

    // Sample cycling spine (Zhai -> Huiwen -> Zhili)
    const pZhai = DATA.places['斋区'].xy;
    const pHuiwen = DATA.places['汇文楼'].xy;
    const pZhili = DATA.places['致理楼'].xy;
    const pQiao = DATA.places['乔区'].xy;
    const bikeSpine = `M${pHuiwen[0]},${pHuiwen[1]} Q${(pHuiwen[0]+pZhai[0])/2+14},${(pHuiwen[1]+pZhai[1])/2} ${pZhai[0]},${pZhai[1]} T${pZhili[0]},${pZhili[1]}`;
    svgEl('path', {
      d: bikeSpine, fill: 'none', stroke: COLORS.cycle, 'stroke-width': 2.8,
      'stroke-linecap': 'round', 'stroke-opacity': 0.85
    }, svg);

    // Animated moving dots along shuttle ring (2 buses) and bike spine
    const ringId = svgId + '-ring-motion';
    svgEl('path', { id: ringId, d: ringD, fill: 'none', stroke: 'none' }, defs);
    [0, 0.5].forEach((offset, idx) => {
      const dot = svgEl('circle', { r: 5.5, fill: COLORS.shuttle, stroke: '#FFFFFF', 'stroke-width': 2 }, svg);
      const am = svgEl('animateMotion', {
        dur: '13s', repeatCount: 'indefinite', begin: `-${offset * 13}s`
      }, dot);
      svgEl('mpath', { href: '#' + ringId }, am);
      if (idx === 0) dot.setAttribute('opacity', '0.98');
    });

    const bikeId = svgId + '-bike-motion';
    svgEl('path', { id: bikeId, d: bikeSpine, fill: 'none', stroke: 'none' }, defs);
    const bikeDot = svgEl('circle', { r: 5, fill: COLORS.cycle, stroke: '#FFFFFF', 'stroke-width': 2 }, svg);
    const amBike = svgEl('animateMotion', { dur: '5.5s', repeatCount: 'indefinite', keyPoints: '0;1;0', keyTimes: '0;0.5;1', calcMode: 'linear' }, bikeDot);
    svgEl('mpath', { href: '#' + bikeId }, amBike);

    // Highlighted campus landmarks (6 key anchors)
    const keyMarks = [
      { key: '汇文楼', label: 'Huiwen', dx: 10, dy: -6, type: 'teach' },
      { key: '斋区', label: 'Zhai Dorms', dx: 10, dy: -4, type: 'dorm' },
      { key: '乔区', label: 'Qiao Dorms', dx: -8, dy: 16, anchor: 'middle', type: 'dorm' },
      { key: '南区', label: 'South Dorms', dx: -8, dy: -10, anchor: 'end', type: 'dorm' },
      { key: '致理楼', label: 'Zhili', dx: 9, dy: 4, type: 'teach' },
      { key: '计软楼', label: 'CS & SE', dx: 9, dy: 5, type: 'teach' },
    ];
    keyMarks.forEach((m) => {
      const p = DATA.places[m.key];
      if (!p) return;
      const g = svgEl('g', { style: 'cursor:pointer' }, svg);
      const col = m.type === 'dorm' ? COLORS.walk : COLORS.ink;
      svgEl('circle', { cx: p.xy[0], cy: p.xy[1], r: 5.5, fill: col, stroke: '#FFFFFF', 'stroke-width': 2 }, g);
      const t = svgEl('text', {
        x: p.xy[0] + (m.dx || 0),
        y: p.xy[1] + (m.dy || 0),
        fill: COLORS.ink,
        'font-size': 12,
        'font-weight': 700,
        'text-anchor': m.anchor || 'start',
        'paint-order': 'stroke',
        stroke: '#FAF7F0',
        'stroke-width': 3.5,
        'stroke-linejoin': 'round'
      }, g);
      t.textContent = m.label;

      g.addEventListener('mouseenter', (e) => {
        showTooltip(e, `<div class="tt-title">${p.en}</div><div>${m.type === 'dorm' ? 'Residential Hub' : 'Teaching Building'} · Yuehai Campus</div>`);
      });
      g.addEventListener('mousemove', moveTooltip);
      g.addEventListener('mouseleave', hideTooltip);
    });

    // Shuttle stop ticks
    DATA.stops.forEach((st) => {
      if (st.name === '北门') return;
      svgEl('circle', {
        cx: st.xy[0], cy: st.xy[1], r: 2.6, fill: '#FFFFFF', stroke: COLORS.shuttle, 'stroke-width': 1.5
      }, svg);
    });
  }

  // ------------------------------------------------------------------------
  // SLIDE 9: Head-to-Head Grouped Bar Chart (4 Iconic Routes)
  // ------------------------------------------------------------------------
  let h2hMode = 'peak'; // 'peak' or 'off'
  function renderHeadToHead(animate = true) {
    const svg = document.getElementById('chart-h2h');
    if (!svg || !DATA) return;
    svg.innerHTML = '';

    const W = 1080, H = 370;
    const pad = { top: 24, right: 32, bottom: 56, left: 60 };
    const iw = W - pad.left - pad.right;
    const ih = H - pad.top - pad.bottom;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

    const maxY = 25;
    const yOf = (v) => pad.top + ih - (v / maxY) * ih;

    // Recessive solid 1px horizontal gridlines (per dataviz skill)
    [0, 5, 10, 15, 20, 25].forEach((tick) => {
      const y = yOf(tick);
      svgEl('line', {
        x1: pad.left, x2: W - pad.right, y1: y, y2: y,
        stroke: tick === 0 ? 'rgba(28,26,23,0.28)' : COLORS.grid,
        'stroke-width': 1
      }, svg);
      const t = svgEl('text', {
        x: pad.left - 12, y: y + 4, 'text-anchor': 'end',
        fill: COLORS.muted, 'font-size': 12, 'font-family': 'var(--font-mono)'
      }, svg);
      t.textContent = tick + 'm';
    });

    // 10-min evening break reference line (label placed cleanly on open left-mid space with halo)
    const y10 = yOf(10);
    svgEl('line', {
      x1: pad.left, x2: W - pad.right, y1: y10, y2: y10,
      stroke: COLORS.red, 'stroke-width': 1.3, 'stroke-opacity': 0.55
    }, svg);
    svgEl('rect', {
      x: pad.left + 8, y: y10 - 22, width: 122, height: 18, rx: 4,
      fill: '#FFFFFF', 'fill-opacity': 0.92
    }, svg);
    svgEl('text', {
      x: pad.left + 14, y: y10 - 9, 'text-anchor': 'start',
      fill: COLORS.red, 'font-size': 11.5, 'font-weight': 700
    }, svg).textContent = '10 min class break';

    const routes = DATA.featured;
    const groupW = iw / routes.length;
    const barW = 24; // <= 24px spec from dataviz skill
    const gap = 8;
    const totalBarsW = 3 * barW + 2 * gap;

    routes.forEach((r, gi) => {
      const gx = pad.left + gi * groupW + (groupW - totalBarsW) / 2;
      const bikeVal = h2hMode === 'peak' ? r.bike_peak : r.bike_off;
      const shuttleVal = h2hMode === 'peak' ? r.shuttle_4w : r.shuttle_0w;

      const items = [
        { key: 'walk', label: 'Walk', val: r.walk, color: COLORS.walk },
        { key: 'cycle', label: h2hMode === 'peak' ? 'Cycle (peak)' : 'Cycle (off-peak)', val: bikeVal, color: COLORS.cycle },
        { key: 'shuttle', label: h2hMode === 'peak' ? 'Shuttle (+4m wait)' : 'Shuttle (0m wait)', val: shuttleVal, color: COLORS.shuttle },
      ];

      items.forEach((it, bi) => {
        const bx = gx + bi * (barW + gap);
        const targetH = (it.val / maxY) * ih;
        const targetY = pad.top + ih - targetH;

        // 4px rounded top corners, square baseline using path
        const makeBarPath = (x, y, w, h) => {
          const rad = Math.min(4, h);
          if (h <= 0.5) return `M${x},${pad.top + ih} H${x + w} Z`;
          return `M${x},${y + h} V${y + rad} Q${x},${y} ${x + rad},${y} H${x + w - rad} Q${x + w},${y} ${x + w},${y + rad} V${y + h} Z`;
        };

        const path = svgEl('path', {
          d: animate ? makeBarPath(bx, pad.top + ih, barW, 0) : makeBarPath(bx, targetY, barW, targetH),
          fill: it.color,
          style: 'cursor:pointer; transition: opacity 0.2s ease;'
        }, svg);

        if (animate) {
          const delay = gi * 70 + bi * 45;
          setTimeout(() => {
            const t0 = performance.now();
            const dur = 750;
            function step(now) {
              const p = Math.min(1, (now - t0) / dur);
              const e = 1 - Math.pow(1 - p, 4);
              const ch = targetH * e;
              path.setAttribute('d', makeBarPath(bx, pad.top + ih - ch, barW, ch));
              if (p < 1) requestAnimationFrame(step);
            }
            requestAnimationFrame(step);
          }, delay);
        }

        // Selective direct label on top of Cycle (winner) and Walk/Shuttle extremes
        const lbl = svgEl('text', {
          x: bx + barW / 2,
          y: targetY - 7,
          'text-anchor': 'middle',
          fill: it.key === 'cycle' ? COLORS.ink : COLORS.muted,
          'font-size': it.key === 'cycle' ? 12.5 : 11.5,
          'font-weight': it.key === 'cycle' ? 800 : 600,
          'font-family': 'var(--font-mono)',
          opacity: animate ? 0 : 1,
          style: 'transition: opacity 0.45s ease'
        }, svg);
        lbl.textContent = it.val.toFixed(1);
        if (animate) setTimeout(() => { lbl.setAttribute('opacity', '1'); }, 480 + gi * 60);

        // Hover hit target
        const hit = svgEl('rect', {
          x: bx - 3, y: pad.top, width: barW + 6, height: ih,
          fill: 'transparent', style: 'cursor:pointer'
        }, svg);
        hit.addEventListener('mouseenter', (e) => {
          path.style.opacity = '0.82';
          showTooltip(e,
            `<div class="tt-title">${r.from} → ${r.to}</div>` +
            `<div class="tt-row"><span>${it.label}</span><strong>${it.val.toFixed(1)} min</strong></div>` +
            `<div class="tt-row"><span>Distance</span><span>${r.dist_m} m (+${r.ascent_m}m climb)</span></div>`
          );
        });
        hit.addEventListener('mousemove', moveTooltip);
        hit.addEventListener('mouseleave', () => { path.style.opacity = '1'; hideTooltip(); });
      });

      // X-axis route label + distance subtitle
      const cx = gx + totalBarsW / 2;
      svgEl('text', {
        x: cx, y: pad.top + ih + 22, 'text-anchor': 'middle',
        fill: COLORS.ink, 'font-size': 13.5, 'font-weight': 700
      }, svg).textContent = `${r.from} → ${r.to}`;
      svgEl('text', {
        x: cx, y: pad.top + ih + 40, 'text-anchor': 'middle',
        fill: COLORS.muted, 'font-size': 12
      }, svg).textContent = `${r.tag} · ${r.dist_m} m`;
    });

    // Populate accessible table
    const tbody = document.getElementById('table-h2h-body');
    if (tbody) {
      tbody.innerHTML = routes.map((r) => `
        <tr>
          <td>${r.from} → ${r.to}</td>
          <td class="num">${r.dist_m} m</td>
          <td class="num">${r.walk.toFixed(1)} min</td>
          <td class="num">${r.bike_off.toFixed(1)} / ${r.bike_peak.toFixed(1)} min</td>
          <td class="num">${r.shuttle_0w.toFixed(1)} / ${r.shuttle_4w.toFixed(1)} min</td>
        </tr>
      `).join('');
    }
  }

  // ------------------------------------------------------------------------
  // SLIDE 10: Slope & Crowd Curve (Line Chart: Walk vs Cycle Speed vs Grade)
  // ------------------------------------------------------------------------
  function renderSlopeChart(animate = true) {
    const svg = document.getElementById('chart-slope');
    if (!svg || !DATA) return;
    svg.innerHTML = '';

    const W = 720, H = 370;
    const pad = { top: 34, right: 126, bottom: 52, left: 52 };
    const iw = W - pad.left - pad.right;
    const ih = H - pad.top - pad.bottom;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

    const pts = DATA.grade_series;
    const minG = -5, maxG = 6, maxV = 24;
    const xOf = (g) => pad.left + ((g - minG) / (maxG - minG)) * iw;
    const yOf = (v) => pad.top + ih - (v / maxV) * ih;

    // Subtle shaded zones: downhill vs uphill
    svgEl('rect', {
      x: pad.left, y: pad.top, width: xOf(0) - pad.left, height: ih,
      fill: 'rgba(11, 143, 134, 0.045)'
    }, svg);
    svgEl('rect', {
      x: xOf(0), y: pad.top, width: pad.left + iw - xOf(0), height: ih,
      fill: 'rgba(200, 40, 40, 0.04)'
    }, svg);
    svgEl('text', { x: pad.left + 10, y: pad.top + ih - 10, fill: COLORS.muted, 'font-size': 11, 'font-weight': 700 }, svg).textContent = '← DOWNHILL';
    svgEl('text', { x: pad.left + iw - 10, y: pad.top + ih - 10, 'text-anchor': 'end', fill: COLORS.muted, 'font-size': 11, 'font-weight': 700 }, svg).textContent = 'UPHILL →';

    // Gridlines
    [0, 5, 10, 15, 20].forEach((v) => {
      const y = yOf(v);
      svgEl('line', { x1: pad.left, x2: pad.left + iw, y1: y, y2: y, stroke: v === 0 ? 'rgba(28,26,23,0.28)' : COLORS.grid, 'stroke-width': 1 }, svg);
      svgEl('text', { x: pad.left - 10, y: y + 4, 'text-anchor': 'end', fill: COLORS.muted, 'font-size': 11.5, 'font-family': 'var(--font-mono)' }, svg).textContent = v + '';
    });
    svgEl('text', { x: pad.left - 10, y: pad.top - 10, 'text-anchor': 'end', fill: COLORS.muted, 'font-size': 11, 'font-weight': 700 }, svg).textContent = 'km/h';

    // Zero grade vertical axis
    svgEl('line', { x1: xOf(0), x2: xOf(0), y1: pad.top, y2: pad.top + ih, stroke: 'rgba(28,26,23,0.22)', 'stroke-width': 1 }, svg);

    // X ticks
    [-4, -2, 0, 2, 4, 6].forEach((g) => {
      svgEl('text', {
        x: xOf(g), y: pad.top + ih + 22, 'text-anchor': 'middle',
        fill: g === 0 ? COLORS.ink : COLORS.muted,
        'font-weight': g === 0 ? 700 : 500,
        'font-size': 12, 'font-family': 'var(--font-mono)'
      }, svg).textContent = (g > 0 ? '+' : '') + g + '%';
    });
    svgEl('text', { x: pad.left + iw / 2, y: H - 8, 'text-anchor': 'middle', fill: COLORS.muted, 'font-size': 12 }, svg).textContent = 'Road grade (slope)';

    const makeLine = (key) => pts.map((p, i) => (i === 0 ? 'M' : 'L') + xOf(p.g).toFixed(1) + ',' + yOf(p[key]).toFixed(1)).join(' ');

    // Subtle 10% area wash under Cycle
    const cycleD = makeLine('bike');
    const areaD = cycleD + ` L${xOf(6).toFixed(1)},${yOf(0).toFixed(1)} L${xOf(-5).toFixed(1)},${yOf(0).toFixed(1)} Z`;
    svgEl('path', { d: areaD, fill: COLORS.cycle, 'fill-opacity': 0.08 }, svg);

    // Lines (2px round cap per dataviz spec)
    const bikePath = svgEl('path', {
      d: cycleD, fill: 'none', stroke: COLORS.cycle, 'stroke-width': 2.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'
    }, svg);
    const walkPath = svgEl('path', {
      d: makeLine('walk'), fill: 'none', stroke: COLORS.walk, 'stroke-width': 2.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'
    }, svg);

    if (animate) {
      [bikePath, walkPath].forEach((p, idx) => {
        const len = p.getTotalLength();
        p.style.strokeDasharray = len;
        p.style.strokeDashoffset = len;
        p.getBoundingClientRect();
        p.style.transition = `stroke-dashoffset 1.15s cubic-bezier(0.16, 1, 0.3, 1) ${idx * 140}ms`;
        p.style.strokeDashoffset = '0';
      });
    }

    // Selective endpoint + 0% markers (r=4.5 with 2px white surface ring)
    const last = pts[pts.length - 1];
    const flat = pts.find((p) => p.g === 0);
    [
      { g: -4, v: pts.find(p => p.g === -4).bike, col: COLORS.cycle, txt: '19.4' },
      { g: 0, v: flat.bike, col: COLORS.cycle, txt: '15.8' },
      { g: 6, v: last.bike, col: COLORS.cycle, txt: '11.5 km/h', end: true, name: 'Cycle' },
      { g: 0, v: flat.walk, col: COLORS.walk, txt: '4.5' },
      { g: 6, v: last.walk, col: COLORS.walk, txt: '4.3 km/h', end: true, name: 'Walk' },
    ].forEach((m) => {
      svgEl('circle', { cx: xOf(m.g), cy: yOf(m.v), r: 4.8, fill: m.col, stroke: '#FFFFFF', 'stroke-width': 2 }, svg);
      if (m.end) {
        svgEl('text', { x: xOf(m.g) + 10, y: yOf(m.v) + 4, fill: COLORS.ink, 'font-size': 12.5, 'font-weight': 700 }, svg).textContent = `${m.name} ${m.txt}`;
      } else {
        svgEl('text', { x: xOf(m.g), y: yOf(m.v) - 11, 'text-anchor': 'middle', fill: COLORS.inkSec, 'font-size': 11.5, 'font-weight': 700, 'font-family': 'var(--font-mono)' }, svg).textContent = m.txt;
      }
    });

    // Interactive hover crosshair
    const cross = svgEl('line', { y1: pad.top, y2: pad.top + ih, stroke: COLORS.ink, 'stroke-width': 1, 'stroke-opacity': 0.3, visibility: 'hidden' }, svg);
    const dotB = svgEl('circle', { r: 5.5, fill: COLORS.cycle, stroke: '#FFFFFF', 'stroke-width': 2, visibility: 'hidden' }, svg);
    const dotW = svgEl('circle', { r: 5.5, fill: COLORS.walk, stroke: '#FFFFFF', 'stroke-width': 2, visibility: 'hidden' }, svg);

    const overlay = svgEl('rect', { x: pad.left, y: pad.top, width: iw, height: ih, fill: 'transparent', style: 'cursor:crosshair' }, svg);
    overlay.addEventListener('mousemove', (e) => {
      const rect = svg.getBoundingClientRect();
      const mx = ((e.clientX - rect.left) / rect.width) * W;
      let best = pts[0], bestD = Infinity;
      pts.forEach((p) => {
        const d = Math.abs(xOf(p.g) - mx);
        if (d < bestD) { bestD = d; best = p; }
      });
      const x = xOf(best.g);
      cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
      dotB.setAttribute('cx', x); dotB.setAttribute('cy', yOf(best.bike)); dotB.setAttribute('visibility', 'visible');
      dotW.setAttribute('cx', x); dotW.setAttribute('cy', yOf(best.walk)); dotW.setAttribute('visibility', 'visible');
      showTooltip(e,
        `<div class="tt-title">Slope ${best.g > 0 ? '+' : ''}${best.g}%</div>` +
        `<div class="tt-row"><span>Cycle speed</span><strong>${best.bike.toFixed(1)} km/h</strong></div>` +
        `<div class="tt-row"><span>Walk speed</span><strong>${best.walk.toFixed(1)} km/h</strong></div>`
      );
    });
    overlay.addEventListener('mouseleave', () => {
      cross.setAttribute('visibility', 'hidden');
      dotB.setAttribute('visibility', 'hidden');
      dotW.setAttribute('visibility', 'hidden');
      hideTooltip();
    });

    const tbody = document.getElementById('table-slope-body');
    if (tbody) {
      tbody.innerHTML = pts.filter((p) => p.g % 2 === 0).map((p) => `
        <tr>
          <td>${p.g > 0 ? '+' : ''}${p.g}%</td>
          <td class="num">${p.walk.toFixed(1)} km/h</td>
          <td class="num">${p.bike.toFixed(1)} km/h</td>
        </tr>
      `).join('');
    }
  }

  // ------------------------------------------------------------------------
  // SLIDE 11: Shuttle Door-to-Door Time Anatomy (Horizontal Stacked Bars)
  // ------------------------------------------------------------------------
  function renderShuttleAnatomy(animate = true) {
    const svg = document.getElementById('chart-shuttle');
    if (!svg) return;
    svg.innerHTML = '';

    const W = 720, H = 370;
    const pad = { top: 28, right: 86, bottom: 44, left: 152 };
    const iw = W - pad.left - pad.right;
    const ih = H - pad.top - pad.bottom;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

    const rows = [
      { name: 'Zhai → Huiwen', sub: '651 m · Mid', to: 4.8, wait: 4.1, ride: 1.1, from: 2.5, walkRef: 8.8 },
      { name: 'Zhai → Zhili', sub: '954 m · South walk', to: 3.3, wait: 4.1, ride: 1.0, from: 6.9, walkRef: 12.6 },
      { name: 'Huiwen → Zhili', sub: '1,378 m · Long', to: 2.4, wait: 4.1, ride: 7.4, from: 7.2, walkRef: 19.0 },
      { name: 'Qiao → Huiwen', sub: '1,411 m · Shuttle wins!', to: 2.0, wait: 4.1, ride: 3.9, from: 2.5, walkRef: 18.2 },
    ];
    const segColors = {
      to: '#AE700E',
      wait: '#C82828',
      ride: '#6A55D6',
      from: '#D4A048',
    };

    const maxX = 24;
    const xOf = (v) => pad.left + (v / maxX) * iw;

    // Vertical gridlines
    [0, 5, 10, 15, 20].forEach((t) => {
      const x = xOf(t);
      svgEl('line', { x1: x, x2: x, y1: pad.top, y2: pad.top + ih, stroke: t === 0 ? 'rgba(28,26,23,0.28)' : COLORS.grid, 'stroke-width': 1 }, svg);
      svgEl('text', { x, y: pad.top + ih + 22, 'text-anchor': 'middle', fill: COLORS.muted, 'font-size': 12, 'font-family': 'var(--font-mono)' }, svg).textContent = t + 'm';
    });

    const rowH = ih / rows.length;
    const barH = 26;

    rows.forEach((r, idx) => {
      const cy = pad.top + idx * rowH + rowH / 2;
      const by = cy - barH / 2;
      const wx = xOf(r.walkRef);

      svgEl('text', { x: pad.left - 14, y: cy - 3, 'text-anchor': 'end', fill: COLORS.ink, 'font-size': 13.5, 'font-weight': 700 }, svg).textContent = r.name;
      svgEl('text', { x: pad.left - 14, y: cy + 13, 'text-anchor': 'end', fill: idx === 3 ? COLORS.cycle : COLORS.muted, 'font-size': 11.5, 'font-weight': idx === 3 ? 700 : 500 }, svg).textContent = r.sub;

      const segs = [
        { k: 'to', lbl: 'Walk to stop', v: r.to, c: segColors.to },
        { k: 'wait', lbl: 'Expected wait', v: r.wait, c: segColors.wait },
        { k: 'ride', lbl: 'On shuttle', v: r.ride, c: segColors.ride },
        { k: 'from', lbl: 'Walk from stop', v: r.from, c: segColors.from },
      ];

      let acc = 0;
      const gapPx = 2; // 2px surface gap per dataviz skill
      segs.forEach((s, si) => {
        const sx = xOf(acc) + (si > 0 ? gapPx : 0);
        const sw = Math.max(0, (s.v / maxX) * iw - (si > 0 ? gapPx : 0));
        acc += s.v;

        const rect = svgEl('rect', {
          x: sx, y: by, width: animate ? 0 : sw, height: barH,
          rx: 4, fill: s.c, style: 'cursor:pointer'
        }, svg);

        if (animate) {
          setTimeout(() => {
            rect.style.transition = `width 0.72s cubic-bezier(0.16, 1, 0.3, 1) ${idx * 90 + si * 75}ms`;
            rect.setAttribute('width', sw.toFixed(1));
          }, 30);
        }

        // Only print inline label when segment comfortably fits AND doesn't collide with direct walk marker
        const midX = sx + sw / 2;
        const collidesWithWalk = Math.abs(midX - wx) < 22;
        if (sw >= 46 && !collidesWithWalk) {
          const txt = svgEl('text', {
            x: midX, y: cy + 4, 'text-anchor': 'middle',
            fill: s.k === 'from' ? '#1C1A17' : '#FFFFFF',
            'font-size': 11, 'font-weight': 700, 'font-family': 'var(--font-mono)',
            'pointer-events': 'none', opacity: animate ? 0 : 1,
            style: 'transition: opacity 0.4s ease'
          }, svg);
          txt.textContent = s.v.toFixed(1) + 'm';
          if (animate) setTimeout(() => txt.setAttribute('opacity', '1'), 560 + idx * 80);
        }

        rect.addEventListener('mouseenter', (e) => {
          showTooltip(e,
            `<div class="tt-title">${r.name} — ${s.lbl}</div>` +
            `<div class="tt-row"><span>Segment</span><strong>${s.v.toFixed(1)} min</strong></div>` +
            `<div class="tt-row"><span>Total shuttle</span><span>${(r.to+r.wait+r.ride+r.from).toFixed(1)} min</span></div>` +
            `<div class="tt-row"><span>Direct walk</span><span>${r.walkRef.toFixed(1)} min</span></div>`
          );
        });
        rect.addEventListener('mousemove', moveTooltip);
        rect.addEventListener('mouseleave', hideTooltip);
      });

      const totalMin = r.to + r.wait + r.ride + r.from;
      // Direct walk reference marker (tick + dot)
      svgEl('line', {
        x1: wx, x2: wx, y1: by - 6, y2: by + barH + 6,
        stroke: COLORS.ink, 'stroke-width': 2
      }, svg);
      svgEl('circle', {
        cx: wx, cy: by - 6, r: 3.5, fill: COLORS.ink, stroke: '#FFFFFF', 'stroke-width': 1.5
      }, svg);

      // Total shuttle label right at bar end
      svgEl('text', {
        x: xOf(totalMin) + 8, y: cy + 4,
        fill: COLORS.ink, 'font-size': 12.5, 'font-weight': 800, 'font-family': 'var(--font-mono)'
      }, svg).textContent = totalMin.toFixed(1) + 'm';

      // On the winning row (Qiao -> Huiwen), label the walk marker clearly to show the 5.7m savings
      if (r.walkRef > totalMin + 2) {
        svgEl('text', {
          x: wx + 7, y: cy + 4,
          fill: COLORS.muted, 'font-size': 11.5, 'font-weight': 700, 'font-family': 'var(--font-mono)'
        }, svg).textContent = `${r.walkRef.toFixed(1)}m walk`;
      }
    });

    // Direct walk reference legend note inside chart top-right
    svgEl('line', { x1: W - 210, x2: W - 210, y1: 6, y2: 18, stroke: COLORS.ink, 'stroke-width': 2 }, svg);
    svgEl('circle', { cx: W - 210, cy: 6, r: 3, fill: COLORS.ink }, svg);
    svgEl('text', { x: W - 200, y: 15, fill: COLORS.inkSec, 'font-size': 11.5, 'font-weight': 600 }, svg).textContent = 'Direct walk time (marker)';

    const tbody = document.getElementById('table-shuttle-body');
    if (tbody) {
      tbody.innerHTML = rows.map((r) => `
        <tr>
          <td>${r.name}</td>
          <td class="num">${r.to.toFixed(1)}m</td>
          <td class="num">${r.wait.toFixed(1)}m</td>
          <td class="num">${r.ride.toFixed(1)}m</td>
          <td class="num">${r.from.toFixed(1)}m</td>
          <td class="num"><strong>${(r.to+r.wait+r.ride+r.from).toFixed(1)}m</strong></td>
          <td class="num">${r.walkRef.toFixed(1)}m</td>
        </tr>
      `).join('');
    }
  }

  // ------------------------------------------------------------------------
  // SLIDE 12: Reach & Break Feasibility (Isochrone Concentric Visual + Bars)
  // ------------------------------------------------------------------------
  function renderReachVisual(animate = true) {
    const svg = document.getElementById('chart-reach');
    if (!svg) return;
    svg.innerHTML = '';

    const W = 720, H = 370;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

    // Left: Concentric 5-min & 10-min Reach from Zhai Dorms (19 destinations)
    const cx = 195, cy = 180;
    // Outer ring = 10 min Bike (19/19)
    const rings = [
      { r: 122, col: COLORS.cycle, fillOp: 0.08, strokeOp: 0.55 },
      { r: 96, col: COLORS.cycle, fillOp: 0.12, strokeOp: 0.85 },
      { r: 68, col: COLORS.walk, fillOp: 0.11, strokeOp: 0.75 },
      { r: 38, col: COLORS.walk, fillOp: 0.18, strokeOp: 0.95 },
    ];
    rings.forEach((rg, idx) => {
      const c = svgEl('circle', {
        cx, cy, r: animate ? 6 : rg.r,
        fill: rg.col, 'fill-opacity': rg.fillOp,
        stroke: rg.col, 'stroke-width': 2, 'stroke-opacity': rg.strokeOp
      }, svg);
      if (animate) {
        setTimeout(() => {
          c.style.transition = `r 0.85s cubic-bezier(0.16, 1, 0.3, 1) ${idx * 90}ms`;
          c.setAttribute('r', rg.r);
        }, 40);
      }
    });
    // Center origin dot
    svgEl('circle', { cx, cy, r: 7, fill: COLORS.ink, stroke: '#FFFFFF', 'stroke-width': 2.5 }, svg);
    svgEl('text', { x: cx, y: cy + 22, 'text-anchor': 'middle', fill: COLORS.ink, 'font-size': 12, 'font-weight': 800 }, svg).textContent = 'Zhai Dorms';
    // Clean pill callouts for rings (neutral ink text + colored swatch per dataviz rules)
    svgEl('circle', { cx: cx - 88, cy: 30, r: 4.5, fill: COLORS.cycle }, svg);
    svgEl('text', { x: cx - 78, y: 34, fill: COLORS.ink, 'font-size': 12, 'font-weight': 700 }, svg).textContent = 'Cycle: 18/19 (5m) · 19/19 (10m)';
    svgEl('circle', { cx: cx - 76, cy: 332, r: 4.5, fill: COLORS.walk }, svg);
    svgEl('text', { x: cx - 66, y: 336, fill: COLORS.ink, 'font-size': 12, 'font-weight': 700 }, svg).textContent = 'Walk: 4/19 (5m) · 11/19 (10m)';
    svgEl('text', { x: cx, y: 356, 'text-anchor': 'middle', fill: COLORS.muted, 'font-size': 11.5 }, svg).textContent = 'Hubs reachable from Zhai Dorms';

    // Right: Teaching-to-Teaching Break Feasibility (30 directed pairs)
    const rx = 388, rw = 296;
    svgEl('text', { x: rx, y: 42, fill: COLORS.ink, 'font-size': 15, 'font-weight': 800 }, svg).textContent = 'Between Teaching Buildings (30 pairs)';
    svgEl('text', { x: rx, y: 60, fill: COLORS.muted, 'font-size': 12 }, svg).textContent = 'Share of class transfers reachable within break window';

    const windows = [
      { label: '5-min break', walk: 6, bike: 14 },
      { label: '10-min break', walk: 12, bike: 30 },
      { label: '20-min break', walk: 26, bike: 30 },
    ];
    windows.forEach((w, idx) => {
      const y0 = 96 + idx * 82;
      svgEl('text', { x: rx, y: y0, fill: COLORS.ink, 'font-size': 13.5, 'font-weight': 700 }, svg).textContent = w.label;

      // Cycle bar
      const bw = (w.bike / 30) * (rw - 72);
      svgEl('rect', { x: rx, y: y0 + 10, width: rw - 72, height: 15, rx: 4, fill: 'rgba(28,26,23,0.07)' }, svg);
      const bf = svgEl('rect', { x: rx, y: y0 + 10, width: animate ? 0 : bw, height: 15, rx: 4, fill: COLORS.cycle }, svg);
      svgEl('text', { x: rx + rw - 64, y: y0 + 22, fill: COLORS.ink, 'font-size': 12, 'font-weight': 700, 'font-family': 'var(--font-mono)' }, svg).textContent = `${w.bike}/30`;

      // Walk bar
      const ww = (w.walk / 30) * (rw - 72);
      svgEl('rect', { x: rx, y: y0 + 31, width: rw - 72, height: 15, rx: 4, fill: 'rgba(28,26,23,0.07)' }, svg);
      const wf = svgEl('rect', { x: rx, y: y0 + 31, width: animate ? 0 : ww, height: 15, rx: 4, fill: COLORS.walk }, svg);
      svgEl('text', { x: rx + rw - 64, y: y0 + 43, fill: COLORS.inkSec, 'font-size': 12, 'font-weight': 600, 'font-family': 'var(--font-mono)' }, svg).textContent = `${w.walk}/30`;

      if (animate) {
        setTimeout(() => {
          bf.style.transition = `width 0.8s cubic-bezier(0.16, 1, 0.3, 1) ${idx * 100}ms`;
          wf.style.transition = `width 0.8s cubic-bezier(0.16, 1, 0.3, 1) ${idx * 100 + 80}ms`;
          bf.setAttribute('width', bw.toFixed(1));
          wf.setAttribute('width', ww.toFixed(1));
        }, 50);
      }
    });
  }

  // ------------------------------------------------------------------------
  // SLIDE 15: Interactive Campus Route Advisor
  // ------------------------------------------------------------------------
  function initAdvisor() {
    const selO = document.getElementById('adv-origin');
    const selD = document.getElementById('adv-dest');
    const togglePeak = document.getElementById('adv-peak-toggle');
    if (!selO || !selD || !DATA) return;

    const origins = [...new Set(DATA.matrix.map((m) => m.o))];
    const dests = [...new Set(DATA.matrix.map((m) => m.d))];
    selO.innerHTML = origins.map((o) => `<option value="${o}">${o}</option>`).join('');
    selD.innerHTML = dests.map((d) => `<option value="${d}">${d}</option>`).join('');
    selO.value = 'Qiao Dorms';
    selD.value = 'Huiwen Bldg';

    let isPeak = true;

    function updateAdvisor() {
      let o = selO.value;
      let d = selD.value;
      if (o === d) {
        d = dests.find((x) => x !== o);
        selD.value = d;
      }
      const row = DATA.matrix.find((m) => m.o === o && m.d === d);
      if (!row) return;

      const w = row.w;
      const b = isPeak ? row.bp : row.bo;
      const s = isPeak ? row.s4 : row.s0;
      const maxT = Math.max(w, b, s, 16);

      document.getElementById('adv-bar-walk').style.width = (w / maxT * 100).toFixed(1) + '%';
      document.getElementById('adv-val-walk').textContent = w.toFixed(1) + ' min';
      document.getElementById('adv-bar-cycle').style.width = (b / maxT * 100).toFixed(1) + '%';
      document.getElementById('adv-val-cycle').textContent = b.toFixed(1) + ' min';
      document.getElementById('adv-bar-shuttle').style.width = (s / maxT * 100).toFixed(1) + '%';
      document.getElementById('adv-val-shuttle').textContent = s.toFixed(1) + ' min';

      let rec = '';
      if (row.dist < 500) {
        rec = `<strong>Walk (${w.toFixed(1)}m)</strong> — under 500 m, walking avoids bike parking friction and beats the shuttle by ${(s - w).toFixed(1)} min.`;
      } else if (s < w - 2.5) {
        rec = `<strong>Cycle (${b.toFixed(1)}m)</strong> is fastest; <strong>Shuttle (${s.toFixed(1)}m)</strong> is a solid rain/fatigue backup (beats walking by ${(w - s).toFixed(1)}m).`;
      } else {
        rec = `<strong>Cycle (${b.toFixed(1)}m)</strong> saves ${(w - b).toFixed(1)} min over walking. Skip the shuttle (${row.sw.toFixed(1)}m of stop walking).`;
      }
      document.getElementById('adv-verdict-main').innerHTML = rec;
      document.getElementById('adv-verdict-meta').textContent = `${row.dist} m · +${row.asc}m climb`;
    }

    selO.addEventListener('change', updateAdvisor);
    selD.addEventListener('change', updateAdvisor);
    if (togglePeak) {
      togglePeak.querySelectorAll('.seg-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          togglePeak.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          isPeak = btn.dataset.val === 'peak';
          updateAdvisor();
        });
      });
    }
    updateAdvisor();
  }

  // ------------------------------------------------------------------------
  // Slide 5 Break Bar Animation
  // ------------------------------------------------------------------------
  function animateBreakBars(slide) {
    slide.querySelectorAll('.b-fill[data-w]').forEach((el, idx) => {
      el.style.width = '0%';
      setTimeout(() => {
        el.style.width = el.dataset.w + '%';
      }, 140 + idx * 120);
    });
  }

  // ------------------------------------------------------------------------
  // Slide Navigation Engine
  // ------------------------------------------------------------------------
  const sectionColors = {
    'Cover': COLORS.red,
    'Overview': COLORS.red,
    'Part I · Introduction': COLORS.walk,
    'Part II · Statistics & Analysis': COLORS.cycle,
    'Part III · Results & Recommendations': COLORS.shuttle,
    'Part ? · The End': COLORS.red,
  };

  function goTo(index, instant = false) {
    const next = Math.max(0, Math.min(total - 1, index));
    const dir = next >= current ? 1 : -1;

    slides.forEach((s, i) => {
      s.classList.remove('active', 'exit-left', 'exit-right');
      if (i < next) s.classList.add('exit-left');
      else if (i > next) s.classList.add('exit-right');
    });

    current = next;
    const activeSlide = slides[current];
    activeSlide.classList.add('active');

    // Update persistent editorial chrome
    progressFill.style.width = ((current + 1) / total * 100).toFixed(2) + '%';
    counterEl.textContent = `${String(current + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
    const sec = activeSlide.dataset.section || '';
    sectionLabelEl.textContent = sec;
    brandDotEl.style.background = sectionColors[sec] || COLORS.red;

    // Gently pan ambient topographical contours to create depth across transitions
    const tx = -current * 14;
    const ty = Math.sin(current * 0.6) * 18;
    const rot = (current - 7) * 0.45;
    contoursEl.style.transform = `translate3d(${tx}px, ${ty}px, 0) rotate(${rot}deg)`;

    // Update URL hash cleanly
    if (history.replaceState) {
      history.replaceState(null, '', `#slide-${current + 1}`);
    }

    // Trigger slide-specific kinetic animations
    animateCounters(activeSlide);
    if (activeSlide.id === 's-breaks') animateBreakBars(activeSlide);
    if (activeSlide.id === 's-h2h') renderHeadToHead(!instant);
    if (activeSlide.id === 's-slope') renderSlopeChart(!instant);
    if (activeSlide.id === 's-shuttle') renderShuttleAnatomy(!instant);
    if (activeSlide.id === 's-reach') renderReachVisual(!instant);

    // Close any open data tables on slide change
    document.querySelectorAll('.data-table-overlay.open').forEach((el) => el.classList.remove('open'));
    document.querySelectorAll('.table-toggle-btn[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  }

  // Controls & Keyboard
  document.getElementById('btn-prev').addEventListener('click', () => goTo(current - 1));
  document.getElementById('btn-next').addEventListener('click', () => goTo(current + 1));
  document.getElementById('btn-grid').addEventListener('click', toggleOverview);
  document.getElementById('btn-close-ov').addEventListener('click', toggleOverview);

  // Roadmap cards jump directly to their part
  document.querySelectorAll('.roadmap-card[data-jump]').forEach((card) => {
    card.addEventListener('click', () => goTo(parseInt(card.dataset.jump, 10)));
  });

  // Slide 9 Peak/Off-peak toggle
  const h2hToggle = document.getElementById('h2h-toggle');
  if (h2hToggle) {
    h2hToggle.querySelectorAll('.seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        h2hToggle.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        h2hMode = btn.dataset.val;
        renderHeadToHead(true);
      });
    });
  }

  // Accessible Data Table toggles
  document.querySelectorAll('.table-toggle-btn[data-target]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.target);
      if (!target) return;
      const open = target.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
    });
  });

  function toggleOverview() {
    const isOpen = overviewModal.classList.toggle('open');
    if (isOpen) {
      const grid = document.getElementById('overview-grid');
      grid.innerHTML = slides.map((s, i) => `
        <div class="ov-item ${i === current ? 'current' : ''}" data-idx="${i}">
          <div class="ov-num">${String(i + 1).padStart(2, '0')} · ${s.dataset.section || ''}</div>
          <div class="ov-title">${s.dataset.title || 'Slide ' + (i + 1)}</div>
        </div>
      `).join('');
      grid.querySelectorAll('.ov-item').forEach((item) => {
        item.addEventListener('click', () => {
          toggleOverview();
          goTo(parseInt(item.dataset.idx, 10));
        });
      });
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.target && ['SELECT', 'INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if (e.key === 'Escape' && overviewModal.classList.contains('open')) {
      toggleOverview();
      return;
    }
    if (e.key === 'g' || e.key === 'G') {
      toggleOverview();
      return;
    }
    if (overviewModal.classList.contains('open')) return;

    if (['ArrowRight', ' ', 'PageDown', 'Enter'].includes(e.key)) {
      e.preventDefault();
      goTo(current + 1);
    } else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) {
      e.preventDefault();
      goTo(current - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      goTo(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      goTo(total - 1);
    } else if (e.key === 'f' || e.key === 'F') {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
      else document.exitFullscreen?.();
    }
  });

  // Touch swipe support
  let touchX = 0;
  document.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  document.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 50) goTo(current + (dx < 0 ? 1 : -1));
  }, { passive: true });

  // Render static maps & advisor once on startup
  renderCampusMap('cover-map', { dimRoads: true });
  renderCampusMap('method-map', { dimRoads: false });
  renderHeadToHead(false);
  renderSlopeChart(false);
  renderShuttleAnatomy(false);
  renderReachVisual(false);
  initAdvisor();

  // Initial slide from hash
  const match = location.hash.match(/slide-(\d+)/);
  const startIdx = match ? Math.max(0, Math.min(total - 1, parseInt(match[1], 10) - 1)) : 0;
  goTo(startIdx, true);

  // Expose helper for QA screenshots
  window.__DECK__ = { goTo, total, getCurrent: () => current };
})();

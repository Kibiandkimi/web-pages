// Layout QA: per-slide DOM checks (out of stage, clipped text, overlapping text boxes) + 2×2 contact sheets.
//   NODE_PATH=~/Work/ChineseDungeonSplit4/node_modules node qa.cjs [theme] [slides] [outdir]
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
(async () => {
  const theme = process.argv[2] || 'light';
  const only = process.argv[3] && process.argv[3] !== 'all' ? process.argv[3].split(',').map(Number) : null;
  const out = process.argv[4] || '/tmp/wrw-qa'; fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  await page.addInitScript(t => { try { localStorage.setItem('wrw-theme', t); } catch (e) {} }, theme);
  await page.goto('file://' + path.join(__dirname, 'index.html') + '#1');
  await page.waitForTimeout(1500);
  const N = await page.evaluate(() => window.DECK.N);
  const waits = { 6: 9000, 7: 4500, 9: 11500, 12: 3500 };
  const shots = [];
  for (let i = 1; i <= N; i++) {
    if (only && !only.includes(i)) continue;
    await page.evaluate(n => window.DECK.go(n - 1, { instant: true }), i);
    await page.waitForTimeout(waits[i] || 3600);
    const issues = await page.evaluate(() => {
      const S = document.querySelector('.slide.active'), st = document.getElementById('stage').getBoundingClientRect();
      const sc = st.width / 1600, R = el => { const r = el.getBoundingClientRect(); return { x: (r.left - st.left) / sc, y: (r.top - st.top) / sc, w: r.width / sc, h: r.height / sc }; };
      const vis = el => { const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > .05 && el.getClientRects().length; };
      const name = el => (el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '') + ' "' + (el.textContent || '').trim().slice(0, 40) + '"');
      const res = [];
      // leaf-ish text elements
      const texts = [...S.querySelectorAll('*')].filter(el => !el.closest('aside.notes') && !(el.closest('svg') && el.tagName !== 'text') && vis(el) &&
        [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()));
      for (const el of texts) {
        const r = R(el);
        if (r.x < 40 || r.y < 70 || r.x + r.w > 1560 || r.y + r.h > 832) res.push(`edge: ${name(el)} @ ${r.x|0},${r.y|0} ${r.w|0}×${r.h|0}`);
        if (el.tagName !== 'text' && (el.scrollWidth > el.clientWidth + 2) && getComputedStyle(el).overflow !== 'visible') res.push(`clipped: ${name(el)}`);
      }
      // pairwise overlaps between text boxes that are not ancestor/descendant
      const boxes = texts.map(el => [el, R(el)]);
      for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
        const [ea, ra] = boxes[a], [eb, rb] = boxes[b];
        if (ea.contains(eb) || eb.contains(ea)) continue;
        const ox = Math.min(ra.x + ra.w, rb.x + rb.w) - Math.max(ra.x, rb.x), oy = Math.min(ra.y + ra.h, rb.y + rb.h) - Math.max(ra.y, rb.y);
        if (ox > 3 && oy > 3) res.push(`overlap: ${name(ea)} × ${name(eb)} (${ox|0}×${oy|0})`);
      }
      return res;
    });
    console.log(`--- slide ${i}: ${issues.length ? '\n  ' + issues.join('\n  ') : 'ok'}`);
    const f = `${out}/${theme}-${String(i).padStart(2, '0')}.png`; await page.screenshot({ path: f }); shots.push(f);
  }
  // metro labels
  const lab = await page.evaluate(() => [...document.querySelectorAll('#metro .lab')].map(l => { const r = l.getBoundingClientRect(); return [l.textContent, r.left | 0, r.right | 0]; }));
  for (let k = 1; k < lab.length; k++) if (lab[k][1] < lab[k - 1][2] + 8) console.log('metro label collision:', lab[k - 1][0], '/', lab[k][0]);
  // contact sheets, 2×2 at half size
  for (let k = 0; k < shots.length; k += 4) {
    const grp = shots.slice(k, k + 4);
    const html = `<body style="margin:0;display:grid;grid-template-columns:800px 800px;gap:0;background:#888">${grp.map(f => `<div style="position:relative"><img src="file://${f}" style="width:800px;height:450px;display:block"><b style="position:absolute;left:6px;top:4px;font:bold 18px sans-serif;color:#d00">${path.basename(f, '.png')}</b></div>`).join('')}</body>`;
    fs.writeFileSync(`${out}/sheet.html`, html);
    const p2 = await browser.newPage({ viewport: { width: 1600, height: grp.length > 2 ? 900 : 450 } });
    await p2.goto('file://' + out + '/sheet.html'); await p2.waitForTimeout(300);
    await p2.screenshot({ path: `${out}/sheet-${theme}-${k / 4 + 1}.png` }); await p2.close();
  }
  console.log(errors.length ? errors.join('\n') : 'no console errors');
  await browser.close();
})();

// Screenshot every slide and report console errors.
//   NODE_PATH=~/Work/ChineseDungeonSplit4/node_modules node shoot.cjs [file] [outdir] [theme] [slides]
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const file = path.resolve(process.argv[2] || path.join(__dirname, 'index.html'));
  const out = process.argv[3] || '/tmp/wrw';
  const theme = process.argv[4] || 'light';
  const only = process.argv[5] ? process.argv[5].split(',').map(Number) : null;
  require('fs').mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  await page.addInitScript(t => { try { localStorage.setItem('wrw-theme', t); } catch (e) {} }, theme);
  await page.goto('file://' + file + '#1');
  await page.waitForTimeout(1500);
  const N = await page.evaluate(() => window.DECK ? window.DECK.N : 0);
  const waits = { 6: 9000, 7: 4500, 9: 11500, 12: 3500 };
  for (let i = 1; i <= N; i++) {
    if (only && !only.includes(i)) continue;
    await page.evaluate(n => window.DECK.go(n - 1, { instant: true }), i);
    await page.waitForTimeout(waits[i] || 3600);
    await page.screenshot({ path: `${out}/${theme}-${String(i).padStart(2, '0')}.png` });
  }
  console.log(`slides: ${N}`);
  console.log(errors.length ? errors.join('\n') : 'no console errors');
  await browser.close();
})();

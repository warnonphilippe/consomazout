// Vidéo de présentation de ConsoMazout, tournée en pilotant l'application Electron avec Playwright.
//   npm run video     (build de production, enregistrement, conversion MP4)
// Sortie : docs/video/consomazout-presentation.mp4
//
// Les données de démonstration sont chargées dans un dossier temporaire (CONSOMAZOUT_USER_DATA) :
// les données réelles de l'utilisateur ne sont jamais touchées.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = join(ROOT, 'docs', 'video');
const OUT_FILE = join(OUT_DIR, 'consomazout-presentation.mp4');
const SIZE = { width: 1440, height: 900 };
/** Résolution de la vidéo (fenêtre 1440×900 capturée en Retina, réduite en 1920×1200). */
const VIDEO = { width: 1920, height: 1200 };

const userData = mkdtempSync(join(tmpdir(), 'consomazout-video-'));
const rawDir = mkdtempSync(join(tmpdir(), 'consomazout-video-raw-'));

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function launch() {
  const app = await electron.launch({
    args: ['.'],
    cwd: ROOT,
    env: { ...process.env, CONSOMAZOUT_USER_DATA: userData },
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(20_000);
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setContentSize(size.width, size.height);
    win.center();
  }, SIZE);
  await page.waitForSelector('app-root .sidebar');
  return { app, page };
}

// ---------------------------------------------------------------- 1. Données de démonstration
const { app, page } = await launch();
// Date figée : les données de démo dépendent du jour, et à certaines dates la cuve vient d'être remplie
// (plus de place pour montrer un plein). Le 21 octobre 2026, elle est à ~40 cm : la vidéo reste reproductible.
await page.clock.install({ time: new Date(2026, 9, 21, 10, 0) });
await page.reload();
await page.waitForSelector('app-root .sidebar');
await page.click('a[href="/reglages"]');
await page.getByRole('button', { name: 'Charger la démo' }).first().click();
await page.locator('dialog').getByRole('button', { name: 'Charger la démo' }).click();
await page.click('button[title="Thème sombre"]');
await page.click('a[href="/"]');
await page.waitForTimeout(1000);

// ---------------------------------------------------------------- 2. Tournage
// Capture des images par le protocole DevTools (screencast) : chaque image est horodatée,
// puis ffmpeg les assemble en respectant les durées réelles.
const frames = [];
const cdp = await page.context().newCDPSession(page);
cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
  // Écriture immédiate sur disque : garder des milliers d'images en mémoire fait planter la capture.
  const file = join(rawDir, `f${String(frames.length).padStart(6, '0')}.jpg`);
  writeFileSync(file, Buffer.from(data, 'base64'));
  frames.push({ file, time: metadata.timestamp });
  void cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => undefined);
});
app.process().stderr.on('data', (chunk) => {
  const text = String(chunk).trim();
  if (text && !text.startsWith('Debugger') && !text.startsWith('For help')) console.error(`[electron] ${text}`);
});
page.on('crash', () => console.error('[electron] le processus de rendu a planté'));
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: VIDEO.width, maxHeight: VIDEO.height, everyNthFrame: 1 });
const started = Date.now();

/** Curseur et sous-titres dessinés dans la page (la capture vidéo ne montre pas le vrai curseur). */
await page.evaluate(() => {
  const style = document.createElement('style');
  style.textContent = `
    #demo-cursor { position: fixed; left: 0; top: 0; width: 26px; height: 26px; z-index: 99999; pointer-events: none;
      transition: transform 0.55s cubic-bezier(.4,0,.2,1); filter: drop-shadow(0 2px 4px rgba(0,0,0,.45)); }
    #demo-cursor.click::after { content: ''; position: absolute; left: -14px; top: -14px; width: 28px; height: 28px;
      border-radius: 50%; border: 3px solid #f59e0b; animation: demo-ripple .5s ease-out forwards; }
    @keyframes demo-ripple { from { transform: scale(.3); opacity: 1 } to { transform: scale(1.6); opacity: 0 } }
    #demo-caption { position: fixed; left: 50%; bottom: 28px; transform: translate(-50%, 20px); z-index: 99998;
      pointer-events: none; opacity: 0; transition: opacity .35s, transform .35s; max-width: 900px;
      padding: 14px 26px; border-radius: 14px; background: rgba(15, 23, 42, .92); color: #f8fafc;
      border: 1px solid rgba(148, 163, 184, .35); box-shadow: 0 12px 40px rgba(0,0,0,.45);
      font: 600 22px/1.3 ui-sans-serif, system-ui, -apple-system, sans-serif; text-align: center; }
    #demo-caption small { display: block; margin-top: 4px; font-weight: 500; font-size: 16px; color: #cbd5e1; }
    #demo-caption .step { color: #fbbf24; margin-right: 8px; }
    #demo-caption.show { opacity: 1; transform: translate(-50%, 0); }
    #demo-title { position: fixed; inset: 0; z-index: 99997; display: grid; place-items: center; pointer-events: none;
      background: rgba(2, 6, 23, .82); backdrop-filter: blur(6px); opacity: 0; transition: opacity .6s; }
    #demo-title.show { opacity: 1; }
    #demo-title div { text-align: center; color: #f8fafc; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
    #demo-title h1 { font-size: 64px; margin: 18px 0 8px; letter-spacing: -0.02em; }
    #demo-title p { font-size: 24px; color: #cbd5e1; margin: 0; }
    #demo-title .logo { width: 110px; height: 110px; margin: 0 auto; border-radius: 28px; display: grid; place-items: center;
      background: linear-gradient(135deg, #3b82f6, #1d4ed8); box-shadow: 0 12px 40px rgba(37,99,235,.5); }
  `;
  document.head.append(style);
  const cursor = document.createElement('div');
  cursor.id = 'demo-cursor';
  cursor.innerHTML =
    '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2 L4 20 L9 15 L12.5 22 L15.5 20.5 L12 13.8 L19 13.8 Z" fill="#fff" stroke="#0f172a" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  cursor.style.transform = `translate(${innerWidth / 2}px, ${innerHeight / 2}px)`;
  const caption = document.createElement('div');
  caption.id = 'demo-caption';
  const title = document.createElement('div');
  title.id = 'demo-title';
  document.body.append(cursor, caption, title);
});

let cursorX = SIZE.width / 2;
let cursorY = SIZE.height / 2;

async function moveCursor(x, y, ms = 600) {
  cursorX = x;
  cursorY = y;
  await page.evaluate(
    ({ x, y, ms }) => {
      const c = document.getElementById('demo-cursor');
      c.style.transitionDuration = `${ms}ms`;
      c.style.transform = `translate(${x}px, ${y}px)`;
    },
    { x, y, ms },
  );
  await page.mouse.move(x, y);
  await pause(ms + 80);
}

async function pointAt(locator, ms) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  await moveCursor(box.x + Math.min(box.width / 2, 60), box.y + box.height / 2, ms);
}

async function click(locator, wait = 500) {
  await pointAt(locator);
  await page.evaluate(() => {
    const c = document.getElementById('demo-cursor');
    c.classList.remove('click');
    void c.offsetWidth;
    c.classList.add('click');
  });
  await locator.click();
  await pause(wait);
}

async function type(locator, text, { clear = true } = {}) {
  await click(locator, 200);
  if (clear) {
    await locator.fill('');
  }
  await locator.pressSequentially(text, { delay: 90 });
  await pause(400);
}

async function caption(step, text, sub = '') {
  console.log(`[${((Date.now() - started) / 1000).toFixed(1)} s] ${step} ${text}`);
  await page.evaluate(
    ({ step, text, sub }) => {
      const el = document.getElementById('demo-caption');
      el.innerHTML = `${step ? `<span class="step">${step}</span>` : ''}${text}${sub ? `<small>${sub}</small>` : ''}`;
      el.classList.add('show');
    },
    { step, text, sub },
  );
  await pause(2400);
}

async function hideCaption() {
  await page.evaluate(() => document.getElementById('demo-caption').classList.remove('show'));
  await pause(400);
}

async function titleCard(heading, sub, ms) {
  await page.evaluate(
    ({ heading, sub }) => {
      const el = document.getElementById('demo-title');
      el.innerHTML = `<div><div class="logo"><svg viewBox="0 0 24 24" width="58" height="58" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/></svg></div><h1>${heading}</h1><p>${sub}</p></div>`;
      el.classList.add('show');
    },
    { heading, sub },
  );
  await pause(ms);
  await page.evaluate(() => document.getElementById('demo-title').classList.remove('show'));
  await pause(700);
}

async function go(path) {
  await click(page.locator(`.sidebar a.nav-item[href="${path}"]`), 900);
  await page.evaluate(() => (document.querySelector('.content').scrollTop = 0));
}

async function scrollContent(to, ms = 900) {
  await page.evaluate(
    ({ to }) => document.querySelector('.content').scrollTo({ top: to, behavior: 'instant' }),
    { to },
  );
  await pause(ms);
}

const pad = (n) => String(n).padStart(2, '0');
const localIso = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Cuve de démonstration : cylindre couché Ø 130 cm × 230 cm. */
function demoVolume(h) {
  const r = 65;
  const clamped = Math.min(Math.max(h, 0), 2 * r);
  const area = r * r * Math.acos((r - clamped) / r) - (r - clamped) * Math.sqrt(Math.max(0, 2 * r * clamped - clamped * clamped));
  return (area * 230) / 1000;
}
function demoHeight(liters) {
  let low = 0;
  let high = 130;
  for (let i = 0; i < 50; i++) {
    const mid = (low + high) / 2;
    if (demoVolume(mid) < liters) low = mid;
    else high = mid;
  }
  return Math.round(low * 2) / 2;
}
const parseNumber = (text) => Number(text.replace(/[^\d,.-]/g, '').replace(',', '.'));

// ---------------------------------------------------------------- Introduction
await pause(600);
const introAt = (Date.now() - started) / 1000;
await titleCard('ConsoMazout', 'Suivre sa cuve à mazout et anticiper le prochain plein', 3200);

await caption('', 'Le tableau de bord résume l’état de la cuve', 'Contenu estimé aujourd’hui, date de commande conseillée, consommation et coûts');
await pointAt(page.locator('.level-kpi'));
await pause(900);
await pointAt(page.locator('.kpis .kpi').nth(1));
await pause(900);
await pointAt(page.locator('.kpis .kpi').nth(3));
await pause(900);
await hideCaption();

// ---------------------------------------------------------------- La cuve
await go('/cuve');
await caption('', 'La cuve est décrite une seule fois', 'Forme et dimensions intérieures : la hauteur mesurée est convertie en litres');
await pointAt(page.locator('.shape.active'));
await pause(800);
await type(page.getByPlaceholder('Hauteur mesurée'), '80');
await pointAt(page.locator('.test-result'));
await pause(1500);
await caption('', 'Cinq formes de cuve, dont la cuve à jauge', 'Cylindre, rectangle, table de jaugeage… ou simple capacité en litres');
const shapes = page.locator('.shapes .shape');
for (let i = 0; i < (await shapes.count()); i++) {
  await pointAt(shapes.nth(i), 450);
  await pause(450);
}
await hideCaption();

// ---------------------------------------------------------------- 1. Relevé du jour
await go('/releves');
await caption('1', 'Encoder un relevé', 'On mesure la hauteur de mazout dans la cuve et on l’encode');
const morning = new Date((await page.evaluate(() => Date.now())) - 2 * 3600_000); // heure de l'application (horloge figée)
await click(page.locator('#date'), 300);
await page.locator('#date').fill(localIso(morning));
await pause(500);
await click(page.locator('.link-btn'), 700);
const todayHeight = Number(await page.locator('#height').inputValue());
await pointAt(page.locator('.preview'));
await caption('1', 'Encoder un relevé', 'Aperçu immédiat : litres, remplissage et consommation depuis le relevé précédent');
await type(page.locator('#note'), 'Relevé du matin');
await click(page.locator('form.entry button[type=submit]'), 1200);
await pointAt(page.locator('.table tbody tr').first());
await pause(1500);
await hideCaption();

// ---------------------------------------------------------------- 2. Relevé dans le passé
const rows = await page.locator('.table tbody tr').evaluateAll((trs) =>
  trs.slice(1, 3).map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim())),
);
const parseRow = ([date, height]) => {
  const [d, m, y, hh, mm] = date.match(/\d+/g).map(Number);
  return { time: new Date(y, m - 1, d, hh, mm).getTime(), height: parseNumber(height) };
};
const [newer, older] = rows.map(parseRow);
const pastDate = new Date((newer.time + older.time) / 2);
pastDate.setMinutes(0);
const pastHeight = Math.round((newer.height + older.height)) / 2;

await caption('2', 'Encoder un relevé oublié, dans le passé', 'La date est libre : tous les calculs sont refaits automatiquement');
await click(page.locator('#date'), 300);
await page.locator('#date').fill(localIso(pastDate));
await pause(700);
await type(page.locator('#height'), String(pastHeight));
await pointAt(page.locator('.preview'));
await pause(1200);
await click(page.locator('form.entry button[type=submit]'), 1200);
await pointAt(page.locator('.table tbody tr').nth(2));
await pause(1800);
await hideCaption();

// ---------------------------------------------------------------- 2 bis. Relevé en litres (jauge)
await caption('2', 'Ou relever la quantité lue sur la jauge', 'Hauteur en cm ou litres : au choix, selon l’équipement de la cuve');
await click(page.locator('.mode-switch button', { hasText: 'Quantité' }), 600);
await click(page.locator('.link-btn'), 700);
await pointAt(page.locator('.preview'));
await pause(1200);
await type(page.locator('#note'), 'Lu sur la jauge');
await click(page.locator('form.entry button[type=submit]'), 1200);
await pointAt(page.locator('.table tbody tr').first());
await pause(1800);
await hideCaption();

// ---------------------------------------------------------------- 3. Plein
await go('/pleins');
await caption('3', 'Encoder une recharge de la cuve', 'Date, litres livrés et prix : le total se calcule tout seul');
await click(page.locator('.link-btn'), 700);
const liters = Number(await page.locator('#liters').inputValue());
await type(page.locator('#price'), '1.049');
await pointAt(page.locator('#total'));
await pause(900);
await type(page.locator('#supplier'), 'Mazout Dupont');
const afterHeight = demoHeight(demoVolume(todayHeight) + liters);
await caption('3', 'Encoder une recharge de la cuve', 'La hauteur mesurée après le plein crée aussi un relevé');
await click(page.locator('.after-switch button', { hasText: 'Hauteur' }), 400);
await type(page.locator('#after'), String(afterHeight));
await pause(600);
await click(page.locator('form.entry button[type=submit]'), 1400);
await pointAt(page.locator('.table tbody tr').first());
await pause(1200);
await pointAt(page.locator('.kpi').nth(3));
await pause(1400);
await hideCaption();

// ---------------------------------------------------------------- 4. Évolution
await go('/');
await caption('4', 'Consulter l’évolution du contenu', 'Courbe jour par jour : elle descend avec la saison et saute à chaque livraison');
await scrollContent(250);
await click(page.getByRole('button', { name: 'Tout', exact: true }), 1200);
const chart = page.locator('app-chart canvas').first();
const box = await chart.boundingBox();
const y = box.y + box.height * 0.45;
await caption('4', 'Survoler la courbe', 'Infobulle : hauteur de mazout, litres et détails de chaque plein (triangles)');
for (let i = 0; i <= 36; i++) {
  await moveCursor(box.x + 70 + ((box.width * 0.48 - 70) * i) / 36, y, 240);
  await pause(i % 6 === 0 ? 500 : 60);
}
await pause(1000);
await hideCaption();

// ---------------------------------------------------------------- 5. Prévisions
await caption('5', 'Prévoir l’évolution selon la saison', 'Trois profils : statistique belge, statistique ajustée et historique de la maison');
await click(page.getByRole('button', { name: '1 an', exact: true }), 600);
await click(page.getByRole('button', { name: '+18 mois' }), 1200);
for (let i = 0; i <= 10; i++) {
  await moveCursor(box.x + box.width * 0.55 + ((box.width * 0.4) * i) / 10, box.y + box.height * 0.4, 260);
}
await pause(800);
await scrollContent(900, 1200);
await caption('5', 'Quand faut-il commander ?', 'Pour chaque profil : seuil d’alerte atteint, date limite de commande, cuve vide');
const profileRows = page.locator('.profile-row');
await pointAt(profileRows.nth(2));
await pause(1200);
await click(profileRows.nth(0), 700);
await click(profileRows.nth(1), 700);
await scrollContent(250, 1000);
await caption('5', 'Seule la courbe « Historique de la maison » est affichée', 'Elle se base sur la consommation réelle des années précédentes');
await pause(1200);
await scrollContent(900, 900);
await click(profileRows.nth(0), 400);
await click(profileRows.nth(1), 600);
await scrollContent(1400, 1200);
await caption('5', 'Consommation prévue des 12 prochains mois', 'Selon la saison : l’hiver pèse bien plus que l’été');
await pointAt(page.locator('app-chart').last());
await pause(1800);
await hideCaption();

// ---------------------------------------------------------------- 6. Statistiques
await go('/statistiques');
await caption('6', 'Statistiques par saison et par mois', 'Moyennes comparées à la référence belge');
await pointAt(page.locator('.season').first());
await pause(1200);
await scrollContent(330, 1000);
await pointAt(page.locator('.avg-row'));
await pause(1800);
await scrollContent(800, 1000);
const years = page.locator('.segmented button');
await click(years.nth(0), 900);
await click(years.nth(1), 900);
await click(years.last(), 900);
await pause(800);
await hideCaption();

// ---------------------------------------------------------------- 7. Assistant IA et données
await go('/reglages');
await caption('7', 'Un assistant qui connaît toutes vos données', 'Claude (Anthropic) répond sur vos relevés, pleins et prévisions, avec votre propre clé API');
await page.evaluate(() => document.getElementById('ia').scrollIntoView({ block: 'start', behavior: 'instant' }));
await pause(1200);
await pointAt(page.locator('#ia'));
await pause(1500);
await click(page.locator('.assistant-btn'), 1200);
await caption('7', 'Le panneau s’ouvre à droite de chaque page', 'La clé est chiffrée par le système ; les données ne partent que lorsque vous posez une question');
await pointAt(page.locator('.assistant'));
await pause(2200);
await hideCaption();
await click(page.locator('.assistant-btn'), 800);
await page.evaluate(() => (document.querySelector('.content').scrollTop = 0));
await caption('7', 'Sauvegarde, export et partage', 'JSON complet, import par fusion entre ordinateurs, CSV pour Excel');
await page.evaluate(() => document.querySelector('.content').scrollTo({ top: 99999, behavior: 'instant' }));
await pause(1000);
await pointAt(page.getByRole('button', { name: 'Exporter les données (JSON)' }));
await pointAt(page.getByRole('button', { name: 'Importer un fichier…' }));
await pointAt(page.getByRole('button', { name: 'Conso. mensuelle' }));
await pause(900);
await hideCaption();

// ---------------------------------------------------------------- Fin
await go('/');
await caption('', 'Thème clair ou sombre', 'Au choix, ou selon le système');
await click(page.locator('button[title="Thème clair"]'), 1800);
await hideCaption();
await titleCard('ConsoMazout', 'Angular 21 · Electron · Assistant IA Claude · macOS et Windows', 3000);

await cdp.send('Page.stopScreencast');
const duration = (Date.now() - started) / 1000;
await app.close();

// ---------------------------------------------------------------- 3. Assemblage MP4
mkdirSync(OUT_DIR, { recursive: true });
const firstTime = frames[0].time + Math.max(0, introAt - 0.2);
const kept = frames.filter((f, i) => f.time >= firstTime || frames[i + 1]?.time > firstTime);
const lines = [];
kept.forEach((frame, i) => {
  const next = kept[i + 1]?.time ?? frame.time + 1;
  lines.push(`file '${frame.file}'`, `duration ${Math.max(0.001, next - Math.max(frame.time, firstTime)).toFixed(4)}`);
});
lines.push(`file '${kept.at(-1).file}'`);
const list = join(rawDir, 'frames.txt');
writeFileSync(list, lines.join('\n'));
const result = spawnSync(
  'ffmpeg',
  [
    '-y', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0', '-i', list,
    '-vf', `scale=${VIDEO.width}:${VIDEO.height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${VIDEO.width}:${VIDEO.height}:(ow-iw)/2:(oh-ih)/2:color=0x0f172a,fps=30,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
    '-movflags', '+faststart',
    OUT_FILE,
  ],
  { stdio: 'inherit' },
);
rmSync(userData, { recursive: true, force: true });
if (result.status !== 0) {
  console.error(`Assemblage ffmpeg échoué ; images conservées dans ${rawDir}`);
  process.exit(1);
}
rmSync(rawDir, { recursive: true, force: true });
console.log(`✓ ${OUT_FILE} (${Math.round(duration - introAt)} s, ${kept.length} images)`);

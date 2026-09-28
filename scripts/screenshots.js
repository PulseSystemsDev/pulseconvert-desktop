const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright-core');

const APP = path.resolve(__dirname, '..');
const OUT = path.join(APP, 'screenshots');
const PORT = process.env.MOCK_PORT || '4599';
process.env.MOCK_PORT = PORT;
process.env.MOCK_APPROVE_AFTER = process.env.MOCK_APPROVE_AFTER || '4';
process.env.MOCK_JOB_SECONDS = process.env.MOCK_JOB_SECONDS || '45';
require('./mock-server');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pulseconvert-shots-'));
  const sample = path.join(profile, 'porsche_911_gt3rs.zip');
  fs.writeFileSync(sample, Buffer.alloc(3 * 1024 * 1024, 1));

  const args = [APP];
  if (process.platform === 'linux') args.push('--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist');
  const env = { ...process.env, PULSECONVERT_API_URL: `http://127.0.0.1:${PORT}`, PULSE_ACCOUNTS_ISSUER: `http://127.0.0.1:${PORT}`, PULSECONVERT_USER_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await electron.launch({ executablePath: require('electron'), args, env });
  const errors = [];
  const win = await app.firstWindow();
  win.on('pageerror', (err) => errors.push(err.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setSize(1440, 900);
    window.center();
  });

  const shot = async (name) => {
    await sleep(700);
    await win.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log('saved', name);
  };
  const nav = async (label) => {
    await win.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: label }).first().click();
    await sleep(900);
  };

  await win.waitForSelector('text=Sign in with Pulse');
  await sleep(2500);
  await shot('01-sign-in');
  await win.click('text=Sign in with Pulse');
  await win.waitForSelector('text=Approve this device');
  await shot('02-sign-in-code');

  await win.waitForSelector('text=Where should finished resources go?', { timeout: 20000 });
  await shot('03-welcome');
  await win.click('button:has-text("Next")');
  await shot('04-welcome-deploy');
  await win.click('text=Skip for now');
  await win.waitForSelector('text=Quick convert');

  await win.fill('input[placeholder^="https://www.gta5-mods.com/vehicles"]', 'https://www.gta5-mods.com/vehicles/2024-porsche-911-gt3-rs');
  await win.click('main form button[type=submit]');
  await sleep(1200);
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, sample);
  await nav('Catalog');
  await win.locator('article').nth(1).click();
  await win.click('button:has-text("Instant download")');
  await win.keyboard.press('Escape');
  await nav('Optimize');
  await win.click('button:has-text("Choose a file")');
  await shot('07-optimize');
  await win.click('main button:has-text("Optimize vehicles")');
  await nav('Home');
  await sleep(6000);
  await shot('05-home');

  await nav('Convert');
  for (const url of ['https://www.gta5-mods.com/vehicles/bmw-m4-competition-g82', 'https://www.gta5-mods.com/vehicles/audi-rs6-avant-c8-abt', 'https://www.mediafire.com/file/abc123/nissan_skyline_r34.zip']) {
    await win.fill('input[placeholder^="https://"]', url);
    await win.click('button:has-text("Add link")');
  }
  await win.click('text=Options');
  await shot('06-convert-pack');
  await nav('Fix resource');
  await shot('08-fix');

  await nav('Catalog');
  await shot('09-catalog');
  await win.locator('article').first().click();
  await sleep(900);
  await win.click('button:has-text("View in 3D")');
  await sleep(2500);
  await shot('10-catalog-3d');
  await win.keyboard.press('Escape');
  await nav('Gallery');
  await shot('11-gallery');

  await nav('Jobs');
  await sleep(1500);
  await shot('12-jobs');
  await win.locator('tbody tr', { hasText: '2h ago' }).first().click();
  await sleep(1500);
  await shot('13-job-detail');
  await win.keyboard.press('Escape');
  await win.locator('tbody tr', { hasText: 'just now' }).first().click();
  await sleep(1500);
  await shot('14-job-running');
  await win.keyboard.press('Escape');

  await nav('Server queue');
  await shot('15-queue');
  await nav('Live stats');
  await sleep(11000);
  await win.locator('svg[aria-label^="Jobs finished"] rect[fill="transparent"]').nth(24).hover();
  await shot('16-stats');

  await nav('Tools');
  await win.fill('textarea', 'police\nmy_gt3rs\nm4comp_pc\nr34_vspec');
  await win.click('button:has-text("Check for collisions")');
  await sleep(1000);
  await shot('17-tools');
  await nav('Deploy');
  await win.click('text=Remote server (SFTP)');
  await shot('18-deploy');
  await nav('Settings');
  await shot('19-settings');
  await win.click('header button:has-text("running"), header button:has-text("Activity")');
  await shot('20-activity');

  await app.close();
  if (errors.length) {
    console.error('Renderer errors:\n' + errors.join('\n'));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

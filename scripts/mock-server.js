const http = require('http');
const crypto = require('crypto');
const yazl = require('yazl');
const fs = require('fs');

const PORT = Number(process.env.MOCK_PORT || 4599);
const AUTO_APPROVE_AFTER_POLLS = Number(process.env.MOCK_APPROVE_AFTER ?? 2);

const PALETTES = [
  ['#ff7a33', '#3a1606'],
  ['#2dd4bf', '#06302b'],
  ['#5b9fd9', '#0b2138'],
  ['#d9a93f', '#35270a'],
  ['#c084fc', '#2a0f3d'],
  ['#f87171', '#3b0d0d'],
  ['#a3e635', '#1d2b07'],
  ['#e5e7eb', '#1f2937'],
];

const VEHICLES = [
  ['2024 Porsche 911 GT3 RS', 'Vanz', 3],
  ['Lamborghini Revuelto [Add-On | Tuning]', 'Rmod', 4],
  ['BMW M4 Competition G82', 'Kevin', 0],
  ['Ford F-150 Raptor R 2023', 'Pleb Masters', 2],
  ['Nissan Skyline GT-R R34 V-Spec II', 'Z3D', 5],
  ['Police Interceptor Utility Pack', 'Emergency Dept', 1],
  ['Mercedes-AMG G63 6x6', 'Kurukuru', 7],
  ['Toyota Supra MK4 Widebody', 'Hydra', 6],
  ['Audi RS6 Avant C8 ABT', 'Gabriel', 2],
  ['Dodge Charger SRT Hellcat Redeye', 'SkylineGTRFreak', 5],
  ['McLaren 765LT Spider', 'Vanz', 0],
  ['Chevrolet Tahoe 2021 Unmarked', 'Emergency Dept', 3],
].map(([title, author, palette], index) => ({
  id: `veh${index + 1}`,
  title,
  author,
  palette,
  sourceUrl: `https://www.gta5-mods.com/vehicles/${String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  likes: 480 + ((index * 733) % 4200),
  downloads: 9000 + ((index * 17_311) % 180_000),
  rating: 4.2 + ((index * 7) % 8) / 10,
  prebuilt: index % 3 !== 2,
  hasPreview: index % 2 === 0,
  description: `${title} converted for FiveM.\n\nFeatures:\n- High detail interior\n- Working lights and dials\n- Custom handling\n- Multiple liveries\n\nPlease credit the original author when you use this on your server.`,
  tags: JSON.stringify(['add-on', 'car', index % 2 ? 'tuning' : 'lore-friendly']),
}));

const CONTENT = {
  map: ['Legion Square Revamp MLO', 'Mission Row PD Interior', 'Vinewood Mansion', 'Sandy Shores Airfield Hangar', 'Paleto Bay Gas Station'],
  ped: ['Realistic Police Officer', 'SWAT Operator', 'Paramedic Female', 'Street Racer'],
  eup: ['LSPD Class B Uniform Pack', 'Sheriff Duty Belt', 'Fire Department Turnout Gear', 'EMS Winter Jacket'],
};

const ANIMATIONS = ['Tactical Reload Pack', 'Realistic Pistol Animations', 'Rifle Low-Ready Stance', 'Smooth Weapon Swap'];

const now = Date.now();
const iso = (offset) => new Date(now - offset).toISOString();
const jobs = new Map();
const uploads = new Map();
let pollsBeforeApproval = AUTO_APPROVE_AFTER_POLLS;
let queueSerial = 0;

function seedJob(id, title, sourceType, status, ageMs, extra = {}) {
  jobs.set(id, {
    id,
    title,
    sourceType,
    status,
    error: null,
    conversionTarget: 'addon',
    optimizeCategory: sourceType === 'optimize' ? 'vehicles' : null,
    detectedCategory: 'vehicle',
    inputSizeBytes: 48_000_000,
    outputSizeBytes: status === 'done' ? 22_000_000 + ((ageMs / 1000) % 30_000_000) : 0,
    hasOutput: status === 'done',
    healthScore: status === 'done' ? 94 : null,
    createdAt: iso(ageMs),
    completedAt: status === 'done' ? iso(ageMs - 90_000) : null,
    expiresAt: status === 'done' ? new Date(now - ageMs + 72 * 3600_000).toISOString() : null,
    fixLog:
      status === 'done'
        ? [
            'vehicles.meta: added missing <audioNameHash> for gt3rs',
            'carvariations.meta: generated entry for gt3rs (none shipped)',
            'gt3rs.ytd: 31.4 MB over the streaming limit - split into gt3rs.ytd + gt3rs+hi.ytd',
            'handling.meta: fixed malformed <fInitialDragCoeff> value',
            'fxmanifest.lua: registered VEHICLE_METADATA_FILE, CARCOLS_FILE, VEHICLE_VARIATION_FILE',
          ]
        : [],
    startedAt: now - ageMs,
    ...extra,
  });
}

seedJob('job-a1', '2024 Porsche 911 GT3 RS', 'url', 'done', 2 * 3600_000);
seedJob('job-a2', 'Pack of 6 vehicles', 'batch', 'done', 26 * 3600_000);
seedJob('job-a3', 'mission_row_pd.zip', 'optimize', 'done', 3 * 86_400_000);
seedJob('job-a4', 'lspd_charger_2018.rar', 'upload', 'failed', 4 * 86_400_000, { error: 'No vehicle model (.yft) was found in this archive. It may be a texture-only replacement.' });
seedJob('job-a5', 'Nissan Skyline GT-R R34 V-Spec II', 'url', 'done', 6 * 86_400_000);
seedJob('job-a6', 'sheriff_pack_fixed.zip', 'fix', 'done', 9 * 86_400_000);

function thumbSvg(title, palette) {
  const [accent, dark] = PALETTES[palette % PALETTES.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${dark}"/><stop offset="1" stop-color="#080b12"/></linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.62" r="0.55"><stop offset="0" stop-color="${accent}" stop-opacity="0.55"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="640" height="360" fill="url(#bg)"/>
  <ellipse cx="320" cy="270" rx="250" ry="26" fill="#000" opacity="0.45"/>
  <rect width="640" height="360" fill="url(#glow)"/>
  <path d="M110 238 C130 200 190 178 250 172 L300 140 C330 124 400 122 440 140 L495 176 C530 182 548 196 552 214 L556 240 C556 250 548 256 538 256 L120 256 C110 256 104 248 110 238 Z" fill="#0b0f17" stroke="${accent}" stroke-width="3" stroke-opacity="0.9"/>
  <path d="M268 172 L308 146 C334 134 392 133 428 148 L470 176 Z" fill="${accent}" opacity="0.18"/>
  <circle cx="200" cy="256" r="34" fill="#05070b" stroke="${accent}" stroke-width="4"/><circle cx="200" cy="256" r="14" fill="${accent}" opacity="0.5"/>
  <circle cx="470" cy="256" r="34" fill="#05070b" stroke="${accent}" stroke-width="4"/><circle cx="470" cy="256" r="14" fill="${accent}" opacity="0.5"/>
</svg>`;
}

function listResponse(entries, url) {
  const search = (url.searchParams.get('search') || '').toLowerCase();
  const sort = url.searchParams.get('sort') || 'latest';
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  let filtered = entries.filter((entry) => !search || entry.title.toLowerCase().includes(search) || String(entry.author).toLowerCase().includes(search));
  if (sort === 'downloads') filtered = [...filtered].sort((a, b) => b.downloads - a.downloads);
  if (sort === 'likes') filtered = [...filtered].sort((a, b) => b.likes - a.likes);
  if (sort === 'rating') filtered = [...filtered].sort((a, b) => b.rating - a.rating);
  const pageSize = 24;
  return {
    entries: filtered.slice((page - 1) * pageSize, page * pageSize).map(({ palette, ...entry }) => entry),
    total: filtered.length,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
  };
}

const favorites = new Set(['veh2', 'veh5']);
const catalog = {
  vehicles: VEHICLES.map((vehicle) => ({ ...vehicle, thumbnailUrl: `/mock/thumb/${vehicle.id}.svg`, favorited: favorites.has(vehicle.id) })),
  animations: ANIMATIONS.map((title, index) => ({
    id: `anim${index + 1}`,
    title,
    author: 'Anim Lab',
    palette: index + 2,
    sourceUrl: `https://www.gta5-mods.com/weapons/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    thumbnailUrl: `/mock/thumb/anim${index + 1}.svg`,
    likes: 300 + index * 91,
    downloads: 5000 + index * 1200,
    rating: 4.5,
    prebuilt: index !== 1,
    description: 'Weapon animation replacement pack.',
    tags: JSON.stringify(['animation', 'weapon']),
  })),
};
for (const [kind, titles] of Object.entries(CONTENT)) {
  catalog[kind] = titles.map((title, index) => ({
    id: `${kind}${index + 1}`,
    title,
    author: ['Uncle Just', 'Gabz', 'Kiiya', 'Breze'][index % 4],
    palette: index + (kind === 'map' ? 1 : kind === 'ped' ? 4 : 6),
    sourceUrl: `https://www.gta5-mods.com/${kind === 'map' ? 'maps' : 'player'}/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    thumbnailUrl: `/mock/thumb/${kind}${index + 1}.svg`,
    likes: 120 + index * 311,
    downloads: 2000 + index * 4100,
    rating: 4.1 + index / 10,
    description: `${title} for FiveM servers.`,
    tags: JSON.stringify([kind]),
  }));
}
const allEntries = () => [...catalog.vehicles, ...catalog.animations, ...catalog.map, ...catalog.ped, ...catalog.eup];

function advance(job) {
  if (job.status === 'done' || job.status === 'failed') return;
  const elapsed = Date.now() - job.startedAt;
  const speed = Number(process.env.MOCK_JOB_SECONDS || 40) * 1000;
  const fraction = elapsed / speed;
  if (fraction < 0.12 && job.sourceType !== 'upload' && job.sourceType !== 'optimize' && job.sourceType !== 'fix') job.status = 'scraping';
  else if (fraction < 0.3) job.status = 'queued';
  else if (fraction < 1) job.status = 'processing';
  else {
    job.status = 'done';
    job.hasOutput = true;
    job.outputSizeBytes = 18_400_000;
    job.healthScore = 91;
    job.completedAt = new Date().toISOString();
    job.expiresAt = new Date(Date.now() + 72 * 3600_000).toISOString();
    job.fixLog = ['vehicles.meta: added missing <audioNameHash>', 'model.ytd: split oversized dictionary (28.2 MB) into 2 parts', 'fxmanifest.lua: generated with 4 data_file entries'];
  }
  job.progressFraction = Math.min(1, Math.max(0, (fraction - 0.3) / 0.7));
}

function jobRecord(job) {
  advance(job);
  const steps = ['Extracting archive', 'Reading vehicle metadata', 'Validating handling.meta', 'Splitting texture dictionaries', 'Building resource'];
  const step = Math.min(steps.length - 1, Math.floor((job.progressFraction ?? 0) * steps.length));
  return {
    id: job.id,
    title: job.title,
    licenseText: null,
    realBrand: /porsche|lamborghini|bmw|ford|nissan|mercedes|toyota|audi|dodge|mclaren|chevrolet/i.test(job.title ?? '') ? 'the manufacturer' : null,
    outputSizeBytes: job.outputSizeBytes || null,
    status: job.status,
    queuePosition: job.status === 'queued' ? 2 : 0,
    scrapeQueuePosition: 0,
    etaMs: job.status === 'queued' ? 95_000 : null,
    progress: job.status === 'processing' ? { label: steps[step], current: Math.round((job.progressFraction ?? 0) * 100), total: 100 } : { label: null, current: null, total: null },
    health: { score: job.healthScore, report: null },
    fixLog: job.fixLog ?? [],
    error: job.error,
    downloadUrl: job.status === 'done' ? `/api/jobs/${job.id}/download` : null,
    previewUrl: job.status === 'done' && job.sourceType !== 'optimize' ? `/api/jobs/${job.id}/preview` : null,
    expiresAt: job.expiresAt,
    batch: job.sourceType === 'batch' ? { total: 6, done: job.status === 'done' ? 6 : 2, currentTitle: 'BMW M4 Competition G82', currentIndex: 2, failedItems: [] } : null,
  };
}

function listItem(job) {
  advance(job);
  const { fixLog, startedAt, progressFraction, ...item } = job;
  return item;
}

function createJob(title, sourceType) {
  const id = `job-${crypto.randomBytes(4).toString('hex')}`;
  queueSerial += 1;
  jobs.set(id, {
    id,
    title,
    sourceType,
    status: 'queued',
    error: null,
    conversionTarget: 'addon',
    optimizeCategory: null,
    detectedCategory: 'vehicle',
    inputSizeBytes: 30_000_000,
    outputSizeBytes: 0,
    hasOutput: false,
    healthScore: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
    expiresAt: null,
    fixLog: [],
    startedAt: Date.now() + queueSerial * 1500,
  });
  return id;
}

function sampleZip(name) {
  return new Promise((resolve) => {
    const zip = new yazl.ZipFile();
    zip.addBuffer(Buffer.from(`fx_version 'cerulean'\ngame 'gta5'\n\n-- Sample resource generated by the Pulse Convert mock server.\n`), `${name}/fxmanifest.lua`);
    zip.addBuffer(crypto.randomBytes(256 * 1024), `${name}/stream/${name}.yft`);
    const chunks = [];
    zip.outputStream.on('data', (chunk) => chunks.push(chunk));
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zip.end();
  });
}

function tinyGlb() {
  if (process.env.MOCK_PREVIEW_GLB) return fs.readFileSync(process.env.MOCK_PREVIEW_GLB);
  const positions = [
    -1.6, -0.35, -0.8, 1.6, -0.35, -0.8, 1.6, 0.35, -0.8, -1.6, 0.35, -0.8, -1.6, -0.35, 0.8, 1.6, -0.35, 0.8, 1.6, 0.35, 0.8, -1.6, 0.35, 0.8,
    -0.8, 0.35, -0.7, 0.9, 0.35, -0.7, 0.6, 0.8, -0.6, -0.5, 0.8, -0.6, -0.8, 0.35, 0.7, 0.9, 0.35, 0.7, 0.6, 0.8, 0.6, -0.5, 0.8, 0.6,
  ];
  const box = (o) => [o + 0, o + 2, o + 1, o + 0, o + 3, o + 2, o + 4, o + 5, o + 6, o + 4, o + 6, o + 7, o + 0, o + 1, o + 5, o + 0, o + 5, o + 4, o + 3, o + 7, o + 6, o + 3, o + 6, o + 2, o + 0, o + 4, o + 7, o + 0, o + 7, o + 3, o + 1, o + 2, o + 6, o + 1, o + 6, o + 5];
  const indices = [...box(0), ...box(8)];
  const posBuf = Buffer.from(new Float32Array(positions).buffer);
  const idxBuf = Buffer.from(new Uint16Array(indices).buffer);
  const pad = (buffer) => Buffer.concat([buffer, Buffer.alloc((4 - (buffer.length % 4)) % 4)]);
  const bin = Buffer.concat([pad(idxBuf), posBuf]);
  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 0.48, 0.2, 1], metallicFactor: 0.6, roughnessFactor: 0.35 } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 1 }, indices: 0, material: 0 }] }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: idxBuf.length, target: 34963 },
      { buffer: 0, byteOffset: pad(idxBuf).length, byteLength: posBuf.length, target: 34962 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5123, count: indices.length, type: 'SCALAR' },
      { bufferView: 1, componentType: 5126, count: positions.length / 3, type: 'VEC3', min: [-1.6, -0.35, -0.8], max: [1.6, 0.8, 0.8] },
    ],
  };
  const json = Buffer.from(JSON.stringify(gltf));
  const jsonChunk = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + bin.length, 8);
  const chunkHeader = (length, type) => {
    const buffer = Buffer.alloc(8);
    buffer.writeUInt32LE(length, 0);
    buffer.writeUInt32LE(type, 4);
    return buffer;
  };
  return Buffer.concat([header, chunkHeader(jsonChunk.length, 0x4e4f534a), jsonChunk, chunkHeader(bin.length, 0x004e4942), bin]);
}

function fakeJwt() {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: '123456789012345678', exp: Math.floor(Date.now() / 1000) + 3600 })}.mock`;
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function send(res, status, body, type = 'application/json') {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': payload.length, 'Access-Control-Allow-Origin': '*' });
  res.end(payload);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  const method = req.method;
  const body = method === 'POST' || method === 'PUT' ? await readBody(req) : Buffer.alloc(0);
  const json = () => {
    try {
      return JSON.parse(body.toString('utf8') || '{}');
    } catch {
      return {};
    }
  };
  const form = () => new URLSearchParams(body.toString('utf8'));

  if (path === '/device/auth' && method === 'POST') {
    pollsBeforeApproval = AUTO_APPROVE_AFTER_POLLS;
    return send(res, 200, { device_code: 'mock-device-code', user_code: 'PCDX-7Q4M', verification_uri: `http://127.0.0.1:${PORT}/device`, verification_uri_complete: `http://127.0.0.1:${PORT}/device?code=PCDX-7Q4M`, expires_in: 600, interval: 1 });
  }
  if (path === '/token' && method === 'POST') {
    const params = form();
    if (params.get('grant_type') === 'refresh_token') return send(res, 200, { access_token: fakeJwt(), refresh_token: 'mock-refresh', expires_in: 3600, scope: 'openid profile email' });
    if (AUTO_APPROVE_AFTER_POLLS < 0 || pollsBeforeApproval-- > 0) return send(res, 400, { error: 'authorization_pending' });
    return send(res, 200, { access_token: fakeJwt(), refresh_token: 'mock-refresh', expires_in: 3600, scope: 'openid profile email' });
  }

  const thumb = path.match(/^\/mock\/thumb\/([a-z0-9]+)\.svg$/);
  if (thumb) {
    const entry = allEntries().find((item) => item.id === thumb[1]);
    return send(res, 200, thumbSvg(entry?.title ?? 'Pulse Convert', entry?.palette ?? 0), 'image/svg+xml');
  }
  const shot = path.match(/^\/api\/screenshots\/([a-z0-9]+)\/image$/);
  if (shot) return send(res, 200, thumbSvg(VEHICLES[Number(shot[1].replace('s', '')) % VEHICLES.length].title, Number(shot[1].replace('s', ''))), 'image/svg+xml');

  if (path === '/api/account') {
    return send(res, 200, {
      id: '123456789012345678',
      username: 'Rook',
      avatar: null,
      firstLogin: '2025-03-14T18:00:00.000Z',
      stats: { totalJobs: 148, doneJobs: 139, failedJobs: 9, totalInputBytes: 9_800_000_000, totalOutputBytes: 6_300_000_000 },
      usage: { jobs: 7, bytes: 640_000_000 },
      limits: { maxJobsPerDay: 25, maxBytesPerDay: 5_000_000_000, conversionsEnabled: true },
      dmNotificationsEnabled: true,
      devices: [
        { id: process.env.MOCK_DEVICE_ID || 'this-device', name: 'RIG-01', platform: process.platform, lastSeenAt: new Date().toISOString() },
        { id: 'dev-2', name: 'fivem-host', platform: 'linux', lastSeenAt: iso(3 * 3600_000) },
      ],
    });
  }
  if (path === '/api/account/notifications') return send(res, 200, { ok: true });
  if (path === '/api/jobs' && method === 'GET') return send(res, 200, { jobs: [...jobs.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).map(listItem) });
  if (path === '/api/jobs' && method === 'POST') {
    const payload = json();
    const upload = payload.uploadId ? uploads.get(payload.uploadId) : null;
    const title = upload?.filename ?? (payload.url ? decodeURIComponent(payload.url.split('/').filter(Boolean).pop()).replace(/-/g, ' ') : 'Resource');
    return send(res, 200, { jobId: createJob(title, payload.sourceType) });
  }
  if (path === '/api/jobs/batch') return send(res, 200, { jobId: createJob(`Pack of ${json().items?.length ?? 0} vehicles`, 'batch') });
  const jobMatch = path.match(/^\/api\/jobs\/([A-Za-z0-9_-]+)(\/[a-z-]+)?$/);
  if (jobMatch) {
    const job = jobs.get(jobMatch[1]);
    if (!job) return send(res, 404, { error: 'Job not found' });
    const action = jobMatch[2];
    if (!action && method === 'GET') return send(res, 200, jobRecord(job));
    if (!action && method === 'DELETE') {
      job.hasOutput = false;
      return send(res, 200, { ok: true });
    }
    if (action === '/download') return send(res, 200, await sampleZip((job.title ?? 'resource').toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)), 'application/zip');
    if (action === '/preview') return send(res, 200, tinyGlb(), 'model/gltf-binary');
    if (action === '/rerun') return send(res, 200, { jobId: createJob(job.title, 'url') });
    if (action === '/cancel' && method === 'POST') {
      const wasRunning = job.status !== 'done' && job.status !== 'failed';
      if (wasRunning) Object.assign(job, { status: 'failed', error: 'Cancelled.', completedAt: new Date().toISOString() });
      console.log(`[mock] cancel ${job.id}: ${wasRunning ? 'cancelled' : 'already finished'}`);
      return send(res, 200, { status: wasRunning ? 'cancelled' : 'finished' });
    }
    return send(res, 200, { ok: true, id: 'shot1' });
  }
  if (path === '/api/upload/init') {
    const uploadId = crypto.randomBytes(6).toString('hex');
    uploads.set(uploadId, json());
    return send(res, 200, { uploadId, chunkSize: 4 * 1024 * 1024 });
  }
  if (path === '/api/upload/chunk' || path === '/api/upload/complete') return send(res, 200, { ok: true });
  if (path === '/api/queue' || path === '/api/queue/public') {
    const mine = [...jobs.values()].filter((job) => {
      advance(job);
      return job.status !== 'done' && job.status !== 'failed';
    });
    const other = (index, status) => ({ jobId: `other-${status}-${index}`, sourceType: index % 3 ? 'url' : 'upload', status, isMine: false, title: index === 1 ? 'Pack of 12 vehicles' : null });
    return send(res, 200, {
      processing: other(0, 'processing'),
      processingMany: [other(0, 'processing'), other(1, 'processing'), ...mine.filter((job) => job.status === 'processing').map((job) => ({ jobId: job.id, sourceType: job.sourceType, status: 'processing', isMine: true, title: job.title }))],
      scraping: [other(4, 'scraping'), ...mine.filter((job) => job.status === 'scraping').map((job) => ({ jobId: job.id, sourceType: job.sourceType, status: 'scraping', isMine: true, title: job.title }))],
      queued: [other(5, 'queued'), other(6, 'queued'), ...mine.filter((job) => job.status === 'queued').map((job) => ({ jobId: job.id, sourceType: job.sourceType, status: 'queued', isMine: true, title: job.title })), other(7, 'queued')],
    });
  }
  if (path === '/api/stats/live') {
    return send(res, 200, { totalConverted: 48_217, totalFixesApplied: 312_904, totalBytesSaved: 2_870_000_000_000, catalogVehiclesIndexed: 11_482, activeNow: 9, avgConversionMs: 104_000, workerOnline: true });
  }
  if (path === '/api/stats/history') {
    const days = Array.from({ length: 30 }, (_, index) => {
      const date = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() - (29 - index)));
      const weekend = [0, 6].includes(date.getUTCDay());
      const done = Math.round(900 + index * 14 + (weekend ? 420 : 0) + 160 * Math.sin(index * 1.7));
      return { day: date.toISOString().slice(0, 10), done, failed: Math.round(done * (0.035 + 0.02 * Math.abs(Math.cos(index)))) };
    });
    return send(res, 200, { days, byType: { url: 21_480, upload: 6_912, batch: 1_388, optimize: 2_107, fix: 634 } });
  }
  if (path === '/api/catalog/showcase') {
    return send(res, 200, { vehicles: VEHICLES.map((vehicle) => ({ id: vehicle.id, title: vehicle.title, imageUrl: `/mock/thumb/${vehicle.id}.svg` })) });
  }
  if (path === '/api/gallery') {
    return send(res, 200, { screenshots: Array.from({ length: 9 }, (_, index) => ({ id: `s${index}`, title: VEHICLES[index % VEHICLES.length].title, imageUrl: `/api/screenshots/s${index}/image`, submittedAt: iso(index * 86_400_000) })) });
  }
  if (path === '/api/catalog/vehicles/list') return send(res, 200, listResponse(catalog.vehicles.map((item) => ({ ...item, favorited: favorites.has(item.id) })), url));
  if (path === '/api/catalog/animations/list') return send(res, 200, listResponse(catalog.animations, url));
  if (path === '/api/catalog-content/list') return send(res, 200, listResponse(catalog[url.searchParams.get('kind')] ?? [], url));
  const fav = path.match(/^\/api\/(vehicles|animations|catalog-content)\/([a-z0-9]+)\/favorite$/);
  if (fav) {
    if (favorites.has(fav[2])) favorites.delete(fav[2]);
    else favorites.add(fav[2]);
    return send(res, 200, { favorited: favorites.has(fav[2]) });
  }
  const prebuilt = path.match(/^\/api\/(vehicles|animations)\/([a-z0-9]+)\/(prebuilt|preview|convert)$/);
  if (prebuilt) {
    const entry = allEntries().find((item) => item.id === prebuilt[2]);
    if (!entry) return send(res, 404, { error: 'Not found' });
    if (prebuilt[3] === 'preview') return send(res, 200, tinyGlb(), 'model/gltf-binary');
    if (prebuilt[3] === 'convert') return send(res, 200, { jobId: createJob(entry.title, 'url') });
    if (!entry.prebuilt) return send(res, 404, { cached: false });
    return send(res, 200, await sampleZip(entry.id), 'application/zip');
  }
  if (path === '/api/tools/available') {
    const tool = (slug, name, category, summary, extra = {}) => ({ slug, name, href: `/tools/${slug}`, category, summary, restricted: false, adminOnly: false, untested: false, isNew: false, ...extra });
    return send(res, 200, {
      admin: false,
      tools: [
        tool('backdoor-scanner', 'Backdoor Scanner', 'Security', 'Finds obfuscated loaders, remote code and webhook stealers in a resource.'),
        tool('els-converter', 'ELS Converter', 'Emergency', 'Converts vehicle ELS configs between classic ELS, MISS-ELS, oELS and z_els.', { restricted: true, untested: true, isNew: true }),
        tool('fxmanifest-generator', 'fxmanifest Generator', 'Resources', 'Writes a correct fxmanifest.lua for a folder of files.'),
        tool('stream-auditor', 'Stream Auditor', 'Resources', 'Lists oversized and duplicate streamed files.'),
        { ...tool('workspaces', 'Workspaces', 'Server', 'A live mirror of your server: browse every file, check its health and keep snapshots.', { restricted: true, untested: true }), href: '/workspaces' },
      ],
    });
  }
  if (path === '/api/desktop/handoff' && req.method === 'POST') {
    return send(res, 200, { url: `http://127.0.0.1:${PORT}/api/desktop/handoff/mock-code-0123456789abcdef?to=${encodeURIComponent(json().path ?? '/tools')}` });
  }
  if (path.startsWith('/api/desktop/handoff/')) {
    const to = url.searchParams.get('to') ?? '/tools';
    return send(res, 200, `<!doctype html><html><head><title>Pulse Convert</title><style>body{margin:0;background:#0b0f16;color:#e8edf5;font:14px system-ui}header{padding:14px 24px;border-bottom:1px solid #1d2636;font-weight:600}main{padding:32px 24px}h1{font-size:24px;margin:0 0 8px}p{color:#9aa6b8}</style></head><body><header>Pulse Convert</header><main><h1>${to === '/workspaces' ? 'Workspaces' : 'ELS Converter'}</h1><p>This window shows the real site page (${to}) signed in as you. The mock server stands in for it here.</p></main></body></html>`, 'text/html');
  }
  if (path === '/api/tools/collisions') {
    const vanilla = { adder: 'adder', police: 'police', sultan: 'sultan', boxville: 'boxville' };
    return send(res, 200, {
      results: (json().names ?? []).map((name, index) => ({
        name,
        hash: crypto.createHash('md5').update(name).digest().readUInt32LE(0),
        collidesWithVanilla: vanilla[name.toLowerCase()] ?? null,
        collidesWithIssued: index === 2 ? `${name}_pc` : null,
      })),
    });
  }
  if (path === '/api/tools/map-inspect') {
    return send(res, 200, {
      report: {
        totalStreamBytes: 184_000_000,
        fileCounts: { ymap: 4, ytyp: 2, ydr: 118, ybn: 21, ytd: 36 },
        archetypeCount: 131,
        missingCollision: [{ name: 'mrpd_desk_02', file: 'mrpd_props.ytyp', reason: 'No physics dictionary and no matching .ybn in the upload' }],
        duplicateArchetypeNames: [],
        hashCollisions: [{ name: 'prop_bench_01a', file: 'mrpd_props.ytyp', reason: 'Same name as a vanilla GTA V object' }],
      },
    });
  }
  if (path === '/api/tools/siren-builder') return send(res, 200, await sampleZip('my_sirens'), 'application/zip');
  if (path === '/api/desktop/devices/register') return send(res, 200, { ok: true });
  if (/^\/api\/desktop\/devices\/[^/]+\/events$/.test(path)) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
    req.on('close', () => clearInterval(ping));
    return;
  }
  if (/^\/api\/desktop\/devices\//.test(path)) return send(res, 200, { ok: true });

  send(res, 404, { error: `Mock server has no route for ${method} ${path}` });
});

server.listen(PORT, '127.0.0.1', () => console.log(`Pulse Convert mock server on http://127.0.0.1:${PORT}`));
module.exports = server;

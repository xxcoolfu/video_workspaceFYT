import 'dotenv/config.js';
import express from 'express';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const DEFAULT_PORT = Number(process.env.JIMENG_BRIDGE_PORT || 3210);
const appRoot = join(homedir(), '.jimeng-video-desktop');
const dbPath = join(appRoot, 'app.sqlite');
const transientRoot = join(tmpdir(), 'jimeng-video-desktop');
const defaultSettings = {
  materialRoot: join(appRoot, 'materials'),
  outputRoot: join(appRoot, 'outputs'),
  cliBin: process.env.SEEDANCE_CLI_BIN || 'dreamina',
};
const defaultProjectDefaults = {
  aspectRatio: '16:9',
  resolution: '720p',
  modelVersion: 'seedance2.0fast',
  template: 'multi_modal_reference',
  durationSec: 4,
  generateAudio: true,
};
const modelVersions = ['seedance2.0', 'seedance2.0fast', 'seedance2.0_vip', 'seedance2.0fast_vip'];
const queueTerminalStatuses = ['succeeded', 'failed', 'cancelled'];

mkdirSync(appRoot, { recursive: true });
mkdirSync(defaultSettings.materialRoot, { recursive: true });
mkdirSync(defaultSettings.outputRoot, { recursive: true });
mkdirSync(transientRoot, { recursive: true });

let db = null;
let processingQueue = false;

function openSqliteDatabase(path) {
  try {
    const BetterSqlite3 = require('better-sqlite3');
    return new BetterSqlite3(path);
  } catch (betterSqliteError) {
    try {
      const { DatabaseSync } = require('node:sqlite');
      const sqlite = new DatabaseSync(path);
      return {
        exec: (sql) => sqlite.exec(sql),
        pragma: (sql) => sqlite.exec(`pragma ${sql}`),
        prepare: (sql) => {
          const statement = sqlite.prepare(sql);
          return {
            get: (...args) => statement.get(...args),
            all: (...args) => statement.all(...args),
            run: (...args) => statement.run(...args),
          };
        },
      };
    } catch (nodeSqliteError) {
      throw new Error(`SQLite unavailable. better-sqlite3: ${betterSqliteError.message}; node:sqlite: ${nodeSqliteError.message}`);
    }
  }
}

function nowIso() {
  return new Date().toISOString();
}

function slugify(value) {
  const ascii = String(value || '').trim().toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5-]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '');
  return ascii || randomUUID().slice(0, 8);
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeModelVersion(value) {
  return modelVersions.includes(value) ? value : 'seedance2.0fast';
}

function normalizeResolution(value) {
  return value === '480p' || value === '720p' || value === '1080p' ? value : '720p';
}

function normalizeDefaults(value) {
  const candidate = value && typeof value === 'object' ? value : {};
  return {
    aspectRatio: ['16:9', '9:16', '1:1', '4:3', '3:4'].includes(candidate.aspectRatio) ? candidate.aspectRatio : defaultProjectDefaults.aspectRatio,
    resolution: normalizeResolution(candidate.resolution),
    modelVersion: normalizeModelVersion(candidate.modelVersion),
    template: ['free_text', 'first_frame', 'first_last_frame', 'multi_modal_reference'].includes(candidate.template) ? candidate.template : defaultProjectDefaults.template,
    durationSec: Math.max(4, Math.min(15, Math.round(Number(candidate.durationSec) || defaultProjectDefaults.durationSec))),
    generateAudio: typeof candidate.generateAudio === 'boolean' ? candidate.generateAudio : defaultProjectDefaults.generateAudio,
  };
}

function isConcurrencyLimitError(message) {
  const normalized = String(message || '').toLowerCase();
  return normalized.includes('exceedconcurrencylimit') || normalized.includes('ret=1310');
}

function retryDelayMs(attemptCount) {
  return Math.min(120_000, 30_000 + Math.max(0, attemptCount - 1) * 30_000);
}

function mapRemoteStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'success' || normalized === 'succeeded') return 'succeeded';
  if (normalized === 'fail' || normalized === 'failed' || normalized === 'error' || normalized === 'expired') return 'failed';
  if (normalized === 'cancelled' || normalized === 'canceled') return 'cancelled';
  return 'running';
}

function initDb() {
  if (db) return db;
  db = openSqliteDatabase(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    create table if not exists settings (key text primary key, value text not null);
    create table if not exists groups (id text primary key, name text not null, slug text not null, created_at text not null);
    create table if not exists projects (id text primary key, group_id text not null, name text not null, slug text not null, defaults_json text not null, created_at text not null);
    create table if not exists storyboards (id text primary key, project_id text not null, scene_no integer not null, prompt text not null, overrides_json text not null, asset_ids_json text not null, status text not null, created_at text not null, updated_at text not null);
    create table if not exists input_assets (id text primary key, project_id text not null, kind text not null, name text not null, filename text not null, relative_path text not null, created_at text not null);
    create table if not exists output_assets (id text primary key, project_id text not null, storyboard_id text not null, scene_no integer not null, kind text not null, filename text not null, relative_path text not null, created_at text not null);
    create table if not exists queue_tasks (id text primary key, project_id text not null, storyboard_id text not null, scene_no integer not null, status text not null, submit_id text not null, error text not null, prompt text not null, options_json text not null, created_at text not null, started_at text not null, finished_at text not null, last_checked_at text not null, next_retry_at text not null, attempt_count integer not null, raw_json text not null);
  `);
  if (!getSetting('materialRoot')) setSetting('materialRoot', defaultSettings.materialRoot);
  if (!getSetting('outputRoot')) setSetting('outputRoot', defaultSettings.outputRoot);
  if (!getSetting('cliBin')) setSetting('cliBin', defaultSettings.cliBin);
  return db;
}

function getSetting(key) {
  return initDb().prepare('select value from settings where key = ?').get(key)?.value || '';
}

function setSetting(key, value) {
  initDb().prepare('insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value').run(key, String(value || ''));
}

function getSettings() {
  return {
    materialRoot: getSetting('materialRoot') || defaultSettings.materialRoot,
    outputRoot: getSetting('outputRoot') || defaultSettings.outputRoot,
    cliBin: getSetting('cliBin') || defaultSettings.cliBin,
  };
}

function projectPathParts(projectId) {
  const project = initDb().prepare('select * from projects where id = ?').get(projectId);
  if (!project) throw new Error('Project not found.');
  const group = initDb().prepare('select * from groups where id = ?').get(project.group_id);
  if (!group) throw new Error('Group not found.');
  return { groupSlug: group.slug, projectSlug: project.slug, project };
}

function safeResolve(root, relativePath) {
  const absolute = resolve(root, ...String(relativePath || '').split('/').filter(Boolean));
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
  if (absolute !== root && !absolute.startsWith(normalizedRoot)) {
    throw new Error('Path escapes configured root.');
  }
  return absolute;
}

function rowGroup(row) {
  return { id: row.id, name: row.name, slug: row.slug, createdAt: row.created_at };
}

function rowProject(row) {
  return { id: row.id, groupId: row.group_id, name: row.name, slug: row.slug, defaults: parseJson(row.defaults_json, defaultProjectDefaults), createdAt: row.created_at };
}

function rowStoryboard(row) {
  return { id: row.id, projectId: row.project_id, sceneNo: row.scene_no, prompt: row.prompt, overrides: parseJson(row.overrides_json, {}), assetIds: parseJson(row.asset_ids_json, []), status: row.status, createdAt: row.created_at, updatedAt: row.updated_at };
}

function assetPreviewUrl(asset) {
  return `/api/assets/${encodeURIComponent(asset.id)}/file?t=${Date.now()}`;
}

function outputPreviewUrl(asset) {
  return `/api/outputs/${encodeURIComponent(asset.id)}/file?t=${Date.now()}`;
}

function rowInputAsset(row) {
  return { id: row.id, projectId: row.project_id, kind: row.kind, name: row.name, filename: row.filename, relativePath: row.relative_path, previewUrl: assetPreviewUrl(row), createdAt: row.created_at };
}

function rowOutputAsset(row) {
  return { id: row.id, projectId: row.project_id, storyboardId: row.storyboard_id, sceneNo: row.scene_no, kind: row.kind, filename: row.filename, relativePath: row.relative_path, previewUrl: outputPreviewUrl(row), createdAt: row.created_at };
}

function rowQueueTask(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    storyboardId: row.storyboard_id,
    sceneNo: row.scene_no,
    status: row.status,
    submitId: row.submit_id,
    error: row.error,
    prompt: row.prompt,
    options: parseJson(row.options_json, defaultProjectDefaults),
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    lastCheckedAt: row.last_checked_at,
    nextRetryAt: row.next_retry_at,
    attemptCount: row.attempt_count,
    raw: parseJson(row.raw_json, {}),
  };
}

function getState() {
  const database = initDb();
  return {
    settings: getSettings(),
    groups: database.prepare('select * from groups order by created_at asc').all().map(rowGroup),
    projects: database.prepare('select * from projects order by created_at asc').all().map(rowProject),
    storyboards: database.prepare('select * from storyboards order by scene_no asc').all().map(rowStoryboard),
    inputAssets: database.prepare('select * from input_assets order by created_at asc').all().map(rowInputAsset),
    outputAssets: database.prepare('select * from output_assets order by created_at desc').all().map(rowOutputAsset),
    queueTasks: database.prepare('select * from queue_tasks order by created_at desc').all().map(rowQueueTask),
  };
}

function extractJsonCandidate(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  for (const candidate of [trimmed, firstBrace >= 0 && lastBrace > firstBrace ? trimmed.slice(firstBrace, lastBrace + 1) : '']) {
    if (!candidate) continue;
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {}
  }
  return '';
}

function parseCommandJson(stdout, stderr) {
  const candidate = extractJsonCandidate(stdout) || extractJsonCandidate(`${stdout}\n${stderr}`);
  if (!candidate) throw new Error(String(stderr || stdout || 'Command did not return JSON.').trim());
  return JSON.parse(candidate);
}

async function runDreaminaJson(args) {
  const { cliBin } = getSettings();
  try {
    const { stdout, stderr } = await execFileAsync(cliBin, args, {
      cwd: transientRoot,
      maxBuffer: 30 * 1024 * 1024,
    });
    return { payload: parseCommandJson(stdout, stderr), stdout, stderr, exitCode: 0 };
  } catch (error) {
    const stdout = error.stdout || '';
    const stderr = error.stderr || '';
    try {
      return { payload: parseCommandJson(stdout, stderr), stdout, stderr, exitCode: error.code || 1 };
    } catch {
      throw new Error(String(stderr || stdout || error.message || error).trim());
    }
  }
}

function buildDreaminaArgs({ prompt, images, videos, audios, options }) {
  const hasMedia = images.length > 0 || videos.length > 0 || audios.length > 0;
  return [
    hasMedia ? 'multimodal2video' : 'text2video',
    ...images.flatMap((asset) => ['--image', asset.absolutePath]),
    ...videos.flatMap((asset) => ['--video', asset.absolutePath]),
    ...audios.flatMap((asset) => ['--audio', asset.absolutePath]),
    `--prompt=${prompt}`,
    `--model_version=${normalizeModelVersion(options.modelVersion)}`,
    `--ratio=${options.aspectRatio || '16:9'}`,
    `--video_resolution=${normalizeResolution(options.resolution)}`,
    `--duration=${Math.max(4, Math.min(15, Math.round(Number(options.durationSec) || 4)))}`,
    '--poll=0',
  ];
}

function compilePromptReferences(prompt, assets) {
  const hits = [];
  for (const asset of assets) {
    for (const needle of [`@${asset.name}`, `@${asset.id}`]) {
      const index = prompt.indexOf(needle);
      if (index >= 0) {
        hits.push({ index, asset });
        break;
      }
    }
  }
  const counters = { image: 0, video: 0, audio: 0 };
  const uploadOrder = { image: [], video: [], audio: [] };
  let compiledPrompt = prompt;
  for (const { asset } of hits.sort((left, right) => left.index - right.index)) {
    if (uploadOrder[asset.kind].includes(asset.id)) continue;
    counters[asset.kind] += 1;
    uploadOrder[asset.kind].push(asset.id);
    const token = asset.kind === 'image' ? `@图片${counters.image}` : asset.kind === 'video' ? `@视频${counters.video}` : `@音频${counters.audio}`;
    compiledPrompt = compiledPrompt.replaceAll(`@${asset.name}`, token).replaceAll(`@${asset.id}`, token);
  }
  return { prompt: compiledPrompt, uploadOrder };
}

function getAssetAbsolute(asset) {
  return safeResolve(getSettings().materialRoot, asset.relative_path);
}

function taskAssetsForStoryboard(storyboard) {
  const ids = parseJson(storyboard.asset_ids_json, []);
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  return initDb().prepare(`select * from input_assets where id in (${placeholders})`).all(...ids);
}

function buildSubmitInput(task) {
  const storyboard = initDb().prepare('select * from storyboards where id = ?').get(task.storyboard_id);
  if (!storyboard) throw new Error('Storyboard not found.');
  const assets = taskAssetsForStoryboard(storyboard);
  const promptData = compilePromptReferences(storyboard.prompt || task.prompt, assets);
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const refs = (kind) => promptData.uploadOrder[kind]
    .map((id) => assetById.get(id))
    .filter(Boolean)
    .map((asset) => ({ id: asset.id, kind: asset.kind, name: asset.name, absolutePath: getAssetAbsolute(asset) }));
  return {
    projectId: task.project_id,
    storyboardId: task.storyboard_id,
    prompt: promptData.prompt,
    images: refs('image'),
    videos: refs('video'),
    audios: refs('audio'),
    options: parseJson(task.options_json, defaultProjectDefaults),
  };
}

function updateStoryboardStatus(storyboardId, status) {
  initDb().prepare('update storyboards set status = ?, updated_at = ? where id = ?').run(status, nowIso(), storyboardId);
}

function createOutputAssetFromFile({ task, filePath, kind }) {
  const { groupSlug, projectSlug } = projectPathParts(task.project_id);
  const root = getSettings().outputRoot;
  const sceneDir = `/${groupSlug}/${projectSlug}/scene-${String(task.scene_no).padStart(3, '0')}`.replace(/^\/+/u, '');
  const targetDir = safeResolve(root, sceneDir);
  mkdirSync(targetDir, { recursive: true });
  const fileName = `${randomUUID().slice(0, 8)}-${basename(filePath)}`;
  const relativePath = `${sceneDir}/${fileName}`.replaceAll('\\', '/');
  const target = safeResolve(root, relativePath);
  writeFileSync(target, readFileSync(filePath));
  const id = randomUUID();
  initDb().prepare('insert into output_assets (id, project_id, storyboard_id, scene_no, kind, filename, relative_path, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, task.project_id, task.storyboard_id, task.scene_no, kind, fileName, relativePath, nowIso());
}

function collectTaskFiles(submitId) {
  const dir = join(transientRoot, 'tasks', submitId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((entry) => join(dir, entry))
    .filter((file) => statSync(file).isFile());
}

async function downloadResultFiles(task, payload) {
  const submitId = task.submit_id;
  const dir = join(transientRoot, 'tasks', submitId);
  mkdirSync(dir, { recursive: true });
  const videos = payload?.result_json?.videos || payload?.resultJson?.videos || [];
  const images = payload?.result_json?.images || payload?.resultJson?.images || [];

  for (let index = 0; index < videos.length; index += 1) {
    const video = videos[index];
    const url = video.video_url || video.videoUrl || video.url;
    if (!url) continue;
    const extension = video.format ? `.${String(video.format).replace(/^\./u, '')}` : '.mp4';
    const filePath = join(dir, `${submitId}_video_${index + 1}${extension}`);
    if (!existsSync(filePath) || statSync(filePath).size < 200_000) {
      const response = await fetch(url);
      if (response.ok) writeFileSync(filePath, Buffer.from(await response.arrayBuffer()));
    }
  }

  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    const url = image.image_url || image.imageUrl || image.url;
    if (!url) continue;
    const filePath = join(dir, `${submitId}_image_${index + 1}.png`);
    if (!existsSync(filePath) || statSync(filePath).size < 1000) {
      const response = await fetch(url);
      if (response.ok) writeFileSync(filePath, Buffer.from(await response.arrayBuffer()));
    }
  }

  for (const filePath of collectTaskFiles(submitId)) {
    const ext = extname(filePath).toLowerCase();
    if (['.mp4', '.mov', '.webm'].includes(ext)) createOutputAssetFromFile({ task, filePath, kind: 'video' });
    if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) createOutputAssetFromFile({ task, filePath, kind: 'image' });
  }
}

async function submitQueueTask(task) {
  const database = initDb();
  const startedAt = nowIso();
  database.prepare('update queue_tasks set status = ?, started_at = ?, last_checked_at = ?, error = ? where id = ?')
    .run('submitting', startedAt, startedAt, '', task.id);
  updateStoryboardStatus(task.storyboard_id, 'submitting');

  const input = buildSubmitInput(task);
  const args = buildDreaminaArgs(input);
  const { payload } = await runDreaminaJson(args);
  const submitId = String(payload?.submit_id || payload?.submitId || '').trim();
  const genStatus = String(payload?.gen_status || payload?.genStatus || '').trim();
  if (!submitId) throw new Error('Dreamina did not return submit_id.');
  const status = mapRemoteStatus(genStatus);
  database.prepare('update queue_tasks set status = ?, submit_id = ?, last_checked_at = ?, raw_json = ? where id = ?')
    .run(status, submitId, nowIso(), JSON.stringify(payload), task.id);
  updateStoryboardStatus(task.storyboard_id, status);
}

async function pollQueueTask(task) {
  const { payload } = await runDreaminaJson(['query_result', `--submit_id=${task.submit_id}`]);
  const genStatus = String(payload?.gen_status || payload?.genStatus || '').trim();
  const status = mapRemoteStatus(genStatus);
  const checkedAt = nowIso();
  if (status === 'succeeded') {
    await downloadResultFiles(task, payload);
    initDb().prepare('update queue_tasks set status = ?, finished_at = ?, last_checked_at = ?, raw_json = ? where id = ?')
      .run('succeeded', checkedAt, checkedAt, JSON.stringify(payload), task.id);
    updateStoryboardStatus(task.storyboard_id, 'succeeded');
    return;
  }
  if (queueTerminalStatuses.includes(status)) {
    const error = payload?.fail_reason || payload?.failReason || payload?.error?.message || '';
    initDb().prepare('update queue_tasks set status = ?, error = ?, finished_at = ?, last_checked_at = ?, raw_json = ? where id = ?')
      .run(status, String(error), checkedAt, checkedAt, JSON.stringify(payload), task.id);
    updateStoryboardStatus(task.storyboard_id, status);
    return;
  }
  const queueInfo = payload?.queue_info || payload?.queueInfo || {};
  const waitMs = Math.min(600_000, Math.max(60_000, Number(queueInfo.wait_ms || queueInfo.waitMs || 0) || 60_000));
  initDb().prepare('update queue_tasks set status = ?, last_checked_at = ?, next_retry_at = ?, raw_json = ? where id = ?')
    .run('running', checkedAt, new Date(Date.now() + waitMs).toISOString(), JSON.stringify(payload), task.id);
}

async function processQueue() {
  if (processingQueue) return;
  processingQueue = true;
  try {
    const database = initDb();
    const active = database.prepare("select * from queue_tasks where status in ('submitting', 'running') order by scene_no asc, created_at asc limit 1").get();
    if (active) {
      if (active.status === 'running' && (!active.next_retry_at || Date.parse(active.next_retry_at) <= Date.now())) {
        await pollQueueTask(active);
      }
      return;
    }

    const next = database.prepare("select * from queue_tasks where status = 'queued' or (status = 'retry_wait' and (next_retry_at = '' or next_retry_at <= ?)) order by scene_no asc, created_at asc limit 1").get(nowIso());
    if (!next) return;
    try {
      await submitQueueTask(next);
    } catch (error) {
      const message = String(error?.message || error || 'Submit failed.');
      const checkedAt = nowIso();
      if (isConcurrencyLimitError(message)) {
        const attempts = Number(next.attempt_count || 0) + 1;
        initDb().prepare('update queue_tasks set status = ?, error = ?, attempt_count = ?, last_checked_at = ?, next_retry_at = ? where id = ?')
          .run('retry_wait', message, attempts, checkedAt, new Date(Date.now() + retryDelayMs(attempts)).toISOString(), next.id);
        updateStoryboardStatus(next.storyboard_id, 'queued');
      } else {
        initDb().prepare('update queue_tasks set status = ?, error = ?, finished_at = ?, last_checked_at = ? where id = ?')
          .run('failed', message, checkedAt, checkedAt, next.id);
        updateStoryboardStatus(next.storyboard_id, 'failed');
      }
    }
  } finally {
    processingQueue = false;
  }
}

function configureRoutes(app) {
  app.use(express.json({ limit: '100mb' }));
  app.use((request, response, next) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (request.method === 'OPTIONS') return response.status(204).end();
    return next();
  });

  app.get('/api/state', (_request, response) => response.json(getState()));

  app.put('/api/settings', (request, response) => {
    const body = request.body || {};
    for (const key of ['materialRoot', 'outputRoot', 'cliBin']) {
      if (typeof body[key] === 'string' && body[key].trim()) setSetting(key, body[key].trim());
    }
    mkdirSync(getSettings().materialRoot, { recursive: true });
    mkdirSync(getSettings().outputRoot, { recursive: true });
    response.json(getState());
  });

  app.post('/api/groups', (request, response) => {
    const name = String(request.body?.name || '').trim() || '新分组';
    const id = randomUUID();
    initDb().prepare('insert into groups (id, name, slug, created_at) values (?, ?, ?, ?)').run(id, name, slugify(name), nowIso());
    response.json(getState());
  });

  app.post('/api/projects', (request, response) => {
    const database = initDb();
    const groupId = String(request.body?.groupId || '').trim();
    const group = database.prepare('select * from groups where id = ?').get(groupId);
    if (!group) return response.status(400).json({ error: 'Group not found.' });
    const name = String(request.body?.name || '').trim() || '新项目';
    const sceneCount = Math.max(1, Math.min(200, Math.round(Number(request.body?.sceneCount) || 3)));
    const id = randomUUID();
    const createdAt = nowIso();
    database.prepare('insert into projects (id, group_id, name, slug, defaults_json, created_at) values (?, ?, ?, ?, ?, ?)')
      .run(id, groupId, name, slugify(name), JSON.stringify(normalizeDefaults(request.body?.defaults)), createdAt);
    const insertScene = database.prepare('insert into storyboards (id, project_id, scene_no, prompt, overrides_json, asset_ids_json, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (let sceneNo = 1; sceneNo <= sceneCount; sceneNo += 1) {
      insertScene.run(randomUUID(), id, sceneNo, '', '{}', '[]', 'idle', createdAt, createdAt);
    }
    response.json(getState());
  });

  app.put('/api/projects/:id', (request, response) => {
    initDb().prepare('update projects set defaults_json = ? where id = ?').run(JSON.stringify(normalizeDefaults(request.body?.defaults)), request.params.id);
    response.json(getState());
  });

  app.post('/api/projects/:id/storyboards', (request, response) => {
    const database = initDb();
    const max = database.prepare('select max(scene_no) as sceneNo from storyboards where project_id = ?').get(request.params.id)?.sceneNo || 0;
    const createdAt = nowIso();
    database.prepare('insert into storyboards (id, project_id, scene_no, prompt, overrides_json, asset_ids_json, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), request.params.id, max + 1, '', '{}', '[]', 'idle', createdAt, createdAt);
    response.json(getState());
  });

  app.delete('/api/storyboards/:id', (request, response) => {
    initDb().prepare('delete from storyboards where id = ?').run(request.params.id);
    response.json(getState());
  });

  app.put('/api/storyboards/:id', (request, response) => {
    const prompt = String(request.body?.prompt || '');
    const overrides = request.body?.overrides && typeof request.body.overrides === 'object' ? request.body.overrides : {};
    const assetIds = Array.isArray(request.body?.assetIds) ? request.body.assetIds.map(String) : [];
    initDb().prepare('update storyboards set prompt = ?, overrides_json = ?, asset_ids_json = ?, updated_at = ? where id = ?')
      .run(prompt, JSON.stringify(overrides), JSON.stringify(assetIds), nowIso(), request.params.id);
    response.json(getState());
  });

  app.post('/api/assets', (request, response) => {
    const database = initDb();
    const projectId = String(request.body?.projectId || '').trim();
    const kind = ['image', 'video', 'audio'].includes(request.body?.kind) ? request.body.kind : 'image';
    const fileName = basename(String(request.body?.filename || `${kind}.bin`));
    const name = String(request.body?.name || fileName.replace(/\.[^.]+$/u, '')).trim() || fileName;
    const dataBase64 = String(request.body?.dataBase64 || '').replace(/^data:[^,]+,/u, '');
    if (!dataBase64) return response.status(400).json({ error: 'File data is empty.' });
    const { groupSlug, projectSlug } = projectPathParts(projectId);
    const id = String(request.body?.replaceId || '').trim() || randomUUID();
    const safeName = `${id.slice(0, 8)}-${fileName}`;
    const relativePath = `${groupSlug}/${projectSlug}/${safeName}`;
    const absolutePath = safeResolve(getSettings().materialRoot, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, Buffer.from(dataBase64, 'base64'));
    database.prepare('delete from input_assets where id = ?').run(id);
    database.prepare('insert into input_assets (id, project_id, kind, name, filename, relative_path, created_at) values (?, ?, ?, ?, ?, ?, ?)')
      .run(id, projectId, kind, name, fileName, relativePath, nowIso());
    response.json(getState());
  });

  app.get('/api/assets/:id/file', (request, response) => {
    const asset = initDb().prepare('select * from input_assets where id = ?').get(request.params.id);
    if (!asset) return response.status(404).json({ error: 'Asset not found.' });
    response.sendFile(getAssetAbsolute(asset));
  });

  app.get('/api/outputs/:id/file', (request, response) => {
    const asset = initDb().prepare('select * from output_assets where id = ?').get(request.params.id);
    if (!asset) return response.status(404).json({ error: 'Output not found.' });
    response.sendFile(safeResolve(getSettings().outputRoot, asset.relative_path));
  });

  app.post('/api/queue/enqueue', (request, response) => {
    const storyboardIds = Array.isArray(request.body?.storyboardIds) ? request.body.storyboardIds.map(String) : [];
    const database = initDb();
    for (const storyboardId of storyboardIds) {
      const storyboard = database.prepare('select * from storyboards where id = ?').get(storyboardId);
      if (!storyboard) continue;
      const project = database.prepare('select * from projects where id = ?').get(storyboard.project_id);
      if (!project) continue;
      const existing = database.prepare("select id from queue_tasks where storyboard_id = ? and status in ('queued', 'submitting', 'running', 'retry_wait')").get(storyboardId);
      if (existing) continue;
      const defaults = parseJson(project.defaults_json, defaultProjectDefaults);
      const options = normalizeDefaults({ ...defaults, ...parseJson(storyboard.overrides_json, {}) });
      database.prepare('insert into queue_tasks (id, project_id, storyboard_id, scene_no, status, submit_id, error, prompt, options_json, created_at, started_at, finished_at, last_checked_at, next_retry_at, attempt_count, raw_json) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), storyboard.project_id, storyboard.id, storyboard.scene_no, 'queued', '', '', storyboard.prompt, JSON.stringify(options), nowIso(), '', '', '', '', 0, '{}');
      updateStoryboardStatus(storyboard.id, 'queued');
    }
    void processQueue();
    response.json(getState());
  });

  app.post('/api/queue/process', async (_request, response) => {
    await processQueue();
    response.json(getState());
  });

  app.post('/api/queue/:id/retry', (request, response) => {
    const database = initDb();
    const task = database.prepare('select * from queue_tasks where id = ?').get(request.params.id);
    if (!task) return response.status(404).json({ error: 'Queue task not found.' });
    if (task.status === 'submitting' || task.status === 'running') {
      return response.status(409).json({ error: 'Running task cannot be retried locally until it finishes.' });
    }
    database.prepare('update queue_tasks set status = ?, submit_id = ?, error = ?, started_at = ?, finished_at = ?, last_checked_at = ?, next_retry_at = ?, attempt_count = ?, raw_json = ? where id = ?')
      .run('queued', '', '', '', '', nowIso(), '', 0, '{}', request.params.id);
    updateStoryboardStatus(task.storyboard_id, 'queued');
    void processQueue();
    response.json(getState());
  });

  app.post('/api/queue/:id/cancel-local', (request, response) => {
    const database = initDb();
    const task = database.prepare('select * from queue_tasks where id = ?').get(request.params.id);
    if (!task) return response.status(404).json({ error: 'Queue task not found.' });
    const checkedAt = nowIso();
    database.prepare('update queue_tasks set status = ?, error = ?, finished_at = ?, last_checked_at = ?, next_retry_at = ? where id = ?')
      .run('cancelled', '本地已停止轮询；远端即梦任务不会被自动取消。', checkedAt, checkedAt, '', request.params.id);
    updateStoryboardStatus(task.storyboard_id, 'cancelled');
    response.json(getState());
  });

  app.delete('/api/queue/:id', (request, response) => {
    const database = initDb();
    const task = database.prepare('select * from queue_tasks where id = ?').get(request.params.id);
    if (!task) return response.status(404).json({ error: 'Queue task not found.' });
    database.prepare('delete from queue_tasks where id = ?').run(request.params.id);
    if (task.status === 'submitting' || task.status === 'running') {
      updateStoryboardStatus(task.storyboard_id, 'cancelled');
    } else {
      updateStoryboardStatus(task.storyboard_id, 'idle');
    }
    response.json(getState());
  });

  app.get('/api/jimeng/health', async (_request, response) => {
    const { cliBin } = getSettings();
    try {
      await execFileAsync(cliBin, ['-h'], { maxBuffer: 2 * 1024 * 1024 });
    } catch (error) {
      return response.json({ cliAvailable: false, loginStatus: 'unknown', modelVersions, error: String(error?.message || error), checkedAt: nowIso() });
    }
    try {
      const credit = await runDreaminaJson(['user_credit']);
      response.json({ cliAvailable: true, loginStatus: 'logged_in', modelVersions, credit: credit.payload, checkedAt: nowIso() });
    } catch (error) {
      response.json({ cliAvailable: true, loginStatus: 'logged_out', modelVersions, error: String(error?.message || error), checkedAt: nowIso() });
    }
  });

  app.post('/api/jimeng/tasks', async (request, response) => {
    try {
      const input = request.body || {};
      const options = normalizeDefaults(input.options);
      const result = await runDreaminaJson(buildDreaminaArgs({ ...input, options, images: input.images || [], videos: input.videos || [], audios: input.audios || [] }));
      response.json({ submitId: result.payload?.submit_id || result.payload?.submitId || '', genStatus: result.payload?.gen_status || result.payload?.genStatus || '', raw: result.payload });
    } catch (error) {
      response.status(500).json({ error: String(error?.message || error) });
    }
  });

  app.get('/api/jimeng/tasks/:submitId', async (request, response) => {
    try {
      const result = await runDreaminaJson(['query_result', `--submit_id=${request.params.submitId}`]);
      response.json({ submitId: request.params.submitId, genStatus: result.payload?.gen_status || result.payload?.genStatus || '', queueInfo: result.payload?.queue_info || result.payload?.queueInfo || {}, raw: result.payload });
    } catch (error) {
      response.status(500).json({ error: String(error?.message || error) });
    }
  });

  app.get('/api/jimeng/files/:taskId/:filename', (request, response) => {
    const filePath = safeResolve(join(transientRoot, 'tasks', request.params.taskId), request.params.filename);
    if (!existsSync(filePath)) return response.status(404).json({ error: 'File not found.' });
    response.sendFile(filePath);
  });
}

export async function startJimengBridge(options = {}) {
  initDb();
  const app = express();
  configureRoutes(app);
  const port = Number(options.port || DEFAULT_PORT);
  const server = app.listen(port, '127.0.0.1');
  const interval = setInterval(() => void processQueue(), 5000);
  return {
    port,
    close() {
      clearInterval(interval);
      server.close();
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  startJimengBridge({ port: DEFAULT_PORT }).then(({ port }) => {
    console.log(`Jimeng bridge listening on http://127.0.0.1:${port}`);
  });
}

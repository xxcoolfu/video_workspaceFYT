import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_PROJECT_DEFAULTS } from '../src/shared/types';
import {
  buildDreaminaArgs,
  compilePromptReferences,
  getRetryDelayMs,
  isConcurrencyLimitError,
  normalizeModelVersion,
  sortQueueCandidates,
} from '../src/shared/jimeng';

test('default model stays on non-VIP seedance2.0fast', () => {
  assert.equal(DEFAULT_PROJECT_DEFAULTS.modelVersion, 'seedance2.0fast');
  assert.equal(normalizeModelVersion('unknown'), 'seedance2.0fast');
  assert.equal(normalizeModelVersion('seedance2.0_vip'), 'seedance2.0_vip');
});

test('buildDreaminaArgs selects text2video for pure prompt and passes fast model', () => {
  const args = buildDreaminaArgs({
    prompt: '雨夜街道',
    images: [],
    videos: [],
    audios: [],
    options: DEFAULT_PROJECT_DEFAULTS,
  });
  assert.equal(args[0], 'text2video');
  assert.ok(args.includes('--model_version=seedance2.0fast'));
  assert.ok(args.includes('--video_resolution=720p'));
  assert.ok(args.includes('--poll=0'));
});

test('buildDreaminaArgs selects multimodal2video when media is present', () => {
  const args = buildDreaminaArgs({
    prompt: '@图片1 跑步',
    images: [{ id: 'a1', kind: 'image', name: '角色', absolutePath: 'C:/asset/role.png' }],
    videos: [],
    audios: [],
    options: DEFAULT_PROJECT_DEFAULTS,
  });
  assert.equal(args[0], 'multimodal2video');
  assert.deepEqual(args.slice(1, 3), ['--image', 'C:/asset/role.png']);
});

test('compilePromptReferences orders uploads by @ mention order and rewrites tokens', () => {
  const result = compilePromptReferences('@动作视频 的动作给 @角色图，背景音乐参考 @配乐', [
    { id: 'img', name: '角色图', kind: 'image' },
    { id: 'vid', name: '动作视频', kind: 'video' },
    { id: 'aud', name: '配乐', kind: 'audio' },
  ]);
  assert.equal(result.prompt, '@视频1 的动作给 @图片1，背景音乐参考 @音频1');
  assert.deepEqual(result.uploadOrder, {
    image: ['img'],
    video: ['vid'],
    audio: ['aud'],
  });
});

test('queue candidates sort by smallest scene number first', () => {
  const sorted = sortQueueCandidates([
    { sceneNo: 3, createdAt: '2026-04-29T00:00:02.000Z' },
    { sceneNo: 1, createdAt: '2026-04-29T00:00:03.000Z' },
    { sceneNo: 1, createdAt: '2026-04-29T00:00:01.000Z' },
  ]);
  assert.deepEqual(sorted.map((item) => `${item.sceneNo}:${item.createdAt}`), [
    '1:2026-04-29T00:00:01.000Z',
    '1:2026-04-29T00:00:03.000Z',
    '3:2026-04-29T00:00:02.000Z',
  ]);
});

test('concurrency limit detection and retry backoff are explicit', () => {
  assert.equal(isConcurrencyLimitError('ret=1310 ExceedConcurrencyLimit'), true);
  assert.equal(isConcurrencyLimitError('ordinary failure'), false);
  assert.equal(getRetryDelayMs(1), 30_000);
  assert.equal(getRetryDelayMs(3), 90_000);
  assert.equal(getRetryDelayMs(99), 120_000);
});

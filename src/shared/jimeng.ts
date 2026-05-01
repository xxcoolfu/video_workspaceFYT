import type { AssetKind, LocalAssetRef, ModelVersion, ProjectDefaults, QueueTask, Resolution } from './types';

export const MODEL_VERSIONS: ModelVersion[] = [
  'seedance2.0',
  'seedance2.0fast',
  'seedance2.0_vip',
  'seedance2.0fast_vip',
];

export const NON_VIP_MODEL_VERSIONS: ModelVersion[] = ['seedance2.0', 'seedance2.0fast'];

export function normalizeModelVersion(value: unknown, fallback: ModelVersion = 'seedance2.0fast'): ModelVersion {
  return typeof value === 'string' && MODEL_VERSIONS.includes(value as ModelVersion)
    ? value as ModelVersion
    : fallback;
}

export function modelLabel(model: ModelVersion) {
  const labels: Record<ModelVersion, string> = {
    'seedance2.0': 'Seedance 2.0',
    'seedance2.0fast': 'Seedance 2.0 Fast',
    'seedance2.0_vip': 'Seedance 2.0 VIP',
    'seedance2.0fast_vip': 'Seedance 2.0 Fast VIP',
  };
  return labels[model];
}

export function normalizeResolution(value: unknown, fallback: Resolution = '720p'): Resolution {
  return value === '480p' || value === '720p' || value === '1080p' ? value : fallback;
}

export function isConcurrencyLimitError(message?: string) {
  const normalized = String(message || '').toLowerCase();
  return normalized.includes('exceedconcurrencylimit') || normalized.includes('ret=1310');
}

export function getRetryDelayMs(attemptCount: number) {
  return Math.min(120_000, 30_000 + Math.max(0, attemptCount - 1) * 30_000);
}

export function mapRemoteStatus(status?: string): QueueTask['status'] {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'success' || normalized === 'succeeded') return 'succeeded';
  if (normalized === 'fail' || normalized === 'failed' || normalized === 'error' || normalized === 'expired') return 'failed';
  if (normalized === 'cancelled' || normalized === 'canceled') return 'cancelled';
  return 'running';
}

export function sortQueueCandidates(tasks: Pick<QueueTask, 'sceneNo' | 'createdAt'>[]) {
  return [...tasks].sort((left, right) => left.sceneNo - right.sceneNo || left.createdAt.localeCompare(right.createdAt));
}

export function parsePromptAssetOrder(prompt: string, assets: Array<{ id: string; name: string; kind: AssetKind }>) {
  const hits: Array<{ index: number; id: string; kind: AssetKind }> = [];
  for (const asset of assets) {
    const needles = [`@${asset.name}`, `@${asset.id}`];
    for (const needle of needles) {
      const index = prompt.indexOf(needle);
      if (index >= 0) {
        hits.push({ index, id: asset.id, kind: asset.kind });
        break;
      }
    }
  }
  const orderedIds = new Set<string>();
  return hits
    .sort((left, right) => left.index - right.index)
    .filter((hit) => {
      if (orderedIds.has(hit.id)) return false;
      orderedIds.add(hit.id);
      return true;
    });
}

export function compilePromptReferences(prompt: string, assets: Array<{ id: string; name: string; kind: AssetKind }>) {
  let compiled = prompt;
  const counters: Record<AssetKind, number> = { image: 0, video: 0, audio: 0 };
  const ordered = parsePromptAssetOrder(prompt, assets);
  const uploadOrder: Record<AssetKind, string[]> = { image: [], video: [], audio: [] };

  for (const item of ordered) {
    counters[item.kind] += 1;
    uploadOrder[item.kind].push(item.id);
    const token = item.kind === 'image' ? `@图片${counters[item.kind]}` : item.kind === 'video' ? `@视频${counters[item.kind]}` : `@音频${counters[item.kind]}`;
    const asset = assets.find((candidate) => candidate.id === item.id);
    if (asset) {
      compiled = compiled.replaceAll(`@${asset.name}`, token).replaceAll(`@${asset.id}`, token);
    }
  }

  return { prompt: compiled, uploadOrder };
}

export function buildDreaminaArgs(input: {
  prompt: string;
  images: LocalAssetRef[];
  videos: LocalAssetRef[];
  audios: LocalAssetRef[];
  options: ProjectDefaults;
}) {
  const hasMedia = input.images.length > 0 || input.videos.length > 0 || input.audios.length > 0;
  const command = hasMedia ? 'multimodal2video' : 'text2video';
  return [
    command,
    ...input.images.flatMap((asset) => ['--image', asset.absolutePath]),
    ...input.videos.flatMap((asset) => ['--video', asset.absolutePath]),
    ...input.audios.flatMap((asset) => ['--audio', asset.absolutePath]),
    `--prompt=${input.prompt}`,
    `--model_version=${normalizeModelVersion(input.options.modelVersion)}`,
    `--ratio=${input.options.aspectRatio}`,
    `--video_resolution=${normalizeResolution(input.options.resolution)}`,
    `--duration=${Math.max(4, Math.min(15, Math.round(input.options.durationSec || 4)))}`,
    '--poll=0',
  ];
}

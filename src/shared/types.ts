export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
export type Resolution = '480p' | '720p' | '1080p';
export type ModelVersion = 'seedance2.0' | 'seedance2.0fast' | 'seedance2.0_vip' | 'seedance2.0fast_vip';
export type TemplateId = 'free_text' | 'first_frame' | 'first_last_frame' | 'multi_modal_reference';
export type AssetKind = 'image' | 'video' | 'audio';
export type QueueStatus = 'queued' | 'submitting' | 'running' | 'retry_wait' | 'web_pending' | 'succeeded' | 'failed' | 'cancelled';

export type ProjectDefaults = {
  aspectRatio: AspectRatio;
  resolution: Resolution;
  modelVersion: ModelVersion;
  template: TemplateId;
  durationSec: number;
  generateAudio: boolean;
  firstFrameAssetId?: string;
};

export type Group = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
};

export type Project = {
  id: string;
  groupId: string;
  name: string;
  slug: string;
  defaults: ProjectDefaults;
  createdAt: string;
};

export type Storyboard = {
  id: string;
  projectId: string;
  sceneNo: number;
  prompt: string;
  overrides: Partial<ProjectDefaults>;
  assetIds: string[];
  status: QueueStatus | 'idle';
  isContinuation: boolean;
  createdAt: string;
  updatedAt: string;
};

export type InputAsset = {
  id: string;
  projectId: string;
  kind: AssetKind;
  name: string;
  filename: string;
  relativePath: string;
  previewUrl: string;
  createdAt: string;
};

export type OutputAsset = {
  id: string;
  projectId: string;
  storyboardId: string;
  sceneNo: number;
  kind: 'video' | 'image';
  filename: string;
  relativePath: string;
  previewUrl: string;
  createdAt: string;
};

export type QueueTask = {
  id: string;
  projectId: string;
  storyboardId: string;
  sceneNo: number;
  status: QueueStatus;
  submitId: string;
  error: string;
  prompt: string;
  options: ProjectDefaults;
  createdAt: string;
  startedAt: string;
  finishedAt: string;
  lastCheckedAt: string;
  nextRetryAt: string;
  attemptCount: number;
  raw: unknown;
  raw_json: string;
};

export type AppSettings = {
  materialRoot: string;
  outputRoot: string;
  cliBin: string;
  submitMode: string;
};

export type AppState = {
  settings: AppSettings;
  groups: Group[];
  projects: Project[];
  storyboards: Storyboard[];
  inputAssets: InputAsset[];
  outputAssets: OutputAsset[];
  queueTasks: QueueTask[];
};

export type LocalAssetRef = {
  id: string;
  kind: AssetKind;
  name: string;
  absolutePath: string;
};

export type SubmitTaskRequest = {
  projectId: string;
  storyboardId: string;
  prompt: string;
  images: LocalAssetRef[];
  videos: LocalAssetRef[];
  audios: LocalAssetRef[];
  options: ProjectDefaults;
};

export const DEFAULT_PROJECT_DEFAULTS: ProjectDefaults = {
  aspectRatio: '16:9',
  resolution: '720p',
  modelVersion: 'seedance2.0fast',
  template: 'multi_modal_reference',
  durationSec: 4,
  generateAudio: true,
};

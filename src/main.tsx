import React from 'react';
import ReactDOM from 'react-dom/client';
import { AlertCircle, Camera, Check, Download, FolderPlus, HeartPulse, Image, Library, ListPlus, Play, Plus, RefreshCw, Save, Settings, Upload, Video } from 'lucide-react';
import type { AppState, AssetKind, Group, InputAsset, Project, ProjectDefaults, QueueTask, Storyboard } from './shared/types';
import { DEFAULT_PROJECT_DEFAULTS } from './shared/types';
import { MODEL_VERSIONS, modelLabel, normalizeModelVersion } from './shared/jimeng';
import './styles.css';

const apiBase = 'http://localhost:3210';

function assetUrl(path: string): string {
  if (!path) return path;
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) return path;
  return `${apiBase}${path}`;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || response.statusText);
  return payload as T;
}

function emptyState(): AppState {
  return {
    settings: { materialRoot: '', outputRoot: '', cliBin: 'dreamina', submitMode: 'cli' },
    groups: [],
    projects: [],
    storyboards: [],
    inputAssets: [],
    outputAssets: [],
    queueTasks: [],
  };
}

function effectiveDefaults(project: Project | undefined, storyboard: Storyboard | undefined): ProjectDefaults {
  return {
    ...DEFAULT_PROJECT_DEFAULTS,
    ...(project?.defaults || {}),
    ...(storyboard?.overrides || {}),
    modelVersion: normalizeModelVersion(storyboard?.overrides?.modelVersion || project?.defaults.modelVersion || DEFAULT_PROJECT_DEFAULTS.modelVersion),
  };
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function kindFromMime(mime: string): AssetKind {
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'image';
}

function StatusPill({ status }: { status: string }) {
  const labels: Record<string, string> = {
    'web_pending': '待网页提交',
    'queued': '排队中',
    'submitting': '提交中',
    'running': '生成中',
    'succeeded': '已完成',
    'failed': '失败',
    'cancelled': '已取消',
    'retry_wait': '等待重试',
  };
  return <span className={`pill pill-${status}`}>{labels[status] || status}</span>;
}

function AssetPreview({ asset, onCaptureFrame }: { asset: InputAsset; onCaptureFrame?: (asset: InputAsset, frameData: string) => void }) {
  const videoRef = React.useRef<HTMLVideoElement>(null);

  if (asset.kind === 'image') return <img src={assetUrl(asset.previewUrl)} alt={asset.name} />;
  if (asset.kind === 'video') {
    return (
      <div className="video-container">
        <video 
          ref={videoRef} 
          src={assetUrl(asset.previewUrl)} 
          muted 
          controls 
          className="asset-video"
        />
        {onCaptureFrame && (
          <div className="video-controls-overlay">
            <button 
              className="capture-frame-btn"
              onClick={() => {
                const video = videoRef.current;
                if (video) {
                  const canvas = document.createElement('canvas');
                  canvas.width = video.videoWidth;
                  canvas.height = video.videoHeight;
                  const ctx = canvas.getContext('2d');
                  ctx?.drawImage(video, 0, 0);
                  const frameDataUrl = canvas.toDataURL('image/png');
                  onCaptureFrame(asset, frameDataUrl);
                }
              }}
            >
              <Camera size={16} />
              <span>获取静帧</span>
            </button>
          </div>
        )}
      </div>
    );
  }
  return <div className="asset-audio">音频</div>;
}

function App() {
  const [state, setState] = React.useState<AppState>(emptyState);
  const [selectedGroupId, setSelectedGroupId] = React.useState('');
  const [selectedProjectId, setSelectedProjectId] = React.useState('');
  const [selectedStoryboardId, setSelectedStoryboardId] = React.useState('');
  const [view, setView] = React.useState<'workbench' | 'settings'>('workbench');
  const [health, setHealth] = React.useState<any>(null);
  const [toast, setToast] = React.useState('');
  const [projectDialog, setProjectDialog] = React.useState(false);
  const [newProjectName, setNewProjectName] = React.useState('新视频项目');
  const [sceneCount, setSceneCount] = React.useState(3);
  const [newDefaults, setNewDefaults] = React.useState<ProjectDefaults>(DEFAULT_PROJECT_DEFAULTS);
  const [savedStoryboardId, setSavedStoryboardId] = React.useState('');
  const [isPolling, setIsPolling] = React.useState(false);
  const [pendingStoryboards, setPendingStoryboards] = React.useState<Set<string>>(new Set());
  const [importDialog, setImportDialog] = React.useState(false);
  const [importData, setImportData] = React.useState<any[]>([]);
  const [overwriteScenes, setOverwriteScenes] = React.useState<Set<number>>(new Set());
  const [fileEncoding, setFileEncoding] = React.useState<'utf8' | 'gbk'>('utf8');
  const [currentFile, setCurrentFile] = React.useState<File | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [groupDialog, setGroupDialog] = React.useState(false);
  const [storyboardDirty, setStoryboardDirty] = React.useState(false);
  const [dirtyConfirmPending, setDirtyConfirmPending] = React.useState<{ type: 'switchStoryboard' | 'switchView' | 'none'; target?: any }>({ type: 'none' });
  const [newGroupName, setNewGroupName] = React.useState('新分组');
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = React.useState<{ type: 'group' | 'project'; id: string; name: string } | null>(null);
  const [batchEditDialog, setBatchEditDialog] = React.useState(false);
  const [batchEditParams, setBatchEditParams] = React.useState<ProjectDefaults>(DEFAULT_PROJECT_DEFAULTS);
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const currentEditorRef = React.useRef<{ prompt: string; overrides: Partial<ProjectDefaults>; assetIds: string[] } | null>(null);
  const [capturedFrame, setCapturedFrame] = React.useState<string | null>(null);
  const [capturedFrameAsset, setCapturedFrameAsset] = React.useState<InputAsset | null>(null);
  const [frameDialogOpen, setFrameDialogOpen] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setIsPolling(true);
    try {
      const next = await api<AppState>('/api/state');
      setState(next);
      if (!selectedGroupId && next.groups[0]) setSelectedGroupId(next.groups[0].id);
      if (!selectedProjectId && next.projects[0]) setSelectedProjectId(next.projects[0].id);
    } finally {
      setIsPolling(false);
    }
  }, [selectedGroupId, selectedProjectId]);

  React.useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const selectedGroup = state.groups.find((group) => group.id === selectedGroupId);
  const selectedProject = state.projects.find((project) => project.id === selectedProjectId);
  const projectStoryboards = state.storyboards.filter((storyboard) => storyboard.projectId === selectedProjectId).sort((a, b) => a.sceneNo - b.sceneNo);
  const selectedStoryboard = state.storyboards.find((storyboard) => storyboard.id === selectedStoryboardId) || projectStoryboards[0];
  const projectAssets = state.inputAssets.filter((asset) => asset.projectId === selectedProjectId);
  const projectOutputs = state.outputAssets.filter((asset) => asset.projectId === selectedProjectId);
  const projectQueue = state.queueTasks.filter((task) => task.projectId === selectedProjectId).sort((a, b) => a.sceneNo - b.sceneNo);

  React.useEffect(() => {
    if (!selectedStoryboardId && projectStoryboards[0]) setSelectedStoryboardId(projectStoryboards[0].id);
    if (selectedStoryboardId && !projectStoryboards.some((storyboard) => storyboard.id === selectedStoryboardId)) {
      setSelectedStoryboardId(projectStoryboards[0]?.id || '');
    }
  }, [projectStoryboards, selectedStoryboardId]);

  async function mutate(path: string, body?: unknown, method = 'POST') {
    const init: RequestInit = { method };
    // 只对非DELETE方法添加body
    if (method !== 'DELETE' && body !== undefined) {
      init.body = JSON.stringify(body);
    }
    const next = await api<AppState>(path, init);
    setState(next);
    return next;
  }

  async function createGroup() {
    setGroupDialog(true);
  }

  async function confirmCreateGroup() {
    if (!newGroupName.trim()) return;
    await mutate('/api/groups', { name: newGroupName });
    setGroupDialog(false);
    setNewGroupName('新分组');
  }

  async function deleteGroup(groupId: string, groupName: string) {
    setDeleteConfirm({ type: 'group', id: groupId, name: groupName });
  }

  async function deleteProject(projectId: string, projectName: string) {
    setDeleteConfirm({ type: 'project', id: projectId, name: projectName });
  }

  async function confirmDelete() {
    if (!deleteConfirm) return;
    
    console.log('confirmDelete called with:', deleteConfirm);
    
    try {
      if (deleteConfirm.type === 'group') {
        console.log('Deleting group:', deleteConfirm.id);
        await mutate(`/api/groups/${deleteConfirm.id}`, undefined, 'DELETE');
        if (selectedGroupId === deleteConfirm.id) {
          setSelectedGroupId('');
          setSelectedProjectId('');
        }
      } else {
        console.log('Deleting project:', deleteConfirm.id);
        await mutate(`/api/projects/${deleteConfirm.id}`, undefined, 'DELETE');
        if (selectedProjectId === deleteConfirm.id) {
          setSelectedProjectId('');
        }
      }
      
      console.log('Deletion completed, closing dialog');
      setDeleteConfirm(null);
    } catch (error) {
      console.error('Error deleting:', error);
      alert('删除失败：' + (error instanceof Error ? error.message : '未知错误'));
    }
  }

  function toggleGroupCollapse(groupId: string) {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }

  async function createProject() {
    const groupId = selectedGroupId || state.groups[0]?.id;
    if (!groupId) return;
    const next = await mutate('/api/projects', { groupId, name: newProjectName, defaults: newDefaults, sceneCount });
    const project = next.projects.at(-1);
    if (project) {
      setSelectedProjectId(project.id);
      setSelectedGroupId(project.groupId);
    }
    setProjectDialog(false);
  }

  // 打开批量修改对话框时初始化参数为项目默认值
  function openBatchEditDialog() {
    if (selectedProject) {
      setBatchEditParams({ ...DEFAULT_PROJECT_DEFAULTS, ...selectedProject.defaults });
    }
    setBatchEditDialog(true);
  }

  async function doBatchEdit() {
    if (!selectedProject) return;
    // 只传我们修改的三个参数，不传全部
    await mutate(`/api/projects/${selectedProject.id}/storyboards-batch`, { 
      overrides: {
        aspectRatio: batchEditParams.aspectRatio,
        resolution: batchEditParams.resolution,
        modelVersion: batchEditParams.modelVersion
      }
    }, 'PUT');
    setBatchEditDialog(false);
    setToast(`已批量更新项目内所有分镜的参数`);
  }

  async function saveStoryboard(storyboard: Storyboard, patch: Partial<Storyboard>) {
    await mutate(`/api/storyboards/${storyboard.id}`, {
      prompt: patch.prompt ?? storyboard.prompt,
      overrides: patch.overrides ?? storyboard.overrides,
      assetIds: patch.assetIds ?? storyboard.assetIds,
      isContinuation: patch.isContinuation ?? storyboard.isContinuation,
    }, 'PUT');
    setSavedStoryboardId(storyboard.id);
    window.setTimeout(() => setSavedStoryboardId((current) => current === storyboard.id ? '' : current), 1800);
    setToast(`分镜 ${storyboard.sceneNo} 已保存`);
  }

  async function handleSaveCurrentAndSwitch(targetStoryboardId: string) {
    if (selectedStoryboard) {
      const editorState = currentEditorRef.current;
      await saveStoryboard(selectedStoryboard, {
        prompt: editorState?.prompt ?? selectedStoryboard.prompt,
        overrides: editorState?.overrides ?? selectedStoryboard.overrides,
        assetIds: editorState?.assetIds ?? selectedStoryboard.assetIds,
      });
    }
    setSelectedStoryboardId(targetStoryboardId);
  }

  function handleSetView(newView: 'workbench' | 'settings') {
    if (storyboardDirty) {
      setDirtyConfirmPending({ type: 'switchView', target: newView });
    } else {
      setView(newView);
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!selectedProject || !files?.length) return;
    for (const file of Array.from(files)) {
      await mutate('/api/assets', {
        projectId: selectedProject.id,
        kind: kindFromMime(file.type),
        filename: file.name,
        name: file.name.replace(/\.[^.]+$/u, ''),
        dataBase64: await fileToBase64(file),
      });
    }
    setToast('素材已加入项目');
  }

  async function enqueueSelected() {
    if (!selectedStoryboard) return;
    await mutate('/api/queue/enqueue', { storyboardIds: [selectedStoryboard.id] });
  }

  async function enqueueAllReady() {
    const ready = projectStoryboards.filter((storyboard) => storyboard.prompt.trim()).map((storyboard) => storyboard.id);
    await mutate('/api/queue/enqueue', { storyboardIds: ready });
  }

  async function enqueuePending() {
    const ready = Array.from(pendingStoryboards);
    if (ready.length === 0) return;
    await mutate('/api/queue/enqueue', { storyboardIds: ready });
    setPendingStoryboards(new Set());
  }

  function togglePending(storyboardId: string, hasBeenSubmitted: boolean) {
    setPendingStoryboards((prev) => {
      const next = new Set(prev);
      if (next.has(storyboardId)) {
        next.delete(storyboardId);
      } else {
        next.add(storyboardId);
      }
      return next;
    });
  }

  // 标准CSV解析器，支持引号内换行和引号转义
  function parseCSV(file: File, encoding: 'utf8' | 'gbk'): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          let text = e.target?.result as string;

          if (encoding === 'gbk' && file.arrayBuffer) {
            const buffer = await file.arrayBuffer();
            try {
              const decoder = new TextDecoder('gbk');
              text = decoder.decode(buffer);
            } catch (err) {
              console.log('GBK解码失败，尝试UTF-8', err);
            }
          }

          // 检测分隔符
          const firstLine = text.split(/\r?\n/)[0];
          const delimiter = firstLine.includes('\t') ? '\t' : ',';

          // 解析CSV单元格，处理引号转义
          function parseCSVField(input: string): string {
            const result: string[] = [];
            let current = '';
            let inQuotes = false;
            let i = 0;

            while (i < input.length) {
              const char = input[i];
              const nextChar = input[i + 1];

              if (inQuotes) {
                if (char === '"') {
                  if (nextChar === '"') {
                    current += '"';
                    i += 2;
                  } else {
                    inQuotes = false;
                    i++;
                  }
                } else {
                  current += char;
                  i++;
                }
              } else {
                if (char === '"') {
                  inQuotes = true;
                  i++;
                } else {
                  current += char;
                  i++;
                }
              }
            }
            return current.trim();
          }

          // 按行解析CSV，保持引号内换行（引号原封不动保留）
          const rows: string[] = [];
          let currentRow = '';
          let inQuotes = false;

          for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const nextChar = text[i + 1];

            if (inQuotes) {
              currentRow += char;
              if (char === '"') {
                if (nextChar !== '"') {
                  // 单独引号，退出引号（连续引号""是转义）
                  inQuotes = false;
                } else {
                  // 转义引号，跳过第二个
                  i++;
                }
              }
            } else {
              if (char === '"') {
                currentRow += char;
                inQuotes = true;
              } else if (char === '\n' || (char === '\r' && text[i + 1] === '\n')) {
                const line = currentRow.trim();
                if (line) rows.push(line);
                currentRow = '';
                if (char === '\r') i++;
              } else {
                currentRow += char;
              }
            }
          }

          // 处理最后一行
          const lastLine = currentRow.trim();
          if (lastLine) rows.push(lastLine);

          console.log('CSV解析后行数:', rows.length);

          const data: any[] = [];
          let startIndex = 0;

          // 识别表头
          if (rows.length > 0) {
            const firstRow = rows[0];
            if (firstRow.includes('分镜') || firstRow.includes('序号')) {
              startIndex = 1;
            }
          }

          for (let i = startIndex; i < rows.length; i++) {
            const row = rows[i];
            const fields: string[] = [];
            let currentField = '';
            let inRowQuotes = false;

            // 逐字符解析行
            for (let j = 0; j < row.length; j++) {
              const char = row[j];
              const nextChar = row[j + 1];

              if (inRowQuotes) {
                if (char === '"') {
                  if (nextChar === '"') {
                    currentField += '"';
                    j++;
                  } else {
                    inRowQuotes = false;
                  }
                } else {
                  currentField += char;
                }
              } else {
                if (char === '"') {
                  inRowQuotes = true;
                } else if (char === delimiter) {
                  fields.push(currentField.trim());
                  currentField = '';
                } else {
                  currentField += char;
                }
              }
            }

            fields.push(currentField.trim());

            if (fields.length >= 3) {
              const sceneNo = parseInt(fields[0].trim());
              // 如果素材字段被引号包裹，先去掉引号
              let assetsField = fields[1].trim();
              if (assetsField.startsWith('"') && assetsField.endsWith('"')) {
                assetsField = assetsField.slice(1, -1);
              }
              const assets = assetsField.split(/[,，]/).map(a => a.trim()).filter(a => a);
              const prompt = fields.slice(2).join(' ').trim();

              if (!isNaN(sceneNo)) {
                data.push({ sceneNo, assets, prompt });
                console.log(`分镜${sceneNo}: 素材${assets.length}个, 提示词${prompt.length}字`);
              }
            }
          }

          console.log('解析结果:', data.length, '个分镜');
          resolve(data);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = reject;

      if (encoding === 'utf8') {
        reader.readAsText(file, 'utf-8');
      } else {
        reader.readAsArrayBuffer(file);
      }
    });
  }

  // 处理文件选择
  async function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    
    setCurrentFile(file);
    
    try {
      const data = await parseCSV(file, fileEncoding);
      setImportData(data);
      
      // 检测冲突
      const conflicts = new Set<number>();
      data.forEach(item => {
        const existing = projectStoryboards.find(s => s.sceneNo === item.sceneNo);
        if (existing && existing.prompt.trim()) {
          conflicts.add(item.sceneNo);
        }
      });
      setOverwriteScenes(conflicts);
      
      setImportDialog(true);
    } catch (error) {
      setToast('文件解析失败，请检查格式');
    }
    
    // 重置input
    if (event.target) {
      event.target.value = '';
    }
  }

  // 重新解析文件
  async function reparseFile() {
    if (!currentFile) return;
    
    try {
      const data = await parseCSV(currentFile, fileEncoding);
      setImportData(data);
      
      // 检测冲突
      const conflicts = new Set<number>();
      data.forEach(item => {
        const existing = projectStoryboards.find(s => s.sceneNo === item.sceneNo);
        if (existing && existing.prompt.trim()) {
          conflicts.add(item.sceneNo);
        }
      });
      setOverwriteScenes(conflicts);
    } catch (error) {
      setToast('文件解析失败，请检查格式');
    }
  }

  // 执行导入
  async function executeImport() {
    if (!selectedProject || importData.length === 0) return;
    
    const maxSceneNo = Math.max(...projectStoryboards.map(s => s.sceneNo), 0);
    const importMaxSceneNo = Math.max(...importData.map(d => d.sceneNo));
    
    // 新增缺失的分镜
    for (let i = maxSceneNo + 1; i <= importMaxSceneNo; i++) {
      const hasImport = importData.some(d => d.sceneNo === i);
      if (!hasImport) continue;
      
      await mutate(`/api/projects/${selectedProject.id}/storyboards`);
      await refresh(); // 刷新获取新分镜
    }
    
    // 等待refresh完成
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const updatedState = await api<AppState>('/api/state');
    const updatedStoryboards = updatedState.storyboards.filter(s => s.projectId === selectedProjectId);
    
    // 处理每个分镜
    for (const item of importData) {
      const storyboard = updatedStoryboards.find(s => s.sceneNo === item.sceneNo);
      if (!storyboard) continue;
      
      const shouldOverwrite = overwriteScenes.has(item.sceneNo);
      const hasExistingPrompt = storyboard.prompt.trim();
      
      // 如果已存在且不覆盖，跳过
      if (hasExistingPrompt && !shouldOverwrite) continue;
      
      // 查找素材
      const assetIds: string[] = [];
      item.assets.forEach((assetName: string) => {
        const cleanName = assetName.replace(/^@/, '');
        const asset = projectAssets.find(a => 
          a.name === cleanName || 
          a.filename === cleanName ||
          a.filename === `${cleanName}.png` ||
          a.filename === `${cleanName}.jpg` ||
          a.filename === `${cleanName}.jpeg` ||
          a.filename === `${cleanName}.webp` ||
          a.filename === `${cleanName}.mp4`
        );
        if (asset) {
          assetIds.push(asset.id);
        }
      });
      
      // 组合提示词
      let promptText = '';
      if (item.assets.length > 0) {
        const assetNames = item.assets.map((a: string) => `@${a.replace(/^@/, '')}`).join(' ');
        promptText = `${assetNames}\n\n${item.prompt}`;
      } else {
        promptText = item.prompt;
      }
      
      // 更新分镜
      await mutate(`/api/storyboards/${storyboard.id}`, {
        prompt: promptText,
        overrides: storyboard.overrides,
        assetIds: assetIds
      }, 'PUT');
    }
    
    setImportDialog(false);
    setToast('导入成功！');
    await refresh();
  }

  async function queueAction(task: QueueTask, action: 'retry' | 'delete' | 'cancel-local') {
    try {
      if (action === 'retry') {
        await mutate(`/api/queue/${task.id}/retry`);
        setToast(`分镜 ${task.sceneNo} 已重新入队`);
      } else if (action === 'cancel-local') {
        await mutate(`/api/queue/${task.id}/cancel-local`);
        setToast(`分镜 ${task.sceneNo} 已停止本地轮询`);
      } else {
        await mutate(`/api/queue/${task.id}`, undefined, 'DELETE');
        setToast(`分镜 ${task.sceneNo} 队列记录已删除`);
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : '队列操作失败');
    }
  }

  async function checkHealth() {
    setHealth(await api('/api/jimeng/health'));
  }

  const optionPanel = selectedProject && selectedStoryboard
    ? effectiveDefaults(selectedProject, selectedStoryboard)
    : DEFAULT_PROJECT_DEFAULTS;

  return (
    <main className="app-shell">
      <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="brand">
          <Video size={24} />
          <div>
            <strong>AI视频制作</strong>
            <span>即梦 CLI 队列工作台</span>
          </div>
          <button 
            className="icon-button" 
            title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'} 
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            style={{ marginLeft: 'auto' }}
          >
            {sidebarCollapsed ? '→' : '←'}
          </button>
        </div>

        {view !== 'settings' && (
          <>
            <button className="nav-button" onClick={createGroup}><FolderPlus size={16} />新增分组</button>
            <button className="nav-button" onClick={() => setProjectDialog(true)} disabled={!state.groups.length}><Plus size={16} />新建项目</button>
          </>
        )}

        {view !== 'settings' && (
          <div className="sidebar-section">
          {state.groups.map((group: Group) => {
            const isCollapsed = collapsedGroups.has(group.id);
            const groupProjects = state.projects.filter((project) => project.groupId === group.id);
            return (
              <section key={group.id} className="group-block">
                <div className="group-header">
                  <button 
                    className={`group-title ${selectedGroupId === group.id ? 'active' : ''}`} 
                    onClick={() => setSelectedGroupId(group.id)}
                    onDoubleClick={() => toggleGroupCollapse(group.id)}
                  >
                    {isCollapsed ? '▶' : '▼'} {group.name}
                  </button>
                  <button 
                    className="delete-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteGroup(group.id, group.name);
                    }}
                    title="删除分组"
                  >
                    ✕
                  </button>
                </div>
                {!isCollapsed && groupProjects.map((project) => (
                  <div key={project.id} className="project-item">
                    <button
                      className={`project-link ${selectedProjectId === project.id ? 'active' : ''}`}
                      onClick={() => {
                        setSelectedProjectId(project.id);
                        setSelectedGroupId(project.groupId);
                        handleSetView('workbench');
                      }}
                    >
                      {project.name}
                    </button>
                    <button 
                      className="delete-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteProject(project.id, project.name);
                      }}
                      title="删除项目"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </section>
            );
          })}
          </div>
        )}

        <button className={`settings-link ${view === 'settings' ? 'active' : ''}`} onClick={() => handleSetView(view === 'settings' ? 'workbench' : 'settings')}>
          <Settings size={16} />{view === 'settings' ? '返回工作台' : '设置'}
        </button>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
            {view === 'settings' && (
              <button className="mini-button" onClick={() => handleSetView('workbench')}>
                ← 返回工作台
              </button>
            )}
            <div>
              <p>{selectedGroup?.name || '尚未选择分组'}</p>
              <h1>{view === 'settings' ? '设置' : selectedProject?.name || '创建一个项目开始'}</h1>
            </div>
            {selectedProject && view !== 'settings' && (
              <div style={{ display: 'flex', gap: '8px' }}>
                <label className="mini-button file-pick" style={{ padding: '8px 16px', height: '40px', minHeight: '40px' }}>
                  <Upload size={14} />批量导入
                  <input 
                    type="file" 
                    accept=".csv,.tsv,.txt"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                  />
                </label>
                <button className="mini-button" onClick={openBatchEditDialog} style={{ padding: '8px 16px', height: '40px', minHeight: '40px' }}>批量修改</button>
                <button className="mini-button" onClick={() => void enqueuePending()} style={{ padding: '8px 16px', height: '40px', minHeight: '40px' }}>批量提交</button>
              </div>
            )}
          </div>
          <div className="topbar-actions">
            {toast && <span className="toast">{toast}</span>}
            <button className="icon-button" title="刷新" onClick={refresh}><RefreshCw size={18} /></button>
          </div>
        </header>

        {view === 'settings' ? (
          <SettingsView state={state} health={health} onSave={(settings) => mutate('/api/settings', settings, 'PUT')} onHealth={checkHealth} />
        ) : selectedProject ? (
          <div className="workspace-grid">
            <section className="scene-list panel">
              <div className="panel-title">
                <ListPlus size={17} />
                <strong>分镜</strong>
                <div className="panel-title-actions">
                  <button className="mini-button" onClick={() => mutate(`/api/projects/${selectedProject.id}/storyboards`)}>增加</button>
                </div>
              </div>
              <div className="scene-list-scroll">
              {projectStoryboards.map((storyboard) => {
                const hasBeenSubmitted = storyboard.status !== 'idle';
                const isPending = pendingStoryboards.has(storyboard.id);
                return (
                  <div key={storyboard.id} className="scene-row-wrapper">
                    <input
                      type="checkbox"
                      className="scene-checkbox"
                      checked={isPending}
                      disabled={hasBeenSubmitted}
                      onChange={() => togglePending(storyboard.id, hasBeenSubmitted)}
                      onDoubleClick={() => {
                        if (hasBeenSubmitted) {
                          togglePending(storyboard.id, hasBeenSubmitted);
                        }
                      }}
                    />
                    <button
                      className={`scene-row ${selectedStoryboard?.id === storyboard.id ? 'active' : ''}`}
                      onClick={() => {
                        if (storyboard.id === selectedStoryboard?.id) return;
                        if (storyboardDirty) {
                          setDirtyConfirmPending({ type: 'switchStoryboard', target: storyboard.id });
                        } else {
                          setSelectedStoryboardId(storyboard.id);
                        }
                      }}
                    >
                      <span>分镜 {storyboard.sceneNo}{storyboard.isContinuation ? ' 🔗' : ''}</span>
                      <StatusPill status={storyboard.status} />
                    </button>
                  </div>
                );
              })}
              </div>
            </section>

            <section className="editor panel">
              {selectedStoryboard && (
              <StoryboardEditor
                  storyboard={selectedStoryboard}
                  assets={projectAssets}
                  options={optionPanel}
                  onSave={saveStoryboard}
                  onEnqueue={enqueueSelected}
                  onEnqueueAll={enqueueAllReady}
                  savedSignal={savedStoryboardId === selectedStoryboard.id}
                  onDirtyChange={setStoryboardDirty}
                  onEditorStateChange={(state) => { currentEditorRef.current = state; }}
                  onRefresh={refresh}
                />
              )}
            </section>

            <section className="library-column">
              <div className="panel asset-panel">
                <div className="panel-title">
                  <Library size={17} />
                  <strong>项目素材</strong>
                  <label className="mini-button file-pick">
                    <Upload size={14} />新增
                    <input type="file" multiple accept="image/*,video/*,audio/*" onChange={(event) => void handleFiles(event.target.files)} />
                  </label>
                </div>
                <div className="asset-grid">
                  {projectAssets.map((asset) => (
                    <article key={asset.id} className="asset-card">
                      <AssetPreview 
                        asset={asset} 
                        onCaptureFrame={(asset, frameData) => {
                          setCapturedFrame(frameData);
                          setCapturedFrameAsset(asset);
                          setFrameDialogOpen(true);
                        }}
                      />
                      <div className="asset-card-footer">
                        <span>@{asset.name}</span>
                        <button 
                          className="asset-delete-btn"
                          onClick={async () => {
                            try {
                              const response = await fetch(`${apiBase}/api/assets/${asset.id}/references`);
                              const data = await response.json();
                              
                              if (data.referenced) {
                                const refs = data.storyboards.map((sb: any) => `项目「${sb.projectName}」分镜${sb.sceneNo}`).join('\n');
                                alert(`该素材被以下分镜引用，无法删除：\n\n${refs}`);
                                return;
                              }
                              
                              if (confirm(`确定删除素材 "@${asset.name}" 吗？`)) {
                                const deleteResponse = await fetch(`${apiBase}/api/assets/${asset.id}`, {
                                  method: 'DELETE',
                                });
                                if (deleteResponse.ok) {
                                  await refresh();
                                  setToast(`素材 "@${asset.name}" 已删除`);
                                } else {
                                  const errorData = await deleteResponse.json();
                                  alert('删除失败: ' + (errorData.error || '未知错误'));
                                }
                              }
                            } catch (error) {
                              alert('删除失败: ' + (error instanceof Error ? error.message : '网络错误'));
                            }
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </div>

              <div className="panel queue-panel">
                <div className="panel-title">
                  <Play size={17} />
                  <strong>任务队列</strong>
                  <span className={`polling-indicator ${isPolling ? 'active' : ''}`}>
                    {isPolling ? '轮询中...' : '已连接'}
                  </span>
                  <button
                    className="mini-button"
                    style={{ marginLeft: 'auto', fontSize: '11px' }}
                    onClick={async () => {
                      try {
                        const res = await fetch('/api/queue/reset-stuck', { method: 'POST' });
                        if (res.ok) {
                          const data = await res.json();
                          await refresh();
                          setToast(data.resetCount > 0 ? `已重置${data.resetCount}个卡住的任务` : '没有卡住的任务');
                        }
                      } catch {}
                    }}
                  >
                    重置卡住任务
                  </button>
                </div>
                {projectQueue.map((task: QueueTask) => (
                  <div key={task.id} className="queue-row">
                    <span>分镜 {task.sceneNo}</span>
                    <StatusPill status={task.status} />
                    {task.error && <small>{task.error}</small>}
                    {(task.status === 'submitting' || task.status === 'running') && (
                      <div className="queue-actions">
                        <button
                          className="mini-button"
                          disabled
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void queueAction(task, 'cancel-local');
                          }}
                        >
                          停止轮询
                        </button>
                        <button
                          className="mini-button danger"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void queueAction(task, 'delete');
                          }}
                        >
                          删除记录
                        </button>
                      </div>
                    )}
                    {(task.status === 'failed' || task.status === 'cancelled') && (
                      <div className="queue-actions">
                        <button
                          className="mini-button"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void queueAction(task, 'retry');
                          }}
                        >
                          重试
                        </button>
                        <button
                          className="mini-button danger"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void queueAction(task, 'delete');
                          }}
                        >
                          删除
                        </button>
                      </div>
                    )}
                    {(task.status === 'queued' || task.status === 'retry_wait') && (
                      <div className="queue-actions">
                        <button
                          className="mini-button danger"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void queueAction(task, 'delete');
                          }}
                        >
                          挂起删除
                        </button>
                      </div>
                    )}
                    {task.status === 'web_pending' && (
                      <div style={{ marginTop: '8px', padding: '10px', background: '#fef3cd', borderRadius: '6px', fontSize: '13px' }}>
                        <div style={{ fontWeight: 'bold', color: '#856404', marginBottom: '6px' }}>📋 网页模式待提交</div>
                        <div style={{ marginBottom: '10px' }}>
                          <button
                            style={{
                              background: '#186a63',
                              color: 'white',
                              border: 'none',
                              borderRadius: '6px',
                              padding: '6px 14px',
                              fontSize: '13px',
                              cursor: 'pointer',
                            }}
                            onClick={async () => {
                              const raw = task.raw_json ? JSON.parse(task.raw_json) : null;
                              if (!raw) return;
                              try {
                                const result = await (window as any).jimengDesktop.openJimengWeb({
                                  prompt: raw.prompt,
                                  assets: raw.assets,
                                  options: raw.options,
                                });
                                if (result.success) {
                                  alert('浏览器已打开，提示词已自动填充！');
                                } else {
                                  alert('打开失败: ' + result.error);
                                }
                              } catch (err) {
                                alert('打开浏览器失败: ' + String(err));
                              }
                            }}
                          >
                            🌐 一键打开浏览器（自动填充）
                          </button>
                        </div>
                        <div style={{ marginBottom: '6px' }}>
                          <strong>提示词：</strong>
                          <button
                            className="mini-button"
                            style={{ marginLeft: '8px', padding: '2px 8px', fontSize: '11px' }}
                            onClick={() => {
                              const raw = task.raw_json ? JSON.parse(task.raw_json) : null;
                              if (raw?.prompt) {
                                navigator.clipboard.writeText(raw.prompt);
                              }
                            }}
                          >
                            复制提示词
                          </button>
                        </div>
                        {task.raw_json && (() => {
                          const raw = JSON.parse(task.raw_json);
                          return raw?.prompt ? (
                            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: '80px', overflow: 'auto', background: '#fff', padding: '6px', borderRadius: '4px', marginBottom: '6px', fontSize: '11px' }}>
                              {raw.prompt}
                            </pre>
                          ) : null;
                        })()}
                        {task.raw_json && (() => {
                          const raw = JSON.parse(task.raw_json);
                          const hasAssets = (raw?.images?.length || 0) + (raw?.videos?.length || 0) + (raw?.audios?.length || 0) > 0;
                          return hasAssets ? (
                            <div style={{ fontSize: '12px', color: '#666' }}>
                              <strong>素材文件：</strong>
                              <ul style={{ margin: '4px 0', paddingLeft: '16px' }}>
                                {raw?.images?.map((img: any) => <li key={img.path}>🖼️ {img.path}</li>)}
                                {raw?.videos?.map((vid: any) => <li key={vid.path}>🎬 {vid.path}</li>)}
                                {raw?.audios?.map((aud: any) => <li key={aud.path}>🔊 {aud.path}</li>)}
                              </ul>
                            </div>
                          ) : null;
                        })()}
                        <div style={{ fontSize: '11px', color: '#856404', marginTop: '6px' }}>
                          提示词已自动填充，请手动上传素材和点击提交
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="panel output-panel">
                <div className="panel-title"><Download size={17} /><strong>资产库</strong></div>
                {projectOutputs.map((asset) => (
                  <article key={asset.id} className="output-card">
                    {asset.kind === 'video' ? (
                      <div className="video-container">
                        <video src={assetUrl(asset.previewUrl)} controls className="asset-video" />
                        <div className="video-controls-overlay">
                          <button 
                            className="capture-frame-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              const video = (e.target as HTMLElement).closest('.video-container')?.querySelector('video');
                              if (video) {
                                const canvas = document.createElement('canvas');
                                canvas.width = video.videoWidth;
                                canvas.height = video.videoHeight;
                                const ctx = canvas.getContext('2d');
                                ctx?.drawImage(video, 0, 0);
                                const frameDataUrl = canvas.toDataURL('image/png');
                                setCapturedFrame(frameDataUrl);
                                setCapturedFrameAsset({ name: `分镜${asset.sceneNo}`, id: asset.id, kind: 'video' } as InputAsset);
                                setFrameDialogOpen(true);
                              }
                            }}
                          >
                            <Camera size={16} />
                            <span>获取静帧</span>
                          </button>
                        </div>
                      </div>
                    ) : <img src={assetUrl(asset.previewUrl)} alt={asset.filename} />}
                    <a href={assetUrl(asset.previewUrl)} download>{`分镜 ${asset.sceneNo} · ${asset.filename}`}</a>
                  </article>
                ))}
              </div>
            </section>
          </div>
        ) : (
          <div className="empty-state">
            <Image size={40} />
            <h2>先创建一个分组和项目</h2>
            <p>首版聚焦本地排队、分镜提交和结果资产管理。</p>
            <button onClick={async () => {
              if (!state.groups.length) await createGroup();
              setProjectDialog(true);
            }}>开始</button>
          </div>
        )}
      </section>

      {projectDialog && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>新建项目</h2>
            <label>项目名<input value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} /></label>
            <label>首次分镜数<input type="number" min={1} max={200} value={sceneCount} onChange={(event) => setSceneCount(Number(event.target.value))} /></label>
            <DefaultsForm value={newDefaults} onChange={setNewDefaults} />
            <div className="modal-actions">
              <button className="secondary" onClick={() => setProjectDialog(false)}>取消</button>
              <button onClick={createProject}><Check size={16} />创建</button>
            </div>
          </div>
        </div>
      )}
      
      {groupDialog && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>新建分组</h2>
            <label>分组名<input value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} /></label>
            <div className="modal-actions">
              <button className="secondary" onClick={() => {
                setGroupDialog(false);
                setNewGroupName('新分组');
              }}>取消</button>
              <button onClick={confirmCreateGroup}><Check size={16} />创建</button>
            </div>
          </div>
        </div>
      )}
      
      {importDialog && (
        <div className="modal-backdrop">
          <div className="modal modal-large">
            <h2>导入分镜</h2>
            <div className="encoding-select">
              <label>
                文件编码：
                <select value={fileEncoding} onChange={(e) => setFileEncoding(e.target.value as any)}>
                  <option value="utf8">UTF-8</option>
                  <option value="gbk">GBK (Windows中文)</option>
                </select>
              </label>
              <button className="mini-button" onClick={() => reparseFile()}>重新解析</button>
            </div>
            <div className="import-preview">
              {importData.length === 0 ? (
                <div className="empty-import">
                  <p>没有解析到数据，请检查文件格式</p>
                  <p className="csv-example">
                    逗号/Tab分隔均可，支持引号内换行<br/>
                    CSV示例：<br/>
                    1,"@素材1,@素材2","提示词第一行<br/>提示词第二行"<br/>
                    TSV示例：<br/>
                    1&lt;TAB&gt;@素材1,@素材2&lt;TAB&gt;提示词（可换行）
                  </p>
                </div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>分镜序号</th>
                      <th>分镜素材</th>
                      <th>提示词</th>
                      <th>覆盖</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importData.map((item, index) => {
                      const existing = projectStoryboards.find(s => s.sceneNo === item.sceneNo);
                      const hasConflict = existing && existing.prompt.trim();
                      const isChecked = overwriteScenes.has(item.sceneNo);
                      return (
                        <tr key={index} className={hasConflict ? 'conflict' : ''}>
                          <td>{item.sceneNo}</td>
                          <td>{item.assets.join(', ')}</td>
                          <td className="prompt-preview">{item.prompt}</td>
                          <td>
                            {hasConflict ? (
                              <input 
                                type="checkbox" 
                                checked={isChecked}
                                onChange={() => {
                                  setOverwriteScenes(prev => {
                                    const next = new Set(prev);
                                    if (next.has(item.sceneNo)) {
                                      next.delete(item.sceneNo);
                                    } else {
                                      next.add(item.sceneNo);
                                    }
                                    return next;
                                  });
                                }}
                              />
                            ) : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <div className="import-hint">
              <span className="conflict-hint">黄色</span> 表示该分镜已有提示词，需要勾选"覆盖"才会替换
            </div>
            <div className="modal-actions">
              <button className="secondary" onClick={() => setImportDialog(false)}>取消</button>
              <button onClick={async () => {
                await executeImport();
              }}><Check size={16} />导入</button>
            </div>
          </div>
        </div>
      )}
      
      {batchEditDialog && (
        <div 
          className="modal-backdrop delete-confirm-backdrop"
          style={{ 
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(8, 18, 17, 0.42)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 99999,
            padding: '20px'
          }}
        >
          <div 
            className="modal delete-confirm-modal"
            style={{ 
              background: '#fbfdfc',
              borderRadius: '8px',
              padding: '30px',
              boxShadow: '0 24px 60px rgba(0,0,0,0.22)',
              width: '100%',
              maxWidth: '500px',
              position: 'relative',
              zIndex: 100000,
              overflow: 'visible'
            }}
          >
            <h2 style={{ marginTop: 0, marginBottom: '20px' }}>批量修改分镜参数</h2>
            
            <div className="defaults-grid">
              <label>画幅
                <select value={batchEditParams.aspectRatio} onChange={(event) => setBatchEditParams({ ...batchEditParams, aspectRatio: event.target.value as ProjectDefaults['aspectRatio'] })}>
                  {['16:9', '9:16', '1:1', '4:3', '3:4'].map((item) => <option key={item}>{item}</option>)}
                </select>
              </label>
              <label>分辨率
                <select value={batchEditParams.resolution} onChange={(event) => setBatchEditParams({ ...batchEditParams, resolution: event.target.value as ProjectDefaults['resolution'] })}>
                  {['480p', '720p', '1080p'].map((item) => <option key={item}>{item}</option>)}
                </select>
              </label>
              <label>模型
                <select value={batchEditParams.modelVersion} onChange={(event) => setBatchEditParams({ ...batchEditParams, modelVersion: event.target.value as ProjectDefaults['modelVersion'] })}>
                  {MODEL_VERSIONS.map((item) => <option key={item} value={item}>{modelLabel(item)}{item.includes('vip') ? ' · 高消耗' : ''}</option>)}
                </select>
              </label>
            </div>
            
            <div style={{ display: 'flex', gap: '10px', marginTop: '20px', paddingBottom: '10px' }}>
              <button 
                onClick={() => setBatchEditDialog(false)}
                style={{ 
                  background: '#e8eeed', 
                  color: '#23413e', 
                  minHeight: '40px', 
                  padding: '10px 20px', 
                  border: 'none', 
                  borderRadius: '7px',
                  cursor: 'pointer',
                  flex: 1
                }}
              >取消</button>
              <button 
                onClick={doBatchEdit}
                style={{ 
                  background: '#186a63', 
                  color: 'white', 
                  minHeight: '40px', 
                  padding: '10px 20px', 
                  border: 'none', 
                  borderRadius: '7px',
                  cursor: 'pointer',
                  flex: 1
                }}
              >确认修改</button>
            </div>
          </div>
        </div>
      )}
      
      {deleteConfirm && (
        <div 
          className="modal-backdrop delete-confirm-backdrop"
          style={{ 
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(8, 18, 17, .42)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 99999,
            padding: '20px'
          }}
        >
          <div 
            className="modal delete-confirm-modal"
            style={{ 
              background: '#fbfdfc',
              borderRadius: '8px',
              padding: '30px',
              boxShadow: '0 24px 60px rgba(0,0,0,.22)',
              width: '100%',
              maxWidth: '500px',
              position: 'relative',
              zIndex: 100000,
              overflow: 'visible'
            }}
          >
            <h2 style={{ marginTop: 0, marginBottom: '15px' }}>确认删除</h2>
            <p style={{ marginBottom: '10px' }}>确定要删除 {deleteConfirm.type === 'group' ? '分组' : '项目'}「{deleteConfirm.name}」吗？</p>
            <p style={{ color: '#dc3545', marginBottom: '25px' }}>此操作不可撤销，所有数据将永久删除。</p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button 
                onClick={() => setDeleteConfirm(null)}
                style={{ 
                  background: '#e8eeed', 
                  color: '#23413e', 
                  minHeight: '40px', 
                  padding: '10px 20px', 
                  border: 'none', 
                  borderRadius: '7px',
                  cursor: 'pointer',
                  flex: 1
                }}
              >取消</button>
              <button 
                onClick={confirmDelete}
                style={{ 
                  background: '#dc3545', 
                  color: 'white', 
                  minHeight: '40px', 
                  padding: '10px 20px', 
                  border: 'none', 
                  borderRadius: '7px',
                  cursor: 'pointer',
                  flex: 1
                }}
              >确认删除</button>
            </div>
          </div>
        </div>
      )}

      {dirtyConfirmPending.type !== 'none' && (
        <div
          className="modal-backdrop"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(8, 18, 17, .42)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 99999,
            padding: '20px'
          }}
        >
          <div
            style={{
              background: '#fbfdfc',
              borderRadius: '8px',
              padding: '30px',
              boxShadow: '0 24px 60px rgba(0,0,0,.22)',
              width: '100%',
              maxWidth: '400px',
              position: 'relative',
              zIndex: 100000
            }}
          >
            <h2 style={{ marginTop: 0, marginBottom: '15px' }}>有未保存的修改</h2>
            <p style={{ marginBottom: '25px' }}>当前分镜有未保存的修改，是否先保存？</p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => {
                  setDirtyConfirmPending({ type: 'none' });
                  setStoryboardDirty(false);
                }}
                style={{
                  background: '#e8eeed',
                  color: '#23413e',
                  minHeight: '40px',
                  padding: '10px 20px',
                  border: 'none',
                  borderRadius: '7px',
                  cursor: 'pointer',
                  flex: 1
                }}
              >放弃修改</button>
              <button
                onClick={async () => {
                  const pending = dirtyConfirmPending;
                  setDirtyConfirmPending({ type: 'none' });
                  if (pending.type === 'switchStoryboard' && pending.target) {
                    setStoryboardDirty(false);
                    await handleSaveCurrentAndSwitch(pending.target);
                  } else if (pending.type === 'switchView') {
                    setStoryboardDirty(false);
                    setView(pending.target);
                  }
                }}
                style={{
                  background: '#186a63',
                  color: 'white',
                  minHeight: '40px',
                  padding: '10px 20px',
                  border: 'none',
                  borderRadius: '7px',
                  cursor: 'pointer',
                  flex: 1
                }}
              >保存并继续</button>
            </div>
          </div>
        </div>
      )}

      <FrameCaptureDialog
        isOpen={frameDialogOpen}
        onClose={() => {
          setFrameDialogOpen(false);
          setCapturedFrame(null);
          setCapturedFrameAsset(null);
        }}
        frameData={capturedFrame || ''}
        asset={capturedFrameAsset || {} as InputAsset}
        storyboards={projectStoryboards}
        onSaveToAssets={async () => {
          if (!capturedFrame || !selectedProjectId) return;
          
          try {
            const base64Data = capturedFrame.split(',')[1];
            const fileName = `${capturedFrameAsset?.name || 'frame'}_${Date.now()}.png`;
            
            const data = await api<AppState>('/api/assets', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                projectId: selectedProjectId,
                kind: 'image',
                name: fileName.replace('.png', ''),
                filename: fileName,
                dataBase64: base64Data,
              }),
            });
            
            setState(data);
            setToast('静帧已保存到项目素材库');
          } catch (error) {
            alert('保存失败: ' + (error instanceof Error ? error.message : '网络错误'));
          }
          
          setFrameDialogOpen(false);
          setCapturedFrame(null);
          setCapturedFrameAsset(null);
        }}
        onSetAsFirstFrame={async (storyboardId: string) => {
          if (!capturedFrame || !selectedProjectId) return;
          
          try {
            const base64Data = capturedFrame.split(',')[1];
            const assetName = `首帧_${capturedFrameAsset?.name || 'frame'}_${Date.now()}`;
            const fileName = `${assetName}.png`;
            
            const data = await api<AppState>('/api/assets', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                projectId: selectedProjectId,
                kind: 'image',
                name: assetName,
                filename: fileName,
                dataBase64: base64Data,
              }),
            });
            
            setState(data);
            
            const newAsset = data.inputAssets[data.inputAssets.length - 1];
            if (newAsset) {
              const sb = data.storyboards.find((s) => s.id === storyboardId);
              if (sb) {
                const newAssetIds = [...sb.assetIds, newAsset.id];
                const newOverrides = { ...sb.overrides, firstFrameAssetId: newAsset.id };
                
                await api(`/api/storyboards/${storyboardId}`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    prompt: sb.prompt.includes('= 首帧参考') ? sb.prompt : `@${newAsset.name} = 首帧参考\n\n${sb.prompt}`,
                    overrides: newOverrides,
                    assetIds: newAssetIds,
                    isContinuation: sb.isContinuation,
                  }),
                });
                
                await refresh();
                setToast(`静帧已设为分镜 ${sb.sceneNo} 的首帧素材`);
              }
            }
          } catch (error) {
            alert('设置首帧失败: ' + (error instanceof Error ? error.message : '网络错误'));
          }
          
          setFrameDialogOpen(false);
          setCapturedFrame(null);
          setCapturedFrameAsset(null);
        }}
      />
    </main>
  );
}

function DefaultsForm({ value, onChange }: { value: ProjectDefaults; onChange: (value: ProjectDefaults) => void }) {
  return (
    <div className="defaults-grid">
      <label>画幅
        <select value={value.aspectRatio} onChange={(event) => onChange({ ...value, aspectRatio: event.target.value as ProjectDefaults['aspectRatio'] })}>
          {['16:9', '9:16', '1:1', '4:3', '3:4'].map((item) => <option key={item}>{item}</option>)}
        </select>
      </label>
      <label>分辨率
        <select value={value.resolution} onChange={(event) => onChange({ ...value, resolution: event.target.value as ProjectDefaults['resolution'] })}>
          {['480p', '720p', '1080p'].map((item) => <option key={item}>{item}</option>)}
        </select>
      </label>
      <label>模型
        <select value={value.modelVersion} onChange={(event) => onChange({ ...value, modelVersion: event.target.value as ProjectDefaults['modelVersion'] })}>
          {MODEL_VERSIONS.map((item) => <option key={item} value={item}>{modelLabel(item)}{item.includes('vip') ? ' · 高消耗' : ''}</option>)}
        </select>
      </label>
      <label>功能
        <select value={value.template} onChange={(event) => onChange({ ...value, template: event.target.value as ProjectDefaults['template'] })}>
          <option value="multi_modal_reference">全能参考</option>
          <option value="free_text">纯文本</option>
          <option value="first_frame">首帧</option>
          <option value="first_last_frame">首尾帧</option>
        </select>
      </label>
      <label>时长
        <input type="number" min={4} max={15} value={value.durationSec} onChange={(event) => onChange({ ...value, durationSec: Number(event.target.value) })} />
      </label>
      <label className="checkline">
        <input type="checkbox" checked={value.generateAudio} onChange={(event) => onChange({ ...value, generateAudio: event.target.checked })} />
        生成音频
      </label>
    </div>
  );
}

function StoryboardEditor({ storyboard, assets, options, onSave, onEnqueue, onEnqueueAll, savedSignal, onDirtyChange, onEditorStateChange, onRefresh }: {
  storyboard: Storyboard;
  assets: InputAsset[];
  options: ProjectDefaults;
  onSave: (storyboard: Storyboard, patch: Partial<Storyboard>) => Promise<void>;
  onEnqueue: () => Promise<void>;
  onEnqueueAll: () => Promise<void>;
  savedSignal: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onEditorStateChange?: (state: { prompt: string; overrides: Partial<ProjectDefaults>; assetIds: string[] }) => void;
  onRefresh?: () => Promise<void>;
}) {
  const [prompt, setPrompt] = React.useState(storyboard.prompt);
  const [assetIds, setAssetIds] = React.useState(storyboard.assetIds);
  const [overrides, setOverrides] = React.useState<Partial<ProjectDefaults>>(storyboard.overrides);
  const [dirty, setDirty] = React.useState(false);
  const [saveState, setSaveState] = React.useState<'idle' | 'saving' | 'saved'>('idle');
  const [showAssetPicker, setShowAssetPicker] = React.useState(false);
  const [hoveredAsset, setHoveredAsset] = React.useState<InputAsset | null>(null);
  const [firstFrameAsset, setFirstFrameAsset] = React.useState<InputAsset | null>(null);
  const hoverTimerRef = React.useRef<NodeJS.Timeout | null>(null);
  const promptRef = React.useRef<HTMLTextAreaElement | null>(null);
  const firstFrameFileInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const firstFrameId = storyboard.overrides?.firstFrameAssetId;
    if (firstFrameId) {
      const asset = assets.find(a => a.id === firstFrameId);
      setFirstFrameAsset(asset || null);
    } else {
      setFirstFrameAsset(null);
    }
  }, [storyboard.id, assets]);

  React.useEffect(() => {
    setPrompt(storyboard.prompt);
    setAssetIds(storyboard.assetIds);
    setOverrides(storyboard.overrides);
    setIsContinuation(!!storyboard.isContinuation);
    setDirty(false);
    setShowAssetPicker(false);
  }, [storyboard.id]);

  React.useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  React.useEffect(() => {
    onEditorStateChange?.({ prompt, overrides, assetIds });
  }, [prompt, overrides, assetIds, onEditorStateChange]);

  React.useEffect(() => {
    if (savedSignal) {
      setSaveState('saved');
      setDirty(false);
      const timer = window.setTimeout(() => setSaveState('idle'), 1600);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [savedSignal]);

  const mergedOptions = { ...options, ...overrides };
  const [isContinuation, setIsContinuation] = React.useState(!!storyboard.isContinuation);

  const handleContinuationChange = async (checked: boolean) => {
    setIsContinuation(checked);
    try {
      await api(`/api/storyboards/${storyboard.id}/continuation`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isContinuation: checked }),
      });
      if (onRefresh) await onRefresh();
    } catch (error) {
      alert('保存连续分镜设置失败: ' + (error instanceof Error ? error.message : '网络错误'));
    }
  };

  return (
    <>
      <div className="panel-title editor-title">
        <strong>分镜 {storyboard.sceneNo}</strong>
        <StatusPill status={storyboard.status} />
        <label className="continuation-toggle">
          <input
            type="checkbox"
            checked={isContinuation}
            onChange={(e) => handleContinuationChange(e.target.checked)}
          />
          <span>连续分镜</span>
        </label>
        {isContinuation && (
          <div className="continuation-hint">
            将自动获取上一分镜的最后一帧作为首帧
          </div>
        )}
      </div>
      <textarea
        ref={promptRef}
        className="prompt-box"
        value={prompt}
        placeholder="写入视频提示词，可用 @素材名 引用项目素材。例如：@角色参考 走进雨夜街道，镜头缓慢推进。"
        onChange={(event) => {
          setPrompt(event.target.value);
          setDirty(true);
          const cursor = event.target.selectionStart;
          const beforeCursor = event.target.value.slice(0, cursor);
          setShowAssetPicker(/(^|\s)@\S*$/u.test(beforeCursor));
        }}
      />
      {showAssetPicker && assets.length > 0 && (
        <div className="asset-picker">
          {assets.map((asset) => (
            <button
              key={asset.id}
              className="mini-button asset-picker-item"
              onMouseDown={(event) => {
                event.preventDefault();
                const textarea = promptRef.current;
                const cursor = textarea?.selectionStart ?? prompt.length;
                const before = prompt.slice(0, cursor).replace(/@\S*$/u, `@${asset.name} `);
                const after = prompt.slice(cursor);
                setPrompt(`${before}${after}`);
                setAssetIds((current) => current.includes(asset.id) ? current : [...current, asset.id]);
                setDirty(true);
                setShowAssetPicker(false);
                window.setTimeout(() => textarea?.focus(), 0);
              }}
              onMouseEnter={() => {
                if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
                hoverTimerRef.current = setTimeout(() => {
                  setHoveredAsset(asset);
                }, 300);
              }}
              onMouseLeave={() => {
                if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
                setHoveredAsset(null);
              }}
            >
              @{asset.name}
            </button>
          ))}
          {hoveredAsset && (
            <div className="asset-preview-tooltip">
              {hoveredAsset.kind === 'image' && (
                <img src={assetUrl(hoveredAsset.previewUrl)} alt={hoveredAsset.name} />
              )}
              {hoveredAsset.kind === 'video' && (
                <video src={assetUrl(hoveredAsset.previewUrl)} muted autoPlay loop playsInline />
              )}
              {hoveredAsset.kind === 'audio' && (
                <div className="asset-audio-preview">音频</div>
              )}
              <div className="asset-preview-name">{hoveredAsset.name}</div>
            </div>
          )}
        </div>
      )}
      <div className="hint-line">被引用素材会按提示词里 @ 出现顺序上传，并转换为 @图片1 / @视频1 / @音频1。</div>

      <div className="asset-select-list">
        {assets.map((asset) => (
          <label 
            key={asset.id} 
            className="asset-toggle"
            onMouseEnter={() => {
              if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
              hoverTimerRef.current = setTimeout(() => {
                setHoveredAsset(asset);
              }, 300);
            }}
            onMouseLeave={() => {
              if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
              setHoveredAsset(null);
            }}
          >
            <input
              type="checkbox"
              checked={assetIds.includes(asset.id)}
              onChange={(event) => {
                const newAssetIds = event.target.checked 
                  ? [...assetIds, asset.id] 
                  : assetIds.filter((id) => id !== asset.id);
                setAssetIds(newAssetIds);
                
                const selectedAssets = newAssetIds
                  .map(id => assets.find(a => a.id === id))
                  .filter(Boolean);
                
                const assetLines = selectedAssets.map(a => `@${a!.name}`).join('\n');
                
                const assetNames = new Set(selectedAssets.map(a => a!.name));
                
                const lines = prompt.split('\n');
                const nonAssetLines = lines.filter(line => {
                  if (!line.startsWith('@')) return true;
                  const name = line.slice(1);
                  return !assetNames.has(name);
                });
                const promptBody = nonAssetLines.join('\n').trim();
                
                const newPrompt = assetLines 
                  ? `${assetLines}\n\n${promptBody}` 
                  : promptBody;
                
                setPrompt(newPrompt);
                setDirty(true);
              }}
            />
            @{asset.name}
          </label>
        ))}
        {hoveredAsset && (
          <div className="asset-preview-popup">
            {hoveredAsset.kind === 'image' && (
              <img src={assetUrl(hoveredAsset.previewUrl)} alt={hoveredAsset.name} />
            )}
            {hoveredAsset.kind === 'video' && (
              <video src={assetUrl(hoveredAsset.previewUrl)} muted autoPlay loop playsInline />
            )}
            {hoveredAsset.kind === 'audio' && (
              <div className="asset-audio-preview">音频</div>
            )}
            <div className="asset-preview-name">{hoveredAsset.name}</div>
          </div>
        )}
      </div>

      <div className="first-frame-section">
        <div className="section-title">
          <Image size={16} />
          <strong>首帧素材</strong>
          <span className="section-hint">（只属于此分镜）</span>
        </div>
        {firstFrameAsset ? (
          <div className="first-frame-preview">
            <div className="preview-image-wrapper">
              <img src={assetUrl(firstFrameAsset.previewUrl)} alt={firstFrameAsset.name} />
              <span className="first-frame-badge">首帧参考</span>
            </div>
            <div className="preview-info">
              <span className="asset-name">@{firstFrameAsset.name}</span>
              <button 
                className="small-button danger"
                onClick={() => {
                  setOverrides({ ...overrides, firstFrameAssetId: undefined });
                  setFirstFrameAsset(null);
                  setDirty(true);
                }}
              >
                删除首帧素材
              </button>
            </div>
          </div>
        ) : (
          <div className="upload-area">
            <input
              ref={firstFrameFileInputRef}
              type="file"
              accept="image/*"
              className="hidden-input"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;

                try {
                  const base64Data = await fileToBase64(file);
                  const data = await api<AppState>('/api/assets', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      projectId: storyboard.projectId,
                      kind: 'image',
                      filename: file.name,
                      name: file.name.replace(/\.[^.]+$/u, ''),
                      dataBase64: base64Data,
                    }),
                  });
                  
                  if (onRefresh) {
                    await onRefresh();
                  }
                  
                  const newAsset = data.inputAssets.find((a: InputAsset) => a.name === file.name.replace(/\.[^.]+$/u, ''));
                  if (newAsset) {
                    setFirstFrameAsset(newAsset);
                    setOverrides({ ...overrides, firstFrameAssetId: newAsset.id });
                    setAssetIds([...assetIds, newAsset.id]);
                    
                    const firstFrameLine = `@${newAsset.name} = 首帧参考`;
                    const lines = prompt.split('\n');
                    const hasFirstFrame = lines.some(line => line.includes('= 首帧参考'));
                    
                    if (!hasFirstFrame) {
                      setPrompt(`${firstFrameLine}\n\n${prompt}`);
                    }
                    setDirty(true);
                  }
                } catch (error) {
                  alert('上传失败: ' + (error instanceof Error ? error.message : '网络错误'));
                }
              }}
            />
            <button 
              className="secondary upload-button"
              onClick={() => firstFrameFileInputRef.current?.click()}
            >
              <Upload size={18} />
              <span>上传首帧素材</span>
            </button>
          </div>
        )}
      </div>

      <DefaultsForm value={mergedOptions} onChange={(value) => {
        setOverrides(value);
        setDirty(true);
      }} />

      <div className="editor-actions">
        <button className="secondary" onClick={async () => {
          setSaveState('saving');
          await onSave(storyboard, { prompt, assetIds, overrides });
        }}>
          <Save size={16} />{saveState === 'saving' ? '保存中' : saveState === 'saved' ? '已保存' : dirty ? '保存分镜*' : '保存分镜'}
        </button>
        <button onClick={async () => {
          await onSave(storyboard, { prompt, assetIds, overrides });
          await onEnqueue();
        }}><Play size={16} />提交当前</button>
      </div>
    </>
  );
}

function SettingsView({ state, health, onSave, onHealth }: {
  state: AppState;
  health: any;
  onSave: (settings: AppState['settings']) => Promise<unknown>;
  onHealth: () => Promise<void>;
}) {
  const [settings, setSettings] = React.useState(state.settings);
  const [dirty, setDirty] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  React.useEffect(() => {
    if (!dirty) setSettings(state.settings);
  }, [state.settings, dirty]);

  return (
    <div className="settings-grid panel">
      <label>素材库根目录<input value={settings.materialRoot} onChange={(event) => {
        setSettings({ ...settings, materialRoot: event.target.value });
        setDirty(true);
      }} /></label>
      <label>资产库根目录<input value={settings.outputRoot} onChange={(event) => {
        setSettings({ ...settings, outputRoot: event.target.value });
        setDirty(true);
      }} /></label>
      <label>dreamina CLI<input value={settings.cliBin} onChange={(event) => {
        setSettings({ ...settings, cliBin: event.target.value });
        setDirty(true);
      }} /></label>
      <label>提交模式
        <select value={settings.submitMode} onChange={(event) => {
          setSettings({ ...settings, submitMode: event.target.value });
          setDirty(true);
        }}>
          <option value="cli">CLI 模式（自动提交）</option>
          <option value="web">网页模式（手动提交）</option>
        </select>
      </label>
      <div className="settings-actions">
        <button onClick={async () => {
          await onSave(settings);
          setDirty(false);
          setSaved(true);
          window.setTimeout(() => setSaved(false), 1600);
        }}><Save size={16} />{saved ? '已保存' : dirty ? '保存*' : '保存'}</button>
        <button className="secondary" onClick={() => void onHealth()}><HeartPulse size={16} />健康检查</button>
      </div>
      {health && (
        <div className={`health-card ${health.cliAvailable && health.loginStatus === 'logged_in' ? 'ok' : 'warn'}`}>
          {health.cliAvailable && health.loginStatus === 'logged_in' ? <Check size={18} /> : <AlertCircle size={18} />}
          <div>
            <strong>{health.cliAvailable ? `CLI 可用 · ${health.loginStatus}` : 'CLI 不可用'}</strong>
            <div style={{ marginTop: '8px', fontSize: '14px', color: '#666' }}>
              当前模式: <span style={{ fontWeight: 'bold', color: health.submitMode === 'cli' ? '#186a63' : '#e67e22' }}>
                {health.submitMode === 'cli' ? 'CLI 自动提交' : '网页手动提交'}
              </span>
            </div>
            <pre>{JSON.stringify(health.credit || health.error || health, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

function FrameCaptureDialog({ 
  isOpen, 
  onClose, 
  frameData, 
  asset,
  storyboards,
  onSaveToAssets, 
  onSetAsFirstFrame 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  frameData: string;
  asset: InputAsset;
  storyboards: Storyboard[];
  onSaveToAssets: () => void;
  onSetAsFirstFrame: (storyboardId: string) => void;
}) {
  const [selectedStoryboardId, setSelectedStoryboardId] = React.useState('');

  if (!isOpen || !frameData) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <strong>获取静帧</strong>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="frame-preview">
            <img src={frameData} alt="静帧预览" />
          </div>
          <div className="frame-info">
            <p>来源: @{asset.name}</p>
          </div>
          <div className="frame-actions">
            <button className="secondary" onClick={onSaveToAssets}>
              <Save size={16} />
              <span>保存到项目素材库</span>
            </button>
          </div>
          <div className="first-frame-target">
            <div className="section-title">
              <Image size={16} />
              <strong>设为分镜首帧素材</strong>
            </div>
            <div className="storyboard-select-row">
              <select value={selectedStoryboardId} onChange={(e) => setSelectedStoryboardId(e.target.value)}>
                <option value="">选择分镜...</option>
                {storyboards.map((sb) => (
                  <option key={sb.id} value={sb.id}>分镜 {sb.sceneNo}</option>
                ))}
              </select>
              <button 
                disabled={!selectedStoryboardId}
                onClick={() => {
                  if (selectedStoryboardId) onSetAsFirstFrame(selectedStoryboardId);
                }}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);

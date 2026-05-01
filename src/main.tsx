import React from 'react';
import ReactDOM from 'react-dom/client';
import { AlertCircle, Check, Download, FolderPlus, HeartPulse, Image, Library, ListPlus, Play, Plus, RefreshCw, Save, Settings, Upload, Video } from 'lucide-react';
import type { AppState, AssetKind, Group, InputAsset, Project, ProjectDefaults, QueueTask, Storyboard } from './shared/types';
import { DEFAULT_PROJECT_DEFAULTS } from './shared/types';
import { MODEL_VERSIONS, modelLabel, normalizeModelVersion } from './shared/jimeng';
import './styles.css';

const apiBase = '';

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
    settings: { materialRoot: '', outputRoot: '', cliBin: 'dreamina' },
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
  return <span className={`pill pill-${status}`}>{status}</span>;
}

function AssetPreview({ asset }: { asset: InputAsset }) {
  if (asset.kind === 'image') return <img src={asset.previewUrl} alt={asset.name} />;
  if (asset.kind === 'video') return <video src={asset.previewUrl} muted controls />;
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
  const [newGroupName, setNewGroupName] = React.useState('新分组');
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = React.useState<{ type: 'group' | 'project'; id: string; name: string } | null>(null);
  const [batchEditDialog, setBatchEditDialog] = React.useState(false);
  const [batchEditParams, setBatchEditParams] = React.useState<ProjectDefaults>(DEFAULT_PROJECT_DEFAULTS);
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);

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
    const interval = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const selectedGroup = state.groups.find((group) => group.id === selectedGroupId);
  const selectedProject = state.projects.find((project) => project.id === selectedProjectId);
  const projectStoryboards = state.storyboards.filter((storyboard) => storyboard.projectId === selectedProjectId).sort((a, b) => a.sceneNo - b.sceneNo);
  const selectedStoryboard = state.storyboards.find((storyboard) => storyboard.id === selectedStoryboardId) || projectStoryboards[0];
  const projectAssets = state.inputAssets.filter((asset) => asset.projectId === selectedProjectId);
  const projectOutputs = state.outputAssets.filter((asset) => asset.projectId === selectedProjectId);
  const projectQueue = state.queueTasks.filter((task) => task.projectId === selectedProjectId);

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
    }, 'PUT');
    setSavedStoryboardId(storyboard.id);
    window.setTimeout(() => setSavedStoryboardId((current) => current === storyboard.id ? '' : current), 1800);
    setToast(`分镜 ${storyboard.sceneNo} 已保存`);
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

  // 解析CSV文件
  function parseCSV(file: File, encoding: 'utf8' | 'gbk'): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          let text = e.target?.result as string;
          
          // 如果选择GBK编码，需要用TextDecoder解码
          if (encoding === 'gbk' && file.arrayBuffer) {
            const buffer = await file.arrayBuffer();
            try {
              const decoder = new TextDecoder('gbk');
              text = decoder.decode(buffer);
            } catch (err) {
              console.log('GBK解码失败，尝试UTF-8', err);
              // 回退到UTF-8
            }
          }
          
          const lines = text.split(/\r?\n/).filter(line => line.trim());
          const data: any[] = [];
          
          console.log('CSV内容:', lines); // 调试
          
          // 尝试自动识别表头
          let startIndex = 0;
          if (lines.length > 0) {
            const firstLine = lines[0];
            if (firstLine.includes('分镜') || firstLine.includes('序号')) {
              startIndex = 1; // 有表头，跳过第一行
            }
          }
          
          for (let i = startIndex; i < lines.length; i++) {
            const columns = lines[i].split(',');
            if (columns.length >= 3) {
              const sceneNo = parseInt(columns[0].trim());
              const assets = columns[1].trim().split(/[,，]/).map(a => a.trim()).filter(a => a);
              const prompt = columns.slice(2).join(',').trim();
              
              console.log('解析行:', { sceneNo, assets, prompt }); // 调试
              
              if (!isNaN(sceneNo)) {
                data.push({ sceneNo, assets, prompt });
              }
            }
          }
          console.log('解析结果:', data); // 调试
          resolve(data);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = reject;
      
      if (encoding === 'utf8') {
        reader.readAsText(file, 'utf-8');
      } else {
        reader.readAsArrayBuffer(file); // GBK用ArrayBuffer读取，在onload中解码
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
                        setView('workbench');
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

        <button className={`settings-link ${view === 'settings' ? 'active' : ''}`} onClick={() => setView(view === 'settings' ? 'workbench' : 'settings')}>
          <Settings size={16} />{view === 'settings' ? '返回工作台' : '设置'}
        </button>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
            {view === 'settings' && (
              <button className="mini-button" onClick={() => setView('workbench')}>
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
                    accept=".csv"
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
                      onClick={() => setSelectedStoryboardId(storyboard.id)}
                    >
                      <span>分镜 {storyboard.sceneNo}</span>
                      <StatusPill status={storyboard.status} />
                    </button>
                  </div>
                );
              })}
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
                      <AssetPreview asset={asset} />
                      <span>@{asset.name}</span>
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
                  </div>
                ))}
              </div>

              <div className="panel output-panel">
                <div className="panel-title"><Download size={17} /><strong>资产库</strong></div>
                {projectOutputs.map((asset) => (
                  <article key={asset.id} className="output-card">
                    {asset.kind === 'video'
                      ? <video src={asset.previewUrl} controls />
                      : <img src={asset.previewUrl} alt={asset.filename} />}
                    <a href={asset.previewUrl} download>{`分镜 ${asset.sceneNo} · ${asset.filename}`}</a>
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
                  <p>没有解析到数据，请检查CSV文件格式</p>
                  <p className="csv-example">
                    示例格式：<br/>
                    分镜序号,分镜素材,提示词<br/>
                    1,@马力,@jinu,一个人在雨中行走<br/>
                    3,@风景,美丽的自然风光
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

function StoryboardEditor({ storyboard, assets, options, onSave, onEnqueue, onEnqueueAll, savedSignal }: {
  storyboard: Storyboard;
  assets: InputAsset[];
  options: ProjectDefaults;
  onSave: (storyboard: Storyboard, patch: Partial<Storyboard>) => Promise<void>;
  onEnqueue: () => Promise<void>;
  onEnqueueAll: () => Promise<void>;
  savedSignal: boolean;
}) {
  const [prompt, setPrompt] = React.useState(storyboard.prompt);
  const [assetIds, setAssetIds] = React.useState(storyboard.assetIds);
  const [overrides, setOverrides] = React.useState<Partial<ProjectDefaults>>(storyboard.overrides);
  const [dirty, setDirty] = React.useState(false);
  const [saveState, setSaveState] = React.useState<'idle' | 'saving' | 'saved'>('idle');
  const [showAssetPicker, setShowAssetPicker] = React.useState(false);
  const promptRef = React.useRef<HTMLTextAreaElement | null>(null);

  React.useEffect(() => {
    setPrompt(storyboard.prompt);
    setAssetIds(storyboard.assetIds);
    setOverrides(storyboard.overrides);
    setDirty(false);
    setShowAssetPicker(false);
  }, [storyboard.id]);

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

  return (
    <>
      <div className="panel-title editor-title">
        <strong>分镜 {storyboard.sceneNo}</strong>
        <StatusPill status={storyboard.status} />
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
              className="mini-button"
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
            >
              @{asset.name}
            </button>
          ))}
        </div>
      )}
      <div className="hint-line">被引用素材会按提示词里 @ 出现顺序上传，并转换为 @图片1 / @视频1 / @音频1。</div>

      <div className="asset-select-list">
        {assets.map((asset) => (
          <label key={asset.id} className="asset-toggle">
            <input
              type="checkbox"
              checked={assetIds.includes(asset.id)}
              onChange={(event) => {
                setAssetIds((current) => event.target.checked ? [...current, asset.id] : current.filter((id) => id !== asset.id));
                setDirty(true);
              }}
            />
            @{asset.name}
          </label>
        ))}
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
            <pre>{JSON.stringify(health.credit || health.error || health, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);

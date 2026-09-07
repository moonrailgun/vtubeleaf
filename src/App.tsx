import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DropdownMenu } from 'radix-ui';
import {
  Image,
  FolderHeart,
  FolderOpen,
  ScanFace,
  UserRound,
  MonitorUp,
  PanelTopClose,
  X,
  ArrowUpRight,
  Plus,
  ChevronDown,
  Video,
  Sparkles,
} from 'lucide-react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { NativeSelect as Select } from './components/ui/native-select';
import { Switch } from './components/ui/switch';
import { Slider } from './components/ui/slider';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from './components/ui/collapsible';
import { createStudio, type Studio, type StudioView } from './studio';
import {
  defaults,
  defaultMapping,
  parameterNames,
  faceSources,
  type Settings,
  type Mapping,
  type FaceKey,
} from './state';
import type { MotionMode } from './renderer';

function Fold({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Collapsible className="fold">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="fold-trigger">
          {title}
          <ChevronDown aria-hidden="true" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="fold-content">{children}</CollapsibleContent>
    </Collapsible>
  );
}
function Toggle({
  id,
  label,
  checked,
  onChange,
  note,
  disabled,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  note?: string;
  disabled?: boolean;
}) {
  return (
    <div className="check">
      <label htmlFor={id}>
        {label}
        {note && <small>{note}</small>}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}
function Range({
  id,
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="range-field">
      <div className="slider-label">
        <span id={`${id}-label`}>{label}</span>
        <output id={`${id}-value`}>
          {value.toFixed(2)}
          {id.includes('Smooth') || id === 'lostDelay' ? ' s' : ''}
        </output>
      </div>
      <Slider
        id={id}
        aria-labelledby={`${id}-label`}
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([next]) => onChange(next)}
      />
    </div>
  );
}
const tabs = [
  { id: 'library', label: '角色库', title: '角色库', icon: FolderHeart, color: 'model' },
  { id: 'appearance', label: '画面', title: '画面设置', icon: Image, color: 'appearance' },
  { id: 'capture', label: '面捕', title: '面部捕捉', icon: ScanFace, color: 'capture' },
  { id: 'model-controls', label: '角色', title: '角色控制', icon: UserRound, color: 'model' },
  { id: 'meeting', label: '接入', title: '会议接入', icon: MonitorUp, color: 'meeting' },
];
const initialView: StudioView = {
  ready: false,
  settings: defaults,
  model: null,
  library: [],
  libraryDirectory: '',
  dropActive: false,
  previews: {},
  modelLoading: false,
  profileRevision: 0,
  tracking: 'stopped',
  cameraDevices: [],
  renderStatus: '画面预览',
  faceStatus: '点击开始后才会采集',
  bodyStatus: '上半身待识别',
  faceInput: {},
  notice: { message: '画面与面部数据仅在本机处理，不使用麦克风。', error: false },
  events: [],
  parameters: [],
  expressions: [],
  motions: [],
  activeExpressions: new Set(),
  recording: false,
  duration: 0,
  canSaveRecording: false,
};
export function App() {
  const container = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const mesh = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const nav = useRef<HTMLButtonElement[]>([]);
  const runtime = useRef<Studio | null>(null);
  const liveButton = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState(initialView);
  const [tab, setTab] = useState('capture');
  const [collapsed, setCollapsed] = useState(false);
  const [live, setLive] = useState(false);
  const [preview, setPreview] = useState(false);
  const [showMesh, setShowMesh] = useState(true);
  useEffect(() => {
    const studio = createStudio(container.current!, video.current!, setView, mesh.current!);
    runtime.current = studio;
    setView(studio.snapshot());
    const element = container.current!;
    const wheel = (event: WheelEvent) => {
      const current = studio.snapshot();
      if (!current.model || current.modelLoading) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const delta =
        event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
      studio.actions.zoom(
        Math.exp(-delta * 0.0015),
        (event.clientX - rect.left) / rect.width - 0.5,
        (event.clientY - rect.top) / rect.height - 0.5,
      );
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => {
      element.removeEventListener('wheel', wheel);
      runtime.current = null;
      studio.destroy();
    };
  }, []);
  useEffect(() => {
    if (!live) return;
    container.current?.focus();
    const restore = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      setLive(false);
      requestAnimationFrame(() => liveButton.current?.focus());
    };
    document.addEventListener('keydown', restore, true);
    return () => {
      document.removeEventListener('keydown', restore, true);
    };
  }, [live]);
  const a = runtime.current?.actions;
  const run = (fn: () => unknown) => a?.run(fn);
  const s = view.settings;
  const active = view.tracking !== 'stopped';
  const busy = !view.ready || view.modelLoading;
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => a?.setSetting(key, value);
  const range = (key: keyof Settings, label: string, min: number, max: number, step: number) => (
    <Range
      key={key}
      id={key}
      label={label}
      value={s[key] as number}
      min={min}
      max={max}
      step={step}
      onChange={(value) => set(key, value)}
    />
  );
  const toggle = (key: keyof Settings, label: string) => (
    <Toggle
      id={key}
      label={label}
      checked={s[key] as boolean}
      onChange={(value) => set(key, value)}
    />
  );
  const trackingLabel = {
    stopped: '尚未开始',
    starting: '正在启动',
    running: '正在跟踪',
    paused: '已暂停',
  }[view.tracking];
  const cameraLabel =
    s.engine === 'openseeface'
      ? active
        ? 'OpenSeeFace 本地接收中'
        : 'OpenSeeFace 未连接'
      : active
        ? '摄像头使用中'
        : '摄像头未使用';
  const common = view.parameters.filter((p) => Object.hasOwn(parameterNames, p.id));
  return (
    <div className={`studio-shell${live ? ' live-mode' : ''}`}>
      <div
        className="model-drop-overlay studio-overlay"
        hidden={!view.dropActive}
        inert={live}
        role="status"
      >
        <FolderHeart aria-hidden="true" />
        <strong>{busy ? '请稍候，角色正在加载' : '松开鼠标，加入角色库'}</strong>
        <span>模型文件夹 · model3.json · ZIP，可一次拖入多个</span>
      </div>
      <header className="topbar studio-overlay" inert={live}>
        <a className="brand" href="#" aria-label="VTubeLeaf 首页">
          <img src="/brand/mark.svg" alt="" />
          <span>
            VTubeLeaf<small>LIVE2D STUDIO</small>
          </span>
        </a>
        <div className="header-actions">
          <span className="local-badge">
            <i />
            本机处理
          </span>
          <Button
            id="live-mode"
            ref={liveButton}
            disabled={!view.ready}
            aria-label="直播模式"
            title="隐藏所有面板，按 Esc 恢复界面"
            onClick={() => setLive(true)}
          >
            <PanelTopClose aria-hidden="true" />
            直播模式
            <small>Esc 恢复界面</small>
          </Button>
          <Button
            id="open-output"
            className="output-button"
            disabled={!view.ready}
            onClick={() => run(() => a?.openOutput())}
          >
            独立输出窗口
            <ArrowUpRight aria-hidden="true" />
          </Button>
        </div>
      </header>
      <main id="studio" className={`studio${collapsed ? ' panel-collapsed' : ''}`}>
        <nav className="toolbar studio-overlay" aria-label="设置分类" inert={live}>
          {tabs.map((item, index) => (
            <Button
              key={item.id}
              ref={(el) => {
                if (el) nav.current[index] = el;
              }}
              variant="ghost"
              data-tab={item.id}
              aria-label={item.label}
              aria-pressed={!collapsed && tab === item.id}
              aria-controls={item.id}
              className={`tool tool-${item.color}${!collapsed && tab === item.id ? ' active' : ''}`}
              onClick={() => {
                setTab(item.id);
                setCollapsed(false);
              }}
            >
              <span className="tool-icon">
                <item.icon aria-hidden="true" />
              </span>
              <span>{item.label}</span>
            </Button>
          ))}
          <span className="toolbar-end" aria-hidden="true">
            ✦
          </span>
        </nav>
        <section className="workspace" aria-label="角色预览">
          <div className="stage-frame">
            <div
              id="stage"
              ref={container}
              tabIndex={-1}
              data-draggable={!!view.model && !busy}
              aria-label="角色舞台，可拖动移动和滚轮缩放"
              onPointerDown={(event) => {
                if (event.button !== 0 || !view.model || busy || drag.current) return;
                event.preventDefault();
                drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                const previous = drag.current;
                if (!previous || previous.id !== event.pointerId) return;
                const rect = event.currentTarget.getBoundingClientRect();
                a?.pan(
                  (event.clientX - previous.x) / rect.width,
                  (event.clientY - previous.y) / rect.height,
                );
                drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
              }}
              onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId);
                drag.current = null;
              }}
              onPointerCancel={() => {
                drag.current = null;
              }}
              onLostPointerCapture={() => {
                drag.current = null;
              }}
            />
            <div className="workspace-heading studio-overlay" inert={live}>
              <h1>
                角色舞台 <span>LIVE2D</span>
              </h1>
              <span
                id="tracking-status"
                className={`status${view.tracking === 'running' ? ' live' : ''}`}
              >
                {trackingLabel}
              </span>
            </div>
            <div
              id="empty-state"
              className="empty-state studio-overlay"
              hidden={!!view.model}
              inert={live}
            >
              <div className="leaf-orbit">
                <img src="/brand/mark.svg" alt="" />
              </div>
              <p className="eyebrow">HELLO, LITTLE YOU</p>
              <h2>你的舞台，等你登场</h2>
              <p>
                导入 Live2D 角色，
                <br />
                让转头、眨眼和笑容一起动起来。
              </p>
              <Button
                id="import-empty"
                disabled={busy}
                onClick={() => run(() => a?.importModel('directory'))}
              >
                <Plus aria-hidden="true" />
                选择模型目录
              </Button>
              <span className="file-note">支持 .model3.json 与完整资源目录</span>
            </div>
          </div>
          <div className="session-dock studio-overlay" inert={live}>
            <div className="stage-caption">
              <span id="model-name">{view.model?.name ?? '未加载角色'}</span>
              {view.model && <span className="stage-gesture-hint">拖动移动 · 滚轮缩放</span>}
              <span id="render-status">{view.renderStatus}</span>
            </div>
            <div className="session-bar">
              <div>
                <span className={`indicator${active ? ' live' : ''}`} id="camera-indicator" />
                <strong id="camera-status">{cameraLabel}</strong>
                <small id="face-status">{view.faceStatus}</small>
              </div>
              <div className="session-actions">
                <Button
                  variant="outline"
                  id="calibrate"
                  disabled={view.tracking !== 'running'}
                  onClick={() => run(() => a?.calibrate())}
                >
                  校准中立姿态
                </Button>
                <Button
                  variant="outline"
                  id="pause"
                  disabled={!['running', 'paused'].includes(view.tracking)}
                  onClick={() => run(() => a?.pause())}
                >
                  {view.tracking === 'paused' ? '继续' : '暂停'}
                </Button>
                <Button
                  variant="outline"
                  id="stop"
                  disabled={!active}
                  onClick={() => run(() => a?.stop())}
                >
                  停止
                </Button>
                <Button
                  id="start"
                  disabled={active || !view.ready}
                  onClick={() => run(() => a?.start())}
                >
                  <Video aria-hidden="true" />
                  开始跟踪
                </Button>
              </div>
            </div>
            <div
              id="notice"
              className={`notice${view.notice.error ? ' error' : ''}`}
              role="status"
              aria-live="polite"
            >
              {view.notice.message}
            </div>
          </div>
        </section>
        <aside
          id="controls"
          className="controls studio-overlay"
          aria-labelledby="panel-title"
          hidden={collapsed}
          inert={live}
        >
          <header className="controls-heading">
            <div>
              <p className="eyebrow">STUDIO SETTINGS</p>
              <h2 id="panel-title">{tabs.find((item) => item.id === tab)?.title}</h2>
            </div>
            <Button
              id="close-panel"
              variant="ghost"
              size="icon"
              className="icon-button"
              aria-label="收起设置面板"
              title="收起设置面板"
              onClick={() => {
                setCollapsed(true);
                nav.current[tabs.findIndex((item) => item.id === tab)]?.focus();
              }}
            >
              <X aria-hidden="true" />
            </Button>
          </header>
          <section id="capture" className="panel" hidden={tab !== 'capture'}>
            <div className="section-title">
              <h2>跟踪来源</h2>
              <span>LOCAL ONLY</span>
            </div>
            <label htmlFor="engine">跟踪引擎</label>
            <Select
              id="engine"
              disabled={active || !view.ready}
              value={s.engine}
              onChange={(e) => set('engine', e.target.value as Settings['engine'])}
            >
              <option value="mediapipe">MediaPipe · 默认</option>
              <option value="openseeface">OpenSeeFace · 备选</option>
            </Select>
            <div id="mediapipe-options" hidden={s.engine !== 'mediapipe'}>
              <div className="label-row">
                <label htmlFor="device">摄像头</label>
                <Button
                  id="refresh-devices"
                  variant="ghost"
                  size="sm"
                  onClick={() => run(() => a?.devices())}
                >
                  刷新
                </Button>
              </div>
              <Select
                id="device"
                disabled={active || !view.ready}
                value={s.deviceId}
                onChange={(e) => set('deviceId', e.target.value)}
              >
                <option value="">系统默认摄像头</option>
                {view.cameraDevices.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `摄像头 ${i + 1}`}
                  </option>
                ))}
                {s.deviceId && !view.cameraDevices.some((d) => d.deviceId === s.deviceId) && (
                  <option value={s.deviceId}>上次选择的摄像头（当前不可用）</option>
                )}
              </Select>
              <Toggle
                id="upper-body"
                label="识别上半身"
                checked={s.upperBody}
                disabled={active || !view.ready}
                onChange={(value) => set('upperBody', value)}
                note="肩膀入镜时自动启用"
              />
              <p id="body-status" className="hint" aria-live="polite">
                {view.tracking === 'running'
                  ? view.bodyStatus
                  : s.upperBody
                    ? '开始后识别肩膀、躯干与手臂'
                    : '仅识别面部'}
              </p>
              <div className="camera-preview">
                <video
                  id="camera-video"
                  ref={video}
                  autoPlay
                  muted
                  playsInline
                  className={`${preview && active ? 'preview-enabled' : ''}${s.previewMirror ? ' mirrored' : ''}`}
                />
                <canvas
                  id="face-mesh"
                  ref={mesh}
                  hidden={!preview || !showMesh || !active}
                  className={s.previewMirror ? 'mirrored' : ''}
                  role="img"
                  aria-label="面部网格与上半身关键点"
                />
                <span id="preview-caption" hidden={preview && view.tracking === 'running'}>
                  <ScanFace aria-hidden="true" />
                  {!preview
                    ? '开启预览，查看跟踪关键点'
                    : view.tracking === 'paused'
                      ? '跟踪已暂停'
                      : view.tracking === 'starting'
                        ? '正在启动面捕…'
                        : '开始跟踪后显示预览'}
                </span>
              </div>
              <Toggle
                id="show-preview"
                label="显示面捕预览"
                checked={preview}
                onChange={setPreview}
                note="仅本窗口"
              />
              <Toggle
                id="show-mesh"
                label="叠加网格与身体关键点"
                checked={showMesh}
                onChange={setShowMesh}
              />
              {toggle('previewMirror', '镜像摄像头预览')}
            </div>
            <div id="osf-options" hidden={s.engine !== 'openseeface'}>
              <p className="hint">
                只接收 127.0.0.1 的单人跟踪数据。可连接已启动的
                OpenSeeFace，或填写两个路径由应用启动。 上半身识别与关键点预览请使用 MediaPipe。
              </p>
              <div className="two-fields">
                <label>
                  UDP 端口
                  <Input
                    id="port"
                    disabled={active}
                    type="number"
                    min={1024}
                    max={65535}
                    value={s.port}
                    onChange={(e) => set('port', Number(e.target.value))}
                  />
                </label>
                <label>
                  摄像头编号
                  <Input
                    id="camera"
                    disabled={active}
                    type="number"
                    min={0}
                    max={32}
                    value={s.camera}
                    onChange={(e) => set('camera', Number(e.target.value))}
                  />
                </label>
              </div>
              <label htmlFor="pythonPath">
                Python 可执行文件 <small>可选</small>
              </label>
              <Input
                id="pythonPath"
                disabled={active}
                value={s.pythonPath}
                onChange={(e) => set('pythonPath', e.target.value)}
                placeholder="/…/bin/python"
                spellCheck={false}
              />
              <label htmlFor="scriptPath">
                OpenSeeFace 启动脚本 <small>可选</small>
              </label>
              <Input
                id="scriptPath"
                disabled={active}
                value={s.scriptPath}
                onChange={(e) => set('scriptPath', e.target.value)}
                placeholder="/…/scripts/run-openseeface.py"
                spellCheck={false}
              />
              <p className="hint">
                路径都留空时使用外部进程；停止接收不会关闭外部进程或释放它占用的摄像头。
              </p>
            </div>
            <div className="divider" />
            <div className="section-title">
              <h2>动作调节</h2>
              <Button
                id="reset-tracking"
                variant="ghost"
                size="sm"
                onClick={() => a?.resetTracking()}
              >
                重置
              </Button>
            </div>
            {toggle('motionMirror', '镜像角色转头方向')}
            {range('sensitivity', '头部灵敏度', 0.2, 3, 0.1)}
            {range('headSmooth', '头部平滑', 0, 0.5, 0.01)}
            <Fold title="眼睛、嘴部与丢脸恢复">
              {range('eyeSensitivity', '眨眼灵敏度', 0.3, 2, 0.1)}
              {range('eyeSmooth', '眼睛平滑', 0, 0.3, 0.01)}
              {range('mouthSensitivity', '嘴部灵敏度', 0.2, 3, 0.1)}
              {range('mouthSmooth', '嘴部平滑', 0, 0.4, 0.01)}
              {range('lostDelay', '丢脸容错时间', 0.1, 2, 0.1)}
            </Fold>
            <p className="hint">面向镜头，睁眼、闭嘴，保持自然姿态后校准。平滑越高，跟随越柔和。</p>
          </section>
          <section id="library" className="panel" hidden={tab !== 'library'}>
            <div className="section-title">
              <h2>我的角色</h2>
              <span>{view.library.length} 个角色</span>
            </div>
            <p className="library-drop-hint">
              把模型文件夹、.model3.json 或 ZIP 拖到窗口中，自动复制到角色库。
            </p>
            <div className="library-actions">
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <Button id="import-model" variant="outline" size="sm" disabled={busy}>
                    <Plus aria-hidden="true" />
                    添加角色
                    <ChevronDown aria-hidden="true" />
                  </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content className="model-import-menu" align="start" sideOffset={6}>
                    <DropdownMenu.Item onSelect={() => run(() => a?.importModel('file'))}>
                      选择文件（model3.json / ZIP）
                    </DropdownMenu.Item>
                    <DropdownMenu.Item onSelect={() => run(() => a?.importModel('directory'))}>
                      选择模型文件夹
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="打开角色文件夹"
                title="打开角色文件夹"
                disabled={!view.libraryDirectory}
                onClick={() => run(() => a?.openLibrary())}
              >
                <FolderOpen aria-hidden="true" />
              </Button>
            </div>
            <div className="model-library" aria-label="已保存的角色" aria-busy={busy}>
              {view.library.map((entry) => (
                <Button
                  key={entry.path}
                  variant="outline"
                  className="model-card"
                  disabled={busy}
                  aria-label={`切换到 ${entry.name}`}
                  aria-pressed={view.model?.path === entry.path}
                  title={entry.path}
                  onClick={() => run(() => a?.recentModel(entry.path))}
                >
                  <span className="model-thumbnail">
                    {view.previews[entry.path] ? (
                      <img src={view.previews[entry.path]} alt={`${entry.name} 角色预览`} />
                    ) : (
                      <UserRound aria-hidden="true" />
                    )}
                  </span>
                  <span className="model-card-name">{entry.name}</span>
                  <small>{view.model?.path === entry.path ? '使用中' : '点击切换'}</small>
                </Button>
              ))}
            </div>
            {!view.library.length && (
              <p className="hint">还没有角色。加入后会保存在本机，重启也能直接切换。</p>
            )}
            {!!view.libraryDirectory && (
              <Fold title="角色文件夹">
                <p className="library-path">{view.libraryDirectory}</p>
                <p className="hint">
                  导入后使用库内副本，原文件可以移动。每个角色的构图、映射和快捷键独立保存。
                </p>
              </Fold>
            )}
          </section>
          <section id="appearance" className="panel" hidden={tab !== 'appearance'}>
            <div className="section-title">
              <h2>{view.model?.name ?? '你的角色'}</h2>
              <Button variant="ghost" size="sm" onClick={() => setTab('library')}>
                切换角色
              </Button>
            </div>
            <p id="capabilities" className="hint">
              {!view.model
                ? '加载模型后显示可驱动的动作。'
                : common.length
                  ? `可驱动：${common.map((p) => parameterNames[p.id]).join('、')}`
                  : '未发现常见面捕参数，可在「角色」页为模型参数配置映射。'}
            </p>
            <div className="divider" />
            <div className="section-title">
              <h2>角色构图</h2>
              <Button
                id="reset-display"
                variant="ghost"
                size="sm"
                onClick={() => a?.resetDisplay()}
              >
                复位
              </Button>
            </div>
            {range('zoom', '角色缩放', 0.25, 2.5, 0.05)}
            {range('x', '水平位置', -0.8, 0.8, 0.01)}
            {range('y', '垂直位置', -0.8, 0.8, 0.01)}
            <label htmlFor="background">输出背景</label>
            <div className="color-row">
              <Input
                id="background"
                type="color"
                value={s.background}
                onChange={(e) => set('background', e.target.value)}
              />
              {[
                ['#e5ebdd', '浅叶绿'],
                ['#1c2926', '深松绿'],
                ['#00ff00', '色键绿'],
                ['#f3ede5', '暖白'],
              ].map(([color, label]) => (
                <Button
                  key={color}
                  variant="outline"
                  className="swatch"
                  data-color={color}
                  style={{ background: color }}
                  aria-label={label}
                  aria-pressed={s.background === color}
                  onClick={() => set('background', color)}
                />
              ))}
            </div>
            <p className="hint">
              直播模式只显示角色与纯色背景，按 Esc 恢复界面。色键可在 OBS 中配置。
            </p>
          </section>
          <section id="model-controls" className="panel" hidden={tab !== 'model-controls'}>
            {a && <ModelControls key={view.model?.path} view={view} actions={a} />}
          </section>
          <section id="meeting" className="panel" hidden={tab !== 'meeting'}>
            <div className="section-title">
              <h2>接入你的会议</h2>
              <span>OBS → 飞书</span>
            </div>
            <ol className="guide">
              {[
                [
                  '进入直播模式',
                  '调整角色构图和背景后，点击顶部「直播模式」隐藏面板。按 Esc 恢复界面。',
                ],
                [
                  '在 OBS 添加捕获源',
                  '选择 VTubeLeaf 主窗口。macOS 使用 macOS 屏幕捕获并授予屏幕录制权限；裁掉系统标题栏。',
                ],
                ['启动虚拟摄像头', '在 OBS 点击「启动虚拟摄像头」。可在场景中添加背景或使用色键。'],
                ['在飞书选择摄像头', '选择 OBS Virtual Camera；麦克风仍使用你原来的设备。'],
              ].map(([title, text]) => (
                <li key={title}>
                  <b>{title}</b>
                  <p>{text}</p>
                </li>
              ))}
            </ol>
            <p className="hint">
              需要边调整边输出时，可使用「独立输出窗口」并在 OBS 捕获 VTubeLeaf
              Output。先用另一参会端确认画面，后台与最小化表现需按平台实测。
            </p>
            <Fold title="常见问题与运行记录">
              <p className="hint">
                黑屏：检查模型是否成功加载，以及 OBS
                捕获的窗口。无表情：检查跟踪状态并重新校准。摄像头不可用：检查系统权限、设备连接与其他应用占用。
              </p>
              <ul id="events" className="events">
                {view.events.map((event, i) => (
                  <li key={`${i}:${event}`}>{event}</li>
                ))}
              </ul>
            </Fold>
            <div className="privacy-note">
              <b>你的人脸，留在你的电脑。</b>
              <p>
                不上传摄像头画面，仅在手动录制时保存角色参数，不采集声音。运行记录只保留本次会话的错误提示。
              </p>
            </div>
            <Button
              id="reset-all"
              variant="outline"
              className="wide"
              onClick={() => run(() => a?.resetAll())}
            >
              恢复默认设置
            </Button>
          </section>
          <footer className="panel-footer">
            <Sparkles className="leaf-dot" aria-hidden="true" />
            VTubeLeaf<span>v0.1</span>
          </footer>
        </aside>
      </main>
    </div>
  );
}

function ModelControls({ view, actions: a }: { view: StudioView; actions: Studio['actions'] }) {
  const [parameterId, setParameter] = useState(view.parameters[0]?.id ?? '');
  const [hotkeyId, setHotkey] = useState('stop-motion');
  const [mode, setMode] = useState<MotionMode>(a.motionMode);
  const parameter = view.parameters.find((p) => p.id === parameterId);
  const run = a.run;
  return (
    <>
      <div className="section-title">
        <h2>角色参数</h2>
        <Button
          id="reset-profile"
          variant="ghost"
          size="sm"
          disabled={!view.model}
          onClick={() => run(a.resetProfile)}
        >
          重置本模型
        </Button>
      </div>
      <p className="hint">映射、校准、构图、表情快捷键和待机设置按模型自动保存。</p>
      <label htmlFor="mapping-parameter">输出参数</label>
      <Select
        id="mapping-parameter"
        disabled={!view.parameters.length}
        value={parameterId}
        onChange={(e) => setParameter(e.target.value)}
      >
        {!view.parameters.length && <option value="">加载模型后可用</option>}
        {view.parameters.map((p) => (
          <option key={p.id} value={p.id}>
            {parameterNames[p.id] ?? p.id} ({p.id})
          </option>
        ))}
      </Select>
      {parameter && (
        <MappingEditor
          key={`${parameterId}:${view.profileRevision}`}
          parameter={parameter}
          view={view}
          actions={a}
        />
      )}
      <div className="divider" />
      <div className="section-title">
        <h2>表情</h2>
        <Button
          id="clear-expressions"
          variant="ghost"
          size="sm"
          onClick={() => run(() => a.modelAction('clear-expressions'))}
        >
          全部关闭
        </Button>
      </div>
      <div id="expression-buttons" className="button-list">
        {view.expressions.map((e) => (
          <Button
            key={e.id}
            variant="outline"
            data-expression={e.id}
            aria-pressed={view.activeExpressions.has(e.id)}
            onClick={() => run(() => a.modelAction(`expression:${e.id}`))}
          >
            {e.name}
          </Button>
        ))}
        {!view.expressions.length && (
          <p className="hint">{view.model ? '模型未提供此类资源。' : '加载模型后可用。'}</p>
        )}
      </div>
      <p className="hint">再次点击关闭，可同时启用多个模型表情。</p>
      <div className="divider" />
      <div className="section-title">
        <h2>动作与待机</h2>
        <Button
          id="stop-motion"
          variant="ghost"
          size="sm"
          onClick={() => run(() => a.modelAction('stop-motion'))}
        >
          停止动作
        </Button>
      </div>
      <label htmlFor="motion-mode">播放方式</label>
      <Select
        id="motion-mode"
        value={mode}
        onChange={(e) => {
          const next = e.target.value as MotionMode;
          a.motionMode = next;
          setMode(next);
        }}
      >
        <option value="once">单次</option>
        <option value="loop">循环</option>
        <option value="hold">保持末帧</option>
      </Select>
      <div id="motion-buttons" className="button-list">
        {view.motions.map((m) => (
          <Button
            key={m.id}
            variant="outline"
            onClick={() => run(() => a.modelAction(`motion:${m.id}`, mode))}
          >
            {m.name}
          </Button>
        ))}
        {!view.motions.length && (
          <p className="hint">{view.model ? '模型未提供此类资源。' : '加载模型后可用。'}</p>
        )}
      </div>
      <label htmlFor="idle-motion">待机动作</label>
      <Select
        id="idle-motion"
        value={view.settings.idleMotion}
        onChange={(e) => a.setSetting('idleMotion', e.target.value)}
      >
        <option value="">不播放</option>
        {view.motions.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </Select>
      <Toggle
        id="autoBlink"
        label="未跟踪眼睛时自动眨眼"
        checked={view.settings.autoBlink}
        onChange={(value) => a.setSetting('autoBlink', value)}
      />
      <Fold title="全局快捷键">
        <p className="hint">
          选择动作后填写组合键，如 Control+Shift+1。桌面版在后台也能触发；表情再次触发会关闭。
        </p>
        <label htmlFor="hotkey-action">操作</label>
        <Select id="hotkey-action" value={hotkeyId} onChange={(e) => setHotkey(e.target.value)}>
          <option value="stop-motion">停止动作</option>
          <option value="clear-expressions">关闭全部表情</option>
          {view.expressions.map((e) => (
            <option key={e.id} value={`expression:${e.id}`}>
              表情 · {e.name}
            </option>
          ))}
          {view.motions.map((m) => (
            <option key={m.id} value={`motion:${m.id}`}>
              动作 · {m.name}
            </option>
          ))}
        </Select>
        <HotkeyEditor
          key={`${hotkeyId}:${view.profileRevision}`}
          id={hotkeyId}
          view={view}
          actions={a}
        />
      </Fold>
      <div className="divider" />
      <div className="section-title">
        <h2>动作录制</h2>
        <output id="record-status">{view.duration.toFixed(1)} s</output>
      </div>
      <div className="two-fields">
        <Button
          id="record-toggle"
          variant="outline"
          disabled={!view.model}
          onClick={a.toggleRecording}
        >
          {view.recording ? '停止录制' : '开始录制'}
        </Button>
        <Button
          id="record-save"
          variant="outline"
          disabled={!view.canSaveRecording}
          onClick={() => run(a.saveRecording)}
        >
          保存动作
        </Button>
      </div>
      <p className="hint">
        手动录制角色的最终参数，最长 60 秒，保存为
        .motion3.json；不会录制摄像头画面或声音。开始新录制会替换未保存的上一段。
      </p>
    </>
  );
}
function HotkeyEditor({
  id,
  view,
  actions,
}: {
  id: string;
  view: StudioView;
  actions: Studio['actions'];
}) {
  const [binding, setBinding] = useState(view.settings.hotkeys[id] ?? '');
  return (
    <>
      <label htmlFor="hotkey-binding">组合键</label>
      <Input
        id="hotkey-binding"
        value={binding}
        onChange={(e) => setBinding(e.target.value)}
        placeholder="Control+Shift+1"
        spellCheck={false}
      />
      <div className="two-fields">
        <Button
          id="save-hotkey"
          variant="outline"
          disabled={!view.model}
          onClick={() => actions.run(() => actions.applyHotkey(id, binding))}
        >
          应用快捷键
        </Button>
        <Button
          id="clear-hotkey"
          variant="outline"
          disabled={!view.model}
          onClick={() => {
            setBinding('');
            actions.run(() => actions.applyHotkey(id, ''));
          }}
        >
          清除
        </Button>
      </div>
    </>
  );
}
function MappingEditor({
  parameter,
  view,
  actions,
}: {
  parameter: StudioView['parameters'][number];
  view: StudioView;
  actions: Studio['actions'];
}) {
  const initial = view.settings.mappings[parameter.id] ??
    defaultMapping(parameter, view.settings) ?? {
      source: 'yaw',
      inputMin: -1,
      inputMax: 1,
      outputMin: parameter.min,
      outputMax: parameter.max,
      smoothing: 0.12,
      enabled: false,
    };
  const [source, setSource] = useState<FaceKey>(initial.source);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [numbers, setNumbers] = useState({
    inputMin: String(initial.inputMin),
    inputMax: String(initial.inputMax),
    outputMin: String(initial.outputMin),
    outputMax: String(initial.outputMax),
    smoothing: String(initial.smoothing),
  });
  const input = view.faceInput[source];
  const field = (key: keyof typeof numbers, label: string) => (
    <label>
      {label}
      <Input
        id={`mapping-${key}`}
        type="number"
        step="0.01"
        value={numbers[key]}
        onChange={(e) => setNumbers({ ...numbers, [key]: e.target.value })}
      />
    </label>
  );
  return (
    <>
      <p id="mapping-status" className="hint">
        当前输入：{input === undefined ? '暂无数据' : input.toFixed(3)} ·{' '}
        {Object.hasOwn(view.settings.mappings, parameter.id) ? '自定义映射' : '自动映射'}
      </p>
      <div id="mapping-editor">
        <Toggle
          id="mapping-enabled"
          label="使用面捕驱动此参数"
          checked={enabled}
          onChange={setEnabled}
        />
        <label htmlFor="mapping-source">跟踪输入</label>
        <Select
          id="mapping-source"
          value={source}
          onChange={(e) => setSource(e.target.value as FaceKey)}
        >
          {Object.entries(faceSources).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </Select>
        <div className="two-fields">
          {field('inputMin', '输入下限')}
          {field('inputMax', '输入上限')}
        </div>
        <div className="two-fields">
          {field('outputMin', '输出下限')}
          {field('outputMax', '输出上限')}
        </div>
        {field('smoothing', '平滑时间（秒）')}
        <div className="two-fields">
          <Button
            id="save-mapping"
            onClick={() =>
              actions.run(() =>
                actions.saveMapping(parameter.id, {
                  source,
                  enabled,
                  ...Object.fromEntries(
                    Object.entries(numbers).map(([key, value]) => [
                      key,
                      value.trim() === '' ? NaN : Number(value),
                    ]),
                  ),
                } as Mapping),
              )
            }
          >
            应用映射
          </Button>
          <Button
            id="reset-mapping"
            variant="outline"
            onClick={() => actions.resetMapping(parameter.id)}
          >
            恢复自动
          </Button>
        </div>
        <p className="hint">
          输入为校准后的归一化数值，实时显示在上方。交换输出上下限可反向。位移在两个引擎中的尺度不同，切换后请重新校准。
        </p>
      </div>
    </>
  );
}

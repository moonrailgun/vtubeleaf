import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { AlertDialog, ContextMenu, Dialog, DropdownMenu, Tabs, ToggleGroup } from 'radix-ui';
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
  Copy,
  Ellipsis,
  Video,
  Sparkles,
  Trash2,
  Pin,
  PinOff,
} from 'lucide-react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/ui/select';
import { isVTubeLeafCamera } from './camera-devices';
import { Switch } from './components/ui/switch';
import { Slider } from './components/ui/slider';
import { Fold } from './Fold';
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
import type { ModelInfo, MotionMode } from './renderer';
import { SceneControls } from './SceneControls';
import { vowels } from './lipsync';
import { version } from '../package.json';
import { initialUpdateState } from './updater';
import { OpenSeeFaceDownload } from './OpenSeeFaceDownload';
import { releasesSince } from './changelog';
import { ReleaseList, releases } from './ReleaseNotes';
import { t } from './i18n';

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
        // Render before the next move: WKWebView can send several per frame, and Radix skips a
        // move that matches the not-yet-rendered value, which would leave the thumb off the pointer.
        onValueChange={([next]) => flushSync(() => onChange(next))}
      />
    </div>
  );
}
const silentMic: Studio['micLevel'] = { get: () => 0, subscribe: () => () => {} };
// Subscribes on its own so a moving level re-renders only the meter, not the whole studio.
function MicMeter({ source }: { source: Studio['micLevel'] }) {
  const level = useSyncExternalStore(source.subscribe, source.get);
  return (
    <>
      <div className="slider-label">
        <span id="mic-volume-label">{t('app.inputVolume')}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {Math.round(level * 100)}%
        </span>
      </div>
      <div
        id="mic-volume"
        role="meter"
        aria-labelledby="mic-volume-label"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={level}
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${level * 100}%` }} />
      </div>
    </>
  );
}
const tabs = [
  {
    id: 'library',
    labelKey: 'app.tabLibrary',
    titleKey: 'app.tabLibrary',
    icon: FolderHeart,
    color: 'model',
  },
  {
    id: 'appearance',
    labelKey: 'app.tabAppearance',
    titleKey: 'app.tabAppearanceTitle',
    icon: Image,
    color: 'appearance',
  },
  {
    id: 'capture',
    labelKey: 'app.tabCapture',
    titleKey: 'app.tabCaptureTitle',
    icon: ScanFace,
    color: 'capture',
  },
  {
    id: 'model-controls',
    labelKey: 'app.tabAvatar',
    titleKey: 'app.tabAvatarTitle',
    icon: UserRound,
    color: 'model',
  },
  {
    id: 'meeting',
    labelKey: 'app.tabConnect',
    titleKey: 'app.tabConnectTitle',
    icon: MonitorUp,
    color: 'meeting',
  },
] as const;
const initialView = (): StudioView => ({
  updater: initialUpdateState,
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
  selectedItem: '',
  sceneBusy: false,
  obsOutput: { supported: false, native: undefined, active: false, pending: false, url: '' },
  virtualCamera: {
    supported: false,
    installed: false,
    active: false,
    message: t('camera.unsupported'),
  },
  cameraDevices: [],
  micDevices: [],
  micActive: false,
  micStarting: false,
  micLabel: '',
  voiceCalibration: null,
  calibrating: null,
  cameraLabel: '',
  cameraSettings: '',
  renderStatus: t('studio.renderPreview'),
  faceStatus: t('studio.faceIdle'),
  bodyStatus: t('tracker.bodyPending'),
  handStatus: t('tracker.handOff'),
  faceInput: {},
  notice: { message: t('studio.privacyNotice'), error: false },
  events: [],
  parameters: [],
  expressions: [],
  motions: [],
  physicsGroups: [],
  activeExpressions: new Set(),
  recording: false,
  duration: 0,
  canSaveRecording: false,
});
export function App() {
  const container = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const mesh = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const nav = useRef<HTMLButtonElement[]>([]);
  const runtime = useRef<Studio | null>(null);
  const liveButton = useRef<HTMLButtonElement>(null);
  const cameraMoreButton = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState(initialView);
  const [dismissedNotice, setDismissedNotice] = useState<StudioView['notice'] | null>(null);
  const [tab, setTab] = useState('capture');
  const [collapsed, setCollapsed] = useState(false);
  const [live, setLive] = useState(false);
  const [preview, setPreview] = useState(false);
  const [cameraPending, setCameraPending] = useState('');
  const [uninstallCameraOpen, setUninstallCameraOpen] = useState(false);
  const [modelToRemove, setModelToRemove] = useState<ModelInfo | null>(null);
  useEffect(() => {
    const studio = createStudio(container.current!, video.current!, setView, mesh.current!);
    runtime.current = studio;
    setView(studio.snapshot());
    const element = container.current!;
    const wheel = (event: WheelEvent) => {
      if (!studio.canMove()) return;
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
    if (
      !view.notice.message ||
      view.notice.error ||
      view.calibrating ||
      view.voiceCalibration ||
      view.modelLoading ||
      view.sceneBusy
    )
      return;
    const timer = window.setTimeout(() => setDismissedNotice(view.notice), 5000);
    return () => window.clearTimeout(timer);
  }, [view.notice, view.calibrating, view.voiceCalibration, view.modelLoading, view.sceneBusy]);
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
  const camera = view.virtualCamera;
  const [cameraActionLabel, cameraActionPending] = !camera.installed
    ? [t('app.installVirtualCamera'), t('app.installing')]
    : camera.active
      ? [t('app.stopVirtualCamera'), t('app.stopping')]
      : [t('app.startVirtualCamera'), t('app.starting')];
  const runCamera = async (label: string, action: () => Promise<void>) => {
    if (!a || cameraPending) return;
    setCameraPending(label);
    try {
      await a.run(action);
    } finally {
      setCameraPending('');
    }
  };
  const s = view.settings;
  const library = useMemo(
    () =>
      [...view.library].sort(
        (a, b) => Number(s.pinnedModels.includes(b.path)) - Number(s.pinnedModels.includes(a.path)),
      ),
    [view.library, s.pinnedModels],
  );
  const obsNative = !!view.obsOutput.native && s.obsOutput === 'native';
  const obsSource =
    view.obsOutput.native === 'Spout2' ? 'Spout2 Capture' : t('app.obsSyphonClient');
  const active = view.tracking !== 'stopped';
  const busy = !view.ready || view.modelLoading || view.sceneBusy;
  const draggable = !!(view.model || view.selectedItem) && !busy;
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => a?.setSetting(key, value);
  const whatsNew = view.ready ? releasesSince(releases, version, s.lastSeenVersion) : [];
  // The language is applied at startup, so remember the one this run started with.
  const startLanguage = useRef<Settings['language']>(undefined);
  if (view.ready) startLanguage.current ??= s.language;
  const languagePending = view.ready && s.language !== startLanguage.current;
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
  const toggle = (key: keyof Settings, label: string, disabled = false) => (
    <Toggle
      id={key}
      label={label}
      checked={s[key] as boolean}
      onChange={(value) => set(key, value)}
      disabled={disabled}
    />
  );
  const trackingLabel = {
    stopped: t('app.trackingStopped'),
    starting: t('app.trackingStarting'),
    running: t('app.trackingRunning'),
    paused: t('app.trackingPaused'),
  }[view.tracking];
  const cameraLabel =
    s.engine === 'nvidia'
      ? active
        ? t('app.nvidiaExperimental')
        : t('app.nvidiaDisconnected')
      : s.engine === 'openseeface'
        ? active
          ? t('app.osfReceiving')
          : t('app.osfDisconnected')
        : active
          ? t('app.cameraInUse')
          : t('app.cameraNotInUse');
  const openLibraryButton = (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={t('app.openModelFolder')}
      title={t('app.openModelFolder')}
      disabled={!view.libraryDirectory}
      onClick={() => run(() => a?.openLibrary())}
    >
      <FolderOpen aria-hidden="true" />
    </Button>
  );
  return (
    <div
      className={`studio-shell${live ? ' live-mode' : ''}`}
      inert={view.updater.status === 'installing'}
    >
      <div
        className="model-drop-overlay studio-overlay"
        hidden={!view.dropActive}
        inert={live}
        role="status"
      >
        <FolderHeart aria-hidden="true" />
        <strong>{busy ? t('app.dropBusy') : t('app.dropRelease')}</strong>
        <span>{t('app.dropFormats')}</span>
      </div>
      <header className="topbar studio-overlay" inert={live}>
        <a className="brand" href="#" aria-label={t('app.home')}>
          <img src="/brand/mark.svg" alt="" />
          <span>VTubeLeaf</span>
        </a>
        <div className="header-actions">
          <span className="local-badge">
            <i />
            {t('app.localBadge')}
          </span>
          <Button
            id="live-mode"
            ref={liveButton}
            disabled={!view.ready}
            aria-label={t('app.streamMode')}
            title={t('app.streamModeTitle')}
            onClick={() => setLive(true)}
          >
            <PanelTopClose aria-hidden="true" />
            {t('app.streamMode')}
            <small>{t('app.escRestore')}</small>
          </Button>
          <Button
            id="open-output"
            className="output-button"
            disabled={!view.ready}
            onClick={() => run(() => a?.openOutput())}
          >
            {t('app.outputWindow')}
            <ArrowUpRight aria-hidden="true" />
          </Button>
        </div>
      </header>
      <main id="studio" className={`studio${collapsed ? ' panel-collapsed' : ''}`}>
        <nav
          className="toolbar studio-overlay"
          aria-label={t('app.settingsCategories')}
          inert={live}
        >
          {tabs.map((item, index) => (
            <Button
              key={item.id}
              ref={(el) => {
                if (el) nav.current[index] = el;
              }}
              variant="ghost"
              data-tab={item.id}
              aria-label={t(item.labelKey)}
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
              <span>{t(item.labelKey)}</span>
            </Button>
          ))}
          <span className="toolbar-end" aria-hidden="true">
            ✦
          </span>
        </nav>
        <section className="workspace" aria-label={t('app.avatarPreview')}>
          <div className="stage-frame">
            <div
              id="stage"
              ref={container}
              tabIndex={-1}
              data-draggable={draggable}
              aria-label={t('app.stageLabel')}
              onPointerDown={(event) => {
                if (event.button !== 0 || !draggable || drag.current) return;
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
              hidden={
                !!view.model || !!s.composition.items.length || !!s.composition.backgroundImage
              }
              inert={live}
            >
              <div className="leaf-orbit">
                <img src="/brand/mark.svg" alt="" />
              </div>
              <p className="eyebrow">HELLO, LITTLE YOU</p>
              <h2>{t('app.emptyTitle')}</h2>
              <p>
                {t('app.emptyLine1')}
                <br />
                {t('app.emptyLine2')}
              </p>
              <Button
                id="import-empty"
                disabled={busy}
                onClick={() =>
                  view.library.length ? setTab('library') : run(() => a?.importModel('directory'))
                }
              >
                <Plus aria-hidden="true" />
                {view.library.length ? t('app.chooseExistingModel') : t('app.chooseModelDirectory')}
              </Button>
              <span className="file-note">{t('app.supportedFormats')}</span>
            </div>
            <div
              id="notice"
              className={`notice studio-overlay${view.notice.error ? ' error' : view.calibrating ? ' calibrating' : ''}`}
              hidden={!view.notice.message || view.notice === dismissedNotice}
              inert={live}
              role="status"
              aria-live="polite"
            >
              {view.calibrating && !view.notice.error && (
                <strong>{t('app.calibratingHold')}</strong>
              )}
              {view.notice.message}
            </div>
          </div>
          <div className="session-dock studio-overlay" inert={live}>
            <div className="stage-caption">
              <span id="model-name">{view.model?.name ?? t('app.noModelLoaded')}</span>
              {view.model && (
                <span className="stage-gesture-hint">{t('app.stageGestureHint')}</span>
              )}
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
                  disabled={view.tracking !== 'running' || !!view.calibrating}
                  onClick={() => run(() => a?.calibrate())}
                >
                  {view.calibrating ? t('app.calibratingEllipsis') : t('app.calibrateNeutral')}
                </Button>
                <Button
                  id="start"
                  variant={active ? 'outline' : 'default'}
                  disabled={!active && !view.ready}
                  onClick={() => run(() => (active ? a?.stop() : a?.start()))}
                >
                  <Video aria-hidden="true" />
                  {active ? t('app.stopTracking') : t('app.startTracking')}
                </Button>
              </div>
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
              <h2 id="panel-title">
                {t(tabs.find((item) => item.id === tab)?.titleKey ?? 'app.tabCaptureTitle')}
              </h2>
            </div>
            <Button
              id="close-panel"
              variant="ghost"
              size="icon"
              className="icon-button"
              aria-label={t('app.collapsePanel')}
              title={t('app.collapsePanel')}
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
              <h2>{t('app.trackingSource')}</h2>
              <span>LOCAL ONLY</span>
            </div>
            <div id="mediapipe-options" hidden={s.engine !== 'mediapipe'}>
              <div className="label-row">
                <label htmlFor="device">{t('app.camera')}</label>
                <Button
                  id="refresh-devices"
                  variant="ghost"
                  size="sm"
                  onClick={() => run(() => a?.devices(true))}
                >
                  {t('app.refresh')}
                </Button>
              </div>
              <Select
                disabled={active || !view.ready}
                value={s.deviceId || 'auto-camera'}
                onValueChange={(value) => set('deviceId', value === 'auto-camera' ? '' : value)}
                onOpenChange={(open) => {
                  if (open) run(() => a?.devices(true));
                }}
              >
                <SelectTrigger id="device">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto-camera">{t('app.autoCamera')}</SelectItem>
                  {view.cameraDevices.map((d, i) => (
                    <SelectItem key={d.deviceId} value={d.deviceId} disabled={isVTubeLeafCamera(d)}>
                      {d.label || t('app.cameraN', { n: i + 1 })}
                      {isVTubeLeafCamera(d) && ` · ${t('app.outputOnly')}`}
                    </SelectItem>
                  ))}
                  {s.deviceId && !view.cameraDevices.some((d) => d.deviceId === s.deviceId) && (
                    <SelectItem value={s.deviceId} disabled>
                      {t('app.lastCameraUnavailable')}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
              {view.cameraLabel && (
                <p className="hint break-all">{t('app.inUse', { name: view.cameraLabel })}</p>
              )}
              <Toggle
                id="upper-body"
                label={t('app.upperBody')}
                checked={s.upperBody}
                disabled={active || !view.ready}
                onChange={(value) => set('upperBody', value)}
                note={t('app.upperBodyNote')}
              />
              <p id="body-status" className="hint" aria-live="polite">
                {view.tracking === 'running'
                  ? view.bodyStatus
                  : s.upperBody
                    ? t('app.upperBodyIdle')
                    : t('app.faceOnly')}
              </p>
              <Toggle
                id="hand-tracking"
                label={t('app.handTracking')}
                checked={s.handTracking}
                disabled={active || !view.ready}
                onChange={(value) => set('handTracking', value)}
                note={active ? view.handStatus : t('app.handTrackingNote')}
              />
              <Toggle
                id="show-preview"
                label={t('app.showTrackingPreview')}
                checked={preview}
                onChange={setPreview}
                note={t('app.thisWindowOnly')}
              />
              <div className="camera-preview" hidden={!preview}>
                <video
                  id="camera-video"
                  ref={video}
                  autoPlay
                  muted
                  playsInline
                  className={`${active && s.previewCamera ? 'preview-enabled' : ''}${s.previewMirror ? ' mirrored' : ''}`}
                />
                <canvas
                  id="face-mesh"
                  ref={mesh}
                  hidden={!active}
                  className={s.previewMirror ? 'mirrored' : ''}
                  role="img"
                  aria-label={t('app.meshLabel')}
                />
                <span id="preview-caption" hidden={view.tracking === 'running'}>
                  <ScanFace aria-hidden="true" />
                  {view.tracking === 'paused'
                    ? t('app.trackingPausedCaption')
                    : view.tracking === 'starting'
                      ? t('app.trackingStartingCaption')
                      : t('app.previewAfterStart')}
                </span>
              </div>
            </div>
            <div id="osf-options" hidden={s.engine !== 'openseeface'}>
              <p className="hint">{t('app.osfIntro')}</p>
              <OpenSeeFaceDownload />
              <details>
                <summary>{t('app.advancedSettings')}</summary>
                <label htmlFor="openseeface-mode">{t('app.runMode')}</label>
                <Select
                  value={s.openseefaceMode}
                  disabled={active}
                  onValueChange={(value) =>
                    set('openseefaceMode', value as Settings['openseefaceMode'])
                  }
                >
                  <SelectTrigger id="openseeface-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="external">{t('app.osfExternal')}</SelectItem>
                    <SelectItem value="custom">{t('app.osfCustom')}</SelectItem>
                  </SelectContent>
                </Select>
                <div className="two-fields">
                  <label>
                    {t('app.udpPort')}
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
                </div>
                {s.openseefaceMode === 'custom' && (
                  <>
                    <label>
                      {t('app.cameraIndex')}
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
                    <label htmlFor="pythonPath">{t('app.pythonExecutable')}</label>
                    <Input
                      id="pythonPath"
                      disabled={active}
                      value={s.pythonPath}
                      onChange={(e) => set('pythonPath', e.target.value)}
                      placeholder="/…/bin/python"
                      spellCheck={false}
                    />
                    <label htmlFor="scriptPath">{t('app.osfScript')}</label>
                    <Input
                      id="scriptPath"
                      disabled={active}
                      value={s.scriptPath}
                      onChange={(e) => set('scriptPath', e.target.value)}
                      placeholder="/…/scripts/run-openseeface.py"
                      spellCheck={false}
                    />
                  </>
                )}
                {s.openseefaceMode === 'external' && (
                  <p className="hint">{t('app.osfExternalHint')}</p>
                )}
              </details>
            </div>
            <div id="nvidia-options" hidden={s.engine !== 'nvidia'}>
              <p className="hint">{t('app.nvidiaIntro')}</p>
              {!/Win/.test(navigator.platform) && (
                <p className="hint">{t('app.nvidiaUnsupported')}</p>
              )}
              <label htmlFor="nvidia-path">{t('app.nvidiaPath')}</label>
              <Input
                id="nvidia-path"
                disabled={active}
                value={s.nvidiaPath}
                onChange={(e) => set('nvidiaPath', e.target.value)}
                placeholder="C:\ARSDK\bin\VTubeLeafNvidia.exe"
                spellCheck={false}
              />
              <label htmlFor="nvidia-model-dir">{t('app.nvidiaModelDir')}</label>
              <Input
                id="nvidia-model-dir"
                disabled={active}
                value={s.nvidiaModelDir}
                onChange={(e) => set('nvidiaModelDir', e.target.value)}
                placeholder="C:\ARSDK\bin\models"
                spellCheck={false}
              />
              <div className="two-fields">
                <label>
                  {t('app.cameraIndex')}
                  <Input
                    id="nvidia-camera"
                    type="number"
                    min={0}
                    max={32}
                    disabled={active}
                    value={s.camera}
                    onChange={(e) => set('camera', Number(e.target.value))}
                  />
                </label>
                <label>
                  {t('app.trackingFps')}
                  <Select
                    disabled={active}
                    value={String(s.trackingFps)}
                    onValueChange={(value) =>
                      set('trackingFps', Number(value) as Settings['trackingFps'])
                    }
                  >
                    <SelectTrigger id="nvidia-fps">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[15, 24, 30, 60].map((fps) => (
                        <SelectItem key={fps} value={String(fps)}>
                          {fps} FPS
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              </div>
              <label htmlFor="nvidia-resolution">{t('app.cameraResolution')}</label>
              <Select
                disabled={active}
                value={s.cameraResolution}
                onValueChange={(value) =>
                  set('cameraResolution', value as Settings['cameraResolution'])
                }
              >
                <SelectTrigger id="nvidia-resolution">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="360p">640 × 360</SelectItem>
                  <SelectItem value="720p">1280 × 720</SelectItem>
                  <SelectItem value="1080p">1920 × 1080</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="divider" />
            <div className="section-title">
              <h2>{t('app.motionTuning')}</h2>
              <Button
                id="reset-tracking"
                variant="ghost"
                size="sm"
                onClick={() => a?.resetTracking()}
              >
                {t('app.reset')}
              </Button>
            </div>
            {range('sensitivity', t('app.headSensitivity'), 0.2, 3, 0.1)}
            {toggle('motionMirror', t('app.mirrorHead'))}
            <Fold title={t('app.micLipSync')}>
              <p className="hint">{t('app.micPrivacy')}</p>
              <label htmlFor="mic-device">{t('app.microphone')}</label>
              <div className="flex items-center gap-2">
                <Select
                  disabled={view.micActive || view.micStarting}
                  value={s.micDeviceId || 'default-mic'}
                  onValueChange={(value) =>
                    set('micDeviceId', value === 'default-mic' ? '' : value)
                  }
                >
                  <SelectTrigger id="mic-device" className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default-mic">{t('app.defaultMic')}</SelectItem>
                    {view.micDevices.map((d, i) => (
                      <SelectItem key={d.deviceId} value={d.deviceId}>
                        {d.label || t('app.micN', { n: i + 1 })}
                      </SelectItem>
                    ))}
                    {s.micDeviceId &&
                      !view.micDevices.some((d) => d.deviceId === s.micDeviceId) && (
                        <SelectItem value={s.micDeviceId}>{t('app.lastMicUnavailable')}</SelectItem>
                      )}
                  </SelectContent>
                </Select>
                <Button
                  id="mic-toggle"
                  className="h-10"
                  variant="outline"
                  disabled={!view.ready}
                  onClick={() => run(() => a?.toggleMic())}
                >
                  {view.micStarting
                    ? t('app.cancelMicStart')
                    : view.micActive
                      ? t('app.micOff')
                      : t('app.micOn')}
                </Button>
              </div>
              {view.micLabel && (
                <p className="hint break-all">{t('app.inUse', { name: view.micLabel })}</p>
              )}
              {toggle('autoStartMic', t('app.autoStartMic'))}
              <label htmlFor="lip-sync-mode">{t('app.lipSyncSource')}</label>
              <Select
                value={s.lipSyncMode}
                onValueChange={(value) => set('lipSyncMode', value as Settings['lipSyncMode'])}
              >
                <SelectTrigger id="lip-sync-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">{t('app.lipSyncCameraOnly')}</SelectItem>
                  <SelectItem value="volume">{t('app.lipSyncVolume')}</SelectItem>
                  <SelectItem value="vowels">{t('app.lipSyncVowels')}</SelectItem>
                </SelectContent>
              </Select>
              {s.lipSyncMode !== 'off' && (
                <>
                  <div className="range-field">
                    <MicMeter source={runtime.current?.micLevel ?? silentMic} />
                    <p className="hint">
                      {!view.micActive
                        ? t('app.micVolumeOff')
                        : view.tracking === 'paused'
                          ? t('app.micVolumePaused')
                          : t('app.micVolumeHint')}
                    </p>
                  </div>
                  {range('lipSyncBlend', t('app.lipSyncBlend'), 0, 1, 0.05)}
                  {range('micGain', t('app.micGain'), 0.1, 20, 0.1)}
                  {range('micNoiseGate', t('app.noiseGate'), 0, 0.2, 0.005)}
                  {s.lipSyncMode === 'volume' && <p className="hint">{t('app.volumeHint')}</p>}
                </>
              )}
              {s.lipSyncMode === 'vowels' && (
                <>
                  <p className="hint">{t('app.vowelsHint')}</p>
                  <Fold title={t('app.personalVowelCalibration')}>
                    <p className="hint">{t('app.vowelCalibrationHint')}</p>
                    <div className="resource-buttons">
                      {vowels.map((vowel) => (
                        <Button
                          key={vowel}
                          id={`calibrate-voice-${vowel}`}
                          variant="outline"
                          size="sm"
                          disabled={
                            !view.micActive || !!view.voiceCalibration || view.tracking === 'paused'
                          }
                          onClick={() => run(() => a?.calibrateVoice(vowel))}
                        >
                          {view.voiceCalibration === vowel
                            ? t('app.vowelSampling', { vowel })
                            : `${vowel}${s.voiceTemplates[vowel] ? ' ✓' : ''}`}
                        </Button>
                      ))}
                    </div>
                    <Button
                      id="reset-voice-calibration"
                      variant="outline"
                      size="sm"
                      disabled={
                        !!view.voiceCalibration || !vowels.some((vowel) => s.voiceTemplates[vowel])
                      }
                      onClick={() => set('voiceTemplates', {})}
                    >
                      {t('app.restoreBuiltinTemplates')}
                    </Button>
                  </Fold>
                </>
              )}
            </Fold>
            <Fold title={t('app.trackingFineTune')}>
              {range('depthSensitivity', t('app.depthSensitivity'), 0, 2, 0.1)}
              <p className="hint">
                {s.engine === 'nvidia' ? t('app.depthUnavailable') : t('app.depthHint')}
              </p>
              {range('headSmooth', t('app.headSmooth'), 0, 0.5, 0.01)}

              <label htmlFor="eye-link">{t('app.eyeLink')}</label>
              <Select
                value={s.eyeLink}
                onValueChange={(value) => set('eyeLink', value as Settings['eyeLink'])}
              >
                <SelectTrigger id="eye-link">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">{t('app.eyeLinkOff')}</SelectItem>
                  <SelectItem value="side">{t('app.eyeLinkSide')}</SelectItem>
                  <SelectItem value="always">{t('app.eyeLinkAlways')}</SelectItem>
                </SelectContent>
              </Select>
              {s.eyeLink === 'side' && range('eyeLinkAngle', t('app.eyeLinkAngle'), 10, 60, 1)}
              <Button
                id="calibrate-eyes"
                variant="outline"
                disabled={view.tracking !== 'running' || !!view.calibrating || !s.neutral}
                onClick={() => a?.calibrate('eyes')}
              >
                {t('app.calibrateEyes')}
              </Button>
              <p className="hint">
                {t('app.calibrateEyesHint')}
                {s.eyeClosedLeft !== null && t('app.eyesSaved')}
              </p>
              {range('eyeSensitivity', t('app.eyeSensitivity'), 0.3, 2, 0.1)}
              {s.eyeClosedLeft === null &&
                range('eyeClosedThreshold', t('app.eyeClosedThreshold'), 0, 0.6, 0.01)}
              <p className="hint">{t('app.eyeClosedHint')}</p>
              {range('eyeSmooth', t('app.eyeSmooth'), 0, 0.3, 0.01)}
              {range('mouthSensitivity', t('app.mouthSensitivity'), 0.2, 3, 0.1)}
              {range('mouthSmooth', t('app.mouthSmooth'), 0, 0.4, 0.01)}
              <p className="hint">{t('app.mouthSmoothHint')}</p>
              {range('lostDelay', t('app.lostDelay'), 0.1, 2, 0.1)}
              <label htmlFor="lost-mode">{t('app.lostMode')}</label>
              <Select
                value={s.lostMode}
                onValueChange={(value) => set('lostMode', value as Settings['lostMode'])}
              >
                <SelectTrigger id="lost-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="neutral">{t('app.lostNeutral')}</SelectItem>
                  <SelectItem value="hold">{t('app.lostHold')}</SelectItem>
                </SelectContent>
              </Select>
              <p className="hint">{t('app.calibrateHint')}</p>
            </Fold>
            <Fold title={t('app.engineAndCapture')}>
              <label htmlFor="engine">{t('app.trackingEngine')}</label>
              <Select
                disabled={active || !view.ready}
                value={s.engine}
                onValueChange={(value) => set('engine', value as Settings['engine'])}
              >
                <SelectTrigger id="engine">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mediapipe">{t('app.engineMediapipe')}</SelectItem>
                  <SelectItem value="openseeface">{t('app.engineOpenSeeFace')}</SelectItem>
                  {(/Win/.test(navigator.platform) || s.engine === 'nvidia') && (
                    <SelectItem value="nvidia" disabled={!/Win/.test(navigator.platform)}>
                      {t('app.nvidiaExperimental')}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
              <div hidden={s.engine !== 'mediapipe'}>
                <label htmlFor="tracking-delegate">{t('app.trackingDelegate')}</label>
                <Select
                  disabled={active}
                  value={s.trackingDelegate}
                  onValueChange={(value) =>
                    set('trackingDelegate', value as Settings['trackingDelegate'])
                  }
                >
                  <SelectTrigger id="tracking-delegate">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GPU">{t('app.trackingDelegateGpu')}</SelectItem>
                    <SelectItem value="CPU">CPU</SelectItem>
                  </SelectContent>
                </Select>
                <p className="hint">{t('app.trackingDelegateHint')}</p>
                <label htmlFor="camera-resolution">{t('app.captureResolution')}</label>
                <Select
                  disabled={active}
                  value={s.cameraResolution}
                  onValueChange={(value) =>
                    set('cameraResolution', value as Settings['cameraResolution'])
                  }
                >
                  <SelectTrigger id="camera-resolution">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="360p">640 × 360 · {t('app.powerSaving')}</SelectItem>
                    <SelectItem value="720p">1280 × 720 · {t('app.recommended')}</SelectItem>
                    <SelectItem value="1080p">1920 × 1080 · {t('app.highDefinition')}</SelectItem>
                  </SelectContent>
                </Select>
                <label htmlFor="tracking-fps">{t('app.faceFps')}</label>
                <Select
                  disabled={active}
                  value={String(s.trackingFps)}
                  onValueChange={(value) =>
                    set('trackingFps', Number(value) as Settings['trackingFps'])
                  }
                >
                  <SelectTrigger id="tracking-fps">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[15, 24, 30, 60].map((fps) => (
                      <SelectItem key={fps} value={String(fps)}>
                        {fps} FPS
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(['bodyFps', 'handFps'] as const).map((key) => (
                  <label key={key}>
                    {key === 'bodyFps' ? t('app.bodyFps') : t('app.handFps')}
                    <Select
                      disabled={active}
                      value={String(s[key])}
                      onValueChange={(value) => set(key, Number(value) as Settings[typeof key])}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[5, 10, 15, 30].map((fps) => (
                          <SelectItem key={fps} value={String(fps)}>
                            {fps} FPS
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                ))}
                <p className="hint">{t('app.captureHint')}</p>
                {view.cameraSettings && (
                  <p className="hint">
                    {t('app.actualCapture', { settings: view.cameraSettings })}
                  </p>
                )}
                <Toggle
                  id="show-camera"
                  label={t('app.showCamera')}
                  checked={s.previewCamera}
                  onChange={(value) => set('previewCamera', value)}
                  note={t('app.showCameraNote')}
                />
                {toggle('previewMirror', t('app.mirrorPreview'))}
              </div>
            </Fold>
          </section>
          <section id="library" className="panel" hidden={tab !== 'library'}>
            <div className="section-title">
              <h2 id="library-title" tabIndex={-1}>
                {t('app.myModels')}
              </h2>
              <span>{t('app.modelCount', { count: view.library.length })}</span>
            </div>
            <p className="library-drop-hint">{t('app.libraryDropHint')}</p>
            <div className="library-actions">
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <Button id="import-model" variant="outline" size="sm" disabled={busy}>
                    <Plus aria-hidden="true" />
                    {t('app.addModel')}
                    <ChevronDown aria-hidden="true" />
                  </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content className="model-import-menu" align="start" sideOffset={6}>
                    <DropdownMenu.Item onSelect={() => run(() => a?.importModel('file'))}>
                      {t('app.chooseModelFile')}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item onSelect={() => run(() => a?.importModel('directory'))}>
                      {t('app.chooseModelFolder')}
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
              {openLibraryButton}
            </div>
            <div className="model-library" aria-label={t('app.savedModels')} aria-busy={busy}>
              {library.map((entry) => {
                const pinned = s.pinnedModels.includes(entry.path);
                return (
                  <ContextMenu.Root key={entry.path}>
                    <ContextMenu.Trigger asChild disabled={busy}>
                      <Button
                        variant="outline"
                        className="model-card"
                        disabled={busy}
                        aria-label={t('app.switchTo', { name: entry.name })}
                        aria-pressed={view.model?.path === entry.path}
                        title={entry.path}
                        onClick={() => run(() => a?.recentModel(entry.path))}
                      >
                        <span className="model-thumbnail">
                          {view.previews[entry.path] ? (
                            <img
                              src={view.previews[entry.path]}
                              alt={t('app.modelPreviewAlt', { name: entry.name })}
                            />
                          ) : (
                            <UserRound aria-hidden="true" />
                          )}
                          {pinned && (
                            <span className="model-pin" aria-hidden="true">
                              <Pin />
                            </span>
                          )}
                        </span>
                        <span className="model-card-name">{entry.name}</span>
                        <small>
                          {pinned && `${t('app.pinned')} · `}
                          {view.model?.path === entry.path
                            ? t('app.inUseShort')
                            : t('app.clickToSwitch')}
                        </small>
                      </Button>
                    </ContextMenu.Trigger>
                    <ContextMenu.Portal>
                      <ContextMenu.Content className="model-import-menu">
                        <ContextMenu.Item
                          className="flex items-center gap-2 data-[disabled]:opacity-50"
                          disabled={busy}
                          onSelect={() =>
                            set(
                              'pinnedModels',
                              pinned
                                ? s.pinnedModels.filter((path) => path !== entry.path)
                                : [...s.pinnedModels, entry.path],
                            )
                          }
                        >
                          {pinned ? (
                            <PinOff aria-hidden="true" size={14} />
                          ) : (
                            <Pin aria-hidden="true" size={14} />
                          )}
                          {pinned ? t('app.unpin') : t('app.pin')}
                        </ContextMenu.Item>
                        <ContextMenu.Item
                          className="flex items-center gap-2 text-destructive data-[disabled]:opacity-50"
                          disabled={busy || entry.builtin}
                          onSelect={() => setModelToRemove(entry)}
                        >
                          <Trash2 aria-hidden="true" size={14} />
                          {entry.builtin ? t('app.builtinNotRemovable') : t('app.removeModel')}
                        </ContextMenu.Item>
                      </ContextMenu.Content>
                    </ContextMenu.Portal>
                  </ContextMenu.Root>
                );
              })}
            </div>
            <AlertDialog.Root
              open={!!modelToRemove}
              onOpenChange={(open) => !open && setModelToRemove(null)}
            >
              <AlertDialog.Portal>
                <AlertDialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
                <AlertDialog.Content
                  className="fixed top-1/2 left-1/2 z-50 w-[calc(100%_-_2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-background p-6 shadow-lg"
                  onCloseAutoFocus={(event) => {
                    event.preventDefault();
                    document.getElementById('library-title')?.focus();
                  }}
                >
                  <AlertDialog.Title className="text-lg font-medium">
                    {t('app.removeModelTitle', { name: modelToRemove?.name ?? '' })}
                  </AlertDialog.Title>
                  <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
                    {t('app.removeModelDescription')}
                  </AlertDialog.Description>
                  <div className="mt-5 flex justify-end gap-2">
                    <AlertDialog.Cancel asChild>
                      <Button variant="outline">{t('app.cancel')}</Button>
                    </AlertDialog.Cancel>
                    <AlertDialog.Action asChild>
                      <Button
                        variant="destructive"
                        disabled={busy}
                        onClick={() => modelToRemove && run(() => a?.removeModel(modelToRemove.id))}
                      >
                        {t('app.confirmRemove')}
                      </Button>
                    </AlertDialog.Action>
                  </div>
                </AlertDialog.Content>
              </AlertDialog.Portal>
            </AlertDialog.Root>
            {!view.library.length && <p className="hint">{t('app.libraryEmpty')}</p>}
            {!!view.libraryDirectory && (
              <Fold title={t('app.modelFolder')}>
                <div className="flex items-center gap-2">
                  <p className="library-path min-w-0 flex-1">{view.libraryDirectory}</p>
                  {openLibraryButton}
                </div>
                <p className="hint">{t('app.modelFolderHint')}</p>
              </Fold>
            )}
          </section>
          <section id="appearance" className="panel" hidden={tab !== 'appearance'}>
            {a && (
              <SceneControls view={view} actions={a}>
                <div className="section-title">
                  <h2>{t('app.modelLayout')}</h2>
                  <Button
                    id="reset-display"
                    variant="ghost"
                    size="sm"
                    onClick={() => a?.resetDisplay()}
                  >
                    {t('app.resetLayout')}
                  </Button>
                </div>
                <Toggle
                  id="modelVisible"
                  label={t('app.showMainModel')}
                  checked={s.modelVisible}
                  onChange={(value) => set('modelVisible', value)}
                />
                <p className="hint">{t('app.layoutHint')}</p>
                <Fold title={t('app.layoutValues')}>
                  {range('zoom', t('app.modelZoom'), 0.05, 10, 0.05)}
                  {range('x', t('app.horizontalPosition'), -0.8, 0.8, 0.01)}
                  {range('y', t('app.verticalPosition'), -3, 3, 0.01)}
                  {range('rotation', t('app.modelRotation'), -180, 180, 1)}
                </Fold>
              </SceneControls>
            )}
          </section>
          <section id="model-controls" className="panel" hidden={tab !== 'model-controls'}>
            {a && <ModelControls key={view.model?.path} view={view} actions={a} />}
          </section>
          <section id="meeting" className="panel" hidden={tab !== 'meeting'}>
            <Tabs.Root defaultValue="camera">
              <Tabs.List
                aria-label={t('app.connectionMethod')}
                className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-secondary p-1"
              >
                {[
                  ['camera', t('app.builtinVirtualCamera')],
                  ['obs', t('app.obsConnect')],
                ].map(([value, label]) => (
                  <Tabs.Trigger key={value} value={value} asChild>
                    <Button
                      variant="ghost"
                      className="data-[state=active]:bg-background data-[state=active]:text-accent-foreground data-[state=active]:shadow-sm"
                    >
                      {label}
                    </Button>
                  </Tabs.Trigger>
                ))}
              </Tabs.List>
              <Tabs.Content value="camera">
                <div className="section-title">
                  <h2 className="shrink-0 whitespace-nowrap">{t('app.builtinVirtualCamera')}</h2>
                  <span className="truncate" title="Windows / macOS · 720p / 30 FPS">
                    Windows / macOS · 720p / 30 FPS
                  </span>
                </div>
                <p role="status" className="break-words" title={view.virtualCamera.message}>
                  {view.virtualCamera.message}
                </p>
                <div className="flex items-center gap-2" tabIndex={-1}>
                  <Button
                    variant="outline"
                    className="flex-1"
                    disabled={!camera.supported || !!cameraPending}
                    onClick={() =>
                      a &&
                      runCamera(
                        cameraActionPending,
                        !camera.installed
                          ? a.installCamera
                          : camera.active
                            ? a.stopCamera
                            : a.startCamera,
                      )
                    }
                  >
                    {cameraPending || cameraActionLabel}
                  </Button>
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                      <Button
                        ref={cameraMoreButton}
                        variant="outline"
                        size="icon"
                        disabled={!camera.installed || !!cameraPending}
                        aria-label={t('app.virtualCameraMore')}
                        title={t('app.moreActions')}
                      >
                        <Ellipsis aria-hidden="true" />
                      </Button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content
                        className="model-import-menu"
                        align="end"
                        sideOffset={6}
                      >
                        <DropdownMenu.Item
                          disabled={!camera.installed || !!cameraPending}
                          onSelect={() => setUninstallCameraOpen(true)}
                        >
                          {t('app.uninstallVirtualCamera')}
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                  <AlertDialog.Root
                    open={uninstallCameraOpen}
                    onOpenChange={setUninstallCameraOpen}
                  >
                    <AlertDialog.Portal>
                      <AlertDialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
                      <AlertDialog.Content
                        className="fixed top-1/2 left-1/2 z-50 w-[calc(100%_-_2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-background p-6 shadow-lg"
                        onCloseAutoFocus={(event) => {
                          event.preventDefault();
                          const button = cameraMoreButton.current;
                          (button?.disabled ? button.parentElement : button)?.focus();
                        }}
                      >
                        <AlertDialog.Title className="text-lg font-medium">
                          {t('app.uninstallVirtualCameraTitle')}
                        </AlertDialog.Title>
                        <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
                          {t('app.uninstallVirtualCameraDescription')}
                        </AlertDialog.Description>
                        <div className="mt-5 flex justify-end gap-2">
                          <AlertDialog.Cancel asChild>
                            <Button variant="outline">{t('app.cancel')}</Button>
                          </AlertDialog.Cancel>
                          <AlertDialog.Action asChild>
                            <Button
                              variant="destructive"
                              disabled={!camera.installed || !!cameraPending}
                              onClick={() =>
                                a && runCamera(t('app.uninstalling'), a.uninstallCamera)
                              }
                            >
                              {t('app.confirmUninstall')}
                            </Button>
                          </AlertDialog.Action>
                        </div>
                      </AlertDialog.Content>
                    </AlertDialog.Portal>
                  </AlertDialog.Root>
                </div>
                {toggle(
                  'autoStartVirtualCamera',
                  t('app.autoStartVirtualCamera'),
                  !camera.installed,
                )}
                <Fold title={t('app.moreOutputOptions')}>
                  {toggle(
                    'autoStopVirtualCamera',
                    t('app.autoStopVirtualCamera'),
                    !camera.installed,
                  )}
                  {toggle('virtualCameraMirror', t('app.mirrorOutput'), !camera.installed)}
                  <p className="hint">{t('app.virtualCameraHint')}</p>
                </Fold>
              </Tabs.Content>
              <Tabs.Content value="obs">
                <div className="section-title">
                  <h2>{t('app.obsTransparentOutput')}</h2>
                  <span>
                    {obsNative ? `Alpha · 1920×1080 · ${s.renderFps} FPS` : t('app.obsBrowserSpec')}
                  </span>
                </div>
                <div className={`obs-card${view.obsOutput.active ? ' live' : ''}`}>
                  <div className="flex items-center gap-3">
                    <span className="obs-alpha" aria-hidden="true">
                      <UserRound />
                    </span>
                    <div className="obs-state">
                      <strong role="status">
                        {view.obsOutput.pending
                          ? t('app.switching')
                          : view.obsOutput.active
                            ? t('app.outputting')
                            : t('app.notStarted')}
                      </strong>
                      <small>
                        {!view.obsOutput.supported
                          ? t('app.enableInDesktopApp')
                          : !view.obsOutput.active
                            ? t('app.obsTransparentHint')
                            : obsNative
                              ? t('app.obsNativeSelect', { source: obsSource })
                              : t('app.obsBrowserPaste')}
                      </small>
                    </div>
                  </div>
                  {view.obsOutput.native && (
                    <ToggleGroup.Root
                      type="single"
                      aria-label={t('app.outputMethod')}
                      className="grid grid-cols-2 gap-1 rounded-lg bg-secondary p-1"
                      value={s.obsOutput}
                      disabled={view.obsOutput.active || view.obsOutput.pending}
                      onValueChange={(value) =>
                        value && set('obsOutput', value as Settings['obsOutput'])
                      }
                    >
                      {[
                        ['native', view.obsOutput.native],
                        ['browser', t('app.browserSource')],
                      ].map(([value, label]) => (
                        <ToggleGroup.Item key={value} value={value} asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="data-[state=on]:bg-background data-[state=on]:text-accent-foreground data-[state=on]:shadow-sm"
                          >
                            {label}
                          </Button>
                        </ToggleGroup.Item>
                      ))}
                    </ToggleGroup.Root>
                  )}
                  {!obsNative && view.obsOutput.url && (
                    <div className="flex items-center gap-2">
                      <Input
                        aria-label={t('app.obsBrowserUrl')}
                        readOnly
                        value={view.obsOutput.url}
                        onFocus={(event) => event.target.select()}
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label={t('app.copyAddress')}
                        title={t('app.copyAddress')}
                        onClick={() => run(() => a?.copyObsUrl())}
                      >
                        <Copy aria-hidden="true" />
                      </Button>
                    </div>
                  )}
                  <Button
                    variant={view.obsOutput.active ? 'outline' : 'default'}
                    className="w-full"
                    disabled={!view.obsOutput.supported || view.obsOutput.pending || busy}
                    onClick={() => run(() => a?.setObsOutput(!view.obsOutput.active))}
                  >
                    {view.obsOutput.pending
                      ? t('app.switching')
                      : view.obsOutput.active
                        ? t('app.stopTransparentOutput')
                        : t('app.startTransparentOutput')}
                  </Button>
                </div>
                <Fold title={t('app.obsSetupSteps')}>
                  <p className="hint">
                    {obsNative
                      ? t('app.obsNativeHint', { native: view.obsOutput.native ?? '' })
                      : t('app.obsLocalOnly')}
                    {t('app.obsEdgeHint')}
                  </p>
                  <ol className="guide">
                    {[
                      ...(view.obsOutput.native === 'Spout2' && obsNative
                        ? [[t('app.guideSpoutPluginTitle'), t('app.guideSpoutPluginText')]]
                        : []),
                      obsNative
                        ? [t('app.startTransparentOutput'), t('app.guideStartNativeText')]
                        : [t('app.guideStartCopyTitle'), t('app.guideStartCopyText')],
                      !obsNative
                        ? [t('app.guideBrowserTitle'), t('app.guideBrowserText')]
                        : view.obsOutput.native === 'Spout2'
                          ? [t('app.guideSpoutTitle'), t('app.guideSpoutText')]
                          : [t('app.guideSyphonTitle'), t('app.guideSyphonText')],
                      [t('app.guideCompositeTitle'), t('app.guideCompositeText')],
                      [t('app.guideCameraTitle'), t('app.guideCameraText')],
                    ].map(([title, text]) => (
                      <li key={title}>
                        <b>{title}</b>
                        <p>{text}</p>
                      </li>
                    ))}
                  </ol>
                  <p className="hint">{t('app.obsWindowHint')}</p>
                </Fold>
              </Tabs.Content>
            </Tabs.Root>
            <Fold title={t('app.qualityAndGeneral')}>
              <label htmlFor="ui-language">{t('app.language')}</label>
              <Select
                value={s.language}
                onValueChange={(value) => set('language', value as Settings['language'])}
              >
                <SelectTrigger id="ui-language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="system">{t('app.languageSystem')}</SelectItem>
                  {languageNames.map(([value, name]) => (
                    <SelectItem key={value} value={value} lang={value}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {languagePending && (
                <div className="language-restart">
                  <p className="hint">{t('app.languageRestartHint')}</p>
                  <Button size="sm" onClick={() => run(() => a?.restartApp())}>
                    {t('app.restartNow')}
                  </Button>
                </div>
              )}
              <label htmlFor="render-fps">{t('app.renderFps')}</label>
              <Select
                value={String(s.renderFps)}
                onValueChange={(value) => set('renderFps', Number(value) as Settings['renderFps'])}
              >
                <SelectTrigger id="render-fps">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 FPS · {t('app.powerSaving')}</SelectItem>
                  <SelectItem value="60">60 FPS · {t('app.smooth')}</SelectItem>
                </SelectContent>
              </Select>
              {toggle('supersample', t('app.supersample'))}
              <Toggle
                id="outputTransparent"
                label={t('app.outputTransparent')}
                note={t('app.outputTransparentNote')}
                checked={s.outputTransparent}
                onChange={(value) => set('outputTransparent', value)}
              />
              <p className="hint">{t('app.streamModeHint')}</p>
              <Button
                id="reset-all"
                variant="outline"
                className="wide"
                onClick={() => run(() => a?.resetAll())}
              >
                {t('app.resetAll')}
              </Button>
            </Fold>
          </section>
          <footer className="panel-footer">
            <Sparkles className="leaf-dot" aria-hidden="true" />
            VTubeLeaf
            <button
              className="ml-auto hover:text-foreground"
              onClick={() => run(() => a?.openAbout())}
              aria-label={t('app.aboutAndUpdates')}
            >
              {['available', 'downloading', 'ready', 'installed'].includes(view.updater.status)
                ? view.updater.status === 'downloading'
                  ? t('app.downloading')
                  : view.updater.status === 'ready' || view.updater.status === 'installed'
                    ? t('app.updateReady')
                    : t('app.updateAvailable')
                : `v${version}`}
            </button>
          </footer>
        </aside>
      </main>
      <Dialog.Root
        open={!!whatsNew.length}
        onOpenChange={(open) => !open && set('lastSeenVersion', version)}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
          <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100%_-_2rem)] w-[calc(100%_-_2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border bg-background p-6 shadow-lg">
            <Dialog.Title className="text-lg font-medium">
              {t('app.updatedTo', { version })}
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted-foreground">
              {whatsNew.length > 1
                ? t('app.updatedCount', { count: whatsNew.length })
                : t('app.whatsChanged')}
            </Dialog.Description>
            <div className="mt-4 min-h-0 overflow-y-auto text-sm leading-6">
              <ReleaseList list={whatsNew} />
            </div>
            <div className="mt-5 flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">{t('app.allReleasesInAbout')}</p>
              <Dialog.Close asChild>
                <Button>{t('app.gotIt')}</Button>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

// Each language is listed in its own name, so it can be found from any UI language.
const languageNames = [
  ['en', 'English'],
  ['zh', '简体中文'],
  ['ja', '日本語'],
  ['es', 'Español'],
  ['fr', 'Français'],
] as const;

function hotkeyLabel(binding = '') {
  return binding.replace(/\b(?:Key|Digit)(?=[A-Z0-9]\b)/g, '');
}

function HotkeyHint({ binding }: { binding?: string }) {
  return binding ? (
    <kbd className="rounded border px-1 text-[0.85em] opacity-70" title={t('app.hotkeyActiveHint')}>
      {hotkeyLabel(binding)}
    </kbd>
  ) : null;
}

function ModelControls({ view, actions: a }: { view: StudioView; actions: Studio['actions'] }) {
  const [parameterId, setParameter] = useState(view.parameters[0]?.id ?? '');
  const [parameterSearch, setParameterSearch] = useState('');
  const [parameterGroup, setParameterGroup] = useState('');
  const groups = useMemo(
    () => [...new Set(view.parameters.map((p) => p.group || t('app.ungrouped')))].sort(),
    [view.parameters],
  );
  const parameters = useMemo(() => {
    const query = parameterSearch.trim().toLocaleLowerCase();
    return view.parameters.filter(
      (p) =>
        (!parameterGroup || (p.group || t('app.ungrouped')) === parameterGroup) &&
        (!query ||
          [p.id, p.name, parameterNames[p.id] && t(parameterNames[p.id]), p.group].some((text) =>
            text?.toLocaleLowerCase().includes(query),
          )),
    );
  }, [view.parameters, parameterSearch, parameterGroup]);
  const [hotkeyId, setHotkey] = useState(
    () =>
      [
        ...view.expressions.map((e) => `expression:${e.id}`),
        ...view.motions.map((m) => `motion:${m.id}`),
      ].find((id) => view.settings.hotkeys[id]) ?? 'stop-motion',
  );
  const [mode, setMode] = useState<MotionMode | 'default'>('default');
  const parameter = parameters.find((p) => p.id === parameterId) ?? parameters[0];
  const run = a.run;
  const common = view.parameters.filter((p) => Object.hasOwn(parameterNames, p.id));
  return (
    <>
      <div className="section-title">
        <h2>{t('app.expressions')}</h2>
        <Button
          id="clear-expressions"
          variant="ghost"
          size="sm"
          onClick={() => run(() => a.modelAction('clear-expressions'))}
        >
          {t('app.clearAll')}
          <HotkeyHint binding={view.settings.hotkeys['clear-expressions']} />
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
            <HotkeyHint binding={view.settings.hotkeys[`expression:${e.id}`]} />
          </Button>
        ))}
        {!view.expressions.length && (
          <p className="hint">
            {view.model ? t('app.noModelResources') : t('app.availableAfterLoad')}
          </p>
        )}
      </div>
      <div className="divider" />
      <div className="section-title">
        <h2>{t('app.motions')}</h2>
        <Button
          id="stop-motion"
          variant="ghost"
          size="sm"
          onClick={() => run(() => a.modelAction('stop-motion'))}
        >
          {t('app.stopMotion')}
          <HotkeyHint binding={view.settings.hotkeys['stop-motion']} />
        </Button>
      </div>
      <div id="motion-buttons" className="button-list">
        {view.motions.map((m) => (
          <Button
            key={m.id}
            variant="outline"
            onClick={() =>
              run(() =>
                a.modelAction(
                  `motion:${m.id}`,
                  mode === 'default'
                    ? (view.settings.hotkeyOptions[`motion:${m.id}`]?.motionMode ?? 'once')
                    : mode,
                ),
              )
            }
          >
            {m.name}
            <HotkeyHint binding={view.settings.hotkeys[`motion:${m.id}`]} />
          </Button>
        ))}
        {!view.motions.length && (
          <p className="hint">
            {view.model ? t('app.noModelResources') : t('app.availableAfterLoad')}
          </p>
        )}
      </div>
      <Fold title={t('app.motionIdleSettings')}>
        <label htmlFor="motion-mode">{t('app.playbackMode')}</label>
        <Select
          value={mode}
          onValueChange={(value) => {
            const next = value as MotionMode | 'default';
            a.motionMode = next === 'default' ? 'once' : next;
            setMode(next);
          }}
        >
          <SelectTrigger id="motion-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">{t('app.followMotionSetting')}</SelectItem>
            <SelectItem value="once">{t('app.once')}</SelectItem>
            <SelectItem value="loop">{t('app.loop')}</SelectItem>
            <SelectItem value="hold">{t('app.holdLastFrame')}</SelectItem>
          </SelectContent>
        </Select>
        <label htmlFor="idle-motion">{t('app.idleMotion')}</label>
        <Select
          value={view.settings.idleMotion || 'no-motion'}
          onValueChange={(value) => a.setSetting('idleMotion', value === 'no-motion' ? '' : value)}
        >
          <SelectTrigger id="idle-motion">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="no-motion">{t('app.noIdle')}</SelectItem>
            {view.motions.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label htmlFor="lost-idle-motion">{t('app.lostIdleMotion')}</label>
        <Select
          value={view.settings.lostIdleMotion || 'default-motion'}
          onValueChange={(value) =>
            a.setSetting('lostIdleMotion', value === 'default-motion' ? '' : value)
          }
        >
          <SelectTrigger id="lost-idle-motion">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default-motion">{t('app.followIdle')}</SelectItem>
            {view.motions.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Toggle
          id="motion-sound"
          label={t('app.motionSound')}
          checked={view.settings.motionSound}
          onChange={(value) => a.setSetting('motionSound', value)}
        />
        <Toggle
          id="autoBlink"
          label={t('app.autoBlink')}
          checked={view.settings.autoBlink}
          onChange={(value) => a.setSetting('autoBlink', value)}
        />
      </Fold>
      <Fold title={t('app.hotkeys')}>
        <Toggle
          id="use-keyboard-hotkeys"
          label={t('app.useKeyboardHotkeys')}
          checked={view.settings.useKeyboardHotkeys}
          onChange={(value) => a.setSetting('useKeyboardHotkeys', value)}
        />
        <p className="hint">{t('app.hotkeysPerModel')}</p>

        <p className="hint">{t('app.hotkeysHelp')}</p>
        <label htmlFor="hotkey-action">{t('app.hotkeyAction')}</label>
        <Select value={hotkeyId} onValueChange={(value) => setHotkey(value)}>
          <SelectTrigger id="hotkey-action">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="toggle-tracking">{t('app.hotkeyToggleTracking')}</SelectItem>
            <SelectItem value="calibrate">{t('app.calibrateNeutral')}</SelectItem>
            <SelectItem value="toggle-mic">{t('app.hotkeyToggleMic')}</SelectItem>
            <SelectItem value="toggle-model">{t('app.hotkeyToggleModel')}</SelectItem>
            <SelectItem value="toggle-camera">{t('app.hotkeyToggleCamera')}</SelectItem>
            <SelectItem value="pause-tracking">{t('app.hotkeyPauseTracking')}</SelectItem>
            <SelectItem value="stop-tracking">{t('app.hotkeyStopTracking')}</SelectItem>
            <SelectItem value="reset-display">{t('app.hotkeyResetDisplay')}</SelectItem>
            <SelectItem value="open-output">{t('app.hotkeyOpenOutput')}</SelectItem>
            {view.settings.scenes.map((scene) => (
              <SelectItem key={scene.id} value={`scene:${scene.id}`}>
                {t('app.hotkeyScene', { name: scene.name })}
              </SelectItem>
            ))}
            {view.settings.composition.items.map((item) => (
              <SelectItem key={item.id} value={`item:${item.id}`}>
                {t('app.hotkeyToggleItem', { name: item.name })}
              </SelectItem>
            ))}
            <SelectItem value="stop-motion">
              {t('app.stopMotion')}
              {view.settings.hotkeys['stop-motion'] &&
                ` · ${hotkeyLabel(view.settings.hotkeys['stop-motion'])}`}
            </SelectItem>
            <SelectItem value="clear-expressions">
              {t('app.clearExpressions')}
              {view.settings.hotkeys['clear-expressions'] &&
                ` · ${hotkeyLabel(view.settings.hotkeys['clear-expressions'])}`}
            </SelectItem>
            {view.expressions.map((e) => (
              <SelectItem key={e.id} value={`expression:${e.id}`}>
                {t('app.hotkeyExpression', { name: e.name })}
                {view.settings.hotkeys[`expression:${e.id}`] &&
                  ` · ${hotkeyLabel(view.settings.hotkeys[`expression:${e.id}`])}`}
              </SelectItem>
            ))}
            {view.motions.map((m) => (
              <SelectItem key={m.id} value={`motion:${m.id}`}>
                {t('app.hotkeyMotion', { name: m.name })}
                {view.settings.hotkeys[`motion:${m.id}`] &&
                  ` · ${hotkeyLabel(view.settings.hotkeys[`motion:${m.id}`])}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <HotkeyEditor
          key={`${hotkeyId}:${view.profileRevision}`}
          id={hotkeyId}
          view={view}
          actions={a}
        />
      </Fold>
      <Fold title={t('app.advanced')}>
        <p id="capabilities" className="hint">
          {!view.model
            ? t('app.capabilitiesNoModel')
            : common.length
              ? t('app.capabilities', {
                  list: common.map((p) => t(parameterNames[p.id])).join(t('app.listSeparator')),
                })
              : t('app.capabilitiesNone')}
        </p>
        {!!view.model?.vtsResources?.warnings.length && (
          <Fold title={t('app.modelWarnings', { count: view.model.vtsResources.warnings.length })}>
            <div className="max-h-64 overflow-y-auto" role="status" tabIndex={0}>
              {view.model.vtsResources.warnings.map((warning, index) => (
                <p key={index} className="hint">
                  {warning}
                </p>
              ))}
            </div>
          </Fold>
        )}
        <div className="section-title">
          <h2>{t('app.modelParameters')}</h2>
          <AlertDialog.Root>
            <AlertDialog.Trigger asChild>
              <Button id="reset-profile" variant="ghost" size="sm" disabled={!view.model}>
                {t('app.resetProfile')}
              </Button>
            </AlertDialog.Trigger>
            <AlertDialog.Portal>
              <AlertDialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
              <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%_-_2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-background p-6 shadow-lg">
                <AlertDialog.Title className="text-lg font-medium">
                  {t('app.resetProfileTitle', { name: view.model?.name ?? '' })}
                </AlertDialog.Title>
                <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
                  {t('app.resetProfileDescription')}
                </AlertDialog.Description>
                <div className="mt-5 flex justify-end gap-2">
                  <AlertDialog.Cancel asChild>
                    <Button variant="outline">{t('app.cancel')}</Button>
                  </AlertDialog.Cancel>
                  <AlertDialog.Action asChild>
                    <Button variant="destructive" onClick={() => run(a.resetProfile)}>
                      {t('app.confirmReset')}
                    </Button>
                  </AlertDialog.Action>
                </div>
              </AlertDialog.Content>
            </AlertDialog.Portal>
          </AlertDialog.Root>
        </div>
        <p className="hint">{t('app.profileAutoSave')}</p>
        <div className="button-list">
          <Button
            id="import-vts"
            variant="outline"
            disabled={!view.model || view.modelLoading || view.sceneBusy}
            onClick={() => run(a.importVts)}
          >
            {t('app.importVts')}
          </Button>
          <Button
            id="reapply-vts"
            variant="outline"
            disabled={!view.model || view.modelLoading || view.sceneBusy}
            onClick={() => run(() => a.importVts('model'))}
          >
            {t('app.reapplyVts')}
          </Button>
        </div>
        <p className="hint">{t('app.vtsHint')}</p>
        {!!view.settings.vtsImportReport.length && (
          <Fold title={t('app.vtsImportReport')}>
            <div className="max-h-64 overflow-y-auto" tabIndex={0}>
              {view.settings.vtsImportReport.map((line, index) => (
                <p key={index} className="hint">
                  {line}
                </p>
              ))}
            </div>
          </Fold>
        )}
        <div className="divider" />
        <div className="section-title">
          <h2>{t('app.manualParameters')}</h2>
        </div>
        <p className="hint">{t('app.manualParametersHint')}</p>
        <label htmlFor="parameter-search">{t('app.searchParameters')}</label>
        <Input
          id="parameter-search"
          type="search"
          placeholder={t('app.searchPlaceholder')}
          value={parameterSearch}
          onChange={(e) => setParameterSearch(e.target.value)}
        />
        <label htmlFor="parameter-group">{t('app.parameterGroup')}</label>
        <Select
          value={parameterGroup || 'all-groups'}
          onValueChange={(value) => setParameterGroup(value === 'all-groups' ? '' : value)}
          disabled={!view.parameters.length}
        >
          <SelectTrigger id="parameter-group">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all-groups">{t('app.allGroups')}</SelectItem>
            {groups.map((group) => (
              <SelectItem key={group} value={group}>
                {group}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label htmlFor="mapping-parameter">
          {t('app.outputParameters', { count: parameters.length })}
        </label>
        <Select
          disabled={!parameters.length}
          value={(parameter?.id ?? '') || 'no-parameter'}
          onValueChange={(value) => setParameter(value === 'no-parameter' ? '' : value)}
        >
          <SelectTrigger id="mapping-parameter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {!parameters.length && (
              <SelectItem value="no-parameter">
                {view.parameters.length
                  ? t('app.noMatchingParameters')
                  : t('app.availableAfterLoadShort')}
              </SelectItem>
            )}
            {parameters.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name || (parameterNames[p.id] && t(parameterNames[p.id])) || p.id}
                {p.name || parameterNames[p.id] ? ` (${p.id})` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {parameter && (
          <>
            <ParameterOverride parameter={parameter} view={view} actions={a} />
            <Fold title={t('app.trackingMapping')}>
              <MappingEditor
                key={`${parameter.id}:${view.profileRevision}`}
                parameter={parameter}
                view={view}
                actions={a}
              />
            </Fold>
          </>
        )}
        <Fold title={t('app.physics')}>
          {!view.physicsGroups.length ? (
            <p className="hint">{t('app.noPhysics')}</p>
          ) : (
            <>
              <Range
                id="physicsStrength"
                label={t('app.physicsStrength')}
                value={view.settings.physicsStrength}
                min={0}
                max={2}
                step={0.05}
                onChange={(value) => a.setSetting('physicsStrength', value)}
              />
              <Range
                id="physicsWind"
                label={t('app.physicsWind')}
                value={view.settings.physicsWind}
                min={-2}
                max={2}
                step={0.05}
                onChange={(value) => a.setSetting('physicsWind', value)}
              />
              <label htmlFor="physics-fps">{t('app.physicsFps')}</label>
              <Select
                value={String(view.settings.physicsFps)}
                onValueChange={(value) => a.setSetting('physicsFps', Number(value) as 0 | 30 | 60)}
              >
                <SelectTrigger id="physics-fps">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">{t('app.followRenderFps')}</SelectItem>
                  <SelectItem value="30">30 FPS</SelectItem>
                  <SelectItem value="60">60 FPS</SelectItem>
                </SelectContent>
              </Select>
              {view.physicsGroups.map((group) => (
                <Range
                  key={group.id}
                  id={`physics-group-${group.id}`}
                  label={group.name}
                  value={view.settings.physicsGroups[group.id] ?? 1}
                  min={0}
                  max={2}
                  step={0.05}
                  onChange={(value) =>
                    a.setSetting('physicsGroups', {
                      ...view.settings.physicsGroups,
                      [group.id]: value,
                    })
                  }
                />
              ))}
            </>
          )}
        </Fold>
        <div className="divider" />
        <div className="section-title">
          <h2>{t('app.defaultAppearance')}</h2>
        </div>
        <div className="two-fields">
          <Button
            id="save-default-appearance"
            variant="outline"
            disabled={!view.model}
            onClick={() => run(a.saveDefaultAppearance)}
          >
            {t('app.saveDefaultAppearance')}
          </Button>
          <Button
            id="restore-default-appearance"
            variant="outline"
            disabled={!view.model}
            onClick={() => run(a.restoreDefaultAppearance)}
          >
            {t('app.restoreDefaultAppearance')}
          </Button>
        </div>
        <p className="hint">{t('app.defaultAppearanceHint')}</p>
        <div className="divider" />
        <div className="section-title">
          <h2>{t('app.motionRecording')}</h2>
          <output id="record-status">{view.duration.toFixed(1)} s</output>
        </div>
        <div className="two-fields">
          <Button
            id="record-toggle"
            variant="outline"
            disabled={!view.model}
            onClick={a.toggleRecording}
          >
            {view.recording ? t('app.stopRecording') : t('app.startRecording')}
          </Button>
          <Button
            id="record-save"
            variant="outline"
            disabled={!view.canSaveRecording}
            onClick={() => run(a.saveRecording)}
          >
            {t('app.saveMotion')}
          </Button>
        </div>
        <p className="hint">{t('app.recordingHint')}</p>
      </Fold>
    </>
  );
}
function ParameterOverride({
  parameter,
  view,
  actions,
}: {
  parameter: StudioView['parameters'][number];
  view: StudioView;
  actions: Studio['actions'];
}) {
  const enabled = Object.hasOwn(view.settings.parameterOverrides, parameter.id);
  const value = view.settings.parameterOverrides[parameter.id] ?? parameter.default;
  return (
    <div id="parameter-override">
      <p className="hint">
        {parameter.group || t('app.ungrouped')} · {parameter.id}
      </p>
      <Toggle
        id="parameter-override-enabled"
        label={t('app.overrideParameter')}
        checked={enabled}
        onChange={(checked) => actions.setParameterOverride(parameter.id, checked ? value : null)}
      />
      <div className="slider-label">
        <label htmlFor="parameter-override-value">{t('app.fixedValue')}</label>
        <output id="parameter-override-current" htmlFor="parameter-override-value">
          {Number(value.toFixed(3))}
        </output>
      </div>
      <input
        id="parameter-override-value"
        className="parameter-slider"
        type="range"
        min={parameter.min}
        max={parameter.max}
        step={(parameter.max - parameter.min) / 1000 || 0.001}
        value={value}
        disabled={!enabled || parameter.min === parameter.max}
        onChange={(e) => actions.setParameterOverride(parameter.id, e.target.valueAsNumber)}
      />
      <p className="hint">
        {t('app.parameterRange', {
          min: parameter.min,
          max: parameter.max,
          default: parameter.default,
        })}
      </p>
      <Button
        id="restore-parameter-tracking"
        variant="outline"
        disabled={!enabled}
        onClick={() => actions.setParameterOverride(parameter.id, null)}
      >
        {t('app.restoreTracking')}
      </Button>
    </div>
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
  const global = !['expression:', 'motion:', 'stop-motion', 'clear-expressions'].some((prefix) =>
    id.startsWith(prefix),
  );
  const [binding, setBinding] = useState(
    (global ? view.settings.globalHotkeys : view.settings.hotkeys)[id] ?? '',
  );
  const options = view.settings.hotkeyOptions[id] ?? { scope: 'local' as const };
  const expression = id.startsWith('expression:');
  const motion = id.startsWith('motion:');
  const fade = expression || motion || id === 'clear-expressions';
  const [release, setRelease] = useState(options.release ?? false);
  const [seconds, setSeconds] = useState(String(options.seconds ?? 0));
  const [fadeSeconds, setFadeSeconds] = useState(
    options.fadeSeconds === undefined ? '' : String(options.fadeSeconds),
  );
  const [motionMode, setMotionMode] = useState(options.motionMode ?? 'once');
  return (
    <>
      <label htmlFor="hotkey-binding">{t('app.keyCombo')}</label>
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
          disabled={!global && !view.model}
          onClick={() => actions.run(() => actions.applyHotkey(id, binding))}
        >
          {t('app.applyHotkey')}
        </Button>
        <Button
          id="clear-hotkey"
          variant="outline"
          disabled={!global && !view.model}
          onClick={() => {
            setBinding('');
            actions.run(() => actions.applyHotkey(id, ''));
          }}
        >
          {t('app.clear')}
        </Button>
      </div>
      {expression && (
        <>
          <Toggle
            id="hotkey-release"
            label={t('app.hotkeyRelease')}
            checked={release}
            onChange={setRelease}
          />
          <label htmlFor="hotkey-seconds">{t('app.hotkeySeconds')}</label>
          <Input
            id="hotkey-seconds"
            type="number"
            min="0"
            max="3600"
            step="0.1"
            value={seconds}
            onChange={(e) => setSeconds(e.target.value)}
          />
        </>
      )}
      {fade && (
        <>
          <label htmlFor="hotkey-fade-seconds">{t('app.hotkeyFade')}</label>
          <Input
            id="hotkey-fade-seconds"
            type="number"
            min="0"
            max="10"
            step="0.05"
            value={fadeSeconds}
            onChange={(e) => setFadeSeconds(e.target.value)}
          />
        </>
      )}
      {motion && (
        <>
          <label htmlFor="hotkey-motion-mode">{t('app.hotkeyMotionMode')}</label>
          <Select
            value={motionMode}
            onValueChange={(value) => setMotionMode(value as 'once' | 'hold')}
          >
            <SelectTrigger id="hotkey-motion-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="once">{t('app.once')}</SelectItem>
              <SelectItem value="hold">{t('app.holdLastFrame')}</SelectItem>
            </SelectContent>
          </Select>
          <p className="hint">{t('app.hotkeyMotionModeHint')}</p>
        </>
      )}
      {(fade || motion) && (
        <Button
          id="save-hotkey-options"
          variant="outline"
          disabled={!view.model}
          onClick={() =>
            actions.run(() =>
              actions.applyHotkeyOptions(id, {
                ...options,
                scope: 'local',
                ...(expression ? { release, seconds: Number(seconds) } : {}),
                ...(fade
                  ? { fadeSeconds: fadeSeconds.trim() === '' ? undefined : Number(fadeSeconds) }
                  : {}),
                ...(motion ? { motionMode } : {}),
              }),
            )
          }
        >
          {t('app.applyBehavior')}
        </Button>
      )}
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
  const initial: Mapping = view.settings.mappings[parameter.id] ??
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
  const [clamp, setClamp] = useState(initial.clamp ?? true);
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
        {t('app.mappingStatus', {
          value: input === undefined ? t('app.noData') : input.toFixed(3),
          mode: Object.hasOwn(view.settings.mappings, parameter.id)
            ? t('app.customMapping')
            : t('app.autoMapping'),
        })}
      </p>
      <div id="mapping-editor">
        <Toggle
          id="mapping-enabled"
          label={t('app.useTrackingForParameter')}
          checked={enabled}
          onChange={setEnabled}
        />
        <label htmlFor="mapping-source">{t('app.trackingInput')}</label>
        <Select value={source} onValueChange={(value) => setSource(value as FaceKey)}>
          <SelectTrigger id="mapping-source">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(faceSources).map(([id, label]) => (
              <SelectItem key={id} value={id}>
                {t(label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Toggle
          id="mapping-clamp"
          label={t('app.clampInput')}
          checked={clamp}
          onChange={setClamp}
        />
        <div className="two-fields">
          {field('inputMin', t('app.inputMin'))}
          {field('inputMax', t('app.inputMax'))}
        </div>
        <div className="two-fields">
          {field('outputMin', t('app.outputMin'))}
          {field('outputMax', t('app.outputMax'))}
        </div>
        {field('smoothing', t('app.smoothingSeconds'))}
        <div className="two-fields">
          <Button
            id="save-mapping"
            onClick={() =>
              actions.run(() =>
                actions.saveMapping(parameter.id, {
                  source,
                  enabled,
                  clamp,
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
            {t('app.applyMapping')}
          </Button>
          <Button
            id="reset-mapping"
            variant="outline"
            onClick={() => actions.resetMapping(parameter.id)}
          >
            {t('app.restoreAuto')}
          </Button>
        </div>
        <p className="hint">
          {t('app.mappingHint')}
          {source === 'mouthOpen' && t('app.mouthOpenHint')}
        </p>
      </div>
    </>
  );
}

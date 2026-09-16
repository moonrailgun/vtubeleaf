import { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { ChevronDown } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/ui/select';
import { version } from '../package.json';
import { Button } from './components/ui/button';
import { Switch } from './components/ui/switch';
import { initialUpdateState, type UpdateState } from './updater';

export function About() {
  const [events, setEvents] = useState<string[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    const previousTitle = document.title;
    document.title = '关于 VTubeLeaf';
    document.body.classList.add('about');
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    async function connect() {
      if (!isTauri()) return;
      const release = await listen<string[]>('about-events', ({ payload }) => {
        if (!disposed) setEvents(payload);
      });
      if (disposed) return release();
      unlisten = release;
      await emitTo('main', 'about-ready');
    }
    void connect().catch(() => {
      if (!disposed) setError('无法读取运行记录，请关闭此窗口后重试。');
    });
    return () => {
      disposed = true;
      unlisten?.();
      document.title = previousTitle;
      document.body.classList.remove('about');
    };
  }, []);
  return (
    <main className="about-page">
      <header className="flex items-center gap-4 pb-6">
        <img src="/brand/mark.svg" alt="" className="size-16" />
        <div>
          <h1 className="about-title">VTubeLeaf</h1>
          <p className="mt-1 text-xs text-muted-foreground">Live2D Studio · v{version}</p>
        </div>
      </header>
      <Updates />
      <details className="about-section">
        <summary>
          常见问题与运行记录
          <ChevronDown aria-hidden="true" />
        </summary>
        <div className="space-y-3 px-1 pb-4 text-xs leading-7 text-muted-foreground">
          <p>黑屏：检查模型是否成功加载，以及 OBS 捕获的窗口。</p>
          <p>无表情：检查跟踪状态并重新校准。</p>
          <p>摄像头不可用：检查系统权限、设备连接与其他应用占用。</p>
          <h2 className="font-semibold text-foreground">本次会话的运行记录</h2>
          {error ? (
            <p role="status">{error}</p>
          ) : events.length ? (
            <ul id="events" className="events">
              {events.map((event, i) => (
                <li key={`${i}:${event}`}>{event}</li>
              ))}
            </ul>
          ) : (
            <p>本次会话暂无错误记录。</p>
          )}
        </div>
      </details>
      <details className="about-section" open>
        <summary>
          开源与第三方许可
          <ChevronDown aria-hidden="true" />
        </summary>
        <div className="pb-4">
          <LicenseNotices />
        </div>
      </details>
    </main>
  );
}

function Updates() {
  const [state, setState] = useState<UpdateState & { autoCheckUpdates: boolean }>({
    ...initialUpdateState,
    autoCheckUpdates: true,
  });
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    void listen<typeof state>('update-state', ({ payload }) => {
      if (!disposed) {
        setState(payload);
        setConnected(true);
        setError('');
      }
    })
      .then(async (release) => {
        if (disposed) return release();
        unlisten = release;
        await emitTo('main', 'about-ready');
      })
      .catch(() => {
        if (!disposed) setError('无法连接工作台，请关闭此窗口后重试。');
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  const act = (action: string | boolean) => {
    setError('');
    void emitTo('main', 'update-action', action).catch(() => setError('操作未发送，请重试。'));
  };
  const busy = ['checking', 'downloading', 'installing'].includes(state.status);
  const downloaded = state.status === 'ready' || state.status === 'installed';
  const labels: Record<UpdateState['status'], string> = {
    idle: '可手动检查新版本',
    checking: '正在检查更新…',
    current: '当前已是最新版本',
    available: `发现新版本 v${state.version}`,
    downloading: `正在下载 v${state.version}…`,
    ready: `v${state.version} 已下载并通过签名校验`,
    installing: '正在安装，请稍候…',
    installed: '更新已安装，等待重启',
  };
  return (
    <details className="about-section" open>
      <summary>
        应用更新
        <ChevronDown aria-hidden="true" />
      </summary>
      <div className="space-y-3 pb-4 text-xs leading-6">
        <p role="status" aria-live="polite">
          {isTauri() ? labels[state.status] : '请在桌面应用中检查和安装更新。'}
        </p>
        {state.status === 'downloading' && (
          <div>
            <progress
              aria-label="更新下载进度"
              className="update-progress"
              value={state.total ? state.received : undefined}
              max={state.total || undefined}
            />
            <p className="text-muted-foreground">
              {(state.received / 1024 / 1024).toFixed(1)} MB
              {state.total ? ` / ${(state.total / 1024 / 1024).toFixed(1)} MB` : ''} ·
              下载期间可继续使用
            </p>
          </div>
        )}
        {(error || state.error) && (
          <p role="alert" className="break-words text-destructive">
            {error || state.error}
          </p>
        )}
        {downloaded && (
          <p className="text-muted-foreground">
            安装会停止跟踪和虚拟摄像头，并重启应用。请先保存动作录制；选择稍后时保持应用打开。
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {state.status === 'available' && (
            <>
              <Button size="sm" onClick={() => act('download')}>
                下载更新
              </Button>
              <Button size="sm" variant="outline" onClick={() => act('ignore')}>
                忽略此版本
              </Button>
            </>
          )}
          {downloaded && (
            <>
              <Button size="sm" onClick={() => act('install')}>
                {state.status === 'installed' ? '重启应用' : '安装并重启'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => act('later')}>
                稍后
              </Button>
            </>
          )}
          {!downloaded && (
            <Button
              size="sm"
              variant="outline"
              disabled={!connected || busy}
              onClick={() => act('check')}
            >
              {state.status === 'checking' ? '检查中…' : '检查更新'}
            </Button>
          )}
        </div>
        <div className="flex items-center justify-between gap-4">
          <label htmlFor="auto-check-updates">
            自动检查更新
            <span className="block text-muted-foreground">
              启动后及运行期间每天检查，下载和安装由你决定。
            </span>
          </label>
          <Switch
            id="auto-check-updates"
            checked={state.autoCheckUpdates}
            disabled={!connected || state.status === 'installing'}
            onCheckedChange={act}
          />
        </div>
        {state.notes && (
          <div>
            <h2 className="font-semibold">更新说明</h2>
            <p className="whitespace-pre-wrap break-words text-muted-foreground">{state.notes}</p>
          </div>
        )}
      </div>
    </details>
  );
}

function LicenseNotices() {
  const [file, setFile] = useState('/licenses/resources.txt');
  const [text, setText] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setText('读取中…');
    void fetch(file, { signal: controller.signal })
      .then(async (response) => {
        if (
          !response.ok ||
          (!file.endsWith('.html') && response.headers.get('content-type')?.includes('text/html'))
        )
          throw new Error('许可文件未包含在当前构建中。');
        let body = await response.text();
        if (file.endsWith('.html')) {
          const document = new DOMParser().parseFromString(body, 'text/html');
          document.querySelectorAll('a').forEach((link) => {
            link.textContent += ` (${link.getAttribute('href')})`;
          });
          body = [...document.querySelectorAll('h1, h2, p, li, pre')]
            .map((element) => element.textContent)
            .join('\n\n');
        }
        setText(body);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setText(error instanceof Error ? error.message : '无法读取许可文件。');
      });
    return () => controller.abort();
  }, [file]);
  return (
    <>
      <Select value={file} onValueChange={(value) => setFile(value)}>
        <SelectTrigger aria-label="许可文件">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="/licenses/vtubeleaf.txt">VTubeLeaf（MIT）</SelectItem>
          <SelectItem value="/licenses/resources.txt">资源来源与许可状态</SelectItem>
          <SelectItem value="/licenses/npm.txt">JavaScript 依赖许可</SelectItem>
          <SelectItem value="/licenses/rust.html">Rust 依赖许可</SelectItem>
          <SelectItem value="/licenses/cubism-framework.md">Cubism Framework</SelectItem>
          <SelectItem value="/runtime/licenses/Core/LICENSE.md">Cubism Core（已配置时）</SelectItem>
          <SelectItem value="/licenses/windows-microsoft.txt">Microsoft BaseClasses</SelectItem>
          <SelectItem value="/licenses/windows-softcam.txt">Softcam BaseClasses</SelectItem>
        </SelectContent>
      </Select>
      <pre aria-label="许可正文" tabIndex={0} className="license-text">
        {text}
      </pre>
    </>
  );
}

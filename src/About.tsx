import { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { ChevronDown } from 'lucide-react';
import { NativeSelect as Select } from './components/ui/native-select';
import { version } from '../package.json';

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
      <Select aria-label="许可文件" value={file} onChange={(event) => setFile(event.target.value)}>
        <option value="/licenses/vtubeleaf.txt">VTubeLeaf（MIT）</option>
        <option value="/licenses/resources.txt">资源来源与许可状态</option>
        <option value="/licenses/npm.txt">JavaScript 依赖许可</option>
        <option value="/licenses/rust.html">Rust 依赖许可</option>
        <option value="/licenses/cubism-framework.md">Cubism Framework</option>
        <option value="/runtime/licenses/Core/LICENSE.md">Cubism Core（已配置时）</option>
        <option value="/licenses/windows-microsoft.txt">Microsoft BaseClasses</option>
        <option value="/licenses/windows-softcam.txt">Softcam BaseClasses</option>
      </Select>
      <pre aria-label="许可正文" tabIndex={0} className="license-text">
        {text}
      </pre>
    </>
  );
}

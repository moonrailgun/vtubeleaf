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
import { localNotes, parseNotes } from './changelog';
import { Notes, ReleaseList, releases } from './ReleaseNotes';
import { lang, t, type Key } from './i18n.ts';

export function About() {
  const [events, setEvents] = useState<string[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    const previousTitle = document.title;
    document.title = t('about.windowTitle');
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
      if (!disposed) setError(t('about.eventsError'));
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
          {t('about.releaseNotes')}
          <ChevronDown aria-hidden="true" />
        </summary>
        <div className="pb-4 text-xs leading-6">
          <ReleaseList list={releases} current={version} />
        </div>
      </details>
      <details className="about-section">
        <summary>
          {t('about.faqAndLog')}
          <ChevronDown aria-hidden="true" />
        </summary>
        <div className="space-y-3 px-1 pb-4 text-xs leading-7 text-muted-foreground">
          <p>
            <b className="font-semibold text-foreground">{t('about.privacyTitle')}</b>
            {t('about.privacyBody')}
          </p>
          <p>{t('about.faqBlackScreen')}</p>
          <p>{t('about.faqNoExpression')}</p>
          <p>{t('about.faqCamera')}</p>
          <h2 className="font-semibold text-foreground">{t('about.sessionLog')}</h2>
          {error ? (
            <p role="status">{error}</p>
          ) : events.length ? (
            <ul id="events" className="events">
              {events.map((event, i) => (
                <li key={`${i}:${event}`}>{event}</li>
              ))}
            </ul>
          ) : (
            <p>{t('about.noEvents')}</p>
          )}
        </div>
      </details>
      <details className="about-section" open>
        <summary>
          {t('about.licenses')}
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
        if (!disposed) setError(t('about.connectError'));
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  const act = (action: string | boolean) => {
    setError('');
    void emitTo('main', 'update-action', action).catch(() => setError(t('about.actionError')));
  };
  const busy = ['checking', 'downloading', 'installing'].includes(state.status);
  const downloaded = state.status === 'ready' || state.status === 'installed';
  const labels: Record<UpdateState['status'], Key> = {
    idle: 'about.statusIdle',
    checking: 'about.statusChecking',
    current: 'about.statusCurrent',
    available: 'about.statusAvailable',
    downloading: 'about.statusDownloading',
    ready: 'about.statusReady',
    installing: 'about.statusInstalling',
    installed: 'about.statusInstalled',
  };
  return (
    <details className="about-section" open>
      <summary>
        {t('about.updates')}
        <ChevronDown aria-hidden="true" />
      </summary>
      <div className="space-y-3 pb-4 text-xs leading-6">
        <p role="status" aria-live="polite">
          {isTauri() ? t(labels[state.status], { version: state.version }) : t('about.desktopOnly')}
        </p>
        {state.status === 'downloading' && (
          <div>
            <progress
              aria-label={t('about.downloadProgress')}
              className="update-progress"
              value={state.total ? state.received : undefined}
              max={state.total || undefined}
            />
            <p className="text-muted-foreground">
              {(state.received / 1024 / 1024).toFixed(1)} MB
              {state.total ? ` / ${(state.total / 1024 / 1024).toFixed(1)} MB` : ''} ·{' '}
              {t('about.keepUsing')}
            </p>
          </div>
        )}
        {(error || state.error) && (
          <p role="alert" className="break-words text-destructive">
            {error || state.error}
          </p>
        )}
        {downloaded && <p className="text-muted-foreground">{t('about.installWarning')}</p>}
        <div className="flex flex-wrap gap-2">
          {state.status === 'available' && (
            <>
              <Button size="sm" onClick={() => act('download')}>
                {t('about.downloadUpdate')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => act('ignore')}>
                {t('about.skipVersion')}
              </Button>
            </>
          )}
          {downloaded && (
            <>
              <Button size="sm" onClick={() => act('install')}>
                {state.status === 'installed'
                  ? t('about.restartApp')
                  : t('about.installAndRestart')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => act('later')}>
                {t('about.later')}
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
              {state.status === 'checking' ? t('about.checking') : t('about.checkUpdates')}
            </Button>
          )}
        </div>
        <div className="flex items-center justify-between gap-4">
          <label htmlFor="auto-check-updates">
            {t('about.autoCheck')}
            <span className="block text-muted-foreground">{t('about.autoCheckHint')}</span>
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
            <h2 className="font-semibold">{t('about.notesTitle', { version: state.version })}</h2>
            <div className="mt-1 break-words text-muted-foreground">
              <Notes groups={parseNotes(localNotes(state.notes, lang))} />
            </div>
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
    setText(t('about.loading'));
    void fetch(file, { signal: controller.signal })
      .then(async (response) => {
        if (
          !response.ok ||
          (!file.endsWith('.html') && response.headers.get('content-type')?.includes('text/html'))
        )
          throw new Error(t('about.licenseMissing'));
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
          setText(error instanceof Error ? error.message : t('about.licenseReadError'));
      });
    return () => controller.abort();
  }, [file]);
  return (
    <>
      <Select value={file} onValueChange={(value) => setFile(value)}>
        <SelectTrigger aria-label={t('about.licenseFile')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="/licenses/vtubeleaf.txt">{t('about.licenseApp')}</SelectItem>
          <SelectItem value="/licenses/resources.txt">{t('about.licenseResources')}</SelectItem>
          <SelectItem value="/licenses/npm.txt">{t('about.licenseNpm')}</SelectItem>
          <SelectItem value="/licenses/rust.html">{t('about.licenseRust')}</SelectItem>
          <SelectItem value="/licenses/cubism-framework.md">Cubism Framework</SelectItem>
          <SelectItem value="/runtime/licenses/Core/LICENSE.md">
            {t('about.licenseCubismCore')}
          </SelectItem>
          <SelectItem value="/licenses/windows-microsoft.txt">Microsoft BaseClasses</SelectItem>
          <SelectItem value="/licenses/windows-softcam.txt">Softcam BaseClasses</SelectItem>
          <SelectItem value="/licenses/macos-syphon.txt">Syphon</SelectItem>
          <SelectItem value="/licenses/windows-spout.txt">Spout2</SelectItem>
        </SelectContent>
      </Select>
      <pre aria-label={t('about.licenseText')} tabIndex={0} className="license-text">
        {text}
      </pre>
    </>
  );
}

import { useEffect, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { Download } from 'lucide-react';
import { Button } from './components/ui/button';
import { loadLatestRelease } from '../website/src/release';

const platforms = {
  'windows-x86_64': 'Windows x64',
  'darwin-aarch64': 'macOS Apple Silicon',
  'darwin-x86_64': 'macOS Intel',
};

export function OpenSeeFaceDownload() {
  const [platform, setPlatform] = useState<keyof typeof platforms>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const label = platform && platforms[platform];

  useEffect(() => {
    if (!isTauri()) return;
    invoke<keyof typeof platforms>('get_download_platform')
      .then(setPlatform)
      .catch(() => setError('无法识别当前架构，请去到下载页选择启动包。'));
  }, []);

  async function download(url: string) {
    setError('');
    try {
      if (isTauri()) await invoke('open_release_url', { url });
      else window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      setError(`无法打开下载链接：${String(error)}`);
    }
  }

  async function downloadCurrent() {
    if (!platform || !label) return;
    setLoading(true);
    setError('');
    try {
      const release = await loadLatestRelease();
      const url = release.openseeface?.[platform];
      if (!url) throw new Error('Missing OpenSeeFace download');
      await download(url);
    } catch {
      setError('暂时无法获取下载信息，请重试或去到下载页。');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="my-2 flex gap-2">
        <Button
          className="flex-1 px-2 text-xs has-[>svg]:px-2"
          disabled={!label || loading}
          onClick={() => void downloadCurrent()}
        >
          <Download aria-hidden="true" />
          {loading ? '正在获取最新版…' : label ? `下载 ${label} 版` : '下载当前架构版本'}
        </Button>
        <Button
          variant="outline"
          className="px-2 text-xs"
          onClick={() => void download('https://github.com/moonrailgun/vtubeleaf/releases/latest')}
        >
          去到下载页
        </Button>
      </div>
      {error && (
        <p className="hint" role="status">
          {error}
        </p>
      )}
    </>
  );
}

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { loadLatestRelease } from './release';

declare const __RELEASE__: Awaited<ReturnType<typeof loadLatestRelease>>;

type Platform = 'win' | 'mac';
function initialPlatform(): Platform {
  try {
    const saved = localStorage.getItem('vtl.tab');
    if (saved === 'tab-win' || saved === 'tab-mac') return saved === 'tab-mac' ? 'mac' : 'win';
  } catch {
    // Storage can be disabled in private browsing.
  }
  return /Mac|iPhone|iPad/.test(navigator.platform) ? 'mac' : 'win';
}

export default function App() {
  const [release, setRelease] = useState(__RELEASE__);
  useEffect(() => {
    let active = true;
    loadLatestRelease()
      .then((latest) => {
        if (active) setRelease(latest);
      })
      .catch(() => {
        // Keep the prerendered downloads when the release manifest is unavailable or invalid.
      });
    return () => {
      active = false;
    };
  }, []);
  const [model, setModel] = useState(0);
  const [switches, setSwitches] = useState([true, true, true, false]);
  const [amplitude, setAmplitude] = useState(70);
  const [speed, setSpeed] = useState(2);
  const [platform, setPlatform] = useState<Platform>('win');
  useEffect(() => setPlatform(initialPlatform()), []);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  function selectPlatform(next: Platform) {
    setPlatform(next);
    try {
      localStorage.setItem('vtl.tab', `tab-${next}`);
    } catch {
      // Keep selection usable when storage is unavailable.
    }
  }
  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? 1
          : event.key === 'ArrowLeft' || event.key === 'ArrowRight'
            ? 1 - index
            : null;
    if (next === null) return;
    event.preventDefault();
    selectPlatform(next === 0 ? 'win' : 'mac');
    tabs.current[next]?.focus();
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'SoftwareApplication',
            name: 'VTubeLeaf',
            url: 'https://vtubeleaf.vercel.app/',
            image: 'https://vtubeleaf.vercel.app/assets/brand/logo.png',
            description: '免费的 Live2D 虚拟形象桌面应用，使用普通摄像头进行本地面部与手势追踪。',
            applicationCategory: 'MultimediaApplication',
            operatingSystem:
              'Windows 10 or later (x64), macOS 14 or later (Apple Silicon and Intel)',
            softwareVersion: release.version,
            downloadUrl: [release.windows, release.mac],
            releaseNotes: release.url,
            offers: { '@type': 'Offer', price: '0', priceCurrency: 'CNY' },
          }).replace(/</g, '\\u003c'),
        }}
      />
      <a href="#content" className="skip">
        跳到正文
      </a>
      <header className="topnav" data-od-id="topnav">
        <div className="wrap">
          <a className="brand" href="#" aria-label="VTubeLeaf 首页" data-od-id="brand-lockup">
            <img src="assets/brand/lockup-rose.svg" alt="VTubeLeaf" />
          </a>
          <ul className="nav-links">
            <li>
              <a href="#scenes">能做什么</a>
            </li>
            <li>
              <a href="#features">功能</a>
            </li>
            <li>
              <a href="#install">安装</a>
            </li>
            <li>
              <a href="#compare">对比</a>
            </li>
            <li>
              <a href="#faq">常见问题</a>
            </li>
          </ul>
          <a className="nav-dl" href="#install" data-od-id="nav-download">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"></path>
            </svg>
            免费下载
          </a>
        </div>
      </header>

      <main id="content" tabIndex={-1}>
        <section className="hero" data-od-id="hero" style={{ paddingBottom: '0' }}>
          <div className="wrap">
            <p className="eyebrow">免费 · 无水印 · 全部在你的电脑上运行</p>
            <h1 data-od-id="hero-title">
              让你的 Live2D 角色，<em>替你出镜。</em>
            </h1>
            <p className="lede" style={{ marginTop: '22px' }}>
              一颗普通摄像头，就能让你的虚拟形象跟着你眨眼、说话、转头。直播、开会、录视频、上网课——想不露脸的时候，就让角色上场。
            </p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="#install" data-od-id="hero-cta">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"></path>
                </svg>
                免费下载
              </a>
              <a className="btn btn-ghost" href="#scenes" data-od-id="hero-secondary">
                看看能做什么
              </a>
            </div>
            <p className="hero-note">
              支持 Windows 10 及以上、macOS 14 及以上 · 当前版本 {release.version}
            </p>

            <div
              className="app"
              role="region"
              aria-label="VTubeLeaf 应用界面示意：左侧角色库，中间舞台显示你的 Live2D 角色，右上角为摄像头面部捕捉预览，右侧为设置面板"
              data-od-id="hero-app-mock"
            >
              <div className="app-title">
                <div className="lights" aria-hidden="true">
                  <i></i>
                  <i></i>
                  <i></i>
                </div>
                <span className="name">VTubeLeaf</span>
                <div className="tool" aria-hidden="true">
                  <span className="chip on">摄像头已连接</span>
                  <span className="chip">正在输出到会议</span>
                </div>
              </div>
              <div className="app-body">
                <aside className="pane">
                  <h4>我的角色</h4>
                  <button
                    className={`model-card${model === 0 ? ' active' : ''}`}
                    type="button"
                    aria-pressed={model === 0}
                    onClick={() => setModel(0)}
                  >
                    <span className="model-thumb">
                      <img src="assets/brand/mark-rose.svg" alt="" />
                    </span>
                    <span>
                      <b>小叶</b>
                      <span>上次使用 · 今天</span>
                    </span>
                  </button>
                  <button
                    className={`model-card${model === 1 ? ' active' : ''}`}
                    type="button"
                    aria-pressed={model === 1}
                    onClick={() => setModel(1)}
                  >
                    <span className="model-thumb">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="12" cy="8" r="4"></circle>
                        <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"></path>
                      </svg>
                    </span>
                    <span>
                      <b>会议专用</b>
                      <span>正装 · 白底</span>
                    </span>
                  </button>
                  <button
                    className={`model-card${model === 2 ? ' active' : ''}`}
                    type="button"
                    aria-pressed={model === 2}
                    onClick={() => setModel(2)}
                  >
                    <span className="model-thumb">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 3l2.5 5.5L20 9l-4 4 1 6-5-2.7L7 19l1-6-4-4 5.5-.5z"></path>
                      </svg>
                    </span>
                    <span>
                      <b>直播主形象</b>
                      <span>带头饰</span>
                    </span>
                  </button>
                  <p
                    style={{
                      marginTop: '18px',
                      fontSize: '12px',
                      color: 'var(--muted)',
                      lineHeight: '1.5',
                    }}
                  >
                    把角色文件夹拖进来，就会出现在这里。
                  </p>
                </aside>
                <div className="stage">
                  <div className="stage-grid" aria-hidden="true"></div>
                  <div className="avatar">
                    <img src="assets/brand/mark-rose.svg" alt="" id="avatarImg" />
                    <span className="avatar-cap" id="avatarCap" aria-live="polite">
                      此处显示你的 Live2D 角色 · {['小叶', '会议专用', '直播主形象'][model]}
                    </span>
                  </div>
                  <div className="cam" aria-hidden="true">
                    <svg viewBox="0 0 172 118" fill="none">
                      <rect width="172" height="118" fill="oklch(0.27 0.025 305)"></rect>
                      <ellipse
                        cx="86"
                        cy="60"
                        rx="30"
                        ry="38"
                        stroke="oklch(0.80 0.10 355)"
                        strokeWidth="1.2"
                        strokeDasharray="3 3"
                        opacity=".7"
                      ></ellipse>
                      <g fill="oklch(0.80 0.10 355)">
                        <circle cx="74" cy="52" r="1.6"></circle>
                        <circle cx="80" cy="50" r="1.6"></circle>
                        <circle cx="86" cy="51" r="1.6"></circle>
                        <circle cx="92" cy="50" r="1.6"></circle>
                        <circle cx="98" cy="52" r="1.6"></circle>
                        <circle cx="86" cy="62" r="1.6"></circle>
                        <circle cx="86" cy="68" r="1.6"></circle>
                        <circle cx="76" cy="78" r="1.6"></circle>
                        <circle cx="82" cy="81" r="1.6"></circle>
                        <circle cx="86" cy="82" r="1.6"></circle>
                        <circle cx="90" cy="81" r="1.6"></circle>
                        <circle cx="96" cy="78" r="1.6"></circle>
                        <circle cx="58" cy="60" r="1.6"></circle>
                        <circle cx="114" cy="60" r="1.6"></circle>
                        <circle cx="62" cy="76" r="1.6"></circle>
                        <circle cx="110" cy="76" r="1.6"></circle>
                        <circle cx="86" cy="24" r="1.6"></circle>
                        <circle cx="70" cy="28" r="1.6"></circle>
                        <circle cx="102" cy="28" r="1.6"></circle>
                      </g>
                      <path
                        d="M70 52 L98 52 M86 51 L86 68 M76 78 Q86 86 96 78"
                        stroke="oklch(0.80 0.10 355)"
                        strokeWidth="1"
                        opacity=".6"
                      ></path>
                    </svg>
                    <span className="tag">摄像头预览 · 只在本机</span>
                  </div>
                  <div className="statusbar" aria-hidden="true">
                    <span>眨眼</span>
                    <span>口型</span>
                    <span>头部转动</span>
                    <span>手势</span>
                  </div>
                </div>
                <aside className="pane">
                  <h4>设置</h4>
                  <div className="row">
                    <span>跟着我眨眼</span>
                    <button
                      className="switch"
                      type="button"
                      role="switch"
                      aria-checked={switches[0]}
                      aria-label="跟着我眨眼"
                      onClick={() =>
                        setSwitches((current) =>
                          current.map((value, index) => (index === 0 ? !value : value)),
                        )
                      }
                    ></button>
                  </div>
                  <div className="row">
                    <span>说话时动嘴</span>
                    <button
                      className="switch"
                      type="button"
                      role="switch"
                      aria-checked={switches[1]}
                      aria-label="说话时动嘴"
                      onClick={() =>
                        setSwitches((current) =>
                          current.map((value, index) => (index === 1 ? !value : value)),
                        )
                      }
                    ></button>
                  </div>
                  <div className="row">
                    <span>识别手势</span>
                    <button
                      className="switch"
                      type="button"
                      role="switch"
                      aria-checked={switches[2]}
                      aria-label="识别手势"
                      onClick={() =>
                        setSwitches((current) =>
                          current.map((value, index) => (index === 2 ? !value : value)),
                        )
                      }
                    ></button>
                  </div>
                  <div className="row">
                    <span>安静时轻微呼吸</span>
                    <button
                      className="switch"
                      type="button"
                      role="switch"
                      aria-checked={switches[3]}
                      aria-label="安静时轻微呼吸"
                      onClick={() =>
                        setSwitches((current) =>
                          current.map((value, index) => (index === 3 ? !value : value)),
                        )
                      }
                    ></button>
                  </div>
                  <div className="slider">
                    <label htmlFor="ampRange">
                      动作幅度
                      <span className="mono" id="ampVal">
                        {amplitude}%
                      </span>
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={amplitude}
                      onChange={(event) => setAmplitude(Number(event.target.value))}
                      id="ampRange"
                      aria-label="动作幅度"
                    />
                  </div>
                  <div className="slider">
                    <label htmlFor="spdRange">
                      反应速度
                      <span className="mono" id="spdVal">
                        {['慢', '中', '快'][speed]}
                      </span>
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="2"
                      value={speed}
                      onChange={(event) => setSpeed(Number(event.target.value))}
                      id="spdRange"
                      aria-label="反应速度"
                    />
                  </div>
                  <div className="row" style={{ marginTop: '8px' }}>
                    <span style={{ color: 'var(--muted)' }}>背景</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '12px' }}>纯色 · 可抠</span>
                  </div>
                </aside>
              </div>
            </div>
          </div>
        </section>

        <section id="scenes" data-od-id="scenes">
          <div className="wrap">
            <div className="section-head">
              <p className="eyebrow">能做什么</p>
              <h2>
                凡是需要露脸的地方，
                <br />
                都可以换成你的角色。
              </h2>
              <p>
                VTubeLeaf 把你的表情实时映射到 Live2D 角色上，再把画面送到你正在用的任何软件里。
              </p>
            </div>
            <div className="scenes">
              <article className="scene" data-od-id="scene-live">
                <div className="ico">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="2.5"></circle>
                    <path d="M7.8 7.8a6 6 0 000 8.4M16.2 7.8a6 6 0 010 8.4M5 5a10 10 0 000 14M19 5a10 10 0 010 14"></path>
                  </svg>
                </div>
                <h3>直播</h3>
                <p>把角色当作一个摄像头画面加进直播软件，配上你喜欢的背景与挂件，就能开播。</p>
                <p className="with">常搭配：OBS、B 站直播姬</p>
              </article>
              <article className="scene" data-od-id="scene-meeting">
                <div className="ico">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="3" y="6" width="13" height="12" rx="2"></rect>
                    <path d="M16 10l5-3v10l-5-3"></path>
                  </svg>
                </div>
                <h3>视频会议</h3>
                <p>在会议软件里选择「VTubeLeaf 摄像头」，不化妆、不整理房间也能开着视频参会。</p>
                <p className="with">常搭配：飞书、腾讯会议、Zoom</p>
              </article>
              <article className="scene" data-od-id="scene-record">
                <div className="ico">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="9"></circle>
                    <circle cx="12" cy="12" r="3.5" fill="currentColor"></circle>
                  </svg>
                </div>
                <h3>录制视频</h3>
                <p>录教程、做解说、剪短视频。角色画面用纯色背景，后期抠掉很方便。</p>
                <p className="with">常搭配：剪映、Final Cut</p>
              </article>
              <article className="scene" data-od-id="scene-class">
                <div className="ico">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M2 9l10-5 10 5-10 5z"></path>
                    <path d="M6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5M22 9v6"></path>
                  </svg>
                </div>
                <h3>网课与线上分享</h3>
                <p>老师、讲师、社群分享者：让角色替你讲，观众看得更专注，你也更轻松。</p>
                <p className="with">常搭配：钉钉、Teams、腾讯课堂</p>
              </article>
            </div>
          </div>
        </section>

        <section id="features" className="alt" data-od-id="features">
          <div className="wrap">
            <div className="section-head">
              <p className="eyebrow">功能</p>
              <h2>你只管说话，角色会跟上。</h2>
              <p>不需要额外设备，也不用学新东西。打开应用、选一个角色，就可以开始了。</p>
            </div>
            <div className="features">
              <article className="feature" data-od-id="feature-face">
                <p className="num">01</p>
                <h3>面部跟随</h3>
                <p>眨眼、转头、张嘴、挑眉——摄像头看到什么，角色就做什么，延迟低到几乎察觉不到。</p>
              </article>
              <article className="feature" data-od-id="feature-lipsync">
                <p className="num">02</p>
                <h3>说话时自然动嘴</h3>
                <p>口型跟着你的声音变化，配合面部识别一起判断，不会出现你不说话它却在动的情况。</p>
              </article>
              <article className="feature" data-od-id="feature-hands">
                <p className="num">03</p>
                <h3>手势识别</h3>
                <p>比个心、挥个手，角色也能跟着做。只靠摄像头完成，不需要手柄或体感设备。</p>
              </article>
              <article className="feature" data-od-id="feature-library">
                <p className="num">04</p>
                <h3>角色库</h3>
                <p>把多个角色放在一起，直播用一个、开会用另一个，点一下就能切换。</p>
              </article>
              <article className="feature" data-od-id="feature-tuning">
                <p className="num">05</p>
                <h3>幅度与灵敏度可调</h3>
                <p>
                  觉得动作太大或太小？拖一下滑块就好。设置会自动记住，下次打开还是你习惯的样子。
                </p>
              </article>
              <article className="feature" data-od-id="feature-import">
                <p className="num">06</p>
                <h3>沿用你在 VTube Studio 里的设置</h3>
                <p>已经在别的软件里调好了角色？直接把它连同设置一起搬进来，不用重新调一遍。</p>
              </article>
            </div>
          </div>
        </section>

        <section id="how" data-od-id="how-it-works">
          <div className="wrap">
            <div className="section-head">
              <p className="eyebrow">三步开始</p>
              <h2>从安装到上镜，几分钟的事。</h2>
            </div>
            <div className="steps">
              <article className="step" data-od-id="step-install">
                <h3>安装并打开</h3>
                <p>下载对应系统的安装包，像装其他软件一样双击安装。首次打开时允许使用摄像头。</p>
              </article>
              <article className="step" data-od-id="step-model">
                <h3>放入你的角色</h3>
                <p>把 Live2D 角色文件夹拖到应用窗口里，角色就会站上舞台并开始跟着你动。</p>
              </article>
              <article className="step" data-od-id="step-use">
                <h3>在其他软件里选它</h3>
                <p>
                  在「接入」中安装并启动虚拟摄像头，再到直播、会议或录屏软件里选择 VTubeLeaf
                  Camera。
                </p>
              </article>
            </div>
          </div>
        </section>

        <section id="install" className="alt" data-od-id="install">
          <div className="wrap split">
            <div>
              <p className="eyebrow">安装</p>
              <h2 style={{ fontSize: 'clamp(30px,3.6vw,44px)' }}>选择你的系统</h2>
              <p style={{ marginTop: '14px', color: 'var(--muted)', fontSize: '17px' }}>
                最新稳定版 v{release.version}，两个系统都免费。
              </p>
              <div className="download-actions">
                {(platform === 'mac' ? ['mac', 'win'] : ['win', 'mac']).map((system) => (
                  <a
                    key={system}
                    className={`btn ${system === platform ? 'btn-primary' : 'btn-ghost'}`}
                    href={system === 'mac' ? release.mac : release.windows}
                  >
                    下载 {system === 'mac' ? 'macOS' : 'Windows'} 版
                  </a>
                ))}
              </div>
              <p className="download-note">Windows x64 · macOS 通用版（Apple Silicon / Intel）</p>
              <p className="download-note">
                <a href={release.url}>更新说明与全部安装包</a>
              </p>
              <div
                className="tabs"
                role="tablist"
                aria-label="选择操作系统"
                data-od-id="install-tabs"
              >
                <button
                  className="tab"
                  role="tab"
                  id="tab-win"
                  aria-selected={platform === 'win'}
                  aria-controls="panel-win"
                  tabIndex={platform === 'win' ? 0 : -1}
                  ref={(element) => {
                    tabs.current[0] = element;
                  }}
                  onClick={() => selectPlatform('win')}
                  onKeyDown={(event) => navigateTabs(event, 0)}
                  type="button"
                >
                  Windows
                </button>
                <button
                  className="tab"
                  role="tab"
                  id="tab-mac"
                  aria-selected={platform === 'mac'}
                  aria-controls="panel-mac"
                  tabIndex={platform === 'mac' ? 0 : -1}
                  ref={(element) => {
                    tabs.current[1] = element;
                  }}
                  onClick={() => selectPlatform('mac')}
                  onKeyDown={(event) => navigateTabs(event, 1)}
                  type="button"
                >
                  macOS
                </button>
              </div>
              <div
                className={`panel${platform === 'win' ? ' show' : ''}`}
                id="panel-win"
                role="tabpanel"
                aria-labelledby="tab-win"
                hidden={platform !== 'win'}
                tabIndex={0}
              >
                <ol>
                  <li>
                    <b>下载 Windows 安装包</b>并运行，按提示完成安装。需要 Windows 10 或更新版本的
                    x64 系统。
                  </li>
                  <li>首次打开时，点击「允许」让应用使用摄像头。</li>
                  <li>在应用的「接入」页面点击「安装虚拟摄像头」，再点击「启动虚拟摄像头」。</li>
                  <li>重新打开会议或直播软件的摄像头列表，选择「VTubeLeaf Camera」。</li>
                </ol>
                <p className="hint">
                  已内置虚拟摄像头，无需安装 OBS。支持使用 DirectShow 的桌面客户端；
                  若目标软件无法识别，也可通过 OBS 输出。
                </p>
              </div>
              <div
                className={`panel${platform === 'mac' ? ' show' : ''}`}
                id="panel-mac"
                role="tabpanel"
                aria-labelledby="tab-mac"
                hidden={platform !== 'mac'}
                tabIndex={0}
              >
                <ol>
                  <li>
                    <b>下载安装包</b>，打开后把 VTubeLeaf 拖进「应用程序」文件夹。需要 macOS 14
                    或更新版本。
                  </li>
                  <li>首次打开时，在系统弹窗中允许使用摄像头。</li>
                  <li>在「接入」中安装虚拟摄像头，按应用提示到系统设置批准摄像头扩展。</li>
                  <li>回到应用启动虚拟摄像头，再到会议或直播软件中选择「VTubeLeaf Camera」。</li>
                </ol>
                <p className="hint">
                  macOS 15 及以上：系统设置 → 通用 → 登录项与扩展 → 摄像头扩展。 macOS 14：系统设置
                  → 隐私与安全性。启用 VTubeLeaf 后按应用提示继续。
                </p>
              </div>
            </div>
            <aside className="req" data-od-id="install-requirements">
              <h3 style={{ fontSize: '22px', marginBottom: '8px' }}>你需要准备</h3>
              <ul>
                <li>
                  <span className="dot">1</span>
                  <div>
                    <b>一台电脑和一颗摄像头</b>
                    <span>笔记本自带的摄像头就够用，不需要额外设备。</span>
                  </div>
                </li>
                <li>
                  <span className="dot">2</span>
                  <div>
                    <b>一个 Live2D 角色</b>
                    <span>内置 Haru、Hiyori、Mao 示例角色，也可导入自己已获得使用授权的角色。</span>
                  </div>
                </li>
                <li>
                  <span className="dot">3</span>
                  <div>
                    <b>光线正常的环境</b>
                    <span>正面有光、脸部清晰，跟随会更稳定。</span>
                  </div>
                </li>
              </ul>
              <p className="req-note">
                可以先用内置示例体验。直播或商业使用前，请查看对应模型的授权； 也可在 Live2D
                角色商店与创作者社区寻找适合自己的角色。
              </p>
            </aside>
          </div>
        </section>

        <section
          data-od-id="facts"
          style={{ paddingTop: '0', paddingBottom: '0', background: 'var(--surface)' }}
        >
          <div className="wrap">
            <div className="facts">
              <div className="fact" data-od-id="fact-price">
                <p className="v">¥0</p>
                <p className="k">永久免费，没有付费解锁、没有水印</p>
              </div>
              <div className="fact" data-od-id="fact-local">
                <p className="v">
                  100<small>%</small>
                </p>
                <p className="k">在你的电脑上运行，摄像头画面不上传</p>
              </div>
              <div className="fact" data-od-id="fact-devices">
                <p className="v">0</p>
                <p className="k">额外设备，一颗普通摄像头即可</p>
              </div>
              <div className="fact" data-od-id="fact-os">
                <p className="v">2</p>
                <p className="k">支持的系统：Windows 与 macOS</p>
              </div>
            </div>
          </div>
        </section>

        <section id="compare" data-od-id="compare">
          <div className="wrap">
            <div className="section-head">
              <p className="eyebrow">对比</p>
              <h2>和常见的同类应用比一比。</h2>
              <p>
                这些都是不错的应用，各有侧重。如果你想要一个免费、没有水印、也不上传画面的 Live2D
                工具，VTubeLeaf 是最直接的选择。
              </p>
            </div>
            <div className="cmp-wrap" role="region" aria-label="同类应用功能对比" tabIndex={0}>
              <table className="cmp" data-od-id="compare-table">
                <thead>
                  <tr>
                    <th scope="col">
                      <span style={{ opacity: '0' }}>项目</span>
                    </th>
                    <th scope="col" className="me">
                      VTubeLeaf<small>开源项目</small>
                    </th>
                    <th scope="col">
                      VTube Studio<small>Denchi</small>
                    </th>
                    <th scope="col">
                      nizima LIVE<small>Live2D Inc.</small>
                    </th>
                    <th scope="col">
                      Animaze<small>Holotech Studios</small>
                    </th>
                    <th scope="col">
                      VSeeFace<small>Emiliana</small>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">价格</th>
                    <td className="me">
                      免费<span className="sub">全部功能，无付费项</span>
                    </td>
                    <td>
                      免费<span className="sub">去水印需一次性购买 $14.99</span>
                    </td>
                    <td>
                      有免费版<span className="sub">个人订阅 550 日元 / 月</span>
                    </td>
                    <td>
                      有免费版<span className="sub">Plus 订阅 $19.99 / 年</span>
                    </td>
                    <td>免费</td>
                  </tr>
                  <tr>
                    <th scope="row">免费版有没有限制</th>
                    <td className="me">
                      <span className="yes">无水印、无时长限制</span>
                    </td>
                    <td>有水印</td>
                    <td>
                      有水印<span className="sub">摄像头连续使用限 40 分钟</span>
                    </td>
                    <td>
                      有水印<span className="sub">60 帧与视频导出需付费</span>
                    </td>
                    <td>
                      <span className="yes">无限制</span>
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Live2D 角色</th>
                    <td className="me">
                      <span className="yes">支持</span>
                    </td>
                    <td>
                      <span className="yes">支持</span>
                    </td>
                    <td>
                      <span className="yes">支持</span>
                    </td>
                    <td>
                      <span className="yes">支持</span>
                    </td>
                    <td>
                      <span className="no">不支持</span>
                      <span className="sub">仅 3D 角色</span>
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">3D 角色</th>
                    <td className="me">
                      <span className="no">不支持</span>
                    </td>
                    <td>
                      <span className="no">不支持</span>
                    </td>
                    <td>
                      <span className="no">不支持</span>
                      <span className="sub">仅 Live2D 角色</span>
                    </td>
                    <td>
                      <span className="yes">支持</span>
                    </td>
                    <td>
                      <span className="yes">支持</span>
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">支持的系统</th>
                    <td className="me">Windows、macOS</td>
                    <td>Windows、macOS</td>
                    <td>Windows、macOS</td>
                    <td>仅 Windows</td>
                    <td>仅 Windows</td>
                  </tr>
                  <tr>
                    <th scope="row">手势识别</th>
                    <td className="me">
                      <span className="yes">支持</span>
                      <span className="sub">只用摄像头</span>
                    </td>
                    <td>
                      <span className="yes">支持</span>
                    </td>
                    <td>
                      <span className="yes">支持</span>
                      <span className="sub">只用摄像头</span>
                    </td>
                    <td>
                      <span className="yes">支持</span>
                    </td>
                    <td>
                      需要额外设备<span className="sub">Leap Motion 手部追踪器</span>
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">在会议软件里当摄像头</th>
                    <td className="me">
                      <span className="yes">内置</span>
                      <span className="sub">Windows / macOS，首次使用需安装或激活</span>
                    </td>
                    <td>需配合 OBS</td>
                    <td>需配合 OBS 插件</td>
                    <td>
                      <span className="yes">内置</span>
                    </td>
                    <td>
                      <span className="yes">内置</span>
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">开放源代码</th>
                    <td className="me">
                      <span className="yes">是</span>
                      <span className="sub">任何人都可以查看、检查它做了什么</span>
                    </td>
                    <td>
                      <span className="no">否</span>
                    </td>
                    <td>
                      <span className="no">否</span>
                    </td>
                    <td>
                      <span className="no">否</span>
                    </td>
                    <td>
                      部分开源
                      <span className="sub">面部追踪与角色动画代码公开，软件本体不公开</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="cmp-note">
              以上信息于 2026 年 9 月核对自各应用官网与 Steam
              页面，价格以当时页面标示为准，可能随时间变化。「开放源代码」一项以各应用官方说明为准。如有错漏，欢迎
              <a href="https://github.com/moonrailgun/vtubeleaf/issues">告诉我们</a>。
            </p>
          </div>
        </section>

        <section id="faq" className="alt" data-od-id="faq">
          <div className="wrap">
            <div className="section-head">
              <p className="eyebrow">常见问题</p>
              <h2>开始之前，你可能想知道</h2>
            </div>
            <div className="faq" data-od-id="faq-list">
              <details name="faq" open>
                <summary>我需要买什么设备吗？</summary>
                <div className="a">
                  不需要。笔记本自带的摄像头，或任何一颗普通 USB
                  摄像头都可以。手势识别也只靠摄像头完成，不需要手柄、体感设备或 iPhone。
                </div>
              </details>
              <details name="faq">
                <summary>我的摄像头画面会被上传吗？</summary>
                <div className="a">
                  不会。所有识别都在你自己的电脑上完成，应用不连接任何服务器，也不收集使用数据。如果你在意隐私，还可以去查看它的全部源代码。
                </div>
              </details>
              <details name="faq">
                <summary>我没有 Live2D 角色，怎么办？</summary>
                <div className="a">
                  可以先使用内置的 Haru、Hiyori、Mao
                  官方示例角色。你也可以委托画师与建模师制作，或在 Live2D
                  角色商店或创作者社区购买、下载成品。使用前请留意角色的授权范围，尤其是用于直播或商业用途时。
                </div>
              </details>
              <details name="faq">
                <summary>我已经在 VTube Studio 里把角色调好了，能直接用吗？</summary>
                <div className="a">
                  可以。把角色文件夹拖进
                  VTubeLeaf，它会读取你原来的设置，包括表情映射和参数范围，不需要重新调一遍。
                </div>
              </details>
              <details name="faq">
                <summary>会在会议软件里被别人看出是虚拟形象吗？</summary>
                <div className="a">
                  会——这正是它的用途。角色会以清晰的动画形象出现在你的视频窗口里，对方看到的是一个跟着你眨眼、说话的角色，而不是伪装成真人的画面。
                </div>
              </details>
              <details name="faq">
                <summary>真的完全免费？以后会收费吗？</summary>
                <div className="a">
                  是的。VTubeLeaf 是开源项目，没有付费版、订阅或水印解锁。它的代码公开在 GitHub
                  上，任何人都可以免费使用和修改。
                </div>
              </details>
            </div>
          </div>
        </section>

        <section data-od-id="cta" style={{ paddingBottom: '40px' }}>
          <div className="wrap">
            <div className="cta">
              <div>
                <div className="brand-dark">
                  <img src="assets/brand/lockup-rose-dark.svg" alt="VTubeLeaf" />
                </div>
                <p className="eyebrow">现在就试试</p>
                <h2>
                  下一次开视频，
                  <br />
                  换你的角色上场。
                </h2>
                <p>下载只需几分钟，不注册、不付费、不留水印。</p>
                <a className="btn btn-primary" href="#install" data-od-id="cta-download">
                  免费下载
                </a>
              </div>
              <div className="promise" data-od-id="cta-promise">
                <div>
                  <span className="n">01</span>
                  <div>
                    <b>永远免费</b>
                    <span>没有付费版、订阅或解锁项，全部功能对所有人开放。</span>
                  </div>
                </div>
                <div>
                  <span className="n">02</span>
                  <div>
                    <b>画面只留在你的电脑</b>
                    <span>不连接服务器、不收集数据，源代码公开可查。</span>
                  </div>
                </div>
                <div>
                  <span className="n">03</span>
                  <div>
                    <b>不绑定任何平台</b>
                    <span>凡是能选摄像头的软件都能用，换软件不用换工具。</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer data-od-id="footer">
        <div className="wrap">
          <span>© 2026 VTubeLeaf · 开源项目 · 版本 {release.version}</span>
          <ul>
            <li>
              <a href="https://github.com/moonrailgun/vtubeleaf">GitHub</a>
            </li>
            <li>
              <a href="#faq">常见问题</a>
            </li>
            <li>
              <a href="https://github.com/moonrailgun/vtubeleaf/issues">反馈问题</a>
            </li>
          </ul>
        </div>
      </footer>
    </>
  );
}

export function startFrameLoop(
  frame: () => void,
  fps: () => number,
  background: () => boolean = () => true,
  // Pace frames by display refreshes. Only for loops that paint; inference must not block them.
  vsync = false,
  active: () => boolean = () => true,
): () => void {
  let worker: Worker | undefined;
  let timer = 0;
  let raf = 0;
  let armed = 0;
  let stopped = false;
  let due = performance.now() + 1000 / fps();
  let refreshed = performance.now();
  let period = Infinity;
  let painting = false;
  // Refreshes can pace the loop only when they come at least about as often as its frames.
  const steady = () => period <= (1000 / fps()) * 1.25;
  function arm(delay: number) {
    const id = ++armed;
    window.clearTimeout(timer);
    if (active() && background()) {
      // WKWebView throttles hidden-page DOM timers even with backgroundThrottling disabled.
      // Only keep a worker alive while tracking or output needs uninterrupted frames.
      if (!worker) {
        const url = URL.createObjectURL(
          new Blob(
            ['onmessage = ({ data: [delay, id] }) => setTimeout(() => postMessage(id), delay);'],
            { type: 'text/javascript' },
          ),
        );
        try {
          worker = new Worker(url);
        } finally {
          URL.revokeObjectURL(url);
        }
        // A worker timer cannot be cancelled, so a frame that already ran leaves a stale id.
        worker.onmessage = ({ data }) => {
          if (data === armed) run(performance.now());
        };
      }
      worker.postMessage([Math.max(0, delay), id]);
    } else {
      worker?.terminate();
      worker = undefined;
      timer = window.setTimeout(() => run(performance.now()), Math.max(0, delay));
    }
  }
  function run(now: number, refresh = false) {
    if (stopped) return;
    if (!active()) {
      cancelAnimationFrame(raf);
      raf = 0;
      painting = false;
      period = Infinity;
      due = now + 1000 / fps();
      // Check for new output demand without rendering or keeping a worker alive.
      arm(250);
      return;
    }
    if (vsync && !raf) {
      refreshed = now;
      raf = requestAnimationFrame(refreshFrame);
    }
    try {
      frame();
    } finally {
      // Reschedule even when the frame throws, so a refresh cannot retry it at display rate.
      if (!stopped) {
        const interval = 1000 / fps();
        // A refresh frame re-anchors to its refresh, locking the loop to a whole number of them.
        // A timer frame keeps the ideal cadence so timer latency never lowers the rate, and a
        // late one restarts it so slow inference never queues extra frames.
        due = refresh ? now + interval : Math.max(due + interval, now + interval * 0.75);
        // While refreshes keep arriving the timer only covers a stall; otherwise it paces.
        arm(due - performance.now() + (painting && steady() ? interval : 0));
        painting = false;
      }
    }
  }
  function refreshFrame(time: number) {
    raf = requestAnimationFrame(refreshFrame);
    period = time - refreshed;
    refreshed = time;
    painting = true;
    // Timers drift against the display and repeat frames, so take the refresh nearest to due.
    // The rate then rounds to a whole number of refreshes, e.g. 60 FPS becomes 72 at 144 Hz.
    if (steady() && time + period * 0.45 >= due) run(time, true);
  }
  function wake() {
    due = performance.now();
    period = Infinity;
    painting = false;
    run(due);
  }
  if (vsync) {
    raf = requestAnimationFrame(refreshFrame);
    document.addEventListener('visibilitychange', wake);
  }
  arm(due - performance.now());
  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', wake);
    cancelAnimationFrame(raf);
    window.clearTimeout(timer);
    worker?.terminate();
    worker = undefined;
  };
}

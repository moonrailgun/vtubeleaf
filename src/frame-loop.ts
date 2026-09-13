export function startFrameLoop(
  frame: () => void,
  fps: () => number,
  background: () => boolean = () => true,
): () => void {
  let worker: Worker | undefined;
  let timer = 0;
  let stopped = false;
  function schedule(delay: number) {
    if (background()) {
      // WKWebView throttles hidden-page DOM timers even with backgroundThrottling disabled.
      // Only keep a worker alive while tracking needs uninterrupted frames.
      if (!worker) {
        const url = URL.createObjectURL(
          new Blob(['onmessage = ({ data }) => setTimeout(() => postMessage(null), data);'], {
            type: 'text/javascript',
          }),
        );
        try {
          worker = new Worker(url);
        } finally {
          URL.revokeObjectURL(url);
        }
        worker.onmessage = tick;
      }
      worker.postMessage(delay);
    } else {
      worker?.terminate();
      worker = undefined;
      timer = window.setTimeout(tick, delay);
    }
  }
  function tick() {
    if (stopped) return;
    const started = performance.now();
    frame();
    // Schedule after completing the frame so slow inference never queues extra frames.
    if (!stopped) schedule(Math.max(0, 1000 / fps() - (performance.now() - started)));
  }
  schedule(1000 / fps());
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    worker?.terminate();
    worker = undefined;
  };
}

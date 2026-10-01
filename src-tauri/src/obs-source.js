const canvas = document.querySelector('canvas');
const context = canvas.getContext('2d');
const clear = () => context.clearRect(0, 0, canvas.width, canvas.height);

async function nextFrame() {
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    clear();
    controller.abort();
  }, 2000);
  let delay = 1000 / 30;
  try {
    const response = await fetch('/frame', { cache: 'no-store', signal: controller.signal });
    if (response.status === 204) {
      clear();
      delay = 100;
    } else {
      if (!response.ok) throw new Error('Output unavailable');
      const bitmap = await createImageBitmap(await response.blob());
      clear();
      if (!controller.signal.aborted) context.drawImage(bitmap, 0, 0);
      bitmap.close();
    }
  } catch {
    clear();
    delay = 500;
  } finally {
    clearTimeout(timeout);
    setTimeout(nextFrame, Math.max(0, delay - (performance.now() - started)));
  }
}
void nextFrame();

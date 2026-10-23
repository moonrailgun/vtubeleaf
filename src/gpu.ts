/**
 * The GPU that MediaPipe will use, as reported by the browser. Chromium wraps the name in an
 * ANGLE description such as `ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0,
 * D3D11)`, so the graphics API tail is stripped to leave the model name.
 */
export function gpuName(): string {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  const info = gl?.getExtension('WEBGL_debug_renderer_info');
  const raw = gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
  if (!raw) return '';
  const angle = raw.match(/^ANGLE \([^,]+,\s*([^,]+),\s*[^)]*\)$/);
  return (angle?.[1] ?? raw)
    .replace(/\s+(Direct3D|OpenGL|Metal|Vulkan)\S*.*$/i, '')
    .trim();
}

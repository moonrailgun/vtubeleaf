export type MaskCell = { channel: number; x: number; y: number; width: number; height: number };

const CHANNELS = 4;

// The SDK stops at a 4x4 grid per channel (64 masks); a square grid of any size keeps heavy models rendering.
export function layoutMasks(count: number): MaskCell[] {
  const cells: MaskCell[] = [];
  const div = Math.floor(count / CHANNELS),
    mod = count % CHANNELS;
  for (let channel = 0; channel < CHANNELS; channel++) {
    const n = div + (channel < mod ? 1 : 0);
    if (!n) continue;
    const columns = Math.ceil(Math.sqrt(n)),
      rows = Math.ceil(n / columns);
    for (let i = 0; i < n; i++)
      cells.push({
        channel,
        x: (i % columns) / columns,
        y: Math.floor(i / columns) / rows,
        width: 1 / columns,
        height: 1 / rows,
      });
  }
  return cells;
}

export function maskBufferSize(count: number) {
  const side = Math.ceil(Math.sqrt(Math.ceil(count / CHANNELS)));
  const size = 2 ** Math.ceil(Math.log2(Math.max(1, side) * 256));
  return Math.min(2048, Math.max(256, size));
}

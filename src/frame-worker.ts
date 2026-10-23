/// <reference lib="webworker" />
/**
 * Sends native frames from a worker so the fetch never competes with the render loop for the main
 * thread. The main thread measured a ~39 ms empty round trip that grew with frame rate, which is
 * the cost of the response callback waiting for the next gap between frames.
 */

type Config = { type: 'config'; url: string };
type Frame = { type: 'frame'; id: number; buffer: ArrayBuffer };
type Incoming = Config | Frame;

type Reply = {
  id: number;
  ok: boolean;
  wanted?: boolean;
  sendMs?: number;
  readMs?: number;
  error?: string;
};

let url = '';

self.onmessage = async (event: MessageEvent<Incoming>) => {
  const message = event.data;
  if (message.type === 'config') {
    url = message.url;
    return;
  }
  const reply: Reply = { id: message.id, ok: false };
  try {
    const response = await fetch(url, {
      method: 'POST',
      body: message.buffer,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(await response.text());
    const body = (await response.json()) as { wanted: boolean; sendMs: number; readMs: number };
    reply.ok = true;
    reply.wanted = body.wanted;
    reply.sendMs = body.sendMs;
    reply.readMs = body.readMs;
  } catch (error) {
    reply.error = error instanceof Error ? error.message : String(error);
  }
  (self as unknown as Worker).postMessage(reply);
};

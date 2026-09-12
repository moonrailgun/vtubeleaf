export function isVTubeLeafCamera(device: { label: string }) {
  return device.label.toLowerCase().includes('vtubeleaf camera');
}

// Camera names and IDs can be hidden until the user grants capture permission.
export async function enumerateCaptureDevices(
  requestPermission = false,
  cancelled: () => boolean = () => false,
) {
  const media = navigator.mediaDevices;
  if (!media?.enumerateDevices) return [];
  const devices = await media.enumerateDevices();
  if (cancelled()) return [];
  const cameras = devices.filter((device) => device.kind === 'videoinput');
  if (
    !requestPermission ||
    (cameras.length && cameras.every((device) => device.deviceId && device.label))
  )
    return devices;
  const probe = await media.getUserMedia({ audio: false, video: true });
  try {
    if (cancelled()) return [];
    return await media.enumerateDevices();
  } finally {
    probe.getTracks().forEach((track) => track.stop());
  }
}

function trackingCamera(devices: MediaDeviceInfo[]) {
  return devices.find(
    (device) =>
      device.kind === 'videoinput' && device.deviceId && device.label && !isVTubeLeafCamera(device),
  );
}

function noTrackingCamera() {
  return new DOMException(
    '未找到可用于跟踪的摄像头。VTubeLeaf Camera 仅用于输出。',
    'NotFoundError',
  );
}

export async function openTrackingCamera(
  deviceId: string,
  constraints: MediaTrackConstraints,
  cancelled: () => boolean,
): Promise<MediaStream | null> {
  const media = navigator.mediaDevices;
  const devices = await media.enumerateDevices();
  if (cancelled()) return null;
  const selected = devices.find((device) => device.deviceId === deviceId);
  // Keep an explicit unavailable camera ID so getUserMedia reports it instead of switching cameras.
  let target =
    deviceId && !isVTubeLeafCamera(selected ?? { label: '' })
      ? deviceId
      : trackingCamera(devices)?.deviceId;
  const cameras = devices.filter((device) => device.kind === 'videoinput');
  if (!target && cameras.length && cameras.every(isVTubeLeafCamera)) throw noTrackingCamera();

  for (let attempt = 0; attempt < 2; attempt++) {
    const stream = await media.getUserMedia({
      audio: false,
      video: { ...constraints, ...(target ? { deviceId: { exact: target } } : {}) },
    });
    if (cancelled()) {
      stream.getTracks().forEach((track) => track.stop());
      return null;
    }
    const track = stream.getVideoTracks()[0];
    if (track && !isVTubeLeafCamera(track)) return stream;
    try {
      if (!track || attempt > 0) throw noTrackingCamera();
      // A permission prompt may have opened the system's default virtual camera.
      // Enumerate while permission is active, then release it before opening the input.
      const available = await media.enumerateDevices();
      if (cancelled()) return null;
      target = trackingCamera(available)?.deviceId;
      if (!target) throw noTrackingCamera();
    } finally {
      stream.getTracks().forEach((track) => track.stop());
    }
  }
  throw noTrackingCamera();
}

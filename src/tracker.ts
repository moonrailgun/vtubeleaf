import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  FaceLandmarker,
  HandLandmarker,
  NormalizedLandmark,
  PoseLandmarker,
} from '@mediapipe/tasks-vision';
import { fromHands, type HandSignals } from './hands.ts';
import { fromNvidia } from './nvidia.ts';
import { openTrackingCamera } from './camera-devices.ts';
import { startFrameLoop } from './frame-loop.ts';
import {
  fromMediaPipe,
  fromPose,
  visiblePosePoint,
  isFace,
  type Face,
  type Settings,
  type UpperBody,
} from './state.ts';

/** When pose and hand inference are next due, and which goes first when both are due. */
export type PoseHandDue = { pose: number; hand: number; handFirst: boolean };

// Due times, not run times, set each cadence, so a run deferred by a tick keeps its configured
// average rate; one that fell a whole interval behind restarts its cadence instead of bursting.
// When both fall due on one tick and each rate leaves every other tick free, one runs and the
// other waits a tick (taking turns), so no tick runs face, pose and hand back to back.
// A rate of 0 means that model is off.
export function duePoseHand(
  due: PoseHandDue,
  now: number,
  tickFps: number,
  poseFps: number,
  handFps: number,
) {
  // Slack for a tracking loop whose ticks land slightly early.
  let pose = poseFps > 0 && now >= due.pose - 4;
  let hand = handFps > 0 && now >= due.hand - 4;
  if (pose && hand && Math.max(poseFps, handFps) * 2 <= tickFps) {
    pose = !due.handFirst;
    hand = due.handFirst;
    due.handFirst = !due.handFirst;
  }
  const next = (at: number, fps: number) =>
    at + 1000 / fps > now ? at + 1000 / fps : now + 1000 / fps;
  if (pose) due.pose = next(due.pose, poseFps);
  if (hand) due.hand = next(due.hand, handFps);
  return { pose, hand };
}

export class Tracker {
  private video: HTMLVideoElement;
  private receive: (face: Partial<Face>) => void;
  private fail: (message: string) => void;
  private preview?: HTMLCanvasElement;
  private stream?: MediaStream;
  private landmarker?: FaceLandmarker;
  private pose?: PoseLandmarker;
  private hand?: HandLandmarker;
  private body: UpperBody = {};
  private hands?: HandSignals;
  private poseLandmarks: NormalizedLandmark[] = [];
  private handLandmarks: NormalizedLandmark[][] = [];
  private due: PoseHandDue = { pose: -Infinity, hand: -Infinity, handFirst: false };
  private trackingFps = 24;
  private cameraFps = Infinity;
  private bodyFps = 10;
  private handFps = 10;
  bodyStatus = '上半身待识别';
  handStatus = '手部识别已关闭';
  cameraLabel = '';
  cameraSettings = '';
  private unlisten: UnlistenFn[] = [];
  private stopFrames?: () => void;
  private generation = 0;
  private paused = false;
  private previousTime = -1;
  private input?: CanvasRenderingContext2D;
  private lastDetection = 0;
  private engine?: Settings['engine'];
  private nativeOperation: Promise<unknown> = Promise.resolve();
  private drawPreview?: (landmarks: NormalizedLandmark[]) => void;

  // Plain fields rather than parameter properties keep this module loadable by Node's type stripping.
  constructor(
    video: HTMLVideoElement,
    receive: (face: Partial<Face>) => void,
    fail: (message: string) => void,
    preview?: HTMLCanvasElement,
  ) {
    this.video = video;
    this.receive = receive;
    this.fail = fail;
    this.preview = preview;
  }

  async start(s: Settings) {
    const stopped = this.stop();
    const generation = this.generation;
    await stopped;
    if (generation !== this.generation) return false;
    this.engine = s.engine;
    this.paused = false;
    this.bodyStatus =
      s.engine !== 'mediapipe'
        ? '当前引擎仅支持面部'
        : s.upperBody
          ? '上半身待识别'
          : '上半身识别已关闭';
    this.handStatus =
      s.engine !== 'mediapipe'
        ? '当前引擎不支持手部'
        : s.handTracking
          ? '手部待识别'
          : '手部识别已关闭';
    this.trackingFps = s.trackingFps;
    this.bodyFps = s.bodyFps;
    this.handFps = s.handFps;
    try {
      if (s.engine !== 'mediapipe') {
        const engine = s.engine;
        const unlisten = await listen<unknown>(`${engine}-frame`, (event) => {
          const face =
            engine === 'nvidia'
              ? fromNvidia(event.payload)
              : isFace(event.payload)
                ? event.payload
                : null;
          if (generation === this.generation && !this.paused && face) this.receive(face);
        });
        if (generation !== this.generation) {
          unlisten();
          return false;
        }
        this.unlisten.push(unlisten);
        const unlistenError = await listen<string>(`${engine}-error`, (event) => {
          if (generation !== this.generation) return;
          void this.stop().catch(() => {});
          this.fail(
            engine === 'nvidia'
              ? `NVIDIA RTX（实验中）：${typeof event.payload === 'string' ? event.payload : '跟踪进程异常，请检查 SDK 与摄像头。'}`
              : typeof event.payload === 'string'
                ? event.payload
                : 'OpenSeeFace 跟踪进程已退出，请检查摄像头后重试。',
          );
        });
        if (generation !== this.generation) {
          unlistenError();
          return false;
        }
        this.unlisten.push(unlistenError);
        this.nativeOperation = this.nativeOperation
          .catch(() => {})
          .then(() => {
            if (generation === this.generation)
              return invoke(
                `start_${engine}`,
                engine === 'nvidia'
                  ? {
                      executable: s.nvidiaPath,
                      modelDir: s.nvidiaModelDir,
                      camera: s.camera,
                      fps: s.trackingFps,
                      resolution: s.cameraResolution,
                    }
                  : {
                      port: s.port,
                      mode: s.openseefaceMode,
                      camera: s.camera,
                      pythonPath: s.pythonPath || null,
                      scriptPath: s.scriptPath || null,
                    },
              );
          });
        await this.nativeOperation;
      } else {
        if (!navigator.mediaDevices?.getUserMedia)
          throw new Error('此运行环境没有摄像头接口。请使用桌面应用，并检查系统权限。');
        // Load the models while the camera opens; a camera failure still wins over a model one.
        const loading = this.loadMediaPipe(s, generation);
        loading.catch(() => {});
        const [width, height] =
          s.cameraResolution === '1080p'
            ? [1920, 1080]
            : s.cameraResolution === '720p'
              ? [1280, 720]
              : [640, 360];
        const stream = await openTrackingCamera(
          s.deviceId,
          {
            width: { ideal: width },
            height: { ideal: height },
            frameRate: { ideal: s.trackingFps, max: s.trackingFps },
          },
          () => generation !== this.generation,
        );
        if (!stream) return false;
        if (generation !== this.generation) {
          stream.getTracks().forEach((track) => track.stop());
          return false;
        }
        this.stream = stream;
        const videoTrack = stream.getVideoTracks()[0];
        this.cameraLabel = videoTrack.label || '摄像头名称不可用';
        const actual = videoTrack.getSettings();
        this.cameraFps = actual.frameRate ? Math.round(actual.frameRate) : Infinity;
        this.cameraSettings = [
          actual.width && actual.height ? `${actual.width}×${actual.height}` : '',
          actual.frameRate ? `${Math.round(actual.frameRate)} FPS` : '',
        ]
          .filter(Boolean)
          .join(' · ');
        this.video.srcObject = stream;
        videoTrack.addEventListener('ended', () => {
          if (generation === this.generation) {
            void this.stop();
            this.fail('摄像头已断开。请重新连接或选择其他设备后开始。');
          }
        });
        await this.video.play();
        if (generation !== this.generation) return false;
        const { FaceLandmarker, HandLandmarker } = await loading;
        if (generation !== this.generation) return false;
        const canvas = this.preview;
        const context = canvas?.getContext('2d');
        if (canvas && context) {
          // The mesh lists each inner edge once per triangle, so twice. Stroked one by one, the
          // two 0x66 layers added up to 0xa3; one path draws each edge once at that alpha instead.
          const mesh = [
            ...new Map(
              FaceLandmarker.FACE_LANDMARKS_TESSELATION.map((edge) => [
                Math.min(edge.start, edge.end) * 1000 + Math.max(edge.start, edge.end),
                edge,
              ]),
            ).values(),
          ];
          // One path per set rather than ~2,700 separate strokes a frame.
          const lines = (
            points: NormalizedLandmark[],
            connections: { start: number; end: number }[],
            color: string,
            lineWidth: number,
          ) => {
            context.beginPath();
            for (const { start, end } of connections) {
              const from = points[start];
              const to = points[end];
              if (!from || !to) continue;
              context.moveTo(from.x * canvas.width, from.y * canvas.height);
              context.lineTo(to.x * canvas.width, to.y * canvas.height);
            }
            context.strokeStyle = color;
            context.lineWidth = lineWidth;
            context.stroke();
          };
          // Filled and outlined at 1px, as MediaPipe's DrawingUtils draws landmarks.
          const dots = (points: NormalizedLandmark[], color: string, radius: number) => {
            context.beginPath();
            for (const { x, y } of points) {
              context.moveTo(x * canvas.width + radius, y * canvas.height);
              context.arc(x * canvas.width, y * canvas.height, radius, 0, 2 * Math.PI);
            }
            context.fillStyle = context.strokeStyle = color;
            context.lineWidth = 1;
            context.fill();
            context.stroke();
          };
          let shown = false;
          this.drawPreview = (landmarks) => {
            // A hidden preview skips each frame's work but is still left blank for when it shows.
            if (!canvas.getClientRects().length) {
              if (shown) this.clearPreview();
              shown = false;
              return;
            }
            shown = true;
            this.clearPreview();
            if (
              canvas.width !== this.video.videoWidth ||
              canvas.height !== this.video.videoHeight
            ) {
              canvas.width = this.video.videoWidth;
              canvas.height = this.video.videoHeight;
            }
            lines(landmarks, mesh, '#a7f3d0a3', 1);
            lines(landmarks, FaceLandmarker.FACE_LANDMARKS_CONTOURS, '#6ee7b7', 2);
            dots(landmarks, '#ffffff', 1);
            const body = this.poseLandmarks;
            const connections = [
              [11, 12],
              [11, 13],
              [13, 15],
              [12, 14],
              [14, 16],
              [11, 23],
              [12, 24],
              [23, 24],
            ]
              .map(([start, end]) => ({ start, end }))
              .filter(
                ({ start, end }) => visiblePosePoint(body[start]) && visiblePosePoint(body[end]),
              );
            lines(body, connections, '#fbbf24', 3);
            dots(
              [11, 12, 13, 14, 15, 16, 23, 24].map((id) => body[id]).filter(visiblePosePoint),
              '#fef3c7',
              3,
            );
            for (const hand of this.handLandmarks) {
              lines(hand, HandLandmarker.HAND_CONNECTIONS, '#60a5fa', 3);
              dots(hand, '#dbeafe', 3);
            }
          };
        }
        this.previousTime = -1;
        this.stopFrames = startFrameLoop(
          () => this.tick(generation),
          () => this.trackingFps,
        );
      }
      return generation === this.generation;
    } catch (error) {
      if (generation !== this.generation) return false;
      await this.stop();
      if (error instanceof DOMException) {
        const messages: Record<string, string> = {
          NotAllowedError:
            '摄像头权限被拒绝。请在系统隐私设置中允许 VTubeLeaf 使用摄像头，然后重试。',
          NotFoundError:
            '未找到可用于跟踪的摄像头。请连接其他摄像头并刷新列表；VTubeLeaf Camera 仅用于输出。',
          NotReadableError: '无法打开摄像头。请关闭正在占用它的应用后重试。',
          OverconstrainedError: '所选摄像头已不可用。请刷新列表并重新选择。',
        };
        throw new Error(messages[error.name] ?? '摄像头启动失败。请检查设备与系统权限。');
      }
      if (s.engine === 'openseeface')
        throw new Error(
          typeof error === 'string'
            ? error
            : 'OpenSeeFace 接收失败。请检查本机端口；自定义模式需同时检查 Python 路径。',
        );
      if (error instanceof Error && error.message.startsWith('此运行环境')) throw error;
      throw new Error(
        s.engine === 'mediapipe' && s.trackingDelegate === 'GPU'
          ? '面捕启动失败。请在「跟踪引擎与采集」中将「面捕计算设备」切换为 CPU 后重试；若仍失败，请检查本地面捕资源。'
          : '面捕资源加载失败。请运行 npm run setup:assets 安装本地 MediaPipe 资源后重试。',
      );
    }
  }

  // Creates the enabled landmarkers together. Each belongs to this tracker, so stop() closes it,
  // only while its start is current; one that finishes after a stop or restart closes itself.
  private async loadMediaPipe(s: Settings, generation: number) {
    const vision = await import('@mediapipe/tasks-vision');
    const { FaceLandmarker, HandLandmarker, PoseLandmarker, FilesetResolver } = vision;
    const fileset = await FilesetResolver.forVisionTasks('/runtime/mediapipe/wasm');
    if (generation !== this.generation) return vision;
    const current = (landmarker: { close(): void }) => {
      if (generation === this.generation) return true;
      landmarker.close();
      return false;
    };
    await Promise.all([
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: '/runtime/mediapipe/face_landmarker.task',
          delegate: s.trackingDelegate,
        },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      }).then((landmarker) => {
        if (current(landmarker)) this.landmarker = landmarker;
      }),
      s.upperBody &&
        PoseLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: '/runtime/mediapipe/pose_landmarker_lite.task',
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.6,
          minPosePresenceConfidence: 0.6,
          minTrackingConfidence: 0.6,
          outputSegmentationMasks: false,
        }).then(
          (pose) => {
            if (current(pose)) this.pose = pose;
          },
          () => {
            if (generation === this.generation)
              this.bodyStatus = '上半身资源加载失败 · 仅面捕，请重新准备跟踪资源';
          },
        ),
      s.handTracking &&
        HandLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: '/runtime/mediapipe/hand_landmarker.task',
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.6,
          minHandPresenceConfidence: 0.6,
          minTrackingConfidence: 0.6,
        }).then(
          (hand) => {
            if (current(hand)) this.hand = hand;
          },
          () => {
            if (generation === this.generation)
              this.handStatus = '手部资源加载失败 · 面捕继续，请重新准备跟踪资源';
          },
        ),
    ]);
    return vision;
  }

  private tick(generation: number) {
    if (generation !== this.generation) return;
    // ponytail: inference stays synchronous; move it to workers only if profiling justifies it.
    const started = performance.now();
    try {
      if (!this.paused && this.landmarker && this.video.readyState >= 2) {
        const input = (this.input ??= document.createElement('canvas').getContext('2d')!);
        if (
          input.canvas.width !== this.video.videoWidth ||
          input.canvas.height !== this.video.videoHeight
        ) {
          input.canvas.width = this.video.videoWidth;
          input.canvas.height = this.video.videoHeight;
        }
        // WebKit pauses hidden videos read only through WebGL (MediaPipe's input path).
        // Drawing to 2D keeps capture playback active, including when resuming in the background.
        // Do this before checking currentTime: a suspended video's clock cannot advance yet.
        input.drawImage(this.video, 0, 0);
        if (this.video.currentTime === this.previousTime) return;
        this.previousTime = this.video.currentTime;
        const result = this.landmarker.detectForVideo(input.canvas, started);
        const matrix = result.facialTransformationMatrixes[0]?.data;
        const face = matrix && fromMediaPipe(result.faceBlendshapes[0]?.categories ?? [], matrix);
        // A camera slower than the tracking rate leaves fewer ticks to spread pose and hand over.
        const due = duePoseHand(
          this.due,
          started,
          Math.min(this.trackingFps, this.cameraFps),
          this.pose ? this.bodyFps : 0,
          this.hand ? this.handFps : 0,
        );
        if (this.pose && due.pose) {
          try {
            const pose = this.pose.detectForVideo(input.canvas, started);
            this.body = fromPose(pose.landmarks[0] ?? [], pose.worldLandmarks[0] ?? []);
            this.poseLandmarks = this.body.bodyYaw === undefined ? [] : pose.landmarks[0];
            this.bodyStatus =
              this.body.bodyYaw === undefined
                ? '未看到双肩 · 身体随头部轻动'
                : this.body.bodyPitch === undefined
                  ? '已识别肩膀 · 躯干未完整入镜'
                  : '已识别上半身';
          } catch {
            this.pose.close();
            this.pose = undefined;
            this.body = {};
            this.poseLandmarks = [];
            this.bodyStatus = '上半身识别中断 · 仅面捕，停止后重试';
          }
        }
        if (this.hand && due.hand) {
          try {
            const result = this.hand.detectForVideo(input.canvas, started);
            this.hands = fromHands(result.landmarks, result.worldLandmarks, result.handedness);
            this.handLandmarks = result.landmarks;
            this.handStatus =
              this.hands.handLeftFound || this.hands.handRightFound ? '已识别手部' : '未看到手部';
          } catch {
            this.hand.close();
            this.hand = undefined;
            this.handLandmarks = [];
            this.hands = fromHands([], [], []);
            this.handStatus = '手部识别中断 · 面捕继续，停止后重试';
          }
        }
        if (face || this.body.bodyYaw !== undefined || this.hands)
          this.receive({ ...face, ...this.body, ...this.hands });
        this.lastDetection = performance.now() - started;
        this.drawPreview?.(result.faceLandmarks[0] ?? []);
      }
    } catch {
      void this.stop();
      this.fail('面捕运行中断。请停止后重新开始；反复失败时可改用 OpenSeeFace。');
      return;
    }
  }

  get inferenceMs() {
    return this.lastDetection;
  }

  pause(paused: boolean) {
    this.paused = paused;
    if (paused) {
      this.clearPreview();
      this.body = {};
      this.hands = undefined;
      this.poseLandmarks = [];
      this.handLandmarks = [];
      this.due.pose = this.due.hand = -Infinity;
    }
  }

  private clearPreview() {
    const canvas = this.preview;
    if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  }

  async stop() {
    ++this.generation;
    this.clearPreview();
    this.drawPreview = undefined;
    this.stopFrames?.();
    this.stopFrames = undefined;
    this.unlisten.forEach((unlisten) => unlisten());
    this.unlisten = [];
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    this.cameraLabel = '';
    this.cameraSettings = '';
    this.video.pause();
    this.video.srcObject = null;
    this.input = undefined;
    this.landmarker?.close();
    this.landmarker = undefined;
    this.pose?.close();
    this.pose = undefined;
    this.hand?.close();
    this.hand = undefined;
    this.body = {};
    this.hands = undefined;
    this.poseLandmarks = [];
    this.handLandmarks = [];
    this.due.pose = this.due.hand = -Infinity;
    const engine = this.engine;
    this.engine = undefined;
    if (engine && engine !== 'mediapipe')
      this.nativeOperation = this.nativeOperation
        .catch(() => {})
        .then(() => invoke(`stop_${engine}`));
    await this.nativeOperation;
  }
}

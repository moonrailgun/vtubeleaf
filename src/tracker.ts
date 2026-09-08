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
import {
  fromMediaPipe,
  fromPose,
  visiblePosePoint,
  isFace,
  type Face,
  type Settings,
  type UpperBody,
} from './state';

export class Tracker {
  private stream?: MediaStream;
  private landmarker?: FaceLandmarker;
  private pose?: PoseLandmarker;
  private hand?: HandLandmarker;
  private body: UpperBody = {};
  private hands?: HandSignals;
  private poseLandmarks: NormalizedLandmark[] = [];
  private handLandmarks: NormalizedLandmark[][] = [];
  private lastPoseAt = -Infinity;
  private lastHandAt = -Infinity;
  private trackingFps = 24;
  private bodyFps = 10;
  private handFps = 10;
  bodyStatus = '上半身待识别';
  handStatus = '手部识别已关闭';
  cameraLabel = '';
  cameraSettings = '';
  private unlisten: UnlistenFn[] = [];
  private timer = 0;
  private generation = 0;
  private paused = false;
  private previousTime = -1;
  private lastDetection = 0;
  private engine?: Settings['engine'];
  private nativeOperation: Promise<unknown> = Promise.resolve();
  private drawPreview?: (landmarks: NormalizedLandmark[]) => void;

  constructor(
    private video: HTMLVideoElement,
    private receive: (face: Partial<Face>) => void,
    private fail: (message: string) => void,
    private preview?: HTMLCanvasElement,
  ) {}

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
              : 'OpenSeeFace 跟踪进程已退出。请检查 Python 依赖与摄像头后重试。',
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
        const [width, height] =
          s.cameraResolution === '1080p'
            ? [1920, 1080]
            : s.cameraResolution === '720p'
              ? [1280, 720]
              : [640, 360];
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            width: { ideal: width },
            height: { ideal: height },
            frameRate: { ideal: s.trackingFps, max: s.trackingFps },
            ...(s.deviceId ? { deviceId: { exact: s.deviceId } } : {}),
          },
        });
        if (generation !== this.generation) {
          stream.getTracks().forEach((track) => track.stop());
          return false;
        }
        this.stream = stream;
        const videoTrack = stream.getVideoTracks()[0];
        this.cameraLabel = videoTrack.label || '摄像头名称不可用';
        const actual = videoTrack.getSettings();
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
        const { FaceLandmarker, HandLandmarker, PoseLandmarker, FilesetResolver, DrawingUtils } =
          await import('@mediapipe/tasks-vision');
        const vision = await FilesetResolver.forVisionTasks('/runtime/mediapipe/wasm');
        if (generation !== this.generation) return false;
        const landmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: '/runtime/mediapipe/face_landmarker.task',
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        });
        if (generation !== this.generation) {
          landmarker.close();
          return false;
        }
        this.landmarker = landmarker;
        if (s.upperBody) {
          try {
            const pose = await PoseLandmarker.createFromOptions(vision, {
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
            });
            if (generation !== this.generation) {
              pose.close();
              return false;
            }
            this.pose = pose;
          } catch {
            if (generation !== this.generation) return false;
            this.bodyStatus = '上半身资源加载失败 · 仅面捕，请重新准备跟踪资源';
          }
        }
        if (s.handTracking) {
          try {
            const hand = await HandLandmarker.createFromOptions(vision, {
              baseOptions: {
                modelAssetPath: '/runtime/mediapipe/hand_landmarker.task',
                delegate: 'CPU',
              },
              runningMode: 'VIDEO',
              numHands: 2,
              minHandDetectionConfidence: 0.6,
              minHandPresenceConfidence: 0.6,
              minTrackingConfidence: 0.6,
            });
            if (generation !== this.generation) {
              hand.close();
              return false;
            }
            this.hand = hand;
          } catch {
            if (generation !== this.generation) return false;
            this.handStatus = '手部资源加载失败 · 面捕继续，请重新准备跟踪资源';
          }
        }
        const canvas = this.preview;
        const context = canvas?.getContext('2d');
        if (canvas && context) {
          const drawing = new DrawingUtils(context);
          this.drawPreview = (landmarks) => {
            this.clearPreview();
            if (!canvas.getClientRects().length) return;
            if (
              canvas.width !== this.video.videoWidth ||
              canvas.height !== this.video.videoHeight
            ) {
              canvas.width = this.video.videoWidth;
              canvas.height = this.video.videoHeight;
            }
            drawing.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_TESSELATION, {
              color: '#a7f3d066',
              lineWidth: 1,
            });
            drawing.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_CONTOURS, {
              color: '#6ee7b7',
              lineWidth: 2,
            });
            drawing.drawLandmarks(landmarks, { color: '#ffffff', radius: 1, lineWidth: 0 });
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
            drawing.drawConnectors(body, connections, { color: '#fbbf24', lineWidth: 3 });
            drawing.drawLandmarks(
              [11, 12, 13, 14, 15, 16, 23, 24].map((id) => body[id]).filter(visiblePosePoint),
              { color: '#fef3c7', radius: 3, lineWidth: 0 },
            );
            for (const hand of this.handLandmarks) {
              drawing.drawConnectors(hand, HandLandmarker.HAND_CONNECTIONS, {
                color: '#60a5fa',
                lineWidth: 3,
              });
              drawing.drawLandmarks(hand, { color: '#dbeafe', radius: 3, lineWidth: 0 });
            }
          };
        }
        this.previousTime = -1;
        this.tick(generation);
      }
      return generation === this.generation;
    } catch (error) {
      if (generation !== this.generation) return false;
      await this.stop();
      if (error instanceof DOMException) {
        const messages: Record<string, string> = {
          NotAllowedError:
            '摄像头权限被拒绝。请在系统隐私设置中允许 VTubeLeaf 使用摄像头，然后重试。',
          NotFoundError: '未找到摄像头。请连接设备并刷新列表。',
          NotReadableError: '无法打开摄像头。请关闭正在占用它的应用后重试。',
          OverconstrainedError: '所选摄像头已不可用。请刷新列表并重新选择。',
        };
        throw new Error(messages[error.name] ?? '摄像头启动失败。请检查设备与系统权限。');
      }
      if (s.engine === 'openseeface')
        throw new Error(
          typeof error === 'string'
            ? error
            : 'OpenSeeFace 启动失败。请检查本地端口与 Python 路径。',
        );
      if (error instanceof Error && error.message.startsWith('此运行环境')) throw error;
      throw new Error(
        '面捕资源加载失败。请运行 npm run setup:assets 安装本地 MediaPipe 资源后重试。',
      );
    }
  }

  private tick(generation: number) {
    if (generation !== this.generation) return;
    const started = performance.now();
    try {
      if (
        !this.paused &&
        this.landmarker &&
        this.video.readyState >= 2 &&
        this.video.currentTime !== this.previousTime
      ) {
        this.previousTime = this.video.currentTime;
        const result = this.landmarker.detectForVideo(this.video, started);
        const matrix = result.facialTransformationMatrixes[0]?.data;
        const face = matrix && fromMediaPipe(result.faceBlendshapes[0]?.categories ?? [], matrix);
        if (this.pose && started - this.lastPoseAt >= 1000 / this.bodyFps) {
          this.lastPoseAt = started;
          try {
            const pose = this.pose.detectForVideo(this.video, started);
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
        if (this.hand && started - this.lastHandAt >= 1000 / this.handFps) {
          this.lastHandAt = started;
          try {
            const result = this.hand.detectForVideo(this.video, started);
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
    // ponytail: MediaPipe's VIDEO calls are synchronous; keep one latest-frame loop and profile
    // before paying the complexity cost of moving the auxiliary tasks into workers.
    this.timer = window.setTimeout(
      () => this.tick(generation),
      Math.max(0, 1000 / this.trackingFps - (performance.now() - started)),
    );
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
      this.lastPoseAt = -Infinity;
      this.handLandmarks = [];
      this.lastHandAt = -Infinity;
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
    window.clearTimeout(this.timer);
    this.unlisten.forEach((unlisten) => unlisten());
    this.unlisten = [];
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    this.cameraLabel = '';
    this.cameraSettings = '';
    this.video.pause();
    this.video.srcObject = null;
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
    this.lastPoseAt = -Infinity;
    this.lastHandAt = -Infinity;
    const engine = this.engine;
    this.engine = undefined;
    if (engine && engine !== 'mediapipe')
      this.nativeOperation = this.nativeOperation
        .catch(() => {})
        .then(() => invoke(`stop_${engine}`));
    await this.nativeOperation;
  }
}

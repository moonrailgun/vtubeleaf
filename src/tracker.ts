import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { FaceLandmarker, NormalizedLandmark, PoseLandmarker } from '@mediapipe/tasks-vision';
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
  private body: UpperBody = {};
  private poseLandmarks: NormalizedLandmark[] = [];
  private lastPoseAt = -Infinity;
  bodyStatus = '上半身待识别';
  private unlisten: UnlistenFn[] = [];
  private timer = 0;
  private generation = 0;
  private paused = false;
  private previousTime = -1;
  private lastDetection = 0;
  private engine?: Settings['engine'];
  private osfOperation: Promise<unknown> = Promise.resolve();
  private drawPreview?: (landmarks: NormalizedLandmark[]) => void;

  constructor(
    private video: HTMLVideoElement,
    private receive: (face: Face) => void,
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
      s.engine === 'openseeface'
        ? 'OpenSeeFace 仅支持面部'
        : s.upperBody
          ? '上半身待识别'
          : '上半身识别已关闭';
    try {
      if (s.engine === 'openseeface') {
        const unlisten = await listen<Face>('openseeface-frame', (event) => {
          if (generation === this.generation && !this.paused && isFace(event.payload))
            this.receive(event.payload);
        });
        if (generation !== this.generation) {
          unlisten();
          return false;
        }
        this.unlisten.push(unlisten);
        const unlistenError = await listen('openseeface-error', () => {
          if (generation !== this.generation) return;
          void this.stop().catch(() => {});
          this.fail('OpenSeeFace 跟踪进程已退出。请检查 Python 依赖与摄像头后重试。');
        });
        if (generation !== this.generation) {
          unlistenError();
          return false;
        }
        this.unlisten.push(unlistenError);
        this.osfOperation = this.osfOperation
          .catch(() => {})
          .then(() => {
            if (generation === this.generation)
              return invoke('start_openseeface', {
                port: s.port,
                camera: s.camera,
                pythonPath: s.pythonPath || null,
                scriptPath: s.scriptPath || null,
              });
          });
        await this.osfOperation;
      } else {
        if (!navigator.mediaDevices?.getUserMedia)
          throw new Error('此运行环境没有摄像头接口。请使用桌面应用，并检查系统权限。');
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            width: { ideal: 640 },
            height: { ideal: 360 },
            frameRate: { ideal: 24, max: 30 },
            ...(s.deviceId ? { deviceId: { exact: s.deviceId } } : {}),
          },
        });
        if (generation !== this.generation) {
          stream.getTracks().forEach((track) => track.stop());
          return false;
        }
        this.stream = stream;
        this.video.srcObject = stream;
        stream.getVideoTracks()[0].addEventListener('ended', () => {
          if (generation === this.generation) {
            void this.stop();
            this.fail('摄像头已断开。请重新连接或选择其他设备后开始。');
          }
        });
        await this.video.play();
        if (generation !== this.generation) return false;
        const { FaceLandmarker, PoseLandmarker, FilesetResolver, DrawingUtils } =
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
        // ponytail: synchronous Lite inference capped at 10 Hz; move to a worker if profiling shows UI stalls.
        if (this.pose && started - this.lastPoseAt >= 100) {
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
        if (face) this.receive({ ...face, ...this.body });
        this.lastDetection = performance.now() - started;
        this.drawPreview?.(result.faceLandmarks[0] ?? []);
      }
    } catch {
      void this.stop();
      this.fail('面捕运行中断。请停止后重新开始；反复失败时可改用 OpenSeeFace。');
      return;
    }
    // One synchronous inference at a time; always read the latest frame, never queue frames.
    this.timer = window.setTimeout(
      () => this.tick(generation),
      Math.max(0, 1000 / 24 - (performance.now() - started)),
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
      this.poseLandmarks = [];
      this.lastPoseAt = -Infinity;
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
    this.video.pause();
    this.video.srcObject = null;
    this.landmarker?.close();
    this.landmarker = undefined;
    this.pose?.close();
    this.pose = undefined;
    this.body = {};
    this.poseLandmarks = [];
    this.lastPoseAt = -Infinity;
    const engine = this.engine;
    this.engine = undefined;
    if (engine === 'openseeface')
      this.osfOperation = this.osfOperation.catch(() => {}).then(() => invoke('stop_openseeface'));
    await this.osfOperation;
  }
}

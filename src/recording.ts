export class MotionRecording {
  active = false;
  private started?: number;
  private frames: { time: number; values: Record<string, number> }[] = [];

  get duration() {
    return this.frames.at(-1)?.time ?? 0;
  }

  start() {
    this.frames = [];
    this.started = undefined;
    this.active = true;
  }

  stop() {
    this.active = false;
  }

  capture(values: Record<string, number>, now: number) {
    if (!this.active || !Number.isFinite(now) || !Object.keys(values).length) return;
    this.started ??= now;
    const time = Math.min(60, Math.max(0, (now - this.started) / 1000));
    if (this.frames.length && time <= this.duration) return;
    // ponytail: cap manual takes at 60 seconds / 30 fps; stream to disk for longer recording.
    if (time - this.duration < 1 / 30 && this.frames.length && time < 60) return;
    const finite = Object.fromEntries(
      Object.entries(values).filter(([, value]) => Number.isFinite(value)),
    );
    this.frames.push({ time, values: finite });
    if (time >= 60 || this.frames.length >= 1801) this.stop();
  }

  export() {
    if (this.frames.length < 2) return null;
    const curves = Object.keys(this.frames[0].values).map((id) => ({
      Target: 'Parameter',
      Id: id,
      Segments: this.frames.flatMap((frame, index) =>
        index
          ? [0, frame.time, frame.values[id] ?? this.frames[0].values[id]]
          : [0, frame.values[id]],
      ),
    }));
    return {
      Version: 3,
      Meta: {
        Duration: this.duration,
        Fps: 30,
        Loop: false,
        AreBeziersRestricted: true,
        CurveCount: curves.length,
        TotalSegmentCount: curves.length * (this.frames.length - 1),
        TotalPointCount: curves.length * this.frames.length,
        UserDataCount: 0,
        TotalUserDataSize: 0,
      },
      Curves: curves,
      UserData: [],
    };
  }
}

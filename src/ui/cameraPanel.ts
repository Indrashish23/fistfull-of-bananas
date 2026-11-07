// The camera preview beside the game: a mirror, so players can see they're in frame. It uses
// Little's media.camera, where the host handles permission and the on-air light. The camera
// only opens when someone turns it on, and closes whenever the app leaves the screen.

export interface CameraGrantLike {
  ok: boolean;
  stream?: MediaStream;
  stop?: () => void;
}

export type CameraOpener = () => Promise<CameraGrantLike>;

export class CameraPanel {
  private readonly video: HTMLVideoElement;
  private readonly status: HTMLElement;
  private stopCamera: (() => void) | null = null;
  /** Whether players want it on, which survives the app being paused. */
  private wanted = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly open: CameraOpener,
    private readonly available: () => boolean,
  ) {
    const panel = document.createElement("aside");
    panel.className = "camera-panel";
    panel.setAttribute("aria-label", "Camera preview");
    panel.innerHTML = `
      <div class="camera-frame">
        <video autoplay muted playsinline></video>
        <div class="camera-status"></div>
      </div>
      <div class="camera-title">You're on camera</div>`;
    root.appendChild(panel);
    this.video = panel.querySelector("video")!;
    this.status = panel.querySelector(".camera-status")!;
  }

  get on(): boolean {
    return this.wanted;
  }

  /** Turns the preview on or off, and returns what to tell the player. */
  async toggle(): Promise<string> {
    if (this.wanted) {
      this.turnOff();
      return "Camera off";
    }
    if (!this.available()) return "No camera on this device";
    this.wanted = true;
    this.showLayout(true);
    return (await this.startStream()) ? "Camera on" : this.failed();
  }

  private failed(): string {
    this.turnOff();
    return "The camera didn't open";
  }

  private turnOff(): void {
    this.wanted = false;
    this.stopStream();
    this.showLayout(false);
  }

  /** Lays out the game on the left and the preview on the right, without a camera, for checks. */
  showLayout(on: boolean): void {
    if (on) this.root.dataset.camera = "on";
    else delete this.root.dataset.camera;
  }

  private async startStream(): Promise<boolean> {
    this.status.textContent = "Starting camera...";
    this.status.hidden = false;
    let grant: CameraGrantLike;
    try {
      grant = await this.open();
    } catch {
      return false;
    }
    if (!grant.ok || !grant.stream) return false;
    // They may have turned it off, or left the app, while the camera was opening.
    if (!this.wanted) {
      grant.stop?.();
      return true;
    }
    this.stopCamera = grant.stop ?? null;
    this.video.srcObject = grant.stream;
    this.status.hidden = true;
    void this.video.play().catch(() => {});
    return true;
  }

  private stopStream(): void {
    this.stopCamera?.();
    this.stopCamera = null;
    this.video.srcObject = null;
  }

  /** The host revokes the camera when the app leaves the screen. */
  pause(): void {
    this.stopStream();
  }

  resume(): void {
    if (this.wanted) void this.startStream().then((ok) => { if (!ok) this.turnOff(); });
  }
}

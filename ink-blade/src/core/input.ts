export class Input {
  keys = new Set<string>();
  pressed = new Set<string>();
  mouse = { x: 0, y: 0, down: false, clicked: false };
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.bind();
  }

  private bind() {
    window.addEventListener('keydown', (e) => {
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.down = false;
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.keys.clear();
        this.mouse.down = false;
      }
    });
    this.canvas.addEventListener('pointermove', (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
    });
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const r = this.canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
      this.mouse.down = true;
      this.mouse.clicked = true;
    });
    window.addEventListener('pointerup', (e) => {
      if (e.button === 0) this.mouse.down = false;
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  isDown(code: string) {
    return this.keys.has(code);
  }

  wasPressed(code: string) {
    return this.pressed.has(code);
  }

  wasAnyPressed(codes: string[]) {
    return codes.some((c) => this.pressed.has(c));
  }

  get moveX() {
    return (this.isDown('KeyD') || this.isDown('ArrowRight') ? 1 : 0) - (this.isDown('KeyA') || this.isDown('ArrowLeft') ? 1 : 0);
  }

  get moveY() {
    return (this.isDown('KeyS') || this.isDown('ArrowDown') ? 1 : 0) - (this.isDown('KeyW') || this.isDown('ArrowUp') ? 1 : 0);
  }

  get moveVec() {
    const x = this.moveX;
    const y = this.moveY;
    const len = Math.hypot(x, y);
    return len > 0 ? { x: x / len, y: y / len, len } : { x: 0, y: 0, len: 0 };
  }

  endFrame() {
    this.pressed.clear();
    this.mouse.clicked = false;
  }
}

declare module 'three/examples/jsm/postprocessing/EffectComposer.js' {
  import type { WebGLRenderer, WebGLRenderTarget } from 'three';

  export class EffectComposer {
    constructor(renderer: WebGLRenderer, renderTarget?: WebGLRenderTarget);
    addPass(pass: unknown): void;
    removePass(pass: unknown): void;
    render(deltaTime?: number): void;
    setSize(width: number, height: number): void;
    setPixelRatio(pixelRatio: number): void;
    dispose(): void;
  }
}

declare module 'three/examples/jsm/postprocessing/RenderPass.js' {
  import type { Camera, Scene } from 'three';

  export class RenderPass {
    constructor(scene: Scene, camera: Camera);
    scene: Scene;
    camera: Camera;
    clear: boolean;
    clearDepth: boolean;
  }
}

declare module 'three/examples/jsm/postprocessing/UnrealBloomPass.js' {
  import type { Vector2 } from 'three';

  export class UnrealBloomPass {
    constructor(resolution: Vector2, strength: number, radius: number, threshold: number);
    strength: number;
    radius: number;
    threshold: number;
    setSize(width: number, height: number): void;
  }
}

declare module 'three/examples/jsm/postprocessing/OutputPass.js' {
  export class OutputPass {
    constructor();
  }
}

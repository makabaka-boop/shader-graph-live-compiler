// WebGL2 渲染器：编译着色器、全屏三角形、u_time 动画、截图。
// 上下文丢失时 GL 资源全部失效；恢复后重建资源并用当前图重新编译，
// 状态机保证不会再显示旧画面。
export interface CompileOutcome {
  ok: boolean;
  message?: string;
  /** 编译期间上下文已丢失，结果应被忽略 */
  lost?: boolean;
}

export interface RendererCallbacks {
  onLost: () => void;
  onRestored: () => void;
}

const VERTICES = new Float32Array([-1, -1, 3, -1, -1, 3]);

export class GLRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram | null = null;
  private vbo: WebGLBuffer | null = null;
  private uTime: WebGLUniformLocation | null = null;
  private lost = false;
  private lostHandler: (e: Event) => void;
  private restoredHandler: () => void;

  constructor(
    private canvas: HTMLCanvasElement,
    private cbs: RendererCallbacks
  ) {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      preserveDrawingBuffer: true // 保证截图可与当前画面一致
    });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    this.createBuffers();

    this.lostHandler = (e: Event) => {
      e.preventDefault(); // 允许浏览器随后触发 restored
      if (this.lost) return;
      this.lost = true;
      this.program = null;
      this.uTime = null;
      this.vbo = null;
      this.cbs.onLost();
    };
    this.restoredHandler = () => {
      if (!this.lost) return;
      this.lost = false;
      this.createBuffers();
      this.cbs.onRestored();
    };
    canvas.addEventListener('webglcontextlost', this.lostHandler);
    canvas.addEventListener('webglcontextrestored', this.restoredHandler);
  }

  get isLost(): boolean {
    return this.lost;
  }

  private createBuffers(): void {
    const gl = this.gl;
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, VERTICES, gl.STATIC_DRAW);
  }

  private compileShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? '着色器编译失败';
      gl.deleteShader(shader);
      throw new Error(log);
    }
    return shader;
  }

  /** 异步编译，让“迟到编译结果”可通过修订号在状态机中被丢弃 */
  async compile(vertexSource: string, fragmentSource: string): Promise<CompileOutcome> {
    await Promise.resolve(); // 让出一个微任务，模拟真实异步管线
    if (this.lost) return { ok: false, lost: true };
    const gl = this.gl;
    try {
      const vs = this.compileShader(gl.VERTEX_SHADER, vertexSource);
      const fs = this.compileShader(gl.FRAGMENT_SHADER, fragmentSource);
      const program = gl.createProgram()!;
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(program) ?? '程序链接失败';
        gl.deleteProgram(program);
        return { ok: false, message: log };
      }
      if (this.lost) {
        gl.deleteProgram(program);
        return { ok: false, lost: true };
      }
      if (this.program) gl.deleteProgram(this.program);
      this.program = program;
      this.uTime = gl.getUniformLocation(program, 'u_time');
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  /** 绘制一帧；无程序或上下文丢失时跳过 */
  draw(timeSeconds: number): boolean {
    if (this.lost || !this.program || !this.vbo) return false;
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    if (this.uTime) gl.uniform1f(this.uTime, timeSeconds);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  }

  /** 在当前帧立即截图（PNG dataURL） */
  capture(timeSeconds: number): string | null {
    if (this.lost) return null;
    const drawn = this.draw(timeSeconds);
    if (!drawn) return null;
    return this.canvas.toDataURL('image/png');
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.lostHandler);
    this.canvas.removeEventListener('webglcontextrestored', this.restoredHandler);
    // 仅释放资源，不主动 loseContext（开发模式 StrictMode 双挂载时
    // 两个实例共享同一上下文，主动丢失会让后一个实例无法工作）
    if (!this.lost) {
      if (this.program) this.gl.deleteProgram(this.program);
      if (this.vbo) this.gl.deleteBuffer(this.vbo);
    }
    this.program = null;
    this.vbo = null;
  }
}

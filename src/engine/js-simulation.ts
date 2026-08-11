import type { MorphName } from './protocol';

const MAX_NEIGHBOURS = 48;
const GRID_SIZE = 131071;
const CELL = 1.35;
const BOUNDS = 18;
const DT_MAX = 1 / 30;
const SEED = 0x51f15e;

type ForceEvent = { x: number; y: number; age: number; strength: number; mode: 0 | 1 };

export class JsSimulation {
  readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly head = new Int32Array(GRID_SIZE);
  private readonly next: Int32Array;
  private readonly cellX: Int32Array;
  private readonly cellY: Int32Array;
  private readonly cellZ: Int32Array;
  private mouseX = 0;
  private mouseY = 0;
  private mouseActive = false;
  private repel = false;
  private morph: MorphName = 'sphere';
  private time = 0;
  private event: ForceEvent | null = null;
  private _edges = 0;

  constructor(readonly count: number) {
    this.positions = new Float32Array(count * 3);
    this.velocities = new Float32Array(count * 3);
    this.next = new Int32Array(count);
    this.cellX = new Int32Array(count);
    this.cellY = new Int32Array(count);
    this.cellZ = new Int32Array(count);
    this.reset();
  }

  get edges() { return this._edges; }

  reset() {
    let state = SEED >>> 0;
    const rand = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3;
      const u = rand() * 2 - 1;
      const a = rand() * Math.PI * 2;
      const r = 6 + (rand() - 0.5) * 1.8;
      const s = Math.sqrt(Math.max(0, 1 - u * u));
      this.positions[i3] = Math.cos(a) * s * r;
      this.positions[i3 + 1] = u * r;
      this.positions[i3 + 2] = Math.sin(a) * s * r;
      this.velocities[i3] = (rand() - 0.5) * 0.12;
      this.velocities[i3 + 1] = (rand() - 0.5) * 0.12;
      this.velocities[i3 + 2] = (rand() - 0.5) * 0.12;
    }
  }

  setPointer(x: number, y: number, active: boolean, repel: boolean) {
    this.mouseX = x * 11;
    this.mouseY = y * 7;
    this.mouseActive = active;
    this.repel = repel;
  }

  setMorph(shape: MorphName) { this.morph = shape; }
  explode(x: number, y: number) { this.event = { x: x * 11, y: y * 7, age: 0, strength: 34, mode: 1 }; }
  ripple(x: number, y: number) { this.event = { x: x * 11, y: y * 7, age: 0, strength: 15, mode: 0 }; }

  step(dtInput: number) {
    const dt = Math.min(DT_MAX, Math.max(1 / 240, dtInput));
    this.time += dt;
    this.buildGrid();
    let edges = 0;
    const p = this.positions;
    const v = this.velocities;
    const mouseSign = this.repel ? -1 : 1;
    const morphMode = this.morph === 'sphere' ? 0 : this.morph === 'torus' ? 1 : 2;
    const event = this.event;

    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3;
      const x = p[i3], y = p[i3 + 1], z = p[i3 + 2];
      let ax = Math.sin(y * 0.34 + this.time * 0.8) * 0.19 + Math.cos(z * 0.27 - this.time * 0.55) * 0.11;
      let ay = Math.sin(z * 0.31 - this.time * 0.66) * 0.17 + Math.cos(x * 0.29 + this.time * 0.42) * 0.10;
      let az = Math.sin(x * 0.33 + this.time * 0.52) * 0.18 + Math.cos(y * 0.25 - this.time * 0.48) * 0.10;

      let checks = 0;
      const cx = this.cellX[i], cy = this.cellY[i], cz = this.cellZ[i];
      neighbourLoop: for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        let j = this.head[this.hash(cx + dx, cy + dy, cz + dz)];
        while (j !== -1) {
          if (j !== i) {
            const j3 = j * 3;
            const rx = x - p[j3], ry = y - p[j3 + 1], rz = z - p[j3 + 2];
            const d2 = rx * rx + ry * ry + rz * rz + 0.0001;
            if (d2 < 1.82) {
              const inv = 1 / Math.sqrt(d2);
              const repel = (1.82 - d2) * 0.105 * inv;
              ax += rx * repel; ay += ry * repel; az += rz * repel;
              if (d2 < 0.82) edges++;
            }
            checks++;
            if (checks >= MAX_NEIGHBOURS) break neighbourLoop;
          }
          j = this.next[j];
        }
      }

      if (this.mouseActive) {
        const mx = this.mouseX - x, my = this.mouseY - y;
        const md2 = mx * mx + my * my + z * z * 0.24 + 0.3;
        const m = mouseSign * 18 / md2;
        ax += mx * m; ay += my * m; az += -z * m * 0.18;
      }

      const u = (i + 0.5) / this.count;
      const a = i * 2.399963229728653;
      let tx: number, ty: number, tz: number;
      if (morphMode === 0) {
        const sy = 1 - 2 * u, sr = Math.sqrt(Math.max(0, 1 - sy * sy));
        tx = Math.cos(a) * sr * 7; ty = sy * 7; tz = Math.sin(a) * sr * 7;
      } else if (morphMode === 1) {
        const ring = 6.2, tube = 2.0, b = ((i * 37) % this.count) / this.count * Math.PI * 2;
        const rr = ring + tube * Math.cos(b);
        tx = rr * Math.cos(a); ty = tube * Math.sin(b); tz = rr * Math.sin(a);
      } else {
        const gx = ((i % 512) / 511 - 0.5) * 18;
        const gz = (((i / 512) | 0) / Math.max(1, Math.ceil(this.count / 512) - 1) - 0.5) * 13;
        tx = gx; ty = Math.sin(gx * 0.52 + this.time) * 1.6 + Math.cos(gz * 0.58 - this.time * 0.7) * 1.2; tz = gz;
      }
      ax += (tx - x) * 0.075; ay += (ty - y) * 0.075; az += (tz - z) * 0.075;

      if (event) {
        const ex = x - event.x, ey = y - event.y;
        const dist = Math.sqrt(ex * ex + ey * ey + z * z * 0.12) + 0.15;
        const wave = event.mode === 0 ? Math.exp(-Math.abs(dist - event.age * 11) * 1.6) : Math.exp(-dist * 0.24) * Math.exp(-event.age * 1.7);
        const ef = wave * event.strength / dist;
        ax += ex * ef; ay += ey * ef; az += z * ef * 0.35;
      }

      v[i3] = (v[i3] + ax * dt) * 0.986;
      v[i3 + 1] = (v[i3 + 1] + ay * dt) * 0.986;
      v[i3 + 2] = (v[i3 + 2] + az * dt) * 0.986;
      p[i3] = this.wrap(x + v[i3] * dt);
      p[i3 + 1] = this.wrap(y + v[i3 + 1] * dt);
      p[i3 + 2] = this.wrap(z + v[i3 + 2] * dt);
    }
    this._edges = edges >> 1;
    if (this.event) {
      this.event.age += dt;
      if (this.event.age > 1.8) this.event = null;
    }
  }

  private wrap(value: number) {
    if (value > BOUNDS) return value - BOUNDS * 2;
    if (value < -BOUNDS) return value + BOUNDS * 2;
    return value;
  }

  private buildGrid() {
    this.head.fill(-1);
    const p = this.positions;
    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3;
      const cx = Math.floor(p[i3] / CELL), cy = Math.floor(p[i3 + 1] / CELL), cz = Math.floor(p[i3 + 2] / CELL);
      this.cellX[i] = cx; this.cellY[i] = cy; this.cellZ[i] = cz;
      const h = this.hash(cx, cy, cz);
      this.next[i] = this.head[h]; this.head[h] = i;
    }
  }

  private hash(x: number, y: number, z: number) {
    return ((Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) >>> 0) % GRID_SIZE;
  }
}

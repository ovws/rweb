/// <reference lib="webworker" />
import * as THREE from 'three';
import { JsSimulation } from '../engine/js-simulation';
import type { EngineName, MainToWorker, MorphName, WorkerToMain } from '../engine/protocol';

type WasmSim = {
  step(dt: number): void; positions_ptr(): number; positions_len(): number; network_edges(): number;
  set_pointer(x: number, y: number, active: boolean, repel: boolean): void; set_morph(mode: number): void;
  explode(x: number, y: number): void; ripple(x: number, y: number): void; free?: () => void;
};

type WasmApi = { Simulation: new (count: number) => WasmSim; default: (input?: string | URL | Request) => Promise<{ memory: WebAssembly.Memory }> };

let renderer: THREE.WebGLRenderer;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
let geometry: THREE.BufferGeometry;
let jsSim: JsSimulation;
let wasmSim: WasmSim | null = null;
let wasmApi: WasmApi | null = null;
let wasmMemory: WebAssembly.Memory | null = null;
let wasmAvailable = false;
let wasmReason = 'not loaded';
let engine: EngineName = 'js';
let count = 50_000;
let positionView: Float32Array;
let width = 1, height = 1, dpr = 1;
let last = performance.now();
let lastMetric = last;
let frameAccumulator = 0;
let simAccumulator = 0;
let frameCount = 0;
let pointer = { x: 0, y: 0, active: false, repel: false };
let morph: MorphName = 'sphere';

const vertexShader = `
  uniform float uTime;
  attribute float aSeed;
  varying float vGlow;
  void main(){
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float pulse = 1.0 + 0.35 * sin(uTime * 1.3 + aSeed * 18.0);
    gl_PointSize = clamp((2.2 * pulse) * (260.0 / -mv.z), 1.0, 6.0);
    gl_Position = projectionMatrix * mv;
    vGlow = 0.45 + 0.55 * pulse;
  }
`;
const fragmentShader = `
  varying float vGlow;
  void main(){
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p);
    if(d > 0.5) discard;
    float alpha = smoothstep(0.5, 0.02, d) * 0.78;
    vec3 cold = vec3(0.40, 0.70, 1.0);
    vec3 hot = vec3(0.77, 0.94, 1.0);
    gl_FragColor = vec4(mix(cold, hot, vGlow), alpha);
  }
`;

function post(message: WorkerToMain) { self.postMessage(message); }

function initRenderer(canvas: OffscreenCanvas) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(dpr, 1.75)); renderer.setSize(width, height, false);
  scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0x050608, 0.034);
  camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 80); camera.position.set(0, 0, 20);
  geometry = new THREE.BufferGeometry();
  const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: { value: 0 } } });
  points = new THREE.Points(geometry, material); scene.add(points);
  resetSimulation();
  requestAnimationFrame(loop);
}

function createSeeds(n: number) {
  const seeds = new Float32Array(n); let s = 0x714acfe1 >>> 0;
  for (let i = 0; i < n; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; seeds[i] = s / 4294967296; }
  return seeds;
}

function bindGeometry(array: Float32Array) {
  positionView = array;
  geometry.setAttribute('position', new THREE.BufferAttribute(positionView, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(createSeeds(count), 1));
  geometry.setDrawRange(0, count);
  geometry.computeBoundingSphere();
}

function morphCode(shape: MorphName) { return shape === 'sphere' ? 0 : shape === 'torus' ? 1 : 2; }

function resetSimulation() {
  jsSim = new JsSimulation(count);
  if (wasmSim?.free) wasmSim.free();
  wasmSim = null;
  if (wasmAvailable && wasmApi && wasmMemory) {
    try {
      wasmSim = new wasmApi.Simulation(count);
      const ptr = wasmSim.positions_ptr();
      const len = wasmSim.positions_len();
      positionView = new Float32Array(wasmMemory.buffer, ptr, len);
    } catch (error) {
      wasmAvailable = false; wasmReason = `WASM simulation init failed: ${String(error)}`;
      engine = 'js';
    }
  }
  applyStateToSims();
  const array = engine === 'wasm' && wasmSim ? positionView : jsSim.positions;
  bindGeometry(array);
  post({ type: 'engine', engine, wasm: wasmAvailable, reason: wasmReason });
}

function applyStateToSims() {
  jsSim.setPointer(pointer.x, pointer.y, pointer.active, pointer.repel); jsSim.setMorph(morph);
  if (wasmSim) { wasmSim.set_pointer(pointer.x, pointer.y, pointer.active, pointer.repel); wasmSim.set_morph(morphCode(morph)); }
}

async function loadWasm(url: string) {
  try {
    const mod = await import(/* @vite-ignore */ url) as unknown as WasmApi;
    const exports = await mod.default(url.replace(/\.js(?:\?.*)?$/, '_bg.wasm'));
    wasmApi = mod; wasmMemory = exports.memory;
    if (!mod.Simulation || !wasmMemory) throw new Error('Expected wasm-bindgen exports were not found');
    wasmAvailable = true; wasmReason = 'ready';
  } catch (error) {
    wasmAvailable = false; wasmReason = String(error instanceof Error ? error.message : error);
  }
}

function switchEngine(next: EngineName) {
  if (next === 'wasm' && !wasmAvailable) next = 'js';
  engine = next;
  // Reset both implementations on engine switches so each benchmark run starts
  // from the same deterministic particle state instead of a stale inactive sim.
  resetSimulation();
}

function loop(now: number) {
  const frameMs = now - last; const dt = Math.min(frameMs / 1000, 1 / 30); last = now;
  const s0 = performance.now();
  if (engine === 'wasm' && wasmSim && wasmMemory) {
    wasmSim.step(dt);
    if (positionView.buffer !== wasmMemory.buffer) bindGeometry(new Float32Array(wasmMemory.buffer, wasmSim.positions_ptr(), wasmSim.positions_len()));
  } else jsSim.step(dt);
  const simMs = performance.now() - s0;
  (geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  points.rotation.y = Math.sin(now * 0.00009) * 0.09;
  points.rotation.x = Math.cos(now * 0.00007) * 0.04;
  points.material.uniforms.uTime.value = now * 0.001;
  renderer.render(scene, camera);

  frameAccumulator += frameMs; simAccumulator += simMs; frameCount++;
  if (now - lastMetric >= 500) {
    const avgFrame = frameAccumulator / frameCount;
    post({ type: 'metrics', fps: 1000 / avgFrame, frameMs: avgFrame, simulationMs: simAccumulator / frameCount, count, edges: engine === 'wasm' && wasmSim ? wasmSim.network_edges() : jsSim.edges, engine });
    frameAccumulator = 0; simAccumulator = 0; frameCount = 0; lastMetric = now;
  }
  requestAnimationFrame(loop);
}

self.onmessage = async (event: MessageEvent<MainToWorker>) => {
  const m = event.data;
  try {
    if (m.type === 'init') {
      width = m.width; height = m.height; dpr = m.dpr; count = m.count;
      await loadWasm(m.wasmUrl);
      engine = m.engine === 'wasm' && wasmAvailable ? 'wasm' : 'js';
      initRenderer(m.canvas);
      post({ type: 'ready', wasm: wasmAvailable, engine, reason: wasmReason });
    } else if (m.type === 'resize') {
      width = m.width; height = m.height; dpr = m.dpr; renderer.setPixelRatio(Math.min(dpr, 1.75)); renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
    } else if (m.type === 'pointer') {
      pointer = { x: m.x, y: m.y, active: m.active, repel: m.repel }; applyStateToSims();
    } else if (m.type === 'engine') switchEngine(m.engine);
    else if (m.type === 'count') { count = m.count; resetSimulation(); }
    else if (m.type === 'morph') { morph = m.shape; applyStateToSims(); }
    else if (m.type === 'explode') { jsSim.explode(m.x, m.y); wasmSim?.explode(m.x, m.y); }
    else if (m.type === 'ripple') { jsSim.ripple(m.x, m.y); wasmSim?.ripple(m.x, m.y); }
  } catch (error) { post({ type: 'fatal', reason: String(error) }); }
};

export {};

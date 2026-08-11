import './styles.css';
import type { EngineName, MainToWorker, MorphName, WorkerToMain } from './engine/protocol';

const canvas = document.querySelector<HTMLCanvasElement>('#particle-canvas')!;
const shell = document.querySelector<HTMLElement>('#canvas-shell')!;
const fallback = document.querySelector<HTMLElement>('#fallback-visual')!;
const panel = document.querySelector<HTMLElement>('#benchmark-panel')!;
const engineState = document.querySelector<HTMLElement>('#engine-state')!;
const wasmNote = document.querySelector<HTMLElement>('#wasm-note')!;
const metrics = {
  fps: document.querySelector<HTMLElement>('#fps')!, frame: document.querySelector<HTMLElement>('#frame-time')!, sim: document.querySelector<HTMLElement>('#sim-time')!, particles: document.querySelector<HTMLElement>('#particles')!, edges: document.querySelector<HTMLElement>('#edges')!,
};
let worker: Worker | null = null;
let engine: EngineName = 'wasm';
let count = 50_000;
let morphIndex = 0;
const morphs: MorphName[] = ['sphere', 'torus', 'wave'];

function post(message: MainToWorker, transfer?: Transferable[]) { worker?.postMessage(message, transfer ?? []); }
function showFallback(reason: string) {
  canvas.hidden = true; fallback.hidden = false; engineState.textContent = 'STATIC FALLBACK'; wasmNote.textContent = `Compute layer unavailable: ${reason}`;
  document.documentElement.dataset.compute = 'fallback';
}
function resize() {
  const rect = shell.getBoundingClientRect();
  post({ type: 'resize', width: Math.max(1, rect.width), height: Math.max(1, rect.height), dpr: window.devicePixelRatio || 1 });
}
function pointerNorm(event: MouseEvent) {
  const rect = shell.getBoundingClientRect();
  return { x: ((event.clientX - rect.left) / rect.width) * 2 - 1, y: -(((event.clientY - rect.top) / rect.height) * 2 - 1) };
}

function startExperience() {
  if (!('Worker' in window) || !('OffscreenCanvas' in window) || !canvas.transferControlToOffscreen) {
    showFallback('OffscreenCanvas / Worker not supported by this browser'); return;
  }
  try {
    const offscreen = canvas.transferControlToOffscreen();
    worker = new Worker(new URL('./workers/simulation.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }: MessageEvent<WorkerToMain>) => {
      if (data.type === 'fatal') return showFallback(data.reason);
      if (data.type === 'ready' || data.type === 'engine') {
        engine = data.engine;
        engineState.textContent = engine === 'wasm' ? 'RUST WASM' : 'JAVASCRIPT';
        wasmNote.textContent = data.wasm ? 'WASM status: ready · direct memory view in render worker' : `WASM status: unavailable · JS fallback (${data.reason ?? 'unknown'})`;
        document.querySelectorAll<HTMLButtonElement>('[data-engine]').forEach(btn => btn.classList.toggle('active', btn.dataset.engine === engine));
      } else if (data.type === 'metrics') {
        metrics.fps.textContent = data.fps.toFixed(1); metrics.frame.textContent = `${data.frameMs.toFixed(2)} ms`; metrics.sim.textContent = `${data.simulationMs.toFixed(2)} ms`; metrics.particles.textContent = data.count.toLocaleString(); metrics.edges.textContent = data.edges.toLocaleString();
      }
    };
    const rect = shell.getBoundingClientRect();
    const wasmUrl = new URL('wasm/rweb_wasm.js', document.baseURI).href;
    post({ type: 'init', canvas: offscreen, width: rect.width, height: rect.height, dpr: window.devicePixelRatio || 1, wasmUrl, count, engine }, [offscreen]);
  } catch (error) { showFallback(String(error)); }
}

shell.addEventListener('pointermove', event => { const p = pointerNorm(event); post({ type: 'pointer', ...p, active: true, repel: event.altKey }); });
shell.addEventListener('pointerleave', () => post({ type: 'pointer', x: 0, y: 0, active: false, repel: false }));
shell.addEventListener('click', event => { const p = pointerNorm(event); post({ type: 'ripple', ...p }); });
document.querySelector('#explode')?.addEventListener('click', () => post({ type: 'explode', x: 0, y: 0 }));
document.querySelector('#morph')?.addEventListener('click', () => { morphIndex = (morphIndex + 1) % morphs.length; post({ type: 'morph', shape: morphs[morphIndex] }); });
document.querySelector('#bench-toggle')?.addEventListener('click', () => panel.classList.toggle('open'));
document.querySelector('#bench-close')?.addEventListener('click', () => panel.classList.remove('open'));
document.querySelectorAll<HTMLButtonElement>('[data-engine]').forEach(button => button.addEventListener('click', () => { const next = button.dataset.engine as EngineName; post({ type: 'engine', engine: next }); }));
document.querySelectorAll<HTMLButtonElement>('[data-count]').forEach(button => button.addEventListener('click', () => { count = Number(button.dataset.count); document.querySelectorAll<HTMLButtonElement>('[data-count]').forEach(btn => btn.classList.toggle('active', btn === button)); metrics.particles.textContent = count.toLocaleString(); post({ type: 'count', count }); }));
window.addEventListener('resize', resize, { passive: true });

const observer = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) entry.target.classList.add('visible'); }), { threshold: 0.12 });
document.querySelectorAll<HTMLElement>('.content-section, .contact-section').forEach(el => observer.observe(el));
startExperience();

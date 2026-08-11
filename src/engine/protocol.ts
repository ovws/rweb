export type EngineName = 'js' | 'wasm';
export type MorphName = 'sphere' | 'torus' | 'wave';

export type MainToWorker =
  | { type: 'init'; canvas: OffscreenCanvas; width: number; height: number; dpr: number; wasmUrl: string; count: number; engine: EngineName }
  | { type: 'resize'; width: number; height: number; dpr: number }
  | { type: 'pointer'; x: number; y: number; active: boolean; repel: boolean }
  | { type: 'engine'; engine: EngineName }
  | { type: 'count'; count: number }
  | { type: 'explode'; x: number; y: number }
  | { type: 'ripple'; x: number; y: number }
  | { type: 'morph'; shape: MorphName };

export type WorkerToMain =
  | { type: 'ready'; wasm: boolean; engine: EngineName; reason?: string }
  | { type: 'metrics'; fps: number; frameMs: number; simulationMs: number; count: number; edges: number; engine: EngineName }
  | { type: 'engine'; engine: EngineName; wasm: boolean; reason?: string }
  | { type: 'fatal'; reason: string };

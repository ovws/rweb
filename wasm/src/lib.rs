use wasm_bindgen::prelude::*;

const MAX_NEIGHBOURS: usize = 48;
const GRID_SIZE: usize = 131_071;
const CELL: f32 = 1.35;
const BOUNDS: f32 = 18.0;
const DT_MAX: f32 = 1.0 / 30.0;
const SEED: u32 = 0x51f15e;

#[derive(Clone, Copy)]
struct Event { x: f32, y: f32, age: f32, strength: f32, mode: u8 }

#[wasm_bindgen]
pub struct Simulation {
    count: usize,
    positions: Vec<f32>,
    velocities: Vec<f32>,
    head: Vec<i32>,
    next: Vec<i32>,
    cell_x: Vec<i32>,
    cell_y: Vec<i32>,
    cell_z: Vec<i32>,
    mouse_x: f32,
    mouse_y: f32,
    mouse_active: bool,
    repel: bool,
    morph: u8,
    time: f32,
    event: Option<Event>,
    edges: u32,
}

#[wasm_bindgen]
impl Simulation {
    #[wasm_bindgen(constructor)]
    pub fn new(count: usize) -> Simulation {
        let mut sim = Simulation {
            count,
            positions: vec![0.0; count * 3], velocities: vec![0.0; count * 3],
            head: vec![-1; GRID_SIZE], next: vec![-1; count],
            cell_x: vec![0; count], cell_y: vec![0; count], cell_z: vec![0; count],
            mouse_x: 0.0, mouse_y: 0.0, mouse_active: false, repel: false,
            morph: 0, time: 0.0, event: None, edges: 0,
        };
        sim.reset();
        sim
    }

    pub fn reset(&mut self) {
        let mut state = SEED;
        let mut rand = || -> f32 {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            (state as f64 / 4_294_967_296.0) as f32
        };
        for i in 0..self.count {
            let i3 = i * 3;
            let u = rand() * 2.0 - 1.0;
            let a = rand() * std::f32::consts::TAU;
            let r = 6.0 + (rand() - 0.5) * 1.8;
            let s = (1.0 - u * u).max(0.0).sqrt();
            self.positions[i3] = a.cos() * s * r;
            self.positions[i3 + 1] = u * r;
            self.positions[i3 + 2] = a.sin() * s * r;
            self.velocities[i3] = (rand() - 0.5) * 0.12;
            self.velocities[i3 + 1] = (rand() - 0.5) * 0.12;
            self.velocities[i3 + 2] = (rand() - 0.5) * 0.12;
        }
    }

    pub fn positions_ptr(&self) -> *const f32 { self.positions.as_ptr() }
    pub fn positions_len(&self) -> usize { self.positions.len() }
    pub fn network_edges(&self) -> u32 { self.edges }
    pub fn set_pointer(&mut self, x: f32, y: f32, active: bool, repel: bool) { self.mouse_x = x * 11.0; self.mouse_y = y * 7.0; self.mouse_active = active; self.repel = repel; }
    pub fn set_morph(&mut self, morph: u8) { self.morph = morph.min(2); }
    pub fn explode(&mut self, x: f32, y: f32) { self.event = Some(Event { x: x * 11.0, y: y * 7.0, age: 0.0, strength: 34.0, mode: 1 }); }
    pub fn ripple(&mut self, x: f32, y: f32) { self.event = Some(Event { x: x * 11.0, y: y * 7.0, age: 0.0, strength: 15.0, mode: 0 }); }

    pub fn step(&mut self, dt_input: f32) {
        let dt = dt_input.clamp(1.0 / 240.0, DT_MAX);
        self.time += dt;
        self.build_grid();
        let mut edges: u32 = 0;
        let mouse_sign = if self.repel { -1.0 } else { 1.0 };
        let event = self.event;

        for i in 0..self.count {
            let i3 = i * 3;
            let x = self.positions[i3]; let y = self.positions[i3 + 1]; let z = self.positions[i3 + 2];
            let mut ax = (y * 0.34 + self.time * 0.8).sin() * 0.19 + (z * 0.27 - self.time * 0.55).cos() * 0.11;
            let mut ay = (z * 0.31 - self.time * 0.66).sin() * 0.17 + (x * 0.29 + self.time * 0.42).cos() * 0.10;
            let mut az = (x * 0.33 + self.time * 0.52).sin() * 0.18 + (y * 0.25 - self.time * 0.48).cos() * 0.10;

            let cx = self.cell_x[i]; let cy = self.cell_y[i]; let cz = self.cell_z[i];
            let mut checks = 0usize;
            'neighbours: for dz in -1..=1 { for dy in -1..=1 { for dx in -1..=1 {
                let mut j = self.head[hash(cx + dx, cy + dy, cz + dz)];
                while j != -1 {
                    let ju = j as usize;
                    if ju != i {
                        let j3 = ju * 3;
                        let rx = x - self.positions[j3]; let ry = y - self.positions[j3 + 1]; let rz = z - self.positions[j3 + 2];
                        let d2 = rx * rx + ry * ry + rz * rz + 0.0001;
                        if d2 < 1.82 {
                            let inv = 1.0 / d2.sqrt();
                            let repel = (1.82 - d2) * 0.105 * inv;
                            ax += rx * repel; ay += ry * repel; az += rz * repel;
                            if d2 < 0.82 { edges = edges.wrapping_add(1); }
                        }
                        checks += 1;
                        if checks >= MAX_NEIGHBOURS { break 'neighbours; }
                    }
                    j = self.next[ju];
                }
            }}}

            if self.mouse_active {
                let mx = self.mouse_x - x; let my = self.mouse_y - y;
                let md2 = mx * mx + my * my + z * z * 0.24 + 0.3;
                let m = mouse_sign * 18.0 / md2;
                ax += mx * m; ay += my * m; az += -z * m * 0.18;
            }

            let u = (i as f32 + 0.5) / self.count as f32;
            let a = i as f32 * 2.399_963_1;
            let (tx, ty, tz) = match self.morph {
                0 => { let sy = 1.0 - 2.0 * u; let sr = (1.0 - sy * sy).max(0.0).sqrt(); (a.cos() * sr * 7.0, sy * 7.0, a.sin() * sr * 7.0) }
                1 => { let ring = 6.2; let tube = 2.0; let b = ((i * 37) % self.count) as f32 / self.count as f32 * std::f32::consts::TAU; let rr = ring + tube * b.cos(); (rr * a.cos(), tube * b.sin(), rr * a.sin()) }
                _ => { let gx = ((i % 512) as f32 / 511.0 - 0.5) * 18.0; let rows = ((self.count + 511) / 512).max(2); let gz = ((i / 512) as f32 / (rows - 1) as f32 - 0.5) * 13.0; (gx, (gx * 0.52 + self.time).sin() * 1.6 + (gz * 0.58 - self.time * 0.7).cos() * 1.2, gz) }
            };
            ax += (tx - x) * 0.075; ay += (ty - y) * 0.075; az += (tz - z) * 0.075;

            if let Some(ev) = event {
                let ex = x - ev.x; let ey = y - ev.y;
                let dist = (ex * ex + ey * ey + z * z * 0.12).sqrt() + 0.15;
                let wave = if ev.mode == 0 { (-(dist - ev.age * 11.0).abs() * 1.6).exp() } else { (-dist * 0.24).exp() * (-ev.age * 1.7).exp() };
                let ef = wave * ev.strength / dist;
                ax += ex * ef; ay += ey * ef; az += z * ef * 0.35;
            }

            self.velocities[i3] = (self.velocities[i3] + ax * dt) * 0.986;
            self.velocities[i3 + 1] = (self.velocities[i3 + 1] + ay * dt) * 0.986;
            self.velocities[i3 + 2] = (self.velocities[i3 + 2] + az * dt) * 0.986;
            self.positions[i3] = wrap(x + self.velocities[i3] * dt);
            self.positions[i3 + 1] = wrap(y + self.velocities[i3 + 1] * dt);
            self.positions[i3 + 2] = wrap(z + self.velocities[i3 + 2] * dt);
        }
        self.edges = edges >> 1;
        if let Some(mut ev) = self.event { ev.age += dt; self.event = if ev.age > 1.8 { None } else { Some(ev) }; }
    }

    fn build_grid(&mut self) {
        self.head.fill(-1);
        for i in 0..self.count {
            let i3 = i * 3;
            let cx = (self.positions[i3] / CELL).floor() as i32;
            let cy = (self.positions[i3 + 1] / CELL).floor() as i32;
            let cz = (self.positions[i3 + 2] / CELL).floor() as i32;
            self.cell_x[i] = cx; self.cell_y[i] = cy; self.cell_z[i] = cz;
            let h = hash(cx, cy, cz);
            self.next[i] = self.head[h]; self.head[h] = i as i32;
        }
    }
}

#[inline] fn hash(x: i32, y: i32, z: i32) -> usize { (((x.wrapping_mul(73_856_093) ^ y.wrapping_mul(19_349_663) ^ z.wrapping_mul(83_492_791)) as u32) as usize) % GRID_SIZE }
#[inline] fn wrap(value: f32) -> f32 { if value > BOUNDS { value - BOUNDS * 2.0 } else if value < -BOUNDS { value + BOUNDS * 2.0 } else { value } }

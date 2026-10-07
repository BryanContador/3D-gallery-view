// Church generator (Phase 4).
//
// Each church is built in a LOCAL frame inside a THREE.Group, then the group is placed and
// rotated on its island:   x = u (sideways),  z = v (along the church),  +v = entrance.
//
// Structure:  ground floor + 2 balcony levels (always fully built, filled or not),
//             one flight of stairs per level on the entrance side (invisible ramp colliders),
//             stained-glass windows, baked warm lighting, art on the left/back/right walls.
// Capacity:   5 images per wall x 3 walls x 3 levels = 45.
//
// Lighting is "baked" (unlit materials with warm tints, vertex gradients and additive glow
// quads) instead of real lights, so six churches cost nothing in lighting.
import * as THREE from 'three';

export const ASSET_BASE = 'https://bryancontador.github.io/';
export const CAPACITY = 45;

// ---------------------------------------------------------------- dimensions (metres)
const T = 0.8;                                   // wall thickness
const OW = 15, OL = 28;                          // outer half width / half length
const IW = OW - T, IL = OL - T;                  // inner half width / half length
const LEVEL_H = 6, LEVELS = 3;
const WALL_H = LEVEL_H * (LEVELS - 1) + 8;       // 20
const WALL_TOP = WALL_H + 0.3;
const RIDGE = 5;
const DOOR_W = 6, DOOR_H = 6.5;
const DOOR_TRIM_PROUD = 0.1;
const DOOR_TRIM_INSET = 0.2;
const STRIP = 5, SLAB_T = 0.4;                   // balcony width / thickness
const BACK_V = -IL + STRIP;                      // inner edge of the back balcony
const LANE_A = [23.6, IL], LANE_B = [20, 23.6];  // stair lanes along the entrance wall (v ranges)
const U_BASE = -2.4, U_TOP = -12;                // stair flights run between these u values
const STEPS = 16;
const TILE = 4;

// Art slots (centres). Side walls use v in [-27.2, 16]; the back wall spans the full width.
const SLOT_V = [-22.88, -14.24, -5.6, 3.04, 11.68];
const SLOT_U = [-11.36, -5.68, 0, 5.68, 11.36];
const ART_MAX_H = 3.2, ART_CY = 2.4;

// ---------------------------------------------------------------- small helpers
const V = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: (a) => Math.hypot(a[0], a[1], a[2]),
};

function mulberry32(seed) {
    return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const c255 = (v) => Math.max(0, Math.min(255, Math.round(v)));

// Flat quad: origin o, edges du and dv. `face` is a point the front side should look at.
// Optional vertical subdivision (rows) so a vertex-colour gradient (shade) can be baked.
function quadGeo(o, du, dv, face, tw = TILE, th = TILE, rows = 1, shade = null) {
    const n = V.cross(du, dv), nl = V.len(n) || 1;
    const centre = V.add(o, V.mul(V.add(du, dv), 0.5));
    const flip = V.dot(n, V.sub(face, centre)) < 0;
    const nn = V.mul(n, (flip ? -1 : 1) / nl);
    const pos = [], uv = [], col = [], nor = [], idx = [];
    const lu = V.len(du) / tw, lv = V.len(dv) / th;
    for (let r = 0; r <= rows; r++) {
        const t = r / rows;
        for (let s = 0; s <= 1; s++) {
            const p = [o[0] + dv[0] * t + du[0] * s, o[1] + dv[1] * t + du[1] * s, o[2] + dv[2] * t + du[2] * s];
            pos.push(...p); uv.push(s * lu, t * lv); nor.push(...nn);
            col.push(...(shade ? shade(p[1]) : [1, 1, 1]));
        }
    }
    for (let r = 0; r < rows; r++) {
        const a = 2 * r, b = a + 1, c = a + 2, d = a + 3;
        if (flip) idx.push(a, d, b, a, c, d); else idx.push(a, b, d, a, d, c);
    }
    return finish(pos, uv, col, nor, idx);
}

function triGeo(p0, p1, p2, face, tw = TILE, th = TILE, shade = null) {
    const n = V.cross(V.sub(p1, p0), V.sub(p2, p0)), nl = V.len(n) || 1;
    const centre = V.mul(V.add(V.add(p0, p1), p2), 1 / 3);
    const flip = V.dot(n, V.sub(face, centre)) < 0;
    const nn = V.mul(n, (flip ? -1 : 1) / nl);
    const pts = [p0, p1, p2];
    const pos = [], uv = [], col = [], nor = [];
    for (const p of pts) {
        pos.push(...p); uv.push((p[0] + p[2]) / tw, p[1] / th); nor.push(...nn);
        col.push(...(shade ? shade(p[1]) : [1, 1, 1]));
    }
    return finish(pos, uv, col, nor, flip ? [0, 2, 1] : [0, 1, 2]);
}

// Any four points (used for additive light shafts / pools; drawn double-sided).
function freeQuad(p0, p1, p2, p3) {
    const pos = [...p0, ...p1, ...p2, ...p3];
    const uv = [0, 0, 1, 0, 1, 1, 0, 1];
    const nor = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
    return finish(pos, uv, new Array(12).fill(1), nor, [0, 1, 2, 0, 2, 3]);
}

function finish(pos, uv, col, nor, idx) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    return g;
}

// ---------------------------------------------------------------- textures & materials
function tex(size, paint) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    paint(c.getContext('2d'), size);
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}
const px = (ctx, x, y, r, g, b, a = 1) => { ctx.fillStyle = `rgba(${c255(r)},${c255(g)},${c255(b)},${a})`; ctx.fillRect(x, y, 1, 1); };

function blockTexture(base, seed, mortar = 0.55) {
    const rnd = mulberry32(seed);
    return tex(8, (ctx, s) => {
        for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
            const m = (y % 4 === 0) || ((x + (Math.floor(y / 4) % 2) * 4) % 8 === 0);
            const k = m ? mortar : 1 + (rnd() - 0.5) * 0.25;
            px(ctx, x, y, base[0] * k, base[1] * k, base[2] * k);
        }
    });
}

function plankTexture(base, seed) {
    const rnd = mulberry32(seed);
    return tex(8, (ctx, s) => {
        for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
            const k = (y % 3 === 0 ? 0.62 : 1) * (1 + (rnd() - 0.5) * 0.22);
            px(ctx, x, y, base[0] * k, base[1] * k, base[2] * k);
        }
    });
}

function carpetTexture() {
    return tex(8, (ctx, s) => {
        for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
            let c = [135, 22, 28];
            if (x === 0 || x === 7) c = [165, 125, 45];
            else if (x === 1 || x === 6) c = [78, 12, 16];
            else if ((x === 3 || x === 4) && (y === 3 || y === 4)) c = [165, 125, 45];
            px(ctx, x, y, ...c);
        }
    });
}

function glassTexture(seed, pal) {
    const rnd = mulberry32(seed);
    return tex(32, (ctx, s) => {
        for (let cy = 0; cy < 8; cy++) for (let cx = 0; cx < 4; cx++) {
            const c = pal[Math.floor(rnd() * pal.length)];
            const k = 0.8 + rnd() * 0.4;
            for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) {
                const lead = x === 0 || y === 0;
                px(ctx, cx * 8 + x, cy * 4 + y, lead ? 22 : c[0] * k, lead ? 18 : c[1] * k, lead ? 14 : c[2] * k);
            }
        }
    });
}

function glowTexture() {
    return tex(16, (ctx, s) => {
        for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
            const d = Math.hypot(x - 7.5, y - 7.5) / 8;
            const a = Math.pow(Math.max(0, 1 - d), 1.6);
            px(ctx, x, y, 255, 255, 255, a);
        }
    });
}

function labelTexture(w, h, text, font, fg, bg, border) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = border; ctx.lineWidth = 2; ctx.strokeRect(1, 1, w - 2, h - 2);
    ctx.fillStyle = fg; ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 1);
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

const GLASS_PALS = [
    [[190, 30, 40], [40, 70, 190], [210, 170, 40]],
    [[40, 150, 70], [130, 50, 160], [190, 30, 40]],
    [[40, 70, 190], [210, 170, 40], [40, 150, 70]],
    [[130, 50, 160], [190, 30, 40], [40, 120, 180]],
];
export const GLASS_COLORS = [0xd03040, 0x4060e0, 0x40b060, 0xe0b040, 0x9050c0];

// Shared by all churches. Call once.
export function makeChurchAssets() {
    const A = { unitPlane: new THREE.PlaneGeometry(1, 1), unitBox: new THREE.BoxGeometry(1, 1, 1) };
    A.glowTex = glowTexture();
    const B = (o) => new THREE.MeshBasicMaterial({ fog: false, ...o });
    const DS = THREE.DoubleSide;
    A.m = {
        inStone: B({ map: blockTexture([150, 134, 112], 5), color: 0xffd6a0, vertexColors: true }),
        inFloor: B({ map: blockTexture([118, 100, 84], 9, 0.45), color: 0xf0cf9e }),
        inWood:  B({ map: plankTexture([110, 72, 42], 3), color: 0xe0b684 }),
        inWoodDS: B({ map: plankTexture([110, 72, 42], 3), color: 0xe0b684, side: DS }),
        inRoof:  B({ map: plankTexture([70, 46, 30], 4), color: 0xc09a70 }),
        dark:    B({ color: 0x2a2118 }),
        carpet:  B({ map: carpetTexture(), color: 0xffffff }),
        frame:   B({ map: plankTexture([92, 58, 32], 8), color: 0xffffff }),
        flame:   B({ color: 0xffd070 }),
        exStone: new THREE.MeshLambertMaterial({ map: blockTexture([92, 88, 84], 12, 0.6) }),
        exRoof:  new THREE.MeshLambertMaterial({ map: plankTexture([62, 62, 74], 14) }),
        glassIn:  GLASS_PALS.map((p, i) => B({ map: glassTexture(40 + i, p) })),
        glassOut: GLASS_PALS.map((p, i) => new THREE.MeshBasicMaterial({ map: glassTexture(40 + i, p) })),
    };
    const cache = {};
    A.glow = (hex, op) => cache['g' + hex + op] ||
        (cache['g' + hex + op] = B({ map: A.glowTex, color: hex, transparent: true, opacity: op,
            blending: THREE.AdditiveBlending, depthWrite: false, side: DS }));
    A.shaft = (hex) => cache['s' + hex] ||
        (cache['s' + hex] = B({ color: hex, transparent: true, opacity: 0.12,
            blending: THREE.AdditiveBlending, depthWrite: false, side: DS }));
    return A;
}

// ---------------------------------------------------------------- the church
export function buildChurch(scene, world, island, A) {
    const [fx, fz] = island.facing;
    const { cx, cz } = island.site;
    const M = A.m;

    const group = new THREE.Group();
    group.position.set(cx, 0, cz);
    group.rotation.y = Math.atan2(fx, fz);
    group.visible = false;
    scene.add(group);

    const toWorld = (u, v) => ({ x: cx + u * fz + v * fx, z: cz - u * fx + v * fz });
    const collider = (u0, u1, y0, y1, v0, v1) => {
        const a = toWorld(u0, v0), b = toWorld(u1, v1);
        world.boxes.push({ minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minY: y0, maxY: y1,
            minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) });
    };
    const add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); group.add(m); return m; };
    const box = (u, y, v, w, h, d, mat, solid = true) => {
        const m = add(A.unitBox, mat); m.scale.set(w, h, d); m.position.set(u, y, v);
        if (solid) collider(u - w / 2, u + w / 2, y - h / 2, y + h / 2, v - d / 2, v + d / 2);
        return m;
    };
    const wallShade = (y) => { const b = 1 - 0.6 * Math.min(1, Math.max(0, (y - 2) / (WALL_TOP + 2))); return [b, b, b]; };

    // ---- walls: inner plane (baked warm light) + outer plane (world-lit) + collider ----
    const wallPanel = (u0, v0, u1, v1, y0, y1, ox, oz, extA = 0, extB = 0) => {
        const du = [u1 - u0, 0, v1 - v0], L = Math.hypot(du[0], du[2]);
        const d = [du[0] / L, 0, du[2] / L];
        const mid = [(u0 + u1) / 2, (y0 + y1) / 2, (v0 + v1) / 2];
        const rows = Math.max(1, Math.ceil((y1 - y0) / 4));
        add(quadGeo([u0, y0, v0], du, [0, y1 - y0, 0], [mid[0] - ox * 10, mid[1], mid[2] - oz * 10], TILE, TILE, rows, wallShade), M.inStone);
        const a = [u0 + ox * T - d[0] * extA, y0, v0 + oz * T - d[2] * extA];
        const b = [u1 + ox * T + d[0] * extB, y0, v1 + oz * T + d[2] * extB];
        add(quadGeo(a, [b[0] - a[0], 0, b[2] - a[2]], [0, y1 - y0, 0], [mid[0] + ox * 10, mid[1], mid[2] + oz * 10]), M.exStone);
        const us = [u0, u1, a[0], b[0]], vs = [v0, v1, a[2], b[2]];
        collider(Math.min(...us), Math.max(...us), y0, y1, Math.min(...vs), Math.max(...vs));
    };
    wallPanel(-IW, -IL, -IW, IL, 0, WALL_TOP, -1, 0, T, T);                 // left
    wallPanel(IW, -IL, IW, IL, 0, WALL_TOP, 1, 0, T, T);                    // right
    wallPanel(-IW, -IL, IW, -IL, 0, WALL_TOP, 0, -1, T, T);                 // back
    wallPanel(-IW, IL, -DOOR_W / 2, IL, 0, WALL_TOP, 0, 1, T, 0);           // entrance, left of door
    wallPanel(DOOR_W / 2, IL, IW, IL, 0, WALL_TOP, 0, 1, 0, T);             // entrance, right of door
    wallPanel(-DOOR_W / 2, IL, DOOR_W / 2, IL, DOOR_H, WALL_TOP, 0, 1);     // lintel above the door

    // Doorway reveals: the wall's thickness around the opening, so you can't see into the wall.
    for (const s of [-1, 1])
        add(quadGeo([s * DOOR_W / 1, 0, IL], [0, 0, T], [0, DOOR_H, 0], [0, 3, IL + T / 2], 1, 4, 2, wallShade), M.inStone);
    add(quadGeo([-DOOR_W / 2, DOOR_H + 1, IL], [DOOR_W, 0, 0], [0, 0, T], [0, 0, IL + T / 2], 4, 1, 1, wallShade), M.inStone);

    // ---- gables and roof ----
    const apex = WALL_H + RIDGE;
    for (const s of [-1, 1]) {
        add(triGeo([-IW, WALL_TOP, s * IL], [IW, WALL_TOP, s * IL], [0, apex, s * IL], [0, WALL_TOP, 0], TILE, TILE, wallShade), M.inStone);
        add(triGeo([-OW, WALL_TOP, s * OL], [OW, WALL_TOP, s * OL], [0, apex, s * OL], [0, WALL_TOP, s * 100]), M.exStone);
    }
    for (const s of [-1, 1]) {
        const o = [s * OW, WALL_H, -OL], du = [0, 0, 2 * OL], dv = [-s * OW, RIDGE, 0];
        add(quadGeo(o, du, dv, [s * 20, WALL_H + 100, 0]), M.exRoof);
        add(quadGeo([o[0], o[1] - 0.06, o[2]], du, dv, [0, 0, 0], 4, 4), M.inRoof);
    }

    // ---- floor, carpet, dais, altar ----
    add(quadGeo([-IW, 0.02, -IL], [2 * IW, 0, 0], [0, 0, 2 * IL], [0, 10, 0], 2, 2), M.inFloor);
    add(quadGeo([-2, 0.05, -17], [4, 0, 0], [0, 0, IL + 17], [0, 10, 0], 4, 4), M.carpet);
    add(quadGeo([-6, 0.3, -24], [12, 0, 0], [0, 0, 7], [0, 10, 0], 2, 2), M.inFloor);         // dais top
    add(quadGeo([-6, 0.02, -17], [12, 0, 0], [0, 0.28, 0], [0, 0, 10], 2, 2), M.inStone);     // dais front
    collider(-6, 6, -1, 0.3, -24, -17);
    add(quadGeo([-2, 0.32, -22], [4, 0, 0], [0, 0, 5], [0, 10, 0], 4, 4), M.carpet);
    box(0, 0.85, -21.9, 3.6, 1.1, 1.3, M.inWood);                                              // altar
    for (const s of [-1, 1]) {
        box(s * 1.4, 1.65, -21.9, 0.15, 0.5, 0.15, M.flame, false);
        const gl = add(A.unitPlane, A.glow(0xffb040, 0.6)); gl.scale.set(3, 3, 1); gl.position.set(s * 1.4, 1.75, -21.5);
    }

    // ---- pews (solid, jumpable) ----
    for (const s of [-1, 1]) for (let i = 0; i < 9; i++)
        box(s * 5.65, 0.4, -13 + i * 3.2, 5.7, 0.8, 0.9, M.inWood);

    // ---- doorway frame + name sign ----
    const doorTrimDepth = T + 2 * DOOR_TRIM_PROUD + DOOR_TRIM_INSET;
    const doorTrimV = IL + T / 2 - DOOR_TRIM_INSET / 2;
    for (const s of [-1, 1]) box(s * (DOOR_W / 2 + 0.25), DOOR_H / 2, doorTrimV, 0.5, DOOR_H, doorTrimDepth, M.inWood, false);
    box(0, DOOR_H + 0.25, doorTrimV, DOOR_W + 1, 0.5, doorTrimDepth, M.inWood, false);
    const nameMat = new THREE.MeshBasicMaterial({ map: labelTexture(256, 48, island.name, 'bold 24px "Courier New", Courier, monospace', '#e0d6b8', '#17120d', '#8a7a58') });
    add(quadGeo([-3.5, 7.1, OL + 0.05], [7, 0, 0], [0, 1.3, 0], [0, 8, 100], 7, 1.3), nameMat);
    // ---- buttresses (silhouette) ----
    for (const s of [-1, 1]) for (const v of [-20, -8, 4, 16])
        box(s * (OW + 0.6), (WALL_H - 3) / 2, v, 1.2, WALL_H - 3, 1.6, M.exStone);

    // ---- balconies: slabs + rails ----
    const slab = (u0, u1, v0, v1, y) => {
        add(quadGeo([u0, y, v0], [u1 - u0, 0, 0], [0, 0, v1 - v0], [0, y + 10, 0], 2, 2), M.inWoodDS);
        collider(u0, u1, y - SLAB_T, y, v0, v1);
    };
    const rail = (u0, v0, u1, v1, y) => {
        add(quadGeo([u0, y, v0], [u1 - u0, 0, v1 - v0], [0, 1.1, 0], [0, y, 0], 2, 2), M.inWoodDS);
        collider(Math.min(u0, u1) - 0.15, Math.max(u0, u1) + 0.15, y, y + 1.1, Math.min(v0, v1) - 0.15, Math.max(v0, v1) + 0.15);
    };
    for (let lv = 1; lv < LEVELS; lv++) {
        const y = LEVEL_H * lv;
        const leftEnd = lv === 1 ? LANE_B[0] : IL;
        slab(-IW, -IW + STRIP, BACK_V, leftEnd, y);          // left strip
        slab(IW - STRIP, IW, BACK_V, IL, y);                 // right strip
        slab(-IW, IW, -IL, BACK_V, y);                       // back strip
        rail(-IW + STRIP, BACK_V, IW - STRIP, BACK_V, y);    // back rail
        rail(IW - STRIP, BACK_V, IW - STRIP, IL, y);         // right rail
        if (lv === 1) {
            slab(-IW, U_TOP, LANE_B[0], IL, y);                      // landing at the top of flight 1
            rail(-IW + STRIP, BACK_V, -IW + STRIP, LANE_B[0], y);    // left rail
        } else {
            slab(-IW + STRIP, -2.0, LANE_A[0], IL, y);               // loft over flight 1's top
            rail(-IW + STRIP, BACK_V, -IW + STRIP, LANE_A[0], y);    // left rail (gap for the loft)
            rail(-IW + STRIP, LANE_A[0], -4.2, LANE_A[0], y);
            rail(-2.0, LANE_A[0], -2.0, IL, y);
        }
    }

    // ---- stairs: invisible ramp collider + visible steps ----
    // Climbs from (uStart, yStart) to (uEnd, yEnd) inside the lane v0..v1. The ramp sits 0.15 m
    // above the nominal height so feet rest on the step treads.
    const flight = (v0, v1, uStart, yStart, uEnd, yEnd) => {
        const ua = Math.min(uStart, uEnd), ub = Math.max(uStart, uEnd);
        const a = toWorld(ua, v0), b = toWorld(ub, v1);
        const axis = fz !== 0 ? 'x' : 'z';
        const sign = fz !== 0 ? fz : -fx;                       // world direction of increasing u
        const yAtUa = (uStart < uEnd ? yStart : yEnd) + 0.15;
        const yAtUb = (uStart < uEnd ? yEnd : yStart) + 0.15;
        world.ramps.push({
            minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z),
            axis, y0: sign > 0 ? yAtUa : yAtUb, y1: sign > 0 ? yAtUb : yAtUa,
        });
        const steps = new THREE.InstancedMesh(A.unitBox, M.inWood, STEPS);
        const dummy = new THREE.Object3D();
        const h = Math.abs(yEnd - yStart) / STEPS + 0.2;
        for (let i = 0; i < STEPS; i++) {
            const t = (i + 0.5) / STEPS;
            dummy.position.set(uStart + (uEnd - uStart) * t, yStart + (yEnd - yStart) * t + 0.15 - h / 2, (v0 + v1) / 2);
            dummy.scale.set(Math.abs(uEnd - uStart) / STEPS, h, v1 - v0);
            dummy.updateMatrix();
            steps.setMatrixAt(i, dummy.matrix);
        }
        group.add(steps);
    };
    flight(LANE_A[0], LANE_A[1], U_BASE, 0, U_TOP, LEVEL_H);              // ground -> level 1, base by the door
    flight(LANE_B[0], LANE_B[1], U_TOP, LEVEL_H, U_BASE, 2 * LEVEL_H);    // level 1 -> level 2, beside the first

    // ---- stained glass, light shafts and floor pools ----
    const glass = (i, o, du, dv, face, outer) => add(quadGeo(o, du, dv, face), (outer ? M.glassOut : M.glassIn)[i % 4]);
    let wi = 0;
    for (const s of [-1, 1]) {
        for (let k = 0; k < 4; k++) {
            const v = (SLOT_V[k] + SLOT_V[k + 1]) / 2, i = wi++;
            glass(i, [s * (IW - 0.04), 16.4, v - 1.5], [0, 0, 3], [0, 3.4, 0], [0, 18, 0]);
            glass(i, [s * (OW + 0.04), 16.4, v - 1.5], [0, 0, 3], [0, 3.4, 0], [s * 100, 18, 0], true);
            const hex = GLASS_COLORS[i % GLASS_COLORS.length];
            add(freeQuad([s * IW, 16.4, v - 1.5], [s * IW, 16.4, v + 1.5], [s * 3.4, 0.08, v + 2.2], [s * 3.4, 0.08, v - 2.2]), A.shaft(hex));
            add(freeQuad([s * 1.2, 0.09, v - 2.4], [s * 5.6, 0.09, v - 2.4], [s * 5.6, 0.09, v + 2.4], [s * 1.2, 0.09, v + 2.4]), A.glow(hex, 0.45));
        }
    }
    glass(0, [-3, 17.5, -IL + 0.05], [6, 0, 0], [0, 6, 0], [0, 18, 0]);                 // rose window (back)
    glass(0, [-3, 17.5, -OL - 0.05], [6, 0, 0], [0, 6, 0], [0, 18, -100], true);
    glass(2, [-3, 9, IL - 0.05], [6, 0, 0], [0, 7, 0], [0, 12, 0]);                     // above the door
    glass(2, [-3, 9, OL + 0.05], [6, 0, 0], [0, 7, 0], [0, 12, 100], true);

    // ---- chandeliers: warm glow + floor pools ----
    for (const v of [-16, -5.5, 5, 15.5]) {
        box(0, 20, v, 0.08, 8, 0.08, M.dark, false);
        box(0, 16, v, 1.4, 0.3, 1.4, M.dark, false);
        for (const [du, dz] of [[-.5, -.5], [.5, -.5], [-.5, .5], [.5, .5]]) box(du, 16.4, v + dz, 0.2, 0.35, 0.2, M.flame, false);
        for (const r of [0, Math.PI / 2]) { const gl = add(A.unitPlane, A.glow(0xffb040, 0.5)); gl.scale.set(8, 8, 1); gl.position.set(0, 16.4, v); gl.rotation.y = r; }
        add(freeQuad([-7, 0.1, v - 7], [7, 0.1, v - 7], [7, 0.1, v + 7], [-7, 0.1, v + 7]), A.glow(0xff9a30, 0.3));
    }

    // ---- art slots: left wall (entrance -> back), back wall, right wall, per level ----
    const slots = [];
    for (let lv = 0; lv < LEVELS; lv++) {
        const y = LEVEL_H * lv;
        for (let i = 4; i >= 0; i--) slots.push({ y, u: -IW, v: SLOT_V[i], ry: Math.PI / 2, w: 5.4 });
        for (let i = 0; i < 5; i++) slots.push({ y, u: SLOT_U[i], v: -IL, ry: 0, w: 4.4 });
        for (let i = 0; i < 5; i++) slots.push({ y, u: IW, v: SLOT_V[i], ry: -Math.PI / 2, w: 5.4 });
    }
    const images = island.images;
    if (images.length > CAPACITY) console.warn(`"${island.name}" has ${images.length} images but a church holds ${CAPACITY}; extra images are not displayed.`);

    const artworks = [];
    const wallPos = (slot, y, off) => [slot.u + Math.sin(slot.ry) * off, y, slot.v + Math.cos(slot.ry) * off];
    const place = (m, slot, y, off) => { m.position.set(...wallPos(slot, y, off)); m.rotation.y = slot.ry; return m; };

    images.slice(0, CAPACITY).forEach((item, k) => {
        const slot = slots[k];
        const cy = slot.y + ART_CY;
        const frame = place(add(A.unitPlane, M.frame), slot, cy, 0.04);
        const art = place(add(A.unitPlane, new THREE.MeshBasicMaterial({ color: 0x1a1612, fog: false })), slot, cy, 0.07);
        const glow = place(add(A.unitPlane, A.glow(0xffc060, 0.32)), slot, cy, 0.02);
        const lamp = add(A.unitBox, M.dark); lamp.scale.set(0.5, 0.18, 0.45);
        lamp.position.set(...wallPos(slot, slot.y + 4.75, 0.35)); lamp.rotation.y = slot.ry;
        const entry = { item, mesh: art, frame, slot, cy, plaque: null };
        art.userData = { item, islandId: island.id, kind: 'artwork' };
        const layout = (aw, ah) => {
            art.scale.set(aw, ah, 1);
            frame.scale.set(aw + 0.5, ah + 0.5, 1);
            glow.scale.set(aw + 2.8, ah + 2.4, 1);
            if (entry.plaque) { entry.plaque.scale.set(3.2, 0.32, 1); entry.plaque.position.set(...wallPos(slot, Math.max(0.4, cy - ah / 2 - 0.5), 0.07)); }
        };
        entry.layout = layout;
        layout(2.4, 3);
        artworks.push(entry);
    });

    // ---- lazy texture loading (called when the player gets near) ----
    let started = false;
    function load() {
        if (started) return;
        started = true;
        const loader = new THREE.TextureLoader();
        loader.setCrossOrigin('anonymous');
        for (const a of artworks) {
            const url = /^https?:/.test(a.item.thumb) ? a.item.thumb : ASSET_BASE + encodeURI(a.item.thumb);
            loader.load(url, (t) => {
                t.magFilter = THREE.NearestFilter;
                t.minFilter = THREE.NearestFilter;
                t.generateMipmaps = false;
                t.colorSpace = THREE.SRGBColorSpace;
                const iw = t.image.width || 1, ih = t.image.height || 1;
                const s = Math.min(a.slot.w / iw, ART_MAX_H / ih);
                a.mesh.material.map = t;
                a.mesh.material.color.set(0xffffff);
                a.mesh.material.needsUpdate = true;
                const title = a.item.title || 'Untitled';
                const text = title.length > 34 ? title.slice(0, 33) + '…' : title;
                const pm = new THREE.MeshBasicMaterial({ fog: false,
                    map: labelTexture(320, 32, text, 'bold 14px "Courier New", Courier, monospace', '#e3d3a0', '#1a130c', '#7a6a44') });
                a.plaque = add(A.unitPlane, pm);
                a.plaque.rotation.y = a.slot.ry;
                a.layout(iw * s, ih * s);
            }, undefined, () => console.warn('Could not load artwork image:', url));
        }
    }

    return { group, artworks, load, capacity: CAPACITY, overflow: Math.max(0, images.length - CAPACITY) };
}

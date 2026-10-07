// Player: Pointer Lock look, WASD, sprint, jump, gravity and collision.
//
// The player's position `pos` is at the FEET. The camera sits EYE metres above.
// Collision data comes from the world:
//   boxes: [{minX,maxX,minY,maxY,minZ,maxZ}]  solid AABBs (floors, walls, bridges)
//   ramps: [{minX,maxX,minZ,maxZ, axis:'x'|'z', y0, y1}]  walkable slopes (y0 at the
//          min end of the axis, y1 at the max end). These are the "invisible physics ramps".

// --- Body ---
const RADIUS = 0.4;
const HEIGHT = 1.8;
const EYE = 1.65;
const STEP = 0.35;          // ledges up to this height are walked over automatically
const EPS = 0.001;

// --- Movement feel ---
const WALK = 6;
const SPRINT = 12;
const GROUND_ACCEL = 70;
const AIR_ACCEL = 18;
const GRAVITY = 24;
const JUMP = 8;             // ~1.3 m high; sprint jump covers ~8 m, walk jump ~4 m
const TERMINAL = 45;
const COYOTE = 0.1;         // can still jump this long after leaving a ledge
const JUMP_BUFFER = 0.12;   // a jump pressed this early before landing still counts
const FALL_LIMIT = -60;     // below this the player respawns

const BASE_FOV = 70;
const SPRINT_FOV = 78;
const SUBSTEP = 1 / 90;     // physics step; keeps fast falls from skipping thin floors

export class Player {
    constructor(camera, domElement) {
        this.camera = camera;
        this.dom = domElement;
        this.yaw = 0;
        this.pitch = 0;
        this.sensitivity = 0.0022;
        this.camera.rotation.order = 'YXZ';

        this.pos = { x: 0, y: 0, z: 0 };
        this.vel = { x: 0, y: 0, z: 0 };
        this.grounded = false;
        this.sprinting = false;
        this.coyote = 0;
        this.jumpBuffer = 0;
        this.spawn = { x: 0, y: 0, z: 0, yaw: 0 };
        this.boxes = [];
        this.ramps = [];
        this.keys = {};

        document.addEventListener('mousemove', (e) => {
            if (!this.isLocked) return;
            this.yaw -= e.movementX * this.sensitivity;
            this.pitch -= e.movementY * this.sensitivity;
            this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));
        });

        document.addEventListener('keydown', (e) => {
            if (!this.isLocked) return;
            this.keys[e.code] = true;
            if (e.code === 'Space') {
                e.preventDefault();
                if (!e.repeat) this.jumpBuffer = JUMP_BUFFER;
            }
        });
        document.addEventListener('keyup', (e) => { this.keys[e.code] = false; });

        // Never leave keys "stuck" when the mouse is freed or the window loses focus.
        const clearKeys = () => { this.keys = {}; };
        document.addEventListener('pointerlockchange', () => { if (!this.isLocked) clearKeys(); });
        window.addEventListener('blur', clearKeys);
    }

    get isLocked() { return document.pointerLockElement === this.dom; }

    lock() {
        // Browsers can reject a re-lock right after ESC; ignore and let the next click retry.
        const p = this.dom.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
    }

    setWorld(world) {
        this.boxes = world.boxes;
        this.ramps = world.ramps;
        this.spawn = world.spawn;
        this.respawn();
    }

    respawn() {
        const s = this.spawn;
        this.pos.x = s.x; this.pos.y = s.y; this.pos.z = s.z;
        this.vel.x = this.vel.y = this.vel.z = 0;
        if (s.yaw !== undefined) this.yaw = s.yaw;
        this.pitch = 0;
        this.grounded = false;
    }

    // ---------- collision helpers ----------

    _overlapsXZ(c) {
        const p = this.pos;
        return p.x + RADIUS > c.minX && p.x - RADIUS < c.maxX &&
               p.z + RADIUS > c.minZ && p.z - RADIUS < c.maxZ;
    }

    _overlaps(c) {
        const p = this.pos;
        return this._overlapsXZ(c) && p.y + HEIGHT > c.minY + EPS && p.y < c.maxY - EPS;
    }

    // Height of the highest ramp surface under the player's centre (null = none).
    _rampY() {
        const { x, z } = this.pos;
        let best = null;
        for (const r of this.ramps) {
            if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) continue;
            const t = r.axis === 'x'
                ? (x - r.minX) / (r.maxX - r.minX)
                : (z - r.minZ) / (r.maxZ - r.minZ);
            const y = r.y0 + (r.y1 - r.y0) * t;
            if (best === null || y > best) best = y;
        }
        return best;
    }

    _moveAxis(axis, d) {
        if (d === 0) return;
        const p = this.pos;
        p[axis] += d;
        for (const c of this.boxes) {
            if (!this._overlaps(c)) continue;
            // Already inside this box before the move (e.g. a stair ramp lifted us into a balcony
            // floor)? Don't trap the player: let them walk out.
            p[axis] -= d; const wasInside = this._overlaps(c); p[axis] += d;
            if (wasInside) continue;
            if (c.maxY - p.y <= STEP) { p.y = c.maxY; continue; }   // small ledge: step up
            p[axis] -= d;                                           // wall: stop
            this.vel[axis] = 0;
            return;
        }
    }

    _moveVertical(dt, wasGrounded) {
        const p = this.pos, v = this.vel;
        const prevY = p.y;
        const newY = prevY + v.y * dt;

        if (v.y <= 0) {
            // Falling or standing: look for a surface we crossed this step.
            let land = null;
            for (const c of this.boxes) {
                if (!this._overlapsXZ(c)) continue;
                if (c.maxY <= prevY + EPS && c.maxY >= newY - EPS && (land === null || c.maxY > land)) land = c.maxY;
            }
            const sy = this._rampY();
            if (sy !== null) {
                const crossing = sy <= prevY + 0.05 && sy >= newY - EPS;
                const snapping = wasGrounded && Math.abs(sy - prevY) <= 0.5;   // stick to slopes
                if ((crossing || snapping) && (land === null || sy > land)) land = sy;
            }
            if (land !== null) {
                p.y = land; v.y = 0; this.grounded = true;
                return;
            }
            p.y = newY; this.grounded = false;
            return;
        }

        // Rising: check for a ceiling.
        let y = newY;
        for (const c of this.boxes) {
            if (!this._overlapsXZ(c)) continue;
            if (c.minY >= prevY + HEIGHT - EPS && c.minY <= y + HEIGHT + EPS) {
                y = Math.min(y, c.minY - HEIGHT);
                v.y = 0;
            }
        }
        p.y = y; this.grounded = false;
    }

    // ---------- simulation ----------

    _step(dt) {
        const k = this.keys, v = this.vel;
        const wasGrounded = this.grounded;

        let ix = 0, iz = 0;
        if (k.KeyW) iz += 1;
        if (k.KeyS) iz -= 1;
        if (k.KeyD) ix += 1;
        if (k.KeyA) ix -= 1;
        const len = Math.hypot(ix, iz);
        this.sprinting = len > 0 && !!(k.ShiftLeft || k.ShiftRight);

        let tx = 0, tz = 0;
        if (len > 0) {
            const speed = this.sprinting ? SPRINT : WALK;
            const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
            // forward = (-sin, -cos), right = (cos, -sin)
            tx = ((-sin * iz) + (cos * ix)) / len * speed;
            tz = ((-cos * iz) + (-sin * ix)) / len * speed;
        }
        const a = (wasGrounded ? GROUND_ACCEL : AIR_ACCEL) * dt;
        const dx = tx - v.x, dz = tz - v.z, dl = Math.hypot(dx, dz);
        if (dl <= a) { v.x = tx; v.z = tz; }
        else { v.x += dx / dl * a; v.z += dz / dl * a; }

        this.coyote = wasGrounded ? COYOTE : Math.max(0, this.coyote - dt);
        this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
        if (this.jumpBuffer > 0 && this.coyote > 0) {
            v.y = JUMP;
            this.coyote = 0;
            this.jumpBuffer = 0;
            this.grounded = false;
        }
        v.y = Math.max(v.y - GRAVITY * dt, -TERMINAL);

        this._moveAxis('x', v.x * dt);
        this._moveAxis('z', v.z * dt);
        this._moveVertical(dt, wasGrounded && v.y <= 0);

        if (this.pos.y < FALL_LIMIT) this.respawn();
    }

    update(dt) {
        const n = Math.max(1, Math.ceil(dt / SUBSTEP));
        for (let i = 0; i < n; i++) this._step(dt / n);

        this.camera.position.set(this.pos.x, this.pos.y + EYE, this.pos.z);
        this.camera.rotation.set(this.pitch, this.yaw, 0);

        // Subtle FOV kick while sprinting.
        const target = this.sprinting ? SPRINT_FOV : BASE_FOV;
        if (Math.abs(this.camera.fov - target) > 0.05) {
            this.camera.fov += (target - this.camera.fov) * (1 - Math.exp(-8 * dt));
            this.camera.updateProjectionMatrix();
        }
    }
}

// Interaction: centre-screen raycast, kiosks, artwork inspector, teleport and music keys.
import * as THREE from 'three';
import { ASSET_BASE } from './church-builder.js';
import { showToast, setTeleportHint, createInspector } from './ui.js';

const KIOSK_RANGE = 8;     // how close you must be to use a kiosk (metres)
const ART_RANGE = 16;      // how far away you can click an artwork
const ART_NEAR = 30;       // only artworks of churches within this distance are tested

// Ray vs axis-aligned box. Returns the entry distance, or null if the ray misses, the box is
// beyond maxT, or the ray starts inside it.
export function rayBoxEnter(o, d, b, maxT) {
    let tmin = -Infinity, tmax = Infinity;
    const lo = [b.minX, b.minY, b.minZ], hi = [b.maxX, b.maxY, b.maxZ];
    const oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
    for (let i = 0; i < 3; i++) {
        if (Math.abs(dd[i]) < 1e-9) { if (oo[i] < lo[i] || oo[i] > hi[i]) return null; continue; }
        let t1 = (lo[i] - oo[i]) / dd[i], t2 = (hi[i] - oo[i]) / dd[i];
        if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return null;
    }
    if (tmax < 0 || tmin <= 0) return null;
    return tmin <= maxT ? tmin : null;
}

export function initInteraction({ camera, player, world, music }) {
    const crosshair = document.getElementById('crosshair');
    const label = document.getElementById('target-label');
    const ray = new THREE.Raycaster();
    ray.far = ART_RANGE;
    const centre = new THREE.Vector2(0, 0);
    const kioskMeshes = world.kiosks.map(k => k.mesh);
    let hover = null;
    let labelText = '';

    const inspector = createInspector(ASSET_BASE, { onClickAway: () => player.lock() });
    setTeleportHint(world.teleports);

    function candidates() {
        const list = kioskMeshes.slice();
        const { x, z } = player.pos;
        for (const isl of world.islands) {
            if (!isl.group.visible) continue;
            const b = isl.bounds;
            const dx = Math.max(b.minX - x, 0, x - b.maxX), dz = Math.max(b.minZ - z, 0, z - b.maxZ);
            if (dx * dx + dz * dz > ART_NEAR * ART_NEAR) continue;
            for (const a of isl.artworks) list.push(a.mesh);
        }
        return list;
    }

    // Is something solid (a wall, balcony floor, rail...) between the camera and the target?
    function blocked(r, dist) {
        for (const b of world.boxes) {
            const t = rayBoxEnter(r.origin, r.direction, b, dist);
            if (t !== null && t < dist - 0.05) return true;
        }
        return false;
    }

    function describe(obj) {
        const ud = obj.userData;
        if (ud.kind === 'artwork') return ud.item.title || 'Untitled';
        return music.playing ? 'MUSIC KIOSK (click: pause)' : 'MUSIC KIOSK (click: play)';
    }

    // Call once per frame, AFTER rendering (so object matrices are current).
    function update() {
        let target = null;
        if (player.isLocked && !inspector.isOpen) {
            ray.setFromCamera(centre, camera);
            const hits = ray.intersectObjects(candidates(), false);
            if (hits.length) {
                const h = hits[0];
                const range = h.object.userData.kind === 'kiosk' ? KIOSK_RANGE : ART_RANGE;
                if (h.distance <= range && !blocked(ray.ray, h.distance)) target = h.object;
            }
        }
        if (target !== hover) { hover = target; crosshair.classList.toggle('hot', !!hover); }
        const text = hover ? describe(hover) : '';
        if (text !== labelText) { labelText = text; label.textContent = text; }
    }

    // Click on what the crosshair is pointing at.
    document.addEventListener('click', () => {
        if (!player.isLocked || inspector.isOpen || !hover) return;
        const ud = hover.userData;
        if (ud.kind === 'kiosk') music.playKiosk(ud.id);
        else if (ud.kind === 'artwork') inspector.open(ud.item);   // frees the mouse and shows the overlay
    });

    function teleport(n) {
        const t = world.teleports[n];
        if (!t) return;
        player.teleport(t);
        const isl = world.islands.find(i => i.id === t.id);
        if (isl && !isl.loadStarted) { isl.loadStarted = true; isl.load(); }   // start fetching its artwork now
        showToast(`TELEPORT: ${t.name}`);
    }

    document.addEventListener('keydown', (e) => {
        if (e.code === 'ArrowLeft') { music.seekBy(-10); return; }
        if (e.code === 'ArrowRight') { music.seekBy(10); return; }
        if (e.repeat) return;
        if (e.code === 'KeyP') { music.toggle(); return; }
        const m = /^(?:Digit|Numpad)([0-9])$/.exec(e.code);
        if (m && player.isLocked && !inspector.isOpen) teleport(Number(m[1]));
    });

    return { update, teleport, inspector, get hover() { return hover; } };
}

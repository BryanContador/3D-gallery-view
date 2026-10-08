// Phase 5: per-zone fog, distance culling and lazy artwork loading.
//
// FOG is a live settings object. Edit the defaults below, or change values while the game runs
// from the browser console (the game exposes it as `FOG`), for example:
//     FOG.hub = 0.01                  // clearer hub
//     FOG.church_jamol = 0.02         // thicker fog while standing inside Jamol's church
//     FOG.interiorIgnoresFog = false  // church interiors get fogged like everything else
import { setInteriorFog } from './church-builder.js';

export const FOG = {
    default: 0.055,   // bridges and the open void: heavy, oppressive
    hub: 0.025,       // the hub is a little calmer
    rest: 0.025,      // mid-bridge rest platforms
    island: 0.035,    // outdoors on any island (override one with its id, e.g. FOG.jamol)
    church: 0.035,    // density while standing INSIDE a church (override one with FOG.church_<id>)
    interiorIgnoresFog: true,   // true = church interiors stay clear; false = interiors are fogged too
    fade: 1.0,        // how fast fog changes when crossing zones (higher = faster)
    
};

// Culling: a chunk is hidden when its nearest edge is further than this. The distance follows the
// current fog (thinner fog = see further), so nothing visibly pops in or out.
const CULL_MIN = 110;
const CULL_K = 3.2;       // at distance K / density, fog hides 99.99% of an object
const LOAD_DIST = 190;    // start downloading a church's artwork this close

export const stats = { zone: 'hub', cull: CULL_MIN, visible: 0, total: 0 };

const inRect = (r, x, z) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;

function fogTarget(world, x, y, z) {
    for (const c of world.churchZones)
        if (inRect(c, x, z) && y < c.maxY) return { id: 'church_' + c.id, density: FOG['church_' + c.id] ?? FOG.church };
    for (const zone of world.zones)
        if (inRect(zone, x, z)) return { id: zone.id, density: FOG[zone.id] ?? FOG[zone.kind] ?? FOG.default };
    return { id: 'open air', density: FOG.default };
    
}

let appliedIgnore = true;   // church materials start out ignoring fog

export function updateFog(world, scene, player, dt) {
    const { x, y, z } = player.pos;
    const target = fogTarget(world, x, y, z);
    stats.zone = target.id;
    scene.fog.density += (target.density - scene.fog.density) * (1 - Math.exp(-FOG.fade * dt));
    if (appliedIgnore !== FOG.interiorIgnoresFog) {
        appliedIgnore = FOG.interiorIgnoresFog;
        setInteriorFog(world.churchAssets, !appliedIgnore);
    }
}

export function updateCulling(world, player, density) {
    const cull = Math.max(CULL_MIN, CULL_K / Math.max(density, 0.002));
    const c2 = cull * cull;
    const { x, z } = player.pos;
    let visible = 0;
    for (const c of world.cullables) {
        const b = c.bounds;
        const dx = Math.max(b.minX - x, 0, x - b.maxX), dz = Math.max(b.minZ - z, 0, z - b.maxZ);
        c.group.visible = dx * dx + dz * dz < c2;
        if (c.group.visible) visible++;
    }
    stats.cull = cull; stats.visible = visible; stats.total = world.cullables.length;

    // Start downloading a church's artwork once you are near it.
    const l2 = LOAD_DIST * LOAD_DIST;
    for (const isl of world.islands) {
        if (isl.loadStarted) continue;
        const b = isl.bounds;
        const dx = Math.max(b.minX - x, 0, x - b.maxX), dz = Math.max(b.minZ - z, 0, z - b.maxZ);
        if (dx * dx + dz * dz < l2) { isl.loadStarted = true; isl.load(); }
    }
}

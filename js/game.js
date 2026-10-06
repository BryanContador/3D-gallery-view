// Main setup: renderer (PS1 look), scene, fog, loop.
import * as THREE from 'three';
import { Player } from './player.js';
import { buildWorld, updateZones } from './world-builder.js';
import { initHUD, setStartStatus, hideStartScreen } from './ui.js';

// --- PS1 rendering settings ---
const DOWNSCALE = 0.35;
const FOG_COLOR = 0x726B7A; // dark gray-purple
const FOG_DENSITY = 0.035;

const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);

const scene = new THREE.Scene();
scene.background = new THREE.Color(FOG_COLOR);
scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);

const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 600);

scene.add(new THREE.HemisphereLight(0x8a8f99, 0x1a1410, 0.9));
const dirLight = new THREE.DirectionalLight(0xb0a890, 0.5);
dirLight.position.set(20, 40, 10);
scene.add(dirLight);

function resize() {
    const w = Math.max(1, Math.floor(window.innerWidth * DOWNSCALE));
    const h = Math.max(1, Math.floor(window.innerHeight * DOWNSCALE));
    renderer.setSize(w, h, false); // false = don't touch CSS size; CSS stretches the canvas
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const player = new Player(camera, canvas);
initHUD();

// --- Pointer Lock flow ---
document.getElementById('start-button').addEventListener('click', () => {
    hideStartScreen();
    player.lock();
});
canvas.addEventListener('click', () => { if (!player.isLocked) player.lock(); });

// --- Build the world from the CDN data (galleryData comes from the script tag in index.html) ---
let world = null;
if (typeof galleryData === 'undefined') {
    setStartStatus('Could not load data.js from bryancontador.github.io. Check your connection and reload.', false);
} else {
    world = buildWorld(scene, galleryData);
    player.setWorld(world);
    world.islands.forEach(i => console.log(`Island "${i.name}": ${i.images.length} images`));
    setStartStatus(`Data loaded: ${world.islands.length} galleries ready.`, true);
}

// --- Loop ---
const clock = new THREE.Clock();
function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    player.update(dt);
    if (world) updateZones(world, player);
    renderer.render(scene, camera);
}
animate();

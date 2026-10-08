// Music player. NOT spatial: once started, a track plays wherever the player goes.
// Click a red kiosk to play (click the same kiosk's track again to pause/resume).
// Lower-right widget: title, play/pause, time, and a seek bar.
//   Keys:  P = pause/resume    LEFT / RIGHT arrows = back/forward 10 s
//   Mouse: press ESC to free the mouse, then click or drag the bar (click the game to re-lock).

export const AUDIO_LOOP = false;   // true = repeat the track forever

// The placeholder track for every kiosk. To give a kiosk its own song:
//   KIOSK_TRACKS.jamol = { file: 'audio/jamol.mp3', title: 'jamol theme' };
export const DEFAULT_TRACK = { file: 'audio/sticks and stones.mp3', title: 'sticks and stones' };
export const KIOSK_TRACKS = {
    //jamol: { file: 'audio/test.mp3', title: 'jamol test' },
};
export const trackFor = (kioskId) => KIOSK_TRACKS[kioskId] || DEFAULT_TRACK;

export function formatTime(s) {
    if (!isFinite(s) || s < 0) return '0:00';
    s = Math.floor(s);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function initMusic() {
    const $ = (id) => document.getElementById(id);
    const root = $('audio-player'), titleEl = $('audio-title'), toggleBtn = $('audio-toggle');
    const timeEl = $('audio-time'), bar = $('audio-bar'), fill = $('audio-fill');

    const audio = new Audio();
    audio.preload = 'metadata';
    audio.loop = AUDIO_LOOP;
    let current = null;
    let failed = false;

    function render() {
        const dur = audio.duration, cur = audio.currentTime;
        const known = isFinite(dur) && dur > 0;
        fill.style.width = known ? Math.min(100, cur / dur * 100) + '%' : '0%';
        timeEl.textContent = failed ? '--:-- / --:--' : `${formatTime(cur)} / ${known ? formatTime(dur) : '--:--'}`;
        toggleBtn.textContent = audio.paused ? '[ PLAY ]' : '[ PAUSE ]';
    }

    function play() {
        const p = audio.play();
        if (p && p.catch) p.catch(() => { /* blocked or missing file: the error handler explains */ });
    }

    function playTrack(track) {
        if (current && current.file === track.file) { toggle(); return; }   // same song: pause/resume
        current = track; failed = false;
        titleEl.textContent = track.title;
        audio.src = encodeURI(track.file);
        root.hidden = false;
        play();
        render();
    }

    function toggle() {
        if (!current || failed) return;
        if (audio.ended) audio.currentTime = 0;
        if (audio.paused) play(); else audio.pause();
    }

    function seekBy(sec) {
        if (!current || !isFinite(audio.duration)) return;
        audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + sec));
        render();
    }

    function seekToPointer(e) {
        if (!isFinite(audio.duration)) return;
        const r = bar.getBoundingClientRect();
        audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * audio.duration;
        render();
    }

    for (const ev of ['timeupdate', 'seeked', 'loadedmetadata', 'durationchange', 'play', 'pause', 'ended']) audio.addEventListener(ev, render);
    audio.addEventListener('error', () => {
        failed = true;
        titleEl.textContent = `${current ? current.title : 'audio'}  (file not found: ${current ? current.file : ''})`;
        render();
    });

    toggleBtn.addEventListener('click', toggle);
    let dragging = false;
    bar.addEventListener('pointerdown', (e) => { dragging = true; bar.setPointerCapture(e.pointerId); seekToPointer(e); });
    bar.addEventListener('pointermove', (e) => { if (dragging) seekToPointer(e); });
    bar.addEventListener('pointerup', () => { dragging = false; });
    bar.addEventListener('pointercancel', () => { dragging = false; });

    return {
        playKiosk: (id) => playTrack(trackFor(id)),
        toggle, seekBy,
        get hasTrack() { return !!current; },
        get playing() { return !!current && !audio.paused; },
        get title() { return current ? current.title : ''; },
    };
}

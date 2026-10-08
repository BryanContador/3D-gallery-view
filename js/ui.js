// HUD & overlays. Time/weather widget ported from the portfolio's about page.

export function initHUD() {
    // --- Time (Mexico City) ---
    const timeEl = document.getElementById('local-time');
    if (timeEl) {
        const fmt = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Mexico_City',
            hour: '2-digit', minute: '2-digit', hour12: true
        });
        const tick = () => { timeEl.textContent = `My time is: ${fmt.format(new Date())}`; };
        tick();
        setInterval(tick, 1000);
    }

    // --- Weather (Open-Meteo, Morelia coordinates) ---
    const weatherEl = document.getElementById('local-weather');
    if (weatherEl) {
        const lat = 19.7008, lon = -101.1828;
        const weatherMap = {
            0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
            45: 'Foggy', 48: 'Foggy',
            51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
            61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
            71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
            80: 'Rain showers', 81: 'Rain showers', 82: 'Heavy rain showers',
            95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with heavy hail'
        };
        fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`)
            .then(r => r.json())
            .then(data => {
                const { temperature, weathercode } = data.current_weather;
                weatherEl.textContent = `My weather is: ${temperature}°C, ${weatherMap[weathercode] || 'Unknown conditions'}`;
            })
            .catch(err => {
                console.error('Error fetching weather:', err);
                weatherEl.textContent = 'My weather is: Unavailable right now';
            });
    }
}

// Start screen status/button helpers
export function setStartStatus(text, ready) {
    document.getElementById('start-status').textContent = text;
    document.getElementById('start-button').disabled = !ready;
}
export function hideStartScreen() {
    document.getElementById('start-screen').classList.add('hidden');
}

// F3 toggles a small performance readout (bottom left). `read(fps)` returns the text to show.
export function initDebug(read) {
    const el = document.createElement('div');
    el.id = 'debug';
    el.hidden = true;
    Object.assign(el.style, {
        position: 'fixed', left: '14px', bottom: '14px', zIndex: 20, whiteSpace: 'pre',
        font: '12px "Courier New", Courier, monospace', color: '#b9b4a6', textShadow: '1px 1px 0 #000',
        pointerEvents: 'none',
    });
    document.body.appendChild(el);
    window.addEventListener('keydown', (e) => {
        if (e.code === 'F3') { e.preventDefault(); el.hidden = !el.hidden; }
    });
    let frames = 0, last = performance.now();
    return function tick() {
        frames++;
        const now = performance.now();
        if (now - last < 500) return;
        const fps = frames * 1000 / (now - last);
        frames = 0; last = now;
        if (!el.hidden) el.textContent = read(fps);
    };
}

// ---------------------------------------------------------------- Phase 6 overlays
const byId = (id) => document.getElementById(id);

let toastTimer = 0;
export function showToast(text) {
    const el = byId('toast');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
}

// "TELEPORT: 0 HUB | 1 SUNSHINE | ..." under the controls line (digit keys 0-9 only).
export function setTeleportHint(targets) {
    const el = byId('teleport-hint');
    if (el) el.textContent = 'TELEPORT: ' + targets.slice(0, 10).map((t, i) => `${i} ${t.name}`).join(' | ');
}

// Turn plain text into DOM nodes, making http(s) links clickable (never inserts HTML).
export function appendLinkified(parent, text) {
    text.split(/(https?:\/\/[^\s]+)/g).forEach((part, i) => {
        if (i % 2 === 1) {
            const a = document.createElement('a');
            a.href = part; a.textContent = part; a.target = '_blank'; a.rel = 'noopener noreferrer';
            parent.appendChild(a);
        } else if (part) {
            parent.appendChild(document.createTextNode(part));
        }
    });
}

// Full-screen artwork viewer. Opening it frees the mouse; clicking outside the panel closes it
// and calls onClickAway (the game uses that to lock the mouse again). ESC closes without re-locking.
// An image's `altSources` (alternate versions, sketches, back sides...) appear as numbered buttons
// to the left of the image: 1 = the main high-res, 2.. = the alternates. (The arrow keys are
// reserved for seeking the music, so versions are switched with the buttons.)
export function createInspector(assetBase, { onClickAway }) {
    const root = byId('inspector');
    const img = byId('inspector-img'), loading = byId('inspector-loading');
    const title = byId('inspector-title'), desc = byId('inspector-desc');
    const versionsEl = byId('inspector-versions'), hint = byId('inspector-hint');
    let open = false, token = 0, sources = [], current = 0, thumb = '';

    const url = (path) => /^https?:/.test(path) ? path : assetBase + encodeURI(path);

    function showImage(index) {
        current = index;
        const mine = ++token;
        let triedThumb = false;
        img.classList.remove('ready'); img.removeAttribute('src');
        loading.classList.remove('done'); loading.textContent = 'LOADING...';
        img.onload = () => { if (mine !== token) return; img.classList.add('ready'); loading.classList.add('done'); };
        img.onerror = () => {
            if (mine !== token) return;
            // Only the main image falls back to the thumbnail; an alternate that fails just says so.
            if (index === 0 && !triedThumb && thumb) { triedThumb = true; img.src = url(thumb); return; }
            loading.textContent = 'COULD NOT LOAD IMAGE';
        };
        img.src = url(sources[index]);
        Array.from(versionsEl.children).forEach((b, i) => b.classList.toggle('active', i === index));
    }

    function show(item) {
        title.textContent = item.title || 'Untitled';
        desc.textContent = '';
        const d = (item.description || '').trim();
        if (d && d.toLowerCase() !== 'no description') appendLinkified(desc, d);

        thumb = item.thumb || '';
        sources = [item.highRes || item.thumb].concat(Array.isArray(item.altSources) ? item.altSources : []).filter(Boolean);

        versionsEl.textContent = '';
        versionsEl.hidden = sources.length < 2;
        if (sources.length > 1) sources.forEach((_, i) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = String(i + 1);
            b.title = i === 0 ? `Main image (1 of ${sources.length})` : `Version ${i + 1} of ${sources.length}`;
            b.addEventListener('click', () => showImage(i));
            versionsEl.appendChild(b);
        });
        hint.textContent = sources.length > 1
            ? 'CLICK OUTSIDE TO CLOSE | NUMBERS ON THE LEFT: SWITCH VERSION'
            : 'CLICK OUTSIDE TO CLOSE';

        showImage(0);
        root.classList.add('open');
        open = true;
        document.exitPointerLock();
    }

    function close() {
        if (!open) return;
        open = false; token++;
        root.classList.remove('open');
        img.removeAttribute('src');
    }

    root.addEventListener('click', (e) => {
        if (e.target !== root) return;      // clicks on the panel itself do nothing
        close();
        if (onClickAway) onClickAway();
    });
    document.addEventListener('keydown', (e) => { if (open && e.code === 'Escape') close(); });

    return { open: show, close, get isOpen() { return open; } };
}

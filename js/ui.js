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

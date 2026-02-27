// Dawn Patrol - Morning Activity Advisor
// Helps decide: Surf, Cycle, or Sunrise Photos
// Version 3.0 - Using Open-Meteo Marine for wave data

(function() {
    'use strict';

    console.log('Dawn Patrol v3.1 loaded');

    // ============================================
    // Configuration
    // ============================================
    const CONFIG = {
        // Ventnor, NJ coordinates (home base)
        latitude: 39.3404,
        longitude: -74.4774,

        // Surf spots with Surfline IDs
        surfSpots: [
            { name: 'Ventnor Pier', id: '5842041f4e65fad6a7708a09', lat: 39.3404, lng: -74.4774 },
            { name: 'Atlantic City', id: '5842041f4e65fad6a7708a0d', lat: 39.3643, lng: -74.4229 },
            { name: 'Ocean City', id: '5842041f4e65fad6a770886d', lat: 39.2776, lng: -74.5746 },
            { name: 'Brigantine', id: '5842041f4e65fad6a7708a0b', lat: 39.4101, lng: -74.3645 }
        ],

        // Morning hours to check (6 AM - 9 AM)
        morningStartHour: 6,
        morningEndHour: 9,

        // Cycling directions
        directions: {
            longport: 'Longport (South)',
            atlanticCity: 'Atlantic City (North)'
        }
    };

    // ============================================
    // API Endpoints
    // ============================================
    const API = {
        // Using ECMWF model - generally most accurate global model
        openMeteo: (lat, lng) =>
            `https://api.open-meteo.com/v1/ecmwf?latitude=${lat}&longitude=${lng}&hourly=temperature_2m,relative_humidity_2m,cloud_cover,wind_speed_10m,wind_direction_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America/New_York&forecast_days=2`,

        sunrise: (lat, lng, date) =>
            `https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lng}&date=${date}&formatted=0`,

        // NOAA Tides & Currents API - Atlantic City station 8534720
        noaaTides: (beginDate, endDate) =>
            `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?begin_date=${beginDate}&end_date=${endDate}&station=8534720&product=predictions&datum=MLLW&time_zone=lst_ldt&interval=hilo&units=english&format=json`,

        // NOAA water temp - Cape May station 8536110 (has water temp sensors)
        noaaWaterTemp: () =>
            `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?date=latest&station=8536110&product=water_temperature&units=english&time_zone=lst_ldt&format=json`,

        // Open-Meteo Marine API for wave data (free, no CORS issues)
        marineWaves: (lat, lng) =>
            `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lng}&hourly=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period&timezone=America/New_York&forecast_days=2&length_unit=imperial`
    };

    // ============================================
    // State
    // ============================================
    let state = {
        weather: null,
        sunrise: null,
        marineData: null,
        noaaTides: null,
        waterTempData: null,
        scores: {
            surf: 0,
            photo: 0,
            cycle: 0
        },
        recommendation: null
    };

    // ============================================
    // Utility Functions
    // ============================================
    function formatLocalDate(date) {
        // Format date as YYYY-MM-DD in LOCAL time (not UTC)
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function getTomorrowDate() {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        return formatLocalDate(tomorrow);
    }

    function formatTime(date) {
        return new Date(date).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    }

    function formatDateTime(date) {
        return new Date(date).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
    }

    function degreesToCardinal(degrees) {
        const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                           'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
        const index = Math.round(degrees / 22.5) % 16;
        return directions[index];
    }

    function getMorningHourIndex(hourlyTimes, targetDate) {
        // Find the index for tomorrow morning (6-9 AM)
        for (let i = 0; i < hourlyTimes.length; i++) {
            const time = new Date(hourlyTimes[i]);
            const dateStr = formatLocalDate(time);
            const hour = time.getHours();

            if (dateStr === targetDate && hour >= CONFIG.morningStartHour && hour <= CONFIG.morningEndHour) {
                return i;
            }
        }
        return -1;
    }

    // ============================================
    // API Fetching
    // ============================================
    async function fetchWeather() {
        try {
            const response = await fetch(API.openMeteo(CONFIG.latitude, CONFIG.longitude));
            if (!response.ok) throw new Error('Weather API failed');
            return await response.json();
        } catch (error) {
            console.error('Weather fetch error:', error);
            throw error;
        }
    }

    async function fetchSunrise() {
        try {
            const tomorrow = getTomorrowDate();
            const response = await fetch(API.sunrise(CONFIG.latitude, CONFIG.longitude, tomorrow));
            if (!response.ok) throw new Error('Sunrise API failed');
            return await response.json();
        } catch (error) {
            console.error('Sunrise fetch error:', error);
            throw error;
        }
    }

    async function fetchNoaaTides() {
        try {
            const today = new Date();
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);

            // Format dates as YYYYMMDD for NOAA API
            const beginDate = formatLocalDate(today).replace(/-/g, '');
            const endDate = formatLocalDate(tomorrow).replace(/-/g, '');

            const response = await fetch(API.noaaTides(beginDate, endDate));
            if (!response.ok) throw new Error('NOAA Tides API failed');
            return await response.json();
        } catch (error) {
            console.error('NOAA Tides fetch error:', error);
            return null;
        }
    }

    async function fetchWaterTemp() {
        try {
            const response = await fetch(API.noaaWaterTemp());
            if (!response.ok) throw new Error('NOAA water temp API failed');
            return await response.json();
        } catch (error) {
            console.error('Water temp fetch error:', error);
            return null;
        }
    }

    async function fetchMarineData() {
        // Fetch wave data from Open-Meteo Marine API (single location for the area)
        try {
            const response = await fetch(API.marineWaves(CONFIG.latitude, CONFIG.longitude));
            if (!response.ok) throw new Error('Marine API failed');
            return await response.json();
        } catch (error) {
            console.error('Marine data fetch error:', error);
            return null;
        }
    }

    // ============================================
    // Scoring Functions
    // ============================================
    function calculateSurfScore(marineData, weatherData) {
        // Uses Open-Meteo Marine API data
        if (!marineData || !marineData.hourly) {
            return { score: 0, details: 'No data available' };
        }

        const tomorrow = getTomorrowDate();
        const times = marineData.hourly.time;
        const waveHeights = marineData.hourly.wave_height || [];
        const wavePeriods = marineData.hourly.wave_period || [];
        const waveDirections = marineData.hourly.wave_direction || [];
        const swellHeights = marineData.hourly.swell_wave_height || [];
        const swellPeriods = marineData.hourly.swell_wave_period || [];
        const swellDirections = marineData.hourly.swell_wave_direction || [];

        // Find morning index for tomorrow
        let morningIndex = -1;
        for (let i = 0; i < times.length; i++) {
            const time = new Date(times[i]);
            const dateStr = formatLocalDate(time);
            const hour = time.getHours();

            if (dateStr === tomorrow && hour >= CONFIG.morningStartHour && hour <= CONFIG.morningEndHour) {
                morningIndex = i;
                break;
            }
        }

        if (morningIndex === -1) {
            return { score: 0, details: 'No forecast data' };
        }

        // Get wave data for morning
        const waveHeight = waveHeights[morningIndex] || 0;
        const swellHeight = swellHeights[morningIndex] || waveHeight;
        const period = swellPeriods[morningIndex] || wavePeriods[morningIndex] || 0;
        const direction = swellDirections[morningIndex] || waveDirections[morningIndex] || 0;

        // Wave height score (in feet)
        let heightScore;
        if (waveHeight < 1) heightScore = 1;
        else if (waveHeight < 2) heightScore = 3;
        else if (waveHeight < 3) heightScore = 5;
        else if (waveHeight < 4) heightScore = 7;
        else if (waveHeight < 5) heightScore = 9;
        else if (waveHeight < 6) heightScore = 10;
        else if (waveHeight < 8) heightScore = 8;
        else heightScore = 6; // Too big

        // Period score
        let periodScore;
        if (period < 5) periodScore = 2;
        else if (period < 7) periodScore = 4;
        else if (period < 9) periodScore = 6;
        else if (period < 11) periodScore = 8;
        else periodScore = 10;

        // Wind score from weather data
        let windScore = 5;
        if (weatherData && weatherData.hourly) {
            const wxIndex = getMorningHourIndex(weatherData.hourly.time, tomorrow);
            if (wxIndex !== -1) {
                const windSpeed = weatherData.hourly.wind_speed_10m[wxIndex] || 0;
                const windDir = weatherData.hourly.wind_direction_10m[wxIndex] || 0;

                // For NJ coast, offshore is W-NW (250-320 degrees)
                const isOffshore = windDir >= 250 && windDir <= 320;
                const isLightWind = windSpeed < 8;

                if (isOffshore && isLightWind) windScore = 10;
                else if (isOffshore) windScore = 8;
                else if (isLightWind) windScore = 7;
                else if (windSpeed < 15) windScore = 4;
                else windScore = 2;
            }
        }

        // Calculate final score
        const finalScore = Math.round((heightScore * 0.4) + (periodScore * 0.3) + (windScore * 0.3));

        // Build details string
        const heightStr = `${waveHeight.toFixed(1)}ft`;
        const periodStr = period > 0 ? `${Math.round(period)}s` : '';
        const dirStr = degreesToCardinal(direction);

        return {
            score: Math.min(10, Math.max(1, finalScore)),
            waveHeight: waveHeight,
            details: `${heightStr} @ ${periodStr} ${dirStr}`,
            period: period,
            direction: direction,
            heightScore,
            periodScore,
            windScore
        };
    }

    function calculatePhotoScore(weather, sunriseData) {
        const tomorrow = getTomorrowDate();
        const hourIndex = getMorningHourIndex(weather.hourly.time, tomorrow);

        if (hourIndex === -1) {
            return { score: 0, details: 'No data', verdict: 'No data available', cloudCover: 0 };
        }

        const cloudCover = weather.hourly.cloud_cover[hourIndex];
        const humidity = weather.hourly.relative_humidity_2m?.[hourIndex] || 50;

        // Sunrise photo scoring based on total cloud cover (ECMWF model)
        // Best conditions: 20-60% clouds (some clouds to catch color, but not overcast)
        // Good: 10-20% or 60-80%
        // Poor: <10% (clear) or >80% (overcast)

        let score;
        let verdict;

        if (cloudCover >= 20 && cloudCover <= 60) {
            score = 8 + Math.round((40 - Math.abs(cloudCover - 40)) / 20); // 8-10
            verdict = 'Good cloud cover for colorful sunrise';
        } else if (cloudCover >= 10 && cloudCover < 20) {
            score = 6;
            verdict = 'Light clouds - some color potential';
        } else if (cloudCover > 60 && cloudCover <= 80) {
            score = 5;
            verdict = 'Heavy clouds - may get some color';
        } else if (cloudCover < 10) {
            score = 4;
            verdict = 'Clear sky - pretty but no cloud color';
        } else {
            score = 2;
            verdict = 'Overcast - unlikely to see color';
        }

        return {
            score,
            cloudCover,
            humidity,
            verdict
        };
    }

    function calculateCycleScore(weather) {
        const tomorrow = getTomorrowDate();
        const hourIndex = getMorningHourIndex(weather.hourly.time, tomorrow);

        if (hourIndex === -1) {
            return { score: 0, details: 'No data', direction: null };
        }

        const windSpeed = weather.hourly.wind_speed_10m[hourIndex];
        const windDirection = weather.hourly.wind_direction_10m[hourIndex];
        const temp = weather.hourly.temperature_2m[hourIndex];
        const weatherCode = weather.hourly.weather_code[hourIndex];

        // Wind speed score (>15 mph is a no-go)
        let windScore;
        if (windSpeed < 8) windScore = 10;
        else if (windSpeed < 12) windScore = 8;
        else if (windSpeed <= 15) windScore = 5;
        else windScore = 1; // >15 mph = no go

        // Weather score (based on WMO codes)
        let weatherScore;
        if (weatherCode <= 3) weatherScore = 10; // Clear to partly cloudy
        else if (weatherCode <= 49) weatherScore = 7; // Fog, drizzle
        else if (weatherCode <= 59) weatherScore = 3; // Rain
        else weatherScore = 0; // Heavy rain, snow, etc.

        // Temperature score
        let tempScore;
        if (temp >= 55 && temp <= 75) tempScore = 10;
        else if ((temp >= 45 && temp < 55) || (temp > 75 && temp <= 85)) tempScore = 7;
        else tempScore = 3;

        const finalScore = Math.round((windScore * 0.4) + (weatherScore * 0.3) + (tempScore * 0.3));

        // Determine cycling direction
        // Wind direction is where it comes FROM
        // North wind (315-45): Ride to AC first, return with wind at back
        // South wind (135-225): Ride to Longport first, return with wind at back
        let direction;
        let directionText;

        const normalizedDir = ((windDirection % 360) + 360) % 360;

        if ((normalizedDir >= 315 || normalizedDir <= 45)) {
            // North wind - go north first (AC)
            direction = 'ac';
            directionText = 'Go to Atlantic City first, wind at your back coming home';
        } else if (normalizedDir >= 135 && normalizedDir <= 225) {
            // South wind - go south first (Longport)
            direction = 'longport';
            directionText = 'Go to Longport first, wind at your back coming home';
        } else {
            // East or West - either way
            direction = 'either';
            directionText = 'Wind is cross-shore, either direction works';
        }

        return {
            score: Math.min(10, Math.max(1, finalScore)),
            windSpeed: Math.round(windSpeed),
            windDirection: normalizedDir,
            windCardinal: degreesToCardinal(normalizedDir),
            temp: Math.round(temp),
            direction,
            directionText
        };
    }

    function getRecommendation(scores, surfScoreData, cycleData) {
        const { surf, photo, cycle } = scores;

        // Find best activity
        const activities = [
            { name: 'surf', score: surf, label: 'GO SURF' },
            { name: 'photo', score: photo, label: 'SUNRISE PHOTOS' },
            { name: 'cycle', score: cycle, label: 'GO CYCLING' }
        ];

        activities.sort((a, b) => b.score - a.score);
        const best = activities[0];

        // Build recommendation
        let detail = '';
        if (best.name === 'surf' && surfScoreData) {
            detail = surfScoreData.details;
        } else if (best.name === 'cycle' && cycleData.directionText) {
            detail = cycleData.directionText;
        } else if (best.name === 'photo') {
            detail = 'Get up early and find your spot';
        }

        // If all scores are low, suggest sleeping in
        if (best.score < 4) {
            return {
                activity: 'SLEEP IN',
                detail: 'Nothing looks great tomorrow',
                icon: '&#128564;'
            };
        }

        const icons = {
            surf: '&#127940;',
            photo: '&#128247;',
            cycle: '&#128690;'
        };

        return {
            activity: best.label,
            detail,
            icon: icons[best.name]
        };
    }

    // ============================================
    // Main Data Loading
    // ============================================
    async function loadAllData() {
        showLoading();

        try {
            // Fetch all data in parallel
            const [weather, sunriseData, noaaTides, waterTempData, marineData] = await Promise.all([
                fetchWeather(),
                fetchSunrise(),
                fetchNoaaTides(),
                fetchWaterTemp(),
                fetchMarineData()
            ]);

            state.weather = weather;
            state.sunrise = sunriseData;
            state.noaaTides = noaaTides;
            state.waterTempData = waterTempData;
            state.marineData = marineData;

            // Calculate scores
            calculateAllScores();

            // Update UI
            updateUI();

            showContent();

        } catch (error) {
            console.error('Error loading data:', error);
            showError('Failed to load forecast data. Please try again.');
        }
    }

    function calculateAllScores() {
        // Calculate surf score using Open-Meteo marine data
        const surfScoreData = calculateSurfScore(state.marineData, state.weather);
        state.scores.surf = surfScoreData.score;
        state.surfScoreData = surfScoreData;

        // Calculate photo score
        const photoData = calculatePhotoScore(state.weather, state.sunrise);
        state.scores.photo = photoData.score;
        state.photoData = photoData;

        // Calculate cycle score
        const cycleData = calculateCycleScore(state.weather);
        state.scores.cycle = cycleData.score;
        state.cycleData = cycleData;

        // Get recommendation
        state.recommendation = getRecommendation(state.scores, surfScoreData, cycleData);
    }

    // ============================================
    // UI Updates
    // ============================================
    function showLoading() {
        document.getElementById('loading').style.display = 'block';
        document.getElementById('error').style.display = 'none';
        document.getElementById('content').style.display = 'none';
    }

    function showError(message) {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('error').style.display = 'block';
        document.getElementById('content').style.display = 'none';
        document.querySelector('.error-message').textContent = message;
    }

    function showContent() {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('error').style.display = 'none';
        document.getElementById('content').style.display = 'block';
    }

    function updateUI() {
        // Sunrise time
        if (state.sunrise && state.sunrise.results) {
            const sunriseTime = formatTime(state.sunrise.results.sunrise);
            document.getElementById('sunrise-time').textContent = `Sunrise: ${sunriseTime}`;
        }

        // Recommendation
        const rec = state.recommendation;
        document.getElementById('rec-activity').innerHTML = `${rec.icon} ${rec.activity}`;
        document.getElementById('rec-detail').textContent = rec.detail;

        // Conditions Summary
        // Air temp (from cycling data which uses Open-Meteo)
        if (state.cycleData && state.cycleData.temp) {
            document.getElementById('summary-air-temp').textContent = `${state.cycleData.temp}°F`;
        }

        // Water temp from NOAA
        if (state.waterTempData && state.waterTempData.data && state.waterTempData.data.length > 0) {
            const waterTemp = Math.round(parseFloat(state.waterTempData.data[0].v));
            document.getElementById('summary-water-temp').textContent = `${waterTemp}°F`;
            // Also update state for surf card
            state.waterTempNoaa = waterTemp;
        }

        // Tides from NOAA
        if (state.noaaTides && state.noaaTides.predictions) {
            const tideStr = getNoaaTideInfo(state.noaaTides.predictions);
            document.getElementById('summary-tides').textContent = tideStr;
        }

        // Surf card
        document.getElementById('surf-score').textContent = state.scores.surf;
        updateScoreColor('surf-card', state.scores.surf);

        if (state.surfScoreData) {
            document.getElementById('surf-best-spot').textContent = `Ventnor Area`;
            document.getElementById('surf-conditions').textContent = state.surfScoreData.details;

            // Get tide info from NOAA
            let tideInfo = 'Check tide times';
            if (state.noaaTides && state.noaaTides.predictions) {
                tideInfo = getNoaaTideInfo(state.noaaTides.predictions);
                if (tideInfo === '--') tideInfo = 'Check tide times';
            }
            document.getElementById('surf-tide').textContent = tideInfo;

            // Water temp from NOAA
            if (state.waterTempNoaa) {
                document.getElementById('surf-water-temp').textContent = `Water: ${state.waterTempNoaa}°F`;
            }

            // Air temp from cycling data (Open-Meteo)
            if (state.cycleData && state.cycleData.temp) {
                document.getElementById('surf-air-temp').textContent = `Air: ${state.cycleData.temp}°F`;
            }

            // Show wave breakdown instead of forecaster headline
            const breakdown = `Height: ${state.surfScoreData.heightScore}/10 | Period: ${state.surfScoreData.periodScore}/10 | Wind: ${state.surfScoreData.windScore}/10`;
            document.getElementById('surf-forecast').textContent = breakdown;
        }

        // Photo card
        document.getElementById('photo-score').textContent = state.scores.photo;
        updateScoreColor('photo-card', state.scores.photo);
        document.getElementById('photo-clouds').textContent = `Cloud cover: ${state.photoData.cloudCover}%`;
        document.getElementById('photo-humidity').textContent = `Model: ECMWF`;
        document.getElementById('photo-verdict').textContent = state.photoData.verdict;

        // Cycle card
        document.getElementById('cycle-score').textContent = state.scores.cycle;
        updateScoreColor('cycle-card', state.scores.cycle);
        document.getElementById('cycle-wind').textContent =
            `Wind: ${state.cycleData.windSpeed} mph ${state.cycleData.windCardinal}`;
        document.getElementById('cycle-temp').textContent = `Temperature: ${state.cycleData.temp}°F`;
        document.querySelector('.direction-text').textContent = state.cycleData.directionText;

        // Update direction arrow
        const dirIcon = document.querySelector('.direction-icon');
        if (state.cycleData.direction === 'ac') {
            dirIcon.innerHTML = '&#8593;'; // Up arrow (north)
        } else if (state.cycleData.direction === 'longport') {
            dirIcon.innerHTML = '&#8595;'; // Down arrow (south)
        } else {
            dirIcon.innerHTML = '&#8596;'; // Both ways
        }

        // Last updated
        document.getElementById('last-updated').textContent = formatDateTime(new Date());
    }

    function updateScoreColor(cardId, score) {
        const card = document.getElementById(cardId);
        card.classList.remove('score-low', 'score-medium', 'score-high');

        if (score >= 7) {
            card.classList.add('score-high');
        } else if (score >= 5) {
            card.classList.add('score-medium');
        } else {
            card.classList.add('score-low');
        }
    }

    function getTideInfo(surfData) {
        if (!surfData || !surfData.tides || !surfData.tides.data || !surfData.tides.data.tides) {
            return 'Tide data unavailable';
        }

        const tomorrow = getTomorrowDate();
        const tides = surfData.tides.data.tides;
        const morningTides = [];

        for (const tide of tides) {
            // Only include HIGH and LOW tides, skip NORMAL
            if (tide.type !== 'HIGH' && tide.type !== 'LOW') continue;

            const tideDate = new Date(tide.timestamp * 1000);
            const dateStr = formatLocalDate(tideDate);
            const hour = tideDate.getHours();

            if (dateStr === tomorrow && hour >= 4 && hour <= 12) {
                morningTides.push({
                    type: tide.type === 'HIGH' ? 'High' : 'Low',
                    time: formatTime(tideDate),
                    height: tide.height?.toFixed(1) || '--'
                });
            }
        }

        if (morningTides.length === 0) {
            return 'Check tide times';
        }

        return morningTides.map(t => `${t.type}: ${t.time}`).join(' | ');
    }

    function getShortTideInfo(surfData) {
        // Shorter format for the conditions summary
        if (!surfData || !surfData.tides || !surfData.tides.data || !surfData.tides.data.tides) {
            return '--';
        }

        const tomorrow = getTomorrowDate();
        const tides = surfData.tides.data.tides;
        const morningTides = [];

        for (const tide of tides) {
            // Only include HIGH and LOW tides, skip NORMAL
            if (tide.type !== 'HIGH' && tide.type !== 'LOW') continue;

            const tideDate = new Date(tide.timestamp * 1000);
            const dateStr = formatLocalDate(tideDate);
            const hour = tideDate.getHours();

            // Get tides from 4 AM to noon
            if (dateStr === tomorrow && hour >= 4 && hour <= 12) {
                morningTides.push({
                    type: tide.type === 'HIGH' ? 'H' : 'L',
                    time: formatTime(tideDate)
                });
            }
        }

        if (morningTides.length === 0) {
            return '--';
        }

        return morningTides.map(t => `${t.type} ${t.time}`).join(', ');
    }

    function getNoaaTideInfo(predictions) {
        // Parse NOAA tide predictions for tomorrow morning
        // NOAA format: { t: "2024-02-27 06:32", v: "4.123", type: "H" }
        if (!predictions || predictions.length === 0) {
            return '--';
        }

        const tomorrow = getTomorrowDate();
        const morningTides = [];

        for (const pred of predictions) {
            // Only include H (high) and L (low) entries
            if (pred.type !== 'H' && pred.type !== 'L') continue;

            // Parse the NOAA datetime format "YYYY-MM-DD HH:MM"
            const [dateStr, timeStr] = pred.t.split(' ');

            if (dateStr === tomorrow) {
                const hour = parseInt(timeStr.split(':')[0], 10);

                // Get tides from 4 AM to noon
                if (hour >= 4 && hour <= 12) {
                    // Parse time for display
                    const [h, m] = timeStr.split(':');
                    const hourNum = parseInt(h, 10);
                    const ampm = hourNum >= 12 ? 'PM' : 'AM';
                    const hour12 = hourNum > 12 ? hourNum - 12 : (hourNum === 0 ? 12 : hourNum);

                    morningTides.push({
                        type: pred.type,
                        time: `${hour12}:${m} ${ampm}`
                    });
                }
            }
        }

        if (morningTides.length === 0) {
            return '--';
        }

        return morningTides.map(t => `${t.type} ${t.time}`).join(', ');
    }

    // ============================================
    // Event Handlers
    // ============================================
    window.refreshData = function() {
        loadAllData();
    };

    // ============================================
    // Service Worker Registration
    // ============================================
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('service-worker.js')
                .then(reg => console.log('Service Worker registered'))
                .catch(err => console.log('Service Worker registration failed:', err));
        });
    }

    // ============================================
    // Initialize
    // ============================================
    document.addEventListener('DOMContentLoaded', () => {
        loadAllData();
    });

})();

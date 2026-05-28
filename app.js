// Dawn Patrol - Morning Activity Advisor
// Helps decide: Surf, Fish, Cycle, or Sunrise Photos
// Version 4.0 - Added fishing score with solunar, tides, and barometric pressure

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
            `https://api.open-meteo.com/v1/ecmwf?latitude=${lat}&longitude=${lng}&hourly=temperature_2m,apparent_temperature,cloud_cover,precipitation,snowfall,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,relative_humidity_2m&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=America/New_York&forecast_days=4`,

        sunrise: (lat, lng, date) =>
            `https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lng}&date=${date}&formatted=0`,

        // NOAA Tides & Currents API - Atlantic City station 8534720
        noaaTides: (beginDate, endDate) =>
            `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?begin_date=${beginDate}&end_date=${endDate}&station=8534720&product=predictions&datum=MLLW&time_zone=lst_ldt&interval=hilo&units=english&format=json`,

        // NOAA water temp - Atlantic City Steel Pier station 8534720
        noaaWaterTemp: () =>
            `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?date=latest&station=8534720&product=water_temperature&units=english&time_zone=lst_ldt&format=json`,

        // Open-Meteo Marine API for wave data (free, no CORS issues)
        marineWaves: (lat, lng) =>
            `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lng}&hourly=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period&timezone=America/New_York&forecast_days=4&length_unit=imperial`,

        // Surfline API (spot-specific surf forecasts)
        surflineWave: (spotId) =>
            `https://services.surfline.com/kbyg/spots/forecasts/wave?spotId=${spotId}&days=2&intervalHours=3`,
        surflineRating: (spotId) =>
            `https://services.surfline.com/kbyg/spots/forecasts/rating?spotId=${spotId}&days=2&intervalHours=3`,
        surflineWind: (spotId) =>
            `https://services.surfline.com/kbyg/spots/forecasts/wind?spotId=${spotId}&days=2&intervalHours=3`,

        // NDBC Buoy 44091 (Barnegat, NJ) - closest wave buoy
        // Primary: CORS proxy wrapping NDBC text data
        // Fallback: NOAA ERDDAP JSON endpoint
        ndbcBuoyProxy: () =>
            `https://corsproxy.io/?url=https://www.ndbc.noaa.gov/data/realtime2/44091.txt`,
        ndbcBuoyErddap: () =>
            `https://coastwatch.pfeg.noaa.gov/erddap/tabledap/cwwcNDBCMet.json?station%2Ctime%2Cwd%2Cwspd%2Cgst%2Cwvht%2Cdpd%2Cmwd%2Cwtmp&station=%2244091%22&time%3E=now-2hours&orderBy(%22time%22)`
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
        buoyData: null,
        surflineData: null,
        scores: {
            surf: 0,
            fish: 0,
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

    function getMorningWeatherCondition(weather, targetDate) {
        // Determine precipitation and weather conditions for a target morning
        const tomorrow = targetDate || getTomorrowDate();
        const hourIndex = getMorningHourIndex(weather.hourly.time, tomorrow);
        if (hourIndex === -1) return { precipitation: 0, snowfall: 0, feelsLike: null, condition: 'Unknown' };

        const precip = weather.hourly.precipitation?.[hourIndex] || 0;
        const snow = weather.hourly.snowfall?.[hourIndex] || 0;
        const feelsLike = weather.hourly.apparent_temperature?.[hourIndex] || null;
        const cloudCover = weather.hourly.cloud_cover?.[hourIndex] || 0;
        const windSpeed = weather.hourly.wind_speed_10m?.[hourIndex] || 0;

        // Check multiple morning hours for precip (6-9 AM)
        let totalPrecip = 0;
        let totalSnow = 0;
        for (let i = hourIndex; i < Math.min(hourIndex + 4, weather.hourly.time.length); i++) {
            totalPrecip += weather.hourly.precipitation?.[i] || 0;
            totalSnow += weather.hourly.snowfall?.[i] || 0;
        }

        let condition;
        if (totalSnow > 0.1) condition = 'Snow';
        else if (totalPrecip > 0.2) condition = 'Rain';
        else if (totalPrecip > 0.05) condition = 'Light Rain';
        else if (cloudCover > 80) condition = 'Overcast';
        else if (cloudCover > 50) condition = 'Partly Cloudy';
        else condition = 'Clear';

        const windGusts = weather.hourly.wind_gusts_10m?.[hourIndex] || 0;

        return {
            precipitation: totalPrecip,
            snowfall: totalSnow,
            feelsLike: feelsLike !== null ? Math.round(feelsLike) : null,
            condition,
            windSpeed,
            windGusts,
            isWet: totalPrecip > 0.05 || totalSnow > 0.1,
            isRain: totalPrecip > 0.2,
            isPouring: totalPrecip > 0.5,
            isSuperWindy: windSpeed > 25 || windGusts > 35
        };
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
            const endDay = new Date();
            endDay.setDate(endDay.getDate() + 4);

            // Format dates as YYYYMMDD for NOAA API
            const beginDate = formatLocalDate(today).replace(/-/g, '');
            const endDate = formatLocalDate(endDay).replace(/-/g, '');

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

    async function fetchBuoyData() {
        // Try CORS proxy first, then ERDDAP, then direct NDBC
        try {
            const response = await fetch(API.ndbcBuoyProxy());
            if (!response.ok) throw new Error('Proxy fetch failed');
            const text = await response.text();
            const result = parseNdbcText(text);
            if (result) return result;
        } catch (e) {
            console.warn('Buoy proxy failed:', e.message);
        }
        try {
            const response = await fetch(API.ndbcBuoyErddap());
            if (!response.ok) throw new Error('ERDDAP fetch failed');
            const json = await response.json();
            const result = parseErddapData(json);
            if (result) return result;
        } catch (e) {
            console.warn('Buoy ERDDAP failed:', e.message);
        }
        try {
            const response = await fetch(`https://www.ndbc.noaa.gov/data/realtime2/44091.txt`);
            if (!response.ok) throw new Error('Direct NDBC failed');
            const text = await response.text();
            return parseNdbcText(text);
        } catch (e) {
            console.warn('Buoy direct failed:', e.message);
        }
        return null;
    }

    function parseNdbcText(text) {
        const lines = text.trim().split('\n');
        if (lines.length < 3) return null;
        const headers = lines[0].replace('#', '').trim().split(/\s+/);
        const values = lines[2].trim().split(/\s+/);

        const get = (name) => {
            const idx = headers.indexOf(name);
            if (idx === -1) return null;
            const val = values[idx];
            return val === 'MM' ? null : parseFloat(val);
        };

        const waveHeightM = get('WVHT');
        const wavePeriod = get('DPD');
        const waveDir = get('MWD');
        const waterTempC = get('WTMP');
        const windSpeedMs = get('WSPD');
        const windDir = get('WDIR');
        const windGustMs = get('GST');

        return {
            waveHeight: waveHeightM !== null ? Math.round(waveHeightM * 3.281 * 10) / 10 : null,
            wavePeriod: wavePeriod,
            waveDirection: waveDir,
            waveCardinal: waveDir !== null ? degreesToCardinal(waveDir) : null,
            waterTemp: waterTempC !== null ? Math.round(waterTempC * 9/5 + 32) : null,
            windSpeed: windSpeedMs !== null ? Math.round(windSpeedMs * 2.237) : null,
            windDirection: windDir,
            windGust: windGustMs !== null ? Math.round(windGustMs * 2.237) : null,
            stationId: '44091',
            stationName: 'Buoy 44091 (Barnegat)'
        };
    }

    function parseErddapData(json) {
        // ERDDAP returns { table: { columnNames: [...], rows: [[...], ...] } }
        if (!json || !json.table || !json.table.rows || json.table.rows.length === 0) return null;

        const cols = json.table.columnNames;
        const row = json.table.rows[json.table.rows.length - 1]; // most recent

        const get = (name) => {
            const idx = cols.indexOf(name);
            if (idx === -1) return null;
            const val = row[idx];
            return (val === null || val === 'NaN' || val === '') ? null : parseFloat(val);
        };

        const waveHeightM = get('wvht');
        const wavePeriod = get('dpd');
        const waveDir = get('mwd');
        const waterTempC = get('wtmp');
        const windSpeedMs = get('wspd');
        const windDir = get('wd');
        const windGustMs = get('gst');

        return {
            waveHeight: waveHeightM !== null ? Math.round(waveHeightM * 3.281 * 10) / 10 : null,
            wavePeriod: wavePeriod,
            waveDirection: waveDir,
            waveCardinal: waveDir !== null ? degreesToCardinal(waveDir) : null,
            waterTemp: waterTempC !== null ? Math.round(waterTempC * 9/5 + 32) : null,
            windSpeed: windSpeedMs !== null ? Math.round(windSpeedMs * 2.237) : null,
            windDirection: windDir,
            windGust: windGustMs !== null ? Math.round(windGustMs * 2.237) : null,
            stationId: '44091',
            stationName: 'Buoy 44091 (Barnegat)'
        };
    }

    async function fetchSurflineData() {
        // Fetch Surfline spot-specific data for Ventnor Pier
        const spotId = CONFIG.surfSpots[0].id; // Ventnor Pier
        try {
            const [waveRes, ratingRes, windRes] = await Promise.all([
                fetch(API.surflineWave(spotId)),
                fetch(API.surflineRating(spotId)),
                fetch(API.surflineWind(spotId))
            ]);
            if (!waveRes.ok) throw new Error('Surfline wave API failed');
            const waveData = await waveRes.json();
            const ratingData = ratingRes.ok ? await ratingRes.json() : null;
            const windData = windRes.ok ? await windRes.json() : null;
            return parseSurflineData(waveData, ratingData, windData);
        } catch (error) {
            console.warn('Surfline unavailable (CORS or network):', error.message);
            return null;
        }
    }

    function parseSurflineData(waveData, ratingData, windData) {
        if (!waveData || !waveData.data || !waveData.data.wave || waveData.data.wave.length === 0) return null;

        const tomorrow = getTomorrowDate();
        const tomorrowStart = new Date(tomorrow + 'T00:00:00').getTime() / 1000;
        const tomorrowEnd = tomorrowStart + 86400;

        // Find morning entries (6-9 AM tomorrow)
        const morningStart = tomorrowStart + (CONFIG.morningStartHour * 3600);
        const morningEnd = tomorrowStart + (CONFIG.morningEndHour * 3600);

        // Find closest wave entry to morning
        let bestWave = null;
        for (const entry of waveData.data.wave) {
            if (entry.timestamp >= morningStart && entry.timestamp <= morningEnd) {
                bestWave = entry;
                break;
            }
        }
        // Fall back to first entry of the day
        if (!bestWave) {
            for (const entry of waveData.data.wave) {
                if (entry.timestamp >= tomorrowStart && entry.timestamp < tomorrowEnd) {
                    bestWave = entry;
                    break;
                }
            }
        }
        if (!bestWave) return null;

        // Get rating for same time window
        let bestRating = null;
        if (ratingData && ratingData.data && ratingData.data.rating) {
            for (const entry of ratingData.data.rating) {
                if (entry.timestamp >= morningStart && entry.timestamp <= morningEnd) {
                    bestRating = entry;
                    break;
                }
            }
            if (!bestRating) {
                for (const entry of ratingData.data.rating) {
                    if (entry.timestamp >= tomorrowStart && entry.timestamp < tomorrowEnd) {
                        bestRating = entry;
                        break;
                    }
                }
            }
        }

        // Get wind for same time window
        let bestWind = null;
        if (windData && windData.data && windData.data.wind) {
            for (const entry of windData.data.wind) {
                if (entry.timestamp >= morningStart && entry.timestamp <= morningEnd) {
                    bestWind = entry;
                    break;
                }
            }
        }

        const surfMin = bestWave.surf?.min || 0;
        const surfMax = bestWave.surf?.max || 0;
        const surfHeight = (surfMin + surfMax) / 2;
        const primarySwell = bestWave.swells?.[0] || {};

        return {
            surfMin: Math.round(surfMin * 10) / 10,
            surfMax: Math.round(surfMax * 10) / 10,
            surfHeight,
            swellHeight: primarySwell.height || 0,
            swellPeriod: primarySwell.period || 0,
            swellDirection: primarySwell.direction || 0,
            swellCardinal: primarySwell.direction ? degreesToCardinal(primarySwell.direction) : '',
            rating: bestRating?.rating?.value ?? null,
            wind: bestWind ? {
                speed: Math.round(bestWind.speed || 0),
                gust: Math.round(bestWind.gust || 0),
                direction: bestWind.direction || 0,
                directionType: bestWind.directionType || ''
            } : null
        };
    }

    // ============================================
    // Wetsuit Recommendation
    // ============================================
    function getWetsuitRecommendation(waterTempF) {
        if (waterTempF >= 72) return 'Trunks';
        if (waterTempF >= 65) return 'Springsuit or 3/2';
        if (waterTempF >= 60) return '3/2';
        if (waterTempF >= 55) return '3/2 + boots';
        if (waterTempF >= 50) return '4/3 + boots + gloves';
        return '5/4 + boots + gloves + hood';
    }

    // ============================================
    // Board Call
    // ============================================
    function getBoardCall(surfData, weatherData) {
        const tomorrow = getTomorrowDate();
        const waveHeight = surfData.waveHeight || 0;
        const period = surfData.period || 0;

        let isOffshore = false;
        let isLightWind = false;
        let windSpeed = 0;
        if (weatherData && weatherData.hourly) {
            const wxIndex = getMorningHourIndex(weatherData.hourly.time, tomorrow);
            if (wxIndex !== -1) {
                windSpeed = weatherData.hourly.wind_speed_10m[wxIndex] || 0;
                const windDir = weatherData.hourly.wind_direction_10m[wxIndex] || 0;
                isOffshore = windDir >= 250 && windDir <= 320;
                isLightWind = windSpeed < 8;
            }
        }

        const isClean = isOffshore || isLightWind;
        const isGroundswell = period >= 10;
        const isOnshore = !isOffshore && windSpeed > 8;
        const isSmallOrMushy = waveHeight < 3 || (period < 8 && !isOffshore);

        // Funline: small/mushy/onshore
        if (isSmallOrMushy || (isOnshore && waveHeight < 4)) {
            return {
                board: 'Funline',
                specs: "8'0 · 2+1",
                reason: isOnshore ? 'Onshore — log it' : 'Small/mushy — extra float'
            };
        }

        // Darkness: clean groundswell, lined-up walls, trim feel
        if (isClean && isGroundswell && waveHeight >= 3) {
            return {
                board: 'Darkness',
                specs: "7'2 · quad",
                reason: 'Clean groundswell — trim the walls'
            };
        }

        // Vesper: steep/wedgy/punchy, borderline, or tiebreaker
        return {
            board: 'Vesper',
            specs: "6'10 · quad",
            reason: (waveHeight >= 3 && period >= 8)
                ? 'Steep & punchy — quick to speed'
                : 'Borderline day — fastest paddle-in'
        };
    }

    // ============================================
    // Scoring Functions
    // ============================================
    function calculateSurfScore(marineData, weatherData) {
        const sl = state.surflineData;

        // If Surfline data available, use spot-specific surf heights
        if (sl) {
            return calculateSurfScoreFromSurfline(sl, weatherData);
        }

        // Fallback to Open-Meteo Marine
        return calculateSurfScoreFromMarine(marineData, weatherData);
    }

    function calculateSurfScoreFromSurfline(sl, weatherData) {
        const waveHeight = sl.surfHeight || 0;
        const period = sl.swellPeriod || 0;
        const direction = sl.swellDirection || 0;

        // Surfline surf height is spot-specific (already accounts for bathymetry)
        let heightScore;
        if (waveHeight < 1) heightScore = 1;
        else if (waveHeight < 1.5) heightScore = 3;
        else if (waveHeight < 2.5) heightScore = 5;
        else if (waveHeight < 3.5) heightScore = 7;
        else if (waveHeight < 5) heightScore = 9;
        else if (waveHeight < 6) heightScore = 10;
        else if (waveHeight < 8) heightScore = 8;
        else heightScore = 6;

        let periodScore;
        if (period < 5) periodScore = 2;
        else if (period < 7) periodScore = 4;
        else if (period < 9) periodScore = 6;
        else if (period < 11) periodScore = 8;
        else periodScore = 10;

        // Use Surfline wind data if available, else fall back to ECMWF
        let windScore = 5;
        if (sl.wind) {
            const dt = sl.wind.directionType;
            const spd = sl.wind.speed;
            if (dt === 'Offshore' && spd < 8) windScore = 10;
            else if (dt === 'Offshore') windScore = 8;
            else if (dt === 'Cross-shore' && spd < 8) windScore = 7;
            else if (dt === 'Cross-shore') windScore = 5;
            else if (spd < 8) windScore = 6;
            else if (spd < 15) windScore = 4;
            else windScore = 2;
        } else if (weatherData && weatherData.hourly) {
            const tomorrow = getTomorrowDate();
            const wxIndex = getMorningHourIndex(weatherData.hourly.time, tomorrow);
            if (wxIndex !== -1) {
                const windSpeed = weatherData.hourly.wind_speed_10m[wxIndex] || 0;
                const windDir = weatherData.hourly.wind_direction_10m[wxIndex] || 0;
                const isOffshore = windDir >= 250 && windDir <= 320;
                const isLightWind = windSpeed < 8;
                if (isOffshore && isLightWind) windScore = 10;
                else if (isOffshore) windScore = 8;
                else if (isLightWind) windScore = 7;
                else if (windSpeed < 15) windScore = 4;
                else windScore = 2;
            }
        }

        // If Surfline provides a rating, blend it in (their rating is 0-6 scale)
        let finalScore;
        if (sl.rating !== null && sl.rating !== undefined) {
            const surflineScore = Math.round((sl.rating / 6) * 10);
            // 50% Surfline rating, 25% our height score, 15% period, 10% wind
            finalScore = Math.round(
                (surflineScore * 0.50) +
                (heightScore * 0.25) +
                (periodScore * 0.15) +
                (windScore * 0.10)
            );
        } else {
            finalScore = Math.round((heightScore * 0.4) + (periodScore * 0.3) + (windScore * 0.3));
        }

        const heightStr = `${sl.surfMin}-${sl.surfMax}ft`;
        const periodStr = period > 0 ? `${Math.round(period)}s` : '';
        const dirStr = sl.swellCardinal || degreesToCardinal(direction);

        return {
            score: Math.min(10, Math.max(1, finalScore)),
            waveHeight: waveHeight,
            details: `${heightStr} @ ${periodStr} ${dirStr}`,
            period: period,
            direction: direction,
            heightScore,
            periodScore,
            windScore,
            source: 'Surfline'
        };
    }

    function calculateSurfScoreFromMarine(marineData, weatherData) {
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

        const waveHeight = waveHeights[morningIndex] || 0;
        const period = swellPeriods[morningIndex] || wavePeriods[morningIndex] || 0;
        const direction = swellDirections[morningIndex] || waveDirections[morningIndex] || 0;

        let heightScore;
        if (waveHeight < 1) heightScore = 1;
        else if (waveHeight < 2) heightScore = 3;
        else if (waveHeight < 3) heightScore = 5;
        else if (waveHeight < 4) heightScore = 7;
        else if (waveHeight < 5) heightScore = 9;
        else if (waveHeight < 6) heightScore = 10;
        else if (waveHeight < 8) heightScore = 8;
        else heightScore = 6;

        let periodScore;
        if (period < 5) periodScore = 2;
        else if (period < 7) periodScore = 4;
        else if (period < 9) periodScore = 6;
        else if (period < 11) periodScore = 8;
        else periodScore = 10;

        let windScore = 5;
        if (weatherData && weatherData.hourly) {
            const wxIndex = getMorningHourIndex(weatherData.hourly.time, tomorrow);
            if (wxIndex !== -1) {
                const windSpeed = weatherData.hourly.wind_speed_10m[wxIndex] || 0;
                const windDir = weatherData.hourly.wind_direction_10m[wxIndex] || 0;
                const isOffshore = windDir >= 250 && windDir <= 320;
                const isLightWind = windSpeed < 8;
                if (isOffshore && isLightWind) windScore = 10;
                else if (isOffshore) windScore = 8;
                else if (isLightWind) windScore = 7;
                else if (windSpeed < 15) windScore = 4;
                else windScore = 2;
            }
        }

        const finalScore = Math.round((heightScore * 0.4) + (periodScore * 0.3) + (windScore * 0.3));
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
            windScore,
            source: 'Open-Meteo'
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

    // ============================================
    // Fishing Score
    // ============================================

    // NJ Shore species calendar: { months (1-indexed), idealWaterTemp [min, max] }
    const FISH_SPECIES = [
        { name: 'Striped Bass', months: [3,4,5,6,10,11,12], temp: [50, 65], emoji: '🐟' },
        { name: 'Bluefish', months: [5,6,7,8,9,10,11], temp: [60, 72], emoji: '🐟' },
        { name: 'Fluke', months: [4,5,6,7,8,9,10], temp: [55, 70], emoji: '🐟' },
        { name: 'Weakfish', months: [5,6,7,8,9], temp: [58, 68], emoji: '🐟' },
        { name: 'Black Drum', months: [4,5,6], temp: [55, 70], emoji: '🥁' },
        { name: 'Tautog', months: [3,4,5,10,11,12], temp: [50, 60], emoji: '🐟' },
        { name: 'Kingfish', months: [6,7,8,9,10], temp: [60, 75], emoji: '👑' },
    ];

    function getMoonPhase(date) {
        // Calculate moon phase (0 = new moon, 0.5 = full moon)
        // Based on a known new moon: Jan 6, 2000 18:14 UTC
        const knownNew = new Date(Date.UTC(2000, 0, 6, 18, 14, 0));
        const synodicMonth = 29.53058868;
        const daysSinceNew = (date.getTime() - knownNew.getTime()) / (1000 * 60 * 60 * 24);
        const phase = ((daysSinceNew % synodicMonth) + synodicMonth) % synodicMonth;
        return phase / synodicMonth; // 0-1
    }

    function getMoonPhaseName(phase) {
        if (phase < 0.0625 || phase >= 0.9375) return 'New Moon';
        if (phase < 0.1875) return 'Waxing Crescent';
        if (phase < 0.3125) return 'First Quarter';
        if (phase < 0.4375) return 'Waxing Gibbous';
        if (phase < 0.5625) return 'Full Moon';
        if (phase < 0.6875) return 'Waning Gibbous';
        if (phase < 0.8125) return 'Last Quarter';
        return 'Waning Crescent';
    }

    function calculateFishScore(weather, noaaTides, waterTempData) {
        const tomorrow = getTomorrowDate();
        const tomorrowDate = new Date(tomorrow + 'T00:00:00');
        const month = tomorrowDate.getMonth() + 1; // 1-indexed

        // --- Moon/Solunar Score (25%) ---
        const moonPhase = getMoonPhase(tomorrowDate);
        const moonName = getMoonPhaseName(moonPhase);
        // New moon (0) and full moon (0.5) are best for fishing
        // Distance from nearest peak (0 or 0.5)
        const distFromPeak = Math.min(moonPhase, Math.abs(moonPhase - 0.5), 1 - moonPhase);
        // 0 = at peak (best), 0.25 = quarter moon (worst)
        let solunarScore = Math.round(10 - (distFromPeak / 0.25) * 8);
        solunarScore = Math.max(2, Math.min(10, solunarScore));

        // --- Tide Score (25%) ---
        // Moving water is best - check if morning window has a tide change
        let tideScore = 5; // default
        let tideDetail = 'Check tides';
        if (noaaTides && noaaTides.predictions) {
            const morningTides = [];
            for (const pred of noaaTides.predictions) {
                if (pred.type !== 'H' && pred.type !== 'L') continue;
                const [dateStr] = pred.t.split(' ');
                if (dateStr === tomorrow) {
                    const hour = parseInt(pred.t.split(' ')[1].split(':')[0], 10);
                    if (hour >= 4 && hour <= 11) {
                        morningTides.push({ type: pred.type, hour });
                    }
                }
            }
            // Tide change during fishing window (5-9 AM) = great
            if (morningTides.some(t => t.hour >= 5 && t.hour <= 9)) {
                tideScore = 10;
                tideDetail = 'Tide change during morning - moving water';
            } else if (morningTides.length > 0) {
                tideScore = 7;
                tideDetail = 'Tide change near morning window';
            } else {
                tideScore = 4;
                tideDetail = 'Slack water in morning';
            }
        }

        // --- Barometric Pressure Score (20%) ---
        let pressureScore = 5;
        let pressureTrend = 'Unknown';
        if (weather && weather.hourly && weather.hourly.pressure_msl) {
            const hourIndex = getMorningHourIndex(weather.hourly.time, tomorrow);
            if (hourIndex > 5) {
                const currentPressure = weather.hourly.pressure_msl[hourIndex];
                const priorPressure = weather.hourly.pressure_msl[hourIndex - 6]; // 6 hours before
                const change = currentPressure - priorPressure;
                // Falling pressure = fish feed more actively
                if (change < -2) { pressureScore = 10; pressureTrend = 'Falling'; }
                else if (change < -0.5) { pressureScore = 8; pressureTrend = 'Slowly falling'; }
                else if (change <= 0.5) { pressureScore = 6; pressureTrend = 'Steady'; }
                else if (change <= 2) { pressureScore = 4; pressureTrend = 'Rising'; }
                else { pressureScore = 2; pressureTrend = 'Rapidly rising'; }
            }
        }

        // --- Wind Score (15%) ---
        let windScore = 5;
        let windSpeed = 0;
        if (weather && weather.hourly) {
            const hourIndex = getMorningHourIndex(weather.hourly.time, tomorrow);
            if (hourIndex !== -1) {
                windSpeed = weather.hourly.wind_speed_10m[hourIndex] || 0;
                const windGusts = weather.hourly.wind_gusts_10m?.[hourIndex] || 0;
                // Light wind best for pier fishing
                if (windSpeed < 8) windScore = 10;
                else if (windSpeed < 12) windScore = 7;
                else if (windSpeed < 18) windScore = 4;
                else windScore = 2;
                // Heavy gusts penalize
                if (windGusts > 30) windScore = Math.min(windScore, 2);
            }
        }

        // --- Water Temp / Species Score (15%) ---
        let waterTemp = null;
        let speciesScore = 5;
        const activeSpecies = [];

        // Get current species for this month
        const inSeasonSpecies = FISH_SPECIES.filter(s => s.months.includes(month));

        if (waterTempData && waterTempData.data && waterTempData.data.length > 0) {
            waterTemp = parseFloat(waterTempData.data[0].v);

            // Score based on how many species are in their ideal temp range
            let tempMatches = 0;
            for (const species of inSeasonSpecies) {
                const inRange = waterTemp >= species.temp[0] && waterTemp <= species.temp[1];
                const nearRange = waterTemp >= species.temp[0] - 5 && waterTemp <= species.temp[1] + 5;
                if (inRange) {
                    activeSpecies.push({ ...species, status: 'ideal' });
                    tempMatches += 2;
                } else if (nearRange) {
                    activeSpecies.push({ ...species, status: 'possible' });
                    tempMatches += 1;
                }
            }
            speciesScore = Math.min(10, Math.max(2, Math.round(tempMatches * 1.5)));
        } else {
            // No water temp - just list in-season species
            for (const species of inSeasonSpecies) {
                activeSpecies.push({ ...species, status: 'in-season' });
            }
        }

        // --- Final Score ---
        const finalScore = Math.round(
            (solunarScore * 0.25) +
            (tideScore * 0.25) +
            (pressureScore * 0.20) +
            (windScore * 0.15) +
            (speciesScore * 0.15)
        );

        return {
            score: Math.min(10, Math.max(1, finalScore)),
            moonPhase: moonName,
            solunarScore,
            tideScore,
            tideDetail,
            pressureScore,
            pressureTrend,
            windScore,
            windSpeed: Math.round(windSpeed),
            speciesScore,
            waterTemp: waterTemp ? Math.round(waterTemp) : null,
            activeSpecies,
        };
    }

    function calculateCycleScore(weather) {
        const tomorrow = getTomorrowDate();
        const hourIndex = getMorningHourIndex(weather.hourly.time, tomorrow);

        if (hourIndex === -1) {
            return { score: 0, details: 'No data', direction: null };
        }

        const windSpeed = weather.hourly.wind_speed_10m[hourIndex];
        const windGusts = weather.hourly.wind_gusts_10m?.[hourIndex] || 0;
        const windDirection = weather.hourly.wind_direction_10m[hourIndex];
        const temp = weather.hourly.temperature_2m[hourIndex];
        const feelsLike = weather.hourly.apparent_temperature?.[hourIndex] || temp;
        const cloudCover = weather.hourly.cloud_cover?.[hourIndex] || 0;

        // Wind speed score (>15 mph is a no-go)
        let windScore;
        if (windSpeed < 8) windScore = 10;
        else if (windSpeed < 12) windScore = 8;
        else if (windSpeed <= 15) windScore = 5;
        else windScore = 1; // >15 mph = no go

        // Gusts above 26 mph override to no-go
        if (windGusts > 26) windScore = 1;

        // Weather score (based on cloud cover since ECMWF doesn't have weather codes)
        let weatherScore;
        if (cloudCover <= 30) weatherScore = 10; // Clear to partly cloudy
        else if (cloudCover <= 70) weatherScore = 7; // Partly cloudy
        else weatherScore = 5; // Cloudy but rideable

        // Temperature score - use feels-like for cycling comfort
        let tempScore;
        if (feelsLike >= 55 && feelsLike <= 75) tempScore = 10;
        else if ((feelsLike >= 45 && feelsLike < 55) || (feelsLike > 75 && feelsLike <= 85)) tempScore = 7;
        else if (feelsLike >= 35 && feelsLike < 45) tempScore = 4;
        else tempScore = 2;

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
            windGusts: Math.round(windGusts),
            windDirection: normalizedDir,
            windCardinal: degreesToCardinal(normalizedDir),
            temp: Math.round(temp),
            feelsLike: Math.round(feelsLike),
            direction,
            directionText
        };
    }

    function getRecommendation(scores, surfScoreData, fishData, cycleData, weatherCondition) {
        const { surf, fish, photo, cycle } = scores;

        const icons = {
            surf: '&#127940;',
            fish: '&#127907;',
            photo: '&#128247;',
            cycle: '&#128690;'
        };

        function getDetail(activity) {
            if (activity.name === 'surf' && surfScoreData) return surfScoreData.details;
            if (activity.name === 'fish' && fishData) {
                const topSpecies = fishData.activeSpecies.filter(s => s.status === 'ideal').map(s => s.name);
                return topSpecies.length > 0 ? topSpecies.join(', ') + ' in range' : fishData.tideDetail;
            }
            if (activity.name === 'cycle' && cycleData.directionText) return cycleData.directionText;
            if (activity.name === 'photo') return 'Arrive 20 min before sunrise';
            return '';
        }

        // Super windy = gym day, no question
        if (weatherCondition && weatherCondition.isSuperWindy) {
            let gymDetail = `Wind ${Math.round(weatherCondition.windSpeed)} mph`;
            if (weatherCondition.windGusts > 35) gymDetail += `, gusts ${Math.round(weatherCondition.windGusts)} mph`;
            if (weatherCondition.feelsLike !== null) gymDetail += ` - Feels like ${weatherCondition.feelsLike}°F`;
            return {
                activity: 'HIT THE GYM',
                detail: gymDetail,
                icon: '&#127947;',
                runnerUp: null
            };
        }

        // Sort activities - surf wins ties (stable sort with surf priority)
        const activities = [
            { name: 'surf', score: surf, label: 'GO SURF', priority: 0 },
            { name: 'fish', score: fish, label: 'GO FISHING', priority: 1 },
            { name: 'photo', score: photo, label: 'SUNRISE PHOTOS', priority: 3 },
            { name: 'cycle', score: cycle, label: 'GO CYCLING', priority: 2 }
        ];
        activities.sort((a, b) => b.score - a.score || a.priority - b.priority);
        const best = activities[0];
        const runnerUp = activities[1];

        // All scores low = gym day
        if (best.score < 4) {
            let gymDetail = weatherCondition ? weatherCondition.condition : 'Poor conditions';
            if (weatherCondition && weatherCondition.feelsLike !== null) {
                gymDetail += ` - Feels like ${weatherCondition.feelsLike}°F`;
            }
            return {
                activity: 'HIT THE GYM',
                detail: gymDetail,
                icon: '&#127947;',
                runnerUp: best.score >= 3 ? `Or: ${best.label} (${best.score}/10)` : null
            };
        }

        let detail = getDetail(best);

        // Runner-up suggestion if close in score
        let runnerUpText = null;
        if (runnerUp.score >= 5 && (best.score - runnerUp.score) <= 3) {
            runnerUpText = `Also good: ${runnerUp.label} (${runnerUp.score}/10)`;
        }

        return {
            activity: best.label,
            detail,
            icon: icons[best.name],
            runnerUp: runnerUpText
        };
    }

    // ============================================
    // Main Data Loading
    // ============================================
    async function loadAllData() {
        showLoading();

        try {
            // Fetch all data in parallel
            const [weather, sunriseData, noaaTides, waterTempData, marineData, buoyData, surflineData] = await Promise.all([
                fetchWeather(),
                fetchSunrise(),
                fetchNoaaTides(),
                fetchWaterTemp(),
                fetchMarineData(),
                fetchBuoyData(),
                fetchSurflineData()
            ]);

            state.weather = weather;
            state.sunrise = sunriseData;
            state.noaaTides = noaaTides;
            state.waterTempData = waterTempData;
            state.marineData = marineData;
            state.buoyData = buoyData;
            state.surflineData = surflineData;

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
        // Determine weather conditions first
        const weatherCondition = state.weather ? getMorningWeatherCondition(state.weather) : null;
        state.weatherCondition = weatherCondition;

        // Calculate surf score using Open-Meteo marine data
        const surfScoreData = calculateSurfScore(state.marineData, state.weather);
        state.scores.surf = surfScoreData.score;
        state.surfScoreData = surfScoreData;

        // Calculate fish score
        const fishData = calculateFishScore(state.weather, state.noaaTides, state.waterTempData);
        state.scores.fish = fishData.score;
        state.fishData = fishData;

        // Calculate photo score
        const photoData = calculatePhotoScore(state.weather, state.sunrise);
        state.scores.photo = photoData.score;
        state.photoData = photoData;

        // Calculate cycle score
        const cycleData = calculateCycleScore(state.weather);
        state.scores.cycle = cycleData.score;
        state.cycleData = cycleData;

        // Apply weather rules
        if (weatherCondition) {
            // Any rain or snow = no cycling, period
            if (weatherCondition.isWet) {
                state.scores.cycle = 1;
            }
            // Rain kills sunrise photos
            if (weatherCondition.isWet) {
                state.scores.photo = 1;
            }
            // Pouring = no fishing. Light rain is fine.
            if (weatherCondition.isPouring) {
                state.scores.fish = Math.max(1, state.scores.fish - 5);
            }
            // Surfing: rain doesn't matter, you're already wet. Snow is rough though.
            if (weatherCondition.condition === 'Snow') {
                state.scores.surf = Math.max(1, state.scores.surf - 3);
            }
        }
        // Photos only recommended if actually a good sunrise (score >= 6 pre-penalty)
        if (state.scores.photo < 6) {
            state.scores.photo = Math.min(state.scores.photo, 4);
        }

        // Get recommendation
        state.recommendation = getRecommendation(state.scores, surfScoreData, fishData, cycleData, weatherCondition);
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
        const runnerUpEl = document.getElementById('rec-runner-up');
        if (rec.runnerUp) {
            runnerUpEl.textContent = rec.runnerUp;
            runnerUpEl.style.display = 'block';
        } else {
            runnerUpEl.style.display = 'none';
        }

        // Conditions Summary
        // Weather condition
        if (state.weatherCondition) {
            document.getElementById('summary-condition').textContent = state.weatherCondition.condition;
        }

        // Air temp (from cycling data which uses Open-Meteo)
        if (state.cycleData && state.cycleData.temp) {
            const tempStr = state.cycleData.feelsLike !== state.cycleData.temp
                ? `${state.cycleData.temp}°F (${state.cycleData.feelsLike}°F)`
                : `${state.cycleData.temp}°F`;
            document.getElementById('summary-air-temp').textContent = tempStr;
        }

        // Water temp - prefer buoy, fall back to NOAA station
        if (state.waterTempData && state.waterTempData.data && state.waterTempData.data.length > 0) {
            state.waterTempNoaa = Math.round(parseFloat(state.waterTempData.data[0].v));
        }
        const summaryWaterTemp = (state.buoyData && state.buoyData.waterTemp) || state.waterTempNoaa;
        if (summaryWaterTemp) {
            document.getElementById('summary-water-temp').textContent = `${summaryWaterTemp}°F`;
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
            const source = state.surfScoreData.source || 'Open-Meteo';
            document.getElementById('surf-best-spot').textContent = `Ventnor Area (${source})`;
            document.getElementById('surf-conditions').textContent = state.surfScoreData.details;

            // Get tide info from NOAA
            let tideInfo = 'Check tide times';
            if (state.noaaTides && state.noaaTides.predictions) {
                tideInfo = getNoaaTideInfo(state.noaaTides.predictions);
                if (tideInfo === '--') tideInfo = 'Check tide times';
            }
            document.getElementById('surf-tide').textContent = tideInfo;

            // Buoy data (real-time observed)
            const buoyEl = document.getElementById('surf-buoy');
            if (state.buoyData) {
                const b = state.buoyData;
                const parts = [];
                if (b.waveHeight !== null) parts.push(`${b.waveHeight}ft`);
                if (b.wavePeriod !== null) parts.push(`${b.wavePeriod}s`);
                if (b.waveCardinal) parts.push(b.waveCardinal);
                buoyEl.textContent = parts.length > 0
                    ? `Buoy 44091: ${parts.join(' @ ')}`
                    : 'Buoy 44091: No data';
            } else {
                buoyEl.textContent = 'Buoy 44091: Unavailable';
            }

            // Water temp - prefer buoy, fall back to NOAA station
            const waterTemp = (state.buoyData && state.buoyData.waterTemp) || state.waterTempNoaa;
            if (waterTemp) {
                const source = (state.buoyData && state.buoyData.waterTemp) ? 'Buoy' : 'NOAA';
                document.getElementById('surf-water-temp').textContent = `Water: ${waterTemp}°F (${source})`;
            }

            // Air temp from cycling data (Open-Meteo)
            if (state.cycleData && state.cycleData.temp) {
                document.getElementById('surf-air-temp').textContent = `Air: ${state.cycleData.temp}°F`;
            }

            // Show wave breakdown instead of forecaster headline
            const breakdown = `Height: ${state.surfScoreData.heightScore}/10 | Period: ${state.surfScoreData.periodScore}/10 | Wind: ${state.surfScoreData.windScore}/10`;
            document.getElementById('surf-forecast').textContent = breakdown;

            // Board call
            if (state.scores.surf >= 3) {
                const board = getBoardCall(state.surfScoreData, state.weather);
                document.getElementById('surf-board-name').textContent = `${board.board} — ${board.specs}`;
                document.getElementById('surf-board-reason').textContent = board.reason;
                document.getElementById('surf-board-call').style.display = 'block';
            } else {
                document.getElementById('surf-board-call').style.display = 'none';
            }
        }

        // Fish card
        document.getElementById('fish-score').textContent = state.scores.fish;
        updateScoreColor('fish-card', state.scores.fish);
        if (state.fishData) {
            document.getElementById('fish-moon').textContent = `Moon: ${state.fishData.moonPhase}`;
            document.getElementById('fish-tide').textContent = state.fishData.tideDetail;
            document.getElementById('fish-pressure').textContent =
                `Pressure: ${state.fishData.pressureTrend}`;
            document.getElementById('fish-wind').textContent =
                `Wind: ${state.fishData.windSpeed} mph`;
            if (state.fishData.waterTemp) {
                document.getElementById('fish-water-temp').textContent =
                    `Water: ${state.fishData.waterTemp}°F`;
            }
            // Species list
            const speciesList = document.getElementById('fish-species-list');
            speciesList.innerHTML = '';
            if (state.fishData.activeSpecies.length > 0) {
                for (const species of state.fishData.activeSpecies) {
                    const span = document.createElement('span');
                    span.className = 'fish-species-tag' + (species.status === 'ideal' ? ' species-ideal' : '');
                    span.textContent = species.name;
                    speciesList.appendChild(span);
                }
            } else {
                speciesList.textContent = 'Slow season';
            }
            // Score breakdown
            document.getElementById('fish-breakdown').textContent =
                `Moon: ${state.fishData.solunarScore}/10 | Tide: ${state.fishData.tideScore}/10 | Pressure: ${state.fishData.pressureScore}/10`;
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
            `Wind: ${state.cycleData.windSpeed} mph ${state.cycleData.windCardinal}` +
            (state.cycleData.windGusts ? ` (gusts ${state.cycleData.windGusts} mph)` : '');
        const cycleTempStr = state.cycleData.feelsLike !== state.cycleData.temp
            ? `Feels like ${state.cycleData.feelsLike}°F (actual ${state.cycleData.temp}°F)`
            : `Temperature: ${state.cycleData.temp}°F`;
        document.getElementById('cycle-temp').textContent = cycleTempStr;
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

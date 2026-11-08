// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: thermometer-half;

/**
 * Temp hjemme og på hytta – widget for Scriptable (iPhone)
 *
 * Henter temperatur fra Ecowitt sin sky (api.ecowitt.net) for to
 * stasjoner og viser dem i en widget på hjemskjermen eller låseskjermen.
 *
 * Første gang du kjører scriptet i Scriptable-appen blir du bedt om
 * Application Key og API Key fra ecowitt.net. Deretter henter scriptet
 * stasjonene automatisk, og du kan gi dem navn (f.eks. «Hjemme» og «Hytta»).
 *
 * Utseende (Lys, Stor skrift, Farge, Tabell) velges i menyen når scriptet
 * kjøres i appen.
 *
 * Widget-parameter (valgfritt, settes ved å holde inne widgeten → Rediger):
 *   tomt            → viser alle valgte stasjoner i valgt utseende
 *   «Hytta»         → viser bare stasjonen med det navnet
 *   «farge»         → bruker utseendet «Farge» på akkurat denne widgeten
 *   «Hytta, stor»   → begge deler
 */

// ---------------------------------------------------------------------------
// Innstillinger som kan endres
// ---------------------------------------------------------------------------

const SETTINGS = {
  // Hvor ofte iOS bes om å oppdatere widgeten (minutter). iOS bestemmer
  // selv til slutt, i praksis blir det ca. hvert 15.–30. minutt.
  refreshMinutes: 15,

  // Data eldre enn dette markeres med oransje (stasjonen er kanskje offline).
  staleAfterMinutes: 90,

  // Fargelegg temperaturen: blå under frysepunktet, oransje når det er varmt.
  coldBelow: 0,
  warmAbove: 25,
};

// ---------------------------------------------------------------------------

const API = "https://api.ecowitt.net/api/v3";
const KC_APP_KEY = "tempwidget.ecowitt.applicationKey";
const KC_API_KEY = "tempwidget.ecowitt.apiKey";
const KC_STATIONS = "tempwidget.ecowitt.stations";
const KC_STYLE = "tempwidget.style";
const CACHE_FILE = "tempwidget-cache.json";

const COLORS = {
  bg: Color.dynamic(new Color("#F4F7FB"), new Color("#15191F")),
  text: Color.dynamic(new Color("#14181F"), new Color("#F2F4F7")),
  muted: Color.dynamic(new Color("#5D6673"), new Color("#9AA4B2")),
  cold: Color.dynamic(new Color("#1F6FD1"), new Color("#6AB0FF")),
  warm: Color.dynamic(new Color("#D9650B"), new Color("#FFA45C")),
  stale: Color.dynamic(new Color("#C25E00"), new Color("#FFB35C")),
  error: Color.dynamic(new Color("#C42B1C"), new Color("#FF7B6E")),
  divider: Color.dynamic(new Color("#DCE2EA"), new Color("#2A313B")),
};

// ===========================================================================
// Lagring
// ===========================================================================

function getKeys() {
  if (!Keychain.contains(KC_APP_KEY) || !Keychain.contains(KC_API_KEY)) return null;
  const applicationKey = Keychain.get(KC_APP_KEY).trim();
  const apiKey = Keychain.get(KC_API_KEY).trim();
  if (!applicationKey || !apiKey) return null;
  return { applicationKey, apiKey };
}

function saveKeys(applicationKey, apiKey) {
  Keychain.set(KC_APP_KEY, applicationKey.trim());
  Keychain.set(KC_API_KEY, apiKey.trim());
}

/** Lagrede stasjoner: [{ id, label, mac?, imei? }] i ønsket rekkefølge. */
function getStations() {
  if (!Keychain.contains(KC_STATIONS)) return null;
  try {
    const list = JSON.parse(Keychain.get(KC_STATIONS));
    return Array.isArray(list) && list.length ? list : null;
  } catch (e) {
    return null;
  }
}

function saveStations(list) {
  Keychain.set(KC_STATIONS, JSON.stringify(list));
}

/** Utseende på hjemskjerm-widgeten. Velges i menyen i appen. */
const STYLES = {
  lys: { name: "Lys", description: "Lyst kort med to kolonner, fukt og innetemperatur." },
  stor: { name: "Stor skrift", description: "Bare temperaturene, så store som mulig. Lett å lese på avstand." },
  farge: { name: "Farge", description: "Hver stasjon får en farge etter hvor kaldt eller varmt det er." },
  tabell: { name: "Tabell", description: "Ute og inne i hver sin kolonne, én rad per sted." },
};
const DEFAULT_STYLE = "lys";

function getStyle() {
  if (!Keychain.contains(KC_STYLE)) return DEFAULT_STYLE;
  const style = Keychain.get(KC_STYLE);
  return STYLES[style] ? style : DEFAULT_STYLE;
}

function saveStyle(style) {
  Keychain.set(KC_STYLE, style);
}

function cachePath() {
  const fm = FileManager.local();
  return fm.joinPath(fm.documentsDirectory(), CACHE_FILE);
}

function readCache() {
  try {
    const fm = FileManager.local();
    const path = cachePath();
    if (!fm.fileExists(path)) return {};
    return JSON.parse(fm.readString(path)) || {};
  } catch (e) {
    return {};
  }
}

function writeCache(cache) {
  try {
    FileManager.local().writeString(cachePath(), JSON.stringify(cache));
  } catch (e) {
    // Ikke kritisk
  }
}

// ===========================================================================
// Ecowitt API
// ===========================================================================

function query(params) {
  return Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== "")
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join("&");
}

async function apiGet(path, params) {
  const req = new Request(`${API}/${path}?${query(params)}`);
  req.timeoutInterval = 20;
  const json = await req.loadJSON();
  if (!json || typeof json !== "object") throw new Error("Tomt svar fra Ecowitt");
  if (json.code !== 0) {
    const err = new Error(explainError(json.code, json.msg));
    err.code = json.code;
    throw err;
  }
  return json;
}

function friendlyError(e) {
  const msg = (e && e.message) || String(e);
  if (e && e.code !== undefined) return msg; // allerede oversatt Ecowitt-feil
  if (/timed out|fetch failed|offline|network|internet|could not connect|hostname|cancelled/i.test(msg)) {
    return "Ingen nettforbindelse";
  }
  return msg;
}

function explainError(code, msg) {
  if (code === 40010) return "Ugyldig Application Key";
  if (code === 40011) return "Ugyldig API Key";
  if (code === 40012) return "Ukjent stasjon (MAC/IMEI)";
  if (code === -1 || code === 45001) return "Ecowitt er opptatt, prøver igjen senere";
  return `Ecowitt-feil ${code}${msg ? `: ${msg}` : ""}`;
}

async function fetchDeviceList(keys) {
  const devices = [];
  for (let page = 1; page <= 5; page++) {
    const json = await apiGet("device/list", {
      application_key: keys.applicationKey,
      api_key: keys.apiKey,
      limit: 50,
      page,
    });
    const data = json.data || {};
    const list = Array.isArray(data.list) ? data.list : [];
    devices.push(...list);
    if (!data.totalPage || page >= data.totalPage) break;
  }
  return devices.map((d) => ({
    id: String(d.mac || d.imei || d.id),
    name: d.name || d.stationtype || "Stasjon",
    mac: d.mac || undefined,
    imei: d.mac ? undefined : d.imei || undefined,
  }));
}

function readValue(obj) {
  if (!obj || obj.value === undefined || obj.value === null || obj.value === "") return null;
  const value = parseFloat(String(obj.value).replace(",", "."));
  if (!isFinite(value)) return null;
  const time = obj.time ? parseInt(obj.time, 10) * 1000 : null;
  return { value, time };
}

/** Plukker ut det vi trenger fra et real_time-svar. */
function parseRealtime(data) {
  data = data && !Array.isArray(data) ? data : {};
  const outdoor = data.outdoor || {};
  const indoor = data.indoor || {};

  // Hvis stasjonen ikke har utesensor, bruk første ekstra temp-sensor (CH1–CH8).
  let main = readValue(outdoor.temperature);
  let mainHumidity = readValue(outdoor.humidity);
  let mainSource = "outdoor";
  if (!main) {
    for (let ch = 1; ch <= 8; ch++) {
      const s = data[`temp_and_humidity_ch${ch}`];
      if (s && readValue(s.temperature)) {
        main = readValue(s.temperature);
        mainHumidity = readValue(s.humidity);
        mainSource = `ch${ch}`;
        break;
      }
    }
  }

  const indoorTemp = readValue(indoor.temperature);
  const indoorHumidity = readValue(indoor.humidity);
  const feelsLike = readValue(outdoor.feels_like);

  if (!main && indoorTemp) {
    // Kun innesensor tilgjengelig
    return {
      temp: indoorTemp.value,
      humidity: indoorHumidity ? indoorHumidity.value : null,
      indoor: null,
      indoorHumidity: null,
      feelsLike: null,
      source: "indoor",
      time: indoorTemp.time,
    };
  }
  if (!main) return null;

  return {
    temp: main.value,
    humidity: mainHumidity ? mainHumidity.value : null,
    indoor: indoorTemp ? indoorTemp.value : null,
    indoorHumidity: indoorHumidity ? indoorHumidity.value : null,
    feelsLike: feelsLike ? feelsLike.value : null,
    source: mainSource,
    time: main.time,
  };
}

async function fetchStation(keys, station) {
  const json = await apiGet("device/real_time", {
    application_key: keys.applicationKey,
    api_key: keys.apiKey,
    mac: station.mac,
    imei: station.mac ? undefined : station.imei,
    call_back: "all",
    temp_unitid: 1, // °C
  });
  const parsed = parseRealtime(json.data);
  if (!parsed) throw new Error("Ingen temperatur fra stasjonen");
  return parsed;
}

/**
 * Henter alle stasjoner. Hvis en henting feiler brukes siste lagrede verdi,
 * så widgeten ikke blir tom når hytta eller nettet er nede en stund.
 */
async function loadAll(keys, stations) {
  const cache = readCache();
  const results = await Promise.all(
    stations.map(async (station) => {
      try {
        const reading = await fetchStation(keys, station);
        cache[station.id] = reading;
        return { station, reading, error: null, fromCache: false };
      } catch (e) {
        const cached = cache[station.id] || null;
        return { station, reading: cached, error: friendlyError(e), fromCache: !!cached };
      }
    })
  );
  writeCache(cache);
  return results;
}

// ===========================================================================
// Formattering
// ===========================================================================

function formatTemp(t, decimals = 1) {
  if (t === null || t === undefined) return "–";
  const rounded = Number(t).toFixed(decimals);
  // Unngå «-0,0»
  const clean = Number(rounded) === 0 ? (0).toFixed(decimals) : rounded;
  return `${clean.replace("-", "−").replace(".", ",")}°`;
}

function tempColor(t, fallback) {
  if (t === null || t === undefined) return fallback;
  if (t < SETTINGS.coldBelow) return COLORS.cold;
  if (t > SETTINGS.warmAbove) return COLORS.warm;
  return fallback;
}

function ageMinutes(time) {
  if (!time) return null;
  return Math.max(0, Math.round((Date.now() - time) / 60000));
}

function formatAge(minutes) {
  if (minutes === null) return "";
  if (minutes < 2) return "nå";
  if (minutes < 60) return `${minutes} min siden`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} t siden`;
  return `${Math.round(hours / 24)} d siden`;
}

function isStale(reading) {
  const age = reading ? ageMinutes(reading.time) : null;
  return age !== null && age > SETTINGS.staleAfterMinutes;
}

function iconFor(station, index) {
  const name = station.icon || (index === 0 ? "house.fill" : "house.lodge.fill");
  return SFSymbol.named(name) || SFSymbol.named("mountain.2.fill") || SFSymbol.named("house.fill");
}

// ===========================================================================
// Widget-oppsett
// ===========================================================================

function addLabelRow(parent, result, index, size, color) {
  const row = parent.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  row.spacing = 4;
  const symbol = iconFor(result.station, index);
  if (symbol) {
    const img = row.addImage(symbol.image);
    img.imageSize = new Size(size, size);
    img.tintColor = color;
  }
  const label = row.addText(result.station.label);
  label.font = Font.semiboldSystemFont(size);
  label.textColor = color;
  label.lineLimit = 1;
  return row;
}

function statusLine(result) {
  const r = result.reading;
  if (!r) return { text: result.error || "Ingen data", color: COLORS.error };
  const age = ageMinutes(r.time);
  if (isStale(r)) return { text: formatAge(age), color: COLORS.stale };
  if (result.error) return { text: `${formatAge(age)} · offline`, color: COLORS.stale };
  return { text: formatAge(age), color: COLORS.muted };
}

function tempText(parent, result, size, color) {
  const r = result.reading;
  const stale = !r || result.error || isStale(r);
  const t = parent.addText(formatTemp(r ? r.temp : null));
  t.font = Font.boldRoundedSystemFont(size);
  t.textColor = stale ? COLORS.stale : color || tempColor(r && r.temp, COLORS.text);
  t.minimumScaleFactor = 0.5;
  t.lineLimit = 1;
  return t;
}

function smallText(parent, text, size, color, weight) {
  const t = parent.addText(text);
  t.font = weight === "semibold" ? Font.semiboldSystemFont(size) : Font.mediumSystemFont(size);
  t.textColor = color;
  t.lineLimit = 1;
  return t;
}

function indoorText(r, decimals) {
  return r && r.indoor !== null && r.indoor !== undefined ? `inne ${formatTemp(r.indoor, decimals)}` : null;
}

// ---------------------------------------------------------------------------
// Utseende «Lys»
// ---------------------------------------------------------------------------

/** Liten widget: stasjonene under hverandre. */
function buildLysSmall(widget, results) {
  widget.backgroundColor = COLORS.bg;
  widget.setPadding(12, 14, 12, 14);
  const shown = results.slice(0, 2);
  shown.forEach((result, i) => {
    if (i > 0) widget.addSpacer();
    const r = result.reading;
    const stale = !r || result.error || isStale(r);
    addLabelRow(widget, result, i, 12, COLORS.muted);

    const row = widget.addStack();
    row.layoutHorizontally();
    row.bottomAlignContent();
    tempText(row, result, shown.length === 1 ? 44 : 30);
    row.addSpacer();
    const indoor = indoorText(r, 0);
    if (indoor) smallText(row, indoor, 11, COLORS.muted);
    if (shown.length === 1 || stale) {
      const s = statusLine(result);
      const t = widget.addText(s.text);
      t.font = Font.systemFont(10);
      t.textColor = s.color;
      t.lineLimit = 1;
    }
  });
}

/** Middels / stor widget: stasjonene side om side med litt mer detalj. */
function buildLysMedium(widget, results, large) {
  widget.backgroundColor = COLORS.bg;
  widget.setPadding(14, 16, 14, 16);
  const columns = widget.addStack();
  columns.layoutHorizontally();
  columns.topAlignContent();

  const shown = results.slice(0, large ? 4 : 2);
  shown.forEach((result, i) => {
    if (i > 0) {
      columns.addSpacer(10);
      const divider = columns.addStack();
      divider.backgroundColor = COLORS.divider;
      divider.size = new Size(1, large ? 220 : 110);
      columns.addSpacer(10);
    }
    const col = columns.addStack();
    col.layoutVertically();
    const r = result.reading;

    addLabelRow(col, result, i, large ? 16 : 13, COLORS.muted);
    col.addSpacer(large ? 6 : 2);
    tempText(col, result, large ? 56 : 40);

    const details = [];
    if (r && r.humidity !== null) details.push(`${Math.round(r.humidity)} % fukt`);
    if (large && r && r.feelsLike !== null && Math.abs(r.feelsLike - r.temp) >= 1) {
      details.push(`føles ${formatTemp(r.feelsLike, 0)}`);
    }
    const indoor = indoorText(r, 1);
    if (indoor) details.push(indoor);
    details.forEach((d) => smallText(col, d, large ? 14 : 12, COLORS.muted));

    col.addSpacer(large ? 8 : 4);
    const s = statusLine(result);
    const status = col.addText(s.text);
    status.font = Font.systemFont(large ? 12 : 10);
    status.textColor = s.color;
    status.lineLimit = 1;
    col.addSpacer();
  });
  if (shown.length === 1) columns.addSpacer();
}

// ---------------------------------------------------------------------------
// Utseende «Stor skrift»: svart/hvitt, bare det viktigste, størst mulig tall
// ---------------------------------------------------------------------------

const STOR = {
  bg: Color.dynamic(new Color("#FFFFFF"), new Color("#000000")),
  text: Color.dynamic(new Color("#000000"), new Color("#FFFFFF")),
  muted: Color.dynamic(new Color("#4A5058"), new Color("#B5BCC6")),
};

function buildStor(widget, results, family) {
  widget.backgroundColor = STOR.bg;
  const large = family === "large" || family === "extraLarge";
  const small = family === "small";
  widget.setPadding(small ? 10 : 14, small ? 12 : 18, small ? 10 : 14, small ? 12 : 18);

  const shown = results.slice(0, small ? 2 : large ? 4 : 2);
  const container = small || large ? widget : widget.addStack();
  if (!small && !large) {
    container.layoutHorizontally();
    container.centerAlignContent();
  }

  shown.forEach((result, i) => {
    if (i > 0) container.addSpacer(small ? null : large ? 10 : 14);
    const block = container.addStack();
    block.layoutVertically();
    const r = result.reading;
    const stale = !r || result.error || isStale(r);

    addLabelRow(block, result, i, small ? 13 : large ? 20 : 15, STOR.muted);

    const row = block.addStack();
    row.layoutHorizontally();
    row.bottomAlignContent();
    const t = tempText(row, result, small ? 40 : large ? 76 : 42, STOR.text);
    if (stale) t.textColor = COLORS.stale;
    row.addSpacer();

    const indoor = indoorText(r, 0);
    if (indoor && large) {
      const side = row.addStack();
      side.layoutVertically();
      side.bottomAlignContent();
      smallText(side, "inne", 15, STOR.muted);
      smallText(side, indoor.replace("inne ", ""), 30, STOR.muted).font = Font.boldRoundedSystemFont(30);
    } else if (indoor) {
      smallText(block, indoor, small ? 12 : 15, STOR.muted);
    }

    if (stale || large) {
      const s = statusLine(result);
      const status = block.addText(s.text);
      status.font = Font.systemFont(small ? 10 : large ? 13 : 11);
      status.textColor = stale ? s.color : STOR.muted;
      status.lineLimit = 1;
    }
  });
  if (!small && !large) container.addSpacer();
}

// ---------------------------------------------------------------------------
// Utseende «Farge»: bakgrunnen følger temperaturen
// ---------------------------------------------------------------------------

const FARGE_STOPS = [
  [-15, "#1E3A8A"],
  [0, "#2D6FD2"],
  [8, "#2A9DB8"],
  [16, "#3E9F5B"],
  [24, "#E3962B"],
  [32, "#D23F38"],
];

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(rgb) {
  return "#" + rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("");
}

function mix(a, b, f) {
  return a.map((v, i) => v + (b[i] - v) * f);
}

function colorForTemp(t) {
  if (t === null || t === undefined) return "#5B6472";
  if (t <= FARGE_STOPS[0][0]) return FARGE_STOPS[0][1];
  for (let i = 1; i < FARGE_STOPS.length; i++) {
    const [t1, c1] = FARGE_STOPS[i];
    const [t0, c0] = FARGE_STOPS[i - 1];
    if (t <= t1) return rgbToHex(mix(hexToRgb(c0), hexToRgb(c1), (t - t0) / (t1 - t0)));
  }
  return FARGE_STOPS[FARGE_STOPS.length - 1][1];
}

function tempGradient(t) {
  const top = hexToRgb(colorForTemp(t));
  const bottom = mix(top, [0, 0, 0], 0.22);
  const g = new LinearGradient();
  g.colors = [new Color(rgbToHex(top)), new Color(rgbToHex(bottom))];
  g.locations = [0, 1];
  g.startPoint = new Point(0, 0);
  g.endPoint = new Point(0.3, 1);
  return g;
}

function buildFarge(widget, results, family) {
  const large = family === "large" || family === "extraLarge";
  const small = family === "small";
  const white = new Color("#FFFFFF");
  const faint = new Color("#FFFFFF", 0.78);

  // Flere stasjoner får hver sin flate; én stasjon fyller hele widgeten.
  const shown = results.slice(0, small ? 2 : large ? 4 : 2);
  if (shown.length === 1) {
    widget.backgroundGradient = tempGradient(shown[0].reading && shown[0].reading.temp);
  } else {
    widget.backgroundColor = Color.dynamic(new Color("#E9EEF4"), new Color("#0E1115"));
  }
  const gap = 6;
  widget.setPadding(shown.length === 1 ? 14 : gap, shown.length === 1 ? 16 : gap, shown.length === 1 ? 14 : gap, shown.length === 1 ? 16 : gap);

  const container = small || large || shown.length === 1 ? widget : widget.addStack();
  if (container !== widget) {
    container.layoutHorizontally();
    container.topAlignContent();
  }

  shown.forEach((result, i) => {
    if (i > 0) container.addSpacer(gap);
    const r = result.reading;
    const stale = !r || result.error || isStale(r);
    const tile = container.addStack();
    tile.layoutVertically();
    tile.setPadding(small ? 8 : 12, small ? 10 : 14, small ? 8 : 12, small ? 10 : 14);
    if (shown.length > 1) {
      tile.backgroundGradient = tempGradient(r && r.temp);
      tile.cornerRadius = 14;
    }

    addLabelRow(tile, result, i, small ? 12 : large ? 17 : 14, faint);
    if (!small) tile.addSpacer(2);

    const row = tile.addStack();
    row.layoutHorizontally();
    row.bottomAlignContent();
    tempText(row, result, small ? 30 : large ? 60 : 40, white);
    row.addSpacer();
    const indoor = indoorText(r, small ? 0 : 1);
    const wide = large || shown.length === 1;
    if (indoor && !(!small && !wide)) smallText(row, indoor, small ? 11 : large ? 16 : 13, faint);
    if (!small) {
      tile.addSpacer(2);
      if (indoor && !wide) smallText(tile, indoor, 13, faint);
      const parts = [];
      if (r && r.humidity !== null && (!stale || wide)) parts.push(`${Math.round(r.humidity)} % fukt`);
      const s = statusLine(result);
      parts.push(s.text);
      smallText(tile, parts.join(" · "), large ? 13 : 11, stale ? new Color("#FFE2B8") : faint);
    } else if (stale) {
      smallText(tile, statusLine(result).text, 10, new Color("#FFE2B8"));
    }
    if (!small) tile.addSpacer();
  });
  if (container !== widget && shown.length === 1) container.addSpacer();
}

// ---------------------------------------------------------------------------
// Utseende «Tabell»: ute og inne i hver sin kolonne
// ---------------------------------------------------------------------------

function cell(parent, width, align) {
  const c = parent.addStack();
  c.layoutHorizontally();
  c.bottomAlignContent();
  c.size = new Size(width, 0);
  if (align === "right") c.addSpacer();
  return c;
}

function buildTabell(widget, results, family) {
  widget.backgroundColor = COLORS.bg;
  const large = family === "large" || family === "extraLarge";
  const small = family === "small";
  widget.setPadding(small ? 12 : 14, small ? 12 : 16, small ? 12 : 14, small ? 12 : 16);
  const shown = results.slice(0, small ? 3 : large ? 5 : 3);

  const colW = small ? 40 : large ? 104 : 88;
  const numSize = small ? 20 : large ? 32 : 28;
  const nameSize = small ? 12 : large ? 18 : 15;

  const header = widget.addStack();
  header.layoutHorizontally();
  header.addSpacer();
  smallText(cell(header, colW, "right"), "Ute", small ? 10 : large ? 14 : 12, COLORS.muted, "semibold");
  smallText(cell(header, colW, "right"), "Inne", small ? 10 : large ? 14 : 12, COLORS.muted, "semibold");
  widget.addSpacer(small ? 4 : large ? 10 : 6);

  shown.forEach((result, i) => {
    if (i > 0) {
      widget.addSpacer(small ? 4 : large ? 8 : 5);
      const line = widget.addStack();
      line.backgroundColor = COLORS.divider;
      line.size = new Size(0, 1);
      widget.addSpacer(small ? 4 : large ? 8 : 5);
    }
    const r = result.reading;
    const stale = !r || result.error || isStale(r);
    const row = widget.addStack();
    row.layoutHorizontally();
    row.centerAlignContent();

    const name = row.addStack();
    name.layoutVertically();
    addLabelRow(name, result, i, nameSize, COLORS.text);
    const s = statusLine(result);
    if (large || stale || result.error) {
      const st = name.addText(s.text);
      st.font = Font.systemFont(small ? 9 : large ? 12 : 10);
      st.textColor = s.color;
      st.lineLimit = 1;
      if (large && r && r.humidity !== null && !stale) smallText(name, `${Math.round(r.humidity)} % fukt`, 12, COLORS.muted);
    }
    row.addSpacer();

    const ute = tempText(cell(row, colW, "right"), result, numSize);
    if (small) ute.text = formatTemp(r ? r.temp : null, 0);
    const indoor = indoorText(r, large ? 1 : 0);
    const t = cell(row, colW, "right").addText(indoor ? indoor.replace("inne ", "") : "–");
    t.font = Font.boldRoundedSystemFont(numSize);
    t.textColor = stale ? COLORS.stale : COLORS.text;
    t.lineLimit = 1;
    t.minimumScaleFactor = 0.5;
  });
  widget.addSpacer();
}

/** Låseskjerm, rektangulær: én linje per stasjon. */
function buildRectangular(widget, results) {
  results.slice(0, 3).forEach((result, i) => {
    const row = widget.addStack();
    row.layoutHorizontally();
    row.centerAlignContent();
    const symbol = iconFor(result.station, i);
    if (symbol) {
      const img = row.addImage(symbol.image);
      img.imageSize = new Size(14, 14);
    }
    row.addSpacer(4);
    const label = row.addText(result.station.label);
    label.font = Font.mediumSystemFont(14);
    label.lineLimit = 1;
    row.addSpacer();
    const r = result.reading;
    const temp = row.addText(formatTemp(r ? r.temp : null));
    temp.font = Font.boldRoundedSystemFont(16);
    temp.lineLimit = 1;
    if (!r || result.error || isStale(r)) temp.textOpacity = 0.6;
  });
}

/** Låseskjerm, linje over klokka. */
function buildInline(widget, results) {
  const text = results
    .slice(0, 2)
    .map((r) => `${r.station.label} ${formatTemp(r.reading ? r.reading.temp : null, 0)}`)
    .join("  ");
  widget.addText(text);
}

/** Låseskjerm, rund: én stasjon (bruk parameter for å velge hvilken). */
function buildCircular(widget, results) {
  widget.addAccessoryWidgetBackground = true;
  const result = results[0];
  const r = result.reading;
  const top = widget.addStack();
  top.addSpacer();
  const symbol = iconFor(result.station, 0);
  if (symbol) {
    const img = top.addImage(symbol.image);
    img.imageSize = new Size(12, 12);
  }
  top.addSpacer();
  const row = widget.addStack();
  row.addSpacer();
  const t = row.addText(formatTemp(r ? r.temp : null, 0));
  t.font = Font.boldRoundedSystemFont(20);
  t.minimumScaleFactor = 0.5;
  t.lineLimit = 1;
  row.addSpacer();
}

function buildMessageWidget(title, message) {
  const widget = new ListWidget();
  widget.backgroundColor = COLORS.bg;
  widget.setPadding(14, 14, 14, 14);
  const t = widget.addText(title);
  t.font = Font.semiboldSystemFont(14);
  t.textColor = COLORS.text;
  widget.addSpacer(4);
  const m = widget.addText(message);
  m.font = Font.systemFont(12);
  m.textColor = COLORS.muted;
  m.minimumScaleFactor = 0.7;
  return widget;
}

function buildWidget(results, family, style) {
  const widget = new ListWidget();
  widget.refreshAfterDate = new Date(Date.now() + SETTINGS.refreshMinutes * 60000);

  // Trykk på widgeten åpner en større oversikt.
  widget.url = `scriptable:///run/${encodeURIComponent(Script.name())}?view=details`;

  // Låseskjermen er alltid svart/hvit, så utseendet gjelder bare hjemskjermen.
  if (family === "accessoryRectangular") buildRectangular(widget, results);
  else if (family === "accessoryInline") buildInline(widget, results);
  else if (family === "accessoryCircular") buildCircular(widget, results);
  else if (style === "stor") buildStor(widget, results, family);
  else if (style === "farge") buildFarge(widget, results, family);
  else if (style === "tabell") buildTabell(widget, results, family);
  else if (family === "small") buildLysSmall(widget, results);
  else buildLysMedium(widget, results, family === "large" || family === "extraLarge");
  return widget;
}

/**
 * Tolker widget-parameteren. Den kan inneholde et stasjonsnavn, et utseende,
 * eller begge adskilt med komma: «Hytta», «farge», «Hytta, stor skrift».
 */
function parseParameter(stations, parameter, defaultStyle) {
  let style = defaultStyle;
  let shown = stations;
  const tokens = (parameter || "").split(/[,;]/).map((t) => t.trim().toLowerCase()).filter(Boolean);
  for (const token of tokens) {
    const styleId = Object.keys(STYLES).find((id) => id === token || STYLES[id].name.toLowerCase() === token);
    if (styleId) {
      style = styleId;
      continue;
    }
    const exact = stations.filter((s) => s.label.toLowerCase() === token);
    const partial = exact.length ? exact : stations.filter((s) => s.label.toLowerCase().includes(token));
    if (partial.length) shown = partial;
  }
  return { style, stations: shown };
}

// ===========================================================================
// Oppsett i appen
// ===========================================================================

async function askForKeys() {
  const existing = getKeys();
  const a = new Alert();
  a.title = "Ecowitt-nøkler";
  a.message =
    "Logg inn på ecowitt.net → Profil (øverst til høyre) → Private Center. " +
    "Lag en «Application Key» og en «API Key», og lim dem inn her.";
  a.addTextField("Application Key", existing ? existing.applicationKey : "");
  a.addTextField("API Key", existing ? existing.apiKey : "");
  a.addAction("Lagre");
  a.addCancelAction("Avbryt");
  if ((await a.presentAlert()) === -1) return null;
  const applicationKey = a.textFieldValue(0).trim();
  const apiKey = a.textFieldValue(1).trim();
  if (!applicationKey || !apiKey) {
    await showMessage("Mangler nøkkel", "Begge feltene må fylles ut.");
    return null;
  }
  saveKeys(applicationKey, apiKey);
  return { applicationKey, apiKey };
}

async function showMessage(title, message) {
  const a = new Alert();
  a.title = title;
  a.message = message;
  a.addAction("OK");
  await a.presentAlert();
}

async function chooseStations(keys) {
  let devices;
  try {
    devices = await fetchDeviceList(keys);
  } catch (e) {
    await showMessage("Fikk ikke hentet stasjoner", e.message || String(e));
    return null;
  }
  if (!devices.length) {
    await showMessage(
      "Ingen stasjoner funnet",
      "Kontoen har ingen stasjoner på ecowitt.net. Sjekk at stasjonene er lagt til i Ecowitt-appen med samme konto."
    );
    return null;
  }

  const previous = getStations() || [];
  const chosen = [];
  for (const device of devices) {
    const prev = previous.find((p) => p.id === device.id);
    const a = new Alert();
    a.title = device.name;
    a.message = `Skal denne vises i widgeten? Gi den gjerne et kort navn.\n(${device.mac || device.imei})`;
    a.addTextField("Navn", prev ? prev.label : device.name);
    a.addAction("Vis");
    a.addAction("Ikke vis");
    const choice = await a.presentAlert();
    if (choice === 0) {
      chosen.push({
        id: device.id,
        label: a.textFieldValue(0).trim() || device.name,
        mac: device.mac,
        imei: device.imei,
      });
    }
  }
  if (!chosen.length) {
    await showMessage("Ingen valgt", "Velg minst én stasjon.");
    return null;
  }

  if (chosen.length > 1) {
    const order = new Alert();
    order.title = "Hvilken er hjemme?";
    order.message = "Den står først i widgeten, med hus-ikon. De andre får hytte-ikon.";
    chosen.forEach((s) => order.addAction(s.label));
    const first = await order.presentSheet();
    if (first > 0) chosen.unshift(chosen.splice(first, 1)[0]);
  }

  chosen.forEach((s, i) => (s.icon = i === 0 ? "house.fill" : "house.lodge.fill"));
  saveStations(chosen);
  return chosen;
}

async function ensureSetup() {
  let keys = getKeys();
  if (!keys) keys = await askForKeys();
  if (!keys) return null;
  let stations = getStations();
  if (!stations) stations = await chooseStations(keys);
  if (!stations) return null;
  return { keys, stations };
}

async function preview(keys, stations, family, style) {
  const results = await loadAll(keys, stations);
  const widget = buildWidget(results, family, style || getStyle());
  if (family === "small") await widget.presentSmall();
  else if (family === "large") await widget.presentLarge();
  else await widget.presentMedium();
}

/** Lar brukeren bla gjennom utseendene og velge ett. */
async function chooseStyle(keys, stations) {
  const ids = Object.keys(STYLES);
  const current = getStyle();
  while (true) {
    const a = new Alert();
    a.title = "Velg utseende";
    a.message = `Nå: ${STYLES[current].name}\n${STYLES[current].description}`;
    ids.forEach((id) => a.addAction(`${id === current ? "✓ " : ""}${STYLES[id].name}`));
    a.addCancelAction("Tilbake");
    const choice = await a.presentSheet();
    if (choice === -1) return;
    const id = ids[choice];
    await preview(keys, stations, "medium", id);
    const confirm = new Alert();
    confirm.title = STYLES[id].name;
    confirm.message = STYLES[id].description;
    confirm.addAction("Bruk denne");
    confirm.addAction("Se liten størrelse");
    confirm.addCancelAction("Prøv en annen");
    const answer = await confirm.presentAlert();
    if (answer === 1) {
      await preview(keys, stations, "small", id);
      const again = new Alert();
      again.title = STYLES[id].name;
      again.addAction("Bruk denne");
      again.addCancelAction("Prøv en annen");
      if ((await again.presentAlert()) === -1) continue;
    } else if (answer !== 0) continue;
    saveStyle(id);
    return;
  }
}

async function runInApp() {
  const setup = await ensureSetup();
  if (!setup) return;

  if (args.queryParameters && args.queryParameters.view === "details") {
    await preview(setup.keys, setup.stations, "large");
    return;
  }

  while (true) {
    const keys = getKeys();
    const stations = getStations();
    const menu = new Alert();
    menu.title = "Temp-widget";
    menu.message = `${stations.map((s) => s.label).join(" · ")}\nUtseende: ${STYLES[getStyle()].name}`;
    menu.addAction("Vis liten widget");
    menu.addAction("Vis middels widget");
    menu.addAction("Vis stor widget");
    menu.addAction("Velg utseende");
    menu.addAction("Velg / gi navn til stasjoner");
    menu.addAction("Endre Ecowitt-nøkler");
    menu.addCancelAction("Ferdig");
    const choice = await menu.presentSheet();
    if (choice === -1) return;
    if (choice === 0) await preview(keys, stations, "small");
    if (choice === 1) await preview(keys, stations, "medium");
    if (choice === 2) await preview(keys, stations, "large");
    if (choice === 3) await chooseStyle(keys, stations);
    if (choice === 4) await chooseStations(keys);
    if (choice === 5) {
      const newKeys = await askForKeys();
      if (newKeys) await chooseStations(newKeys);
    }
  }
}

async function runInWidget() {
  const family = config.widgetFamily || "medium";
  const keys = getKeys();
  const stations = getStations();
  if (!keys || !stations) {
    return buildMessageWidget(
      "Ikke satt opp",
      `Åpne Scriptable og kjør «${Script.name()}» én gang for å legge inn nøkler.`
    );
  }
  const { style, stations: shown } = parseParameter(stations, args.widgetParameter, getStyle());
  const results = await loadAll(keys, shown);
  return buildWidget(results, family, style);
}

// ===========================================================================

if (config.runsInWidget) {
  let widget;
  try {
    widget = await runInWidget();
  } catch (e) {
    widget = buildMessageWidget("Feil", e.message || String(e));
  }
  Script.setWidget(widget);
} else {
  await runInApp();
}
Script.complete();

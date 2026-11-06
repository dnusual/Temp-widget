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
 * Widget-parameter (valgfritt, settes ved å holde inne widgeten → Rediger):
 *   tomt     → viser alle valgte stasjoner
 *   «Hytta»  → viser bare stasjonen med det navnet
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
        return { station, reading: cached, error: e.message || String(e), fromCache: !!cached };
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

/** Liten widget: stasjonene under hverandre. */
function buildSmall(widget, results) {
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
    const temp = row.addText(formatTemp(r ? r.temp : null));
    temp.font = Font.boldRoundedSystemFont(shown.length === 1 ? 44 : 30);
    temp.textColor = stale ? COLORS.stale : tempColor(r && r.temp, COLORS.text);
    temp.minimumScaleFactor = 0.6;
    temp.lineLimit = 1;
    row.addSpacer();
    if (r && r.indoor !== null && r.indoor !== undefined) {
      const indoor = row.addText(`inne ${formatTemp(r.indoor, 0)}`);
      indoor.font = Font.mediumSystemFont(11);
      indoor.textColor = COLORS.muted;
      indoor.lineLimit = 1;
    }
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
function buildMedium(widget, results, large) {
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
    const stale = !r || result.error || isStale(r);

    addLabelRow(col, result, i, large ? 16 : 13, COLORS.muted);
    col.addSpacer(large ? 6 : 2);

    const temp = col.addText(formatTemp(r ? r.temp : null));
    temp.font = Font.boldRoundedSystemFont(large ? 56 : 40);
    temp.textColor = stale ? COLORS.stale : tempColor(r && r.temp, COLORS.text);
    temp.minimumScaleFactor = 0.5;
    temp.lineLimit = 1;

    const details = [];
    if (r && r.humidity !== null) details.push(`${Math.round(r.humidity)} % fukt`);
    if (large && r && r.feelsLike !== null && Math.abs(r.feelsLike - r.temp) >= 1) {
      details.push(`føles ${formatTemp(r.feelsLike, 0)}`);
    }
    if (r && r.indoor !== null) details.push(`inne ${formatTemp(r.indoor)}`);
    details.forEach((d) => {
      const t = col.addText(d);
      t.font = Font.mediumSystemFont(large ? 14 : 12);
      t.textColor = COLORS.muted;
      t.lineLimit = 1;
    });

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

function buildWidget(results, family) {
  const widget = new ListWidget();
  widget.refreshAfterDate = new Date(Date.now() + SETTINGS.refreshMinutes * 60000);

  // Trykk på widgeten åpner en større oversikt.
  widget.url = `scriptable:///run/${encodeURIComponent(Script.name())}?view=details`;

  if (family === "accessoryRectangular") buildRectangular(widget, results);
  else if (family === "accessoryInline") buildInline(widget, results);
  else if (family === "accessoryCircular") buildCircular(widget, results);
  else {
    widget.backgroundColor = COLORS.bg;
    if (family === "small") buildSmall(widget, results);
    else buildMedium(widget, results, family === "large" || family === "extraLarge");
  }
  return widget;
}

function filterByParameter(stations, parameter) {
  const p = (parameter || "").trim().toLowerCase();
  if (!p) return stations;
  const hits = stations.filter((s) => s.label.toLowerCase() === p);
  if (hits.length) return hits;
  const partial = stations.filter((s) => s.label.toLowerCase().includes(p));
  return partial.length ? partial : stations;
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

async function preview(keys, stations, family) {
  const results = await loadAll(keys, stations);
  const widget = buildWidget(results, family);
  if (family === "small") await widget.presentSmall();
  else if (family === "large") await widget.presentLarge();
  else await widget.presentMedium();
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
    menu.message = stations.map((s) => s.label).join(" · ");
    menu.addAction("Vis liten widget");
    menu.addAction("Vis middels widget");
    menu.addAction("Vis stor widget");
    menu.addAction("Velg / gi navn til stasjoner");
    menu.addAction("Endre Ecowitt-nøkler");
    menu.addCancelAction("Ferdig");
    const choice = await menu.presentSheet();
    if (choice === -1) return;
    if (choice === 0) await preview(keys, stations, "small");
    if (choice === 1) await preview(keys, stations, "medium");
    if (choice === 2) await preview(keys, stations, "large");
    if (choice === 3) await chooseStations(keys);
    if (choice === 4) {
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
  const shown = filterByParameter(stations, args.widgetParameter);
  const results = await loadAll(keys, shown);
  return buildWidget(results, family);
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

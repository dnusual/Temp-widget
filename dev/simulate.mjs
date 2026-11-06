// Kjører TempWidget.js utenfor iPhone med en enkel etterligning av Scriptable,
// og falske svar fra Ecowitt. Brukes bare til testing under utvikling.
//
//   node dev/simulate.mjs            → kjører alle scenarier og skriver dev/preview.html
//
// Scenariene sjekker at scriptet kjører uten feil for alle widget-størrelser,
// at feil hos Ecowitt håndteres, og at bufret data brukes når hytta er offline.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "TempWidget.js"), "utf8");

// ---------------------------------------------------------------------------
// Falske Ecowitt-svar
// ---------------------------------------------------------------------------

const now = () => Math.floor(Date.now() / 1000);
const v = (value, unit, ageMin = 3) => ({ time: String(now() - ageMin * 60), unit, value: String(value) });

const DEVICES = {
  code: 0,
  msg: "success",
  time: String(now()),
  data: {
    total: 2,
    totalPage: 1,
    pageNum: 1,
    list: [
      { id: 1, name: "GW2000 Hjem", mac: "AA:BB:CC:00:00:01", type: 1, stationtype: "GW2000A" },
      { id: 2, name: "Hytta Geilo", mac: "AA:BB:CC:00:00:02", type: 1, stationtype: "GW1100" },
    ],
  },
};

function realtime(outTemp, inTemp, { ageMin = 3, hum = 81, feels } = {}) {
  return {
    code: 0,
    msg: "success",
    time: String(now()),
    data: {
      outdoor: {
        temperature: v(outTemp, "℃", ageMin),
        feels_like: v(feels ?? outTemp, "℃", ageMin),
        humidity: v(hum, "%", ageMin),
      },
      indoor: { temperature: v(inTemp, "℃", ageMin), humidity: v(38, "%", ageMin) },
      pressure: { relative: v(1012.3, "hPa", ageMin) },
    },
  };
}

// ---------------------------------------------------------------------------
// Etterligning av Scriptable
// ---------------------------------------------------------------------------

function makeEnv({ family, runsInWidget, keychain, responses, alerts = [], parameter = null, query = {}, docs }) {
  const requests = [];
  const presented = [];
  let widgetSet = null;

  class Color {
    constructor(hex, alpha = 1) { this.hex = hex; this.alpha = alpha; }
    static dynamic(light, dark) { const c = new Color(light.hex); c.dark = dark.hex; return c; }
    static white() { return new Color("#FFFFFF"); }
    static black() { return new Color("#000000"); }
  }
  class Font {
    constructor(weight, size, rounded = false) { Object.assign(this, { weight, size, rounded }); }
  }
  for (const w of ["regular", "medium", "semibold", "bold"]) {
    Font[`${w === "regular" ? "" : w}${w === "regular" ? "systemFont" : "SystemFont"}`] = (s) => new Font(w, s);
    Font[`${w}RoundedSystemFont`] = (s) => new Font(w, s, true);
  }
  class Size { constructor(w, h) { this.width = w; this.height = h; } }

  class Element { constructor(kind) { this.kind = kind; } }
  class WidgetText extends Element {
    constructor(text) { super("text"); this.text = text; this.align = "left"; }
    leftAlignText() { this.align = "left"; } centerAlignText() { this.align = "center"; } rightAlignText() { this.align = "right"; }
  }
  class WidgetImage extends Element { constructor(image) { super("image"); this.image = image; } }
  class WidgetSpacer extends Element { constructor(length) { super("spacer"); this.length = length; } }
  class Container extends Element {
    constructor(kind) { super(kind); this.children = []; this.layout = kind === "widget" ? "vertical" : "horizontal"; this.align = "center"; }
    addText(t) { assert.equal(typeof t, "string", "addText krever streng"); const e = new WidgetText(t); this.children.push(e); return e; }
    addDate(d) { const e = new WidgetText(d.toISOString()); this.children.push(e); return e; }
    addImage(img) { assert.ok(img, "addImage fikk null"); const e = new WidgetImage(img); this.children.push(e); return e; }
    addSpacer(l) { const e = new WidgetSpacer(l ?? null); this.children.push(e); return e; }
    addStack() { const e = new Container("stack"); this.children.push(e); return e; }
    layoutHorizontally() { this.layout = "horizontal"; } layoutVertically() { this.layout = "vertical"; }
    topAlignContent() { this.align = "top"; } centerAlignContent() { this.align = "center"; } bottomAlignContent() { this.align = "bottom"; }
    setPadding(t, l, b, r) { this.padding = [t, l, b, r]; }
  }
  class ListWidget extends Container {
    constructor() { super("widget"); }
    async presentSmall() { presented.push({ size: "small", widget: this }); }
    async presentMedium() { presented.push({ size: "medium", widget: this }); }
    async presentLarge() { presented.push({ size: "large", widget: this }); }
  }
  const SYMBOLS = new Set(["house.fill", "house.lodge.fill", "mountain.2.fill"]);
  const SFSymbol = { named: (n) => (SYMBOLS.has(n) ? { image: { symbol: n } } : null) };

  class Request {
    constructor(url) { this.url = url; }
    async loadJSON() {
      requests.push(this.url);
      const u = new URL(this.url);
      const handler = responses[u.pathname.replace("/api/v3/", "")];
      assert.ok(handler, `Uventet kall: ${u.pathname}`);
      const res = handler(u.searchParams);
      if (res instanceof Error) throw res;
      return JSON.parse(JSON.stringify(res));
    }
  }

  const Keychain = {
    contains: (k) => Object.prototype.hasOwnProperty.call(keychain, k),
    get: (k) => { if (!(k in keychain)) throw new Error("not in keychain"); return keychain[k]; },
    set: (k, val) => { assert.equal(typeof val, "string"); keychain[k] = val; },
    remove: (k) => { delete keychain[k]; },
  };

  const FileManager = {
    local: () => ({
      documentsDirectory: () => docs,
      joinPath: (a, b) => path.join(a, b),
      fileExists: (p) => fs.existsSync(p),
      readString: (p) => fs.readFileSync(p, "utf8"),
      writeString: (p, s) => fs.writeFileSync(p, s),
    }),
  };

  class Alert {
    constructor() { this.actions = []; this.fields = []; }
    addTextField(placeholder, text = "") { this.fields.push(text); }
    addSecureTextField(placeholder, text = "") { this.fields.push(text); }
    addAction(t) { this.actions.push(t); }
    addCancelAction(t) { this.cancel = t; }
    addDestructiveAction(t) { this.actions.push(t); }
    textFieldValue(i) { return this.fields[i]; }
    async presentAlert() { return this._answer(); }
    async presentSheet() { return this._answer(); }
    _answer() {
      const next = alerts.shift();
      assert.ok(next, `Ingen svar forberedt for dialog «${this.title}»`);
      if (next.expectTitle) assert.match(this.title, next.expectTitle);
      if (next.fields) next.fields.forEach((f, i) => { if (f !== undefined) this.fields[i] = f; });
      return next.choice;
    }
  }

  const Script = {
    name: () => "Temp",
    setWidget: (w) => { widgetSet = w; },
    complete: () => {},
  };

  const env = {
    Color, Font, Size, ListWidget, SFSymbol, Request, Keychain, FileManager, Alert, Script,
    LinearGradient: class { },
    config: { runsInWidget, runsInApp: !runsInWidget, widgetFamily: runsInWidget ? family : null },
    args: { widgetParameter: parameter, queryParameters: query },
  };
  return { env, requests, presented, get widget() { return widgetSet; }, keychain, alerts };
}

async function run(opts) {
  const ctx = makeEnv(opts);
  const names = Object.keys(ctx.env);
  const fn = new Function(...names, `return (async () => {\n${source}\n})();`);
  await fn(...names.map((n) => ctx.env[n]));
  return ctx;
}

// ---------------------------------------------------------------------------
// HTML-forhåndsvisning (omtrentlig – bare for å se layout)
// ---------------------------------------------------------------------------

const SIZES = {
  small: [170, 170], medium: [364, 170], large: [364, 382],
  accessoryRectangular: [172, 76], accessoryInline: [257, 26], accessoryCircular: [76, 76],
};

function css(color) { return color ? color.hex : "inherit"; }

function render(el, parentLayout) {
  if (el.kind === "text") {
    const f = el.font || { size: 17, weight: "regular" };
    const weight = { regular: 400, medium: 500, semibold: 600, bold: 700 }[f.weight];
    const family = f.rounded ? "ui-rounded, 'SF Pro Rounded', system-ui" : "system-ui";
    return `<div style="font:${weight} ${f.size}px ${family};color:${css(el.textColor)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:${el.textOpacity ?? 1};text-align:${el.align}">${el.text}</div>`;
  }
  if (el.kind === "image") {
    const s = el.imageSize || { width: 16, height: 16 };
    const glyph = el.image.symbol === "house.fill" ? "🏠" : "🏔";
    return `<div style="width:${s.width}px;height:${s.height}px;font-size:${s.width - 1}px;line-height:${s.height}px">${glyph}</div>`;
  }
  if (el.kind === "spacer") {
    return el.length === null ? `<div style="flex:1 1 0"></div>` : `<div style="flex:0 0 ${el.length}px"></div>`;
  }
  const horizontal = el.layout === "horizontal";
  const align = { top: "flex-start", center: "center", bottom: "flex-end" }[el.align];
  const size = el.size ? `width:${el.size.width}px;height:${el.size.height}px;flex:none;` : "";
  const bg = el.backgroundColor ? `background:${el.backgroundColor.hex};` : "";
  return `<div style="display:flex;flex-direction:${horizontal ? "row" : "column"};align-items:${horizontal ? align : "stretch"};gap:${el.spacing || 0}px;${size}${bg}min-width:0">${el.children.map((c) => render(c, el.layout)).join("")}</div>`;
}

function renderWidget(widget, family, title) {
  const [w, h] = SIZES[family];
  const p = widget.padding || (family.startsWith("accessory") ? [0, 0, 0, 0] : [16, 16, 16, 16]);
  const bg = widget.backgroundColor ? widget.backgroundColor.hex : "rgba(255,255,255,.18)";
  const color = widget.backgroundColor ? "#14181F" : "#fff";
  const radius = family === "accessoryCircular" ? "50%" : family.startsWith("accessory") ? "12px" : "22px";
  return `<figure><div style="width:${w}px;height:${h}px;box-sizing:border-box;padding:${p[0]}px ${p[3]}px ${p[2]}px ${p[1]}px;background:${bg};color:${color};border-radius:${radius};display:flex;flex-direction:column;justify-content:center;overflow:hidden">${widget.children.map((c) => render(c, "vertical")).join("")}</div><figcaption>${title}</figcaption></figure>`;
}

// ---------------------------------------------------------------------------
// Scenarier
// ---------------------------------------------------------------------------

const APP = "tempwidget.ecowitt.applicationKey";
const KEY = "tempwidget.ecowitt.apiKey";
const STATIONS = "tempwidget.ecowitt.stations";

const docs = fs.mkdtempSync(path.join(os.tmpdir(), "tempwidget-"));
const previews = [];

const normal = {
  "device/list": () => DEVICES,
  "device/real_time": (q) => (q.get("mac").endsWith("01") ? realtime(4.26, 21.8, { feels: 1.9 }) : realtime(-7.04, 9.6, { hum: 92 })),
};

// 1. Førstegangsoppsett i appen: nøkler → stasjoner → rekkefølge → forhåndsvis → ferdig
{
  const keychain = {};
  const ctx = await run({
    runsInWidget: false, keychain, docs, responses: normal,
    alerts: [
      { expectTitle: /nøkler/, fields: ["  app-123 ", "api-456"], choice: 0 },
      { expectTitle: /GW2000/, fields: ["Hjemme"], choice: 0 },
      { expectTitle: /Hytta/, fields: ["Hytta"], choice: 0 },
      { expectTitle: /først/, choice: 0 },
      { expectTitle: /Temp-widget/, choice: 1 }, // vis middels
      { expectTitle: /Temp-widget/, choice: -1 }, // ferdig
    ],
  });
  assert.equal(keychain[APP], "app-123", "nøkkel skal trimmes");
  const saved = JSON.parse(keychain[STATIONS]);
  assert.deepEqual(saved.map((s) => s.label), ["Hjemme", "Hytta"]);
  assert.deepEqual(saved.map((s) => s.icon), ["house.fill", "house.lodge.fill"]);
  assert.equal(ctx.presented[0].size, "medium");
  assert.ok(ctx.requests.some((u) => u.includes("temp_unitid=1")), "skal be om °C");
  console.log("✓ førstegangsoppsett");
}

const configured = () => ({
  [APP]: "app-123",
  [KEY]: "api-456",
  [STATIONS]: JSON.stringify([
    { id: "AA:BB:CC:00:00:01", label: "Hjemme", mac: "AA:BB:CC:00:00:01", icon: "house.fill" },
    { id: "AA:BB:CC:00:00:02", label: "Hytta", mac: "AA:BB:CC:00:00:02", icon: "house.lodge.fill" },
  ]),
});

const texts = (el) => (el.kind === "text" ? [el.text] : (el.children || []).flatMap(texts));

// 2. Alle widget-størrelser med normale data
for (const family of Object.keys(SIZES)) {
  const ctx = await run({ runsInWidget: true, family, keychain: configured(), docs, responses: normal });
  assert.ok(ctx.widget, `${family}: ingen widget satt`);
  const all = texts(ctx.widget).join(" | ");
  if (family !== "accessoryCircular") assert.match(all, /−7,0°|−7°/, `${family}: mangler hyttetemp: ${all}`);
  assert.match(all, /4,3°|4°/, `${family}: mangler hjemmetemp: ${all}`);
  previews.push(renderWidget(ctx.widget, family, family));
  console.log(`✓ ${family}: ${all}`);
}

// 3. Hytta offline: ett vellykket kall først (fyller cache), så feil → bufret verdi vises som offline
{
  const failing = { ...normal, "device/real_time": (q) => (q.get("mac").endsWith("02") ? new Error("The request timed out.") : normal["device/real_time"](q)) };
  const ctx = await run({ runsInWidget: true, family: "medium", keychain: configured(), docs, responses: failing });
  const all = texts(ctx.widget).join(" | ");
  assert.match(all, /−7,0°/, "bufret hyttetemp skal vises");
  assert.match(all, /offline/);
  previews.push(renderWidget(ctx.widget, "medium", "medium – hytta offline (bufret verdi)"));
  console.log(`✓ offline med cache: ${all}`);
}

// 4. Gammel data fra stasjonen (f.eks. strømbrudd på hytta i 5 timer)
{
  const stale = { ...normal, "device/real_time": (q) => (q.get("mac").endsWith("02") ? realtime(-2.5, 3.1, { ageMin: 300 }) : normal["device/real_time"](q)) };
  const ctx = await run({ runsInWidget: true, family: "small", keychain: configured(), docs, responses: stale });
  const all = texts(ctx.widget).join(" | ");
  assert.match(all, /5 t siden/);
  previews.push(renderWidget(ctx.widget, "small", "small – gamle data fra hytta"));
  console.log(`✓ gamle data: ${all}`);
}

// 5. Feil nøkler og ingen cache
{
  fs.rmSync(path.join(docs, "tempwidget-cache.json"), { force: true });
  const bad = { "device/real_time": () => ({ code: 40011, msg: "Illegal Api_Key Parameter", time: String(now()), data: [] }) };
  const ctx = await run({ runsInWidget: true, family: "medium", keychain: configured(), docs, responses: bad });
  const all = texts(ctx.widget).join(" | ");
  assert.match(all, /Ugyldig API Key/);
  previews.push(renderWidget(ctx.widget, "medium", "medium – feil API-nøkkel"));
  console.log(`✓ feil nøkkel: ${all}`);
}

// 6. Ikke satt opp ennå
{
  const ctx = await run({ runsInWidget: true, family: "small", keychain: {}, docs, responses: normal });
  assert.match(texts(ctx.widget).join(" "), /Ikke satt opp/);
  console.log("✓ ikke satt opp");
}

// 7. Widget-parameter «hytta» viser bare hytta, med hytte-ikon
{
  const ctx = await run({ runsInWidget: true, family: "accessoryCircular", parameter: "hytta", keychain: configured(), docs, responses: normal });
  const all = texts(ctx.widget).join(" | ");
  assert.equal(all, "−7°");
  assert.equal(ctx.requests.length, 1, "skal bare hente én stasjon");
  previews.push(renderWidget(ctx.widget, "accessoryCircular", "rund – parameter «Hytta»"));
  console.log(`✓ parameter: ${all}`);
}

// 8. Trykk på widget → stor oversikt
{
  const ctx = await run({ runsInWidget: false, keychain: configured(), docs, responses: normal, query: { view: "details" } });
  assert.equal(ctx.presented[0].size, "large");
  console.log("✓ trykk åpner stor oversikt");
}

// 9. Stasjon uten utesensor, men med CH1-sensor
{
  const ch = { ...normal, "device/real_time": () => ({ code: 0, msg: "success", data: { indoor: { temperature: v(20.1, "℃") }, temp_and_humidity_ch1: { temperature: v(-12.34, "℃"), humidity: v(70, "%") } } }) };
  const ctx = await run({ runsInWidget: true, family: "small", keychain: configured(), docs, responses: ch });
  assert.match(texts(ctx.widget).join(" "), /−12,3°/);
  console.log("✓ CH1-sensor som reserve");
}

const html = `<!doctype html><meta charset="utf-8"><title>Temp-widget forhåndsvisning</title>
<style>body{margin:0;padding:24px;background:linear-gradient(160deg,#3b5b8c,#1b2a44);font-family:system-ui;display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start}
figure{margin:0}figcaption{color:#dfe7f3;font-size:12px;margin-top:6px}</style>${previews.join("\n")}`;
fs.writeFileSync(path.join(here, "preview.html"), html);
console.log("\nAlle scenarier OK. Forhåndsvisning: dev/preview.html");

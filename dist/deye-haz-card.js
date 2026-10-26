/*
 * Deye Ház Card – 3D off-grid napelemes ház kártya Home Assistanthoz
 * Deye párhuzamos inverterek (Solarman) + akkumulátor + bővíthető sztringek
 * Licenc: MIT
 */
const VERSION = "1.0.0";
const BASE = new URL(".", import.meta.url).href;   // /hacsfiles/deye-haz-card/

// --------------------------------------------------------------------------
//  Alapértelmezett beállítások (a saját telekhez igazítva – YAML-ban felülírható)
// --------------------------------------------------------------------------
const DEFAULTS = {
  image_day: BASE + "haz_nappal.jpg",
  image_night: BASE + "haz_ejjel.jpg",
  night: "auto",                      // auto | always | never
  aspect_ratio: 1600 / 1100,
  entities: {
    pv: "sensor.deye_pv_teljesitmeny",
    pv_today: "sensor.deye_termeles_napi",
    load: "sensor.deye_fogyasztas_teljesitmeny",
    load_today: "sensor.deye_fogyasztas_napi",
    battery_soc: "sensor.deye_akku_soc",
    battery_power: "sensor.deye_akku_teljesitmeny",      // + = merítés, − = töltés (Deye konvenció)
    battery_time: "sensor.deye_akku_hatralevo_ido",       // perc
    grid_power: "sensor.deye_halozat_teljesitmeny",
    grid_connected: "binary_sensor.fo_inverter_grid",
    inverter_temps: ["sensor.fo_inverter_temperature", "sensor.inverter_2_temperature"],
    inverter_faults: ["sensor.fo_inverter_device_fault", "sensor.inverter_2_device_fault"],
    sun: "sun.sun",
  },
  invert_battery: false,
  strings: [
    { name: "Ház", entity: "sensor.deye_string_1", peak: 4900, tilt: 45, azimuth: 180, top: 50.0, left: 37.0 },
    { name: "Ny",  entity: "sensor.deye_string_3", peak: 2000, tilt: 70, azimuth: 270, top: 25.5, left: 70.5 },
    { name: "DK",  entity: "sensor.deye_string_2", peak: 2000, tilt: 70, azimuth: 120, top: 39.0, left: 87.0 },
  ],
  positions: {                       // buborékok helye a képen (%: felülről, balról)
    pv: [30.0, 27.5], inverter: [21.5, 50.0], battery: [43.5, 60.5], load: [65.5, 27.5], grid: [37.0, 11.5],
  },
  tap: {                             // koppintás: '#hash' (Bubble Card pop-up), '/útvonal', vagy 'more-info'
    pv: "#napelemek", strings: "#napelemek", inverter: "#inverterek", battery: "#akkumulator", load: "#inverterek", grid: "#halozat",
  },
  flows: {                           // energiafolyam útvonalak a 1600×1100-as képen (a 3D jelenetből vetítve)
    pv: ["M512,570 L710,517 L730,579 L798,539 L871,505 L838,411 L836,413",
         "M1211,412 L1178,434 L1161,414 L1026,451 L1000,415 L871,403 L860,406",
         "M1277,386 L1249,417 L1179,436"],
    battery: ["M843,429 L847,454 L890,442 L893,431"],          // inverter → akku irány (töltés)
    grid: ["M95,510 L138,522 L179,530 L219,535 L258,537 L295,535 L308,534 L348,684 L728,579 L866,512 L831,418 L834,414"],
    load: ["M870,517 L806,546 L731,579 L637,651 L384,722"],
  },
  show_flows: true,
  threshold: 20,                     // W alatt nincs folyam-animáció
};

const COLORS = { pv: "#F5A623", battery: "#22C55E", grid: "#E5484D", load: "#3B82F6", inverter: "#A78BFA" };

// --------------------------------------------------------------------------
const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const fmtW = (w) => Math.abs(w) >= 1000 ? (w / 1000).toFixed(2).replace(".", ",") + " kW" : Math.round(w) + " W";
const fmtKWh = (k) => k.toFixed(1).replace(".", ",") + " kWh";
const fmtMin = (m) => { m = Math.round(m); return m >= 60 ? `${Math.floor(m / 60)} ó ${m % 60} p` : `${m} p`; };
const deg = Math.PI / 180;
function deepMerge(a, b) {
  if (Array.isArray(b)) return b.slice();
  if (b && typeof b === "object") { const o = { ...(a || {}) }; for (const k of Object.keys(b)) o[k] = deepMerge(a ? a[k] : undefined, b[k]); return o; }
  return b === undefined ? a : b;
}
// napsugár és panel FELÜLETE közti szög (90° = merőleges)
function sunAngle(el, az, tilt, pAz) {
  if (el <= 0) return 0;
  const c = Math.sin(el * deg) * Math.cos(tilt * deg) + Math.cos(el * deg) * Math.sin(tilt * deg) * Math.cos((az - pAz) * deg);
  return c > 0 ? Math.asin(Math.min(1, c)) / deg : 0;
}

class DeyeHazCard extends HTMLElement {
  static getStubConfig() { return {}; }
  setConfig(config) {
    this._config = deepMerge(DEFAULTS, config || {});
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._built = false;
    if (this._hass) this._render();
  }
  set hass(hass) { this._hass = hass; this._render(); }
  getCardSize() { return 8; }
  getGridOptions() { return { columns: "full", rows: "auto", min_columns: 6 }; }

  _st(id) { return id && this._hass ? this._hass.states[id] : undefined; }
  _v(id, d = 0) { const s = this._st(id); return s ? num(s.state, d) : d; }

  _build() {
    const c = this._config;
    const flows = (k) => (c.flows[k] || []).map((d) =>
      `<path class="glow" d="${d}"/><path class="dash" d="${d}"/>`).join("");
    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; }
        ha-card { overflow:hidden; background:transparent; box-shadow:none; border:none; }
        .wrap { position:relative; width:100%; aspect-ratio:${c.aspect_ratio}; container-type:inline-size; border-radius:var(--ha-card-border-radius,16px); overflow:hidden; }
        img.bg { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; transition:opacity .8s; }
        img.night { opacity:0; }
        .wrap.is-night img.night { opacity:1; }
        svg { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; }
        g.flow { display:none; } g.flow.on { display:inline; }
        .glow { fill:none; stroke-width:12; stroke-opacity:.22; stroke-linecap:round; stroke-linejoin:round; }
        .dash { fill:none; stroke-width:5; stroke-linecap:round; stroke-linejoin:round; stroke-dasharray:3 19; animation:run var(--dur,1s) linear infinite; }
        g.rev .dash { animation-direction:reverse; }
        @keyframes run { to { stroke-dashoffset:-22; } }
        .pill { position:absolute; transform:translate(-50%,-50%); display:flex; align-items:center; gap:.45em;
          padding:.35em .7em .35em .5em; border-radius:.9em; cursor:pointer; user-select:none; -webkit-tap-highlight-color:transparent;
          background:rgba(15,22,36,.78); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);
          border:1.5px solid rgba(255,255,255,.14); box-shadow:0 4px 14px rgba(0,0,0,.35);
          color:#F3F4F6; font: 500 clamp(9px, 1.45cqw, 15px)/1.15 var(--paper-font-body1_-_font-family, Roboto, sans-serif);
          white-space:nowrap; transition:transform .15s, border-color .3s; }
        .pill:hover { transform:translate(-50%,-50%) scale(1.06); }
        .pill:active { transform:translate(-50%,-50%) scale(.97); }
        .pill.small { font-size:clamp(8px, 1.2cqw, 12.5px); padding:.3em .6em .3em .45em; background:rgba(15,22,36,.7); }
        .pill ha-icon { --mdc-icon-size:1.45em; color:var(--c,#fff); flex:none; }
        .pill .t { display:flex; flex-direction:column; gap:.12em; }
        .pill b { font-weight:600; }
        .pill small { font-size:.82em; color:#CBD5E1; }
        .bar { height:.28em; border-radius:.2em; background:rgba(255,255,255,.15); overflow:hidden; margin-top:.1em; }
        .bar i { display:block; height:100%; background:var(--c,#22C55E); border-radius:.2em; transition:width .6s; }
        .pill.warn { border-color:#F97316; background:rgba(67,20,7,.85); color:#FDBA74; }
        .pill.alert { border-color:#EF4444; animation:pulse 1.4s ease-in-out infinite; }
        @keyframes pulse { 50% { box-shadow:0 0 0 .35em rgba(239,68,68,.35); } }
      </style>
      <ha-card>
        <div class="wrap">
          <img class="bg day" src="${c.image_day}" alt="">
          <img class="bg night" src="${c.image_night}" alt="">
          <svg viewBox="0 0 1600 1100" preserveAspectRatio="xMidYMid slice">
            <g class="flow" id="f-pv" stroke="${COLORS.pv}">${flows("pv")}</g>
            <g class="flow" id="f-grid" stroke="${COLORS.grid}">${flows("grid")}</g>
            <g class="flow" id="f-battery" stroke="${COLORS.battery}">${flows("battery")}</g>
            <g class="flow" id="f-load" stroke="${COLORS.load}">${flows("load")}</g>
          </svg>
          <div id="pills"></div>
        </div>
      </ha-card>`;
    this._built = true;
    this._pillEls = {};
  }

  _pill(key, { top, left, icon, color, main, sub, bar, small, cls, tap, entity }) {
    let el = this._pillEls[key];
    const host = this.shadowRoot.getElementById("pills");
    if (!el) {
      el = document.createElement("div");
      el.className = "pill";
      el.innerHTML = `<ha-icon></ha-icon><div class="t"><b></b><small></small><div class="bar"><i></i></div></div>`;
      this._bindActions(el, () => el._tap, () => el._entity);
      host.appendChild(el);
      this._pillEls[key] = el;
    }
    el._tap = tap; el._entity = entity;
    el.className = "pill" + (small ? " small" : "") + (cls ? " " + cls : "");
    el.style.top = top + "%"; el.style.left = left + "%";
    el.style.setProperty("--c", color);
    el.querySelector("ha-icon").setAttribute("icon", icon);
    el.querySelector("b").textContent = main;
    const s = el.querySelector("small"); s.textContent = sub || ""; s.style.display = sub ? "" : "none";
    const b = el.querySelector(".bar"); b.style.display = bar === undefined ? "none" : "";
    if (bar !== undefined) b.querySelector("i").style.width = Math.max(0, Math.min(100, bar)) + "%";
  }

  _bindActions(el, getTap, getEntity) {
    let timer = null, held = false;
    const start = () => { held = false; timer = setTimeout(() => { held = true; this._moreInfo(getEntity()); }, 500); };
    const cancel = () => { clearTimeout(timer); };
    el.addEventListener("pointerdown", start);
    el.addEventListener("pointerup", cancel); el.addEventListener("pointerleave", cancel);
    el.addEventListener("click", (e) => { e.stopPropagation(); if (held) return; this._tap(getTap(), getEntity()); });
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  _tap(target, entity) {
    if (!target || target === "more-info") return this._moreInfo(entity);
    if (target === "none") return;
    history.pushState(null, "", target.startsWith("#") ? location.pathname + location.search + target : target);
    window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
  }
  _moreInfo(entityId) {
    if (!entityId) return;
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
  }
  _flow(id, on, watts, reverse = false) {
    const g = this.shadowRoot.getElementById("f-" + id);
    if (!g) return;
    g.classList.toggle("on", !!on && this._config.show_flows);
    g.classList.toggle("rev", reverse);
    const dur = Math.max(0.35, Math.min(2.6, 2.6 - Math.abs(watts) / 2500));   // nagyobb teljesítmény → gyorsabb
    g.style.setProperty("--dur", dur.toFixed(2) + "s");
  }

  _render() {
    if (!this._config || !this._hass) return;
    if (!this._built) this._build();
    const c = this._config, E = c.entities, P = c.positions, T = c.tap, th = c.threshold;
    // nappal / éjjel
    const sun = this._st(E.sun);
    const night = c.night === "always" || (c.night === "auto" && sun && sun.state === "below_horizon");
    this.shadowRoot.querySelector(".wrap").classList.toggle("is-night", night);
    const el = sun ? num(sun.attributes.elevation, -90) : -90, az = sun ? num(sun.attributes.azimuth, 180) : 180;

    // napelem összesen
    const pv = this._v(E.pv), pvToday = this._v(E.pv_today);
    const peakSum = c.strings.reduce((a, s) => a + num(s.peak, 0), 0);
    this._pill("pv", { top: P.pv[0], left: P.pv[1], icon: "mdi:solar-power-variant", color: COLORS.pv,
      main: fmtW(pv), sub: "ma " + fmtKWh(pvToday), bar: peakSum ? pv / peakSum * 100 : undefined, tap: T.pv, entity: E.pv });
    // sztringek: W · kihasználtság · napszög
    c.strings.forEach((s, i) => {
      const w = this._v(s.entity), util = s.peak ? w / s.peak * 100 : 0;
      const ang = s.tilt !== undefined ? sunAngle(el, az, num(s.tilt), num(s.azimuth, 180)) : 0;
      const parts = [w > 0 ? Math.round(util) + " %" : "—"]; if (ang > 0) parts.push("∠" + Math.round(ang) + "°");
      this._pill("s" + i, { top: s.top, left: s.left, small: true, icon: s.icon || "mdi:solar-panel", color: COLORS.pv,
        main: `${s.name} ${fmtW(w)}`, sub: parts.join(" · "), bar: util, tap: s.tap || T.strings, entity: s.entity });
    });
    // inverterek
    const load = this._v(E.load), loadToday = this._v(E.load_today);
    const temps = (E.inverter_temps || []).map((id) => this._v(id, NaN)).filter(Number.isFinite);
    const tmax = temps.length ? Math.max(...temps) : NaN;
    const fault = (E.inverter_faults || []).some((id) => { const s = this._st(id); return s && !["OK", "ok", "unknown", "unavailable", "Normal"].includes(s.state); });
    this._pill("inv", { top: P.inverter[0], left: P.inverter[1], icon: fault ? "mdi:alert" : "mdi:sine-wave", color: fault ? "#EF4444" : COLORS.inverter,
      main: fmtW(load), sub: (fault ? "HIBA · " : "") + (Number.isFinite(tmax) ? Math.round(tmax) + " °C" : ""),
      cls: fault ? "alert" : "", tap: T.inverter, entity: (E.inverter_temps || [])[0] });
    // akku
    const soc = this._v(E.battery_soc), bpRaw = this._v(E.battery_power), bp = c.invert_battery ? -bpRaw : bpRaw, bmin = this._v(E.battery_time);
    const socCol = soc < 20 ? "#EF4444" : soc < 50 ? "#F59E0B" : COLORS.battery;
    const dir = bp > th ? " ▼ " + fmtW(bp) : bp < -th ? " ▲ " + fmtW(-bp) : "";
    this._pill("bat", { top: P.battery[0], left: P.battery[1], color: socCol,
      icon: bp < -th ? "mdi:battery-charging" : soc < 20 ? "mdi:battery-alert-variant-outline" : "mdi:battery-high",
      main: Math.round(soc) + " %" + dir, sub: bmin > 0 ? (bp < -th ? "tele: " + fmtMin(bmin) : fmtMin(bmin) + " hátra") : "nyugalmi",
      bar: soc, cls: soc < 10 ? "alert" : "", tap: T.battery, entity: E.battery_soc });
    // ház fogyasztás
    this._pill("load", { top: P.load[0], left: P.load[1], icon: "mdi:home-lightning-bolt", color: COLORS.load,
      main: fmtW(load), sub: "ma " + fmtKWh(loadToday), tap: T.load, entity: E.load });
    // hálózat
    const gc = this._st(E.grid_connected), gp = this._v(E.grid_power);
    const off = gc && ["off", "Ki", "false", "disconnected"].includes(gc.state);
    this._pill("grid", { top: P.grid[0], left: P.grid[1], icon: off ? "mdi:transmission-tower-off" : "mdi:transmission-tower",
      color: off ? "#FB923C" : COLORS.grid, main: off ? "Lekapcsolva" : fmtW(gp), sub: off ? "" : "hálózat",
      small: off, cls: off ? "warn" : "", tap: T.grid, entity: E.grid_power });
    // folyamok
    this._flow("pv", pv > th, pv);
    this._flow("grid", !off && gp > th, gp);
    this._flow("battery", Math.abs(bp) > th, bp, bp > th);      // merítéskor visszafelé (akku → inverter)
    this._flow("load", load > th, load);
  }
}

customElements.define("deye-haz-card", DeyeHazCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: "deye-haz-card", name: "Deye Ház Card", description: "3D off-grid napelemes ház élő energiafolyammal (Deye + Solarman)", preview: false });
console.info(`%c DEYE-HAZ-CARD %c v${VERSION} `, "color:#fff;background:#F5A623;font-weight:700", "color:#F5A623;background:#1F2937");

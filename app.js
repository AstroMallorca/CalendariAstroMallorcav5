// app.js

// === URLs (les teves) ===
const BASE_SHEETS = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSWf6OL8LYzMsBPuxvI_h4s9-0__hru3hWK9D2ewyccoku9ndl2VhZ0GS8P9uEigShJEehsy2UktnY2/pub";


const SHEET_FOTOS_MES = "data/FOTOS_MES.csv";
// const SHEET_EFEMERIDES = `${BASE_SHEETS}?output=csv&gid=1305356303`;
// ✅ Efemèrides especials (icones) en LOCAL (CSV)
const LOCAL_EFEMERIDES_CSV = "data/efemerides_2026_data_unica_importancia.csv";

// ✅ FESTIUS (A=data DD-MM-YYYY, B=nom)
const SHEET_FESTIUS = "data/FESTIUS_BALEARS.csv";

// ICS públic
const CALENDAR_ICS =
  "https://calendar.google.com/calendar/ical/astromca%40gmail.com/public/basic.ics";


// === Fetch robust (evita errors CORS/500 puntuals) ===
async function fetchTextWithFallback(urls){
  let lastErr = null;
  for (const u of urls){
    try{
      const r = await fetch(u, { cache: "no-store" });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const t = await r.text();
      return { text: t, url: u };
    }catch(e){
      lastErr = e;
      console.warn("[fetch] falla:", u, e);
    }
  }
  throw lastErr || new Error("fetch failed");
}

function csvFallbacks(url){
  const enc = encodeURIComponent(url);
  return [
    url,
    `https://api.allorigins.win/raw?url=${enc}`,
    `https://corsproxy.io/?${enc}`,
    `https://r.jina.ai/http://${url.replace(/^https?:\/\//,"")}`
  ];
}

function icsFallbacks(url){
  const enc = encodeURIComponent(url);
  return [
    // prefer proxys que respectin salts de línia
    `https://corsproxy.io/?${enc}`,
    `https://api.allorigins.win/raw?url=${enc}`,
    url,
    // últim recurs (pot aplanar; si passa, ho reparam més avall)
    `https://r.jina.ai/http://${url.replace(/^https?:\/\//,"")}`
  ];
}

function normalizeICS(text){
  // Si ve aplanat (BEGIN:VCALENDAR ... END:VCALENDAR en una sola línia), inserim salts abans de claus.
  if (!/\r?\n/.test(text) && text.includes("BEGIN:VEVENT")){
    return text
      .replace(/(BEGIN:|END:|DTSTART|DTEND|SUMMARY|DESCRIPTION|LOCATION|UID|RRULE|EXDATE|RDATE|SEQUENCE|STATUS|TRANSP|CATEGORIES|CLASS|CREATED|LAST-MODIFIED|DTSTAMP)/g, "\n$1")
      .trim();
  }
  return text;
}

// Mesos en català
const MESOS_CA = [
  "Gener","Febrer","Març","Abril","Maig","Juny",
  "Juliol","Agost","Setembre","Octubre","Novembre","Desembre"
];
// === Localització (per a futurs càlculs: sortida/posta, etc.) ===
// No forçam permís: si l'usuari el denega, fem servir Mallorca per defecte.
const DEFAULT_OBSERVER = { latitude: 39.5696, longitude: 2.6502, elevation: 0 }; // Palma aprox.
let APP_OBSERVER = { ...DEFAULT_OBSERVER };

function initObserverFromDevice(){
  if (!("geolocation" in navigator)) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      APP_OBSERVER = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        elevation: pos.coords.altitude ?? 0
      };
      // Si ja hi ha calendari pintat, el repintam per adaptar càlculs al lloc.
     try { dibuixaMes(mesActual); } catch(e) {}
    },
    () => { /* silenci: mantenim DEFAULT_OBSERVER */ },
    { enableHighAccuracy: true, maximumAge: 6 * 60 * 60 * 1000, timeout: 8000 }
  );
}

// === Fases lunars (quarters) ===
// Mostram icones només als 4 quarts: nova, quart creixent, plena, quart minvant.
const MOON_ICON_BY_QUARTER = {
  0: "assets/moon/nova.png",
  1: "assets/moon/quart_creixent.png",
  2: "assets/moon/plena.png",
  3: "assets/moon/quart_minvant.png",
};

// Cache per no recalcular cada repintat
const _moonQuarterCache = new Map(); // key: "YYYY-MM" -> Map(day -> [quarters])

function getMoonQuartersForMonth(year, monthIndex0){
  const key = `${year}-${String(monthIndex0+1).padStart(2,"0")}`;
  if (_moonQuarterCache.has(key)) return _moonQuarterCache.get(key);

  const map = new Map(); // day -> [quarter, quarter...]
  _moonQuarterCache.set(key, map);

  // Si la llibreria no està carregada, deixam map buit.
  if (typeof Astronomy === "undefined" || !Astronomy.SearchMoonQuarter) return map;

  const start = new Date(year, monthIndex0, 1, 0, 0, 0);
  const end   = new Date(year, monthIndex0 + 1, 1, 0, 0, 0);

  // Primera fase després de "start - 7 dies" per no perdre un esdeveniment que cau el dia 1.
  let mq = Astronomy.SearchMoonQuarter(new Date(start.getTime() - 7*24*3600*1000));

  // Recorrem fins sortir del mes (amb marge).
  for (let guard = 0; guard < 12; guard++){
    const dt = mq.time?.date ? new Date(mq.time.date.getTime()) : null; // es mostra en TZ local del dispositiu
    if (dt){
      const y = dt.getFullYear();
      const m = dt.getMonth();
      const day = dt.getDate();
      if (y === year && m === monthIndex0){
        const arr = map.get(day) || [];
        arr.push(mq.quarter);
        map.set(day, arr);
      }
      if (dt.getTime() > end.getTime() + 2*24*3600*1000) break;
    }
    mq = Astronomy.NextMoonQuarter(mq);
  }

  return map;
}

// === AVUI (per pintar groc i decidir el mes inicial) ===
const AVUI = new Date();
const AVUI_ISO = `${AVUI.getFullYear()}-${String(AVUI.getMonth()+1).padStart(2,"0")}-${String(AVUI.getDate()).padStart(2,"0")}`;

function getMesInicial2026() {
  // Si avui és 2026 -> mes actual. Si no -> Gener 2026.
  if (AVUI.getFullYear() === 2026) {
    return `2026-${String(AVUI.getMonth() + 1).padStart(2, "0")}`;
  }
  return "2026-01";
}

// === CONTROL DE MES (SWIPE) ===
let mesActual = getMesInicial2026();
// === Deep-link: si venim d'una pàgina (Lluna/Sol/Planetes) amb ?date=YYYY-MM-DD,
// volem obrir directament el modal d'EFEMÈRIDES d'aquell dia.
let DEEPLINK_ISO = null;
try{
  const p = new URLSearchParams(location.search);
  const q = (p.get("date") || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(q)) {
    DEEPLINK_ISO = q;
    // Ens asseguram que el calendari pinta el mes correcte
    mesActual = DEEPLINK_ISO.slice(0, 7); // "YYYY-MM"
  }
}catch(e){}

function monthToParts(isoYM){
  const [y, m] = isoYM.split("-").map(Number);
  return { y, m };
}
function partsToMonth(y, m){
  return `${y}-${String(m).padStart(2,"0")}`;
}
function nextMonth(isoYM){
  let { y, m } = monthToParts(isoYM);
  m += 1;
  if (m === 13){ m = 1; y += 1; }
  return partsToMonth(y, m);
}
function prevMonth(isoYM){
  let { y, m } = monthToParts(isoYM);
  m -= 1;
  if (m === 0){ m = 12; y -= 1; }
  return partsToMonth(y, m);
}
function clamp2026(isoYM){
  const { y } = monthToParts(isoYM);
  if (y < 2026) return "2026-01";
  if (y > 2026) return "2026-12";
  return isoYM;
}
function renderMes(isoYM){
  mesActual = isoYM;
  setFotoMes(mesActual);
  actualitzaTitolMes(mesActual);
  dibuixaMes(mesActual);
}
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

// === ESTAT DADES ===
let efemerides = {};           // local data/efemerides2026.json (per dia ISO)
let efemeridesEspecials = {};  // del sheet per dia ISO -> array
let activitats = {};           // del calendari ICS per dia ISO -> array
// === EFEMÈRIDES HISTÒRIQUES (locals per mes) ===
// Fitxers esperats a /data/: efemerides_historic_YYYY_MM.json
// Es carreguen "lazy" quan obres un dia i es queden en memòria (cache).
const historicByMonthCache = {}; // { "2026-01": <json|null> }

async function loadHistoricMonth(y, m1){
  // ✅ Nou: efemèrides històriques d'un únic fitxer (CSV o JSON) per tot l'any
  // Posa el fitxer a /data/ amb un d'aquests noms:
  //   - data/efemerides_historique_2026_ca_top5.csv
  //   - data/efemerides_historique_2026_ca_top5.json
  // (Si existeixen tots dos, prioritzam el JSON)
  const key = "ALL";
  if (key in historicByMonthCache) return historicByMonthCache[key];

  const JSON_URL = "data/efemerides_historique_2026_ca_top5.json";
  const CSV_URL  = "data/efemerides_historique_2026_ca_top5.csv";

  // helper: passa DD/MM/YYYY o DD-MM-YYYY o ISO a ISO YYYY-MM-DD
  const anyToISO = (s) => {
    const t = (s ?? "").toString().trim();
    if (!t) return null;
    // ISO directe
    const mIso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (mIso) return `${mIso[1]}-${mIso[2]}-${mIso[3]}`;
    // DD/MM/YYYY o DD-MM-YYYY
    const mDMY = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (mDMY){
      const dd = String(mDMY[1]).padStart(2,"0");
      const mm = String(mDMY[2]).padStart(2,"0");
      const yy = mDMY[3];
      return `${yy}-${mm}-${dd}`;
    }
    return null;
  };

  try{
    // 1) Prova JSON
    const r = await fetch(JSON_URL, { cache: "no-store" });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    const data = await r.json();
    historicByMonthCache[key] = data;
    return data;
  }catch(errJson){
    // 2) Fallback CSV
    try{
      const rows = await loadCSV(CSV_URL); // reutilitza el parser actual
      const out = {};
      for (const r of rows){
        const iso = anyToISO(r.data || r.date || r.dia || r.iso);
        if (!iso) continue;

        const item = {
          prioritat: Number(r.prioritat ?? r.prioridad ?? r.priority ?? "") || undefined,
          any: Number(r.any ?? r.anno ?? r.year ?? "") || undefined,
          text: (r.text ?? r.texto ?? r.descripcio ?? r.descripció ?? r.description ?? r.titol ?? r.title ?? "").toString().trim()
        };

        // si no hi ha text, no afegim res
        if (!item.text) continue;

        if (!out[iso]) out[iso] = [];
        out[iso].push(item);
      }
      historicByMonthCache[key] = out;
      return out;
    }catch(errCsv){
      console.warn("No he pogut carregar efemèrides històriques (CSV/JSON):", errJson, errCsv);
      historicByMonthCache[key] = null;
      return null;
    }
  }
}


// Intenta trobar les efemèrides del dia sigui quin sigui el format del JSON
function pickHistoricForISO(monthData, iso){
  if (!monthData) return [];

  // Format A: objecte amb claus ISO => array / string / objectes
  if (typeof monthData === "object" && !Array.isArray(monthData)){
    if (monthData[iso] != null) return monthData[iso];
    if (monthData.dies && monthData.dies[iso] != null) return monthData.dies[iso];
    if (monthData.data && monthData.data[iso] != null) return monthData.data[iso];
  }

  // Format B: array d'items amb camp data/iso/dia
  if (Array.isArray(monthData)){
    const found = monthData.filter(it => {
      if (!it) return false;
      if (typeof it === "string") return false;
      const d = it.iso || it.data || it.dia || it.date;
      return d === iso;
    });
    if (found.length) return found;
  }

  return [];
}

function renderHistoricItems(raw){
  if (!raw) return [];

  // Si és "wrapper" {date, items:[...]} -> torna items
  if (typeof raw === "object" && !Array.isArray(raw) && Array.isArray(raw.items)){
    return raw.items;
  }

  // Si és array i conté wrappers -> aplanam tots els items
  if (Array.isArray(raw)){
    const flattened = [];
    for (const it of raw){
      if (it && typeof it === "object" && Array.isArray(it.items)) flattened.push(...it.items);
      else flattened.push(it);
    }
    return flattened;
  }

  // Si és string -> el tractam com un item de text
  if (typeof raw === "string") return [{ text: raw }];

  // Qualsevol altre objecte -> el tornam com a item
  return [raw];
}

let fotosMes = {};             // "MM-YYYY" -> info foto
let festius = new Map();       // "YYYY-MM-DD" -> "Nom del festiu"

// === Utils dates ===
function ddmmyyyyToISO(s) {
  if (s == null) return null;

  // Neteja espais, tabs i caràcters raros (NBSP)
  const clean = String(s).replace(/\u00A0/g, " ").trim();

  // Accepta DD-MM-YYYY o DD/MM/YYYY
  const m = clean.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (!m) return null;

  const dd = m[1].padStart(2, "0");
  const mm = m[2].padStart(2, "0");
  const yyyy = m[3];

  return `${yyyy}-${mm}-${dd}`;
}
function isoToDDMMYYYY(iso){
  const [y,m,d] = iso.split("-");
  return `${d}-${m}-${y}`;
}
function weekdayCA2(iso){
  // iso = "YYYY-MM-DD"
  const [y,m,d] = iso.split("-").map(Number);
  const dow = new Date(y, m-1, d).getDay(); // 0=dg..6=ds

  const names = ["Dg","Dl","Dt","Dc","Dj","Dv","Ds"];
  return names[dow];
}

function pad2(n){ return String(n).padStart(2,"0"); }

function formatHM(dateObj){
  if (!dateObj) return "—";
  return `${pad2(dateObj.getHours())}:${pad2(dateObj.getMinutes())}`;
}

// Calcula sortida/posta amb Astronomy Engine (si està carregada)
function getRiseSet(bodyName, iso, observer){
  try{
    if (typeof Astronomy === "undefined" || !Astronomy.SearchRiseSet) {
      return { rise: null, set: null };
    }

    // 1) Body correcte
    const body =
      bodyName === "Sun"  ? Astronomy.Body.Sun :
      bodyName === "Moon" ? Astronomy.Body.Moon :
      bodyName;

    // 2) Data d'inici del dia
    const [Y,M,D] = iso.split("-").map(Number);
    const start = new Date(Y, M-1, D, 0, 0, 0);

    // 3) Observer d'Astronomy Engine
    const lat = Number(observer?.latitude ?? DEFAULT_OBSERVER.latitude);
    const lon = Number(observer?.longitude ?? DEFAULT_OBSERVER.longitude);
    const h   = Number(observer?.elevation ?? observer?.height ?? 0);
    const obs = new Astronomy.Observer(lat, lon, Number.isFinite(h) ? h : 0);

    // 4) Rise / Set
    const t0 = Astronomy.MakeTime(start);

    const riseRes = Astronomy.SearchRiseSet(body, obs, +1, t0, 1, 0);
    const setRes  = Astronomy.SearchRiseSet(body, obs, -1, t0, 1, 0);

    // ✅ Accepta AstroTime o AstroEvent
    const riseTime = (riseRes && riseRes.date) ? riseRes : (riseRes && riseRes.time ? riseRes.time : null);
    const setTime  = (setRes  && setRes.date)  ? setRes  : (setRes  && setRes.time  ? setRes.time  : null);

    const rise = (riseTime && riseTime.date) ? new Date(riseTime.date.getTime()) : null;
    const set  = (setTime  && setTime.date)  ? new Date(setTime.date.getTime())  : null;

    return { rise, set };
  }catch(e){
    console.warn("Rise/Set error", bodyName, iso, e);
    return { rise: null, set: null };
  }
}

// === Compte enrere eclipsi (Europe/Madrid, DST inclòs) ===
const ECLIPSI_TZ = "Europe/Madrid";
const ECLIPSI_LOCAL = { year: 2026, month: 8, day: 12, hour: 20, minute: 31 };

function getTimeZoneOffsetMinutes(date, timeZone) {
  // Retorna offset (minuts) de timeZone respecte UTC en aquell instant
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false
  });

  const parts = dtf.formatToParts(date);
  const map = {};
  for (const p of parts) map[p.type] = p.value;

  // data/hora "com si" fos UTC
  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );

  // offset = (hora en tz expressada com UTC) - UTC real
  return (asUTC - date.getTime()) / 60000;
}

function zonedDateTimeToUtcMs({year, month, day, hour, minute}, timeZone) {
  // Estimació inicial
  const base = Date.UTC(year, month - 1, day, hour, minute, 0);

  // Ajust 1
  let off = getTimeZoneOffsetMinutes(new Date(base), timeZone);
  let utc = base - off * 60000;

  // Ajust 2 (per seguretat a canvis DST) -> recalcula DES DE base, no tornis a restar sobre utc
  off = getTimeZoneOffsetMinutes(new Date(utc), timeZone);
  utc = base - off * 60000;

  return utc;
}

const ECLIPSI_UTC_MS = zonedDateTimeToUtcMs(ECLIPSI_LOCAL, ECLIPSI_TZ);

function formatCountdownDDHHMM(ms) {
  if (ms <= 0) return "00d:00h:00min";

  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes - days * 60 * 24) / 60);
  const minutes = totalMinutes - days * 60 * 24 - hours * 60;

  const D = String(days).padStart(2, "0");
  const H = String(hours).padStart(2, "0");
  const M = String(minutes).padStart(2, "0");
  return `${D}d:${H}h:${M}min`;
}

let countdownTimer = null;

function iniciaCompteEnrereEclipsi() {
  const el = document.getElementById("eclipsiCountdown");
  if (!el) return;

  const tick = () => {
    const now = Date.now(); // hora del sistema
    const diff = ECLIPSI_UTC_MS - now;
    el.textContent = formatCountdownDDHHMM(diff);
  };

  tick();
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(tick, 30000); // cada 30s és suficient (mostram minuts)
}

// ✅ Helper: "2026-08" -> "08-2026"
function isoToMonthKey(isoYM) {
  if (!isoYM || isoYM.length < 7) return "";
  return `${isoYM.slice(5,7)}-${isoYM.slice(0,4)}`;
}

// ✅ Actualitza títol del mes
function actualitzaTitolMes(isoYM){
  const [y, m] = isoYM.split("-").map(Number);
  const nom = `${MESOS_CA[m-1]} ${y}`;
  const el = document.getElementById("titolMes");
  if (el) el.textContent = nom.toUpperCase();
}

// === CSV parser (quotes + commas) ===
function detectDelimiter(text){
  const firstLine = (text.split(/\r?\n/).find(l => l.trim()) || "");
  const commas = (firstLine.match(/,/g) || []).length;
  const semis  = (firstLine.match(/;/g) || []).length;
  return semis > commas ? ";" : ",";
}

// === CSV parser (quotes + delimiter auto ,/;) ===
function parseCSV(text) {
  const delimiter = detectDelimiter(text);

  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (c === '"' && inQuotes && next === '"') {
      cur += '"'; i++; continue;
    }
    if (c === '"') { inQuotes = !inQuotes; continue; }

    if (c === delimiter && !inQuotes) { row.push(cur); cur = ""; continue; }

    if ((c === "\n" || c === "\r") && !inQuotes) {
      if (cur.length || row.length) { row.push(cur); rows.push(row); }
      row = []; cur = "";
      if (c === "\r" && next === "\n") i++;
      continue;
    }
    cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}


// ✅ Millora: capçaleres normalitzades (evita espais/majúscules)
function normalizeHeader(h) {
  return (h || "")
    .trim()
    .toLowerCase()
    // treu accents (títol -> titol)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    // espais i guions -> _
    .replace(/[\s-]+/g, "_")
    // deixa només a-z0-9_
    .replace(/[^a-z0-9_]/g, "");
}

function rowsToObjects(rows) {
  if (!rows.length) return [];
  const header = rows[0].map(normalizeHeader);

  return rows.slice(1)
    .filter(r => r.some(x => (x || "").trim() !== ""))
    .map(r => {
      const obj = {};
      header.forEach((h, idx) => {
        obj[h] = (r[idx] ?? "").trim();
      });
      return obj;
    });
}

// === ICS parser mínim (VEVENT) ===
function parseICS(icsText) {
  const rawLines = icsText.split(/\r?\n/);
  const lines = [];
  for (const l of rawLines) {
    if (l.startsWith(" ") && lines.length) lines[lines.length - 1] += l.slice(1);
    else lines.push(l);
  }

  const events = [];
  let cur = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;

    const idx = line.indexOf(":");
    if (idx === -1) continue;

    const left = line.slice(0, idx);
    const value = line.slice(idx + 1);
    const key = left.split(";")[0];
    cur[key] = value;
  }

  return events.map(e => ({
    titol: e.SUMMARY || "Activitat",
    lloc: e.LOCATION || "",
    descripcio: e.DESCRIPTION || "",
    url: e.URL || "",
    dtstart: e.DTSTART || "",
    dtend: e.DTEND || ""
  }));
}
// --- ICS datetime helpers (UTC "Z" -> hora local del dispositiu) ---
function icsToDateLocal(dt){
  // Retorna un Date en temps local del dispositiu, interpretant correctament "Z" (UTC)
  // Suporta:
  //  - YYYYMMDD                (all-day)
  //  - YYYYMMDDTHHMMSSZ / ...Z  (UTC)
  //  - YYYYMMDDTHHMMSS          ("floating", el tractam com a hora local)
  if (!dt) return null;
  const s = String(dt).trim();
  if (!s) return null;

  // All-day: YYYYMMDD
  if (/^\d{8}$/.test(s)){
    const Y = Number(s.slice(0,4));
    const M = Number(s.slice(4,6));
    const D = Number(s.slice(6,8));
    return new Date(Y, M-1, D, 0, 0, 0);
  }

  // Datetime
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return null;

  const Y = Number(m[1]);
  const Mo = Number(m[2]);
  const D = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const se = Number(m[6] || "0");
  const isUTC = !!m[7];

  if (isUTC){
    // Important: Date() amb UTC i després el Date ja es mostra en local quan fas getHours()
    return new Date(Date.UTC(Y, Mo-1, D, h, mi, se));
  } else {
    // "floating" -> consideram que ja és hora local
    return new Date(Y, Mo-1, D, h, mi, se);
  }
}

function icsDateToISODate(dt){
  const d = icsToDateLocal(dt);
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

function icsDateToHM(dt){
  const d = icsToDateLocal(dt);
  if (!d) return "";
  // all-day: retornam buit (com feies abans)
  if (/^\d{8}$/.test(String(dt).trim())) return "";
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

function icsTimeRange(dtstart, dtend){
  const a = icsDateToHM(dtstart);
  const b = icsDateToHM(dtend);
  if (a && b) return `${a}–${b}`;
  return a || "";
}
// Converteix text (LOCATION/DESCRIPTION) en HTML segur i amb enllaços clicables
function escapeHTML(s){
  return (s ?? "").toString()
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#39;");
}
function linkifyText(s){
  // DESCRIPTION de Google Calendar sol dur \\n
  const txt = escapeHTML(s).replace(/\\n/g, "\n");
  const withBreaks = txt.replace(/\r?\n/g, "<br>");
  // enllaços http/https
  return withBreaks.replace(/(https?:\/\/[^\s<]+)/g, (m) => {
    return `<a href="${m}" target="_blank" rel="noopener">${m}</a>`;
  });
}

// === Carregues ===
async function loadJSON(path) {
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new Error(`No puc carregar ${path} (${r.status})`);
  return r.json();
}
async function loadCSV(url) {
  const { text } = await fetchTextWithFallback(csvFallbacks(url));
  return rowsToObjects(parseCSV(text));
}
async function loadCSVLocal(path) {
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new Error(`No puc carregar ${path} (${r.status})`);
  const text = await r.text();
  return rowsToObjects(parseCSV(text));
}
async function loadICS(url) {
  // IMPORTANT: Google Calendar ICS no envia capçalera CORS.
  // Per això usam proxys amb fallback (i deixam l'URL directa com a últim intent).
  const { text } = await fetchTextWithFallback(icsFallbacks(url));
  let t = text;

  // Amb r.jina.ai a vegades ve text extra; retallam al calendari real
  const idx = t.indexOf("BEGIN:VCALENDAR");
  if (idx !== -1) t = t.slice(idx);

  return t;
}


// === Transformacions ===
function buildEfemeridesEspecials(objs) {
  const out = {};

  for (const o of objs) {
    const iso = ddmmyyyyToISO(o.data);
    if (!iso) continue;

    // normalitza ruta icona (pot quedar buit)
    const codi = (() => {
      const raw = (o.codi || "").trim();
      if (!raw) return ""; // ✅ permetem buit
      if (/^(https?:)?\/\//i.test(raw)) return raw;  // URL
      if (raw.includes("/")) return raw;             // ja és una ruta
      return `assets/icons/${raw}`;                  // només nom de fitxer
    })();

    out[iso] ??= [];
    out[iso].push({
      codi,                                // ✅ pot ser ""
      tipus: (o.tipus || o.tipo || "").trim(),
      clau: (o.clau || "").trim(),
      titol: (o.titol || "").trim(),
      hora: (o.hora || o.Hora || "").trim(),
      importancia: Number(o.importancia || 3)
    });
  }

  return out;
}


function buildEfemeridesEspecialsFromJSON(j) {
  // Converteix un JSON local (formats diversos) a:
  // { "YYYY-MM-DD": [ {codi, titol, clau, hora, importancia} ] }
  const out = {};

  const add = (iso, e) => {
    if (!iso) return;

    // accepta diferents noms de camp per la icona
    const codi =
      (e?.codi ?? e?.icone ?? e?.icona ?? e?.icon ?? e?.img ?? e?.imatge ?? "")
        .toString()
        .trim();

    // ✅ Només volem mostrar efemèrides amb enllaç d'icona
    if (!codi) return;

    out[iso] ??= [];
    out[iso].push({
      codi,
      clau: (e?.clau ?? e?.key ?? "").toString(),
      titol: (e?.titol ?? e?.títol ?? e?.title ?? "").toString(),
      hora: (e?.hora ?? e?.time ?? "").toString(),
      importancia: Number(e?.importancia ?? e?.importance ?? 3)
    });
  };

  // 1) Si és un array pla d'objectes
  if (Array.isArray(j)) {
    for (const e of j) {
      let iso =
        (e?.iso ?? e?.data_iso ?? e?.date ?? e?.dataISO ?? "").toString().trim();

      if (!iso) iso = ddmmyyyyToISO(e?.data); // DD-MM-YYYY o DD/MM/YYYY
      add(iso, e);
    }
    return out;
  }

  // 2) Si ve com { dies: { "YYYY-MM-DD": [...] } } o similar
  if (j && typeof j === "object") {
    const dies = j.dies || j.days || j.per_dia || null;

    if (dies && typeof dies === "object") {
      for (const [iso, val] of Object.entries(dies)) {
        if (Array.isArray(val)) {
          for (const e of val) add(iso, e);
        } else if (val && typeof val === "object") {
          // pot venir com { efemerides: [...] }
          const arr = val.efemerides || val.events || val.items || null;
          if (Array.isArray(arr)) for (const e of arr) add(iso, e);
          else add(iso, val);
        }
      }
      return out;
    }

    // 3) Si ve com { efemerides: [...] }
    const arr = j.efemerides || j.events || j.items || null;
    if (Array.isArray(arr)) {
      for (const e of arr) {
        let iso = (e?.iso ?? e?.data_iso ?? e?.date ?? "").toString().trim();
        if (!iso) iso = ddmmyyyyToISO(e?.data);
        add(iso, e);
      }
      return out;
    }
  }

  return out;
}

function buildFotosMes(objs) {
  const out = {};
  for (const o of objs) {
    const key = (o.any_mes || "").trim(); // MM-YYYY
    if (!key) continue;
    out[key] = o;
  }
  return out;
}
function buildActivitatsFromICS(events) {
  const out = {};
  for (const ev of events) {
    const iso = icsDateToISODate(ev.dtstart);
    if (!iso) continue;

    out[iso] ??= [];

    const hora = icsTimeRange(ev.dtstart, ev.dtend);
    const comentaris = (ev.descripcio || "").trim();

    out[iso].push({
      titol: ev.titol,
      lloc: ev.lloc,
      hora,                 // ✅ nou
      comentaris,           // ✅ nou
      descripcio: ev.descripcio, // ho deixam per compatibilitat (no ho llevis)
      url: ev.url
    });
  }
  return out;
}

// === UI ===
const graella = document.getElementById("graellaDies");
const modal = document.getElementById("modalDia");
const contingutDia = document.getElementById("contingutDia");
const botoNocturn = document.getElementById("toggleNocturn");
// === Android BACK: si el modal està obert, "enrere" ha de tancar el modal i no tancar la PWA ===
function buildUrlWithDate(iso){
  const u = new URL(location.href);
  if (iso) u.searchParams.set("date", iso);
  else u.searchParams.delete("date");
  return u.toString();
}

// Crea (o actualitza) un estat d'historial mentre el modal és obert
function ensureModalHistory(iso){
  try{
    const st = history.state || null;

    // Si ja som dins "mode modal", actualitzam en lloc d'apilar
    if (st && st.__amModal === true){
      history.replaceState({ __amModal: true, date: iso }, "", buildUrlWithDate(iso));
      return;
    }

    // Si no, cream una entrada nova perquè el botó "enrere" tanqui el modal
    history.pushState({ __amModal: true, date: iso }, "", buildUrlWithDate(iso));
  }catch(e){}
}

function closeModalOnly(){
  modal.classList.add("ocult");
}

// Si l'usuari prem "enrere" i el modal és obert -> tancam el modal
try{
  window.addEventListener("popstate", () => {
    if (modal && !modal.classList.contains("ocult")){
      closeModalOnly();
    }
  });
}catch(e){}

// ✅ Aplica el mode nocturn guardat en carregar la pàgina principal
try{
  const saved = localStorage.getItem("nocturn") === "1";
  document.body.classList.toggle("nocturn", saved);
}catch(e){}
try{
  window.addEventListener("storage", (e) => {
    if (e.key === "nocturn"){
      const saved = localStorage.getItem("nocturn") === "1";
      document.body.classList.toggle("nocturn", saved);
    }
  });
}catch(e){}


function setFotoMes(isoYM) {
  // El teu Sheet usa "YYYY-MM" (ex: 2026-08)
  // però mantenim compatibilitat amb "MM-YYYY" (ex: 08-2026)
  const keyYM = isoYM;               // "2026-08"
  const keyMY = isoToMonthKey(isoYM); // "08-2026"
  const f = fotosMes[keyYM] || fotosMes[keyMY];

  const img = document.getElementById("imgFotoMes");
  const titolEl = document.getElementById("titolFoto");

  // Imatge (fallback si el sheet no té imatge)
  const fallbackPath = `assets/months/2026/${isoYM}.png`;
  const src = (f && f.imatge) ? f.imatge : fallbackPath;
  img.src = src;

  // Text: "Títol — Autor"
  if (titolEl) {
    const t = (f && f.titol) ? f.titol : "";
    const a = (f && f.autor) ? f.autor : "";
    titolEl.textContent = (t && a) ? `${t} — ${a}` : (t || a || "");
  }

  // Si vols que en clicar la foto s'obri el detall (ja ho tens)
  img.onclick = null; // ✅ ja no obrim modal des de la portada

const link = document.getElementById("linkFotoMes");
if (link) {
  link.href = `foto.html?ym=${encodeURIComponent(isoYM)}`;
}

  img.onerror = () => {
    img.onerror = null;
    img.src = "assets/months/2026/default.png"; // opcional
  };
}
function obreModalDetallFoto(f) {
  const clean = (v) => (v ?? "").toString().trim();

  const titol = clean(f.titol);
  const autor = clean(f.autor);
  const lloc  = clean(f.lloc);
  const credits = clean(f.credits ?? f.credit);

  const tech = [];
  if (clean(f.camera))   tech.push(`📷 ${clean(f.camera)}`);
  if (clean(f.objectiu)) tech.push(`🔭 ${clean(f.objectiu)}`);
  if (clean(f.exposicio))tech.push(`⏱ ${clean(f.exposicio)}`);
  if (clean(f.iso))      tech.push(`ISO ${clean(f.iso)}`);
  if (clean(f.f))        tech.push(`f/${clean(f.f)}`);

  const descCurta  = clean(f.descripcio ?? f.descripcio_curta ?? f.descripcion_curta);
  const descLlarga = clean(f.descripcio_llarga ?? f.descripcion_llarga);

  // ✅ Si no hi ha res (tècnica/lloc/crèdits), NO mostram el primer recuadre
  const hasInfoCard = tech.length || lloc || credits;

  // ✅ Card 1 (info)
  const infoCardHtml = hasInfoCard ? `
    <div class="foto-card">
      ${tech.length ? `<div>${tech.join(" · ")}</div>` : ""}
      ${lloc ? `<div style="margin-top:10px"><b>Lloc:</b> ${lloc}</div>` : ""}
      ${credits ? `<div style="margin-top:6px"><b>Crèdits:</b> ${credits}</div>` : ""}
    </div>
  ` : "";

  // ✅ Card 2 (descripcions)
  const descCardHtml = (descCurta || descLlarga) ? `
    <div class="foto-card">
      ${descCurta ? `<div style="margin-bottom:12px">${descCurta}</div>` : ""}
      ${descLlarga ? `<div style="opacity:.95">${descLlarga}</div>` : ""}
    </div>
  ` : "";

  contingutDia.innerHTML = `
    <div class="foto-wrap">
      <a href="#" class="foto-back" id="fotoBack">← Tornar</a>

      <div class="foto-title">Fotografia del mes</div>
      ${titol ? `<div class="foto-subtitle">${titol}</div>` : ""}

      ${f.imatge ? `
        <img class="foto-img" src="${f.imatge}" alt="${titol.replace(/"/g, "&quot;")}">
      ` : ""}

      ${autor ? `<div class="foto-author">${autor}</div>` : ""}

      ${infoCardHtml}
      ${descCardHtml}
    </div>
  `;

  // ✅ Tornar com a Sistema solar (history.back)
  const back = document.getElementById("fotoBack");
  if (back){
    back.addEventListener("click", (e) => {
      e.preventDefault();
      // com que és un modal, aquí “tornam” tancant el modal:
      modal.classList.add("ocult");
    });
  }

   // ✅ Necessari perquè el botó Android "enrere" tanqui el modal i no la PWA
  ensureModalHistory(iso);

  modal.classList.remove("ocult");
}



function dibuixaMes(isoYM) {
  graella.innerHTML = "";

  const [Y, M] = isoYM.split("-").map(Number);
  const daysInMonth = new Date(Y, M, 0).getDate();
  const firstDow = new Date(Y, M - 1, 1).getDay(); // 0=dg..6=ds
  const offset = (firstDow + 6) % 7; // dl=0..dg=6

  // Moon maps: mes actual + anterior + següent (per poder pintar fases als “altres mesos”)
  const moonByDay      = getMoonQuartersForMonth(Y, M - 1);
  const prevDate       = new Date(Y, M - 2, 1);
  const nextDate       = new Date(Y, M, 1);
  const prevY          = prevDate.getFullYear();
  const prevM1         = prevDate.getMonth() + 1; // 1..12
  const nextY          = nextDate.getFullYear();
  const nextM1         = nextDate.getMonth() + 1; // 1..12
  const daysInPrev     = new Date(prevY, prevM1, 0).getDate();
  const moonPrevByDay  = getMoonQuartersForMonth(prevY, prevM1 - 1);
  const moonNextByDay  = getMoonQuartersForMonth(nextY, nextM1 - 1);
    // ⭐ Dies bons per astrofoto: +/- 3 dies de Lluna nova (quarter=0)
  const MS_PER_DAY = 24*3600*1000;

  function collectNewMoons(map, year, monthIndex0){
    const out = [];
    for (const [day, quarters] of map.entries()){
      if (Array.isArray(quarters) && quarters.includes(0)){
        out.push(new Date(year, monthIndex0, day, 0, 0, 0));
      }
    }
    return out;
  }

  const newMoonDates = [
    ...collectNewMoons(moonPrevByDay, prevY, prevM1 - 1),
    ...collectNewMoons(moonByDay,     Y,     M - 1),
    ...collectNewMoons(moonNextByDay, nextY, nextM1 - 1),
  ];
console.log("newMoonDates:", newMoonDates);


  function pintaCel(dateObj, esAltreMes){
    const y  = dateObj.getFullYear();
    const m1 = dateObj.getMonth() + 1; // 1..12
    const d  = dateObj.getDate();

    const dd = String(d).padStart(2, "0");
    const mm = String(m1).padStart(2, "0");
    const iso = `${y}-${mm}-${dd}`;

    const info = efemerides[iso] || null;
    const esp = efemeridesEspecials[iso] || [];
    const act = activitats[iso] || [];

    const cel = document.createElement("div");
    cel.className = "dia" + (esAltreMes ? " altre-mes" : "");
        // ⭐ Marca el “marc” segons proximitat a Lluna nova (0..3)
    if (newMoonDates.length){
      const dayDate = new Date(y, m1 - 1, d, 0, 0, 0);
      let best = Infinity;

      for (const nm of newMoonDates){
        const diffDays = Math.round((dayDate.getTime() - nm.getTime()) / MS_PER_DAY);
        const ad = Math.abs(diffDays);
        if (ad < best) best = ad;
        if (best === 0) break;
      }

      if (best <= 3){
        cel.classList.add(`astrofoto-${best}`); // astrofoto-0..3
      }
    }


    // ✅ Avui en groc (només si és exactament avui)
    if (iso === AVUI_ISO) cel.classList.add("avui");

    // ✅ Diumenge o festiu: verd (si vols que als “altres mesos” no es posin verds, ho podem ajustar)
    const dow = dateObj.getDay(); // 0 = diumenge
    const esDiumenge = (dow === 0);
    const esFestiu = festius.has(iso);
    if (esDiumenge || esFestiu) cel.classList.add("festiu");

    // 🌙 fases lunars (quarts) segons el mes corresponent
    let moonQuarters = [];
    if (!esAltreMes && y === Y && m1 === M) {
      moonQuarters = moonByDay.get(d) || [];
    } else if (y === prevY && m1 === prevM1) {
      moonQuarters = moonPrevByDay.get(d) || [];
    } else if (y === nextY && m1 === nextM1) {
      moonQuarters = moonNextByDay.get(d) || [];
    }

    const moonHtml = moonQuarters.length
      ? `<div class="moon-phases">${moonQuarters
          .map(q => `<img class="moon-icon" src="${MOON_ICON_BY_QUARTER[q]}" alt="Fase lluna">`)
          .join("")}</div>`
      : "";

    // fons lluna fosca (si existeix en efemèrides)
// IMPORTANT: no ho apliquis en diumenge/festiu perquè taparia el verd
if (info?.lluna_foscor?.color && !(esDiumenge || esFestiu)) {
  cel.style.background = info.lluna_foscor.color;
  cel.style.color =
    (info.lluna_foscor.color === "#000000" || info.lluna_foscor.color === "#333333")
      ? "#fff"
      : "#000";
}


    cel.innerHTML = `
      <div class="num">${d}</div>
      ${moonHtml}
      ${act.length ? `<img class="am-mini am-act-center" src="assets/icons/astromallorca.png" alt="AstroMallorca">` : ""}
    <div class="badges">
  ${
    esp
      .filter(x => (x.codi || "").trim())   // ✅ només les que tenen icona
      .slice(0,6)
      .map(x => `<img class="esp-icon"
                      src="${x.codi}"
                      alt="${(x.titol || x.clau || "").replace(/"/g,"&quot;")}"
                      loading="lazy">`)
      .join("")
  }
</div>

    `;

    cel.onclick = () => obreDia(iso);
    graella.appendChild(cel);
  }

  // 1) Dies del mes anterior (en lloc de buits)
  // offset = quants dies abans del dia 1 hem de pintar
  for (let i = 0; i < offset; i++) {
    const dayPrev = (daysInPrev - offset + 1) + i; // p.ex: si offset=2 i diesPrev=31 -> 30,31
    pintaCel(new Date(prevY, prevM1 - 1, dayPrev), true);
  }

  // 2) Dies del mes actual
  for (let d = 1; d <= daysInMonth; d++) {
    pintaCel(new Date(Y, M - 1, d), false);
  }

  // 3) Dies del mes següent fins completar la darrera setmana
  const totalPintats = offset + daysInMonth;
  const tail = (7 - (totalPintats % 7)) % 7; // 0..6
  for (let d = 1; d <= tail; d++) {
    pintaCel(new Date(nextY, nextM1 - 1, d), true);
  }
}

async function obreDia(iso) {
  const info = efemerides[iso] || {};
  const esp = efemeridesEspecials[iso] || [];
 const espOrdenades = [...esp].sort((a, b) => {
  const aHas = !!(a.codi || "").trim();
  const bHas = !!(b.codi || "").trim();

  // 1) primer amb icona
  if (aHas !== bHas) return bHas - aHas;

  // 2) dins cada grup, per importància desc
  return (b.importancia ?? 0) - (a.importancia ?? 0);
});

  const act = activitats[iso] || [];
  const obsQ = `&lat=${encodeURIComponent(APP_OBSERVER.latitude)}&lon=${encodeURIComponent(APP_OBSERVER.longitude)}&elev=${encodeURIComponent(APP_OBSERVER.elevation ?? 0)}`;

  const nomFestiu = festius.get(iso);

  const llunaFaseTxt = info.lluna ? `${info.lluna.fase || ""} (${info.lluna.il_luminacio_percent ?? ""}%)` : "—";
  const astrofoto = info.lluna_foscor?.apte_astrofotografia ? "🌑 Dia favorable per astrofotografia" : "";

  const espHtml = espOrdenades.length
  ? `<h3>Efemèrides</h3><ul class="esp-llista">${
      espOrdenades.map(e => {
        const label = (e.titol || e.clau || e.tipus || e.codi || "").trim();
        const icon  = (e.codi || "").trim();

        const iconHtml = icon
          ? `<img class="esp-icon" src="${icon}" alt="${label.replace(/"/g,"&quot;")}" loading="lazy">`
          : "";

       return `<li class="esp-row"><span class="esp-bullet" aria-hidden="true">•</span>${iconHtml}<span>${label}${e.hora ? " — " + e.hora : ""}</span></li>`;
      }).join("")
    }</ul>`
  : `<h3>Efemèrides</h3><p>Cap destacat.</p>`;


const actHtml = act.length
  ? `<h3>Activitats AstroMallorca</h3><ul class="dia-llista">${
      act.map(a => {
        const titol = escapeHTML(a.titol || "Activitat");
        const hora  = icsTimeRange(a.dtstart, a.dtend);
        const lloc  = (a.lloc || "").trim();
        const info  = (a.descripcio || "").trim();
        const url   = (a.url || "").trim();

        return `<li>
          <b>${titol}</b>${hora ? ` — <span class="dia-time">${hora}</span>` : ""}
          ${lloc ? `<div class="dia-note"><b>Lloc:</b> ${linkifyText(lloc)}</div>` : ""}
          ${info ? `<div class="dia-note"><b>Info:</b> ${linkifyText(info)}</div>` : ""}
          ${url ? `<div class="dia-note"><a href="${url}" target="_blank" rel="noopener">Enllaç</a></div>` : ""}
        </li>`;
      }).join("")
    }</ul>`
  : `<h3>Activitats AstroMallorca</h3><p>Cap activitat.</p>`;

  
// === Efemèrides històriques (del teu JSON/CSV anual) ===
const [yStr, mStr] = iso.split("-");
const y = Number(yStr);
const m1 = Number(mStr);
  const d1 = Number(iso.slice(8,10));

const Q_LABEL = {
  0: "Lluna nova",
  1: "Quart creixent",
  2: "Lluna plena",
  3: "Quart minvant",
};

// mira si aquest dia té un “quart” (pot ser 1 o més, però normalment 1)
const qMap = getMoonQuartersForMonth(y, m1 - 1);
const qArr = qMap.get(d1) || [];
const moonQuarterLabel = (qArr.length ? (Q_LABEL[qArr[0]] || "") : "");


const monthData = await loadHistoricMonth(y, m1);
const rawHist = pickHistoricForISO(monthData, iso);
const histItems = renderHistoricItems(rawHist);

    // Sol i Lluna: sortida i posta (hora local dispositiu)
  const sol = getRiseSet("Sun", iso, APP_OBSERVER);
  const lluna = getRiseSet("Moon", iso, APP_OBSERVER);

  const solTxt = `Sortida: ${formatHM(sol.rise)} · Posta: ${formatHM(sol.set)}`;
  const llunaTxt = `Sortida: ${formatHM(lluna.rise)} · Posta: ${formatHM(lluna.set)}`;
     const teActivitat = act && act.length;
  const teEspecials = espOrdenades && espOrdenades.length;
  const teHistoric  = histItems && histItems.length;

const activitatHtml = teActivitat
  ? `<div class="dia-card">
       <div class="dia-card-title">Activitat</div>
       <ul class="dia-list">
    ${act.map(a => {
  const titol = escapeHTML(a.titol || "Activitat");
  const hora  = (a.hora || "").trim();

  const llocRaw = (a.lloc || "").trim();
  const infoRaw = (a.comentaris || a.descripcio || "").trim(); // comentaris ve del DESCRIPTION

return `
  <li>
    <b>${titol}</b>

    ${hora ? `<div class="dia-note"><b>Horari:</b> ${escapeHTML(hora)}</div>` : ""}
    ${llocRaw ? `<div class="dia-note"><b>Lloc:</b> ${linkifyText(llocRaw)}</div>` : ""}
    ${infoRaw ? `<div class="dia-note"><b>Info:</b> ${linkifyText(infoRaw)}</div>` : ""}

    ${(a.url || "").trim()
      ? `<div class="dia-note"><a href="${a.url.trim()}" target="_blank" rel="noopener">Enllaç</a></div>`
      : ""
    }
  </li>
`;
}).join("")}

       </ul>
     </div>`
  : "";

const especialsHtml = teEspecials
  ? `<div class="dia-card">
       <div class="dia-card-title">Efemèrides especials</div>
       <ul class="dia-list">
         ${espOrdenades.map(e => {
           const label = (e.titol || e.clau || e.tipus || "").trim();
           const icon  = (e.codi || "").trim();
           const iconHtml = icon
             ? `<img class="esp-icon" src="${icon}" alt="${label.replace(/"/g,"&quot;")}" loading="lazy">`
             : "";
           return `<li style="display:flex;align-items:center;gap:10px">
  <span class="esp-bullet" aria-hidden="true">•</span>
  ${iconHtml}
  <span>${label}${e.hora ? ` — ${e.hora}` : ""}</span>
</li>`;
         }).join("")}
       </ul>
     </div>`
  : "";


  const historicHtml = teHistoric
    ? `<div class="dia-card">
         <div class="dia-section-title small">EFEMÈRIDES HISTÒRIQUES</div>
         <div class="dia-historic">
          ${histItems.map(it => {
  if (typeof it === "string") return `<div class="dia-hitem">${it}</div>`;

  const desc = (it.description || it.descripcio || it.descripció || it.text || it.texto || "").toString().trim();
  if (!desc) return "";

  // Any: camp year/any o extret de "(born 1618)" / "(died 1637)"
  let yv = it.year ?? it.any;
  if (!yv){
    const m = desc.match(/\((?:born|died)\s+(\d{3,4})\)/i);
    if (m) yv = m[1];
  }
  const yearPrefix = yv ? `<span class="dia-hyear">${yv}</span>: ` : "";

  // Nom en negreta = abans de la primera coma
  const parts = desc.split(",");
  const name = (parts.shift() || "").trim();
  const rest = parts.length ? ", " + parts.join(",").trim() : "";

  return `<div class="dia-hitem">${yearPrefix}<b>${name}</b>${rest}</div>`;
}).join("")}

         </div>
       </div>`
    : "";
  contingutDia.innerHTML = `
    <!-- 1) Data -->
   <div class="dia-header dia-header-nav">
  <button class="dia-nav dia-prev btn-nav-mes" data-dir="-1" aria-label="Dia anterior">‹</button>

  <div class="dia-date">${weekdayCA2(iso)} ${isoToDDMMYYYY(iso)}</div>

  <button class="dia-nav dia-next btn-nav-mes" data-dir="1" aria-label="Dia següent">›</button>
</div>

${nomFestiu ? `<div class="dia-festiu">🎉 ${nomFestiu}</div>` : ""}


    <!-- 2) Activitat (només si n'hi ha) -->
    ${activitatHtml}

    <!-- 3) Títol EFEMÈRIDES -->
    <div class="dia-section-title">EFEMÈRIDES</div>

    <!-- 4) Efemèrides especials (només si n'hi ha) -->
    ${especialsHtml}

    <!-- 5) Bloc Sol/Lluna/Planetes/Messiers -->
<div class="dia-card">

  <div class="dia-row dia-link dia-btn" data-href="sol.html?date=${iso}${obsQ}">
    <div class="dia-row-icon">
  <img src="assets/icons/sun.png" alt="Sol">
</div>
    <div class="dia-row-text">
      <div class="dia-row-title">El Sol avui</div>
      <div class="dia-row-sub">${solTxt}</div>
    </div>
  </div>

  <div class="dia-row dia-link dia-btn" data-href="lluna.html?date=${iso}${obsQ}">
    <div class="dia-row-icon">
  <img src="assets/icons/moon.png" alt="Lluna">
</div>
    <div class="dia-row-text">
      <div class="dia-row-title">La Lluna avui${moonQuarterLabel ? ` — ${moonQuarterLabel}` : ""}</div>
      <div class="dia-row-sub">${llunaTxt}</div>
    </div>
  </div>

  <div class="dia-row dia-link dia-btn" data-href="planetes.html?date=${iso}${obsQ}">
    <div class="dia-row-icon">
  <img src="assets/icons/saturn.png" alt="Planetes">
</div>
    <div class="dia-row-text">
      <div class="dia-row-title">Els Planetes avui</div>
      <div class="dia-row-sub">Obre per veure detalls</div>
    </div>
  </div>

  <div class="dia-row dia-link dia-btn" data-href="messiers.html?date=${iso}${obsQ}">
    <div class="dia-row-icon">
  <img src="assets/icons/galaxy.png" alt="Cel profund">
</div>
    <div class="dia-row-text">
      <div class="dia-row-title">Messiers visibles</div>
      <div class="dia-row-sub">Obre per veure detalls</div>
    </div>
  </div>

</div>


    <!-- 6) Efemèrides històriques (al final) -->
    ${historicHtml}
  `;
   
  // Clickables
contingutDia.querySelectorAll(".dia-link").forEach(el => {
  el.addEventListener("click", () => {
    const href = el.getAttribute("data-href");
    if (!href) return;

    // ✅ Guardam retorn (per Android back dins pàgines Sol/Lluna/Planetes/Messiers)
    try{
      sessionStorage.setItem("am_return", location.href); // això inclou ?date=ISO si el tens
    }catch(e){}

    window.location.href = href;
  });
});


  modal.classList.remove("ocult");
  // === Navegació dia anterior / següent ===
const btnPrev = contingutDia.querySelector(".dia-prev");
const btnNext = contingutDia.querySelector(".dia-next");

const toDate = (isoStr) => {
  const [y,m,d] = isoStr.split("-").map(Number);
  return new Date(y, m-1, d);
};

const toISO = (date) => {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
};

const curDate = toDate(iso);

if (btnPrev){
  const prev = new Date(curDate);
  prev.setDate(prev.getDate() - 1);
  const prevISO = toISO(prev);

  btnPrev.disabled = (prevISO < "2026-01-01");
  if (!btnPrev.disabled) btnPrev.onclick = () => obreDia(prevISO);
}

if (btnNext){
  const next = new Date(curDate);
  next.setDate(next.getDate() + 1);
  const nextISO = toISO(next);

  btnNext.disabled = (nextISO > "2026-12-31");
  if (!btnNext.disabled) btnNext.onclick = () => obreDia(nextISO);
}

}

const btnTancar = document.querySelector(".tancar");
if (btnTancar) btnTancar.onclick = () => {
  try{
    // Si el modal ha creat estat d'historial, tornam enrere (això dispararà popstate i tancarà modal)
    if (history.state && history.state.__amModal === true){
      history.back();
      return;
    }
  }catch(e){}
  // fallback
  modal.classList.add("ocult");
};

botoNocturn.onclick = () => {
  const on = document.body.classList.toggle("nocturn");
  localStorage.setItem("nocturn", on ? "1" : "0");
};

// === ANIMACIÓ SWIPE ===
const swipeInner = document.getElementById("swipeInner");
const swipeArea  = document.getElementById("swipeArea");
let animant = false;

async function animaCanviMes(direccio){
  if (animant) return;

  // ✅ aquí estava el bug: dinsLimits(...) no existeix
  const target = direccio === "next" ? nextMonth(mesActual) : prevMonth(mesActual);
  const nouMes = clamp2026(target);
  if (nouMes === mesActual) return;

  animant = true;

  swipeInner.classList.add("swipe-anim");
  swipeInner.classList.remove("swipe-reset", "swipe-in-left", "swipe-in-right", "swipe-out-left", "swipe-out-right");
  swipeInner.classList.add(direccio === "next" ? "swipe-out-left" : "swipe-out-right");

  await wait(220);

  swipeInner.classList.remove("swipe-out-left", "swipe-out-right");
  swipeInner.classList.add(direccio === "next" ? "swipe-in-left" : "swipe-in-right");

  renderMes(nouMes);

  swipeInner.offsetHeight;

  swipeInner.classList.remove("swipe-in-left", "swipe-in-right");
  swipeInner.classList.add("swipe-reset");

  await wait(220);

  swipeInner.classList.remove("swipe-anim");
  animant = false;
}

// Botons (desktop)
const btnPrevMes = document.getElementById("prevMes");
const btnNextMes = document.getElementById("nextMes");
if (btnPrevMes) btnPrevMes.onclick = () => animaCanviMes("prev");
if (btnNextMes) btnNextMes.onclick = () => animaCanviMes("next");

// Detector swipe
let startX = 0, startY = 0, startT = 0;
let tracking = false;

swipeArea.addEventListener("touchstart", (e) => {
  if (!e.touches || e.touches.length !== 1) return;
  const t = e.touches[0];
  startX = t.clientX;
  startY = t.clientY;
  startT = Date.now();
  tracking = true;
}, { passive: true });

swipeArea.addEventListener("touchend", (e) => {
  if (!tracking) return;
  tracking = false;

  const t = e.changedTouches[0];
  const dx = t.clientX - startX;
  const dy = t.clientY - startY;
  const dt = Date.now() - startT;

  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  if (absX < 50) return;
  if (absY > absX * 0.7) return;
  if (dt > 600) return;

  if (dx < 0) animaCanviMes("next");
  else animaCanviMes("prev");
}, { passive: true });

// === Inici ===
async function inicia() {
  initObserverFromDevice();
  try {
    // local
    const e = await loadJSON("data/efemerides2026.json");
efemerides = e.dies || {};

// ✅ Efemèrides especials (icones) des de CSV LOCAL
const espRows = await loadCSVLocal("data/efemerides_2026_data_unica_importancia.csv");
efemeridesEspecials = buildEfemeridesEspecials(espRows);
    console.log("03-01-2026:", efemeridesEspecials["2026-01-03"]);


    // sheets (fotos + efemèrides + festius)
  const [fotos, fest] = await Promise.all([
  loadCSV(SHEET_FOTOS_MES),
  loadCSV(SHEET_FESTIUS)
]);

fotosMes = buildFotosMes(fotos);


    // Festius: A=data, B=nom
    festius = new Map();
    fest.forEach(r => {
      const iso = ddmmyyyyToISO(r.data);
      if (!iso) return;
      festius.set(iso, (r.nom || "Festiu"));
    });

    // calendari
    try {
      const icsText = await loadICS(CALENDAR_ICS);
      activitats = buildActivitatsFromICS(parseICS(icsText));
    } catch (err) {
      console.warn("No he pogut carregar el calendari ICS:", err);
      activitats = {};
    }

    // ✅ mes inicial ja calculat (mesActual) i avui groc ja aplicat a dibuixaMes
    renderMes(mesActual);
    // ✅ Si hi ha deep-link, obrim el modal del dia
if (DEEPLINK_ISO) {
  // ✅ Important a Android: cream una "base" sense ?date perquè hi hagi enrere intern
  try{
    history.replaceState({ __amBase: true }, "", location.pathname);
  }catch(e){}
  await obreDia(DEEPLINK_ISO);
}

// Ja està obert el modal: podem mostrar el calendari sense "flash"
try{ document.documentElement.classList.remove("deeplink-opening"); }catch(e){}

    // ✅ refresc suau (sense trencar festius)
    if (navigator.onLine) {
      setTimeout(async () => {
        try {
        const fest2 = await loadCSV(SHEET_FESTIUS);

          festius = new Map();
          fest2.forEach(r => {
            const iso = ddmmyyyyToISO(r.data);
            if (!iso) return;
            festius.set(iso, (r.nom || "Festiu"));
          });

          renderMes(mesActual);
        } catch {}
      }, 15000);
    }

  } catch (err) {
    graella.innerHTML = `<p style="padding:10px">Error carregant dades: ${err.message}</p>`;
    console.error(err);
  }
}

inicia();
iniciaCompteEnrereEclipsi();
const comptador = document.querySelector(".comptador-eclipsi");
if (comptador) {
  comptador.style.cursor = "pointer";
  comptador.addEventListener("click", () => {
    window.open(
      "https://astromallorca.wordpress.com/eclipsis/",
      "_blank"
    );
  });
}


// app.js

// === URLs (les teves) ===
const BASE_SHEETS =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSWf6OL8LYzMsBPuxvI_h4s9-0__hru3hWK9D2ewyccoku9ndl2VhZ0GS8P9uEigShJEehsy2UktnY2/pub";

const SHEET_FOTOS_MES = `${BASE_SHEETS}?gid=0&single=true&output=csv`;
const SHEET_EFEMERIDES = `${BASE_SHEETS}?gid=1305356303&single=true&output=csv`;
const SHEET_CONFIG = `${BASE_SHEETS}?gid=1324899531&single=true&output=csv`;

// ✅ FESTIUS (A=data DD-MM-YYYY, B=nom)
const SHEET_FESTIUS = `${BASE_SHEETS}?gid=1058273430&single=true&output=csv`;

// ICS públic
const CALENDAR_ICS =
  "https://r.jina.ai/https://calendar.google.com/calendar/ical/astromca%40gmail.com/public/basic.ics";

// Mesos en català
const MESOS_CA = [
  "Gener","Febrer","Març","Abril","Maig","Juny",
  "Juliol","Agost","Setembre","Octubre","Novembre","Desembre"
];

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
let efemerides = {};           // local data/efemerides_2026.json (per dia ISO)
let efemeridesEspecials = {};  // del sheet per dia ISO -> array
let activitats = {};           // del calendari ICS per dia ISO -> array
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
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  // Ajust 1
  let off = getTimeZoneOffsetMinutes(new Date(utc), timeZone);
  utc -= off * 60000;
  // Ajust 2 (per seguretat a canvis DST)
  off = getTimeZoneOffsetMinutes(new Date(utc), timeZone);
  utc -= off * 60000;
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
function parseCSV(text) {
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

    if (c === "," && !inQuotes) { row.push(cur); cur = ""; continue; }

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
function icsDateToISODate(dt) {
  if (!dt) return null;
  const d = dt.replace("Z", "");
  const y = d.slice(0, 4);
  const m = d.slice(4, 6);
  const day = d.slice(6, 8);
  if (!y || !m || !day) return null;
  return `${y}-${m}-${day}`;
}

// === Carregues ===
async function loadJSON(path) {
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new Error(`No puc carregar ${path} (${r.status})`);
  return r.json();
}
async function loadCSV(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`No puc carregar CSV (${r.status})`);
  const t = await r.text();
  return rowsToObjects(parseCSV(t));
}
async function loadICS(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`No puc carregar ICS (${r.status})`);
  let t = await r.text();

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
    out[iso] ??= [];
    out[iso].push({
      codi: o.codi,
      clau: o.clau || "",
      titol: o.titol || "",
      hora: o.hora || "",
      importancia: Number(o.importancia || 3)
    });
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
    out[iso].push({
      titol: ev.titol,
      lloc: ev.lloc,
      descripcio: ev.descripcio,
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
  img.onclick = (f ? () => obreModalDetallFoto(f) : null);

  img.onerror = () => {
    img.onerror = null;
    img.src = "assets/months/2026/default.png"; // opcional
  };
}
function obreModalDetallFoto(f) {
  contingutDia.innerHTML = `
    <h2>${f.titol || ""}</h2>
    ${f.imatge ? `<img src="${f.imatge}" alt="${f.titol || ""}" style="width:100%;border-radius:10px">` : ""}
    <p><b>Autor:</b> ${f.autor || ""}</p>
    <p><b>Lloc:</b> ${f.lloc || ""}</p>
    <p>${f.descripcio_llarga || f.descripcio_curta || ""}</p>
  `;
  modal.classList.remove("ocult");
}

function dibuixaMes(isoYM) {
  graella.innerHTML = "";

  const [Y, M] = isoYM.split("-").map(Number);
  const daysInMonth = new Date(Y, M, 0).getDate();
  const firstDow = new Date(Y, M - 1, 1).getDay(); // 0=dg..6=ds
  const offset = (firstDow + 6) % 7; // dl=0..dg=6

  for (let i = 0; i < offset; i++) {
    const empty = document.createElement("div");
    empty.className = "dia buit";
    graella.appendChild(empty);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dd = String(d).padStart(2, "0");
    const mm = String(M).padStart(2, "0");
    const iso = `${Y}-${mm}-${dd}`;

    const info = efemerides[iso] || null;
    const esp = efemeridesEspecials[iso] || [];
    const act = activitats[iso] || [];

    const cel = document.createElement("div");
    cel.className = "dia";

    // ✅ Avui en groc
    if (iso === AVUI_ISO) cel.classList.add("avui");

    // ✅ Diumenge o festiu: verd
    const dow = new Date(Y, M - 1, d).getDay(); // 0 = diumenge
    const esDiumenge = (dow === 0);
    const esFestiu = festius.has(iso);
    if (esDiumenge || esFestiu) cel.classList.add("festiu");

    // fons lluna fosca (si existeix)
    if (info?.lluna_foscor?.color) {
      cel.style.background = info.lluna_foscor.color;
      cel.style.color =
        (info.lluna_foscor.color === "#000000" || info.lluna_foscor.color === "#333333")
          ? "#fff"
          : "#000";
    }

    cel.innerHTML = `
      <div class="num">${d}</div>
      <div class="badges">
        ${esp.slice(0,2).map(x => `<span class="badge">${x.codi}</span>`).join("")}
        ${act.length ? `<img class="am-mini" src="assets/icons/astromallorca.png" alt="AstroMallorca">` : ""}
      </div>
    `;

    cel.onclick = () => obreDia(iso);
    graella.appendChild(cel);
  }
}

function obreDia(iso) {
  const info = efemerides[iso] || {};
  const esp = efemeridesEspecials[iso] || [];
  const act = activitats[iso] || [];

  const nomFestiu = festius.get(iso);

  const llunaTxt = info.lluna ? `${info.lluna.fase || ""} (${info.lluna.il_luminacio_percent ?? ""}%)` : "—";
  const astrofoto = info.lluna_foscor?.apte_astrofotografia ? "🌑 Dia favorable per astrofotografia" : "";

  const espHtml = esp.length
    ? `<h3>Efemèrides</h3><ul>${esp.map(e => `<li>${(e.titol || e.codi)}${e.hora ? " — " + e.hora : ""}</li>`).join("")}</ul>`
    : `<h3>Efemèrides</h3><p>Cap destacat.</p>`;

  const actHtml = act.length
    ? `<h3>Activitats AstroMallorca</h3><ul>${act.map(a => `<li><b>${a.titol}</b>${a.lloc ? " — " + a.lloc : ""}${a.url ? ` — <a href="${a.url}" target="_blank">Enllaç</a>` : ""}</li>`).join("")}</ul>`
    : `<h3>Activitats AstroMallorca</h3><p>Cap activitat.</p>`;

  contingutDia.innerHTML = `
    <h2>${iso}</h2>
    ${nomFestiu ? `<p>🎉 <b>${nomFestiu}</b></p>` : ""}
    <p><b>Lluna:</b> ${llunaTxt}</p>
    <p>${astrofoto}</p>
    ${espHtml}
    ${actHtml}
  `;
  modal.classList.remove("ocult");
}

document.querySelector(".tancar").onclick = () => modal.classList.add("ocult");
botoNocturn.onclick = () => document.body.classList.toggle("nocturn");

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
  try {
    // local
    const e = await loadJSON("data/efemerides_2026.json");
    efemerides = e.dies || {};

    // sheets (fotos + efemèrides + festius)
    const [fotos, esp, fest] = await Promise.all([
      loadCSV(SHEET_FOTOS_MES),
      loadCSV(SHEET_EFEMERIDES),
      loadCSV(SHEET_FESTIUS)
    ]);

    fotosMes = buildFotosMes(fotos);
    efemeridesEspecials = buildEfemeridesEspecials(esp);

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

    // ✅ refresc suau (sense trencar festius)
    if (navigator.onLine) {
      setTimeout(async () => {
        try {
          const [esp2, fest2] = await Promise.all([
            loadCSV(SHEET_EFEMERIDES),
            loadCSV(SHEET_FESTIUS)
          ]);
          efemeridesEspecials = buildEfemeridesEspecials(esp2);

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


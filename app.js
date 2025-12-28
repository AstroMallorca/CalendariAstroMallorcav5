// app.js — versió estable (sense errors isoToMonthKey / diaEl)

// === URLs ===
const SHEET_FOTOS_MES =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSWf6OL8LYzMsBPuxvI_h4s9-0__hru3hWK9D2ewyccoku9ndl2VhZ0GS8P9uEigShJEehsy2UktnY2/pub?gid=0&single=true&output=csv";

// Efemèrides especials (tab EFEMERIDES_ESPECIALS; la de la captura amb data/codi/titol/hora...)
const SHEET_EFEMERIDES_ESPECIALS =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSWf6OL8LYzMsBPuxvI_h4s9-0__hru3hWK9D2ewyccoku9ndl2VhZ0GS8P9uEigShJEehsy2UktnY2/pub?gid=1058273430&single=true&output=csv";

// Festius Balears (columna A = data DD-MM-YYYY, columna B = nom)
const SHEET_FESTIUS =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSWf6OL8LYzMsBPuxvI_h4s9-0__hru3hWK9D2ewyccoku9ndl2VhZ0GS8P9uEigShJEehsy2UktnY2/pub?gid=1058273430&single=true&output=csv";

// (Si tens festius a un altre gid, canvia només aquesta URL)

// Local
const LOCAL_EFEMERIDES_JSON = "data/efemerides_2026.json";

// Eclipse
const ECLIPSE_LOCAL_ISO = "2026-08-12T20:31:00+02:00"; // hora local (Europe/Madrid)

// Mesos en català
const MESOS_CA = [
  "Gener","Febrer","Març","Abril","Maig","Juny",
  "Juliol","Agost","Setembre","Octubre","Novembre","Desembre"
];

// === Estat ===
let mesActual = "2026-01";
let efemerides = {};             // per dia ISO: "YYYY-MM-DD"
let efemeridesEspecials = {};    // per dia ISO: array
let fotosMes = {};               // per clau "MM-YYYY"
let festius = new Map();         // ISO -> nom (text)

// === Helpers ===
function monthToParts(isoYM){
  const [y, m] = isoYM.split("-").map(Number);
  return { y, m };
}
function partsToMonth(y, m){
  return `${y}-${String(m).padStart(2,"0")}`;
}
function nextMonth(isoYM){
  let { y, m } = monthToParts(isoYM);
  m += 1; if (m === 13) { m = 1; y += 1; }
  return partsToMonth(y, m);
}
function prevMonth(isoYM){
  let { y, m } = monthToParts(isoYM);
  m -= 1; if (m === 0) { m = 12; y -= 1; }
  return partsToMonth(y, m);
}
function clamp2026(isoYM){
  const { y } = monthToParts(isoYM);
  if (y < 2026) return "2026-01";
  if (y > 2026) return "2026-12";
  return isoYM;
}

// "DD-MM-YYYY" -> "YYYY-MM-DD"
function ddmmyyyyToISO(s) {
  if (s == null) return null;
  const clean = String(s).replace(/\u00A0/g, " ").trim();
  const m = clean.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (!m) return null;
  const dd = m[1].padStart(2, "0");
  const mm = m[2].padStart(2, "0");
  const yyyy = m[3];
  return `${yyyy}-${mm}-${dd}`;
}

// "2026-08" -> "08-2026"
function isoToMonthKey(isoYM){
  const [y, m] = isoYM.split("-");
  return `${m}-${y}`;
}

function actualitzaTitolMes(isoYM){
  const el = document.getElementById("titolMes");
  if (!el) return;
  const { y, m } = monthToParts(isoYM);
  el.textContent = `${MESOS_CA[m-1].toUpperCase()} ${y}`;
}

function codiToIconFile(codi){
  // Normalitza: espais -> _, guions -> _
  return String(codi || "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");
}

function specialIconPath(codi){
  return `assets/icons/special/${codiToIconFile(codi)}.png`;
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

    if (c === '"' && inQuotes && next === '"') { cur += '"'; i++; continue; }
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

function rowsToObjects(rows) {
  if (!rows.length) return [];
  const header = rows[0].map(h => (h || "").trim());
  return rows.slice(1)
    .filter(r => r.some(x => (x || "").trim() !== ""))
    .map(r => {
      const obj = {};
      header.forEach((h, idx) => obj[h] = (r[idx] ?? "").trim());
      return obj;
    });
}

// === Fetchers ===
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

// === Build maps ===
function buildFotosMes(objs) {
  const out = {};
  for (const o of objs) {
    const key = (o.any_mes || "").trim(); // "MM-YYYY"
    if (!key) continue;
    out[key] = o;
  }
  return out;
}

function buildEfemeridesEspecials(objs){
  const out = {};
  for (const o of objs) {
    const iso = ddmmyyyyToISO(o.data);
    if (!iso) continue;
    out[iso] ??= [];
    out[iso].push({
      codi: String(o.codi || "").trim().replace(/-/g, "_"),
      clau: o.clau || "",
      titol: o.titol || "",
      hora: o.hora || "",
      importancia: Number(o.importancia || 3)
    });
  }
  return out;
}

function buildFestius(objs){
  // columna A: data | columna B: nom  (segons la teva captura)
  const out = new Map();
  for (const o of objs) {
    const iso = ddmmyyyyToISO(o.data);
    if (!iso) continue;
    out.set(iso, o.nom || "Festiu");
  }
  return out;
}

// === Foto del mes ===
function setFotoMes(isoYM){
  const key = isoToMonthKey(isoYM); // "MM-YYYY"
  const foto = fotosMes[key];

  const img = document.getElementById("imgFotoMes");
  const info = document.getElementById("titolFoto"); // un sol element al DOM!

  if (img) {
    img.src = foto?.imatge ? foto.imatge : img.src;
  }
  if (info) {
    const tit = (foto?.titol || "").trim();
    const aut = (foto?.autor || "").trim();
    info.textContent = (tit || aut) ? `${tit}${tit && aut ? " — " : ""}${aut}` : "";
  }
}

// === Compte enrere eclipse ===
function iniciaCompteEnrereEclipsi(){
  const el = document.getElementById("eclipsiCountdown");
  if (!el) return;

  const target = new Date(ECLIPSE_LOCAL_ISO);

  function tick(){
    const now = new Date();
    let diff = target.getTime() - now.getTime();
    if (diff < 0) diff = 0;

    const totalMin = Math.floor(diff / 60000);
    const d = Math.floor(totalMin / (60*24));
    const h = Math.floor((totalMin - d*60*24) / 60);
    const m = totalMin - d*60*24 - h*60;

    el.textContent = `${String(d).padStart(2,"0")}D:${String(h).padStart(2,"0")}H:${String(m).padStart(2,"0")}M`;
  }

  tick();
  setInterval(tick, 30000);
}

// === Dibuix mensual ===
function dibuixaMes(isoYM){
  const graella = document.getElementById("graellaDies");
  if (!graella) return;

  graella.innerHTML = "";

  const { y, m } = monthToParts(isoYM);
  const first = new Date(y, m-1, 1);
  const last = new Date(y, m, 0);

  // DI=0..DG=6 (diumenge)
  const jsDow = first.getDay(); // 0 diumenge
  const offset = (jsDow + 6) % 7; // dilluns=0

  const daysInMonth = last.getDate();

  // buits inicials
  for (let i=0;i<offset;i++){
    const empty = document.createElement("div");
    empty.className = "dia buit";
    graella.appendChild(empty);
  }

  const today = new Date();
  const todayISO = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;

  for (let d=1; d<=daysInMonth; d++){
    const iso = `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;

    const cell = document.createElement("div");
    cell.className = "dia";

    // número
    const num = document.createElement("div");
    num.className = "num";
    num.textContent = String(d);

    // diumenges (diumenge = 6 a la nostra graella DI..DG)
    const dow = (offset + (d-1)) % 7;
    const esDiumenge = (dow === 6);
    const esFestiu = festius.has(iso);

    if (esDiumenge || esFestiu) num.classList.add("verd");
    if (iso === todayISO && iso.startsWith("2026-")) cell.classList.add("avui");

    cell.appendChild(num);

    // Efemèrides especials -> ICONES
    const esp = efemeridesEspecials[iso] || [];
    if (esp.length){
      const wrap = document.createElement("div");
      wrap.className = "spec-wrap";

      // mostra fins a 2 icones (si vols més, pujam el límit)
      esp.slice(0,2).forEach(e => {
        const img = document.createElement("img");
        img.className = "spec-mini";
        img.src = specialIconPath(e.codi);
        img.alt = e.titol || e.codi;
        img.title = e.titol || e.codi;
        wrap.appendChild(img);
      });

      cell.appendChild(wrap);
    }

    // (Opcional) efemèrides del JSON (no icones aquí, només per dades futures)
    // const ef = efemerides[iso];

    graella.appendChild(cell);
  }
}

// === Inicialització ===
async function inicia(){
  try {
    // dades locals
    try {
      efemerides = await loadJSON(LOCAL_EFEMERIDES_JSON);
    } catch {
      efemerides = {};
    }

    // sheets
    const [fotos, esp, fest] = await Promise.all([
      loadCSV(SHEET_FOTOS_MES),
      loadCSV(SHEET_EFEMERIDES_ESPECIALS),
      loadCSV(SHEET_FESTIUS)
    ]);

    fotosMes = buildFotosMes(fotos);
    efemeridesEspecials = buildEfemeridesEspecials(esp);
    festius = buildFestius(fest);

    // mes inicial: mes actual si som al 2026, si no gener 2026
    const now = new Date();
    const isoYMNow = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
    mesActual = isoYMNow.startsWith("2026-") ? isoYMNow : "2026-01";

    // pintar
    setFotoMes(mesActual);
    actualitzaTitolMes(mesActual);
    dibuixaMes(mesActual);

    iniciaCompteEnrereEclipsi();

  } catch (err) {
    const graella = document.getElementById("graellaDies");
    if (graella){
      graella.innerHTML = `<p style="padding:10px">Error carregant dades: ${err.message}</p>`;
    }
    console.error(err);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  inicia();
  iniciaCompteEnrereEclipsi();
});

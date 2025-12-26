// === URLs (les teves) ===
const SHEET_FOTOS_MES = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSWf6OL8LYzMsBPuxvI_h4s9-0__hru3hWK9D2ewyccoku9ndl2VhZ0GS8P9uEigShJEehsy2UktnY2/pub?gid=0&single=true&output=csv";
const SHEET_EFEMERIDES = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSWf6OL8LYzMsBPuxvI_h4s9-0__hru3hWK9D2ewyccoku9ndl2VhZ0GS8P9uEigShJEehsy2UktnY2/pub?gid=1305356303&single=true&output=csv";
const SHEET_CONFIG = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSWf6OL8LYzMsBPuxvI_h4s9-0__hru3hWK9D2ewyccoku9ndl2VhZ0GS8P9uEigShJEehsy2UktnY2/pub?gid=1324899531&single=true&output=csv";

// ICS públic (prova això)
const CALENDAR_ICS = "https://calendar.google.com/calendar/ical/astromca%40gmail.com/public/basic.ics";

let efemerides = {};        // efemerides locals (data/efemerides_2026.json) per dia ISO
let efemeridesEspecials = {}; // del sheet per dia ISO -> array
let activitats = {};        // del calendari ICS per dia ISO -> array
let fotosMes = {};          // MM-YYYY -> info foto

// === Utils dates ===
function ddmmyyyyToISO(s) {
  // "12-08-2026" -> "2026-08-12"
  const [dd, mm, yyyy] = (s || "").trim().split("-");
  if (!dd || !mm || !yyyy) return null;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}
function isoToDay(iso) {
  return iso.split("-")[2];
}
function isoToMonthKey(iso) {
  // "2026-08-12" -> "08-2026"
  const [y, m] = iso.split("-");
  return `${m}-${y}`;
}
function isoToYM(iso) {
  // "2026-08-12" -> "2026-08"
  return iso.slice(0, 7);
}

// === CSV parser robust (quotes, commas) ===
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (c === '"' && inQuotes && next === '"') {
      cur += '"';
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (c === "," && !inQuotes) {
      row.push(cur);
      cur = "";
      continue;
    }
    if ((c === "\n" || c === "\r") && !inQuotes) {
      if (cur.length || row.length) {
        row.push(cur);
        rows.push(row);
      }
      row = [];
      cur = "";
      // saltar \r\n
      if (c === "\r" && next === "\n") i++;
      continue;
    }
    cur += c;
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
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

// === ICS parser mínim (VEVENT) ===
function parseICS(icsText) {
  // Unfold lines (RFC5545): lines that start with space are continuations
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

    const key = left.split(";")[0]; // ignore params
    cur[key] = value;
  }

  // Convertir a format intern simple
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
  // pot ser: 20260812T193000Z o 20260812 o 20260812T193000
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
  return r.text();
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
      importancia: Number(o.importancia || 3),
      detalls_json: o.detalls_json || ""
    });
  }
  return out;
}

function buildFotosMes(objs) {
  const out = {};
  for (const o of objs) {
    // any_mes format MM-YYYY (ex: 08-2026)
    const key = (o.any_mes || "").trim();
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

// === UI bàsica (graella del mes actual) ===
const graella = document.getElementById("graellaDies");
const modal = document.getElementById("modalDia");
const contingutDia = document.getElementById("contingutDia");
const botoNocturn = document.getElementById("toggleNocturn");

function setFotoMes(isoAnyMes) {
  // isoAnyMes "2026-08"
  const key = `${isoAnyMes.slice(5,7)}-${isoAnyMes.slice(0,4)}`; // MM-YYYY
  const f = fotosMes[key];
  if (!f) return;

  const img = document.querySelector("#fotoMes img");
  const titol = document.getElementById("titolFoto");
  img.src = f.imatge || img.src;
  titol.textContent = f.titol || "";
  img.onclick = () => {
    // modal simple per veure detall
    obreModalDetallFoto(f);
  };
}

function obreModalDetallFoto(f) {
  contingutDia.innerHTML = `
    <h2>${f.titol || ""}</h2>
    <img src="${f.imatge}" alt="${f.titol || ""}" style="width:100%;border-radius:10px">
    <p><b>Autor:</b> ${f.autor || ""}</p>
    <p><b>Lloc:</b> ${f.lloc || ""}</p>
    <p>${f.descripcio_llarga || f.descripcio_curta || ""}</p>
  `;
  modal.classList.remove("ocult");
}

function dibuixaMes(isoYM) {
  graella.innerHTML = "";

  // llista dies del mes isoYM: "2026-08"
  const days = Object.keys(efemerides).filter(d => d.startsWith(isoYM + "-")).sort();

  for (const iso of days) {
    const info = efemerides[iso];
    const cel = document.createElement("div");
    cel.className = "dia";

    // fons lluna fosca (si existeix)
    if (info.lluna_foscor?.color) {
      cel.style.background = info.lluna_foscor.color;
      cel.style.color = (info.lluna_foscor.color === "#000000" || info.lluna_foscor.color === "#333333") ? "#fff" : "#000";
    }

    // número dia
    cel.innerHTML = `
      <div class="num">${isoToDay(iso)}</div>
      <div class="badges">
        ${(efemeridesEspecials[iso] || []).slice(0,3).map(x => `<span class="badge">${x.codi}</span>`).join("")}
        ${(activitats[iso] || []).length ? `<span class="badge am">AM</span>` : ""}
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

  const llunaTxt = info.lluna ? `${info.lluna.fase || ""} (${info.lluna.il_luminacio_percent ?? ""}%)` : "—";
  const astrofoto = info.lluna_foscor?.apte_astrofotografia ? "🌑 Dia favorable per astrofotografia" : "";

  const espHtml = esp.length
    ? `<h3>Efemèrides</h3><ul>${esp.map(e => `<li>${e.titol || e.codi}${e.hora ? " — " + e.hora : ""}</li>`).join("")}</ul>`
    : `<h3>Efemèrides</h3><p>Cap destacat.</p>`;

  const actHtml = act.length
    ? `<h3>Activitats AstroMallorca</h3><ul>${act.map(a => `<li><b>${a.titol}</b>${a.lloc ? " — " + a.lloc : ""}${a.url ? ` — <a href="${a.url}" target="_blank">Enllaç</a>` : ""}</li>`).join("")}</ul>`
    : `<h3>Activitats AstroMallorca</h3><p>Cap activitat.</p>`;

  contingutDia.innerHTML = `
    <h2>${iso}</h2>
    <p><b>Lluna:</b> ${llunaTxt}</p>
    <p>${astrofoto}</p>
    ${espHtml}
    ${actHtml}
  `;

  modal.classList.remove("ocult");
}

document.querySelector(".tancar").onclick = () => modal.classList.add("ocult");
botoNocturn.onclick = () => document.body.classList.toggle("nocturn");

// === Inici (carrega i dibuixa) ===
async function inicia() {
  try {
    // 1) locals
    const e = await loadJSON("data/efemerides_2026.json");
    efemerides = e.dies || {};

    // 2) sheets (fotos mes, efemèrides, config)
    const [fotos, esp, cfg] = await Promise.all([
      loadCSV(SHEET_FOTOS_MES),
      loadCSV(SHEET_EFEMERIDES),
      loadCSV(SHEET_CONFIG).catch(() => [])
    ]);
    fotosMes = buildFotosMes(fotos);
    efemeridesEspecials = buildEfemeridesEspecials(esp);

    // 3) calendari ICS
    try {
      const icsText = await loadICS(CALENDAR_ICS);
      activitats = buildActivitatsFromICS(parseICS(icsText));
    } catch (err) {
      console.warn("No he pogut carregar el calendari ICS:", err);
      activitats = {};
    }

    // Mostram un mes per començar (agost 2026)
    const mesInicial = "2026-08";
    setFotoMes(mesInicial);
    dibuixaMes(mesInicial);

    // 4) refresc suau (per agafar actualitzacions del SW)
    if (navigator.onLine) {
      setTimeout(async () => {
        try {
          const esp2 = await loadCSV(SHEET_EFEMERIDES);
          efemeridesEspecials = buildEfemeridesEspecials(esp2);
          dibuixaMes(mesInicial);
        } catch {}
      }, 15000);
    }
  } catch (err) {
    graella.innerHTML = `<p style="padding:10px">Error carregant dades: ${err.message}</p>`;
    console.error(err);
  }
}

inicia();

// Registre SW
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("sw.js");
      console.log("✅ Service Worker registrat");
    } catch (e) {
      console.warn("⚠️ No s'ha pogut registrar el Service Worker", e);
    }
  });
}

// ========================
// CONFIG
// ========================
const BASE_SHEETS =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSWf6OL8LYzMsBPuxvI_h4s9-0__hru3hWK9D2ewyccoku9ndl2VhZ0GS8P9uEigShJEehsy2UktnY2/pub";

const SHEET_FOTOS_MES   = `${BASE_SHEETS}?gid=0&single=true&output=csv`;
const SHEET_EFEMERIDES  = `${BASE_SHEETS}?gid=1305356303&single=true&output=csv`;
const SHEET_FESTIUS     = `${BASE_SHEETS}?gid=1058273430&single=true&output=csv`;

// ✅ ICS públic (via proxy per evitar CORS a iPhone/PWA)
const CALENDAR_ICS =
  "https://r.jina.ai/http://calendar.google.com/calendar/ical/astromca%40gmail.com/public/basic.ics";

const MESOS_CA = [
  "Gener","Febrer","Març","Abril","Maig","Juny",
  "Juliol","Agost","Setembre","Octubre","Novembre","Desembre"
];

// ========================
// ESTAT
// ========================
let mesActual = "2026-01";
let efemerides = {};          // data/efemerides_2026.json -> dies[ISO]
let efemeridesEspecials = {}; // sheet -> per dia ISO
let activitats = {};          // ICS -> per dia ISO
let fotosMes = {};            // sheet fotos -> "MM-YYYY"
let festius = new Map();      // ISO -> nom

// ========================
// DOM
// ========================
const graella = document.getElementById("graellaDies");
const modal = document.getElementById("modalDia");
const contingutDia = document.getElementById("contingutDia");
const botoNocturn = document.getElementById("toggleNocturn");
const swipeArea = document.getElementById("swipeArea");
const swipeInner = document.getElementById("swipeInner");

// ========================
// UTILS
// ========================
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

function ddmmyyyyToISO(s){
  if (s == null) return null;
  const clean = String(s).replace(/\u00A0/g, " ").trim();
  const m = clean.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (!m) return null;
  const dd = m[1].padStart(2,"0");
  const mm = m[2].padStart(2,"0");
  const yyyy = m[3];
  return `${yyyy}-${mm}-${dd}`;
}

function isoToMonthKey(isoYM){
  return `${isoYM.slice(5,7)}-${isoYM.slice(0,4)}`; // "MM-YYYY"
}

function actualitzaTitolMes(isoYM){
  const [y, m] = isoYM.split("-").map(Number);
  document.getElementById("titolMes").textContent = `${MESOS_CA[m-1]} ${y}`.toUpperCase();
}

function monthToParts(isoYM){ const [y,m] = isoYM.split("-").map(Number); return {y,m}; }
function partsToMonth(y,m){ return `${y}-${String(m).padStart(2,"0")}`; }
function nextMonth(isoYM){
  let {y,m}=monthToParts(isoYM); m++; if(m===13){m=1;y++;} return partsToMonth(y,m);
}
function prevMonth(isoYM){
  let {y,m}=monthToParts(isoYM); m--; if(m===0){m=12;y--;} return partsToMonth(y,m);
}
function clamp2026(isoYM){
  const {y}=monthToParts(isoYM);
  if(y<2026) return "2026-01";
  if(y>2026) return "2026-12";
  return isoYM;
}

// ========================
// CSV
// ========================
function parseCSV(text){
  const rows=[]; let row=[]; let cur=""; let inQ=false;
  for(let i=0;i<text.length;i++){
    const c=text[i], n=text[i+1];
    if(c === '"' && inQ && n === '"'){ cur+='"'; i++; continue; }
    if(c === '"'){ inQ=!inQ; continue; }
    if(c === "," && !inQ){ row.push(cur); cur=""; continue; }
    if((c === "\n" || c === "\r") && !inQ){
      if(cur.length || row.length){ row.push(cur); rows.push(row); }
      row=[]; cur="";
      if(c === "\r" && n === "\n") i++;
      continue;
    }
    cur+=c;
  }
  if(cur.length || row.length){ row.push(cur); rows.push(row); }
  return rows;
}

function rowsToObjects(rows){
  if(!rows.length) return [];
  const header = rows[0].map(h => (h||"").trim().toLowerCase());
  return rows.slice(1)
    .filter(r => r.some(x => (x||"").trim() !== ""))
    .map(r => {
      const o={};
      header.forEach((h,idx)=> o[h]=(r[idx]??"").trim());
      return o;
    });
}

async function loadCSV(url){
  const r = await fetch(url, { cache:"no-store" });
  if(!r.ok) throw new Error(`No puc carregar CSV (${r.status})`);
  const t = await r.text();
  return rowsToObjects(parseCSV(t));
}

async function loadJSON(path){
  const r = await fetch(path, { cache:"no-store" });
  if(!r.ok) throw new Error(`No puc carregar ${path} (${r.status})`);
  return r.json();
}

// ========================
// ICS
// ========================
async function loadICS(url){
  const r = await fetch(url, { cache:"no-store" });
  if(!r.ok) throw new Error(`No puc carregar ICS (${r.status})`);
  let t = await r.text();
  const idx = t.indexOf("BEGIN:VCALENDAR");
  if(idx !== -1) t = t.slice(idx);
  return t;
}

function parseICS(icsText){
  const raw = icsText.split(/\r?\n/);
  const lines=[];
  for(const l of raw){
    if(l.startsWith(" ") && lines.length) lines[lines.length-1]+=l.slice(1);
    else lines.push(l);
  }

  const events=[];
  let cur=null;

  for(const line of lines){
    if(line==="BEGIN:VEVENT"){ cur={}; continue; }
    if(line==="END:VEVENT"){ if(cur) events.push(cur); cur=null; continue; }
    if(!cur) continue;

    const idx=line.indexOf(":");
    if(idx===-1) continue;
    const left=line.slice(0,idx);
    const value=line.slice(idx+1);
    const key=left.split(";")[0];
    cur[key]=value;
  }

  return events.map(e=>({
    titol: e.SUMMARY || "Activitat",
    lloc: e.LOCATION || "",
    descripcio: e.DESCRIPTION || "",
    url: e.URL || "",
    dtstart: e.DTSTART || ""
  }));
}

function icsDateToISODate(dt){
  if(!dt) return null;
  const d = dt.replace("Z","");
  const y=d.slice(0,4), m=d.slice(4,6), day=d.slice(6,8);
  if(!y || !m || !day) return null;
  return `${y}-${m}-${day}`;
}

function buildActivitatsFromICS(events){
  const out={};
  for(const ev of events){
    const iso = icsDateToISODate(ev.dtstart);
    if(!iso) continue;
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

// ========================
// BUILDERS (Sheets)
// ========================
function buildEfemeridesEspecials(objs){
  const out={};
  for(const o of objs){
    const iso = ddmmyyyyToISO(o.data);
    if(!iso) continue;
    out[iso] ??= [];
    out[iso].push({
      codi: o.codi || "",
      titol: o.titol || "",
      hora: o.hora || ""
    });
  }
  return out;
}

function buildFotosMes(objs){
  const out={};
  for(const o of objs){
    const key=(o.any_mes || "").trim(); // "MM-YYYY"
    if(!key) continue;
    out[key]=o;
  }
  return out;
}

// ========================
// ✅ CAPTION: entre foto i mes
// ========================
function asseguraCaptionEntreFotoIMes(){
  const titolMes = document.getElementById("titolMes");
  if(!titolMes) return null;

  let cap = document.getElementById("captionFotoMes");
  if(!cap){
    cap = document.createElement("div");
    cap.id = "captionFotoMes";
    cap.className = "caption-foto";
  }

  // Inserta JUST abans del títol del mes
  titolMes.parentNode.insertBefore(cap, titolMes);
  return cap;
}

// ========================
// UI: foto mes + caption
// ========================
function setFotoMes(isoYM){
  const key = isoToMonthKey(isoYM);
  const f = fotosMes[key];

  const img = document.getElementById("imgFotoMes");
  const cap = asseguraCaptionEntreFotoIMes();

  // Foto (fallback local)
  const fallback = `assets/months/2026/${isoYM}.png`;
  const src = (f && f.imatge) ? f.imatge : fallback;
  img.src = src;

  // ✅ caption entre foto i mes
  const titol = (f && f.titol) ? String(f.titol).trim() : "";
  const autor = (f && f.autor) ? String(f.autor).trim() : "";
  cap.textContent = autor ? `${titol} — ${autor}` : titol;

  // Click a la foto -> modal detall
  img.onclick = f ? () => obreModalDetallFoto(f) : null;
  img.onerror = () => { img.onerror=null; img.src = "assets/months/2026/default.png"; };
}

function obreModalDetallFoto(f){
  contingutDia.innerHTML = `
    <h2>${f.titol || ""}</h2>
    ${f.imatge ? `<img src="${f.imatge}" alt="${f.titol||""}" style="width:100%;border-radius:10px">` : ""}
    <p><b>Autor:</b> ${f.autor || ""}</p>
    <p><b>Lloc:</b> ${f.lloc || ""}</p>
    <p>${f.descripcio_llarga || f.descripcio_curta || ""}</p>
  `;
  modal.classList.remove("ocult");
}

// ========================
// UI: graella mes
// ========================
function dibuixaMes(isoYM){
  graella.innerHTML="";

  const [Y,M]=isoYM.split("-").map(Number);
  const daysInMonth = new Date(Y, M, 0).getDate();
  const firstDow = new Date(Y, M-1, 1).getDay(); // 0 dg..6 ds
  const offset = (firstDow + 6) % 7; // dl=0..dg=6

  // buits
  for(let i=0;i<offset;i++){
    const e=document.createElement("div");
    e.className="dia buit";
    graella.appendChild(e);
  }

  for(let d=1; d<=daysInMonth; d++){
    const dd=String(d).padStart(2,"0");
    const mm=String(M).padStart(2,"0");
    const iso=`${Y}-${mm}-${dd}`;

    const esp = efemeridesEspecials[iso] || [];
    const act = activitats[iso] || [];

    const cel=document.createElement("div");
    cel.className="dia";

    const dow = new Date(Y, M-1, d).getDay(); // 0 diumenge
    const esDiumenge = (dow===0);
    const esFestiu = festius.has(iso);
    if(esDiumenge || esFestiu) cel.classList.add("festiu");

    // foscor lluna si existeix al JSON
    const info = efemerides[iso] || null;
    if(info?.lluna_foscor?.color){
      cel.style.background = info.lluna_foscor.color;
      cel.style.color = (info.lluna_foscor.color === "#000000") ? "#fff" : "#111";
    }

    const amIcon = act.length
      ? `<img class="am-mini" src="assets/icons/astromallorca.png" alt="AstroMallorca">`
      : "";

    cel.innerHTML = `
      <div class="num">${d}</div>
      <div class="badges">
        ${esp.slice(0,2).map(x => `<span class="badge">${x.codi}</span>`).join("")}
        ${amIcon}
      </div>
    `;

    cel.onclick = () => obreDia(iso);
    graella.appendChild(cel);
  }
}

function obreDia(iso){
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

// ========================
// SWIPE
// ========================
let animant=false;

async function animaCanviMes(dir){
  if(animant) return;
  const nou = clamp2026(dir==="next" ? nextMonth(mesActual) : prevMonth(mesActual));
  if(nou === mesActual) return;

  animant=true;

  swipeInner.classList.add("swipe-anim");
  swipeInner.classList.remove("swipe-reset","swipe-in-left","swipe-in-right","swipe-out-left","swipe-out-right");
  swipeInner.classList.add(dir==="next" ? "swipe-out-left" : "swipe-out-right");
  await wait(220);

  swipeInner.classList.remove("swipe-out-left","swipe-out-right");
  swipeInner.classList.add(dir==="next" ? "swipe-in-left" : "swipe-in-right");

  renderMes(nou);

  swipeInner.offsetHeight;
  swipeInner.classList.remove("swipe-in-left","swipe-in-right");
  swipeInner.classList.add("swipe-reset");
  await wait(220);

  swipeInner.classList.remove("swipe-anim");
  animant=false;
}

let startX=0, startY=0, startT=0, tracking=false;
swipeArea.addEventListener("touchstart",(e)=>{
  if(!e.touches || e.touches.length!==1) return;
  const t=e.touches[0];
  startX=t.clientX; startY=t.clientY; startT=Date.now();
  tracking=true;
},{passive:true});

swipeArea.addEventListener("touchend",(e)=>{
  if(!tracking) return;
  tracking=false;

  const t=e.changedTouches[0];
  const dx=t.clientX-startX;
  const dy=t.clientY-startY;
  const dt=Date.now()-startT;

  const absX=Math.abs(dx), absY=Math.abs(dy);
  if(absX<50) return;
  if(absY>absX*0.7) return;
  if(dt>600) return;

  if(dx<0) animaCanviMes("next");
  else animaCanviMes("prev");
},{passive:true});

// ========================
// RENDER
// ========================
function renderMes(isoYM){
  mesActual=isoYM;
  setFotoMes(isoYM);
  actualitzaTitolMes(isoYM);
  dibuixaMes(isoYM);
}

// ========================
// INIT
// ========================
document.querySelector(".tancar").onclick = ()=> modal.classList.add("ocult");
botoNocturn.onclick = ()=> document.body.classList.toggle("nocturn");

async function inicia(){
  try{
    // JSON local
    const e = await loadJSON("data/efemerides_2026.json");
    efemerides = e.dies || {};

    // Sheets
    const [fotos, esp, fest] = await Promise.all([
      loadCSV(SHEET_FOTOS_MES),
      loadCSV(SHEET_EFEMERIDES),
      loadCSV(SHEET_FESTIUS)
    ]);

    fotosMes = buildFotosMes(fotos);
    efemeridesEspecials = buildEfemeridesEspecials(esp);

    // festius map (ISO -> nom)
    festius = new Map();
    fest.forEach(r=>{
      const iso = ddmmyyyyToISO(r.data);
      if(!iso) return;
      festius.set(iso, r.nom || "Festiu");
    });

    // ICS
    try{
      const icsText = await loadICS(CALENDAR_ICS);
      activitats = buildActivitatsFromICS(parseICS(icsText));
      // Debug útil:
      // console.log("Activitats (dies):", Object.keys(activitats).length);
    }catch(err){
      console.warn("No he pogut carregar el calendari ICS:", err);
      activitats = {};
    }

    renderMes(mesActual);

  }catch(err){
    graella.innerHTML = `<div style="padding:12px">Error carregant dades: ${err.message}</div>`;
    console.error(err);
  }
}

inicia();

// ========================
// SW register + auto update
// ========================
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload());
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("sw.js");
      if (reg.waiting) reg.waiting.postMessage("SKIP_WAITING");
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", () => {
          if (nw.state === "installed" && navigator.serviceWorker.controller) {
            nw.postMessage("SKIP_WAITING");
          }
        });
      });
    } catch (e) {
      console.warn("SW no registrat:", e);
    }
  });
}


// H3samBot — diagnostic build (renders even if KB fails)
const chat  = document.getElementById('chat');
const form  = document.getElementById('chatForm');
const input = document.getElementById('userInput');
const statusEl = document.getElementById('status');

function setStatus(msg){ if(statusEl){ statusEl.textContent = "Status: " + msg; } console.log("[H3samBot]", msg); }
function addMsg(role, html){
  const row = document.createElement('div'); row.className = 'msg ' + role;
  const bubble = document.createElement('div'); bubble.className = 'bubble'; bubble.innerHTML = html;
  row.appendChild(bubble); chat.appendChild(row); chat.scrollTop = chat.scrollHeight;
}

// Banner so you always see something
addMsg('bot', `<b>H3samBot</b> ready. Ask me about camera settings, lighting, lenses, networking, Windows/Linux tips, and more.<br>
<small class="hint">Try: “best shutter for sports” or “fix high CPU on Windows”.</small>`);

// ----- utils -----
function tokenize(t){ return t.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(Boolean); }
function tfidfVectors(docs){
  const vocab=new Map();
  const tfs=docs.map(tokens=>{ const m=new Map(); tokens.forEach(w=>m.set(w,(m.get(w)||0)+1)); for(const w of m.keys()) if(!vocab.has(w)) vocab.set(w,0); return m; });
  for(const m of tfs){ for(const w of m.keys()) vocab.set(w,(vocab.get(w)||0)+1); }
  const N=docs.length, idf=new Map(); for(const [w,df] of vocab) idf.set(w, Math.log(1+N/df));
  const vecs=tfs.map(m=>{ const v=new Map(); for(const [w,f] of m) v.set(w, f*(idf.get(w)||0)); return v; });
  return {vecs,idf};
}
function cosine(a,b){ let dot=0,na=0,nb=0; for(const [w,va] of a){na+=va*va; const vb=b.get(w); if(vb) dot+=va*vb;} for(const [,vb] of b){nb+=vb*vb;} return dot/(Math.sqrt(na)*Math.sqrt(nb)||1); }

// ----- KB load + index -----
let KB=[], pre=null;
async function loadKBAndIndex(){
  try{
    setStatus("loading knowledge.json …");
    const res = await fetch('data/knowledge.json?cb=' + Date.now());
    if(!res.ok){ setStatus("failed to fetch knowledge.json ("+res.status+")"); return; }
    KB = await res.json();
    setStatus("knowledge loaded: " + KB.length + " items");
    const docs = KB.map(x => tokenize((x.q||"") + " " + (x.a||"")));
    pre = tfidfVectors(docs);
    setStatus("index built");
  }catch(e){
    setStatus("error loading KB: " + (e.message||e));
    console.error(e);
  }
}
async function ensureReady(){ if(!pre) await loadKBAndIndex(); }

// ----- QA -----
async function answer(q) {
  await ensureReady();

  // --- Greeting ---
  if (/^\s*(hi|hello|hey|yo|sup|greetings|good\s*(morning|evening))\s*$/i.test(q)) {
    return "Hey there 👋 I'm H3samBot — your Photo & Tech assistant! Ask me about cameras, lighting, editing, or tech fixes for Windows and Linux.";
  }

  if (!pre) return "I couldn’t load my knowledge base yet — please refresh.";

  // --- Detect topic ---
  const qLower = q.toLowerCase();
  const isPhoto = /(camera|lens|photo|photography|aperture|shutter|bokeh|flash|studio|exposure|lighting)/.test(qLower);
  const isTech = /(windows|linux|mac|apple|microsoft|driver|update|wifi|network|security|pc|software|hardware)/.test(qLower);

  // --- Reject irrelevant questions ---
  if (!isPhoto && !isTech) {
    return "🤖 Sorry, I can only help with photography 📸 and IT/tech 💻 questions. Try asking me something like:<br>– 'Best settings for portraits'<br>– 'Fix Wi-Fi not working on Windows'<br>– 'What’s a good camera for low light?'.";
  }

  // --- Topic filter ---
  const topic = isPhoto ? "photo" : "it";
  const idxs = [];
  KB.forEach((item, i) => {
    if (!item.topic || item.topic === topic) idxs.push(i);
  });

  // --- Build query vector ---
  const toks = tokenize(q);
  const m = new Map();
  toks.forEach(w => m.set(w, (m.get(w) || 0) + 1));
  const vq = new Map();
  for (const [w, f] of m) vq.set(w, f * (pre.idf.get(w) || 0));

  // --- Score ---
  const scored = idxs.map(i => {
    const s = cosine(vq, pre.vecs[i]);
    return { i, s };
  }).sort((a, b) => b.s - a.s);

  const picks = scored.filter(x => x.s >= 0.02).slice(0, 3);
  if (picks.length === 0) {
    return "Hmm 🤔 I couldn’t find anything for that. Try being more specific — like 'best lens for portraits' or 'how to fix high CPU on Windows'.";
  }

  // --- Render cards ---
  const cards = picks.map(p => {
    const it = KB[p.i];
    const date = it.date ? `<br><small>${new Date(it.date).toDateString()}</small>` : "";
    return `<div class="card"><b>${it.title || "Tip"}</b>${date}<br>${it.a}</div>`;
  });

  return cards.join("");
}


// boot
loadKBAndIndex();

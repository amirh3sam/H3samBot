// H3samBot — stable build with strong diagnostics

// ---- DOM refs ----
const chat  = document.getElementById('chat');
const form  = document.getElementById('chatForm');
const input = document.getElementById('userInput');
const statusEl = document.getElementById('status');

// ---- Diagnostics helpers ----
function setStatus(msg){ if(statusEl){ statusEl.textContent = "Status: " + msg; } console.log("[H3samBot]", msg); }
window.addEventListener('error', e => setStatus("JS error: " + (e.message || e)));
window.addEventListener('unhandledrejection', e => setStatus("Promise error: " + (e.reason?.message || e.reason || e)));

// ---- UI helpers ----
function addMsg(role, html){
  if(!chat){ console.error("chat element missing"); return; }
  const row = document.createElement('div');
  row.className = 'msg ' + role;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = html;
  row.appendChild(bubble);
  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;
}

// Opening banner so you always see something
addMsg('bot', `<b>H3samBot</b> ready. Ask me about camera settings, lighting, lenses, Windows/Linux tips, and more.<br>
<small class="hint">Try: “best shutter for sports” or “fix high CPU on Windows”.</small>`);

// ---- NLP utils ----
function tokenize(t){ return (t||"").toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(Boolean); }
function tfidfVectors(docs){
  const vocab=new Map();
  const tfs=docs.map(tokens=>{
    const m=new Map();
    tokens.forEach(w=>m.set(w,(m.get(w)||0)+1));
    for(const w of m.keys()) if(!vocab.has(w)) vocab.set(w,0);
    return m;
  });
  for(const m of tfs){ for(const w of m.keys()) vocab.set(w,(vocab.get(w)||0)+1); }
  const N=docs.length, idf=new Map();
  for(const [w,df] of vocab) idf.set(w, Math.log(1 + N/df));
  const vecs=tfs.map(m=>{ const v=new Map(); for(const [w,f] of m) v.set(w, f*(idf.get(w)||0)); return v; });
  return { vecs, idf };
}
function cosine(a,b){ let dot=0,na=0,nb=0; for(const [w,va] of a){na+=va*va; const vb=b.get(w); if(vb) dot+=va*vb;} for(const [,vb] of b){nb+=vb*vb;} return dot/(Math.sqrt(na)*Math.sqrt(nb)||1); }

// ---- KB load + index ----
let KB=[], pre=null;

async function loadKBAndIndex(){
  try{
    setStatus("loading knowledge.json …");
    const res = await fetch('data/knowledge.json?cb=' + Date.now());
    if(!res.ok){ setStatus("fetch failed: " + res.status); return; }
    KB = await res.json();
    setStatus("knowledge loaded: " + KB.length + " items");
    const docs = KB.map(x => tokenize((x.q||'') + ' ' + (x.a||'')));
    pre = tfidfVectors(docs);
    setStatus("index built");
  }catch(e){
    setStatus("error loading KB: " + (e.message||e));
  }
}
async function ensureReady(){ if(!pre) await loadKBAndIndex(); }

// ---- Answer logic (with topic guard + greeting) ----
async function answer(q){
  await ensureReady();

  // greeting
  if(/^\s*(hi|hello|hey|yo|sup|greetings|good\s*(morning|evening))\s*$/i.test(q)){
    return "Hey there 👋 I'm H3samBot — your Photo & Tech assistant! Ask me about cameras, lighting, or Windows/Linux fixes.";
  }

  if(!pre){ return "I couldn’t load my knowledge base yet — please refresh."; }

// topic gate (only photo/tech)
// --- Topic detection (more flexible) ---
const ql = q.toLowerCase();

// Expanded keyword lists
const photoKW = /(camera|lens|photo|photography|aperture|shutter|bokeh|flash|studio|exposure|lighting|portrait|landscape|iso|raw|mirrorless|dslr)/i;
const techKW  = /(tech|technology|\bit\b|computer|pc|software|hardware|windows|linux|mac|apple|microsoft|driver|update|wifi|network|security|gpu|cpu|browser|android|iphone|ios|server|system|it support)/i;

// Detect intent
const isPhoto = photoKW.test(ql);
const isTech  = techKW.test(ql);
const wantsNews = /(news|latest|new|updates?|trending|recent)\b/.test(ql);

let topic = null;

// If user mentions both “it” and “news”, handle gracefully
if (isPhoto) topic = "photo";
else if (isTech || /\bit\b/.test(ql)) topic = "it";
else if (wantsNews) topic = "it"; // default news → tech
else {
  return "🤖 Sorry, I only help with photography 📸 and IT/tech 💻 questions. Try: “best settings for portraits” or “fix Wi-Fi on Windows”.";
}

// --- “News” shortcut: show latest 3 ---
if (wantsNews) {
  const items = KB.filter(it => !it.topic || it.topic === topic);
  items.sort((a,b) => new Date(b.date || 0) - new Date(a.date || 0));
  const picks = items.slice(0, 3);
  if (picks.length === 0) return "No recent updates yet — check back later!";
  return picks.map(it => {
    const date = it.date ? `<br><small>${new Date(it.date).toDateString()}</small>` : "";
    return `<div class='card'><b>${it.title || 'Update'}</b>${date}<br>${it.a}</div>`;
  }).join("");
}


  const idxs = [];
  KB.forEach((item,i)=>{ if(!item.topic || item.topic === topic) idxs.push(i); });

  // query vector
  const m=new Map(); tokenize(q).forEach(w=>m.set(w,(m.get(w)||0)+1));
  const vq = new Map(); for(const [w,f] of m) vq.set(w, f*(pre.idf.get(w)||0));

  // score subset
  const scored = idxs.map(i=>({ i, s: cosine(vq, pre.vecs[i]) }))
                     .sort((a,b)=>b.s-a.s);

  const picks = scored.filter(x=>x.s>=0.02).slice(0,3);
  if(picks.length===0){
    return "Hmm 🤔 I couldn’t find anything for that. Try being more specific — like “best mirrorless camera 2025” or “fix Wi-Fi on Windows 11”.";
  }

  const cards = picks.map(p=>{
    const it = KB[p.i];
    const date = it.date ? `<br><small>${new Date(it.date).toDateString()}</small>` : "";
    return `<div class="card"><b>${it.title||'Tip'}</b>${date}<br>${it.a}</div>`;
  });
  return cards.join("");
}

// ---- Bind form safely ----
if(!form){
  setStatus("form element not found (id='chatForm'). Check your HTML.");
}else{
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    if(!input){ setStatus("input element not found (id='userInput')"); return; }
    const q = (input.value||"").trim();
    if(!q) return;
    addMsg('user', q);
    input.value = '';

    const thinking = document.createElement('div');
    thinking.className = 'msg bot';
    thinking.innerHTML = '<div class="bubble">…</div>';
    chat.appendChild(thinking); chat.scrollTop = chat.scrollHeight;

    try{
      const a = await answer(q);
      thinking.remove();
      addMsg('bot', a);
    }catch(err){
      thinking.remove();
      addMsg('bot', 'Error: ' + (err?.message||err));
      setStatus("submit error: " + (err?.message||err));
    }
  });
}

// ---- Minimal styles for cards if not present ----
(function injectCardStyle(){
  if(document.querySelector('style[data-h3sam]')) return;
  const s = document.createElement('style');
  s.dataset.h3sam = "1";
  s.textContent = ".card{background:#0e1420;border:1px solid #202b3d;border-radius:10px;padding:12px;margin:8px 0}";
  document.head.appendChild(s);
})();

// ---- Boot ----
loadKBAndIndex();

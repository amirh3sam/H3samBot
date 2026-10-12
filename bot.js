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
// "it" is deliberately NOT a stop word here: IT support is half this bot's job.
const STOP_WORDS = new Set("a an the and or but if then than that this these those is are was were am be been being do does did to of in on at by for with from as into about over after before under my your you we our us me i how what when where which who why can could will would should too very really get got make makes need want".split(" "));
// Crude singular folding so "photos" and "photo" are the same term. It does
// not have to be linguistically right, only applied identically to documents
// and queries, which is what makes the match work.
function stem(w){
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && (w.endsWith("ses") || w.endsWith("xes") || w.endsWith("ches") || w.endsWith("shes"))) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) return w.slice(0, -1);
  return w;
}
function tokenize(t){
  return (t||"").toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/)
    .filter(w => w && !STOP_WORDS.has(w))
    .map(stem);
}
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
    // `q` is the curated keyword list, `a` is prose written for a reader.
    // Counting them equally let stray words in a long answer outrank an
    // entry's own keywords, so weight q more heavily.
    const docs = KB.map(x => tokenize(((x.q||'') + ' ').repeat(3) + (x.a||'')));
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

// A keyword whitelist used to decide this, and it turned away plenty of
// questions the bot can answer -- "free up disk space", "laptop too hot" and
// "how do i back up my files" contain no listed word and were refused
// outright. Let the knowledge base decide instead: search it, and only
// apologise when nothing in it is a real match.
let topic = null;
if (isPhoto) topic = "photo";
else if (isTech || /\bit\b/.test(ql)) topic = "it";

// --- “News” shortcut: show latest 3 ---
if (wantsNews) {
  const newsTopic = topic || "it";
  const items = KB.filter(it => !it.topic || it.topic === newsTopic);
  items.sort((a,b) => new Date(b.date || 0) - new Date(a.date || 0));
  const picks = items.slice(0, 3);
  if (picks.length === 0) return "No recent updates yet — check back later!";
  return picks.map(it => {
    const date = it.date ? `<br><small>${new Date(it.date).toDateString()}</small>` : "";
    return `<div class='card'><b>${it.title || 'Update'}</b>${date}<br>${it.a}</div>`;
  }).join("");
}


  const idxs = [];
  KB.forEach((item,i)=>{ if(!topic || !item.topic || item.topic === topic) idxs.push(i); });

  // query vector
  const m=new Map(); tokenize(q).forEach(w=>m.set(w,(m.get(w)||0)+1));
  const vq = new Map(); for(const [w,f] of m) vq.set(w, f*(pre.idf.get(w)||0));

  // score subset
  // A how-to question deserves the written guide, not whatever headline
  // happens to share a word with it. Explicit news requests took the
  // shortcut above and never reach this.
  const scored = idxs.map(i=>({
                       i,
                       s: cosine(vq, pre.vecs[i]) * (KB[i].manual ? 1.25 : 1)
                     }))
                     .sort((a,b)=>b.s-a.s);

  const picks = scored.filter(x=>x.s>=0.02).slice(0,3);
  if(picks.length===0){
    return "Hmm 🤔 nothing in my notes covers that. I know photography 📸 and IT/tech 💻 — try “best shutter speed for sports”, “fix high CPU on Windows”, or “latest camera news”.";
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

// Tiny client-side RAG bot: TF‑IDF + cosine over a small KB.
const chat = document.getElementById('chat');
const form = document.getElementById('chatForm');
const input = document.getElementById('userInput');

function addMsg(role, html){
  const row = document.createElement('div');
  row.className = 'msg ' + role;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = html;
  row.appendChild(bubble);
  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;
}

addMsg('bot', `<b>H3samBot</b> ready. Ask me about camera settings, lighting, lenses, networking, Windows/Linux tips, and more.<br><small class="hint">Try: “best shutter for sports” or “fix high CPU on Windows”.</small>`);

let KB = [];
async function loadKB(){
  const res = await fetch('data/knowledge.json');
  KB = await res.json();
}
function tokenize(t){
  return t.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(Boolean);
}
function tfidfVectors(docs){
  const vocab = new Map();
  const tfs = docs.map(tokens=>{
    const m = new Map();
    tokens.forEach(w=> m.set(w,(m.get(w)||0)+1));
    for(const w of m.keys()){ if(!vocab.has(w)) vocab.set(w,0); }
    return m;
  });
  for(const m of tfs){ for(const w of m.keys()) vocab.set(w, vocab.get(w)+1); }
  const N = docs.length, idf = new Map();
  for(const [w,df] of vocab) idf.set(w, Math.log(1 + N/(df)));
  const vecs = tfs.map(m=>{
    const v = new Map();
    for(const [w,f] of m) v.set(w, f * idf.get(w));
    return v;
  });
  return {vecs, idf};
}
function cosine(a,b){
  let dot=0, na=0, nb=0;
  for(const [w,va] of a){ na += va*va; const vb = b.get(w); if(vb) dot += va*vb; }
  for(const [,vb] of b){ nb += vb*vb; }
  return dot / (Math.sqrt(na)*Math.sqrt(nb) || 1);
}
let pre = null;
async function ensureIndex(){
  if (pre) return;
  const docs = KB.map(x => tokenize((x.q||'') + ' ' + (x.a||'')));
  pre = tfidfVectors(docs);
}
function vecFromText(t, pre){
  const toks = tokenize(t);
  const m = new Map();
  toks.forEach(w=> m.set(w,(m.get(w)||0)+1));
  const v = new Map();
  for(const [w,f] of m){
    const idf = pre.idf.get(w) || 0;
    v.set(w, f * idf);
  }
  return v;
}
async function answer(q) {
  await ensureReady();

  // --- Greeting check FIRST ---
  const greetingPattern = /^\s*(hi|hello|hey|good\s*(morning|evening)|greetings|yo|sup)\s*$/i;
  if (greetingPattern.test(q)) {
    return "Hey there 👋 I'm H3samBot — your Photo & Tech assistant! Ask me about photography tips, lighting setups, camera settings, or tech fixes for Windows and Linux.";
  }

  // --- Build query vector ---
  const vq = (function vecFromText(t) {
    const toks = tokenize(t);
    const m = new Map();
    toks.forEach(w => m.set(w, (m.get(w) || 0) + 1));
    const v = new Map();
    for (const [w, f] of m) {
      const idf = pre.idf.get(w) || 0;
      v.set(w, f * idf);
    }
    return v;
  })(q);

  // --- Find best match ---
  let best = { i: -1, score: 0 };
  pre.vecs.forEach((vd, i) => {
    const s = cosine(vq, vd);
    if (s > best.score) best = { i, score: s };
  });

  // --- Lower match threshold ---
  if (best.i === -1 || best.score < 0.01) {
    return "I’m not sure yet 🤔 Try asking me something like 'best camera settings for portraits' or 'how to fix Wi-Fi on Windows'.";
  }

  const item = KB[best.i];
  return `<b>${item.title || 'Tip'}</b><br>${item.a}`;
}

loadKB();

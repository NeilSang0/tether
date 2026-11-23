// The phone app and the locked page. One file, no build step, no CDN.
export const LOCKED_HTML = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow"><title>Locked</title>
<link rel="icon" href="/icon.png"><link rel="apple-touch-icon" href="/icon.png">
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;
  background:#101a20;color:#e7eef2;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
form{width:100%;max-width:340px;text-align:center}
img{width:72px;height:72px;border-radius:18px}
h1{font-size:19px;font-weight:600;margin:20px 0 6px}
p{color:#8aa0ab;font-size:14px;margin:0 0 20px}
input{width:100%;padding:13px 14px;border-radius:12px;border:1px solid #283a44;
  background:#0a1216;color:#e7eef2;font-size:16px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
input:focus{outline:2px solid #f5b450;outline-offset:1px;border-color:#f5b450}
button{width:100%;margin-top:12px;padding:13px;border:0;border-radius:12px;
  background:#f5b450;color:#101a20;font-size:16px;font-weight:600}
.err{color:#f08a7a;font-size:14px;margin-top:14px}
</style></head><body>
<form method="post" action="/login">
<img src="/icon.png" alt="">
<h1>Locked</h1>
<p>Paste the key printed by <code>tether deploy</code>.</p>
<input name="k" type="password" autocomplete="current-password" autocapitalize="off"
  autocorrect="off" spellcheck="false" placeholder="key" required>
<button type="submit">Unlock</button>
<div class="err">{{msg}}</div>
</form></body></html>`;

export const APP_HTML = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow"><title>{{name}}</title>
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#101a20">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon.png"><link rel="apple-touch-icon" href="/icon.png">
<style>
:root{--bg:#101a20;--card:#17242b;--line:#25353e;--ink:#e7eef2;--dim:#8aa0ab;--amber:#f5b450;--red:#f08a7a;--green:#7ad4a0}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;background:var(--bg);color:var(--ink);
  font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
  padding:max(14px,env(safe-area-inset-top)) 14px calc(132px + env(safe-area-inset-bottom))}
header{display:flex;align-items:center;gap:10px;margin:2px 0 16px}
header img{width:30px;height:30px;border-radius:8px}
header h1{font-size:17px;font-weight:600;margin:0;flex:1;letter-spacing:.2px}
header a{color:var(--dim);font-size:13px;text-decoration:none}
.dot{width:8px;height:8px;border-radius:50%;background:var(--dim);flex:none}
.dot.on{background:var(--green)}.dot.off{background:var(--red)}
#hbtxt{font-size:12px;color:var(--dim);margin:-10px 0 16px;padding-left:2px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:13px 14px;margin-bottom:10px}
.q{font-weight:600;font-size:15px;margin:0 0 2px;white-space:pre-wrap;overflow-wrap:anywhere}
.meta{font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.6px;margin:0 0 8px}
.a{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:15px}
.a code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;
  background:#0a1216;padding:1px 5px;border-radius:5px;overflow-wrap:anywhere}
.a pre{background:#0a1216;border:1px solid var(--line);border-radius:10px;
  padding:10px;overflow-x:auto;font-size:13px;margin:8px 0}
.pend{color:var(--amber)}.fail{color:var(--red)}
.empty{color:var(--dim);text-align:center;padding:48px 20px;font-size:15px}
.bar{position:fixed;left:0;right:0;bottom:0;background:var(--bg);
  border-top:1px solid var(--line);padding:10px 14px calc(10px + env(safe-area-inset-bottom))}
.row{display:flex;gap:8px;align-items:flex-end}
textarea{flex:1;min-height:46px;max-height:140px;padding:12px 13px;border-radius:12px;
  border:1px solid var(--line);background:var(--card);color:var(--ink);
  font:16px/1.4 inherit;resize:none}
textarea:focus{outline:2px solid var(--amber);outline-offset:1px;border-color:var(--amber)}
button{border:0;border-radius:12px;font-size:16px;font-weight:600;flex:none}
#send{padding:0 18px;height:46px;background:var(--amber);color:var(--bg)}
#send:disabled{opacity:.4}
#mic{width:46px;height:46px;background:var(--card);border:1px solid var(--line);
  color:var(--ink);font-size:19px}
#mic.rec{background:var(--red);color:#fff;border-color:var(--red)}
#mic[hidden]{display:none}
select{width:100%;margin-top:8px;padding:9px 11px;border-radius:10px;border:1px solid var(--line);
  background:var(--card);color:var(--dim);font-size:13px}
select[hidden]{display:none}
.x{float:right;background:none;border:0;color:var(--dim);font-size:19px;padding:0 0 6px 10px;line-height:1}
@media (prefers-reduced-motion:no-preference){.card{transition:opacity .15s}}
</style></head><body>
<header>
  <img src="/icon.png" alt="">
  <h1>{{name}}</h1>
  <span class="dot" id="dot"></span>
  <a href="/logout">Sign out</a>
</header>
<div id="hbtxt">Checking the machine...</div>
<main id="list"><div class="empty">Loading.</div></main>

<div class="bar">
  <div class="row">
    <button id="mic" type="button" aria-label="Dictate" hidden>&#127908;</button>
    <textarea id="t" rows="1" placeholder="Ask your machine" autocapitalize="sentences"></textarea>
    <button id="send" type="button">Ask</button>
  </div>
  <select id="proj" hidden aria-label="Project"></select>
</div>

<script>
var L=document.getElementById('list'),T=document.getElementById('t'),S=document.getElementById('send'),
    D=document.getElementById('dot'),HB=document.getElementById('hbtxt'),M=document.getElementById('mic'),
    P=document.getElementById('proj'),timer=null,seen='';

function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}

// Minimal, safe rendering: escape first, then re-introduce code spans, fenced
// blocks and bold. Nothing here can inject markup, because esc() ran first.
function fmt(s){
  var h=esc(s);
  h=h.replace(/\`\`\`[a-z]*\\n([\\s\\S]*?)\`\`\`/g,function(m,b){return '<pre>'+b+'</pre>';});
  h=h.replace(/\`([^\`\\n]+)\`/g,'<code>$1</code>');
  h=h.replace(/\\*\\*([^*\\n]+)\\*\\*/g,'<strong>$1</strong>');
  return h;
}
function ago(ms){
  var s=Math.round(ms/1000);
  if(s<60)return s+'s ago';
  if(s<3600)return Math.round(s/60)+'m ago';
  if(s<86400)return Math.round(s/3600)+'h ago';
  return Math.round(s/86400)+'d ago';
}
function draw(d){
  var now=d.now, out='', a=d.asks||[];
  if(!a.length){L.innerHTML='<div class="empty">Nothing yet.<br>Ask your machine something.</div>';seen='';return;}
  for(var i=0;i<a.length;i++){
    var k=a[i], cls=k.status==='failed'?'fail':'pend';
    var state=k.status==='done'?ago(now-(k.doneAt||k.at)):
              k.status==='doing'?'working...':
              k.status==='failed'?'failed':'queued';
    out+='<div class="card">'+
      '<button class="x" data-id="'+esc(k.id)+'" aria-label="Delete">&times;</button>'+
      '<p class="q">'+esc(k.text)+'</p>'+
      '<p class="meta">'+(k.project?esc(k.project)+' &middot; ':'')+esc(state)+'</p>'+
      (k.answer?'<p class="a">'+fmt(k.answer)+'</p>'
               :'<p class="a '+cls+'">'+(k.status==='failed'?'No answer came back.':'Waiting for the machine.')+'</p>')+
      '</div>';
  }
  if(out!==seen){L.innerHTML=out;seen=out;}
  var pend=a.some(function(k){return k.status==='queued'||k.status==='doing';});
  clearTimeout(timer);timer=setTimeout(load,pend?4000:20000);
}
function heart(d){
  var age=d.now-d.hb;
  if(!d.hb){D.className='dot off';HB.textContent='The machine has never checked in. Is the listener running?';return;}
  var ok=age<11*60*1000;
  D.className='dot '+(ok?'on':'off');
  HB.textContent=ok?'Machine listening, stamped '+ago(age)+'.'
                   :'Machine last stamped '+ago(age)+'. It may be asleep.';
}
function load(){
  fetch('/api/state',{headers:{'cache-control':'no-cache'}})
    .then(function(r){if(r.status===401){location.href='/login';return null;}return r.json();})
    .then(function(d){
      if(!d)return;
      heart(d);draw(d);
      if(d.projects&&d.projects.length>1&&P.hidden){
        P.hidden=false;
        P.innerHTML=d.projects.map(function(p){return '<option>'+esc(p)+'</option>';}).join('');
      }
    })
    .catch(function(){clearTimeout(timer);timer=setTimeout(load,8000);});
}
function send(){
  var v=T.value.trim();if(!v)return;
  S.disabled=true;
  fetch('/api/ask',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({text:v,project:P.hidden?null:P.value})})
    .then(function(r){return r.json();})
    .then(function(){T.value='';T.style.height='auto';load();})
    .catch(function(){alert('Could not send that. Check your connection.');})
    .then(function(){S.disabled=false;});
}
S.addEventListener('click',send);
T.addEventListener('input',function(){T.style.height='auto';T.style.height=Math.min(T.scrollHeight,140)+'px';});
T.addEventListener('keydown',function(e){if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();send();}});
L.addEventListener('click',function(e){
  var b=e.target.closest('.x');if(!b)return;
  fetch('/api/ask?id='+encodeURIComponent(b.dataset.id),{method:'DELETE'}).then(load);
});

// Dictation runs in the browser, on the phone. Nothing is uploaded and no
// transcription service is called, so a voice note costs nothing to anyone.
var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
if(SR){
  M.hidden=false;
  var rec=null;
  M.addEventListener('click',function(){
    if(rec){rec.stop();return;}
    rec=new SR();rec.lang=navigator.language||'en-US';rec.interimResults=true;rec.continuous=true;
    var base=T.value?T.value+' ':'';
    rec.onresult=function(e){
      var s='';
      for(var i=e.resultIndex;i<e.results.length;i++)s+=e.results[i][0].transcript;
      T.value=base+s;T.style.height='auto';T.style.height=Math.min(T.scrollHeight,140)+'px';
      if(e.results[e.results.length-1].isFinal)base=T.value+' ';
    };
    rec.onend=function(){rec=null;M.classList.remove('rec');};
    rec.onerror=rec.onend;
    rec.start();M.classList.add('rec');
  });
}
document.addEventListener('visibilitychange',function(){if(!document.hidden)load();});
load();
</script></body></html>`;

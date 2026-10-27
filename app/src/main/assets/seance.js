/* ═══════════════════════════════════════════════════════════════════════
   Callisthénie (version générique) — moteur commun des onglets Programme et Extra
   - affichage des séances (blocs, tours, minuteurs, repos automatique)
   - paramétrage complet dans l'appli (⚙️ Paramétrer la séance)
   - sauvegarde / transfert des réglages en texte
   La page définit PAGE = {key, days:[{tab,sub}], defaults:[séances], widget:bool}
   puis appelle initSeances().
   Format d'une séance :
   {id, letter, col, day, time, dur, name, desc, conseil,
    warmup:[{n,d,b}],
    blocs:[{titre, type:'rounds'|'linear', maxRounds, restSec, autoRest,
            exos:[{name, reps, hold, kg, rest, note, steps:[], tip, erreur}]}]}
   ═══════════════════════════════════════════════════════════════════════ */

var COLORS={
  A:{bg:'#5C6BC0',light:'#eef0fb',badge:'#5C6BC0',grad:'linear-gradient(135deg,#5C6BC0,#7986CB)',nom:'Indigo'},
  B:{bg:'#26A69A',light:'#e8f6f5',badge:'#26A69A',grad:'linear-gradient(135deg,#26A69A,#4DB6AC)',nom:'Turquoise'},
  C:{bg:'#7E57C2',light:'#f3f0fb',badge:'#7E57C2',grad:'linear-gradient(135deg,#7E57C2,#9575CD)',nom:'Violet'},
  D:{bg:'#EF5350',light:'#fef0f0',badge:'#EF5350',grad:'linear-gradient(135deg,#EF5350,#E57373)',nom:'Rouge'},
  E:{bg:'#FF7043',light:'#fff0ec',badge:'#E64A19',grad:'linear-gradient(135deg,#FF7043,#FF8A65)',nom:'Orange'},
  F:{bg:'#F9A825',light:'#fffbec',badge:'#F57F17',grad:'linear-gradient(135deg,#FDD835,#F9A825)',nom:'Jaune'},
  REC:{bg:'#66BB6A',light:'#edf7ee',badge:'#43A047',grad:'linear-gradient(135deg,#66BB6A,#81C784)',nom:'Vert'},
  G:{bg:'#29B6F6',light:'#e6f6fe',badge:'#0288D1',grad:'linear-gradient(135deg,#29B6F6,#4FC3F7)',nom:'Bleu ciel'},
  H:{bg:'#EC407A',light:'#fdeaf1',badge:'#D81B60',grad:'linear-gradient(135deg,#EC407A,#F06292)',nom:'Rose'},
  I:{bg:'#78909C',light:'#eef2f4',badge:'#546E7A',grad:'linear-gradient(135deg,#78909C,#90A4AE)',nom:'Gris'}
};

var PAGE=null,DAYS=[],SESSIONS=[],SESSION_IDX=[];
var currentTab=0,doneExos={},timerInterval=null,timerTotal=0,timerLeft=0;

/* ───────── Utilitaires ───────── */
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function escBr(s){return esc(s).replace(/\n/g,'<br>');}
function clone(o){return JSON.parse(JSON.stringify(o));}
function num(v,def){var n=parseFloat(String(v==null?'':v).replace(',','.'));return isNaN(n)?def:n;}
function int(v,def){var n=parseInt(v,10);return isNaN(n)?def:n;}

/* Réglages persistants : préférences Android (survivent aux mises à jour) + copie navigateur */
function prefGet(k){
  var v=null;
  try{if(window.App&&App.getPref)v=App.getPref(k);}catch(e){}
  if(v==null){try{v=localStorage.getItem(k);}catch(e){}}
  return v;
}
function prefSet(k,v){
  try{if(window.App&&App.setPref)App.setPref(k,v);}catch(e){}
  try{if(v==null)localStorage.removeItem(k);else localStorage.setItem(k,v);}catch(e){}
}

/* ───────── Normalisation (anciens formats, champs manquants) ───────── */
function stripPrefix(s,re){return String(s||'').replace(re,'').trim();}
function normExo(x){
  x=x||{};
  return {
    name:String(x.name||'Nouvel exercice'),
    reps:String(x.reps==null?'':x.reps),
    hold:Math.max(0,int(x.hold,0)),
    kg:String(x.kg||''),
    rest:Math.max(0,int(x.rest,0)),
    note:String(x.note||''),
    steps:(Array.isArray(x.steps)?x.steps:[]).map(String).filter(function(s){return s.trim();}),
    tip:stripPrefix(x.tip,/^💡\s*/),
    erreur:stripPrefix(x.erreur,/^⚠️?\s*/)
  };
}
function normBloc(b){
  b=b||{};
  return {
    titre:String(b.titre||''),
    type:b.type==='linear'?'linear':'rounds',
    maxRounds:Math.max(1,Math.min(10,int(b.maxRounds,3))),
    restSec:Math.max(0,int(b.restSec,90)),
    autoRest:!!b.autoRest,
    exos:(Array.isArray(b.exos)?b.exos:[]).map(normExo)
  };
}
function normSession(s,i){
  s=s||{};
  var blocs=(Array.isArray(s.blocs)&&s.blocs.length)?s.blocs.map(normBloc)
    :[normBloc({titre:'',type:'rounds',maxRounds:s.tours||3,restSec:s.restSec||90,autoRest:s.autoRest,exos:s.exos||[]})];
  return {
    id:String(s.id||('S'+i)),
    letter:String(s.letter||'★'),
    col:COLORS[s.col]?s.col:'A',
    day:String(s.day||''),
    time:String(s.time||''),
    dur:String(s.dur||''),
    name:String(s.name||'Séance'),
    desc:String(s.desc||''),
    conseil:String(s.conseil||''),
    warmup:(Array.isArray(s.warmup)?s.warmup:[]).map(function(w){return {n:String(w.n||''),d:String(w.d||''),b:String(w.b||'')};}),
    blocs:blocs
  };
}
function cfgKey(){return 'cfg_'+PAGE.key;}
function loadSessions(){
  var defs=PAGE.defaults.map(normSession),raw=prefGet(cfgKey());
  if(raw){
    try{
      var a=JSON.parse(raw);
      if(Array.isArray(a)&&a.length===defs.length)return a.map(normSession);
    }catch(e){}
  }
  return defs;
}
function saveSessions(){
  prefSet(cfgKey(),JSON.stringify(SESSIONS));
  syncWidget();
}

/* Widget écran d'accueil (onglet Programme) : 7 entrées, index 0 = dimanche */
function syncWidget(){
  if(!PAGE.widget)return;
  try{
    var w=[];
    for(var js=0;js<7;js++){
      var s=SESSIONS[SESSION_IDX[(js+6)%7]];
      w.push({n:s.name,h:[s.time,s.dur].filter(Boolean).join(' · ')||s.desc.slice(0,40),e:s.letter,c:(COLORS[s.col]||COLORS.A).bg});
    }
    var j=JSON.stringify(w);
    if(prefGet('widget_json')!==j){prefSet('widget_json',j);if(window.App&&App.updateWidget)App.updateWidget();}
  }catch(e){}
}

/* ───────── Son, horloge, navigation ───────── */
var audioCtx=null;
function getAudioCtx(){
  if(!audioCtx){try{audioCtx=new (window.AudioContext||window.webkitAudioContext)();}catch(e){}}
  if(audioCtx&&audioCtx.state==='suspended'){try{audioCtx.resume();}catch(e){}}
  return audioCtx;
}
function beep(freq,duration,vol){
  var ctx=getAudioCtx();if(!ctx)return;
  try{
    var osc=ctx.createOscillator(),gain=ctx.createGain();
    osc.type='sine';osc.frequency.value=freq;
    gain.gain.setValueAtTime(vol||0.25,ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+duration);
    osc.connect(gain);gain.connect(ctx.destination);
    osc.start();osc.stop(ctx.currentTime+duration);
  }catch(e){}
}
function updateClock(){
  var now=new Date(),jours=['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
  var el=document.getElementById('header-time'),el2=document.getElementById('header-date');
  if(el)el.textContent=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
  if(el2)el2.textContent=jours[now.getDay()]+' '+now.getDate()+'/'+String(now.getMonth()+1).padStart(2,'0');
}
function navTo(page){
  var pages={programme:'programme.html',respiration:'respiration.html',poids:'poids.html',extra:'seance_extra.html',seance_extra:'seance_extra.html',sante:'sante.html'};
  if(pages[page])window.location.href='file:///android_asset/'+pages[page];
}

/* ───────── Onglets ───────── */
function buildTabs(){
  var bar=document.getElementById('tabs');bar.innerHTML='';
  DAYS.forEach(function(d,i){
    var s=SESSIONS[SESSION_IDX[i]];
    var el=document.createElement('div');
    el.className='tab'+(i===currentTab?' active':'');
    el.innerHTML=esc(d.tab)+'<span class="tab-sub">'+esc(d.sub||s.name)+'</span>';
    el.onclick=(function(idx){return function(){showTab(idx);};})(i);
    bar.appendChild(el);
  });
  updateTabColors(currentTab);
}
function updateTabColors(activeIdx){
  document.querySelectorAll('.tab').forEach(function(t,i){
    var C=COLORS[SESSIONS[SESSION_IDX[i]].col]||COLORS.A;
    if(i===activeIdx){t.style.color=C.bg;t.style.borderBottomColor=C.bg;}
    else{t.style.color='';t.style.borderBottomColor='transparent';}
  });
}
function showTab(i){
  currentTab=i;
  document.querySelectorAll('.tab').forEach(function(t,j){t.classList.toggle('active',j===i);});
  updateTabColors(i);
  renderSession(SESSIONS[SESSION_IDX[i]]);
  document.getElementById('content').scrollTop=0;
}

/* ───────── Rendu d'une séance ───────── */
function blocLabel(b){return b.type==='rounds'?b.maxRounds+' tour'+(b.maxRounds>1?'s':'')+' · repos '+b.restSec+' s en fin de tour':'1 passage';}
function toursLabel(s){
  if(s.blocs.length===1)return s.blocs[0].type==='rounds'?s.blocs[0].maxRounds+' tour'+(s.blocs[0].maxRounds>1?'s':''):'1 passage';
  return s.blocs.map(function(b){return (b.titre||'Bloc')+(b.type==='rounds'?' '+b.maxRounds+' tours':'');}).join(' + ');
}
function roundKey(s,b){return s.id+(b?'_'+b:'');}

function makeCard(ex,i,s,dk,C,displayNum,endRest){
  var done=dk[i];
  var n=displayNum!==undefined?displayNum:i;
  return '<div class="exo-card'+(done?' done':'')+'" id="card-'+s.id+'-'+i+'" onclick="toggleCard(\''+s.id+'\','+i+')">'
    +'<div class="exo-card-header">'
    +'<div class="exo-num'+(done?' is-done':'')+'" style="background:'+(done?'linear-gradient(135deg,#4ECDC4,#95E1D3)':C.light)+';color:'+(done?'#fff':C.badge)+'">'+(done?'&#x2713;':(n+1))+'</div>'
    +'<div class="exo-info"><div class="exo-name">'+esc(ex.name)+'</div>'
    +'<div class="badge-row">'
    +(ex.reps?'<span class="badge" style="background:'+C.bg+';color:#fff">'+esc(ex.reps)+'</span>':'')
    +(ex.kg?'<span class="badge badge-kg">&#x1F3CB; '+esc(ex.kg)+'</span>':'')
    +(ex.hold>0?'<span class="badge" style="background:#4ECDC4;color:#0f0f13">&#x23F1; '+ex.hold+'s</span>':'')
    +(ex.note?'<span class="badge" style="background:#FF7043;color:#fff">'+esc(ex.note)+'</span>':'')
    +'</div></div>'
    +'<span class="exo-chevron">&#x2304;</span></div>'
    +'<div class="exo-detail"><div class="exo-body">'
    +(ex.steps.length?'<div class="steps-title" style="color:'+C.bg+'">&#x1F4CB; Technique</div>'
      +ex.steps.map(function(st,k){return '<div class="step"><div class="step-num" style="background:'+C.bg+'">'+(k+1)+'</div><div class="step-txt">'+esc(st)+'</div></div>';}).join(''):'')
    +(ex.tip?'<div class="tip-box">💡 '+escBr(ex.tip)+'</div>':'')
    +(ex.erreur?'<div class="err-box">⚠ '+escBr(ex.erreur)+'</div>':'')
    +'<div class="btn-row">'
    +(ex.hold>0?'<button class="btn-timer btn-hold" onclick="event.stopPropagation();startTimer('+ex.hold+',\'&#x1F3CB; Exercice\')">&#x1F3CB; Exercice '+ex.hold+'s</button>':'')
    +(ex.rest>0?'<button class="btn-timer btn-rest" onclick="event.stopPropagation();startTimer('+ex.rest+',\'&#x23F1; Repos\')">&#x23F1; Repos '+ex.rest+'s</button>':'')
    +(endRest>0?'<button class="btn-timer btn-rest" onclick="event.stopPropagation();startTimer('+endRest+',\'&#x23F1; Repos fin de tour\')">&#x23F1; Fin de tour · repos '+endRest+'s</button>':'')
    +'</div>'
    +'<button class="btn-done'+(done?' is-done':'')+'" onclick="event.stopPropagation();markDone(\''+s.id+'\','+i+')">'+(done?'&#x21A9; Marquer non fait':'&#x2713; Exercice termin&#233;')+'</button>'
    +'</div></div></div>';
}

function renderSession(s){
  var C=COLORS[s.col]||COLORS.A;
  var dk=doneExos[s.id]||{};
  var html='';

  html+='<div class="session-header">'
    +'<div class="session-badge" style="background:'+C.grad+'">'
    +'<span class="s-icon">'+esc(s.letter)+'</span>'
    +'<span class="s-lbl">'+esc(s.day)+'</span>'
    +'</div>'
    +'<div><div class="session-title">'+esc(s.name)+'</div>'
    +'<div class="session-meta">'+((s.time||s.day)?'<span class="session-tag" style="background:'+C.light+';color:'+C.badge+'">'+esc(s.time||s.day)+'</span>':'')+esc(s.desc)+'</div>'
    +'<div class="session-tours" style="color:'+C.bg+'">&#x1F501; '+esc(toursLabel(s))+(s.dur?' · &#x23F1; '+esc(s.dur):'')+'</div>'
    +'</div></div>';

  html+='<button class="cfg-btn" style="border-color:'+C.bg+'66;color:'+C.bg+'" onclick="edOpen()">⚙️ Paramétrer la séance</button>';

  if(s.warmup.length){
    html+='<div class="warm-section"><div class="warm-title">🔥 Échauffement</div>'
      +s.warmup.map(function(w){
        return '<div class="warm-item"><div class="warm-item-txt">'+esc(w.n)+(w.d?'<div class="warm-item-sub">'+esc(w.d)+'</div>':'')+'</div>'
          +(w.b?'<span class="warm-badge" style="background:'+C.bg+'">'+esc(w.b)+'</span>':'')+'</div>';
      }).join('')+'</div>';
  }

  html+='<div class="exo-list">';
  var single=s.blocs.length===1&&!s.blocs[0].titre;
  s.blocs.forEach(function(bloc,b){
    if(!single){
      html+='<div class="bloc-titre" style="background:rgba(255,255,255,.06);color:'+C.badge+'">'+esc(bloc.titre||('Bloc '+(b+1)))
        +'<div class="bloc-sous">'+esc(blocLabel(bloc))+'</div>'
        +(bloc.autoRest?'<div class="bloc-auto">⏱ Repos automatique quand un exercice est terminé</div>':'')+'</div>';
    }else if(bloc.autoRest){
      html+='<div class="bloc-auto" style="margin:6px 4px">⏱ Repos automatique quand un exercice est terminé</div>';
    }
    if(bloc.type==='rounds'){
      var rk=roundKey(s,b),curRound=doneExos['__round_'+rk]||1;
      html+='<div class="round-bar">'
        +'<span class="round-lbl">Tour</span>'
        +Array.from({length:bloc.maxRounds},function(_,k){return k+1;}).map(function(r){
          return '<button class="round-btn'+(curRound===r?' active':'')+'" '
            +'style="'+(curRound===r?'background:'+C.bg+';color:#fff;border-color:'+C.bg:'background:transparent;color:'+C.badge+';border-color:'+C.badge)+'" '
            +'onclick="setRound(\''+rk+'\','+r+')">'+r+'</button>';
        }).join('')
        +(bloc.restSec>0?'<button class="round-rest-btn" style="background:'+C.grad+'" onclick="startTimer('+bloc.restSec+',\'&#x23F1; Repos entre les tours\')">&#x23F1; Repos '+bloc.restSec+'s</button>':'')
        +'</div>';
    }
    if(!bloc.exos.length)html+='<div class="empty-bloc">Aucun exercice — touche ⚙️ Paramétrer la séance pour en ajouter.</div>';
    var offset=b*100;
    bloc.exos.forEach(function(ex,i){
      var last=bloc.type==='rounds'&&i===bloc.exos.length-1;
      html+=makeCard(ex,offset+i,s,dk,C,i,last&&!bloc.autoRest?bloc.restSec:0);
    });
  });
  html+='</div>';

  if(s.conseil){
    html+='<div class="conseil" style="background:rgba(255,255,255,.06);border-color:'+C.bg+'55">'
      +'<div class="conseil-title" style="color:'+C.bg+'">&#x1F4A1; Conseil</div>'+escBr(s.conseil)+'</div>';
  }else html+='<div style="height:80px"></div>';

  document.getElementById('content').innerHTML=html;
}

function rerender(){
  var c=document.getElementById('content'),sc=c.scrollTop;
  renderSession(SESSIONS[SESSION_IDX[currentTab]]);
  c.scrollTop=sc;
}
function setRound(rk,r){doneExos['__round_'+rk]=r;rerender();}
function toggleCard(sid,i){
  var card=document.getElementById('card-'+sid+'-'+i);
  var isOpen=card.classList.contains('open');
  document.querySelectorAll('.exo-card.open').forEach(function(c){c.classList.remove('open');});
  if(!isOpen)card.classList.add('open');
}
function markDone(sid,i){
  if(!doneExos[sid])doneExos[sid]={};
  var wasDone=!!doneExos[sid][i];
  if(wasDone)delete doneExos[sid][i];else doneExos[sid][i]=true;
  /* Repos automatique : repos de l'exercice, puis repos de fin de tour → tour suivant */
  var S=SESSIONS[SESSION_IDX[currentTab]],b=Math.floor(i/100),bloc=S.blocs[b];
  if(!wasDone&&bloc&&bloc.autoRest){
    var ex=bloc.exos[i%100],rk=roundKey(S,b),cur=doneExos['__round_'+rk]||1,maxR=bloc.type==='rounds'?bloc.maxRounds:1;
    var all=bloc.exos.every(function(_,k){return doneExos[sid][b*100+k];});
    if(all){
      if(cur<maxR){
        bloc.exos.forEach(function(_,k){delete doneExos[sid][b*100+k];});
        doneExos['__round_'+rk]=cur+1;
        if(bloc.restSec>0)startTimer(bloc.restSec,'⏱ Fin du tour '+cur+'/'+maxR+' — repos avant le tour '+(cur+1));
      }else{
        startTimer(5,'🎉 '+(bloc.titre||'Séance')+' terminé'+(bloc.titre?'':'e')+' !');
      }
    }else if(ex.rest>0){
      var nxt=bloc.exos.filter(function(_,k){return !doneExos[sid][b*100+k];})[0];
      startTimer(ex.rest,'⏱ Repos'+(maxR>1?' · tour '+cur+'/'+maxR:'')+(nxt?' — ensuite : '+nxt.name:''));
    }
  }
  rerender();
  var card=document.getElementById('card-'+sid+'-'+i);
  if(card)card.classList.add('open');
}

/* ───────── Minuteur ───────── */
var wakeLock=null;
function requestWakeLock(){try{if('wakeLock' in navigator){navigator.wakeLock.request('screen').then(function(w){wakeLock=w;}).catch(function(){});}}catch(e){}}
function releaseWakeLock(){try{if(wakeLock){wakeLock.release();wakeLock=null;}}catch(e){}}
function startTimer(sec,label){
  timerTotal=sec;timerLeft=sec;
  document.getElementById('timer-label').textContent=label||'Repos';
  document.getElementById('timer-overlay').classList.add('show');
  getAudioCtx();updateTimer();requestWakeLock();
  clearInterval(timerInterval);
  timerInterval=setInterval(function(){
    timerLeft--;updateTimer();
    if(timerLeft<=0){clearInterval(timerInterval);releaseWakeLock();beep(880,0.5,0.4);setTimeout(stopTimer,900);}
    else beep(660,0.12,0.2);
  },1000);
}
function adjustTimer(delta){timerLeft=Math.max(1,timerLeft+delta);timerTotal=Math.max(timerTotal,timerLeft);updateTimer();}
function updateTimer(){
  var fg=document.getElementById('ring-fg');
  fg.style.strokeDashoffset=534*(1-timerLeft/timerTotal);
  fg.style.stroke=timerLeft<=5?'#EF5350':timerLeft<=10?'#F9A825':'#5C6BC0';
  var n=document.getElementById('timer-num');if(n)n.textContent=timerLeft;
}
function stopTimer(){clearInterval(timerInterval);releaseWakeLock();document.getElementById('timer-overlay').classList.remove('show');}

/* ═══════════════════════════════════════════════════════════════════════
   ÉDITEUR DE SÉANCE
   ═══════════════════════════════════════════════════════════════════════ */
var ED=null,ED_VIEW='session',ED_EXO=null;

var ED_CSS=''
+'#ed{display:none;position:fixed;inset:0;z-index:200;background:var(--bg);flex-direction:column;max-width:430px;margin:0 auto}'
+'#ed.show{display:flex}'
+'#ed-hd{display:flex;align-items:center;gap:10px;padding:12px 14px;background:#1a1a22;border-bottom:1px solid var(--border);flex-shrink:0}'
+'#ed-hd .t{flex:1;font-size:16px;font-weight:800;color:var(--txt);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
+'#ed-hd button{background:none;border:none;color:var(--txt2);font-size:22px;padding:2px 6px;cursor:pointer}'
+'#ed-body{flex:1;overflow-y:auto;padding:12px 14px 20px;-webkit-overflow-scrolling:touch}'
+'#ed-ft{display:flex;gap:8px;padding:10px 14px 14px;background:#1a1a22;border-top:1px solid var(--border);flex-shrink:0}'
+'.ed-sec{font-size:11px;font-weight:800;color:var(--txt3);text-transform:uppercase;letter-spacing:.8px;margin:18px 2px 8px}'
+'.ed-sec:first-child{margin-top:4px}'
+'.ed-card{background:#1a1a22;border:1px solid var(--border);border-radius:14px;padding:12px;margin-bottom:10px}'
+'.ed-f{margin-bottom:10px}.ed-f:last-child{margin-bottom:0}'
+'.ed-f label{display:block;font-size:11px;font-weight:700;color:var(--txt3);margin-bottom:4px}'
+'.ed-f input,.ed-f textarea,.ed-f select{width:100%;background:#0f0f13;border:1px solid var(--border);border-radius:10px;color:var(--txt);font-size:15px;padding:9px 10px;font-family:inherit;-webkit-appearance:none}'
+'.ed-f textarea{min-height:70px;resize:vertical;line-height:1.45}'
+'.ed-f input:focus,.ed-f textarea:focus,.ed-f select:focus{outline:none;border-color:#5C6BC0}'
+'.ed-f .hint{font-size:11px;color:var(--txt3);margin-top:3px}'
+'.ed-row{display:flex;gap:8px}.ed-row>.ed-f{flex:1;min-width:0}'
+'.ed-chk{display:flex;align-items:center;gap:8px;font-size:14px;color:var(--txt);padding:4px 0}'
+'.ed-chk input{width:20px;height:20px;accent-color:#5C6BC0}'
+'.ed-item{display:flex;align-items:center;gap:8px;background:#0f0f13;border:1px solid var(--border);border-radius:11px;padding:8px 8px 8px 11px;margin-bottom:6px}'
+'.ed-item .nm{flex:1;min-width:0;font-size:14px;font-weight:700;color:var(--txt);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
+'.ed-item .nm small{display:block;font-size:11px;font-weight:500;color:var(--txt3)}'
+'.ed-ic{background:rgba(255,255,255,.06);border:1px solid var(--border);color:var(--txt2);border-radius:8px;min-width:32px;height:32px;font-size:14px;cursor:pointer;padding:0 6px}'
+'.ed-ic:disabled{opacity:.3}'
+'.ed-ic.del{color:#EF5350}'
+'.ed-add{width:100%;background:transparent;border:1.5px dashed var(--border);color:var(--txt2);border-radius:11px;padding:10px;font-size:14px;font-weight:700;cursor:pointer;margin-top:2px}'
+'.ed-btn{flex:1;border:none;border-radius:12px;padding:13px 10px;font-size:15px;font-weight:800;cursor:pointer;-webkit-appearance:none}'
+'.ed-main{background:linear-gradient(135deg,#5C6BC0,#7986CB);color:#fff}'
+'.ed-sec-btn{background:rgba(255,255,255,.07);color:var(--txt2);border:1px solid var(--border)}'
+'.ed-danger{background:transparent;color:#EF5350;border:1px solid #EF535066}'
+'.ed-tools{display:flex;gap:8px;margin-top:14px}.ed-tools .ed-btn{font-size:13px;padding:11px 6px}'
+'.ed-cols{display:flex;flex-wrap:wrap;gap:8px}'
+'.ed-col{width:34px;height:34px;border-radius:50%;border:3px solid transparent;cursor:pointer}'
+'.ed-col.on{border-color:var(--txt)}'
+'.ed-bloc{border-left:4px solid #5C6BC0}'
+'.ed-bloc-hd{display:flex;align-items:center;gap:6px;margin-bottom:10px}'
+'.ed-bloc-hd b{flex:1;font-size:13px;color:var(--txt)}'
+'.ed-note{font-size:12.5px;color:var(--txt2);line-height:1.5;margin-bottom:10px}'
+'#ed-txt{min-height:180px;font-family:monospace;font-size:12px}'
+'.cfg-btn{display:block;width:calc(100% - 24px);margin:10px 12px 2px;background:transparent;border:1.5px dashed;border-radius:12px;padding:9px;font-size:14px;font-weight:700;cursor:pointer;-webkit-appearance:none}'
+'.empty-bloc{font-size:13px;color:var(--txt3);padding:10px 4px 14px;text-align:center}'
+'@media (prefers-color-scheme: light){#ed-hd,#ed-ft,.ed-card{background:#fff}.ed-f input,.ed-f textarea,.ed-f select,.ed-item{background:#f2f2f6}.ed-ic{background:rgba(0,0,0,.04)}}';

function edInjectUI(){
  var st=document.createElement('style');st.textContent=ED_CSS;document.head.appendChild(st);
  var d=document.createElement('div');d.id='ed';
  d.innerHTML='<div id="ed-hd"><button onclick="edBack()" aria-label="Retour">&#x2190;</button><div class="t" id="ed-title"></div><button onclick="edClose()" aria-label="Fermer">&#x2715;</button></div>'
    +'<div id="ed-body"></div><div id="ed-ft"></div>';
  document.body.appendChild(d);
  d.addEventListener('input',edOnInput);
  d.addEventListener('change',edOnInput);
}

/* Liaison des champs : data-p="chemin.dans.ED" data-t="str|int|kg|lines|bool" */
function edResolve(path){
  var parts=path.split('.'),o=ED;
  for(var i=0;i<parts.length-1;i++)o=o[parts[i]];
  return {o:o,k:parts[parts.length-1]};
}
function edOnInput(e){
  var el=e.target,p=el.getAttribute&&el.getAttribute('data-p');if(!p)return;
  var t=el.getAttribute('data-t')||'str',r=edResolve(p),v;
  if(t==='int')v=Math.max(0,int(el.value,0));
  else if(t==='rounds')v=Math.max(1,Math.min(10,int(el.value,1)));
  else if(t==='kg'){var n=num(el.value,0);v=n>0?(String(n).replace('.',','))+' kg':'';}
  else if(t==='lines')v=el.value.split('\n').map(function(x){return x.trim();}).filter(Boolean);
  else if(t==='bool')v=!!el.checked;
  else v=el.value;
  r.o[r.k]=v;
  if(el.getAttribute('data-live'))edLive(el.getAttribute('data-live'));
}
function edLive(what){
  if(what==='title')document.getElementById('ed-title').textContent=ED_VIEW==='exo'?edCurExo().name:'⚙️ '+ED.name;
  if(what==='type'){edRender();}
}
function fIn(label,path,val,opt){
  opt=opt||{};
  var t=opt.t||'str',type=(t==='int'||t==='kg'||t==='rounds')?'number':'text';
  return '<div class="ed-f"><label>'+label+'</label><input type="'+type+'"'+(type==='number'?' inputmode="decimal" min="0" step="'+(t==='kg'?'0.5':'1')+'"':'')
    +' data-p="'+path+'" data-t="'+t+'"'+(opt.live?' data-live="'+opt.live+'"':'')+' value="'+esc(val)+'"'+(opt.ph?' placeholder="'+esc(opt.ph)+'"':'')+'>'
    +(opt.hint?'<div class="hint">'+opt.hint+'</div>':'')+'</div>';
}
function fTa(label,path,val,opt){
  opt=opt||{};
  return '<div class="ed-f"><label>'+label+'</label><textarea data-p="'+path+'" data-t="'+(opt.t||'str')+'"'+(opt.ph?' placeholder="'+esc(opt.ph)+'"':'')+'>'+esc(val)+'</textarea>'
    +(opt.hint?'<div class="hint">'+opt.hint+'</div>':'')+'</div>';
}
function fChk(label,path,val,live){
  return '<label class="ed-chk"><input type="checkbox" data-p="'+path+'" data-t="bool"'+(live?' data-live="'+live+'"':'')+(val?' checked':'')+'> '+label+'</label>';
}
function kgVal(s){var n=num(String(s||'').replace(/[^0-9.,]/g,''),0);return n>0?n:'';}

function edOpen(){
  ED=clone(SESSIONS[SESSION_IDX[currentTab]]);
  ED_VIEW='session';ED_EXO=null;
  document.getElementById('ed').classList.add('show');
  edRender();
}
function edClose(){
  document.getElementById('ed').classList.remove('show');
  ED=null;
}
function edBack(){
  if(ED_VIEW==='exo'||ED_VIEW==='transfer'){ED_VIEW='session';edRender();}
  else edAskClose();
}
function edAskClose(){
  var orig=JSON.stringify(SESSIONS[SESSION_IDX[currentTab]]);
  if(ED&&JSON.stringify(ED)!==orig){
    if(confirm('Enregistrer les modifications de la séance ?')){edSave();return;}
  }
  edClose();
}
/* Bouton retour Android (appelé par MainActivity) */
window.onBackKey=function(){
  var e=document.getElementById('ed');
  if(e&&e.classList.contains('show')){edBack();return true;}
  var t=document.getElementById('timer-overlay');
  if(t&&t.classList.contains('show')){stopTimer();return true;}
  return false;
};

function edCurExo(){return ED.blocs[ED_EXO.b].exos[ED_EXO.i];}

function edRender(){
  var body=document.getElementById('ed-body'),ft=document.getElementById('ed-ft'),h='';
  if(ED_VIEW==='exo'){
    var b=ED_EXO.b,i=ED_EXO.i,x=edCurExo(),p='blocs.'+b+'.exos.'+i+'.';
    document.getElementById('ed-title').textContent=x.name;
    h+='<div class="ed-card">'
      +fIn('Nom de l\'exercice',p+'name',x.name,{live:'title'})
      +'<div class="ed-row">'+fIn('Répétitions',p+'reps',x.reps,{ph:'ex. 12 rép. · 10 rép./côté'})+fIn('Poids (kg)',p+'kg',kgVal(x.kg),{t:'kg',ph:'aucun'})+'</div>'
      +'<div class="ed-row">'+fIn('Durée de tenue (s)',p+'hold',x.hold||'',{t:'int',ph:'0',hint:'Affiche un minuteur'})+fIn('Repos après (s)',p+'rest',x.rest||'',{t:'int',ph:'0',hint:'Repos après l\'exercice'})+'</div>'
      +fIn('Note (badge)',p+'note',x.note,{ph:'ex. Tempo 4-0-2'})
      +'</div>'
      +'<div class="ed-sec">Technique</div><div class="ed-card">'
      +fTa('Étapes — une par ligne',p+'steps',x.steps.join('\n'),{t:'lines'})
      +fTa('💡 Astuce',p+'tip',x.tip)
      +fTa('⚠ Erreur à éviter',p+'erreur',x.erreur)
      +'</div>';
    body.innerHTML=h;
    ft.innerHTML='<button class="ed-btn ed-danger" onclick="edExoDel('+b+','+i+',true)">🗑 Supprimer</button><button class="ed-btn ed-main" onclick="edBack()">✓ Valider</button>';
    body.scrollTop=0;
    return;
  }
  if(ED_VIEW==='transfer'){edRenderTransfer();return;}

  document.getElementById('ed-title').textContent='⚙️ '+ED.name;
  /* Séance */
  h+='<div class="ed-sec">Séance</div><div class="ed-card">'
    +fIn('Nom',  'name',ED.name,{live:'title'})
    +fIn('Description','desc',ED.desc)
    +'<div class="ed-row">'+fIn('Horaire','time',ED.time,{ph:'ex. 7h15'})+fIn('Durée','dur',ED.dur,{ph:'ex. ~25 min'})+fIn('Icône','letter',ED.letter,{ph:'A'})+'</div>'
    +'<div class="ed-f"><label>Couleur</label><div class="ed-cols">'
    +Object.keys(COLORS).map(function(k){return '<div class="ed-col'+(ED.col===k?' on':'')+'" title="'+COLORS[k].nom+'" style="background:'+COLORS[k].grad+'" onclick="edSetCol(\''+k+'\')"></div>';}).join('')
    +'</div></div>'
    +fTa('💡 Conseil',  'conseil',ED.conseil)
    +'</div>';

  /* Échauffement */
  h+='<div class="ed-sec">Échauffement</div><div class="ed-card">';
  ED.warmup.forEach(function(w,i){
    h+='<div class="ed-item" style="display:block;padding:10px">'
      +'<div class="ed-row">'+fIn('Mouvement','warmup.'+i+'.n',w.n)+'<div style="flex:0 0 auto;display:flex;align-items:flex-end;gap:4px;padding-bottom:10px">'
      +'<button class="ed-ic" onclick="edMove(\'warmup\','+i+',-1)"'+(i===0?' disabled':'')+'>↑</button>'
      +'<button class="ed-ic" onclick="edMove(\'warmup\','+i+',1)"'+(i===ED.warmup.length-1?' disabled':'')+'>↓</button>'
      +'<button class="ed-ic del" onclick="edDel(\'warmup\','+i+')">🗑</button></div></div>'
      +'<div class="ed-row">'+fIn('Consigne','warmup.'+i+'.d',w.d)+fIn('Volume','warmup.'+i+'.b',w.b,{ph:'2x10'})+'</div>'
      +'</div>';
  });
  if(!ED.warmup.length)h+='<div class="ed-note">Pas d\'échauffement pour cette séance.</div>';
  h+='<button class="ed-add" onclick="edAddWarm()">＋ Ajouter un mouvement</button></div>';

  /* Blocs et exercices */
  h+='<div class="ed-sec">Exercices</div>';
  var multi=ED.blocs.length>1;
  ED.blocs.forEach(function(bl,b){
    var pb='blocs.'+b+'.';
    h+='<div class="ed-card ed-bloc" style="border-left-color:'+(COLORS[ED.col]||COLORS.A).bg+'">';
    if(multi)h+='<div class="ed-bloc-hd"><b>Bloc '+(b+1)+'</b>'
      +'<button class="ed-ic" onclick="edMove(\'blocs\','+b+',-1)"'+(b===0?' disabled':'')+'>↑</button>'
      +'<button class="ed-ic" onclick="edMove(\'blocs\','+b+',1)"'+(b===ED.blocs.length-1?' disabled':'')+'>↓</button>'
      +'<button class="ed-ic del" onclick="edDelBloc('+b+')">🗑</button></div>';
    h+=fIn(multi?'Titre du bloc':'Titre du bloc (facultatif)',pb+'titre',bl.titre,{ph:multi?'ex. Bloc Force':'aucun'})
      +'<div class="ed-f"><label>Déroulement</label><select data-p="'+pb+'type" data-live="type">'
      +'<option value="rounds"'+(bl.type==='rounds'?' selected':'')+'>En tours (circuit)</option>'
      +'<option value="linear"'+(bl.type==='linear'?' selected':'')+'>1 seul passage</option></select></div>';
    if(bl.type==='rounds')h+='<div class="ed-row">'+fIn('Nombre de tours',pb+'maxRounds',bl.maxRounds,{t:'rounds'})+fIn('Repos fin de tour (s)',pb+'restSec',bl.restSec,{t:'int'})+'</div>';
    h+=fChk('Repos automatique (minuteur lancé quand un exercice est marqué terminé)',pb+'autoRest',bl.autoRest);
    h+='<div style="height:8px"></div>';
    bl.exos.forEach(function(x,i){
      var info=[x.reps,x.kg,x.hold?x.hold+' s':'',x.rest?'repos '+x.rest+' s':''].filter(Boolean).join(' · ');
      h+='<div class="ed-item"><div class="nm" onclick="edExo('+b+','+i+')">'+(i+1)+'. '+esc(x.name)+(info?'<small>'+esc(info)+'</small>':'')+'</div>'
        +'<button class="ed-ic" onclick="edExo('+b+','+i+')" aria-label="Modifier">✎</button>'
        +'<button class="ed-ic" onclick="edExoDup('+b+','+i+')" aria-label="Dupliquer">⧉</button>'
        +'<button class="ed-ic" onclick="edExoMove('+b+','+i+',-1)"'+(b===0&&i===0?' disabled':'')+' aria-label="Monter">↑</button>'
        +'<button class="ed-ic" onclick="edExoMove('+b+','+i+',1)"'+(b===ED.blocs.length-1&&i===bl.exos.length-1?' disabled':'')+' aria-label="Descendre">↓</button>'
        +'<button class="ed-ic del" onclick="edExoDel('+b+','+i+')" aria-label="Supprimer">🗑</button></div>';
    });
    h+='<button class="ed-add" onclick="edExoAdd('+b+')">＋ Ajouter un exercice</button></div>';
  });
  h+='<button class="ed-add" onclick="edAddBloc()">＋ Ajouter un bloc (ex. étirements en 1 passage)</button>';

  h+='<div class="ed-tools">'
    +'<button class="ed-btn ed-sec-btn" onclick="edDefault()">↺ Séance par défaut</button>'
    +'<button class="ed-btn ed-sec-btn" onclick="ED_VIEW=\'transfer\';edRender()">⇄ Sauvegarde / transfert</button>'
    +'</div>';
  var sc=body.scrollTop;
  body.innerHTML=h;
  body.scrollTop=sc;
  ft.innerHTML='<button class="ed-btn ed-sec-btn" onclick="edClose()">Annuler</button><button class="ed-btn ed-main" onclick="edSave()">✓ Enregistrer</button>';
}

function edSetCol(k){ED.col=k;edRender();}
function edMove(list,i,d){var a=ED[list],j=i+d;if(j<0||j>=a.length)return;var t=a[i];a[i]=a[j];a[j]=t;edRender();}
function edDel(list,i){ED[list].splice(i,1);edRender();}
function edAddWarm(){ED.warmup.push({n:'Nouveau mouvement',d:'',b:'2x10'});edRender();}
function edAddBloc(){
  if(ED.blocs.length===1&&!ED.blocs[0].titre)ED.blocs[0].titre='Bloc 1';
  ED.blocs.push(normBloc({titre:'Bloc '+(ED.blocs.length+1),type:'linear',exos:[]}));edRender();
}
function edDelBloc(b){
  var n=ED.blocs[b].exos.length;
  if(n&&!confirm('Supprimer ce bloc et ses '+n+' exercice'+(n>1?'s':'')+' ?'))return;
  ED.blocs.splice(b,1);edRender();
}
function edExo(b,i){ED_VIEW='exo';ED_EXO={b:b,i:i};edRender();}
function edExoAdd(b){
  ED.blocs[b].exos.push(normExo({name:'Nouvel exercice',reps:'10 rép.'}));
  edExo(b,ED.blocs[b].exos.length-1);
}
function edExoDup(b,i){var x=clone(ED.blocs[b].exos[i]);x.name+=' (copie)';ED.blocs[b].exos.splice(i+1,0,x);edRender();}
function edExoDel(b,i,fromExo){
  if(!confirm('Supprimer « '+ED.blocs[b].exos[i].name+' » ?'))return;
  ED.blocs[b].exos.splice(i,1);
  if(fromExo)ED_VIEW='session';
  edRender();
}
/* Déplacement : passe au bloc voisin quand on dépasse le début / la fin du bloc */
function edExoMove(b,i,d){
  var ex=ED.blocs[b].exos;
  if(i+d>=0&&i+d<ex.length){var t=ex[i];ex[i]=ex[i+d];ex[i+d]=t;}
  else if(d<0&&b>0){ED.blocs[b-1].exos.push(ex.splice(i,1)[0]);}
  else if(d>0&&b<ED.blocs.length-1){ED.blocs[b+1].exos.unshift(ex.splice(i,1)[0]);}
  edRender();
}
function edDefault(){
  if(!confirm('Remettre cette séance telle qu\'elle était à l\'origine ? Tes modifications de cette séance seront perdues.'))return;
  ED=normSession(clone(PAGE.defaults[SESSION_IDX[currentTab]]),SESSION_IDX[currentTab]);
  edRender();
}
function edSave(){
  ED.blocs=ED.blocs.filter(function(b,k){return b.exos.length||ED.blocs.length===1;});
  if(!ED.blocs.length)ED.blocs=[normBloc({})];
  ED=normSession(ED,SESSION_IDX[currentTab]);
  SESSIONS[SESSION_IDX[currentTab]]=ED;
  saveSessions();
  edClose();
  doneExos={};
  buildTabs();
  showTab(currentTab);
}

/* ───────── Sauvegarde / transfert ───────── */
var TRANSFER_KEYS=['cfg_programme','cfg_extra','poids_cfg','sante_obj'];
function exportText(){
  var o={app:'callisthenie',v:1,date:new Date().toISOString().slice(0,10)};
  TRANSFER_KEYS.forEach(function(k){
    var v=k===cfgKey()?JSON.stringify(SESSIONS):prefGet(k);
    if(v!=null){try{o[k]=JSON.parse(v);}catch(e){}}
  });
  return JSON.stringify(o);
}
function edRenderTransfer(){
  document.getElementById('ed-title').textContent='⇄ Sauvegarde / transfert';
  var body=document.getElementById('ed-body');
  body.innerHTML='<div class="ed-card"><div class="ed-note"><b>Exporter</b> : copie ou envoie ce texte (mail, messagerie…). Il contient les séances <b>Programme</b> et <b>Extra</b>, ainsi que les objectifs Poids et Santé (pas les pesées).</div>'
    +'<div class="ed-f"><textarea id="ed-txt" readonly>'+esc(exportText())+'</textarea></div>'
    +'<div class="ed-tools" style="margin-top:0"><button class="ed-btn ed-sec-btn" onclick="trCopy()">📋 Copier</button>'
    +(window.App&&App.shareText?'<button class="ed-btn ed-sec-btn" onclick="App.shareText(exportText())">📤 Envoyer</button>':'')+'</div></div>'
    +'<div class="ed-card"><div class="ed-note"><b>Importer</b> : colle ici le texte reçu d\'un autre téléphone. Les réglages actuels seront remplacés.</div>'
    +'<div class="ed-f"><textarea id="ed-imp" placeholder="Colle le texte ici"></textarea></div>'
    +'<div class="ed-tools" style="margin-top:0">'+(window.App&&App.pasteText?'<button class="ed-btn ed-sec-btn" onclick="document.getElementById(\'ed-imp\').value=App.pasteText()">📋 Coller</button>':'')
    +'<button class="ed-btn ed-main" onclick="trImport()">⇩ Importer</button></div></div>'
    +'<div class="ed-card"><div class="ed-note">Remettre <b>toutes</b> les séances de cet onglet telles qu\'à l\'origine.</div>'
    +'<button class="ed-btn ed-danger" style="width:100%" onclick="trResetAll()">↺ Tout l\'onglet par défaut</button></div>';
  document.getElementById('ed-ft').innerHTML='<button class="ed-btn ed-sec-btn" onclick="edBack()">&#x2190; Retour à la séance</button>';
  body.scrollTop=0;
}
function trCopy(){
  var t=exportText();
  if(window.App&&App.copyText){App.copyText(t);return;}
  var ta=document.getElementById('ed-txt');ta.removeAttribute('readonly');ta.select();
  try{document.execCommand('copy');alert('Réglages copiés');}catch(e){}
  ta.setAttribute('readonly','');
}
function trImport(){
  var raw=(document.getElementById('ed-imp').value||'').trim();
  if(!raw){alert('Colle d\'abord le texte des réglages.');return;}
  var o;
  try{o=JSON.parse(raw.slice(raw.indexOf('{'),raw.lastIndexOf('}')+1));}catch(e){alert('Texte illisible : vérifie qu\'il a été copié en entier.');return;}
  if(!o||o.app!=='callisthenie'){alert('Ce texte ne contient pas de réglages Callisthénie.');return;}
  var n=0;
  TRANSFER_KEYS.forEach(function(k){if(o[k]!=null){prefSet(k,JSON.stringify(o[k]));n++;}});
  if(!n){alert('Aucun réglage trouvé dans ce texte.');return;}
  alert('Réglages importés ✓');
  location.reload();
}
function trResetAll(){
  if(!confirm('Remettre toutes les séances de cet onglet par défaut ?'))return;
  prefSet(cfgKey(),null);
  SESSIONS=loadSessions();syncWidget();
  edClose();doneExos={};buildTabs();showTab(currentTab);
}

/* ───────── Démarrage ───────── */
function initSeances(){
  DAYS=PAGE.days;
  SESSION_IDX=DAYS.map(function(_,i){return i;});
  SESSIONS=loadSessions();
  edInjectUI();
  updateClock();setInterval(updateClock,10000);
  if(PAGE.today){var d=new Date().getDay();currentTab=(d+6)%7;}
  buildTabs();
  showTab(currentTab);
  syncWidget();
  try{var v=window.App&&App.version();if(v)document.querySelectorAll('.app-ver').forEach(function(e){e.textContent=e.getAttribute('data-pre')+'v'+v;});}catch(e){}
}

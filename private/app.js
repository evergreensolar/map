// Smart Evergreen staff app – served only to logged-in users (/app.js)
const COLORS={ENQUIRY:'#9e9e9e',SURVEY_REQUESTED:'#ffb74d',SURVEY_SCHEDULED:'#fb8c00',SURVEY_DONE:'#fdd835',DESIGN_PENDING:'#f06292',DESIGN_DONE:'#ba68c8',PROJECT_CREATED:'#7986cb',AGREEMENT_PENDING:'#5c6bc0',DISPATCH_PENDING:'#e53935',INSTALLATION_PENDING:'#8e24aa',NET_METERING_PENDING:'#00acc1',DOCUMENT_SENDING:'#26a69a',COMPLETED:'#2e9e44',OTHER:'#6d4c41'};
const NAMES={ENQUIRY:'Enquiry',SURVEY_REQUESTED:'Survey requested (coordinator)',SURVEY_SCHEDULED:'Survey scheduled (engineer)',SURVEY_DONE:'Survey submitted',DESIGN_PENDING:'Design pending',DESIGN_DONE:'Design done / customer confirm',PROJECT_CREATED:'Project created',AGREEMENT_PENDING:'Agreement pending',DISPATCH_PENDING:'Dispatch pending',INSTALLATION_PENDING:'Installation pending',NET_METERING_PENDING:'Net metering pending',DOCUMENT_SENDING:'Document sending',COMPLETED:'Completed',OTHER:'Other'};
const SVC={MAINTENANCE:'#d50000',CLEANING:'#0091ea',AMC:'#00c853'},KIND={SURVEY:'#fb8c00',...SVC};
let ME,projects=[],routeLine,nearLayer=L.layerGroup();
const $=id=>document.getElementById(id);
const api=async(u,o={})=>{const r=await fetch(u,{headers:{'Content-Type':'application/json'},...o});if(r.status==401){$('login').style.display='flex';throw 0;}return r.json();};
const map=L.map('map').setView([22.65,88.45],10);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map);
const projLayer=L.markerClusterGroup({disableClusteringAtZoom:15}),enqLayer=L.layerGroup();map.addLayer(projLayer);map.addLayer(enqLayer);map.addLayer(nearLayer);
$('fStage').innerHTML=Object.keys(NAMES).map(k=>`<option value="${k}" ${['SURVEY_REQUESTED','SURVEY_SCHEDULED','DISPATCH_PENDING','INSTALLATION_PENDING','NET_METERING_PENDING'].includes(k)?'selected':''}>${NAMES[k]}</option>`).join('');
$('legend').innerHTML=Object.keys(NAMES).map(k=>`<div class="leg"><span class="dot" style="background:${COLORS[k]}"></span>${NAMES[k]}</div>`).join('');
async function logout(){await fetch('/auth/logout',{method:'POST'});location.reload();}
async function init(){try{ME=await api('/auth/me');}catch(e){return;}$('login').style.display='none';badge();$('me').textContent=`${ME.name} (${ME.role})`;
 document.querySelectorAll('.adm').forEach(b=>b.style.display=['admin','manager'].includes(ME.role)?'':'none');if(ME.role!=='admin')document.querySelector('[data-p=usersPage]').style.display='none';
 const s=await api('/api/summary');const opt=(a)=>'<option value="">All</option>'+a.map(x=>`<option>${x}</option>`).join('');
 $('fTeam').innerHTML=opt(s.filters.teams);$('fEng').innerHTML=opt(s.filters.engineers);$('fSrc').innerHTML=opt(s.filters.sources);
 if(ME.role==='engineer'&&ME.team)$('fTeam').value=ME.team;await mBucket(MB);
 let t=location.hash.slice(1);if(!t)try{t=localStorage.getItem('ef_tab')||'';}catch(e){}
 const tb=t&&document.querySelector(`header button[data-p="${t}"]`);if(tb&&tb.style.display!=='none'&&t!=='mapPage')show(tb);bgStatus();}
function show(b){document.querySelectorAll('header button[data-p]').forEach(x=>x.classList.remove('on'));b.classList.add('on');
 try{history.replaceState(null,'','#'+b.dataset.p);localStorage.setItem('ef_tab',b.dataset.p);}catch(e){}LAST_REFRESH=Date.now();
 ['mapPage','todayPage','routePage','genPage','planPage','areaPage','rmsPage','alertPage','importPage','usersPage','docsPage'].forEach(p=>$(p).style.display='none');$(b.dataset.p).style.display=['mapPage','genPage','routePage'].includes(b.dataset.p)?'flex':'block';
 if(b.dataset.p=='mapPage')map.invalidateSize();if(b.dataset.p=='areaPage')areas();if(b.dataset.p=='planPage')planner();if(b.dataset.p=='rmsPage')rmsPage();if(b.dataset.p=='genPage')genPage();if(b.dataset.p=='alertPage')alertsPage();if(b.dataset.p=='usersPage')users();if(b.dataset.p=='importPage')dataStatus();if(b.dataset.p=='docsPage')docs();if(b.dataset.p=='todayPage')todayPage();if(b.dataset.p=='routePage')routePage();}
const fmt=d=>d?d.split('-').reverse().join('/'):'-';
async function load(keepView){const st=[...$('fStage').selectedOptions].map(o=>o.value).join(',');const q=new URLSearchParams({stage:st,from:$('fFrom').value,to:$('fTo').value,team:$('fTeam').value,engineer:$('fEng').value,datefield:$('fDateField').value});
 projLayer.clearLayers();enqLayer.clearLayers();projects=[];const cnt={};
 if($('lProj').checked&&st){projects=await api('/api/projects?'+q);projects.forEach(p=>{cnt[p.stage]=(cnt[p.stage]||0)+1;
  L.circleMarker([p.lat,p.lng],{radius:8,weight:1,color:'#222',fillColor:COLORS[p.stage],fillOpacity:.9}).bindPopup(`<b>${p.customer||''}</b> (${p.ext_id})<br><b style="color:${COLORS[p.stage]}">${NAMES[p.stage]}</b> ${p.stage_label?'– '+p.stage_label:''}<br>Stage date: ${fmt(p.stage_date)}<br>Survey: ${fmt(p.survey_date)} | Dispatch: ${fmt(p.dispatch_date)}<br>Install: ${fmt(p.installation_date)} | Complete: ${fmt(p.completion_date)}<br>${p.capacity_kw?p.capacity_kw+' kW | ':''}${p.engineer||''} ${p.team?'('+p.team+')':''}<br>${p.address||''} ${p.pincode||''}<br>${p.phone||''}<br><a target=_blank href="https://www.openstreetmap.org/directions?to=${p.lat},${p.lng}">Directions</a>`).addTo(projLayer);});}
 let enqTotal=0;if($('lEnq').checked){const e=await api('/api/enquiries/by-pincode?'+new URLSearchParams({from:$('fFrom').value,to:$('fTo').value,source:$('fSrc').value}));
  e.forEach(x=>{enqTotal+=x.count;L.circleMarker([x.lat,x.lng],{radius:Math.min(6+Math.sqrt(x.count)*4,40),color:'#e65100',weight:1,fillColor:'#ff9800',fillOpacity:.35}).bindPopup(`<b>Pincode ${x.pincode}</b><br>${x.area||''}<br>Enquiries: <b>${x.count}</b>`).addTo(enqLayer);});}
 let survN=0;if($('lSurv').checked){const sv=await api('/api/enquiries/survey');sv.filter(x=>x.lat!=null).forEach(x=>{survN++;const c=COLORS[x.stage]||COLORS.SURVEY_REQUESTED;
  L.circleMarker([x.lat,x.lng],{radius:8,weight:2,color:'#fff',fillColor:c,fillOpacity:.95}).bindPopup(`<b>${x.customer||''}</b> (${x.ext_id})<br><b style="color:${c}">${NAMES[x.stage]||x.status}</b> – ${x.status}<br>Enquiry date: ${fmt(x.enquiry_date)}${x.assigned_to?'<br>Assigned: '+x.assigned_to:''}<br>${x.area||''} ${x.pincode||''}<br>${x.phone?`<a href="tel:${x.phone}">${x.phone}</a>`:''}`).addTo(enqLayer);});
  cnt.__s=`<br><span style="color:${COLORS.SURVEY_REQUESTED}">●</span> Survey requests (enquiries): <b>${survN}</b>${sv.length>survN?` <span class="small">(${sv.length-survN} without location)</span>`:''}`;}
 $('totals').innerHTML=`Enquiries shown: <b>${enqTotal}</b><br>Projects shown: <b>${projects.length}</b><br>`+Object.entries(cnt).filter(([k])=>k!=='__s').map(([k,v])=>`<span style="color:${COLORS[k]}">●</span> ${NAMES[k]}: ${v}`).join('<br>')+(cnt.__s||'');
 if($('lSvc').checked){const sv=await api('/api/service');sv.forEach(t=>L.marker([t.lat,t.lng],{icon:L.divIcon({className:'',html:`<div style="width:14px;height:14px;background:${SVC[t.type]};border:2px solid #fff;transform:rotate(45deg);box-shadow:0 0 2px #000"></div>`})}).bindPopup(`<b>${t.type}</b> ticket ${t.ext_id}<br><b>${t.customer||''}</b> ${t.phone||''}<br>${t.issue||''}<br>Status: ${t.status} | Date: ${fmt(t.scheduled_date)}<br>${t.engineer||''}`).addTo(enqLayer));
 $('totals').innerHTML+=`<br>Open service tickets: <b>${sv.length}</b>`;}
 const all=[...projects.map(p=>[p.lat,p.lng])];if(all.length&&keepView!==true)map.fitBounds(L.latLngBounds(all).pad(.1));}
map.on('click',async e=>{if(!$('nearMode').checked)return;nearLayer.clearLayers();const km=+$('nearKm').value||3;
 L.circle(e.latlng,{radius:km*1000,color:'#2e9e44',fillOpacity:.05}).addTo(nearLayer);L.marker(e.latlng).addTo(nearLayer);
 const r=await api(`/api/nearby?lat=${e.latlng.lat}&lng=${e.latlng.lng}&km=${km}`);
 r.forEach(p=>L.circleMarker([p.lat,p.lng],{radius:9,color:'#000',weight:2,fillColor:'#2e9e44',fillOpacity:1}).bindPopup(`<b>${p.customer}</b><br>${p.capacity_kw||''} kW, completed ${fmt(p.completion_date)}<br>${p.distance_km} km away`).addTo(nearLayer));
 $('list').innerHTML=`<b>${r.length} completed projects within ${km} km</b><br>`+r.map(p=>`${p.customer} – ${p.capacity_kw||'?'} kW – ${p.distance_km} km`).join('<br>');});
function km(a,b){const t=Math.PI/180,x=Math.sin((b[0]-a[0])*t/2)**2+Math.cos(a[0]*t)*Math.cos(b[0]*t)*Math.sin((b[1]-a[1])*t/2)**2;return 12742*Math.asin(Math.sqrt(x));}
function route(){clearRoute();let pts=projects.map(p=>({p,c:[p.lat,p.lng]})),cur=ME.office.split(',').map(Number),start=cur,out=[],tot=0,max=+$('maxStops').value||8;
 while(pts.length&&out.length<max){let bi=0,bd=1e9;pts.forEach((x,i)=>{const d=km(cur,x.c);if(d<bd){bd=d;bi=i;}});tot+=bd;out.push({...pts[bi],d:bd});cur=pts[bi].c;pts.splice(bi,1);}
 if(!out.length)return alert('No projects shown');routeLine=L.polyline([start,...out.map(o=>o.c)],{color:'#ff5722',weight:4,dashArray:'6'}).addTo(map);map.fitBounds(routeLine.getBounds().pad(.1));
 $('list').innerHTML=`<b>Approx. ${tot.toFixed(1)} km (straight line)</b><ol>`+out.map(o=>`<li>${o.p.customer} – ${NAMES[o.p.stage]} – ${o.d.toFixed(1)} km</li>`).join('')+'</ol>';}
function clearRoute(){if(routeLine)map.removeLayer(routeLine);routeLine=null;$('list').innerHTML='';}
async function areas(){const s=await api('/api/summary');$('areaTbl').innerHTML=`<p>Total enquiries: <b>${s.totalEnquiries}</b> | Pincodes waiting for location: ${s.ungeocoded}</p><table><tr><th>Pincode</th><th>Area</th><th>Enquiries</th><th>Survey pending</th><th>Design</th><th>Agreement</th><th>Dispatch pending</th><th>Install pending</th><th>Net metering</th><th>Completed</th><th>Open service</th><th>Total projects</th></tr>`+
 s.byArea.map(r=>`<tr><td>${r.pincode}</td><td>${r.area||''}</td><td>${r.enquiries}</td><td>${r.survey_pending}</td><td>${r.design_pending}</td><td>${r.agreement_pending}</td><td>${r.dispatch_pending}</td><td>${r.install_pending}</td><td>${r.netmeter_pending}</td><td>${r.completed}</td><td>${r.service_open}</td><td>${r.total}</td></tr>`).join('')+'</table>';}
async function planner(){if(!$('pFrom').value)$('pFrom').value=new Date().toISOString().slice(0,10);
 const kinds=[...document.querySelectorAll('.pk:checked')].map(x=>x.value).join(',');
 const r=await api('/api/planner?'+new URLSearchParams({from:$('pFrom').value,days:$('pDays').value,kinds}));
 $('planBody').innerHTML=`<p><b>${fmt(r.from)} to ${fmt(r.to)}</b> – ${r.total} visits in ${r.groups.length} areas</p>`+r.groups.map(g=>`<div style="border:1px solid #ccc;border-radius:6px;margin:10px 0;padding:8px;${g.can_club?'border-left:6px solid #fb8c00':''}">
 <b>Pincode ${g.pincode}</b> ${g.area?'– '+g.area:''} – <b>${g.count} visits</b> on ${g.dates.length} different day(s)
 ${g.can_club?`<span style="background:#fff3e0;padding:2px 6px;border-radius:4px;margin-left:6px">Can club into one day – suggested: <b>${fmt(g.suggested_date)}</b></span>`:''}
 <table style="margin-top:6px"><tr><th>Date</th><th>Type</th><th>Customer</th><th>Phone</th><th>Address</th><th>Engineer</th><th>Status</th><th>ID</th></tr>
 ${g.jobs.map(j=>`<tr><td>${fmt(j.date)}</td><td><span style="color:${KIND[j.kind]}">■</span> ${j.kind}</td><td>${j.customer||''}</td><td><a href="tel:${j.phone||''}">${j.phone||''}</a></td><td>${j.address||''}</td><td>${j.engineer||'-'}</td><td>${NAMES[j.status]||j.status||''}</td><td>${j.ext_id}</td></tr>`).join('')}</table></div>`).join('');}
const LABEL={GROWATT:'Growatt',SOLARMAN:'Deye (Solarman)',SUNGROW:'Sungrow (iSolarCloud)',PVBLINK:'PVblink'};
async function connPage(){if(ME.role!=='admin'){$('connWrap').style.display='none';return;}const st=await api('/api/rms/settings');
 $('connWrap').open=!st.some(b=>b.configured);$('connBox').innerHTML='<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">'+st.map(b=>`<div style="border:1px solid #ccc;border-radius:6px;padding:8px;width:260px">
 <b>${LABEL[b.brand]}</b> <span style="color:${b.configured?'green':'red'}">${b.configured?'● connected':'● not set'}</span>
 ${b.fields.map(f=>`<label>${f.key.replace(b.brand+'_','').replace(/_/g,' ')}${/BASE/.test(f.key)?' (optional)':''}</label><input data-k="${f.key}" type="${f.secret?'password':'text'}" placeholder="${f.secret&&f.set?'•••••• saved':''}" value="${f.value}">`).join('')}
 <button class="b" onclick="connSave('${b.brand}',this)">Save</button><button class="b g" onclick="connTest('${b.brand}')">Test connection</button></div>`).join('')+'</div><p class="small">Secrets are stored on the server only and never shown again. Leave a secret box empty to keep the saved value.</p>';}
async function connSave(brand,btn){const o={};btn.parentElement.querySelectorAll('input[data-k]').forEach(i=>{if(i.value)o[i.dataset.k]=i.value;});await api('/api/rms/settings',{method:'POST',body:JSON.stringify(o)});connPage();rmsPage(true);}
async function connTest(brand){const r=await api('/api/rms/test/'+brand,{method:'POST'});alert(LABEL[brand]+': '+r.message);}
async function rmsPage(skipConn){if(!skipConn)connPage();unmapped();const b=await api('/api/rms/brands');$('brandBox').innerHTML='API status: '+b.map(x=>`${x.brand==='SOLARMAN'?'DEYE/Solarman':x.brand}: <b style="color:${x.configured?'green':'red'}">${x.configured?'connected':'key not set'}</b>`).join(' | ');
 RDATA=await api('/api/rms/devices');rDraw();}
let RDATA=[],RF='',RVIEW=[];
const f2=(v,d=1)=>v==null||v===''||isNaN(+v)?'–':(+v).toFixed(d).replace(/\.0+$/,'');
function ago(t){if(!t)return'never';const m=Math.round((Date.now()-new Date(t))/60000);return m<1?'just now':m<60?m+' min ago':m<1440?Math.round(m/60)+' h ago':Math.round(m/1440)+' d ago';}
function rState(x){if(x.last_error&&!/^ALARM/.test(x.last_error))return['err','No data'];if(x.last_error)return['bad','Alarm'];if(x.online===1)return['ok','Online'];if(x.online===0)return['bad','Offline'];return['wait','Idle (night)'];}
function ring(pct,col){const r=26,c=2*Math.PI*r,v=Math.max(0,Math.min(1,pct||0));
 return `<svg width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="${r}" fill="none" stroke="rgba(127,154,163,.18)" stroke-width="6"/><circle cx="32" cy="32" r="${r}" fill="none" stroke="${col}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${(c*v).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 32 32)" style="transition:stroke-dasharray .8s"/><text x="32" y="36" text-anchor="middle" font-family="JetBrains Mono,monospace" font-size="12" font-weight="600" fill="${col}">${Math.round(v*100)}%</text></svg>`;}
function rCore(late,low){const D=RDATA,n=D.length||1,on=D.filter(x=>x.online===1).length,kw=D.reduce((a,x)=>a+(+x.kw||0),0),live=D.reduce((a,x)=>a+(+x.last_power_kw||0),0),
 withT=D.filter(x=>x.today_kwh!=null&&x.kw),tk=D.reduce((a,x)=>a+(+x.today_kwh||0),0),tkw=withT.reduce((a,x)=>a+(+x.kw||0),0),y=tkw?withT.reduce((a,x)=>a+(+x.today_kwh||0),0)/tkw:0,al=D.filter(x=>x.alerts).length;
 const g=(svg,v,l)=>`<div class="gauge">${svg}<div><div class="gv">${v}</div><div class="gl">${l}</div></div></div>`;
 $('rCore').innerHTML=g(ring(on/n,'#3cf08a'),`${on}/${D.length}`,'Systems online')+g(ring(kw?live/kw:0,'#38f0c8'),`${live.toFixed(1)} kW`,'Live power')+g(ring(Math.min(1,y/4.5),'#3ec7ff'),`${Math.round(tk)} kWh`,'Generated today')+
  g(ring(Math.min(1,y/4.5),y<low&&late?'#ffad3b':'#3ec7ff'),`${y.toFixed(2)}`,'kWh per kW today')+g(ring(al/n,al?'#ff5d6c':'#3cf08a'),String(al),'Systems with alerts');}
function rDraw(){const low=+(window.LOWGEN||2.5),late=new Date().getHours()>=17,qq=($('rFind').value||'').toLowerCase().trim();
 const yieldOf=x=>x.kw&&x.today_kwh!=null?x.today_kwh/x.kw:null;
 const tests={'':()=>true,ok:x=>rState(x)[0]==='ok',bad:x=>['bad','err'].includes(rState(x)[0]),alerts:x=>!!x.alerts,low:x=>late&&yieldOf(x)!=null&&yieldOf(x)<low,unlinked:x=>!x.project_ext_id,ow:x=>!!x.no_alerts};
 const cnt=k=>RDATA.filter(tests[k]).length;
 rCore(late,low);
 const chips=[['','All'],['ok','Online'],['bad','Offline / no data'],['alerts','With alerts'],...(late?[['low','Low generation today']]:[]),['unlinked','Not linked'],['ow','Out of warranty']];
 $('rStats').innerHTML=chips.map(([k,t])=>`<button class="chip ${RF===k?'on':''} c-${k||'all'}" onclick="RF='${k}';rDraw()"><b>${cnt(k)}</b>${t}</button>`).join('');
 let l=RDATA.filter(tests[RF]||tests['']).filter(x=>!qq||`${x.customer||''} ${x.serial} ${x.logger_serial||''} ${x.area||''} ${x.phone||''} ${x.project_ext_id||''} ${x.pincode||''}`.toLowerCase().includes(qq));
 const rank=x=>({err:0,bad:0,wait:2,ok:3})[rState(x)[0]]-(x.alerts?1:0)+(x.no_alerts?4:0),srt=$('rSort').value;
 RVIEW=l;l.sort(srt==='name'?(a,b)=>(a.customer||'').localeCompare(b.customer||''):srt==='kw'?(a,b)=>(+b.kw||0)-(+a.kw||0):srt==='gen'?(a,b)=>(yieldOf(a)??99)-(yieldOf(b)??99):(a,b)=>rank(a)-rank(b)||(yieldOf(a)??99)-(yieldOf(b)??99));
 const canEdit=['admin','manager'].includes(ME.role);
 $('rTbl').innerHTML=l.length?'<table class="rt"><tr><th>Customer</th><th>Project</th><th>Inverter</th><th class="n">Size</th><th class="n">Now</th><th class="n">Today</th><th>Yield today</th><th>Status</th><th>Updated</th><th></th></tr>'+
 l.map(x=>{const [st,label]=rState(x),y=yieldOf(x),lowY=late&&y!=null&&y<low;
  return `<tr class="${st==='bad'||st==='err'?'rbad':''}"><td><a href="#" class="lnk" onclick="dev(${x.id});return false"><b>${x.customer||'—'}</b></a><div class="sub">${[x.phone,x.area,x.pincode].filter(Boolean).join(' · ')}</div></td>
  <td>${x.project_ext_id?x.project_ext_id+(String(x.project_ext_id).startsWith('TMP-')?' <span class="tag">temporary</span>':''):'<span class="tag warn">Not linked</span>'}</td>
  <td>${x.brand==='SOLARMAN'?'DEYE':x.brand}<div class="sub mono">${x.serial}${x.logger_serial?' · '+x.logger_serial:''}</div></td>
  <td class="n">${f2(x.kw,2)} kW</td><td class="n">${f2(x.last_power_kw,2)} kW</td><td class="n">${f2(x.today_kwh)} kWh</td>
  <td>${y==null?'–':`<div class="bar ${lowY?'low':''}"><i style="width:${Math.min(100,y/5*100)}%"></i></div><span class="sub">${y.toFixed(2)} kWh/kW</span>`}</td>
  <td><span class="pill p-${st}">${label}</span>${x.online===0&&x.offline_since?`<div class="sub">since ${new Date(x.offline_since).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}</div>`:''}${x.alerts?`<div class="sub" style="color:var(--red)">⚠ ${x.alerts.split(',').map(t=>(ANAME[t]||t).split(' –')[0]).join(', ')}</div>`:''}${x.no_alerts?'<div><span class="tag">Out of warranty</span></div>':''}${st==='err'?`<div class="sub" title="${String(x.last_error).replace(/"/g,'&quot;')}" style="color:var(--red)">${String(x.last_error).slice(0,60)}</div>`:''}</td>
  <td class="sub">${ago(x.last_fetch)}</td>
  <td class="act"><button class="mini" onclick="rTest(${x.id})">Test</button>${canEdit?`<button class="mini" onclick="rEdit(${x.id},'${x.project_ext_id||''}')">Link</button><button class="mini" onclick="warranty('${x.serial}',${!x.no_alerts})">${x.no_alerts?'Alerts on':'Warranty off'}</button><button class="mini del" title="Remove" onclick="rDel(${x.id})">✕</button>`:''}</td></tr>`;}).join('')+'</table>':'<p class="small" style="margin:18px 0">Nothing matches this filter.</p>';}
async function rSearch(){const r=await api('/api/projects/search?q='+encodeURIComponent($('rQ').value));$('rProj').innerHTML=r.map(p=>`<option value="${p.ext_id}" data-kw="${p.capacity_kw||''}">${p.customer} – ${p.ext_id} – ${p.pincode||''}</option>`).join('');const o=$('rProj').selectedOptions[0];if(o&&o.dataset.kw)$('rKw').value=o.dataset.kw;}
async function rAdd(){const r=await api('/api/rms/devices',{method:'POST',body:JSON.stringify({project_ext_id:$('rCust').value?'':$('rProj').value,customer:$('rCust').value,phone:$('rPhone').value,pincode:$('rPin').value,brand:$('rBrand').value,serial:$('rSn').value,logger_serial:$('rLog').value,capacity_kw:$('rKw').value})});if(r.error)return alert(r.error);$('rSn').value=$('rLog').value=$('rCust').value=$('rPhone').value=$('rPin').value='';rmsPage(true);}
async function rEdit(id,cur){const p=prompt('Link to ERP Project ID (current: '+cur+')',cur.startsWith('TMP-')?'':cur);if(p===null)return;
 const lg=prompt('Data logger serial (leave empty to keep)','');const body={project_ext_id:p||undefined};if(lg)body.logger_serial=lg;
 const r=await api('/api/rms/devices/'+id,{method:'PUT',body:JSON.stringify(body)});if(r.error)alert(r.error);rmsPage(true);}
async function rTest(id){const r=await api('/api/rms/debug/'+id);
 alert(r.ok?`OK (${r.used})\nNow: ${r.power_kw??'-'} kW\nToday: ${r.today_kwh??'-'} kWh\nTotal: ${r.total_kwh??'-'} kWh\n\nRaw reply:\n${r.raw}`:`FAILED (${r.used||''})\n${r.message}`);}
async function rDel(id){if(confirm('Remove this inverter link?')){await api('/api/rms/devices/'+id,{method:'DELETE'});rmsPage();}}
async function rRefresh(){await api('/api/rms/refresh',{method:'POST'});alert('Refresh started – reload this tab in a minute.');}
const ATYPE={FAULT:'#ff5d6c',GRID:'#9fb3c8',OFFLINE:'#ff8a65',LOW_GEN:'#ffad3b',CLEANING:'#3ec7ff'};
const ANAME={FAULT:'Inverter fault – engineer needed',GRID:'Grid fault – no engineer needed',OFFLINE:'No data / offline',LOW_GEN:'Low generation',CLEANING:'Cleaning needed'};
async function badge(){try{const c=await api('/api/alerts/count');const b=$('aBadge');if(c.open){b.style.display='';b.textContent=c.due?`${c.open} (${c.due} due)`:c.open;}else b.style.display='none';}catch(e){}}
setInterval(badge,60000);
// ---- Auto refresh: current tab every 5 min (only when visible and nobody is typing) ----
let LAST_REFRESH=Date.now();const REFRESH_MS=5*60e3;
async function autoRefresh(force){if(!ME||document.hidden)return;const a=document.activeElement;if(!force&&a&&/INPUT|TEXTAREA|SELECT/.test(a.tagName))return;
 if(!force&&Date.now()-LAST_REFRESH<REFRESH_MS)return;LAST_REFRESH=Date.now();const p=document.querySelector('header button.on')?.dataset.p;
 try{if(p==='mapPage'){if(MB==='ADV')await load(true);else await mBucket(MB,true);}else if(p==='genPage'&&GMAP){GDATA=await api('/api/gen/map');genDraw(false);}else if(p==='rmsPage')await rmsPage(true);
  else if(p==='alertPage')await alertsPage();else if(p==='todayPage')await todayPage();else if(p==='areaPage')await areas();badge();bgStatus();}catch(e){}}
setInterval(autoRefresh,30000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)autoRefresh();});
async function bgStatus(){try{const s=await api('/api/bg-status');const m=s.last_tick?Math.round((Date.now()-Date.parse(s.last_tick))/60000):null;
 let el=$('bgSt');if(!el){el=document.createElement('span');el.id='bgSt';el.style.cssText='font-size:11px;margin:0 8px;opacity:.85';$('me').before(el);}
 el.textContent=m==null?'Data: not run yet':`Data ${m<1?'just now':m+' min ago'}`;el.style.color=m==null||m>40?'#ffcc80':'';
 el.title='Server fetches inverter data every 15 min even when this app is closed.'+(m>40?' Looks stopped – check the Hostinger cron job.':'');}catch(e){}}
async function warranty(sn,out){if(!confirm(out?`Mark inverter ${sn} as OUT OF WARRANTY?\n\nAll its open alerts will close and no new alerts will come. Generation data is still collected. You can undo this in the RMS tab.`:`Turn alerts back ON for ${sn} (in warranty / AMC)?`))return;
 const r=await api('/api/rms/warranty',{method:'POST',body:JSON.stringify({serial:sn,out})});if(r.error)return alert(r.error);badge();
 const p=document.querySelector('header button.on')?.dataset.p;if(p==='rmsPage')rmsPage(true);else alertsPage();}
let ALERTS=[],AF='';
async function alertsPage(){ALERTS=await api('/api/alerts?status='+$('aStatus').value);badge();aDraw();}
function aDraw(){const qq=($('aFind').value||'').toLowerCase().trim(),T=k=>a=>k===''||(k==='DUE'?a.due:a.type===k);
 const keys=[['','All'],...($('aStatus').value==='OPEN'?[['DUE','Question due']]:[]),...Object.keys(ANAME).map(k=>[k,ANAME[k].split(' –')[0]])];
 $('aChips').innerHTML=keys.map(([k,t])=>{const n=ALERTS.filter(T(k)).length;return n||k===''?`<button class="chip ${AF===k?'on':''}" onclick="AF='${k}';aDraw()"><b style="${k&&ATYPE[k]?'color:'+ATYPE[k]:''}">${n}</b>${t}</button>`:'';}).join('');
 const r=ALERTS.filter(T(AF)).filter(a=>!qq||`${a.customer||''} ${a.serial} ${a.area||''} ${a.pincode||''} ${a.phone||''} ${a.message||''}`.toLowerCase().includes(qq));
 $('aList').innerHTML=r.length?r.map(a=>`<div style="border:1px solid #ccc;border-left:6px solid ${a.due?'#fb8c00':ATYPE[a.type]};border-radius:6px;margin:10px 0;padding:10px;${a.due?'background:#fff8e1':''}">
 <b style="color:${ATYPE[a.type]}">${ANAME[a.type]||a.type}</b> – <b>${a.customer||a.project_ext_id}</b> ${a.phone?`<a href="tel:${a.phone}">${a.phone}</a>`:''} | ${a.area||''} ${a.pincode||''} | ${a.brand||''} SN ${a.serial}<br>
 ${a.message}<br><span class="small">Open since ${new Date(a.opened_at).toLocaleString('en-IN')} (${a.age_hrs} h) | Follow-up round ${a.round}${a.engineer?' | Engineer: '+a.engineer:''}${a.status==='RESOLVED'?' | Resolved by '+a.resolved_by+' at '+new Date(a.resolved_at).toLocaleString('en-IN'):''}</span>
 ${a.status==='OPEN'&&['admin','manager'].includes(ME.role)?`<button class="b ow" onclick="warranty('${a.serial}',true)">Out of warranty – stop alerts</button>`:''}
 ${a.status==='OPEN'?`<div class="qf"><b>${a.due?'❓ ':''}${a.question.q}</b>
 <select id="ans${a.id}">${a.question.options.map(o=>`<option>${o}</option>`).join('')}</select>
 <input id="eng${a.id}" placeholder="Engineer name (if assigned)" value="${a.engineer||''}"><input id="note${a.id}" placeholder="Remarks">
 <button class="b" style="width:auto;padding:6px 14px" onclick="answer(${a.id})">Submit answer</button>
 <button class="b g" style="width:auto;padding:6px 14px" onclick="resolveA(${a.id})">Mark resolved</button>
 ${!a.due&&a.next_ask_at?`<span class="small"> Next question: ${new Date(a.next_ask_at).toLocaleString('en-IN')}</span>`:''}</div>`:''}
 <a href="#" class="small" onclick="logA(${a.id},this);return false">History</a><div id="log${a.id}"></div></div>`).join(''):'<p class="small" style="margin:18px 0">No alerts here 🎉</p>';}
async function answer(id){const r=await api(`/api/alerts/${id}/answer`,{method:'POST',body:JSON.stringify({answer:$('ans'+id).value,engineer:$('eng'+id).value,note:$('note'+id).value})});if(r.error)alert(r.error);alertsPage();}
async function resolveA(id){const n=prompt('What was done to resolve?');if(n===null)return;await api(`/api/alerts/${id}/resolve`,{method:'POST',body:JSON.stringify({note:n})});alertsPage();}
async function logA(id){const l=await api(`/api/alerts/${id}/log`);$('log'+id).innerHTML='<table>'+l.map(x=>`<tr><td>${new Date(x.at).toLocaleString('en-IN')}</td><td>${x.who}</td><td>${x.question?'<i>'+x.question+'</i><br>':''}${x.answer?'<b>'+x.answer+'</b> ':''}${x.note||''}</td></tr>`).join('')+'</table>';}
// ---------- Generation page ----------
let GMAP,gLayer,GDATA=[];
const GLEG=[['#2e7d32','Good (≥3.5 kWh/kW today)'],['#9ccc65','Average'],['#fdd835','Low today'],['#ef6c00','Low generation alert'],['#0091ea','Cleaning needed'],['#607d8b','Grid fault (power cut)'],['#c62828','Fault / offline'],['#bdbdbd','No data yet']];
function gColor(x){const a=x.alerts||'';if(/FAULT|OFFLINE/.test(a))return GLEG[6];if(/GRID/.test(a))return GLEG[5];if(/LOW_GEN/.test(a))return GLEG[3];if(/CLEANING/.test(a))return GLEG[4];
 if(x.today_kwh==null)return GLEG[7];const y=x.kw?x.today_kwh/x.kw:null;if(y==null)return GLEG[1];return y>=3.5?GLEG[0]:y>=2?GLEG[1]:GLEG[2];}
async function genPage(){if(!GMAP){GMAP=L.map('gmap').setView([22.65,88.45],9);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(GMAP);
  gLayer=L.markerClusterGroup({disableClusteringAtZoom:14});GMAP.addLayer(gLayer);$('gLeg').innerHTML=GLEG.map(([c,t])=>`<div class="leg"><span class="dot" style="background:${c}"></span>${t}</div>`).join('');}
 setTimeout(()=>GMAP.invalidateSize(),60);GDATA=await api('/api/gen/map');genDraw(true);}
function genDraw(fit){const b=$('gBrand').value,f=$('gFilter').value,qq=$('gQ').value.toLowerCase();
 const l=GDATA.filter(x=>(!b||x.brand===b)&&(!f||(f==='ALERT'?!!x.alerts:f==='OK'?!x.alerts:!x.project_ext_id))&&(!qq||`${x.name||''} ${x.serial} ${x.city||''}`.toLowerCase().includes(qq)));
 gLayer.clearLayers();let kw=0,today=0,live=0,al=0,nl=0;const pts=[];
 l.forEach(x=>{kw+=+x.kw||0;today+=+x.today_kwh||0;live+=+x.last_power_kw||0;if(x.alerts)al++;const [c,t]=gColor(x);
  if(x.lat==null){nl++;return;}pts.push([x.lat,x.lng]);
  L.circleMarker([x.lat,x.lng],{radius:x.alerts?10:7,color:'#222',weight:1,fillColor:c,fillOpacity:.9}).bindPopup(`<b>${x.name||x.serial}</b>${x.project_ext_id?'':' <i style="color:#ef6c00">(not mapped)</i>'}<br>${x.brand==='SOLARMAN'?'DEYE':x.brand} · SN ${x.serial}<br>${x.kw?x.kw+' kW · ':''}Now ${x.last_power_kw??'-'} kW<br>Today ${x.today_kwh??'-'} kWh ${x.kw&&x.today_kwh!=null?'('+(x.today_kwh/x.kw).toFixed(2)+' kWh/kW)':''}<br>Lifetime ${x.total_kwh!=null?Math.round(x.total_kwh)+' kWh':'-'}<br>Status: <b style="color:${c}">${t}</b>${x.alerts?'<br>Open alerts: <b>'+x.alerts+'</b>':''}${x.no_alerts?'<br><i>Out of warranty – no alerts</i>':''}${x.phone?'<br>'+x.phone:''}<br><a href="#" onclick="dev(${x.id});return false">Open details »</a><br><small>${x.city||''} · updated ${x.last_fetch?new Date(x.last_fetch).toLocaleString('en-IN'):'-'}</small>`).addTo(gLayer);});
 $('gTot').innerHTML=`Systems: <b>${l.length}</b> · ${kw.toFixed(0)} kW<br>Live power: <b>${live.toFixed(1)} kW</b><br>Today: <b>${today.toFixed(0)} kWh</b>${kw?` (${(today/kw).toFixed(2)} kWh/kW)`:''}<br>With open alerts: <b style="color:#c62828">${al}</b>${nl?`<br><span style="color:#ef6c00">${nl} systems have no location yet</span>`:''}`;
 $('gList').innerHTML=l.filter(x=>x.alerts).slice(0,80).map(x=>`<div style="padding:4px 0;border-bottom:1px solid #ddd"><span style="color:${gColor(x)[0]}">●</span> ${x.name||x.serial} – ${x.alerts}</div>`).join('')||'No open alerts 🎉';
 if(fit&&pts.length)GMAP.fitBounds(L.latLngBounds(pts).pad(.1));}
// ---------- Auto-imported inverters to map ----------
async function unmapped(){const d=(await api('/api/rms/devices')).filter(x=>!x.project_ext_id);const canEdit=['admin','manager'].includes(ME.role);
 $('unmapSum').textContent=d.length?`Not linked to an ERP project (${d.length}) – link them here`:'Auto-imported inverters (all linked)';
 $('unmapBox').innerHTML=`<div style="margin-top:10px"></div>
 ${canEdit?'<button class="b" style="width:auto;padding:6px 14px" onclick="discover(\'GROWATT\',this)">Import all Growatt plants now</button> <span class="small">Also runs automatically once a day.</span>':''}
 <datalist id="projList"></datalist>${d.length?`<table style="margin-top:8px"><tr><th>Brand</th><th>Plant name</th><th>City</th><th>Serial</th><th>Logger</th><th>kW</th><th>Today kWh</th><th>Map to project</th></tr>`+
 d.map(x=>`<tr><td>${x.brand==='SOLARMAN'?'DEYE':x.brand}</td><td>${x.plant_name||''}</td><td>${x.city||''}</td><td>${x.serial}</td><td>${x.logger_serial||''}</td><td>${x.kw||''}</td><td>${x.today_kwh??'-'}</td>
 <td>${canEdit?`<input id="mp${x.id}" list="projList" oninput="projSuggest(this.value)" placeholder="Project ID / customer" style="width:170px"> <button onclick="mapDev(${x.id})">Map</button>`:''}</td></tr>`).join('')+'</table>':''}`;}
async function projSuggest(v){if(v.length<2)return;const r=await api('/api/projects/search?q='+encodeURIComponent(v));$('projList').innerHTML=r.map(p=>`<option value="${p.ext_id}">${p.customer} – ${p.pincode||''}</option>`).join('');}
async function mapDev(id){const v=$('mp'+id).value.trim();if(!v)return;const r=await api('/api/rms/devices/'+id,{method:'PUT',body:JSON.stringify({project_ext_id:v})});if(r.error)return alert(r.error);rmsPage(true);}
async function discover(brand,btn){btn.disabled=true;btn.textContent='Importing… (may take a minute)';
 try{const r=await api('/api/rms/discover/'+brand,{method:'POST'});if(r.error)alert(r.error);else alert(`${brand}: ${r.found} plants found, ${r.added} new added${r.complete?'':'. More are still importing – they will finish automatically through the 15-minute job.'}${r.found?'':' – Click "Test connection" on the Growatt card to see Growatt\'s raw reply.'}`);}
 finally{rmsPage(true);}}
async function imp(){const f=$('impFile').files[0];if(!f)return;const fd=new FormData();fd.append('file',f);const r=await fetch('/api/import/'+$('impType').value,{method:'POST',body:fd});$('impRes').textContent=JSON.stringify(await r.json(),null,2);}
async function users(){const u=await api('/api/users');$('uTbl').innerHTML='<table><tr><th>Name</th><th>Username</th><th>Role</th><th>Team</th><th>Active</th><th></th></tr>'+u.map(x=>`<tr><td>${x.name||''}</td><td>${x.username}</td><td>${x.role}</td><td>${x.team||''}</td><td>${x.active?'Yes':'No'}</td><td>${x.active?`<a href="#" onclick="delUser(${x.id})">Disable</a>`:''}</td></tr>`).join('')+'</table>';}
async function addUser(){const r=await api('/api/users',{method:'POST',body:JSON.stringify({name:$('uN').value,username:$('uU').value,password:$('uP').value,role:$('uR').value,team:$('uT').value})});if(r.error)alert(r.error);users();}
async function delUser(id){if(confirm('Disable this user?')){await api('/api/users/'+id,{method:'DELETE'});users();}}
async function erpPullBox(){if(ME.role!=='admin'){$('erpPullBox').innerHTML='';return;}const d=await api('/api/erp-pull');
 const lab={ERP_PULL_BASE:'ERP base URL (e.g. https://erp.example.com/api/v1)',ERP_PULL_KEY:'ERP API key / token (given by ERP team)',ERP_PULL_HEADER:'Header name (default X-API-Key; or Authorization)',ERP_PULL_PROJECTS:'Projects list path (default /projects, "-" = skip)',ERP_PULL_ENQUIRIES:'Enquiries list path (default /enquiries)',ERP_PULL_SERVICE:'Service tickets list path (default /service)'};
 $('erpPullBox').innerHTML=`<details class="fold" open><summary>Pull all projects & enquiries from ERP</summary><p class="small">Fill this once the ERP team gives a <b>read (GET) URL</b>. The app then pulls all projects, enquiries and service tickets every hour (same field names as in the API spec below). The key ERP uses to send data to us is different – that one is shown further down.</p>
 <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:4px 12px">${d.fields.map(f=>`<div><label>${lab[f.key]}${f.key==='ERP_PULL_KEY'&&f.set?' <span class="tag">saved</span>':''}</label><input data-ek="${f.key}" ${f.key==='ERP_PULL_KEY'?'type="password" placeholder="'+(f.set?'•••••• (leave empty to keep)':'')+'"':''} value="${String(f.value).replace(/"/g,'&quot;')}"></div>`).join('')}</div>
 <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><button class="b" style="width:auto" onclick="erpSave()">Save</button><button class="b g" style="width:auto" onclick="erpRun(this)">Pull now</button></div><pre id="erpOut" style="margin-top:10px">${d.last?'Last pull: '+d.last:'Not pulled yet.'}</pre></details>`;}
async function erpSave(){const o={};document.querySelectorAll('[data-ek]').forEach(i=>{if(i.value)o[i.dataset.ek]=i.value;});await api('/api/erp-pull/settings',{method:'POST',body:JSON.stringify(o)});erpPullBox();}
async function erpRun(b){b.disabled=true;b.textContent='Pulling…';try{const r=await api('/api/erp-pull/run',{method:'POST'});$('erpOut').textContent=JSON.stringify(r,null,2);}finally{b.disabled=false;b.textContent='Pull now';}}
async function docs(){erpPullBox();const t=await (await fetch('/docs/raw')).text();let k='';
 if(ME.role==='admin'){try{const x=await api('/api/admin/keys');k=`<div style="background:#fff8e1;border:1px solid #ffb300;border-radius:6px;padding:10px;margin:10px 0"><b>Admin only – keep private</b><br>Cron command (Hostinger cron, every 15 min):<br><code style="word-break:break-all">${x.cron_command}</code><br><br>ERP API key: <code style="word-break:break-all">${x.erp_api_key}</code><br>ERP base URL: <code>${x.erp_base_url}</code></div>`;}catch(e){}}
 $('docBody').innerHTML=k+marked.parse(t);}

// ---------- CSV export of the current RMS view ----------
function rCsv(){const cols=[['customer','Customer'],['phone','Phone'],['area','Area'],['pincode','Pincode'],['project_ext_id','Project'],['brand','Brand'],['serial','Inverter SN'],['logger_serial','Logger SN'],['kw','kW'],['last_power_kw','Now kW'],['today_kwh','Today kWh'],['online','Online'],['alerts','Open alerts'],['no_alerts','Out of warranty'],['last_fetch','Last update']];
 const esc=v=>{v=v==null?'':String(v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;};
 const csv='﻿'+cols.map(c=>c[1]).join(',')+'\n'+RVIEW.map(x=>cols.map(([k])=>esc(k==='online'?(x.online===1?'Online':x.online===0?'Offline':''):k==='no_alerts'?(x.no_alerts?'Yes':''):x[k])).join(',')).join('\n');
 const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download=`inverters-${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);}
// ---------- Inverter detail panel ----------
function closeDev(){$('drawer').classList.remove('open');}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDev();});
async function dev(id){const r=await api('/api/rms/devices/'+id+'/history');if(r.error)return alert(r.error);const d=r.device,[st,label]=rState(d);
 $('dTitle').innerHTML=`<b>${d.customer||d.serial}</b><div class="sub">${[d.area,d.pincode,d.brand==='SOLARMAN'?'DEYE':d.brand,'SN '+d.serial].filter(Boolean).join(' · ')}</div>`;
 const days=r.days,kwh=days.map(x=>+x.kwh||0),avg=kwh.length?kwh.reduce((a,b)=>a+b,0)/kwh.length:0,best=Math.max(0,...kwh),month=kwh.reduce((a,b)=>a+b,0);
 // 30-day bar chart (bars = kWh, dots = nearby systems' median for the same size)
 const W=500,H=170,pad=28,n=Math.max(days.length,1),bw=(W-pad-6)/n,mx=Math.max(1,...kwh,...days.map(x=>(+x.peer_median||0)*(+d.kw||0)))*1.1;
 const vc={OK:'#38f0c8',DIRTY:'#ffad3b',LOW:'#ff5d6c',CLOUDY:'#7f9aa3'};
 const bars=days.map((x,i)=>{const h=(+x.kwh||0)/mx*(H-pad-8),X=pad+i*bw+1;return `<rect x="${X.toFixed(1)}" y="${(H-pad-h).toFixed(1)}" width="${Math.max(2,bw-3).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${vc[x.verdict]||'#3ec7ff'}" opacity=".85"><title>${x.day}: ${(+x.kwh||0).toFixed(1)} kWh${x.verdict?' · '+x.verdict:''}</title></rect>`;}).join('');
 const peers=days.map((x,i)=>x.peer_median&&d.kw?`<circle cx="${(pad+i*bw+bw/2).toFixed(1)}" cy="${(H-pad-(x.peer_median*d.kw)/mx*(H-pad-8)).toFixed(1)}" r="2.6" style="fill:var(--ink)"><title>Nearby median: ${(x.peer_median*d.kw).toFixed(1)} kWh</title></circle>`:'').join('');
 const ax=[0,.5,1].map(f=>`<text x="2" y="${(H-pad-f*(H-pad-8)+4).toFixed(1)}" font-size="9" fill="#7f9aa3" font-family="JetBrains Mono,monospace">${Math.round(mx*f)}</text><line x1="${pad}" x2="${W}" y1="${(H-pad-f*(H-pad-8)).toFixed(1)}" y2="${(H-pad-f*(H-pad-8)).toFixed(1)}" stroke="rgba(56,240,200,.08)"/>`).join('');
 const lbl=days.length?`<text x="${pad}" y="${H-8}" font-size="9" fill="#7f9aa3" font-family="JetBrains Mono,monospace">${days[0].day.slice(5)}</text><text x="${W-4}" y="${H-8}" text-anchor="end" font-size="9" fill="#7f9aa3" font-family="JetBrains Mono,monospace">${days[days.length-1].day.slice(5)}</text>`:'';
 $('dBody').innerHTML=`<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><span class="pill p-${st}">${label}</span>${d.no_alerts?'<span class="tag">Out of warranty</span>':''}${d.project_ext_id?`<span class="tag">${d.project_ext_id}</span>`:'<span class="tag warn">Not linked</span>'}
  ${d.phone?`<a class="mini" style="text-decoration:none" href="tel:${d.phone}">📞 ${d.phone}</a><a class="mini" style="text-decoration:none" target="_blank" rel="noopener" href="https://wa.me/91${String(d.phone).slice(-10)}">WhatsApp</a>`:''}</div>
 <div class="kv"><div><b>${f2(d.kw,2)}</b><span>System kW</span></div><div><b>${f2(d.last_power_kw,2)}</b><span>Now kW</span></div><div><b>${f2(d.today_kwh)}</b><span>Today kWh</span></div>
  <div><b>${avg?avg.toFixed(1):'–'}</b><span>Avg kWh/day</span></div><div><b>${best?best.toFixed(1):'–'}</b><span>Best day</span></div><div><b>${month?Math.round(month):'–'}</b><span>Last 30 days</span></div></div>
 <h4>Last 30 days</h4><div class="chart">${days.length?`<svg viewBox="0 0 ${W} ${H}" width="100%">${ax}${bars}${peers}${lbl}</svg><div class="sub" style="padding:4px 2px 6px">Bars: <span style="color:#38f0c8">normal</span> · <span style="color:#ffad3b">dusty</span> · <span style="color:#ff5d6c">low</span> · <span style="color:#7f9aa3">cloudy day</span> &nbsp; Dots: nearby systems (same size)</div>`:'<p class="small">No daily history yet – it builds up automatically every day.</p>'}</div>
 <div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0"><button class="mini" onclick="rTest(${d.id})">Test now (raw reply)</button>${['admin','manager'].includes(ME.role)?`<button class="mini" onclick="rEdit(${d.id},'${d.project_ext_id||''}')">Link to project</button><button class="mini" onclick="warranty('${d.serial}',${!d.no_alerts}).then(()=>dev(${d.id}))">${d.no_alerts?'Alerts on':'Warranty off'}</button>`:''}</div>
 <h4>Alert history</h4>${r.alerts.length?r.alerts.map(a=>`<div class="tgrp"><b style="color:${ATYPE[a.type]||'var(--ink)'}">${ANAME[a.type]||a.type}</b> <span class="pill ${a.status==='OPEN'?'p-bad':'p-ok'}">${a.status}</span><div class="sub">${a.message||''}</div><div class="sub">${new Date(a.opened_at).toLocaleString('en-IN')}${a.resolved_at?' → '+new Date(a.resolved_at).toLocaleString('en-IN')+' ('+(a.resolved_by||'')+')':''}${a.engineer?' · Engineer: '+a.engineer:''}</div></div>`).join(''):'<p class="small">No alerts so far 🎉</p>'}`;
 $('drawer').classList.add('open');}
// ---------- Today's action board ----------
let TODAY=null;
async function todayPage(){const [devs,als]=await Promise.all([api('/api/rms/devices'),api('/api/alerts?status=OPEN')]);RDATA=devs;
 const byArea=l=>{const g={};l.forEach(x=>{const k=(x.area||'Unknown area').split(',')[0].trim();(g[k]=g[k]||[]).push(x);});return Object.entries(g).sort((a,b)=>b[1].length-a[1].length);};
 const off=devs.filter(x=>x.online===0&&!x.no_alerts),nodata=devs.filter(x=>x.last_error&&!/^ALARM/.test(x.last_error)),due=als.filter(a=>a.due),
  clean=als.filter(a=>a.type==='CLEANING'||a.type==='LOW_GEN'),fault=als.filter(a=>a.type==='FAULT'),grid=als.filter(a=>a.type==='GRID');
 const withY=devs.filter(x=>x.kw&&x.today_kwh!=null).map(x=>({...x,y:x.today_kwh/x.kw})).sort((a,b)=>b.y-a.y);
 const on=devs.filter(x=>x.online===1).length,live=devs.reduce((a,x)=>a+(+x.last_power_kw||0),0),tk=devs.reduce((a,x)=>a+(+x.today_kwh||0),0);
 TODAY={on,n:devs.length,live,tk,off,due,clean,fault,grid,nodata,byArea};
 const row=x=>`<div class="trow"><div class="nm"><a href="#" class="lnk" onclick="dev(${x.id});return false">${x.customer||x.serial}</a><div class="sub">${x.brand} · ${x.serial}${x.offline_since?' · offline since '+new Date(x.offline_since).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}):''}</div></div>${x.phone?`<a class="call" href="tel:${x.phone}">📞 ${x.phone}</a>`:''}</div>`;
 const devOf=a=>devs.find(d=>d.serial===a.serial)||{id:0,serial:a.serial,customer:a.customer,brand:a.brand,area:a.area,phone:a.phone};
 const sec=(title,list,empty)=>`<div class="tsec"><h4>${title} (${list.length})</h4>${list.length?byArea(list).map(([ar,l])=>`<div class="tgrp"><div class="ar">${ar} · ${l.length} <button class="mini" style="float:right" onclick='routeFrom(${JSON.stringify(l.map(x=>x.serial))})'>➜ Plan route</button></div>${l.map(row).join('')}</div>`).join(''):`<p class="small">${empty}</p>`}</div>`;
 $('tBody').innerHTML=`<div class="core">${[[`${on}/${devs.length}`,'Online now'],[`${live.toFixed(1)} kW`,'Live power'],[`${Math.round(tk)} kWh`,'Generated today'],[String(off.length),'Offline'],[String(due.length),'Questions due']].map(([v,l])=>`<div class="gauge"><div><div class="gv">${v}</div><div class="gl">${l}</div></div></div>`).join('')}</div>
 ${sec('⚠ Inverter faults – engineer needed',fault.map(devOf),'No inverter faults.')}
 ${sec('● Offline now',off,'Nothing offline right now.')}
 ${sec('🧽 Cleaning / low generation – plan visits by area',clean.map(devOf),'No cleaning or low-generation alerts.')}
 ${sec('⚡ Grid / power cut (no engineer, wait)',grid.map(devOf),'No grid faults.')}
 ${sec('❓ Follow-up questions due',due.map(devOf),'No questions due.')}
 ${nodata.length?sec('No data from inverter cloud',nodata,''):''}
 <div class="tsec"><h4>Best & weakest today (kWh per kW)</h4><div class="two-col" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px">
  <div class="tgrp"><div class="ar">Top 5</div>${withY.slice(0,5).map(x=>`<div class="trow"><div class="nm"><a href="#" class="lnk" onclick="dev(${x.id});return false">${x.customer||x.serial}</a></div><b style="color:var(--ok)">${x.y.toFixed(2)}</b></div>`).join('')||'<p class="small">–</p>'}</div>
  <div class="tgrp"><div class="ar">Weakest 5 (online)</div>${withY.filter(x=>x.online===1).slice(-5).reverse().map(x=>`<div class="trow"><div class="nm"><a href="#" class="lnk" onclick="dev(${x.id});return false">${x.customer||x.serial}</a></div><b style="color:var(--amber)">${x.y.toFixed(2)}</b></div>`).join('')||'<p class="small">–</p>'}</div></div></div>`;}
function waShare(){if(!TODAY)return;const t=TODAY,dt=new Date().toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
 const names=(l,max=15)=>t.byArea(l).map(([ar,x])=>`• ${ar}: ${x.slice(0,max).map(y=>y.customer||y.serial).join(', ')}`).join('\n');
 const devOf=a=>RDATA.find(d=>d.serial===a.serial)||{customer:a.customer,serial:a.serial,area:a.area};
 let m=`*Smart Evergreen – ${dt}*\nOnline ${t.on}/${t.n} · Live ${t.live.toFixed(1)} kW · Today ${Math.round(t.tk)} kWh`;
 if(t.fault.length)m+=`\n\n*Faults – engineer needed (${t.fault.length})*\n`+names(t.fault.map(devOf));
 if(t.off.length)m+=`\n\n*Offline (${t.off.length})*\n`+names(t.off);
 if(t.clean.length)m+=`\n\n*Cleaning / low generation (${t.clean.length})*\n`+names(t.clean.map(devOf));
 if(t.grid.length)m+=`\n\n*Grid fault – wait (${t.grid.length})*\n`+names(t.grid.map(devOf));
 if(t.due.length)m+=`\n\nFollow-up questions due: ${t.due.length}`;
 window.open('https://wa.me/?text='+encodeURIComponent(m.slice(0,3500)),'_blank','noopener');}

// ---------- Route planner ----------
let RMAP,RLAY,RP={start:null,stops:[],id:null},RPICK=null,RROAD=null,rpT;
const OFFICE=()=>{const o=String(ME?.office||'22.6470,88.4400').split(',').map(Number);return{name:'Evergreen Solar office',lat:o[0],lng:o[1]};};
async function routePage(){if(!RMAP){RMAP=L.map('rmap').setView([22.65,88.45],10);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(RMAP);RLAY=L.layerGroup().addTo(RMAP);
  RMAP.on('click',async e=>{if(!RPICK)return;const p={name:'Pinned location',lat:+e.latlng.lat.toFixed(6),lng:+e.latlng.lng.toFixed(6)};if(RPICK==='start')RP.start=p;else RP.stops.push(p);RPICK=null;$('rmap').style.cursor='';rpDraw();});
  if(!$('rpDate').value)$('rpDate').value=new Date(Date.now()+864e5).toISOString().slice(0,10);}
 setTimeout(()=>RMAP.invalidateSize(),60);if(!RP.start)RP.start=OFFICE();rpDraw();rpSaved();}
function rpPickMode(m){RPICK=m;$('rmap').style.cursor='crosshair';alert(m==='start'?'Click on the map where the engineer starts (home / office).':'Click on the map to add a site.');}
function rpStartOffice(){RP.start=OFFICE();rpDraw();}
function rpFind(which){clearTimeout(rpT);const inp=$(which==='start'?'rpStartQ':'rpQ'),box=$(which==='start'?'rpStartRes':'rpRes'),t=inp.value.trim();if(t.length<2){box.style.display='none';return;}
 rpT=setTimeout(async()=>{const [sites,places]=await Promise.all([which==='stop'?api('/api/route/search?q='+encodeURIComponent(t)):Promise.resolve([]),t.length>=3?api('/api/geo?q='+encodeURIComponent(t)).catch(()=>[]):Promise.resolve([])]);
  window._rpRes=[...sites.map(x=>({...x,src:'site'})),...places.map(x=>({kind:'Place',name:x.name.split(',').slice(0,3).join(','),address:x.name,lat:x.lat,lng:x.lng,src:'place'}))];
  box.innerHTML=window._rpRes.map((x,i)=>`<div onclick="rpPick('${which}',${i})"><i>${x.kind}</i><b>${x.name||x.ref||''}</b>${x.phone?' · '+x.phone:''}<div class="sub">${[x.ref&&x.src==='site'?x.ref:'',x.area,x.pincode,x.info].filter(Boolean).join(' · ')}${x.lat==null?' · <span style="color:var(--amber)">no location yet</span>':''}</div></div>`).join('')||'<div class="sub">Nothing found</div>';box.style.display='block';},350);}
async function rpPick(which,i){const x=window._rpRes[i];$(which==='start'?'rpStartRes':'rpRes').style.display='none';$(which==='start'?'rpStartQ':'rpQ').value='';
 let p={name:x.name||x.ref,phone:x.phone||'',address:x.src==='place'?x.address:[x.address,x.area,x.pincode].filter(Boolean).join(', '),ref:x.src==='site'?x.ref:'',kind:x.kind,lat:x.lat,lng:x.lng};
 if(p.lat==null&&(x.pincode||x.area)){const g=await api('/api/geo?q='+encodeURIComponent(x.pincode||x.area)).catch(()=>[]);if(g[0]){p.lat=g[0].lat;p.lng=g[0].lng;p.approx=true;}}
 if(p.lat==null)return alert('This site has no location yet. Add it with "Pick on map" instead.');
 if(which==='start')RP.start=p;else RP.stops.push(p);rpDraw();}
function rpMove(i,d){const j=i+d;if(j<0||j>=RP.stops.length)return;[RP.stops[i],RP.stops[j]]=[RP.stops[j],RP.stops[i]];rpDraw();}
function rpDel(i){RP.stops.splice(i,1);rpDraw();}
function rpOptimize(){if(RP.stops.length<3&&!RP.start)return;const s=RP.start,l=[...RP.stops],back=$('rpBack').checked,D=(a,b)=>dist(a.lat,a.lng,b.lat,b.lng);
 let cur=s,ord=[];while(l.length){let bi=0;l.forEach((x,i)=>{if(D(cur,x)<D(cur,l[bi]))bi=i;});cur=l.splice(bi,1)[0];ord.push(cur);}
 const len=o=>{let t=D(s,o[0]);for(let i=1;i<o.length;i++)t+=D(o[i-1],o[i]);return t+(back?D(o[o.length-1],s):0);};
 let imp=true;while(imp){imp=false;for(let i=0;i<ord.length-1;i++)for(let k=i+1;k<ord.length;k++){const n=[...ord.slice(0,i),...ord.slice(i,k+1).reverse(),...ord.slice(k+1)];if(len(n)<len(ord)-1e-6){ord=n;imp=true;}}}
 RP.stops=ord;rpDraw();}
function dist(a,b,c,d){const t=Math.PI/180,x=Math.sin((c-a)*t/2)**2+Math.cos(a*t)*Math.cos(c*t)*Math.sin((d-b)*t/2)**2;return 12742*Math.asin(Math.sqrt(x));}
function rpPts(){const p=[RP.start,...RP.stops].filter(Boolean);if($('rpBack').checked&&RP.start&&RP.stops.length)p.push(RP.start);return p;}
async function rpDraw(){const s=RP.start;$('rpStartBox').innerHTML=s?`<div class="rstop"><div class="no" style="background:#ffc34d">S</div><div class="tx"><b>${s.name}</b><div class="sub">${s.address||(s.lat.toFixed(4)+', '+s.lng.toFixed(4))}</div></div></div>`:'';
 $('rpList').innerHTML=RP.stops.map((x,i)=>`<div class="rstop"><div class="no">${i+1}</div><div class="tx"><b>${x.name}</b>${x.kind?` <span class="tag">${x.kind}</span>`:''}<div class="sub">${[x.phone,x.address].filter(Boolean).join(' · ')}${x.approx?' · <span style="color:var(--amber)">approx. (pincode)</span>':''}</div><div class="sub" id="leg${i}"></div></div>
  <div class="bt"><button class="mini" onclick="rpMove(${i},-1)">▲</button><button class="mini" onclick="rpMove(${i},1)">▼</button><button class="mini del" onclick="rpDel(${i})">✕</button></div></div>`).join('')||'<p class="small">No sites yet – search above or pick on the map.</p>';
 if(!RMAP)return;RLAY.clearLayers();const pts=rpPts();
 if(s)L.marker([s.lat,s.lng],{icon:L.divIcon({className:'rnum st',html:'<b>S</b>',iconSize:[26,26]})}).bindPopup('<b>Start</b><br>'+s.name).addTo(RLAY);
 RP.stops.forEach((x,i)=>L.marker([x.lat,x.lng],{icon:L.divIcon({className:'rnum',html:`<b>${i+1}</b>`,iconSize:[26,26]})}).bindPopup(`<b>${i+1}. ${x.name}</b><br>${x.phone||''}<br>${x.address||''}`).addTo(RLAY));
 if(pts.length>1){const line=L.polyline(pts.map(p=>[p.lat,p.lng]),{color:'#38f0c8',weight:3,dashArray:'6 6',opacity:.8}).addTo(RLAY);RMAP.fitBounds(line.getBounds().pad(.15));}
 else if(s)RMAP.setView([s.lat,s.lng],11);
 // straight-line estimate first, then real road distance if available
 let km=0;for(let i=1;i<pts.length;i++)km+=dist(pts[i-1].lat,pts[i-1].lng,pts[i].lat,pts[i].lng)*1.3;
 $('rpSum').innerHTML=pts.length>1?`≈ ${km.toFixed(0)} km · ≈ ${fmtMin(km/28*60)} driving (estimate)`:'';RROAD=null;
 if(pts.length>1){const key=JSON.stringify(pts.map(p=>[p.lat,p.lng]));const r=await api('/api/route/road',{method:'POST',body:JSON.stringify({points:pts})}).catch(()=>({}));
  if(r.ok&&key===JSON.stringify(rpPts().map(p=>[p.lat,p.lng]))){RROAD=r;L.polyline(r.line,{color:'#3ec7ff',weight:5,opacity:.85}).addTo(RLAY);
   $('rpSum').innerHTML=`Road distance <b>${r.km.toFixed(1)} km</b> · driving <b>${fmtMin(r.min)}</b> · ${RP.stops.length} stops`;
   r.legs.forEach((l,i)=>{const e=$('leg'+i);if(e)e.textContent=`↳ ${l.km.toFixed(1)} km · ${fmtMin(l.min)} from previous`;});}}}
const fmtMin=m=>m<60?Math.round(m)+' min':Math.floor(m/60)+' h '+Math.round(m%60)+' min';
// Google Maps allows ~9 waypoints per link → long routes are split into parts
function rpLinks(){const pts=rpPts();if(pts.length<2)return[];const ll=p=>`${(+p.lat).toFixed(6)},${(+p.lng).toFixed(6)}`,out=[];
 for(let i=0;i<pts.length-1;i+=10){const seg=pts.slice(i,i+11);const o=seg[0],d=seg[seg.length-1],w=seg.slice(1,-1);
  out.push(`https://www.google.com/maps/dir/?api=1&origin=${ll(o)}&destination=${ll(d)}${w.length?'&waypoints='+encodeURIComponent(w.map(ll).join('|')):''}&travelmode=driving`);}
 return out;}
function rpMsg(){const s=RP.start,links=rpLinks(),d=$('rpDate').value?new Date($('rpDate').value).toLocaleDateString('en-IN',{weekday:'short',day:'2-digit',month:'short'}):'';
 let m=`*${$('rpPurpose').value} route${d?' – '+d:''}*${$('rpPerson').value?'\n'+$('rpPerson').value:''}\n\n*Start:* ${s?s.name:''}`;
 RP.stops.forEach((x,i)=>{m+=`\n\n*${i+1}. ${x.name}*`+(x.phone?`\n📞 ${x.phone}`:'')+(x.address?`\n📍 ${x.address}`:'')+(x.ref?`\nRef: ${x.ref}`:'')+`\nMap: https://maps.google.com/?q=${(+x.lat).toFixed(6)},${(+x.lng).toFixed(6)}`;});
 if($('rpBack').checked)m+=`\n\n*Return to start*`;
 if(RROAD)m+=`\n\nTotal ≈ ${RROAD.km.toFixed(0)} km · ${fmtMin(RROAD.min)} driving`;
 m+=`\n\n*Full route (tap to navigate):*\n`+links.map((l,i)=>(links.length>1?`Part ${i+1}: `:'')+l).join('\n');
 return m+`\n\n– Evergreen Solar · 7074833525`;}
function rpCheck(){if(!RP.start||!RP.stops.length){alert('Add a start point and at least one site.');return false;}return true;}
function rpWhatsApp(){if(!rpCheck())return;const ph=$('rpPhone').value.replace(/\D/g,'').slice(-10);window.open(`https://wa.me/${ph?'91'+ph:''}?text=${encodeURIComponent(rpMsg())}`,'_blank','noopener');}
function rpOpenMaps(){if(!rpCheck())return;rpLinks().forEach(l=>window.open(l,'_blank','noopener'));}
async function rpCopy(){if(!rpCheck())return;try{await navigator.clipboard.writeText(rpMsg());alert('Message copied – paste it anywhere.');}catch(e){prompt('Copy this message:',rpMsg());}}
async function rpSave(){if(!rpCheck())return;const name=prompt('Route name',`${$('rpPurpose').value} – ${$('rpPerson').value||'engineer'} – ${$('rpDate').value}`);if(!name)return;
 const r=await api('/api/routes',{method:'POST',body:JSON.stringify({id:RP.id,name,route_date:$('rpDate').value,person:$('rpPerson').value,phone:$('rpPhone').value,purpose:$('rpPurpose').value,start:RP.start,stops:RP.stops,back:$('rpBack').checked})});
 if(r.error)return alert(r.error);RP.id=r.id;rpSaved();}
async function rpSaved(){const l=await api('/api/routes').catch(()=>[]);$('rpSaved').innerHTML=l.map(r=>`<div class="trow"><div class="nm"><a href="#" class="lnk" onclick="rpLoad(${r.id});return false">${r.name}</a><div class="sub">${r.route_date||''} · ${r.person||''} · by ${r.created_by||''}</div></div>${['admin','manager'].includes(ME.role)?`<button class="mini del" onclick="rpDelSaved(${r.id})">✕</button>`:''}</div>`).join('')||'No saved routes yet.';}
async function rpLoad(id){const r=await api('/api/routes/'+id);RP={start:r.data.start,stops:r.data.stops||[],id:r.id};$('rpBack').checked=!!r.data.back;$('rpPerson').value=r.person||'';$('rpPhone').value=r.phone||'';$('rpDate').value=r.route_date||'';if(r.purpose)$('rpPurpose').value=r.purpose;rpDraw();}
async function rpDelSaved(id){if(!confirm('Delete this saved route?'))return;await api('/api/routes/'+id,{method:'DELETE'});if(RP.id===id)RP.id=null;rpSaved();}
function rpClear(){RP={start:OFFICE(),stops:[],id:null};$('rpPerson').value='';$('rpPhone').value='';rpDraw();}
// From Today board: plan a route for one area
function routeFrom(serials){const add=RDATA.filter(d=>serials.includes(d.serial)&&d.lat!=null).map(d=>({name:d.customer||d.serial,phone:d.phone||'',address:[d.area,d.pincode].filter(Boolean).join(', '),ref:d.serial,kind:'Inverter site',lat:+d.lat,lng:+d.lng}));
 if(!add.length)return alert('These sites have no location yet.');RP.stops=add;RP.id=null;$('rpPurpose').value='Service / maintenance';show(document.querySelector('header button[data-p=routePage]'));setTimeout(rpOptimize,300);}
document.addEventListener('click',e=>{if(!e.target.closest('.srch'))document.querySelectorAll('.sres').forEach(b=>b.style.display='none');});

// ---------- Data check (what arrived from ERP / Excel) ----------
async function dataStatus(){const d=await api('/api/data-status');if(d.error){$('dataStatus').innerHTML='';return;}
 const card=(t,x)=>`<div class="gauge"><div><div class="gv">${x.n}</div><div class="gl">${t}</div><div class="sub" style="color:${x.n-x.located?'var(--amber)':'var(--ok)'}">${x.located||0} on map${x.n-x.located?` · ${x.n-x.located} no location`:''}</div></div></div>`;
 const tbl=(rows,a,b)=>rows.length?'<table style="margin-top:6px">'+rows.map(r=>`<tr><td>${r[a]??'<i>(empty)</i>'}</td><td class="n">${r[b]}</td></tr>`).join('')+'</table>':'<p class="small">–</p>';
 const push=Object.entries(d.erp_last_push||{}).map(([t,v])=>`<div class="trow"><div class="nm"><b>${t}</b><div class="sub">last push ${new Date(v.at).toLocaleString('en-IN')} · ${v.saved}/${v.received} saved${v.failed?` · <span style="color:var(--red)">${v.failed} failed</span>`:''} · total received so far ${v.total_received}</div></div></div>`).join('')||'<p class="small" style="color:var(--amber)">ERP has not pushed any data yet.</p>';
 $('dataStatus').innerHTML=`<div class="core">${card('Projects',d.projects)}${card('Enquiries',d.enquiries)}${card('Service tickets',d.service)}<div class="gauge"><div><div class="gv">${d.survey_enquiries}</div><div class="gl">Survey requests in enquiries</div></div></div></div>
 <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="b" style="width:auto" onclick="fixLoc(this)">Fill missing locations from pincode</button><button class="b g" style="width:auto" onclick="dataStatus()">↻ Refresh</button></div>
 <h4>From ERP</h4><div class="tgrp">${push}${d.erp_pull?`<div class="sub">Last pull: ${d.erp_pull}</div>`:''}</div>
 <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px">
  <div><h4>Project stages</h4>${tbl(d.project_stages.map(r=>({...r,stage:NAMES[r.stage]||r.stage})),'stage','n')}</div>
  <div><h4>ERP stage names not recognised (shown as "Other")</h4>${tbl(d.unrecognised_stages,'stage_label','n')}</div>
  <div><h4>Enquiry status values</h4>${tbl(d.enquiry_statuses,'status','n')}</div>
  <div><h4>Pincodes with no location</h4>${tbl(d.no_location_pincodes,'pincode','n')}<p class="small">Add these in Excel import → type "pincodes" (pincode, lat, lng, area) if they stay here.</p></div></div>`;}
async function fixLoc(b){b.disabled=true;b.textContent='Working…';const r=await api('/api/data-status/fix-locations',{method:'POST'});b.disabled=false;alert(`${r.located} records got a location.`);dataStatus();}

// ---------- Map: work buckets (one click = one workflow stage) ----------
const BK=[['SURVEY','Site survey','#fb8c00'],['DESIGN','Design','#ba68c8'],['AGREEMENT','Agreement','#5c6bc0'],['DISPATCH','Dispatch','#e53935'],['INSTALL','Installation','#8e24aa'],['NETMETER','Net metering','#00acc1'],['DOCS','Documents','#26a69a'],['COMPLETED','Completed','#2e9e44'],['ENQUIRY','Enquiries','#9e9e9e'],['SERVICE','Service','#0091ea'],['OTHER','Other / unknown','#8d6e63']];
let MB=(()=>{try{return localStorage.getItem('ef_mb')||'SURVEY'}catch(e){return 'SURVEY'}})(),MITEMS=[],MSEL=new Set(),MCOUNTS={},MSUB='';
function mChipsRender(){$('mChips').innerHTML=BK.filter(([k])=>k!=='OTHER'||(MCOUNTS.OTHER?.n||0)>0).map(([k,t,c])=>{const x=MCOUNTS[k]||{n:'…'},d=x.delta;
 return `<button class="mchip ${MB===k?'on':''}" style="--c:${c}" onclick="mBucket('${k}')"><span>${t}${d?`<small class="${d>0?'up':'dn'}">${d>0?'▲ +'+d:'▼ '+d} since ${MCOUNTS._since?MCOUNTS._since.slice(5):'yesterday'}</small>`:''}</span><b>${x.n}</b></button>`;}).join('');}
function advApply(){MB='ADV';mChipsRender();$('mItems').innerHTML='';$('mActions').innerHTML='';$('mHead').innerHTML='Showing advanced filter result.';load();}
async function mBucket(c,keep){if(c!==MB){MSEL.clear();MSUB='';}MB=c;try{localStorage.setItem('ef_mb',c);}catch(e){}
 const [items,counts]=await Promise.all([api('/api/map/bucket?c='+c),api('/api/map/counts')]);MITEMS=items;MCOUNTS=counts;mChipsRender();mDraw(keep);}
const mColor=x=>x.kind==='Service'?(SVC[x.stage_label]||'#0091ea'):(COLORS[x.stage]||'#9e9e9e');
function mView(){const qq=($('mFind').value||'').toLowerCase().trim();return MITEMS.filter(x=>(!MSUB||x.stage===MSUB)&&(!qq||`${x.name||''} ${x.ref} ${x.area||''} ${x.pincode||''} ${x.engineer||''} ${x.phone||''}`.toLowerCase().includes(qq)));}
function mDraw(keepView){projLayer.clearLayers();enqLayer.clearLayers();const l=mView(),bk=BK.find(b=>b[0]===MB)||BK[0],on=l.filter(x=>x.lat!=null);
 on.forEach(x=>{const c=mColor(x),sel=MSEL.has(x.ref);
  x._m=L.circleMarker([x.lat,x.lng],{radius:sel?11:8,weight:sel?3:1.5,color:sel?'#fff':'#111',fillColor:c,fillOpacity:.92}).bindPopup(()=>`<b>${x.name||''}</b> <span class="sub">(${x.kind} ${x.ref})</span><br><b style="color:${c}">${x.kind==='Service'?x.stage_label+' ticket':NAMES[x.stage]||x.stage}</b>${x.stage_label&&x.kind!=='Service'?' – '+x.stage_label:''}<br>${x.days!=null?`Waiting <b>${x.days}</b> days (since ${fmt(x.since)})<br>`:''}${x.engineer?'Engineer: '+x.engineer+'<br>':''}${x.capacity_kw?x.capacity_kw+' kW<br>':''}${x.issue?x.issue+'<br>':''}${[x.address,x.area,x.pincode].filter(Boolean).join(', ')}<br>${x.phone?`<a href="tel:${x.phone}">📞 ${x.phone}</a> · `:''}<a target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${x.lat},${x.lng}">Directions</a><br><a href="#" onclick="mToggle('${x.ref}');return false">${MSEL.has(x.ref)?'✓ Selected for route (tap to remove)':'+ Select for route'}</a>`).addTo(projLayer);});
 if(on.length&&!keepView)map.fitBounds(L.latLngBounds(on.map(x=>[x.lat,x.lng])).pad(.12));
 const s=MCOUNTS.SURVEY||{};
 $('mHead').innerHTML=`<b style="color:${bk[2]}">${bk[1]}</b>: <b>${l.length}</b> ${l.length!==MITEMS.length?`of ${MITEMS.length} `:''}· on map ${on.length}${l.length-on.length?` · <span style="color:var(--amber)">${l.length-on.length} without location</span>`:''}`+
  (MB==='SURVEY'?`<div class="subf"><button class="mini" style="${MSUB===''?'border-color:var(--neon)':''}" onclick="MSUB='';mDraw(true)">All</button><button class="mini" style="${MSUB==='SURVEY_REQUESTED'?'border-color:var(--neon)':''}" onclick="MSUB='SURVEY_REQUESTED';mDraw(true)">Requested · ${s.requested??''}</button><button class="mini" style="${MSUB==='SURVEY_SCHEDULED'?'border-color:var(--neon)':''}" onclick="MSUB='SURVEY_SCHEDULED';mDraw(true)">Scheduled · ${s.scheduled??''}</button></div>`:'');
 const nSel=[...MSEL].filter(r=>MITEMS.some(x=>x.ref===r)).length;
 $('mActions').innerHTML=`<button class="mini" onclick="mSelAll(true)">Select all</button><button class="mini" onclick="mSelAll(false)">None</button><button class="mini" style="border-color:var(--neon)" onclick="mRoute()">➜ Route ${nSel?'('+nSel+')':'(all on map)'}</button><button class="mini" onclick="mWa()">WhatsApp list</button>`;
 $('mItems').innerHTML=l.length?l.slice(0,400).map((x,i)=>`<div class="mitem" onclick="mFocus('${x.ref}',event)"><input type="checkbox" ${MSEL.has(x.ref)?'checked':''} onclick="event.stopPropagation();mToggle('${x.ref}')"><div class="nm"><b>${x.name||x.ref}</b>${x.kind==='Enquiry'&&MB==='SURVEY'?' <span class="tag">enquiry</span>':''}<div class="sub">${[x.area,x.pincode].filter(Boolean).join(' · ')}${x.stage_label?' · '+x.stage_label:''}${x.engineer?' · '+x.engineer:''}${x.lat==null?' · <span style="color:var(--amber)">no location</span>':''}</div></div><span class="dy ${x.days>14?'old':x.days>7?'mid':''}">${x.days!=null?x.days+' d':''}</span></div>`).join(''):'<p class="small" style="margin-top:10px">Nothing pending here 🎉</p>';}
function mToggle(r){MSEL.has(r)?MSEL.delete(r):MSEL.add(r);map.closePopup();mDraw(true);}
function mSelAll(v){mView().forEach(x=>v?MSEL.add(x.ref):MSEL.delete(x.ref));mDraw(true);}
function mFocus(r,e){const x=MITEMS.find(y=>y.ref===r);if(!x)return;if(x.lat==null)return alert('This record has no location yet (pincode not found).');map.setView([x.lat,x.lng],Math.max(map.getZoom(),14));setTimeout(()=>x._m&&x._m.openPopup(),250);}
function mRoute(){let l=mView().filter(x=>x.lat!=null);const sel=l.filter(x=>MSEL.has(x.ref));if(sel.length)l=sel;if(!l.length)return alert('No sites with a location to route.');
 if(l.length>25&&!confirm(`${l.length} sites – that is a lot for one day. Use the first 25 (oldest first)?`))return;l=l.slice(0,25);
 RP.stops=l.map(x=>({name:x.name||x.ref,phone:x.phone||'',address:[x.address,x.area,x.pincode].filter(Boolean).join(', '),ref:x.ref,kind:x.kind,lat:+x.lat,lng:+x.lng}));RP.id=null;
 $('rpPurpose').value={SURVEY:'Site survey',DISPATCH:'Material delivery',INSTALL:'Installation',SERVICE:'Service / maintenance'}[MB]||'Other';
 show(document.querySelector('header button[data-p=routePage]'));setTimeout(rpOptimize,400);}
function mWa(){const l=mView(),bk=BK.find(b=>b[0]===MB)||BK[0];const sel=l.filter(x=>MSEL.has(x.ref)),use=sel.length?sel:l;
 let m=`*${bk[1]} pending – ${use.length}* (${new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short'})})`;
 use.slice(0,60).forEach((x,i)=>{m+=`\n${i+1}. ${x.name||x.ref} – ${[x.area,x.pincode].filter(Boolean).join(' ')}${x.phone?' – '+x.phone:''}${x.days!=null?' – '+x.days+' d':''}`;});
 if(use.length>60)m+=`\n… and ${use.length-60} more`;window.open('https://wa.me/?text='+encodeURIComponent(m),'_blank','noopener');}

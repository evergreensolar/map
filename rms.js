// RMS (inverter remote monitoring) connectors.
// Each connector: async fetchDevice(serial, cfg) -> {power_kw, today_kwh, total_kwh, online, raw}
// NOTE: endpoint paths follow each vendor's public OpenAPI docs; verify against the docs/keys you receive.
const crypto=require('crypto');
const num=v=>{const n=parseFloat(v);return isNaN(n)?null:n;};
const tokens={};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let SETTINGS={};const E=k=>SETTINGS[k]||process.env[k]||'';
function setSettings(o){SETTINGS=o||{};for(const k in tokens)delete tokens[k];}
const connectors={
 GROWATT:{ // Growatt OpenAPI v1 – one dealer/installer token gives ALL plants
  env:['GROWATT_TOKEN','GROWATT_BASE'],
  base(){let b=(E('GROWATT_BASE')||'https://openapi.growatt.com/v1').trim().replace(/\/+$/,'');if(!/\/v1$/.test(b))b+='/v1';return b;},
  lastRaw:null,
  async get(path,retry=1){let r,txt;
   try{r=await fetch(this.base()+path,{headers:{token:String(E('GROWATT_TOKEN')).trim()},signal:AbortSignal.timeout(25000)});txt=await r.text();}
   catch(e){throw new Error('Growatt: cannot reach '+this.base()+' ('+(e.name==='TimeoutError'?'timeout':e.message)+')');}
   let j;try{j=JSON.parse(txt);}catch(e){throw new Error('Growatt: HTTP '+r.status+', not JSON: '+txt.replace(/\s+/g,' ').slice(0,200));}
   this.lastRaw=j;const code=j.error_code!=null?+j.error_code:0;
   if(code===10012&&retry>0){await sleep(5000);return this.get(path,retry-1);} // error_frequently_access
   if(code!==0){const hint={10011:' (token wrong, or account is on another Growatt server – check GROWATT_BASE)',10012:' (too many requests – Growatt rate limit, try again in a few minutes)'}[code]||'';
    throw new Error('Growatt '+code+': '+(j.error_msg||'error')+hint);}
   if(!r.ok)throw new Error('Growatt: HTTP '+r.status);return j.data||{};},
  pid(p){return String(p.plant_id??p.plantId??p.id);},
  list(d,...keys){if(Array.isArray(d))return d;for(const k of keys)if(Array.isArray(d[k]))return d[k];return [];},
  async pages(path,keys){const out=[];for(let page=1;page<200;page++){const d=await this.get(`${path}${path.includes('?')?'&':'?'}page=${page}&perpage=100`);const l=this.list(d,...keys);out.push(...l);
    if(!l.length||l.length<100||(d.count&&out.length>=+d.count))break;await sleep(600);}return out;},
  // Installer/dealer accounts: /plant/list can be empty – then go through end users (/user/c_user_list -> /plant/user_plant_list)
  async plants(){let out=await this.pages('/plant/list',['plants','plant_list','list']);if(out.length)return out;
   let users=[];try{users=await this.pages('/user/c_user_list',['c_user','users','list']);}catch(e){return out;}
   const seen=new Set();for(const u of users){const uid=u.c_user_id??u.user_id??u.id;if(uid==null)continue;
    try{for(const p of await this.pages(`/plant/user_plant_list?user_id=${uid}`,['plants','plant_list','list'])){const k=this.pid(p);if(!seen.has(k)){seen.add(k);out.push(p);}}}catch(e){}
    await sleep(600);}
   return out;},
  async token(){await this.get('/plant/list?page=1&perpage=1');return true;},
  async testInfo(){const l=await this.plants();
   if(!l.length)return 'Token accepted, but Growatt returned 0 plants. Raw reply: '+JSON.stringify(this.lastRaw).slice(0,400);
   const p=l[0];return `Connected – ${l.length} plants found. First: ${p.name||p.plant_name||p.plantName||'?'} (id ${this.pid(p)}). Fields: ${Object.keys(p).join(', ').slice(0,300)}`;},
  async discover(known,maxMs=200000){const t0=Date.now(),l=await this.plants(),out=[];let complete=true;
   for(const p of l){const pid=this.pid(p);const lat=num(p.latitude??p.lat),lng=num(p.longitude??p.lng);
    const rec={plant_id:pid,plant_name:p.name||p.plant_name||p.plantName||null,city:p.city||null,lat:lat||null,lng:lng||null,capacity_kw:num(p.peak_power??p.nominal_power??p.nominalPower)};
    if(known.has(pid)){out.push(rec);continue;}
    if(Date.now()-t0>maxMs){complete=false;break;}
    const sns=[];try{const d=await this.get(`/device/list?plant_id=${pid}&page=1&perpage=100`);this.list(d,'devices','device_list','list').forEach(x=>{const sn=x.device_sn??x.deviceSn??x.sn;if(sn)sns.push({sn,logger:x.datalogger_sn??x.dataloggerSn??null});});}catch(e){}
    rec.serial=sns[0]?.sn||('GW-'+pid);rec.logger_serial=sns[0]?.logger||null;rec.inverters=sns.map(x=>x.sn).join(',').slice(0,300)||null;out.push(rec);await sleep(600);}
   return{list:out,complete};},
  isLost(x){const v=x.lost;return v===true||v===1||v==='1'||String(v).toLowerCase()==='true';},
  // device-level live data by Growatt device type (1=inverter, 4=MAX, 7=MIN/MIC/TL-X); returns AC power in W or null
  async devPower(x){const sn=x.device_sn??x.deviceSn??x.sn;if(!sn)return null;const t=+x.type;
   const order=t===7?['tlx']:t===4?['max']:t===1?['inv']:['tlx','inv'];
   const ep={tlx:`/device/tlx/tlx_last_data?tlx_sn=`,inv:`/device/inverter/last_new_data?device_sn=`,max:`/device/max/max_last_data?max_sn=`};
   for(const k of order){try{const d=await this.get(ep[k]+encodeURIComponent(sn));const v=num(d.pac??d.ppv??d.pacToGridTotal);if(v!=null)return{w:v,raw:d};}catch(e){}}return null;},
  async fetchDevice(sn,dev){
   if(dev?.plant_id){const d=await this.get(`/plant/data?plant_id=${dev.plant_id}`);let p=num(d.current_power??d.currentPower??d.power);const cap=dev.capacity_kw||null;
    const toKw=w=>w!=null&&(cap?w>cap*1.5:w>100)?w/1000:w; // W -> kW
    p=toKw(p);
    // Online/offline exactly like the Growatt portal: device list "lost" flag (plant power alone is often 0/stale)
    let devs=[];try{devs=this.list(await this.get(`/device/list?plant_id=${dev.plant_id}&page=1&perpage=100`),'devices','device_list','list');}catch(e){}
    let online=devs.length?devs.some(x=>!this.isLost(x)):(p==null?null:p>0),src='plant';
    if(online&&!p){let w=0,got=false;for(const x of devs.filter(x=>!this.isLost(x)).slice(0,3)){const r=await this.devPower(x);if(r){w+=r.w;got=true;}}if(got){p=toKw(w);src='device';}}
    return{power_kw:p,today_kwh:num(d.today_energy??d.todayEnergy??d.eToday),total_kwh:num(d.total_energy??d.totalEnergy??d.eTotal),online,
     raw:{plant_data:d,power_from:src,devices:devs.map(x=>({sn:x.device_sn,type:x.type,lost:x.lost,status:x.status,last_update_time:x.last_update_time,model:x.model}))}};}
   // No plant id yet (added manually by serial): try the standard inverter endpoint, then MIN/TL-X models
   let d,err;for(const p of [`/device/inverter/last_new_data?device_sn=`,`/device/tlx/tlx_last_data?tlx_sn=`]){try{d=await this.get(p+encodeURIComponent(sn));if(d&&Object.keys(d).length)break;}catch(e){err=e;d=null;}}
   if(!d||!Object.keys(d).length)throw err||new Error('Growatt: no data for '+sn+' – use "Import all Growatt plants now"');
   const pac=num(d.pac??d.ppv);return{power_kw:pac!=null?pac/1000:null,today_kwh:num(d.eToday??d.e_today??d.eacToday),total_kwh:num(d.eTotal??d.e_total??d.eacTotal),online:d.status!=null?String(d.status)!=='0':null,raw:d};}},
 SOLARMAN:{ // Deye via Solarman OpenAPI – appId/appSecret + account login
  env:['SOLARMAN_APP_ID','SOLARMAN_APP_SECRET','SOLARMAN_EMAIL','SOLARMAN_PASSWORD','SOLARMAN_BASE'],
  async token(){const t=tokens.SOLARMAN;if(t&&t.exp>Date.now())return t.v;const base=(E('SOLARMAN_BASE')||'https://globalapi.solarmanpv.com');
   const r=await fetch(`${base}/account/v1.0/token?appId=${E('SOLARMAN_APP_ID')}&language=en`,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({appSecret:E('SOLARMAN_APP_SECRET'),email:E('SOLARMAN_EMAIL'),password:crypto.createHash('sha256').update((E('SOLARMAN_PASSWORD')||'')).digest('hex')})});
   const j=await r.json();if(!j.access_token)throw new Error('Solarman login failed: '+(j.msg||''));tokens.SOLARMAN={v:j.access_token,exp:Date.now()+(+j.expires_in||3600)*900};return j.access_token;},
  async fetchDevice(sn){const base=(E('SOLARMAN_BASE')||'https://globalapi.solarmanpv.com');const tk=await this.token();
   const r=await fetch(`${base}/device/v1.0/currentData?language=en`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'bearer '+tk},body:JSON.stringify({deviceSn:sn})});
   const j=await r.json();if(j.success===false)throw new Error('Solarman: '+j.msg);const m={};(j.dataList||[]).forEach(x=>m[x.key]=x.value);
   const p=num(m.APo_t1??m.PG_Pt1??m.Pac);return{power_kw:p!=null?p/1000:null,today_kwh:num(m.Etdy_ge1??m.Etdy_ge0),total_kwh:num(m.Et_ge0??m.Et_ge1),online:j.deviceState!=null?j.deviceState===1:null,raw:m};}},
 SUNGROW:{ // iSolarCloud OpenAPI – appkey + x-access-key + account login
  env:['SUNGROW_APPKEY','SUNGROW_ACCESS_KEY','SUNGROW_USER','SUNGROW_PASSWORD','SUNGROW_BASE'],
  async call(path,body){const base=(E('SUNGROW_BASE')||'https://gateway.isolarcloud.com.hk');
   const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','x-access-key':E('SUNGROW_ACCESS_KEY'),sys_code:'901'},body:JSON.stringify({appkey:E('SUNGROW_APPKEY'),lang:'_en_US',...body})});
   const j=await r.json();if(j.result_code!=='1')throw new Error('Sungrow: '+(j.result_msg||j.result_code));return j.result_data;},
  async token(){const t=tokens.SUNGROW;if(t&&t.exp>Date.now())return t.v;const d=await this.call('/openapi/login',{user_account:E('SUNGROW_USER'),user_password:E('SUNGROW_PASSWORD')});
   tokens.SUNGROW={v:d.token,exp:Date.now()+6*3600e3};return d.token;},
  async fetchDevice(sn){const tk=await this.token();const d=await this.call('/openapi/getPVInverterRealTimeData',{token:tk,sn_list:[sn],point_id_list:['24','1','2']});
   const x=(d.device_point_list||[])[0]?.device_point||{};
   return{power_kw:num(x.p24)!=null?num(x.p24)/1000:null,today_kwh:num(x.p1)!=null?num(x.p1)/1000:null,total_kwh:num(x.p2)!=null?num(x.p2)/1000:null,online:x.dev_status!=null?String(x.dev_status)==='1':null,raw:x};}},
 PVBLINK:{ // PVBlink Open API v1 – Basic(ClientID:Secret) + email + base64 password -> token (12h)
  env:['PVBLINK_CLIENT_ID','PVBLINK_CLIENT_SECRET','PVBLINK_EMAIL','PVBLINK_PASSWORD','PVBLINK_BASE'],
  base(){return (E('PVBLINK_BASE')||'https://api-cloud.pvblink.com/api/pvblinkdata/v1');},
  async token(){const t=tokens.PVBLINK;if(t&&t.exp>Date.now())return t.v;
   const basic=Buffer.from(`${E('PVBLINK_CLIENT_ID')}:${E('PVBLINK_CLIENT_SECRET')}`).toString('base64');
   const r=await fetch(this.base()+'/user/exchange/token',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Basic '+basic},
    body:JSON.stringify({email:E('PVBLINK_EMAIL'),password:Buffer.from((E('PVBLINK_PASSWORD')||'')).toString('base64')})});
   const j=await r.json();const d=j.data||{};if(!d.token)throw new Error('PVblink login failed: '+(j.message||r.status));
   tokens.PVBLINK={v:d.token,exp:Date.now()+((+d.expiration||43200)-300)*1000};return d.token;},
  async get(path){const tk=await this.token();
   // Header style for secure APIs not shown in screenshots: try Bearer, fall back to raw token
   const r=await fetch(this.base()+path,{headers:{Authorization:tk,'Content-Type':'application/json'}}); // raw token, no "Bearer"
   if(r.status===401){delete tokens.PVBLINK;throw new Error('PVblink: unauthorised (token)');}const j=await r.json();return j.data??j;},
  plants:null,plantsAt:0,
  async plantId(logger){if(!this.plants||Date.now()-this.plantsAt>6*3600e3){const l=await this.get('/plant/s/list');this.plants=Array.isArray(l)?l:(l.list||l.plants||l.records||[]);this.plantsAt=Date.now();}
   const p=this.plants.find(x=>String(x.loggerNumber??x.loggerSerialNumber??'')===String(logger))||this.plants.find(x=>JSON.stringify(x).includes(String(logger)));if(!p)throw new Error('PVblink: logger '+logger+' not found in plant list');
   return p.plantId??p.plant_id??p.id;},
  async fetchDevice(sn,dev){const logger=dev?.logger_serial||sn;const pid=await this.plantId(logger);
   const d=await this.get(`/plant/s/live/${pid}/${logger}`);
   let p=num(d.activePower??d.gridPower);if(p!=null&&p>100)p=p/1000; // W -> kW
   const state=String(d.workingState||'');let err=null;try{const e=typeof d.statusErrorMessage==='string'?JSON.parse(d.statusErrorMessage):d.statusErrorMessage;const v=Object.values(e||{});if(v.length)err=v.join(', ');}catch(_){}
   return{power_kw:p,today_kwh:num(d.powerGenerationForTheDay??d.dailyProduction),total_kwh:num(d.totalPowerGeneration??d.production),
    online:state?/running/i.test(state):null,alarm:/alarm|fault/i.test(state)?(state+(err?': '+err:'')):(err||null),temp_c:num(d.inverterTemperature),raw:d};}}
};
function configured(brand){const c=connectors[brand];return !!c&&c.env.filter(e=>!/BASE$/.test(e)).every(e=>E(e));}
module.exports={connectors,configured,setSettings,BRANDS:Object.keys(connectors)};

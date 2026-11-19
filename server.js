// Evergreen Solar - Field Operations Map (MySQL version, for cPanel Node.js shared hosting)
const fs=require('fs'),path=require('path');
const os=require('os');
const CONFIG_NAME='.evergreen-fieldmap.env';
// Settings file is written to several places OUTSIDE the app folder (Hostinger rebuild replaces the app folder); first one found is read.
const CONFIG_FILES=[...new Set([process.env.FIELDMAP_CONFIG,path.join(os.homedir(),CONFIG_NAME),path.join(__dirname,'..',CONFIG_NAME),path.join(__dirname,'..','..',CONFIG_NAME),path.join(__dirname,'.env')].filter(Boolean).map(f=>path.resolve(f)))];
const CONFIG_FOUND=[];
for(const f of CONFIG_FILES)try{fs.readFileSync(f,'utf8').split(/\r?\n/).forEach(l=>{const m=l.match(/^\s*([\w]+)\s*=\s*(.*?)\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2];});CONFIG_FOUND.push(f);}catch(e){}
console.log('Config files found:',CONFIG_FOUND.join(', ')||'none','| DB from',process.env.DB_NAME?(CONFIG_FOUND.length?'file/env':'env'):'nowhere');
const express=require('express'),session=require('express-session'),MySQLStore=require('express-mysql-session')(session),bcrypt=require('bcryptjs'),mysql=require('mysql2/promise'),multer=require('multer'),XLSX=require('xlsx');
const PORT=process.env.PORT||3000;let ERP_KEY=process.env.ERP_API_KEY||'',CRON_KEY=process.env.CRON_KEY||'';
const DBCFG={host:process.env.DB_HOST||'localhost',port:+(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME};
const pool=mysql.createPool({...DBCFG,connectionLimit:+(process.env.DB_POOL||5),dateStrings:true,charset:'utf8mb4'});
const q=async(sql,p=[])=>(await pool.query(sql,p))[0];
const one=async(sql,p=[])=>(await q(sql,p))[0]||null;
const now=()=>new Date().toISOString();
const istDay=(o=0)=>new Date(Date.now()+5.5*36e5+o*864e5).toISOString().slice(0,10);
const istHour=()=>new Date(Date.now()+5.5*36e5).getUTCHours();
const SCHEMA=[
`CREATE TABLE IF NOT EXISTS users(id INT AUTO_INCREMENT PRIMARY KEY,name VARCHAR(120),username VARCHAR(60) UNIQUE,password_hash VARCHAR(100),role VARCHAR(20) DEFAULT 'sales',team VARCHAR(60),active TINYINT DEFAULT 1)`,
`CREATE TABLE IF NOT EXISTS pincodes(pincode VARCHAR(10) PRIMARY KEY,lat DOUBLE,lng DOUBLE,area VARCHAR(200),source VARCHAR(20))`,
`CREATE TABLE IF NOT EXISTS enquiries(id INT AUTO_INCREMENT PRIMARY KEY,ext_id VARCHAR(80) UNIQUE,customer VARCHAR(200),phone VARCHAR(30),pincode VARCHAR(10),area VARCHAR(200),source VARCHAR(80),enquiry_date VARCHAR(10),status VARCHAR(40),assigned_to VARCHAR(120),lat DOUBLE,lng DOUBLE,updated_at VARCHAR(30),INDEX(pincode),INDEX(enquiry_date))`,
`CREATE TABLE IF NOT EXISTS projects(id INT AUTO_INCREMENT PRIMARY KEY,ext_id VARCHAR(80) UNIQUE,customer VARCHAR(200),phone VARCHAR(30),address VARCHAR(400),pincode VARCHAR(10),area VARCHAR(200),lat DOUBLE,lng DOUBLE,capacity_kw DOUBLE,stage VARCHAR(40),stage_label VARCHAR(120),stage_date VARCHAR(10),survey_date VARCHAR(10),dispatch_date VARCHAR(10),installation_date VARCHAR(10),completion_date VARCHAR(10),engineer VARCHAR(120),team VARCHAR(60),created_date VARCHAR(10),updated_at VARCHAR(30),INDEX(stage),INDEX(pincode),INDEX(lat,lng))`,
`CREATE TABLE IF NOT EXISTS service(id INT AUTO_INCREMENT PRIMARY KEY,ext_id VARCHAR(80) UNIQUE,type VARCHAR(20),customer VARCHAR(200),phone VARCHAR(30),address VARCHAR(400),pincode VARCHAR(10),area VARCHAR(200),lat DOUBLE,lng DOUBLE,project_ref VARCHAR(80),issue VARCHAR(500),status VARCHAR(30),scheduled_date VARCHAR(10),engineer VARCHAR(120),team VARCHAR(60),created_date VARCHAR(10),updated_at VARCHAR(30),INDEX(status),INDEX(pincode))`,
`CREATE TABLE IF NOT EXISTS settings(k VARCHAR(80) PRIMARY KEY,v TEXT)`,
`CREATE TABLE IF NOT EXISTS rms_devices(id INT AUTO_INCREMENT PRIMARY KEY,project_ext_id VARCHAR(80),brand VARCHAR(20),serial VARCHAR(80) UNIQUE,logger_serial VARCHAR(80),capacity_kw DOUBLE,added_by VARCHAR(60),added_at VARCHAR(30),last_power_kw DOUBLE,today_kwh DOUBLE,total_kwh DOUBLE,online TINYINT,last_fetch VARCHAR(30),last_error VARCHAR(300),fail_count INT DEFAULT 0,INDEX(project_ext_id))`,
`CREATE TABLE IF NOT EXISTS rms_daily(serial VARCHAR(80),day VARCHAR(10),kwh DOUBLE,yld DOUBLE,peer_median DOUBLE,peers INT,expected DOUBLE,ratio DOUBLE,verdict VARCHAR(10),PRIMARY KEY(serial,day),INDEX(day))`,
`CREATE TABLE IF NOT EXISTS alerts(id INT AUTO_INCREMENT PRIMARY KEY,serial VARCHAR(80),project_ext_id VARCHAR(80),type VARCHAR(20),message VARCHAR(600),status VARCHAR(10) DEFAULT 'OPEN',opened_at VARCHAR(30),resolved_at VARCHAR(30),resolved_by VARCHAR(120),engineer VARCHAR(120),last_answer VARCHAR(400),last_answer_by VARCHAR(120),last_answer_at VARCHAR(30),next_ask_at VARCHAR(30),rnd INT DEFAULT 0,INDEX(status),INDEX(serial))`,
`CREATE TABLE IF NOT EXISTS alert_log(id INT AUTO_INCREMENT PRIMARY KEY,alert_id INT,at VARCHAR(30),who VARCHAR(120),question VARCHAR(500),answer VARCHAR(400),note VARCHAR(500),INDEX(alert_id))`,
`CREATE TABLE IF NOT EXISTS web_enquiries(id INT AUTO_INCREMENT PRIMARY KEY,ref VARCHAR(30) UNIQUE,name VARCHAR(120),phone VARCHAR(15),email VARCHAR(120),pincode VARCHAR(10),segment VARCHAR(20),monthly_bill VARCHAR(30),message VARCHAR(600),page VARCHAR(200),ip VARCHAR(60),created_at VARCHAR(30),erp_status VARCHAR(20) DEFAULT 'PENDING',erp_response VARCHAR(300),INDEX(created_at))`,
`CREATE TABLE IF NOT EXISTS kv_state(k VARCHAR(80) PRIMARY KEY,v VARCHAR(200))`,
`CREATE TABLE IF NOT EXISTS routes(id INT AUTO_INCREMENT PRIMARY KEY,name VARCHAR(200),route_date VARCHAR(10),person VARCHAR(120),phone VARCHAR(20),purpose VARCHAR(40),data MEDIUMTEXT,created_by VARCHAR(120),created_at VARCHAR(30),INDEX(route_date))`];
async function initDB(){for(const s of SCHEMA)await q(s);setTimeout(()=>seedPincodes().catch(()=>{}),2000);
 for(const c of ['plant_id VARCHAR(80)','plant_name VARCHAR(200)','city VARCHAR(120)','site_lat DOUBLE','site_lng DOUBLE','inverters VARCHAR(300)','source VARCHAR(20)','no_alerts TINYINT DEFAULT 0','no_alerts_reason VARCHAR(40)','no_alerts_by VARCHAR(120)','no_alerts_at VARCHAR(30)','offline_since VARCHAR(30)'])try{await q('ALTER TABLE rms_devices ADD COLUMN '+c);}catch(e){}}
// Bundled India Post pincode locations (West Bengal + Sikkim) – no internet lookup needed for these
async function seedPincodes(){try{const d=JSON.parse(fs.readFileSync(path.join(__dirname,'data','pincodes-wb.json'),'utf8'));const have=(await one("SELECT COUNT(*) n FROM pincodes WHERE source='indiapost'")).n;
 if(have<Object.keys(d).length){const rows=Object.entries(d).map(([p,[la,ln,ar]])=>[p,la,ln,ar,'indiapost']);for(let i=0;i<rows.length;i+=300)await q('INSERT IGNORE INTO pincodes(pincode,lat,lng,area,source) VALUES ?',[rows.slice(i,i+300)]);}
 }catch(e){console.error('pincode seed',e.message);}await fillMissingLocations();}
async function fillMissingLocations(){let n=0;for(const t of ['projects','enquiries','service'])n+=(await q(`UPDATE ${t} x JOIN pincodes p ON p.pincode=TRIM(x.pincode) SET x.lat=p.lat,x.lng=p.lng,x.area=COALESCE(x.area,p.area) WHERE x.lat IS NULL AND p.lat IS NOT NULL`)).affectedRows;return n;}
// ---- Stage normalisation (Evergreen workflow) ----
const STAGES=['ENQUIRY','SURVEY_REQUESTED','SURVEY_SCHEDULED','SURVEY_DONE','DESIGN_PENDING','DESIGN_DONE','PROJECT_CREATED','AGREEMENT_PENDING','DISPATCH_PENDING','INSTALLATION_PENDING','NET_METERING_PENDING','DOCUMENT_SENDING','COMPLETED','OTHER'];
function normStage(s){const t=String(s||'').toUpperCase().replace(/[^A-Z]+/g,'_');if(STAGES.includes(t))return t;
 if(/NET_?METER/.test(t))return 'NET_METERING_PENDING';if(/DOCUMENT/.test(t))return 'DOCUMENT_SENDING';
 if(/SURVEY/.test(t))return /DONE|SUBMIT|COMPLET/.test(t)?'SURVEY_DONE':/SCHEDUL|ASSIGN|ENGINEER/.test(t)?'SURVEY_SCHEDULED':'SURVEY_REQUESTED';
 if(/DESIGN/.test(t))return /DONE|COMPLET/.test(t)?'DESIGN_DONE':'DESIGN_PENDING';if(/AGREEMENT/.test(t))return 'AGREEMENT_PENDING';
 if(/DISPATCH|MATERIAL|PROCURE|PURCHASE|DELIVER/.test(t))return 'DISPATCH_PENDING';if(/INSTALL/.test(t))return 'INSTALLATION_PENDING';if(/PROJECT_?CREAT|CONFIRM/.test(t))return 'PROJECT_CREATED';
 if(/COMPLET|CLOSED|HANDOVER/.test(t))return 'COMPLETED';if(/ENQUIR|INQUIR|LEAD/.test(t))return 'ENQUIRY';return 'OTHER';}
function toISODate(v){if(!v)return null;if(typeof v==='number'){const d=XLSX.SSF.parse_date_code(v);return d?`${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`:null;}
 const s=String(v).trim();let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);if(m)return m[0];
 m=s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);if(m){let y=+m[3];if(y<100)y+=2000;return `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;}
 const d=new Date(s);return isNaN(d)?null:d.toISOString().slice(0,10);}
const lookupPin=pin=>pin?one('SELECT * FROM pincodes WHERE pincode=?',[String(pin)]):null;
// ---- Upserts (ERP API + Excel) ----
// Partial update: a field the ERP did not send keeps its saved value; send null explicitly to clear it
async function upsertRow(table,r,src){const upd={};const has=n=>Object.prototype.hasOwnProperty.call(src,n);
 const names=k=>k==='customer'?['customer_name','customer']:k==='stage_label'?['stage']:k==='project_ref'?['project_id','project_ref']:[k];
 for(const [k,v] of Object.entries(r)){if(['status','type','stage','stage_label'].includes(k)&&!names(k).some(has))continue;
  if(v!==null&&v!==undefined){upd[k]=v;continue;}if(names(k).some(n=>has(n)&&src[n]===null))upd[k]=null;}
 await q(`INSERT INTO ${table} SET ? ON DUPLICATE KEY UPDATE ?`,[r,upd]);}
async function upsertEnquiry(e){const ext=String(e.enquiry_id??e.ext_id??'').trim();if(!ext)throw new Error('enquiry_id missing');
 const pin=e.pincode?String(e.pincode).trim():null;const p=await lookupPin(pin);
 const r={ext_id:ext,customer:e.customer_name??e.customer??null,phone:e.phone??null,pincode:pin,area:e.area??p?.area??null,source:e.source??null,enquiry_date:toISODate(e.enquiry_date),status:e.status??'OPEN',assigned_to:e.assigned_to??null,lat:e.lat??p?.lat??null,lng:e.lng??p?.lng??null,updated_at:now()};
 await upsertRow('enquiries',r,e);}
async function upsertProject(x){const ext=String(x.project_id??x.ext_id??'').trim();if(!ext)throw new Error('project_id missing');
 const pin=x.pincode?String(x.pincode).trim():null;const p=await lookupPin(pin);
 const r={ext_id:ext,customer:x.customer_name??x.customer??null,phone:x.phone??null,address:x.address??null,pincode:pin,area:x.area??p?.area??null,lat:x.lat??p?.lat??null,lng:x.lng??p?.lng??null,
  capacity_kw:x.capacity_kw!=null&&x.capacity_kw!==''?+x.capacity_kw:null,stage:normStage(x.stage),stage_label:x.stage!=null?String(x.stage):null,stage_date:toISODate(x.stage_date),survey_date:toISODate(x.survey_date),
  dispatch_date:toISODate(x.dispatch_date),installation_date:toISODate(x.installation_date),completion_date:toISODate(x.completion_date),engineer:x.engineer??null,team:x.team??null,created_date:toISODate(x.created_date),updated_at:now()};
 await upsertRow('projects',r,x);}
const normType=t=>{t=String(t||'').toUpperCase();return /CLEAN/.test(t)?'CLEANING':/AMC/.test(t)?'AMC':'MAINTENANCE';};
async function upsertService(x){const ext=String(x.ticket_id??x.ext_id??'').trim();if(!ext)throw new Error('ticket_id missing');
 const pin=x.pincode?String(x.pincode).trim():null;const p=await lookupPin(pin);
 const r={ext_id:ext,type:normType(x.type),customer:x.customer_name??x.customer??null,phone:x.phone??null,address:x.address??null,pincode:pin,area:x.area??p?.area??null,lat:x.lat??p?.lat??null,lng:x.lng??p?.lng??null,
  project_ref:x.project_id??null,issue:x.issue??null,status:String(x.status||'OPEN').toUpperCase(),scheduled_date:toISODate(x.scheduled_date),engineer:x.engineer??null,team:x.team??null,created_date:toISODate(x.created_date),updated_at:now()};
 await upsertRow('service',r,x);}
async function fillPin(pin,lat,lng){for(const t of ['enquiries','projects','service'])await q(`UPDATE ${t} SET lat=?,lng=? WHERE pincode=? AND lat IS NULL`,[lat,lng,pin]);}
async function upsertPincode(p){await q('REPLACE INTO pincodes(pincode,lat,lng,area,source) VALUES(?,?,?,?,?)',[String(p.pincode),+p.lat,+p.lng,p.area??null,'manual']);await fillPin(String(p.pincode),+p.lat,+p.lng);}
async function bulk(fn,items){const errors=[];let ok=0;for(let i=0;i<items.length;i++){try{await fn(items[i]);ok++;}catch(e){errors.push({index:i,error:e.message});}}return{received:items.length,saved:ok,errors};}
// Inverter sites without coordinates: geocode the city name (Nominatim, cached per city in kv_state)
async function geocodeSites(max=8){const rows=await q("SELECT DISTINCT city FROM rms_devices WHERE site_lat IS NULL AND city IS NOT NULL AND city<>'' LIMIT 40");let done=0;
 for(const {city} of rows){const key='city:'+String(city).toLowerCase().slice(0,70);let v=(await one('SELECT v FROM kv_state WHERE k=?',[key]))?.v;
  if(!v){if(done>=max)continue;done++;try{const j=await (await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city+', India')}&countrycodes=in&format=json&limit=1`,{headers:{'User-Agent':'EvergreenSolar-FieldMap/1.0'}})).json();
   v=j[0]?`${(+j[0].lat).toFixed(4)},${(+j[0].lon).toFixed(4)}`:'none';await q('REPLACE INTO kv_state(k,v) VALUES(?,?)',[key,v]);}catch(e){continue;}await new Promise(r=>setTimeout(r,1200));}
  if(v&&v!=='none'){const [la,ln]=v.split(',').map(Number);await q('UPDATE rms_devices SET site_lat=?,site_lng=? WHERE city=? AND site_lat IS NULL',[la,ln,city]);}}
 return done;}
// Pincode geocoding via free OpenStreetMap Nominatim (run from cron, max 1 req/sec)
async function geocodeBatch(max=20){const pins=await q(`SELECT DISTINCT pincode FROM (SELECT pincode FROM projects WHERE lat IS NULL UNION SELECT pincode FROM enquiries WHERE lat IS NULL UNION SELECT pincode FROM service WHERE lat IS NULL) x
 WHERE pincode REGEXP '^[0-9]{6}$' AND pincode NOT IN (SELECT pincode FROM pincodes) AND CONCAT('geofail:',pincode) NOT IN (SELECT k FROM kv_state WHERE v>?) LIMIT ?`,[new Date(Date.now()-7*864e5).toISOString(),max]);let done=0;
 for(const {pincode} of pins){try{const r=await fetch(`https://nominatim.openstreetmap.org/search?postalcode=${pincode}&country=India&format=json&limit=1`,{headers:{'User-Agent':'EvergreenSolar-FieldMap/1.0'}});let j=await r.json();
  if(!j[0]){await new Promise(r=>setTimeout(r,1200));j=await (await fetch(`https://nominatim.openstreetmap.org/search?q=${pincode}%20India&countrycodes=in&format=json&limit=1`,{headers:{'User-Agent':'EvergreenSolar-FieldMap/1.0'}})).json();}
  if(!j[0])await q('REPLACE INTO kv_state(k,v) VALUES(?,?)',['geofail:'+pincode,new Date().toISOString()]);
  if(j[0]){const area=(j[0].display_name||'').split(',').slice(0,2).join(',').trim();await q('REPLACE INTO pincodes(pincode,lat,lng,area,source) VALUES(?,?,?,?,?)',[pincode,+j[0].lat,+j[0].lon,area,'osm']);await fillPin(pincode,+j[0].lat,+j[0].lon);done++;}}catch(e){}
  await new Promise(r=>setTimeout(r,1200));}return done;}

// ---- App ----
const app=express();app.set('trust proxy',1);app.disable('x-powered-by');
// ---- Security: headers, AI/scraper bot blocking ----
const AI_BOTS=/GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-Web|Claude-User|anthropic-ai|CCBot|Google-Extended|PerplexityBot|Perplexity-User|Bytespider|Amazonbot|Applebot-Extended|cohere-ai|Diffbot|ImagesiftBot|Omgilibot|FacebookBot|meta-externalagent|YouBot|Timpibot|PetalBot|DataForSeoBot|Scrapy|HTTrack|SiteSucker|WebCopier|WebZIP|Offline Explorer/i,
 TOOLS=/python-requests|python-urllib|aiohttp|httpx|curl\/|wget|Go-http-client|node-fetch|undici|axios|okhttp|libwww|Java\/|HeadlessChrome|PhantomJS|Puppeteer|Playwright|Selenium/i;
app.use((req,res,next)=>{
 res.set({'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'strict-origin-when-cross-origin','Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy':'same-origin','X-Robots-Tag':req.path==='/'||req.path==='/index.html'?'noai, noimageai':'noindex, nofollow, noarchive, noai, noimageai',
  'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://*.tile.openstreetmap.org https://unpkg.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"});
 if(req.secure)res.set('Strict-Transport-Security','max-age=31536000; includeSubDomains');
 // Machine clients (scrapers, AI crawlers, copy tools) get nothing – except the cron job and the ERP API
 const ua=req.get('user-agent')||'';
 if(req.path!=='/robots.txt'&&(AI_BOTS.test(ua)||(TOOLS.test(ua)&&!/^\/(cron|erp)\//.test(req.path)&&req.path!=='/')))return res.status(403).type('text/plain').send('Forbidden');
 next();});
app.get('/robots.txt',(req,res)=>res.type('text/plain').send(`User-agent: GPTBot\nDisallow: /\n\nUser-agent: ChatGPT-User\nDisallow: /\n\nUser-agent: ClaudeBot\nDisallow: /\n\nUser-agent: anthropic-ai\nDisallow: /\n\nUser-agent: CCBot\nDisallow: /\n\nUser-agent: Google-Extended\nDisallow: /\n\nUser-agent: PerplexityBot\nDisallow: /\n\nUser-agent: Bytespider\nDisallow: /\n\nUser-agent: *\nAllow: /$\nDisallow: /app.html\nDisallow: /app.js\nDisallow: /api/\nDisallow: /docs/\nDisallow: /erp/\nDisallow: /cron/\n`));
app.use(express.json({limit:'10mb'}));
app.use(session({secret:process.env.SESSION_SECRET||require('crypto').createHash('sha256').update('fieldmap|'+(process.env.DB_PASSWORD||'')+'|'+(process.env.DB_NAME||'')).digest('hex'),resave:false,saveUninitialized:false,store:process.env.DB_NAME?new MySQLStore({...DBCFG,createDatabaseTable:true}):undefined,name:'sev.sid',cookie:{httpOnly:true,secure:'auto',sameSite:'lax',maxAge:12*3600*1000}}));
const W=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(e=>{console.error(e);res.status(500).json({error:e.message});});
const auth=roles=>(req,res,next)=>{const u=req.session.user;if(!u)return res.status(401).json({error:'login required'});if(roles&&!roles.includes(u.role))return res.status(403).json({error:'not allowed'});next();};
// Brute-force protection: 8 wrong tries per username or 20 per IP -> locked for 15 minutes
const FAILS={};const failKey=k=>{const f=FAILS[k];if(f&&Date.now()-f.t>15*60e3)delete FAILS[k];return FAILS[k];};
app.post('/auth/login',W(async(req,res)=>{const un=String(req.body.username||'').slice(0,60).toLowerCase(),ku='u:'+un,ki='i:'+req.ip;
 if((failKey(ku)?.n||0)>=8||(failKey(ki)?.n||0)>=20)return res.status(429).json({error:'Too many wrong attempts. Try again after 15 minutes.'});
 const u=await one('SELECT * FROM users WHERE username=? AND active=1',[un]);
 if(!u||!bcrypt.compareSync(String(req.body.password||''),u.password_hash)){for(const k of [ku,ki]){const f=FAILS[k]||(FAILS[k]={n:0,t:Date.now()});f.n++;}await new Promise(r=>setTimeout(r,600));return res.status(401).json({error:'Wrong username or password'});}
 delete FAILS[ku];await new Promise((ok,no)=>req.session.regenerate(e=>e?no(e):ok())); // new session id after login
 req.session.user={id:u.id,name:u.name,username:u.username,role:u.role,team:u.team};res.json(req.session.user);}));
app.post('/auth/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/auth/me',auth(),(req,res)=>res.json({...req.session.user,office:process.env.OFFICE_LATLNG||'22.6470,88.4400'}));
app.get('/api/users',auth(['admin']),W(async(req,res)=>res.json(await q('SELECT id,name,username,role,team,active FROM users'))));
app.post('/api/users',auth(['admin']),W(async(req,res)=>{const {name,username,password,role,team}=req.body;if(!username||!password)return res.status(400).json({error:'username & password required'});
 try{await q('INSERT INTO users(name,username,password_hash,role,team) VALUES(?,?,?,?,?)',[name,username,bcrypt.hashSync(password,10),role||'sales',team||null]);res.json({ok:true});}catch(e){res.status(400).json({error:e.message});}}));
app.delete('/api/users/:id',auth(['admin']),W(async(req,res)=>{await q('UPDATE users SET active=0 WHERE id=?',[req.params.id]);res.json({ok:true});}));
// ---- Map data ----
app.get('/api/projects',auth(),W(async(req,res)=>{const {stage,from,to,team,engineer,datefield}=req.query;const f=['survey_date','dispatch_date','installation_date','completion_date','stage_date','created_date'].includes(datefield)?datefield:'stage_date';
 let s='SELECT * FROM projects WHERE lat IS NOT NULL',a=[];if(stage){const l=String(stage).split(',');s+=` AND stage IN (?)`;a.push(l);}
 if(from){s+=` AND ${f}>=?`;a.push(from);}if(to){s+=` AND ${f}<=?`;a.push(to);}if(team){s+=' AND team=?';a.push(team);}if(engineer){s+=' AND engineer=?';a.push(engineer);}
 res.json(await q(s,a));}));
app.get('/api/enquiries/by-pincode',auth(),W(async(req,res)=>{const {from,to,source}=req.query;let s='SELECT pincode,MAX(area) area,AVG(lat) lat,AVG(lng) lng,COUNT(*) count FROM enquiries WHERE lat IS NOT NULL',a=[];
 if(from){s+=' AND enquiry_date>=?';a.push(from);}if(to){s+=' AND enquiry_date<=?';a.push(to);}if(source){s+=' AND source=?';a.push(source);}
 res.json(await q(s+' GROUP BY pincode ORDER BY count DESC',a));}));
// Survey requests kept as ENQUIRIES in the ERP (status mentions survey and is not done)
const SURVEY_ENQ="status REGEXP 'survey' AND status NOT REGEXP 'done|complet|submit|cancel|closed|reject'";
app.get('/api/enquiries/survey',auth(),W(async(req,res)=>res.json((await q(`SELECT ext_id,customer,phone,pincode,area,lat,lng,status,enquiry_date,assigned_to,source FROM enquiries WHERE ${SURVEY_ENQ} ORDER BY enquiry_date DESC LIMIT 2000`)).map(e=>({...e,stage:normStage(e.status)})))));
// ---- Map "work buckets": one click = one stage of the workflow ----
const BUCKETS={SURVEY:['SURVEY_REQUESTED','SURVEY_SCHEDULED'],DESIGN:['SURVEY_DONE','DESIGN_PENDING','DESIGN_DONE'],AGREEMENT:['PROJECT_CREATED','AGREEMENT_PENDING'],DISPATCH:['DISPATCH_PENDING'],
 INSTALL:['INSTALLATION_PENDING'],NETMETER:['NET_METERING_PENDING'],DOCS:['DOCUMENT_SENDING'],COMPLETED:['COMPLETED'],OTHER:['OTHER','ENQUIRY']};
const daysSince=d=>d?Math.max(0,Math.floor((Date.now()-Date.parse(d+'T00:00:00+05:30'))/864e5)):null;
async function bucketItems(c){let out=[];
 if(BUCKETS[c])out=(await q('SELECT ext_id ref,customer name,phone,address,area,pincode,lat,lng,stage,stage_label,COALESCE(stage_date,created_date) since,engineer,team,capacity_kw FROM projects WHERE stage IN (?)',[BUCKETS[c]])).map(x=>({kind:'Project',...x}));
 if(c==='SURVEY')out=out.concat((await q(`SELECT ext_id ref,customer name,phone,NULL address,area,pincode,lat,lng,status,enquiry_date since,assigned_to engineer FROM enquiries WHERE ${SURVEY_ENQ}`)).map(x=>({kind:'Enquiry',...x,stage:normStage(x.status),stage_label:x.status})));
 if(c==='ENQUIRY')out=(await q(`SELECT ext_id ref,customer name,phone,NULL address,area,pincode,lat,lng,status stage_label,enquiry_date since,assigned_to engineer,source FROM enquiries WHERE NOT (${SURVEY_ENQ}) AND COALESCE(status,'') NOT REGEXP 'closed|lost|cancel|reject|convert|won'`)).map(x=>({kind:'Enquiry',...x,stage:'ENQUIRY'}));
 if(c==='SERVICE')out=(await q("SELECT ext_id ref,customer name,phone,address,area,pincode,lat,lng,type stage_label,status,COALESCE(scheduled_date,created_date) since,engineer,issue FROM service WHERE status NOT IN ('CLOSED','DONE','COMPLETED')")).map(x=>({kind:'Service',...x,stage:'SERVICE_'+(x.stage_label||'')}));
 out.forEach(x=>{x.days=daysSince(x.since);});return out.sort((a,b)=>(b.days??-1)-(a.days??-1));}
app.get('/api/map/bucket',auth(),W(async(req,res)=>res.json(await bucketItems(String(req.query.c||'SURVEY').toUpperCase()))));
app.get('/api/map/counts',auth(),W(async(req,res)=>{const out={};
 for(const c of [...Object.keys(BUCKETS),'ENQUIRY','SERVICE']){const l=await bucketItems(c);out[c]={n:l.length,located:l.filter(x=>x.lat!=null).length,
  ...(c==='SURVEY'?{requested:l.filter(x=>x.stage==='SURVEY_REQUESTED').length,scheduled:l.filter(x=>x.stage==='SURVEY_SCHEDULED').length}:{})};}
 // daily snapshot -> change since the previous day (e.g. dispatched projects leave "Dispatch")
 const day=istDay(),snap=Object.fromEntries(Object.entries(out).map(([k,v])=>[k,v.n]));await q('REPLACE INTO kv_state(k,v) VALUES(?,?)',['snap:'+day,JSON.stringify(snap).slice(0,200)]);
 const prev=await one("SELECT k,v FROM kv_state WHERE k LIKE 'snap:%' AND k<? ORDER BY k DESC LIMIT 1",['snap:'+day]);
 if(prev){const p=JSON.parse(prev.v);for(const k in out)if(p[k]!=null)out[k].delta=out[k].n-p[k];out._since=prev.k.slice(5);}
 res.json(out);}));
// Data check for admins: what arrived, what has no location, which stages were not recognised
app.get('/api/data-status',auth(['admin','manager']),W(async(req,res)=>{const c=async(t)=>(await one(`SELECT COUNT(*) n,SUM(lat IS NOT NULL) located FROM ${t}`));
 const push={};for(const r of await q("SELECT k,v FROM kv_state WHERE k LIKE 'erp_push_%'"))push[r.k.slice(9)]=JSON.parse(r.v);
 res.json({projects:await c('projects'),enquiries:await c('enquiries'),service:await c('service'),
  survey_enquiries:(await one(`SELECT COUNT(*) n FROM enquiries WHERE ${SURVEY_ENQ}`)).n,
  project_stages:await q('SELECT stage,COUNT(*) n FROM projects GROUP BY stage ORDER BY n DESC'),
  unrecognised_stages:await q("SELECT stage_label,COUNT(*) n FROM projects WHERE stage='OTHER' GROUP BY stage_label ORDER BY n DESC LIMIT 20"),
  enquiry_statuses:await q('SELECT status,COUNT(*) n FROM enquiries GROUP BY status ORDER BY n DESC LIMIT 20'),
  no_location_pincodes:await q(`SELECT pincode,COUNT(*) n FROM (SELECT pincode FROM projects WHERE lat IS NULL UNION ALL SELECT pincode FROM enquiries WHERE lat IS NULL UNION ALL SELECT pincode FROM service WHERE lat IS NULL) x GROUP BY pincode ORDER BY n DESC LIMIT 25`),
  erp_last_push:push,erp_pull:(await one("SELECT v FROM kv_state WHERE k='erp_pull_last'"))?.v||null});}));
app.post('/api/data-status/fix-locations',auth(['admin','manager']),W(async(req,res)=>{await seedPincodes();res.json({ok:true,located:await fillMissingLocations()});}));
app.get('/api/summary',auth(),W(async(req,res)=>{
 const byArea=await q(`SELECT COALESCE(pincode,'-') pincode,MAX(area) area,SUM(stage IN ('SURVEY_REQUESTED','SURVEY_SCHEDULED')) survey_pending,SUM(stage IN ('DESIGN_PENDING','DESIGN_DONE')) design_pending,
  SUM(stage='AGREEMENT_PENDING') agreement_pending,SUM(stage='DISPATCH_PENDING') dispatch_pending,SUM(stage='INSTALLATION_PENDING') install_pending,SUM(stage='NET_METERING_PENDING') netmeter_pending,
  SUM(stage IN ('DOCUMENT_SENDING','COMPLETED')) completed,COUNT(*) total FROM projects GROUP BY pincode ORDER BY survey_pending DESC,total DESC`);
 const em=Object.fromEntries((await q('SELECT pincode,COUNT(*) c FROM enquiries GROUP BY pincode')).map(e=>[e.pincode,e.c]));
 const sm=Object.fromEntries((await q("SELECT pincode,COUNT(*) c FROM service WHERE status NOT IN ('CLOSED','DONE','COMPLETED') GROUP BY pincode")).map(e=>[e.pincode,e.c]));
 const svm=Object.fromEntries((await q(`SELECT pincode,COUNT(*) c FROM enquiries WHERE ${SURVEY_ENQ} GROUP BY pincode`)).map(e=>[e.pincode,e.c]));
 const known=new Set(byArea.map(r=>String(r.pincode)));for(const [pin,c] of Object.entries(em))if(!known.has(String(pin))){const a=(await one('SELECT area FROM pincodes WHERE pincode=?',[pin]))?.area||null;byArea.push({pincode:pin||'-',area:a,survey_pending:0,design_pending:0,agreement_pending:0,dispatch_pending:0,install_pending:0,netmeter_pending:0,completed:0,total:0});}
 byArea.forEach(r=>{for(const k in r)if(typeof r[k]==='string'&&/^\d+$/.test(r[k])&&k!=='pincode')r[k]=+r[k];r.enquiries=em[r.pincode]||0;r.service_open=sm[r.pincode]||0;r.survey_pending=(+r.survey_pending||0)+(svm[r.pincode]||0);});
 byArea.sort((a,b)=>b.survey_pending-a.survey_pending||b.total-a.total||b.enquiries-a.enquiries);
 const col=async s=>(await q(s)).map(r=>Object.values(r)[0]);
 res.json({byArea,filters:{teams:await col('SELECT DISTINCT team FROM projects WHERE team IS NOT NULL'),engineers:await col('SELECT DISTINCT engineer FROM projects WHERE engineer IS NOT NULL'),sources:await col('SELECT DISTINCT source FROM enquiries WHERE source IS NOT NULL')},
  totalEnquiries:(await one('SELECT COUNT(*) c FROM enquiries')).c,ungeocoded:(await one("SELECT COUNT(DISTINCT pincode) c FROM projects WHERE lat IS NULL")).c});}));
app.get('/api/nearby',auth(),W(async(req,res)=>{const lat=+req.query.lat,lng=+req.query.lng,km=+(req.query.km||3),d=km/111;
 const rows=await q(`SELECT * FROM projects WHERE stage IN ('NET_METERING_PENDING','DOCUMENT_SENDING','COMPLETED') AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`,[lat-d,lat+d,lng-d*1.1,lng+d*1.1]);
 rows.forEach(r=>r.distance_km=+dist(lat,lng,r.lat,r.lng).toFixed(2));res.json(rows.filter(r=>r.distance_km<=km).sort((a,b)=>a.distance_km-b.distance_km));}));
app.get('/api/service',auth(),W(async(req,res)=>{const {type,from,to}=req.query;let s="SELECT * FROM service WHERE lat IS NOT NULL AND status NOT IN ('CLOSED','DONE','COMPLETED')",a=[];
 if(type){s+=' AND type IN (?)';a.push(String(type).split(','));}if(from){s+=' AND scheduled_date>=?';a.push(from);}if(to){s+=' AND scheduled_date<=?';a.push(to);}res.json(await q(s,a));}));
app.get('/api/planner',auth(),W(async(req,res)=>{const days=Math.min(+(req.query.days||7),31),from=req.query.from||istDay();
 const to=new Date(new Date(from).getTime()+(days-1)*864e5).toISOString().slice(0,10);const kinds=String(req.query.kinds||'SURVEY,MAINTENANCE,CLEANING,AMC').split(',');let jobs=[];
 if(kinds.includes('SURVEY'))jobs.push(...await q(`SELECT 'SURVEY' kind,ext_id,customer,phone,address,pincode,area,lat,lng,engineer,team,stage status,COALESCE(survey_date,stage_date) date FROM projects
  WHERE stage IN ('SURVEY_REQUESTED','SURVEY_SCHEDULED') AND (COALESCE(survey_date,stage_date) IS NULL OR COALESCE(survey_date,stage_date) BETWEEN ? AND ?)`,[from,to]));
 const st=kinds.filter(k=>k!=='SURVEY');
 if(st.length)jobs.push(...await q(`SELECT type kind,ext_id,customer,phone,address,pincode,area,lat,lng,engineer,team,status,scheduled_date date FROM service
  WHERE status NOT IN ('CLOSED','DONE','COMPLETED') AND type IN (?) AND (scheduled_date IS NULL OR scheduled_date BETWEEN ? AND ?)`,[st,from,to]));
 const g={};jobs.forEach(j=>{const k=j.pincode||'NO-PINCODE';(g[k]=g[k]||{pincode:k,area:j.area,jobs:[]}).jobs.push(j);});
 const out=Object.values(g).map(x=>{x.jobs.sort((a,b)=>(a.date||'9')>(b.date||'9')?1:-1);x.count=x.jobs.length;x.dates=[...new Set(x.jobs.map(j=>j.date||'unscheduled'))];
  x.can_club=x.count>1&&x.dates.length>1;x.suggested_date=x.jobs.map(j=>j.date).filter(Boolean)[0]||null;return x;}).sort((a,b)=>b.count-a.count);
 res.json({from,to,total:jobs.length,groups:out});}));
// ---- Excel import ----
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:20e6}});
app.post('/api/import/:type',auth(['admin','manager']),upload.single('file'),W(async(req,res)=>{const fn={projects:upsertProject,enquiries:upsertEnquiry,service:upsertService,pincodes:upsertPincode}[req.params.type];
 if(!fn||!req.file)return res.status(400).json({error:'bad request'});const wb=XLSX.read(req.file.buffer);const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:null});
 res.json(await bulk(fn,rows.map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[String(k).trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,''),v])))));}));
// ---- ERP integration API (header X-API-Key) ----
const erp=(req,res,next)=>ERP_KEY&&req.get('X-API-Key')===ERP_KEY?next():res.status(401).json({error:'invalid API key'});
const logPush=async(t,r)=>{const o=JSON.parse((await one('SELECT v FROM kv_state WHERE k=?',['erp_push_'+t]))?.v||'{}');await q('REPLACE INTO kv_state(k,v) VALUES(?,?)',['erp_push_'+t,JSON.stringify({at:now(),received:r.received,saved:r.saved,failed:r.errors.length,total_received:(o.total_received||0)+r.received}).slice(0,200)]);};
const arr=b=>Array.isArray(b)?b:(Array.isArray(b?.data)?b.data:[b]);
app.post('/erp/v1/enquiries',erp,W(async(req,res)=>{const r=await bulk(upsertEnquiry,arr(req.body));await logPush('enquiries',r);fillMissingLocations().catch(()=>{});res.json(r);}));
app.post('/erp/v1/projects',erp,W(async(req,res)=>{const r=await bulk(upsertProject,arr(req.body));await logPush('projects',r);fillMissingLocations().catch(()=>{});res.json(r);}));
app.post('/erp/v1/service',erp,W(async(req,res)=>{const r=await bulk(upsertService,arr(req.body));await logPush('service',r);fillMissingLocations().catch(()=>{});res.json(r);}));
app.post('/erp/v1/pincodes',erp,W(async(req,res)=>res.json(await bulk(upsertPincode,arr(req.body)))));
for(const [t,col] of [['projects','projects'],['enquiries','enquiries'],['service','service']])app.delete(`/erp/v1/${t}/:id`,erp,W(async(req,res)=>{await q(`DELETE FROM ${col} WHERE ext_id=?`,[req.params.id]);res.json({ok:true});}));
app.get('/erp/v1/health',erp,(req,res)=>res.json({ok:true,time:now()}));
const DOC=path.join(__dirname,'API_DOCUMENTATION.md');
app.get('/docs/download',auth(),(req,res)=>res.download(DOC,'Evergreen_FieldMap_API_Spec.md'));
app.get('/docs/raw',auth(),(req,res)=>res.type('text/plain').send(fs.readFileSync(DOC,'utf8')));

// ---- RMS ----
const RMS=require('./rms');
const loadSettings=async()=>RMS.setSettings(Object.fromEntries((await q('SELECT k,v FROM settings')).map(x=>[x.k,x.v])));
const SECRET=/SECRET|PASSWORD|TOKEN|ACCESS_KEY/;
app.get('/api/rms/settings',auth(['admin']),W(async(req,res)=>{const sv=Object.fromEntries((await q('SELECT k,v FROM settings')).map(x=>[x.k,x.v]));
 res.json(RMS.BRANDS.map(b=>({brand:b,configured:RMS.configured(b),fields:RMS.connectors[b].env.map(k=>({key:k,secret:SECRET.test(k),set:!!(sv[k]||process.env[k]),value:SECRET.test(k)?'':(sv[k]||process.env[k]||'')}))})));}));
app.post('/api/rms/settings',auth(['admin']),W(async(req,res)=>{const ok=new Set(RMS.BRANDS.flatMap(b=>RMS.connectors[b].env));
 for(const [k,v] of Object.entries(req.body||{}))if(ok.has(k)&&v!==''&&v!=null)await q('REPLACE INTO settings(k,v) VALUES(?,?)',[k,String(v).trim()]);await loadSettings();res.json({ok:true});}));
// ---- Pull from ERP (when the ERP offers GET/list URLs). Same field names as the push API. ----
const ERP_PULL_KEYS=['ERP_PULL_BASE','ERP_PULL_KEY','ERP_PULL_HEADER','ERP_PULL_PROJECTS','ERP_PULL_ENQUIRIES','ERP_PULL_SERVICE'];
async function erpGetAll(path){const base=String((await one("SELECT v FROM settings WHERE k='ERP_PULL_BASE'"))?.v||'').trim().replace(/\/+$/,'');if(!base)throw new Error('ERP pull URL not set');
 const key=(await one("SELECT v FROM settings WHERE k='ERP_PULL_KEY'"))?.v||'',hdr=(await one("SELECT v FROM settings WHERE k='ERP_PULL_HEADER'"))?.v||'X-API-Key';
 let url=/^https?:/.test(path)?path:base+(path.startsWith('/')?path:'/'+path);const out=[];let first=null;
 for(let page=0;page<200&&url;page++){const r=await fetch(url,{headers:{[hdr]:hdr.toLowerCase()==='authorization'&&!/^(bearer|basic|token) /i.test(key)?'Bearer '+key:key,'Accept':'application/json','User-Agent':'SmartEvergreen-FieldMap/1.0'},signal:AbortSignal.timeout(30000)});
  const txt=await r.text();let j;try{j=JSON.parse(txt);}catch(e){throw new Error(`HTTP ${r.status} from ERP, not JSON: ${txt.replace(/\s+/g,' ').slice(0,160)}`);}
  if(!r.ok)throw new Error(`HTTP ${r.status} from ERP: ${JSON.stringify(j).slice(0,160)}`);
  const list=Array.isArray(j)?j:(j.data||j.items||j.results||j.records||j.rows||[]);out.push(...list);first=first||list[0]||null;
  const nx=!Array.isArray(j)&&(j.next||j.next_page_url||j.links?.next||j.meta?.next);url=nx?(/^https?:/.test(nx)?nx:base+nx):null;}
 return{list:out,first};}
async function erpPull(){const cfg=Object.fromEntries((await q("SELECT k,v FROM settings WHERE k LIKE 'ERP_PULL_%'")).map(x=>[x.k,x.v]));if(!cfg.ERP_PULL_BASE)return null;const res={};
 for(const [t,fn,def] of [['projects',upsertProject,'/projects'],['enquiries',upsertEnquiry,'/enquiries'],['service',upsertService,'/service']]){
  const path=cfg['ERP_PULL_'+t.toUpperCase()]??def;if(!path||path==='-')continue;
  try{const {list,first}=await erpGetAll(path);const r=await bulk(fn,list);res[t]={...r,errors:r.errors.slice(0,5),sample_fields:first?Object.keys(first).slice(0,30):[]};}catch(e){res[t]={error:e.message};}}
 await q("REPLACE INTO kv_state(k,v) VALUES('erp_pull_last',?)",[JSON.stringify({at:now(),res}).slice(0,200)]);return res;}
app.get('/api/erp-pull',auth(['admin']),W(async(req,res)=>{const sv=Object.fromEntries((await q("SELECT k,v FROM settings WHERE k LIKE 'ERP_PULL_%'")).map(x=>[x.k,x.v]));
 res.json({fields:ERP_PULL_KEYS.map(k=>({key:k,set:!!sv[k],value:k==='ERP_PULL_KEY'?'':(sv[k]||'')})),last:(await one("SELECT v FROM kv_state WHERE k='erp_pull_last'"))?.v||null});}));
app.post('/api/erp-pull/settings',auth(['admin']),W(async(req,res)=>{for(const [k,v] of Object.entries(req.body||{}))if(ERP_PULL_KEYS.includes(k)&&v!=null&&v!=='')await q('REPLACE INTO settings(k,v) VALUES(?,?)',[k,String(v).trim()]);res.json({ok:true});}));
app.post('/api/erp-pull/run',auth(['admin']),W(async(req,res)=>{const r=await erpPull();res.json(r||{error:'Enter the ERP URL first'});}));
app.post('/api/rms/test/:brand',auth(['admin']),W(async(req,res)=>{const c=RMS.connectors[req.params.brand];if(!c)return res.status(404).json({error:'unknown'});
 try{if(!RMS.configured(req.params.brand))throw new Error('credentials not set');let msg='Connected';if(c.testInfo)msg=await c.testInfo();else if(c.token)await c.token();res.json({ok:true,message:msg});}catch(e){res.json({ok:false,message:e.message});}}));
app.get('/api/rms/brands',auth(),(req,res)=>res.json(RMS.BRANDS.map(b=>({brand:b,configured:RMS.configured(b)}))));
// ---- Route planner: search sites, search places, road distance, saved routes ----
app.get('/api/route/search',auth(),W(async(req,res)=>{const t=String(req.query.q||'').trim();if(t.length<2)return res.json([]);const s='%'+t+'%';
 const pick=(kind,sql,args)=>q(sql,args).then(r=>r.map(x=>({kind,...x})));
 const r=(await Promise.all([
  pick('Project','SELECT ext_id ref,customer name,phone,address,area,pincode,lat,lng,stage_label info FROM projects WHERE customer LIKE ? OR ext_id LIKE ? OR phone LIKE ? OR pincode LIKE ? OR area LIKE ? LIMIT 10',[s,s,s,s,s]),
  pick('Enquiry','SELECT ext_id ref,customer name,phone,NULL address,area,pincode,lat,lng,status info FROM enquiries WHERE customer LIKE ? OR ext_id LIKE ? OR phone LIKE ? OR pincode LIKE ? OR area LIKE ? LIMIT 10',[s,s,s,s,s]),
  pick('Service','SELECT ext_id ref,customer name,phone,address,area,pincode,lat,lng,type info FROM service WHERE customer LIKE ? OR ext_id LIKE ? OR phone LIKE ? OR pincode LIKE ? OR area LIKE ? LIMIT 10',[s,s,s,s,s]),
  pick('Inverter site','SELECT d.serial ref,COALESCE(p.customer,d.plant_name) name,p.phone,p.address,COALESCE(p.area,d.city) area,p.pincode,COALESCE(p.lat,d.site_lat) lat,COALESCE(p.lng,d.site_lng) lng,d.brand info FROM rms_devices d LEFT JOIN projects p ON p.ext_id=d.project_ext_id WHERE d.plant_name LIKE ? OR p.customer LIKE ? OR d.serial LIKE ? OR d.city LIKE ? OR p.phone LIKE ? LIMIT 10',[s,s,s,s,s])])).flat();
 res.json(r.slice(0,30));}));
// Any place / address / village / pincode (OpenStreetMap Nominatim via our server; max 1 request per second)
let geoLast=0;const geoCache={};
app.get('/api/geo',auth(),W(async(req,res)=>{const t=String(req.query.q||'').trim().slice(0,120);if(t.length<3)return res.json([]);if(geoCache[t])return res.json(geoCache[t]);
 const w=geoLast+1100-Date.now();if(w>0)await new Promise(r=>setTimeout(r,w));geoLast=Date.now();
 const qs=/^\d{6}$/.test(t)?`postalcode=${t}&country=India`:`q=${encodeURIComponent(t)}&countrycodes=in`;
 let j=[];try{j=await (await fetch(`https://nominatim.openstreetmap.org/search?${qs}&format=json&limit=6`,{headers:{'User-Agent':'EvergreenSolar-FieldMap/1.0'},signal:AbortSignal.timeout(12000)})).json();}catch(e){return res.json([]);}
 res.json(geoCache[t]=(j||[]).map(x=>({name:x.display_name,lat:+x.lat,lng:+x.lon})));}));
// Road distance / time / shape (free OSRM; falls back to straight lines in the browser if it fails)
app.post('/api/route/road',auth(),W(async(req,res)=>{const pts=(req.body.points||[]).filter(p=>isFinite(p.lat)&&isFinite(p.lng)).slice(0,60);if(pts.length<2)return res.json({ok:false});
 try{const c=pts.map(p=>`${(+p.lng).toFixed(5)},${(+p.lat).toFixed(5)}`).join(';');
  const j=await (await fetch(`https://router.project-osrm.org/route/v1/driving/${c}?overview=simplified&geometries=geojson&steps=false`,{headers:{'User-Agent':'EvergreenSolar-FieldMap/1.0'},signal:AbortSignal.timeout(12000)})).json();
  const r=j.routes&&j.routes[0];if(!r)return res.json({ok:false});res.json({ok:true,km:r.distance/1000,min:r.duration/60,legs:(r.legs||[]).map(l=>({km:l.distance/1000,min:l.duration/60})),line:r.geometry.coordinates.map(([x,y])=>[y,x])});}
 catch(e){res.json({ok:false,error:e.message});}}));
app.get('/api/routes',auth(),W(async(req,res)=>res.json(await q('SELECT id,name,route_date,person,phone,purpose,created_by,created_at FROM routes ORDER BY id DESC LIMIT 60'))));
app.get('/api/routes/:id',auth(),W(async(req,res)=>{const r=await one('SELECT * FROM routes WHERE id=?',[req.params.id]);if(!r)return res.status(404).json({error:'not found'});r.data=JSON.parse(r.data||'{}');res.json(r);}));
app.post('/api/routes',auth(['admin','manager','sales']),W(async(req,res)=>{const b=req.body||{},u=req.session.user.name||req.session.user.username;
 const row={name:String(b.name||'Route').slice(0,200),route_date:String(b.route_date||'').slice(0,10)||null,person:String(b.person||'').slice(0,120)||null,phone:String(b.phone||'').replace(/\D/g,'').slice(-10)||null,purpose:String(b.purpose||'').slice(0,40)||null,data:JSON.stringify({start:b.start,stops:(b.stops||[]).slice(0,60),back:!!b.back})};
 if(b.id){await q('UPDATE routes SET ? WHERE id=?',[row,b.id]);return res.json({ok:true,id:+b.id});}
 const r=await q('INSERT INTO routes SET ?',[{...row,created_by:u,created_at:now()}]);res.json({ok:true,id:r.insertId});}));
app.delete('/api/routes/:id',auth(['admin','manager']),W(async(req,res)=>{await q('DELETE FROM routes WHERE id=?',[req.params.id]);res.json({ok:true});}));
// One inverter: details + last 30 days + alert history (for the detail panel)
app.get('/api/rms/devices/:id/history',auth(),W(async(req,res)=>{const d=await one('SELECT d.*,COALESCE(p.customer,d.plant_name) customer,p.phone,p.pincode,p.address,COALESCE(p.area,d.city) area,COALESCE(d.capacity_kw,p.capacity_kw) kw FROM rms_devices d LEFT JOIN projects p ON p.ext_id=d.project_ext_id WHERE d.id=?',[req.params.id]);
 if(!d)return res.status(404).json({error:'not found'});const from=new Date(Date.now()-30*864e5).toISOString().slice(0,10);
 res.json({device:d,days:await q('SELECT day,kwh,yld,peer_median,verdict FROM rms_daily WHERE serial=? AND day>=? ORDER BY day',[d.serial,from]),
  alerts:await q('SELECT id,type,message,status,opened_at,resolved_at,resolved_by,engineer FROM alerts WHERE serial=? ORDER BY opened_at DESC LIMIT 20',[d.serial])});}));
app.get('/api/rms/devices',auth(),W(async(req,res)=>res.json(await q('SELECT d.*,COALESCE(p.customer,d.plant_name) customer,p.phone,p.pincode,COALESCE(p.area,d.city) area,COALESCE(p.lat,d.site_lat) lat,COALESCE(p.lng,d.site_lng) lng,COALESCE(d.capacity_kw,p.capacity_kw) kw,(SELECT GROUP_CONCAT(DISTINCT a.type) FROM alerts a WHERE a.serial=d.serial AND a.status=\'OPEN\') alerts FROM rms_devices d LEFT JOIN projects p ON p.ext_id=d.project_ext_id ORDER BY d.project_ext_id IS NULL DESC,d.id DESC'))));
app.post('/api/rms/devices',auth(['admin','manager']),W(async(req,res)=>{let {project_ext_id,brand,serial,logger_serial,capacity_kw,customer,phone,pincode}=req.body;
 serial=String(serial||'').trim();if(!serial||!RMS.BRANDS.includes(brand))return res.status(400).json({error:'brand and serial required'});
 if(project_ext_id){if(!await one('SELECT 1 x FROM projects WHERE ext_id=?',[project_ext_id]))return res.status(400).json({error:'Project ID not found'});}
 else{ // ERP not connected yet: create a temporary project from manual details
  if(!customer)return res.status(400).json({error:'Select a project OR enter customer name'});
  project_ext_id='TMP-'+serial;const pin=pincode?String(pincode).trim():null;const p=await lookupPin(pin);
  const r={ext_id:project_ext_id,customer,phone:phone||null,pincode:pin,area:p?.area??null,lat:p?.lat??null,lng:p?.lng??null,capacity_kw:capacity_kw?+capacity_kw:null,stage:'COMPLETED',stage_label:'Linked manually (RMS)',updated_at:now()};
  await q('INSERT INTO projects SET ? ON DUPLICATE KEY UPDATE ?',[r,r]);}
 try{await q('INSERT INTO rms_devices(project_ext_id,brand,serial,logger_serial,capacity_kw,added_by,added_at) VALUES(?,?,?,?,?,?,?)',[project_ext_id,brand,serial,logger_serial||null,capacity_kw?+capacity_kw:null,req.session.user.username,now()]);res.json({ok:true,project_ext_id});}
 catch(e){res.status(400).json({error:e.message});}}));
// Re-link a device to the real ERP project later (temporary project is removed)
app.put('/api/rms/devices/:id',auth(['admin','manager']),W(async(req,res)=>{const d=await one('SELECT * FROM rms_devices WHERE id=?',[req.params.id]);if(!d)return res.status(404).json({error:'not found'});
 const {project_ext_id,logger_serial,capacity_kw}=req.body;
 if(project_ext_id&&project_ext_id!==d.project_ext_id){if(!await one('SELECT 1 x FROM projects WHERE ext_id=?',[project_ext_id]))return res.status(400).json({error:'Project ID not found'});
  await q('UPDATE rms_devices SET project_ext_id=? WHERE id=?',[project_ext_id,d.id]);await q('UPDATE alerts SET project_ext_id=? WHERE serial=?',[project_ext_id,d.serial]);
  if(String(d.project_ext_id).startsWith('TMP-')&&!await one('SELECT 1 x FROM rms_devices WHERE project_ext_id=?',[d.project_ext_id]))await q('DELETE FROM projects WHERE ext_id=?',[d.project_ext_id]);}
 if(logger_serial!=null)await q('UPDATE rms_devices SET logger_serial=? WHERE id=?',[logger_serial||null,d.id]);
 if(capacity_kw!=null&&capacity_kw!=='')await q('UPDATE rms_devices SET capacity_kw=? WHERE id=?',[+capacity_kw,d.id]);
 res.json({ok:true});}));
app.delete('/api/rms/devices/:id',auth(['admin','manager']),W(async(req,res)=>{await q('DELETE FROM rms_devices WHERE id=?',[req.params.id]);res.json({ok:true});}));
app.get('/api/projects/search',auth(),W(async(req,res)=>{const s='%'+(req.query.q||'')+'%';res.json(await q('SELECT ext_id,customer,phone,pincode,capacity_kw FROM projects WHERE customer LIKE ? OR ext_id LIKE ? OR phone LIKE ? LIMIT 20',[s,s,s]));}));
app.get('/api/rms/area',auth(),W(async(req,res)=>{const days=+(req.query.days||30),from=istDay(-days);
 const rows=await q(`SELECT p.pincode,MAX(p.area) area,AVG(p.lat) lat,AVG(p.lng) lng,COUNT(DISTINCT d.serial) systems,SUM(COALESCE(d.capacity_kw,p.capacity_kw)) kw,
  (SELECT SUM(r.kwh) FROM rms_daily r JOIN rms_devices d2 ON d2.serial=r.serial JOIN projects p2 ON p2.ext_id=d2.project_ext_id WHERE p2.pincode=p.pincode AND r.day>=?) kwh
  FROM rms_devices d JOIN projects p ON p.ext_id=d.project_ext_id WHERE p.lat IS NOT NULL GROUP BY p.pincode`,[from]);
 res.json(rows.map(r=>({...r,kw:+r.kw||0,kwh:+r.kwh||0,kwh_per_kw_day:r.kw&&r.kwh?+(r.kwh/r.kw/days).toFixed(2):null})));}));
// ---- Auto-import (dealer account: all inverters with one token) ----
async function discoverBrand(brand,maxMs=200000){await loadSettings();const c=RMS.connectors[brand];
 const known=new Set((await q('SELECT plant_id FROM rms_devices WHERE brand=? AND plant_id IS NOT NULL',[brand])).map(r=>String(r.plant_id)));
 const {list,complete}=await c.discover(known,maxMs);let added=0,updated=0;
 for(const x of list){const loc=[x.lat||null,x.lng||null];
  if(!x.serial){await q('UPDATE rms_devices SET plant_name=?,city=?,site_lat=COALESCE(?,site_lat),site_lng=COALESCE(?,site_lng),capacity_kw=COALESCE(capacity_kw,?) WHERE brand=? AND plant_id=?',[x.plant_name,x.city,...loc,x.capacity_kw,brand,x.plant_id]);updated++;continue;}
  const ex=await one('SELECT id FROM rms_devices WHERE serial=?',[x.serial]);
  if(ex){await q('UPDATE rms_devices SET plant_id=?,plant_name=?,city=?,site_lat=COALESCE(?,site_lat),site_lng=COALESCE(?,site_lng),inverters=?,logger_serial=COALESCE(logger_serial,?),capacity_kw=COALESCE(capacity_kw,?) WHERE id=?',[x.plant_id,x.plant_name,x.city,...loc,x.inverters,x.logger_serial,x.capacity_kw,ex.id]);updated++;}
  else{await q('INSERT INTO rms_devices(project_ext_id,brand,serial,logger_serial,capacity_kw,plant_id,plant_name,city,site_lat,site_lng,inverters,source,added_by,added_at) VALUES(NULL,?,?,?,?,?,?,?,?,?,?,?,?,?)',[brand,x.serial,x.logger_serial,x.capacity_kw,x.plant_id,x.plant_name,x.city,...loc,x.inverters,'AUTO','system',now()]);added++;}}
 return{found:list.length,added,updated,complete};}
async function discoverDaily(){const day=istDay(),d=await one("SELECT v FROM kv_state WHERE k='discover_day'");if(d&&d.v===day)return null;await loadSettings();
 let all=true;const res={};for(const b of RMS.BRANDS){if(!RMS.connectors[b].discover||!RMS.configured(b))continue;
  try{const r=await discoverBrand(b,90000);res[b]=r;if(!r.complete)all=false;}catch(e){res[b]={error:e.message};all=false;}}
 if(all)await q("REPLACE INTO kv_state(k,v) VALUES('discover_day',?)",[day]);return res;}
app.post('/api/rms/discover/:brand',auth(['admin','manager']),W(async(req,res)=>{const b=req.params.brand;await loadSettings();
 if(!RMS.connectors[b]?.discover)return res.status(400).json({error:'Auto-import not available for '+b});if(!RMS.configured(b))return res.status(400).json({error:'Enter the '+b+' token first'});
 res.json(await discoverBrand(b,40000));}));
// ---- Generation page data (separate from enquiry/project map) ----
app.get('/api/gen/map',auth(),W(async(req,res)=>res.json(await q(`SELECT d.id,d.brand,d.serial,d.plant_name,d.city,d.project_ext_id,COALESCE(p.customer,d.plant_name) name,p.phone,
 COALESCE(d.capacity_kw,p.capacity_kw) kw,COALESCE(p.lat,d.site_lat) lat,COALESCE(p.lng,d.site_lng) lng,d.today_kwh,d.last_power_kw,d.total_kwh,d.online,d.last_fetch,d.last_error,d.no_alerts,
 (SELECT GROUP_CONCAT(DISTINCT a.type) FROM alerts a WHERE a.serial=d.serial AND a.status='OPEN') alerts
 FROM rms_devices d LEFT JOIN projects p ON p.ext_id=d.project_ext_id`))));
// ---- Alerts: open / auto-resolve ----
const GRID_WAIT=+(process.env.GRID_FAULT_WAIT_HOURS||12),FOLLOW_HRS=+(process.env.ALERT_FOLLOWUP_HOURS||24);
async function openAlert(d,type,msg){if(await one("SELECT 1 x FROM alerts WHERE serial=? AND type=? AND status='OPEN'",[d.serial,type]))return;
 if(await one('SELECT 1 x FROM rms_devices WHERE serial=? AND no_alerts=1',[d.serial]))return; // out of warranty – no alerts
 const ask=type==='GRID'?new Date(Date.now()+GRID_WAIT*36e5).toISOString():now();
 const r=await q('INSERT INTO alerts(serial,project_ext_id,type,message,opened_at,next_ask_at) VALUES(?,?,?,?,?,?)',[d.serial,d.project_ext_id,type,String(msg).slice(0,600),now(),ask]);
 await q('INSERT INTO alert_log(alert_id,at,who,note) VALUES(?,?,?,?)',[r.insertId,now(),'SYSTEM','Alert opened: '+String(msg).slice(0,480)]);}
async function autoResolve(id,why){await q("UPDATE alerts SET status='RESOLVED',resolved_at=?,resolved_by='AUTO' WHERE id=? AND status='OPEN'",[now(),id]);await q('INSERT INTO alert_log(alert_id,at,who,note) VALUES(?,?,?,?)',[id,now(),'SYSTEM','Auto-resolved: '+why]);}
async function evalAlerts(d,r,err,fails){const hr=istHour(),daylight=hr>=9&&hr<=16,want={};
 if(err){if(fails>=3&&!/key|token|login|unauthor|credential|not configured/i.test(err))want.OFFLINE='No data from inverter/logger: '+err;}
 else{if(r.alarm){if(/grid|no.?grid|mains|island|ac.?volt|ac.?freq|utility/i.test(r.alarm))want.GRID=r.alarm;else want.FAULT=r.alarm;}
  const offMin=d.offline_since?(Date.now()-Date.parse(d.offline_since))/60000:0; // must stay offline 45 min before an alert (no false alarms from one bad reading)
  if(r.online===false&&daylight&&!want.GRID&&offMin>=+(process.env.OFFLINE_ALERT_MINUTES||45))want.OFFLINE='Inverter offline / not running in daytime for '+Math.round(offMin)+' min';}
 for(const [t,m] of Object.entries(want))await openAlert(d,t,m);
 for(const a of await q("SELECT * FROM alerts WHERE serial=? AND status='OPEN' AND type IN ('FAULT','GRID','OFFLINE')",[d.serial])){
  if(want[a.type])continue;if(a.type==='OFFLINE'&&r&&r.online===false)continue; // still offline – keep the alert (and its follow-up history)
  if(err&&a.type!=='OFFLINE')continue;if(err&&fails>=3)continue;await autoResolve(a.id,'inverter back to normal');}}
async function pollRMS(maxMs=240000){const t0=Date.now();await loadSettings();
 const devs=await q('SELECT * FROM rms_devices ORDER BY COALESCE(last_fetch,"") ASC');let n=0;
 const byBrand={};devs.forEach(d=>(byBrand[d.brand]=byBrand[d.brand]||[]).push(d));
 await Promise.all(Object.entries(byBrand).map(async([brand,list])=>{if(!RMS.configured(brand))return;
  for(const d of list){if(Date.now()-t0>maxMs)break;
   try{const r=await RMS.connectors[brand].fetchDevice(d.serial,d);
    d.offline_since=r.online===false?(d.offline_since||now()):null;
    await q('UPDATE rms_devices SET last_power_kw=?,today_kwh=?,total_kwh=?,online=?,last_fetch=?,last_error=?,fail_count=0,offline_since=? WHERE id=?',[r.power_kw!=null?+(+r.power_kw).toFixed(3):null,r.today_kwh,r.total_kwh,r.online==null?null:(r.online?1:0),now(),r.alarm?('ALARM: '+r.alarm).slice(0,300):null,d.offline_since,d.id]);
    if(r.today_kwh!=null)await q('INSERT INTO rms_daily(serial,day,kwh) VALUES(?,?,?) ON DUPLICATE KEY UPDATE kwh=VALUES(kwh)',[d.serial,istDay(),r.today_kwh]);
    await evalAlerts(d,r,null,0);n++;}
   catch(e){if(e.rate){console.log(brand+': rate limited, stopping this round');break;}const f=(d.fail_count||0)+1;await q('UPDATE rms_devices SET last_error=?,last_fetch=?,fail_count=? WHERE id=?',[String(e.message).slice(0,300),now(),f,d.id]);await evalAlerts(d,null,e.message,f);}
   await new Promise(r=>setTimeout(r,800));}}));return n;}
// ---- Smart performance: nearby systems + weather (Open-Meteo, free) + own 30-day normal ----
function dist(a,b,c,d){const t=Math.PI/180,x=Math.sin((c-a)*t/2)**2+Math.cos(a*t)*Math.cos(c*t)*Math.sin((d-b)*t/2)**2;return 12742*Math.asin(Math.sqrt(x));}
const median=a=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const wx={};async function sunHours(lat,lng,day){const k=`${lat.toFixed(1)},${lng.toFixed(1)},${day}`;if(k in wx)return wx[k];
 try{const j=await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=shortwave_radiation_sum&timezone=Asia%2FKolkata&start_date=${day}&end_date=${day}`)).json();
  const mj=j.daily?.shortwave_radiation_sum?.[0];return wx[k]=mj!=null?mj/3.6:null;}catch(e){return wx[k]=null;}}
async function evalPerformance(day){const PR=+(process.env.EXPECTED_PR||0.75),CLEAN=+(process.env.CLEANING_RATIO||0.85),LOW=+(process.env.LOWGEN_RATIO||0.6),DAYS=+(process.env.CLEANING_DAYS||2),KM=+(process.env.PEER_RADIUS_KM||10);
 const bad=new Set((await q("SELECT serial FROM alerts WHERE status='OPEN' AND type IN ('FAULT','GRID','OFFLINE')")).map(r=>r.serial));
 const rows=(await q('SELECT r.serial,r.kwh,d.project_ext_id,COALESCE(d.capacity_kw,p.capacity_kw) kw,COALESCE(p.lat,d.site_lat) lat,COALESCE(p.lng,d.site_lng) lng FROM rms_daily r JOIN rms_devices d ON d.serial=r.serial LEFT JOIN projects p ON p.ext_id=d.project_ext_id WHERE r.day=?',[day])).filter(x=>x.kw>0&&x.kwh!=null);
 rows.forEach(x=>x.y=x.kwh/x.kw);
 for(const x of rows){if(bad.has(x.serial))continue;
  const peers=x.lat==null?[]:rows.filter(o=>o.serial!==x.serial&&!bad.has(o.serial)&&o.lat!=null&&dist(x.lat,x.lng,o.lat,o.lng)<=KM).map(o=>o.y);
  const pm=peers.length>=3?median(peers):null,psh=x.lat!=null?await sunHours(x.lat,x.lng,day):null,exp=psh!=null?psh*PR:null;
  const hist=median((await q("SELECT yld FROM rms_daily WHERE serial=? AND day<? AND day>=? AND yld IS NOT NULL AND verdict<>'CLOUDY'",[x.serial,day,new Date(new Date(day)-30*864e5).toISOString().slice(0,10)])).map(r=>r.yld));
  const ref=pm??exp,ratio=ref?x.y/ref:null,cloudy=psh!=null&&psh<3.0;let v='OK';
  if(ratio!=null&&!cloudy){if(ratio<LOW)v='LOW';else if(ratio<CLEAN)v='DIRTY';}
  if(v==='OK'&&hist&&!cloudy&&x.y<hist*CLEAN&&(pm==null||x.y<pm*0.95))v='DIRTY';
  await q('UPDATE rms_daily SET yld=?,peer_median=?,peers=?,expected=?,ratio=?,verdict=? WHERE serial=? AND day=?',[+x.y.toFixed(2),pm,peers.length,exp,ratio,cloudy?'CLOUDY':v,x.serial,day]);
  const last=(await q("SELECT verdict FROM rms_daily WHERE serial=? AND day<=? AND verdict<>'CLOUDY' ORDER BY day DESC LIMIT ?",[x.serial,day,DAYS])).map(r=>r.verdict);
  const info=`${x.y.toFixed(2)} kWh/kW; nearby avg ${pm?pm.toFixed(2):'n/a'} (${peers.length} systems); weather-expected ${exp?exp.toFixed(2):'n/a'}; own normal ${hist?hist.toFixed(2):'n/a'}`;
  if(last.length>=DAYS&&last.every(z=>z==='LOW'))await openAlert(x,'LOW_GEN',`Generation far below nearby systems for ${DAYS} days – check strings/MPPT/shading. ${info}`);
  else if(last.length>=DAYS&&last.every(z=>z==='DIRTY'||z==='LOW'))await openAlert(x,'CLEANING',`Panels likely dusty – below normal for ${DAYS} days in good weather. Suggest cleaning / AMC. ${info}`);
  if(v==='OK'&&!cloudy)for(const a of await q("SELECT id FROM alerts WHERE serial=? AND status='OPEN' AND type IN ('CLEANING','LOW_GEN')",[x.serial]))await autoResolve(a.id,'generation back to normal ('+info+')');}}
// ---- Alert follow-up Q&A ----
async function questionFor(a){
 if(a.type==='GRID'){const same=a.pincode?(await one("SELECT COUNT(*) c FROM alerts x JOIN projects p ON p.ext_id=x.project_ext_id WHERE x.type='GRID' AND x.status='OPEN' AND p.pincode=?",[a.pincode])).c:1;
  const h=Math.round((Date.now()-new Date(a.opened_at))/36e5);
  return{q:`Grid fault for ${h} hours${same>1?` (${same} systems in this pincode also down – likely area power cut)`:' (only this system – nearby systems running)'}. No engineer needed for a power cut. Call the customer: is there electricity at the house?`,
   options:['Area power cut – wait','Customer MCB / isolator was off – switched on','Meter / DISCOM issue – customer to contact DISCOM','Power is there but inverter shows grid fault – send engineer']};}
 if(a.type==='CLEANING'&&!a.last_answer)return{q:'Panels likely need cleaning. What action?',options:['Customer has AMC – cleaning scheduled','Offered paid cleaning / AMC','Customer will clean themselves','Customer declined','Checked – not dust (shading / other issue)']};
 if(!a.last_answer)return{q:'Has a service engineer been assigned for this alert?',options:['Yes – engineer assigned','No – will assign today','Fixed remotely / customer guided','Customer-side issue (Wi-Fi / power cut / MCB off)','Not needed – false alert']};
 const h=Math.round((Date.now()-new Date(a.last_answer_at))/36e5);
 return{q:`Last time ${a.last_answer_by} answered "${a.last_answer}" (${h} hours ago). The alert is still not resolved – why?`,
  options:['Engineer visited – spare part awaited','Engineer not reached yet – visit scheduled','Customer not available','Need to reassign engineer','Escalate to inverter company','Issue fixed – waiting for data to update']};}
app.get('/api/alerts',auth(),W(async(req,res)=>{const st=req.query.status==='RESOLVED'?'RESOLVED':'OPEN',t=now();
 const rows=await q('SELECT a.*,COALESCE(p.customer,d.plant_name) customer,p.phone,p.pincode,COALESCE(p.area,d.city) area,d.brand FROM alerts a LEFT JOIN projects p ON p.ext_id=a.project_ext_id LEFT JOIN rms_devices d ON d.serial=a.serial WHERE a.status=? ORDER BY a.opened_at DESC LIMIT 500',[st]);
 for(const a of rows){a.round=a.rnd;a.due=a.status==='OPEN'&&a.next_ask_at<=t;if(a.status==='OPEN')a.question=await questionFor(a);a.age_hrs=Math.round((Date.now()-new Date(a.opened_at))/36e5);}
 res.json(rows.sort((x,y)=>(y.due-x.due)||(y.rnd-x.rnd)));}));
app.get('/api/alerts/count',auth(),W(async(req,res)=>{const r=await one("SELECT COUNT(*) open,SUM(next_ask_at<=?) due FROM alerts WHERE status='OPEN'",[now()]);res.json({open:+r.open,due:+(r.due||0)});}));
app.get('/api/alerts/:id/log',auth(),W(async(req,res)=>res.json(await q('SELECT * FROM alert_log WHERE alert_id=? ORDER BY at',[req.params.id]))));
app.post('/api/alerts/:id/answer',auth(),W(async(req,res)=>{const a=await one('SELECT a.*,p.pincode FROM alerts a LEFT JOIN projects p ON p.ext_id=a.project_ext_id WHERE a.id=?',[req.params.id]);
 if(!a||a.status!=='OPEN')return res.status(400).json({error:'alert not open'});const {answer,note,engineer}=req.body;if(!answer)return res.status(400).json({error:'answer required'});
 const u=req.session.user.name||req.session.user.username,qq=(await questionFor(a)).q;
 await q('INSERT INTO alert_log(alert_id,at,who,question,answer,note) VALUES(?,?,?,?,?,?)',[a.id,now(),u,qq.slice(0,500),answer,note||null]);
 const next=new Date(Date.now()+(a.type==='GRID'&&/power cut|wait/i.test(answer)?GRID_WAIT:FOLLOW_HRS)*36e5).toISOString();
 await q('UPDATE alerts SET last_answer=?,last_answer_by=?,last_answer_at=?,next_ask_at=?,rnd=rnd+1,engineer=COALESCE(?,engineer) WHERE id=?',[(answer+(note?' – '+note:'')).slice(0,400),u,now(),next,engineer||null,a.id]);
 res.json({ok:true,next_ask_at:next});}));
// Out of warranty: stop all alerts for this inverter (data is still collected). out=false turns alerts back on.
app.post('/api/rms/warranty',auth(['admin','manager']),W(async(req,res)=>{const {serial,out}=req.body||{};const u=req.session.user.name||req.session.user.username;
 if(!serial||!await one('SELECT 1 x FROM rms_devices WHERE serial=?',[serial]))return res.status(404).json({error:'inverter not found'});
 await q('UPDATE rms_devices SET no_alerts=?,no_alerts_reason=?,no_alerts_by=?,no_alerts_at=? WHERE serial=?',[out?1:0,out?'OUT_OF_WARRANTY':null,u,now(),serial]);let closed=0;
 if(out)for(const a of await q("SELECT id FROM alerts WHERE serial=? AND status='OPEN'",[serial])){await q("UPDATE alerts SET status='RESOLVED',resolved_at=?,resolved_by=? WHERE id=?",[now(),u,a.id]);
  await q('INSERT INTO alert_log(alert_id,at,who,note) VALUES(?,?,?,?)',[a.id,now(),u,'Out of warranty – alerts stopped for this inverter']);closed++;}
 res.json({ok:true,closed});}));
app.post('/api/alerts/:id/resolve',auth(['admin','manager','engineer']),W(async(req,res)=>{const u=req.session.user.name||req.session.user.username;
 await q("UPDATE alerts SET status='RESOLVED',resolved_at=?,resolved_by=? WHERE id=? AND status='OPEN'",[now(),u,req.params.id]);
 await q('INSERT INTO alert_log(alert_id,at,who,note) VALUES(?,?,?,?)',[req.params.id,now(),u,'Manually resolved: '+(req.body.note||'')]);res.json({ok:true});}));
// Diagnose one inverter: shows the raw reply from the inverter company
app.get('/api/rms/debug/:id',auth(['admin','manager']),W(async(req,res)=>{await loadSettings();const d=await one('SELECT * FROM rms_devices WHERE id=?',[req.params.id]);if(!d)return res.status(404).json({error:'not found'});
 if(!RMS.configured(d.brand))return res.json({ok:false,message:d.brand+' credentials not saved'});
 try{const r=await RMS.connectors[d.brand].fetchDevice(d.serial,d);res.json({ok:true,used:d.plant_id?'plant '+d.plant_id:'serial '+d.serial,power_kw:r.power_kw,today_kwh:r.today_kwh,total_kwh:r.total_kwh,raw:JSON.stringify(r.raw).slice(0,1500)});}
 catch(e){res.json({ok:false,used:d.plant_id?'plant '+d.plant_id:'serial '+d.serial,message:e.message});}}));
app.post('/api/rms/refresh',auth(['admin','manager']),(req,res)=>{pollRMS().catch(console.error);res.json({ok:true});});
app.post('/api/rms/evaluate',auth(['admin','manager']),W(async(req,res)=>{const day=req.body?.day||istDay();await evalPerformance(day);res.json({ok:true,day});}));
// ---- CRON (shared hosting: app sleeps, so cPanel cron calls this every 15 min) ----
let running=false;
app.get('/api/admin/keys',auth(['admin']),(req,res)=>{const host=req.get('host');res.json({cron_command:`curl -s "https://${host}/cron/tick?key=${CRON_KEY}" > /dev/null`,erp_api_key:ERP_KEY,erp_base_url:`https://${host}/erp/v1`});});
app.get('/api/bg-status',auth(),W(async(req,res)=>{const r=await one("SELECT v FROM kv_state WHERE k='last_tick'");res.json({last_tick:r?r.v:null});}));
async function runTick(force){if(running)return{skipped:'already running'};running=true;
 try{const lt=await one("SELECT v FROM kv_state WHERE k='last_tick'");if(lt&&Date.now()-Date.parse(lt.v)<12*60e3&&!force){running=false;return({skipped:'ran '+Math.round((Date.now()-Date.parse(lt.v))/60000)+' min ago'});}}catch(e){running=false;throw e;}
 const out={},t0=Date.now();try{await q("REPLACE INTO kv_state(k,v) VALUES('last_tick',?)",[new Date().toISOString()]);out.discovered=await discoverDaily();out.polled=await pollRMS(Math.max(30000,(+(process.env.CRON_MAX_SECONDS||240))*1000-(Date.now()-t0)));out.located=await fillMissingLocations();out.geocoded=await geocodeBatch(15);out.sites_geocoded=await geocodeSites(8);
  {const lp=await one("SELECT v FROM kv_state WHERE k='erp_pull_at'");if(!lp||Date.now()-Date.parse(lp.v)>55*60e3){await q("REPLACE INTO kv_state(k,v) VALUES('erp_pull_at',?)",[new Date().toISOString()]);try{out.erp_pull=await erpPull();}catch(e){out.erp_pull={error:e.message};}}}for(const e of await q("SELECT * FROM web_enquiries WHERE erp_status='FAILED' AND created_at>? LIMIT 20",[new Date(Date.now()-3*864e5).toISOString()]))await pushToERP(e);
  const day=istDay(),done=await one("SELECT v FROM kv_state WHERE k='perf_day'");
  if(istHour()>=19&&(!done||done.v!==day)){await evalPerformance(day);await q("REPLACE INTO kv_state(k,v) VALUES('perf_day',?)",[day]);out.performance=day;}}
 finally{running=false;}return out;}
app.get('/cron/tick',W(async(req,res)=>{if(!CRON_KEY||req.query.key!==CRON_KEY)return res.status(401).json({error:'bad key'});res.json({ok:true,...await runTick(!!req.query.force)});}));
// ---- Public enquiry form (website) -> saved here + pushed to ERP ----
const hits={};
async function pushToERP(e){const url=process.env.ERP_ENQUIRY_WEBHOOK;if(!url)return;
 try{const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-API-Key':process.env.ERP_WEBHOOK_KEY||''},body:JSON.stringify({ref:e.ref,customer_name:e.name,phone:e.phone,email:e.email,pincode:e.pincode,segment:e.segment,monthly_bill:e.monthly_bill,message:e.message,source:'Smart Evergreen website',created_at:e.created_at})});
  const t=(await r.text()).slice(0,300);await q('UPDATE web_enquiries SET erp_status=?,erp_response=? WHERE ref=?',[r.ok?'SENT':'FAILED',t,e.ref]);}
 catch(err){await q("UPDATE web_enquiries SET erp_status='FAILED',erp_response=? WHERE ref=?",[String(err.message).slice(0,300),e.ref]);}}
app.post('/public/enquiry',W(async(req,res)=>{const clean=v=>typeof v==='string'?v.replace(/[<>`\u0000-\u001f]/g,' ').trim():v;const b=Object.fromEntries(Object.entries(req.body||{}).map(([k,v])=>[k,clean(v)])),ip=req.ip;
 if(b.website)return res.json({ok:true}); // honeypot – bots fill hidden field
 const k=ip+':'+istDay();hits[k]=(hits[k]||0)+1;if(hits[k]>5)return res.status(429).json({error:'Too many requests today. Please call 7074833525.'});
 const phone=String(b.phone||'').replace(/\D/g,'').slice(-10)||null,pin=String(b.pincode||'').replace(/\D/g,''),email=String(b.email||'').trim().toLowerCase();
 if(!b.name||String(b.name).trim().length<2)return res.status(400).json({error:'Please enter your name'});
 if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))return res.status(400).json({error:'Please enter a valid email address'});
 if(!phone||!/^[6-9]\d{9}$/.test(phone))return res.status(400).json({error:'Please enter a valid 10-digit mobile number'});
 const bill=String(b.monthly_bill||'').replace(/[^\d]/g,'');if(!bill||+bill<100)return res.status(400).json({error:'Please enter your average monthly electricity bill'});
 if(!/^\d{6}$/.test(pin))return res.status(400).json({error:'Please enter a valid 6-digit pincode'});
 const e={ref:'WEB-'+Date.now().toString(36).toUpperCase(),name:String(b.name).trim().slice(0,120),phone,email:email.slice(0,120),pincode:pin,segment:b.segment==='COMMERCIAL'?'COMMERCIAL':'DOMESTIC',
  monthly_bill:bill,message:String(b.message||'').slice(0,600)||null,page:String(req.get('referer')||'').slice(0,200),ip,created_at:now()};
 await q('INSERT INTO web_enquiries SET ?',[e]);
 await upsertEnquiry({enquiry_id:e.ref,customer_name:e.name,phone:e.phone,pincode:e.pincode,source:'Smart website',enquiry_date:istDay(),status:'OPEN'}); // shows on map immediately
 pushToERP(e);res.json({ok:true,ref:e.ref});}));
// ERP can also PULL website enquiries
app.get('/erp/v1/web-enquiries',erp,W(async(req,res)=>{const since=req.query.since||'1970-01-01';res.json(await q('SELECT ref,name customer_name,phone,email,pincode,segment,monthly_bill,message,created_at FROM web_enquiries WHERE created_at>? ORDER BY created_at LIMIT 500',[since]));}));
app.post('/erp/v1/web-enquiries/ack',erp,W(async(req,res)=>{const refs=arr(req.body).map(x=>x.ref||x).filter(Boolean);let n=0;if(refs.length)n=(await q("UPDATE web_enquiries SET erp_status='SENT',erp_response='pulled by ERP' WHERE ref IN (?)",[refs])).affectedRows;res.json({ok:true,acknowledged:n,received:refs.length,unknown:refs.length-n});}));
app.get('/api/web-enquiries',auth(['admin','manager','sales']),W(async(req,res)=>res.json(await q('SELECT * FROM web_enquiries ORDER BY created_at DESC LIMIT 300'))));
app.post('/api/web-enquiries/retry',auth(['admin']),W(async(req,res)=>{const l=await q("SELECT * FROM web_enquiries WHERE erp_status<>'SENT' LIMIT 100");for(const e of l)await pushToERP(e);res.json({ok:true,retried:l.length});}));
// ---- Public stats for landing page (aggregates only, no customer names/addresses) ----
let pubCache={t:0,v:null};
app.get('/public/stats',W(async(req,res)=>{if(Date.now()-pubCache.t<5*60e3&&pubCache.v)return res.json(pubCache.v);const day=istDay();
 const sys=await one('SELECT COUNT(*) n,SUM(COALESCE(d.capacity_kw,p.capacity_kw)) kw,SUM(d.total_kwh) life,SUM(d.last_power_kw) live FROM rms_devices d LEFT JOIN projects p ON p.ext_id=d.project_ext_id');
 const today=await one('SELECT SUM(kwh) k FROM rms_daily WHERE day=?',[day]);
 const proj=await one("SELECT COUNT(*) n,SUM(capacity_kw) kw FROM projects WHERE stage IN ('NET_METERING_PENDING','DOCUMENT_SENDING','COMPLETED')");
 const al=await one("SELECT COUNT(*) n,SUM(resolved_by='AUTO') auto,AVG(TIMESTAMPDIFF(MINUTE,STR_TO_DATE(LEFT(opened_at,19),'%Y-%m-%dT%H:%i:%s'),STR_TO_DATE(LEFT(resolved_at,19),'%Y-%m-%dT%H:%i:%s'))) mins FROM alerts WHERE status='RESOLVED' AND opened_at>=?",[new Date(Date.now()-30*864e5).toISOString()]);
 const openA=await one("SELECT COUNT(*) n FROM alerts WHERE status='OPEN'");
 // Area map: linked AND not-yet-linked inverters (site location from the inverter cloud / city). Grouped into ~25 km clusters; only cells with 3+ systems are shown (privacy).
 const pts=await q(`SELECT COALESCE(p.lat,d.site_lat) lat,COALESCE(p.lng,d.site_lng) lng,COALESCE(p.area,d.city) area,COALESCE(d.capacity_kw,p.capacity_kw) kw,d.today_kwh FROM rms_devices d LEFT JOIN projects p ON p.ext_id=d.project_ext_id WHERE COALESCE(p.lat,d.site_lat) IS NOT NULL`);
 const cl=[];for(const x of pts){let c=cl.find(c=>dist(c.lat/c.n,c.lng/c.n,+x.lat,+x.lng)<=25);if(!c){c={n:0,lat:0,lng:0,kw:0,today:0,kwToday:0,names:{}};cl.push(c);}
  c.n++;c.lat+=+x.lat;c.lng+=+x.lng;c.kw+=+x.kw||0;if(x.today_kwh!=null&&x.kw){c.today+=+x.today_kwh;c.kwToday+=+x.kw;}const nm=String(x.area||'').split(',')[0].trim();if(nm)c.names[nm]=(c.names[nm]||0)+1;}
 const areas=cl.filter(c=>c.n>=3).map(c=>({area:Object.entries(c.names).sort((a,b)=>b[1]-a[1])[0]?.[0]||'',lat:+(c.lat/c.n).toFixed(2),lng:+(c.lng/c.n).toFixed(2),systems:c.n,kw:Math.round(c.kw),kwh_per_kw:c.kwToday?+(c.today/c.kwToday).toFixed(2):null}));
 const life=+sys.life||0;
 pubCache={t:Date.now(),v:{systems_monitored:+sys.n||0,monitored_kw:Math.round(+sys.kw||0),live_kw:+(+sys.live||0).toFixed(1),today_kwh:Math.round(+today.k||0),lifetime_mwh:+(life/1000).toFixed(1),
  co2_tonnes:+(life*0.82/1000).toFixed(1),trees:Math.round(life*0.82/21),installed_projects:+proj.n||0,installed_kw:Math.round(+proj.kw||0),
  alerts_resolved_30d:+al.n||0,auto_resolved_30d:+(al.auto||0),avg_resolve_hours:al.mins?+(al.mins/60).toFixed(1):null,open_alerts:+openA.n||0,areas,updated:now()}};res.json(pubCache.v);}));
app.get('/app.js',auth(),(req,res)=>{res.set('Cache-Control','no-store');res.type('application/javascript').sendFile(path.join(__dirname,'private','app.js'));});
app.use(express.static(path.join(__dirname,'public'),{dotfiles:'deny',index:'index.html'}));
// ---- Start / CLI / First-run setup wizard ----
const crypto=require('crypto');
function setupApp(errMsg){const sa=express();sa.use(express.urlencoded({extended:false}));
 const page=(msg='',ok=false)=>`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Evergreen Field Map – Setup</title>
 <style>body{font-family:Arial;background:#1b7a3a;display:flex;justify-content:center;padding:30px}form,div.c{background:#fff;padding:24px;border-radius:8px;width:360px}label{display:block;font-size:13px;margin-top:8px}input{width:100%;padding:7px;box-sizing:border-box}button{margin-top:14px;width:100%;padding:9px;background:#1b7a3a;color:#fff;border:0;border-radius:4px}.e{color:#c62828}.s{color:#2e7d32}</style></head><body>
 ${ok?`<div class="c"><h2>Setup complete ✅</h2><p class="s">${msg}</p><p>Wait 10 seconds, then <a href="/">open the app</a> and login.</p></div>`:
 `<form method="post" action="/setup"><h2 style="color:#1b7a3a;margin-top:0">Evergreen Field Map<br><small>Database connection</small></h2>
 ${msg?`<p class="e">${msg}</p>`:''}<b>MySQL database (from cPanel)</b>
 <label>Database host</label><input name="DB_HOST" value="localhost"><label>Database name</label><input name="DB_NAME" required>
 <label>Database user</label><input name="DB_USER" required><label>Database password</label><input name="DB_PASSWORD" type="password" required>
 ${process.env.DB_PASSWORD?'<label>CURRENT saved database password (security check)</label><input name="CUR_PASS" type="password" required>':''}
 <br><br><b>Admin login</b> <small>(leave empty if you already created one – your data is kept)</small><label>Your name</label><input name="ADMIN_NAME" value="Suva"><label>Username</label><input name="ADMIN_USER">
 <label>Password (min 8 characters)</label><input name="ADMIN_PASS" type="password" minlength="8">
 <label>Office location (lat,lng)</label><input name="OFFICE_LATLNG" value="22.6470,88.4400"><button>Save &amp; start</button></form>`}</body></html>`;
 sa.get('*',(req,res)=>res.send(page((errMsg&&!/missing/i.test(errMsg)?'Database connection failed: '+errMsg:'')+`<br><small style="color:#555">Settings files looked for: ${CONFIG_FILES.map(f=>f+(CONFIG_FOUND.includes(f)?' ✅':' ✗')).join('<br>')}</small>`)));
 sa.post('/setup',async(req,res)=>{const b=req.body;
  // Settings already exist (DB just unreachable): only someone who knows the CURRENT database password may change them
  if(process.env.DB_PASSWORD&&b.CUR_PASS!==process.env.DB_PASSWORD)return res.send(page('Settings already exist. Enter the CURRENT database password to change them (protects against takeover).'));const cfg={host:b.DB_HOST||'localhost',port:3306,user:b.DB_USER,password:b.DB_PASSWORD,database:b.DB_NAME};
  try{const c=await mysql.createConnection(cfg);for(const sql of SCHEMA)await c.query(sql);
   const admins=(await c.query("SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1"))[0][0].n;
   let adminMsg='Existing admin login kept.';
   if(b.ADMIN_USER&&b.ADMIN_PASS){await c.query('REPLACE INTO users(name,username,password_hash,role,active) VALUES(?,?,?,?,1)',[b.ADMIN_NAME||b.ADMIN_USER,b.ADMIN_USER,bcrypt.hashSync(b.ADMIN_PASS,10),'admin']);adminMsg=`Admin "${b.ADMIN_USER}" saved.`;}
   else if(!admins){await c.end();return res.send(page('This is a new database – please enter an admin username and password.'));}
   const rnd=()=>crypto.randomBytes(24).toString('hex');
   const key=async k=>{const r=(await c.query('SELECT v FROM kv_state WHERE k=?',[k]))[0][0];if(r)return{v:r.v,old:true};const v=rnd();await c.query('REPLACE INTO kv_state(k,v) VALUES(?,?)',[k,v]);return{v,old:false};};
   const cron=await key('cfg_cron_key'),erpk=await key('cfg_erp_key');await c.end();
   const lines=[`DB_HOST=${cfg.host}`,`DB_NAME=${cfg.database}`,`DB_USER=${cfg.user}`,`DB_PASSWORD=${cfg.password}`,`OFFICE_LATLNG=${b.OFFICE_LATLNG||'22.6470,88.4400'}`].join('\n')+'\n';
   const saved=[];for(const f of CONFIG_FILES){try{fs.writeFileSync(f,lines,{mode:0o600});saved.push(f);}catch(e){}}const where=saved.join('<br>');
   const host=req.get('host');
   res.send(page(`Database connected. ${adminMsg}<br>${cron.old?'<b>Your existing cron command and ERP key are unchanged</b> – nothing to update.':'<b>New keys created – copy these:</b>'}<br><br>Cron command (every 15 min):<br><code style="font-size:11px;word-break:break-all">curl -s "https://${host}/cron/tick?key=${cron.v}" &gt; /dev/null</code><br><br>ERP API key: <code style="word-break:break-all">${erpk.v}</code><br><br><small>Admins can see these any time in the app: API Docs tab.<br>Settings saved to:<br>${where||'(could not save – use Hostinger environment variables)'}<br><b>Safest:</b> also add DB_HOST, DB_NAME, DB_USER, DB_PASSWORD as Environment variables in Hostinger app settings – then this page never comes back.</small>`,true));
   setTimeout(()=>process.exit(0),1500);
  }catch(e){res.send(page('Could not connect: '+e.message+'. Check database name, user and password (user must be added to the database with ALL PRIVILEGES).'));}});
 sa.listen(PORT,()=>console.log('Setup wizard running on port',PORT));}
(async()=>{
 if(!process.env.DB_NAME||!process.env.DB_USER)return setupApp('missing');
 // Settings exist: a DB hiccup right after redeploy must NOT show the setup page – retry for ~1 minute first
 for(let i=1;;i++){try{await initDB();break;}catch(e){console.error('DB failed (try '+i+'):',e.message);
  if(i>=6||/access denied|unknown database/i.test(e.message))return setupApp(e.message);await new Promise(r=>setTimeout(r,10000));}}
 await loadSettings();
 const keyFromDB=async(k,envv)=>{const r=await one('SELECT v FROM kv_state WHERE k=?',[k]);if(envv){if(!r||r.v!==envv)await q('REPLACE INTO kv_state(k,v) VALUES(?,?)',[k,envv]);return envv;}
  if(r)return r.v;const v=crypto.randomBytes(24).toString('hex');await q('REPLACE INTO kv_state(k,v) VALUES(?,?)',[k,v]);return v;};
 CRON_KEY=await keyFromDB('cfg_cron_key',process.env.CRON_KEY);ERP_KEY=await keyFromDB('cfg_erp_key',process.env.ERP_API_KEY);
 if(process.argv.includes('--create-admin')){const [u,pw,name]=process.argv.slice(process.argv.indexOf('--create-admin')+1);
  if(!u||!pw){console.log('Usage: node server.js --create-admin <username> <password> "<Full Name>"');process.exit(1);}
  await q('REPLACE INTO users(name,username,password_hash,role,active) VALUES(?,?,?,?,1)',[name||u,u,bcrypt.hashSync(pw,10),'admin']);console.log('Admin created:',u);process.exit(0);}
 app.listen(PORT,()=>console.log('Evergreen Field Map running on port',PORT));
 // Built-in timer (default ON): keeps fetching data while the server runs, even if nobody has the app open. Hostinger cron is the backup.
 if(process.env.INTERNAL_SCHEDULER!=='0'){const tick=()=>runTick(false).catch(e=>console.error('tick',e.message));setTimeout(tick,60e3);setInterval(tick,5*60e3);}
})().catch(e=>{console.error('Startup failed:',e.message);setupApp(e.message);});

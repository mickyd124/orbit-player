import {createHash} from 'node:crypto';

const httpError=(status,message)=>Object.assign(new Error(message),{status});
const megaSessions=new Map();
const teraboxDomains=new Map();
const TERABOX='https://www.terabox.com';

function checkTeraBoxResult(value){
  if(!value||typeof value!=='object')throw httpError(502,'Invalid TeraBox response.');
  if(Number(value.errno||0)!==0)throw httpError(502,'TeraBox: '+(value.show_msg||'Error '+value.errno));
  return value.data||value;
}
async function teraboxJson(route,options={}){
  const response=await fetch(TERABOX+route,{signal:AbortSignal.timeout(25000),redirect:'error',...options});
  if(!response.ok)throw httpError(502,'TeraBox returned HTTP '+response.status);
  return checkTeraBoxResult(await response.json());
}
function teraboxSignature(){
  const {TERABOX_CLIENT_ID:id,TERABOX_CLIENT_SECRET:secret,TERABOX_PRIVATE_SECRET:privateKey}=process.env;
  if(!id||!secret||!privateKey)throw httpError(400,'Set TERABOX_CLIENT_ID, TERABOX_CLIENT_SECRET and TERABOX_PRIVATE_SECRET on the companion.');
  const timestamp=Math.floor(Date.now()/1000);
  return {client_id:id,client_secret:secret,timestamp,
    sign:createHash('md5').update([id,timestamp,secret,privateKey].join('_')).digest('hex')};
}
function bodyForm(value){return new URLSearchParams(value).toString();}
export function safeTeraBoxDomain(host){
  const value=String(host||'').replace(/^https:\/\//,'').replace(/\/$/,'');
  if(!/^(?:[a-z0-9-]+\.)*(?:terabox\.com|terabox\.app)$/i.test(value))throw httpError(502,'Unexpected TeraBox API domain.');
  return 'https://'+value;
}
async function teraboxAPI(account,route,params={}){
  const info=teraboxDomains.get(account.id);
  let base=info&&info.expires>Date.now()?info.base:null;
  if(!base){
    const data=await teraboxJson('/oauth/tokeninfo',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:bodyForm({access_token:account.access_token})});
    base=safeTeraBoxDomain(data.api_domain);
    teraboxDomains.set(account.id,{base,expires:Date.now()+50*60000});
  }
  const url=new URL(route,base);
  for(const [key,value] of Object.entries({access_tokens:account.access_token,...params}))url.searchParams.set(key,String(value));
  const response=await fetch(url,{signal:AbortSignal.timeout(25000),redirect:'error'});
  if(!response.ok)throw httpError(502,'TeraBox returned HTTP '+response.status);
  return checkTeraBoxResult(await response.json());
}
export async function startTeraBox(){
  if(!process.env.TERABOX_CLIENT_ID||!process.env.TERABOX_CLIENT_SECRET||!process.env.TERABOX_PRIVATE_SECRET)
    throw httpError(400,'Configure the three TERABOX_* credentials on the companion.');
  const result=await teraboxJson('/oauth/devicecode?'+bodyForm({client_id:process.env.TERABOX_CLIENT_ID}));
  if(!result.device_code||!result.qrcode_url)throw httpError(502,'TeraBox did not return a device code and QR image.');
  const raw=String(result.qrcode_url);
  const qr=raw.startsWith('data:image/png;base64,')?raw:
    /^[A-Za-z0-9+/=]{100,}$/.test(raw)?'data:image/png;base64,'+raw:
    /^https:\/\/(?:[a-z0-9-]+\.)*terabox\.(?:com|app)\//i.test(raw)?raw:null;
  if(!qr)throw httpError(502,'TeraBox returned an unrecognized QR image format.');
  return {device_code:String(result.device_code),qrcode:qr,
    interval:Math.max(5,Number(result.interval||5)),
    expires_in:Math.min(1800,Number(result.expires_in||900))};
}
export async function pollTeraBox(code){
  const result=await fetch(TERABOX+'/oauth/gettoken',{method:'POST',redirect:'error',signal:AbortSignal.timeout(25000),
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:bodyForm({...teraboxSignature(),grant_type:'device_code',code})});
  if(!result.ok)throw httpError(502,'TeraBox token endpoint returned HTTP '+result.status);
  const data=await result.json();
  if(Number(data.errno)===400001)return null;
  return checkTeraBoxResult(data);
}
export async function refreshTeraBox(a,persist){
  if(Number(a.expires)>Date.now()+90000)return a.access_token;
  if(!a.refresh_token)throw httpError(401,'TeraBox requires reconnection.');
  const response=await teraboxJson('/oauth/refreshtoken',{method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:bodyForm({...teraboxSignature(),refresh_token:a.refresh_token})});
  if(!response.access_token||!response.refresh_token)throw httpError(502,'TeraBox did not refresh credentials.');
  a.access_token=response.access_token;a.refresh_token=response.refresh_token;
  a.expires=Date.now()+Number(response.expires_in||172800)*1000;
  teraboxDomains.delete(a.id);
  await persist();return a.access_token;
}
export async function browseTeraBox(a,folder,next,refresh){
  await refresh(a);
  const root=String(process.env.TERABOX_ROOT||'/');
  if(!root.startsWith('/')||root.includes('..'))throw httpError(500,'Invalid TERABOX_ROOT setting.');
  const dir=folder||root;
  const prefix=root.endsWith('/')?root:root+'/';
  if(dir!==root&&!dir.startsWith(prefix))throw httpError(400,'Folder is outside the authorized TeraBox root.');
  const page=Math.max(1,Math.min(100000,Number(next||1)||1));
  const data=await teraboxAPI(a,'/openapi/api/list',{dir,num:100,page,order:'name',desc:0});
  const entries=data.info||data.list||[];
  if(!Array.isArray(entries))throw httpError(502,'Unexpected TeraBox folder listing.');
  return {items:entries.map(f=>({id:String(f.isdir?f.path:f.fs_id),name:String(f.server_filename||f.filename||''),
    folder:!!Number(f.isdir),video:!Number(f.isdir)&&([1,2].includes(Number(f.category))||/\.(mp4|m4v|mkv|mov|avi|webm|ts|m2ts|wmv|flv|mpg|mpeg|ogv|3gp|mp3|m4a|aac|flac|wav|ogg|opus|wma|ac3|eac3|dts|mka|aiff|aif|alac|mp2)$/i.test(f.server_filename||'')),
    size:Number(f.size)||0})),
    next:data.has_more||entries.length===100?String(page+1):null};
}
export async function streamTeraBox(a,id,range,refresh){
  if(!/^\d{1,24}$/.test(id))throw httpError(400,'Invalid TeraBox file ID.');
  await refresh(a);
  const data=await teraboxAPI(a,'/openapi/api/download',{fidlist:'['+id+']',type:'dlink'});
  const link=data.dlink&&data.dlink[0]?.dlink;
  if(!link)throw httpError(502,'TeraBox did not supply a download link.');
  const url=new URL(link);
  safeTeraBoxDomain(url.host);
  url.searchParams.set('access_tokens',a.access_token);
  const response=await fetch(url,{signal:null,headers:range?{Range:range}:{},redirect:'follow'});
  if(!response.ok&&response.status!==206)throw httpError(502,'TeraBox download returned HTTP '+response.status);
  return response;
}
async function getMegaSDK(){
  try{return (await import('megajs')).Storage;}catch(e){
    if(e.code==='ERR_MODULE_NOT_FOUND')throw httpError(503,'MEGA support needs the megajs package. Run npm install on the companion.');
    throw e;
  }
}
async function megaLogin(a){
  const cached=megaSessions.get(a.id);
  if(cached)return cached;
  const Storage=await getMegaSDK();
  const storage=await new Storage({email:a.email,password:a.password,keepalive:false}).ready;
  megaSessions.set(a.id,storage);return storage;
}
export async function verifyMega(email,password){
  const Storage=await getMegaSDK();
  const storage=await new Storage({email,password,keepalive:false}).ready;
  const label=storage.name||email;
  storage.close();
  return label;
}
export function disconnectMega(id){
  const current=megaSessions.get(id);
  if(current){megaSessions.delete(id);current.close();}
  teraboxDomains.delete(id);
}
export async function browseMega(a,folder){
  const storage=await megaLogin(a);
  const dir=folder?storage.files[folder]:storage.root;
  if(!dir||!dir.directory)throw httpError(404,'MEGA folder no longer exists.');
  return {items:(dir.children||[]).map(f=>({id:f.nodeId,name:f.name||'Untitled',
    folder:!!f.directory,video:!f.directory&&/\.(mp4|m4v|mkv|mov|avi|webm|ts|m2ts|wmv|flv|mpg|mpeg|ogv|3gp|mp3|m4a|aac|flac|wav|ogg|opus|wma|ac3|eac3|dts|mka|aiff|aif|alac|mp2)$/i.test(f.name||''),
    size:Number(f.size)||0})),next:null};
}
export async function streamMega(a,id,range,res){
  const storage=await megaLogin(a);
  const file=storage.files[id];
  if(!file||file.directory)throw httpError(404,'MEGA file not found.');
  const size=Number(file.size);
  if(!Number.isSafeInteger(size)||size<0)throw httpError(502,'Invalid MEGA file size.');
  let start=0,end=size-1;
  if(range){
    const match=/^bytes=(\d*)-(\d*)$/.exec(range);
    if(!match||(!match[1]&&!match[2]))throw httpError(416,'Invalid byte range.');
    if(match[1]){start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]));}
    else start=Math.max(0,size-Number(match[2]));
    if(start>=size||start>end)throw httpError(416,'Byte range is outside the file.');
  }
  const extension=String(file.name||'').split('.').pop().toLowerCase();
  const mime={mp4:'video/mp4',m4v:'video/mp4',mov:'video/quicktime',webm:'video/webm',
    mkv:'video/x-matroska',avi:'video/x-msvideo',ts:'video/mp2t',m2ts:'video/mp2t',
    mpeg:'video/mpeg',mpg:'video/mpeg',ogv:'video/ogg',mp3:'audio/mpeg',m4a:'audio/mp4',aac:'audio/aac',flac:'audio/flac',wav:'audio/wav',ogg:'audio/ogg',opus:'audio/ogg'}[extension]||'application/octet-stream';
  res.status(range?206:200).set({'Content-Type':mime,
    'Accept-Ranges':'bytes','Content-Length':String(end-start+1),'Cache-Control':'no-store'});
  if(range)res.set('Content-Range',`bytes ${start}-${end}/${size}`);
  if(size===0)return res.end();
  const stream=file.download({start,end,forceHttps:true});
  res.on('close',()=>stream.destroy());
  stream.on('error',e=>{if(!res.headersSent)res.status(502).end('MEGA stream failed');else res.destroy(e);});
  stream.pipe(res);
}

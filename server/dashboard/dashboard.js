'use strict';
const $=id=>document.getElementById(id);
let token='',busy=false,generation=0;
const names={orbit:'Orbit Player',multcloud:'MultCloud TV',both:'Both apps',paused:'Paused'};
const providers={google:'Google Drive',mega:'MEGA',terabox:'TeraBox',onedrive:'OneDrive',dropbox:'Dropbox',webdav:'WebDAV'};
function say(s){$('message').textContent=s;}
async function api(path,options={}){
 const res=await fetch('/api/'+path,{...options,cache:'no-store',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},signal:AbortSignal.timeout(10000)});
 const data=await res.json();if(!res.ok){const e=new Error(data.error||'Request failed');e.status=res.status;throw e;}return data;
}
function lock(){generation++;token='';$('token').value='';$('dashboard').hidden=true;$('login').hidden=false;$('connection').textContent='Locked';$('connection').classList.remove('online');$('accounts').replaceChildren();$('addresses').replaceChildren();$('activity').textContent='';$('codec-detail').textContent='';}
function row(parent,label,extra,cls){const el=document.createElement('div');el.className=cls;const name=document.createElement('span');name.textContent=label;el.append(name);if(extra){const small=document.createElement('small');small.textContent=extra;el.append(small);}parent.append(el);return el;}
function setLink(id,enabled){$(id).setAttribute('aria-disabled',String(!enabled));$(id).hidden=!enabled;}
function render(s){
 $('login').hidden=true;$('dashboard').hidden=false;$('connection').textContent='Connected';$('connection').classList.add('online');
 $('host').textContent=location.origin;$('server-state').textContent='Running';$('uptime').textContent='Uptime: '+Math.floor(s.uptime/3600)+'h '+Math.floor(s.uptime/60)%60+'m';$('mode').textContent=names[s.mode]||s.mode;$('sessions').textContent=s.sessions;$('runtime').textContent=s.platform;
 document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===s.mode)));
 const orbit=s.clients.includes('orbit'),multi=s.clients.includes('multcloud');
 setLink('orbit',orbit);setLink('multcloud',multi);setLink('manage',orbit||multi);$('manage').href=orbit?'/orbit':'/multcloud';
 $('addresses').replaceChildren();const urls=s.addresses.length?s.addresses:[location.origin];
 for(const url of urls){const line=document.createElement('div');line.className='address';const code=document.createElement('code');code.textContent=url;const b=document.createElement('button');b.className='secondary';b.textContent='Copy';b.onclick=async()=>{try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(url);}else{const r=document.createRange();r.selectNodeContents(code);const selection=getSelection();selection.removeAllRanges();selection.addRange(r);if(!document.execCommand('copy'))throw Error('Copy unavailable');selection.removeAllRanges();}say('Address copied.');}catch{say('Select and copy the address manually.');}};line.append(code,b);$('addresses').append(line);}
 $('ffmpeg').textContent='FFmpeg: '+(s.ffmpeg?'installed':'not installed');$('codec-summary').textContent=s.media?('FFprobe: '+(s.media.ffprobe?'ready':'missing')+' · '+s.media.decoders+' decoders · '+s.media.encoders+' encoders · H.264/AAC fallback: '+(s.media.ready?'ready':'missing encoder')):'Codec inventory unavailable';$('torrent').textContent='BitTorrent: '+(s.torrentEnabled?'enabled':'disabled');$('node').textContent='Node '+s.node;
 $('activity').textContent=s.activity.map(a=>new Date(a.at).toLocaleTimeString()+'  '+a.message).join('\n');
}
function accounts(data){$('count').textContent=data.accounts.length+' linked';$('providers').replaceChildren();for(const [id,label] of Object.entries(providers)){const el=document.createElement('span');el.textContent=label+' · '+(data.enabled[id]?'available':'setup required');$('providers').append(el);}$('accounts').replaceChildren();for(const a of data.accounts)row($('accounts'),a.name,providers[a.type]||a.type,'account');if(!data.accounts.length)row($('accounts'),'No companion accounts linked yet','','account');}
async function refresh(){
 if(!token||busy)return;busy=true;const current=generation;
 try{const s=await api('companion/status');if(current!==generation)return;render(s);say('');try{const data=await api('cloud/accounts');if(current===generation)accounts(data);}catch(e){if(current===generation)say('Cloud account status unavailable: '+e.message);}}
 catch(e){if(current!==generation)return;if(e.status===401){lock();say('Invalid access token.');}else{$('connection').textContent='Disconnected';$('connection').classList.remove('online');$('server-state').textContent='Unknown';say(e.message);}}
 finally{busy=false;}
}
$('login-form').onsubmit=async e=>{e.preventDefault();if(busy)return;token=$('token').value.trim();$('token').value='';say('Connecting…');await refresh();if($('dashboard').hidden)lock();};
$('lock').onclick=()=>{lock();say('Dashboard locked.');};$('refresh').onclick=refresh;
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=async()=>{if(!token||busy)return;busy=true;const current=generation;try{await api('companion/mode',{method:'POST',body:JSON.stringify({mode:b.dataset.mode})});}catch(e){if(current===generation)say(e.message);}finally{busy=false;}if(current===generation)await refresh();});
setInterval(()=>{if(token&&!document.hidden)refresh();},8000);

$('codec-list').onclick=async()=>{try{const c=await api('companion/codecs');if(token)$('codec-detail').textContent=(c.version||'FFmpeg not installed')+'\n\nDECODERS\n'+c.decoders.join(', ')+'\n\nENCODERS\n'+c.encoders.join(', ');}catch(e){say(e.message);}};

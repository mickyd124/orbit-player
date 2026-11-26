import {readFileSync,writeFileSync,existsSync,chmodSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {networkInterfaces} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const base=resolve(root,'..');
const file=resolve(base,'companion-settings.json');
process.umask(0o077);
if(!existsSync(file))writeFileSync(file,JSON.stringify({PORT:3000,ORBIT_TOKEN:randomBytes(24).toString('hex')},null,2)+'\n',{mode:0o600,flag:'wx'});
const config=JSON.parse(readFileSync(file,'utf8'));
try{chmodSync(file,0o600)}catch{}
if(!/^[a-f0-9]{48}$/.test(config.ORBIT_TOKEN||''))throw Error('Invalid saved token; back up and repair '+file);
const port=Number(config.PORT||3000);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid port');
const choice=process.argv[2]||'both';
const mode=({'1':'orbit','2':'multcloud','3':'both','':'both',orbit:'orbit',multcloud:'multcloud',both:'both'})[choice];
if(!mode)throw Error('Invalid selection');
const allowed=['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','MS_CLIENT_ID','DROPBOX_APP_KEY','TERABOX_CLIENT_ID','TERABOX_CLIENT_SECRET','TERABOX_PRIVATE_SECRET','TERABOX_ROOT','GOOGLE_AUTH_MODE'];
const env={...process.env,PORT:String(port),ORBIT_TOKEN:config.ORBIT_TOKEN,ORBIT_CLIENT_MODE:mode};
for(const k of allowed)if(typeof config[k]==='string'&&config[k])env[k]=config[k];
if(process.platform==='android'||process.env.TERMUX_VERSION||process.env.PREFIX?.includes('/com.termux/'))env.ORBIT_DISABLE_TORRENT='1';
if(existsSync(resolve(base,'cloud-only')))env.ORBIT_DISABLE_TORRENT='1';
try{await fetch('http://127.0.0.1:'+port+'/api/health',{signal:AbortSignal.timeout(1500)});throw Error('Port already in use')}catch(e){if(e.message==='Port already in use')throw e}
const child=spawn(process.execPath,['server/index.js'],{cwd:root,env,stdio:'inherit'});
let stopped=false,exitCode=1;
const done=new Promise(r=>{child.once('error',e=>{console.error(e.message);stopped=true;r()});child.once('exit',(c)=>{stopped=true;exitCode=c??0;r()})});
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{if(!stopped)child.kill(sig)});
let health;
for(let i=0;i<60&&!stopped;i++){
 try{const res=await fetch('http://127.0.0.1:'+port+'/api/health',{headers:{Authorization:'Bearer '+config.ORBIT_TOKEN},signal:AbortSignal.timeout(1500)});if(res.ok){health=await res.json();break}}catch{}
 await new Promise(r=>setTimeout(r,500));
}
if(!health?.ok){console.error('Companion did not pass health check');if(!stopped)child.kill();await done;process.exitCode=1;}
else{
 console.log('\nREADY:',JSON.stringify(health));
 try{for(const entries of Object.values(networkInterfaces()))for(const a of entries||[])if((a.family==='IPv4'||a.family===4)&&!a.internal)console.log('TV URL: http://'+a.address+':'+port)}catch{}
 console.log('Use this device Wi-Fi IP with port '+port+' if not listed.');
 console.log('Dashboard: http://127.0.0.1:'+port+'/companion\nAccess token: '+config.ORBIT_TOKEN+'\nSettings: '+file+'\nCtrl+C stops the server. Private LAN only.');
 if(process.env.ORBIT_NO_BROWSER!=='1'){
  const url='http://127.0.0.1:'+port+'/companion';
  const mobile=process.platform==='android'||process.env.TERMUX_VERSION||process.env.PREFIX?.includes('/com.termux/');
  const command=mobile?['termux-open-url',[url]]:process.platform==='win32'?['rundll32.exe',['url.dll,FileProtocolHandler',url]]:process.platform==='darwin'?['open',[url]]:process.env.DISPLAY||process.env.WAYLAND_DISPLAY?['xdg-open',[url]]:null;
  if(command){const browser=spawn(command[0],command[1],{stdio:'ignore',detached:true});browser.on('error',()=>console.log('Open dashboard manually: '+url));browser.unref();}
 }
 await done;process.exitCode=exitCode;
}

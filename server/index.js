import express from 'express';
import createCloud from './cloud.js';
import {randomBytes} from 'node:crypto';
import {networkInterfaces} from 'node:os';
import {spawn} from 'node:child_process';
import {detectCapabilities,probeMedia,choosePlan,buildArgs} from './media-engine.js';
import {mkdir,mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateSource} from './policy.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const app=express(),token=process.env.ORBIT_TOKEN||randomBytes(24).toString('hex'),port=Number(process.env.PORT||3000),sessions=new Map();
const media=detectCapabilities(),ffmpeg=media.ffmpeg;
const torrentEnabled=process.env.ORBIT_DISABLE_TORRENT!=='1';
let torrentClient;
app.use((req,res,next)=>{res.set('Access-Control-Allow-Origin','*');res.set('Access-Control-Allow-Headers','Authorization, Content-Type');res.set('Access-Control-Allow-Methods','GET,POST,DELETE,OPTIONS');res.set('Cache-Control','no-store');if(req.method==='OPTIONS')return res.sendStatus(204);next();});
app.use('/api',(req,res,next)=>{if(req.headers.authorization!=='Bearer '+token)return res.status(401).json({error:'Invalid companion token'});next();});
app.use('/api/sessions',express.json({limit:'2mb'}));
app.use(express.json({limit:'16kb'}));
const cloud=createCloud(token,port,root);
app.use('/api/cloud',cloud.api);
app.use('/cloud',cloud.pub);
const modes=['orbit','multcloud','both','paused'];
let mode=modes.includes(process.env.ORBIT_CLIENT_MODE)?process.env.ORBIT_CLIENT_MODE:'both';
const selected=()=>mode==='both'?['orbit','multcloud']:mode==='paused'?[]:[mode];
const started=Date.now();
let activity=[{at:started,message:'Companion started'}];
const record=message=>{activity=[{at:Date.now(),message},...activity].slice(0,30);};
function addresses(){
 const out=[];
 try{for(const group of Object.values(networkInterfaces()))for(const a of group||[])if((a.family==='IPv4'||a.family===4)&&!a.internal)out.push('http://'+a.address+':'+port);}catch{}
 return [...new Set(out)];
}
app.get('/api/companion/codecs',(req,res)=>res.json(media));
app.get('/api/health',(req,res)=>res.json({ok:true,ffmpeg,clients:selected(),mode,torrentEnabled}));
app.get('/api/companion/status',(req,res)=>res.json({ok:true,mode,clients:selected(),ffmpeg,torrentEnabled,port,addresses:addresses(),uptime:Math.floor((Date.now()-started)/1000),platform:process.platform,node:process.version,sessions:sessions.size,activity,media:{ffprobe:media.ffprobe,ready:media.ready,version:media.version,encoders:media.encoders.length,decoders:media.decoders.length}}));
app.post('/api/companion/mode',(req,res)=>{
 // Management writes are same-origin only, in addition to the existing bearer check.
 if(req.get('origin')!=='http://'+req.get('host')&&req.get('origin')!=='https://'+req.get('host'))return res.status(403).json({error:'Open the companion dashboard directly to change mode.'});
 if(!modes.includes(req.body?.mode))return res.status(400).json({error:'Invalid mode'});
 if(mode!==req.body.mode){mode=req.body.mode;record('Client selection changed to '+mode);}
 res.json({ok:true,mode,clients:selected()});
});
app.get('/companion',(req,res)=>{res.set('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");res.sendFile(path.join(root,'server','dashboard','index.html'));});
for(const [url,file] of [['/companion.js','dashboard.js'],['/companion.css','dashboard.css']])app.get(url,(req,res)=>res.sendFile(path.join(root,'server','dashboard',file)));
for(const client of ['orbit','multcloud'])app.get('/'+client,(req,res)=>selected().includes(client)?res.redirect('/?client='+client):res.status(403).type('text').send('Client not selected. Enable it in /companion.'));
app.get('/',(req,res,next)=>{const client=req.query.client;if(typeof client==='string'&&['orbit','multcloud'].includes(client)&&!selected().includes(client))return res.status(403).type('text').send('Client disabled. Enable it in /companion.');next();});
async function destroy(id){const session=sessions.get(id);if(!session)return;sessions.delete(id);session.probe?.kill('SIGKILL');session.process?.kill('SIGKILL');if(session.torrent)await new Promise(resolve=>session.torrent.destroy({destroyStore:true},resolve));session.server?.close();await rm(session.dir,{recursive:true,force:true});}
async function torrentInput(source,session){
 if(!torrentClient){const {default:WebTorrent}=await import('webtorrent');torrentClient=new WebTorrent();torrentClient.on('error',e=>console.error('Torrent client:',e.message));}
 return new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>reject(new Error('Torrent metadata timed out. Check peers and network access.')),90000);
 const torrent=torrentClient.add(source,{path:path.join(session.dir,'torrent')});session.torrent=torrent;
 torrent.once('error',e=>{clearTimeout(timer);reject(e);});
 torrent.once('ready',()=>{clearTimeout(timer);const files=torrent.files.filter(f=>/\.(mp4|mkv|avi|mov|webm|m4v|ts|m2ts|mpeg|mpg|wmv|flv|ogv|mp3|m4a|aac|flac|wav|ogg|opus|wma|ac3|eac3|dts|mka|aiff|aif|alac)$/i.test(f.name)).sort((a,b)=>b.length-a.length);const file=files[0];if(!file)return reject(new Error('No supported media file found in torrent'));torrent.files.forEach(f=>f.deselect());file.select();const server=torrent.createServer();session.server=server;server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+server.address().port+'/'+torrent.files.indexOf(file)));});
 });
}
app.post('/api/sessions',async(req,res)=>{
 let id;
 try{let source=req.body?.url,kind;
 if(req.body?.torrentBase64!==undefined){
  const encoded=req.body.torrentBase64;
  if(typeof encoded!=='string'||encoded.length>1400000||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw Error('Invalid torrent file');
  source=Buffer.from(encoded,'base64');if(source.length>1048576||source[0]!==100||source[source.length-1]!==101)throw Error('Invalid torrent metadata');
  kind='torrent';
 }else kind=validateSource(source);if(kind==='torrent'&&!torrentEnabled)return res.status(503).json({error:'BitTorrent disabled on this companion build; direct cloud playback is available.'});if(!ffmpeg)return res.status(503).json({error:'Install FFmpeg on the companion computer first.'});if(sessions.size>=3)return res.status(429).json({error:'Companion is busy. Close another playback session.'});
 id=randomBytes(24).toString('hex');await mkdir(path.join(root,'.runtime'),{recursive:true});const dir=await mkdtemp(path.join(root,'.runtime','play-'));const session={dir,lastAccess:Date.now(),error:null,shared:req.body.shared===true,title:String(req.body.title||'Companion stream').slice(0,150),ready:false};sessions.set(id,session);
 const input=kind==='torrent'?await torrentInput(source,session):source;
 if(!sessions.has(id))throw new Error('Session expired');
 const info=media.ffprobe?await probeMedia(input,session):null;
 if(!sessions.has(id))throw new Error('Session expired');
 const plan=choosePlan(info,req.body.mode==='safe');
 if(plan.video==='encode'&&!media.encoders.includes('libx264'))throw Error('FFmpeg is missing libx264. Install a full FFmpeg build.');
 if(plan.audio==='encode'&&!media.encoders.includes('aac'))throw Error('FFmpeg is missing AAC encoding. Install a full FFmpeg build.');
 session.plan=plan;
 session.process=spawn('ffmpeg',buildArgs(input,dir,plan),{windowsHide:true,stdio:['ignore','ignore','pipe']});
 // Drain stderr without returning credential-bearing cloud URLs to clients.
 session.process.stderr.on('data',()=>{});
 session.process.on('error',()=>{session.error='FFmpeg could not start.';});
 session.process.on('exit',code=>{if(code!==0)session.error='Conversion failed. Check source availability and installed decoders; try safe compatibility mode.';});
 const deadline=Date.now()+60000;while(Date.now()<deadline){
 if(!sessions.has(id))throw Error('Session expired');
 if(session.error)throw Error(session.error);
 try{const playlist=await readFile(path.join(dir,'index.m3u8'),'utf8');if(playlist.includes('.ts')){session.ready=true;return res.json({id,playback:'/media/'+id+'/index.m3u8',plan:{video:plan.video,audio:plan.audio,videoCodec:plan.videoCodec,audioCodec:plan.audioCodec}});}}catch{}
 await new Promise(resolve=>setTimeout(resolve,300));}
 throw new Error('Media took too long to prepare. Check source availability.');
 }catch(e){if(id)await destroy(id);res.status(400).json({error:e.message});}
});
app.get('/api/sessions',(req,res)=>res.json({sessions:[...sessions].filter(([,s])=>s.shared&&s.ready&&!s.error).map(([id,s])=>({id,title:s.title,playback:'/media/'+id+'/index.m3u8'}))}));
app.delete('/api/sessions/:id',async(req,res)=>{await destroy(req.params.id);res.json({ok:true});});
app.get('/media/:id/:file',(req,res)=>{const session=sessions.get(req.params.id);if(!session||!/^index\.m3u8$|^segment\d+\.ts$/.test(req.params.file))return res.sendStatus(404);session.lastAccess=Date.now();res.sendFile(path.join(session.dir,req.params.file),{dotfiles:'allow'});});
app.use(express.static(path.join(root,'app')));
app.use((err,req,res,next)=>res.status(400).json({error:'Invalid request'}));
const http=app.listen(port,'0.0.0.0',()=>{console.log('Orbit companion: http://localhost:'+port);console.log('Access token: '+token);console.log('FFmpeg: '+(ffmpeg?'ready':'missing'));});http.requestTimeout=180000;
setInterval(()=>{for(const [id,s] of sessions)if(Date.now()-s.lastAccess>20*60000)destroy(id);},60000).unref();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await Promise.all([...sessions.keys()].map(destroy));torrentClient?.destroy();http.close();process.exit(0);});

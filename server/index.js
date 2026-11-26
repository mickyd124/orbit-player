import express from 'express';
import createCloud from './cloud.js';
import {randomBytes} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {mkdir,mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateSource} from './policy.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const app=express(),token=process.env.ORBIT_TOKEN||randomBytes(24).toString('hex'),port=Number(process.env.PORT||3000),sessions=new Map();
const ffmpeg=spawnSync('ffmpeg',['-version'],{stdio:'ignore'}).status===0;
let torrentClient;
app.use((req,res,next)=>{res.set('Access-Control-Allow-Origin','*');res.set('Access-Control-Allow-Headers','Authorization, Content-Type');res.set('Access-Control-Allow-Methods','GET,POST,DELETE,OPTIONS');res.set('Cache-Control','no-store');if(req.method==='OPTIONS')return res.sendStatus(204);next();});
app.use(express.json({limit:'16kb'}));
app.use('/api',(req,res,next)=>{if(req.headers.authorization!=='Bearer '+token)return res.status(401).json({error:'Invalid companion token'});next();});
const cloud=createCloud(token,port,root);
app.use('/api/cloud',cloud.api);
app.use('/cloud',cloud.pub);
const mode=['orbit','multcloud','both'].includes(process.env.ORBIT_CLIENT_MODE)?process.env.ORBIT_CLIENT_MODE:'both';
const clients=mode==='both'?['orbit','multcloud']:[mode];
app.get('/api/health',(req,res)=>res.json({ok:true,ffmpeg,clients,mode}));
app.get('/companion',(req,res)=>res.type('html').send('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Orbit iSH Companion</title><style>body{font:20px system-ui;background:#101c2a;color:white;padding:24px}a{display:block;background:#24628b;color:white;padding:20px;margin:14px 0;border-radius:12px;text-decoration:none}</style><h1>Shared companion</h1><p>Choose an enabled client. Both use the same cloud accounts and access token.</p>'+clients.map(c=>'<a href="/'+c+'">'+(c==='orbit'?'Orbit Player':'MultCloud TV — Cloud library')+'</a>').join('')+'<p>Use the token printed in iSH. Private Wi-Fi only.</p>'));
for(const client of ['orbit','multcloud'])app.get('/'+client,(req,res)=>clients.includes(client)?res.redirect('/?client='+client):res.status(403).type('text').send('Client not selected. Restart the companion and select Both or this client.'));
async function destroy(id){const session=sessions.get(id);if(!session)return;sessions.delete(id);session.process?.kill('SIGKILL');if(session.torrent)await new Promise(resolve=>session.torrent.destroy({destroyStore:true},resolve));session.server?.close();await rm(session.dir,{recursive:true,force:true});}
async function torrentInput(source,session){
 if(!torrentClient){const {default:WebTorrent}=await import('webtorrent');torrentClient=new WebTorrent();torrentClient.on('error',e=>console.error('Torrent client:',e.message));}
 return new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>reject(new Error('Torrent metadata timed out. Check peers and network access.')),90000);
 const torrent=torrentClient.add(source,{path:path.join(session.dir,'torrent')});session.torrent=torrent;
 torrent.once('error',e=>{clearTimeout(timer);reject(e);});
 torrent.once('ready',()=>{clearTimeout(timer);const files=torrent.files.filter(f=>/\.(mp4|mkv|avi|mov|webm|m4v|ts|m2ts|mpeg|mpg|wmv|flv|ogv)$/i.test(f.name)).sort((a,b)=>b.length-a.length);const file=files[0];if(!file)return reject(new Error('No supported video file found in torrent'));torrent.files.forEach(f=>f.deselect());file.select();const server=torrent.createServer();session.server=server;server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+server.address().port+'/'+torrent.files.indexOf(file)));});
 });
}
app.post('/api/sessions',async(req,res)=>{
 let id;
 try{const source=req.body.url,kind=validateSource(source);if(!ffmpeg)return res.status(503).json({error:'Install FFmpeg on the companion computer first.'});if(sessions.size>=3)return res.status(429).json({error:'Companion is busy. Close another playback session.'});
 id=randomBytes(24).toString('hex');await mkdir(path.join(root,'.runtime'),{recursive:true});const dir=await mkdtemp(path.join(root,'.runtime','play-'));const session={dir,lastAccess:Date.now(),error:null};sessions.set(id,session);
 const input=kind==='torrent'?await torrentInput(source,session):source;
 if(!sessions.has(id))throw new Error('Session expired');
 const args=['-nostdin','-hide_banner','-loglevel','error','-rw_timeout','30000000','-i',input,'-map','0:v:0','-map','0:a:0?','-c:v','libx264','-threads','2','-filter_threads','1','-preset','veryfast','-crf','23','-vf','scale=w=min(1920\\,iw):h=min(1080\\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2','-pix_fmt','yuv420p','-c:a','aac','-ac','2','-b:a','160k','-f','hls','-hls_time','4','-hls_list_size','0','-hls_playlist_type','event','-hls_segment_filename',path.join(dir,'segment%06d.ts'),path.join(dir,'index.m3u8')];
 session.process=spawn('ffmpeg',args);let errors='';session.process.stderr.on('data',data=>{errors=(errors+data.toString()).slice(-2000);});session.process.on('error',e=>{session.error=e.message;});session.process.on('exit',code=>{if(code&&code!==0)session.error='Conversion failed: '+errors.slice(-2000);});
 const deadline=Date.now()+60000;while(Date.now()<deadline){if(session.error)throw new Error(session.error);try{const playlist=await readFile(path.join(dir,'index.m3u8'),'utf8');if(playlist.includes('.ts'))return res.json({id,source,playback:'/media/'+id+'/index.m3u8'});}catch{}await new Promise(resolve=>setTimeout(resolve,300));}
 throw new Error('Media took too long to prepare. Check source availability.');
 }catch(e){if(id)await destroy(id);res.status(400).json({error:e.message});}
});
app.delete('/api/sessions/:id',async(req,res)=>{await destroy(req.params.id);res.json({ok:true});});
app.get('/media/:id/:file',(req,res)=>{const session=sessions.get(req.params.id);if(!session||!/^index\.m3u8$|^segment\d+\.ts$/.test(req.params.file))return res.sendStatus(404);session.lastAccess=Date.now();res.sendFile(path.join(session.dir,req.params.file),{dotfiles:'allow'});});
app.use(express.static(path.join(root,'app')));
app.use((err,req,res,next)=>res.status(400).json({error:'Invalid request'}));
const http=app.listen(port,'0.0.0.0',()=>{console.log('Orbit companion: http://localhost:'+port);console.log('Access token: '+token);console.log('FFmpeg: '+(ffmpeg?'ready':'missing'));});http.requestTimeout=180000;
setInterval(()=>{for(const [id,s] of sessions)if(Date.now()-s.lastAccess>20*60000)destroy(id);},60000).unref();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await Promise.all([...sessions.keys()].map(destroy));torrentClient?.destroy();http.close();process.exit(0);});

import http from 'node:http';
import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
// Generate /tmp/orbit-test.mp4 with FFmpeg before invoking this optional check.
const sample=readFileSync('/tmp/orbit-test.mp4');
const fixture=http.createServer((req,res)=>{res.setHeader('Content-Type','video/mp4');res.setHeader('Accept-Ranges','bytes');const match=/bytes=(\d+)-(\d*)/.exec(req.headers.range||'');if(match){const start=Number(match[1]),end=match[2]?Number(match[2]):sample.length-1;res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${sample.length}`,'Content-Length':end-start+1});res.end(sample.subarray(start,end+1));}else{res.setHeader('Content-Length',sample.length);res.end(sample);}}).listen(3099,'127.0.0.1');
const child=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:'3100',ORBIT_TOKEN:'integration-test-token'},stdio:'ignore'});
try {
 const base='http://127.0.0.1:3100';
 for(let i=0;i<50;i++){try{await fetch(base);break;}catch{await new Promise(r=>setTimeout(r,100));}}
 assert.equal((await fetch(base+'/api/health')).status,401);
 const headers={'Authorization':'Bearer integration-test-token','Content-Type':'application/json'};
 const response=await fetch(base+'/api/sessions',{method:'POST',headers,body:JSON.stringify({url:'http://127.0.0.1:3099/movie.mp4'})});
 const result=await response.json();assert.ok(response.ok,JSON.stringify(result));
 const playlist=await (await fetch(base+result.playback)).text();assert.ok(playlist.includes('#EXTM3U'));
 const segment=playlist.split('\n').find(line=>line.endsWith('.ts'));assert.ok(segment);
 const media=await fetch(base+result.playback.replace('index.m3u8',segment));assert.equal(media.status,200);assert.ok((await media.arrayBuffer()).byteLength>0);
 assert.equal((await fetch(base+'/api/sessions/'+result.id,{method:'DELETE',headers})).status,200);
 assert.equal((await fetch(base+result.playback)).status,404);
 console.log('PASS: authentication, HTTP → FFmpeg → HLS playlist and segment, session cleanup');
} finally {fixture.close();child.kill('SIGTERM');}

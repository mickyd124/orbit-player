import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import createCloud from '../server/cloud.js';

function listen(app){return new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});}
function url(server){return 'http://127.0.0.1:'+server.address().port;}
async function close(server){return new Promise(resolve=>server.close(resolve));}
const documentXML='<?xml version="1.0"?>'
  +'<d:multistatus xmlns:d="DAV:">'
  +'<d:response><d:href>/dav/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>'
  +'<d:response><d:href>/dav/videos/</d:href><d:propstat><d:prop><d:displayname>videos</d:displayname><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>'
  +'<d:response><d:href>/dav/sample.mp4</d:href><d:propstat><d:prop><d:displayname>sample.mp4</d:displayname><d:getcontenttype>video/mp4</d:getcontenttype><d:getcontentlength>8</d:getcontentlength></d:prop></d:propstat></d:response>'
  +'</d:multistatus>';

test('multi-account companion can browse WebDAV and stream byte ranges using signed links',async()=>{
 const previous=process.env.ORBIT_ALLOW_INSECURE_WEBDAV;
 process.env.ORBIT_ALLOW_INSECURE_WEBDAV='1';
 const temp=await mkdtemp(path.join(os.tmpdir(),'orbit-cloud-test-'));
 const dav=createServer((req,res)=>{
  assert.equal(req.headers.authorization,'Basic '+Buffer.from('test:pass').toString('base64'));
  if(req.method==='PROPFIND'){res.writeHead(207,{'Content-Type':'application/xml'});res.end(documentXML);return;}
  if(req.url==='/dav/sample.mp4'){
   if(req.headers.range==='bytes=0-3'){res.writeHead(206,{'Content-Type':'video/mp4','Content-Length':'4','Content-Range':'bytes 0-3/8','Accept-Ranges':'bytes'});res.end('ABCD');}
   else{res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':'8'});res.end('ABCDEFGH');}
   return;
  }
  res.writeHead(404);res.end();
 });
 const davServer=await new Promise(resolve=>dav.listen(0,'127.0.0.1',()=>resolve(dav)));
 const app=express();app.use(express.json());const cloud=createCloud('test-token',3000,temp);
 app.use('/api/cloud',cloud.api);app.use('/cloud',cloud.pub);
 const server=await listen(app);
 async function call(route,options={}){
  const r=await fetch(url(server)+route,options);
  return {status:r.status,data:await r.json()};
 }
 try{
  const link=await call('/api/cloud/accounts/webdav',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({name:'My test',url:url(davServer)+'/dav/',username:'test',password:'pass'})});
  assert.equal(link.status,201);
  const id=link.data.account.id;
  const other=await call('/api/cloud/accounts/webdav',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({name:'Second test',url:url(davServer)+'/dav/',username:'test',password:'pass'})});
  assert.equal(other.status,201);
  assert.notEqual(id,other.data.account.id);
  const list=await call('/api/cloud/accounts');
  assert.equal(list.data.accounts.length,2);
  assert.equal(JSON.stringify(list.data).includes('pass'),false);
  const browsed=await call('/api/cloud/browse/'+encodeURIComponent(id));
  assert.equal(browsed.status,200);
  assert.equal(browsed.data.items.length,2);
  assert(browsed.data.items.some(f=>f.folder&&f.name==='videos'));
  const file=browsed.data.items.find(f=>f.video);
  assert.equal(file.id,'sample.mp4');
  const playing=await call('/api/cloud/play/'+encodeURIComponent(id),{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({id:file.id,name:file.name})});
  assert.equal(playing.status,200);
  const stream=await fetch(url(server)+playing.data.playback,{headers:{Range:'bytes=0-3'}});
  assert.equal(stream.status,206);
  assert.equal(stream.headers.get('content-range'),'bytes 0-3/8');
  assert.equal(await stream.text(),'ABCD');
  const tampered=await fetch(url(server)+playing.data.playback+'invalid');
  assert.equal(tampered.status,403);
  const remove=await call('/api/cloud/accounts/'+encodeURIComponent(id),{method:'DELETE'});
  assert.equal(remove.status,200);
  const after=await call('/api/cloud/accounts');
  assert.equal(after.data.accounts.length,1);
 }finally{
  await close(server);await close(davServer);await rm(temp,{recursive:true,force:true});
  if(previous===undefined)delete process.env.ORBIT_ALLOW_INSECURE_WEBDAV;
  else process.env.ORBIT_ALLOW_INSECURE_WEBDAV=previous;
 }
});

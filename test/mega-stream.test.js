import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const window={};
vm.runInNewContext(await readFile(new URL('../app/mega-stream.js',import.meta.url),'utf8'),{window,Uint8Array,Number,Math,Error});
test('MEGA stream requests bounded ranges above 4 GiB',async()=>{
 const start=5*1024**3, calls=[];
 const file={size:50*1024**3,async downloadBuffer(o){calls.push(o);return new Uint8Array(o.end-o.start+1);}};
 const data=await window.OrbitMegaStream.readRange(file,start);
 assert.equal(data.fileStart,start);
 assert.equal(data.byteLength,2*1024**2);
 assert.equal(calls[0].end,start+data.byteLength-1);
});
test('MEGA stream handles final partial range and rejects truncation',async()=>{
 const file={size:100,async downloadBuffer(o){return new Uint8Array(o.end-o.start+1);}};
 assert.equal((await window.OrbitMegaStream.readRange(file,90)).byteLength,10);
 file.downloadBuffer=async()=>new Uint8Array(1);
 await assert.rejects(window.OrbitMegaStream.readRange(file,90),/Incomplete/);
});

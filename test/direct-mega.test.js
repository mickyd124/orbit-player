import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../app/direct-mega.js',import.meta.url),'utf8');
function makeHarness(){
 const file={nodeId:'node-1',name:'clip.mp4',directory:false,size:4,
   async downloadBuffer(){return new Uint8Array([0,1,2,3]);}};
 const folder={nodeId:'folder-1',name:'Clips',directory:true,children:[file]};
 const storage={name:'Example Mega',
   root:{directory:true,children:[folder]},files:{'node-1':file,'folder-1':folder},
   close(){storage.closed=true;},closed:false};
 const captured={};
 const window={mega:{Storage:class {constructor(args){captured.creds=args;this.ready=Promise.resolve(storage);}}},
   Orbit:{async openMegaStream(file,name){captured.file=file;captured.name=name;return true;}}};
 vm.runInNewContext(source,{window,Blob,Promise,Number,Date,Math,Error,String});
 return {mega:window.OrbitDirectMega,file,storage,captured};
}

test('Direct MEGA connects and browses cloud folders without a companion',async()=>{
 const {mega,captured}=makeHarness();
 const a=await mega.connect('person@example.com','test-secret');
 assert.equal(captured.creds.email,'person@example.com');
 assert.equal(a.direct,true);
 assert.equal(mega.accounts().length,1);
 assert.equal(mega.accounts()[0].name,'Example Mega');
 assert.equal(JSON.stringify(mega.accounts()).includes('test-secret'),false);
 const root=await mega.browse(a.id);
 assert.equal(root.items.length,1);assert.equal(root.items[0].folder,true);
 const sub=await mega.browse(a.id,'folder-1');
 assert.equal(sub.items[0].video,true);
 assert.equal(sub.items[0].name,'clip.mp4');
});
test('Direct MEGA delegates large files to range streaming without downloading a whole file',async()=>{
 const {mega,file,captured,storage}=makeHarness();
 const a=await mega.connect('person@example.com','password');
 file.size=50*1024*1024*1024;
 file.downloadBuffer=()=>{throw new Error('Unexpected full download');};
 await mega.play(a.id,'node-1');
 assert.equal(captured.file,file);
 assert.equal(captured.name,'clip.mp4');
 assert.throws(()=>mega.browse(a.id,'missing'),/folder not found/);
 mega.disconnect(a.id);
 assert.equal(storage.closed,true);
 await assert.rejects(mega.play(a.id,'node-1'),/no longer connected/);
});
test('Direct MEGA validates account input',async()=>{
 const {mega}=makeHarness();
 await assert.rejects(mega.connect('not-an-email','password'),/valid MEGA email/);
 await assert.rejects(mega.connect('a@example.com',''),/MEGA password/);
});

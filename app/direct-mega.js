(function(root){
'use strict';
// TV-only, range-streamed MEGA access. Credentials remain in session memory.
// MEGA's browser SDK decrypts files; browser video elements cannot consume its encrypted URLs.
var accounts=[];
var seq=0;
function fail(message){return new Error(message);}
function checkSDK(){
 if(!root.mega||typeof root.mega.Storage!=='function')
  throw fail('Direct MEGA library unavailable. Rebuild Orbit with npm run package:webos.');
}
function account(id){
 var found=accounts.find(function(a){return a.id===id;});
 if(!found)throw fail('Direct MEGA account no longer connected. Sign in again.');
 return found;
}
function isVideo(file){
 return /\.(mp4|m4v|mov|webm|mkv|avi|mpg|mpeg|ogv|ts|m2ts|3gp)$/i.test(file.name||'');
}
function mimeOf(name){
 var ext=String(name||'').split('.').pop().toLowerCase();
 return {mp4:'video/mp4',m4v:'video/mp4',mov:'video/quicktime',webm:'video/webm',
  ogv:'video/ogg',mkv:'video/x-matroska',avi:'video/x-msvideo',
  mpg:'video/mpeg',mpeg:'video/mpeg',ts:'video/mp2t',m2ts:'video/mp2t'}[ext]||'application/octet-stream';
}
function publicAccounts(){
 return accounts.map(function(a){return {id:a.id,name:a.name,type:'mega-direct',direct:true};});
}
async function connect(email,password){
 checkSDK();
 if(typeof email!=='string'||!/^\S+@\S+\.\S+$/.test(email)||email.length>255)
  throw fail('Enter a valid MEGA email address.');
 if(typeof password!=='string'||!password||password.length>1024)
  throw fail('Enter your MEGA password.');
 var storage=await new root.mega.Storage({email:email,password:password,keepalive:false}).ready;
 var id='direct-mega-'+Date.now()+'-'+(++seq);
 var entry={id:id,type:'mega-direct',name:String(storage.name||email),storage:storage};
 accounts.push(entry);
 return {id:id,type:'mega-direct',name:entry.name,direct:true};
}
function browse(id,folder){
 var a=account(id),storage=a.storage;
 var dir=folder?storage.files[folder]:storage.root;
 if(!dir||!dir.directory)throw fail('MEGA folder not found.');
 return Promise.resolve({items:(dir.children||[]).map(function(f){
  return {id:String(f.nodeId),name:String(f.name||'Unnamed file'),folder:!!f.directory,
   video:!f.directory&&isVideo(f),size:Number(f.size)||0};
 }),next:null});
}
async function play(id,fileId){
 var a=account(id),file=a.storage.files[fileId];
 if(!file||file.directory||!isVideo(file))throw fail('Choose a supported MEGA video file.');
 if(!Number.isSafeInteger(Number(file.size))||Number(file.size)<=0)
  throw fail('MEGA returned an invalid file size.');
 if(!root.Orbit||typeof root.Orbit.openMegaStream!=='function')
  throw fail('Orbit streaming player is unavailable.');
 return root.Orbit.openMegaStream(file,file.name);
}
function disconnect(id){
 var index=accounts.findIndex(function(a){return a.id===id;});
 if(index<0)return;
 var a=accounts.splice(index,1)[0];
 try{a.storage.close();}catch(e){}
}
root.OrbitDirectMega={
 accounts:publicAccounts,connect:connect,browse:browse,play:play,disconnect:disconnect
};
}(window));

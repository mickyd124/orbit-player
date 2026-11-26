(function(root){
'use strict';
var CHUNK=2*1024*1024, AHEAD=25, BEHIND=15, MAX_QUEUE=48*1024*1024;
async function readRange(file,offset){
 var end=Math.min(Number(file.size),offset+CHUNK)-1;
 if(end<offset)throw new Error('Invalid MEGA range');
 // megajs uses an inclusive end offset. Partial downloads decrypt at the requested offset.
 var bytes=await file.downloadBuffer({start:offset,end:end,maxConnections:1,forceHttps:true});
 if(bytes.byteLength!==end-offset+1)throw new Error('Incomplete MEGA range');
 var result=new Uint8Array(bytes.byteLength);result.set(bytes);
 result.buffer.fileStart=offset;
 return result.buffer;
}
function open(video,file,status){
 if(!root.MediaSource||!root.MP4Box)throw new Error('This TV does not support direct MP4 streaming. Use the companion.');
 var ms=new root.MediaSource(),url=root.URL.createObjectURL(ms),parser=root.MP4Box.createFile(false);
 var stopped=false,busy=false,ready=false,eof=false,offset=0,tracks=[],timer=null,queued=0,lastProgress=Date.now();
 function stop(){
  if(stopped)return;stopped=true;clearInterval(timer);
  video.removeEventListener('seeking',seek);ms.removeEventListener('sourceopen',start);
  try{parser.stop();}catch(e){}
  root.URL.revokeObjectURL(url);
 }
 function error(e){if(stopped)return;stop();status('MEGA streaming failed: '+(e.message||e)+'. Try the companion.');}
 function ahead(){
  var b=video.buffered,t=video.currentTime;
  for(var i=0;i<b.length;i++)if(b.start(i)<=t+0.1&&b.end(i)>=t)return b.end(i)-t;
  return 0;
 }
 function pumpTrack(t){
  if(stopped||t.sb.updating)return;
  try{
   var b=t.sb.buffered,cut=video.currentTime-BEHIND;
   if(b.length&&cut>b.start(0)+5){t.sb.remove(b.start(0),cut);return;}
   if(t.queue.length){
    var data=t.queue.shift();queued-=data.byteLength;t.sb.appendBuffer(data);
   }
  }catch(e){error(e);}
 }
 function enqueue(t,data){
  queued+=data.byteLength;
  if(queued>MAX_QUEUE){error(new Error('TV streaming buffer capacity exceeded'));return;}
  t.queue.push(data);pumpTrack(t);
 }
 parser.onError=error;
 parser.onReady=function(info){
  if(stopped)return;
  try{
   var selected=[];
   var v=info.tracks.filter(function(t){return !!t.video;})[0];
   var a=info.tracks.filter(function(t){return !!t.audio;})[0];
   if(v)selected.push(v);if(a)selected.push(a);
   if(!v)throw new Error('No video track found');
   selected.forEach(function(track){
    var mime=(track.video?'video':'audio')+'/mp4; codecs="'+track.codec+'"';
    if(!root.MediaSource.isTypeSupported(mime))throw new Error('Unsupported TV codec '+track.codec);
    var t={sb:ms.addSourceBuffer(mime),queue:[],id:track.id};
    tracks.push(t);
    t.sb.addEventListener('updateend',function(){pumpTrack(t);});
    t.sb.addEventListener('error',function(){error(new Error('Video segment rejected'));});
    parser.setSegmentOptions(track.id,t,{nbSamples:track.video?60:120,rapAlignement:true});
   });
   if(info.timescale&&info.duration>0)ms.duration=info.duration/info.timescale;
   parser.onSegment=function(id,t,data,sampleNumber){
    if(stopped)return;
    enqueue(t,data);parser.releaseUsedSamples(id,sampleNumber);
   };
   parser.initializeSegmentation().forEach(function(init){enqueue(init.user,init.buffer);});
   ready=true;parser.start();status('');
   var playing=video.play();if(playing)playing.catch(function(){if(!stopped)status('Press Play to start.');});
  }catch(e){error(e);}
 };
 // Keep a sequential stream; do not pretend that unbuffered random seeking is supported.
 function seek(){
  if(stopped||!ready)return;
  var b=video.buffered,t=video.currentTime;
  for(var i=0;i<b.length;i++)if(t>=b.start(i)&&t<=b.end(i))return;
  if(b.length){video.currentTime=Math.max(b.start(0),Math.min(b.end(b.length-1)-0.1,t));status('Seeking is available within the buffered section. Use companion mode for full seeking.');}
 }
 async function tick(){
  if(stopped||busy)return;
  tracks.forEach(pumpTrack);
  if(stopped)return;
  if(eof){
   if(ms.readyState==='open'&&tracks.every(function(t){return !t.queue.length&&!t.sb.updating;})){
    try{ms.endOfStream();}catch(e){error(e);}clearInterval(timer);
   }return;
  }
  if(queued||tracks.some(function(t){return t.sb.updating;})||(ready&&ahead()>AHEAD))return;
  busy=true;
  try{
   var data=await readRange(file,offset);
   if(stopped)return;
   var next=parser.appendBuffer(data);
   if(stopped)return;
   var sequential=offset+data.byteLength;
   // Before metadata is available, MP4Box may jump to a moov box at the file end.
   // After initialization follow its requested sample offset when available.
   var target=Number.isSafeInteger(next)&&next>=0?next:sequential;
   if(target===offset)target=sequential;
   offset=target;
   if(offset>=Number(file.size)){parser.flush();eof=true;if(!ready)throw new Error('MP4 metadata not found');}
   lastProgress=Date.now();
  }catch(e){error(e);}finally{busy=false;}
 }
 function start(){if(stopped)return;timer=setInterval(tick,150);tick();}
 ms.addEventListener('sourceopen',start);video.addEventListener('seeking',seek);
 video.src=url;
 return {stop:stop};
}
root.OrbitMegaStream={open:open,readRange:readRange,chunkBytes:CHUNK};
}(window));

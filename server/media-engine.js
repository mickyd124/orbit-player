import {spawn,spawnSync} from 'node:child_process';
import path from 'node:path';
const protocols='http,https,tcp,tls,crypto';
export function detectCapabilities(){
 const run=(cmd,args)=>spawnSync(cmd,args,{encoding:'utf8',timeout:5000,maxBuffer:2*1024*1024,windowsHide:true});
 const ver=run('ffmpeg',['-version']),probe=run('ffprobe',['-version']);
 const list=(flag)=>{if(ver.status!==0)return [];const r=run('ffmpeg',['-hide_banner',flag]);if(r.status!==0)return [];return r.stdout.split(/\r?\n/).map(l=>/^\s*[VAS][A-Z.]{5}\s+(\S+)/.exec(l)?.[1]).filter(x=>x&&x!=='=');};
 const encoders=list('-encoders'),decoders=list('-decoders');
 return {ffmpeg:ver.status===0,ffprobe:probe.status===0,version:ver.status===0?ver.stdout.split(/\r?\n/)[0].slice(0,150):null,encoders,decoders,ready:encoders.includes('libx264')&&encoders.includes('aac')};
}
export function probeMedia(input,session){
 return new Promise(resolve=>{
 const child=spawn('ffprobe',['-v','error','-protocol_whitelist',protocols,'-rw_timeout','8000000','-probesize','4000000','-analyzeduration','4000000','-show_streams','-of','json',input],{windowsHide:true,stdio:['ignore','pipe','ignore']});
 session.probe=child;let output='',done=false;
 const finish=value=>{if(done)return;done=true;clearTimeout(timer);if(session.probe===child)delete session.probe;resolve(value);};
 const timer=setTimeout(()=>{child.kill('SIGKILL');finish(null);},10000);
 child.stdout.on('data',data=>{output+=data;if(output.length>1000000){child.kill('SIGKILL');finish(null);}});
 child.on('error',()=>finish(null));child.on('close',code=>{try{finish(code===0?JSON.parse(output):null);}catch{finish(null);}});
 });
}
function rate(s){const [a,b]=String(s?.avg_frame_rate||'').split('/').map(Number);return b>0?a/b:0;}
export function choosePlan(info,safe=false){
 const streams=Array.isArray(info?.streams)?info.streams:null;
 const v=streams?.find(s=>s.codec_type==='video'&&!s.disposition?.attached_pic);
 const a=streams?.find(s=>s.codec_type==='audio');
 if(streams&&!v&&!a)throw Error('No audio or video stream found.');
 const fps=rate(v);
 const vc=!!(!safe&&v&&v.codec_name==='h264'&&['Constrained Baseline','Baseline','Main','High'].includes(v.profile)&&v.pix_fmt==='yuv420p'&&v.width>0&&v.width<=1920&&v.height>0&&v.height<=1080&&v.level>0&&v.level<=41&&fps>0&&fps<=30&&v.field_order==='progressive'&&!['smpte2084','arib-std-b67'].includes(v.color_transfer));
 const ac=!!(!safe&&a&&a.codec_name==='aac'&&a.profile==='LC'&&a.channels>0&&a.channels<=2&&[44100,48000].includes(Number(a.sample_rate)));
 return {video:streams?(v?(vc?'copy':'encode'):'none'):'encode',audio:streams?(a?(ac?'copy':'encode'):'none'):'encode',videoIndex:v?.index,audioIndex:a?.index,fps,videoCodec:v?.codec_name||null,audioCodec:a?.codec_name||null,known:!!streams};
}
export function buildArgs(input,dir,plan){
 const args=['-nostdin','-hide_banner','-loglevel','error','-protocol_whitelist',protocols,'-rw_timeout','30000000','-i',input];
 if(plan.video!=='none')args.push('-map',plan.known?'0:'+plan.videoIndex:'0:V:0?');
 if(plan.audio!=='none')args.push('-map',plan.known?'0:'+plan.audioIndex:'0:a:0?');
 args.push('-sn','-dn','-map_metadata','-1');
 if(plan.video==='copy')args.push('-c:v','copy');
 if(plan.video==='encode'){
 const filter='scale=w=min(1920\\,iw):h=min(1080\\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2'+(!plan.fps||plan.fps>30?',fps=30':'');
 args.push('-c:v','libx264','-threads','2','-filter_threads','1','-preset','veryfast','-crf','23','-maxrate','8M','-bufsize','16M','-vf',filter,'-pix_fmt','yuv420p','-profile:v','main','-level:v','4.1','-flags','+cgop','-force_key_frames','expr:gte(t,n_forced*4)');
 }
 if(plan.audio==='copy')args.push('-c:a','copy');
 if(plan.audio==='encode')args.push('-c:a','aac','-profile:a','aac_low','-ac','2','-ar','48000','-b:a','160k');
 args.push('-f','hls','-hls_time','4','-hls_list_size','0','-hls_playlist_type','event','-hls_flags','temp_file','-hls_segment_filename',path.join(dir,'segment%06d.ts'),path.join(dir,'index.m3u8'));
 return args;
}

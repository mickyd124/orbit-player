import {Router} from 'express';
import {randomBytes,createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {readFile,writeFile,mkdir,rename,chmod} from 'node:fs/promises';
import {Readable} from 'node:stream';
import path from 'node:path';

const VIDEO=/\.(mp4|m4v|mkv|mov|avi|webm|ts|m2ts|wmv|flv|mpg|mpeg|ogv|3gp|3gpp)$/i;
const msBase='https://login.microsoftonline.com/consumers/oauth2/v2.0/';
const providers=['google','onedrive','dropbox'];
const random=()=>randomBytes(18).toString('base64url');
const message=e=>e && e.message ? e.message : String(e);
const bad=(status,error)=>Object.assign(new Error(error),{status});
function video(name,mime){return /^video\//i.test(mime||'')||VIDEO.test(name||'');}
function kindItem(id,name,isFolder,mime,size){
  return {id:String(id),name:String(name),folder:!!isFolder,video:!isFolder&&video(name,mime),size:Number(size)||0};
}
async function request(url,options={}){
  const r=await fetch(url,{...options,signal:AbortSignal.timeout(25000)});
  if(!r.ok){let details='';try{const data=await r.json();details=data.error_description||data.error?.message||data.error_summary||data.error||'';}catch{}
    throw bad(r.status,typeof details==='string'&&details?details:'Cloud provider returned HTTP '+r.status);}
  return r;
}
async function json(url,options){return (await request(url,options)).json();}
function form(data){return new URLSearchParams(Object.entries(data).filter(([,v])=>v!==undefined&&v!==null)).toString();}
function oauthHeaders(){return {'Content-Type':'application/x-www-form-urlencoded'};}
function safeWebdav(url){
  const parsed=new URL(url);
  if(parsed.username||parsed.password||parsed.search||parsed.hash)throw bad(400,'Use a WebDAV URL without embedded credentials, queries or fragments.');
  if(parsed.protocol!=='https:'&&!(process.env.ORBIT_ALLOW_INSECURE_WEBDAV==='1'&&parsed.protocol==='http:'))
    throw bad(400,'WebDAV must use HTTPS. Set ORBIT_ALLOW_INSECURE_WEBDAV=1 only for a trusted private network.');
  parsed.pathname=parsed.pathname.replace(/\/?$/,'/');
  return parsed.href;
}
function davUrl(account,file){
  const root=new URL(account.url),url=new URL(String(file||''),root);
  if(url.origin!==root.origin||!url.pathname.startsWith(root.pathname))throw bad(400,'WebDAV file is outside the configured folder.');
  return url.href;
}
function xmlText(input){return input.replace(/&#(x[0-9a-f]+|\d+);|&(?:amp|lt|gt|quot|apos);/gi,(match,n)=>{
  if(n){const value=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return value>0&&value<=0x10ffff?String.fromCodePoint(value):'';}
  return {'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'" }[match.toLowerCase()]||match;
});}
function xmlField(xml,name){const match=xml.match(new RegExp('<(?:[\\w.-]+:)?'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?'+name+'\\s*>','i'));return match?xmlText(match[1].trim()):'';}
function davEntries(xml,account,folder){
  const root=new URL(account.url),requested=new URL(davUrl(account,folder||'')),items=[];
  const blocks=xml.match(/<(?:[\w.-]+:)?response\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?response\s*>/gi)||[];
  for(const block of blocks){
    const href=xmlField(block,'href');if(!href)continue;
    let url;try{url=new URL(href,root);}catch{continue;}
    if(url.origin!==root.origin||!url.pathname.startsWith(root.pathname))continue;
    if(decodeURI(url.pathname.replace(/\/$/,''))===decodeURI(requested.pathname.replace(/\/$/,'')))continue;
    const folderItem=/<(?:[\w.-]+:)?collection(?:\s*\/>|(?:\s[^>]*)?>)/i.test(block);
    const name=xmlField(block,'displayname')||decodeURIComponent(url.pathname.replace(/\/$/,'').split('/').pop()||'');
    items.push(kindItem(url.pathname.slice(root.pathname.length),name,folderItem,xmlField(block,'getcontenttype'),xmlField(block,'getcontentlength')));
  }
  return items;
}
function basic(a){return 'Basic '+Buffer.from(a.username+':'+a.password).toString('base64');}

export default function createCloud(token,port,root){
  const api=Router(),pub=Router(),accountsFile=path.join(root,'.runtime','cloud-accounts.json');
  const pending=new Map();
  let accounts=[],ready;
  function load(){if(!ready)ready=readFile(accountsFile,'utf8').then(s=>{const value=JSON.parse(s);accounts=Array.isArray(value)?value:[];}).catch(e=>{if(e.code!=='ENOENT')throw e;});return ready;}
  async function persist(){
    await mkdir(path.dirname(accountsFile),{recursive:true,mode:0o700});
    const tmp=accountsFile+'.'+random()+'.tmp';
    await writeFile(tmp,JSON.stringify(accounts,null,2),{mode:0o600});
    await chmod(tmp,0o600);await rename(tmp,accountsFile);
  }
  const publicAccount=a=>({id:a.id,type:a.type,name:a.name});
  function account(id){const a=accounts.find(x=>x.id===id);if(!a)throw bad(404,'Cloud account not found.');return a;}
  async function add(a){await load();a.id=random();accounts.push(a);await persist();return publicAccount(a);}
  async function refresh(a){
    if(a.type==='webdav')return null;
    if(a.expires>Date.now()+90000)return a.access_token;
    if(!a.refresh_token)throw bad(401,'Reconnect this cloud account: refresh token unavailable.');
    const endpoint=a.type==='google'?'https://oauth2.googleapis.com/token':a.type==='onedrive'?msBase+'token':'https://api.dropboxapi.com/oauth2/token';
    const client=a.type==='google'?process.env.GOOGLE_CLIENT_ID:a.type==='onedrive'?process.env.MS_CLIENT_ID:process.env.DROPBOX_APP_KEY;
    const body={client_id:client,grant_type:'refresh_token',refresh_token:a.refresh_token};
    if(a.type==='google'&&process.env.GOOGLE_CLIENT_SECRET)body.client_secret=process.env.GOOGLE_CLIENT_SECRET;
    const payload=await json(endpoint,{method:'POST',headers:oauthHeaders(),body:form(body)});
    a.access_token=payload.access_token;a.expires=Date.now()+Number(payload.expires_in||3600)*1000;
    if(payload.refresh_token)a.refresh_token=payload.refresh_token;
    await persist();return a.access_token;
  }
  function pendingSession(id){
    const p=pending.get(id);
    if(!p||p.expires<Date.now()){pending.delete(id);throw bad(404,'Link request expired. Start again.');}
    return p;
  }
  async function finish(p,tokens){
    if(!tokens.access_token)throw bad(502,'Cloud provider did not return an access token.');
    const access=tokens.access_token;
    let label=p.type==='google'?'Google Drive':p.type==='onedrive'?'OneDrive':'Dropbox';
    try{
      if(p.type==='google'){const x=await json('https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)',{headers:{Authorization:'Bearer '+access}});label=x.user?.displayName||x.user?.emailAddress||label;}
      if(p.type==='onedrive'){const x=await json('https://graph.microsoft.com/v1.0/me?$select=displayName,userPrincipalName',{headers:{Authorization:'Bearer '+access}});label=x.displayName||x.userPrincipalName||label;}
      if(p.type==='dropbox'){const x=await json('https://api.dropboxapi.com/2/users/get_current_account',{method:'POST',headers:{Authorization:'Bearer '+access}});label=x.name?.display_name||x.email||label;}
    }catch{/* Account remains connectable if optional profile request is unavailable. */}
    const added=await add({type:p.type,name:label,access_token:access,refresh_token:tokens.refresh_token,
      expires:Date.now()+Number(tokens.expires_in||3600)*1000});
    p.account=added;p.status='linked';delete p.device_code;delete p.verifier;
    return added;
  }

  api.get('/accounts',async(req,res,next)=>{try{await load();res.json({accounts:accounts.map(publicAccount),
    enabled:{google:!!(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET),onedrive:!!process.env.MS_CLIENT_ID,dropbox:!!process.env.DROPBOX_APP_KEY,webdav:true}});}catch(e){next(e);}});
  api.post('/accounts/webdav',async(req,res,next)=>{try{
    const {name,url,username,password}=req.body||{};
    if(typeof url!=='string'||url.length>2048||typeof username!=='string'||typeof password!=='string'||!username||!password)throw bad(400,'Provide a WebDAV URL, username and password.');
    const a={type:'webdav',name:String(name||'WebDAV').slice(0,100),url:safeWebdav(url),username,password};
    await request(a.url,{method:'PROPFIND',headers:{Authorization:basic(a),Depth:'0'},redirect:'error'});
    res.status(201).json({account:await add(a)});
  }catch(e){next(e);}});
  api.delete('/accounts/:id',async(req,res,next)=>{try{await load();account(req.params.id);accounts=accounts.filter(a=>a.id!==req.params.id);await persist();res.json({ok:true});}catch(e){next(e);}});

  api.post('/link/:type',async(req,res,next)=>{try{
    const type=req.params.type;if(!providers.includes(type))throw bad(400,'Unsupported cloud provider.');
    const key=type==='google'?process.env.GOOGLE_CLIENT_ID:type==='onedrive'?process.env.MS_CLIENT_ID:process.env.DROPBOX_APP_KEY;
    if(!key||(type==='google'&&!process.env.GOOGLE_CLIENT_SECRET))throw bad(400,'Set the '+(type==='google'?'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET':type==='onedrive'?'MS_CLIENT_ID':'DROPBOX_APP_KEY')+' environment variable(s) on the companion first.');
    const id=random(),p={type,expires:Date.now()+900000,status:'pending',nextPoll:0,interval:5000};
    pending.set(id,p);
    let result={session:id,type,expires_in:900};
    if(type==='onedrive'||type==='google'&&process.env.GOOGLE_AUTH_MODE==='device'){
      const google=type==='google';
      const data=await json(google?'https://oauth2.googleapis.com/device/code':msBase+'devicecode',{
        method:'POST',headers:oauthHeaders(),body:form({client_id:key,scope:google?'https://www.googleapis.com/auth/drive.readonly':'offline_access Files.Read User.Read'})});
      Object.assign(p,{device_code:data.device_code,interval:Math.max(5000,Number(data.interval||5)*1000),
        expires:Date.now()+Math.min(1800,Number(data.expires_in||900))*1000});
      result={session:id,type,verification_url:data.verification_url||data.verification_uri,user_code:data.user_code,interval:p.interval/1000,expires_in:data.expires_in};
    }else if(type==='dropbox'){
      const verifier=random()+random(),challenge=createHash('sha256').update(verifier).digest('base64url');
      p.verifier=verifier;
      result.url='https://www.dropbox.com/oauth2/authorize?'+form({client_id:key,response_type:'code',
        token_access_type:'offline',code_challenge:challenge,code_challenge_method:'S256',
        scope:'files.metadata.read files.content.read account_info.read'});
    }else{
      // Google browser OAuth: the redirect URI is localhost, so open the link on the companion computer.
      const redirect='http://localhost:'+port+'/cloud/google/callback';
      p.redirect=redirect;
      result.url='http://localhost:'+port+'/cloud/google/start?session='+encodeURIComponent(id);
    }
    res.json(result);
  }catch(e){next(e);}});
  api.post('/link/:id/code',async(req,res,next)=>{try{
    const p=pendingSession(req.params.id);
    if(p.type!=='dropbox'||p.status!=='pending')throw bad(400,'Not awaiting a Dropbox authorization code.');
    const code=String(req.body?.code||'').trim();if(!code||code.length>2000)throw bad(400,'Paste the Dropbox authorization code.');
    const payload=await json('https://api.dropboxapi.com/oauth2/token',{method:'POST',headers:oauthHeaders(),body:form({
      grant_type:'authorization_code',code,client_id:process.env.DROPBOX_APP_KEY,code_verifier:p.verifier})});
    res.json({account:await finish(p,payload)});
  }catch(e){next(e);}});
  api.get('/link/:id',async(req,res,next)=>{try{
    const p=pendingSession(req.params.id);
    if(p.status==='linked')return res.json({status:'linked',account:p.account});
    if(!p.device_code)return res.json({status:'pending'});
    if(Date.now()<p.nextPoll)return res.json({status:'pending'});
    p.nextPoll=Date.now()+p.interval;
    const google=p.type==='google';
    const params={client_id:google?process.env.GOOGLE_CLIENT_ID:process.env.MS_CLIENT_ID,
      grant_type:'urn:ietf:params:oauth:grant-type:device_code',device_code:p.device_code};
    if(google&&process.env.GOOGLE_CLIENT_SECRET)params.client_secret=process.env.GOOGLE_CLIENT_SECRET;
    const r=await fetch(google?'https://oauth2.googleapis.com/token':msBase+'token',{
      method:'POST',headers:oauthHeaders(),body:form(params),signal:AbortSignal.timeout(25000)});
    const data=await r.json();
    if(data.access_token)return res.json({status:'linked',account:await finish(p,data)});
    if(data.error==='authorization_pending')return res.json({status:'pending'});
    if(data.error==='slow_down'){p.interval+=5000;return res.json({status:'pending'});}
    throw bad(400,data.error_description||data.error||'Authorization failed.');
  }catch(e){next(e);}});

  function isLoopback(req){return ['::1','127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);}
  pub.get('/google/start',(req,res,next)=>{try{
    if(!isLoopback(req))throw bad(403,'Open this URL on the computer running Orbit companion.');
    const p=pendingSession(req.query.session);
    if(p.type!=='google'||!p.redirect)throw bad(400,'Invalid Google authorization.');
    const params={client_id:process.env.GOOGLE_CLIENT_ID,redirect_uri:p.redirect,response_type:'code',
      scope:'https://www.googleapis.com/auth/drive.readonly',access_type:'offline',prompt:'consent',
      state:req.query.session};
    res.redirect('https://accounts.google.com/o/oauth2/v2/auth?'+form(params));
  }catch(e){next(e);}});
  pub.get('/google/callback',async(req,res,next)=>{try{
    if(!isLoopback(req))throw bad(403,'Complete Google sign-in on the companion computer.');
    const p=pendingSession(req.query.state);
    if(p.type!=='google'||!p.redirect)throw bad(400,'Invalid Google sign-in session.');
    if(req.query.error)throw bad(400,'Google authorization declined: '+req.query.error);
    const data=await json('https://oauth2.googleapis.com/token',{method:'POST',headers:oauthHeaders(),body:form({
      code:req.query.code,client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri:p.redirect,grant_type:'authorization_code'})});
    const a=await finish(p,data);
    res.type('text/html').send('<!doctype html><meta charset="utf-8"><title>Orbit linked</title><body style="background:#101922;color:#c9f5d6;font:24px Arial;padding:60px"><h1>Cloud connected</h1><p>'+a.type+' is now linked. Return to Orbit on your TV.</p></body>');
  }catch(e){next(e);}});

  async function browse(a,folder,nextPage){
    if(a.type==='webdav'){
      const url=davUrl(a,folder||''),response=await request(url,{method:'PROPFIND',
        headers:{Authorization:basic(a),Depth:'1'},redirect:'error'});
      return {items:davEntries(await response.text(),a,folder),next:null};
    }
    const access=await refresh(a);
    if(a.type==='google'){
      const params={q:"'"+String(folder||'root').replace(/'/g,"\\'")+"' in parents and trashed = false",
        fields:'nextPageToken,files(id,name,mimeType,size)',pageSize:'200',orderBy:'folder,name'};
      if(nextPage)params.pageToken=nextPage;
      const data=await json('https://www.googleapis.com/drive/v3/files?'+form(params),{headers:{Authorization:'Bearer '+access}});
      return {items:data.files.map(f=>kindItem(f.id,f.name,f.mimeType==='application/vnd.google-apps.folder',f.mimeType,f.size)),next:data.nextPageToken||null};
    }
    if(a.type==='onedrive'){
      const base='https://graph.microsoft.com/v1.0/me/drive/';
      const url=nextPage?String(nextPage):base+(folder?'items/'+encodeURIComponent(folder)+'/children':'root/children')+'?$top=200&$select=id,name,file,folder,size';
      if(!url.startsWith(base))throw bad(400,'Invalid OneDrive page token.');
      const data=await json(url,{headers:{Authorization:'Bearer '+access}});
      return {items:(data.value||[]).map(f=>kindItem(f.id,f.name,!!f.folder,f.file?.mimeType,f.size)),next:data['@odata.nextLink']||null};
    }
    const body=nextPage?{cursor:nextPage}:{path:folder||'',recursive:false,limit:200};
    const data=await json('https://api.dropboxapi.com/2/files/'+(nextPage?'list_folder/continue':'list_folder'),{
      method:'POST',headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:JSON.stringify(body)});
    return {items:(data.entries||[]).map(f=>kindItem(f['.tag']==='folder'?f.path_lower:f.id,f.name,f['.tag']==='folder','',f.size)),
      next:data.has_more?data.cursor:null};
  }
  api.get('/browse/:id',async(req,res,next)=>{try{
    await load();const a=account(req.params.id);
    res.json(await browse(a,typeof req.query.folder==='string'?req.query.folder:'',typeof req.query.next==='string'?req.query.next:''));
  }catch(e){next(e);}});

  const secret=createHash('sha256').update(token+':orbit-cloud-media').digest();
  function ticket(payload){
    const content=Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature=createHmac('sha256',secret).update(content).digest('base64url');
    return content+'.'+signature;
  }
  function unticket(value){
    if(typeof value!=='string'||value.length>4096)throw bad(403,'Invalid playback ticket.');
    const [body,sig]=value.split('.');
    if(!body||!sig)throw bad(403,'Invalid playback ticket.');
    const actual=createHmac('sha256',secret).update(body).digest();
    const supplied=Buffer.from(sig,'base64url');
    if(supplied.length!==actual.length||!timingSafeEqual(actual,supplied))throw bad(403,'Invalid playback ticket.');
    const parsed=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
    if(parsed.exp<Date.now()||!parsed.id||!parsed.account)throw bad(403,'Playback link expired.');
    return parsed;
  }
  api.post('/play/:id',async(req,res,next)=>{try{
    await load();const a=account(req.params.id),id=String(req.body?.id||''),name=String(req.body?.name||'');
    if(!id||id.length>2048||!video(name,''))throw bad(400,'Select a supported video file.');
    if(a.type==='webdav')davUrl(a,id);
    const t=ticket({account:a.id,id,name:name.slice(0,255),exp:Date.now()+4*3600000});
    res.json({playback:'/cloud/stream?t='+encodeURIComponent(t)});
  }catch(e){next(e);}});
  pub.get('/stream',async(req,res,next)=>{try{
    await load();const claim=unticket(req.query.t),a=account(claim.account);
    const range=req.headers.range;
    if(range&&!/^bytes=\d*-\d*$/.test(range))throw bad(416,'Unsupported byte range.');
    const headers={};if(range)headers.Range=range;
    let remote;
    if(a.type==='webdav')remote=await request(davUrl(a,claim.id),{headers:{...headers,Authorization:basic(a)},redirect:'error',signal:AbortSignal.timeout(300000)});
    else if(a.type==='google')remote=await request('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(claim.id)+'?alt=media',{
      headers:{...headers,Authorization:'Bearer '+await refresh(a)},signal:AbortSignal.timeout(300000)});
    else if(a.type==='onedrive'){
      const meta=await json('https://graph.microsoft.com/v1.0/me/drive/items/'+encodeURIComponent(claim.id)+'?$select=id,@microsoft.graph.downloadUrl',
        {headers:{Authorization:'Bearer '+await refresh(a)}});
      const url=meta['@microsoft.graph.downloadUrl'];if(!url||!url.startsWith('https://'))throw bad(502,'OneDrive provided no playable download link.');
      remote=await request(url,{headers,signal:AbortSignal.timeout(300000)});
    }else{
      const link=await json('https://api.dropboxapi.com/2/files/get_temporary_link',{
        method:'POST',headers:{Authorization:'Bearer '+await refresh(a),'Content-Type':'application/json'},
        body:JSON.stringify({path:claim.id})});
      if(!link.link||!link.link.startsWith('https://'))throw bad(502,'Dropbox did not provide a streaming link.');
      remote=await request(link.link,{headers,signal:AbortSignal.timeout(300000)});
    }
    res.status(remote.status===206?206:200);
    for(const key of ['content-type','content-length','content-range','accept-ranges'])if(remote.headers.has(key))res.set(key,remote.headers.get(key));
    if(!remote.headers.has('content-type'))res.type('application/octet-stream');
    res.set('Cache-Control','no-store');
    if(!remote.body)return res.end();
    const stream=Readable.fromWeb(remote.body);
    req.on('close',()=>stream.destroy());
    stream.on('error',e=>{if(!res.headersSent)next(e);else res.destroy(e);});
    stream.pipe(res);
  }catch(e){next(e);}});
  api.use((err,req,res,next)=>res.status(err.status||502).json({error:message(err)}));
  pub.use((err,req,res,next)=>res.status(err.status||502).type('text/plain').send(message(err)));
  return {api,pub};
}

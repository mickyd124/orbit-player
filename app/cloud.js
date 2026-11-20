(function(){
'use strict';
var $=function(id){return document.getElementById(id);};
var accounts=[],current=null,stack=[],files=[],nextPage=null,loading=false,pollTimer=null,linkSession=null,available={};
function settings(){try{return JSON.parse(localStorage.getItem('orbit-settings'))||{};}catch(e){return {};}}
function api(route,options){
 var connection=settings();
 if(!connection.url||!connection.token)return Promise.reject(new Error('Connect your companion in Settings first.'));
 options=options||{};
 options.headers=Object.assign({'Authorization':'Bearer '+connection.token},options.headers||{});
 if(options.body)options.headers['Content-Type']='application/json';
 return fetch(connection.url+'/api/cloud'+route,options).then(function(response){
  return response.json().then(function(data){if(!response.ok)throw new Error(data.error||'Cloud request failed');return data;});
 });
}
function status(message,error){$('cloud-status').textContent=message||'';$('cloud-status').className=error?'error':'';}
function dialogStatus(message,error){$('cloud-dialog-status').textContent=message||'';$('cloud-dialog-status').className=error?'error':'';}
function button(text,css,handler){
 var el=document.createElement('button');el.type='button';el.className=css||'';el.textContent=text;el.onclick=handler;return el;
}
function formatSize(size){if(!size)return '';var u=['B','KB','MB','GB','TB'],i=0;while(size>=1024&&i<4){size/=1024;i++;}return size.toFixed(i?1:0)+' '+u[i];}
function badgeName(type){return {webdav:'WebDAV',dropbox:'Dropbox',google:'Google Drive',onedrive:'OneDrive',mega:'MEGA',terabox:'TeraBox'}[type]||type;}
function showAccounts(){
 var list=$('cloud-accounts');list.textContent='';
 list.appendChild(button('☁ All clouds','cloud-account'+(!current?' selected':''),function(){current=null;stack=[];openFolder();}));
 accounts.forEach(function(ac){
  var b=button('▣ '+ac.name+' · '+badgeName(ac.type),'cloud-account'+(current===ac.id?' selected':''),function(){current=ac.id;stack=[];openFolder();});
  list.appendChild(b);
 });
 $('cloud-empty-accounts').hidden=!!accounts.length;
 $('cloud-remove').disabled=!current;
 $('cloud-location').textContent=stack.length?stack.map(function(s){return s.name;}).join(' / '):(current?'Account root':'All cloud accounts');
 $('cloud-up').disabled=!current&&!stack.length;
}
function showFiles(){
 var filter=$('cloud-search').value.trim().toLowerCase(),list=$('cloud-files');list.textContent='';
 var items=files.filter(function(f){return !filter||f.name.toLowerCase().includes(filter)||f.accountName.toLowerCase().includes(filter);});
 if(!items.length){var e=document.createElement('div');e.className='empty';e.textContent=loading?'Loading cloud folders…':'No matching videos or folders here.';list.appendChild(e);}
 items.sort(function(a,b){return Number(b.folder)-Number(a.folder)||a.name.localeCompare(b.name);});
 items.forEach(function(item){
  var row=document.createElement('div');row.className='cloud-file';
  var info=document.createElement('div');info.className='cloud-info';
  var title=document.createElement('strong');title.textContent=(item.folder?'▣ ':'▶ ')+item.name;info.appendChild(title);
  var meta=document.createElement('small');meta.textContent=item.accountName+' · '+(item.folder?'Folder':formatSize(item.size)||'Video');info.appendChild(meta);
  row.appendChild(info);
  if(item.folder){
   row.appendChild(button('Open','cloud-small',function(){
    if(current!==item.accountId){current=item.accountId;stack=[];}
    stack.push({name:item.name,id:item.id});openFolder();
   }));
  }else{
   row.appendChild(button('▶ Play','primary cloud-small',function(){play(item,false);}));
   row.appendChild(button('Convert','cloud-small',function(){play(item,true);}));
  }
  list.appendChild(row);
 });
 $('cloud-more').hidden=!nextPage||!current;
}
function play(item,convert){
 status('Preparing '+item.name+'…');
 api('/play/'+encodeURIComponent(item.accountId),{method:'POST',body:JSON.stringify({id:item.id,name:item.name})}).then(function(data){
  var conn=settings();
  if(!window.Orbit||!window.Orbit.play)throw new Error('Player is unavailable.');
  return window.Orbit.play(conn.url+data.playback,item.name,convert,true);
 }).then(function(){status('');}).catch(function(e){status(e.message,true);});
}
function loadAccount(id,folder,page){
 var url='/browse/'+encodeURIComponent(id)+'?folder='+encodeURIComponent(folder||'');
 if(page)url+='&next='+encodeURIComponent(page);
 return api(url).then(function(data){
  var ac=accounts.find(function(a){return a.id===id;});
  return {items:(data.items||[]).filter(function(f){return f.folder||f.video;}).map(function(f){return Object.assign({},f,{accountId:id,accountName:ac?ac.name:'Cloud'});}),
   next:data.next||null};
 });
}
function openFolder(){
 showAccounts();files=[];nextPage=null;loading=true;showFiles();status('Loading library…');
 var folder=stack.length?stack[stack.length-1].id:'';
 var job=current?loadAccount(current,folder):Promise.all(accounts.map(function(ac){
  return loadAccount(ac.id,'').catch(function(e){return {items:[],error:ac.name+': '+e.message};});
 })).then(function(results){return {items:results.flatMap(function(r){return r.items;}),errors:results.filter(function(r){return r.error;}).map(function(r){return r.error;})};});
 job.then(function(data){
  files=data.items;nextPage=data.next||null;loading=false;showFiles();
  status(data.errors&&data.errors.length?data.errors.join(' · '):files.length+' videos and folders shown'+(!current?' across your connected accounts':''),!!(data.errors&&data.errors.length));
 }).catch(function(e){loading=false;showFiles();status(e.message,true);});
}
function refresh(){
 status('Connecting to companion…');
 return api('/accounts').then(function(data){accounts=data.accounts||[];available=data.enabled||{};showAccounts();openFolder();}).catch(function(e){status(e.message,true);});
}
$('cloud-refresh').onclick=refresh;
$('cloud-search').oninput=showFiles;
$('cloud-up').onclick=function(){if(stack.length){stack.pop();openFolder();}else if(current){current=null;openFolder();}};
$('cloud-more').onclick=function(){
 if(!nextPage||!current)return;
 var b=this;b.disabled=true;
 loadAccount(current,stack.length?stack[stack.length-1].id:'',nextPage).then(function(data){
  files=files.concat(data.items);nextPage=data.next;showFiles();status(files.length+' items loaded');
 }).catch(function(e){status(e.message,true);}).finally(function(){b.disabled=false;});
};
$('cloud-remove').onclick=function(){
 var a=accounts.find(function(a){return a.id===current;});if(!a)return;
 if(!confirm('Disconnect '+a.name+'? Saved cloud credentials will be removed from the companion.'))return;
 api('/accounts/'+encodeURIComponent(a.id),{method:'DELETE'}).then(function(){current=null;stack=[];refresh();}).catch(function(e){status(e.message,true);});
};
function changeProvider(){
 var type=$('cloud-provider').value,isDav=type==='webdav',isMega=type==='mega';
 $('cloud-webdav').hidden=!isDav;$('cloud-mega').hidden=!isMega;
 $('cloud-connect-submit').textContent=isDav?'Save WebDAV account':isMega?'Connect MEGA account':'Start sign-in';
 dialogStatus('');
}
$('cloud-provider').onchange=changeProvider;
function closeDialog(){
 if(pollTimer){clearInterval(pollTimer);pollTimer=null;}
 var d=$('cloud-dialog');if(d.close)d.close();else d.removeAttribute('open');
 linkSession=null;
 $('mega-password').value='';
 $('cloud-qr').removeAttribute('src');$('cloud-qr').hidden=true;
 $('cloud-connect-form').hidden=false;$('cloud-link-step').hidden=true;
 $('cloud-link-code-wrap').hidden=true;
}
$('cloud-cancel').onclick=closeDialog;
$('cloud-finish').onclick=closeDialog;
$('cloud-connect').onclick=function(){
 $('cloud-provider').value='webdav';changeProvider();$('cloud-dialog-status').textContent='';
 $('cloud-connect-form').hidden=false;$('cloud-link-step').hidden=true;
 var d=$('cloud-dialog');if(d.showModal)d.showModal();else d.setAttribute('open','');
 $('cloud-provider').focus();
};
function checkLink(){
 if(!linkSession)return;
 api('/link/'+encodeURIComponent(linkSession)).then(function(data){
  if(data.status==='linked'){
   if(pollTimer){clearInterval(pollTimer);pollTimer=null;}
   dialogStatus('Account linked. You can close this window.');
   $('cloud-finish').textContent='Done';
   refresh();
  }
 }).catch(function(e){dialogStatus(e.message,true);if(pollTimer){clearInterval(pollTimer);pollTimer=null;}});
}
$('cloud-connect-form').onsubmit=function(e){
 e.preventDefault();
 var type=$('cloud-provider').value,action,submit=$('cloud-connect-submit');
 submit.disabled=true;dialogStatus('Connecting…');
 if(type==='webdav'){
  action=api('/accounts/webdav',{method:'POST',body:JSON.stringify({
   name:$('dav-name').value.trim()||'WebDAV',
   url:$('dav-url').value.trim(),username:$('dav-user').value.trim(),password:$('dav-password').value
  })}).then(function(){
   $('dav-password').value='';closeDialog();refresh();
  });
 }else if(type==='mega'){
  action=api('/accounts/mega',{method:'POST',body:JSON.stringify({
    email:$('mega-email').value.trim(),password:$('mega-password').value
  })}).then(function(){
    $('mega-password').value='';closeDialog();refresh();
  });
 }else{
  action=api('/link/'+encodeURIComponent(type),{method:'POST'}).then(function(data){
   linkSession=data.session;
   $('cloud-connect-form').hidden=true;$('cloud-link-step').hidden=false;
   var instructions=$('cloud-link-instructions');instructions.textContent='';
   $('cloud-qr').hidden=type!=='terabox';
   if(type==='terabox'){
    instructions.textContent='Open the official TeraBox app on your phone and scan this QR code to approve Orbit access:';
    $('cloud-qr').src=data.qrcode||'';
   }else if(data.user_code){
    instructions.textContent='On your phone or computer, open '+data.verification_url+' and enter this code:';
    var strong=document.createElement('div');strong.className='cloud-code';strong.textContent=data.user_code;instructions.appendChild(strong);
   }else{
    instructions.textContent=(type==='google'?'On the computer running Orbit companion, open this address in a browser:':'On your phone or computer, open this Dropbox authorization address:');
   }
   var url=$('cloud-link-url');url.textContent=data.url||data.verification_url||'';
   url.href=data.url||data.verification_url||'#';
   url.hidden=type==='terabox';
   $('cloud-link-code-wrap').hidden=type!=='dropbox';
   $('cloud-finish').textContent='Close';
   dialogStatus(type==='dropbox'?'After approving access, paste the code Dropbox shows you.':
    type==='terabox'?'Scan with TeraBox and approve access. This screen updates automatically.':'Complete sign-in and keep Orbit open.');
   if(type==='onedrive'||type==='google'||type==='terabox'){
    if(pollTimer)clearInterval(pollTimer);
    pollTimer=setInterval(checkLink,Math.max(5000,(data.interval||5)*1000));checkLink();
   }
  });
 }
 action.catch(function(err){dialogStatus(err.message,true);}).finally(function(){submit.disabled=false;});
};
$('cloud-code-submit').onclick=function(){
 var code=$('cloud-link-code').value.trim();if(!code)return dialogStatus('Enter the Dropbox code.',true);
 var b=this;b.disabled=true;dialogStatus('Finishing sign-in…');
 api('/link/'+encodeURIComponent(linkSession)+'/code',{method:'POST',body:JSON.stringify({code:code})})
 .then(function(){closeDialog();refresh();})
 .catch(function(e){dialogStatus(e.message,true);})
 .finally(function(){b.disabled=false;});
};
window.OrbitCloud={
 closeDialog:closeDialog,
 back:function(){
  if($('cloud-dialog').hasAttribute('open')){closeDialog();return true;}
  if(stack.length){stack.pop();openFolder();return true;}
  if(current){current=null;openFolder();return true;}
  return false;
 }
};
refresh();
}());

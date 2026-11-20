import test from 'node:test';
import assert from 'node:assert/strict';
import {safeTeraBoxDomain,browseTeraBox,streamTeraBox} from '../server/cloud-extra.js';

test('TeraBox API hosts are restricted to the official provider',()=>{
  assert.equal(safeTeraBoxDomain('www.terabox.com'),'https://www.terabox.com');
  assert.equal(safeTeraBoxDomain('https://region.terabox.app/'),'https://region.terabox.app');
  for(const host of ['evil.com','terabox.com.evil.net','http://www.terabox.com','www.terabox.com:443','user@www.terabox.com']){
    assert.throws(()=>safeTeraBoxDomain(host),/Unexpected TeraBox/);
  }
});

test('TeraBox browse maps files and folders, paginates and cannot escape root',async()=>{
  const originalFetch=globalThis.fetch,originalRoot=process.env.TERABOX_ROOT;
  process.env.TERABOX_ROOT='/From: Other Applications/Orbit-1/';
  const seen=[];
  globalThis.fetch=async(input)=>{
    const url=String(input);seen.push(url);
    if(url.endsWith('/oauth/tokeninfo'))return Response.json({errno:0,data:{api_domain:'www.terabox.com'}});
    if(url.includes('/openapi/api/list')){
      const u=new URL(url);
      assert.equal(u.searchParams.get('dir'),'/From: Other Applications/Orbit-1/');
      assert.equal(u.searchParams.get('access_tokens'),'test-token');
      assert.equal(u.searchParams.get('page'),'1');
      return Response.json({errno:0,info:[
        {fs_id:123,server_filename:'clip.mp4',category:1,isdir:0,size:321},
        {path:'/From: Other Applications/Orbit-1/Movies',server_filename:'Movies',isdir:1,size:0}
      ],has_more:1});
    }
    throw Error('Unexpected call '+url);
  };
  try{
    const a={id:'test-terabox-browse',type:'terabox',access_token:'test-token',expires:Date.now()+10000000};
    const result=await browseTeraBox(a,'','',async()=>{});
    assert.equal(result.items.length,2);assert.equal(result.next,'2');
    assert.deepEqual(result.items.map(x=>x.id),['123','/From: Other Applications/Orbit-1/Movies']);
    assert(result.items[0].video);assert(result.items[1].folder);
    await assert.rejects(browseTeraBox(a,'/unapproved','',async()=>{}),/outside the authorized/);
    assert.equal(seen.length,2);
  }finally{
    globalThis.fetch=originalFetch;
    if(originalRoot===undefined)delete process.env.TERABOX_ROOT;else process.env.TERABOX_ROOT=originalRoot;
  }
});

test('TeraBox generates a signed download link with Range requests',async()=>{
  const old=globalThis.fetch;
  const requests=[];
  globalThis.fetch=async(input,options={})=>{
    const u=new URL(String(input));requests.push({url:u,options});
    if(u.pathname==='/oauth/tokeninfo')return Response.json({errno:0,data:{api_domain:'www.terabox.com'}});
    if(u.pathname==='/openapi/api/download'){
      assert.equal(u.searchParams.get('fidlist'),'[4321]');
      return Response.json({errno:0,dlink:[{fs_id:'4321',dlink:'https://d.terabox.com/file/test?expires=1h'}]});
    }
    if(u.pathname==='/file/test')return new Response('ABCD',{status:206,headers:{'Content-Range':'bytes 0-3/10'}});
    throw Error('Unexpected request '+u);
  };
  try{
    const a={id:'test-terabox-stream',access_token:'token-123',expires:Date.now()+10000000};
    const response=await streamTeraBox(a,'4321','bytes=0-3',async()=>{});
    assert.equal(response.status,206);
    assert.equal(await response.text(),'ABCD');
    assert.equal(requests[2].url.searchParams.get('access_tokens'),'token-123');
    assert.equal(requests[2].options.headers.Range,'bytes=0-3');
    await assert.rejects(streamTeraBox(a,'../secret','',async()=>{}),/Invalid TeraBox file ID/);
  }finally{globalThis.fetch=old;}
});

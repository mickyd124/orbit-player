export function validateSource(source) {
 if(typeof source!=='string'||source.length>8192)throw new Error('Invalid media source');
 if(source.startsWith('magnet:?')) {if(!/[?&]xt=urn:btih:[a-zA-Z0-9]+/.test(source))throw new Error('Magnet must contain a BitTorrent info hash');return 'torrent';}
 let url;try{url=new URL(source);}catch{throw new Error('Invalid URL');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Use HTTP(S) without embedded credentials');
 return 'http';
}

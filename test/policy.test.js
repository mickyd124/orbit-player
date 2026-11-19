import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateSource} from '../server/policy.js';
test('accepts HTTP streams and BitTorrent magnets',()=>{assert.equal(validateSource('https://example.com/movie.mkv'),'http');assert.equal(validateSource('magnet:?xt=urn:btih:0123456789012345678901234567890123456789'),'torrent');});
test('rejects local files, embedded credentials, and other protocols',()=>{for(const value of ['file:///etc/passwd','ftp://example.com/a','http://user:pass@example.com','javascript:alert(1)','magnet:?dn=bad',null])assert.throws(()=>validateSource(value));});

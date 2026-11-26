import {copyFileSync,mkdirSync} from 'node:fs';
mkdirSync('app/vendor',{recursive:true});
for (const [src,dst] of [['node_modules/hls.js/dist/hls.min.js','hls.min.js'],['node_modules/dashjs/dist/dash.all.min.js','dash.all.min.js'],['node_modules/megajs/dist/main.browser-umd.js','mega.browser.js'],['node_modules/mp4box/dist/mp4box.all.min.js','mp4box.all.min.js']]) copyFileSync(src,'app/vendor/'+dst);

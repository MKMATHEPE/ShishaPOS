import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
async function files(dir){const result=[];for(const entry of await readdir(dir,{withFileTypes:true})){const path=`${dir}/${entry.name}`;if(entry.isDirectory())result.push(...await files(path));else if(!path.endsWith('.map')&&!path.endsWith('/sw.js'))result.push(path);}return result;}
const paths=await files('dist');
const hash=createHash('sha256');for(const path of paths.sort())hash.update(await readFile(path));
let worker=await readFile('dist/sw.js','utf8');
worker=worker.replace(/const CACHE = .*/,`const CACHE = 'chill-pipe-pos-${hash.digest('hex').slice(0,12)}'`)
 .replace(/const APP_SHELL = .*/,`const APP_SHELL = ${JSON.stringify(['/',...paths.filter(path=>!path.endsWith('/index.html')).map(path=>path.slice(4))])}`);
await writeFile('dist/sw.js',worker);
console.log(`Offline cache prepared: ${paths.length} files.`);

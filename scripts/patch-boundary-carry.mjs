// Narrow, version-pinned tracking fix for @tilawa/core 0.4.0. Never patch an
// unknown dependency silently; CI must stop if upstream code has changed.
import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url),path=new URL('node_modules/@tilawa/core/dist/recitation/session.js',root);
const pkg=JSON.parse(await readFile(new URL('node_modules/@tilawa/core/package.json',root),'utf8'));
if(pkg.version!=='0.4.0')throw Error('Review boundary carry against changed recognition dependency');
let source=await readFile(path,'utf8');
const marker='import { completedSurahCarry } from "./rattil-boundary-carry.js";';
if(!source.includes(marker)){
 const expected='165ddfd51178a4f517e25e544ebb0457f42a734a4f39e9703d46a995866d456e';
 if(createHash('sha256').update(source).digest('hex')!==expected)throw Error('Unexpected recognition source; boundary patch needs review');
 const old='                this.engine.startSearch();\n                this.resetDecoder();';
 if(source.split(old).length!==2)throw Error('Boundary reset site must be unique');
 source=source.replace('import { normalizedDistance } from "./alignment.js";', 'import { normalizedDistance, alignGlobal } from "./alignment.js";\n'+marker);
 source=source.replace(old,`                const carry = ev.type === "completed" ? completedSurahCarry(this.engine.tracker, this.table, alignGlobal) : [];
                this.engine.startSearch();
                // Do not discard decoded next-surah speech or reset streaming
                // audio state at a textual surah boundary. Idle still resets.
                if (ev.type !== "completed") this.resetDecoder();
                if (carry.length) {
                    this.engine.buffer = carry;
                    this.engine.heardTotal = carry.length;
                }`);
 await writeFile(path,source);
}
await copyFile(new URL('boundary-carry.js',root),new URL('node_modules/@tilawa/core/dist/recitation/rattil-boundary-carry.js',root));

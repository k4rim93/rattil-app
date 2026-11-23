import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {engineTokenMap,mergeWord} from '../recall-core.js';
import {isFlagged,buildSessionSummary} from '../mistake-core.js';
const src=readFileSync(new URL('../app.js',import.meta.url),'utf8');
function harness(){const session={words:[{key:'55:5:1',surah:55,ayah:5,index:1,text:'والقمر',status:'error',errorSource:'rescore'}],verdicts:{'55:5:1':{state:'skipped',gop:-16,gopNone:-2}}};const states=new Map([['55:5:1','error']]);const c=vm.createContext({Number,String,Date,engineTokenMap,mergeWord,isFlagged,currentRecitationSession:session,recitationWordStates:states,recitationWordExpiry:new Map(),reciteVerseCache:new Map([[55,[{numberInSurah:5,text:'الشمس والقمر بحسبان'}]]]),setTimeout(){},drawRecitationQvpPage(){}});vm.runInContext(src.slice(src.indexOf('function handleWordVerdicts('),src.indexOf('async function backfillHeardWords('))+';globalThis.api={handleWordVerdicts,saveRecitationWord}',c);return{a:c.api,session,states};}
test('tracker progress cannot clear rescore error or rewrite saved status',()=>{const h=harness();h.a.saveRecitationWord(55,5,1,'correct','correct',850);assert.equal(h.states.get('55:5:1'),'error');assert.equal(h.session.words[0].status,'error');assert.equal(buildSessionSummary(h.session).counts.wrong,1)});
test('fresh unflagged ok verdict gives green and replaces saved acoustic evidence',()=>{const h=harness();h.a.handleWordVerdicts({surah:55,ayah:5,words:[{w:1,state:'ok',gop:0,repGain:-8}]});assert.equal(h.states.get('55:5:1'),'correct');assert.equal(h.session.words[0].status,'correct');assert.equal(h.session.verdicts['55:5:1'].gop,0);assert.equal(buildSessionSummary(h.session).counts.correct,1)});
test('uncertain or repetition-flagged verdict never produces verified green',()=>{for(const v of [{state:'unsure',gop:-1},{state:'ok',gop:-8,repGain:2}]){const h=harness();h.a.handleWordVerdicts({surah:55,ayah:5,words:[{w:1,...v}]});assert.equal(h.states.get('55:5:1'),'error')}});

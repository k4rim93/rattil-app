import {createSettledWordBridge} from '../settled-words.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../asr-worker.js',import.meta.url),'utf8');
function harness(factory){
 const events=[];
 const c=vm.createContext({createSettledWordBridge,console:{warn(){}},Date,Float32Array,Map,Set,Promise,Number,Math,URL,setTimeout,setInterval(){},navigator:{},self:{postMessage:e=>events.push(e)},createRecognitionSession:factory,createDiag:()=>({reset(){},mark(){},sample(){},bucket(){},snapshot(){return {}}})});
 let src=source.replace(/^import .*;\r?\n/gm,'').replace('let appBase = new URL(/* @vite-ignore */ "../", import.meta.url);','let appBase=new URL("https://test.invalid/");');
 vm.runInContext(src+`;globalThis.api={ensureScorer,rescoreReset,queueRescore,handle,setup(){ortRef={};modelBufferRef={};ioRef={};corpusRef={};quranRef={};session={reset(){},stop:async()=>{}}},seed(){audioTotal=16000;audioChunks=[new Float32Array(16000)];matchLog.push({surah:55,ayah:3,at:8000})},chain:()=>rescoreChain,attempts:()=>scorerAttempts,setProgress(rows){matchLog.length=0;progressLog.length=0;progressLog.push(...rows)},setTotal(n){audioTotal=n;audioChunks=[new Float32Array(n)]}};`,c);
 c.api.setup();return {a:c.api,events};
}
function scorer(feed=async()=>{}){return {feed,zipformer:{setMode(){},reset(){},setExpected(){},engine:{tracer:{verdicts:()=>[{surah:55,ayah:3,word:1,state:'wrong',gop:-9}]}}}}}
test('sync throw and async rejection are contained, bounded retries signal unavailable',async()=>{
 for(const factory of [()=>{throw Error('failure')},()=>Promise.reject(Error('failure'))]){
  const {a,events}=harness(factory);assert.equal(await a.ensureScorer(),null);a.rescoreReset();a.seed();
  for(let i=0;i<5;i++){a.queueRescore(0,16000);await a.chain()}
  assert.equal(a.attempts(),3);assert.equal(events.filter(x=>x.event?.type==='rescore_unavailable').length,1);
  await a.handle({type:'stop'});assert.equal(events.at(-1).type,'stopped');
 }
});
test('delayed scorer resolves then works; first failure can recover',async()=>{
 let n=0;const {a,events}=harness(async()=>{if(++n===1)throw Error('first');await new Promise(r=>setTimeout(r,20));return scorer()});
 assert.equal(await a.ensureScorer(),null);a.seed();a.queueRescore(0,16000);await a.chain();assert.equal(events.filter(x=>x.event?.type==='word_issues').length,1);
});
test('stop drains sliced rescore and posts red issues before stopped',async()=>{
 let calls=0;const {a,events}=harness(async()=>scorer(async()=>{calls++}));a.seed();a.queueRescore(0,16000);await a.handle({type:'stop'});
 assert.equal(calls,4);const issue=events.findIndex(x=>x.event?.type==='word_issues');assert.ok(issue>=0);assert.ok(issue<events.findIndex(x=>x.type==='stopped'));
});
test('reset while slicing cancels stale verdicts and queued old runs; new session works',async()=>{
 let unblock;let calls=0;const {a,events}=harness(async()=>scorer(async()=>{if(++calls===1)await new Promise(r=>unblock=r)}));a.seed();a.queueRescore(0,16000);a.queueRescore(0,16000);
 while(!unblock)await new Promise(r=>setTimeout(r,1));a.rescoreReset();unblock();await a.chain();assert.equal(events.filter(x=>x.event?.type==='word_issues').length,0);
 a.seed();a.queueRescore(0,16000);await a.chain();assert.equal(events.filter(x=>x.event?.type==='word_issues').length,1);
});

test('fresh repeated run can rescore without verse_match, but old scope cannot',async()=>{
 let calls=0;const {a,events}=harness(async()=>scorer(async()=>{calls++}));a.seed();a.setTotal(160000);a.setProgress([{surah:55,ayah:3,at:100000,w:1}]);a.queueRescore(110000,160000);await a.chain();assert.ok(calls>0);assert.ok(events.some(x=>x.event?.type==='word_verdicts'));
 calls=0;a.setProgress([{surah:55,ayah:3,at:10000,w:1}]);a.queueRescore(110000,160000);await a.chain();assert.equal(calls,0);assert.ok(events.some(x=>x.event?.reason==='no_match'));
});
test('uncertain fresh verdict cannot clear an old acoustic flag, clear ok can',async()=>{
 let vs=[{surah:55,ayah:3,word:1,state:'skipped',gop:-12,gopNone:-1}];const {a,events}=harness(async()=>({feed:async()=>{},zipformer:{setMode(){},reset(){},setExpected(){},engine:{tracer:{verdicts:()=>vs}}}}));a.seed();a.queueRescore(0,16000);await a.chain();
 vs=[{surah:55,ayah:3,word:1,state:'pending'}];a.queueRescore(0,16000);await a.chain();assert.equal(events.filter(x=>x.event?.cleared?.length).length,0);
 vs=[{surah:55,ayah:3,word:1,state:'ok',gop:0}];a.queueRescore(0,16000);await a.chain();assert.deepEqual([...events.find(x=>x.event?.cleared?.length).event.cleared],[1]);
});

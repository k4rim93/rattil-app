import test from 'node:test';
import assert from 'node:assert/strict';
import { referencePage, sessionStats, nextHint, mergeWord } from '../recall-core.js';
test('surahs starting partway through a page inherit previous page', () => {
 const refs=[{surah:1,ayah:1},{surah:2,ayah:1},{surah:2,ayah:6},{surah:112,ayah:1}];
 assert.equal(referencePage(refs,113,1),4);assert.equal(referencePage(refs,114,1),4);assert.equal(referencePage(refs,2,5),2);assert.equal(referencePage(refs,2,6),3);
});
test('a hint stays marked for review after later recognition',()=>{
 const word=mergeWord({status:'hint',hinted:true},{status:'correct'});
 assert.equal(word.hinted,true);assert.deepEqual(sessionStats({words:[word]}),{followed:0,hints:1,review:1,touched:1});
});
test('legacy errors are review candidates, never certain scoring',()=>{
 assert.deepEqual(sessionStats({words:[{status:'error'},{status:'uncertain'},{status:'correct'}]}),{followed:1,hints:0,review:2,touched:3});
});
test('hint chooses the next hidden word only inside selected range',()=>{
 const words=[{surah:1,ayah:1,word:1},{surah:1,ayah:2,word:1},{surah:1,ayah:2,word:2},{surah:2,ayah:1,word:1}];
 const seen=new Map([['1:2:1','correct']]);assert.equal(nextHint(words,seen,{surah:1,from:2,to:2}).word,2);
 assert.equal(nextHint(words,seen,{surah:1,from:3,to:3}),undefined);
});
test('hint does not jump backwards across verses',()=>{
 const words=[{surah:1,ayah:1,word:1},{surah:1,ayah:2,word:1}];assert.equal(nextHint(words,new Map(),{after:{surah:1,ayah:2}}).ayah,2);
});
test('empty session is not a perfect score',()=>assert.deepEqual(sessionStats({words:[]}),{followed:0,hints:0,review:0,touched:0}));

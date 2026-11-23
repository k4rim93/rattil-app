import test from 'node:test';import assert from 'node:assert/strict';import {completedSurahCarry}from '../boundary-carry.js';
const table={encode:text=>Uint8Array.from([...text].map(c=>c.charCodeAt(0)))};
const char=(ch,frame)=>({ch,frame,margin:1});
function tracker(text='endNEXT'){return{reachedEnd:true,heard:[...text].map(char),wordStarts:[0,2,4],ref:new Uint8Array(8),len:8}}
test('carries only decoded suffix after final aligned reference cell',()=>{const t=tracker();const carry=completedSurahCarry(t,table,()=>Int32Array.from([5,6,7,-1,-1,-1,-1]));assert.equal(carry.map(c=>c.ch).join(''),'NEXT');assert.equal(carry[0],t.heard[3]);assert.equal(t.heard.length,7)});
test('no carry before a verified textual end',()=>{const t=tracker();t.reachedEnd=false;let ran=false;assert.deepEqual(completedSurahCarry(t,table,()=>{ran=true}),[]);assert.equal(ran,false)});
test('does not invent suffix from incomplete or missing alignment',()=>{for(const a of[[-1,-1],[5,6]])assert.deepEqual(completedSurahCarry(tracker(),table,()=>a),[])});
test('clean completed ending with silence carries no words',()=>assert.deepEqual(completedSurahCarry(tracker('end'),table,()=>[5,6,7]),[]));
test('alignment work is bounded to150 actual chars and3 reference words',()=>{const t=tracker('x'.repeat(160));let seen;completedSurahCarry(t,table,(ids,ref,from,to)=>{seen=[ids.length,from,to];return Array(150).fill(-1)});assert.deepEqual(seen,[150,0,8])});
test('carry module neither emits words nor adds acoustic verdicts',()=>{const t=tracker();const output=completedSurahCarry(t,table,()=>[5,6,7,-1]);assert(output.every(c=>Object.keys(c).sort().join(',')==='ch,frame,margin'))});

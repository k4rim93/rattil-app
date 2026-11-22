import test from 'node:test';import assert from 'node:assert/strict';import{createSettledWordBridge}from '../settled-words.js';
const v=(a,w,state='ok')=>({surah:1,ayah:a,word:w,state});
test('delivers previous-ayah tail independently of current cursor, no duplicates',()=>{const b=createSettledWordBridge();b.collect([v(2,0),v(2,1),v(2,2)]);assert.deepEqual(b.collect([v(2,3,'unsure'),v(3,0)]).map(x=>[x.ayah,x.matched_indices]),[[2,[3]],[3,[0]]]);assert.equal(b.collect([v(2,3)]).length,0)});
test('never fills unread, skipped, wrong or pending words',()=>{const b=createSettledWordBridge();assert.equal(b.collect(['pending','wrong','skipped'].map(s=>v(2,3,s))).length,0);assert.deepEqual(b.collect([v(2,0),v(2,2)])[0].matched_indices,[0,2])});
test('reset allows fresh session events and rewind cannot invent words',()=>{const b=createSettledWordBridge();b.collect([v(2,1)]);assert.equal(b.collect([v(2,1)]).length,0);b.reset();assert.equal(b.collect([v(2,1)]).length,1)});

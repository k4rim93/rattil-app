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

import { backfillFromHeard, backfillMatchedAyah, bismillahOffset, compactHeard, heardCovers } from '../recall-core.js';
test('heard transcript restores the opening words lost before location lock',()=>{
 const verses=[{surah:19,ayah:1,words:['كٓهٓيٓعٓصٓ']},{surah:19,ayah:2,words:['ذِكْرُ','رَحْمَتِ','رَبِّكَ','عَبْدَهُۥ','زَكَرِيَّآ']}];
 assert.deepEqual(backfillFromHeard('كهيعص ذكر رحمت ربك عبده زكريا',verses,2),[{surah:19,ayah:1,from:0,to:0}]);
});
test('nothing is restored when the beginning was not heard',()=>{
 const verses=[{surah:19,ayah:1,words:['كٓهٓيٓعٓصٓ']}];
 assert.deepEqual(backfillFromHeard('ذكر رحمت ربك عبده',verses,2),[]);
 assert.deepEqual(backfillFromHeard('',verses,2),[]);
});
test('partial previous ayah restores only its heard tail and stops the walk',()=>{
 const verses=[{surah:19,ayah:3,words:['إِذْ','نَادَىٰ','رَبَّهُۥ','نِدَآءً','خَفِيًّا']},{surah:19,ayah:4,words:['قَالَ','رَبِّ','إِنِّي','وَهَنَ','ٱلْعَظْمُ','مِنِّي']}];
 assert.deepEqual(backfillFromHeard('ربه نداء خفيا قال رب',verses,4),[{surah:19,ayah:3,from:2,to:4}]);
});
test('heard coverage tolerates dropped letters but rejects absence',()=>{
 assert.equal(heardCovers(compactHeard('ك ه ع ص ذكر رحمت'),'كهيعص'),true);
 assert.equal(heardCovers(compactHeard('ذكر رحمت'),'كهيعص'),false);
});
test('matched ayah: muqattaat opening restored from recited letter names',()=>{
 const heard='كَاااااافهَاايَااعَيييييںںںصَااااااد ذِكْرُ رَحْمَتِ رَبِّكَ';
 const words=['بِسْمِ','ٱللَّهِ','ٱلرَّحْمَـٰنِ','ٱلرَّحِيمِ','كٓهٓيٓعٓصٓ'];
 assert.deepEqual(backfillMatchedAyah(heard,words,new Set([0])),[4]);
});
test('matched ayah: ordinary heard words restored, unheard left hidden',()=>{
 const heard='قَالَ رَبِّ إِنِّي وَهَنَ';
 const words=['قَالَ','رَبِّ','إِنِّي','وَهَنَ','ٱلْعَظْمُ','مِنِّي'];
 assert.deepEqual(backfillMatchedAyah(heard,words,new Set([3])),[0,2]);
});
test('no restoration for omitted, partial, wrong, or short muqattaat openings',()=>{
 const words=['كٓهٓيٓعٓصٓ'];
 assert.deepEqual(backfillMatchedAyah('ذِكْرُ رَحْمَتِ رَبِّكَ عَبْدَهُ',words),[]);
 assert.deepEqual(backfillMatchedAyah('كَاف هَا يَا عَيْن',words),[]);
 assert.deepEqual(backfillMatchedAyah('طَا هَا',words),[]);
 assert.deepEqual(backfillMatchedAyah('',words),[]);
 assert.deepEqual(backfillMatchedAyah('يَا سِين',['يسٓ']),[]);
 assert.deepEqual(backfillMatchedAyah('قَاف',['ق']),[]);
});
test('muqattaat never restores a word the engine already confirmed',()=>{
 const heard='كَااااف هَا يَا عَيْن صَااد';
 const words=['كٓهٓيٓعٓصٓ'];
 assert.deepEqual(backfillMatchedAyah(heard,words,new Set([0])),[]);
});
test('bismillahOffset maps engine word indices for opening ayahs only',()=>{
 assert.equal(bismillahOffset(['بِسْمِ','ٱللَّهِ','ٱلرَّحْمَـٰنِ','ٱلرَّحِيمِ','كٓهٓيٓعٓصٓ']),4);
 assert.equal(bismillahOffset(['بِسْمِ','ٱللَّهِ','ٱلرَّحْمَـٰنِ','ٱلرَّحِيمِ']),0);
 assert.equal(bismillahOffset(['بَرَآءَةٞ','مِّنَ','ٱللَّهِ']),0);
 assert.equal(bismillahOffset(['ذِكْرُ','رَحْمَتِ','رَبِّكَ']),0);
});

import { engineTokenMap, hasRecitationLetters } from '../recall-core.js';
test('engine word indices skip standalone waqf marks so the final display word maps',()=>{
 const tokens=['يَٰيَحْيَىٰ','خُذِ','ٱلْكِتَٰبَ','بِقُوَّةٍۢ','ۖ','وَءَاتَيْنَٰهُ','ٱلْحُكْمَ','صَبِيًّۭا'];
 assert.deepEqual(engineTokenMap(tokens),[0,1,2,3,5,6,7]);
 assert.equal(hasRecitationLetters('ۖ'),false);assert.equal(hasRecitationLetters('بِقُوَّةٍۢ'),true);
});
test('engine word indices keep the basmala offset while skipping waqf marks',()=>{
 const tokens=['بِسْمِ','ٱللَّهِ','ٱلرَّحْمَٰنِ','ٱلرَّحِيمِ','قَالَ','ۖ','رَبِّ'];
 assert.deepEqual(engineTokenMap(tokens),[4,6]);
});

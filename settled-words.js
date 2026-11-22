// Forward only words the engine has actually judged. Cursor position alone is not evidence.
export function createSettledWordBridge(){
 let seen=new Set();
 return {
  reset(){seen=new Set()},
  collect(verdicts){
   const groups=new Map();
   for(const v of verdicts||[]){
    if(!['ok','unsure'].includes(v.state)||![v.surah,v.ayah,v.word].every(Number.isInteger)||v.surah<1||v.ayah<1||v.word<0)continue;
    const key=v.surah+':'+v.ayah+':'+v.word;if(seen.has(key))continue;seen.add(key);
    const a=v.surah+':'+v.ayah;if(!groups.has(a))groups.set(a,{type:'settled_words',surah:v.surah,ayah:v.ayah,matched_indices:[]});groups.get(a).matched_indices.push(v.word);
   }
   return [...groups.values()];
  }
 }
}

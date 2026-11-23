// Manual version updates only. Never deletes user settings, history, models or Quran caches.
export function installAppUpdate({button,status,isBusy,setApplying=()=>{},serviceWorker=navigator.serviceWorker,reload=()=>location.reload(),storage=sessionStorage,buildStorage=globalThis.localStorage,announce=()=>{},current=document.querySelector('meta[name="rattil-build"]')?.content}){
 const say=text=>{status.textContent=text};let running=false,sticky=false;
 const mark=on=>{status.classList?.toggle('update-alert',on);button.classList?.toggle('has-update',on)};
 const pending=storage.getItem('rattil-update-target');if(pending){storage.removeItem('rattil-update-target');const done=pending===current;const text=done?'تم تحديث النسخة. نتائجك وإعداداتك محفوظة.':'لم يكتمل تحديث النسخة. حاول مرة أخرى عند الاتصال.';say(text);announce(text);mark(!done);}
 // Passive version status on every load: show the running build id and
 // whether it is the latest available. A plain reload is never proof of an
 // update — "latest" is only reported after an actual update check, and
 // "new build loaded" only when the running build differs from the one seen
 // on the previous visit.
 const lastBuild=current&&buildStorage?buildStorage.getItem('rattil-last-build'):null;
 const justLoaded=Boolean(current&&lastBuild&&lastBuild!==current);
 if(current&&buildStorage)buildStorage.setItem('rattil-last-build',current);
 if(current&&!pending){
  say(justLoaded?`تم تحميل نسخة جديدة (${current}). جارٍ التحقق من وجود نسخة أحدث…`:`النسخة الحالية: ${current}. جارٍ التحقق من وجود نسخة أحدث…`);
  (async()=>{
   if(!serviceWorker||!navigator.onLine)throw Error('offline');
   const reg=await serviceWorker.getRegistration();if(!reg)throw Error('registration missing');
   await reg.update();const worker=await waitInstalled(reg);
   if(worker){if(!running&&!sticky){say(`فيه نسخة أحدث جاهزة. اضغط تحديث النسخة لتثبيتها. النسخة الحالية: ${current}.`);announce('فيه نسخة أحدث جاهزة — من الإعدادات اضغط تحديث النسخة.');mark(true)}return}
   const activeVersion=reg.active?await version(reg.active):null;
   if(activeVersion&&activeVersion!==current){if(!running&&!sticky){say(`فيه نسخة أحدث جاهزة. اضغط تحديث النسخة لتثبيتها. النسخة الحالية: ${current}.`);announce('فيه نسخة أحدث جاهزة — من الإعدادات اضغط تحديث النسخة.');mark(true)}return}
   if(!running&&!sticky){say(justLoaded?`تم تحميل نسخة جديدة (${current}) — هي أحدث نسخة متاحة.`:`النسخة الحالية (${current}) هي أحدث نسخة متاحة.`);announce(justLoaded?`تم تحميل نسخة جديدة (${current}).`:`أنت على أحدث نسخة (${current}).`);mark(false)}
  })().catch(()=>{if(!running&&!sticky){say(`النسخة الحالية: ${current}. تعذّر التحقق من وجود نسخة أحدث.`);announce('تعذّر التحقق من وجود نسخة أحدث.')} });
 }
 const waitInstalled=reg=>new Promise((resolve,reject)=>{let timer;const check=()=>{if(reg.waiting){clearTimeout(timer);resolve(reg.waiting);return}const w=reg.installing;if(!w){clearTimeout(timer);resolve(null);return}if(w.state==='redundant'){clearTimeout(timer);reject(Error('install failed'));return}w.addEventListener('statechange',check,{once:true})};timer=setTimeout(()=>reject(Error('update timed out')),20000);check()});
 const version=worker=>new Promise((resolve,reject)=>{const ch=new MessageChannel(),t=setTimeout(()=>reject(Error('version timeout')),4000);ch.port1.onmessage=e=>{clearTimeout(t);ch.port1.close();resolve(e.data?.version)};worker.postMessage({type:'GET_VERSION'},[ch.port2])});
 button.addEventListener('click',async()=>{
  if(running)return;sticky=true;if(isBusy()){say('أوقف التسميع وانتظر حفظ النتيجة قبل تحديث النسخة.');return}
  running=true;button.disabled=true;say('جارٍ البحث عن أحدث نسخة…');
  try{
   if(!serviceWorker||!navigator.onLine)throw Error('offline');
   const reg=await serviceWorker.getRegistration();if(!reg)throw Error('registration missing');
   await reg.update();const worker=await waitInstalled(reg);
   if(isBusy()){say('التحديث جاهز. أوقف التسميع وانتظر حفظ النتيجة ثم اضغط تحديث النسخة.');mark(true);return}
   if(!worker){const activeVersion=reg.active?await version(reg.active):null;if(activeVersion&&activeVersion!==current){if(isBusy())return;setApplying(true);storage.setItem('rattil-update-target',activeVersion);reload();return}say('أنت على أحدث نسخة متاحة. نتائجك وإعداداتك محفوظة.');mark(false);return}
   const target=await version(worker);if(!target)throw Error('unknown build');
   if(isBusy()){say('أوقف التسميع وانتظر حفظ النتيجة قبل التحديث.');return}
   setApplying(true);storage.setItem('rattil-update-target',target);say('جارٍ فتح النسخة الجديدة…');
   await new Promise((resolve,reject)=>{let t;const changed=()=>{clearTimeout(t);serviceWorker.removeEventListener('controllerchange',changed);resolve()};serviceWorker.addEventListener('controllerchange',changed);t=setTimeout(()=>{serviceWorker.removeEventListener('controllerchange',changed);reject(Error('activation timeout'))},10000);worker.postMessage({type:'APPLY_UPDATE'})});
   // If a recording began during activation, defer reload until an explicit safe click.
   if(isBusy()){storage.removeItem('rattil-update-target');say('النسخة جاهزة. أوقف التسميع واحفظ النتيجة، ثم افتح التطبيق من جديد.');return}reload();
  }catch{storage.removeItem('rattil-update-target');say('تعذّر التحقق من التحديث. تأكد من الاتصال وحاول مرة أخرى. بياناتك لم تُمسح.');}
  finally{setApplying(false);running=false;button.disabled=false}
 });
}

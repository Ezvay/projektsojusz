const {randomUUID}=require('node:crypto');
const fields=['routes','labels','runners','generals','killedGenerals','regions','snapshots'];
const empty=()=>({routes:{},labels:[],runners:{},generals:{},killedGenerals:{},regions:{},snapshots:[]});
const clone=value=>JSON.parse(JSON.stringify(value));
const validId=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(id)&&!['__proto__','constructor','prototype'].includes(id);
const point=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1;
const check=(ok,message='Nieprawidłowe dane mapy')=>{if(!ok)throw new Error(message);};

// One serialized, durable state per map. Broadcast only after MongoDB confirms a write.
module.exports=function createMapState(io){
 const maps=new Map();let collection;
 function send(target,prefix,state,changed=fields){
  const drawing={};for(const f of ['routes','labels','runners'])if(changed.includes(f))drawing[f]=state[f];
  if(Object.keys(drawing).length)target.emit(prefix+'RoutesUpdate',drawing);
  for(const [field,event] of [['generals','GeneralsUpdate'],['killedGenerals','KilledGeneralsUpdate'],['regions','RegionsUpdate'],['snapshots','SnapshotsUpdate']])if(changed.includes(field))target.emit(prefix+event,state[field]);
 }
 async function init(db,legacy={}){
  collection=db.collection('map_states');
  for(const prefix of ['grota','smierc']){
   let stored=await collection.findOne({_id:prefix});
   if(!stored){
    const migrated=empty();for(const f of fields){const old=legacy[prefix+f[0].toUpperCase()+f.slice(1)];if(old!==undefined)migrated[f]=old;}
    await collection.updateOne({_id:prefix},{$setOnInsert:{...migrated,revision:0}},{upsert:true});
    stored=await collection.findOne({_id:prefix});
   }
   const state=empty();for(const f of fields)if(stored[f]!==undefined)state[f]=stored[f];
   maps.set(prefix,{state,revision:stored.revision||0,queue:Promise.resolve(),pending:0});
  }
 }
 function attach(socket){
  const prefix=socket.handshake.auth?.map;
  if(!['grota','smierc'].includes(prefix))return false;
  if(!maps.has(prefix)){socket.emit('mapError','Baza map nie jest jeszcze dostępna. Edycja jest wstrzymana. Odśwież stronę za chwilę.');return true;}
  const map=maps.get(prefix),room='map:'+prefix;
  socket.join(room);
  send(socket,prefix,map.state);socket.emit('mapReady',{revision:map.revision});
  let count=0,start=Date.now();
  socket.on('mapRequestState',()=>{if(Date.now()-start>1000){start=Date.now();count=0;}if(++count<25){send(socket,prefix,map.state);socket.emit('mapReady',{revision:map.revision});}});
  function on(action,admin,mutate){
   socket.on(prefix+action,(data,ack)=>{
    if(typeof data==='function'){ack=data;data=undefined;}
    const reply=typeof ack==='function'?ack:result=>{if(!result.ok)socket.emit('mapError',result.error);};
    if(Date.now()-start>1000){start=Date.now();count=0;}
    if(++count>25||map.pending>=100)return reply({ok:false,error:'Za dużo zmian naraz. Spróbuj za chwilę.'});
    map.pending++;
    const task=map.queue.then(async()=>{
     check(socket.data.user,'Zaloguj się ponownie przez Discord');
     check(!admin||socket.data.user.role==='admin','Rysowanie wymaga roli administratora na Discordzie');
     const draft=clone(map.state);
     const changed=mutate(draft,data,socket.data.user);
     const revision=map.revision+1,patch={revision,updatedAt:new Date()};
     for(const f of changed)patch[f]=draft[f];
     try{
      const result=await collection.updateOne({_id:prefix,revision:map.revision},{$set:patch});
      if(!result.matchedCount){
       const latest=await collection.findOne({_id:prefix});
       if(latest){for(const f of fields)if(latest[f]!==undefined)map.state[f]=latest[f];map.revision=latest.revision||0;send(io.to(room),prefix,map.state);}
       throw new Error('conflict');
      }
     }catch(e){console.error('Map save failed:',prefix,e.message);throw new Error('Nie zapisano zmiany. Sprawdź połączenie z bazą i spróbuj ponownie.');}
     map.state=draft;map.revision=revision;
     send(io.to(room),prefix,map.state,changed);
     reply({ok:true,revision});
    });
    map.queue=task.catch(e=>reply({ok:false,error:e.message})).finally(()=>{map.pending--;});
   });
  }
  on('AddRoute',true,(s,d)=>{check(d&&validId(d.id)&&Array.isArray(d.points)&&d.points.length>0&&d.points.length<=2000&&d.points.every(point));check(typeof d.name==='string'&&d.name.length<=80&&/^#[0-9a-f]{6}$/i.test(d.color));check(Object.keys(s.routes).length<300);s.routes[d.id]={id:d.id,name:d.name,color:d.color,points:d.points.map(p=>({x:p.x,y:p.y})),visible:true};return ['routes'];});
  on('RemoveRoute',true,(s,id)=>{check(validId(id));delete s.routes[id];delete s.runners[id];return ['routes','runners'];});
  on('ToggleRoute',true,(s,d)=>{check(d&&validId(d.id)&&s.routes[d.id]);s.routes[d.id].visible=!!d.visible;return ['routes'];});
  on('ClearRoutes',true,s=>{s.routes={};s.labels=[];s.runners={};for(const g of Object.values(s.generals))delete g.lureLabelId;return ['routes','labels','runners','generals'];});
  on('AddLabel',true,(s,d)=>{check(d&&validId(d.id)&&point(d)&&typeof d.text==='string'&&d.text.length>0&&d.text.length<=80&&/^#[0-9a-f]{6}$/i.test(d.color)&&Number.isFinite(d.size)&&d.size>=8&&d.size<=100);check(s.labels.length<1000);check(!s.labels.some(l=>l.id===d.id),'To oznaczenie jest już zapisane');s.labels.push({id:d.id,x:d.x,y:d.y,text:d.text,color:d.color,size:d.size});return ['labels'];});
  on('RemoveLabel',true,(s,id)=>{check(validId(id));s.labels=s.labels.filter(l=>l.id!==id);for(const g of Object.values(s.generals))if(g.lureLabelId===id)delete g.lureLabelId;return ['labels','generals'];});
  on('AddRunner',false,(s,d,u)=>{check(d&&validId(d.routeId)&&s.routes[d.routeId]&&Number.isInteger(d.ch)&&d.ch>=1&&d.ch<=8);s.runners[d.routeId]??={};s.runners[d.routeId][d.ch]={nick:u.nick,guild:u.guild||'',displayName:u.displayName||u.nick};return ['runners'];});
  on('RemoveRunner',false,(s,d)=>{check(d&&validId(d.routeId));if(s.runners[d.routeId])delete s.runners[d.routeId][d.ch];return ['runners'];});
  on('AddGeneral',false,(s,d)=>{check(point(d)&&Number.isInteger(d.ch)&&d.ch>=1&&d.ch<=8);check(!Object.values(s.generals).some(g=>g.ch===d.ch),'Na tym kanale generał jest już zaznaczony');const id='gen_'+randomUUID();s.generals[id]={id,x:d.x,y:d.y,ch:d.ch,foundAt:Date.now()};for(const id in s.killedGenerals)if(s.killedGenerals[id].ch===d.ch)delete s.killedGenerals[id];return ['generals','killedGenerals'];});
  on('SetLure',false,(s,d)=>{check(d&&validId(d.id)&&validId(d.labelId)&&s.generals[d.id]&&s.labels.some(l=>l.id===d.labelId),'Nie znaleziono generała lub strefy');s.generals[d.id].lureLabelId=d.labelId;return ['generals'];});
  on('KillGeneral',false,(s,id)=>{check(validId(id)&&s.generals[id],'Nie znaleziono generała');const gen=s.generals[id];delete s.generals[id];const kid='killed_'+randomUUID();s.killedGenerals[kid]={id:kid,ch:gen.ch,x:gen.x,y:gen.y,killedAt:Date.now()};return ['generals','killedGenerals'];});
  on('RemoveGeneral',false,(s,id)=>{check(validId(id));delete s.generals[id];return ['generals'];});
  on('RemoveKilled',false,(s,id)=>{check(validId(id));delete s.killedGenerals[id];return ['killedGenerals'];});
  on('AddRegion',false,(s,d,u)=>{check(d&&point({x:d.x1,y:d.y1})&&point({x:d.x2,y:d.y2}));check(Object.keys(s.regions).length<1000);const id='reg_'+randomUUID();s.regions[id]={id,x1:d.x1,y1:d.y1,x2:d.x2,y2:d.y2,player:u.displayName||u.nick,guild:u.guild,addedAt:Date.now()};return ['regions'];});
  on('RemoveRegion',false,(s,id)=>{check(validId(id));delete s.regions[id];return ['regions'];});
  on('SaveSnapshot',false,(s,d)=>{check(d&&typeof d.name==='string'&&d.name.length<=80);s.snapshots.unshift({id:'snap_'+randomUUID(),name:d.name||'Snapshot',ts:Date.now(),generals:clone(s.generals),killedGenerals:clone(s.killedGenerals),regions:clone(s.regions)});s.snapshots=s.snapshots.slice(0,10);return ['snapshots'];});
  on('LoadSnapshot',false,(s,id)=>{check(validId(id));const snap=s.snapshots.find(x=>x.id===id);check(snap,'Nie znaleziono zapisu');s.generals=clone(snap.generals||{});s.killedGenerals=clone(snap.killedGenerals||{});s.regions=clone(snap.regions||{});return ['generals','killedGenerals','regions'];});
  on('DeleteSnapshot',false,(s,id)=>{check(validId(id));s.snapshots=s.snapshots.filter(x=>x.id!==id);return ['snapshots'];});
  on('ClearSnapshots',false,s=>{s.snapshots=[];return ['snapshots'];});
  return true;
 }
 return {init,attach,flush:()=>Promise.all([...maps.values()].map(m=>m.queue))};
};

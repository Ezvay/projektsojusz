window.connectLiveMap=function(prefix){
 const socket=io({autoConnect:false,auth:{map:prefix},transports:['websocket','polling'],tryAllTransports:true,withCredentials:true});
 const emit=socket.emit.bind(socket);let ready=false,pending=0,lastError='';
 const status=document.createElement('span');status.id='mapSaveStatus';status.setAttribute('role','status');status.style.cssText='font:12px Georgia;color:#c9a84c;display:block;padding:7px 14px;';
 document.querySelector('.sidebar').prepend(status);
 function show(message,error=false){status.textContent=message;status.style.color=error?'#ff9090':'#c9a84c';}
 socket.on('connect',()=>{ready=false;show('Pobieranie zapisanej mapy…');});
 socket.on('mapReady',()=>{ready=true;if(!pending)show(lastError||'Na żywo · dane wczytane',!!lastError);});
 socket.on('connect_error',e=>{ready=false;lastError='Brak połączenia live: '+e.message;show(lastError,true);document.getElementById('wsLabel').textContent='Brak połączenia';});
 socket.on('disconnect',()=>{ready=false;show('Brak połączenia — poczekaj przed edycją',true);});
 socket.on('mapError',error=>show(error,true));
 socket.emit=function(event,...args){
  if(!event.startsWith(prefix))return emit(event,...args);
  const callback=typeof args.at(-1)==='function'?args.pop():null;
  if(!socket.connected||!ready){show('Nie zapisano: brak połączenia live. Poczekaj na połączenie.',true);callback?.(false);return socket;}
  pending++;lastError='';show('Zapisywanie…');
  let done=false;
  const timeout=setTimeout(()=>finish({ok:false,error:'Brak potwierdzenia zapisu. Sprawdź stan mapy przed ponowieniem.'}),10000);
  function finish(result){
   if(done)return;done=true;clearTimeout(timeout);pending--;
   if(!result?.ok){lastError=result?.error||'Nie zapisano zmiany';show(lastError,true);emit('mapRequestState');}
   else show(pending?'Zapisywanie…':'Zapisano · na żywo');
   callback?.(!!result?.ok);
  }
  emit(event,...args,finish);return socket;
 };
 socket.canEdit=()=>{if(socket.connected&&ready)return true;show('Najpierw poczekaj na połączenie live',true);return false;};
 window.addEventListener('beforeunload',event=>{if(pending){event.preventDefault();event.returnValue='';}});
 // Register page listeners before receiving the initial snapshot.
 setTimeout(()=>socket.connect(),0);
 return socket;
};

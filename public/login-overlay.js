document.addEventListener('DOMContentLoaded',()=>{
  const style=document.createElement('style');style.textContent='#saAuthBar{position:fixed;top:0;right:0;z-index:8000;background:#100d08ed;color:#c9a84c;border:1px solid #3a2e1a;padding:8px 12px;display:flex;gap:12px;align-items:center;font:12px Georgia}#saAuthBar button{background:#5865f2;color:white;border:0;padding:7px 12px;cursor:pointer;border-radius:3px}';document.head.appendChild(style);
  const bar=document.createElement('div');bar.id='saAuthBar';const nick=document.createElement('span');const button=document.createElement('button');button.textContent='Zaloguj przez Discord';button.onclick=()=>SojuszAuth.login();bar.append(nick,button);document.body.appendChild(bar);
  window._saUpdateBar=user=>{nick.textContent=user.displayName||user.nick;button.textContent='Wyloguj';button.onclick=()=>SojuszAuth.logout();};
  window.SojuszOverlay={show:()=>SojuszAuth.login(),hide:()=>{}};
  SojuszAuth.getUser().then(user=>{if(user)window._saUpdateBar(user);});
});

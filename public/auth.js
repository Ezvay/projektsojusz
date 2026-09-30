/* Authentication is held in an HttpOnly server session cookie. */
window.SojuszAuth = (() => {
  localStorage.removeItem('sojusz_token');
  function getToken(){return 'discord-session';} // Compatibility for existing request guards; not a credential.
  async function getUser(){try{const r=await fetch('/api/me',{credentials:'same-origin'});return r.ok?await r.json():null;}catch{return null;}}
  function login(){location.href='/auth/discord?returnTo='+encodeURIComponent(location.pathname);}
  let loggingOut=false;
  async function logout(){if(loggingOut)return;loggingOut=true;try{const r=await fetch('/api/logout',{method:'POST'});if(!r.ok)throw Error();localStorage.removeItem('sojusz_token');location.href='/auth/discord';}catch{loggingOut=false;alert('Nie udało się wylogować. Spróbuj ponownie.');}}
  return {getToken,getUser,login,logout};
})();

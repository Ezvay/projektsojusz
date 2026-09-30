const crypto = require('node:crypto');

// Discord credentials belong in the hosting environment, never in public files.
module.exports = function installDiscordAuth({app, io, getDb, getUsers, env=process.env, fetchImpl=fetch}) {
  const origin = new URL((env.PUBLIC_URL || 'https://projekt-sojusz-production.up.railway.app').trim()).origin;
  const callback = origin + '/auth/discord/callback';
  const guildId = env.DISCORD_GUILD_ID || '1543972927719080016';
  const adminRole = env.DISCORD_ADMIN_ROLE_ID || '1543979266084044820';
  const secure = new URL(origin).protocol === 'https:';
  const cookieOptions={httpOnly:true,secure,sameSite:'lax',path:'/'};
  const hash = value => crypto.createHash('sha256').update(value).digest('hex');
  const random = () => crypto.randomBytes(32).toString('hex');
  const cookies = req => Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim().split('=')));
  const sessions = () => getDb().collection('discord_sessions');
  const states = () => getDb().collection('discord_oauth_states');
  function safeReturn(value) {return typeof value==='string' && /^\/(?!\/)[a-zA-Z0-9_./-]*$/.test(value) ? value : '/';}
  function fail(res,message,status=400) {
    return res.status(status).type('html').send('<!doctype html><html lang="pl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Logowanie Discord</title><body style="background:#100d08;color:#e8e0d0;font:18px Georgia;padding:40px"><h1>Logowanie Discord</h1><p>'+message+'</p><a style="color:#f0d080" href="/auth/discord">Spróbuj ponownie</a></body></html>');
  }
  async function discord(url,token) {
    const response=await fetchImpl('https://discord.com/api/v10'+url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error(response.status===404||response.status===403?'membership':'discord');
    return response.json();
  }
  const sessionCache=new Map(),pendingSessions=new Map();
  async function getSession(req) {
    const raw=cookies(req).sojusz_session;
    if(!raw||!/^[a-f0-9]{64}$/.test(raw)||!getDb())return null;
    const key=hash(raw),cached=sessionCache.get(key),now=Date.now();
    if(cached&&cached.until>now&&new Date(cached.session.expiresAt).getTime()>now&&now-cached.session.checkedAt<=5*60*1000)return cached.session;
    if(pendingSessions.has(key))return pendingSessions.get(key);
    const loading=loadSession(req).then(session=>{
      if(session){if(sessionCache.size>=1000)sessionCache.delete(sessionCache.keys().next().value);sessionCache.set(key,{session,until:Date.now()+30000});}
      else sessionCache.delete(key);
      return session;
    }).finally(()=>pendingSessions.delete(key));
    pendingSessions.set(key,loading);return loading;
  }
  async function loadSession(req) {
    const raw=cookies(req).sojusz_session;
    if(!raw||!/^[a-f0-9]{64}$/.test(raw)||!getDb())return null;
    const session=await sessions().findOne({_id:hash(raw),expiresAt:{$gt:new Date()}});
    if(!session)return null;
    // Re-check membership and admin role periodically, including active sockets.
    if(Date.now()-session.checkedAt>5*60*1000) {
      try {
        const member=await discord('/users/@me/guilds/'+guildId+'/member',session.accessToken);
        if(member.pending)throw new Error('membership');
        session.user.role=(member.roles||[]).includes(adminRole)?'admin':'player';
        session.checkedAt=Date.now();
        await sessions().updateOne({_id:session._id},{$set:{user:session.user,checkedAt:session.checkedAt}});
      } catch(e) {
        await sessions().deleteOne({_id:session._id});
        return null;
      }
    }
    return session;
  }
  app.get('/auth/discord',async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    if(!env.DISCORD_CLIENT_ID||!env.DISCORD_CLIENT_SECRET)return fail(res,'Administrator musi ustawić DISCORD_CLIENT_ID i DISCORD_CLIENT_SECRET w Railway.',503);
    try {
      const state=random();
      await states().insertOne({_id:hash(state),returnTo:safeReturn(req.query.returnTo),expiresAt:new Date(Date.now()+10*60*1000)});
      res.cookie('discord_oauth_state',state,{...cookieOptions,maxAge:10*60*1000});
      const query=new URLSearchParams({client_id:env.DISCORD_CLIENT_ID,redirect_uri:callback,response_type:'code',scope:'identify guilds.members.read',state});
      res.redirect('https://discord.com/oauth2/authorize?'+query);
    }catch(e){fail(res,'Nie można rozpocząć logowania. Spróbuj za chwilę.',503);}
  });
  app.get('/auth/discord/callback',async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    const state=req.query.state, expected=cookies(req).discord_oauth_state;
    res.clearCookie('discord_oauth_state',cookieOptions);
    if(typeof state!=='string'||!/^[a-f0-9]{64}$/.test(state)||!expected||state!==expected)return fail(res,'Sesja logowania wygasła. Rozpocznij ponownie.');
    try {
      const pending=await states().findOneAndDelete({_id:hash(state),expiresAt:{$gt:new Date()}},{includeResultMetadata:false});
      if(!pending||req.query.error||typeof req.query.code!=='string')return fail(res,'Logowanie zostało anulowane lub wygasło.');
      const tokenResponse=await fetchImpl('https://discord.com/api/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.DISCORD_CLIENT_ID,client_secret:env.DISCORD_CLIENT_SECRET,grant_type:'authorization_code',code:req.query.code,redirect_uri:callback}),signal:AbortSignal.timeout(10000)});
      if(!tokenResponse.ok)throw new Error('discord');
      const token=await tokenResponse.json();
      if(!token.access_token)throw new Error('discord');
      const profile=await discord('/users/@me',token.access_token);
      const member=await discord('/users/@me/guilds/'+guildId+'/member',token.access_token);
      if(member.pending)throw new Error('membership');
      const role=(member.roles||[]).includes(adminRole)?'admin':'player';
      // Immutable identity for existing nick-based reservations; never link by display name.
      const nick='dc_'+profile.id;
      const user={discordId:profile.id,nick,displayName:member.nick||profile.global_name||profile.username,guild:'Discord',role};
      await getUsers().updateOne({discordId:profile.id},{$set:user,$setOnInsert:{createdAt:new Date()}},{upsert:true});
      const old=cookies(req).sojusz_session;
      if(old){await sessions().deleteOne({_id:hash(old)});sessionCache.delete(hash(old));}
      const sessionId=random();
      const maxAge=Math.min(12*60*60,Number(token.expires_in)||3600)*1000;
      await sessions().insertOne({_id:hash(sessionId),user,accessToken:token.access_token,checkedAt:Date.now(),expiresAt:new Date(Date.now()+maxAge)});
      res.cookie('sojusz_session',sessionId,{...cookieOptions,maxAge});
      res.redirect(pending.returnTo);
    }catch(e){fail(res,e.message==='membership'?'Dostęp mają wyłącznie członkowie naszego serwera Discord, którzy ukończyli weryfikację.':'Nie udało się potwierdzić logowania w Discordzie. Spróbuj ponownie.',403);}
  });
  app.post('/api/logout',async(req,res)=>{
    if(req.headers.origin && req.headers.origin!==origin)return res.status(403).json({error:'Niedozwolone żądanie'});
    const raw=cookies(req).sojusz_session;
    try {
      if(raw) {
        await sessions().deleteOne({_id:hash(raw)});
        sessionCache.delete(hash(raw));
        for(const socket of io.sockets.sockets.values())if(cookies(socket.request).sojusz_session===raw)socket.disconnect(true);
      }
      res.clearCookie('sojusz_session',cookieOptions);
      res.json({ok:true});
    }catch(e){res.status(503).json({error:'Nie udało się wylogować. Spróbuj ponownie.'});}
  });
  async function requireUser(req,res,next) {
    try {
      const session=await getSession(req);
      if(!session)return res.status(401).json({error:'Zaloguj się przez Discord'});
      if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers.origin!==origin)return res.status(403).json({error:'Niedozwolone żądanie'});
      req.user=session.user;next();
    }catch(e){res.status(503).json({error:'Nie można sprawdzić sesji'});}
  }
  app.use((req,res,next)=>{
    if(req.path.startsWith('/api/')||req.path.startsWith('/admin/'))return requireUser(req,res,next);
    if(!['/auth.js','/login-overlay.js','/logo.png','/background.jpg'].includes(req.path)) {
      getSession(req).then(session=>session?next():res.redirect('/auth/discord?returnTo='+encodeURIComponent(safeReturn(req.path)))).catch(()=>fail(res,'Nie można sprawdzić sesji.',503));
    } else next();
  });
  io.use(async(socket,next)=>{
    try {
      // Same-origin polling GETs may omit Origin. Reject foreign browser origins.
      const headers=socket.handshake.headers;
      if(headers.origin ? headers.origin!==origin : headers['sec-fetch-site']==='cross-site'||headers['sec-fetch-site']==='same-site')return next(new Error('Niedozwolone połączenie'));
      const session=await getSession(socket.request);
      if(!session)return next(new Error('Zaloguj się przez Discord'));
      socket.data.user=session.user;next();
    }catch(e){next(new Error('Nie można sprawdzić sesji'));}
  });
  io.on('connection',socket=>socket.use(async(packet,next)=>{
    try {
      const session=await getSession(socket.request);
      if(!session){socket.disconnect(true);return;}
      socket.data.user=session.user;next();
    }catch(e){socket.disconnect(true);}
  }));
  return {requireUser,getSession};
};

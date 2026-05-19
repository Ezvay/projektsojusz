/* ═══════════════════════════════════════════════
   WSPÓLNY LOGIN OVERLAY — wstrzykiwany przez login-overlay.js
═══════════════════════════════════════════════ */

document.addEventListener("DOMContentLoaded", function() {
  /* ── CSS ── */
  const style = document.createElement('style');
  style.textContent = `
    .sa-overlay{position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,0.88);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(5px);}
    .sa-overlay.hidden{display:none;}
    .sa-box{background:linear-gradient(160deg,#1e1810,#100d08);border:1px solid rgba(201,168,76,0.4);border-radius:4px;padding:36px 44px;width:380px;text-align:center;box-shadow:0 0 60px rgba(0,0,0,0.9);}
    .sa-logo{height:52px;object-fit:contain;margin-bottom:14px;filter:drop-shadow(0 0 10px rgba(201,168,76,0.4));}
    .sa-title{font-family:'Cinzel',serif;font-size:11px;letter-spacing:3px;color:#c9a84c;text-transform:uppercase;margin-bottom:18px;}
    .sa-tabs{display:flex;margin-bottom:18px;border-bottom:1px solid rgba(201,168,76,0.15);}
    .sa-tab{flex:1;font-family:'Cinzel',serif;font-size:9px;letter-spacing:2px;padding:9px;color:rgba(232,224,208,0.45);cursor:pointer;text-align:center;text-transform:uppercase;transition:all 0.2s;border-bottom:2px solid transparent;margin-bottom:-1px;}
    .sa-tab.active{color:#c9a84c;border-bottom-color:#c9a84c;}
    .sa-pane{display:none;} .sa-pane.active{display:block;}
    .sa-field{text-align:left;margin-bottom:11px;}
    .sa-lbl{font-family:'Cinzel',serif;font-size:8px;letter-spacing:1.5px;color:rgba(232,224,208,0.45);text-transform:uppercase;display:block;margin-bottom:4px;}
    .sa-inp{width:100%;background:rgba(0,0,0,0.5);border:1px solid rgba(201,168,76,0.2);color:#e8e0d0;font-family:'Crimson Text',serif;font-size:14px;padding:8px 10px;border-radius:2px;outline:none;transition:border-color 0.2s;}
    .sa-inp:focus{border-color:rgba(201,168,76,0.5);}
    .sa-btn{width:100%;font-family:'Cinzel',serif;font-size:10px;letter-spacing:2px;text-transform:uppercase;padding:12px;border:1px solid rgba(201,168,76,0.4);color:#c9a84c;background:rgba(201,168,76,0.07);cursor:pointer;border-radius:2px;transition:all 0.2s;margin-top:6px;}
    .sa-btn:hover{background:rgba(201,168,76,0.18);}
    .sa-err{color:#e07070;font-size:12px;margin-top:8px;min-height:18px;}
    .sa-skip{font-family:'Cinzel',serif;font-size:9px;color:rgba(232,224,208,0.4);cursor:pointer;margin-top:12px;display:block;text-decoration:underline;}
    .sa-skip:hover{color:#c9a84c;}
  `;
  document.head.appendChild(style);

  /* ── HTML ── */
  const div = document.createElement('div');
  div.id = 'saOverlay';
  div.className = 'sa-overlay hidden';
  div.innerHTML = `
    <div class="sa-box">
      <img src="/logo.png" class="sa-logo" alt="Projekt Sojusz">
      <div class="sa-title" id="saTitle">Projekt Sojusz</div>
      <div class="sa-tabs">
        <div class="sa-tab active" onclick="window._saTab('login')">Zaloguj się</div>
        <div class="sa-tab" onclick="window._saTab('register')">Rejestracja</div>
      </div>
      <div class="sa-pane active" id="saPaneLogin">
        <div class="sa-field"><label class="sa-lbl">Nick</label><input class="sa-inp" id="saNick" placeholder="Twój nick..." onkeydown="if(event.key==='Enter')window._saLogin()"></div>
        <div class="sa-field"><label class="sa-lbl">Hasło</label><input class="sa-inp" type="password" id="saPass" placeholder="Hasło..." onkeydown="if(event.key==='Enter')window._saLogin()"></div>
        <button class="sa-btn" onclick="window._saLogin()">→ Zaloguj się</button>
        <div class="sa-err" id="saLoginErr"></div>
        <span class="sa-skip" id="saSkip" style="display:none;" onclick="window._saSkip()">Wejdź bez logowania</span>
      </div>
      <div class="sa-pane" id="saPaneReg">
        <div class="sa-field"><label class="sa-lbl">Nick</label><input class="sa-inp" id="saRNick" placeholder="Nick w grze..."></div>
        <div class="sa-field"><label class="sa-lbl">Gildia</label><input class="sa-inp" id="saRGuild" placeholder="Gildia..."></div>
        <div class="sa-field"><label class="sa-lbl">Hasło</label><input class="sa-inp" type="password" id="saRPass" placeholder="Min. 4 znaki..."></div>
        <div class="sa-field"><label class="sa-lbl">Kod dostępu sojuszu</label><input class="sa-inp" type="password" id="saRCode" placeholder="Zapytaj admina o kod..."></div>
        <button class="sa-btn" onclick="window._saRegister()">→ Zarejestruj konto</button>
        <div class="sa-err" id="saRegErr"></div>
      </div>
    </div>
  `;
  document.body.appendChild(div);

  /* ── JS ── */
  window._saTab = function(t) {
    document.querySelectorAll('.sa-tab').forEach((el,i) => el.classList.toggle('active', (t==='login'?0:1)===i));
    document.getElementById('saPaneLogin').classList.toggle('active', t==='login');
    document.getElementById('saPaneReg').classList.toggle('active', t==='register');
  };

  window._saLogin = async function() {
    const nick = document.getElementById('saNick').value.trim();
    const pass = document.getElementById('saPass').value;
    const err  = document.getElementById('saLoginErr');
    if (!nick || !pass) { err.textContent = 'Wpisz nick i hasło'; return; }
    err.textContent = '';
    try {
      const user = await window.SojuszAuth.login(nick, pass);
      if (window._saUpdateBar) window._saUpdateBar(user);
      window.dispatchEvent(new CustomEvent('sojusz:login', { detail: user }));
      document.getElementById('saOverlay').classList.add('hidden');
    } catch(e) { err.textContent = e.message; }
  };

  window._saRegister = async function() {
    const nick  = document.getElementById('saRNick').value.trim();
    const guild = document.getElementById('saRGuild').value.trim();
    const pass  = document.getElementById('saRPass').value;
    const code  = document.getElementById('saRCode').value.trim();
    const err   = document.getElementById('saRegErr');
    if (!nick||!guild||!pass||!code) { err.textContent = 'Wypełnij wszystkie pola'; return; }
    err.textContent = '';
    try {
      await window.SojuszAuth.register(nick, guild, pass, code);
      document.getElementById('saRNick').value = '';
      document.getElementById('saRPass').value = '';
      document.getElementById('saRCode').value = '';
      window._saTab('login');
      document.getElementById('saNick').value = nick;
      document.getElementById('saLoginErr').textContent = 'Zarejestrowano! Teraz się zaloguj.';
    } catch(e) { err.textContent = e.message; }
  };

  window._saSkip = function() {
    document.getElementById('saOverlay').classList.add('hidden');
    window.dispatchEvent(new Event('sojusz:skip'));
  };

  /* ── API ── */

  /* ── MINI AUTH BAR (prawy górny róg) ── */
  const barStyle = document.createElement('style');
  barStyle.textContent = `
    #saAuthBar{position:fixed;top:0;right:0;z-index:8000;display:flex;align-items:center;gap:8px;padding:10px 16px;background:linear-gradient(to bottom,rgba(9,8,6,0.97),rgba(9,8,6,0.85));border-left:1px solid rgba(201,168,76,0.12);border-bottom:1px solid rgba(201,168,76,0.12);}
    #saAuthBar .sa-bar-nick{font-family:'Cinzel',serif;font-size:10px;letter-spacing:1px;color:#c9a84c;}
    #saAuthBar .sa-bar-btn{font-family:'Cinzel',serif;font-size:8px;letter-spacing:1px;padding:5px 12px;border:1px solid rgba(201,168,76,0.3);color:rgba(201,168,76,0.7);background:none;cursor:pointer;border-radius:2px;transition:all 0.2s;}
    #saAuthBar .sa-bar-btn:hover{color:#c9a84c;border-color:rgba(201,168,76,0.6);}
    #saAuthBar .sa-bar-btn.login{border-color:rgba(201,168,76,0.4);color:#c9a84c;}
  `;
  document.head.appendChild(barStyle);

  const bar = document.createElement('div');
  bar.id = 'saAuthBar';
  bar.innerHTML = `
    <div id="saBarOut" style="display:flex;align-items:center;gap:8px;">
      <button class="sa-bar-btn login" onclick="window.SojuszOverlay && window.SojuszOverlay.show()">→ Zaloguj się</button>
    </div>
    <div id="saBarIn" style="display:none;align-items:center;gap:8px;">
      <span class="sa-bar-nick" id="saBarNick"></span>
      <button class="sa-bar-btn" onclick="window.SojuszAuth.logout();location.reload();">Wyloguj</button>
    </div>
  `;
  document.body.appendChild(bar);

  /* Aktualizuj bar przy login/logout */
  window.addEventListener('sojusz:login', function(e){ if(window._saUpdateBar) window._saUpdateBar(e.detail); });
  window.addEventListener('sojusz:logout', function(){
    document.getElementById('saBarOut').style.display = 'flex';
    document.getElementById('saBarIn').style.display  = 'none';
  });
  /* Sprawdź stan przy ładowaniu */
  (async function(){
    if (!window.SojuszAuth) return;
    const user = await window.SojuszAuth.getUser();
    if (user) _saUpdateBar(user);
  })();

  window._saUpdateBar = function(user) {
    const barOut = document.getElementById('saBarOut');
    const barIn  = document.getElementById('saBarIn');
    const barNick= document.getElementById('saBarNick');
    if (barOut) barOut.style.display = 'none';
    if (barIn)  barIn.style.display  = 'flex';
    if (barNick) barNick.textContent = user.nick + ' · ' + (user.guild||'');
  };

  window.SojuszOverlay = {
    show: function(title, allowSkip) {
      document.getElementById('saTitle').textContent = title || 'Projekt Sojusz';
      document.getElementById('saSkip').style.display = allowSkip ? '' : 'none';
      document.getElementById('saOverlay').classList.remove('hidden');
    },
    hide: function() {
      document.getElementById('saOverlay').classList.add('hidden');
    }
  };
});

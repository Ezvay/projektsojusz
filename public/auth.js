/* ═══════════════════════════════════════════════
   WSPÓLNY MODUŁ AUTH — Projekt Sojusz
   Używany przez: index, grota, giganty, kalendarz, timery
═══════════════════════════════════════════════ */

window.SojuszAuth = (function() {

  const KEY = 'sojusz_token';

  function getToken() { return localStorage.getItem(KEY); }

  async function getUser() {
    const tok = getToken();
    if (!tok) return null;
    try {
      const r = await fetch('/api/me', { headers: { 'Authorization': 'Bearer ' + tok } });
      if (!r.ok) { localStorage.removeItem(KEY); return null; }
      return await r.json();
    } catch(e) { return null; }
  }

  async function login(nick, pass) {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nick, password: pass })
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    localStorage.setItem(KEY, d.token);
    return d;
  }

  async function register(nick, guild, pass, code) {
    const r = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nick, guild, password: pass, code })
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    return d;
  }

  function logout() {
    localStorage.removeItem(KEY);
    window.dispatchEvent(new Event('sojusz:logout'));
  }

  return { getToken, getUser, login, register, logout };
})();

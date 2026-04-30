const express         = require("express")
const app             = express()
const http            = require("http").createServer(app)
const io              = require("socket.io")(http)
const { MongoClient, ObjectId } = require("mongodb")
const bcrypt          = require("bcrypt")
const jwt             = require("jsonwebtoken")
const path            = require("path")

const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://kawulokdarek8_db_user:6SJushejd5pUueBo@projektsojusz.cxl68tz.mongodb.net/?appName=ProjektSojusz"
const JWT_SECRET = process.env.JWT_SECRET || "sojusz_secret_2026_hard"
const DB_NAME   = "projektsojusz"
const ADMIN_NICK = "Ezvay"

app.use(express.json())
app.use(express.static(path.join(__dirname, "public")))

/* ═══ CLEAN URLs ═══ */
app.get('/grota',   (req,res) => res.redirect(301,'/grota.html'))
app.get('/giganty', (req,res) => res.redirect(301,'/giganty.html'))
app.get('/kalendarz',(req,res)=> res.redirect(301,'/kalendarz.html'))

/* ═══ STATE (Grota + Giganty) ═══ */
let chatMessages        = []  // max 100
let grotaGenerals       = {}
let grotaKilledGenerals = {}
let grotaRegions        = {}
let grotaSnapshots      = []
let gigTimers           = {}
let gigRunning          = new Set()
let gigWho              = { top: null, bottom: null }
let gigQueue            = { top: [], bottom: [] }
let delegations         = {}  // { section: { fromNick, toNick, expiresAt } }

/* ═══ MONGO ═══ */
let db, col, usersCol, slotsCol

async function connectDB() {
  const client = new MongoClient(MONGO_URI)
  await client.connect()
  db       = client.db(DB_NAME)
  col      = db.collection("state")
  usersCol = db.collection("users")
  slotsCol = db.collection("slots")

  // Indexes
  await usersCol.createIndex({ nick: 1 }, { unique: true })
  await slotsCol.createIndex({ startAt: 1 })
  await slotsCol.createIndex({ nick: 1 })
  // Override requests collection
  const overridesCol = db.collection("overrides")
  app.set('overridesCol', overridesCol)
  await overridesCol.createIndex({ createdAt: 1 }, { expireAfterSeconds: 86400 }) // auto-expire after 24h

  // Load state
  const doc = await col.findOne({ _id: "main" })
  if (doc) {
    chatMessages        = doc.chatMessages        || []
    grotaGenerals       = doc.grotaGenerals       || {}
    grotaKilledGenerals = doc.grotaKilledGenerals || {}
    grotaRegions        = doc.grotaRegions        || {}
    grotaSnapshots      = doc.grotaSnapshots      || []
    gigTimers           = doc.gigTimers           || {}
    gigRunning          = new Set(doc.gigRunning  || [])
    gigWho              = doc.gigWho              || { top:null, bottom:null }
    delegations         = doc.delegations         || {}
    // Clean old killed generals
    const cutoff = Date.now() - 9*60*60*1000
    Object.keys(grotaKilledGenerals).forEach(id => {
      if (grotaKilledGenerals[id].killedAt < cutoff) delete grotaKilledGenerals[id]
    })
    console.log("✅ State loaded")
  }

  // Ensure admin exists and has correct password
  const adminHash = await bcrypt.hash("Da62534604@", 10)
  const adminDoc = await usersCol.findOne({ nick: ADMIN_NICK })
  if (!adminDoc) {
    await usersCol.insertOne({ nick: ADMIN_NICK, guild: "Sojusz", passwordHash: adminHash, role: "admin", createdAt: new Date() })
    console.log("✅ Admin created:", ADMIN_NICK)
  } else {
    // Always update password and role on startup
    await usersCol.updateOne({ nick: ADMIN_NICK }, { $set: { passwordHash: adminHash, role: "admin" } })
    console.log("✅ Admin password updated:", ADMIN_NICK)
  }
}

// Wyślij wiadomość do konkretnego nicka (wszystkie jego sockety)
function emitToNick(nick, event, data) {
  if (userSockets[nick] && userSockets[nick].size > 0) {
    let sent = false
    userSockets[nick].forEach(sid => {
      const s = io.sockets.sockets.get(sid)
      if (s) { s.emit(event, data); sent = true }
    })
    return sent
  }
  return false
}

// Wyślij pending overrides do socketów zalogowanego gracza
async function sendPendingOverrides(socket, nick) {
  try {
    const overridesCol = req_app_overridesCol || (db ? db.collection("overrides") : null)
    if (!overridesCol) return
    const pending = await overridesCol.find({ toNick: nick, status: 'pending' }).toArray()
    if (pending.length > 0) {
      socket.emit('pendingOverrides', pending)
    }
  } catch(e) { console.error('sendPendingOverrides error:', e.message) }
}

// Globalna referencja do overridesCol
let req_app_overridesCol = null

let saveTimer = null
async function saveNow() {
  if (!col) return
  try {
    await col.replaceOne({ _id: "main" }, {
      _id: "main",
      chatMessages, grotaGenerals, grotaKilledGenerals, grotaRegions, grotaSnapshots,
      gigTimers, gigRunning:[...gigRunning], gigWho, delegations,
      savedAt: Date.now()
    }, { upsert: true })
  } catch(e) { console.error("Save error:", e.message) }
}
function saveData() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveNow, 500)
}

/* ═══ AUTH MIDDLEWARE ═══ */
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) return res.status(401).json({ error: 'Brak tokenu' })
  try {
    req.user = jwt.verify(token, JWT_SECRET)
    next()
  } catch(e) { res.status(401).json({ error: 'Nieprawidłowy token' }) }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Tylko admin' })
  next()
}

/* ═══ AUTH ROUTES ═══ */
app.post('/api/register', async (req, res) => {
  const { nick, guild, password } = req.body
  if (!nick || !guild || !password) return res.status(400).json({ error: 'Wszystkie pola wymagane' })
  if (nick.length < 2 || nick.length > 30) return res.status(400).json({ error: 'Nick 2-30 znaków' })
  if (password.length < 4) return res.status(400).json({ error: 'Hasło min. 4 znaki' })
  try {
    const hash = await bcrypt.hash(password, 10)
    const role = nick === ADMIN_NICK ? 'admin' : 'player'
    await usersCol.insertOne({ nick, guild, passwordHash: hash, role, createdAt: new Date() })
    const token = jwt.sign({ nick, guild, role }, JWT_SECRET, { expiresIn: '7d' })
    res.json({ token, nick, guild, role })
  } catch(e) {
    if (e.code === 11000) res.status(409).json({ error: 'Nick już zajęty' })
    else res.status(500).json({ error: 'Błąd serwera' })
  }
})

app.post('/api/login', async (req, res) => {
  const { nick, password } = req.body
  if (!nick || !password) return res.status(400).json({ error: 'Wymagane nick i hasło' })
  const user = await usersCol.findOne({ nick })
  if (!user) return res.status(401).json({ error: 'Nieprawidłowy nick lub hasło' })
  const ok = await bcrypt.compare(password, user.passwordHash)
  if (!ok) return res.status(401).json({ error: 'Nieprawidłowy nick lub hasło' })
  const token = jwt.sign({ nick: user.nick, guild: user.guild, role: user.role }, JWT_SECRET, { expiresIn: '7d' })
  res.json({ token, nick: user.nick, guild: user.guild, role: user.role })
})

app.get('/api/me', authMiddleware, (req, res) => res.json(req.user))

app.get('/api/users', authMiddleware, async (req, res) => {
  const users = await usersCol.find({}, { projection: { passwordHash:0 } }).toArray()
  res.json(users)
})

app.delete('/api/users/:nick', authMiddleware, adminOnly, async (req, res) => {
  if (req.params.nick === ADMIN_NICK) return res.status(400).json({ error: 'Nie można usunąć admina' })
  await usersCol.deleteOne({ nick: req.params.nick })
  await slotsCol.deleteMany({ nick: req.params.nick })
  res.json({ ok: true })
})

/* ═══ SLOTS ROUTES ═══ */
// Get slots for week
app.get('/api/slots', async (req, res) => {
  const { from, to } = req.query
  const filter = {}
  if (from) filter.startAt = { $gte: new Date(from) }
  if (to)   filter.startAt = { ...filter.startAt, $lte: new Date(to) }
  const slots = await slotsCol.find(filter).sort({ startAt: 1 }).toArray()
  res.json(slots)
})

// Reserve slot
app.post('/api/slots', authMiddleware, async (req, res) => {
  const { section, startAt, endAt, forNick } = req.body
  if (!section || !startAt || !endAt) return res.status(400).json({ error: 'Brakuje danych' })
  if (section !== 'top' && section !== 'bottom') return res.status(400).json({ error: 'Zła sekcja' })

  // Admin może rezerwować dla dowolnego nicka
  let slotNick = req.user.nick
  let slotGuild = req.user.guild
  if (forNick && forNick.trim() && req.user.role === 'admin') {
    slotNick = forNick.trim()
    // Sprawdź czy użytkownik istnieje
    const targetUser = await usersCol.findOne({ nick: slotNick })
    slotGuild = targetUser ? targetUser.guild : 'Gość'
  }

  const start = new Date(startAt)
  const end   = new Date(endAt)
  const diffH = (end - start) / 3600000

  if (diffH < 1)  return res.status(400).json({ error: 'Min. 1 godzina' })
  if (diffH > 8)  return res.status(400).json({ error: 'Max. 8 godzin' })
  if (start < new Date() && req.user.role !== 'admin') return res.status(400).json({ error: 'Nie można rezerwować w przeszłości' })

  // Check collision
  const conflict = await slotsCol.findOne({
    section,
    $or: [{ startAt: { $lt: end }, endAt: { $gt: start } }]
  })
  if (conflict) {
    // Zwróć info o konflikcie — klient może zaproponować nadpisanie
    return res.status(409).json({
      error: 'conflict',
      conflict: {
        slotId: String(conflict._id),
        nick: conflict.nick,
        guild: conflict.guild,
        startAt: conflict.startAt,
        endAt: conflict.endAt
      }
    })
  }

  const note = req.body.note ? String(req.body.note).slice(0,80) : ''
  const slot = {
    nick: slotNick,
    guild: slotGuild,
    section,
    startAt: start,
    endAt: end,
    note,
    createdAt: new Date()
  }
  const result = await slotsCol.insertOne(slot)
  const saved = { ...slot, _id: result.insertedId }
  io.emit('slotsUpdate', { action: 'add', slot: saved })
  res.json(saved)
})

// Edit slot
app.put('/api/slots/:id', authMiddleware, async (req, res) => {
  const { startAt, endAt } = req.body
  const slot = await slotsCol.findOne({ _id: new ObjectId(req.params.id) })
  if (!slot) return res.status(404).json({ error: 'Slot nie istnieje' })
  if (slot.nick !== req.user.nick && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Nie możesz edytować cudzego slotu' })

  const start = new Date(startAt)
  const end   = new Date(endAt)
  const diffH = (end - start) / 3600000
  if (diffH < 1 || diffH > 8) return res.status(400).json({ error: 'Czas 1-8h' })

  // Check collision (exclude self)
  const conflict = await slotsCol.findOne({
    section: slot.section,
    _id: { $ne: new ObjectId(req.params.id) },
    $or: [{ startAt: { $lt: end }, endAt: { $gt: start } }]
  })
  if (conflict) return res.status(409).json({ error: `Kolizja z ${conflict.nick}` })

  await slotsCol.updateOne({ _id: new ObjectId(req.params.id) }, { $set: { startAt: start, endAt: end } })
  const updated = { ...slot, startAt: start, endAt: end }
  io.emit('slotsUpdate', { action: 'update', slot: updated })
  res.json(updated)
})

// Request override (prośba o nadpisanie - może być częściowe)
app.post('/api/slots/override-request', authMiddleware, async (req, res) => {
  const { conflictSlotId, section, startAt, endAt } = req.body
  const overridesCol = req.app.get('overridesCol')

  const conflictSlot = await slotsCol.findOne({ _id: new ObjectId(conflictSlotId) })
  if (!conflictSlot) return res.status(404).json({ error: 'Slot nie istnieje' })
  if (conflictSlot.nick === req.user.nick) return res.status(400).json({ error: 'To Twój własny slot' })

  const reqStart = new Date(startAt)
  const reqEnd   = new Date(endAt)

  // Walidacja: żądany czas musi być w obrębie konfliktowego slotu
  if (reqStart < new Date(conflictSlot.startAt) || reqEnd > new Date(conflictSlot.endAt))
    return res.status(400).json({ error: 'Żądany czas wykracza poza istniejący slot' })

  const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay()); weekStart.setHours(0,0,0,0)
  const weekEnd   = new Date(weekStart); weekEnd.setDate(weekEnd.getDate()+7)
  const mySlots = await slotsCol.find({ nick: req.user.nick, section, startAt: { $gte: weekStart, $lt: weekEnd } }).toArray()
  const myHours = mySlots.reduce((sum,s)=>(sum+(new Date(s.endAt)-new Date(s.startAt))/3600000),0)
  const ownerSlots = await slotsCol.find({ nick: conflictSlot.nick, section, startAt: { $gte: weekStart, $lt: weekEnd } }).toArray()
  const ownerHours = ownerSlots.reduce((sum,s)=>(sum+(new Date(s.endAt)-new Date(s.startAt))/3600000),0)

  const overrideId = 'ovr_'+Date.now()
  await overridesCol.insertOne({
    _id: overrideId,
    fromNick: req.user.nick, fromGuild: req.user.guild,
    toNick: conflictSlot.nick,
    conflictSlotId: String(conflictSlotId), section,
    // Oryginalne granice slotu właściciela - wymuś Date objects
    origStartAt: new Date(conflictSlot.startAt), origEndAt: new Date(conflictSlot.endAt),
    // Żądany przez requestera czas (może być fragment)
    newStartAt: new Date(reqStart), newEndAt: new Date(reqEnd),
    myWeekHours: myHours, ownerWeekHours: ownerHours,
    status: 'pending', createdAt: new Date()
  })

  const overrideData = {
    overrideId, fromNick: req.user.nick, fromGuild: req.user.guild, toNick: conflictSlot.nick,
    section, newStartAt: startAt, newEndAt: endAt,
    myWeekHours: myHours, ownerWeekHours: ownerHours
  }
  // Wyślij do konkretnego użytkownika jeśli jest podłączony
  emitToNick(conflictSlot.nick, 'overrideRequest', overrideData)
  // Zawsze też broadcast - każdy klient sprawdza czy to dla niego
  io.emit('overrideNotify', overrideData)
  res.json({ overrideId, toNick: conflictSlot.nick })
})

// Odpowiedź na prośbę nadpisania
app.post('/api/slots/override-respond', authMiddleware, async (req, res) => {
  const { overrideId, accept } = req.body
  const overridesCol = req.app.get('overridesCol')
  const ovr = await overridesCol.findOne({ _id: overrideId })
  if (!ovr) return res.status(404).json({ error: 'Prośba wygasła lub nie istnieje' })
  if (ovr.toNick !== req.user.nick && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Nie możesz odpowiedzieć na tę prośbę' })

  await overridesCol.updateOne({ _id: overrideId }, { $set: { status: accept?'accepted':'rejected' } })

  if (accept) {
    // Pobierz aktualny slot żeby potwierdzić że istnieje
    let conflictSlot = null
    try { conflictSlot = await slotsCol.findOne({ _id: new ObjectId(ovr.conflictSlotId) }) }
    catch(e) { console.error('Override respond: bad conflictSlotId:', ovr.conflictSlotId, e.message) }

    // origStart/End z zapisanych danych (zawsze powinny być, bo zapisujemy przy request)
    const reqStart = new Date(ovr.newStartAt)
    const reqEnd   = new Date(ovr.newEndAt)

    // Granice oryginału - priorytet: zapisane origStartAt > aktualny slot > błąd
    let origStart, origEnd
    if (ovr.origStartAt && ovr.origEndAt) {
      origStart = new Date(ovr.origStartAt)
      origEnd   = new Date(ovr.origEndAt)
    } else if (conflictSlot) {
      origStart = new Date(conflictSlot.startAt)
      origEnd   = new Date(conflictSlot.endAt)
    } else {
      console.error('Override respond: cannot determine original slot boundaries for', overrideId)
      return res.status(500).json({ error: 'Brakuje danych o oryginalnym slocie' })
    }

    console.log('Override accept:', {
      owner: ovr.toNick, requester: ovr.fromNick,
      origStart: origStart.toISOString(), origEnd: origEnd.toISOString(),
      reqStart: reqStart.toISOString(), reqEnd: reqEnd.toISOString()
    })

    // Pobierz gildię właściciela
    const ownerUser = await usersCol.findOne({ nick: ovr.toNick })
    const ownerGuild = ownerUser?.guild || ''

    // Usuń oryginalny slot
    // Próbuj różne metody żeby na pewno go usunąć
    if (conflictSlot) {
      await slotsCol.deleteOne({ _id: conflictSlot._id })
      io.emit('slotsUpdate', { action: 'delete', slotId: String(conflictSlot._id) })
      console.log('Deleted conflict slot:', String(conflictSlot._id))
    } else {
      // Fallback: szukaj po nick+section+czas = origStart do origEnd
      const deleted = await slotsCol.findOneAndDelete({
        nick: ovr.toNick, section: ovr.section,
        startAt: origStart, endAt: origEnd
      })
      if (deleted) {
        io.emit('slotsUpdate', { action: 'delete', slotId: String(deleted._id) })
        console.log('Deleted conflict slot by time match:', String(deleted._id))
      } else {
        console.error('Could not find conflict slot to delete!', { toNick: ovr.toNick, origStart, origEnd })
      }
    }

    // Właściciel zachowuje czas PRZED żądanym fragmentem (np. 15:00-20:00 gdy request na 20:00-22:00)
    if (origStart.getTime() < reqStart.getTime()) {
      const beforeSlot = { nick: ovr.toNick, guild: ownerGuild, section: ovr.section,
        startAt: origStart, endAt: reqStart, createdAt: new Date() }
      const r1 = await slotsCol.insertOne(beforeSlot)
      io.emit('slotsUpdate', { action: 'add', slot: { ...beforeSlot, _id: r1.insertedId } })
      console.log('✅ BEFORE slot:', ovr.toNick, origStart.toISOString(), '-', reqStart.toISOString())
    } else {
      console.log('No BEFORE slot needed (origStart >= reqStart)')
    }

    // Właściciel zachowuje czas PO żądanym fragmencie (np. 20:00-22:00 gdy request na 20:00-21:00)
    if (origEnd.getTime() > reqEnd.getTime()) {
      const afterSlot = { nick: ovr.toNick, guild: ownerGuild, section: ovr.section,
        startAt: reqEnd, endAt: origEnd, createdAt: new Date() }
      const r2 = await slotsCol.insertOne(afterSlot)
      io.emit('slotsUpdate', { action: 'add', slot: { ...afterSlot, _id: r2.insertedId } })
      console.log('✅ AFTER slot:', ovr.toNick, reqEnd.toISOString(), '-', origEnd.toISOString())
    } else {
      console.log('No AFTER slot needed (origEnd <= reqEnd)')
    }

    // Nowy slot dla osoby proszącej
    const newSlot = { nick: ovr.fromNick, guild: ovr.fromGuild, section: ovr.section,
      startAt: reqStart, endAt: reqEnd, createdAt: new Date() }
    const r3 = await slotsCol.insertOne(newSlot)
    io.emit('slotsUpdate', { action: 'add', slot: { ...newSlot, _id: r3.insertedId } })
    console.log('✅ NEW slot:', ovr.fromNick, reqStart.toISOString(), '-', reqEnd.toISOString())
  }

  const respondData = { overrideId, accept, fromNick: ovr.fromNick, toNick: ovr.toNick }
  emitToNick(ovr.fromNick, 'overrideResponded', respondData)
  emitToNick(ovr.toNick, 'overrideResponded', respondData)
  io.emit('overrideResponded', respondData)  // broadcast - klienci filtrują
  res.json({ ok: true, accepted: accept })
})

// Moje pending override requests (jako toNick)
app.get('/api/slots/override-pending', authMiddleware, async (req, res) => {
  const overridesCol = req.app.get('overridesCol')
  const pending = await overridesCol.find({ toNick: req.user.nick, status: 'pending' }).toArray()
  res.json(pending)
})

// DIAGNOSTIC - sprawdź override
app.get('/api/debug/override/:id', authMiddleware, async (req, res) => {
  try {
    const overridesCol = req.app.get('overridesCol')
    const ovr = await overridesCol.findOne({ _id: req.params.id })
    if (!ovr) return res.json({ found: false, id: req.params.id })
    res.json({
      found: true,
      ovr: {
        _id: ovr._id,
        toNick: ovr.toNick,
        fromNick: ovr.fromNick,
        status: ovr.status,
        origStartAt: ovr.origStartAt,
        origEndAt: ovr.origEndAt,
        newStartAt: ovr.newStartAt,
        newEndAt: ovr.newEndAt,
        conflictSlotId: ovr.conflictSlotId
      }
    })
  } catch(e) { res.json({ error: e.message }) }
})

// Delete slot
app.delete('/api/slots/:id', authMiddleware, async (req, res) => {
  const slot = await slotsCol.findOne({ _id: new ObjectId(req.params.id) })
  if (!slot) return res.status(404).json({ error: 'Nie znaleziono' })
  if (slot.nick !== req.user.nick && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Nie możesz usunąć cudzego slotu' })
  await slotsCol.deleteOne({ _id: new ObjectId(req.params.id) })
  io.emit('slotsUpdate', { action: 'delete', slotId: req.params.id })
  res.json({ ok: true })
})

/* ═══ ACTIVE SLOT CHECK ═══ */
async function getActiveSlot(nick, section) {
  const now = new Date()
  return await slotsCol.findOne({ nick, section, startAt: { $lte: now }, endAt: { $gt: now } })
}

async function canControlTimers(nick, section) {
  // Check own active slot
  const slot = await getActiveSlot(nick, section)
  if (slot) return true
  // Check delegation — osoba oddelegowana przez kogoś kto ma aktywny slot
  const del = delegations[section]
  if (del && del.toNick === nick && del.expiresAt > Date.now()) {
    // Sprawdź czy delegujący nadal ma aktywny slot
    const delegatorSlot = await getActiveSlot(del.fromNick, section)
    if (delegatorSlot) return true
    // Jeśli nie ma slotu ale expiresAt jeszcze nie minął — też pozwól (slot mógł się skończyć przed expiresAt)
    if (del.expiresAt > Date.now()) return true
  }
  return false
}

/* ═══ DELEGATIONS API ═══ */
app.post('/api/delegate', authMiddleware, async (req, res) => {
  const { section, toNick, minutes } = req.body
  if (!section || !toNick || !minutes) return res.status(400).json({ error: 'Brakuje danych' })
  // Check if requester has active slot
  const slot = await getActiveSlot(req.user.nick, section)
  if (!slot && req.user.role !== 'admin') return res.status(403).json({ error: 'Nie masz aktywnego slotu' })
  // Check target user exists
  const target = await usersCol.findOne({ nick: toNick })
  if (!target) return res.status(404).json({ error: 'Użytkownik nie istnieje' })

  delegations[section] = { fromNick: req.user.nick, toNick, expiresAt: Date.now() + minutes*60000 }
  saveData()
  io.emit('delegationsUpdate', delegations)
  res.json(delegations[section])
})

app.delete('/api/delegate/:section', authMiddleware, async (req, res) => {
  delete delegations[req.params.section]
  saveData()
  io.emit('delegationsUpdate', delegations)
  res.json({ ok: true })
})

app.get('/api/delegations', authMiddleware, (req, res) => res.json(delegations))

/* ═══ TIMER ENGINE ═══ */
const gigIntervals = {}

function getTimerSeconds(id) {
  const t = gigTimers[id]
  if (!t) return 0
  if (typeof t === 'number') return t
  if (t.running && t.startedAt) return Math.floor(t.elapsed + (Date.now() - t.startedAt) / 1000)
  return t.elapsed || 0
}
function getTimersSnapshot() {
  const snap = {}
  for (const id in gigTimers) snap[id] = getTimerSeconds(id)
  return snap
}

function startGig(id) {
  if (gigIntervals[id]) return
  if (!gigTimers[id] || typeof gigTimers[id] === 'number') {
    gigTimers[id] = { elapsed: gigTimers[id] || 0, running: true, startedAt: Date.now() }
  } else {
    gigTimers[id].running = true
    gigTimers[id].startedAt = Date.now()
  }
  gigRunning.add(id)
  gigIntervals[id] = setInterval(() => {
    io.emit('update', getTimersSnapshot())
    const elapsed = getTimerSeconds(id)
    if (elapsed % 10 === 0) saveData()
  }, 1000)
}
function stopGig(id) {
  clearInterval(gigIntervals[id])
  delete gigIntervals[id]
  gigRunning.delete(id)
  if (gigTimers[id] && typeof gigTimers[id] === 'object') {
    gigTimers[id].elapsed = getTimerSeconds(id)
    gigTimers[id].running = false
    delete gigTimers[id].startedAt
  }
  saveData()
}
function resetGig(id) {
  clearInterval(gigIntervals[id])
  delete gigIntervals[id]
  gigRunning.delete(id)
  gigTimers[id] = { elapsed: 0, running: false }
  saveData()
  io.emit('update', getTimersSnapshot())
}

/* ═══ AUTO QUEUE CHECK ═══ */
function parsePolandTime(hhmm) {
  if (!hhmm || !hhmm.includes(':')) return null
  const [h, m] = hhmm.split(':').map(Number)
  if (isNaN(h) || isNaN(m)) return null
  const plNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Warsaw' }))
  const result = new Date(plNow)
  result.setHours(h, m, 0, 0)
  if (result < plNow) result.setDate(result.getDate() + 1)
  return result
}

function checkQueueRotation() {
  const nowPl = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Warsaw' }))
  let changed = false;
  ['top', 'bottom'].forEach(function(section) {
    const who = gigWho[section]
    if (!who || !who.until) return
    const expiry = parsePolandTime(who.until)
    if (!expiry) return
    if (nowPl >= expiry) {
      const queue = gigQueue[section] || []
      if (queue.length > 0) {
        const next = queue.shift()
        gigWho[section] = { nick: next.nick, until: next.until }
        gigQueue[section] = queue
      } else {
        gigWho[section] = null
      }
      io.emit('gigWhoUpdate', gigWho)
      io.emit('gigQueueUpdate', gigQueue)
      changed = true
    }
  })
  if (changed) saveData()
}
setInterval(checkQueueRotation, 30000)

/* ═══ SOCKET.IO ═══ */
// Mapa nick → Set socketów (żeby wysyłać do konkretnego użytkownika)
const userSockets = {}

io.on("connection", async socket => {
  /* ── Auth helper ── */
  function getUser() {
    const token = socket.handshake.auth?.token || socket._authToken
    if (!token) return null
    try { return jwt.verify(token, JWT_SECRET) } catch { return null }
  }

  // Zarejestruj socket dla zalogowanego użytkownika
  const initUser = getUser()
  if (initUser) {
    if (!userSockets[initUser.nick]) userSockets[initUser.nick] = new Set()
    userSockets[initUser.nick].add(socket.id)
    console.log("Socket registered for:", initUser.nick)
  }

  // Klient może zaktualizować token po zalogowaniu bez reconnectu
  socket.on('auth', (token) => {
    try {
      const u = jwt.verify(token, JWT_SECRET)
      socket._authToken = token
      if (!userSockets[u.nick]) userSockets[u.nick] = new Set()
      userSockets[u.nick].add(socket.id)
      console.log("Auth update for socket:", u.nick)
      // Wyślij pending overrides po zalogowaniu
      sendPendingOverrides(socket, u.nick)
    } catch(e) {}
  })

  socket.on('disconnect', () => {
    const u = getUser()
    if (u && userSockets[u.nick]) {
      userSockets[u.nick].delete(socket.id)
      if (userSockets[u.nick].size === 0) delete userSockets[u.nick]
    }
  })

  /* ── Chat (PM + globalny) ── */
  socket.on('chatSend', (data) => {
    // Próbuj uzyskać user z różnych źródeł
    let user = getUser()
    if (!user && data.token) {
      // Klient może wysłać token inline
      try { user = jwt.verify(data.token, JWT_SECRET) } catch(e) {}
    }
    if (!user) {
      console.log('chatSend: no user, socket._authToken=', !!socket._authToken, 'handshake.auth=', !!socket.handshake.auth?.token)
      return
    }
    const text = String(data.text || '').slice(0, 300).trim()
    if (!text) return
    const toNick = data.toNick ? String(data.toNick) : null

    if (toNick) {
      // Prywatna wiadomość
      const pm = {
        id: 'pm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
        nick: user.nick, guild: user.guild,
        text, toNick, ts: Date.now(), private: true
      }
      // Wyślij do odbiorcy (jeśli jest online przez emitToNick, inaczej broadcast)
      const delivered = emitToNick(toNick, 'privateMessage', pm)
      if (!delivered) {
        // Odbiorca nie ma aktywnego socketu - wyślij broadcast (filtrowany przez klientów)
        socket.broadcast.emit('privateMessageBroadcast', pm)
      }
      // Wyślij do nadawcy (tylko raz - nie przez broadcast)
      socket.emit('privateMessage', pm)
    } else {
      // Globalna wiadomość
      const msg = {
        id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
        nick: user.nick, guild: user.guild,
        text, ts: Date.now()
      }
      chatMessages.push(msg)
      if (chatMessages.length > 100) chatMessages = chatMessages.slice(-100)
      saveData()
      io.emit('chatMessage', msg)
    }
  })

  /* ── Giganty timers ── */
  socket.on('start', async id => {
    const user = getUser()
    if (!user) return
    const section = id.startsWith('KGD_') ? 'bottom' : 'top'
    const can = await canControlTimers(user.nick, section)
    if (!can && user.role !== 'admin') return socket.emit('timerError', 'Brak aktywnego slotu dla tej sekcji')
    startGig(id)
  })
  socket.on('stop', async id => {
    const user = getUser()
    if (!user) return
    const section = id.startsWith('KGD_') ? 'bottom' : 'top'
    const can = await canControlTimers(user.nick, section)
    if (!can && user.role !== 'admin') return socket.emit('timerError', 'Brak aktywnego slotu')
    stopGig(id)
  })
  socket.on('reset', async id => {
    const user = getUser()
    if (!user) return
    const section = id.startsWith('KGD_') ? 'bottom' : 'top'
    const can = await canControlTimers(user.nick, section)
    if (!can && user.role !== 'admin') return socket.emit('timerError', 'Brak aktywnego slotu')
    resetGig(id)
  })

  /* ── Who is playing ── */
  socket.on('gigWhoSet', ({ section, who, until }) => {
    if (section !== 'top' && section !== 'bottom') return
    gigWho[section] = { nick: String(who).slice(0,40), until: String(until||'').slice(0,5) }
    saveData(); io.emit('gigWhoUpdate', gigWho)
  })
  socket.on('gigWhoClear', ({ section }) => {
    gigWho[section] = null; saveData(); io.emit('gigWhoUpdate', gigWho)
  })

  /* ── Queue ── */
  socket.on('gigQueueJoin', ({ section, nick, until }) => {
    if (!gigQueue[section]) gigQueue[section] = []
    if (gigQueue[section].find(e => e.nick === nick)) return
    if (gigQueue[section].length >= 8) return
    gigQueue[section].push({ nick: String(nick).slice(0,40), until: String(until||'').slice(0,5), joinedAt: Date.now() })
    saveData(); io.emit('gigQueueUpdate', gigQueue)
  })
  socket.on('gigQueueLeave', ({ section, nick }) => {
    gigQueue[section] = (gigQueue[section]||[]).filter(e => e.nick !== nick)
    saveData(); io.emit('gigQueueUpdate', gigQueue)
  })
  socket.on('gigQueueClear', ({ section }) => {
    gigQueue[section] = []; saveData(); io.emit('gigQueueUpdate', gigQueue)
  })

  /* ── Grota ── */
  socket.on('grotaAddGeneral', data => {
    const id = 'gen_'+Date.now()+'_'+Math.random().toString(36).slice(2,6)
    grotaGenerals[id] = { id, x:data.x, y:data.y, ch:data.ch, foundAt:Date.now() }
    saveData(); io.emit('grotaGeneralsUpdate', grotaGenerals)
  })
  socket.on('grotaKillGeneral', id => {
    const gen = grotaGenerals[id]; if(!gen) return
    delete grotaGenerals[id]
    const kid = 'killed_'+Date.now()+'_'+Math.random().toString(36).slice(2,6)
    grotaKilledGenerals[kid] = { id:kid, ch:gen.ch, x:gen.x, y:gen.y, killedAt:Date.now() }
    saveData(); io.emit('grotaGeneralsUpdate', grotaGenerals); io.emit('grotaKilledGeneralsUpdate', grotaKilledGenerals)
  })
  socket.on('grotaRemoveKilled', id => {
    delete grotaKilledGenerals[id]; saveData(); io.emit('grotaKilledGeneralsUpdate', grotaKilledGenerals)
  })
  socket.on('grotaRemoveGeneral', id => {
    delete grotaGenerals[id]; saveData(); io.emit('grotaGeneralsUpdate', grotaGenerals)
  })
  socket.on('grotaAddRegion', data => {
    const id = 'reg_'+Date.now()+'_'+Math.random().toString(36).slice(2,6)
    grotaRegions[id] = { id, x1:data.x1, y1:data.y1, x2:data.x2, y2:data.y2, player:data.player, guild:data.guild, addedAt:Date.now() }
    saveData(); io.emit('grotaRegionsUpdate', grotaRegions)
  })
  socket.on('grotaRemoveRegion', id => {
    delete grotaRegions[id]; saveData(); io.emit('grotaRegionsUpdate', grotaRegions)
  })
  socket.on('grotaSaveSnapshot', data => {
    const snap = { id:'snap_'+Date.now(), name:data.name||'Snapshot', ts:Date.now(),
      generals:JSON.parse(JSON.stringify(grotaGenerals)),
      killedGenerals:JSON.parse(JSON.stringify(grotaKilledGenerals)),
      regions:JSON.parse(JSON.stringify(grotaRegions)) }
    grotaSnapshots.unshift(snap)
    if(grotaSnapshots.length>10) grotaSnapshots=grotaSnapshots.slice(0,10)
    saveData(); io.emit('grotaSnapshotsUpdate', grotaSnapshots)
  })
  socket.on('grotaLoadSnapshot', snapId => {
    const snap = grotaSnapshots.find(s=>s.id===snapId); if(!snap) return
    grotaGenerals=JSON.parse(JSON.stringify(snap.generals||{}))
    grotaKilledGenerals=JSON.parse(JSON.stringify(snap.killedGenerals||{}))
    grotaRegions=JSON.parse(JSON.stringify(snap.regions||{}))
    saveData()
    io.emit('grotaGeneralsUpdate',grotaGenerals)
    io.emit('grotaKilledGeneralsUpdate',grotaKilledGenerals)
    io.emit('grotaRegionsUpdate',grotaRegions)
  })
  socket.on('grotaDeleteSnapshot', snapId => {
    grotaSnapshots=grotaSnapshots.filter(s=>s.id!==snapId); saveData(); io.emit('grotaSnapshotsUpdate',grotaSnapshots)
  })
  socket.on('grotaClearSnapshots', () => {
    grotaSnapshots=[]; saveData(); io.emit('grotaSnapshotsUpdate',grotaSnapshots)
  })

  /* ── Send state to new client ── */
  socket.emit('chatHistory', chatMessages)
  socket.emit('update',                    getTimersSnapshot())
  socket.emit('gigWhoUpdate',              gigWho)
  socket.emit('gigQueueUpdate',            gigQueue)
  socket.emit('delegationsUpdate',         delegations)
  socket.emit('grotaGeneralsUpdate',       grotaGenerals)
  socket.emit('grotaKilledGeneralsUpdate', grotaKilledGenerals)
  socket.emit('grotaRegionsUpdate',        grotaRegions)
  socket.emit('grotaSnapshotsUpdate',      grotaSnapshots)
})

/* ═══ SHUTDOWN ═══ */
async function shutdown(sig) {
  console.log("Shutdown:", sig)
  if (saveTimer) clearTimeout(saveTimer)
  gigRunning.forEach(id => {
    if (gigTimers[id] && typeof gigTimers[id] === 'object') {
      gigTimers[id].elapsed = getTimerSeconds(id)
      gigTimers[id].running = false
      delete gigTimers[id].startedAt
    }
  })
  await saveNow()
  process.exit(0)
}
process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT",  () => shutdown("SIGINT"))

/* ═══ START ═══ */
function startServer() {
  const toResume = [...gigRunning]
  gigRunning.clear()
  toResume.forEach(id => { startGig(id); console.log("Resumed:", id) })
  const PORT = process.env.PORT || 3000
  http.listen(PORT, "0.0.0.0", () => console.log("✅ Port", PORT))
}

const dbTimeout = setTimeout(() => { console.warn("⚠ DB timeout"); startServer() }, 15000)
connectDB().then(() => { clearTimeout(dbTimeout); startServer() })
           .catch(err => { clearTimeout(dbTimeout); console.error("DB error:", err.message); startServer() })

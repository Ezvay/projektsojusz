const express         = require("express")
const app             = express()
const http            = require("http").createServer(app)
const io              = require("socket.io")(http)
const { MongoClient } = require("mongodb")
const path            = require("path")

const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://kawulokdarek8_db_user:6SJushejd5pUueBo@projektsojusz.cxl68tz.mongodb.net/?appName=ProjektSojusz"
const DB_NAME   = "projektsojusz"
const COL_NAME  = "state"
const DOC_ID    = "main"

/* ═══ STATE ═══ */
let grotaGenerals       = {}
let grotaKilledGenerals = {}
let grotaRegions        = {}
let grotaSnapshots      = []
let gigTimers           = {}
let gigRunning          = new Set()
let gigWho              = { top: '', bottom: '' }

/* ═══ MONGODB ═══ */
let col = null

async function connectDB() {
  const client = new MongoClient(MONGO_URI)
  await client.connect()
  const db = client.db(DB_NAME)
  col = db.collection(COL_NAME)
  console.log("✅ Połączono z MongoDB")

  const doc = await col.findOne({ _id: DOC_ID })
  if (doc) {
    grotaGenerals       = doc.grotaGenerals       || {}
    grotaKilledGenerals = doc.grotaKilledGenerals || {}
    grotaRegions        = doc.grotaRegions        || {}
    grotaSnapshots      = doc.grotaSnapshots      || []
    gigTimers           = doc.gigTimers           || {}
    gigRunning          = new Set(doc.gigRunning  || [])
    gigWho              = doc.gigWho              || { top:'', bottom:'' }

    // Wyczyść zabitych generałów starszych niż 9h
    const cutoff = Date.now() - 9*60*60*1000
    Object.keys(grotaKilledGenerals).forEach(id => {
      if (grotaKilledGenerals[id].killedAt < cutoff) delete grotaKilledGenerals[id]
    })

    // Nadrabiaj czas przestoju dla uruchomionych timerów gigantów
    if (doc.shutdownAt && gigRunning.size > 0) {
      const elapsed = Math.floor((Date.now() - doc.shutdownAt) / 1000)
      if (elapsed > 0 && elapsed < 7200) {
        gigRunning.forEach(id => { if (gigTimers[id] !== undefined) gigTimers[id] += elapsed })
        console.log(`Nadrobiono ${elapsed}s przestoju`)
      }
    }
    console.log("✅ Dane wczytane z MongoDB")
  } else {
    console.log("Brak dokumentu — start od zera")
  }
}

let saveTimer = null
async function saveNow() {
  if (!col) return
  try {
    await col.replaceOne(
      { _id: DOC_ID },
      {
        _id: DOC_ID,
        grotaGenerals, grotaKilledGenerals, grotaRegions, grotaSnapshots,
        gigTimers, gigRunning: [...gigRunning], gigWho,
        savedAt: Date.now()
      },
      { upsert: true }
    )
  } catch(e) { console.error("Błąd zapisu:", e.message) }
}
function saveData() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveNow, 500)
}

/* ═══ SERWER STATYCZNY ═══ */
app.use(express.static(path.join(__dirname, "public")))

/* ═══ CZYSTE URLe ═══ */
app.get('/grota',   (req,res) => res.redirect(301, '/grota.html'))
app.get('/giganty', (req,res) => res.redirect(301, '/giganty.html'))

/* ═══ GIGANTY TIMER ENGINE ═══ */
const gigIntervals = {}

function startGig(id) {
  if (gigIntervals[id]) return
  if (gigTimers[id] === undefined) gigTimers[id] = 0
  gigRunning.add(id)
  gigIntervals[id] = setInterval(() => {
    gigTimers[id]++
    saveData()
    io.emit('update', gigTimers)
  }, 1000)
}
function stopGig(id) {
  clearInterval(gigIntervals[id])
  delete gigIntervals[id]
  gigRunning.delete(id)
  saveData()
}
function resetGig(id) {
  gigTimers[id] = 0
  stopGig(id)
  saveData()
  io.emit('update', gigTimers)
}

/* ═══ SOCKET.IO ═══ */
io.on("connection", socket => {
  console.log("Połączenie:", socket.id)

  // ── Giganty timery ──
  socket.on('start', id => startGig(id))
  socket.on('stop',  id => stopGig(id))
  socket.on('reset', id => resetGig(id))

  // ── Kto bije górę/dół ──
  socket.on('gigWhoSet', ({ section, who }) => {
    if (section !== 'top' && section !== 'bottom') return
    gigWho[section] = String(who).slice(0, 60)
    saveData()
    io.emit('gigWhoUpdate', gigWho)
  })
  socket.on('gigWhoClear', ({ section }) => {
    if (section !== 'top' && section !== 'bottom') return
    gigWho[section] = ''
    saveData()
    io.emit('gigWhoUpdate', gigWho)
  })

  // ── Grota generałowie ──
  socket.on('grotaAddGeneral', data => {
    const id = 'gen_' + Date.now() + '_' + Math.random().toString(36).slice(2,6)
    grotaGenerals[id] = { id, x: data.x, y: data.y, ch: data.ch, foundAt: Date.now() }
    saveData()
    io.emit('grotaGeneralsUpdate', grotaGenerals)
  })
  socket.on('grotaKillGeneral', id => {
    const gen = grotaGenerals[id]; if (!gen) return
    delete grotaGenerals[id]
    const kid = 'killed_' + Date.now() + '_' + Math.random().toString(36).slice(2,6)
    grotaKilledGenerals[kid] = { id: kid, ch: gen.ch, x: gen.x, y: gen.y, killedAt: Date.now() }
    saveData()
    io.emit('grotaGeneralsUpdate', grotaGenerals)
    io.emit('grotaKilledGeneralsUpdate', grotaKilledGenerals)
  })
  socket.on('grotaRemoveKilled', id => {
    delete grotaKilledGenerals[id]
    saveData()
    io.emit('grotaKilledGeneralsUpdate', grotaKilledGenerals)
  })
  socket.on('grotaRemoveGeneral', id => {
    delete grotaGenerals[id]
    saveData()
    io.emit('grotaGeneralsUpdate', grotaGenerals)
  })

  // ── Grota regiony ──
  socket.on('grotaAddRegion', data => {
    const id = 'reg_' + Date.now() + '_' + Math.random().toString(36).slice(2,6)
    grotaRegions[id] = { id, x1: data.x1, y1: data.y1, x2: data.x2, y2: data.y2, player: data.player, guild: data.guild, addedAt: Date.now() }
    saveData()
    io.emit('grotaRegionsUpdate', grotaRegions)
  })
  socket.on('grotaRemoveRegion', id => {
    delete grotaRegions[id]
    saveData()
    io.emit('grotaRegionsUpdate', grotaRegions)
  })

  // ── Grota snapshoty ──
  socket.on('grotaSaveSnapshot', data => {
    const snap = {
      id: 'snap_' + Date.now(), name: data.name || 'Snapshot', ts: Date.now(),
      generals:       JSON.parse(JSON.stringify(grotaGenerals)),
      killedGenerals: JSON.parse(JSON.stringify(grotaKilledGenerals)),
      regions:        JSON.parse(JSON.stringify(grotaRegions))
    }
    grotaSnapshots.unshift(snap)
    if (grotaSnapshots.length > 10) grotaSnapshots = grotaSnapshots.slice(0, 10)
    saveData()
    io.emit('grotaSnapshotsUpdate', grotaSnapshots)
  })
  socket.on('grotaLoadSnapshot', snapId => {
    const snap = grotaSnapshots.find(s => s.id === snapId); if (!snap) return
    grotaGenerals       = JSON.parse(JSON.stringify(snap.generals       || {}))
    grotaKilledGenerals = JSON.parse(JSON.stringify(snap.killedGenerals || {}))
    grotaRegions        = JSON.parse(JSON.stringify(snap.regions        || {}))
    saveData()
    io.emit('grotaGeneralsUpdate',        grotaGenerals)
    io.emit('grotaKilledGeneralsUpdate',  grotaKilledGenerals)
    io.emit('grotaRegionsUpdate',         grotaRegions)
  })
  socket.on('grotaDeleteSnapshot', snapId => {
    grotaSnapshots = grotaSnapshots.filter(s => s.id !== snapId)
    saveData()
    io.emit('grotaSnapshotsUpdate', grotaSnapshots)
  })
  socket.on('grotaClearSnapshots', () => {
    grotaSnapshots = []
    saveData()
    io.emit('grotaSnapshotsUpdate', grotaSnapshots)
  })

  // ── Wyślij stan nowemu klientowi ──
  socket.emit('update',                    gigTimers)
  socket.emit('gigWhoUpdate',              gigWho)
  socket.emit('grotaGeneralsUpdate',       grotaGenerals)
  socket.emit('grotaKilledGeneralsUpdate', grotaKilledGenerals)
  socket.emit('grotaRegionsUpdate',        grotaRegions)
  socket.emit('grotaSnapshotsUpdate',      grotaSnapshots)
})

/* ═══ GRACEFUL SHUTDOWN ═══ */
async function shutdown(sig) {
  console.log(`Zamykanie (${sig}) — zapisuję...`)
  if (saveTimer) clearTimeout(saveTimer)
  // Zapisz timestamp zamknięcia żeby nadrobić czas po restarcie
  if (col) {
    try {
      await col.updateOne({ _id: DOC_ID }, { $set: { shutdownAt: Date.now() } })
    } catch(e) {}
  }
  await saveNow()
  console.log("Dane zapisane. Do widzenia!")
  process.exit(0)
}
process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT",  () => shutdown("SIGINT"))

/* ═══ START ═══ */
connectDB().then(() => {
  // Wznów timery gigantów które działały przed restartem
  gigRunning.forEach(id => { startGig(id); console.log("Wznowiono timer:", id) })

  const PORT = process.env.PORT || 3000
  http.listen(PORT, "0.0.0.0", () => console.log(`✅ Serwer na porcie ${PORT}`))
}).catch(err => {
  console.error("❌ Błąd połączenia z MongoDB:", err.message)
  process.exit(1)
})

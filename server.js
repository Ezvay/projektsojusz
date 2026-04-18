const express    = require("express")
const app        = express()
const http       = require("http").createServer(app)
const io         = require("socket.io")(http)
const fs         = require("fs")
const path       = require("path")

/* ======================
   PLIK DANYCH
   Render.com darmowy plan nie ma persistent dysku,
   więc zapisujemy obok server.js (w /opt/render/project/src/)
   Dane przeżywają restarty ale NIE nowych deployów.
   To wystarczy do normalnego użytkowania.
====================== */

const DATA_FILE = path.join(__dirname, "state.json")

/* ======================
   STAN W PAMIĘCI
====================== */

let grotaPings       = {}
let grotaHistory     = []
let grotaGenerals    = {}
let grotaSnapshots   = []
let grotaDeadHistory = []

/* ======================
   ODCZYT PLIKU
====================== */

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      console.log("Brak pliku state.json — start od zera")
      return
    }
    const raw = fs.readFileSync(DATA_FILE, "utf8")
    const doc = JSON.parse(raw)
    grotaPings       = doc.grotaPings       || {}
    grotaHistory     = doc.grotaHistory     || []
    grotaGenerals    = doc.grotaGenerals    || {}
    grotaSnapshots   = doc.grotaSnapshots   || []
    grotaDeadHistory = (doc.grotaDeadHistory || [])
      .filter(d => Date.now() - d.killedAt < 35 * 60 * 1000)
    console.log("Dane wczytane z:", DATA_FILE)
  } catch (e) {
    console.error("Błąd odczytu — start od zera:", e.message)
  }
}

/* ======================
   ZAPIS PLIKU (debounced)
====================== */

let saveTimer = null
function saveData() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(writeNow, 500)
}

function writeNow() {
  try {
    const payload = {
      grotaPings, grotaHistory, grotaGenerals,
      grotaSnapshots, grotaDeadHistory,
      savedAt: Date.now()
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2), "utf8")
  } catch (e) {
    console.error("Błąd zapisu:", e.message)
  }
}

// Wczytaj dane przy starcie
loadData()

/* ======================
   SERWER STATYCZNY
====================== */

app.use(express.static(path.join(__dirname, "public")))

/* ======================
   SOCKET.IO
====================== */

io.on("connection", (socket) => {
  console.log("Nowe połączenie:", socket.id)

  /* ─── Metiny ─── */
  socket.on("grotaAddPing", (data) => {
    const id = "g_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6)
    grotaPings[id] = { id, x: data.x, y: data.y, ch: data.ch, startedAt: Date.now() }
    grotaHistory.push({ x: data.x, y: data.y, ts: Date.now() })
    if (grotaHistory.length > 2000) grotaHistory = grotaHistory.slice(-2000)
    saveData()
    io.emit("grotaPingsUpdate",   grotaPings)
    io.emit("grotaHistoryUpdate", grotaHistory)
  })

  socket.on("grotaRemovePing", (id) => {
    delete grotaPings[id]
    saveData()
    io.emit("grotaPingsUpdate", grotaPings)
  })

  /* ─── Dead history ─── */
  socket.on("grotaAddDead", (dead) => {
    if (!dead || !dead.id) return
    grotaDeadHistory.push(dead)
    grotaDeadHistory = grotaDeadHistory
      .filter(d => Date.now() - d.killedAt < 35 * 60 * 1000)
    io.emit("grotaDeadHistoryUpdate", grotaDeadHistory)
    saveData()
  })

  socket.on("grotaRemoveDead", (id) => {
    grotaDeadHistory = grotaDeadHistory.filter(d => d.id !== id)
    io.emit("grotaDeadHistoryUpdate", grotaDeadHistory)
    saveData()
  })

  /* ─── Generałowie ─── */
  socket.on("grotaAddGeneral", (data) => {
    const id = "gen_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6)
    grotaGenerals[id] = { id, x: data.x, y: data.y, ch: data.ch, startedAt: Date.now() }
    saveData()
    io.emit("grotaGeneralsUpdate", grotaGenerals)
  })

  socket.on("grotaRemoveGeneral", (id) => {
    delete grotaGenerals[id]
    saveData()
    io.emit("grotaGeneralsUpdate", grotaGenerals)
  })

  /* ─── Snapshoty ─── */
  socket.on("grotaSaveSnapshot", (data) => {
    const snap = {
      id:       "snap_" + Date.now(),
      name:     data.name || "Snapshot",
      ts:       Date.now(),
      pings:    JSON.parse(JSON.stringify(grotaPings)),
      generals: JSON.parse(JSON.stringify(grotaGenerals))
    }
    grotaSnapshots.unshift(snap)
    if (grotaSnapshots.length > 10) grotaSnapshots = grotaSnapshots.slice(0, 10)
    saveData()
    io.emit("grotaSnapshotsUpdate", grotaSnapshots)
  })

  socket.on("grotaLoadSnapshot", (snapId) => {
    const snap = grotaSnapshots.find(s => s.id === snapId)
    if (!snap) return
    grotaPings    = JSON.parse(JSON.stringify(snap.pings))
    grotaGenerals = JSON.parse(JSON.stringify(snap.generals))
    saveData()
    io.emit("grotaPingsUpdate",    grotaPings)
    io.emit("grotaGeneralsUpdate", grotaGenerals)
  })

  socket.on("grotaDeleteSnapshot", (snapId) => {
    grotaSnapshots = grotaSnapshots.filter(s => s.id !== snapId)
    saveData()
    io.emit("grotaSnapshotsUpdate", grotaSnapshots)
  })

  socket.on("grotaResetHistory", () => {
    grotaHistory = []
    io.emit("grotaHistoryUpdate", grotaHistory)
    saveData()
  })

  socket.on("grotaClearSnapshots", () => {
    grotaSnapshots = []
    io.emit("grotaSnapshotsUpdate", grotaSnapshots)
    saveData()
  })

  /* ─── Wyślij stan nowemu klientowi ─── */
  socket.emit("grotaPingsUpdate",    grotaPings)
  socket.emit("grotaHistoryUpdate",  grotaHistory)
  socket.emit("grotaGeneralsUpdate", grotaGenerals)
  socket.emit("grotaSnapshotsUpdate",grotaSnapshots)
  socket.emit("grotaDeadHistoryUpdate",
    grotaDeadHistory.filter(d => Date.now() - d.killedAt < 35 * 60 * 1000)
  )
})

/* ======================
   GRACEFUL SHUTDOWN
====================== */

function shutdown(signal) {
  console.log(`Zamykanie (${signal}) — zapisuję...`)
  if (saveTimer) clearTimeout(saveTimer)
  writeNow()
  console.log("Zapisano. Do widzenia!")
  process.exit(0)
}
process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT",  () => shutdown("SIGINT"))

/* ======================
   START
====================== */

const PORT = process.env.PORT || 3000
http.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Serwer działa na porcie ${PORT}`)
})

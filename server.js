const express    = require("express")
const app        = express()
const http       = require("http").createServer(app)
const io         = require("socket.io")(http)
const fs         = require("fs")
const path       = require("path")

/* ======================
   PLIK DANYCH
====================== */

// Na Render.com z dyskiem montujemy /data, lokalnie używamy katalogu projektu
const DATA_DIR  = process.env.DATA_DIR || path.join(__dirname, "data")
const DATA_FILE = path.join(DATA_DIR, "state.json")

// Utwórz folder jeśli nie istnieje
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

/* ======================
   STAN W PAMIĘCI
====================== */

let grotaPings       = {}
let grotaHistory     = []
let grotaGenerals    = {}
let grotaSnapshots   = []
let grotaDeadHistory = []

/* ======================
   ODCZYT / ZAPIS PLIKU
====================== */

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return
    const raw  = fs.readFileSync(DATA_FILE, "utf8")
    const doc  = JSON.parse(raw)
    grotaPings       = doc.grotaPings       || {}
    grotaHistory     = doc.grotaHistory     || []
    grotaGenerals    = doc.grotaGenerals    || {}
    grotaSnapshots   = doc.grotaSnapshots   || []
    // Odfiltruj wygasłe dead (>35min)
    grotaDeadHistory = (doc.grotaDeadHistory || [])
      .filter(d => Date.now() - d.killedAt < 35 * 60 * 1000)
    console.log("Dane wczytane z pliku:", DATA_FILE)
  } catch (e) {
    console.error("Błąd odczytu danych:", e.message)
  }
}

let saveTimer = null
function saveData() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      const payload = JSON.stringify({
        grotaPings, grotaHistory, grotaGenerals,
        grotaSnapshots, grotaDeadHistory,
        savedAt: Date.now()
      }, null, 2)
      fs.writeFileSync(DATA_FILE, payload, "utf8")
    } catch (e) {
      console.error("Błąd zapisu:", e.message)
    }
  }, 500)
}

// Wczytaj dane przy starcie
loadData()

/* ======================
   SERWER STATYCZNY
====================== */

app.use(express.static("public"))

/* ======================
   SOCKET.IO
====================== */

io.on("connection", (socket) => {

  /* ─── Grota — Metiny ─── */
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

  /* ─── Grota — Dead history ─── */
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

  /* ─── Grota — Generałowie ─── */
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

  /* ─── Grota — Snapshoty ─── */
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
  const freshDead = grotaDeadHistory
    .filter(d => Date.now() - d.killedAt < 35 * 60 * 1000)
  socket.emit("grotaDeadHistoryUpdate", freshDead)
})

/* ======================
   GRACEFUL SHUTDOWN
====================== */

function shutdown(signal) {
  console.log(`Zamykanie (${signal}) — zapisuję dane...`)
  if (saveTimer) {
    clearTimeout(saveTimer)
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify({
        grotaPings, grotaHistory, grotaGenerals,
        grotaSnapshots, grotaDeadHistory,
        savedAt: Date.now()
      }, null, 2), "utf8")
      console.log("Dane zapisane.")
    } catch (e) {
      console.error("Błąd zapisu przy zamknięciu:", e.message)
    }
  }
  process.exit(0)
}
process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT",  () => shutdown("SIGINT"))

/* ======================
   START
====================== */

const PORT = process.env.PORT || 3000
http.listen(PORT, () => {
  console.log(`Serwer działa na porcie ${PORT}`)
  console.log(`Plik danych: ${DATA_FILE}`)
})

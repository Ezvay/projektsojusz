const express    = require("express")
const app        = express()
const http       = require("http").createServer(app)
const io         = require("socket.io")(http)
const fs         = require("fs")
const path       = require("path")

const DATA_FILE = path.join(__dirname, "state.json")

let grotaGenerals    = {}
let grotaRegions     = {}
let grotaSnapshots   = []

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return
    const doc = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"))
    grotaGenerals    = doc.grotaGenerals    || {}
    grotaRegions     = doc.grotaRegions     || {}
    grotaSnapshots   = doc.grotaSnapshots   || []
    console.log("Dane wczytane z:", DATA_FILE)
  } catch (e) { console.error("Błąd odczytu:", e.message) }
}

let saveTimer = null
function saveData() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(writeNow, 500)
}
function writeNow() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ grotaGenerals, grotaRegions, grotaSnapshots, savedAt: Date.now() }, null, 2), "utf8")
  } catch (e) { console.error("Błąd zapisu:", e.message) }
}

loadData()
app.use(express.static(path.join(__dirname, "public")))

io.on("connection", (socket) => {
  console.log("Połączenie:", socket.id)

  /* ── Generałowie ── */
  socket.on("grotaAddGeneral", (data) => {
    const id = "gen_" + Date.now() + "_" + Math.random().toString(36).slice(2,6)
    grotaGenerals[id] = { id, x: data.x, y: data.y, ch: data.ch, startedAt: Date.now() }
    saveData()
    io.emit("grotaGeneralsUpdate", grotaGenerals)
  })
  socket.on("grotaRemoveGeneral", (id) => {
    delete grotaGenerals[id]
    saveData()
    io.emit("grotaGeneralsUpdate", grotaGenerals)
  })

  /* ── Regiony metinów ── */
  socket.on("grotaAddRegion", (data) => {
    const id = "reg_" + Date.now() + "_" + Math.random().toString(36).slice(2,6)
    grotaRegions[id] = { id, x1: data.x1, y1: data.y1, x2: data.x2, y2: data.y2, player: data.player, guild: data.guild, addedAt: Date.now() }
    saveData()
    io.emit("grotaRegionsUpdate", grotaRegions)
  })
  socket.on("grotaRemoveRegion", (id) => {
    delete grotaRegions[id]
    saveData()
    io.emit("grotaRegionsUpdate", grotaRegions)
  })

  /* ── Snapshoty ── */
  socket.on("grotaSaveSnapshot", (data) => {
    const snap = { id: "snap_"+Date.now(), name: data.name||"Snapshot", ts: Date.now(), generals: JSON.parse(JSON.stringify(grotaGenerals)), regions: JSON.parse(JSON.stringify(grotaRegions)) }
    grotaSnapshots.unshift(snap)
    if (grotaSnapshots.length > 10) grotaSnapshots = grotaSnapshots.slice(0,10)
    saveData()
    io.emit("grotaSnapshotsUpdate", grotaSnapshots)
  })
  socket.on("grotaLoadSnapshot", (snapId) => {
    const snap = grotaSnapshots.find(s => s.id === snapId)
    if (!snap) return
    grotaGenerals = JSON.parse(JSON.stringify(snap.generals||{}))
    grotaRegions  = JSON.parse(JSON.stringify(snap.regions||{}))
    saveData()
    io.emit("grotaGeneralsUpdate", grotaGenerals)
    io.emit("grotaRegionsUpdate",  grotaRegions)
  })
  socket.on("grotaDeleteSnapshot", (snapId) => {
    grotaSnapshots = grotaSnapshots.filter(s => s.id !== snapId)
    saveData()
    io.emit("grotaSnapshotsUpdate", grotaSnapshots)
  })
  socket.on("grotaClearSnapshots", () => {
    grotaSnapshots = []
    saveData()
    io.emit("grotaSnapshotsUpdate", grotaSnapshots)
  })

  /* ── Stan dla nowego klienta ── */
  socket.emit("grotaGeneralsUpdate", grotaGenerals)
  socket.emit("grotaRegionsUpdate",  grotaRegions)
  socket.emit("grotaSnapshotsUpdate",grotaSnapshots)
})

function shutdown(sig) {
  console.log("Zamykanie —", sig)
  if (saveTimer) clearTimeout(saveTimer)
  writeNow()
  process.exit(0)
}
process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT",  () => shutdown("SIGINT"))

const PORT = process.env.PORT || 3000
http.listen(PORT, "0.0.0.0", () => console.log("✅ Serwer na porcie", PORT))

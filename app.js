const micBtn     = document.getElementById("mic-btn");
const statusEl   = document.getElementById("status");
const transcript = document.getElementById("transcript");

let ws          = null;
let audioCtx    = null;
let mediaStream = null;
let workletNode = null;
let isConnected = false;
let isBusy      = false;
let isHolding   = false;
let heldChunks  = [];

const SAMPLE_RATE = 16000;

// --- UI ---

function setStatus(text) { statusEl.textContent = text; }

function addMessage(role, text, action) {
  const el = document.createElement("div");
  el.className = `message ${role}`;
  if (action === "clarify") el.classList.add("clarify");
  el.textContent = text;
  transcript.appendChild(el);
  transcript.scrollTop = transcript.scrollHeight;
  return el;
}

function addRoutedCard(department, departmentLabel, summary) {
  const el = document.createElement("div");
  el.className = "message routed";
  el.innerHTML = `<span class="routed-icon">✓</span><strong>${departmentLabel}</strong><br><span class="routed-summary">${summary}</span>`;
  transcript.appendChild(el);
  transcript.scrollTop = transcript.scrollHeight;
}

// --- Audio context ---

function ensureAudioContext() {
  if (!audioCtx || audioCtx.state === "closed") {
    audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
}

// --- WAV playback ---

function decodeWav(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const numChannels   = view.getUint16(22, true);
  const sampleRate    = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);

  let dataOffset = 44;
  for (let i = 12; i < Math.min(arrayBuffer.byteLength - 8, 200); i += 4) {
    const id = String.fromCharCode(
      view.getUint8(i), view.getUint8(i+1), view.getUint8(i+2), view.getUint8(i+3)
    );
    if (id === "data") { dataOffset = i + 8; break; }
  }

  const raw     = new DataView(arrayBuffer, dataOffset);
  const samples = (arrayBuffer.byteLength - dataOffset) / (bitsPerSample / 8);
  const float32 = new Float32Array(samples);

  if (bitsPerSample === 16) {
    for (let i = 0; i < samples; i++) float32[i] = raw.getInt16(i * 2, true) / 32768;
  } else if (bitsPerSample === 8) {
    for (let i = 0; i < samples; i++) float32[i] = (raw.getUint8(i) - 128) / 128;
  }

  return { sampleRate, numChannels, float32 };
}

async function playWav(b64) {
  ensureAudioContext();
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const { sampleRate, numChannels, float32 } = decodeWav(bytes.buffer);
  const samplesPerCh = float32.length / numChannels;
  const buffer = audioCtx.createBuffer(numChannels, samplesPerCh, sampleRate);

  for (let ch = 0; ch < numChannels; ch++) {
    const chan = buffer.getChannelData(ch);
    for (let i = 0; i < samplesPerCh; i++) chan[i] = float32[i * numChannels + ch];
  }

  micBtn.classList.add("speaking");
  micBtn.classList.remove("listening");
  setStatus("Хариулж байна...");

  return new Promise((resolve) => {
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.onended = resolve;
    source.start();
  });
}

// --- PCM helpers ---

function float32ToInt16(float32) {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 32768 : s * 32767;
  }
  return int16;
}

function int16ToBase64(int16) {
  const bytes = new Uint8Array(int16.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// --- Mic setup (always-on while connected, collect only while holding) ---

async function startMic() {
  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  ensureAudioContext();
  await audioCtx.audioWorklet.addModule("pcm-processor.js");

  const source = audioCtx.createMediaStreamSource(mediaStream);
  workletNode  = new AudioWorkletNode(audioCtx, "pcm-processor");

  workletNode.port.onmessage = (e) => {
    if (!isHolding) return;

    let samples = e.data;
    if (audioCtx.sampleRate !== SAMPLE_RATE) {
      const ratio     = audioCtx.sampleRate / SAMPLE_RATE;
      const newLen    = Math.round(samples.length / ratio);
      const resampled = new Float32Array(newLen);
      for (let i = 0; i < newLen; i++) resampled[i] = samples[Math.round(i * ratio)];
      samples = resampled;
    }
    heldChunks.push(samples);
  };

  source.connect(workletNode);
  workletNode.connect(audioCtx.destination);
}

function stopMic() {
  if (workletNode) { workletNode.disconnect(); workletNode = null; }
  if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
}

// --- Send collected audio ---

function sendHeldAudio() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (heldChunks.length === 0) return;

  const totalLen = heldChunks.reduce((s, c) => s + c.length, 0);
  
  // FIX: If the recording is less than 0.3 seconds, it was an accidental quick click.
  // Ignore it completely so we don't lock the UI or spam the server.
  if (totalLen < SAMPLE_RATE * 0.3) {
    heldChunks = [];
    setStatus("Товч дарж ярина уу");
    return;
  }

  const combined = new Float32Array(totalLen);
  let offset = 0;
  for (const c of heldChunks) { combined.set(c, offset); offset += c.length; }
  heldChunks = [];

  isBusy = true;
  setStatus("Боловсруулж байна...");

  const int16 = float32ToInt16(combined);
  ws.send(JSON.stringify({ type: "audio", audio: int16ToBase64(int16) }));
}

// --- WebSocket ---

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const host = (location.hostname === "localhost" || location.hostname === "127.0.0.1")
    ? "localhost:3000"
    : "ub-voice-assistant-backend.onrender.com"; // <--- Updated with your live Render URL (no https:// prefix)

  ws = new WebSocket(`${proto}://${host}/ws`);

  ws.onopen = async () => {
    isConnected = true;
    await startMic();
    micBtn.classList.remove("listening", "speaking");
    setStatus("Товч дарж ярина уу");
  };

  ws.onmessage = async (event) => {
    const msg = JSON.parse(event.data);
    await handleServerMessage(msg);
  };

  ws.onerror = () => { setStatus("Алдаа гарлаа."); cleanup(); };
  ws.onclose = () => { cleanup(); };
}

function disconnect() {
  if (ws) { ws.close(); ws = null; }
  cleanup();
}

function cleanup() {
  isConnected = false;
  isBusy      = false;
  isHolding   = false;
  heldChunks  = [];
  stopMic();
  if (audioCtx && audioCtx.state !== "closed") { audioCtx.close(); audioCtx = null; }
  micBtn.classList.remove("listening", "speaking");
  setStatus("Товч дарж ярина уу");
}

// --- Server messages ---

async function handleServerMessage(msg) {
  switch (msg.type) {
    case "status":
      setStatus(msg.text);
      // FIX: Unlock the UI if the server failed STT or rejected short audio
      // without triggering an "audio" or "error" event.
      if (msg.text.includes("Дахин оролдоно уу")) {
        isBusy = false;
        micBtn.classList.remove("speaking");
      }
      break;
    case "transcript":
      addMessage(msg.role, msg.text, msg.action);
      break;
    case "routed":
      addRoutedCard(msg.department, msg.departmentLabel, msg.summary);
      break;
    case "audio":
      await playWav(msg.audio);
      isBusy = false;
      micBtn.classList.remove("speaking");
      setStatus("Товч дарж ярина уу");
      break;
    case "error":
      console.error("Server error:", msg.message);
      setStatus(`Алдаа: ${msg.message}`);
      isBusy = false;
      break;
  }
}

// --- Push-to-talk button events ---

function onPressStart(e) {
  e.preventDefault();
  if (!isConnected || isBusy) return;
  isHolding  = true;
  heldChunks = [];
  micBtn.classList.add("listening");
  setStatus("Ярж байна...");
}

function onPressEnd(e) {
  e.preventDefault();
  if (!isHolding) return;
  isHolding = false;
  micBtn.classList.remove("listening");
  sendHeldAudio();
}

// Auto-connect on load
connect();

// Mouse
micBtn.addEventListener("mousedown", onPressStart);
micBtn.addEventListener("mouseup",   onPressEnd);
micBtn.addEventListener("mouseleave", onPressEnd);

// Touch
micBtn.addEventListener("touchstart", onPressStart, { passive: false });
micBtn.addEventListener("touchend",   onPressEnd,   { passive: false });
micBtn.addEventListener("touchcancel", onPressEnd,  { passive: false });

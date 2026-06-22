import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const CHIMEGE_STT_TOKEN = process.env.CHIMEGE_STT_TOKEN;
const CHIMEGE_TTS_TOKEN = process.env.CHIMEGE_TTS_TOKEN;
const EGUNE_API_KEY     = process.env.EGUNE_API_KEY;

if (!CHIMEGE_STT_TOKEN) { console.error("Missing CHIMEGE_STT_TOKEN"); process.exit(1); }
if (!CHIMEGE_TTS_TOKEN) { console.error("Missing CHIMEGE_TTS_TOKEN"); process.exit(1); }
if (!EGUNE_API_KEY)     { console.error("Missing EGUNE_API_KEY");     process.exit(1); }

const CHIMEGE_STT_URL = "https://api.chimege.com/v1.2/transcribe";
const CHIMEGE_TTS_URL = "https://api.chimege.com/v1.2/synthesize";
const EGUNE_CHAT_URL  = "https://api.egune.com/v1/chat/completions";
const EGUNE_MODEL     = "egune-nano";
const TTS_VOICE       = "FEMALE3v2";
const TTS_SAMPLE_RATE = 16000;

const SYSTEM_PROMPT = `Та монгол хэлний AI туслах юм. Зөвхөн монгол хэлээр ярина уу. Ямар ч нөхцөлд өөр хэлээр хариулж болохгүй.
Хариултаа товч, тодорхой, найрсаг байлгана уу.`;

const app = express();
const server = createServer(app);

app.use(express.static(join(__dirname, "public")));

// Per-connection conversation history
function makeHistory() {
  return [{ role: "system", content: SYSTEM_PROMPT }];
}

// Build a WAV file buffer from raw PCM16 mono samples
function buildWav(pcmBuffer, sampleRate = 16000) {
  const numChannels  = 1;
  const bitsPerSample = 16;
  const byteRate     = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign   = numChannels * bitsPerSample / 8;
  const dataSize     = pcmBuffer.length;
  const buf          = Buffer.alloc(44 + dataSize);

  buf.write("RIFF",                  0);
  buf.writeUInt32LE(36 + dataSize,   4);
  buf.write("WAVE",                  8);
  buf.write("fmt ",                 12);
  buf.writeUInt32LE(16,             16); // PCM chunk size
  buf.writeUInt16LE(1,              20); // PCM format
  buf.writeUInt16LE(numChannels,    22);
  buf.writeUInt32LE(sampleRate,     24);
  buf.writeUInt32LE(byteRate,       28);
  buf.writeUInt16LE(blockAlign,     32);
  buf.writeUInt16LE(bitsPerSample,  34);
  buf.write("data",                 36);
  buf.writeUInt32LE(dataSize,       40);
  pcmBuffer.copy(buf, 44);

  return buf;
}

// STT: raw PCM16 bytes → transcript string
async function transcribe(pcmBuffer) {
  const wavBuffer = buildWav(pcmBuffer, 16000);
  const res = await fetch(CHIMEGE_STT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Token": CHIMEGE_STT_TOKEN,
      "Punctuate": "true",
    },
    body: wavBuffer,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.status);
    throw new Error(`Chimege STT ${res.status}: ${err}`);
  }
  return (await res.text()).trim();
}

// LLM: messages → assistant reply string
async function chat(history) {
  const res = await fetch(EGUNE_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${EGUNE_API_KEY}`,
    },
    body: JSON.stringify({ model: EGUNE_MODEL, messages: history }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.status);
    throw new Error(`Egune chat ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

// TTS: text → WAV Buffer
async function synthesize(text) {
  const res = await fetch(CHIMEGE_TTS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "plain/text",
      "Token": CHIMEGE_TTS_TOKEN,
      "voice-id": TTS_VOICE,
      "sample-rate": String(TTS_SAMPLE_RATE),
      "speed": "1",
    },
    body: Buffer.from(text, "utf-8"),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.status);
    throw new Error(`Chimege TTS ${res.status}: ${err}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  console.log("Client connected");
  const history = makeHistory();

  ws.on("message", async (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    if (msg.type === "audio") {
      // msg.audio: base64-encoded raw PCM16 @ 16000 Hz mono
      const pcmBuffer = Buffer.from(msg.audio, "base64");

      try {
        ws.send(JSON.stringify({ type: "status", text: "Таны яриа танигдаж байна..." }));

        const userText = await transcribe(pcmBuffer);
        if (!userText) {
          ws.send(JSON.stringify({ type: "status", text: "Дуу таних амжилтгүй. Дахин оролдоно уу." }));
          return;
        }

        ws.send(JSON.stringify({ type: "transcript", role: "user", text: userText }));
        ws.send(JSON.stringify({ type: "status", text: "Хариулт бэлдэж байна..." }));

        history.push({ role: "user", content: userText });
        const assistantText = await chat(history);
        history.push({ role: "assistant", content: assistantText });

        ws.send(JSON.stringify({ type: "transcript", role: "assistant", text: assistantText }));
        ws.send(JSON.stringify({ type: "status", text: "Дуу нийлэгжүүлж байна..." }));

        const wavBuffer = await synthesize(assistantText);
        const audioB64 = wavBuffer.toString("base64");

        ws.send(JSON.stringify({ type: "audio", audio: audioB64 }));
        ws.send(JSON.stringify({ type: "status", text: "Ярина уу..." }));
      } catch (err) {
        console.error(err);
        ws.send(JSON.stringify({ type: "error", message: err.message }));
      }
    }
  });

  ws.on("close", () => console.log("Client disconnected"));
  ws.on("error", (err) => console.error("WS error:", err.message));
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

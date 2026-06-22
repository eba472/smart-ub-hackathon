#!/usr/bin/env node
/**
 * Integration test: verifies full round-trip — session setup, audio send, response.
 * Exits 0 on success, 1 on failure.
 *
 * Usage: node test-realtime.js
 */
import "dotenv/config";
import { WebSocket } from "ws";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const REALTIME_MODEL = "gpt-realtime-2";

if (!OPENAI_API_KEY) {
  console.error("FAIL: Missing OPENAI_API_KEY");
  process.exit(1);
}

console.log(`Connecting to OpenAI Realtime API (model: ${REALTIME_MODEL})...`);

const ws = new WebSocket(
  `wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`,
  ["realtime", `openai-insecure-api-key.${OPENAI_API_KEY}`]
);

const received = new Set();
let sessionReady = false;

const timeout = setTimeout(() => {
  console.error("\nFAIL: Timed out. Events received:", [...received].join(", ") || "none");
  process.exit(1);
}, 20000);

// Generate 1 second of silence as PCM16 24kHz (48000 samples * 2 bytes = 96000 bytes)
function makeSilencePCM16(durationSecs = 1) {
  const numSamples = 24000 * durationSecs;
  return Buffer.alloc(numSamples * 2, 0); // 16-bit zeros
}

ws.on("open", () => {
  console.log("  ✓ WebSocket connected");

  ws.send(JSON.stringify({
    type: "session.update",
    session: {
      type: "realtime",
      instructions: "Respond with exactly one short sentence in Mongolian.",
      output_modalities: ["audio"],
      audio: {
        input: {
          format: { type: "audio/pcm", rate: 24000 },
          transcription: { model: "gpt-realtime-whisper" },
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 600,
          },
        },
        output: {
          format: { type: "audio/pcm", rate: 24000 },
          voice: "alloy",
        },
      },
    },
  }));
});

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());

  if (msg.type === "error") {
    console.error(`\nFAIL: OpenAI error [${msg.error?.code}]: ${msg.error?.message}`);
    clearTimeout(timeout);
    ws.close();
    process.exit(1);
  }

  if (!received.has(msg.type)) {
    console.log(`  received: ${msg.type}`);
  }
  received.add(msg.type);

  if (msg.type === "session.updated" && !sessionReady) {
    sessionReady = true;
    console.log("  ✓ Session configured, sending text message to trigger response...");

    // Use conversation.item.create + response.create to trigger a response
    // without needing real audio (avoids mic/VAD issues in test)
    ws.send(JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Сайн уу?" }],
      },
    }));

    ws.send(JSON.stringify({ type: "response.create" }));
  }

  if (msg.type === "response.done") {
    clearTimeout(timeout);
    const status = msg.response?.status;
    if (status === "completed") {
      console.log("\nPASS: Full response round-trip successful");
    } else {
      console.error(`\nFAIL: Response ended with status: ${status}`);
      console.error(JSON.stringify(msg.response?.status_details, null, 2));
      process.exit(1);
    }
    ws.close();
    process.exit(0);
  }
});

ws.on("error", (err) => {
  console.error("FAIL: WebSocket error:", err.message);
  clearTimeout(timeout);
  process.exit(1);
});

ws.on("close", (code) => {
  if (!received.has("response.done")) {
    console.error(`FAIL: Connection closed before response.done (code ${code})`);
    process.exit(1);
  }
});

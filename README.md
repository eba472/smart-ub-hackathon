# gpt-live

Push-to-talk Mongolian voice assistant powered by [Chimege](https://chimege.mn) STT/TTS and [Egune](https://platform.egune.com) LLM.

## How it works

```
Hold button → mic records → release
  → Chimege STT  (speech → Mongolian text)
  → Egune LLM    (text → text response)
  → Chimege TTS  (text → speech)
  → plays audio back
```

Each conversation turn is push-to-talk: hold the button while speaking, release to send. The assistant answers, then waits for the next press. Conversation history is kept for the duration of the session.

## Stack

| Layer | Service |
|-------|---------|
| STT | [Chimege](https://api.chimege.com/v1.2/transcribe) — Mongolian speech recognition |
| LLM | [Egune](https://api.egune.com/v1/chat/completions) — OpenAI-compatible chat |
| TTS | [Chimege](https://api.chimege.com/v1.2/synthesize) — Mongolian speech synthesis |
| Server | Node.js + Express + WebSocket (`ws`) |
| Client | Vanilla JS + Web Audio API (AudioWorklet) |

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and fill in your API keys:

```bash
cp .env.example .env
```

```env
CHIMEGE_STT_TOKEN=your_chimege_stt_token
CHIMEGE_TTS_TOKEN=your_chimege_tts_token
EGUNE_API_KEY=your_egune_api_key
PORT=3000
```

- **Chimege tokens** — get them from [console.chimege.com](https://console.chimege.com). STT and TTS use separate tokens.
- **Egune API key** — get it from [platform.egune.com](https://platform.egune.com).

### 3. Run

```bash
# development (auto-restarts on file changes)
npm run dev

# production
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

1. Click the mic button once to connect.
2. **Hold** the button and speak in Mongolian.
3. **Release** — the assistant transcribes, thinks, and replies aloud.
4. Wait for the reply to finish, then hold again for the next turn.

## Project structure

```
├── server.js           # Express + WebSocket server, orchestrates STT → LLM → TTS
├── public/
│   ├── index.html      # UI
│   ├── app.js          # Push-to-talk logic, WAV playback, WebSocket client
│   └── pcm-processor.js  # AudioWorklet — streams mic PCM to main thread
└── .env.example
```

## API details

### Chimege STT
- `POST https://api.chimege.com/v1.2/transcribe`
- Body: WAV file (PCM16, 16 kHz, mono)
- Headers: `Token`, `Punctuate: true`
- Returns: plain text transcript

### Chimege TTS
- `POST https://api.chimege.com/v1.2/synthesize`
- Body: UTF-8 plain text
- Headers: `Token`, `voice-id`, `sample-rate`, `speed`
- Returns: WAV audio file

### Egune LLM
- `POST https://api.egune.com/v1/chat/completions`
- OpenAI-compatible — model: `egune-nano`
- Headers: `Authorization: Bearer <key>`

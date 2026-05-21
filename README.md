# AI Voice Chat Test App

A small local app for testing Mistral or Claude chat completions with ElevenLabs voice output.

## What it includes

- Express backend with `POST /api/chat`
- Express backend with `POST /api/voice` (ElevenLabs text-to-speech)
- Express backend with `GET /api/voices` (loads voices from your ElevenLabs account)
- Static frontend test page at `/`
- `.env` based configuration for API keys, models, and port
- Multi-turn conversation UI that sends full chat history
- Provider selector in the UI to choose Mistral or Claude per request
- Model selector in the UI with provider-specific presets and custom override

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create your env file:
   - Copy `.env.example` to `.env`
   - Set `MISTRAL_API_KEY` to your key
   - Set `CLAUDE_API_KEY` to your Anthropic key
   - Set `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID`
3. Run in development mode:
   ```bash
   npm run dev
   ```
4. Open `http://localhost:3000`

## Build and run production

```bash
npm run build
npm run start
```

## API request shape

`POST /api/chat`

```json
{
   "provider": "mistral",
  "systemPrompt": "You are helpful.",
  "message": "Write a short hello in French.",
  "model": "mistral-small-latest",
  "temperature": 0.7
}
```

You can also send conversation history:

```json
{
   "provider": "claude",
   "model": "claude-3-5-sonnet-latest",
   "temperature": 0.7,
   "messages": [
      { "role": "system", "content": "You are a helpful assistant." },
      { "role": "user", "content": "Hello" },
      { "role": "assistant", "content": "Hi!" },
      { "role": "user", "content": "Can you summarize this project?" }
   ]
}
```

`provider` supports `mistral` and `claude`.

## Voice endpoint

`POST /api/voice`

```json
{
   "text": "Bonjour! Comment puis-je vous aider?",
   "voiceId": "optional-override",
   "modelId": "eleven_multilingual_v2"
}
```

The response is audio (`audio/mpeg`) and is automatically played by the frontend.

## Voices endpoint

`GET /api/voices`

Returns available ElevenLabs voices and the configured default voice ID for the dropdown selector in the UI.

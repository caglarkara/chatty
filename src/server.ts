import dotenv from "dotenv";
import express from "express";
import path from "path";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);
const mistralApiKey = process.env.MISTRAL_API_KEY;
const claudeApiKey = process.env.CLAUDE_API_KEY;
const defaultMistralModel = process.env.MISTRAL_MODEL || "mistral-small-latest";
const defaultClaudeModel = process.env.CLAUDE_MODEL || "claude-3-5-sonnet-latest";
const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
const defaultVoiceId = process.env.ELEVENLABS_VOICE_ID;
const defaultVoiceModel = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";
const enforcedSystemInstruction = "Keep your response below 20 words.";

app.use(express.json());
app.use(express.static(path.resolve(process.cwd(), "public")));

app.get("/api/voices", async (_req, res) => {
  if (!elevenLabsApiKey) {
    return res.status(500).json({ error: "ELEVENLABS_API_KEY is not configured." });
  }

  try {
    const response = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: {
        "xi-api-key": elevenLabsApiKey
      }
    });

    const rawBody = await response.text();
    let data: { voices?: Array<{ voice_id?: string; name?: string; category?: string }> } | null = null;

    try {
      data = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Failed to load ElevenLabs voices.",
        debug: {
          upstreamStatus: response.status,
          upstreamStatusText: response.statusText,
          upstreamHeaders: Object.fromEntries(response.headers.entries()),
          upstreamBody: data ?? rawBody
        }
      });
    }

    const voices = (data?.voices || [])
      .map(v => ({ id: v.voice_id || "", name: v.name || "Unnamed voice", category: v.category || "unknown" }))
      .filter(v => v.id);

    return res.json({
      defaultVoiceId,
      voices
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ error: `Voice list request failed: ${messageText}` });
  }
});

app.post("/api/chat", async (req, res) => {
  const { message, systemPrompt, model, temperature, messages, provider } = req.body as {
    message?: string;
    systemPrompt?: string;
    model?: string;
    temperature?: number;
    messages?: Array<{ role?: string; content?: string }>;
    provider?: string;
  };

  const selectedProvider = provider === "claude" ? "claude" : "mistral";

  const resolvedMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];

  if (Array.isArray(messages) && messages.length > 0) {
    for (const entry of messages) {
      if (!entry?.content?.trim()) {
        continue;
      }

      if (entry.role === "system" || entry.role === "user" || entry.role === "assistant") {
        resolvedMessages.push({ role: entry.role, content: entry.content.trim() });
      }
    }
  } else {
    if (systemPrompt?.trim()) {
      resolvedMessages.push({ role: "system", content: systemPrompt.trim() });
    }

    if (message?.trim()) {
      resolvedMessages.push({ role: "user", content: message.trim() });
    }
  }

  if (!resolvedMessages.some(m => m.role === "user")) {
    return res.status(400).json({ error: "At least one user message is required." });
  }

  const existingSystem = resolvedMessages.find(m => m.role === "system");
  const instructionRegex = /keep\s+your\s+response\s+below\s+20\s+words/i;
  if (!existingSystem) {
    resolvedMessages.unshift({ role: "system", content: enforcedSystemInstruction });
  } else if (!instructionRegex.test(existingSystem.content)) {
    existingSystem.content = `${existingSystem.content}\n${enforcedSystemInstruction}`;
  }

  if (selectedProvider === "mistral" && !mistralApiKey) {
    return res.status(500).json({ error: "MISTRAL_API_KEY is not configured." });
  }

  if (selectedProvider === "claude" && !claudeApiKey) {
    return res.status(500).json({ error: "CLAUDE_API_KEY is not configured." });
  }

  const resolvedTemperature = typeof temperature === "number" ? temperature : 0.7;

  const mistralPayload = {
    model: model?.trim() || defaultMistralModel,
    messages: resolvedMessages,
    temperature: resolvedTemperature
  };

  const claudeSystemText = resolvedMessages
    .filter(m => m.role === "system")
    .map(m => m.content)
    .join("\n\n");

  const claudeMessages = resolvedMessages
    .filter(m => m.role !== "system")
    .map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));

  const claudePayload = {
    model: model?.trim() || defaultClaudeModel,
    max_tokens: 1024,
    temperature: resolvedTemperature,
    ...(claudeSystemText ? { system: claudeSystemText } : {}),
    messages: claudeMessages
  };

  const requestPayload = selectedProvider === "claude" ? claudePayload : mistralPayload;

  const chatUrl =
    selectedProvider === "claude"
      ? "https://api.anthropic.com/v1/messages"
      : "https://api.mistral.ai/v1/chat/completions";

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (selectedProvider === "claude") {
    headers["x-api-key"] = claudeApiKey as string;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers.Authorization = `Bearer ${mistralApiKey}`;
  }

  try {
    const response = await fetch(chatUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(requestPayload)
    });

    const rawBody = await response.text();
    let data: {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: string } }>;
      content?: Array<{ type?: string; text?: string }>;
      usage?: unknown;
      message?: string;
    } | null = null;

    try {
      data = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || data?.message || `${selectedProvider} API request failed.`,
        debug: {
          provider: selectedProvider,
          upstreamStatus: response.status,
          upstreamStatusText: response.statusText,
          upstreamHeaders: Object.fromEntries(response.headers.entries()),
          upstreamBody: data ?? rawBody,
          requestPayload
        }
      });
    }

    const content =
      selectedProvider === "claude"
        ? (data?.content || [])
            .filter(block => block.type === "text" && typeof block.text === "string")
            .map(block => block.text as string)
            .join("\n")
        : (data?.choices?.[0]?.message?.content ?? "");

    return res.json({
      content,
      usage: data?.usage,
      provider: selectedProvider
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({
      error: `Request failed: ${messageText}`,
      debug: {
        provider: selectedProvider,
        requestPayload
      }
    });
  }
});

app.post("/api/voice", async (req, res) => {
  const { text, voiceId, modelId } = req.body as {
    text?: string;
    voiceId?: string;
    modelId?: string;
  };

  if (!elevenLabsApiKey) {
    return res.status(500).json({ error: "ELEVENLABS_API_KEY is not configured." });
  }

  const resolvedVoiceId = voiceId?.trim() || defaultVoiceId;
  if (!resolvedVoiceId) {
    return res.status(500).json({ error: "ELEVENLABS_VOICE_ID is not configured." });
  }

  if (!text || !text.trim()) {
    return res.status(400).json({ error: "Text is required for voice generation." });
  }

  const requestPayload = {
    text: text.trim(),
    model_id: modelId?.trim() || defaultVoiceModel,
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75
    }
  };

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(resolvedVoiceId)}/stream?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": elevenLabsApiKey
        },
        body: JSON.stringify(requestPayload)
      }
    );

    if (!response.ok) {
      const rawBody = await response.text();
      let parsedBody: unknown = rawBody;
      try {
        parsedBody = rawBody ? JSON.parse(rawBody) : rawBody;
      } catch {
        parsedBody = rawBody;
      }

      return res.status(response.status).json({
        error: "ElevenLabs API request failed.",
        debug: {
          upstreamStatus: response.status,
          upstreamStatusText: response.statusText,
          upstreamHeaders: Object.fromEntries(response.headers.entries()),
          upstreamBody: parsedBody,
          requestPayload,
          voiceId: resolvedVoiceId
        }
      });
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    res.setHeader("Content-Type", response.headers.get("content-type") || "audio/mpeg");
    return res.send(audioBuffer);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({
      error: `Voice request failed: ${messageText}`,
      debug: {
        requestPayload,
        voiceId: resolvedVoiceId
      }
    });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.resolve(process.cwd(), "public", "index.html"));
});

app.listen(port, () => {
  console.log(`Mistral test app running on http://localhost:${port}`);
});

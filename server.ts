import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === 'production';

const app = express();
const httpServer = http.createServer(app);
app.use(express.json({ limit: '1mb' }));

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

app.post('/api/generate-ino', async (req, res) => {
  try {
    const { userPrompt, rulesText, currentPacket, limits } = req.body ?? {};
    if (!userPrompt || typeof userPrompt !== 'string' || !userPrompt.trim()) {
      res.status(400).json({ error: 'Please describe the ESP32 sketch behavior you want to generate.' });
      return;
    }

    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error: 'GEMINI_API_KEY is not configured in Settings > Secrets. You can still use the deterministic .ino Snippet and LLM Prompt tabs.',
      });
      return;
    }

    const systemInstruction = `You are a senior embedded C++ / ESP32 FreeRTOS firmware engineer.
Generate a complete, compile-ready Arduino ESP32 .ino sketch that strictly uses "CsvProtocol.h" (SafeCsv protocol).
Follow these exact frame-creation and FreeRTOS rules:
${typeof rulesText === 'string' ? rulesText : ''}

Rules for output:
1. Output ONLY valid C++ Arduino .ino code (no markdown fences, no prose outside C++ comments).
2. Define any non-default SAFECSV_* macros BEFORE #include "CsvProtocol.h".
3. Never construct raw CSV strings manually if SafeCsvPacket::addField / addFloat / addInt and SafeCsvLink::queueSendStamped / queueReplicate / queueForward can be used.
4. Keep RX (pollReceive) and TX (processTx) in dedicated FreeRTOS tasks per HardwareSerial port.
5. Do not put reserved delimiter characters (, = * < > \\r \\n) in keys or values.
6. Respect active limits: maxFields=${limits?.maxFields ?? 16}, maxKeyLen=${limits?.maxKeyLen ?? 15}, maxValLen=${limits?.maxValLen ?? 31}, maxFrameLen=${limits?.maxFrameLen ?? 896}, maxNodeId=${limits?.maxNodeId ?? 15}.`;

    const fullPrompt = `Current packet schema from designer:
${JSON.stringify(currentPacket ?? {}, null, 2)}

User firmware request:
${userPrompt.trim()}`;

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: fullPrompt,
      config: {
        systemInstruction,
      },
    });

    const rawText = (response.text ?? '').trim();
    const cleaned = rawText
      .replace(/^```(?:cpp|c\+\+|ino|arduino)?\s*/i, '')
      .replace(/```$/i, '')
      .trim();

    if (!cleaned) {
      res.status(502).json({ error: 'Model returned an empty response. Please try again.' });
      return;
    }

    res.json({ code: cleaned });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate .ino sketch.';
    res.status(500).json({ error: message });
  }
});

async function startServer() {
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const disableHmr = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: disableHmr ? false : {},
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`SafeCsv Studio server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

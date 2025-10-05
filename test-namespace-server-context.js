// Test namespace generation in server context
import dotenv from 'dotenv';
dotenv.config();

import { agentSystem } from './lib/llm-agent-system.js';
import express from 'express';

const app = express();
app.use(express.json());

// Test the streaming handler
app.post('/test', async (req, res) => {
  console.log('[Test] Starting test with message:', req.body.message);
  try {
    await agentSystem.handleStreamingWithAgents(
      res,
      req.body.namespace,
      req.body.message,
      req.body.history || [],
      req.body.schema || null,
      req.body.uploadedSchemas || []
    );
  } catch (error) {
    console.error('[Test] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

const port = 5002;
app.listen(port, () => {
  console.log(`[Test] Test server listening on port ${port}`);
  console.log('[Test] API Key:', process.env.ANTHROPIC_API_KEY ? 'SET' : 'NOT SET');
  console.log('[Test] Try: curl -X POST http://localhost:5002/test -H "Content-Type: application/json" -d \'{"message": "generate namespace", "namespace": null}\' --no-buffer');
});


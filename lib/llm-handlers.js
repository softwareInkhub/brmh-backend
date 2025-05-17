import axios from 'axios';

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY 
export const handlers = {
  generateSchemaWithLLM: async (c, req, res) => {
    try {
      const { prompt } = c.request.requestBody;
      if (!prompt) {
        return { statusCode: 400, body: { error: 'Prompt is required' } };
      }

      // System instruction to ensure only JSON is returned
      const context = "Only output the JSON schema. Do not include any explanations, markdown, or extra text. Your response must be a valid JSON object.";
      const inputPrompt = `${context}\n\n${prompt}`;

      // Call Claude API (Anthropic)
      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: 'claude-3-5-sonnet-20240620',
          max_tokens: 2048,
          messages: [{ role: 'user', content: inputPrompt }]
        },
        {
          headers: {
            'x-api-key': CLAUDE_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          }
        }
      );

      // Try to extract JSON schema from the LLM output
      let schema = null;
      try {
        const match = response.data.content[0].text.match(/```json\n([\s\S]*?)```/);
        schema = match ? JSON.parse(match[1]) : null;
      } catch (e) {}

      return {
        statusCode: 200,
        body: {
          schema,
          llm_output: response.data.content[0].text
        }
      };
    } catch (error) {
      return {
        statusCode: 500,
        body: { error: error.message }
      };
    }
  },

  // Streaming handler for /llm/generate-schema/stream
  generateSchemaWithLLMStream: async (c, req, res) => {
    try {
      const { prompt } = c.request.requestBody;
      if (!prompt) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Prompt is required' }));
        return;
      }

      // System instruction to ensure only JSON is returned
      const systemInstruction = "Only output the JSON schema. Do not include any explanations, markdown, or extra text. Your response must be a valid JSON object.";
      const fullPrompt = `${systemInstruction}\n\n${prompt}`;

      // Set up SSE headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      // Call Claude API (Anthropic) - streaming not natively supported, so simulate streaming
      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: 'claude-3-5-sonnet-20240620',
          max_tokens: 2048,
          messages: [{ role: 'user', content: fullPrompt }]
        },
        {
          headers: {
            'x-api-key': CLAUDE_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          }
        }
      );

      // Get the full output
      const fullText = response.data.content[0].text;
      // Simulate streaming by sending chunks
      const chunkSize = 30;
      for (let i = 0; i < fullText.length; i += chunkSize) {
        const chunk = fullText.slice(i, i + chunkSize);
        res.write(`data: ${chunk}\n\n`);
        await new Promise(r => setTimeout(r, 20)); // simulate delay
      }
      res.write('event: end\ndata: [DONE]\n\n');
      res.end();
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  }
}; 
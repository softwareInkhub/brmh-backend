import axios from 'axios';

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY 

let templates = [];
let history = [];

export const handlers = {
  generateSchemaWithLLM: async (c, req, res) => {
    try {
      const { prompt } = c.request.requestBody;
      if (!prompt) {
        return { statusCode: 400, body: { error: 'Prompt is required' } };
      }

      // Detect if the prompt is for code or schema/config
      const isCodePrompt = /lambda function|handler|code/i.test(prompt);
      let context;
      if (isCodePrompt) {
        context = "Only output the code. Do not include any explanations, markdown, or extra text. Your response must be valid JavaScript or TypeScript code.";
      } else {
        context = "Only output the JSON or YAML. Do not include any explanations, markdown, or extra text. Your response must be a valid JSON or YAML object.";
      }
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

      // Try to extract code or JSON/YAML from the LLM output
      let llm_output = response.data.content[0].text;
      let extracted = llm_output;
      // Try to extract code block
      const codeMatch = llm_output.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
      if (codeMatch) {
        extracted = codeMatch[1];
      }
      // Try to extract JSON block if not code
      if (!codeMatch) {
        const jsonMatch = llm_output.match(/({[\s\S]*})/);
        if (jsonMatch) {
          extracted = jsonMatch[1];
        }
      }

      return {
        statusCode: 200,
        body: {
          llm_output: extracted
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
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      // Call Claude API with streaming
      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: 'claude-3-5-sonnet-20240620',
          max_tokens: 2048,
          messages: [{ role: 'user', content: fullPrompt }],
          stream: true
        },
        {
          headers: {
            'x-api-key': CLAUDE_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          },
          responseType: 'stream'
        }
      );

      // Handle the stream
      response.data.on('data', chunk => {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'content_block_delta' && data.delta?.text) {
                res.write(`data: ${data.delta.text}\n\n`);
              }
            } catch (e) {
              // Ignore parsing errors for non-JSON lines
            }
          }
        }
      });

      response.data.on('end', () => {
        res.write('data: [DONE]\n\n');
        res.end();
      });

      response.data.on('error', error => {
        console.error('Stream error:', error);
        res.write(`data: Error: ${error.message}\n\n`);
        res.write('data: [DONE]\n\n');
      res.end();
      });

    } catch (error) {
      console.error('Streaming error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  },

  // Save a new prompt template
  savePromptTemplate: async (c, req, res) => {
    const { name, context, message } = c.request.requestBody;
    const id = Date.now().toString();
    templates.push({ id, name, context, message });
    return { statusCode: 201, body: { id, name, context, message } };
  },

  // List all prompt templates
  listPromptTemplates: async () => ({
    statusCode: 200,
    body: templates
  }),

  // Save LLM output history
  saveLLMHistory: async (c, req, res) => {
    const { prompt, output } = c.request.requestBody;
    const id = Date.now().toString();
    history.push({ id, prompt, output, timestamp: new Date().toISOString() });
    return { statusCode: 201, body: { id } };
  },

  // List LLM output history
  listLLMHistory: async () => ({
    statusCode: 200,
    body: history
  }),

  countTokens: async (c, req, res) => {
    try {
      const { text } = c.request.requestBody;
      if (!text) {
        return { statusCode: 400, body: { error: 'Text is required' } };
      }
      // Simple token count: split by whitespace
      const tokenCount = text.trim().split(/\s+/).length;
      return { statusCode: 200, body: { tokenCount } };
    } catch (error) {
      return { statusCode: 500, body: { error: error.message } };
    }
  },
}; 
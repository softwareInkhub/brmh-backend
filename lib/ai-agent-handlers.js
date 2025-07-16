// AI Agent Workspace Handlers (modularized)
import { agentSystem } from './llm-agent-system.js';

// Non-streaming AI Agent endpoint
export async function aiAgentHandler(c, req, res) {
  try {
    const { message, namespace, action, history, stream = false } = c.request.requestBody || {};
    // Use the agent system to process the message (non-streaming)
    let actions = [];
    let content = '';
    let schemaData = null;
    let apiData = null;
    // Simulate the streaming logic but in one go
    const result = await agentSystem.handleStreamingWithAgents({
      write: (data) => {
        // Parse streamed data
        if (typeof data === 'string' && data.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(data.slice(6));
            if (parsed.type === 'actions' && parsed.actions) {
              actions = parsed.actions;
            } else if (parsed.type === 'chat' && parsed.content) {
              content += parsed.content;
            }
          } catch {}
        }
      },
      end: () => {}
    }, namespace, message, history);
    return {
      statusCode: 200,
      body: {
        content,
        actions,
        type: 'chat'
      }
    };
  } catch (error) {
    console.error('AI Agent error:', error);
    return {
      statusCode: 500,
      body: {
        content: 'Sorry, I encountered an error processing your request.',
        output: '',
        type: 'error',
        error: error.message
      }
    };
  }
}

// Streaming AI Agent endpoint
export async function aiAgentStreamHandler(c, req, res) {
  try {
    const { message, namespace, action, history } = c.request.requestBody || {};
    // Use the agent system to process streaming
    await agentSystem.handleStreamingWithAgents(res, namespace, message, history);
    return null;
  } catch (error) {
    console.error('Streaming AI Agent error:', error);
    return {
      statusCode: 500,
      body: {
        content: 'Sorry, I encountered an error processing your request.',
        output: '',
        type: 'error',
        error: error.message
      }
    };
  }
}

// Add more AI Agent/LLM endpoints here as needed 
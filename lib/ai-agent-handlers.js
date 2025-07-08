// AI Agent Workspace Handlers (modularized)
import { orchestrateAIAgentTask } from './orchestrator.js';
import { streamingAIAgent } from './streaming-ai-agent.js';

// Non-streaming AI Agent endpoint
export async function aiAgentHandler(c, req, res) {
  try {
    const { message, namespace, action, history, stream = false } = c.request.requestBody || {};
    const orchestratorResult = await orchestrateAIAgentTask({ message, namespace, history, session: {} });
    return {
      statusCode: 200,
      body: {
        content: orchestratorResult.response,
        actions: orchestratorResult.actions,
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
    await streamingAIAgent.streamResponse(res, namespace, message, history);
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
// AI Agent Workspace Handlers (modularized)
import { agentSystem } from './llm-agent-system.js';

// Non-streaming AI Agent endpoint
export async function aiAgentHandler(c, req, res) {
  try {
    const { message, namespace, action, history, stream = false } = c.request.requestBody || {};
    
    const namespaceId = typeof namespace === 'object' && namespace !== null ? namespace.id : namespace;
    
    // For non-streaming, provide a simple response with context if available
    let response = {
      content: `I received your message: "${message}". This is a non-streaming response.`,
      actions: [],
      type: 'chat'
    };
    
    // If you have a namespace, you could load context here too
    if (namespaceId) {
      response.content += `\n\nNote: You're working with namespace ${namespaceId}. For detailed context and real-time data, please use the streaming endpoint.`;
    }
    
    return {
      statusCode: 200,
      body: response
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
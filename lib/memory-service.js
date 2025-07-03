import { ChatAnthropic } from '@langchain/anthropic';
import { BufferMemory } from 'langchain/memory';
import { ConversationChain } from 'langchain/chains';
import { DynamoDBChatMessageHistory } from '@langchain/community/stores/message/dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { v4 as uuidv4 } from 'uuid';

const client = new DynamoDBClient({});

class MemoryService {
  constructor() {
    this.sessions = new Map();
    this.llm = new ChatAnthropic({
      modelName: 'claude-3-5-sonnet-20240620',
      temperature: 0.7,
      maxTokens: 4096,
    });
  }

  /**
   * Get or create a conversation session
   * @param {string} sessionId - Unique session identifier
   * @param {string} userId - User identifier
   * @param {string} context - Session context (e.g., 'schema-generation', 'lambda-creation')
   * @returns {Promise<Object>} Conversation session
   */
  async getSession(sessionId, userId, context = 'general') {
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId);
    }

    // Create DynamoDB message history
    const messageHistory = new DynamoDBChatMessageHistory({
      tableName: 'brmh-conversation-memory',
      sessionId: sessionId,
      config: {
        region: process.env.AWS_REGION || 'us-east-1',
      },
    });

    // Create memory with conversation history
    const memory = new BufferMemory({
      chatHistory: messageHistory,
      returnMessages: true,
      memoryKey: 'history',
      inputKey: 'input',
    });

    // Create conversation chain
    const chain = new ConversationChain({
      llm: this.llm,
      memory: memory,
      verbose: false,
    });

    // Create session object
    const session = {
      sessionId,
      userId,
      context,
      chain,
      memory,
      messageHistory,
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Send a message to the conversation
   * @param {string} sessionId - Session identifier
   * @param {string} userId - User identifier
   * @param {string} message - User message
   * @param {string} context - Conversation context
   * @param {Object} metadata - Additional metadata
   * @returns {Promise<Object>} Response with AI reply and context
   */
  async sendMessage(sessionId, userId, message, context = 'general', metadata = {}) {
    try {
      const session = await this.getSession(sessionId, userId, context);
      
      // Update last activity
      session.lastActivity = new Date().toISOString();

      // Create context-aware prompt
      const contextPrompt = this.createContextPrompt(context, metadata);
      const fullMessage = `${contextPrompt}\n\nUser: ${message}`;

      // Get conversation history for context
      const history = await session.memory.chatHistory.getMessages();
      
      // Create response with enhanced context
      const response = await session.chain.call({
        input: fullMessage,
        context: {
          sessionId,
          userId,
          context,
          metadata,
          history: history.slice(-10), // Last 10 messages for context
        },
      });

      // Extract and clean the response
      let aiResponse = response.response;
      
      // Remove any system prefixes
      if (aiResponse.startsWith('Human:') || aiResponse.startsWith('Assistant:')) {
        aiResponse = aiResponse.replace(/^(Human|Assistant):\s*/, '');
      }

      return {
        success: true,
        sessionId,
        response: aiResponse,
        context: {
          sessionId,
          userId,
          context,
          messageCount: history.length + 2, // +2 for current exchange
          lastActivity: session.lastActivity,
        },
        metadata: {
          model: 'claude-3-5-sonnet-20240620',
          timestamp: new Date().toISOString(),
          ...metadata,
        },
      };
    } catch (error) {
      console.error('Memory service error:', error);
      return {
        success: false,
        error: error.message,
        sessionId,
        context: { sessionId, userId, context },
      };
    }
  }

  /**
   * Create context-aware prompts for different conversation types
   * @param {string} context - Conversation context
   * @param {Object} metadata - Additional metadata
   * @returns {string} Context prompt
   */
  createContextPrompt(context, metadata = {}) {
    const basePrompt = `You are an expert AI assistant for the BRHM (Backend Resource Management Hub) platform. You help users with AWS resource management, API development, and schema generation.`;

    const contextPrompts = {
      'schema-generation': `
${basePrompt}

You are specifically helping with schema generation. You can:
- Generate JSON schemas from natural language descriptions
- Validate existing schemas
- Suggest improvements to schemas
- Explain schema concepts and best practices

Current context: ${metadata.namespaceName ? `Working with namespace: ${metadata.namespaceName}` : 'General schema work'}
${metadata.methodName ? `Method: ${metadata.methodName}` : ''}

Remember previous schema discussions and maintain consistency in your recommendations.`,

      'lambda-creation': `
${basePrompt}

You are specifically helping with Lambda function creation. You can:
- Generate Lambda function code
- Suggest best practices for AWS Lambda
- Help with function configuration
- Provide deployment guidance

Current context: ${metadata.namespaceName ? `Working with namespace: ${metadata.namespaceName}` : 'General Lambda work'}
${metadata.methodName ? `Method: ${metadata.methodName}` : ''}

Remember previous Lambda discussions and maintain consistency in your code patterns.`,

      'namespace-management': `
${basePrompt}

You are specifically helping with namespace management. You can:
- Help organize APIs into logical namespaces
- Suggest namespace structures
- Assist with account and method management
- Provide guidance on API organization

Current context: ${metadata.namespaceName ? `Working with namespace: ${metadata.namespaceName}` : 'General namespace work'}

Remember the user's namespace structure and provide consistent organizational advice.`,

      'aws-resources': `
${basePrompt}

You are specifically helping with AWS resource management. You can:
- Provide guidance on AWS services (S3, DynamoDB, Lambda, etc.)
- Help with resource configuration
- Suggest best practices for AWS architecture
- Assist with troubleshooting AWS issues

Current context: ${metadata.service ? `Working with ${metadata.service}` : 'General AWS work'}

Remember previous AWS discussions and maintain consistency in your recommendations.`,

      'general': `
${basePrompt}

You can help with:
- Schema generation and validation
- Lambda function creation
- Namespace and API management
- AWS resource management
- General development questions

Provide helpful, contextual responses based on the user's needs.`
    };

    return contextPrompts[context] || contextPrompts['general'];
  }

  /**
   * Get conversation history for a session
   * @param {string} sessionId - Session identifier
   * @param {number} limit - Number of messages to retrieve
   * @returns {Promise<Array>} Conversation history
   */
  async getHistory(sessionId, limit = 50) {
    try {
      const session = this.sessions.get(sessionId);
      if (!session) {
        return [];
      }

      const messages = await session.memory.chatHistory.getMessages();
      return messages.slice(-limit);
    } catch (error) {
      console.error('Error getting history:', error);
      return [];
    }
  }

  /**
   * Clear conversation history for a session
   * @param {string} sessionId - Session identifier
   * @returns {Promise<boolean>} Success status
   */
  async clearHistory(sessionId) {
    try {
      const session = this.sessions.get(sessionId);
      if (session) {
        await session.memory.chatHistory.clear();
        this.sessions.delete(sessionId);
      }
      return true;
    } catch (error) {
      console.error('Error clearing history:', error);
      return false;
    }
  }

  /**
   * Get all active sessions for a user
   * @param {string} userId - User identifier
   * @returns {Array} Active sessions
   */
  getUserSessions(userId) {
    return Array.from(this.sessions.values())
      .filter(session => session.userId === userId)
      .map(session => ({
        sessionId: session.sessionId,
        context: session.context,
        createdAt: session.createdAt,
        lastActivity: session.lastActivity,
      }));
  }

  /**
   * Clean up old sessions (memory management)
   * @param {number} maxAge - Maximum age in hours
   */
  cleanupOldSessions(maxAge = 24) {
    const cutoff = new Date(Date.now() - maxAge * 60 * 60 * 1000);
    
    for (const [sessionId, session] of this.sessions.entries()) {
      if (new Date(session.lastActivity) < cutoff) {
        this.sessions.delete(sessionId);
      }
    }
  }

  /**
   * Generate a unique session ID
   * @param {string} userId - User identifier
   * @param {string} context - Session context
   * @returns {string} Unique session ID
   */
  generateSessionId(userId, context) {
    return `${userId}-${context}-${uuidv4()}`;
  }
}

// Create singleton instance
const memoryService = new MemoryService();

// Cleanup old sessions every hour
setInterval(() => {
  memoryService.cleanupOldSessions();
}, 60 * 60 * 1000);

export default memoryService; 
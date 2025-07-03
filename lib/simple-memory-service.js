import { ChatAnthropic } from '@langchain/anthropic';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

class SimpleMemoryService {
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
   * @param {string} context - Session context
   * @returns {Promise<Object>} Conversation session
   */
  async getSession(sessionId, userId, context = 'general') {
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId);
    }

    // Create session object
    const session = {
      sessionId,
      userId,
      context,
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Save a message to DynamoDB
   * @param {string} sessionId - Session identifier
   * @param {string} role - Message role (user/assistant)
   * @param {string} content - Message content
   * @returns {Promise<void>}
   */
  async saveMessage(sessionId, role, content) {
    const messageId = uuidv4();
    const timestamp = new Date().toISOString();

    const params = {
      TableName: 'brmh-conversation-memory',
      Item: {
        SessionId: sessionId,
        MessageId: messageId,
        Role: role,
        Content: content,
        Timestamp: timestamp,
        CreatedAt: timestamp
      }
    };

    try {
      await docClient.send(new PutCommand(params));
    } catch (error) {
      console.error('Error saving message:', error);
      throw error;
    }
  }

  /**
   * Get conversation history from DynamoDB
   * @param {string} sessionId - Session identifier
   * @param {number} limit - Number of messages to retrieve
   * @returns {Promise<Array>} Conversation history
   */
  async getHistory(sessionId, limit = 50) {
    const params = {
      TableName: 'brmh-conversation-memory',
      KeyConditionExpression: 'SessionId = :sessionId',
      ExpressionAttributeValues: {
        ':sessionId': sessionId
      },
      ScanIndexForward: false, // Get most recent first
      Limit: limit
    };

    try {
      const result = await docClient.send(new QueryCommand(params));
      return (result.Items || []).reverse(); // Reverse to get chronological order
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
      // Get all messages for the session
      const messages = await this.getHistory(sessionId, 1000);
      
      // Delete each message
      for (const message of messages) {
        const params = {
          TableName: 'brmh-conversation-memory',
          Key: {
            SessionId: sessionId,
            MessageId: message.MessageId
          }
        };
        await docClient.send(new DeleteCommand(params));
      }

      // Remove from sessions map
      this.sessions.delete(sessionId);
      return true;
    } catch (error) {
      console.error('Error clearing history:', error);
      return false;
    }
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

      // Save user message
      await this.saveMessage(sessionId, 'user', message);

      // Get conversation history for context
      const history = await this.getHistory(sessionId, 10);
      
      // Create context-aware prompt
      const contextPrompt = this.createContextPrompt(context, metadata);
      
      // Build conversation context from history
      const conversationContext = history
        .map(msg => `${msg.Role === 'user' ? 'User' : 'Assistant'}: ${msg.Content}`)
        .join('\n');

      const fullPrompt = `${contextPrompt}\n\n${conversationContext}\n\nUser: ${message}\n\nAssistant:`;

      // Call Claude API directly
      const response = await this.llm.invoke([{
        role: 'user',
        content: fullPrompt
      }]);

      const aiResponse = response.content;

      // Save assistant response
      await this.saveMessage(sessionId, 'assistant', aiResponse);

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
const simpleMemoryService = new SimpleMemoryService();

// Cleanup old sessions every hour
setInterval(() => {
  simpleMemoryService.cleanupOldSessions();
}, 60 * 60 * 1000);

export default simpleMemoryService; 
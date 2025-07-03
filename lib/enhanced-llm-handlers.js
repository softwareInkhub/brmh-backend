import { ChatAnthropic } from '@langchain/anthropic';
import simpleMemoryService from './simple-memory-service.js';
import { v4 as uuidv4 } from 'uuid';

// Initialize Claude client
const claude = new ChatAnthropic({
  modelName: 'claude-3-5-sonnet-20240620',
  temperature: 0.7,
  maxTokens: 4096,
});

/**
 * Enhanced LLM handler with conversational memory
 * @param {Object} context - OpenAPI context
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const enhancedLLMHandler = async (context, req, res) => {
  try {
    const { message, sessionId, userId, context: userContext, metadata } = context.request.requestBody;

    if (!message) {
      return {
        statusCode: 400,
        body: {
          success: false,
          error: 'Message is required'
        }
      };
    }

    // Generate session ID if not provided
    const finalSessionId = sessionId || simpleMemoryService.generateSessionId(userId || 'anonymous', userContext || 'general');
    const finalUserId = userId || 'anonymous';
    const finalContext = userContext || 'general';

    // Send message through memory service
    const result = await simpleMemoryService.sendMessage(
      finalSessionId,
      finalUserId,
      message,
      finalContext,
      metadata || {}
    );

    if (result.success) {
      return {
        statusCode: 200,
        body: result
      };
    } else {
      return {
        statusCode: 500,
        body: result
      };
    }
  } catch (error) {
    console.error('Enhanced LLM handler error:', error);
    return {
      statusCode: 500,
      body: {
        success: false,
        error: error.message
      }
    };
  }
};

/**
 * Get conversation history
 * @param {Object} context - OpenAPI context
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getConversationHistory = async (context, req, res) => {
  try {
    const { sessionId, limit = 50 } = context.request.query;

    if (!sessionId) {
      return {
        statusCode: 400,
        body: {
          success: false,
          error: 'Session ID is required'
        }
      };
    }

    const history = await simpleMemoryService.getHistory(sessionId, parseInt(limit));
    
    return {
      statusCode: 200,
      body: {
        success: true,
        sessionId,
        history,
        count: history.length
      }
    };
  } catch (error) {
    console.error('Get history error:', error);
    return {
      statusCode: 500,
      body: {
        success: false,
        error: error.message
      }
    };
  }
};

/**
 * Clear conversation history
 * @param {Object} context - OpenAPI context
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const clearConversationHistory = async (context, req, res) => {
  try {
    const { sessionId } = context.request.requestBody;

    if (!sessionId) {
      return {
        statusCode: 400,
        body: {
          success: false,
          error: 'Session ID is required'
        }
      };
    }

    const success = await simpleMemoryService.clearHistory(sessionId);
    
    return {
      statusCode: 200,
      body: {
        success,
        sessionId,
        message: success ? 'Conversation history cleared successfully' : 'Failed to clear conversation history'
      }
    };
  } catch (error) {
    console.error('Clear history error:', error);
    return {
      statusCode: 500,
      body: {
        success: false,
        error: error.message
      }
    };
  }
};

/**
 * Get user sessions
 * @param {Object} context - OpenAPI context
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getUserSessions = async (context, req, res) => {
  try {
    const sessions = simpleMemoryService.getAllSessions();
    
    return {
      statusCode: 200,
      body: {
        success: true,
        sessions,
        count: sessions.length
      }
    };
  } catch (error) {
    console.error('Get user sessions error:', error);
    return {
      statusCode: 500,
      body: {
        success: false,
        error: error.message
      }
    };
  }
};

/**
 * Create new session
 * @param {Object} context - OpenAPI context
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const createSession = async (context, req, res) => {
  try {
    const { userId, context: userContext } = context.request.requestBody;

    const sessionId = simpleMemoryService.generateSessionId(userId || 'anonymous', userContext || 'general');
    const session = await simpleMemoryService.getSession(sessionId, userId || 'anonymous', userContext || 'general');
    
    return {
      statusCode: 200,
      body: {
        success: true,
        session: {
          sessionId: session.sessionId,
          userId: session.userId,
          context: session.context,
          createdAt: session.createdAt,
          lastActivity: session.lastActivity
        }
      }
    };
  } catch (error) {
    console.error('Create session error:', error);
    return {
      statusCode: 500,
      body: {
        success: false,
        error: error.message
      }
    };
  }
}; 
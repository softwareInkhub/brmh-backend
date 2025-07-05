import { fileOperations } from './file-operations.js';
import { Anthropic } from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export class StreamingAIAgent {
  constructor() {
    this.memory = new Map(); // Simple in-memory storage for conversation context
  }

  async streamResponse(res, namespace, message, history = []) {
    // Always extract namespaceId as string
    const namespaceId = typeof namespace === 'object' && namespace !== null ? namespace.id : namespace;
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    try {
      // Get namespace context
      const namespaceContext = await this.getNamespaceContext(namespaceId);
      
      // Detect intent and prepare response
      const intent = this.detectIntent(message);
      const response = await this.generateResponse(intent, message, namespaceContext, history);
      
      // Stream the response
      await this.streamToClient(res, response);
      
    } catch (error) {
      console.error('Streaming error:', error);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    } finally {
      res.end();
    }
  }

  detectIntent(message) {
    const msg = message.toLowerCase();
    
    if (msg.includes('create') && (msg.includes('file') || msg.includes('code'))) return 'create_file';
    if (msg.includes('edit') && (msg.includes('file') || msg.includes('code'))) return 'edit_file';
    if (msg.includes('schema') || msg.includes('model')) return 'schema';
    if (msg.includes('api') || msg.includes('endpoint') || msg.includes('route')) return 'api';
    if (msg.includes('test') || msg.includes('run')) return 'test';
    if (msg.includes('project') || msg.includes('structure')) return 'project_setup';
    if (msg.includes('list') && msg.includes('file')) return 'list_files';
    if (msg.includes('read') && msg.includes('file')) return 'read_file';
    
    return 'chat';
  }

  async getNamespaceContext(namespace) {
    const namespaceId = typeof namespace === 'object' && namespace !== null ? namespace.id : namespace;
    if (!namespaceId) return { files: [], structure: null };
    
    try {
      const fileTree = await fileOperations.getFileTree(namespaceId);
      return {
        files: fileTree.success ? fileTree.tree : [],
        structure: fileTree.success ? fileTree.tree : null
      };
    } catch (error) {
      console.error('Error getting namespace context:', error);
      return { files: [], structure: null };
    }
  }

  async generateResponse(intent, message, namespaceContext, history) {
    const systemPrompt = this.buildSystemPrompt(intent, namespaceContext);
    
    const messages = [
      { role: 'user', content: systemPrompt },
      ...history.slice(-10), // Last 10 messages for context
      { role: 'user', content: message }
    ];

    try {
      const stream = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20240620',
        max_tokens: 4000,
        messages: messages,
        stream: true,
      });

      return stream;
    } catch (error) {
      console.error('Anthropic API error:', error);
      throw new Error('Failed to generate AI response');
    }
  }

  buildSystemPrompt(intent, namespaceContext) {
    const basePrompt = `You are an AI development assistant working within a code workspace. You can:
- Create and edit files
- Generate schemas and APIs
- Run tests and provide debugging help
- Manage project structure
- Provide coding assistance

Current workspace context:
${JSON.stringify(namespaceContext.files, null, 2)}

Instructions:
1. Always respond in a conversational, helpful manner
2. When creating files, provide the complete file content
3. When editing files, specify the file path and changes
4. For schemas, return raw JSON (no markdown or code blocks)
5. For APIs, provide clear endpoint definitions
6. Keep responses concise but informative

Intent detected: ${intent}`;

    switch (intent) {
      case 'create_file':
        return basePrompt + '\n\nYou are creating a new file. Provide the complete file content and specify the file path.';
      case 'edit_file':
        return basePrompt + '\n\nYou are editing an existing file. Specify the file path and provide the updated content.';
      case 'schema':
        return basePrompt + '\n\nYou are generating a schema. Return ONLY raw JSON without any markdown formatting or code blocks.';
      case 'api':
        return basePrompt + '\n\nYou are creating API endpoints. Provide clear endpoint definitions with methods, paths, and descriptions.';
      case 'test':
        return basePrompt + '\n\nYou are running tests or providing testing assistance.';
      case 'project_setup':
        return basePrompt + '\n\nYou are setting up project structure. Create necessary files and directories.';
      default:
        return basePrompt + '\n\nYou are having a general conversation about development.';
    }
  }

  async streamToClient(res, stream) {
    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta') {
        const content = chunk.delta.text;
        res.write(`data: ${JSON.stringify({ content, type: 'stream' })}\n\n`);
      }
    }
  }

  async handleFileOperation(namespaceId, operation, filePath, content = '') {
    try {
      switch (operation) {
        case 'create':
          return await fileOperations.createFile(namespaceId, filePath, content);
        case 'read':
          return await fileOperations.readFile(namespaceId, filePath);
        case 'update':
          return await fileOperations.updateFile(namespaceId, filePath, content);
        case 'delete':
          return await fileOperations.deleteFile(namespaceId, filePath);
        case 'list':
          return await fileOperations.listFiles(namespaceId, filePath);
        case 'tree':
          return await fileOperations.getFileTree(namespaceId);
        default:
          throw new Error(`Unknown operation: ${operation}`);
      }
    } catch (error) {
      console.error('File operation error:', error);
      return { success: false, error: error.message };
    }
  }

  async generateProjectStructure(namespaceId, projectType = 'nodejs') {
    try {
      return await fileOperations.generateProjectStructure(namespaceId, projectType);
    } catch (error) {
      console.error('Project structure generation error:', error);
      return { success: false, error: error.message };
    }
  }
}

export const streamingAIAgent = new StreamingAIAgent(); 
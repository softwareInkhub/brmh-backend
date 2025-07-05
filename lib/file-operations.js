import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Base workspace directory
const WORKSPACE_BASE = path.join(__dirname, '..', 'workspaces');

export class FileOperations {
  constructor() {
    this.ensureWorkspaceBase();
  }

  async ensureWorkspaceBase() {
    try {
      await fs.access(WORKSPACE_BASE);
    } catch {
      await fs.mkdir(WORKSPACE_BASE, { recursive: true });
    }
  }

  async getNamespaceWorkspace(namespaceId) {
    const workspacePath = path.join(WORKSPACE_BASE, namespaceId);
    try {
      await fs.access(workspacePath);
    } catch {
      await fs.mkdir(workspacePath, { recursive: true });
    }
    return workspacePath;
  }

  async createFile(namespaceId, filePath, content) {
    const workspacePath = await this.getNamespaceWorkspace(namespaceId);
    const fullPath = path.join(workspacePath, filePath);
    
    // Ensure directory exists
    const dir = path.dirname(fullPath);
    await fs.mkdir(dir, { recursive: true });
    
    // Write file
    await fs.writeFile(fullPath, content, 'utf8');
    
    return {
      success: true,
      path: filePath,
      fullPath,
      size: content.length
    };
  }

  async readFile(namespaceId, filePath) {
    const workspacePath = await this.getNamespaceWorkspace(namespaceId);
    const fullPath = path.join(workspacePath, filePath);
    
    try {
      const content = await fs.readFile(fullPath, 'utf8');
      return {
        success: true,
        path: filePath,
        content,
        size: content.length
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async updateFile(namespaceId, filePath, content) {
    const workspacePath = await this.getNamespaceWorkspace(namespaceId);
    const fullPath = path.join(workspacePath, filePath);
    
    try {
      await fs.writeFile(fullPath, content, 'utf8');
      return {
        success: true,
        path: filePath,
        size: content.length
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async deleteFile(namespaceId, filePath) {
    const workspacePath = await this.getNamespaceWorkspace(namespaceId);
    const fullPath = path.join(workspacePath, filePath);
    
    try {
      await fs.unlink(fullPath);
      return {
        success: true,
        path: filePath
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async listFiles(namespaceId, dirPath = '') {
    const workspacePath = await this.getNamespaceWorkspace(namespaceId);
    const fullPath = path.join(workspacePath, dirPath);
    
    try {
      const items = await fs.readdir(fullPath, { withFileTypes: true });
      const files = [];
      
      for (const item of items) {
        const relativePath = path.join(dirPath, item.name);
        const stats = await fs.stat(path.join(fullPath, item.name));
        
        files.push({
          name: item.name,
          path: relativePath,
          type: item.isDirectory() ? 'folder' : 'file',
          size: stats.size,
          modified: stats.mtime,
          isDirectory: item.isDirectory()
        });
      }
      
      return {
        success: true,
        files,
        path: dirPath
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getFileTree(namespaceId) {
    const workspacePath = await this.getNamespaceWorkspace(namespaceId);
    
    const buildTree = async (dirPath) => {
      const fullPath = path.join(workspacePath, dirPath);
      
      try {
        const items = await fs.readdir(fullPath, { withFileTypes: true });
        const tree = [];
        
        for (const item of items) {
          const relativePath = path.join(dirPath, item.name);
          
          if (item.isDirectory()) {
            const children = await buildTree(relativePath);
            tree.push({
              id: relativePath,
              name: item.name,
              type: 'folder',
              path: relativePath,
              children
            });
          } else {
            const stats = await fs.stat(path.join(fullPath, item.name));
            tree.push({
              id: relativePath,
              name: item.name,
              type: 'file',
              path: relativePath,
              size: stats.size,
              modified: stats.mtime
            });
          }
        }
        
        return tree;
      } catch (error) {
        return [];
      }
    };
    
    return {
      success: true,
      tree: await buildTree('')
    };
  }

  async fileExists(namespaceId, filePath) {
    const workspacePath = await this.getNamespaceWorkspace(namespaceId);
    const fullPath = path.join(workspacePath, filePath);
    
    try {
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async getFileStats(namespaceId, filePath) {
    const workspacePath = await this.getNamespaceWorkspace(namespaceId);
    const fullPath = path.join(workspacePath, filePath);
    
    try {
      const stats = await fs.stat(fullPath);
      return {
        success: true,
        path: filePath,
        size: stats.size,
        modified: stats.mtime,
        created: stats.birthtime,
        isDirectory: stats.isDirectory()
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Generate common project structure
  async generateProjectStructure(namespaceId, projectType = 'nodejs') {
    const workspacePath = await this.getNamespaceWorkspace(namespaceId);
    
    const structures = {
      nodejs: {
        'package.json': JSON.stringify({
          name: namespaceId,
          version: '1.0.0',
          description: 'Generated by AI Agent',
          main: 'index.js',
          scripts: {
            start: 'node index.js',
            dev: 'nodemon index.js',
            test: 'jest'
          },
          dependencies: {
            express: '^4.18.2',
            cors: '^2.8.5',
            dotenv: '^16.0.3'
          },
          devDependencies: {
            nodemon: '^2.0.22',
            jest: '^29.5.0'
          }
        }, null, 2),
        'index.js': `const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ message: 'Hello from ${namespaceId}!' });
});

app.listen(PORT, () => {
  console.log(\`Server running on port \${PORT}\`);
});`,
        'README.md': `# ${namespaceId}

This project was generated by the AI Agent Workspace.

## Getting Started

1. Install dependencies:
   \`\`\`bash
   npm install
   \`\`\`

2. Start the development server:
   \`\`\`bash
   npm run dev
   \`\`\`

3. The server will be available at http://localhost:3000

## Project Structure

- \`index.js\` - Main application entry point
- \`package.json\` - Project dependencies and scripts
- \`README.md\` - This file

## API Endpoints

- \`GET /\` - Health check endpoint
`,
        '.env': `PORT=3000
NODE_ENV=development`,
        '.gitignore': `node_modules/
.env
.DS_Store
*.log`
      },
      python: {
        'requirements.txt': `flask==2.3.3
python-dotenv==1.0.0
cors==1.0.1`,
        'app.py': `from flask import Flask, jsonify
from flask_cors import CORS
import os

app = Flask(__name__)
CORS(app)

@app.route('/')
def hello():
    return jsonify({'message': 'Hello from ${namespaceId}!'})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)`,
        'README.md': `# ${namespaceId}

This project was generated by the AI Agent Workspace.

## Getting Started

1. Install dependencies:
   \`\`\`bash
   pip install -r requirements.txt
   \`\`\`

2. Start the development server:
   \`\`\`bash
   python app.py
   \`\`\`

3. The server will be available at http://localhost:5000

## Project Structure

- \`app.py\` - Main application entry point
- \`requirements.txt\` - Python dependencies
- \`README.md\` - This file

## API Endpoints

- \`GET /\` - Health check endpoint
`
      }
    };

    const structure = structures[projectType] || structures.nodejs;
    
    for (const [filePath, content] of Object.entries(structure)) {
      await this.createFile(namespaceId, filePath, content);
    }
    
    return {
      success: true,
      projectType,
      files: Object.keys(structure)
    };
  }
}

export const fileOperations = new FileOperations(); 
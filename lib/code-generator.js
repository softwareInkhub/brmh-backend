import fs from 'fs';
import path from 'path';

function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function writeFileSyncSafe(filePath, content) {
  ensureDirSync(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

// Node.js Generators
function generateNodeModelFile(schema, modelName) {
  const fields = Object.entries(schema.properties || {})
    .map(([key, val]) => `    this.${key} = data.${key}; // type: ${val.type}`)
    .join('\n');
  return `class ${modelName} {
  constructor(data) {
${fields}
  }
}

module.exports = ${modelName};
`;
}

function generateNodeRouteFile(api, modelName) {
  const routes = (api.endpoints || []).map(endpoint => {
    return `app.${endpoint.method.toLowerCase()}('${endpoint.path}', (req, res) => {
  // TODO: Implement ${endpoint.description}
  res.json({ message: '${endpoint.description}' });
});`;
  }).join('\n\n');
  return `const express = require('express');
const app = express();
const ${modelName} = require('../models/${modelName}');

${routes}

module.exports = app;
`;
}

function generateNodePackageJson(namespaceName) {
  return `{
  "name": "${namespaceName.toLowerCase().replace(/\\s+/g, '-')}",
  "version": "1.0.0",
  "description": "Generated backend for ${namespaceName}",
  "main": "app.js",
  "scripts": {
    "start": "node app.js",
    "dev": "nodemon app.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "dotenv": "^16.0.3"
  },
  "devDependencies": {
    "nodemon": "^2.0.22"
  }
}`;
}

function generateNodeAppJs(files, namespaceName) {
  const routeRequires = files.filter(f => f.type === 'route').map(f => `const ${f.name.replace('.js','')} = require('./routes/${f.name}');`).join('\n');
  const useRoutes = files.filter(f => f.type === 'route').map(f => `app.use(${f.name.replace('.js','')});`).join('\n');
  return `const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
${routeRequires}

${useRoutes}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: '${namespaceName}' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(\`🚀 ${namespaceName} server running on port \${PORT}\`);
  console.log(\`📖 API documentation available at http://localhost:\${PORT}/api-docs\`);
});
`;
}

// Python Generators
function generatePythonModelFile(schema, modelName) {
  const fields = Object.entries(schema.properties || {})
    .map(([key, val]) => `        self.${key} = data.get('${key}')  # type: ${val.type}`)
    .join('\n');
  return `from dataclasses import dataclass
from typing import Optional

@dataclass
class ${modelName}:
${fields}
    
    @classmethod
    def from_dict(cls, data: dict):
        return cls(**data)
    
    def to_dict(self):
        return {
${Object.entries(schema.properties || {}).map(([key, val]) => `            '${key}': self.${key}`).join(',\n')}
        }
`;
}

function generatePythonRouteFile(api, modelName) {
  const routes = (api.endpoints || []).map(endpoint => {
    return `@app.route('${endpoint.path}', methods=['${endpoint.method}'])
def ${endpoint.path.replace(/[^a-zA-Z0-9]/g, '_')}():
    # TODO: Implement ${endpoint.description}
    return jsonify({'message': '${endpoint.description}'})`;
  }).join('\n\n');
  return `from flask import jsonify, request
from models.${modelName.toLowerCase()} import ${modelName}

${routes}
`;
}

function generatePythonRequirementsTxt() {
  return `Flask==2.3.3
Flask-CORS==4.0.0
python-dotenv==1.0.0
`;
}

function generatePythonAppPy(files, namespaceName) {
  const routeImports = files.filter(f => f.type === 'route').map(f => `from routes import ${f.name.replace('.py','').toLowerCase()}`).join('\n');
  return `from flask import Flask, jsonify
from flask_cors import CORS
import os
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)

# Import routes
${routeImports}

# Health check
@app.route('/health')
def health():
    return jsonify({'status': 'OK', 'service': '${namespaceName}'})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
    print(f"🚀 ${namespaceName} server running on port {port}")
`;
}

export async function generateBackendCode(namespaceId, schemas = [], apis = [], projectType = 'nodejs', namespaceName = 'Generated Project') {
  const workspaceDir = path.join('workspaces', namespaceId);
  ensureDirSync(workspaceDir);
  const files = [];

  if (projectType === 'nodejs') {
    // Generate Node.js project
    const modelsDir = path.join(workspaceDir, 'models');
    ensureDirSync(modelsDir);
    
    for (const schema of schemas) {
      const modelName = schema.name?.replace(/\W/g, '') || 'Model';
      const filePath = path.join(modelsDir, `${modelName}.js`);
      const content = generateNodeModelFile(schema, modelName);
      writeFileSyncSafe(filePath, content);
      files.push({ type: 'model', name: `${modelName}.js`, path: filePath });
    }

    const routesDir = path.join(workspaceDir, 'routes');
    ensureDirSync(routesDir);
    
    for (const api of apis) {
      const apiName = api.name?.replace(/\W/g, '') || 'Api';
      const modelName = schemas[0]?.name?.replace(/\W/g, '') || 'Model';
      const filePath = path.join(routesDir, `${apiName}.js`);
      const content = generateNodeRouteFile(api, modelName);
      writeFileSyncSafe(filePath, content);
      files.push({ type: 'route', name: `${apiName}.js`, path: filePath });
    }

    // Generate package.json
    const packageJsonPath = path.join(workspaceDir, 'package.json');
    const packageJsonContent = generateNodePackageJson(namespaceName);
    writeFileSyncSafe(packageJsonPath, packageJsonContent);
    files.push({ type: 'config', name: 'package.json', path: packageJsonPath });

    // Generate app.js
    const appJsPath = path.join(workspaceDir, 'app.js');
    const appJsContent = generateNodeAppJs(files, namespaceName);
    writeFileSyncSafe(appJsPath, appJsContent);
    files.push({ type: 'app', name: 'app.js', path: appJsPath });

    // Generate README.md
    const readmePath = path.join(workspaceDir, 'README.md');
    const readmeContent = `# ${namespaceName}

Generated Node.js backend project.

## Installation
\`\`\`bash
npm install
\`\`\`

## Running
\`\`\`bash
npm start
\`\`\`

## Development
\`\`\`bash
npm run dev
\`\`\`

## API Endpoints
${apis.map(api => `### ${api.name}
${api.endpoints.map(endpoint => `- \`${endpoint.method}\` \`${endpoint.path}\` - ${endpoint.description}`).join('\n')}`).join('\n')}
`;
    writeFileSyncSafe(readmePath, readmeContent);
    files.push({ type: 'docs', name: 'README.md', path: readmePath });

  } else if (projectType === 'python') {
    // Generate Python project
    const modelsDir = path.join(workspaceDir, 'models');
    ensureDirSync(modelsDir);
    
    for (const schema of schemas) {
      const modelName = schema.name?.replace(/\W/g, '') || 'Model';
      const filePath = path.join(modelsDir, `${modelName.toLowerCase()}.py`);
      const content = generatePythonModelFile(schema, modelName);
      writeFileSyncSafe(filePath, content);
      files.push({ type: 'model', name: `${modelName.toLowerCase()}.py`, path: filePath });
    }

    const routesDir = path.join(workspaceDir, 'routes');
    ensureDirSync(routesDir);
    
    for (const api of apis) {
      const apiName = api.name?.replace(/\W/g, '') || 'Api';
      const filePath = path.join(routesDir, `${apiName.toLowerCase()}.py`);
      const content = generatePythonRouteFile(api, schemas[0]?.name?.replace(/\W/g, '') || 'Model');
      writeFileSyncSafe(filePath, content);
      files.push({ type: 'route', name: `${apiName.toLowerCase()}.py`, path: filePath });
    }

    // Generate requirements.txt
    const requirementsPath = path.join(workspaceDir, 'requirements.txt');
    const requirementsContent = generatePythonRequirementsTxt();
    writeFileSyncSafe(requirementsPath, requirementsContent);
    files.push({ type: 'config', name: 'requirements.txt', path: requirementsPath });

    // Generate app.py
    const appPyPath = path.join(workspaceDir, 'app.py');
    const appPyContent = generatePythonAppPy(files, namespaceName);
    writeFileSyncSafe(appPyPath, appPyContent);
    files.push({ type: 'app', name: 'app.py', path: appPyPath });

    // Generate README.md
    const readmePath = path.join(workspaceDir, 'README.md');
    const readmeContent = `# ${namespaceName}

Generated Python Flask backend project.

## Installation
\`\`\`bash
pip install -r requirements.txt
\`\`\`

## Running
\`\`\`bash
python app.py
\`\`\`

## API Endpoints
${apis.map(api => `### ${api.name}
${api.endpoints.map(endpoint => `- \`${endpoint.method}\` \`${endpoint.path}\` - ${endpoint.description}`).join('\n')}`).join('\n')}
`;
    writeFileSyncSafe(readmePath, readmeContent);
    files.push({ type: 'docs', name: 'README.md', path: readmePath });
  }

  return { success: true, files, projectType };
} 
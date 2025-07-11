import express from 'express';
import { generateBackendCode } from './code-generator.js';
import fs from 'fs';
import path from 'path';

export function registerCodeGenerationHandlers(app) {
  app.post('/code-generation/generate-backend', async (req, res) => {
    try {
      const { namespaceId, schemas, apis, projectType = 'nodejs', namespaceName = 'Generated Project' } = req.body;
      if (!namespaceId || !Array.isArray(schemas) || !Array.isArray(apis)) {
        return res.status(400).json({ error: 'Missing or invalid parameters' });
      }
      const result = await generateBackendCode(namespaceId, schemas, apis, projectType, namespaceName);
      res.json(result);
    } catch (err) {
      console.error('Code generation error:', err);
      res.status(500).json({ error: 'Code generation failed', details: err.message });
    }
  });

  // List generated files for a namespace
  app.get('/code-generation/files/:namespaceId', (req, res) => {
    try {
      const { namespaceId } = req.params;
      const workspaceDir = path.join('workspaces', namespaceId);
      
      if (!fs.existsSync(workspaceDir)) {
        return res.json({ files: [] });
      }

      const files = [];
      function scanDirectory(dir, relativePath = '') {
        const items = fs.readdirSync(dir);
        for (const item of items) {
          const fullPath = path.join(dir, item);
          const relativeItemPath = path.join(relativePath, item);
          const stat = fs.statSync(fullPath);
          
          if (stat.isDirectory()) {
            files.push({
              name: item,
              path: relativeItemPath,
              type: 'directory'
            });
            scanDirectory(fullPath, relativeItemPath);
          } else {
            files.push({
              name: item,
              path: relativeItemPath,
              type: 'file',
              size: stat.size
            });
          }
        }
      }
      
      scanDirectory(workspaceDir);
      res.json({ files });
    } catch (err) {
      console.error('File listing error:', err);
      res.status(500).json({ error: 'Failed to list files', details: err.message });
    }
  });

  // Read file contents
  app.get('/code-generation/files/:namespaceId/*', (req, res) => {
    try {
      const { namespaceId } = req.params;
      const filePath = req.params[0]; // This captures everything after namespaceId/
      const fullPath = path.join('workspaces', namespaceId, filePath);
      
      if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ error: 'File not found' });
      }
      
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        return res.status(400).json({ error: 'Cannot read directory' });
      }
      
      const content = fs.readFileSync(fullPath, 'utf8');
      res.json({ 
        content,
        name: path.basename(filePath),
        path: filePath,
        size: stat.size
      });
    } catch (err) {
      console.error('File reading error:', err);
      res.status(500).json({ error: 'Failed to read file', details: err.message });
    }
  });
} 
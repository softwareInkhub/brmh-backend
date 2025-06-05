import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { docClient } from './dynamodb-client.js';
import { PutCommand, GetCommand, ScanCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import fs from 'fs';

const router = express.Router();

// Table names
const USERS_TABLE = 'users';
const FOLDERS_TABLE = 'BankStatements';
const FILES_TABLE = 'BankStatements';
const LINKS_TABLE = 'links';

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Authentication token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Auth routes
router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Query user by email
    const command = new ScanCommand({
      TableName: USERS_TABLE,
      FilterExpression: 'email = :email',
      ExpressionAttributeValues: {
        ':email': email
      }
    });

    const response = await docClient.send(command);
    const user = response.Items?.[0];

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET || 'your-secret-key');
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Check if user already exists
    const checkCommand = new ScanCommand({
      TableName: USERS_TABLE,
      FilterExpression: 'email = :email',
      ExpressionAttributeValues: {
        ':email': email
      }
    });

    const existingUser = await docClient.send(checkCommand);
    if (existingUser.Items?.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const id = uuidv4();
    const user = {
      id,
      email,
      password: hashedPassword,
      name,
      createdAt: new Date().toISOString()
    };

    // Save user to DynamoDB
    const putCommand = new PutCommand({
      TableName: USERS_TABLE,
      Item: user
    });

    await docClient.send(putCommand);

    const token = jwt.sign({ id, email }, process.env.JWT_SECRET || 'your-secret-key');
    res.status(201).json({
      message: 'Registration successful',
      token,
      user: { id, email, name }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Folder routes
router.get('/folders', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { parentFolderId } = req.query;
    let params = {
      TableName: FOLDERS_TABLE,
      FilterExpression: 'userId = :userId',
      ExpressionAttributeValues: { ':userId': userId },
    };
    if (parentFolderId) {
      params.FilterExpression += ' AND parentFolderId = :parentFolderId';
      params.ExpressionAttributeValues[':parentFolderId'] = parentFolderId;
    }
    const result = await docClient.send(new ScanCommand(params));
    res.status(200).json({ folders: result.Items || [] });
  } catch (error) {
    console.error('List folders error:', error);
    res.status(500).json({ error: 'Failed to list folders' });
  }
});

// File routes
router.get('/files', authenticateToken, async (req, res) => {
  try {
    const command = new ScanCommand({
      TableName: FILES_TABLE,
      FilterExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': req.user.id
      }
    });

    const response = await docClient.send(command);
    res.json(response.Items || []);
  } catch (error) {
    console.error('Get files error:', error);
    res.status(500).json({ error: 'Failed to get files' });
  }
});

// Link routes
router.get('/links', authenticateToken, async (req, res) => {
  try {
    const command = new ScanCommand({
      TableName: LINKS_TABLE,
      FilterExpression: 'userId = :userId',
      ExpressionAttributeValues: {
        ':userId': req.user.id
      }
    });

    const response = await docClient.send(command);
    res.json(response.Items || []);
  } catch (error) {
    console.error('Get links error:', error);
    res.status(500).json({ error: 'Failed to get links' });
  }
});

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

router.post('/files', authenticateToken, async (req, res) => {
  try {
    const { fileName, mimeType, parentFolderId, s3Key, size, isReadOnly } = req.body;
    const fileId = uuidv4();
    const userId = req.user.id;

    const fileItem = {
      id: fileId, // Partition key
      fileId,
      fileName,
      mimeType,
      parentFolderId,
      s3Key,
      size,
      isReadOnly,
      userId, // Set userId for filtering
      createdAt: new Date().toISOString(),
    };

    const putCommand = new PutCommand({
      TableName: FILES_TABLE,
      Item: fileItem,
    });

    await docClient.send(putCommand);

    res.status(201).json(fileItem);
  } catch (error) {
    console.error('Create file error:', error);
    res.status(500).json({ error: 'Failed to create file' });
  }
});

// Upload file (metadata only, placeholder for S3 logic)
router.post('/files/upload', authenticateToken, async (req, res) => {
  try {
    // For simplicity, assume file metadata is sent in body (no actual file upload here)
    const { fileName, mimeType, parentFolderId, size, isReadOnly } = req.body;
    const fileId = uuidv4();
    const userId = req.user.id;
    const s3Key = `${userId}/${Date.now()}-${fileName}`;
    const fileItem = {
      fileId,
      fileName,
      s3Key,
      size,
      mimeType,
      userId,
      parentFolderId,
      sharedWith: [],
      isReadOnly,
      createdAt: new Date().toISOString(),
    };
    await docClient.send(new PutCommand({ TableName: FILES_TABLE, Item: fileItem }));
    res.status(201).json(fileItem);
  } catch (error) {
    console.error('Upload file error:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// List files (with optional parentFolderId)
router.get('/files/list', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { parentFolderId } = req.query;
    let params = {
      TableName: FILES_TABLE,
      FilterExpression: 'userId = :userId',
      ExpressionAttributeValues: { ':userId': userId },
    };
    if (parentFolderId) {
      params.FilterExpression += ' AND parentFolderId = :parentFolderId';
      params.ExpressionAttributeValues[':parentFolderId'] = parentFolderId;
    }
    const result = await docClient.send(new ScanCommand(params));
    res.status(200).json({ files: result.Items || [] });
  } catch (error) {
    console.error('List files error:', error);
    res.status(500).json({ error: 'Failed to list files' });
  }
});

// Get file content (placeholder, no S3 logic)
router.get('/files/content/:fileId', authenticateToken, async (req, res) => {
  try {
    const { fileId } = req.params;
    const userId = req.user.id;
    const result = await docClient.send(new ScanCommand({
      TableName: FILES_TABLE,
      FilterExpression: 'fileId = :fileId AND userId = :userId',
      ExpressionAttributeValues: { ':fileId': fileId, ':userId': userId },
    }));
    const file = result.Items?.[0];
    if (!file) return res.status(404).json({ error: 'File not found' });
    // Placeholder: return file metadata (no S3 content)
    res.status(200).json({ content: `File content for ${file.fileName} (S3 logic not implemented)` });
  } catch (error) {
    console.error('Get file content error:', error);
    res.status(500).json({ error: 'Failed to get file content' });
  }
});

// Delete file (placeholder, no S3 logic)
router.delete('/files/:fileId', authenticateToken, async (req, res) => {
  try {
    const { fileId } = req.params;
    const userId = req.user.id;
    // Check file ownership
    const result = await docClient.send(new ScanCommand({
      TableName: FILES_TABLE,
      FilterExpression: 'fileId = :fileId AND userId = :userId',
      ExpressionAttributeValues: { ':fileId': fileId, ':userId': userId },
    }));
    const file = result.Items?.[0];
    if (!file) return res.status(404).json({ error: 'File not found or access denied' });
    await docClient.send(new DeleteCommand({ TableName: FILES_TABLE, Key: { fileId } }));
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Delete file error:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// Rename file
router.patch('/files/:fileId/rename', authenticateToken, async (req, res) => {
  try {
    const { fileId } = req.params;
    const { newName } = req.body;
    const userId = req.user.id;
    if (!newName) return res.status(400).json({ error: 'New name is required' });
    // Check file ownership
    const result = await docClient.send(new ScanCommand({
      TableName: FILES_TABLE,
      FilterExpression: 'fileId = :fileId AND userId = :userId',
      ExpressionAttributeValues: { ':fileId': fileId, ':userId': userId },
    }));
    const file = result.Items?.[0];
    if (!file) return res.status(404).json({ error: 'File not found or access denied' });
    await docClient.send(new PutCommand({
      TableName: FILES_TABLE,
      Item: { ...file, fileName: newName },
    }));
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Rename file error:', error);
    res.status(500).json({ error: 'Failed to rename file' });
  }
});

// Share file with another user
router.post('/files/:fileId/share', authenticateToken, async (req, res) => {
  try {
    const { fileId } = req.params;
    const { shareWithUserId } = req.body;
    const userId = req.user.id;
    if (!shareWithUserId) return res.status(400).json({ error: 'User ID to share with is required' });
    // Check file ownership
    const result = await docClient.send(new ScanCommand({
      TableName: FILES_TABLE,
      FilterExpression: 'fileId = :fileId AND userId = :userId',
      ExpressionAttributeValues: { ':fileId': fileId, ':userId': userId },
    }));
    const file = result.Items?.[0];
    if (!file) return res.status(404).json({ error: 'File not found or access denied' });
    const sharedWith = file.sharedWith || [];
    if (!sharedWith.includes(shareWithUserId)) sharedWith.push(shareWithUserId);
    await docClient.send(new PutCommand({
      TableName: FILES_TABLE,
      Item: { ...file, sharedWith },
    }));
    res.status(200).json({ success: true, sharedWith });
  } catch (error) {
    console.error('Share file error:', error);
    res.status(500).json({ error: 'Failed to share file' });
  }
});

// Create folder
router.post('/folders', authenticateToken, async (req, res) => {
  try {
    const { folderName, parentFolderId } = req.body;
    const userId = req.user.id;
    if (!folderName) return res.status(400).json({ error: 'Folder name is required' });
    const folderId = uuidv4();
    const folder = {
      id: folderId, // Add id for DynamoDB partition key
      folderId,
      folderName,
      userId,
      parentFolderId: parentFolderId || null,
      createdAt: new Date().toISOString(),
    };
    await docClient.send(new PutCommand({ TableName: FOLDERS_TABLE, Item: folder }));
    res.status(201).json(folder);
  } catch (error) {
    console.error('Create folder error:', error);
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

// Get folder info
router.get('/folders/:folderId', authenticateToken, async (req, res) => {
  try {
    const { folderId } = req.params;
    const userId = req.user.id;
    const result = await docClient.send(new ScanCommand({
      TableName: FOLDERS_TABLE,
      FilterExpression: 'folderId = :folderId AND userId = :userId',
      ExpressionAttributeValues: { ':folderId': folderId, ':userId': userId },
    }));
    const folder = result.Items?.[0];
    if (!folder) return res.status(404).json({ error: 'Folder not found' });
    res.status(200).json(folder);
  } catch (error) {
    console.error('Get folder info error:', error);
    res.status(500).json({ error: 'Failed to get folder info' });
  }
});

// Delete folder
router.delete('/folders/:folderId', authenticateToken, async (req, res) => {
  try {
    const { folderId } = req.params;
    const userId = req.user.id;
    // Check folder ownership
    const result = await docClient.send(new ScanCommand({
      TableName: FOLDERS_TABLE,
      FilterExpression: 'folderId = :folderId AND userId = :userId',
      ExpressionAttributeValues: { ':folderId': folderId, ':userId': userId },
    }));
    const folder = result.Items?.[0];
    if (!folder) return res.status(404).json({ error: 'Folder not found or access denied' });
    await docClient.send(new DeleteCommand({ TableName: FOLDERS_TABLE, Key: { folderId } }));
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Delete folder error:', error);
    res.status(500).json({ error: 'Failed to delete folder' });
  }
});

// Create a new link
router.post('/links', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, url } = req.body;
    if (!name || !url) return res.status(400).json({ error: 'Name and URL are required' });
    const id = uuidv4();
    const createdAt = new Date().toISOString();
    const item = { id, userId, name, url, createdAt };
    await docClient.send(new PutCommand({ TableName: LINKS_TABLE, Item: item }));
    res.status(201).json(item);
  } catch (error) {
    console.error('Create link error:', error);
    res.status(500).json({ error: 'Failed to create link' });
  }
});

// List links for a user
router.get('/links', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const command = new ScanCommand({
      TableName: LINKS_TABLE,
      FilterExpression: 'userId = :userId',
      ExpressionAttributeValues: { ':userId': userId },
    });
    const data = await docClient.send(command);
    res.status(200).json({ links: data.Items || [] });
  } catch (error) {
    console.error('List links error:', error);
    res.status(500).json({ error: 'Failed to fetch links' });
  }
});

// Delete a link
router.delete('/links/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    // Check link ownership
    const userId = req.user.id;
    const result = await docClient.send(new ScanCommand({
      TableName: LINKS_TABLE,
      FilterExpression: 'id = :id AND userId = :userId',
      ExpressionAttributeValues: { ':id': id, ':userId': userId },
    }));
    const link = result.Items?.[0];
    if (!link) return res.status(404).json({ error: 'Link not found or access denied' });
    await docClient.send(new DeleteCommand({ TableName: LINKS_TABLE, Key: { id } }));
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Delete link error:', error);
    res.status(500).json({ error: 'Failed to delete link' });
  }
});

export default router; 
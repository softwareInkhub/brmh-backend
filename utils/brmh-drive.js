import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, CopyObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, DeleteCommand, QueryCommand, ScanCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

// Initialize AWS clients
const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

// Configuration
const BUCKET_NAME = 'brmh';
const DRIVE_FOLDER = 'brmh-drive';
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const CRUD_API_BASE_URL = process.env.CRUD_API_BASE_URL || 'http://localhost:5001';
const ALLOWED_MIME_TYPES = [
  'text/plain', 'text/html', 'text/css', 'text/javascript',
  'application/json', 'application/xml', 'application/pdf',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm', 'video/ogg',
  'audio/mpeg', 'audio/ogg', 'audio/wav',
  'application/zip', 'application/x-rar-compressed',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
];

// Utility functions
function generateFileId() {
  return `FILE_${uuidv4().replace(/-/g, '')}`;
}

function generateFolderId() {
  return `FOLDER_${uuidv4().replace(/-/g, '')}`;
}

function getS3Key(userId, filePath, fileName) {
  return `${DRIVE_FOLDER}/users/${userId}/${filePath}/${fileName}`.replace(/\/+/g, '/');
}

function getFolderS3Key(userId, folderPath) {
  return `${DRIVE_FOLDER}/users/${userId}/${folderPath}`.replace(/\/+/g, '/');
}

function validateMimeType(mimeType) {
  return ALLOWED_MIME_TYPES.includes(mimeType);
}

function validateFileSize(size) {
  return size <= MAX_FILE_SIZE;
}

// File Operations
export async function uploadFile(userId, fileData, parentId = 'ROOT') {
  try {
    const { name, mimeType, size, content, tags = [] } = fileData;
    
    // Validation
    if (!name || !mimeType || !size || !content) {
      throw new Error('Missing required file data');
    }
    
    if (!validateMimeType(mimeType)) {
      throw new Error('Unsupported file type');
    }
    
    if (!validateFileSize(size)) {
      throw new Error('File size exceeds limit');
    }
    
    const fileId = generateFileId();
    const timestamp = new Date().toISOString();
    
    // Get parent folder path
    let parentPath = '';
    if (parentId !== 'ROOT') {
      const parentFolder = await getFolderById(userId, parentId);
      if (!parentFolder) {
        throw new Error(`Parent folder with ID '${parentId}' not found. Please create the parent folder first or use 'ROOT' as parentId.`);
      }
      parentPath = parentFolder.path || '';
    }
    
    const s3Key = getS3Key(userId, parentPath, name);
    
    // Upload to S3
    await s3Client.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: content,
      ContentType: mimeType,
      Metadata: {
        userId,
        fileId,
        parentId,
        tags: tags.join(',')
      }
    }));
    
    // Save metadata to DynamoDB using CRUD API
    const fileMetadata = {
      tableName: 'brmh-drive-files',
      item: {
        id: fileId,
        name,
        type: 'file',
        parentId,
        path: parentPath,
        s3Key,
        mimeType,
        size,
        tags,
        createdAt: timestamp,
        updatedAt: timestamp,
        ownerId: userId
      }
    };
    
    // Use the existing CRUD API
    const response = await fetch(`${CRUD_API_BASE_URL}/crud?tableName=brmh-drive-files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fileMetadata)
    });
    
    if (!response.ok) {
      throw new Error('Failed to save file metadata');
    }
    
    return {
      success: true,
      fileId,
      name,
      s3Key,
      size,
      mimeType,
      createdAt: timestamp
    };
    
  } catch (error) {
    console.error('Error uploading file:', error);
    throw error;
  }
}

export async function createFolder(userId, folderData, parentId = 'ROOT') {
  try {
    const { name, description = '' } = folderData;
    
    if (!name) {
      throw new Error('Folder name is required');
    }
    
    const folderId = generateFolderId();
    const timestamp = new Date().toISOString();
    
    // Get parent folder path
    let parentPath = '';
    if (parentId !== 'ROOT') {
      const parentFolder = await getFolderById(userId, parentId);
      if (!parentFolder) {
        throw new Error(`Parent folder with ID '${parentId}' not found. Please create the parent folder first or use 'ROOT' as parentId.`);
      }
      parentPath = parentFolder.path || '';
    }
    
    const folderPath = parentPath ? `${parentPath}/${name}` : name;
    const s3Key = getFolderS3Key(userId, folderPath);
    
    // Create placeholder in S3 (optional, for consistency)
    await s3Client.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: `${s3Key}/.folder`,
      Body: JSON.stringify({ type: 'folder', created: timestamp }),
      ContentType: 'application/json'
    }));
    
    // Save metadata to DynamoDB using CRUD API
    const folderMetadata = {
      tableName: 'brmh-drive-files',
      item: {
        id: folderId,
        name,
        type: 'folder',
        parentId,
        path: folderPath,
        s3Key,
        description,
        createdAt: timestamp,
        updatedAt: timestamp,
        ownerId: userId
      }
    };
    
    // Use the existing CRUD API
    const response = await fetch(`${CRUD_API_BASE_URL}/crud?tableName=brmh-drive-files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(folderMetadata)
    });
    
    if (!response.ok) {
      throw new Error('Failed to save folder metadata');
    }
    
    return {
      success: true,
      folderId,
      name,
      path: folderPath,
      createdAt: timestamp
    };
    
  } catch (error) {
    console.error('Error creating folder:', error);
    throw error;
  }
}

export async function getFileById(userId, fileId) {
  try {
    const response = await fetch(`${CRUD_API_BASE_URL}/crud?tableName=brmh-drive-files&id=${fileId}`, {
      method: 'GET'
    });
    
    if (!response.ok) {
      return null;
    }
    
    const result = await response.json();
    const file = result.item;
    
    // Verify the file belongs to the user
    if (file && file.ownerId === userId) {
      return file;
    }
    
    return null;
  } catch (error) {
    console.error('Error getting file:', error);
    throw error;
  }
}

export async function getFolderById(userId, folderId) {
  try {
    const response = await fetch(`${CRUD_API_BASE_URL}/crud?tableName=brmh-drive-files&id=${folderId}`, {
      method: 'GET'
    });
    
    if (!response.ok) {
      return null;
    }
    
    const result = await response.json();
    const folder = result.item;
    
    // Verify the folder belongs to the user
    if (folder && folder.ownerId === userId) {
      return folder;
    }
    
    return null;
  } catch (error) {
    console.error('Error getting folder:', error);
    throw error;
  }
}

export async function listFiles(userId, parentId = 'ROOT', limit = 50, nextToken = null) {
  try {
    // For now, use a simple scan approach - in production you'd use GSI
    const response = await fetch(`${CRUD_API_BASE_URL}/crud?tableName=brmh-drive-files&pagination=true&itemPerPage=${limit}`, {
      method: 'GET'
    });
    
    if (!response.ok) {
      return { files: [], nextToken: null };
    }
    
    const result = await response.json();
    const files = result.items?.filter(item => 
      item.ownerId === userId && 
      item.type === 'file' && 
      item.parentId === parentId
    ) || [];
    
    return {
      files,
      nextToken: result.nextToken
    };
  } catch (error) {
    console.error('Error listing files:', error);
    throw error;
  }
}

export async function listFolders(userId, parentId = 'ROOT', limit = 50, nextToken = null) {
  try {
    // For now, use a simple scan approach - in production you'd use GSI
    const response = await fetch(`${CRUD_API_BASE_URL}/crud?tableName=brmh-drive-files&pagination=true&itemPerPage=${limit}`, {
      method: 'GET'
    });
    
    if (!response.ok) {
      return { folders: [], nextToken: null };
    }
    
    const result = await response.json();
    const folders = result.items?.filter(item => 
      item.ownerId === userId && 
      item.type === 'folder' && 
      item.parentId === parentId
    ) || [];
    
    return {
      folders,
      nextToken: result.nextToken
    };
  } catch (error) {
    console.error('Error listing folders:', error);
    throw error;
  }
}

export async function listFolderContents(userId, folderId, limit = 50, nextToken = null) {
  try {
    const files = await listFiles(userId, folderId, limit, nextToken);
    const folders = await listFolders(userId, folderId, limit, nextToken);
    
    return {
      files: files.files,
      folders: folders.folders,
      nextToken: files.nextToken || folders.nextToken
    };
  } catch (error) {
    console.error('Error listing folder contents:', error);
    throw error;
  }
}

export async function renameFile(userId, fileId, newName) {
  try {
    const file = await getFileById(userId, fileId);
    if (!file) {
      throw new Error('File not found');
    }
    
    if (file.type === 'folder') {
      throw new Error('Cannot rename folders with this method');
    }
    
    const timestamp = new Date().toISOString();
    
    // Update using CRUD API
    const updateData = {
      tableName: 'brmh-drive-files',
      key: {
        id: fileId
      },
      updates: {
        name: newName,
        updatedAt: timestamp
      }
    };
    
    const response = await fetch(`${CRUD_API_BASE_URL}/crud?tableName=brmh-drive-files`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateData)
    });
    
    if (!response.ok) {
      throw new Error('Failed to rename file');
    }
    
    return {
      success: true,
      fileId,
      newName,
      updatedAt: timestamp
    };
    
  } catch (error) {
    console.error('Error renaming file:', error);
    throw error;
  }
}

export async function deleteFile(userId, fileId) {
  try {
    const file = await getFileById(userId, fileId);
    if (!file) {
      throw new Error('File not found');
    }
    
    // Delete from S3
    await s3Client.send(new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: file.s3Key
    }));
    
    // Delete from DynamoDB using CRUD API
    const deleteData = {
      tableName: 'brmh-drive-files',
      id: fileId
    };
    
    const response = await fetch(`${CRUD_API_BASE_URL}/crud?tableName=brmh-drive-files`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(deleteData)
    });
    
    if (!response.ok) {
      throw new Error('Failed to delete file metadata');
    }
    
    return {
      success: true,
      fileId,
      deletedAt: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('Error deleting file:', error);
    throw error;
  }
}

export async function generateDownloadUrl(userId, fileId) {
  try {
    const file = await getFileById(userId, fileId);
    if (!file) {
      throw new Error('File not found');
    }
    
    // Generate presigned URL (expires in 1 hour)
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: file.s3Key
    });
    
    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    
    return {
      success: true,
      downloadUrl: presignedUrl,
      expiresIn: 3600,
      fileName: file.name,
      mimeType: file.mimeType,
      size: file.size
    };
    
  } catch (error) {
    console.error('Error generating download URL:', error);
    throw error;
  }
}

// Sharing Operations
export async function shareFile(userId, fileId, shareData) {
  try {
    const { sharedWithUserId, permissions = ['read'], expiresAt = null, message = '' } = shareData;
    
    if (!sharedWithUserId) {
      throw new Error('sharedWithUserId is required');
    }
    
    // Verify the file exists and belongs to the user
    const file = await getFileById(userId, fileId);
    if (!file) {
      throw new Error('File not found or access denied');
    }
    
    const shareId = `SHARE_${uuidv4().replace(/-/g, '')}`;
    const timestamp = new Date().toISOString();
    
    // Create share metadata
    const shareMetadata = {
      tableName: 'brmh-shared-drive',
      item: {
        id: shareId,
        type: 'file',
        originalId: fileId,
        originalOwnerId: userId,
        sharedWithUserId,
        permissions,
        expiresAt,
        message,
        originalName: file.name,
        originalMimeType: file.mimeType,
        originalSize: file.size,
        originalS3Key: file.s3Key,
        originalPath: file.path,
        originalTags: file.tags,
        createdAt: timestamp,
        updatedAt: timestamp,
        status: 'active'
      }
    };
    
    // Save to DynamoDB using CRUD API
    const response = await fetch(`${CRUD_API_BASE_URL}/crud?tableName=brmh-shared-drive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(shareMetadata)
    });
    
    if (!response.ok) {
      throw new Error('Failed to save share metadata');
    }
    
    return {
      success: true,
      shareId,
      fileId,
      sharedWithUserId,
      permissions,
      expiresAt,
      createdAt: timestamp
    };
    
  } catch (error) {
    console.error('Error sharing file:', error);
    throw error;
  }
}

export async function shareFolder(userId, folderId, shareData) {
  try {
    const { sharedWithUserId, permissions = ['read'], expiresAt = null, message = '', includeSubfolders = false } = shareData;
    
    if (!sharedWithUserId) {
      throw new Error('sharedWithUserId is required');
    }
    
    // Verify the folder exists and belongs to the user
    const folder = await getFolderById(userId, folderId);
    if (!folder) {
      throw new Error('Folder not found or access denied');
    }
    
    const shareId = `SHARE_${uuidv4().replace(/-/g, '')}`;
    const timestamp = new Date().toISOString();
    
    // Create share metadata
    const shareMetadata = {
      tableName: 'brmh-shared-drive',
      item: {
        id: shareId,
        type: 'folder',
        originalId: folderId,
        originalOwnerId: userId,
        sharedWithUserId,
        permissions,
        expiresAt,
        message,
        includeSubfolders,
        originalName: folder.name,
        originalPath: folder.path,
        originalS3Key: folder.s3Key,
        originalDescription: folder.description,
        createdAt: timestamp,
        updatedAt: timestamp,
        status: 'active'
      }
    };
    
    // Save to DynamoDB using CRUD API
    const response = await fetch(`${CRUD_API_BASE_URL}/crud?tableName=brmh-shared-drive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(shareMetadata)
    });
    
    if (!response.ok) {
      throw new Error('Failed to save share metadata');
    }
    
    return {
      success: true,
      shareId,
      folderId,
      sharedWithUserId,
      permissions,
      expiresAt,
      includeSubfolders,
      createdAt: timestamp
    };
    
  } catch (error) {
    console.error('Error sharing folder:', error);
    throw error;
  }
}

export async function getSharedWithMe(userId, limit = 50, nextToken = null) {
  try {
    // Get items shared with this user
    const response = await fetch(`${CRUD_API_BASE_URL}/crud?tableName=brmh-shared-drive&pagination=true&itemPerPage=${limit}`, {
      method: 'GET'
    });
    
    if (!response.ok) {
      return { sharedItems: [], nextToken: null };
    }
    
    const result = await response.json();
    const sharedItems = result.items?.filter(item => 
      item.sharedWithUserId === userId && 
      item.status === 'active' &&
      (!item.expiresAt || new Date(item.expiresAt) > new Date())
    ) || [];
    
    return {
      sharedItems,
      nextToken: result.nextToken
    };
  } catch (error) {
    console.error('Error getting shared items:', error);
    throw error;
  }
}

export async function getSharedByMe(userId, limit = 50, nextToken = null) {
  try {
    // Get items shared by this user
    const response = await fetch(`${CRUD_API_BASE_URL}/crud?tableName=brmh-shared-drive&pagination=true&itemPerPage=${limit}`, {
      method: 'GET'
    });
    
    if (!response.ok) {
      return { sharedItems: [], nextToken: null };
    }
    
    const result = await response.json();
    const sharedItems = result.items?.filter(item => 
      item.originalOwnerId === userId && 
      item.status === 'active'
    ) || [];
    
    return {
      sharedItems,
      nextToken: result.nextToken
    };
  } catch (error) {
    console.error('Error getting shared by me items:', error);
    throw error;
  }
}

export async function updateSharePermissions(userId, shareId, permissions) {
  try {
    // Get the share record
    const response = await fetch(`${CRUD_API_BASE_URL}/crud?tableName=brmh-shared-drive&id=${shareId}`, {
      method: 'GET'
    });
    
    if (!response.ok) {
      throw new Error('Share not found');
    }
    
    const result = await response.json();
    const share = result.item;
    
    // Verify the user owns this share
    if (share.originalOwnerId !== userId) {
      throw new Error('Access denied');
    }
    
    const timestamp = new Date().toISOString();
    
    // Update permissions
    const updateData = {
      tableName: 'brmh-shared-drive',
      key: {
        id: shareId
      },
      updates: {
        permissions,
        updatedAt: timestamp
      }
    };
    
    const updateResponse = await fetch(`${CRUD_API_BASE_URL}/crud?tableName=brmh-shared-drive`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateData)
    });
    
    if (!updateResponse.ok) {
      throw new Error('Failed to update share permissions');
    }
    
    return {
      success: true,
      shareId,
      permissions,
      updatedAt: timestamp
    };
    
  } catch (error) {
    console.error('Error updating share permissions:', error);
    throw error;
  }
}

export async function revokeShare(userId, shareId) {
  try {
    // Get the share record
    const response = await fetch(`${CRUD_API_BASE_URL}/crud?tableName=brmh-shared-drive&id=${shareId}`, {
      method: 'GET'
    });
    
    if (!response.ok) {
      throw new Error('Share not found');
    }
    
    const result = await response.json();
    const share = result.item;
    
    // Verify the user owns this share
    if (share.originalOwnerId !== userId) {
      throw new Error('Access denied');
    }
    
    const timestamp = new Date().toISOString();
    
    // Update status to revoked
    const updateData = {
      tableName: 'brmh-shared-drive',
      key: {
        id: shareId
      },
      updates: {
        status: 'revoked',
        updatedAt: timestamp
      }
    };
    
    const updateResponse = await fetch(`${CRUD_API_BASE_URL}/crud?tableName=brmh-shared-drive`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateData)
    });
    
    if (!updateResponse.ok) {
      throw new Error('Failed to revoke share');
    }
    
    return {
      success: true,
      shareId,
      status: 'revoked',
      revokedAt: timestamp
    };
    
  } catch (error) {
    console.error('Error revoking share:', error);
    throw error;
  }
}

export async function getSharedFileContent(userId, shareId) {
  try {
    // Get the share record
    const response = await fetch(`${CRUD_API_BASE_URL}/crud?tableName=brmh-shared-drive&id=${shareId}`, {
      method: 'GET'
    });
    
    if (!response.ok) {
      throw new Error('Share not found');
    }
    
    const result = await response.json();
    const share = result.item;
    
    // Verify the user has access to this share
    if (share.sharedWithUserId !== userId) {
      throw new Error('Access denied');
    }
    
    // Check if share is still active
    if (share.status !== 'active') {
      throw new Error('Share has been revoked');
    }
    
    // Check if share has expired
    if (share.expiresAt && new Date(share.expiresAt) <= new Date()) {
      throw new Error('Share has expired');
    }
    
    // Check permissions
    if (!share.permissions.includes('read')) {
      throw new Error('No read permission');
    }
    
    // Generate download URL for the original file
    const downloadResult = await generateDownloadUrl(share.originalOwnerId, share.originalId);
    
    return {
      success: true,
      shareId,
      fileName: share.originalName,
      mimeType: share.originalMimeType,
      size: share.originalSize,
      downloadUrl: downloadResult.downloadUrl,
      expiresIn: downloadResult.expiresIn,
      permissions: share.permissions,
      sharedBy: share.originalOwnerId,
      sharedAt: share.createdAt
    };
    
  } catch (error) {
    console.error('Error getting shared file content:', error);
    throw error;
  }
}

// Initialize drive system
export async function initializeDriveSystem() {
  try {
    console.log('Initializing BRMH Drive system...');
    
    // Create the brmh-drive folder structure in S3
    try {
      await s3Client.send(new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${DRIVE_FOLDER}/.system`,
        Body: JSON.stringify({ 
          initialized: true, 
          timestamp: new Date().toISOString(),
          version: '1.0.0'
        }),
        ContentType: 'application/json'
      }));
      console.log('BRMH Drive system folder created in S3');
    } catch (error) {
      console.log('BRMH Drive system folder already exists or error:', error.message);
    }
    
    console.log('BRMH Drive system initialization complete');
    return { success: true };
    
  } catch (error) {
    console.error('Error initializing drive system:', error);
    throw error;
  }
}

export default {
  // File operations
  uploadFile,
  getFileById,
  listFiles,
  renameFile,
  deleteFile,
  
  // Folder operations
  createFolder,
  getFolderById,
  listFolders,
  listFolderContents,
  
  // Download operations
  generateDownloadUrl,
  
  // Sharing operations
  shareFile,
  shareFolder,
  getSharedWithMe,
  getSharedByMe,
  updateSharePermissions,
  revokeShare,
  getSharedFileContent,
  
  // System
  initializeDriveSystem
};

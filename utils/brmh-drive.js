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
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv', 'application/csv'
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

// Namespace-aware path helpers
function slugifyName(name = '') {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function getS3KeyWithNamespace(userId, filePath, fileName, namespace) {
  // Namespace is now REQUIRED - no fallback to users/{userId}
  if (!namespace || !namespace.id || !namespace.name) {
    throw new Error('namespace with id and name is required for all drive operations');
  }
  
  if (!userId) {
    throw new Error('userId is required for all drive operations');
  }
  
  const nsSegment = `namespaces/${slugifyName(namespace.name)}_${namespace.id}/users/${userId}`;
  return `${DRIVE_FOLDER}/${nsSegment}/${filePath}/${fileName}`.replace(/\/+/g, '/');
}

function getFolderS3KeyWithNamespace(userId, folderPath, namespace) {
  // Namespace is now REQUIRED - no fallback to users/{userId}
  if (!namespace || !namespace.id || !namespace.name) {
    throw new Error('namespace with id and name is required for all drive operations');
  }
  
  if (!userId) {
    throw new Error('userId is required for all drive operations');
  }
  
  const nsSegment = `namespaces/${slugifyName(namespace.name)}_${namespace.id}/users/${userId}`;
  return `${DRIVE_FOLDER}/${nsSegment}/${folderPath}`.replace(/\/+/g, '/');
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
    const { name, mimeType, size, content, tags = [], namespace = null } = fileData;
    
    // Debug logging
    console.log('=== UPLOADFILE DEBUG ===');
    console.log('userId:', userId);
    console.log('parentId:', parentId);
    console.log('namespace:', namespace);
    console.log('fileData:', { name, mimeType, size, tags });
    
    // REQUIRED: userId validation
    if (!userId) {
      throw new Error('userId is required for file upload');
    }
    
    // REQUIRED: namespace validation
    if (!namespace || !namespace.id || !namespace.name) {
      throw new Error('namespace with id and name is required for file upload');
    }
    
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
    
    const s3Key = getS3KeyWithNamespace(userId, parentPath, name, namespace);
    
    console.log('=== S3 KEY GENERATION ===');
    console.log('userId:', userId);
    console.log('parentPath:', parentPath);
    console.log('name:', name);
    console.log('namespace:', namespace);
    console.log('Generated s3Key:', s3Key);
    
    // Convert base64 content back to binary data for S3
    const binaryContent = Buffer.from(content, 'base64');
    
    // Upload to S3
    await s3Client.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: binaryContent,
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
        namespaceId: namespace?.id || null,
        namespaceName: namespace?.name || null,
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
    const { name, description = '', namespaceId, namespaceName } = folderData;
    
    // REQUIRED: userId validation
    if (!userId) {
      throw new Error('userId is required for folder creation');
    }
    
    // REQUIRED: namespace validation
    if (!namespaceId || !namespaceName) {
      throw new Error('namespaceId and namespaceName are required in folderData for folder creation');
    }
    
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
    const s3Key = getFolderS3KeyWithNamespace(userId, folderPath, { id: folderData?.namespaceId || null, name: folderData?.namespaceName || null });
    
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
        namespaceId: folderData?.namespaceId || null,
        namespaceName: folderData?.namespaceName || null,
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

export async function listFiles(userId, parentId = 'ROOT', limit = 50, nextToken = null, namespaceId = null) {
  try {
    // REQUIRED: userId validation
    if (!userId) {
      throw new Error('userId is required for listing files');
    }
    
    // REQUIRED: namespaceId validation
    if (!namespaceId) {
      throw new Error('namespaceId is required for listing files');
    }
    
    // For now, use a simple scan approach - in production you'd use GSI
    const response = await fetch(`${CRUD_API_BASE_URL}/crud?tableName=brmh-drive-files&pagination=true&itemPerPage=${limit}`, {
      method: 'GET'
    });
    
    if (!response.ok) {
      return { files: [], nextToken: null };
    }
    
    const result = await response.json();
    // REQUIRED: Always filter by namespaceId - no optional logic
    const files = result.items?.filter(item => 
      item.ownerId === userId && 
      item.type === 'file' && 
      item.parentId === parentId &&
      item.namespaceId === namespaceId
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

export async function listFolders(userId, parentId = 'ROOT', limit = 50, nextToken = null, namespaceId = null) {
  try {
    // REQUIRED: userId validation
    if (!userId) {
      throw new Error('userId is required for listing folders');
    }
    
    // REQUIRED: namespaceId validation
    if (!namespaceId) {
      throw new Error('namespaceId is required for listing folders');
    }
    
    // For now, use a simple scan approach - in production you'd use GSI
    const response = await fetch(`${CRUD_API_BASE_URL}/crud?tableName=brmh-drive-files&pagination=true&itemPerPage=${limit}`, {
      method: 'GET'
    });
    
    if (!response.ok) {
      return { folders: [], nextToken: null };
    }
    
    const result = await response.json();
    // REQUIRED: Always filter by namespaceId - no optional logic
    const folders = result.items?.filter(item => 
      item.ownerId === userId && 
      item.type === 'folder' && 
      item.parentId === parentId &&
      item.namespaceId === namespaceId
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

export async function listFolderContents(userId, folderId, limit = 50, nextToken = null, namespaceId = null) {
  try {
    // REQUIRED: userId validation
    if (!userId) {
      throw new Error('userId is required for listing folder contents');
    }
    
    // REQUIRED: namespaceId validation
    if (!namespaceId) {
      throw new Error('namespaceId is required for listing folder contents');
    }
    
    const files = await listFiles(userId, folderId, limit, nextToken, namespaceId);
    const folders = await listFolders(userId, folderId, limit, nextToken, namespaceId);
    
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
    
    if (!newName || newName.trim() === '') {
      throw new Error('New file name is required');
    }
    
    const timestamp = new Date().toISOString();
    
    // Calculate new path and S3 key
    const newPath = file.parentId === 'ROOT' 
      ? newName.trim() 
      : file.path.replace(file.name, newName.trim());
    
    const newS3Key = getS3KeyWithNamespace(userId, newPath.replace(`/${newName.trim()}`, ''), newName.trim(), { id: file.namespaceId, name: file.namespaceName });
    
    // Update using CRUD API
    const updateData = {
      tableName: 'brmh-drive-files',
      key: {
        id: fileId
      },
      updates: {
        name: newName.trim(),
        path: newPath,
        s3Key: newS3Key,
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
    
    // Update S3 file (copy to new location and delete old one)
    console.log(`🔄 Updating S3 file: ${file.s3Key} → ${newS3Key}`);
    try {
      // Copy file to new location
      console.log(`📋 Copying file to new location: ${newS3Key}`);
      await s3Client.send(new CopyObjectCommand({
        Bucket: BUCKET_NAME,
        CopySource: `${BUCKET_NAME}/${file.s3Key}`,
        Key: newS3Key,
        Metadata: {
          userId,
          fileId,
          parentId: file.parentId,
          renamedAt: timestamp
        }
      }));
      console.log(`✅ File copied successfully`);
      
      // Delete old file
      console.log(`🗑️ Deleting old file: ${file.s3Key}`);
      await s3Client.send(new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: file.s3Key
      }));
      console.log(`✅ Old file deleted successfully`);
      
      console.log(`✅ File renamed in S3: ${file.s3Key} → ${newS3Key}`);
      
    } catch (error) {
      console.error(`❌ S3 file update failed:`, error.message);
      console.error(`❌ Full S3 error:`, error);
      console.error(`❌ Error code:`, error.code);
      console.error(`❌ Error name:`, error.name);
      console.log('S3 file update failed, but DynamoDB was updated');
    }
    
    return {
      success: true,
      fileId,
      oldName: file.name,
      newName: newName.trim(),
      oldPath: file.path,
      newPath,
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

export async function deleteFolder(userId, folderId) {
  try {
    const folder = await getFolderById(userId, folderId);
    if (!folder) {
      throw new Error('Folder not found');
    }
    
    if (folder.type !== 'folder') {
      throw new Error('Item is not a folder');
    }
    
    // First, get all contents of the folder (files and subfolders)
    const contents = await listFolderContents(userId, folderId, 1000); // Get up to 1000 items
    
    // Recursively delete all files in the folder
    let failedFiles = [];
    for (const file of contents.files || []) {
      try {
        await deleteFile(userId, file.id);
        console.log(`✅ Deleted file: ${file.name}`);
      } catch (error) {
        console.error(`❌ Failed to delete file ${file.name}:`, error);
        failedFiles.push({ file: file.name, error: error.message });
      }
    }

    // If any files failed to delete, throw an error
    if (failedFiles.length > 0) {
      throw new Error(`Failed to delete ${failedFiles.length} files: ${failedFiles.map(f => f.file).join(', ')}`);
    }
    
    // Recursively delete all subfolders
    let failedFolders = [];
    for (const subfolder of contents.folders || []) {
      try {
        await deleteFolder(userId, subfolder.id);
        console.log(`✅ Deleted subfolder: ${subfolder.name}`);
      } catch (error) {
        console.error(`❌ Failed to delete subfolder ${subfolder.name}:`, error);
        failedFolders.push({ folder: subfolder.name, error: error.message });
      }
    }

    // If any subfolders failed to delete, throw an error
    if (failedFolders.length > 0) {
      throw new Error(`Failed to delete ${failedFolders.length} subfolders: ${failedFolders.map(f => f.folder).join(', ')}`);
    }
    
    // Delete the folder's S3 marker (if it exists)
    try {
      await s3Client.send(new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${folder.s3Key}/.folder`
      }));
      console.log(`✅ Deleted folder marker from S3: ${folder.s3Key}/.folder`);
    } catch (error) {
      // S3 key might not exist, which is fine
      console.log('S3 folder marker not found, continuing...');
    }
    
    // Delete folder metadata from DynamoDB using CRUD API
    const deleteData = {
      tableName: 'brmh-drive-files',
      id: folderId
    };
    
    const response = await fetch(`${CRUD_API_BASE_URL}/crud?tableName=brmh-drive-files`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(deleteData)
    });
    
    if (!response.ok) {
      throw new Error('Failed to delete folder metadata');
    }
    
    return {
      success: true,
      folderId,
      folderName: folder.name,
      deletedAt: new Date().toISOString(),
      deletedItems: {
        files: contents.files?.length || 0,
        folders: contents.folders?.length || 0
      }
    };
    
  } catch (error) {
    console.error('Error deleting folder:', error);
    throw error;
  }
}

export async function renameFolder(userId, folderId, newName) {
  try {
    const folder = await getFolderById(userId, folderId);
    if (!folder) {
      throw new Error('Folder not found');
    }
    
    if (folder.type !== 'folder') {
      throw new Error('Item is not a folder');
    }
    
    if (!newName || newName.trim() === '') {
      throw new Error('New folder name is required');
    }
    
    const timestamp = new Date().toISOString();
    
    // Update folder name and path
    const newPath = folder.parentId === 'ROOT' 
      ? newName.trim() 
      : folder.path.replace(folder.name, newName.trim());
    
    // Calculate new S3 key
    const newS3Key = getFolderS3KeyWithNamespace(userId, newPath, { id: folder.namespaceId, name: folder.namespaceName });
    
    // Update using CRUD API
    const updateData = {
      tableName: 'brmh-drive-files',
      key: {
        id: folderId
      },
      updates: {
        name: newName.trim(),
        path: newPath,
        s3Key: newS3Key,
        updatedAt: timestamp
      }
    };
    
    const response = await fetch(`${CRUD_API_BASE_URL}/crud?tableName=brmh-drive-files`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateData)
    });
    
    if (!response.ok) {
      throw new Error('Failed to rename folder');
    }
    
    // Update S3 folder marker (if it exists)
    console.log(`🔄 Updating S3 folder marker: ${folder.s3Key}/.folder → ${newS3Key}/.folder`);
    try {
      // Check if old S3 folder marker exists and copy to new location
      console.log(`🔍 Checking if old folder marker exists: ${folder.s3Key}/.folder`);
      await s3Client.send(new HeadObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${folder.s3Key}/.folder`
      }));
      console.log(`✅ Old folder marker found`);
      
      // Copy folder marker to new location
      console.log(`📋 Copying folder marker to new location: ${newS3Key}/.folder`);
      await s3Client.send(new CopyObjectCommand({
        Bucket: BUCKET_NAME,
        CopySource: `${BUCKET_NAME}/${folder.s3Key}/.folder`,
        Key: `${newS3Key}/.folder`,
        Metadata: {
          userId,
          folderId,
          parentId: folder.parentId,
          renamedAt: timestamp
        }
      }));
      console.log(`✅ Folder marker copied successfully`);
      
      // Delete old S3 folder marker
      console.log(`🗑️ Deleting old folder marker: ${folder.s3Key}/.folder`);
      await s3Client.send(new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${folder.s3Key}/.folder`
      }));
      console.log(`✅ Old folder marker deleted successfully`);
      
      console.log(`✅ Folder marker renamed in S3: ${folder.s3Key}/.folder → ${newS3Key}/.folder`);
      
    } catch (error) {
      // Handle NotFound error specifically (folder marker doesn't exist)
      if (error.name === 'NotFound') {
        console.log(`ℹ️ Old folder marker doesn't exist, skipping S3 folder marker update`);
        console.log(`ℹ️ This is normal for folders without explicit folder markers`);
        
      } else {
        // Other S3 errors
        console.error(`❌ S3 folder marker update failed:`, error.message);
        console.error(`❌ Full S3 error:`, error);
        console.error(`❌ Error code:`, error.code);
        console.error(`❌ Error name:`, error.name);
        console.log('S3 folder marker not found or already updated, continuing...');
      }
    }
    
    return {
      success: true,
      folderId,
      oldName: folder.name,
      newName: newName.trim(),
      newPath,
      updatedAt: timestamp
    };
    
  } catch (error) {
    console.error('Error renaming folder:', error);
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
  Key: file.s3Key,
  // Add this to force download instead of view
  ResponseContentDisposition: `attachment; filename="${file.name}"`
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

export async function generatePreviewUrl(userId, fileId) {
  try {
    const file = await getFileById(userId, fileId);
    if (!file) {
      throw new Error('File not found');
    }

    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: file.s3Key,
      ResponseContentDisposition: `inline; filename="${file.name}"`,
      ResponseContentType: file.mimeType || 'application/octet-stream'
    });

    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    return {
      success: true,
      previewUrl: presignedUrl,
      expiresIn: 3600,
      fileName: file.name,
      mimeType: file.mimeType,
      size: file.size
    };

  } catch (error) {
    console.error('Error generating preview URL:', error);
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

// Namespace-specific folder operations
export async function createNamespaceFolder(namespaceId, namespaceName) {
  try {
    console.log('=== CREATE NAMESPACE FOLDER IN BRMH DRIVE ===');
    console.log('namespaceId:', namespaceId);
    console.log('namespaceName:', namespaceName);
    
    // Sanitize namespace name for folder path
    const sanitizedName = namespaceName.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
    const folderPath = `namespaces/${sanitizedName}-${namespaceId}`;
    const s3Key = `${DRIVE_FOLDER}/${folderPath}`;
    
    console.log('Folder path:', folderPath);
    console.log('S3 key:', s3Key);
    
    // Create folder marker in S3
    await s3Client.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: `${s3Key}/.folder`,
      Body: JSON.stringify({ 
        type: 'namespace-folder', 
        namespaceId: namespaceId,
        namespaceName: namespaceName,
        created: new Date().toISOString()
      }),
      ContentType: 'application/json',
      Metadata: {
        namespaceId: namespaceId,
        namespaceName: namespaceName,
        folderType: 'namespace'
      }
    }));
    
    console.log('✅ Namespace folder created successfully in BRMH Drive');
    return {
      folderPath,
      s3Key,
      success: true
    };
  } catch (error) {
    console.error('❌ Error creating namespace folder in BRMH Drive:', error);
    throw new Error(`Failed to create namespace folder: ${error.message}`);
  }
}

export async function deleteNamespaceFolder(folderPath) {
  try {
    if (!folderPath) {
      console.log('No folder path provided, skipping folder deletion');
      return;
    }

    console.log('=== DELETE NAMESPACE FOLDER FROM BRMH DRIVE ===');
    console.log('folderPath:', folderPath);
    
    const s3Key = `${DRIVE_FOLDER}/${folderPath}`;
    console.log('S3 key:', s3Key);
    
    // List all objects in the folder
    const { ListObjectsV2Command, DeleteObjectsCommand } = await import('@aws-sdk/client-s3');
    const listCommand = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: s3Key
    });
    
    const listResponse = await s3Client.send(listCommand);
    
    if (listResponse.Contents && listResponse.Contents.length > 0) {
      // Delete all objects in the folder
      const deleteObjects = listResponse.Contents.map(obj => ({ Key: obj.Key }));
      
      const deleteCommand = new DeleteObjectsCommand({
        Bucket: BUCKET_NAME,
        Delete: {
          Objects: deleteObjects
        }
      });
      
      await s3Client.send(deleteCommand);
      console.log(`✅ Deleted ${deleteObjects.length} objects from namespace folder`);
    } else {
      console.log('No objects found in namespace folder');
    }
    
    console.log('✅ Namespace folder deleted successfully from BRMH Drive');
    return { success: true };
  } catch (error) {
    console.error('❌ Error deleting namespace folder from BRMH Drive:', error);
    // Don't throw error as this is cleanup operation
    return { success: false, error: error.message };
  }
}

// Move file to different folder
export async function moveFile(userId, fileId, newParentId) {
  try {
    console.log('=== MOVE FILE OPERATION ===');
    console.log('userId:', userId);
    console.log('fileId:', fileId);
    console.log('newParentId:', newParentId);
    
    // Get the file to move
    const file = await getFileById(userId, fileId);
    if (!file) {
      throw new Error('File not found');
    }
    
    if (file.type !== 'file') {
      throw new Error('Item is not a file');
    }
    
    // Validate new parent folder exists
    if (newParentId !== 'ROOT') {
      const parentFolder = await getFolderById(userId, newParentId);
      if (!parentFolder) {
        throw new Error('Destination folder not found');
      }
    }
    
    const timestamp = new Date().toISOString();
    
    // Calculate new path
    let newPath = '';
    if (newParentId === 'ROOT') {
      newPath = file.name;
    } else {
      const parentFolder = await getFolderById(userId, newParentId);
      newPath = parentFolder.path ? `${parentFolder.path}/${file.name}` : file.name;
    }
    
    // Calculate new S3 key
    const newS3Key = getS3KeyWithNamespace(userId, newPath.replace(`/${file.name}`, ''), file.name, { id: file.namespaceId, name: file.namespaceName });
    
    // Update file metadata in DynamoDB
    const updateData = {
      tableName: 'brmh-drive-files',
      key: {
        id: fileId
      },
      updates: {
        parentId: newParentId,
        path: newPath,
        s3Key: newS3Key,
        updatedAt: timestamp
      }
    };
    
    const response = await fetch(`${CRUD_API_BASE_URL}/crud?tableName=brmh-drive-files`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateData)
    });
    
    if (!response.ok) {
      throw new Error('Failed to update file metadata');
    }
    
    // Move file in S3
    try {
      // Copy file to new location
      await s3Client.send(new CopyObjectCommand({
        Bucket: BUCKET_NAME,
        CopySource: `${BUCKET_NAME}/${file.s3Key}`,
        Key: newS3Key,
        Metadata: {
          userId,
          fileId,
          parentId: newParentId,
          movedAt: timestamp
        }
      }));
      
      // Delete old file
      await s3Client.send(new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: file.s3Key
      }));
      
      console.log('✅ File moved successfully in S3');
    } catch (error) {
      console.error('❌ Error moving file in S3:', error);
      throw new Error('Failed to move file in storage');
    }
    
    return {
      success: true,
      fileId,
      oldPath: file.path,
      newPath,
      oldParentId: file.parentId,
      newParentId,
      updatedAt: timestamp
    };
    
  } catch (error) {
    console.error('Error moving file:', error);
    throw error;
  }
}

// Move folder to different parent
export async function moveFolder(userId, folderId, newParentId) {
  try {
    console.log('=== MOVE FOLDER OPERATION ===');
    console.log('userId:', userId);
    console.log('folderId:', folderId);
    console.log('newParentId:', newParentId);
    
    // Get the folder to move
    const folder = await getFolderById(userId, folderId);
    if (!folder) {
      throw new Error('Folder not found');
    }
    
    if (folder.type !== 'folder') {
      throw new Error('Item is not a folder');
    }
    
    // Validate new parent folder exists
    if (newParentId !== 'ROOT') {
      const parentFolder = await getFolderById(userId, newParentId);
      if (!parentFolder) {
        throw new Error('Destination folder not found');
      }
    }
    
    // Prevent moving folder into itself or its subfolders
    if (newParentId === folderId) {
      throw new Error('Cannot move folder into itself');
    }
    
    // Check if newParentId is a subfolder of folderId
    const isSubfolder = await checkIfSubfolder(userId, newParentId, folderId);
    if (isSubfolder) {
      throw new Error('Cannot move folder into its own subfolder');
    }
    
    const timestamp = new Date().toISOString();
    
    // Calculate new path
    let newPath = '';
    if (newParentId === 'ROOT') {
      newPath = folder.name;
    } else {
      const parentFolder = await getFolderById(userId, newParentId);
      newPath = parentFolder.path ? `${parentFolder.path}/${folder.name}` : folder.name;
    }
    
    // Calculate new S3 key
    const newS3Key = getFolderS3Key(userId, newPath);
    
    // Update folder metadata in DynamoDB
    const updateData = {
      tableName: 'brmh-drive-files',
      key: {
        id: folderId
      },
      updates: {
        parentId: newParentId,
        path: newPath,
        s3Key: newS3Key,
        updatedAt: timestamp
      }
    };
    
    const response = await fetch(`${CRUD_API_BASE_URL}/crud?tableName=brmh-drive-files`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateData)
    });
    
    if (!response.ok) {
      throw new Error('Failed to update folder metadata');
    }
    
    // Update all child items' paths
    await updateChildItemsPaths(userId, folderId, folder.path, newPath);
    
    // Move folder marker in S3
    try {
      // Copy folder marker to new location
      await s3Client.send(new CopyObjectCommand({
        Bucket: BUCKET_NAME,
        CopySource: `${BUCKET_NAME}/${folder.s3Key}/.folder`,
        Key: `${newS3Key}/.folder`,
        Metadata: {
          userId,
          folderId,
          parentId: newParentId,
          movedAt: timestamp
        }
      }));
      
      // Delete old folder marker
      await s3Client.send(new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `${folder.s3Key}/.folder`
      }));
      
      console.log('✅ Folder moved successfully in S3');
    } catch (error) {
      console.log('S3 folder marker not found or already updated, continuing...');
    }
    
    return {
      success: true,
      folderId,
      oldPath: folder.path,
      newPath,
      oldParentId: folder.parentId,
      newParentId,
      updatedAt: timestamp
    };
    
  } catch (error) {
    console.error('Error moving folder:', error);
    throw error;
  }
}

// Helper function to check if a folder is a subfolder of another
async function checkIfSubfolder(userId, folderId, parentFolderId) {
  try {
    const folder = await getFolderById(userId, folderId);
    if (!folder || folder.parentId === 'ROOT') {
      return false;
    }
    
    if (folder.parentId === parentFolderId) {
      return true;
    }
    
    return await checkIfSubfolder(userId, folder.parentId, parentFolderId);
  } catch (error) {
    return false;
  }
}

// Helper function to update all child items' paths
async function updateChildItemsPaths(userId, folderId, oldPath, newPath) {
  try {
    // Get all child items
    const contents = await listFolderContents(userId, folderId, 1000);
    
    // Update files
    for (const file of contents.files || []) {
      const newFilePath = file.path.replace(oldPath, newPath);
      const newFileS3Key = getS3KeyWithNamespace(userId, newFilePath.replace(`/${file.name}`, ''), file.name, { id: file.namespaceId, name: file.namespaceName });
      
      const updateData = {
        tableName: 'brmh-drive-files',
        key: { id: file.id },
        updates: {
          path: newFilePath,
          s3Key: newFileS3Key,
          updatedAt: new Date().toISOString()
        }
      };
      
      await fetch(`${CRUD_API_BASE_URL}/crud?tableName=brmh-drive-files`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
      });
      
      // Move file in S3
      try {
        await s3Client.send(new CopyObjectCommand({
          Bucket: BUCKET_NAME,
          CopySource: `${BUCKET_NAME}/${file.s3Key}`,
          Key: newFileS3Key
        }));
        
        await s3Client.send(new DeleteObjectCommand({
          Bucket: BUCKET_NAME,
          Key: file.s3Key
        }));
      } catch (error) {
        console.log(`S3 file ${file.name} not found or already updated, continuing...`);
      }
    }
    
    // Update subfolders recursively
    for (const subfolder of contents.folders || []) {
      const newSubfolderPath = subfolder.path.replace(oldPath, newPath);
      const newSubfolderS3Key = getFolderS3KeyWithNamespace(userId, newSubfolderPath, { id: subfolder.namespaceId, name: subfolder.namespaceName });
      
      const updateData = {
        tableName: 'brmh-drive-files',
        key: { id: subfolder.id },
        updates: {
          path: newSubfolderPath,
          s3Key: newSubfolderS3Key,
          updatedAt: new Date().toISOString()
        }
      };
      
      await fetch(`${CRUD_API_BASE_URL}/crud?tableName=brmh-drive-files`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
      });
      
      // Recursively update child items
      await updateChildItemsPaths(userId, subfolder.id, subfolder.path, newSubfolderPath);
    }
    
  } catch (error) {
    console.error('Error updating child items paths:', error);
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
  moveFile,
  
  // Folder operations
  createFolder,
  getFolderById,
  listFolders,
  listFolderContents,
  deleteFolder,
  renameFolder,
  moveFolder,
  
  // Namespace folder operations
  createNamespaceFolder,
  deleteNamespaceFolder,
  
  // Download operations
  generateDownloadUrl,
  generatePreviewUrl,
  
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


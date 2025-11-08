# BRMH Drive System

A comprehensive Google Drive-like storage system built on AWS S3 and DynamoDB, providing secure file and folder management with user-based access control.

## 🚀 Quick Start

### Prerequisites
- AWS account with S3 and DynamoDB access
- Node.js 16+ and npm
- AWS credentials configured

### Installation
1. Clone the repository
2. Install dependencies: `npm install`
3. Set environment variables:
   ```bash
   export AWS_REGION=us-east-1
   export AWS_ACCESS_KEY_ID=your_access_key
   export AWS_SECRET_ACCESS_KEY=your_secret_key
   ```

### Initialize the System
```bash
curl -X POST http://localhost:5001/drive/initialize
```

## 🏗️ Architecture Overview

The system consists of two main components:
- **AWS S3**: Stores actual file content in a structured folder hierarchy
- **AWS DynamoDB**: Stores file and folder metadata with a single primary key design

### S3 Storage Structure
```
s3://brmh/brmh-drive/
├── .system                    # System initialization
├── users/                     # Backward-compatible non-namespace storage
│   ├── user123/
│   │   ├── document.pdf
│   │   └── Work Documents/
│   └── user456/
│       └── Photos/
└── namespaces/                # Namespace-scoped storage (recommended)
    └── <namespace-slug>_<namespaceId>/
        └── users/
            └── <userId>/
                └── ... files and folders ...
```

### DynamoDB Schema

**Table**: `brmh-drive-files`
**Primary Key**: `id` (String) - Unique identifier for each file/folder

**Attributes**:
- `id`: Unique identifier (e.g., "FILE_abc123" or "FOLDER_def456")
- `name`: Display name of the file/folder
- `type`: Item type ("file" or "folder")
- `parentId`: ID of the parent folder ("ROOT" for root level)
- `path`: Full path to the item
- `s3Key`: S3 object key for the file/folder
- `mimeType`: MIME type (for files only)
- `size`: File size in bytes (for files only)
- `tags`: Array of tags (optional)
- `description`: Folder description (for folders only)
- `createdAt`: ISO timestamp of creation
- `updatedAt`: ISO timestamp of last update
- `ownerId`: User ID who owns the item

## 📡 Complete API Reference

### System Operations

#### Initialize Drive System
```http
POST /drive/initialize
```
Initializes the drive system by creating necessary S3 folders and system files.

**Response**: `200 OK` with initialization status

---

### File Operations

#### Upload File
```http
POST /drive/upload
Content-Type: multipart/form-data OR application/json
```

**Multipart Form Data**:
```
userId: string (required)
file: File (required)
parentId: string (optional, default: "ROOT")
tags: string (optional, comma-separated)
namespaceId: string (optional, recommended for namespace-scoped projects)
fieldName: string (optional, creates a subfolder under the namespace folder)
folderId: string (optional)
```

**JSON Request**:
```json
{
  "userId": "user123",
  "namespaceId": "ns_abc123",
  "fileData": {
    "name": "document.pdf",
    "mimeType": "application/pdf",
    "size": 24567,
    "content": "base64_encoded_content",
    "tags": ["work", "important"]
  },
  "parentId": "ROOT"
}
```

**Response**:
```json
{
  "success": true,
  "fileId": "FILE_abc123def456",
  "s3Key": "brmh-drive/namespaces/finance-tools_ns_abc123/users/user123/document.pdf",
  "message": "File uploaded successfully"
}
```

#### Get File Details
```http
GET /drive/file/{userId}/{fileId}
```

**Response**:
```json
{
  "id": "FILE_abc123def456",
  "name": "document.pdf",
  "type": "file",
  "parentId": "ROOT",
  "path": "",
  "s3Key": "brmh-drive/users/user123/document.pdf",
  "mimeType": "application/pdf",
  "size": 24567,
  "tags": ["work", "important"],
  "createdAt": "2025-01-27T10:30:00.000Z",
  "updatedAt": "2025-01-27T10:30:00.000Z",
  "ownerId": "user123"
}
```

#### List User Files
```http
GET /drive/files/{userId}?parentId=ROOT&limit=50&lastEvaluatedKey=...&namespaceId=ns_abc123
```

**Query Parameters**:
- `parentId`: Filter by parent folder (default: "ROOT")
- `limit`: Maximum number of files to return (default: 50)
- `lastEvaluatedKey`: For pagination
- `namespaceId`: Optional; when provided, scopes results to that namespace

**Response**:
```json
{
  "files": [
    {
      "id": "FILE_abc123def456",
      "name": "document.pdf",
      "type": "file",
      "parentId": "ROOT",
      "mimeType": "application/pdf",
      "size": 24567,
      "createdAt": "2025-01-27T10:30:00.000Z"
    }
  ],
  "lastEvaluatedKey": "FILE_xyz789",
  "count": 1
}
```

#### Rename File
```http
PATCH /drive/rename/{userId}/{fileId}
Content-Type: application/json
```

**Request Body**:
```json
{
  "newName": "updated_document.pdf"
}
```

**Response**:
```json
{
  "success": true,
  "message": "File renamed successfully",
  "fileId": "FILE_abc123def456"
}
```

#### Delete File
```http
DELETE /drive/file/{userId}/{fileId}
```

**Response**:
```json
{
  "success": true,
  "message": "File deleted successfully",
  "fileId": "FILE_abc123def456"
}
```

#### Download File
```http
GET /drive/download/{userId}/{fileId}
```

**Response**:
```json
{
  "downloadUrl": "https://s3.amazonaws.com/bucket/presigned-url",
  "expiresIn": 3600,
  "fileName": "document.pdf",
  "fileSize": 24567
}
```

---

### Folder Operations

#### Create Folder
```http
POST /drive/folder
Content-Type: application/json
```

**Request Body**:
```json
{
  "userId": "user123",
  "folderData": {
    "name": "Work Documents",
    "description": "All work-related documents"
  },
  "parentId": "ROOT"
}
```

**Response**:
```json
{
  "success": true,
  "folderId": "FOLDER_def456ghi789",
  "message": "Folder created successfully"
}
```

#### Get Folder Details
```http
GET /drive/folder/{userId}/{folderId}
```

**Response**:
```json
{
  "id": "FOLDER_def456ghi789",
  "name": "Work Documents",
  "type": "folder",
  "parentId": "ROOT",
  "path": "",
  "description": "All work-related documents",
  "createdAt": "2025-01-27T10:30:00.000Z",
  "updatedAt": "2025-01-27T10:30:00.000Z",
  "ownerId": "user123"
}
```

#### List User Folders
```http
GET /drive/folders/{userId}?parentId=ROOT&limit=50&lastEvaluatedKey=...&namespaceId=ns_abc123
```

**Query Parameters**:
- `parentId`: Filter by parent folder (default: "ROOT")
- `limit`: Maximum number of folders to return (default: 50)
- `lastEvaluatedKey`: For pagination
- `namespaceId`: Optional; when provided, scopes results to that namespace

**Response**:
```json
{
  "folders": [
    {
      "id": "FOLDER_def456ghi789",
      "name": "Work Documents",
      "type": "folder",
      "parentId": "ROOT",
      "description": "All work-related documents",
      "createdAt": "2025-01-27T10:30:00.000Z"
    }
  ],
  "lastEvaluatedKey": "FOLDER_xyz789",
  "count": 1
}
```

#### List Folder Contents
```http
GET /drive/contents/{userId}/{folderId}?limit=50&lastEvaluatedKey=...&namespaceId=ns_abc123
```

**Query Parameters**:
- `limit`: Maximum number of items to return (default: 50)
- `lastEvaluatedKey`: For pagination
- `namespaceId`: Optional; when provided, scopes results to that namespace

**Response**:
```json
{
  "contents": {
    "files": [
      {
        "id": "FILE_abc123def456",
        "name": "document.pdf",
        "type": "file",
        "mimeType": "application/pdf",
        "size": 24567,
        "createdAt": "2025-01-27T10:30:00.000Z"
      }
    ],
    "folders": [
      {
        "id": "FOLDER_def456ghi789",
        "name": "Subfolder",
        "type": "folder",
        "description": "A subfolder",
        "createdAt": "2025-01-27T10:30:00.000Z"
      }
    ]
  },
  "lastEvaluatedKey": "FILE_xyz789",
  "count": 2
}
```

#### Rename Folder
```http
PATCH /drive/rename/{userId}/{folderId}
Content-Type: application/json
```

**Request Body**:
```json
{
  "newName": "Updated Folder Name"
}
```

**Response**:
```json
{
  "success": true,
  "message": "Folder renamed successfully",
  "folderId": "FOLDER_def456ghi789"
}
```

#### Delete Folder
```http
DELETE /drive/folder/{userId}/{folderId}
```

**Response**:
```json
{
  "success": true,
  "message": "Folder deleted successfully",
  "folderId": "FOLDER_def456ghi789"
}
```

---

### Search Operations

#### Search Files
```http
GET /drive/search/{userId}?query=document&type=file&limit=50
```

**Query Parameters**:
- `query`: Search term (required)
- `type`: Filter by type ("file" or "folder")
- `limit`: Maximum results (default: 50)

**Response**:
```json
{
  "results": [
    {
      "id": "FILE_abc123def456",
      "name": "document.pdf",
      "type": "file",
      "parentId": "ROOT",
      "mimeType": "application/pdf",
      "size": 24567,
      "createdAt": "2025-01-27T10:30:00.000Z"
    }
  ],
  "count": 1
}
```

---

### Sharing Operations

#### Share File
```http
POST /drive/share/{userId}/{fileId}
Content-Type: application/json
```

**Request Body**:
```json
{
  "sharedWith": ["user456", "user789"],
  "permissions": ["read", "write"],
  "expiresAt": "2025-02-27T10:30:00.000Z"
}
```

**Response**:
```json
{
  "success": true,
  "shareId": "SHARE_abc123def456",
  "message": "File shared successfully"
}
```

#### Get Shared Files
```http
GET /drive/shared/{userId}?limit=50
```

**Response**:
```json
{
  "sharedFiles": [
    {
      "id": "FILE_abc123def456",
      "name": "document.pdf",
      "sharedBy": "user123",
      "permissions": ["read"],
      "sharedAt": "2025-01-27T10:30:00.000Z"
    }
  ],
  "count": 1
}
```

---

## 🔧 Configuration

### S3 Configuration
- **Bucket**: `brmh` (configurable via `BUCKET_NAME`)
- **Drive Folder**: `brmh-drive` (configurable via `DRIVE_FOLDER`)
- **Max File Size**: 100MB (configurable via `MAX_FILE_SIZE`)

### Supported File Types

#### Documents
- `application/pdf` - PDF documents
- `application/msword` - Microsoft Word (.doc)
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document` - Word (.docx)
- `application/vnd.ms-excel` - Microsoft Excel (.xls)
- `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` - Excel (.xlsx)
- `application/vnd.ms-powerpoint` - PowerPoint (.ppt)
- `application/vnd.openxmlformats-officedocument.presentationml.presentation` - PowerPoint (.pptx)

#### Images
- `image/jpeg` - JPEG images
- `image/png` - PNG images
- `image/gif` - GIF images
- `image/webp` - WebP images

#### Videos
- `video/mp4` - MP4 videos
- `video/webm` - WebM videos
- `video/ogg` - OGG videos

#### Audio
- `audio/mpeg` - MP3 audio
- `audio/ogg` - OGG audio
- `audio/wav` - WAV audio

#### Archives
- `application/zip` - ZIP archives
- `application/x-rar-compressed` - RAR archives

#### Text Files
- `text/plain` - Plain text
- `text/html` - HTML files
- `text/css` - CSS files
- `text/javascript` - JavaScript files
- `application/json` - JSON files
- `application/xml` - XML files

## 🔒 Security Features

- **User Isolation**: Each user can only access their own files
- **Access Control**: Files are served through presigned URLs with expiration
- **Input Validation**: File type and size validation
- **Secure Storage**: S3 bucket with proper IAM policies
- **Sharing Control**: Granular permissions for shared files

## 📊 Monitoring and Logging

The system provides comprehensive logging for:
- File operations (upload, download, delete)
- Error handling and debugging
- Performance metrics
- Security events

## 🚨 Error Handling

The API returns appropriate HTTP status codes:
- `200`: Success
- `400`: Bad request (missing fields, invalid data)
- `404`: Resource not found
- `500`: Internal server error

### Common Error Responses

```json
{
  "error": "File not found",
  "code": "FILE_NOT_FOUND",
  "statusCode": 404
}
```

```json
{
  "error": "Invalid file type",
  "code": "INVALID_FILE_TYPE",
  "statusCode": 400,
  "allowedTypes": ["image/jpeg", "image/png", "application/pdf"]
}
```

## 💡 Usage Examples

### JavaScript/Node.js
```javascript
// Upload a file
const formData = new FormData();
formData.append('userId', 'user123');
formData.append('file', fileInput.files[0]);
formData.append('parentId', 'ROOT');

const response = await fetch('/drive/upload', {
  method: 'POST',
  body: formData
});

// Create a folder
const folderResponse = await fetch('/drive/folder', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userId: 'user123',
    folderData: { name: 'Work Documents' },
    parentId: 'ROOT'
  })
});

// List files
const filesResponse = await fetch('/drive/files/user123?parentId=ROOT');
const files = await filesResponse.json();
```

### Python
```python
import requests

# Upload file
with open('document.pdf', 'rb') as f:
    files = {'file': f}
    data = {'userId': 'user123', 'parentId': 'ROOT'}
    response = requests.post('http://localhost:5001/drive/upload', 
                           files=files, data=data)

# Create folder
response = requests.post('http://localhost:5001/drive/folder', json={
    'userId': 'user123',
    'folderData': {'name': 'Work Documents'},
    'parentId': 'ROOT'
})

# List files
response = requests.get('http://localhost:5001/drive/files/user123?parentId=ROOT')
files = response.json()
```

### cURL
```bash
# Initialize system
curl -X POST http://localhost:5001/drive/initialize

# Upload file (multipart)
curl -X POST http://localhost:5001/drive/upload \
  -F "userId=user123" \
  -F "file=@document.pdf" \
  -F "parentId=ROOT"

# Upload file (JSON)
curl -X POST http://localhost:5001/drive/upload \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user123",
    "fileData": {
      "name": "document.pdf",
      "mimeType": "application/pdf",
      "size": 24567,
      "content": "base64_content"
    }
  }'

# Create folder
curl -X POST http://localhost:5001/drive/folder \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user123",
    "folderData": {"name": "Work Documents"},
    "parentId": "ROOT"
  }'

# List files
curl "http://localhost:5001/drive/files/user123?parentId=ROOT"

# Download file
curl "http://localhost:5001/drive/download/user123/FILE_abc123def456"
```

## 📚 API Documentation

Interactive API documentation is available at:
- Development: `http://localhost:5001/drive-api-docs`
- Production: `https://api.brmh.com/drive-api-docs`

## 🔧 Troubleshooting

### Common Issues

1. **S3 Access Denied**: Check IAM permissions and bucket policies
2. **DynamoDB Errors**: Verify table exists and has correct schema
3. **File Upload Failures**: Check file size limits and supported types
4. **Authentication Issues**: Verify AWS credentials and permissions

### Debug Mode

Enable debug logging by setting:
```bash
export DEBUG=brmh-drive:*
```

## 🚀 Future Enhancements

- **File Versioning**: Version control and history
- **Advanced Search**: Full-text search across file contents
- **Collaboration**: Real-time collaborative editing
- **Mobile App**: Native mobile applications
- **Webhooks**: Event-driven notifications
- **Analytics**: Usage statistics and insights
- **CDN Integration**: Global content delivery
- **File Compression**: Automatic compression
- **Advanced Permissions**: Role-based access control

## 📞 Support

For technical support and questions:
- Email: dev@brmh.com
- Documentation: [BRMH Drive API Docs](https://api.brmh.com/drive-api-docs)
- Issues: Create an issue in the project repository

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

---

**Note**: This system is designed for production use but should be thoroughly tested in your environment before deployment. Consider implementing additional security measures such as rate limiting, request validation, and monitoring based on your specific requirements.


# BRMH Drive System

A comprehensive Google Drive-like storage system built on AWS S3 and DynamoDB, providing secure file and folder management with user-based access control.

## Architecture Overview

The system consists of two main components:
- **AWS S3**: Stores actual file content in a structured folder hierarchy
- **AWS DynamoDB**: Stores file and folder metadata with a single primary key design

## DynamoDB Schema

### Table: `brmh-drive-files`

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

**Example Item**:
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

## Getting Started

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

## API Endpoints

### File Operations

#### Upload File
```http
POST /drive/upload
Content-Type: application/json

{
  "userId": "user123",
  "fileData": {
    "name": "document.pdf",
    "mimeType": "application/pdf",
    "size": 24567,
    "content": "base64_encoded_content"
  },
  "parentId": "ROOT"
}
```

#### Get File Details
```http
GET /drive/file/{userId}/{fileId}
```

#### List User Files
```http
GET /drive/files/{userId}?parentId=ROOT&limit=50
```

#### Rename File
```http
PATCH /drive/rename/{userId}/{fileId}
Content-Type: application/json

{
  "newName": "updated_document.pdf"
}
```

#### Delete File
```http
DELETE /drive/file/{userId}/{fileId}
```

#### Download File
```http
GET /drive/download/{userId}/{fileId}
```

### Folder Operations

#### Create Folder
```http
POST /drive/folder
Content-Type: application/json

{
  "userId": "user123",
  "folderData": {
    "name": "Work Documents",
    "description": "All work-related documents"
  },
  "parentId": "ROOT"
}
```

#### Get Folder Details
```http
GET /drive/folder/{userId}/{folderId}
```

#### List User Folders
```http
GET /drive/folders/{userId}?parentId=ROOT&limit=50
```

#### List Folder Contents
```http
GET /drive/contents/{userId}/{folderId}?limit=50
```

## Configuration

### S3 Configuration
- **Bucket**: `brmh` (configurable via `BUCKET_NAME`)
- **Drive Folder**: `brmh-drive` (configurable via `DRIVE_FOLDER`)
- **Max File Size**: 100MB (configurable via `MAX_FILE_SIZE`)

### Supported File Types
- Documents: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX
- Images: JPEG, PNG, GIF, WebP
- Videos: MP4, WebM, OGG
- Audio: MP3, OGG, WAV
- Archives: ZIP, RAR
- Text: Plain text, HTML, CSS, JavaScript, JSON, XML

## Security Features

- **User Isolation**: Each user can only access their own files
- **Access Control**: Files are served through presigned URLs with expiration
- **Input Validation**: File type and size validation
- **Secure Storage**: S3 bucket with proper IAM policies

## Monitoring and Logging

The system provides comprehensive logging for:
- File operations (upload, download, delete)
- Error handling and debugging
- Performance metrics
- Security events

## Error Handling

The API returns appropriate HTTP status codes:
- `200`: Success
- `400`: Bad request (missing fields, invalid data)
- `404`: Resource not found
- `500`: Internal server error

## Future Enhancements

- **File Sharing**: Share files between users
- **Version Control**: File versioning and history
- **Search**: Full-text search across file contents
- **Collaboration**: Real-time collaborative editing
- **Mobile App**: Native mobile applications
- **Webhooks**: Event-driven notifications
- **Analytics**: Usage statistics and insights

## Usage Examples

### JavaScript/Node.js
```javascript
import { uploadFile, createFolder, listFiles } from './brmh-drive.js';

// Upload a file
const result = await uploadFile('user123', {
  name: 'document.pdf',
  mimeType: 'application/pdf',
  size: 24567,
  content: 'base64_content'
});

// Create a folder
const folder = await createFolder('user123', {
  name: 'Work Documents'
});

// List files
const files = await listFiles('user123', 'ROOT');
```

### Python
```python
import requests

# Upload file
response = requests.post('http://localhost:5001/drive/upload', json={
    'userId': 'user123',
    'fileData': {
        'name': 'document.pdf',
        'mimeType': 'application/pdf',
        'size': 24567,
        'content': 'base64_content'
    }
})
```

### cURL
```bash
# Initialize system
curl -X POST http://localhost:5001/drive/initialize

# Upload file
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
```

## API Documentation

Interactive API documentation is available at:
- Development: `http://localhost:5001/drive-api-docs`
- Production: `https://api.brmh.com/drive-api-docs`

## Troubleshooting

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

## Support

For technical support and questions:
- Email: dev@brmh.com
- Documentation: [BRMH Drive API Docs](https://api.brmh.com/drive-api-docs)
- Issues: Create an issue in the project repository

## License

This project is licensed under the MIT License - see the LICENSE file for details.

---

**Note**: This system is designed for production use but should be thoroughly tested in your environment before deployment. Consider implementing additional security measures such as rate limiting, request validation, and monitoring based on your specific requirements.

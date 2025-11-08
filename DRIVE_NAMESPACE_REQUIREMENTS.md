# BRMH Drive - Namespace Requirements Implementation

## ✅ Implementation Completed

All drive operations now **REQUIRE** the following parameters:
- `userId` - User performing the action
- `namespaceId` - Namespace/project identifier
- `namespaceName` - Human-readable namespace name

---

## 📁 Storage Path Structure

### **ONLY Path Available Now:**
```
brmh-drive/namespaces/{namespaceName-slug}_{namespaceId}/users/{userId}/{path}/{filename}
```

### **Old Path Removed:**
```
❌ brmh-drive/users/{userId}/{path}/{filename} (NO LONGER SUPPORTED)
```

---

## 🔧 Changes Made

### **1. Core Functions (brmh-drive.js)**

#### Updated Functions:
- ✅ `getS3KeyWithNamespace()` - Requires namespace, removed user-only fallback
- ✅ `getFolderS3KeyWithNamespace()` - Requires namespace, removed user-only fallback
- ✅ `uploadFile()` - Validates userId, namespaceId, namespaceName
- ✅ `createFolder()` - Validates userId, namespaceId, namespaceName
- ✅ `listFiles()` - Requires namespaceId, filters by namespace only
- ✅ `listFolders()` - Requires namespaceId, filters by namespace only
- ✅ `listFolderContents()` - Requires namespaceId

### **2. API Endpoints (index.js)**

#### File Operations:
- ✅ `POST /drive/upload` - Requires userId, namespaceId, namespaceName in body
- ✅ `GET /drive/files/:userId` - Requires namespaceId in query
- ✅ `GET /drive/file/:userId/:fileId` - Requires namespaceId in query + namespace verification
- ✅ `GET /drive/download/:userId/:fileId` - Requires namespaceId in query + namespace verification
- ✅ `GET /drive/preview/:userId/:fileId` - Requires namespaceId in query + namespace verification
- ✅ `PATCH /drive/rename/:userId/:fileId` - Requires namespaceId in body + namespace verification
- ✅ `PATCH /drive/move/file/:userId/:fileId` - Requires namespaceId in body + namespace verification
- ✅ `DELETE /drive/file/:userId/:fileId` - Requires namespaceId in query + namespace verification

#### Folder Operations:
- ✅ `POST /drive/folder` - Requires namespaceId, namespaceName in folderData
- ✅ `GET /drive/folders/:userId` - Requires namespaceId in query
- ✅ `GET /drive/folder/:userId/:folderId` - Requires namespaceId in query + namespace verification
- ✅ `GET /drive/contents/:userId/:folderId` - Requires namespaceId in query
- ✅ `PATCH /drive/rename/folder/:userId/:folderId` - Requires namespaceId in body + namespace verification
- ✅ `PATCH /drive/move/folder/:userId/:folderId` - Requires namespaceId in body + namespace verification
- ✅ `DELETE /drive/folder/:userId/:folderId` - Requires namespaceId in query + namespace verification

#### Sharing Operations:
- ✅ `POST /drive/share/file/:userId/:fileId` - Requires namespaceId in body + namespace verification
- ✅ `POST /drive/share/folder/:userId/:folderId` - Requires namespaceId in body + namespace verification
- ✅ `GET /drive/shared/with-me/:userId` - Requires namespaceId in query + filters results
- ✅ `GET /drive/shared/by-me/:userId` - Requires namespaceId in query + filters results
- ✅ `PATCH /drive/share/:userId/:shareId/permissions` - Requires namespaceId in body
- ✅ `DELETE /drive/share/:userId/:shareId/revoke` - Requires namespaceId in query
- ✅ `GET /drive/shared/:userId/:shareId/download` - Requires namespaceId in query

---

## 📊 Error Responses

### Missing userId:
```json
{
  "error": "userId is required",
  "message": "Please provide userId in the request body"
}
```

### Missing namespaceId:
```json
{
  "error": "namespaceId is required",
  "message": "All drive operations must be scoped to a namespace. Please provide namespaceId"
}
```

### Missing namespaceName:
```json
{
  "error": "namespaceName is required",
  "message": "Please provide namespaceName for namespace identification"
}
```

### Namespace Mismatch:
```json
{
  "error": "Access denied",
  "message": "File/Folder does not belong to the specified namespace"
}
```

---

## 📝 Usage Examples

### Upload File (Required Parameters):
```javascript
const formData = new FormData();
formData.append('userId', 'user123');              // ← REQUIRED
formData.append('namespaceId', 'ns_marketing');    // ← REQUIRED
formData.append('namespaceName', 'Marketing');     // ← REQUIRED
formData.append('file', fileInput.files[0]);
formData.append('parentId', 'ROOT');

fetch('/drive/upload', { method: 'POST', body: formData });
```

### Create Folder (Required Parameters):
```javascript
fetch('/drive/folder', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userId: 'user123',                    // ← REQUIRED
    folderData: {
      name: 'Reports',
      namespaceId: 'ns_marketing',        // ← REQUIRED
      namespaceName: 'Marketing'          // ← REQUIRED
    },
    parentId: 'ROOT'
  })
});
```

### List Files (Required Parameters):
```javascript
fetch('/drive/files/user123?namespaceId=ns_marketing&parentId=ROOT');
//                           ↑ REQUIRED query parameter
```

### Delete File (Required Parameters):
```javascript
fetch('/drive/file/user123/FILE_abc?namespaceId=ns_marketing', {
  method: 'DELETE'
  //                            ↑ REQUIRED query parameter
});
```

### Rename File (Required Parameters):
```javascript
fetch('/drive/rename/user123/FILE_abc', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    newName: 'updated.pdf',
    namespaceId: 'ns_marketing'    // ← REQUIRED
  })
});
```

---

## 🔐 Security Features

### Namespace Verification:
All operations that modify or access files/folders now verify that:
1. The resource exists
2. The resource belongs to the specified namespace
3. Access is denied if namespace mismatch (403 Forbidden)

### Prevents Cross-Namespace Access:
- User cannot access files from Namespace A using Namespace B credentials
- User cannot move files between namespaces
- User cannot delete files using wrong namespace ID

---

## 🎯 Benefits

### 1. **Data Isolation:**
- Files from different projects are completely isolated
- No accidental cross-project file access
- Clear organization by namespace

### 2. **Security:**
- Namespace verification prevents unauthorized access
- Even if user has fileId, they need correct namespaceId
- Multi-tenant safe architecture

### 3. **Scalability:**
- Each namespace has its own S3 folder structure
- Easy to backup/restore individual namespaces
- Can implement namespace-level quotas

### 4. **Compliance:**
- Clear data ownership (namespace + user)
- Easier to implement GDPR/data deletion by namespace
- Audit trail includes namespace information

---

## ⚠️ Breaking Changes

### Frontend Must Update:
All frontend code making drive API calls must now include:
- `namespaceId` parameter
- `namespaceName` parameter (for upload/create operations)
- `userId` parameter

### Old Requests Will Fail:
```javascript
// ❌ This will now return 400 error
fetch('/drive/files/user123?parentId=ROOT');

// ✅ This is the correct format
fetch('/drive/files/user123?parentId=ROOT&namespaceId=ns_marketing');
```

---

## 🚀 Migration Guide

### For Existing Files:
If you have existing files in the old `users/{userId}/` path:
1. They remain in S3 but cannot be accessed via API
2. Need manual migration to namespace structure
3. Consider creating a migration script if needed

### For New Development:
1. Always include namespaceId in all drive operations
2. Store current namespace context in frontend state
3. Pass namespace info with every request

---

## ✅ Implementation Status

- ✅ Path generation functions updated
- ✅ Core drive functions validated
- ✅ Database filters updated
- ✅ File operation endpoints validated
- ✅ Folder operation endpoints validated
- ✅ Sharing operation endpoints validated
- ✅ Error handling implemented
- ✅ Namespace verification added
- ✅ No hardcoded values (all dynamic)

---

## 📞 Support

For questions or issues related to namespace requirements:
- Check error messages for specific guidance
- Verify all three parameters (userId, namespaceId, namespaceName) are provided
- Ensure namespaceId matches the actual file/folder namespace

---

**Implementation Date:** 2025-10-17
**Status:** ✅ COMPLETE
**Breaking Changes:** YES - All clients must update to include namespace parameters


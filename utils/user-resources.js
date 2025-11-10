import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
  BatchGetCommand
} from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({ region: process.env.AWS_REGION || "us-east-1" });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = "brmh-user-resources";

// Valid resource types
const RESOURCE_TYPES = ['namespace', 'schema', 'table', 'drive-folder', 'drive-file'];

// Valid permission types
const PERMISSION_TYPES = ['read', 'write', 'delete', 'admin', 'execute', 'share'];

/**
 * Grant resource access to a user
 * POST /user-resources/grant
 */
export async function grantResourceAccessHandler(req, res) {
  try {
    const { 
      userId, 
      resourceType, 
      resourceId, 
      permissions = ['read'], 
      grantedBy,
      expiresAt = null,
      metadata = {}
    } = req.body;

    // Validation
    if (!userId || !resourceType || !resourceId) {
      return res.status(400).json({
        success: false,
        error: "userId, resourceType, and resourceId are required"
      });
    }

    if (!RESOURCE_TYPES.includes(resourceType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid resourceType. Must be one of: ${RESOURCE_TYPES.join(', ')}`
      });
    }

    // Validate permissions
    const invalidPermissions = permissions.filter(p => !PERMISSION_TYPES.includes(p));
    if (invalidPermissions.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Invalid permissions: ${invalidPermissions.join(', ')}. Valid permissions: ${PERMISSION_TYPES.join(', ')}`
      });
    }

    const now = new Date().toISOString();
    const compositeResourceId = `${resourceType}#${resourceId}`;

    const resourceAccess = {
      userId,
      resourceId: compositeResourceId,
      resourceType,
      actualResourceId: resourceId,
      permissions: [...new Set(permissions)], // Remove duplicates
      grantedBy: grantedBy || 'system',
      grantedAt: now,
      updatedAt: now,
      expiresAt,
      metadata,
      isActive: true
    };

    const command = new PutCommand({
      TableName: TABLE_NAME,
      Item: resourceAccess
    });

    await docClient.send(command);

    console.log(`[User Resources] Granted ${resourceType} access to user ${userId} for resource ${resourceId}`);

    return res.status(201).json({
      success: true,
      message: "Resource access granted successfully",
      resourceAccess: {
        userId,
        resourceType,
        resourceId,
        permissions,
        grantedAt: now
      }
    });

  } catch (error) {
    console.error("[User Resources] Error granting access:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to grant resource access",
      details: error.message
    });
  }
}

/**
 * Bulk grant resource access to multiple users
 * POST /user-resources/grant-bulk
 */
export async function bulkGrantResourceAccessHandler(req, res) {
  try {
    const { 
      userIds = [], 
      resourceType, 
      resourceId, 
      permissions = ['read'], 
      grantedBy,
      expiresAt = null,
      metadata = {}
    } = req.body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: "userIds array is required and must not be empty"
      });
    }

    if (!resourceType || !resourceId) {
      return res.status(400).json({
        success: false,
        error: "resourceType and resourceId are required"
      });
    }

    const results = {
      successful: [],
      failed: []
    };

    // Process each user
    for (const userId of userIds) {
      try {
        const now = new Date().toISOString();
        const compositeResourceId = `${resourceType}#${resourceId}`;

        const resourceAccess = {
          userId,
          resourceId: compositeResourceId,
          resourceType,
          actualResourceId: resourceId,
          permissions: [...new Set(permissions)],
          grantedBy: grantedBy || 'system',
          grantedAt: now,
          updatedAt: now,
          expiresAt,
          metadata,
          isActive: true
        };

        const command = new PutCommand({
          TableName: TABLE_NAME,
          Item: resourceAccess
        });

        await docClient.send(command);
        results.successful.push(userId);

      } catch (error) {
        console.error(`[User Resources] Failed to grant access to user ${userId}:`, error);
        results.failed.push({ userId, error: error.message });
      }
    }

    console.log(`[User Resources] Bulk grant completed: ${results.successful.length} successful, ${results.failed.length} failed`);

    return res.status(200).json({
      success: true,
      message: "Bulk resource access grant completed",
      results
    });

  } catch (error) {
    console.error("[User Resources] Error in bulk grant:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to bulk grant resource access",
      details: error.message
    });
  }
}

/**
 * Revoke resource access from a user
 * DELETE /user-resources/revoke
 */
export async function revokeResourceAccessHandler(req, res) {
  try {
    const { userId, resourceType, resourceId } = req.body;

    if (!userId || !resourceType || !resourceId) {
      return res.status(400).json({
        success: false,
        error: "userId, resourceType, and resourceId are required"
      });
    }

    const compositeResourceId = `${resourceType}#${resourceId}`;

    const command = new DeleteCommand({
      TableName: TABLE_NAME,
      Key: {
        userId,
        resourceId: compositeResourceId
      }
    });

    await docClient.send(command);

    console.log(`[User Resources] Revoked ${resourceType} access from user ${userId} for resource ${resourceId}`);

    return res.status(200).json({
      success: true,
      message: "Resource access revoked successfully"
    });

  } catch (error) {
    console.error("[User Resources] Error revoking access:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to revoke resource access",
      details: error.message
    });
  }
}

/**
 * Update permissions for a resource access
 * PUT /user-resources/:userId/:resourceType/:resourceId
 */
export async function updateResourceAccessHandler(req, res) {
  try {
    const { userId, resourceType, resourceId } = req.params;
    const { permissions, expiresAt, metadata } = req.body;

    if (!permissions || !Array.isArray(permissions) || permissions.length === 0) {
      return res.status(400).json({
        success: false,
        error: "permissions array is required and must not be empty"
      });
    }

    // Validate permissions
    const invalidPermissions = permissions.filter(p => !PERMISSION_TYPES.includes(p));
    if (invalidPermissions.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Invalid permissions: ${invalidPermissions.join(', ')}`
      });
    }

    const compositeResourceId = `${resourceType}#${resourceId}`;
    const now = new Date().toISOString();

    const updateExpression = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};

    updateExpression.push("#permissions = :permissions");
    expressionAttributeNames["#permissions"] = "permissions";
    expressionAttributeValues[":permissions"] = [...new Set(permissions)];

    updateExpression.push("#updatedAt = :updatedAt");
    expressionAttributeNames["#updatedAt"] = "updatedAt";
    expressionAttributeValues[":updatedAt"] = now;

    if (expiresAt !== undefined) {
      updateExpression.push("#expiresAt = :expiresAt");
      expressionAttributeNames["#expiresAt"] = "expiresAt";
      expressionAttributeValues[":expiresAt"] = expiresAt;
    }

    if (metadata !== undefined) {
      updateExpression.push("#metadata = :metadata");
      expressionAttributeNames["#metadata"] = "metadata";
      expressionAttributeValues[":metadata"] = metadata;
    }

    const command = new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        userId,
        resourceId: compositeResourceId
      },
      UpdateExpression: `SET ${updateExpression.join(", ")}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: "ALL_NEW"
    });

    const response = await docClient.send(command);

    console.log(`[User Resources] Updated resource access for user ${userId}`);

    return res.status(200).json({
      success: true,
      message: "Resource access updated successfully",
      resourceAccess: response.Attributes
    });

  } catch (error) {
    console.error("[User Resources] Error updating access:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to update resource access",
      details: error.message
    });
  }
}

/**
 * Get all resource access for a user
 * GET /user-resources/:userId
 */
export async function getUserResourcesHandler(req, res) {
  try {
    const { userId } = req.params;
    const { resourceType, activeOnly = "true" } = req.query;

    let command;

    if (resourceType) {
      // Query by resource type using GSI
      command = new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "ResourceTypeIndex",
        KeyConditionExpression: "userId = :userId AND resourceType = :resourceType",
        ExpressionAttributeValues: {
          ":userId": userId,
          ":resourceType": resourceType
        }
      });
    } else {
      // Query all resources for user
      command = new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "userId = :userId",
        ExpressionAttributeValues: {
          ":userId": userId
        }
      });
    }

    const response = await docClient.send(command);
    let resources = response.Items || [];

    // Filter active/expired resources
    if (activeOnly === "true") {
      const now = new Date();
      resources = resources.filter(r => {
        if (!r.isActive) return false;
        if (r.expiresAt && new Date(r.expiresAt) < now) return false;
        return true;
      });
    }

    // Group by resource type
    const groupedResources = resources.reduce((acc, resource) => {
      const type = resource.resourceType;
      if (!acc[type]) {
        acc[type] = [];
      }
      acc[type].push(resource);
      return acc;
    }, {});

    console.log(`[User Resources] Retrieved ${resources.length} resources for user ${userId}`);

    return res.status(200).json({
      success: true,
      userId,
      totalResources: resources.length,
      resources: groupedResources,
      allResources: resources
    });

  } catch (error) {
    console.error("[User Resources] Error getting user resources:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to get user resources",
      details: error.message
    });
  }
}

/**
 * Check if user has access to a specific resource
 * POST /user-resources/:userId/check-access
 */
export async function checkResourceAccessHandler(req, res) {
  try {
    const { userId } = req.params;
    const { resourceType, resourceId, requiredPermissions = ['read'] } = req.body;

    if (!resourceType || !resourceId) {
      return res.status(400).json({
        success: false,
        error: "resourceType and resourceId are required"
      });
    }

    const compositeResourceId = `${resourceType}#${resourceId}`;

    const command = new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        userId,
        resourceId: compositeResourceId
      }
    });

    const response = await docClient.send(command);
    const access = response.Item;

    // Check if access exists
    if (!access) {
      return res.status(200).json({
        success: true,
        hasAccess: false,
        message: "No access granted",
        userPermissions: [],
        requiredPermissions,
        missingPermissions: requiredPermissions
      });
    }

    // Check if access is active
    if (!access.isActive) {
      return res.status(200).json({
        success: true,
        hasAccess: false,
        message: "Access is not active",
        userPermissions: [],
        requiredPermissions,
        missingPermissions: requiredPermissions
      });
    }

    // Check if access has expired
    if (access.expiresAt && new Date(access.expiresAt) < new Date()) {
      return res.status(200).json({
        success: true,
        hasAccess: false,
        message: "Access has expired",
        userPermissions: [],
        requiredPermissions,
        missingPermissions: requiredPermissions
      });
    }

    // Check permissions
    const userPermissions = access.permissions || [];
    const hasAllPermissions = requiredPermissions.every(p => 
      userPermissions.includes(p) || userPermissions.includes('admin')
    );

    const missingPermissions = requiredPermissions.filter(p => 
      !userPermissions.includes(p) && !userPermissions.includes('admin')
    );

    console.log(`[User Resources] Access check for user ${userId}: ${hasAllPermissions ? 'GRANTED' : 'DENIED'}`);

    return res.status(200).json({
      success: true,
      hasAccess: hasAllPermissions,
      userId,
      resourceType,
      resourceId,
      userPermissions,
      requiredPermissions,
      missingPermissions,
      grantedBy: access.grantedBy,
      grantedAt: access.grantedAt
    });

  } catch (error) {
    console.error("[User Resources] Error checking access:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to check resource access",
      details: error.message
    });
  }
}

/**
 * Get all users with access to a specific resource
 * GET /user-resources/resource/:resourceType/:resourceId/users
 */
export async function getResourceUsersHandler(req, res) {
  try {
    const { resourceType, resourceId } = req.params;
    const { activeOnly = "true" } = req.query;

    const compositeResourceId = `${resourceType}#${resourceId}`;

    // Scan for all users with this resource (note: less efficient, consider GSI for production)
    const command = new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "GrantedByIndex",
      FilterExpression: "resourceId = :resourceId",
      ExpressionAttributeValues: {
        ":resourceId": compositeResourceId
      }
    });

    // Alternative: Use Scan if GSI doesn't support this query pattern
    const scanCommand = {
      TableName: TABLE_NAME,
      FilterExpression: "resourceId = :resourceId",
      ExpressionAttributeValues: {
        ":resourceId": compositeResourceId
      }
    };

    // For now, let's do a more straightforward approach
    // This would need optimization for production with proper indexing
    const allUsersCommand = new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "ResourceTypeIndex"
    });

    // Better approach: scan with filter
    const response = await docClient.send({
      ...scanCommand,
      TableName: TABLE_NAME
    });

    let users = response.Items || [];

    // Filter active/expired access
    if (activeOnly === "true") {
      const now = new Date();
      users = users.filter(u => {
        if (!u.isActive) return false;
        if (u.expiresAt && new Date(u.expiresAt) < now) return false;
        return true;
      });
    }

    console.log(`[User Resources] Found ${users.length} users with access to ${resourceType}:${resourceId}`);

    return res.status(200).json({
      success: true,
      resourceType,
      resourceId,
      totalUsers: users.length,
      users: users.map(u => ({
        userId: u.userId,
        permissions: u.permissions,
        grantedBy: u.grantedBy,
        grantedAt: u.grantedAt,
        expiresAt: u.expiresAt
      }))
    });

  } catch (error) {
    console.error("[User Resources] Error getting resource users:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to get resource users",
      details: error.message
    });
  }
}

/**
 * Get resource access summary for a user
 * GET /user-resources/:userId/summary
 */
export async function getUserResourcesSummaryHandler(req, res) {
  try {
    const { userId } = req.params;

    const command = new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "userId = :userId",
      ExpressionAttributeValues: {
        ":userId": userId
      }
    });

    const response = await docClient.send(command);
    const resources = response.Items || [];

    // Filter active resources
    const now = new Date();
    const activeResources = resources.filter(r => {
      if (!r.isActive) return false;
      if (r.expiresAt && new Date(r.expiresAt) < now) return false;
      return true;
    });

    // Count by resource type
    const summary = {
      total: activeResources.length,
      byType: {},
      expiringSoon: [],
      recentlyGranted: []
    };

    activeResources.forEach(resource => {
      const type = resource.resourceType;
      summary.byType[type] = (summary.byType[type] || 0) + 1;

      // Check if expiring soon (within 7 days)
      if (resource.expiresAt) {
        const expiryDate = new Date(resource.expiresAt);
        const daysUntilExpiry = (expiryDate - now) / (1000 * 60 * 60 * 24);
        if (daysUntilExpiry <= 7 && daysUntilExpiry > 0) {
          summary.expiringSoon.push({
            resourceType: resource.resourceType,
            resourceId: resource.actualResourceId,
            expiresAt: resource.expiresAt,
            daysRemaining: Math.ceil(daysUntilExpiry)
          });
        }
      }

      // Check if recently granted (within 24 hours)
      const grantedDate = new Date(resource.grantedAt);
      const hoursAgo = (now - grantedDate) / (1000 * 60 * 60);
      if (hoursAgo <= 24) {
        summary.recentlyGranted.push({
          resourceType: resource.resourceType,
          resourceId: resource.actualResourceId,
          grantedAt: resource.grantedAt,
          grantedBy: resource.grantedBy
        });
      }
    });

    console.log(`[User Resources] Retrieved summary for user ${userId}: ${summary.total} active resources`);

    return res.status(200).json({
      success: true,
      userId,
      summary
    });

  } catch (error) {
    console.error("[User Resources] Error getting user summary:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to get user resources summary",
      details: error.message
    });
  }
}

/**
 * Get all available resource types and permissions
 * GET /user-resources/config
 */
export async function getResourceConfigHandler(req, res) {
  try {
    return res.status(200).json({
      success: true,
      config: {
        resourceTypes: RESOURCE_TYPES.map(type => ({
          value: type,
          label: type.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
          description: getResourceTypeDescription(type)
        })),
        permissionTypes: PERMISSION_TYPES.map(perm => ({
          value: perm,
          label: perm.charAt(0).toUpperCase() + perm.slice(1),
          description: getPermissionDescription(perm)
        }))
      }
    });
  } catch (error) {
    console.error("[User Resources] Error getting config:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to get resource config",
      details: error.message
    });
  }
}

// Helper functions
function getResourceTypeDescription(type) {
  const descriptions = {
    'namespace': 'Access to entire namespace and all its contents',
    'schema': 'Access to specific schema/table within namespace',
    'table': 'Access to specific table within namespace',
    'drive-folder': 'Access to specific folder in BRMH Drive',
    'drive-file': 'Access to specific file in BRMH Drive'
  };
  return descriptions[type] || '';
}

function getPermissionDescription(permission) {
  const descriptions = {
    'read': 'View and read access',
    'write': 'Create and update access',
    'delete': 'Delete access',
    'admin': 'Full administrative access (includes all permissions)',
    'execute': 'Execute operations (APIs, methods)',
    'share': 'Share resource with other users'
  };
  return descriptions[permission] || '';
}


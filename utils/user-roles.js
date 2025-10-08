import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  DeleteCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({ region: process.env.AWS_REGION || "us-east-1" });
const docClient = DynamoDBDocumentClient.from(client);

const USER_ROLES_TABLE = "brmh-user-roles";
const ROLES_PERMISSIONS_TABLE = "brmh-roles-permissions";

/**
 * Assign a role to a user in a specific namespace
 * POST /user-roles/assign
 */
export async function assignRoleToUserHandler(req, res) {
  try {
    const { userId, namespaceId, roleId, assignedBy, metadata = {} } = req.body;

    if (!userId || !namespaceId || !roleId) {
      return res.status(400).json({
        success: false,
        error: "userId, namespaceId, and roleId are required"
      });
    }

    // Verify that the role exists in the namespace
    const roleCommand = new GetCommand({
      TableName: ROLES_PERMISSIONS_TABLE,
      Key: {
        namespaceId,
        roleId
      }
    });

    const roleResponse = await docClient.send(roleCommand);

    if (!roleResponse.Item) {
      return res.status(404).json({
        success: false,
        error: `Role ${roleId} not found in namespace ${namespaceId}`
      });
    }

    const role = roleResponse.Item;
    const now = new Date().toISOString();

    // Create user-role assignment
    const assignment = {
      userId,
      namespaceId,
      roleId,
      roleName: role.roleName,
      permissions: role.permissions || [],
      assignedAt: now,
      updatedAt: now,
      assignedBy: assignedBy || "system",
      isActive: true,
      metadata
    };

    const command = new PutCommand({
      TableName: USER_ROLES_TABLE,
      Item: assignment
    });

    await docClient.send(command);

    console.log(`[User Roles] Assigned role ${roleId} to user ${userId} in namespace ${namespaceId}`);

    return res.status(201).json({
      success: true,
      assignment,
      message: "Role assigned successfully"
    });
  } catch (error) {
    console.error("[User Roles] Error assigning role:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to assign role",
      details: error.message
    });
  }
}

/**
 * Get a user's role in a specific namespace
 * GET /user-roles/:userId/namespaces/:namespaceId
 */
export async function getUserRoleInNamespaceHandler(req, res) {
  try {
    const { userId, namespaceId } = req.params;

    const command = new GetCommand({
      TableName: USER_ROLES_TABLE,
      Key: {
        userId,
        namespaceId
      }
    });

    const response = await docClient.send(command);

    if (!response.Item) {
      return res.status(404).json({
        success: false,
        error: "No role assigned to this user in this namespace"
      });
    }

    console.log(`[User Roles] Retrieved role for user ${userId} in namespace ${namespaceId}`);

    return res.status(200).json({
      success: true,
      assignment: response.Item
    });
  } catch (error) {
    console.error("[User Roles] Error getting user role:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to get user role",
      details: error.message
    });
  }
}

/**
 * Get all roles for a user (across all namespaces)
 * GET /user-roles/:userId
 */
export async function getAllUserRolesHandler(req, res) {
  try {
    const { userId } = req.params;
    const { activeOnly = "true" } = req.query;

    const command = new QueryCommand({
      TableName: USER_ROLES_TABLE,
      KeyConditionExpression: "userId = :userId",
      ExpressionAttributeValues: {
        ":userId": userId
      }
    });

    const response = await docClient.send(command);
    let assignments = response.Items || [];

    // Filter by active status if requested
    if (activeOnly === "true") {
      assignments = assignments.filter(assignment => assignment.isActive !== false);
    }

    console.log(`[User Roles] Retrieved ${assignments.length} roles for user ${userId}`);

    return res.status(200).json({
      success: true,
      userId,
      count: assignments.length,
      assignments
    });
  } catch (error) {
    console.error("[User Roles] Error getting all user roles:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to get user roles",
      details: error.message
    });
  }
}

/**
 * Get all users with a specific role in a namespace
 * GET /user-roles/roles/:roleId/namespaces/:namespaceId/users
 */
export async function getUsersWithRoleHandler(req, res) {
  try {
    const { roleId, namespaceId } = req.params;
    const { activeOnly = "true" } = req.query;

    const command = new QueryCommand({
      TableName: USER_ROLES_TABLE,
      IndexName: "RoleIndex",
      KeyConditionExpression: "roleId = :roleId AND namespaceId = :namespaceId",
      ExpressionAttributeValues: {
        ":roleId": roleId,
        ":namespaceId": namespaceId
      }
    });

    const response = await docClient.send(command);
    let users = response.Items || [];

    // Filter by active status if requested
    if (activeOnly === "true") {
      users = users.filter(user => user.isActive !== false);
    }

    console.log(`[User Roles] Found ${users.length} users with role ${roleId} in namespace ${namespaceId}`);

    return res.status(200).json({
      success: true,
      roleId,
      namespaceId,
      count: users.length,
      users
    });
  } catch (error) {
    console.error("[User Roles] Error getting users with role:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to get users with role",
      details: error.message
    });
  }
}

/**
 * Remove a role from a user in a namespace
 * DELETE /user-roles/:userId/namespaces/:namespaceId
 */
export async function removeRoleFromUserHandler(req, res) {
  try {
    const { userId, namespaceId } = req.params;
    const { hardDelete = "false" } = req.query;

    if (hardDelete === "true") {
      // Hard delete - completely remove the assignment
      const command = new DeleteCommand({
        TableName: USER_ROLES_TABLE,
        Key: {
          userId,
          namespaceId
        },
        ConditionExpression: "attribute_exists(userId)"
      });

      await docClient.send(command);

      console.log(`[User Roles] Hard deleted role assignment for user ${userId} in namespace ${namespaceId}`);

      return res.status(200).json({
        success: true,
        message: "Role assignment permanently removed"
      });
    } else {
      // Soft delete - mark as inactive
      const command = new UpdateCommand({
        TableName: USER_ROLES_TABLE,
        Key: {
          userId,
          namespaceId
        },
        UpdateExpression: "SET #isActive = :isActive, #updatedAt = :updatedAt",
        ExpressionAttributeNames: {
          "#isActive": "isActive",
          "#updatedAt": "updatedAt"
        },
        ExpressionAttributeValues: {
          ":isActive": false,
          ":updatedAt": new Date().toISOString()
        },
        ConditionExpression: "attribute_exists(userId)",
        ReturnValues: "ALL_NEW"
      });

      const response = await docClient.send(command);

      console.log(`[User Roles] Soft deleted role assignment for user ${userId} in namespace ${namespaceId}`);

      return res.status(200).json({
        success: true,
        assignment: response.Attributes,
        message: "Role assignment deactivated"
      });
    }
  } catch (error) {
    console.error("[User Roles] Error removing role:", error);
    
    if (error.name === "ConditionalCheckFailedException") {
      return res.status(404).json({
        success: false,
        error: "Role assignment not found"
      });
    }
    
    return res.status(500).json({
      success: false,
      error: "Failed to remove role",
      details: error.message
    });
  }
}

/**
 * Update a user's role in a namespace
 * PUT /user-roles/:userId/namespaces/:namespaceId
 */
export async function updateUserRoleHandler(req, res) {
  try {
    const { userId, namespaceId } = req.params;
    const { roleId, isActive, metadata } = req.body;

    if (!roleId) {
      return res.status(400).json({
        success: false,
        error: "roleId is required"
      });
    }

    // Verify that the new role exists in the namespace
    const roleCommand = new GetCommand({
      TableName: ROLES_PERMISSIONS_TABLE,
      Key: {
        namespaceId,
        roleId
      }
    });

    const roleResponse = await docClient.send(roleCommand);

    if (!roleResponse.Item) {
      return res.status(404).json({
        success: false,
        error: `Role ${roleId} not found in namespace ${namespaceId}`
      });
    }

    const role = roleResponse.Item;
    const now = new Date().toISOString();

    // Build update expression
    const updateExpressions = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};

    updateExpressions.push("#roleId = :roleId");
    expressionAttributeNames["#roleId"] = "roleId";
    expressionAttributeValues[":roleId"] = roleId;

    updateExpressions.push("#roleName = :roleName");
    expressionAttributeNames["#roleName"] = "roleName";
    expressionAttributeValues[":roleName"] = role.roleName;

    updateExpressions.push("#permissions = :permissions");
    expressionAttributeNames["#permissions"] = "permissions";
    expressionAttributeValues[":permissions"] = role.permissions || [];

    if (isActive !== undefined) {
      updateExpressions.push("#isActive = :isActive");
      expressionAttributeNames["#isActive"] = "isActive";
      expressionAttributeValues[":isActive"] = isActive;
    }

    if (metadata !== undefined) {
      updateExpressions.push("#metadata = :metadata");
      expressionAttributeNames["#metadata"] = "metadata";
      expressionAttributeValues[":metadata"] = metadata;
    }

    updateExpressions.push("#updatedAt = :updatedAt");
    expressionAttributeNames["#updatedAt"] = "updatedAt";
    expressionAttributeValues[":updatedAt"] = now;

    const command = new UpdateCommand({
      TableName: USER_ROLES_TABLE,
      Key: {
        userId,
        namespaceId
      },
      UpdateExpression: `SET ${updateExpressions.join(", ")}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ConditionExpression: "attribute_exists(userId)",
      ReturnValues: "ALL_NEW"
    });

    const response = await docClient.send(command);

    console.log(`[User Roles] Updated role for user ${userId} in namespace ${namespaceId}`);

    return res.status(200).json({
      success: true,
      assignment: response.Attributes,
      message: "Role updated successfully"
    });
  } catch (error) {
    console.error("[User Roles] Error updating role:", error);
    
    if (error.name === "ConditionalCheckFailedException") {
      return res.status(404).json({
        success: false,
        error: "Role assignment not found"
      });
    }
    
    return res.status(500).json({
      success: false,
      error: "Failed to update role",
      details: error.message
    });
  }
}

/**
 * Check if a user has specific permissions in a namespace
 * POST /user-roles/:userId/namespaces/:namespaceId/check-permissions
 */
export async function checkUserPermissionsHandler(req, res) {
  try {
    const { userId, namespaceId } = req.params;
    const { requiredPermissions } = req.body;

    if (!requiredPermissions || !Array.isArray(requiredPermissions)) {
      return res.status(400).json({
        success: false,
        error: "requiredPermissions array is required"
      });
    }

    // Get user's role assignment in this namespace
    const command = new GetCommand({
      TableName: USER_ROLES_TABLE,
      Key: {
        userId,
        namespaceId
      }
    });

    const response = await docClient.send(command);

    if (!response.Item) {
      return res.status(404).json({
        success: false,
        error: "User has no role assigned in this namespace"
      });
    }

    const assignment = response.Item;

    // Check if assignment is active
    if (assignment.isActive === false) {
      return res.status(403).json({
        success: false,
        hasPermissions: false,
        error: "User's role assignment is inactive",
        userPermissions: [],
        requiredPermissions,
        missingPermissions: requiredPermissions
      });
    }

    const userPermissions = assignment.permissions || [];
    const hasAllPermissions = requiredPermissions.every(
      permission => userPermissions.includes(permission)
    );

    const missingPermissions = requiredPermissions.filter(
      permission => !userPermissions.includes(permission)
    );

    return res.status(200).json({
      success: true,
      hasPermissions: hasAllPermissions,
      userId,
      namespaceId,
      roleId: assignment.roleId,
      roleName: assignment.roleName,
      userPermissions,
      requiredPermissions,
      missingPermissions
    });
  } catch (error) {
    console.error("[User Roles] Error checking permissions:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to check permissions",
      details: error.message
    });
  }
}

/**
 * Get user's permissions summary across all namespaces
 * GET /user-roles/:userId/permissions-summary
 */
export async function getUserPermissionsSummaryHandler(req, res) {
  try {
    const { userId } = req.params;

    const command = new QueryCommand({
      TableName: USER_ROLES_TABLE,
      KeyConditionExpression: "userId = :userId",
      ExpressionAttributeValues: {
        ":userId": userId
      }
    });

    const response = await docClient.send(command);
    const assignments = (response.Items || []).filter(a => a.isActive !== false);

    const summary = assignments.map(assignment => ({
      namespaceId: assignment.namespaceId,
      roleId: assignment.roleId,
      roleName: assignment.roleName,
      permissions: assignment.permissions || [],
      assignedAt: assignment.assignedAt
    }));

    // Get unique permissions across all namespaces
    const allPermissions = [...new Set(
      assignments.flatMap(a => a.permissions || [])
    )];

    console.log(`[User Roles] Retrieved permissions summary for user ${userId}`);

    return res.status(200).json({
      success: true,
      userId,
      totalNamespaces: assignments.length,
      totalUniquePermissions: allPermissions.length,
      allPermissions,
      namespaceRoles: summary
    });
  } catch (error) {
    console.error("[User Roles] Error getting permissions summary:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to get permissions summary",
      details: error.message
    });
  }
}


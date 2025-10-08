import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand
} from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from 'uuid';

const client = new DynamoDBClient({ region: process.env.AWS_REGION || "us-east-1" });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = "brmh-roles-permissions";

/**
 * Create a new role for a namespace
 * POST /roles-permissions/namespaces/:namespaceId/roles
 */
export async function createRoleHandler(req, res) {
  try {
    const { namespaceId } = req.params;
    const { roleName, roleDescription, permissions = [], createdBy, metadata = {} } = req.body;

    if (!roleName) {
      return res.status(400).json({ 
        success: false, 
        error: "roleName is required" 
      });
    }

    const roleId = `role-${uuidv4()}`;
    const now = new Date().toISOString();

    const roleItem = {
      namespaceId,
      roleId,
      roleName,
      roleDescription: roleDescription || "",
      permissions: permissions || [],
      createdAt: now,
      updatedAt: now,
      createdBy: createdBy || "system",
      isActive: true,
      metadata
    };

    const command = new PutCommand({
      TableName: TABLE_NAME,
      Item: roleItem,
      ConditionExpression: "attribute_not_exists(roleId)"
    });

    await docClient.send(command);

    console.log(`[Roles] Created role: ${roleId} for namespace: ${namespaceId}`);

    return res.status(201).json({
      success: true,
      role: roleItem,
      message: "Role created successfully"
    });
  } catch (error) {
    console.error("[Roles] Error creating role:", error);
    
    if (error.name === "ConditionalCheckFailedException") {
      return res.status(409).json({
        success: false,
        error: "Role already exists"
      });
    }
    
    return res.status(500).json({
      success: false,
      error: "Failed to create role",
      details: error.message
    });
  }
}

/**
 * Get all roles for a namespace
 * GET /roles-permissions/namespaces/:namespaceId/roles
 */
export async function getRolesHandler(req, res) {
  try {
    const { namespaceId } = req.params;
    const { activeOnly = "true" } = req.query;

    const command = new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "namespaceId = :namespaceId",
      ExpressionAttributeValues: {
        ":namespaceId": namespaceId
      }
    });

    const response = await docClient.send(command);
    let roles = response.Items || [];

    // Filter by active status if requested
    if (activeOnly === "true") {
      roles = roles.filter(role => role.isActive !== false);
    }

    console.log(`[Roles] Retrieved ${roles.length} roles for namespace: ${namespaceId}`);

    return res.status(200).json({
      success: true,
      namespaceId,
      count: roles.length,
      roles
    });
  } catch (error) {
    console.error("[Roles] Error getting roles:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to get roles",
      details: error.message
    });
  }
}

/**
 * Get a specific role
 * GET /roles-permissions/namespaces/:namespaceId/roles/:roleId
 */
export async function getRoleByIdHandler(req, res) {
  try {
    const { namespaceId, roleId } = req.params;

    const command = new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        namespaceId,
        roleId
      }
    });

    const response = await docClient.send(command);

    if (!response.Item) {
      return res.status(404).json({
        success: false,
        error: "Role not found"
      });
    }

    console.log(`[Roles] Retrieved role: ${roleId}`);

    return res.status(200).json({
      success: true,
      role: response.Item
    });
  } catch (error) {
    console.error("[Roles] Error getting role:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to get role",
      details: error.message
    });
  }
}

/**
 * Update a role
 * PUT /roles-permissions/namespaces/:namespaceId/roles/:roleId
 */
export async function updateRoleHandler(req, res) {
  try {
    const { namespaceId, roleId } = req.params;
    const { roleName, roleDescription, permissions, isActive, metadata } = req.body;

    // Build update expression dynamically
    const updateExpressions = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};

    if (roleName !== undefined) {
      updateExpressions.push("#roleName = :roleName");
      expressionAttributeNames["#roleName"] = "roleName";
      expressionAttributeValues[":roleName"] = roleName;
    }

    if (roleDescription !== undefined) {
      updateExpressions.push("#roleDescription = :roleDescription");
      expressionAttributeNames["#roleDescription"] = "roleDescription";
      expressionAttributeValues[":roleDescription"] = roleDescription;
    }

    if (permissions !== undefined) {
      updateExpressions.push("#permissions = :permissions");
      expressionAttributeNames["#permissions"] = "permissions";
      expressionAttributeValues[":permissions"] = permissions;
    }

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

    // Always update the updatedAt timestamp
    updateExpressions.push("#updatedAt = :updatedAt");
    expressionAttributeNames["#updatedAt"] = "updatedAt";
    expressionAttributeValues[":updatedAt"] = new Date().toISOString();

    if (updateExpressions.length === 1) { // Only updatedAt
      return res.status(400).json({
        success: false,
        error: "No fields to update"
      });
    }

    const command = new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        namespaceId,
        roleId
      },
      UpdateExpression: `SET ${updateExpressions.join(", ")}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ConditionExpression: "attribute_exists(roleId)",
      ReturnValues: "ALL_NEW"
    });

    const response = await docClient.send(command);

    console.log(`[Roles] Updated role: ${roleId}`);

    return res.status(200).json({
      success: true,
      role: response.Attributes,
      message: "Role updated successfully"
    });
  } catch (error) {
    console.error("[Roles] Error updating role:", error);
    
    if (error.name === "ConditionalCheckFailedException") {
      return res.status(404).json({
        success: false,
        error: "Role not found"
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
 * Delete a role
 * DELETE /roles-permissions/namespaces/:namespaceId/roles/:roleId
 */
export async function deleteRoleHandler(req, res) {
  try {
    const { namespaceId, roleId } = req.params;
    const { hardDelete = "false" } = req.query;

    if (hardDelete === "true") {
      // Hard delete - completely remove from database
      const command = new DeleteCommand({
        TableName: TABLE_NAME,
        Key: {
          namespaceId,
          roleId
        },
        ConditionExpression: "attribute_exists(roleId)"
      });

      await docClient.send(command);

      console.log(`[Roles] Hard deleted role: ${roleId}`);

      return res.status(200).json({
        success: true,
        message: "Role permanently deleted"
      });
    } else {
      // Soft delete - mark as inactive
      const command = new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          namespaceId,
          roleId
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
        ConditionExpression: "attribute_exists(roleId)",
        ReturnValues: "ALL_NEW"
      });

      const response = await docClient.send(command);

      console.log(`[Roles] Soft deleted role: ${roleId}`);

      return res.status(200).json({
        success: true,
        role: response.Attributes,
        message: "Role deactivated successfully"
      });
    }
  } catch (error) {
    console.error("[Roles] Error deleting role:", error);
    
    if (error.name === "ConditionalCheckFailedException") {
      return res.status(404).json({
        success: false,
        error: "Role not found"
      });
    }
    
    return res.status(500).json({
      success: false,
      error: "Failed to delete role",
      details: error.message
    });
  }
}

/**
 * Add permissions to a role
 * POST /roles-permissions/namespaces/:namespaceId/roles/:roleId/permissions
 */
export async function addPermissionsHandler(req, res) {
  try {
    const { namespaceId, roleId } = req.params;
    const { permissions } = req.body;

    if (!permissions || !Array.isArray(permissions) || permissions.length === 0) {
      return res.status(400).json({
        success: false,
        error: "permissions array is required and must not be empty"
      });
    }

    // First, get the current role to check existing permissions
    const getCommand = new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        namespaceId,
        roleId
      }
    });

    const getResponse = await docClient.send(getCommand);

    if (!getResponse.Item) {
      return res.status(404).json({
        success: false,
        error: "Role not found"
      });
    }

    // Merge new permissions with existing ones (avoid duplicates)
    const existingPermissions = getResponse.Item.permissions || [];
    const updatedPermissions = [...new Set([...existingPermissions, ...permissions])];

    // Update the role with new permissions
    const updateCommand = new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        namespaceId,
        roleId
      },
      UpdateExpression: "SET #permissions = :permissions, #updatedAt = :updatedAt",
      ExpressionAttributeNames: {
        "#permissions": "permissions",
        "#updatedAt": "updatedAt"
      },
      ExpressionAttributeValues: {
        ":permissions": updatedPermissions,
        ":updatedAt": new Date().toISOString()
      },
      ReturnValues: "ALL_NEW"
    });

    const updateResponse = await docClient.send(updateCommand);

    console.log(`[Roles] Added permissions to role: ${roleId}`);

    return res.status(200).json({
      success: true,
      role: updateResponse.Attributes,
      addedPermissions: permissions,
      message: "Permissions added successfully"
    });
  } catch (error) {
    console.error("[Roles] Error adding permissions:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to add permissions",
      details: error.message
    });
  }
}

/**
 * Remove permissions from a role
 * DELETE /roles-permissions/namespaces/:namespaceId/roles/:roleId/permissions
 */
export async function removePermissionsHandler(req, res) {
  try {
    const { namespaceId, roleId } = req.params;
    const { permissions } = req.body;

    if (!permissions || !Array.isArray(permissions) || permissions.length === 0) {
      return res.status(400).json({
        success: false,
        error: "permissions array is required and must not be empty"
      });
    }

    // First, get the current role
    const getCommand = new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        namespaceId,
        roleId
      }
    });

    const getResponse = await docClient.send(getCommand);

    if (!getResponse.Item) {
      return res.status(404).json({
        success: false,
        error: "Role not found"
      });
    }

    // Remove specified permissions
    const existingPermissions = getResponse.Item.permissions || [];
    const updatedPermissions = existingPermissions.filter(
      permission => !permissions.includes(permission)
    );

    // Update the role with filtered permissions
    const updateCommand = new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        namespaceId,
        roleId
      },
      UpdateExpression: "SET #permissions = :permissions, #updatedAt = :updatedAt",
      ExpressionAttributeNames: {
        "#permissions": "permissions",
        "#updatedAt": "updatedAt"
      },
      ExpressionAttributeValues: {
        ":permissions": updatedPermissions,
        ":updatedAt": new Date().toISOString()
      },
      ReturnValues: "ALL_NEW"
    });

    const updateResponse = await docClient.send(updateCommand);

    console.log(`[Roles] Removed permissions from role: ${roleId}`);

    return res.status(200).json({
      success: true,
      role: updateResponse.Attributes,
      removedPermissions: permissions,
      message: "Permissions removed successfully"
    });
  } catch (error) {
    console.error("[Roles] Error removing permissions:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to remove permissions",
      details: error.message
    });
  }
}

/**
 * Check if a user has specific permissions in a namespace
 * POST /roles-permissions/namespaces/:namespaceId/check-permissions
 */
export async function checkPermissionsHandler(req, res) {
  try {
    const { namespaceId } = req.params;
    const { roleId, requiredPermissions } = req.body;

    if (!roleId || !requiredPermissions || !Array.isArray(requiredPermissions)) {
      return res.status(400).json({
        success: false,
        error: "roleId and requiredPermissions array are required"
      });
    }

    const command = new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        namespaceId,
        roleId
      }
    });

    const response = await docClient.send(command);

    if (!response.Item) {
      return res.status(404).json({
        success: false,
        error: "Role not found"
      });
    }

    const rolePermissions = response.Item.permissions || [];
    const hasAllPermissions = requiredPermissions.every(
      permission => rolePermissions.includes(permission)
    );

    const missingPermissions = requiredPermissions.filter(
      permission => !rolePermissions.includes(permission)
    );

    return res.status(200).json({
      success: true,
      hasPermissions: hasAllPermissions,
      rolePermissions,
      requiredPermissions,
      missingPermissions
    });
  } catch (error) {
    console.error("[Roles] Error checking permissions:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to check permissions",
      details: error.message
    });
  }
}


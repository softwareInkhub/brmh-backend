import { getUserRecord, updateUserRecord } from './brmh-auth.js';

/**
 * Assign a role to a user in a specific namespace
 * POST /namespace-roles/assign
 */
export async function assignNamespaceRoleHandler(req, res) {
  try {
    const { userId, namespace, role, permissions, assignedBy } = req.body;

    if (!userId || !namespace || !role || !permissions) {
      return res.status(400).json({
        success: false,
        error: "userId, namespace, role, and permissions are required"
      });
    }

    // Get current user record
    const userRecord = await getUserRecord(userId);

    if (!userRecord) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    const now = new Date().toISOString();
    const namespaceRoles = userRecord.namespaceRoles || {};

    // Add or update namespace role
    namespaceRoles[namespace] = {
      role,
      permissions: Array.isArray(permissions) ? permissions : [permissions],
      assignedAt: namespaceRoles[namespace]?.assignedAt || now,
      updatedAt: now,
      assignedBy: assignedBy || 'admin'
    };

    // Also update accessed namespaces list
    const metadata = userRecord.metadata || {};
    const accessedNamespaces = metadata.accessedNamespaces || [];
    if (!accessedNamespaces.includes(namespace)) {
      accessedNamespaces.push(namespace);
    }

    // Update user record
    await updateUserRecord(userId, {
      namespaceRoles,
      'metadata.accessedNamespaces': accessedNamespaces
    });

    console.log(`[Namespace Roles] Assigned role "${role}" to user ${userId} in namespace "${namespace}"`);

    return res.status(200).json({
      success: true,
      message: "Role assigned successfully",
      namespaceRole: namespaceRoles[namespace]
    });
  } catch (error) {
    console.error("[Namespace Roles] Error assigning role:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to assign role",
      details: error.message
    });
  }
}

/**
 * Get a user's role in a specific namespace
 * GET /namespace-roles/:userId/:namespace
 */
export async function getNamespaceRoleHandler(req, res) {
  try {
    const { userId, namespace } = req.params;

    const userRecord = await getUserRecord(userId);

    if (!userRecord) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    const namespaceRoles = userRecord.namespaceRoles || {};
    const namespaceRole = namespaceRoles[namespace];

    if (!namespaceRole) {
      return res.status(404).json({
        success: false,
        error: `No role assigned for namespace "${namespace}"`
      });
    }

    console.log(`[Namespace Roles] Retrieved role for user ${userId} in namespace "${namespace}"`);

    return res.status(200).json({
      success: true,
      userId,
      namespace,
      role: namespaceRole.role,
      permissions: namespaceRole.permissions,
      assignedAt: namespaceRole.assignedAt,
      updatedAt: namespaceRole.updatedAt,
      assignedBy: namespaceRole.assignedBy
    });
  } catch (error) {
    console.error("[Namespace Roles] Error getting role:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to get role",
      details: error.message
    });
  }
}

/**
 * Get all namespace roles for a user
 * GET /namespace-roles/:userId
 */
export async function getAllNamespaceRolesHandler(req, res) {
  try {
    const { userId } = req.params;

    const userRecord = await getUserRecord(userId);

    if (!userRecord) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    const namespaceRoles = userRecord.namespaceRoles || {};

    console.log(`[Namespace Roles] Retrieved all roles for user ${userId}`);

    return res.status(200).json({
      success: true,
      userId,
      totalNamespaces: Object.keys(namespaceRoles).length,
      namespaceRoles
    });
  } catch (error) {
    console.error("[Namespace Roles] Error getting all roles:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to get roles",
      details: error.message
    });
  }
}

/**
 * Update a user's role in a namespace
 * PUT /namespace-roles/:userId/:namespace
 */
export async function updateNamespaceRoleHandler(req, res) {
  try {
    const { userId, namespace } = req.params;
    const { role, permissions, assignedBy } = req.body;

    if (!role && !permissions) {
      return res.status(400).json({
        success: false,
        error: "At least one of role or permissions is required"
      });
    }

    const userRecord = await getUserRecord(userId);

    if (!userRecord) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    const namespaceRoles = userRecord.namespaceRoles || {};

    if (!namespaceRoles[namespace]) {
      return res.status(404).json({
        success: false,
        error: `No role assigned for namespace "${namespace}"`
      });
    }

    const now = new Date().toISOString();

    // Update the namespace role
    if (role) {
      namespaceRoles[namespace].role = role;
    }
    if (permissions) {
      namespaceRoles[namespace].permissions = Array.isArray(permissions) ? permissions : [permissions];
    }
    if (assignedBy) {
      namespaceRoles[namespace].assignedBy = assignedBy;
    }
    namespaceRoles[namespace].updatedAt = now;

    // Update user record
    await updateUserRecord(userId, { namespaceRoles });

    console.log(`[Namespace Roles] Updated role for user ${userId} in namespace "${namespace}"`);

    return res.status(200).json({
      success: true,
      message: "Role updated successfully",
      namespaceRole: namespaceRoles[namespace]
    });
  } catch (error) {
    console.error("[Namespace Roles] Error updating role:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to update role",
      details: error.message
    });
  }
}

/**
 * Remove a user's role from a namespace
 * DELETE /namespace-roles/:userId/:namespace
 */
export async function removeNamespaceRoleHandler(req, res) {
  try {
    const { userId, namespace } = req.params;

    const userRecord = await getUserRecord(userId);

    if (!userRecord) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    const namespaceRoles = userRecord.namespaceRoles || {};

    if (!namespaceRoles[namespace]) {
      return res.status(404).json({
        success: false,
        error: `No role assigned for namespace "${namespace}"`
      });
    }

    // Remove the namespace role
    delete namespaceRoles[namespace];

    // Update user record
    await updateUserRecord(userId, { namespaceRoles });

    console.log(`[Namespace Roles] Removed role for user ${userId} from namespace "${namespace}"`);

    return res.status(200).json({
      success: true,
      message: "Role removed successfully"
    });
  } catch (error) {
    console.error("[Namespace Roles] Error removing role:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to remove role",
      details: error.message
    });
  }
}

/**
 * Check if a user has specific permissions in a namespace
 * POST /namespace-roles/:userId/:namespace/check-permissions
 */
export async function checkNamespacePermissionsHandler(req, res) {
  try {
    const { userId, namespace } = req.params;
    const { requiredPermissions } = req.body;

    if (!requiredPermissions || !Array.isArray(requiredPermissions)) {
      return res.status(400).json({
        success: false,
        error: "requiredPermissions array is required"
      });
    }

    const userRecord = await getUserRecord(userId);

    if (!userRecord) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    const namespaceRoles = userRecord.namespaceRoles || {};
    const namespaceRole = namespaceRoles[namespace];

    if (!namespaceRole) {
      return res.status(404).json({
        success: false,
        hasPermissions: false,
        error: `No role assigned for namespace "${namespace}"`,
        userPermissions: [],
        requiredPermissions,
        missingPermissions: requiredPermissions
      });
    }

    const userPermissions = namespaceRole.permissions || [];
    const hasAllPermissions = requiredPermissions.every(
      permission => userPermissions.includes(permission)
    );

    const missingPermissions = requiredPermissions.filter(
      permission => !userPermissions.includes(permission)
    );

    console.log(`[Namespace Roles] Checked permissions for user ${userId} in namespace "${namespace}"`);

    return res.status(200).json({
      success: true,
      hasPermissions: hasAllPermissions,
      userId,
      namespace,
      role: namespaceRole.role,
      userPermissions,
      requiredPermissions,
      missingPermissions
    });
  } catch (error) {
    console.error("[Namespace Roles] Error checking permissions:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to check permissions",
      details: error.message
    });
  }
}

/**
 * Add permissions to a user's role in a namespace
 * POST /namespace-roles/:userId/:namespace/add-permissions
 */
export async function addNamespacePermissionsHandler(req, res) {
  try {
    const { userId, namespace } = req.params;
    const { permissions } = req.body;

    if (!permissions || !Array.isArray(permissions)) {
      return res.status(400).json({
        success: false,
        error: "permissions array is required"
      });
    }

    const userRecord = await getUserRecord(userId);

    if (!userRecord) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    const namespaceRoles = userRecord.namespaceRoles || {};

    if (!namespaceRoles[namespace]) {
      return res.status(404).json({
        success: false,
        error: `No role assigned for namespace "${namespace}"`
      });
    }

    const currentPermissions = namespaceRoles[namespace].permissions || [];
    const newPermissions = [...new Set([...currentPermissions, ...permissions])];

    namespaceRoles[namespace].permissions = newPermissions;
    namespaceRoles[namespace].updatedAt = new Date().toISOString();

    await updateUserRecord(userId, { namespaceRoles });

    console.log(`[Namespace Roles] Added permissions for user ${userId} in namespace "${namespace}"`);

    return res.status(200).json({
      success: true,
      message: "Permissions added successfully",
      addedPermissions: permissions,
      allPermissions: newPermissions
    });
  } catch (error) {
    console.error("[Namespace Roles] Error adding permissions:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to add permissions",
      details: error.message
    });
  }
}

/**
 * Remove permissions from a user's role in a namespace
 * POST /namespace-roles/:userId/:namespace/remove-permissions
 */
export async function removeNamespacePermissionsHandler(req, res) {
  try {
    const { userId, namespace } = req.params;
    const { permissions } = req.body;

    if (!permissions || !Array.isArray(permissions)) {
      return res.status(400).json({
        success: false,
        error: "permissions array is required"
      });
    }

    const userRecord = await getUserRecord(userId);

    if (!userRecord) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    const namespaceRoles = userRecord.namespaceRoles || {};

    if (!namespaceRoles[namespace]) {
      return res.status(404).json({
        success: false,
        error: `No role assigned for namespace "${namespace}"`
      });
    }

    const currentPermissions = namespaceRoles[namespace].permissions || [];
    const newPermissions = currentPermissions.filter(p => !permissions.includes(p));

    namespaceRoles[namespace].permissions = newPermissions;
    namespaceRoles[namespace].updatedAt = new Date().toISOString();

    await updateUserRecord(userId, { namespaceRoles });

    console.log(`[Namespace Roles] Removed permissions for user ${userId} in namespace "${namespace}"`);

    return res.status(200).json({
      success: true,
      message: "Permissions removed successfully",
      removedPermissions: permissions,
      remainingPermissions: newPermissions
    });
  } catch (error) {
    console.error("[Namespace Roles] Error removing permissions:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to remove permissions",
      details: error.message
    });
  }
}


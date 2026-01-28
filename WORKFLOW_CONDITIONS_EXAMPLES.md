# Workflow Conditions - Complete Guide

## ✅ Yes! You Can Use Conditions in Workflows

The workflow system now supports **conditional branching** using Choice/Condition steps. This allows you to create workflows that take different paths based on data values.

---

## 🎯 How It Works

Conditions use AWS Step Functions **Choice states** to evaluate data and route to different steps based on the results.

---

## 📋 Basic Syntax

### Choice Step Structure

```json
{
  "id": "checkCondition",
  "type": "choice",  // or "condition"
  "conditions": [
    {
      "variable": "$.stepId.result.field",  // JSON path to check
      "operator": "equals",                  // Comparison operator
      "value": "expected-value",            // Value to compare
      "next": "stepIdIfTrue"                // Step to go to if true
    }
  ],
  "default": "stepIdIfFalse"  // Step to go to if no conditions match
}
```

---

## 🔍 Supported Operators

### String Comparisons

| Operator | Description | Example |
|----------|-------------|---------|
| `equals`, `==`, `===` | Exact match | `"status" equals "active"` |
| `notequals`, `!==` | Not equal | `"status" notequals "inactive"` |
| `contains`, `matches` | Contains substring | `"message" contains "error"` |
| `startswith` | Starts with | `"email" startswith "admin@"` |
| `endswith` | Ends with | `"file" endswith ".json"` |

### Numeric Comparisons

| Operator | Description | Example |
|----------|-------------|---------|
| `greaterthan`, `>` | Greater than | `"price" > 100` |
| `greaterthanorequal`, `>=` | Greater than or equal | `"price" >= 100` |
| `lessthan`, `<` | Less than | `"price" < 100` |
| `lessthanorequal`, `<=` | Less than or equal | `"price" <= 100` |

### Boolean Comparisons

| Operator | Description | Example |
|----------|-------------|---------|
| `istrue`, `true` | Is true | `"success" istrue` |
| `isfalse`, `false` | Is false | `"success" isfalse` |

### Presence Checks

| Operator | Description | Example |
|----------|-------------|---------|
| `exists`, `present` | Field exists | `"error" exists` |
| `notexists`, `notpresent` | Field doesn't exist | `"error" notexists` |

---

## 📝 Examples

### Example 1: Check API Success

```json
{
  "name": "Create Product with Validation",
  "steps": [
    {
      "id": "createProduct",
      "type": "api",
      "methodId": "shopify-create-product",
      "accountId": "shopify-account",
      "namespaceId": "shopify-namespace",
      "resultKey": "productResult",
      "next": "checkSuccess"
    },
    {
      "id": "checkSuccess",
      "type": "choice",
      "conditions": [
        {
          "variable": "$.productResult.success",
          "operator": "istrue",
          "next": "sendSuccessNotification"
        }
      ],
      "default": "handleError"
    },
    {
      "id": "sendSuccessNotification",
      "type": "api",
      "methodId": "whapi-send-message",
      "accountId": "whapi-account",
      "namespaceId": "whapi-namespace",
      "inputMapping": {
        "message": "Product created successfully!"
      },
      "next": "done"
    },
    {
      "id": "handleError",
      "type": "sns",
      "topicArn": "arn:aws:sns:...:ErrorTopic",
      "message": "Product creation failed",
      "next": "done"
    },
    {
      "id": "done",
      "type": "end"
    }
  ]
}
```

### Example 2: Check Product Status

```json
{
  "id": "checkProductStatus",
  "type": "choice",
  "conditions": [
    {
      "variable": "$.productResult.data.status",
      "operator": "equals",
      "value": "active",
      "next": "sendActiveNotification"
    },
    {
      "variable": "$.productResult.data.status",
      "operator": "equals",
      "value": "pending",
      "next": "waitForActivation"
    },
    {
      "variable": "$.productResult.data.status",
      "operator": "equals",
      "value": "draft",
      "next": "publishProduct"
    }
  ],
  "default": "handleUnknownStatus"
}
```

### Example 3: Check Price Range

```json
{
  "id": "checkPrice",
  "type": "choice",
  "conditions": [
    {
      "variable": "$.productResult.data.price",
      "operator": "greaterthan",
      "value": 1000,
      "next": "sendHighValueAlert"
    },
    {
      "variable": "$.productResult.data.price",
      "operator": "greaterthanorequal",
      "value": 100,
      "next": "sendMediumValueNotification"
    }
  ],
  "default": "sendLowValueNotification"
}
```

### Example 4: Check Error Presence

```json
{
  "id": "checkForErrors",
  "type": "choice",
  "conditions": [
    {
      "variable": "$.apiResult.error",
      "operator": "exists",
      "next": "handleError"
    }
  ],
  "default": "continueSuccess"
}
```

### Example 5: Complex Workflow with Multiple Conditions

```json
{
  "name": "Order Processing Workflow",
  "steps": [
    {
      "id": "createOrder",
      "type": "api",
      "methodId": "shopify-create-order",
      "resultKey": "orderResult",
      "next": "validateOrder"
    },
    {
      "id": "validateOrder",
      "type": "choice",
      "conditions": [
        {
          "variable": "$.orderResult.data.total_price",
          "operator": "greaterthan",
          "value": 500,
          "next": "requireApproval"
        },
        {
          "variable": "$.orderResult.data.currency",
          "operator": "notequals",
          "value": "USD",
          "next": "convertCurrency"
        },
        {
          "variable": "$.orderResult.data.fulfillment_status",
          "operator": "equals",
          "value": "fulfilled",
          "next": "sendShippingNotification"
        }
      ],
      "default": "processOrder"
    },
    {
      "id": "requireApproval",
      "type": "sns",
      "topicArn": "arn:aws:sns:...:ApprovalTopic",
      "message": "High-value order requires approval",
      "next": "done"
    },
    {
      "id": "convertCurrency",
      "type": "api",
      "methodId": "currency-converter",
      "next": "processOrder"
    },
    {
      "id": "sendShippingNotification",
      "type": "api",
      "methodId": "send-email",
      "next": "done"
    },
    {
      "id": "processOrder",
      "type": "api",
      "methodId": "process-payment",
      "next": "done"
    },
    {
      "id": "done",
      "type": "end"
    }
  ]
}
```

---

## 🔗 JSON Path Syntax

Conditions use JSON path to access data from previous steps:

### Basic Paths
- `$.productResult` - Access result from step with `resultKey: "productResult"`
- `$.productResult.data` - Access data field
- `$.productResult.data.status` - Access nested field
- `$.productResult.success` - Access success boolean

### From Input
- `$.input.title` - Access input data
- `$.input.price` - Access input field

### From Multiple Steps
- `$.step1Result.field` - Result from step1
- `$.step2Result.field` - Result from step2

---

## 💡 Best Practices

1. **Always provide a default path** - Handle cases where no conditions match
2. **Use descriptive step IDs** - Makes workflow easier to understand
3. **Check for errors first** - Use `exists` operator to check for error fields
4. **Order conditions logically** - Most specific conditions first
5. **Use appropriate operators** - Use numeric operators for numbers, string operators for strings

---

## 🚨 Common Patterns

### Pattern 1: Success/Failure Check

```json
{
  "id": "checkResult",
  "type": "choice",
  "conditions": [
    {
      "variable": "$.apiResult.success",
      "operator": "istrue",
      "next": "handleSuccess"
    }
  ],
  "default": "handleFailure"
}
```

### Pattern 2: Status-Based Routing

```json
{
  "id": "routeByStatus",
  "type": "choice",
  "conditions": [
    { "variable": "$.result.status", "operator": "equals", "value": "active", "next": "activePath" },
    { "variable": "$.result.status", "operator": "equals", "value": "pending", "next": "pendingPath" },
    { "variable": "$.result.status", "operator": "equals", "value": "inactive", "next": "inactivePath" }
  ],
  "default": "unknownStatusPath"
}
```

### Pattern 3: Value Range Check

```json
{
  "id": "checkRange",
  "type": "choice",
  "conditions": [
    { "variable": "$.result.value", "operator": "greaterthan", "value": 100, "next": "highValue" },
    { "variable": "$.result.value", "operator": "greaterthanorequal", "value": 50, "next": "mediumValue" }
  ],
  "default": "lowValue"
}
```

---

## 🎯 Summary

✅ **Yes, you can use conditions!**

- Use `type: "choice"` or `type: "condition"`
- Define conditions array with rules
- Each condition has: `variable`, `operator`, `value`, `next`
- Provide a `default` path for unmatched cases
- Supports string, numeric, boolean, and presence checks

**Conditions enable powerful workflow branching based on your data!** 🚀


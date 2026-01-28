# Complete Workflow System Flow

## 🏗️ Architecture Overview

**API Execution:** Step Functions native HTTP integration (direct REST API calls)  
**Data Transformation:** Lambda function (custom transformation logic)  
**Orchestration:** AWS Step Functions state machine

**Benefits:**
- ✅ Lower cost (no Lambda for API calls)
- ✅ Faster execution (no cold starts)
- ✅ Simpler architecture (direct HTTP calls)
- ✅ Better scalability

## 🎯 Complete End-to-End Flow

### Step 1: Create Workflow Definition

**API Call:**
```http
POST /workflows
Content-Type: application/json

{
  "name": "Create Product and Notify",
  "description": "Creates product in Shopify and sends WhatsApp message",
  "steps": [
    {
      "id": "createProduct",
      "type": "api",
      "methodId": "shopify-create-product-method-id",
      "accountId": "shopify-account-id",
      "namespaceId": "shopify-namespace-id",
      "input": {
        "title": "{{input.title}}",
        "price": "{{input.price}}"
      },
      "resultKey": "productResult",
      "next": "sendMessage"
    },
    {
      "id": "sendMessage",
      "type": "api",
      "methodId": "whapi-send-message-method-id",
      "accountId": "whapi-account-id",
      "namespaceId": "whapi-namespace-id",
      "inputMapping": {
        "message": "Product {{productResult.data.title}} created!"
      },
      "next": "done"
    },
    {
      "id": "done",
      "type": "end"
    }
  ],
  "status": "draft"
}
```

**What Happens:**
1. ✅ Validates workflow data
2. ✅ Generates unique `workflowId` (UUID)
3. ✅ Saves workflow to DynamoDB table `brmh-workflows`
4. ✅ Returns workflow object with `workflowId`

**Result:**
```json
{
  "success": true,
  "workflow": {
    "id": "abc-123-def-456",
    "workflowId": "abc-123-def-456",
    "name": "Create Product and Notify",
    "status": "draft",
    "steps": [...],
    "stateMachineArn": null,  // Not created yet
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

---

### Step 2: Deploy Workflow (Creates Lambda + State Machine)

**API Call:**
```http
POST /workflows/abc-123-def-456/deploy
```

**What Happens Behind the Scenes:**

#### 2.1 Check/Create Lambda Function (For Transformations Only)
```
1. Check if Lambda "brmh-workflow-executor" exists
   ↓
2. If NO:
   - Generate Lambda code (transformation handler only)
   - Create Lambda function in AWS
   - Set permissions for Step Functions
   - Configure: timeout=60s, memory=256MB
   ↓
3. If YES:
   - Use existing Lambda
   
Note: Lambda is only used for data transformations.
API execution uses Step Functions native HTTP integration (no Lambda needed).
```

#### 2.2 Generate Step Functions Definition
```
1. Fetch workflow from DynamoDB
   ↓
2. For each step in workflow:
   - API step → Convert to Step Functions Task state
   - Transform step → Convert to Step Functions Task state
   - SNS step → Convert to Step Functions Task state
   - etc.
   ↓
3. Build complete Step Functions JSON definition:
   {
     "Comment": "Workflow: Create Product and Notify",
     "StartAt": "createProduct",
     "States": {
       "createProduct": {
         "Type": "Task",
         "Resource": "arn:aws:states:::http:invoke",
         "Parameters": {
           "ApiEndpoint": "https://api.shopify.com/products",
           "Method": "POST",
           "Headers": {
             "Authorization": "Bearer token",
             "Content-Type": "application/json"
           },
           "RequestBody": {
             "title": "New Product",
             "price": 99.99
           }
         },
         "ResultPath": "$.productResult",
         "Next": "createProductNormalize"
       },
       "createProductNormalize": {
         "Type": "Pass",
         "Parameters": {
           "statusCode": "$.productResult.StatusCode",
           "headers": "$.productResult.Headers",
           "data": "$.productResult.Body"
         },
         "ResultPath": "$.productResult",
         "Next": "transformMessage"
       },
       "transformMessage": {
         "Type": "Task",
         "Resource": "arn:aws:lambda:...:function:brmh-workflow-executor",
         "Parameters": {
           "operation": "transform",
           "transformationRules": {
             "message": "Product {{productResult.data.title}} created!"
           }
         },
         "ResultPath": "$.transformed",
         "Next": "sendMessage"
       },
       "sendMessage": {
         "Type": "Task",
         "Resource": "arn:aws:states:::http:invoke",
         "Parameters": {
           "ApiEndpoint": "https://api.whapi.com/messages",
           "Method": "POST",
           "Headers": {...},
           "RequestBody": {
             "message": "Product New Product created!"
           }
         },
         "ResultPath": "$.sendMessageResult",
         "Next": "sendMessageNormalize"
       },
       "sendMessageNormalize": {
         "Type": "Pass",
         "Parameters": {
           "statusCode": "$.sendMessageResult.StatusCode",
           "headers": "$.sendMessageResult.Headers",
           "data": "$.sendMessageResult.Body"
         },
         "ResultPath": "$.sendMessageResult",
         "Next": "done"
       },
       "done": {
         "Type": "Succeed"
       }
     }
   }
   
Note: API steps use Step Functions HTTP integration (arn:aws:states:::http:invoke)
Transform steps use Lambda (brmh-workflow-executor)
```

#### 2.3 Create/Update State Machine
```
1. Check if state machine exists (using workflow.stateMachineArn)
   ↓
2. If NO:
   - Create new Step Functions state machine
   - Name: "brmh-workflow-abc-123-def-456"
   - Use generated definition
   - Attach IAM role for execution
   ↓
3. If YES:
   - Update existing state machine with new definition
   ↓
4. Save state machine ARN to workflow in DynamoDB
   ↓
5. Update workflow status to "active"
```

**Result:**
```json
{
  "success": true,
  "stateMachineArn": "arn:aws:states:us-east-1:123456789012:stateMachine:brmh-workflow-abc-123-def-456",
  "workflowId": "abc-123-def-456"
}
```

---

### Step 3: Execute Workflow

**API Call:**
```http
POST /workflows/abc-123-def-456/execute
Content-Type: application/json

{
  "input": {
    "title": "New Product",
    "price": 99.99
  }
}
```

**What Happens:**

#### 3.1 Start Step Functions Execution
```
1. Get workflow from DynamoDB
2. Verify workflow is "active" and has stateMachineArn
3. Start Step Functions execution with input data
```

#### 3.2 Step Functions Execution Flow

```
Step Functions State Machine Starts
    ↓
State: "createProduct" (HTTP Task)
    ↓
Step Functions HTTP Integration directly calls:
    POST https://api.shopify.com/products
    Headers: { Authorization: "Bearer token", ... }
    Body: { "title": "New Product", "price": 99.99 }
    ↓
Shopify API responds:
    StatusCode: 201
    Body: {"id":"prod_123","title":"New Product","price":99.99}
    ↓
Step Functions stores raw response: $.productResult = { StatusCode, Headers, Body }
    ↓
State: "createProductNormalize" (Pass State)
    Normalizes response format
    ↓
Step Functions stores normalized: $.productResult = { statusCode, headers, data }
    ↓
State: "transformMessage" (Lambda Task)
    ↓
Invokes Lambda: brmh-workflow-executor
    ↓
Lambda receives:
{
  "operation": "transform",
  "transformationRules": {
    "message": "Product {{productResult.data.title}} created!"
  },
  "previousResults": { productResult: {...} }
}
    ↓
Lambda transforms data:
    message = "Product New Product created!"
    ↓
Returns: { transformed: { message: "Product New Product created!" } }
    ↓
Step Functions stores: $.transformed
    ↓
State: "sendMessage" (HTTP Task)
    ↓
Step Functions HTTP Integration directly calls:
    POST https://api.whapi.com/messages
    Headers: { Authorization: "Bearer token", ... }
    Body: { "message": "Product New Product created!" }
    ↓
WHAPI responds:
    StatusCode: 200
    Body: {"messageId":"msg_456"}
    ↓
Step Functions stores raw response: $.sendMessageResult
    ↓
State: "sendMessageNormalize" (Pass State)
    Normalizes response format
    ↓
Moves to final state: "done"
    ↓
✅ Execution Complete!
```

**Key Points:**
- ✅ API calls use Step Functions HTTP integration (no Lambda)
- ✅ Transformations use Lambda (custom logic)
- ✅ Response normalization happens via Pass states
- ✅ Faster execution (no Lambda cold starts for API calls)
- ✅ Lower cost (no Lambda charges for API calls)

**Result:**
```json
{
  "success": true,
  "executionArn": "arn:aws:states:us-east-1:123456789012:execution:brmh-workflow-abc-123-def-456:exec-1234567890",
  "startDate": "2024-01-01T00:00:00.000Z",
  "workflowId": "abc-123-def-456",
  "workflowName": "Create Product and Notify"
}
```

---

## 📊 Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ STEP 1: CREATE WORKFLOW                                      │
│ POST /workflows                                              │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
         ┌─────────────────────┐
         │  Save to DynamoDB   │
         │  brmh-workflows     │
         │  status: "draft"    │
         └──────────┬──────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 2: DEPLOY WORKFLOW                                      │
│ POST /workflows/:id/deploy                                   │
└──────────────────┬──────────────────────────────────────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
        ▼                     ▼
┌───────────────┐    ┌──────────────────────┐
│ Create Lambda │    │ Generate Step        │
│ (if needed)   │    │ Functions Definition │
│               │    │                      │
│ brmh-workflow-│    │ Convert workflow     │
│ executor      │    │ steps to Step        │
└───────┬───────┘    │ Functions JSON       │
        │            └──────────┬───────────┘
        │                       │
        └───────────┬───────────┘
                    │
                    ▼
         ┌──────────────────────┐
         │ Create/Update        │
         │ Step Functions       │
         │ State Machine        │
         │                      │
         │ Name: brmh-workflow- │
         │ {workflowId}         │
         └──────────┬───────────┘
                    │
                    ▼
         ┌──────────────────────┐
         │ Save stateMachineArn │
         │ to workflow          │
         │ status: "active"     │
         └──────────┬───────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 3: EXECUTE WORKFLOW                                     │
│ POST /workflows/:id/execute                                  │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
         ┌──────────────────────┐
         │ Start Step Functions │
         │ Execution            │
         └──────────┬───────────┘
                    │
                    ▼
         ┌──────────────────────┐
         │ Step Functions       │
         │ Orchestrates Steps   │
         └──────────┬───────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
        ▼                       ▼
┌───────────────┐      ┌───────────────┐
│ Step 1:       │      │ Step 2:       │
│ createProduct │ ────▶│ transformMsg  │
│               │      │               │
│ Step Functions│      │ Invoke Lambda │
│ HTTP Direct   │      │ operation:    │
│ (No Lambda)   │      │ transform     │
└───────┬───────┘      └───────┬───────┘
        │                      │
        ▼                      ▼
┌───────────────┐      ┌───────────────┐
│ Direct HTTP   │      │ Lambda        │
│ Call to       │      │ Transforms    │
│ Shopify API   │      │ Data          │
└───────┬───────┘      └───────┬───────┘
        │                      │
        └──────────┬───────────┘
                   │
                   ▼
         ┌──────────────────────┐
         │ Step 3: sendMessage  │
         │ Step Functions HTTP  │
         │ Direct (No Lambda)   │
         └───────┬──────────────┘
                 │
                 ▼
         ┌──────────────────────┐
         │ Execution Complete   │
         │ Result in Step       │
         │ Functions History    │
         └──────────────────────┘
```

---

## 🔄 Data Flow During Execution

### Input Data
```json
{
  "title": "New Product",
  "price": 99.99
}
```

### After Step 1 (createProduct) - HTTP Direct Call
```json
{
  "title": "New Product",
  "price": 99.99,
  "productResult": {
    "statusCode": 201,
    "statusText": "201",
    "headers": {
      "content-type": "application/json"
    },
    "data": "{\"id\":\"prod_123\",\"title\":\"New Product\",\"price\":99.99}",
    "Body": "{\"id\":\"prod_123\",\"title\":\"New Product\",\"price\":99.99}",
    "StatusCode": 201
  }
}
```

**Note:** `data` and `Body` are JSON strings. Use transform step to parse if needed.

### After Step 2 (transformMessage) - Lambda Transformation
```json
{
  "title": "New Product",
  "price": 99.99,
  "productResult": {
    "statusCode": 201,
    "data": "{\"id\":\"prod_123\",\"title\":\"New Product\",\"price\":99.99}",
    "StatusCode": 201
  },
  "transformed": {
    "success": true,
    "transformed": {
      "message": "Product New Product created!"
    },
    "originalInput": {},
    "previousResults": {
      "productResult": {...}
    }
  }
}
```

### After Step 3 (sendMessage) - HTTP Direct Call
```json
{
  "title": "New Product",
  "price": 99.99,
  "productResult": {...},
  "transformed": {...},
  "sendMessageResult": {
    "statusCode": 200,
    "statusText": "200",
    "headers": {...},
    "data": "{\"messageId\":\"msg_456\"}",
    "Body": "{\"messageId\":\"msg_456\"}",
    "StatusCode": 200
  }
}
```

---

## 🎯 Summary: What You Need to Do

### 1. One-Time Setup
```bash
# Set environment variables
STEP_FUNCTIONS_ROLE_ARN=arn:aws:iam::YOUR_ACCOUNT:role/StepFunctionsExecutionRole
LAMBDA_EXECUTION_ROLE_ARN=arn:aws:iam::YOUR_ACCOUNT:role/LambdaExecutionRole
```

### 2. Create Workflow
```bash
POST /workflows
# Returns: workflowId
```

### 3. Deploy Workflow (Automatic Creation)
```bash
POST /workflows/:workflowId/deploy
# Automatically creates:
# - Lambda function (if doesn't exist, only for transformations)
# - Step Functions state machine (with HTTP integration for APIs)
# - All permissions
# 
# API steps → Step Functions HTTP integration (no Lambda)
# Transform steps → Lambda function
```

### 4. Execute Workflow
```bash
POST /workflows/:workflowId/execute
# Starts Step Functions execution
```

---

## ✅ What Gets Created Automatically

1. **Lambda Function** (once, reused by all workflows)
   - Name: `brmh-workflow-executor`
   - Handles: **Data transformations only** (not API execution)
   - Created: First time you deploy any workflow with transform steps
   - **Note:** API execution uses Step Functions HTTP integration (no Lambda needed)

2. **Step Functions State Machine** (one per workflow)
   - Name: `brmh-workflow-{workflowId}`
   - Contains: Your workflow logic as Step Functions definition
   - Uses: HTTP integration for API calls, Lambda for transformations
   - Created: Every time you deploy a workflow

3. **IAM Permissions**
   - Step Functions → Lambda invoke permission (for transformations)
   - Step Functions → HTTP invoke permission (built-in, no setup needed)
   - Created: Automatically when Lambda is created

## 🎯 Architecture Benefits

### API Execution: Step Functions HTTP Integration
- ✅ **No Lambda invocations** = Lower cost
- ✅ **No cold starts** = Faster execution
- ✅ **Direct HTTP calls** = Simpler architecture
- ✅ **Built-in retry logic** = Better reliability

### Data Transformation: Lambda
- ✅ **Custom logic** = Flexible transformations
- ✅ **Template processing** = Dynamic data mapping
- ✅ **Reusable** = One Lambda for all transformations

---

## 🚀 That's It!

You don't need to:
- ❌ Manually create Lambda functions
- ❌ Manually create Step Functions state machines
- ❌ Manually write Step Functions JSON
- ❌ Manually set up permissions
- ❌ Go to AWS Console

Everything is **automatic**! Just create, deploy, and execute! 🎉


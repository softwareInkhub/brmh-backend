# BRMH Workflow Automation System

## Overview

The BRMH Workflow Automation System allows you to create, manage, and execute workflows that orchestrate REST API calls using AWS Step Functions. Workflows can include data transformation between steps, error handling, and integration with AWS services like SNS and SQS.

## Architecture

```
┌─────────────────┐
│  Workflow API   │  ← REST API endpoints
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  DynamoDB       │  ← Workflow definitions stored in `brmh-workflows` table
│  brmh-workflows │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Step Functions │  ← AWS Step Functions orchestrates execution
│  State Machine  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Lambda         │  ← Executes API calls and transformations
│  Functions      │
└─────────────────┘
```

## Key Components

## Benefits of Unified Lambda Architecture

**Why use a single Lambda function instead of multiple?**

✅ **Better Performance**: Single function reduces cold start overhead  
✅ **Easier Management**: One function to deploy, monitor, and maintain  
✅ **Cost Efficient**: Fewer functions = lower AWS costs  
✅ **Code Reusability**: Shared utilities and logic between operations  
✅ **Simpler Permissions**: One IAM role to manage  
✅ **Easier Debugging**: All logs in one place  

The unified Lambda uses a **router pattern** to handle different operation types based on the `operation` field in the event.

### 1. Workflow Definition
Stored in DynamoDB table `brmh-workflows` with the following structure:

```json
{
  "id": "workflow-uuid",
  "workflowId": "workflow-uuid",
  "name": "Create Product and Notify",
  "description": "Creates a product in Shopify and sends WhatsApp notification",
  "status": "active", // draft, active, inactive
  "steps": [
    {
      "id": "createProduct",
      "type": "api",
      "methodId": "method-uuid",
      "accountId": "account-uuid",
      "namespaceId": "namespace-uuid",
      "input": { "title": "Sample Product" },
      "inputMapping": null,
      "resultKey": "productResult",
      "next": "sendMessage",
      "onSuccess": "sendMessage",
      "onFailure": "handleFailure"
    },
    {
      "id": "sendMessage",
      "type": "api",
      "methodId": "whapi-method-uuid",
      "accountId": "whapi-account-uuid",
      "namespaceId": "whapi-namespace-uuid",
      "inputMapping": {
        "message": "Product {{productResult.data.title}} created successfully"
      },
      "next": "done"
    },
    {
      "id": "handleFailure",
      "type": "sns",
      "topicArn": "arn:aws:sns:us-east-1:123456789012:ProductFailureTopic",
      "message": "Shopify product creation failed",
      "next": "done"
    },
    {
      "id": "done",
      "type": "end"
    }
  ],
  "startStep": "createProduct",
  "stateMachineArn": "arn:aws:states:us-east-1:123456789012:stateMachine:...",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

### 2. Step Types

#### API Step (`type: "api"`)
Executes a REST API call using a method from your namespace system.

**Required Fields:**
- `methodId`: ID of the namespace method
- `accountId`: ID of the namespace account (for authentication)
- `namespaceId`: ID of the namespace

**Optional Fields:**
- `input`: Direct input data for the API call
- `inputMapping`: Template-based mapping from previous step results
- `resultKey`: Key to store the result in workflow state (default: "result")
- `next`: Next step ID on success
- `onSuccess`: Step ID to go to on success
- `onFailure`: Step ID to go to on failure

**Example:**
```json
{
  "id": "createProduct",
  "type": "api",
  "methodId": "shopify-create-product-method-id",
  "accountId": "shopify-account-id",
  "namespaceId": "shopify-namespace-id",
  "input": {
    "title": "New Product",
    "price": 99.99
  },
  "resultKey": "productResult",
  "next": "sendMessage"
}
```

#### Transform Step (`type: "transform"`)
Transforms data between steps using template-based mapping.

**Required Fields:**
- `inputMapping`: Object mapping target fields to source expressions

**Example:**
```json
{
  "id": "transformData",
  "type": "transform",
  "inputMapping": {
    "message": "Product {{productResult.data.title}} created with ID {{productResult.data.id}}",
    "price": "{{productResult.data.price}}",
    "status": "active"
  },
  "resultKey": "transformed",
  "next": "sendMessage"
}
```

#### SNS Step (`type: "sns"`)
Sends a notification via AWS SNS.

**Required Fields:**
- `topicArn`: ARN of the SNS topic

**Optional Fields:**
- `message`: Message to send
- `subject`: Subject line

#### SQS Step (`type: "sqs"`)
Sends a message to an AWS SQS queue.

**Required Fields:**
- `queueUrl`: URL of the SQS queue

**Optional Fields:**
- `messageBody`: Message body

#### Choice/Condition Step (`type: "choice"` or `type: "condition"`)
Creates conditional branching based on data values.

**Required Fields:**
- `conditions`: Array of condition rules

**Optional Fields:**
- `default`: Step ID to go to if no conditions match (default: "FailState")

**Condition Rule Fields:**
- `variable` or `field`: JSON path to the value to check (e.g., `$.productResult.data.status`)
- `operator`: Comparison operator (see below)
- `value`: Value to compare against
- `next` or `then`: Step ID to go to if condition is true

**Supported Operators:**
- **String:** `equals`, `==`, `===`, `notequals`, `!==`, `contains`, `matches`, `startswith`, `endswith`
- **Numeric:** `greaterthan`, `>`, `greaterthanorequal`, `>=`, `lessthan`, `<`, `lessthanorequal`, `<=`
- **Boolean:** `istrue`, `true`, `isfalse`, `false`
- **Presence:** `exists`, `present`, `notexists`, `notpresent`

**Example:**
```json
{
  "id": "checkStatus",
  "type": "choice",
  "conditions": [
    {
      "variable": "$.productResult.data.status",
      "operator": "equals",
      "value": "active",
      "next": "sendSuccessMessage"
    },
    {
      "variable": "$.productResult.data.status",
      "operator": "equals",
      "value": "pending",
      "next": "waitForActivation"
    },
    {
      "variable": "$.productResult.data.price",
      "operator": "greaterthan",
      "value": 100,
      "next": "sendHighValueAlert"
    }
  ],
  "default": "sendDefaultMessage"
}
```

**Simple Example:**
```json
{
  "id": "checkSuccess",
  "type": "condition",
  "conditions": [
    {
      "field": "$.apiResult.success",
      "operator": "istrue",
      "then": "handleSuccess"
    }
  ],
  "default": "handleFailure"
}
```

#### Wait Step (`type: "wait"`)
Waits for a specified duration.

**Required Fields:**
- `seconds`: Number of seconds to wait

#### End Step (`type: "end"`)
Marks the end of the workflow.

#### Fail Step (`type: "fail"`)
Marks the workflow as failed.

**Optional Fields:**
- `error`: Error code
- `cause`: Error message

### 3. Data Transformation

Data transformation uses template syntax to map data from previous steps:

**Template Syntax:**
- `{{stepId.result.field}}` - Access a field from a previous step's result
- `{{stepId.data.field}}` - Access data from API response
- `{{stepId.output.field}}` - Alternative access pattern

**Example:**
```json
{
  "inputMapping": {
    "message": "Product {{createProduct.data.title}} created successfully",
    "productId": "{{createProduct.data.id}}",
    "price": "{{createProduct.data.price}}"
  }
}
```

## API Endpoints

### Create Workflow
```http
POST /workflows
Content-Type: application/json

{
  "name": "My Workflow",
  "description": "Workflow description",
  "steps": [...],
  "status": "draft"
}
```

### Get Workflow
```http
GET /workflows/:workflowId
```

### List Workflows
```http
GET /workflows?status=active&createdBy=user-id
```

### Update Workflow
```http
PUT /workflows/:workflowId
Content-Type: application/json

{
  "name": "Updated Name",
  "steps": [...]
}
```

### Delete Workflow
```http
DELETE /workflows/:workflowId
```

### Deploy Workflow
Creates or updates the Step Functions state machine for the workflow.

```http
POST /workflows/:workflowId/deploy
```

### Execute Workflow
Starts a workflow execution.

```http
POST /workflows/:workflowId/execute
Content-Type: application/json

{
  "input": {
    "title": "Product Name",
    "price": 99.99
  }
}
```

### Get Available API Methods
```http
GET /workflows/api-methods?namespaceId=namespace-id
```

## Environment Variables

Required environment variables:

```bash
# AWS Configuration
AWS_REGION=us-east-1
AWS_ACCOUNT_ID=123456789012
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key

# Step Functions
STEP_FUNCTIONS_ROLE_ARN=arn:aws:iam::123456789012:role/StepFunctionsExecutionRole

# Lambda
LAMBDA_EXECUTION_ROLE_ARN=arn:aws:iam::123456789012:role/LambdaExecutionRole

# Backend URL (for fetching namespace methods)
BACKEND_URL=http://localhost:5001
```

## Step Functions Role Permissions

The Step Functions execution role needs the following permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "lambda:InvokeFunction"
      ],
      "Resource": "arn:aws:lambda:*:*:function:brmh-workflow-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "sns:Publish"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "sqs:SendMessage"
      ],
      "Resource": "*"
    }
  ]
}
```

## Lambda Execution Role Permissions

The Lambda execution role needs:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    }
  ]
}
```

## Example Workflow

### Scenario: Create Product and Send Notification

```json
{
  "name": "Create Product and Notify",
  "description": "Creates a product in Shopify and sends WhatsApp notification",
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
      "onSuccess": "sendMessage",
      "onFailure": "handleFailure"
    },
    {
      "id": "sendMessage",
      "type": "api",
      "methodId": "whapi-send-message-method-id",
      "accountId": "whapi-account-id",
      "namespaceId": "whapi-namespace-id",
      "inputMapping": {
        "message": "Product {{productResult.data.title}} (ID: {{productResult.data.id}}) created successfully! Price: ${{productResult.data.price}}"
      },
      "next": "done"
    },
    {
      "id": "handleFailure",
      "type": "sns",
      "topicArn": "arn:aws:sns:us-east-1:123456789012:ProductFailureTopic",
      "message": "Product creation failed: {{error}}",
      "next": "done"
    },
    {
      "id": "done",
      "type": "end"
    }
  ],
  "startStep": "createProduct"
}
```

## Workflow Execution Flow

1. **Create Workflow**: Define workflow steps and save to DynamoDB
2. **Deploy Workflow**: Generate Step Functions state machine definition and create/update it in AWS
3. **Execute Workflow**: Start a Step Functions execution with input data
4. **Step Execution**: Each step executes via Lambda functions
   - API steps: Lambda calls the REST API
   - Transform steps: Lambda transforms data using mapping rules
   - AWS service steps: Step Functions directly invokes AWS services
5. **Result**: Execution results are stored in Step Functions execution history

## Data Flow

```
Input Data
    ↓
Step 1 (API) → Result stored in workflow state
    ↓
Step 2 (Transform) → Uses Step 1 result, transforms data
    ↓
Step 3 (API) → Uses transformed data
    ↓
Final Result
```

## Error Handling

- **API Step Errors**: If an API call fails, the workflow can route to an error handling step
- **Transformation Errors**: Transformation errors are caught and logged
- **Step Functions Errors**: Step Functions provides built-in retry and error handling

## Best Practices

1. **Use Input Mapping**: Prefer `inputMapping` over direct `input` for dynamic data
2. **Error Handling**: Always include error handling steps for critical workflows
3. **Result Keys**: Use descriptive `resultKey` values for better debugging
4. **Testing**: Test workflows with sample data before deploying to production
5. **Monitoring**: Monitor Step Functions execution history for workflow health

## Troubleshooting

### Workflow deployment fails
- Check Step Functions role ARN is correct
- Verify Lambda execution role has proper permissions
- Check AWS credentials are configured

### API steps fail
- Verify method, account, and namespace IDs are correct
- Check API credentials in the account configuration
- Verify API endpoints are accessible

### Transformation fails
- Check template syntax in `inputMapping`
- Verify previous step results contain expected fields
- Check transformation Lambda logs in CloudWatch

## Future Enhancements

- Visual workflow builder UI
- Workflow versioning
- Workflow scheduling (EventBridge integration)
- Workflow templates
- Advanced transformation functions
- Conditional branching based on step results
- Parallel step execution
- Workflow monitoring dashboard


{
  "name": "Create Product and Notify",
  "steps": [
    {
      "id": "step_1",
      "type": "api",
      "namespaceId": "shopify-ns",
      "accountId": "shopify-account",
      "methodId": "create-product",
      "input": { "title": "New Product", "price": 99.99 },
      "resultKey": "step1"
    },
    {
      "id": "transform_1",
      "type": "transform",
      "inputMapping": {
        "message": "✅ Product {{step1.data.product.id}} created!\nTitle: {{step1.data.product.title}}\nPrice: ${{step1.data.product.price}}",
        "productId": "{{step1.data.product.id}}"
      },
      "resultKey": "transformed",
      "next": "step_2"
    },
    {
      "id": "step_2",
      "type": "api",
      "namespaceId": "whapi-ns",
      "accountId": "whapi-account",
      "methodId": "send-message",
      "inputMapping": {
        "message": "{{transformed.message}}",
        "productId": "{{transformed.productId}}"
      },
      "resultKey": "step2"
    }
  ]
}
# AWS IAM Roles Setup Guide

This guide explains how to create the required IAM roles for the workflow system.

## Required IAM Roles

You need **two IAM roles**:

1. **Lambda Execution Role** (`LAMBDA_EXECUTION_ROLE_ARN`) - For Lambda functions
2. **Step Functions Execution Role** (`STEP_FUNCTIONS_ROLE_ARN`) - For Step Functions state machines

---

## Step 1: Create Lambda Execution Role

### Via AWS Console:

1. **Go to IAM Console**: https://console.aws.amazon.com/iam/
2. **Click "Roles"** → **"Create role"**
3. **Select trusted entity**: Choose **"AWS service"**
4. **Select service**: Choose **"Lambda"**
5. **Click "Next"**
6. **Add permissions**: Attach these policies:
   - `AWSLambdaBasicExecutionRole` (for CloudWatch Logs)
   - (Optional) `AWSLambdaVPCAccessExecutionRole` if using VPC
7. **Role name**: `LambdaExecutionRole` (or any name you prefer)
8. **Click "Create role"**
9. **Copy the Role ARN**: It will look like:
   ```
   arn:aws:iam::123456789012:role/LambdaExecutionRole
   ```

### Permissions Needed:

The Lambda role needs permissions to:
- Write CloudWatch Logs
- Invoke other Lambda functions (if needed)
- Access DynamoDB (if your workflows need it)
- Make HTTP requests (for API calls - already handled by Step Functions)

**Minimum Policy**:
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

---

## Step 2: Create Step Functions Execution Role

### Via AWS Console:

1. **Go to IAM Console**: https://console.aws.amazon.com/iam/
2. **Click "Roles"** → **"Create role"**
3. **Select trusted entity**: Choose **"AWS service"**
4. **Select service**: Choose **"Step Functions"**
5. **Click "Next"**
6. **Add permissions**: You need to create a custom policy with these permissions:

**Required Permissions**:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "lambda:InvokeFunction"
      ],
      "Resource": "arn:aws:lambda:*:*:function:brmh-workflow-executor"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogDelivery",
        "logs:GetLogDelivery",
        "logs:UpdateLogDelivery",
        "logs:DeleteLogDelivery",
        "logs:ListLogDeliveries",
        "logs:PutResourcePolicy",
        "logs:DescribeResourcePolicies",
        "logs:DescribeLogGroups"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "xray:PutTraceSegments",
        "xray:PutTelemetryRecords",
        "xray:GetSamplingRules",
        "xray:GetSamplingTargets"
      ],
      "Resource": "*"
    }
  ]
}
```

**Or use AWS Managed Policy** (if available):
- `AWSLambdaRole` (for invoking Lambda)
- `CloudWatchLogsFullAccess` (for logging)

7. **Role name**: `StepFunctionsExecutionRole` (or any name you prefer)
8. **Click "Create role"**
9. **Copy the Role ARN**: It will look like:
   ```
   arn:aws:iam::123456789012:role/StepFunctionsExecutionRole
   ```

### Permissions Needed:

The Step Functions role needs permissions to:
- **Invoke Lambda functions** (for transform steps)
- **Make HTTP requests** (for API steps - this is built into Step Functions, no extra permission needed)
- **Write CloudWatch Logs** (for execution logs)
- **X-Ray tracing** (optional, for debugging)

---

## Step 3: Get Your AWS Account ID

You need your **12-digit AWS Account ID** to construct the ARN:

1. **Via AWS Console**: 
   - Click on your username (top right)
   - Your Account ID is displayed there

2. **Via AWS CLI**:
   ```bash
   aws sts get-caller-identity --query Account --output text
   ```

3. **Via API**:
   ```bash
   curl https://sts.amazonaws.com/?Action=GetCallerIdentity&Version=2011-06-15
   ```

---

## Step 4: Set Environment Variables

Once you have both role ARNs, set them as environment variables:

### Option 1: Export in Terminal
```bash
export LAMBDA_EXECUTION_ROLE_ARN="arn:aws:iam::YOUR_ACCOUNT_ID:role/LambdaExecutionRole"
export STEP_FUNCTIONS_ROLE_ARN="arn:aws:iam::YOUR_ACCOUNT_ID:role/StepFunctionsExecutionRole"
export AWS_REGION="us-east-1"  # or your preferred region
export AWS_ACCOUNT_ID="YOUR_ACCOUNT_ID"
```

### Option 2: Add to `.env` file
Create or update `.env` in your backend directory:
```env
LAMBDA_EXECUTION_ROLE_ARN=arn:aws:iam::123456789012:role/LambdaExecutionRole
STEP_FUNCTIONS_ROLE_ARN=arn:aws:iam::123456789012:role/StepFunctionsExecutionRole
AWS_REGION=us-east-1
AWS_ACCOUNT_ID=123456789012
```

### Option 3: AWS Credentials
Make sure your AWS credentials are configured:
```bash
aws configure
# Enter your Access Key ID
# Enter your Secret Access Key
# Enter your default region
```

---

## Quick Setup Script (AWS CLI)

If you have AWS CLI installed, you can use this script:

```bash
#!/bin/bash

# Get your AWS account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=${AWS_REGION:-us-east-1}

echo "Setting up IAM roles for account: $ACCOUNT_ID"

# Create Lambda Execution Role
aws iam create-role \
  --role-name LambdaExecutionRole \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "lambda.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'

aws iam attach-role-policy \
  --role-name LambdaExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

# Create Step Functions Execution Role
aws iam create-role \
  --role-name StepFunctionsExecutionRole \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "states.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'

# Create and attach policy for Step Functions
aws iam put-role-policy \
  --role-name StepFunctionsExecutionRole \
  --policy-name StepFunctionsPolicy \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": ["lambda:InvokeFunction"],
        "Resource": "arn:aws:lambda:*:*:function:brmh-workflow-executor"
      },
      {
        "Effect": "Allow",
        "Action": [
          "logs:CreateLogDelivery",
          "logs:GetLogDelivery",
          "logs:UpdateLogDelivery",
          "logs:DeleteLogDelivery",
          "logs:ListLogDeliveries",
          "logs:PutResourcePolicy",
          "logs:DescribeResourcePolicies",
          "logs:DescribeLogGroups"
        ],
        "Resource": "*"
      }
    ]
  }'

echo ""
echo "✅ Roles created!"
echo ""
echo "Set these environment variables:"
echo "export LAMBDA_EXECUTION_ROLE_ARN=\"arn:aws:iam::${ACCOUNT_ID}:role/LambdaExecutionRole\""
echo "export STEP_FUNCTIONS_ROLE_ARN=\"arn:aws:iam::${ACCOUNT_ID}:role/StepFunctionsExecutionRole\""
echo "export AWS_REGION=\"${REGION}\""
echo "export AWS_ACCOUNT_ID=\"${ACCOUNT_ID}\""
```

---

## Verify Your Setup

After creating the roles, verify they exist:

```bash
# Check Lambda role
aws iam get-role --role-name LambdaExecutionRole --query 'Role.Arn' --output text

# Check Step Functions role
aws iam get-role --role-name StepFunctionsExecutionRole --query 'Role.Arn' --output text
```

---

## Troubleshooting

### Error: "Role does not exist"
- Make sure you created the role in the same AWS account
- Check the role name matches exactly (case-sensitive)

### Error: "Access Denied"
- Make sure your AWS credentials have IAM permissions
- The user/role creating these roles needs `iam:CreateRole` and `iam:AttachRolePolicy` permissions

### Error: "Invalid ARN format"
- Make sure the ARN format is: `arn:aws:iam::ACCOUNT_ID:role/ROLE_NAME`
- Replace `ACCOUNT_ID` with your 12-digit AWS account ID
- Replace `ROLE_NAME` with the actual role name you created

---

## Summary

1. **Create Lambda Execution Role** in IAM Console
2. **Create Step Functions Execution Role** in IAM Console
3. **Get your AWS Account ID**
4. **Set environment variables** with the full ARNs
5. **Restart your backend server**

The ARN format is: `arn:aws:iam::YOUR_ACCOUNT_ID:role/ROLE_NAME`


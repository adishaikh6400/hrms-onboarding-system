# HRMS Onboarding System

A fully automated employee onboarding system built using AWS serverless architecture.  
This system handles employee creation, identity provisioning, and onboarding workflow initialization.

---

## Overview

The HRMS Onboarding System is designed to:

- Create a canonical employee record
- Provision authentication using AWS Cognito
- Trigger onboarding workflows
- Enable scalable, event-driven onboarding processes

---

## Architecture

- API Gateway → Entry point for all requests  
- AWS Lambda → Business logic execution  
- DynamoDB → Employee data storage  
- AWS CDK → Infrastructure as Code (IaC)  
- Node.js → Runtime environment  

---

## Tech Stack

- AWS CDK  
- AWS Lambda  
- API Gateway  
- DynamoDB  
- Node.js  

---

## Setup Instructions

### 1. Clone Repository

```bash
git clone https://github.com/adishaikh6400/hrms-onboarding-system.git
cd hrms-onboarding-system
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure AWS Credentials
```bash
aws configure
```
Provide:
- AWS Access Key
- AWS Secret Key
- Region (e.g., ap-south-1)
- Output format (json)

### Bootstrap CDK (First-Time Only)
```bash
cdk bootstrap
```
This prepares your AWS environment for CDK deployments.

### Deploy Infrastructure
```bash
cdk deploy
```
This will:
- Create API Gateway
- Deploy Lambda functions
- Provision DynamoDB tables

---

## API Endpoints
### Create Employee
Endpoint:
```bash
POST /employee
```

Request Body:
```bash
{
  "name": "Adi",
  "email": "adi@test.com"
}
```

Response:
```bash
{
  "employee_id": "uuid",
  "status": "created"
}
```
---

## Prerequisites
Ensure the following are installed:

- Node.js (>= 18 recommended)
- AWS CLI
- AWS CDK (npm install -g aws-cdk)

---

## Common Issues & Fixes
1. cdk deploy fails
- Ensure AWS credentials are correct
- Run cdk bootstrap before deploy
2. API not reachable
- Check API Gateway endpoint output after deployment
- Verify Lambda permissions
3. Missing dependencies
```bash
npm install
```
---

## Contributors
- Rajith S
- Adi Shaikh
- Sreenila
- Adithya Kumar

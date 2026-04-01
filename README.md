1. Project Title + Description
# HRMS Onboarding System

Automated employee onboarding system using AWS CDK, Lambda, API Gateway, and DynamoDB.
2. Tech Stack
## Tech Stack
- AWS CDK
- AWS Lambda
- API Gateway
- DynamoDB
- Node.js


3. Setup Instructions (MOST IMPORTANT 🔥)
## Setup Instructions

### 1. Clone repo
git clone https://github.com/adishaikh6400/hrms-onboarding-system.git
cd hrms-onboarding-system

### 2. Install dependencies
npm install

### 3. Configure AWS
aws configure

### 4. Bootstrap CDK (first time only)
cdk bootstrap

### 5. Deploy
cdk deploy
4. API Testing
## API Testing

POST /employee

Body:
{
  "name": "Adi",
  "email": "adi@test.com"
}
5. Notes (optional but useful)
## Notes
- Make sure AWS CLI is installed
- Make sure Node.js is installed
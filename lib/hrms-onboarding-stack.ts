import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';  // ADD THIS

export class HrmsOnboardingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ✅ DynamoDB (unchanged)
    const table = new dynamodb.Table(this, 'EmployeesTable', {
      tableName: 'hrms-employees-v2',
      partitionKey: { name: 'employee_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ✅ Cognito (unchanged)
    const userPool = new cognito.UserPool(this, 'HrmsUserPool', {
      userPoolName: 'hrms-user-pool',
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ✅ Lambda
    const createEmployeeLambda = new lambda.Function(this, 'CreateEmployeeFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda'),
      environment: {
        TABLE_NAME: table.tableName,
        USER_POOL_ID: userPool.userPoolId,
        SES_FROM_EMAIL: 'adishaikh6400@gmail.com',  // ← PUT YOUR EMAIL HERE
      },
    });

    // ✅ Permissions
    table.grantWriteData(createEmployeeLambda);
    userPool.grant(createEmployeeLambda, 'cognito-idp:AdminCreateUser');

    // ✅ NEW: SES permission
    createEmployeeLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
    }));

    // ✅ API Gateway (unchanged)
    const api = new apigateway.RestApi(this, 'HRMSApi', {
      restApiName: 'HRMS Service',
    });

    const employee = api.root.addResource('employee');
    employee.addMethod('POST', new apigateway.LambdaIntegration(createEmployeeLambda));
  }
}
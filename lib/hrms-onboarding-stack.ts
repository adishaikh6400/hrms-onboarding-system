import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';

export class HrmsOnboardingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ✅ DynamoDB Table
    const table = new dynamodb.Table(this, 'EmployeesTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    // ✅ Lambda Function
    const createEmployeeLambda = new lambda.Function(this, 'CreateEmployeeFn', {
      runtime: lambda.Runtime.NODEJS_20_X,  // ✅ updated
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda'),
      environment: {
        TABLE_NAME: table.tableName,
      },
    });

    // ✅ Permissions
    table.grantWriteData(createEmployeeLambda);

    // ✅ API Gateway
    const api = new apigateway.RestApi(this, 'HRMSApi', {
      restApiName: 'HRMS Service',
    });

    const employee = api.root.addResource('employee');
    employee.addMethod('POST', new apigateway.LambdaIntegration(createEmployeeLambda));
  }
}
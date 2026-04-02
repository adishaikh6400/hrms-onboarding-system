import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';

export class HrmsOnboardingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ✅ DynamoDB
    const table = new dynamodb.Table(this, 'EmployeesTable', {
      tableName: 'hrms-employees-v2',
      partitionKey: { name: 'employee_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    table.addGlobalSecondaryIndex({
      indexName: 'email-index',
      partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ✅ Cognito
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
        SES_FROM_EMAIL: 'adishaikh6400@gmail.com',
      },
    });

    // ✅ Permissions
    table.grantReadWriteData(createEmployeeLambda);
    userPool.grant(createEmployeeLambda, 'cognito-idp:AdminCreateUser');
    createEmployeeLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
    }));

    // ✅ Step Function — simple tracker
    const successState = new sfn.Succeed(this, 'OnboardingComplete', {
      comment: 'Employee onboarded successfully',
    });

    const failState = new sfn.Fail(this, 'OnboardingFailed', {
      error: 'OnboardingError',
      cause: 'Something went wrong during onboarding',
    });

    const checkStatus = new sfn.Choice(this, 'DidOnboardingSucceed?')
      .when(sfn.Condition.numberEquals('$.statusCode', 200), successState)
      .otherwise(failState);

    const stateMachine = new sfn.StateMachine(this, 'HrmsOnboardingStateMachine', {
      stateMachineName: 'hrms-onboarding-flow',
      definitionBody: sfn.DefinitionBody.fromChainable(checkStatus),
      timeout: cdk.Duration.minutes(5),
    });

    // Give Lambda permission to start Step Function
    stateMachine.grantStartExecution(createEmployeeLambda);
    createEmployeeLambda.addEnvironment('STATE_MACHINE_ARN', stateMachine.stateMachineArn);

    // ✅ API Gateway
    const api = new apigateway.RestApi(this, 'HRMSApi', {
      restApiName: 'HRMS Service',
    });

    const employee = api.root.addResource('employee');
    employee.addMethod('POST', new apigateway.LambdaIntegration(createEmployeeLambda));
  }
}
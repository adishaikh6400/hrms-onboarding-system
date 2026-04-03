import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';

export class HrmsOnboardingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // =========================================================
    // MEMBER 1 — Identity & Auth (unchanged)
    // =========================================================

    // ✅ DynamoDB — Employee Master Table
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

    // ✅ Cognito User Pool
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

    // ✅ Create Employee Lambda
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

    // ✅ Permissions for Member 1 Lambda
    table.grantReadWriteData(createEmployeeLambda);
    userPool.grant(createEmployeeLambda, 'cognito-idp:AdminCreateUser');
    createEmployeeLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
    }));

    // ✅ Step Function — placeholder (Member 2 will expand this)
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

    stateMachine.grantStartExecution(createEmployeeLambda);
    createEmployeeLambda.addEnvironment('STATE_MACHINE_ARN', stateMachine.stateMachineArn);

    // =========================================================
    // MEMBER 3 — Document Service (S3 + Validation + SNS)
    // =========================================================

    // ✅ S3 Bucket — stores all employee documents
    const documentsBucket = new s3.Bucket(this, 'DocumentsBucket', {
      bucketName: `hrms-documents-${this.account}-${this.region}`,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      cors: [
        {
          // Allow frontend to PUT files directly via presigned URL
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    // ✅ DynamoDB — Documents Metadata Table
    const documentsTable = new dynamodb.Table(this, 'DocumentsTable', {
      tableName: 'hrms-documents',
      partitionKey: { name: 'employee_id', type: dynamodb.AttributeType.STRING },
      sortKey:      { name: 'document_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ✅ SNS Topic — notifies when a document is uploaded/validated
    const documentTopic = new sns.Topic(this, 'DocumentTopic', {
      topicName: 'hrms-document-notifications',
      displayName: 'HRMS Document Upload Notifications',
    });

    // ✅ Lambda — generates presigned S3 upload URL
    const getUploadUrlLambda = new lambda.Function(this, 'GetUploadUrlFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'getUploadUrl.handler',
      code: lambda.Code.fromAsset('lambda'),
      timeout: cdk.Duration.seconds(30),
      environment: {
        DOCUMENTS_BUCKET: documentsBucket.bucketName,
        DOCUMENTS_TABLE:  documentsTable.tableName,
        TABLE_NAME:       table.tableName,
      },
    });

    // ✅ Lambda — triggered by S3, validates file and updates status
    const validateDocumentLambda = new lambda.Function(this, 'ValidateDocumentFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'validateDocument.handler',
      code: lambda.Code.fromAsset('lambda'),
      timeout: cdk.Duration.seconds(60),
      environment: {
        DOCUMENTS_TABLE:        documentsTable.tableName,
        DOCUMENT_SNS_TOPIC_ARN: documentTopic.topicArn,
      },
    });

    // ✅ Lambda — lists all documents for an employee
    const listDocumentsLambda = new lambda.Function(this, 'ListDocumentsFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'listDocuments.handler',
      code: lambda.Code.fromAsset('lambda'),
      timeout: cdk.Duration.seconds(30),
      environment: {
        DOCUMENTS_TABLE: documentsTable.tableName,
      },
    });

    // ✅ IAM Permissions — getUploadUrl Lambda
    documentsBucket.grantPut(getUploadUrlLambda);
    documentsTable.grantReadWriteData(getUploadUrlLambda);
    table.grantReadData(getUploadUrlLambda);

    // ✅ IAM Permissions — validateDocument Lambda
    documentsBucket.grantRead(validateDocumentLambda);
    documentsBucket.grantDelete(validateDocumentLambda); // to delete invalid files
    documentsTable.grantReadWriteData(validateDocumentLambda);
    documentTopic.grantPublish(validateDocumentLambda);

    // ✅ IAM Permissions — listDocuments Lambda
    documentsTable.grantReadData(listDocumentsLambda);

    // ✅ S3 Event → triggers validateDocument Lambda on every file upload
    documentsBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(validateDocumentLambda),
      { prefix: 'documents/' },
    );

    // =========================================================
    // API Gateway — shared (Member 1 base + Member 3 routes)
    // =========================================================

    const api = new apigateway.RestApi(this, 'HRMSApi', {
      restApiName: 'HRMS Service',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    // ── Member 1 route ────────────────────────────────────────
    // POST /employee
    const employee = api.root.addResource('employee');
    employee.addMethod('POST', new apigateway.LambdaIntegration(createEmployeeLambda));

    // ── Member 3 routes ───────────────────────────────────────
    // POST /employee/{employee_id}/documents/upload-url  → get presigned URL
    // GET  /employee/{employee_id}/documents             → list documents
    const employeeById = employee.addResource('{employee_id}');
    const documents    = employeeById.addResource('documents');
    const uploadUrl    = documents.addResource('upload-url');

    uploadUrl.addMethod('POST', new apigateway.LambdaIntegration(getUploadUrlLambda));
    documents.addMethod('GET',  new apigateway.LambdaIntegration(listDocumentsLambda));

    // =========================================================
    // Stack Outputs — useful after cdk deploy
    // =========================================================

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'HRMS API base URL',
    });

    new cdk.CfnOutput(this, 'DocumentsBucketName', {
      value: documentsBucket.bucketName,
      description: 'S3 bucket for employee documents',
    });

    new cdk.CfnOutput(this, 'DocumentsTableName', {
      value: documentsTable.tableName,
      description: 'DynamoDB table for document metadata',
    });

    new cdk.CfnOutput(this, 'DocumentSnsTopicArn', {
      value: documentTopic.topicArn,
      description: 'SNS topic for document notifications',
    });
  }
}

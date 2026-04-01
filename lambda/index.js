const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { CognitoIdentityProviderClient, AdminCreateUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const { v4: uuidv4 } = require('uuid');

const dynamoClient  = new DynamoDBClient({});
const cognitoClient = new CognitoIdentityProviderClient({});
const sesClient     = new SESClient({ region: 'ap-south-1' });

exports.handler = async (event) => {
  try {
    let body = {};
    if (event.body) {
      body = typeof event.body === "string"
        ? JSON.parse(event.body)
        : event.body;
    }

    if (!body.name || !body.email) {
      return response(400, { message: "name and email are required" });
    }

    const id         = uuidv4();
    const created_at = new Date().toISOString();

    // ─── 1. Save to DynamoDB ───────────────────────────────────
    await dynamoClient.send(new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        id:         { S: id },
        name:       { S: body.name },
        email:      { S: body.email },
        status:     { S: 'ONBOARDED' },
        created_at: { S: created_at },
      },
    }));

    // ─── 2. Create Cognito User ────────────────────────────────
    await cognitoClient.send(new AdminCreateUserCommand({
      UserPoolId: process.env.USER_POOL_ID,
      Username: body.email,
      TemporaryPassword: 'Welcome@123',
      UserAttributes: [
        { Name: 'email',          Value: body.email },
        { Name: 'name',           Value: body.name },
        { Name: 'email_verified', Value: 'true' },
      ],
      MessageAction: 'SUPPRESS',
    }));

    // ─── 3. Send Welcome Email via SES ────────────────────────
    await sesClient.send(new SendEmailCommand({
      Source: process.env.SES_FROM_EMAIL,
      Destination: {
        ToAddresses: [body.email],
      },
      Message: {
        Subject: {
          Data: '🎉 Welcome to HRMS - You are onboarded!',
        },
        Body: {
          Text: {
            Data: `Hi ${body.name},\n\nWelcome to the company!\n\nYour account has been created.\nLogin Email: ${body.email}\nTemporary Password: Welcome@123\n\nPlease change your password on first login.\n\nRegards,\nHRMS Team`,
          },
        },
      },
    }));

    return response(200, {
      message: 'Employee onboarded, Cognito user created, welcome email sent ✅',
      employee_id: id,
    });

  } catch (error) {
    console.error('ERROR:', error);
    return response(500, { error: error.message });
  }
};

const response = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
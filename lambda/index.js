const { DynamoDBClient, PutItemCommand, DeleteItemCommand, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { CognitoIdentityProviderClient, AdminCreateUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const { SFNClient, StartExecutionCommand } = require('@aws-sdk/client-sfn'); // ADD
const { v4: uuidv4 } = require('uuid');

const dynamoClient  = new DynamoDBClient({});
const cognitoClient = new CognitoIdentityProviderClient({});
const sesClient     = new SESClient({ region: 'ap-south-1' });
const sfnClient     = new SFNClient({ region: 'ap-south-1' }); // ADD

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

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(body.email)) {
      return response(400, { message: "invalid email format" });
    }

    // ─── Check duplicate email via GSI ────────────────────────
    const existing = await dynamoClient.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      IndexName: 'email-index',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': { S: body.email } },
    }));

    if (existing.Items && existing.Items.length > 0) {
      return response(409, { message: 'Employee with this email already exists' });
    }

    const employee_id = uuidv4();
    const created_at  = new Date().toISOString();

    // ─── 1. Save to DynamoDB ───────────────────────────────────
    await dynamoClient.send(new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        employee_id:     { S: employee_id },
        name:            { S: body.name },
        email:           { S: body.email },
        department:      { S: body.department      || 'Not Assigned' },
        role:            { S: body.role             || 'Not Assigned' },
        manager:         { S: body.manager          || 'Not Assigned' },
        joining_date:    { S: body.joining_date     || 'Not Assigned' },
        employment_type: { S: body.employment_type  || 'Not Assigned' },
        status:          { S: 'ONBOARDED' },
        created_at:      { S: created_at },
      },
    }));

    // ─── 2. Create Cognito User (with rollback) ────────────────
    try {
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
    } catch (cognitoError) {
      await dynamoClient.send(new DeleteItemCommand({
        TableName: process.env.TABLE_NAME,
        Key: { employee_id: { S: employee_id } },
      }));
      if (cognitoError.name === 'UsernameExistsException') {
        return response(409, { message: 'Employee with this email already exists' });
      }
      return response(500, { message: 'Failed to create login account. Employee record rolled back.' });
    }

    // ─── 3. Send Welcome Email via SES ────────────────────────
    try {
      await sesClient.send(new SendEmailCommand({
        Source: process.env.SES_FROM_EMAIL,
        Destination: { ToAddresses: [body.email] },
        Message: {
          Subject: { Data: '🎉 Welcome to HRMS - You are onboarded!' },
          Body: {
            Text: {
              Data: `Hi ${body.name},\n\nWelcome to the company!\n\nHere are your details:\nDepartment: ${body.department}\nRole: ${body.role}\nManager: ${body.manager}\nJoining Date: ${body.joining_date}\nEmployment Type: ${body.employment_type}\n\nLogin Email: ${body.email}\nTemporary Password: Welcome@123\n\nPlease change your password on first login.\n\nRegards,\nHRMS Team`,
            },
          },
        },
      }));
    } catch (sesError) {
      console.error('SES email failed (non-critical):', sesError);
    }

    // ─── 4. Trigger Step Function ─────────────────────────────
    await sfnClient.send(new StartExecutionCommand({
      stateMachineArn: process.env.STATE_MACHINE_ARN,
      name: `onboard-${employee_id}`,
      input: JSON.stringify({ employee_id, name: body.name, email: body.email, statusCode: 200 }),
    }));

    return response(200, {
      message: 'Employee onboarded successfully ✅',
      employee_id,
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
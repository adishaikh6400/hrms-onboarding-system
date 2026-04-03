const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { DynamoDBClient, PutItemCommand, GetItemCommand } = require('@aws-sdk/client-dynamodb');
const { v4: uuidv4 } = require('uuid');

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'ap-south-1' });
const dynamoClient = new DynamoDBClient({});

// Allowed file types and max size (5MB)
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

exports.handler = async (event) => {
  try {
    // Get employee_id from path: /employee/{employee_id}/documents/upload-url
    const employee_id = event.pathParameters && event.pathParameters.employee_id;
    if (!employee_id) {
      return response(400, { message: 'employee_id is required in path' });
    }

    let body = {};
    if (event.body) {
      body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    }

    // ─── Verify employee exists ────────────────────────────────
    const employeeCheck = await dynamoClient.send(new GetItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: { employee_id: { S: employee_id } },
    }));

    if (!employeeCheck.Item) {
      return response(404, { message: 'Employee not found' });
    }

    const { file_name, file_type, file_size } = body;

    // ─── Validate inputs ───────────────────────────────────────
    if (!file_name || !file_type || !file_size) {
      return response(400, { message: 'file_name, file_type, and file_size are required' });
    }

    if (!ALLOWED_TYPES.includes(file_type)) {
      return response(400, {
        message: `Invalid file type. Allowed types: ${ALLOWED_TYPES.join(', ')}`,
      });
    }

    if (file_size > MAX_SIZE_BYTES) {
      return response(400, { message: 'File size exceeds 5MB limit' });
    }

    const document_id = uuidv4();
    const s3_key = `documents/${employee_id}/${document_id}/${file_name}`;
    const uploaded_at = new Date().toISOString();

    // ─── Generate presigned S3 URL (valid for 5 minutes) ──────
    const command = new PutObjectCommand({
      Bucket: process.env.DOCUMENTS_BUCKET,
      Key: s3_key,
      ContentType: file_type,
      ContentLength: file_size,
      Metadata: {
        employee_id,
        document_id,
        file_name,
      },
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });

    // ─── Save document metadata to DynamoDB (status: PENDING) ─
    await dynamoClient.send(new PutItemCommand({
      TableName: process.env.DOCUMENTS_TABLE,
      Item: {
        employee_id:  { S: employee_id },
        document_id:  { S: document_id },
        file_name:    { S: file_name },
        file_type:    { S: file_type },
        file_size:    { N: String(file_size) },
        s3_key:       { S: s3_key },
        status:       { S: 'PENDING_UPLOAD' },
        uploaded_at:  { S: uploaded_at },
      },
    }));

    return response(200, {
      message: 'Upload URL generated successfully',
      upload_url: uploadUrl,
      document_id,
      s3_key,
      expires_in: '5 minutes',
    });

  } catch (error) {
    console.error('ERROR in getUploadUrl:', error);
    return response(500, { error: error.message });
  }
};

const response = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

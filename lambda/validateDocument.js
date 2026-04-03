const { S3Client, HeadObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'ap-south-1' });
const dynamoClient = new DynamoDBClient({});
const snsClient = new SNSClient({ region: process.env.AWS_REGION || 'ap-south-1' });

const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

exports.handler = async (event) => {
  // S3 can send multiple records in one event
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const s3_key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

    console.log(`Processing file: ${s3_key} from bucket: ${bucket}`);

    // ─── Extract IDs from S3 key ───────────────────────────────
    // Key format: documents/{employee_id}/{document_id}/{file_name}
    const keyParts = s3_key.split('/');
    if (keyParts.length < 4) {
      console.error('Unexpected S3 key format:', s3_key);
      continue;
    }

    const employee_id = keyParts[1];
    const document_id = keyParts[2];
    const file_name   = keyParts[3];

    try {
      // ─── Get file metadata from S3 ──────────────────────────
      const headResult = await s3Client.send(new HeadObjectCommand({
        Bucket: bucket,
        Key: s3_key,
      }));

      const file_type = headResult.ContentType;
      const file_size = headResult.ContentLength;

      // ─── Validate file type and size ────────────────────────
      const isValidType = ALLOWED_TYPES.includes(file_type);
      const isValidSize = file_size <= MAX_SIZE_BYTES;

      if (!isValidType || !isValidSize) {
        // Validation failed — delete the file from S3
        await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: s3_key }));

        const reason = !isValidType
          ? `Invalid file type: ${file_type}`
          : `File too large: ${file_size} bytes (max 5MB)`;

        console.warn(`Validation failed for ${s3_key}: ${reason}`);

        // Update DynamoDB status to REJECTED
        await updateDocumentStatus(employee_id, document_id, 'REJECTED', reason);

        // Notify via SNS about rejection
        await publishSNS(employee_id, document_id, file_name, 'REJECTED', reason);

        continue;
      }

      // ─── Validation passed — update DynamoDB to UPLOADED ────
      await updateDocumentStatus(employee_id, document_id, 'UPLOADED', 'Validation passed');

      // ─── Publish SNS notification ────────────────────────────
      await publishSNS(employee_id, document_id, file_name, 'UPLOADED', 'Document uploaded and validated successfully');

      console.log(`Document ${document_id} validated successfully for employee ${employee_id}`);

    } catch (error) {
      console.error(`Error processing ${s3_key}:`, error);

      // Update status to ERROR in DynamoDB
      await updateDocumentStatus(employee_id, document_id, 'ERROR', error.message);
    }
  }
};

// ─── Helper: Update document status in DynamoDB ─────────────────
async function updateDocumentStatus(employee_id, document_id, status, reason) {
  await dynamoClient.send(new UpdateItemCommand({
    TableName: process.env.DOCUMENTS_TABLE,
    Key: {
      employee_id: { S: employee_id },
      document_id: { S: document_id },
    },
    UpdateExpression: 'SET #s = :status, validation_message = :reason, validated_at = :time',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: {
      ':status': { S: status },
      ':reason': { S: reason },
      ':time':   { S: new Date().toISOString() },
    },
  }));
}

// ─── Helper: Publish to SNS ──────────────────────────────────────
async function publishSNS(employee_id, document_id, file_name, status, message) {
  await snsClient.send(new PublishCommand({
    TopicArn: process.env.DOCUMENT_SNS_TOPIC_ARN,
    Subject: `Document ${status} - ${file_name}`,
    Message: JSON.stringify({
      employee_id,
      document_id,
      file_name,
      status,
      message,
      timestamp: new Date().toISOString(),
    }),
    MessageAttributes: {
      status: {
        DataType: 'String',
        StringValue: status,
      },
    },
  }));
}

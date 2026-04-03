const { DynamoDBClient, QueryCommand } = require('@aws-sdk/client-dynamodb');

const dynamoClient = new DynamoDBClient({});

exports.handler = async (event) => {
  try {
    const employee_id = event.pathParameters && event.pathParameters.employee_id;
    if (!employee_id) {
      return response(400, { message: 'employee_id is required in path' });
    }

    // ─── Query all documents for this employee ─────────────────
    const result = await dynamoClient.send(new QueryCommand({
      TableName: process.env.DOCUMENTS_TABLE,
      KeyConditionExpression: 'employee_id = :eid',
      ExpressionAttributeValues: {
        ':eid': { S: employee_id },
      },
      ScanIndexForward: false, // newest first
    }));

    // ─── Format the response ───────────────────────────────────
    const documents = (result.Items || []).map((item) => ({
      document_id:        item.document_id?.S,
      file_name:          item.file_name?.S,
      file_type:          item.file_type?.S,
      file_size:          item.file_size?.N,
      status:             item.status?.S,
      uploaded_at:        item.uploaded_at?.S,
      validated_at:       item.validated_at?.S,
      validation_message: item.validation_message?.S,
    }));

    return response(200, {
      employee_id,
      total: documents.length,
      documents,
    });

  } catch (error) {
    console.error('ERROR in listDocuments:', error);
    return response(500, { error: error.message });
  }
};

const response = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  try {
    console.log("EVENT:", JSON.stringify(event));

    // safe parsing
    let body = {};
    if (event.body) {
      body = typeof event.body === "string"
        ? JSON.parse(event.body)
        : event.body;
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Lambda is working 🚀",
        input: body
      }),
    };

  } catch (error) {
    console.error("ERROR:", error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error.message,
      }),
    };
  }
};
module.exports = {
  openapi: "3.0.3",
  info: {
    title: "TLMPS Portal API",
    version: "1.0.0",
    description:
      "JSON endpoints exposed by the TLMPS Portal. Most other application routes serve HTML pages or process browser forms.",
  },
  servers: [{ url: "/" }],
  paths: {
    "/health": {
      get: {
        tags: ["System"],
        summary: "Check application health",
        responses: {
          "200": {
            description: "The application is running.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["status"],
                  properties: {
                    status: { type: "string", example: "ok" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/superadmin/api/check-admission/{admission_no}": {
      get: {
        tags: ["Superadmin"],
        summary: "Check whether an admission number is already registered",
        description:
          "Admission numbers must contain exactly five digits. Invalid values return exists=false.",
        parameters: [
          {
            name: "admission_no",
            in: "path",
            required: true,
            description: "The five-digit admission number to check.",
            schema: {
              type: "string",
              pattern: "^\\d{5}$",
              example: "12345",
            },
          },
        ],
        responses: {
          "200": {
            description: "The lookup result.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["exists"],
                  properties: {
                    exists: { type: "boolean", example: false },
                    name: {
                      type: "string",
                      nullable: true,
                      description: "The registered student's name when found.",
                      example: "Ada Okafor",
                    },
                  },
                },
              },
            },
          },
          "500": {
            description: "The admission lookup failed.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["error"],
                  properties: {
                    error: {
                      type: "string",
                      example: "Admission lookup failed",
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};
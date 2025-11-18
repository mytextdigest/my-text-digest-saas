import { S3Client } from "@aws-sdk/client-s3";

const s3Client = new S3Client({
  region: process.env.VPC_REGION,
  credentials: {
    accessKeyId: process.env.VPC_ACCESS_KEY_ID,
    secretAccessKey: process.env.VPC_SECRET_ACCESS_KEY,
  },
});

export default s3Client;



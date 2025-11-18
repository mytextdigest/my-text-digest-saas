import { NextResponse } from "next/server";
import { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";

const s3 = new S3Client({
  region: process.env.VPC_REGION,
  credentials: {
    accessKeyId: process.env.VPC_ACCESS_KEY_ID,
    secretAccessKey: process.env.VPC_SECRET_ACCESS_KEY,
  },
});

export async function POST(req) {
  try {
    const { fileName, fileType, userId } = await req.json();

    console.log("Incoming upload request:", { fileName, fileType, userId });

    if (!fileName || !fileType || !userId) {
      return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
    }

    const key = `uploads/${userId}/${fileName}`;

    const presignedPost = await createPresignedPost(s3, {
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Fields: {
        "Content-Type": fileType,
      },
      Conditions: [
        ["starts-with", "$Content-Type", ""],
        ["content-length-range", 0, 10485760], // 10 MB max
      ],
      Expires: 60, // seconds
    });

    return NextResponse.json({
      url: presignedPost.url,
      fields: presignedPost.fields,
      key,
    });
  } catch (err) {
    console.error("Error creating presigned URL:", err);
    return NextResponse.json({ error: "Failed to create presigned URL" }, { status: 500 });
  }
}

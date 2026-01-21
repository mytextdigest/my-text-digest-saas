import { NextResponse } from "next/server";
import { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { prisma } from "@/lib/prisma";

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

export async function POST(req) {
  try {
    const { fileName, fileType, userId, projectId } = await req.json();

    if (!fileName || !fileType || !userId || !projectId) {
      return NextResponse.json(
        { error: "Missing parameters" },
        { status: 400 }
      );
    }

    // ✅ Exact match (case + extension sensitive)
    const existing = await prisma.document.findFirst({
      where: {
        userId,
        projectId,
        filename: fileName,
      },
      select: { id: true },
    });

    if (existing) {
      return NextResponse.json(
        {
          error: "DUPLICATE_FILENAME",
          message: `A document named "${fileName}" already exists in this project.`,
        },
        { status: 409 }
      );
    }

    const key = `uploads/${userId}/${projectId}/${fileName}`;

    const presignedPost = await createPresignedPost(s3, {
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Fields: {
        "Content-Type": fileType,
      },
      Conditions: [
        ["starts-with", "$Content-Type", ""],
        ["content-length-range", 0, 10 * 1024 * 1024],
      ],
      Expires: 60,
    });

    return NextResponse.json({
      url: presignedPost.url,
      fields: presignedPost.fields,
      key,
    });
  } catch (err) {
    console.error("Presign error:", err);
    return NextResponse.json(
      { error: "Failed to create presigned URL" },
      { status: 500 }
    );
  }
}

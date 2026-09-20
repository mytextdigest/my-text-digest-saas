// src/lib/slides/imageStorage.js
// Shared S3 upload + long-lived-URL resolution for slide imagery (AI-
// generated hero images, uploaded/generated pool images for the Uploads
// panel, brand-kit logos). Used both by worker/processSlideBuild.js (hero
// images at deck-build time) and the Phase 4 API routes (brand-logo/
// slide-image upload + generate), so the S3 client and URL-expiry policy
// live in exactly one place.

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { generateSignedUrl, SLIDE_IMAGE_URL_EXPIRES_IN } from "../s3SignedUrl.js";

const s3 = new S3Client({
  requestHandler: new NodeHttpHandler({ connectionTimeout: 5000, requestTimeout: 60000 }),
});

export async function uploadImageBufferToS3(buffer, key, contentType = "image/png") {
  await s3.send(
    new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: buffer, ContentType: contentType })
  );
  return key;
}

// See SLIDE_IMAGE_URL_EXPIRES_IN's own comment (s3SignedUrl.js) for why this
// is a 7-day signed URL rather than the 1-hour default other read routes use
// — these URLs get baked directly into SlideDeck.outlineJson, not resolved
// fresh on every read.
export async function resolveSlideImageUrl(key) {
  return generateSignedUrl(key, SLIDE_IMAGE_URL_EXPIRES_IN);
}

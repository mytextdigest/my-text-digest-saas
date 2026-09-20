import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import s3Client from "./s3.mjs";

export async function generateSignedUrl(key, expiresIn = 3600) {
  const command = new GetObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
  });

  return getSignedUrl(s3Client, command, { expiresIn }); // default: 1 hour
}

// SigV4's own maximum — used for URLs embedded directly inside SlideDeck's
// outlineJson (hero images, freeform image elements, brand logo), since
// those aren't re-resolved from a stored S3 key on every read the way
// SlideImage/Figure listing routes resolve a fresh signed URL each time —
// they're baked into the JSON blob itself. A 7-day ceiling still means a
// deck left completely untouched for over a week needs its images
// regenerated/re-uploaded; a proper fix (storing the raw key and resolving
// fresh signed URLs on every outline read) is future work, out of scope for
// this port.
export const SLIDE_IMAGE_URL_EXPIRES_IN = 604800;

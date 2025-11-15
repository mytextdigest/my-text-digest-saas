// scripts/runBackgroundTasks.mjs
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { extractTextFromPDFBuffer } from "./pdfExtractor.mjs";
import mammoth from "mammoth";
import fs from "fs";

// Configuration
const CHUNK_SIZE = 2000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function retryOperation(operation, operationName, maxRetries = MAX_RETRIES) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      console.warn(`⚠️ ${operationName} attempt ${attempt} failed:`, error.message);
      if (attempt < maxRetries) {
        await delay(RETRY_DELAY * attempt);
      }
    }
  }
  throw lastError;
}

function chunkText(text, chunkSize = CHUNK_SIZE) {
  if (!text || text.length === 0) {
    return [];
  }
  
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function loadDependencies() {
  try {
    // Load dependencies with retry logic
    const { default: s3Client } = await import("../src/lib/s3.mjs");
    const { prisma } = await import("../src/lib/prisma.mjs");
    const { 
      generateEmbeddingsInBackground, 
      runSummarizationInBackground 
    } = await import("../src/utils/backgroundTasks.mjs");

    return { s3Client, prisma, generateEmbeddingsInBackground, runSummarizationInBackground };
  } catch (error) {
    console.error("❌ Failed to load dependencies:", error);
    throw new Error(`Dependency loading failed: ${error.message}`);
  }
}

async function updateDocumentStatus(prisma, docId, status, error = null) {
  return retryOperation(
    async () => {
      return await prisma.document.update({
        where: { id: docId },
        data: error 
          ? { status, error: error.message || String(error) }
          : { status, error: null },
      });
    },
    `Update document status to ${status}`
  );
}

async function downloadFromS3(s3Client, s3Key) {
  return retryOperation(
    async () => {
      const command = new GetObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET,
        Key: s3Key,
      });
      const response = await s3Client.send(command);
      return await streamToBuffer(response.Body);
    },
    "S3 download"
  );
}

async function processDocument(docId, s3Key, filename) {
  console.log(`🚀 Worker started for doc ${docId}, file: ${filename}`);
  
  let dependencies;
  try {
    // Load all dependencies first
    dependencies = await loadDependencies();
    const { prisma } = dependencies;

    // Update status to extracting
    await updateDocumentStatus(prisma, docId, "extracting");

    // Download file from S3
    console.log(`📥 Downloading file from S3: ${s3Key}`);
    const buffer = await downloadFromS3(dependencies.s3Client, s3Key);
    
    if (!buffer || buffer.length === 0) {
      throw new Error("Downloaded file is empty");
    }

    console.log(`✅ Downloaded ${buffer.length} bytes`);

    // Extract text based on file type
    let text = "";
    if (filename.endsWith(".txt")) {
      text = buffer.toString("utf-8");
    } else if (filename.endsWith(".pdf")) {
      console.log("📄 Processing PDF file...");
      text = await extractTextFromPDFBuffer(buffer);
    } else if (filename.endsWith(".docx")) {
      console.log("📄 Processing DOCX file...");
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } else {
      throw new Error(`Unsupported file type: ${filename}`);
    }

    if (!text || text.trim().length === 0) {
      throw new Error("No text content extracted from file");
    }

    console.log(`✅ Extracted ${text.length} characters from ${filename}`);

    // Chunk text
    const chunks = chunkText(text);
    console.log(`📦 Created ${chunks.length} chunks`);

    // Insert chunks into DB
    await retryOperation(
      async () => {
        await prisma.chunk.createMany({
          data: chunks.map((chunk, idx) => ({
            document_id: docId,
            chunk_index: idx,
            text: chunk,
          })),
        });
      },
      "Create chunks in database"
    );

    // Update document with content and status
    await updateDocumentStatus(prisma, docId, "processing");

    // Run background AI tasks sequentially to avoid overload
    console.log(`🤖 Starting AI tasks for document ${docId}`);
    
    if (dependencies.generateEmbeddingsInBackground) {
      await dependencies.generateEmbeddingsInBackground(docId, chunks);
    } else {
      console.warn("⚠️ generateEmbeddingsInBackground function not available");
    }

    if (dependencies.runSummarizationInBackground) {
      await dependencies.runSummarizationInBackground(docId, filename, chunks);
    } else {
      console.warn("⚠️ runSummarizationInBackground function not available");
    }

    // Final status update
    await updateDocumentStatus(prisma, docId, "completed");
    
    console.log(`🎉 Processing complete for doc ${docId}`);

  } catch (error) {
    console.error("❌ Worker failed:", error);
    
    try {
      if (dependencies?.prisma) {
        await updateDocumentStatus(dependencies.prisma, docId, "error", error);
      }
    } catch (dbError) {
      console.error("❌ Failed to update error status:", dbError);
    }
  } finally {
    // Graceful shutdown
    process.exit(0);
  }
}

// Handle command line arguments (fallback)
if (process.argv.length >= 5) {
  const docId = process.argv[2];
  const s3Key = process.argv[3];
  const filename = process.argv[4];
  
  console.log(`📝 Starting via CLI args for doc: ${docId}`);
  processDocument(docId, s3Key, filename).catch(console.error);
}

// Handle IPC messages (primary)
process.on("message", async (message) => {
  if (message && message.docId && message.s3Key && message.filename) {
    console.log(`📝 Starting via IPC for doc: ${message.docId}`);
    await processDocument(message.docId, message.s3Key, message.filename);
  } else {
    console.error("❌ Invalid IPC message:", message);
    process.exit(1);
  }
});

// Handle uncaught errors
process.on("uncaughtException", (error) => {
  console.error("💥 Uncaught Exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("💥 Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});
// scripts/pdfExtractor.mjs
import PDFParser from "pdf2json";
import fs from "fs/promises";
import os from "os";
import path from "path";

export async function extractTextFromPDFBuffer(buffer) {
  let tempPath;
  
  try {
    // Create temp file
    const tempDir = os.tmpdir();
    tempPath = path.join(tempDir, `pdf_${Date.now()}_${Math.random().toString(36).substring(7)}.pdf`);
    
    await fs.writeFile(tempPath, buffer);
    
    return new Promise((resolve, reject) => {
      const pdfParser = new PDFParser(null, 1);
      
      const timeout = setTimeout(() => {
        reject(new Error("PDF parsing timeout"));
      }, 30000); // 30 second timeout

      pdfParser.on("pdfParser_dataError", (errData) => {
        clearTimeout(timeout);
        reject(new Error(`PDF parsing error: ${errData.parserError}`));
      });

      pdfParser.on("pdfParser_dataReady", () => {
        clearTimeout(timeout);
        try {
          const text = pdfParser.getRawTextContent() || "";
          resolve(text);
        } catch (error) {
          reject(error);
        }
      });

      pdfParser.loadPDF(tempPath);
    });
    
  } catch (error) {
    throw new Error(`PDF extraction failed: ${error.message}`);
  } finally {
    // Clean up temp file
    if (tempPath) {
      try {
        await fs.unlink(tempPath);
      } catch (cleanupError) {
        console.warn("⚠️ Failed to clean up temp file:", cleanupError);
      }
    }
  }
}
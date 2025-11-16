import { exec } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";

export async function extractPdfText(buffer) {
  const tmpPdf = path.join(os.tmpdir(), `doc_${Date.now()}.pdf`);
  const tmpTxt = path.join(os.tmpdir(), `doc_${Date.now()}.txt`);

  await fs.writeFile(tmpPdf, buffer);  

  await new Promise((resolve, reject) => {
    exec(`pdftotext "${tmpPdf}" "${tmpTxt}"`, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  const text = await fs.readFile(tmpTxt, "utf8");

  // Cleanup
  fs.unlink(tmpPdf).catch(()=>{});
  fs.unlink(tmpTxt).catch(()=>{});

  return text;
}

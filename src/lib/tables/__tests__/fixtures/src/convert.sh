#!/bin/sh
# Converts the HTML sources into the DOCX fixtures, then renders the PDFs
# from those DOCX files with Writer (keeps table borders). Needs LibreOffice.
set -e
cd "$(dirname "$0")"
for f in annual_report_2025 annual_report_2024 research_paper; do
  soffice --headless --convert-to docx:"MS Word 2007 XML" --outdir .. "$f.html" >/dev/null 2>&1
  soffice --headless --convert-to pdf:writer_pdf_Export --outdir .. "../$f.docx" >/dev/null 2>&1
done

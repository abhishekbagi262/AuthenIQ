# AuthenIQ — AuthenIQ | SIH 2026 PS 26261 Prototype

**Problem statement:** PS 26261 — “AI-Powered Application Validation, Document Authentication and Regulatory Compliance Verification” (AICTE Regulation Bureau).

This is a local, browser-based decision-support prototype. It demonstrates institution intake, browser-local text extraction, deterministic preliminary checks, an explicitly simulated source connector, the six PS verification statuses, officer review, correction/resubmission, reporting, and an audit trail. It is **not** connected to AICTE, DigiLocker, or any real issuing authority.

## Run it

1. Extract the project folder.
2. Open the folder in VS Code.
3. Open `index.html` with Live Server, or open it directly in a modern browser.
4. Internet access is needed for the PDF.js and Tesseract.js CDN scripts. If those libraries cannot load, file metadata checks and the rest of the workflow still work, but extraction will be marked unavailable and the document should be manually reviewed.
5. The app stores application data in this browser's `localStorage`. Use **Reset demo data** in the admin portal to restore the fictional sample records.

No backend, build step, API key, or package installation is required.

## Implemented features

- **Institution portal:** create an application, enter institution and contact details, select one file for each required category, and submit or resubmit corrections.
- **Browser-local document text extraction:** PDFs use PDF.js to extract embedded text from up to the first three pages. If a PDF appears scanned, the first page is rendered and passed to Tesseract.js OCR. JPG/JPEG/PNG files are passed to Tesseract.js OCR. Extracted text is truncated to 8,000 characters per document; a short preview is shown to the reviewer. OCR confidence is shown where the engine returns it.
- **Preliminary checks:** required fields and categories, filename extension/MIME compatibility, date validity/expiry, declared institution/legal-name consistency, exact duplicate name/application-type match within local demo records, and a limited name cross-check against locally extracted text.
- **PS 26261 six-status workflow:** Verified, Mismatch Detected, Expired, Verification Pending, Source Unavailable, Manual Review Required. The status is shown per document and separately from the application decision. “Verified” is reserved for a matching response from a real authorised source; this prototype has no such connector, so the simulated connector cannot produce Verified.
- **Simulated source connector:** choose a document category and demonstrate simulated match, mismatch, source unavailable, and inconclusive/manual-review outcomes. The interface explicitly labels every result **SIMULATED — NOT LIVE AUTHENTICATION**.
- **Compliance rules:** configurable illustrative registration, faculty, and campus-area rules. These rules are not a complete or validated APH implementation.
- **Officer workflow:** application queue, comments, approve/needs-correction/reject actions with reasons, correction/resubmission loop, and timeline.
- **Reports and audit:** downloadable HTML report, print/save as PDF, CSV export, and local timestamped action log.
- **PS test bench:** repeatable synthetic status-routing tests, including expiry, mismatch, source unavailable, manual review, and the safeguard that a simulated match remains Verification Pending.

## Verification workflow

`Application Intake → Local Text Extraction → Preliminary Field/Date Checks → APH-style Sample Rules → Cross-Document / Anomaly Flags → PS Status Routing → Officer Review → Report and Audit`

The current extraction and checks are intentionally bounded. OCR output can be wrong. A missing name in extracted text can reflect OCR noise or a document layout difference and is not proof of fraud. The reviewer must inspect the original evidence.

## Status semantics

- **Verified:** only after an authorised live source confirms a matching record. Unavailable in the current prototype.
- **Mismatch Detected:** a conflicting entered/source result or a preliminary text/name inconsistency has been flagged. This is not proof of forgery.
- **Expired:** the registration validity date entered in the application is in the past. This is based on entered metadata, not issuer confirmation.
- **Verification Pending:** a trusted source result is still needed, or a simulated match has not been confirmed by an authorised source.
- **Source Unavailable:** the simulated connector returned unavailable. It does not represent a live source outage.
- **Manual Review Required:** extraction is unavailable/low-confidence or the result is inconclusive.

The application decision (Approved / Needs Correction / Rejected) is separate from document status. Preliminary flags do not make the authority decision automatically.

## Data handling and limitations

- Files are read locally in the browser for extraction; raw files are **not uploaded to a server**.
- Extracted text snippets (up to 8,000 characters per file), extraction status, and metadata are saved in `localStorage`. This is local demo storage, not secure document storage. Avoid real, confidential, or personal documents.
- PDF extraction reads embedded text from up to three pages. Scanned PDF OCR processes only the first page. Image OCR processes the selected image. This is not a production document-ingestion pipeline.
- Tesseract.js/PDF.js are loaded from public CDNs; a network connection is required for those features. The application does not send files to an external OCR API, but the browser downloads the library code from the CDN.
- No AI language model, trained document classifier, tamper/forgery detector, digital-signature verification, official AICTE lookup, or live DigiLocker/issuer connector is implemented.
- The source connector is synthetic test data only. It must never be described as real authentication.
- The included compliance rules and thresholds are illustrative and must be checked against the applicable AICTE Approval Process Handbook and amendments before operational use.
- Role switching is a demonstration control, not authentication. `localStorage` and the audit trail are not secure, shared, server-side, or tamper-proof.
- Test-bench results measure only whether a few deterministic routing cases match their expected outcomes. They do not measure OCR accuracy, detection performance on real scans, time savings, or effectiveness in live AICTE operations.

## Recommended next engineering steps

1. Validate category-specific rules against the applicable APH version and amendments, with a rule ID, clause, effective period, and test case for each rule.
2. Expand OCR to multi-page PDFs and structured field extraction, then build a labelled synthetic evaluation set and measure extraction accuracy.
3. Implement robust cross-document comparisons with evidence locations, confidence thresholds, and explicit human-review fallback.
4. Integrate an authorised issuer source only after access approval and technical documentation are available. Keep mock and live source adapters separate.
5. Move storage and audit records to a backend; implement authentication, role-based access control, encryption, retention controls, and tamper-evident logs before any real use.

## References to verify before submission

- AICTE Regulation Bureau, SIH 2026 Problem Statement 26261 (primary requirements source; use the exact portal listing URL in the final deck).
- AICTE, Approval Process Handbook 2024–25 to 2026–27 and applicable amendments: https://aicte.gov.in/sites/default/files/APH%20Final.pdf and https://aicte.gov.in/node/2869
- DigiLocker: https://www.digilocker.gov.in/
- DigiLocker Partner FAQ: https://www.digilocker.gov.in/assets/FAQ%20DL%20EL_onboarding.pdf

Confirm the current applicable handbook/amendments and every reference link before claiming regulatory completeness or source integration.

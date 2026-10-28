# AuthenIQ / AuthenIQ — PS 26261 implementation map

## Current prototype scope

| PS-related requirement | Current implementation | Evidence / limitation |
|---|---|---|
| Application intake | Implemented | Institution portal creates and resubmits an application record. |
| Required-document checklist | Implemented | Four demo categories: registration, faculty, infrastructure, financial. Confirm categories against the exact PS and applicable application type before treating as complete. |
| OCR / document text extraction | Partial | PDF.js reads embedded text from up to three pages; scanned PDF OCR is first page only; image OCR uses Tesseract.js. CDN dependency; text and confidence may be wrong. |
| Field / date checks | Partial | Deterministic checks use form-entered values; expiry is based on the entered registration date. |
| Cross-document comparison | Limited | One preliminary name cross-check against extracted text. No robust multi-field extraction/comparison pipeline yet. |
| Anomaly / manipulation detection | Not implemented as forensic analysis | Preliminary flags only. No image tamper analysis, PDF structural analysis, or proof of alteration. |
| APH regulatory compliance | Partial / illustrative | Sample registration, faculty, campus-area rules. Not a complete, validated, versioned APH rule engine. |
| Six verification statuses | Implemented as a workflow model | Statuses: Verified, Mismatch Detected, Expired, Verification Pending, Source Unavailable, Manual Review Required. “Verified” requires an authorised live source and is not produced by the mock connector. |
| Authorised-source lookup | Not implemented | Mock connector is explicitly labelled **SIMULATED — NOT LIVE AUTHENTICATION**. No AICTE/DigiLocker/issuer system is contacted. |
| Officer decision | Implemented as demo workflow | Approve, Needs Correction, Reject, with required reason; not an official AICTE decision. |
| Correction and resubmission | Implemented | Same application ID is returned for correction and resubmission. |
| Evidence-linked audit and report | Partial | Local timestamps, check reasons, extraction preview, source simulation, report and CSV. No tamper-evident server audit or authoritative evidence chain. |
| Security / multi-user operation | Not implemented for production | Role selector is a demo control; browser localStorage is not secure server-side storage. |

## Six-status semantics in this prototype

- **Verified:** reserved for an authorised live source response that matches the claim. No live connector is implemented, so this should not appear as a result of the simulated connector.
- **Mismatch Detected:** a rule or source response flags a conflict. This is an investigation cue, not a fraud determination.
- **Expired:** the entered registration validity date is in the past; this is not an issuer-confirmed result.
- **Verification Pending:** a trusted verification result is still required; a simulated match remains pending.
- **Source Unavailable:** the mock connector returned unavailable. This is a simulated case, not a real source outage.
- **Manual Review Required:** extraction is unavailable/low confidence or the connector result is inconclusive.

## Recommended live demo sequence

1. Open an existing fictional application in the AICTE Admin Portal.
2. Run AuthenIQ Verification and show required fields, file metadata, OCR text preview when present, preliminary checks, and the generated report.
3. Explain the boundary: OCR extracts text but does not establish authenticity; exact-name matches are preliminary only.
4. In the simulated connector, choose a document category and run **Simulated mismatch**; show the per-document status and the explicit simulation label.
5. Repeat with **Source unavailable** and **Inconclusive / manual review** to show fallback routing.
6. Open **PS test bench** and run the synthetic test suite. Describe it as deterministic status-routing tests, not model accuracy or real-world validation.
7. Request correction with a reason, switch to the Institution Portal, edit and resubmit, then return to the admin queue.
8. Open the report and audit trail. Make clear that the decision and audit are local demo records.

## Claims that are safe to make

- “The prototype performs browser-local PDF text extraction and image OCR when its free CDN libraries are available.”
- “The workflow uses deterministic preliminary rules and evidence-linked reasons.”
- “The mock connector demonstrates status routing only and is not live authentication.”
- “The system keeps the officer in control of the final decision.”

## Claims to avoid until implemented and evaluated

- “AICTE documents are authenticated” or “DigiLocker/issuer verification is live.”
- “The system detects forged/tampered documents.”
- “All APH rules are covered.”
- “OCR is accurate” or “scrutiny time is reduced by X%” without a defined test set and measured results.
- “Role-based access, secure storage, or tamper-proof audit logs are production-ready.”

## Next engineering priorities

1. Use the exact PS and current APH clauses to define a versioned, category-specific rule catalogue.
2. Expand extraction to multi-page scanned PDFs and structured fields with evidence page/region, confidence, and manual correction.
3. Build a synthetic test corpus with clean, expired, missing, inconsistent, duplicate, low-quality, and altered-looking samples; label ground truth and report precision/recall only after measurement.
4. Add a separate authorised-source adapter only after access is approved; keep its response distinct from simulated test fixtures.
5. Move from browser localStorage to a backend with authentication, role-based authorisation, protected file storage, retention policy, and tamper-evident audit events before handling real records.

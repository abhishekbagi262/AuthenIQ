(function () {
  "use strict";

  const STORAGE_KEY = "verifyflow-autheniq-demo-v2";
  const ALLOWED_EXTENSIONS = ["pdf", "jpg", "jpeg", "png"];
  const ALLOWED_MIME_TYPES = {
    pdf: ["application/pdf"],
    jpg: ["image/jpeg", "image/jpg"],
    jpeg: ["image/jpeg", "image/jpg"],
    png: ["image/png"]
  };
  const REQUIRED_DOCS = [
    { key: "registration", label: "Institution registration", required: true },
    { key: "faculty", label: "Faculty details", required: true },
    { key: "infrastructure", label: "Infrastructure evidence", required: true },
    { key: "financial", label: "Financial statements", required: true }
  ];
  const WORKFLOW_STAGES = [
    { id: "submitted", label: "Submitted" },
    { id: "received", label: "Received" },
    { id: "document_validation", label: "Document Validation" },
    { id: "compliance_assessment", label: "Compliance Assessment" },
    { id: "report_generated", label: "Report Generated" },
    { id: "authority_review", label: "Authority Review" },
    { id: "final_decision", label: "Final Decision" }
  ];
  const COMPLIANCE_RULES = [
    { id: "registration", title: "Institution registration evidence", evidence: "Registration category document and an entered validity date", reason: "Checks that registration evidence metadata is present; does not authenticate the document.", evidenceReference: "Registration document filename/category and registration validity date", evaluate: app => app.documents.some(doc => doc.category === "registration") && Boolean(app.expiryDate) },
    { id: "faculty", title: "Faculty information available", evidence: "Faculty details document and declared faculty count", reason: "Checks that faculty evidence and a non-zero declared count are provided.", evidenceReference: "Faculty document filename/category and declared faculty count", evaluate: app => app.documents.some(doc => doc.category === "faculty") && Number(app.facultyCount) > 0 },
    { id: "infrastructure", title: "Campus area declaration", evidence: "Infrastructure evidence and declared campus area", reason: "Illustrative threshold: 5 acres. Confirm applicable norms before relying on this result.", evidenceReference: "Infrastructure document filename/category and declared campus area", evaluate: app => app.documents.some(doc => doc.category === "infrastructure") && Number(app.campusArea) >= 5 }
  ];
  const CATEGORY_LABELS = Object.fromEntries(REQUIRED_DOCS.map(doc => [doc.key, doc.label]));
  const STATUS_LABELS = { submitted: "SUBMITTED", pending: "Pending Review", approved: "APPROVED", correction: "NEEDS CORRECTION", rejected: "REJECTED" };
  const state = { role: "admin", view: "dashboard", currentApplicationId: null, editId: null, formDocuments: {}, rules: {}, pendingOcr: 0 };
  const runningAuthenIQIds = new Set();

  const $ = selector => document.querySelector(selector);
  const main = $("#mainContent");
  const escapeHtml = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const normalize = value => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  const nowIso = () => new Date().toISOString();
  const formattedDate = value => value ? new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";
  const formattedTime = value => value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

  function makeSample(id, name, type, status, city, updatedDays, overrides) {
    const updatedAt = new Date(Date.now() - updatedDays * 86400000).toISOString();
    return Object.assign({
      id, institutionName: name, legalName: name, applicationType: type, address: `${city}, India`,
      state: city === "Pune" ? "Maharashtra" : city === "Jaipur" ? "Rajasthan" : "Karnataka",
      pincode: city === "Pune" ? "411001" : city === "Jaipur" ? "302001" : "560001",
      contactName: "Demo Contact", email: `office@${name.toLowerCase().replace(/[^a-z0-9]/g, "")}.example`,
      phone: "9876543210", establishedDate: "2012-06-15", expiryDate: "2027-06-30",
      facultyCount: 24, campusArea: 8.5, status, createdAt: updatedAt, updatedAt,
      documents: REQUIRED_DOCS.map(doc => ({ category: doc.key, name: `${doc.key}-evidence-demo.pdf`, type: "application/pdf", size: 245000, uploadedAt: updatedAt })),
      checks: [], comments: [], history: [{ status, reason: "Fictional sample application.", actor: "System", at: updatedAt }],
      validationRuns: 0,
      source: "fictional_sample",
      workflow: {
        stage: "received",
        timestamps: { submitted: updatedAt, received: updatedAt },
        events: [
          { stage: "submitted", at: updatedAt, note: "Fictional sample application record." },
          { stage: "received", at: updatedAt, note: "Received by the local AuthenIQ demonstration workflow." }
        ]
      },
      authenIQ: { processingState: "RECEIVED", authenticity: "NOT VERIFIED", documentChecks: [], complianceChecks: [], complianceStatus: "PENDING", psStatus: "Verification Pending", sourceVerification: null, report: null }
    }, overrides || {});
  }

  function seedData() {
    const apps = [
      makeSample("SV-26-00142", "Northstar Institute of Technology", "New Institution Approval", "pending", "Pune", 1, { facultyCount: 32, campusArea: 12 }),
      makeSample("SV-26-00141", "Riverbend Technical University", "Extension of Approval", "correction", "Jaipur", 2, { expiryDate: "", facultyCount: 18, campusArea: 7, comments: [{ actor: "AICTE Administrator", text: "Please provide the current registration validity date and confirm the declared dates.", at: new Date(Date.now() - 86400000).toISOString() }], history: [{ status: "pending", reason: "Application submitted.", actor: "Technical Institution", at: new Date(Date.now() - 4 * 86400000).toISOString() }, { status: "correction", reason: "Please provide the current registration validity date and confirm the declared dates.", actor: "AICTE Administrator", at: new Date(Date.now() - 2 * 86400000).toISOString() }] }),
      makeSample("SV-26-00140", "Cedar Valley Engineering College", "Increase in Intake", "approved", "Bengaluru", 4, { facultyCount: 41, campusArea: 16 }),
      makeSample("SV-26-00139", "Meridian School of Applied Sciences", "New Institution Approval", "pending", "Jaipur", 5, { campusArea: 3.2, facultyCount: 15 }),
      makeSample("SV-26-00138", "Western Lakes Institute", "Extension of Approval", "rejected", "Pune", 8, { history: [{ status: "rejected", reason: "Illustrative sample decision; review all current official requirements.", actor: "AICTE Administrator", at: new Date(Date.now() - 8 * 86400000).toISOString() }] }),
      makeSample("SV-26-00137", "Demo Technical Institution", "Extension of Approval", "correction", "Bengaluru", 3, {
        owner: "institution",
        email: "contact@demo-institution.example",
        comments: [{ actor: "AICTE Administrator", text: "Please confirm the registration validity date and review the declared campus area against your evidence.", at: new Date(Date.now() - 2 * 86400000).toISOString() }],
        history: [{ status: "pending", reason: "Fictional sample application submitted.", actor: "Technical Institution", at: new Date(Date.now() - 5 * 86400000).toISOString() }, { status: "correction", reason: "Please confirm the registration validity date and review the declared campus area against your evidence.", actor: "AICTE Administrator", at: new Date(Date.now() - 3 * 86400000).toISOString() }]
      })
    ];
    const audit = [];
    apps.forEach(app => audit.push({ id: app.id, action: "Fictional sample record loaded", actor: "System", at: app.createdAt }));
    return { apps, audit, rules: Object.fromEntries(COMPLIANCE_RULES.map(rule => [rule.id, true])), nextNumber: 143 };
  }

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return seedData();
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.apps) || !Array.isArray(data.audit)) throw new Error("Stored demo data has an invalid shape.");
      const validApps = data.apps.filter(app => app && typeof app.id === "string" && typeof app.institutionName === "string");
      return {
        apps: validApps.map(app => {
          const normalized = Object.assign({ documents: [], checks: [], comments: [], history: [], validationRuns: 0 }, app);
          normalized.status = Object.prototype.hasOwnProperty.call(STATUS_LABELS, normalized.status) ? normalized.status : "pending";
          normalized.applicationType = typeof normalized.applicationType === "string" ? normalized.applicationType : "Unspecified demo application";
          normalized.address = typeof normalized.address === "string" ? normalized.address : "";
          normalized.state = typeof normalized.state === "string" ? normalized.state : "";
          normalized.pincode = typeof normalized.pincode === "string" ? normalized.pincode : "";
          normalized.legalName = typeof normalized.legalName === "string" ? normalized.legalName : "";
          normalized.contactName = typeof normalized.contactName === "string" ? normalized.contactName : "";
          normalized.email = typeof normalized.email === "string" ? normalized.email : "";
          normalized.phone = typeof normalized.phone === "string" ? normalized.phone : "";
          normalized.establishedDate = typeof normalized.establishedDate === "string" ? normalized.establishedDate : "";
          normalized.expiryDate = typeof normalized.expiryDate === "string" ? normalized.expiryDate : "";
          normalized.facultyCount = Number.isFinite(Number(normalized.facultyCount)) ? Number(normalized.facultyCount) : 0;
          normalized.campusArea = Number.isFinite(Number(normalized.campusArea)) ? Number(normalized.campusArea) : 0;
          normalized.createdAt = typeof normalized.createdAt === "string" && Number.isFinite(Date.parse(normalized.createdAt)) ? normalized.createdAt : nowIso();
          normalized.updatedAt = typeof normalized.updatedAt === "string" && Number.isFinite(Date.parse(normalized.updatedAt)) ? normalized.updatedAt : normalized.createdAt;
          normalized.documents = (Array.isArray(normalized.documents) ? normalized.documents : []).filter(doc => doc && typeof doc.name === "string" && typeof doc.category === "string");
          normalized.checks = (Array.isArray(normalized.checks) ? normalized.checks : []).filter(check => check && typeof check.result === "string");
          normalized.comments = (Array.isArray(normalized.comments) ? normalized.comments : []).filter(comment => comment && typeof comment.text === "string");
          normalized.history = (Array.isArray(normalized.history) ? normalized.history : []).filter(item => item && typeof item.status === "string");
          normalized.validationRuns = Number.isFinite(normalized.validationRuns) ? normalized.validationRuns : 0;
          normalized.workflow = normalizeWorkflow(normalized.workflow, normalized.createdAt);
          normalized.authenIQ = normalizeAuthenIQ(normalized.authenIQ);
          normalized.source = typeof normalized.source === "string" ? normalized.source : (normalized.owner === "institution" ? "institution_submission" : "fictional_sample");
          return normalized;
        }),
        audit: data.audit.filter(item => item && typeof item.action === "string"),
        rules: Object.assign(Object.fromEntries(COMPLIANCE_RULES.map(rule => [rule.id, true])), data.rules || {}),
        nextNumber: Number.isInteger(data.nextNumber) && data.nextNumber > 0 ? data.nextNumber : 143
      };
    } catch (error) {
      console.error("Could not read VerifyFlow demo data:", error);
      toast("Saved demo data could not be read. Fresh fictional sample data is shown; reset demo data to replace the saved copy.", "error", 7000);
      return seedData();
    }
  }

  function normalizeWorkflow(value, fallbackAt) {
    const workflow = value && typeof value === "object" ? value : {};
    const timestamps = workflow.timestamps && typeof workflow.timestamps === "object" ? workflow.timestamps : {};
    const events = Array.isArray(workflow.events) ? workflow.events.filter(item => item && WORKFLOW_STAGES.some(stage => stage.id === item.stage)) : [];
    if (!events.some(item => item.stage === "submitted")) events.unshift({ stage: "submitted", at: fallbackAt, note: "Fictional demo submission record." });
    if (!events.some(item => item.stage === "received")) events.push({ stage: "received", at: fallbackAt, note: "Received in the local AuthenIQ demo workflow." });
    if (!timestamps.submitted) timestamps.submitted = fallbackAt;
    if (!timestamps.received) timestamps.received = fallbackAt;
    const stage = WORKFLOW_STAGES.some(item => item.id === workflow.stage) ? workflow.stage : "document_validation";
    return { stage, timestamps, events };
  }
  function normalizeAuthenIQ(value) {
    const authenIQ = value && typeof value === "object" ? value : {};
    return {
      processingState: typeof authenIQ.processingState === "string" ? authenIQ.processingState : "RECEIVED",
      authenticity: "NOT VERIFIED",
      documentChecks: Array.isArray(authenIQ.documentChecks) ? authenIQ.documentChecks : [],
      complianceChecks: Array.isArray(authenIQ.complianceChecks) ? authenIQ.complianceChecks : [],
      complianceStatus: typeof authenIQ.complianceStatus === "string" ? authenIQ.complianceStatus : "PENDING",
      psStatus: typeof authenIQ.psStatus === "string" ? authenIQ.psStatus : "Verification Pending",
      sourceVerification: authenIQ.sourceVerification && typeof authenIQ.sourceVerification === "object" ? authenIQ.sourceVerification : null,
      report: authenIQ.report && typeof authenIQ.report === "object" ? authenIQ.report : null,
      processedAt: typeof authenIQ.processedAt === "string" ? authenIQ.processedAt : null
    };
  }
  function ensureWorkflow(app) {
    app.workflow = normalizeWorkflow(app.workflow, app.createdAt || nowIso());
    app.authenIQ = normalizeAuthenIQ(app.authenIQ);
    if (!app.authenIQ.report && !app.validationAt && app.authenIQ.processingState !== "PROCESSING" && app.workflow.stage === "document_validation") {
      app.workflow.stage = "received";
    }
  }
  function addWorkflowEvent(app, stage, note) {
    ensureWorkflow(app);
    const at = nowIso();
    app.workflow.stage = stage;
    app.workflow.timestamps[stage] = at;
    if (!app.workflow.events.some(event => event.stage === stage && event.at === at)) {
      app.workflow.events.push({ stage, at, note });
    }
    return at;
  }
  function initializeAuthenIQIntake(app, resubmission) {
    const submittedAt = nowIso();
    const receivedAt = nowIso();
    app.workflow = {
      stage: "received",
      timestamps: { submitted: submittedAt, received: receivedAt },
      events: [
        { stage: "submitted", at: submittedAt, note: resubmission ? "Institution resubmitted the corrected application." : "Institution submitted the application." },
        { stage: "received", at: receivedAt, note: "AuthenIQ received the same saved application record." }
      ]
    };
    app.authenIQ = {
      processingState: "RECEIVED",
      authenticity: "NOT VERIFIED",
      documentChecks: [],
      complianceChecks: [],
      complianceStatus: "PENDING",
      psStatus: "Verification Pending",
      sourceVerification: null,
      report: null,
      processedAt: null
    };
    app.checks = [];
    app.validationAt = null;
    app.validationRuns = 0;
  }
  function workflowStageIndex(app) {
    const stage = app.workflow && app.workflow.stage;
    return WORKFLOW_STAGES.findIndex(item => item.id === stage);
  }
  function workflowStageLabel(app) {
    const stage = WORKFLOW_STAGES.find(item => item.id === app.workflow.stage);
    return stage ? stage.label : "Submitted";
  }
  function isPendingReview(app) {
    return app.status === "submitted" || app.status === "pending";
  }

  let store = loadStore();
  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
      return true;
    } catch (error) {
      console.error("Could not save VerifyFlow demo data:", error);
      toast("Could not save changes in this browser. Check local storage availability and try again.", "error", 7000);
      return false;
    }
  }
  function addAudit(id, action, actor) {
    store.audit.unshift({ id, action, actor, at: nowIso() });
    if (store.audit.length > 500) store.audit.length = 500;
  }
  function toast(message, type, duration) {
    const node = document.createElement("div");
    node.className = `toast${type === "error" ? " error" : ""}`;
    node.textContent = message;
    $("#toastRegion").appendChild(node);
    window.setTimeout(() => node.remove(), duration || 3600);
  }
  function statusClass(status) {
    return status === "approved" ? "approved" : status === "correction" ? "correction" : status === "rejected" ? "rejected" : "pending";
  }
  function statusBadge(status) {
    return `<span class="status ${statusClass(status)}">${escapeHtml(STATUS_LABELS[status] || status)}</span>`;
  }
  function appById(id) { return store.apps.find(app => app.id === id); }
  function getCurrentApps() {
    return state.role === "institution" ? store.apps.filter(app => app.owner === "institution") : store.apps;
  }
  function currentActor() { return state.role === "admin" ? "AICTE Administrator" : "Demo Technical Institution"; }
  function filteredApps(query, status) {
    return getCurrentApps().filter(app => {
      const text = normalize(`${app.id} ${app.institutionName} ${app.applicationType} ${app.state}`);
      return (!query || text.includes(normalize(query))) && (!status || app.status === status);
    });
  }
  function runValidation(app) {
    const docs = Array.isArray(app.documents) ? app.documents : [];
    const requiredFields = [
      ["Institution name", app.institutionName],
      ["Registered legal name", app.legalName],
      ["Application type", app.applicationType],
      ["Address", app.address],
      ["State / Union Territory", app.state],
      ["PIN code", app.pincode],
      ["Contact person", app.contactName],
      ["Contact email", app.email],
      ["Contact phone", app.phone],
      ["Establishment date", app.establishedDate],
      ["Registration validity / expiry date", app.expiryDate],
      ["Faculty count", Number(app.facultyCount) > 0],
      ["Campus area", Number(app.campusArea) > 0]
    ];
    const missingFields = requiredFields.filter(([, value]) => !value || value === "false").map(([label]) => label);
    const missingCategories = REQUIRED_DOCS.filter(item => !docs.some(doc => doc.category === item.key)).map(item => item.label);
    const establishedDateValid = Boolean(app.establishedDate && Number.isFinite(Date.parse(app.establishedDate)));
    const expiryDateValid = Boolean(app.expiryDate && Number.isFinite(Date.parse(app.expiryDate)));
    const expired = expiryDateValid && app.expiryDate < new Date().toISOString().slice(0, 10);
    const datesValid = Boolean(establishedDateValid && expiryDateValid && Date.parse(app.establishedDate) <= Date.parse(app.expiryDate) && !expired);
    const namesMatch = Boolean(app.institutionName && app.legalName && normalize(app.institutionName) === normalize(app.legalName));
    const duplicate = store.apps.some(other => other.id !== app.id && normalize(other.institutionName) === normalize(app.institutionName) && other.applicationType === app.applicationType);
    const formatChecks = REQUIRED_DOCS.map(category => {
      const file = docs.find(doc => doc.category === category.key);
      if (!file) return {
        name: `File type: ${category.label}`, category: category.key, result: "PENDING",
        explanation: "No file metadata is recorded for this category, so its file type cannot be checked.",
        action: `Select and submit a ${category.label.toLowerCase()} file, then run validation.`
      };
      const extension = (file.name.split(".").pop() || "").toLowerCase();
      const extensionAllowed = ALLOWED_EXTENSIONS.includes(extension);
      const mimeMismatch = Boolean(file.type && extensionAllowed && !ALLOWED_MIME_TYPES[extension].includes(file.type.toLowerCase()));
      const allowed = extensionAllowed && !mimeMismatch;
      return {
        name: `File type: ${category.label}`, category: category.key, result: allowed ? "PASS" : "FLAG",
        explanation: allowed ? `${file.name} uses an allowed filename extension${file.type ? " and a compatible browser-reported media type" : ""}. File contents are not inspected.` : mimeMismatch ? `${file.name} has a filename extension that does not match its browser-reported media type.` : `${file.name} uses an unsupported filename extension (${extension || "none"}).`,
        action: allowed ? "Confirm this is the intended file; metadata checks do not inspect contents." : "Re-select a correctly named PDF, JPG, JPEG, or PNG file and confirm its format."
      };
    });
    const checks = [
      { name: "Required application fields", result: missingFields.length ? "FLAG" : "PASS", explanation: missingFields.length ? `Missing or invalid: ${missingFields.join(", ")}.` : "All required institution, contact, and declared information fields are present.", action: missingFields.length ? "Complete or correct the listed required fields." : "No action required." },
      { name: "Required document categories", result: missingCategories.length ? "FLAG" : "PASS", explanation: missingCategories.length ? `No file metadata recorded for: ${missingCategories.join(", ")}.` : "All required document categories have selected file metadata recorded.", action: missingCategories.length ? "Select and submit a file for each missing category." : "Confirm each file is the intended current evidence." },
      ...formatChecks,
      { name: "Dates and expiry information", result: datesValid ? "PASS" : "FLAG", explanation: datesValid ? "Establishment and validity dates are present, valid, and in sequence." : "A date is missing or invalid, or the validity date precedes the establishment date.", action: datesValid ? "Compare the entered dates with the source evidence." : "Enter valid dates and ensure expiry is not before establishment." },
      { name: "Institution name consistency", result: namesMatch ? "PASS" : "FLAG", explanation: namesMatch ? "Entered institution name matches the declared registered legal name." : "Institution name and registered legal name are missing or do not match.", action: namesMatch ? "Confirm the spelling against the source evidence." : "Align the names with the institution's records." },
      { name: "Potential duplicate application", result: duplicate ? "FLAG" : "PASS", explanation: duplicate ? "Another local demo record has the same institution name and application type." : "No exact name-and-application-type match was found in local demo records.", action: duplicate ? "Review the matching demo record before proceeding." : "This local exact-match check is not an official database search." },
      (() => {
        const extracted = docs.filter(doc => doc.extractionStatus === "COMPLETED" && doc.extractedText);
        const combined = extracted.map(doc => doc.extractedText).join("\n");
        const legalNameFound = Boolean(app.legalName && normalize(combined).includes(normalize(app.legalName)));
        const institutionNameFound = Boolean(app.institutionName && normalize(combined).includes(normalize(app.institutionName)));
        const confidenceValues = extracted.map(doc => Number(doc.extractionConfidence)).filter(Number.isFinite);
        const lowConfidence = confidenceValues.some(value => value < 55);
        return {
          name: "OCR text availability and name cross-check", result: !extracted.length ? "PENDING" : (legalNameFound || institutionNameFound) ? "PASS" : "PENDING",
          notPerformed: !extracted.length || (!legalNameFound && !institutionNameFound),
          evidenceReference: extracted.length ? extracted.map(doc => `${CATEGORY_LABELS[doc.category] || doc.category}: ${doc.name} (${doc.extractionMethod || "local extraction"})`).join("; ") : "No extracted document text available",
          explanation: !extracted.length ? "No text was extracted. OCR may be unavailable, the file may be unreadable, or the file may contain no selectable text." : lowConfidence ? "Text was extracted with low OCR confidence. Results are not reliable enough for an automated mismatch decision." : (legalNameFound || institutionNameFound) ? "At least one declared institution name was found in locally extracted text. This is a preliminary text comparison, not authenticity verification." : "Text was extracted, but the declared institution/legal name was not found as an exact normalized string. This may be OCR noise or a real mismatch; it is not proof of falsification.",
          action: !extracted.length ? "Manually review the document; confirm OCR dependencies and scan readability." : (legalNameFound || institutionNameFound) ? "Officer should compare the extracted evidence with the original document." : "Open the source document and route to Manual Review Required before concluding there is a mismatch."
        };
      })()
    ];
    if (checks.some(check => check.name === "Dates and expiry information")) {
      const dateCheck = checks.find(check => check.name === "Dates and expiry information");
      dateCheck.explanation = datesValid
        ? "Establishment and validity dates are present, valid, current, and in sequence."
        : expired
          ? "The registration validity / expiry date is in the past."
          : "A date is missing or invalid, or the validity date precedes the establishment date.";
      dateCheck.action = datesValid
        ? "Compare the entered dates with the source evidence."
        : expired
          ? "Provide current registration evidence or the applicable renewal record."
          : "Enter valid dates and ensure expiry is not before establishment.";
    }
    return checks.map(check => check.result === "FLAG" && !check.severity
      ? Object.assign({}, check, { severity: /required|missing/i.test(check.name || "") ? "high" : "medium" })
      : check);
  }
  function pendingValidation(app) {
    return runValidation(app).map(check => Object.assign({}, check, {
      result: "PENDING",
      explanation: "Preliminary validation has not been run for this application.",
      action: "Select Run Validation to evaluate this check."
    }));
  }
  function appCompliance(app) {
    return COMPLIANCE_RULES.filter(rule => store.rules[rule.id] !== false).map(rule => {
      const pass = rule.evaluate(app);
      return { title: rule.title, evidence: rule.evidence, evidenceReference: rule.evidenceReference, result: pass ? "PASS" : "FLAG", severity: pass ? "info" : "medium", explanation: pass ? "The declared information and document metadata are present for this illustrative check." : "The declared information or required evidence metadata is missing or below this illustrative sample threshold.", action: pass ? "Verify against current official requirements." : "Review the evidence and declared information; confirm current requirements." };
    });
  }
  function complianceOverall(checks) {
    if (!checks.length || checks.some(check => check.result === "PENDING")) return "PENDING";
    return checks.some(check => check.result === "FLAG") ? "FLAG" : "PASS";
  }
  function buildVerificationReport(app) {
    const checks = app.checks || [];
    const compliance = app.authenIQ.complianceChecks || [];
    const documents = (app.documents || []).map(doc => {
      const check = (app.authenIQ.documentChecks || []).find(item => item.category === doc.category);
      return {
        category: CATEGORY_LABELS[doc.category] || doc.category,
        filename: doc.name,
        type: doc.type || "unknown",
        size: doc.size || 0,
        recordedAt: doc.uploadedAt || null,
        uploadStatus: "RECORDED",
        validationStatus: check ? check.result : "PENDING",
        extractionStatus: doc.extractionStatus || "NOT RUN",
        psStatus: deriveDocumentPsStatus(app, doc),
        extractionMethod: doc.extractionMethod || "Not available",
        extractionConfidence: Number.isFinite(Number(doc.extractionConfidence)) ? Number(doc.extractionConfidence) : null,
        extractedTextPreview: String(doc.extractedText || "").slice(0, 500),
        authenticity: "NOT VERIFIED"
      };
    });
    const pending = checks.filter(check => check.result === "PENDING");
    return {
      applicationId: app.id,
      generatedAt: nowIso(),
      submissionAt: app.workflow.timestamps.submitted || app.createdAt,
      institution: {
        name: app.institutionName,
        legalName: app.legalName,
        applicationType: app.applicationType,
        address: app.address,
        state: app.state,
        pincode: app.pincode,
        contactName: app.contactName,
        email: app.email,
        establishedDate: app.establishedDate,
        expiryDate: app.expiryDate
      },
      documents,
      checks,
      compliance,
      complianceStatus: complianceOverall(compliance),
      psStatus: app.authenIQ.psStatus || derivePsStatus(app),
      sourceVerification: app.authenIQ.sourceVerification || null,
      statusAtGeneration: app.status,
      flaggedIssues: [...checks.filter(check => check.result === "FLAG"), ...compliance.filter(check => check.result === "FLAG")],
      checksNotPerformed: [
        ...pending.map(check => ({ name: check.name || check.title, reason: check.explanation })),
        { name: "Trusted-source / digital-signature authenticity verification", reason: "No trusted verification service or signature-validation mechanism is implemented. Authenticity remains NOT VERIFIED." }
      ],
      limitations: [
        "Preliminary browser-local text extraction, metadata, and entered-field checks; no official AICTE integration or database lookup.",
        "Selected files are processed locally in this browser for text extraction/OCR when dependencies are available; raw files are not uploaded to a server. Extracted text snippets are saved in localStorage for this demo.",
        "Filename extension and browser-reported MIME type checks do not establish file safety, document validity, or authenticity. OCR extraction and name matching are preliminary and can contain errors.",
        "Compliance criteria are illustrative demo rules and must be checked against current official AICTE regulations.",
        "This report is not an approval, rejection, or authoritative compliance decision."
      ]
    };
  }
  function waitForDemoStep() {
    return new Promise(resolve => window.setTimeout(resolve, 300));
  }
  async function runAuthenIQ(id) {
    if (state.role !== "admin") {
      toast("Only the AICTE Admin Portal can run AuthenIQ verification.", "error");
      return;
    }
    const app = appById(id);
    if (!app) {
      toast("Application could not be found; AuthenIQ was not started.", "error");
      return;
    }
    if (["approved", "correction", "rejected"].includes(app.status)) {
      toast("This application has a recorded authority decision. An institution must resubmit requested corrections before verification can run again.", "error");
      return;
    }
    if (runningAuthenIQIds.has(id)) return;
    runningAuthenIQIds.add(id);
    ensureWorkflow(app);
    app.authenIQ.processingState = "PROCESSING";
    app.authenIQ.report = null;
    addWorkflowEvent(app, "document_validation", "AuthenIQ started preliminary document and application checks.");
    addAudit(id, "AuthenIQ verification started", "AuthenIQ");
    try {
      if (!persist()) return;
      const setProgress = (message, step) => {
        const element = $("#authenIQProgress");
        if (element) element.innerHTML = `<span class="progress-spinner" aria-hidden="true"></span><span>${escapeHtml(message)}</span><strong>${step}/3</strong>`;
      };
      setProgress("AuthenIQ is checking document metadata and application information…", 1);
      await waitForDemoStep();
      const checks = runValidation(app);
      app.checks = checks;
      app.validationRuns = (app.validationRuns || 0) + 1;
      app.validationAt = nowIso();
      app.authenIQ.documentChecks = checks.filter(check => check.category || check.name === "Required document categories" || /text availability|text consistency/i.test(check.name || ""));
      app.authenIQ.psStatus = derivePsStatus(app);
      addWorkflowEvent(app, "document_validation", "Document metadata, locally extracted text when available, dates, and entered information checked. OCR results are preliminary; authenticity is not established.");
      addAudit(id, "Preliminary document validation completed", "AuthenIQ");
      if (!persist()) return;

      app.workflow.stage = "compliance_assessment";
      setProgress("Evaluating illustrative compliance rules for this application…", 2);
      await waitForDemoStep();
      app.authenIQ.complianceChecks = appCompliance(app);
      app.authenIQ.complianceStatus = complianceOverall(app.authenIQ.complianceChecks);
      addWorkflowEvent(app, "compliance_assessment", "Configured illustrative demo compliance rules evaluated against this application record.");
      addAudit(id, "Illustrative compliance assessment completed", "AuthenIQ");
      if (!persist()) return;

      setProgress("Generating the preliminary verification report…", 3);
      await waitForDemoStep();
      app.authenIQ.psStatus = derivePsStatus(app);
      app.authenIQ.report = buildVerificationReport(app);
      app.authenIQ.processingState = "COMPLETED";
      app.authenIQ.processedAt = app.authenIQ.report.generatedAt;
      addWorkflowEvent(app, "report_generated", "AuthenIQ preliminary report generated and saved to this application record.");
      app.workflow.stage = "report_generated";
      app.updatedAt = nowIso();
      addAudit(id, "AuthenIQ verification report generated", currentActor());
      if (!persist()) return;
      toast(`AuthenIQ report generated for ${id}. Findings are preliminary; authenticity remains NOT VERIFIED.`);
      openApplication(id);
    } finally {
      runningAuthenIQIds.delete(id);
    }
  }
  const PS_VERIFICATION_STATUSES = ["Verified", "Mismatch Detected", "Expired", "Verification Pending", "Source Unavailable", "Manual Review Required"];
  function derivePsStatus(app) {
    const source = app.authenIQ && app.authenIQ.sourceVerification;
    const expiry = app.expiryDate && Number.isFinite(Date.parse(app.expiryDate)) && app.expiryDate < new Date().toISOString().slice(0, 10);
    if (expiry) return "Expired";
    if (source && source.sourceType === "authorized" && source.outcome === "MATCH") return "Verified";
    if (source && source.sourceType === "simulated") {
      if (source.outcome === "MISMATCH") return "Mismatch Detected";
      if (source.outcome === "UNAVAILABLE") return "Source Unavailable";
      if (source.outcome === "INCONCLUSIVE") return "Manual Review Required";
      return "Verification Pending";
    }
    const checks = app.checks || [];
    const mismatch = checks.some(check => check.result === "FLAG" && /name consistency|text consistency|cross-document/i.test(check.name || ""));
    if (mismatch) return "Mismatch Detected";
    const docs = app.documents || [];
    if (docs.some(doc => doc.extractionStatus === "LOW_CONFIDENCE" || doc.extractionStatus === "UNAVAILABLE")) return "Manual Review Required";
    if (!docs.length || docs.some(doc => !doc.extractedText)) return "Verification Pending";
    return "Manual Review Required";
  }
  function deriveDocumentPsStatus(app, doc) {
    if (!doc) return "Manual Review Required";
    const isRegistration = doc.category === "registration";
    const expired = isRegistration && app.expiryDate && Number.isFinite(Date.parse(app.expiryDate)) && app.expiryDate < new Date().toISOString().slice(0, 10);
    if (expired) return "Expired";
    const source = app.authenIQ && app.authenIQ.sourceVerification;
    if (source && (!source.category || source.category === doc.category)) {
      if (source.sourceType === "authorized" && source.outcome === "MATCH") return "Verified";
      if (source.sourceType === "simulated") {
        if (source.outcome === "MISMATCH") return "Mismatch Detected";
        if (source.outcome === "UNAVAILABLE") return "Source Unavailable";
        if (source.outcome === "INCONCLUSIVE") return "Manual Review Required";
      }
    }
    const categoryCheck = (app.checks || []).find(check => check.category === doc.category && check.result === "FLAG");
    if (categoryCheck || (app.checks || []).some(check => check.result === "FLAG" && /name consistency|text consistency|cross-document/i.test(check.name || ""))) return "Mismatch Detected";
    if (doc.extractionStatus === "LOW_CONFIDENCE" || doc.extractionStatus === "UNAVAILABLE") return "Manual Review Required";
    return "Verification Pending";
  }
  function psStatusClass(status) {
    if (status === "Verified") return "approved";
    if (status === "Mismatch Detected" || status === "Expired") return "flag";
    if (status === "Source Unavailable" || status === "Manual Review Required") return "review";
    return "not-run";
  }
  function runMockSourceVerification(id) {
    if (state.role !== "admin") { toast("Only the admin demo portal can run the simulated source check.", "error"); return; }
    const app = appById(id);
    if (!app) return;
    const select = $("#mockSourceOutcome");
    const outcome = select ? select.value : "INCONCLUSIVE";
    const categorySelect = $("#mockSourceCategory");
    const category = categorySelect ? categorySelect.value : "registration";
    const outcomes = {
      MATCH: "SIMULATED MATCH: a fictional source record matches the entered claim. This is not live authentication and cannot produce Verified status.",
      MISMATCH: "SIMULATED MISMATCH: a fictional source record conflicts with the entered claim. An officer must inspect the evidence.",
      UNAVAILABLE: "SIMULATED SOURCE UNAVAILABLE: no response is returned by the mock connector.",
      INCONCLUSIVE: "SIMULATED INCONCLUSIVE RESULT: the mock connector cannot establish a match; manual review is required."
    };
    app.authenIQ.sourceVerification = { sourceType: "simulated", outcome, category, message: outcomes[outcome] || outcomes.INCONCLUSIVE, sourceName: "Demo Registry Connector", checkedAt: nowIso(), liveAuthentication: false };
    app.authenIQ.psStatus = derivePsStatus(app);
    app.updatedAt = nowIso();
    addAudit(id, `Simulated source verification: ${outcome}`, currentActor());
    addWorkflowEvent(app, "document_validation", `SIMULATED — NOT LIVE AUTHENTICATION. Mock source outcome: ${outcome}.`);
    if (app.authenIQ.report) {
      app.authenIQ.report.psStatus = app.authenIQ.psStatus;
      app.authenIQ.report.sourceVerification = app.authenIQ.sourceVerification;
      app.authenIQ.report.documents = (app.authenIQ.report.documents || []).map(item => {
        const sourceDoc = (app.documents || []).find(doc => doc.category === REQUIRED_DOCS.find(required => required.label === item.category)?.key);
        return sourceDoc ? Object.assign({}, item, { psStatus: deriveDocumentPsStatus(app, sourceDoc) }) : item;
      });
    }
    if (!persist()) return;
    toast(`Simulated source result saved. Status: ${app.authenIQ.psStatus}. No live source was contacted.`);
    openApplication(id);
  }
  function resultClass(result) { return result === "PASS" ? "pass" : result === "FLAG" ? "flag" : "not-run"; }
  function resultIcon(result) { return result === "PASS" ? "✓" : result === "FLAG" ? "!" : "…"; }
  function checkSeverity(check) {
    if (check.severity) return check.severity;
    if (check.result !== "FLAG") return "";
    return /required|missing/i(check.name || check.title || "") ? "high" : "medium";
  }
  function checkMarkup(check) {
    const severity = check.result === "FLAG" ? checkSeverity(check) : "";
    const notPerformed = check.notPerformed || check.severity === "not performed";
    return `<div class="check-item"><span class="check-symbol ${resultClass(check.result)}">${resultIcon(check.result)}</span><div><strong>${escapeHtml(check.name || check.title)} <span class="result-label">${escapeHtml(check.result)}</span>${severity ? ` <span class="severity-label severity-${escapeHtml(severity)}">${escapeHtml(severity.toUpperCase())} SEVERITY</span>` : ""}${notPerformed ? ` <span class="not-performed-label">NOT PERFORMED</span>` : ""}</strong><small>${escapeHtml(check.explanation)}${check.evidenceReference ? ` Evidence: ${escapeHtml(check.evidenceReference)}.` : ""} ${check.action ? `Next: ${escapeHtml(check.action)}` : ""}</small></div></div>`;
  }
  function pageHeader(title, description, actions) {
    return `<div class="page-header"><div><h1>${title}</h1><p>${description}</p></div>${actions ? `<div class="header-actions">${actions}</div>` : ""}</div>`;
  }
  function appRow(app) {
    const adminCells = state.role === "admin" ? `<td><span class="primary-cell">${escapeHtml(workflowStageLabel(app))}</span><span class="secondary-cell">${escapeHtml(app.authenIQ.processingState || "RECEIVED")}</span></td><td>${app.authenIQ.report ? `<span class="status approved">AVAILABLE</span>` : `<span class="status not-run">PENDING</span>`}</td>` : "";
    return `<tr class="clickable-row" data-open-app="${escapeHtml(app.id)}" tabindex="0" role="button" aria-label="Review ${escapeHtml(app.id)}"><td><span class="primary-cell">${escapeHtml(app.id)}</span><span class="secondary-cell">${formattedDate(app.createdAt)}</span></td><td><span class="primary-cell">${escapeHtml(app.institutionName)}</span><span class="secondary-cell">${escapeHtml(app.state || "—")}</span></td><td>${escapeHtml(app.applicationType)}</td><td>${statusBadge(app.status)}</td>${adminCells}<td>${formattedDate(app.updatedAt)}</td><td><button class="link-button" data-open-app="${escapeHtml(app.id)}">View details →</button></td></tr>`;
  }
  function tableMarkup(apps, emptyText) {
    return `<div class="table-wrap"><table><thead><tr><th>Application ID</th><th>Institution</th><th>Application type</th><th>Status</th>${state.role === "admin" ? "<th>AuthenIQ stage</th><th>Report</th>" : ""}<th>Last updated</th><th></th></tr></thead><tbody>${apps.length ? apps.map(appRow).join("") : `<tr><td colspan="${state.role === "admin" ? 8 : 6}"><div class="empty-state"><strong>No applications found</strong><p>${escapeHtml(emptyText || "Try changing the search or filter, or create a new application.")}</p></div></td></tr>`}</tbody></table></div>`;
  }
  function renderDashboard() {
    const applications = getCurrentApps();
    const stats = state.role === "admin" ? [
      ["Total applications", store.apps.length, "Across all demo records", "▤"],
      ["Pending reviews", store.apps.filter(isPendingReview).length, "Awaiting authority decision", "◷"],
      ["Flagged applications", store.apps.filter(app => app.checks.some(check => check.result === "FLAG") || app.authenIQ.complianceChecks.some(check => check.result === "FLAG")).length, "Saved AuthenIQ findings only", "⚑"],
      ["Completed decisions", store.apps.filter(app => ["approved", "correction", "rejected"].includes(app.status)).length, `${store.apps.filter(app => app.status === "approved").length} approved · ${store.apps.filter(app => app.status === "correction").length} need corrections · ${store.apps.filter(app => app.status === "rejected").length} rejected`, "✓"]
    ] : [
      ["My applications", applications.length, "Saved in this browser", "▤"],
      ["Pending review", applications.filter(isPendingReview).length, "Awaiting administrator review", "◷"],
      ["Needs correction", applications.filter(app => app.status === "correction").length, "Feedback is available below", "↺"],
      ["Approved", applications.filter(app => app.status === "approved").length, "Current demo status", "✓"]
    ];
    const recent = (state.role === "admin" ? store.apps : applications).slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5);
    const visibleApplicationIds = new Set(applications.map(app => app.id));
    const audit = store.audit.filter(item => state.role === "admin" || visibleApplicationIds.has(item.id)).slice(0, 5);
    const latestChecks = recent[0] ? (recent[0].authenIQ.report ? recent[0].checks : pendingValidation(recent[0])) : [];
    main.innerHTML = `${pageHeader(state.role === "admin" ? "AICTE Administrator Portal" : "Institution Portal", state.role === "admin" ? "Review institution-submitted applications and monitor preliminary validation activity." : "Track your submissions, review feedback, and manage institution applications.", `<button class="button primary" data-nav="${state.role === "admin" ? "applications" : "create"}">${state.role === "admin" ? "Review applications →" : "＋ Create application"}</button>`)}
      <div class="notice"><span class="notice-icon">ⓘ</span><div><strong>Demonstration prototype.</strong> Sample records are fictional. Validation is preliminary assistance only; no official AICTE system, database, or document-authentication service is connected.</div></div>
      <section class="stats-grid">${stats.map(([label, value, foot, icon]) => `<article class="stat-card"><div class="stat-top">${label}<span class="stat-icon">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-foot">${foot}</div></article>`).join("")}</section>
      <div class="dashboard-grid">
        <section class="panel"><div class="panel-head"><div><h2>${state.role === "admin" ? "Recent institution applications" : "Application history"}</h2><p>Latest activity in this ${state.role === "admin" ? "administrator" : "institution"} portal</p></div><button class="link-button" data-nav="applications">View all →</button></div>${tableMarkup(recent, "Create an application to see it here.")}</section>
        <section class="panel"><div class="panel-head"><div><h2>AuthenIQ workflow</h2><p>${recent[0] ? `Latest record · ${escapeHtml(recent[0].id)} · ${escapeHtml(recent[0].authenIQ.processingState)}` : "No application available"}</p></div></div><div class="panel-body"><div class="check-list">${latestChecks.length ? latestChecks.slice(0, 4).map(checkMarkup).join("") : `<div class="empty-state"><strong>Nothing to verify yet</strong><p>Create or select an application to see checks.</p></div>`}</div><div style="margin-top:15px"><button class="button secondary small" data-open-app="${recent[0] ? escapeHtml(recent[0].id) : ""}" ${recent[0] ? "" : "disabled"}>Open shared workflow</button></div></div></section>
      </div>
      <section class="panel" style="margin-top:16px"><div class="panel-head"><div><h2>Recent activity</h2><p>Important actions recorded in the local audit trail</p></div><button class="link-button" data-nav="audit">View audit trail →</button></div><div class="panel-body"><div class="activity-list">${audit.length ? audit.map(activityMarkup).join("") : `<div class="empty-state"><strong>No activity recorded</strong></div>`}</div></div></section>`;
  }
  function activityMarkup(item) {
    return `<div class="activity-item"><span class="activity-mark"></span><div><strong>${escapeHtml(item.action)} ${item.id ? `· ${escapeHtml(item.id)}` : ""}</strong><small>By ${escapeHtml(item.actor || "System")}</small></div><span class="activity-time">${formattedTime(item.at)}</span></div>`;
  }
  function renderApplications() {
    const apps = getCurrentApps();
    const defaultStatus = state.role === "admin" ? "" : "";
    main.innerHTML = `${pageHeader(state.role === "admin" ? "Applications" : "Application history", state.role === "admin" ? "Search and filter submissions before opening a detailed review." : "Review submission status, preliminary feedback, and administrator correction requests.", state.role === "institution" ? `<button class="button primary" data-nav="create">＋ New application</button>` : "")}
      <section class="panel"><div class="toolbar"><div class="search-field"><input id="applicationSearch" type="search" placeholder="Search ID, institution, type, or state…" aria-label="Search applications"></div><select id="statusFilter" aria-label="Filter by status"><option value="">All statuses</option><option value="submitted">SUBMITTED</option><option value="pending">Pending Review</option><option value="correction">Needs Correction</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select><span id="resultCount" class="secondary-cell" style="margin:0 auto 0 2px"></span></div><div id="applicationTable">${tableMarkup(apps, defaultStatus)}</div><div class="table-foot">${state.role === "admin" ? "Institution-submitted and fictional sample applications · " : ""}Select a row to view the same application workflow${state.role === "admin" ? " and record an administrative decision" : " and review feedback"}. All data remains in this browser.</div></section>`;
    $("#applicationSearch").addEventListener("input", updateApplicationTable);
    $("#statusFilter").addEventListener("change", updateApplicationTable);
    updateApplicationTable();
  }
  function updateApplicationTable() {
    const apps = filteredApps($("#applicationSearch") ? $("#applicationSearch").value : "", $("#statusFilter") ? $("#statusFilter").value : "");
    const table = $("#applicationTable");
    if (table) table.innerHTML = tableMarkup(apps);
    const count = $("#resultCount");
    if (count) count.textContent = `${apps.length} result${apps.length === 1 ? "" : "s"}`;
  }
  function formMarkup(app) {
    if (state.role !== "institution") {
      state.editId = null;
      state.view = "dashboard";
      render();
      toast("Application forms are available only in the Institution Portal.", "error");
      return;
    }
    const editing = Boolean(app);
    const fields = app || {};
    state.formDocuments = {};
    const docCards = REQUIRED_DOCS.map(doc => {
      const existing = (fields.documents || []).filter(file => file.category === doc.key);
      return `<div class="doc-upload-card"><strong>${escapeHtml(doc.label)} <span class="required">*</span></strong><input type="file" id="file-${doc.key}" data-category="${doc.key}" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" aria-label="${escapeHtml(doc.label)} file"><div class="doc-meta ${existing.length ? "selected" : ""}" id="docMeta-${doc.key}"><span class="status ${existing.length ? "recorded" : "missing"}" id="docState-${doc.key}">${existing.length ? "RECORDED" : "NOT SELECTED"}</span><span>${existing.length ? `Saved metadata: ${existing.map(file => escapeHtml(file.name)).join(", ")}` : "Required · choose a file to select it"}</span></div></div>`;
    }).join("");
    main.innerHTML = `${pageHeader(editing ? "Update application" : "Create application", editing ? `Update details for ${escapeHtml(app.id)} and resubmit for review.` : "Enter institution details and attach supporting evidence. Fields marked * are required.")}
      <div class="notice warning"><span class="notice-icon">ⓘ</span><div>Files are <strong>not uploaded to a server</strong>. PDF text or image OCR may run locally in this browser; extracted text snippets and file metadata are saved in localStorage. Use fictional, non-confidential documents only.</div></div>
      <form class="panel form-panel" id="applicationForm" novalidate>
        <div class="form-section"><div class="form-section-head"><div><h2>Institution details</h2><p>Use matching institution and legal names to pass the consistency check.</p></div><span class="eyebrow">SECTION 01</span></div>
          <div class="form-grid">
            <div class="field"><label for="institutionName">Institution name <span class="required">*</span></label><input id="institutionName" name="institutionName" required maxlength="120" value="${escapeHtml(fields.institutionName || "")}" placeholder="e.g. Example Institute of Technology"></div>
            <div class="field"><label for="legalName">Name on registration document <span class="required">*</span></label><input id="legalName" name="legalName" required maxlength="120" value="${escapeHtml(fields.legalName || "")}" placeholder="Enter registered legal name"></div>
            <div class="field"><label for="applicationType">Application type <span class="required">*</span></label><select id="applicationType" name="applicationType" required><option value="">Select type</option>${["New Institution Approval", "Extension of Approval", "Increase in Intake", "Change of Institution Name", "Merger / Closure"].map(value => `<option ${fields.applicationType === value ? "selected" : ""}>${value}</option>`).join("")}</select></div>
            <div class="field"><label for="establishedDate">Institution establishment date <span class="required">*</span></label><input id="establishedDate" type="date" name="establishedDate" required value="${escapeHtml(fields.establishedDate || "")}"></div>
            <div class="field"><label for="expiryDate">Registration validity / expiry date <span class="required">*</span></label><input id="expiryDate" type="date" name="expiryDate" required value="${escapeHtml(fields.expiryDate || "")}"><small class="field-help">Required for preliminary date checks; verify against evidence.</small></div>
            <div class="field"><label for="facultyCount">Declared faculty count <span class="required">*</span></label><input id="facultyCount" type="number" name="facultyCount" required min="1" max="10000" value="${escapeHtml(fields.facultyCount || "")}" placeholder="e.g. 25"></div>
            <div class="field"><label for="campusArea">Declared campus area (acres) <span class="required">*</span></label><input id="campusArea" type="number" name="campusArea" required min="0.1" max="100000" step="0.1" value="${escapeHtml(fields.campusArea || "")}" placeholder="e.g. 8.5"></div>
          </div>
        </div>
        <div class="form-section"><div class="form-section-head"><div><h2>Address and contact</h2><p>Provide a point of contact for any correction requests.</p></div><span class="eyebrow">SECTION 02</span></div>
          <div class="form-grid">
            <div class="field"><label for="address">Full address <span class="required">*</span></label><textarea id="address" name="address" required maxlength="300" placeholder="Street, locality, city">${escapeHtml(fields.address || "")}</textarea></div>
            <div class="field"><label for="stateName">State / Union Territory <span class="required">*</span></label><input id="stateName" name="state" required maxlength="60" value="${escapeHtml(fields.state || "")}" placeholder="State or Union Territory"></div>
            <div class="field"><label for="pincode">PIN code <span class="required">*</span></label><input id="pincode" name="pincode" required pattern="[0-9]{6}" inputmode="numeric" maxlength="6" value="${escapeHtml(fields.pincode || "")}" placeholder="6-digit PIN code"></div>
            <div class="field"><label for="contactName">Contact person <span class="required">*</span></label><input id="contactName" name="contactName" required maxlength="100" value="${escapeHtml(fields.contactName || "")}" placeholder="Full name"></div>
            <div class="field"><label for="email">Contact email <span class="required">*</span></label><input id="email" type="email" name="email" required maxlength="120" value="${escapeHtml(fields.email || "")}" placeholder="contact@example.edu.in"></div>
            <div class="field"><label for="phone">Contact phone <span class="required">*</span></label><input id="phone" type="tel" name="phone" required pattern="[0-9+]{8,18}" maxlength="18" value="${escapeHtml(fields.phone || "")}" placeholder="Digits, optionally prefixed with +"></div>
          </div>
        </div>
        <div class="form-section"><div class="form-section-head"><div><h2>Supporting documents</h2><p>One file per required category. Accepted formats: PDF, JPG, JPEG, PNG. Max 10 MB per file.</p></div><span class="eyebrow">SECTION 03</span></div><div class="doc-grid">${docCards}</div></div>
        <div class="form-actions"><button type="button" class="button secondary" data-nav="applications">Cancel</button><button type="submit" class="button primary">${editing ? "Save and resubmit" : "Submit application"} <span>→</span></button></div>
      </form>`;
    REQUIRED_DOCS.forEach(doc => {
      const input = $(`#file-${doc.key}`);
      input.addEventListener("change", () => handleFileSelection(input, doc));
    });
    $("#applicationForm").addEventListener("submit", event => submitApplication(event, app));
  }
  function handleFileSelection(input, doc) {
    const file = input.files && input.files[0];
    if (!file) return;
    const extension = file.name.split(".").pop().toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      input.value = "";
      toast("Unsupported file type. Select a PDF, JPG, JPEG, or PNG file.", "error");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      input.value = "";
      toast("File exceeds the 10 MB demo selection limit.", "error");
      return;
    }
    const selected = { category: doc.key, name: file.name, type: file.type || "unknown", size: file.size, uploadedAt: nowIso(), extractionStatus: "PROCESSING", extractedText: "", extractionEngine: "Browser-local OCR/text extraction" };
    state.formDocuments[doc.key] = selected;
    const meta = $(`#docMeta-${doc.key}`);
    meta.querySelector(".status").className = "status selected";
    meta.querySelector(".status").textContent = "SELECTED · EXTRACTING";
    meta.querySelector("span:last-child").textContent = `${file.name} · ${(file.size / 1024).toFixed(0)} KB · extracting locally in this browser…`;
    meta.classList.add("selected");
    state.pendingOcr += 1;
    extractDocumentText(file).then(result => {
      if (!state.formDocuments[doc.key] || state.formDocuments[doc.key].name !== file.name) return;
      state.formDocuments[doc.key] = Object.assign(state.formDocuments[doc.key], result);
      const status = result.extractionStatus === "COMPLETED" ? `TEXT EXTRACTED · ${result.extractedText.length} CHARS` : result.extractionStatus;
      meta.querySelector(".status").textContent = status;
      meta.querySelector(".status").className = `status ${result.extractionStatus === "COMPLETED" ? "approved" : "not-run"}`;
      meta.querySelector("span:last-child").textContent = result.extractionStatus === "COMPLETED"
        ? `${file.name} · local extraction complete · no file upload` 
        : `${file.name} · ${result.extractionMessage || "Text extraction unavailable; manual review required."}`;
    }).catch(error => {
      console.warn("Local document extraction failed:", error);
      if (state.formDocuments[doc.key] && state.formDocuments[doc.key].name === file.name) {
        Object.assign(state.formDocuments[doc.key], { extractionStatus: "UNAVAILABLE", extractionMessage: "Browser OCR/text extraction could not run; manual review required." });
        meta.querySelector(".status").textContent = "OCR UNAVAILABLE";
        meta.querySelector(".status").className = "status not-run";
      }
    }).finally(() => { state.pendingOcr = Math.max(0, state.pendingOcr - 1); });
  }
  async function extractDocumentText(file) {
    const ext = file.name.split(".").pop().toLowerCase();
    try {
      if (ext === "pdf") {
        if (!window.pdfjsLib) return { extractionStatus: "UNAVAILABLE", extractionMessage: "PDF.js library did not load. File metadata is still recorded." };
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
        let text = "";
        const maxPages = Math.min(pdf.numPages, 3);
        for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
          const page = await pdf.getPage(pageNo);
          const content = await page.getTextContent();
          text += content.items.map(item => item.str || "").join(" ") + "\n";
        }
        if (text.trim().length >= 30) return { extractionStatus: "COMPLETED", extractionMessage: "Embedded PDF text extracted locally.", extractedText: text.trim().slice(0, 8000), extractionMethod: "PDF text layer", extractedAt: nowIso() };
        if (!window.Tesseract) return { extractionStatus: "UNAVAILABLE", extractionMessage: "Scanned PDF needs OCR; OCR library did not load." };
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width; canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        const result = await window.Tesseract.recognize(canvas, "eng");
        const ocrText = (result.data.text || "").trim();
        return ocrText ? { extractionStatus: "COMPLETED", extractionMessage: "First-page OCR completed locally.", extractedText: ocrText.slice(0, 8000), extractionMethod: "Tesseract.js OCR · first page", extractionConfidence: Math.round(result.data.confidence || 0), extractedAt: nowIso() } : { extractionStatus: "LOW_CONFIDENCE", extractionMessage: "No readable text detected in the first page; manual review required.", extractedText: "", extractionMethod: "Tesseract.js OCR · first page", extractedAt: nowIso() };
      }
      if (!window.Tesseract) return { extractionStatus: "UNAVAILABLE", extractionMessage: "OCR library did not load. File metadata is still recorded." };
      const result = await window.Tesseract.recognize(file, "eng");
      const text = (result.data.text || "").trim();
      return text ? { extractionStatus: "COMPLETED", extractionMessage: "Image OCR completed locally.", extractedText: text.slice(0, 8000), extractionMethod: "Tesseract.js OCR", extractionConfidence: Math.round(result.data.confidence || 0), extractedAt: nowIso() } : { extractionStatus: "LOW_CONFIDENCE", extractionMessage: "No readable text detected; manual review required.", extractedText: "", extractionMethod: "Tesseract.js OCR", extractionConfidence: Math.round(result.data.confidence || 0), extractedAt: nowIso() };
    } catch (error) {
      return { extractionStatus: "UNAVAILABLE", extractionMessage: "Local extraction failed; continue with manual review.", extractedText: "", extractionMethod: "Unavailable", extractedAt: nowIso() };
    }
  }
  function formData() {
    return Object.fromEntries(new FormData($("#applicationForm")).entries());
  }
  function submitApplication(event, existing) {
    event.preventDefault();
    if (state.role !== "institution") {
      toast("Only the Institution Portal can submit applications.", "error");
      navigate("dashboard");
      return;
    }
    const form = $("#applicationForm");
    if (state.pendingOcr > 0) {
      toast("Wait for local text extraction to finish before submitting. You can still submit if extraction is unavailable after it finishes.", "error", 5000);
      return;
    }
    if (!form.reportValidity()) {
      toast("Complete the required fields and correct highlighted values.", "error");
      return;
    }
    const data = formData();
    const docs = existing ? (existing.documents || []).filter(doc => !state.formDocuments[doc.category]) : [];
    Object.values(state.formDocuments).forEach(doc => docs.push(doc));
    const missing = REQUIRED_DOCS.filter(doc => !docs.some(file => file.category === doc.key));
    if (missing.length) {
      toast(`Add a file for each required category: ${missing.map(doc => doc.label).join(", ")}.`, "error", 5000);
      return;
    }
    const candidate = Object.assign({}, existing || {}, data, {
      facultyCount: Number(data.facultyCount), campusArea: Number(data.campusArea),
      documents: docs, updatedAt: nowIso(), owner: existing ? existing.owner : "institution"
    });
    if (existing && existing.status === "correction" && !normalize(data.institutionName)) {
      toast("Institution name is required before resubmission.", "error");
      return;
    }
    if (!existing) {
      candidate.id = generateId();
      candidate.status = "submitted";
      candidate.createdAt = nowIso();
      candidate.comments = [];
      candidate.history = [];
    } else {
      candidate.status = "submitted";
      candidate.history = existing.history || [];
    }
    candidate.source = "institution_submission";
    initializeAuthenIQIntake(candidate, Boolean(existing));
    candidate.history.unshift({ status: "submitted", reason: existing ? "Institution corrected and resubmitted the application; AuthenIQ received it." : "Application submitted; AuthenIQ received it for preliminary processing.", actor: "Technical Institution", at: nowIso() });
    if (existing) {
      const index = store.apps.findIndex(app => app.id === existing.id);
      store.apps[index] = candidate;
      addAudit(candidate.id, "Application resubmitted to AuthenIQ", "Technical Institution");
    } else {
      store.apps.unshift(candidate);
      store.nextNumber += 1;
      addAudit(candidate.id, "Application submitted", "Technical Institution");
    }
    addAudit(candidate.id, "AuthenIQ received application", "AuthenIQ");
    if (!persist()) return;
    toast(existing ? `Application resubmitted to AuthenIQ · ${candidate.id}` : `Application submitted and received by AuthenIQ · ${candidate.id}`);
    state.editId = null;
    navigate("applications");
  }
  function generateId() {
    let id;
    do {
      const year = String(new Date().getFullYear()).slice(-2);
      id = `SV-${year}-${String(store.nextNumber++).padStart(5, "0")}`;
    } while (appById(id));
    store.nextNumber -= 1;
    return id;
  }
  function renderTestBench() {
    if (state.role !== "admin") {
      toast("The PS test bench is available in the AICTE Admin demo portal.", "error");
      navigate("dashboard");
      return;
    }
    main.innerHTML = `${pageHeader("PS 26261 test bench", "Repeatable synthetic checks for status routing and key validation scenarios. These tests validate this local prototype, not live AICTE performance.", `<button class="button primary" id="runPsTests">▶ Run synthetic test suite</button>`)}
      <div class="notice warning"><span class="notice-icon">ⓘ</span><div><strong>Synthetic tests only.</strong> No official institution records or issuer services are contacted. Test outcomes do not establish authenticity, regulatory compliance, or real-world accuracy.</div></div>
      <section class="panel"><div class="panel-head"><div><h2>Expected behaviour</h2><p>Each case has a predefined expected outcome; results are reproducible.</p></div><span class="status review">LOCAL TESTS</span></div><div id="psTestResults" class="panel-body"><div class="empty-state"><strong>Test suite not run yet</strong><p>Run the test suite to check expiry routing, mismatch routing, source-unavailable fallback, manual review, and simulated-match safeguards.</p></div></div></section>
      <section class="panel" style="margin-top:14px"><div class="panel-head"><div><h2>Coverage boundary</h2><p>What the tests can and cannot prove</p></div></div><div class="panel-body"><ul class="coverage-list"><li>Can test: deterministic status routing, mock connector fallback, and the rule that simulated matches never produce Verified.</li><li>Can test with uploaded synthetic files: local OCR availability and whether text extraction returns a preview.</li><li>Cannot prove: document authenticity, live issuer confirmation, current APH compliance, secure multi-user access, or production performance.</li></ul></div></section>`;
    $("#runPsTests").addEventListener("click", runPsTestSuite);
  }
  function runPsTestSuite() {
    const makeCase = (overrides = {}) => Object.assign({ expiryDate: "2099-12-31", checks: [], documents: [{ category: "registration", extractionStatus: "COMPLETED", extractedText: "Demo Institution" }], authenIQ: { sourceVerification: null } }, overrides);
    const cases = [
      { name: "Expired entered validity date", expected: "Expired", app: makeCase({ expiryDate: "2000-01-01" }) },
      { name: "Name/text mismatch flag", expected: "Mismatch Detected", app: makeCase({ checks: [{ name: "Institution name consistency", result: "FLAG" }] }) },
      { name: "Simulated source unavailable", expected: "Source Unavailable", app: makeCase({ authenIQ: { sourceVerification: { sourceType: "simulated", outcome: "UNAVAILABLE" } } }) },
      { name: "Inconclusive source routes to review", expected: "Manual Review Required", app: makeCase({ authenIQ: { sourceVerification: { sourceType: "simulated", outcome: "INCONCLUSIVE" } } }) },
      { name: "Simulated match does not claim Verified", expected: "Verification Pending", app: makeCase({ authenIQ: { sourceVerification: { sourceType: "simulated", outcome: "MATCH" } } }) },
      { name: "Missing OCR routes to manual review", expected: "Manual Review Required", app: makeCase({ documents: [{ category: "registration", extractionStatus: "UNAVAILABLE", extractedText: "" }] }) }
    ];
    const results = cases.map(test => {
      const actual = derivePsStatus(test.app);
      return Object.assign({}, test, { actual, passed: actual === test.expected });
    });
    const passCount = results.filter(item => item.passed).length;
    $("#psTestResults").innerHTML = `<div class="test-summary"><strong>${passCount}/${results.length} tests passed</strong><span>${passCount === results.length ? "Status routing matches expected synthetic cases." : "Review failed cases before demonstrating."}</span></div><div class="table-wrap"><table><thead><tr><th>Test case</th><th>Expected</th><th>Actual</th><th>Result</th></tr></thead><tbody>${results.map(item => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.expected)}</td><td>${escapeHtml(item.actual)}</td><td><span class="status ${item.passed ? "approved" : "flag"}">${item.passed ? "PASS" : "FAIL"}</span></td></tr>`).join("")}</tbody></table></div><p class="field-help">Run time: ${formattedTime(nowIso())}. These are unit-style checks of the local status mapper, not a benchmark of document detection.</p>`;
    addAudit("TEST-BENCH", `PS 26261 synthetic test suite: ${passCount}/${results.length} passed`, currentActor());
    persist();
    toast(`Synthetic test suite completed: ${passCount}/${results.length} passed.`, passCount === results.length ? "success" : "error");
  }
  function renderCompliance() {
    if (state.role !== "admin") {
      toast("Compliance rules are managed in the AICTE Admin Portal.", "error");
      navigate("dashboard");
      return;
    }
    const app = getCurrentApps().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    const checks = app ? appCompliance(app) : [];
    main.innerHTML = `${pageHeader("Compliance rules", "Illustrative sample rules with configurable inclusion. Verify all requirements against current official AICTE regulations.", `<button class="button secondary" data-nav="applications">Review applications</button>`)}
      <div class="notice warning"><span class="notice-icon">⚠</span><div><strong>Illustrative demo rules only.</strong> They are not authoritative AICTE regulations and have not been verified against current official requirements. A passing result is not a compliance determination.</div></div>
      <div class="application-layout"><section class="panel"><div class="panel-head"><div><h2>Sample compliance checklist</h2><p>Toggle rule inclusion; results are recalculated locally</p></div></div><div class="panel-body">${COMPLIANCE_RULES.map(rule => `<article class="rule-card"><div class="rule-top"><div><strong>${escapeHtml(rule.title)}</strong><div class="rule-evidence">Evidence needed: ${escapeHtml(rule.evidence)}</div></div><label class="switch-row"><input type="checkbox" data-rule-toggle="${rule.id}" ${store.rules[rule.id] !== false ? "checked" : ""} aria-label="Include ${escapeHtml(rule.title)}"><span class="eyebrow">INCLUDED</span></label></div><p>${escapeHtml(rule.reason)}</p></article>`).join("")}</div></section>
        <section class="panel"><div class="panel-head"><div><h2>Latest application results</h2><p>${app ? `${escapeHtml(app.id)} · ${escapeHtml(app.institutionName)}` : "Create an application to see results"}</p></div></div><div class="panel-body"><div class="check-list">${checks.length ? checks.map(checkMarkup).join("") : `<div class="empty-state"><strong>No application data</strong><p>Results will appear after a submission.</p></div>`}</div></div></section></div>`;
    main.querySelectorAll("[data-rule-toggle]").forEach(input => input.addEventListener("change", () => {
      store.rules[input.dataset.ruleToggle] = input.checked;
      persist();
      renderCompliance();
      toast("Compliance checklist configuration saved.");
    }));
  }
  function renderReports() {
    main.innerHTML = `${pageHeader("Reports", "Status summaries, preliminary validation issues, and illustrative compliance results.", `<button class="button primary" id="exportCsv">↓ Export CSV</button>`)}
      <div class="notice"><span class="notice-icon">ⓘ</span><div>Reports summarize local demonstration data only. Exported CSV includes application information and preliminary results; handle exported files carefully.</div></div>
      <div class="toolbar panel" style="margin-bottom:14px"><label for="reportStatus" class="field-help" style="margin:0">Report scope</label><select id="reportStatus"><option value="">All statuses</option><option value="submitted">SUBMITTED</option><option value="pending">Pending Review</option><option value="correction">Needs Correction</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select><span id="reportCount" class="secondary-cell" style="margin:0"></span></div>
      <div id="reportContent"></div>`;
    $("#reportStatus").addEventListener("change", renderReportContent);
    $("#exportCsv").addEventListener("click", exportCsv);
    renderReportContent();
  }
  function renderReportContent() {
    const status = $("#reportStatus").value;
    const apps = getCurrentApps().filter(app => !status || app.status === status);
    const counts = Object.keys(STATUS_LABELS).map(key => [STATUS_LABELS[key], apps.filter(app => app.status === key).length, key]);
    const validations = apps.filter(app => app.authenIQ.report).flatMap(app => app.checks);
    const issueCounts = validations.filter(check => check.result === "FLAG").reduce((acc, check) => { acc[check.name] = (acc[check.name] || 0) + 1; return acc; }, {});
    const compliance = apps.filter(app => app.authenIQ.report).flatMap(app => app.authenIQ.complianceChecks);
    const complianceCounts = ["PASS", "FLAG"].map(result => [result, compliance.filter(check => check.result === result).length]);
    $("#reportCount").textContent = `${apps.length} application${apps.length === 1 ? "" : "s"}`;
    $("#reportContent").innerHTML = `<div class="report-grid"><section class="panel"><div class="panel-head"><div><h2>Applications by status</h2><p>Counts for the selected report scope</p></div></div><div class="panel-body"><div class="bar-chart">${counts.map(([label, value, key]) => `<div class="bar-row"><label>${escapeHtml(label)}</label><div class="bar-track"><div class="bar-fill" style="width:${apps.length ? value / apps.length * 100 : 0}%;background:${key === "approved" ? "#35a276" : key === "correction" ? "#d28b4d" : key === "rejected" ? "#9b84a3" : "#5c8fdb"}"></div></div><b>${value}</b></div>`).join("")}</div></div></section>
      <section class="panel"><div class="panel-head"><div><h2>Compliance check results</h2><p>Illustrative rules currently enabled</p></div></div><div class="panel-body"><div class="mini-kpis">${complianceCounts.map(([label, value]) => `<div class="mini-kpi"><b>${value}</b><span>${label} results</span></div>`).join("")}<div class="mini-kpi"><b>${compliance.length ? (compliance.filter(check => check.result === "FLAG").length / compliance.length * 100).toFixed(0) : 0}%</b><span>Flagged results</span></div></div></div></section></div>
      <div class="report-grid"><section class="panel"><div class="panel-head"><div><h2>Validation issue summary</h2><p>Number of applications with each preliminary flag</p></div></div><div class="panel-body">${Object.keys(issueCounts).length ? `<div class="bar-chart">${Object.entries(issueCounts).map(([label, value]) => `<div class="bar-row"><label title="${escapeHtml(label)}">${escapeHtml(label)}</label><div class="bar-track"><div class="bar-fill" style="width:${apps.length ? value / apps.length * 100 : 0}%;background:#dfa441"></div></div><b>${value}</b></div>`).join("")}</div>` : `<div class="empty-state"><strong>No flagged checks</strong><p>There are no preliminary flags for this selection.</p></div>`}</div></section>
      <section class="panel"><div class="panel-head"><div><h2>Report scope</h2><p>Current dataset overview</p></div></div><div class="panel-body"><div class="mini-kpis"><div class="mini-kpi"><b>${apps.length}</b><span>Applications</span></div><div class="mini-kpi"><b>${apps.reduce((sum, app) => sum + (app.documents || []).length, 0)}</b><span>File metadata entries</span></div><div class="mini-kpi"><b>${store.audit.length}</b><span>Audit events</span></div></div><p class="field-help">CSV contains only the selected applications and does not include file contents.</p></div></section></div>
      <section class="panel"><div class="panel-head"><div><h2>Applications in report</h2><p>Use CSV export for offline review</p></div></div>${tableMarkup(apps, "No applications match this report filter.")}</section>`;
  }
  function exportCsv() {
    const status = $("#reportStatus").value;
    const apps = getCurrentApps().filter(app => !status || app.status === status);
    const headers = ["Application ID", "Institution", "Application type", "Status", "State", "Contact email", "Created", "Updated", "Validation flags", "Compliance pass", "Compliance flags"];
    const rows = apps.map(app => {
      const checks = app.authenIQ.report ? app.checks : [];
      const compliance = app.authenIQ.report ? app.authenIQ.complianceChecks : [];
      return [app.id, app.institutionName, app.applicationType, STATUS_LABELS[app.status] || app.status, app.state, app.email, app.createdAt, app.updatedAt, checks.filter(check => check.result === "FLAG").length, compliance.filter(check => check.result === "PASS").length, compliance.filter(check => check.result === "FLAG").length];
    });
    const csv = [headers, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `smartverify-report-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast(`CSV exported with ${apps.length} application${apps.length === 1 ? "" : "s"}.`);
  }
  function csvCell(value) {
    let text = String(value == null ? "" : value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }
  function renderAudit() {
    main.innerHTML = `${pageHeader("Audit trail", "A local, timestamped log of important actions in this demo.", `<button class="button secondary" id="auditRefresh">↻ Refresh</button>`)}
      <div class="notice"><span class="notice-icon">ⓘ</span><div>This is a browser-local demonstration log, not a tamper-proof or production audit record. Demo records and activity can be cleared using Reset demo data.</div></div>
      <section class="panel"><div class="toolbar"><div class="search-field"><input type="search" id="auditSearch" placeholder="Search action or application ID…" aria-label="Search audit trail"></div><select id="auditActor"><option value="">All actors</option><option>AICTE Administrator</option><option>Technical Institution</option><option>System</option></select><span id="auditCount" class="secondary-cell" style="margin:0 auto 0 2px"></span></div><div id="auditList"></div></section>`;
    $("#auditSearch").addEventListener("input", updateAudit);
    $("#auditActor").addEventListener("change", updateAudit);
    $("#auditRefresh").addEventListener("click", () => { store = loadStore(); updateAudit(); toast("Audit trail refreshed from local storage."); });
    updateAudit();
  }
  function updateAudit() {
    const query = normalize($("#auditSearch").value);
    const actor = $("#auditActor").value;
    const institutionApplicationIds = new Set(getCurrentApps().map(app => app.id));
    const items = store.audit.filter(item =>
      (state.role === "admin" || institutionApplicationIds.has(item.id)) &&
      (!query || normalize(`${item.id || ""} ${item.action} ${item.actor}`).includes(query)) &&
      (!actor || item.actor === actor)
    );
    $("#auditCount").textContent = `${items.length} event${items.length === 1 ? "" : "s"}`;
    $("#auditList").innerHTML = `<div class="panel-body"><div class="activity-list">${items.length ? items.map(activityMarkup).join("") : `<div class="empty-state"><strong>No audit events found</strong><p>Change your search or actor filter.</p></div>`}</div></div>`;
  }
  function openApplication(id) {
    const app = appById(id);
    if (!app) { toast("Application could not be found in local demo data.", "error"); return; }
    ensureWorkflow(app);
    if (state.role === "admin") beginAuthorityReview(app);
    state.currentApplicationId = id;
    const validationComplete = Boolean(app.validationAt && Number.isFinite(Date.parse(app.validationAt)) && Array.isArray(app.checks) && app.checks.length);
    const checks = validationComplete ? app.checks : pendingValidation(app);
    const compliance = app.authenIQ.complianceChecks.length ? app.authenIQ.complianceChecks : appCompliance(app).map(check => Object.assign({}, check, { result: "PENDING", explanation: "AuthenIQ compliance assessment has not run for this application.", action: "Run AuthenIQ Verification to assess this illustrative rule." }));
    const institutionCanEdit = state.role === "institution" && app.status === "correction" && app.owner === "institution";
    const processLabel = app.authenIQ.processingState === "RECEIVED" ? "PROCESSING QUEUED" : app.authenIQ.processingState;
    const processingAction = state.role === "admin"
      ? `<button class="button primary small" id="runAuthenIQ" ${runningAuthenIQIds.has(id) || ["approved", "correction", "rejected"].includes(app.status) ? "disabled" : ""}>${app.authenIQ.report ? "↻ Run AuthenIQ Again" : "Run AuthenIQ Verification"}</button>`
      : "";
    const processingMessage = app.authenIQ.report
      ? `Report generated ${formattedTime(app.authenIQ.processedAt)} · Compliance ${escapeHtml(app.authenIQ.complianceStatus || "PENDING")}`
      : state.role === "admin"
        ? "AuthenIQ has received this application. Run verification to process local preliminary checks."
        : "AuthenIQ has received this application. Preliminary processing is pending with the AICTE Admin Portal.";
    $("#modalContent").innerHTML = `<div class="modal-header"><div><h2 id="detailTitle">${escapeHtml(app.institutionName)}</h2><p>${escapeHtml(app.id)} · ${escapeHtml(app.applicationType)} · Updated ${formattedTime(app.updatedAt)}</p></div><div style="display:flex;align-items:center;gap:8px">${statusBadge(app.status)}<button class="close-button" id="closeDetail" aria-label="Close application details">×</button></div></div>
      <div class="modal-body"><div class="modal-main">
        <section class="modal-section"><h3>Institution information</h3><div class="detail-grid">${detailField("Application ID", app.id)}${detailField("Institution name", app.institutionName)}${detailField("Registered legal name", app.legalName)}${detailField("Application type", app.applicationType)}${detailField("Address", app.address)}${detailField("State / PIN", `${app.state || "—"} · ${app.pincode || "—"}`)}${detailField("Contact person", app.contactName)}${detailField("Email / phone", `${app.email || "—"} · ${app.phone || "—"}`)}${detailField("Established", formattedDate(app.establishedDate))}${detailField("Registration validity", formattedDate(app.expiryDate))}${detailField("Faculty count", app.facultyCount)}${detailField("Campus area", `${app.campusArea || "—"} acres`)}</div></section>
        <section class="modal-section"><div class="form-section-head"><div><h3 style="margin:0">AuthenIQ processing</h3><p style="margin:4px 0 0">Same application record · ${escapeHtml(app.id)}</p></div>${processingAction}</div><div class="autheniq-state"><span class="status review">RECEIVED</span><span class="status ${app.authenIQ.processingState === "COMPLETED" ? "approved" : app.authenIQ.processingState === "PROCESSING" ? "flag" : "not-run"}">${escapeHtml(processLabel)}</span><span class="status unverified">AUTHENTICITY: NOT VERIFIED</span></div><div id="authenIQProgress" class="autheniq-progress" role="status" aria-live="polite">${processingMessage}</div>${app.authenIQ.report ? `<button class="button secondary small" data-view-report="${escapeHtml(app.id)}">View AuthenIQ report →</button>` : ""}</section>
        <section class="modal-section"><h3>End-to-end workflow</h3>${workflowTimelineMarkup(app)}</section>
        <section class="modal-section"><h3>Document verification statuses</h3><p class="field-help">Upload recording, local text extraction, preliminary checks, PS status, and authenticity are separate. Extracted snippets stay in this browser; authenticity is not established.</p><div class="document-verification-list">${documentRowsMarkup(app, checks, validationComplete)}</div></section>
        <section class="modal-section"><div class="form-section-head"><div><h3 style="margin:0">Preliminary validation results</h3><p style="margin:4px 0 0">${validationComplete ? `Last run ${formattedTime(app.validationAt)} · local file and information checks only.` : "Run AuthenIQ Verification to execute these checks."}</p></div></div><div class="validation-summary">${validationSummaryMarkup(checks)}</div><div class="check-list">${checks.map(checkMarkup).join("")}</div></section>
        <section class="modal-section"><h3>PS 26261 verification status</h3><div class="ps-status-current"><span class="status ${psStatusClass(app.authenIQ.psStatus || derivePsStatus(app))}">${escapeHtml(app.authenIQ.psStatus || derivePsStatus(app))}</span><span class="field-help">Six-status workflow · status is separate from the application decision.</span></div><div class="ps-status-grid">${PS_VERIFICATION_STATUSES.map(status => `<div class="ps-status-option ${status === (app.authenIQ.psStatus || derivePsStatus(app)) ? "active" : ""}"><span class="status ${psStatusClass(status)}">${escapeHtml(status)}</span><small>${status === "Verified" ? "Only after authorised-source match" : status === "Mismatch Detected" ? "Conflicting evidence / source result" : status === "Expired" ? "Entered expiry date is in the past" : status === "Verification Pending" ? "Awaiting trusted verification" : status === "Source Unavailable" ? "Source did not respond" : "Uncertain / low-confidence evidence"}</small></div>`).join("")}</div><p class="field-help">The current prototype has no authorised live connector. Therefore, a simulated match remains <strong>Verification Pending</strong>; it can never set Verified.</p></section>
        <section class="modal-section"><h3>Authorised-source connector (demo simulation)</h3><div class="notice warning"><span class="notice-icon">⚠</span><div><strong>SIMULATED — NOT LIVE AUTHENTICATION.</strong> No AICTE, DigiLocker, or issuer system is contacted. Use this to demonstrate status routing only.</div></div><div class="mock-source-controls"><label for="mockSourceCategory" class="field-help">Document category</label><select id="mockSourceCategory">${REQUIRED_DOCS.map(doc => `<option value="${doc.key}" ${app.authenIQ.sourceVerification && app.authenIQ.sourceVerification.category === doc.key ? "selected" : ""}>${escapeHtml(doc.label)}</option>`).join("")}</select><label for="mockSourceOutcome" class="field-help">Mock connector response</label><select id="mockSourceOutcome"><option value="MATCH">Simulated match</option><option value="MISMATCH">Simulated mismatch</option><option value="UNAVAILABLE">Source unavailable</option><option value="INCONCLUSIVE">Inconclusive / manual review</option></select><button class="button secondary small" id="runMockSource">Run simulated check</button></div>${app.authenIQ.sourceVerification ? `<div class="mock-source-result"><strong>Last simulated result: ${escapeHtml(app.authenIQ.sourceVerification.outcome)}</strong><p>${escapeHtml(app.authenIQ.sourceVerification.message)}</p><small>${formattedTime(app.authenIQ.sourceVerification.checkedAt)} · ${escapeHtml(app.authenIQ.sourceVerification.sourceName || "Demo connector")}</small></div>` : `<p class="field-help">No source check has been simulated for this application yet.</p>`}</section>
        <section class="modal-section"><h3>Authenticity verification</h3><div class="authenticity-notice"><span class="status unverified">NOT VERIFIED</span><p>No trusted source or digital-signature verification mechanism is implemented. This status is not a finding that a document is fake. An authorized administrator must verify evidence through an approved trusted process.</p></div></section>
        <section class="modal-section"><h3>Illustrative compliance checks</h3><p class="field-help">Sample rules only. Confirm current official AICTE regulations before relying on any result.</p><div class="check-list">${compliance.length ? compliance.map(checkMarkup).join("") : `<div class="empty-state"><p>All sample rules are currently disabled.</p></div>`}</div><p class="field-help">Overall preliminary compliance: <strong>${escapeHtml(app.authenIQ.complianceStatus || "PENDING")}</strong></p></section>
        <section class="modal-section"><h3>Comments and feedback</h3><div id="commentList">${app.comments && app.comments.length ? app.comments.map(commentMarkup).join("") : `<p class="field-help">No comments recorded for this application.</p>`}</div>${state.role === "admin" ? `<form class="comment-form" id="commentForm"><textarea id="reviewComment" maxlength="1000" placeholder="Add review feedback for the institution…" required></textarea><button class="button secondary small" type="submit">Add comment</button></form>` : app.comments && app.comments.length ? `<p class="field-help">Feedback is shared from the administrator review.</p>` : ""}</section>
      </div>
      <aside class="modal-aside">
        ${state.role === "admin" ? `<section class="modal-section"><h3>Administrative decision</h3><div class="decision-area"><label class="field-help" for="decisionReason">Decision reason / feedback <span class="required">*</span></label><textarea id="decisionReason" maxlength="1000" placeholder="Enter a reason that will be shared with the institution…"></textarea><div class="decision-buttons"><button class="approve" data-decision="approved" ${!app.authenIQ.report || ["approved", "correction", "rejected"].includes(app.status) ? "disabled" : ""}>Approve</button><button class="correction" data-decision="correction" ${!app.authenIQ.report || ["approved", "correction", "rejected"].includes(app.status) ? "disabled" : ""}>Needs correction</button><button class="reject" data-decision="rejected" ${!app.authenIQ.report || ["approved", "correction", "rejected"].includes(app.status) ? "disabled" : ""}>Reject</button></div><small class="field-help">${app.authenIQ.report ? "Authority decision is separate from automated flags; review the evidence and report first." : "Run AuthenIQ and generate its report before recording a decision."}</small></div></section>` : institutionCanEdit ? `<section class="modal-section"><h3>Action required</h3><p class="field-help">The administrator requested corrections. Update details and resubmit to return the application to AuthenIQ processing.</p><button class="button primary small" id="editApplication">Update and resubmit</button></section>` : `<section class="modal-section"><h3>Application status</h3><p>${statusBadge(app.status)}</p><p class="field-help">${app.status === "correction" ? "Review administrator feedback and update the application to resubmit." : "Status changes are synchronized between the demo roles."}</p></section>`}
        <section class="modal-section"><h3>Status history</h3><div class="timeline">${app.history && app.history.length ? app.history.map(item => `<div class="timeline-item"><strong>${escapeHtml(STATUS_LABELS[item.status] || item.status)} · ${escapeHtml(item.actor || "System")}</strong><small>${formattedTime(item.at)}</small><small>${escapeHtml(item.reason || "")}</small></div>`).join("") : `<div class="empty-state"><p>No status history yet.</p></div>`}</div></section>
        <section class="modal-section"><h3>Review guidance</h3><p class="field-help">Preliminary checks support review only. Final decisions and evidence verification remain with authorized administrators following current official processes.</p></section>
      </aside></div>`;
    $("#detailBackdrop").hidden = false;
    $("#closeDetail").addEventListener("click", closeApplication);
    $("#detailBackdrop").onclick = event => {
      if (event.target === $("#detailBackdrop")) closeApplication();
    };
    const runBtn = $("#runAuthenIQ");
    if (runBtn) runBtn.addEventListener("click", () => runAuthenIQ(id));
    const mockButton = $("#runMockSource");
    if (mockButton) mockButton.addEventListener("click", () => runMockSourceVerification(id));
    const commentForm = $("#commentForm");
    if (commentForm) commentForm.addEventListener("submit", event => {
      event.preventDefault();
      const text = $("#reviewComment").value.trim();
      if (!text) { toast("Enter a comment before adding feedback.", "error"); return; }
      app.comments = app.comments || [];
      app.comments.unshift({ actor: currentActor(), text, at: nowIso() });
      app.updatedAt = nowIso();
      addAudit(id, "Review comment added", currentActor());
      persist();
      toast("Review feedback saved and shared with the institution portal.");
      openApplication(id);
    });
    const edit = $("#editApplication");
    if (edit) edit.addEventListener("click", () => {
      closeApplication();
      state.editId = id;
      navigate("create");
    });
    document.querySelectorAll("[data-decision]").forEach(button => button.addEventListener("click", () => recordDecision(id, button.dataset.decision)));
  }
  function detailField(label, value) {
    return `<div class="detail-field"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value || "—")}</strong></div>`;
  }
  function documentRowsMarkup(app, checks, validationComplete) {
    const docs = Array.isArray(app.documents) ? app.documents : [];
    return REQUIRED_DOCS.map(category => {
      const file = docs.find(doc => doc.category === category.key);
      const fileCheck = checks.find(check => check.category === category.key);
      const preliminaryStatus = validationComplete && fileCheck ? fileCheck.result : "PENDING";
      const psDocumentStatus = file ? deriveDocumentPsStatus(app, file) : "Manual Review Required";
      const uploadStatus = file ? "RECORDED" : "NOT RECORDED";
      const uploadClass = file ? "recorded" : "missing";
      const fileDetails = file
        ? `${escapeHtml(file.name)} · ${escapeHtml(file.type || "unknown type")} · ${((file.size || 0) / 1024).toFixed(0)} KB · recorded ${formattedDate(file.uploadedAt)}`
        : "No file selected or recorded for this required category.";
      const extractionNote = file && file.extractionStatus === "COMPLETED"
        ? `<p class="ocr-preview"><strong>Local text extraction:</strong> ${escapeHtml(file.extractionMethod || "Browser extraction")} · confidence ${Number.isFinite(Number(file.extractionConfidence)) ? `${Math.round(Number(file.extractionConfidence))}%` : "not available"}<span>${escapeHtml(String(file.extractedText || "").slice(0, 260))}${String(file.extractedText || "").length > 260 ? "…" : ""}</span></p>`
        : file ? `<p class="ocr-preview"><strong>Local text extraction:</strong> ${escapeHtml(file.extractionStatus || "NOT RUN")} · ${escapeHtml(file.extractionMessage || "No extracted text stored.")}</p>` : "";
      const preliminaryAction = validationComplete && fileCheck
        ? fileCheck.action
        : "Run AuthenIQ Verification after submitting the application.";
      const authenticityAction = file
        ? "No trusted verification mechanism is implemented. An authorized administrator should verify through an approved trusted process."
        : "Select and submit the required file first; authenticity will still require a trusted verification process.";
      return `<article class="document-verification-row"><div class="document-verification-heading"><div><strong>${escapeHtml(category.label)}</strong><small>${fileDetails}</small></div></div><div class="document-status-grid"><div><small>Upload status</small><span class="status ${uploadClass}">${uploadStatus}</span></div><div><small>Preliminary file check</small><span class="status ${resultClass(preliminaryStatus)}">${preliminaryStatus}</span></div><div><small>PS 26261 status</small><span class="status ${psStatusClass(psDocumentStatus)}">${escapeHtml(psDocumentStatus)}</span></div><div><small>Authenticity</small><span class="status unverified">NOT VERIFIED</span></div></div>${extractionNote}<p class="document-next-action"><strong>Next action:</strong> ${escapeHtml(file ? preliminaryAction : "Select and submit a file for this required category, then run validation.")}</p><p class="document-auth-action"><strong>Authenticity next action:</strong> ${escapeHtml(authenticityAction)}</p></article>`;
    }).join("");
  }
  
function workflowTimelineMarkup(app) {
  ensureWorkflow(app);

  const currentIndex = workflowStageIndex(app);
  const hasDecision = ["approved", "correction", "rejected"].includes(app.status);
  const reportGenerated = Boolean(app.workflow.timestamps.report_generated);
  const authorityReviewStarted = Boolean(app.workflow.timestamps.authority_review);

  return `<ol class="workflow-timeline">${WORKFLOW_STAGES.map((stage, index) => {
    const isFinalDecision = stage.id === "final_decision";
    const isReportGenerated = stage.id === "report_generated";
    const isAuthorityReview = stage.id === "authority_review";

    const current =
      !hasDecision &&
      index === currentIndex &&
      !isReportGenerated &&
      !isAuthorityReview;

    let complete = index < currentIndex;

    if (isReportGenerated) {
      complete = reportGenerated;
    }

    if (isAuthorityReview) {
      // Opening the report starts the review but does not complete it.
      complete = false;
    }

    if (isFinalDecision) {
      complete = hasDecision;
    }

    const event = app.workflow.events
      .filter(item => item.stage === stage.id)
      .slice(-1)[0];

    let label;

    if (isFinalDecision && hasDecision) {
      label = STATUS_LABELS[app.status];
    } else if (isReportGenerated && reportGenerated) {
      label = "COMPLETE";
    } else if (isAuthorityReview && authorityReviewStarted && !hasDecision) {
      label = "REVIEW STARTED";
    } else if (current) {
      label =
        stage.id === "document_validation" &&
        app.authenIQ.processingState === "PROCESSING"
          ? "PROCESSING"
          : "IN PROGRESS";
    } else if (complete) {
      label = "COMPLETE";
    } else {
      label = "PENDING";
    }

    const tone = isAuthorityReview && authorityReviewStarted && !hasDecision
      ? "current"
      : current
        ? "current"
        : complete
          ? "complete"
          : "upcoming";

    const marker = complete ? "✓" : index + 1;

    return `<li class="workflow-step ${tone}">
      <span class="workflow-step-marker">${marker}</span>
      <div>
        <strong>${escapeHtml(stage.label)}</strong>
        <span class="workflow-step-state">${escapeHtml(label)}</span>
        ${event ? `<small>${formattedTime(event.at)} · ${escapeHtml(event.note)}</small>` : ""}
      </div>
    </li>`;
  }).join("")}</ol>`;
}

  function renderVerificationReport() {
    const app = appById(state.currentApplicationId);
    if (!app || !app.authenIQ.report) {
      toast("No AuthenIQ report is available for this application yet.", "error");
      state.view = "applications";
      render();
      return;
    }
    const report = app.authenIQ.report;
    const summary = report.checks.filter(check => check.result === "PASS").length;
    main.innerHTML = `${pageHeader("AuthenIQ verification report", `${escapeHtml(report.applicationId)} · generated ${formattedTime(report.generatedAt)} · preliminary report`, `<button class="button secondary" data-open-app="${escapeHtml(app.id)}">← Back to application</button><button class="button secondary" id="printReport">Print / Save as PDF</button><button class="button primary" id="downloadReport">Download HTML</button>`)}
      <div class="notice warning"><span class="notice-icon">ⓘ</span><div><strong>Preliminary demonstration report.</strong> This report is generated from the same saved application. It is not an authoritative AICTE decision or document-authenticity result.</div></div>
      <article class="verification-report-page panel" id="verificationReport">${reportContentMarkup(report)}</article>`;
    $("#printReport").addEventListener("click", () => window.print());
    $("#downloadReport").addEventListener("click", () => downloadVerificationReport(report));
  }
  function reportContentMarkup(report) {
    const institution = report.institution || {};
    return `<div class="report-brand"><span class="brand-mark">AIQ</span><div><strong>AuthenIQ</strong><small>LOCAL PRELIMINARY VERIFICATION REPORT</small></div></div>
      <div class="report-title"><h2>Application Verification Report</h2><span class="report-id">${escapeHtml(report.applicationId)}</span></div>
      <p class="report-disclaimer"><strong>Preliminary assessment only.</strong> Browser-local OCR/text extraction may have been used where available. No official AICTE service, trusted authenticity source, digital-signature checker, or external database was used. Simulated source results are not live authentication.</p>
      <section class="report-section"><h3>Application details</h3><div class="detail-grid">${detailField("Application ID", report.applicationId)}${detailField("Institution", institution.name)}${detailField("Registered legal name", institution.legalName)}${detailField("Application type", institution.applicationType)}${detailField("Address", `${institution.address || "—"}, ${institution.state || "—"} ${institution.pincode || ""}`)}${detailField("Contact", `${institution.contactName || "—"} · ${institution.email || "—"}`)}${detailField("Submission timestamp", formattedTime(report.submissionAt))}${detailField("Report generated", formattedTime(report.generatedAt))}</div></section>
      <section class="report-section"><h3>Workflow status</h3><p>Overall preliminary assessment: <strong>${escapeHtml(report.complianceStatus)}</strong> · Decision status at report generation: <strong>${escapeHtml(STATUS_LABELS[report.statusAtGeneration] || report.statusAtGeneration || "Pending")}</strong> · Current decision: <strong>${escapeHtml(STATUS_LABELS[appById(report.applicationId).status] || appById(report.applicationId).status)}</strong></p>${workflowTimelineMarkup(appById(report.applicationId))}</section>
      <section class="report-section"><h3>Documents received and verification status</h3>${report.documents.length ? `<div class="table-wrap"><table><thead><tr><th>Category / file</th><th>Upload</th><th>Extraction</th><th>Preliminary validation</th><th>PS status</th><th>Authenticity</th></tr></thead><tbody>${report.documents.map(doc => `<tr><td>${escapeHtml(doc.category)}<span class="secondary-cell">${escapeHtml(doc.filename)} · ${escapeHtml(doc.type)} · ${(doc.size / 1024).toFixed(0)} KB</span></td><td>${escapeHtml(doc.uploadStatus)}</td><td>${escapeHtml(doc.extractionStatus || "NOT RUN")}<span class="secondary-cell">${escapeHtml(doc.extractionMethod || "No text extracted")}${doc.extractionConfidence != null ? ` · ${doc.extractionConfidence}% confidence` : ""}</span></td><td>${escapeHtml(doc.validationStatus)}</td><td>${escapeHtml(doc.psStatus || "Verification Pending")}</td><td>NOT VERIFIED</td></tr>`).join("")}</tbody></table></div>` : `<p>No file metadata was recorded.</p>`}<p class="field-help">Files are processed locally in this browser for text extraction when dependencies load. Extracted text snippets are saved in localStorage. No file is sent to a server; authenticity remains unverified.</p></section>
      <section class="report-section"><h3>PS 26261 verification status</h3><p>Current workflow status: <strong>${escapeHtml(report.psStatus || "Verification Pending")}</strong></p><p>${report.sourceVerification ? `<strong>Source response:</strong> SIMULATED — NOT LIVE AUTHENTICATION · ${escapeHtml(report.sourceVerification.outcome)} · ${escapeHtml(report.sourceVerification.message)}` : "No source response recorded. Await authorised-source verification or manual review."}</p><p class="field-help">Verified is reserved for a matching response from an authorised live source. The current prototype has no such connector.</p></section>
      <section class="report-section"><h3>Preliminary validation checks</h3>${report.checks.length ? `<div class="check-list">${report.checks.map(checkMarkup).join("")}</div>` : `<p>No preliminary checks were run.</p>`}</section>
      <section class="report-section"><h3>Illustrative compliance assessment</h3><p>Overall preliminary status: <strong>${escapeHtml(report.complianceStatus)}</strong>. Sample rules require confirmation against current official AICTE regulations.</p>${report.compliance.length ? `<div class="check-list">${report.compliance.map(checkMarkup).join("")}</div>` : `<p>No rules were enabled or assessed.</p>`}</section>
      <section class="report-section"><h3>Flagged issues and corrective actions</h3>${report.flaggedIssues.length ? `<div class="check-list">${report.flaggedIssues.map(checkMarkup).join("")}</div>` : `<p>No flags were raised by the enabled local checks. This is not a compliance determination.</p>`}</section>
      <section class="report-section"><h3>Checks not performed / authenticity</h3><p><strong>Document authenticity: NOT VERIFIED.</strong> Unverified does not mean fake. No trusted source or supported digital-signature mechanism is connected.</p><div class="check-list">${report.checksNotPerformed.map(item => `<div class="check-item"><span class="check-symbol unverified">?</span><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.reason)}</small></div></div>`).join("")}</div></section>
      <section class="report-section"><h3>Limitations</h3><ul>${report.limitations.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>
      <p class="report-footer">Generated locally by AuthenIQ · ${formattedTime(report.generatedAt)} · Application ${escapeHtml(report.applicationId)}</p>`;
  }
  function downloadVerificationReport(report) {
    try {
      const content = verificationReportHtml(report);
      const url = URL.createObjectURL(new Blob([content], { type: "text/html;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `autheniq-${report.applicationId}-report.html`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("AuthenIQ HTML report download started.");
    } catch (error) {
      console.error("Could not export the AuthenIQ report:", error);
      toast("The report could not be downloaded. Use Print / Save as PDF or try again.", "error", 6000);
    }
  }
  function verificationReportHtml(report) {
    const app = appById(report.applicationId);
    const reportContent = reportContentMarkup(report);
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AuthenIQ Report · ${escapeHtml(report.applicationId)}</title><style>body{max-width:980px;margin:32px auto;padding:0 20px;font:14px/1.5 Arial,sans-serif;color:#24364a}.report-brand{display:flex;align-items:center;gap:12px}.brand-mark{display:grid;place-items:center;width:42px;height:42px;border-radius:10px;background:#2365d1;color:white;font-weight:bold}.report-brand small{display:block;color:#718096;font-size:10px;letter-spacing:1px}.report-title{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #ddd;padding:16px 0}.report-disclaimer{padding:12px;background:#fff8e6;border:1px solid #ead8aa}.report-section{margin:22px 0;padding:14px;border:1px solid #e2e8ef;border-radius:8px;break-inside:avoid}.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.detail-field small,.secondary-cell{display:block;color:#718096;font-size:11px}.detail-field strong{display:block}.check-item{margin:10px 0}.check-item strong{display:block}.check-item small{color:#596a7d}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px;border-bottom:1px solid #e2e8ef;font-size:12px}.workflow-timeline{list-style:none;padding:0}.workflow-step{display:flex;gap:10px;padding:8px}.workflow-step-marker{min-width:24px}.workflow-step-state{margin-left:10px;color:#2365d1}.workflow-step small{display:block;color:#718096}.report-footer{border-top:1px solid #ddd;padding-top:12px;color:#718096;font-size:11px}@media print{body{margin:0}.report-section{break-inside:avoid}}</style></head><body>${reportContent}</body></html>`;
  }
  function validationSummaryMarkup(checks) {
    const counts = ["PASS", "FLAG", "PENDING"].map(result => {
      const count = checks.filter(check => check.result === result).length;
      return `<span class="status ${resultClass(result)}">${result}: ${count}</span>`;
    });
    return counts.join("");
  }
  function commentMarkup(comment) {
    return `<div class="comment-item"><strong>${escapeHtml(comment.actor)}</strong><small>${formattedTime(comment.at)}</small><p>${escapeHtml(comment.text)}</p></div>`;
  }
  function closeApplication() {
    $("#detailBackdrop").hidden = true;
    state.currentApplicationId = null;
  }
  function openReport(id) {
    const app = appById(id);
    if (!app || !app.authenIQ.report) {
      toast("The AuthenIQ report is not available until verification completes.", "error");
      return;
    }
    if (state.role === "admin" && !beginAuthorityReview(app)) return;
    state.currentApplicationId = id;
    $("#detailBackdrop").hidden = true;
    state.view = "verification-report";
    render();
  }
  function beginAuthorityReview(app) {
    if (!app.authenIQ.report || app.workflow.timestamps.authority_review || ["approved", "correction", "rejected"].includes(app.status)) return true;
    const previousWorkflow = JSON.parse(JSON.stringify(app.workflow));
    const previousAudit = store.audit.slice();
    addWorkflowEvent(app, "authority_review", "AICTE administrator opened the generated AuthenIQ report for authority review.");
    addAudit(app.id, "Authority review started", currentActor());
    if (persist()) return true;
    app.workflow = previousWorkflow;
    store.audit = previousAudit;
    return false;
  }
  function recordDecision(id, status) {
    const app = appById(id);
    if (state.role !== "admin") {
      toast("Only the AICTE Admin Portal can record authority decisions.", "error");
      return;
    }
    if (!app || !app.authenIQ.report) {
      toast("Run AuthenIQ Verification and generate the report before recording a decision.", "error");
      return;
    }
    if (["approved", "correction", "rejected"].includes(app.status)) {
      toast("This application already has a decision. A correction request must be resubmitted by the institution before another decision.", "error");
      return;
    }
    if (!["approved", "correction", "rejected"].includes(status)) {
      toast("That administrative decision is not available.", "error");
      return;
    }
    const reason = $("#decisionReason").value.trim();
    if (!reason) { toast("Enter a decision reason to share with the institution.", "error"); $("#decisionReason").focus(); return; }
    const label = STATUS_LABELS[status];
    if (!window.confirm(`Confirm ${label} for ${app.id}? This demo decision will be visible in the institution portal.`)) return;
    app.status = status;
    app.updatedAt = nowIso();
    addWorkflowEvent(app, "final_decision", `${STATUS_LABELS[status]} recorded by AICTE authority: ${reason}`);
    app.comments = app.comments || [];
    app.comments.unshift({ actor: currentActor(), text: `${label}: ${reason}`, at: nowIso() });
    app.history = app.history || [];
    app.history.unshift({ status, reason, actor: currentActor(), at: nowIso() });
    addAudit(id, `Application marked ${label}`, currentActor());
    if (!persist()) return;
    toast(`Decision recorded. ${label} is now visible in the institution portal.`);
    closeApplication();
    render();
  }
  function render() {
    $("#roleSelect").value = state.role;
    $("#userName").textContent = state.role === "admin" ? "AICTE Administrator" : "Technical Institution";
    $("#userRoleText").textContent = state.role === "admin" ? "AICTE Admin Portal · Demo" : "Institution Portal · Demo";
    $("#userAvatar").textContent = state.role === "admin" ? "AD" : "IN";
    $("#createNav").hidden = state.role === "admin";
    $("#createNav").textContent = "";
    if (state.role === "institution") $("#createNav").insertAdjacentHTML("beforeend", '<span class="nav-icon">＋</span>Create application');
    $("#applicationsNavLabel").textContent = state.role === "admin" ? "Applications" : "Application history";
    $("#navCount").textContent = String(state.role === "admin" ? store.apps.filter(isPendingReview).length : getCurrentApps().length);
    document.querySelector(".role-card .eyebrow").textContent = state.role === "admin" ? "AICTE ADMIN PORTAL" : "INSTITUTION PORTAL";
    document.querySelector(".role-card label").textContent = "Switch demo portal";
    document.querySelectorAll(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.nav === state.view));
    $("#complianceNav").hidden = state.role !== "admin";
    $("#testbenchNav").hidden = state.role !== "admin";
    $("#resetDemo").hidden = state.role !== "admin";
    $("#pageCrumb").textContent = ({ dashboard: "Dashboard", applications: state.role === "admin" ? "Applications" : "Application history", create: state.editId ? "Update application" : "New application", compliance: "Compliance rules", testbench: "PS test bench", reports: "Reports", audit: "Audit trail", "verification-report": "AuthenIQ report" })[state.view] || "Dashboard";
    if (state.view === "dashboard") renderDashboard();
    else if (state.view === "applications") renderApplications();
    else if (state.view === "create") formMarkup(state.editId ? appById(state.editId) : null);
    else if (state.view === "compliance") renderCompliance();
    else if (state.view === "testbench") renderTestBench();
    else if (state.view === "reports") renderReports();
    else if (state.view === "audit") renderAudit();
    else if (state.view === "verification-report") renderVerificationReport();
    $("#sidebar").classList.remove("open");
  }
  function navigate(view) {
    if (view === "create" && state.role !== "institution") {
      toast("Application creation is available only in the Institution Portal.", "error");
      return;
    }
    if ((view === "compliance" || view === "testbench") && state.role !== "admin") {
      toast("Compliance rules are managed in the AICTE Admin Portal.", "error");
      return;
    }
    if (view === "verification-report") {
      toast("Open a generated report from its application details.", "error");
      return;
    }
    if (view !== "create") state.editId = null;
    state.view = view;
    render();
    main.focus({ preventScroll: true });
  }
  function resetDemo() {
    if (state.role !== "admin") {
      toast("Demo data reset is available only in the AICTE Admin Portal.", "error");
      return;
    }
    if (!window.confirm("Reset all locally saved demo records, feedback, and audit events to fictional sample data?")) return;
    store = seedData();
    if (!persist()) return;
    state.editId = null;
    closeApplication();
    render();
    toast("Demo data reset to fictional sample records.");
  }

  document.addEventListener("click", event => {
    const report = event.target.closest("[data-view-report]");
    if (report) {
      openReport(report.dataset.viewReport);
      return;
    }
    const navigation = event.target.closest("[data-nav]");
    if (navigation) {
      event.preventDefault();
      navigate(navigation.dataset.nav);
      return;
    }
    const open = event.target.closest("[data-open-app]");
    if (open) openApplication(open.dataset.openApp);
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !$("#detailBackdrop").hidden) closeApplication();
    if ((event.key === "Enter" || event.key === " ") && event.target.matches("tr[data-open-app]")) {
      event.preventDefault();
      openApplication(event.target.dataset.openApp);
    }
  });
  $("#roleSelect").addEventListener("change", event => {
    state.role = event.target.value;
    state.editId = null;
    state.view = "dashboard";
    closeApplication();
    render();
    toast(`Switched to the ${state.role === "admin" ? "AICTE Admin Portal" : "Institution Portal"} demo.`);
  });
  $("#resetDemo").addEventListener("click", resetDemo);
  $("#mobileMenu").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  render();
})();

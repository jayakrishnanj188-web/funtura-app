// ====== CONFIG ======

const VAT_RATE = 0.05;

// localStorage keys
const STORAGE_KEY = "funturaRecords";
const LOGIN_KEY = "funturaLoggedUser";

// Google Apps Script Web App URL
const SHEET_WEBHOOK_URL =
  "https://script.google.com/macros/s/AKfycbxvelUN-SdoXd_pxSf5_z7m4Gdg7cdwcaiTtdlLRISBBUZzjl6XaJePiFUAdyBwIcknnQ/exec";

// simple users
const VALID_USERS = [
  { username: "Admin", password: "Intexuae@1327", role: "admin" },
  { username: "Annie@intex.com", password: "AnnieIntex01", role: "staff" },
  { username: "Aji@intex.com", password: "AjiIntex02", role: "staff" },
  { username: "Kausar@intex.com", password: "KausarIntex03", role: "staff" },
];

let currentUser = null; // {username, role}
let records = []; // main in-memory array of visits

// ====== DOM REFS ======

// login
const loginScreen = document.getElementById("login-screen");
const appContainer = document.getElementById("app");
const loginForm = document.getElementById("login-form");
const loginUserInput = document.getElementById("loginUser");
const loginPassInput = document.getElementById("loginPassword");
const togglePassword = document.getElementById("togglePassword");
const logoutBtn = document.getElementById("logoutBtn");

// payment form
const childNameInput = document.getElementById("childName");
const parentPhoneInput = document.getElementById("parentPhone");
const amountInput = document.getElementById("amount");
const currentDateTimeInput = document.getElementById("currentDateTime");
const timeInInput = document.getElementById("timeIn");
const timeOutInput = document.getElementById("timeOut");
const instructionInput = document.getElementById("instruction");
const printButton = document.getElementById("printButton");
// Missing elements from old code – now define them correctly
const kidsInsideScreen = document.getElementById("module-staff-live");
const reportScreen = document.getElementById("module-live");
const financialScreen = document.getElementById("module-finance");

// For overdue popup tracking
const alertedOverdueIds = new Set();

// staff live view
const staffInsideWrapper = document.getElementById("staffInside");
const staffInsideBody = document.getElementById("staffInsideBody");

// receipt
const receiptDiv = document.getElementById("receipt");

// admin tables
const adminInsideBody = document.getElementById("adminInsideBody");
const adminOverdueBody = document.getElementById("adminOverdueBody");
const financialReportBody = document.getElementById("financialReportBody");

// dashboard cards + modules
const cardPayment = document.getElementById("card-payment");
const cardStaffLive = document.getElementById("card-staff-live");
const cardLive = document.getElementById("card-live");
const cardFinance = document.getElementById("card-finance");

const modulePayment = document.getElementById("module-payment");
const moduleStaffLive = document.getElementById("module-staff-live");
const moduleLive = document.getElementById("module-live");
const moduleFinance = document.getElementById("module-finance");

// stats
const kidsInsideEl = document.getElementById("kidsInsideCount");
const kidsOverdueEl = document.getElementById("kidsOverdueCount");

// simple banner alert
const alertBox = document.getElementById("alertBox");

// ====== DASHBOARD MODULE HANDLING ======

function showModule(name) {
  const allModules = [
    modulePayment,
    moduleStaffLive,
    moduleLive,
    moduleFinance,
  ];
  allModules.forEach((m) => {
    if (m) m.style.display = "none";
  });

  if (name === "payment" && modulePayment)
    modulePayment.style.display = "block";
  if (name === "staff-live" && moduleStaffLive)
    moduleStaffLive.style.display = "block";
  if (name === "live" && moduleLive) moduleLive.style.display = "block";
  if (name === "finance" && moduleFinance)
    moduleFinance.style.display = "block";
}

if (cardPayment)
  cardPayment.addEventListener("click", () => showModule("payment"));
if (cardStaffLive)
  cardStaffLive.addEventListener("click", () => showModule("staff-live"));
if (cardLive) cardLive.addEventListener("click", () => showModule("live"));
if (cardFinance)
  cardFinance.addEventListener("click", () => showModule("finance"));

// ====== HELPERS ======

let alertTimeout;

function showAlert(message) {
  // If we are still on the login screen (app hidden), use a simple popup
  if (appContainer && appContainer.style.display === "none") {
    alert(message);
    return;
  }

  // Fallback if alertBox doesn't exist
  if (!alertBox) {
    alert(message);
    return;
  }

  // In-app banner message
  alertBox.textContent = message;
  alertBox.style.display = "block";
  clearTimeout(alertTimeout);
  alertTimeout = setTimeout(() => {
    alertBox.style.display = "none";
  }, 3000);
}

function loadRecordsFromLocal() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    records = [];
    return;
  }
  try {
    records = JSON.parse(raw);
    normalizeRecords();
  } catch (e) {
    console.error("Failed to parse saved records:", e);
    records = [];
  }
}

function saveRecords() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function normalizeRecords() {
  records.forEach((r) => {
    if (typeof r.id === "undefined") {
      r.id = r.invoiceNo || Date.now() + Math.random();
    }
    if (typeof r.isClosed === "undefined") r.isClosed = false;

    // 🔹 FIX: ensure dateISO is always a valid ISO string
    let d = r.dateISO ? new Date(r.dateISO) : null;
    if (!d || isNaN(d.getTime())) {
      // try fallbacks from Sheet (if they exist)
      const rawDate = r.date || r.Date || null;
      if (rawDate) {
        const tryD = new Date(rawDate);
        if (!isNaN(tryD.getTime())) {
          d = tryD;
        }
      }
    }
    if (!d || isNaN(d.getTime())) {
      // final fallback – use "today" so UI never shows "Invalid Date"
      d = new Date();
    }
    r.dateISO = d.toISOString();
  });
}

function findRecordIndexById(id) {
  const target = String(id);
  return records.findIndex((r) => String(r.id) === target);
}

function generateInvoiceNo() {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");

  const key = "invoiceCounter:" + `${y}${m}${d}`;
  let n = parseInt(localStorage.getItem(key) || "0", 10);
  n += 1;
  localStorage.setItem(key, String(n).padStart(3, "0"));
  const seq = String(n).padStart(3, "0");

  return `FUN${seq}/${y}`;
}

function timeToMinutes(t) {
  if (!t) return null;
  const parts = t.split(":");
  if (parts.length < 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

function diffTimeHuman(timeIn, timeOut) {
  const minIn = timeToMinutes(timeIn);
  const minOut = timeToMinutes(timeOut);
  if (minIn == null || minOut == null || minOut <= minIn) return "";
  const diff = minOut - minIn;
  const hours = Math.floor(diff / 60);
  const mins = diff % 60;

  if (hours > 0 && mins === 0) {
    return `Playing for ${hours} hr${hours > 1 ? "s" : ""}`;
  } else if (hours > 0 && mins > 0) {
    return `Playing for ${hours} hr ${mins} min`;
  } else {
    return `Playing for ${mins} min`;
  }
}

function isValidChildName(name) {
  return /^[A-Za-z .'-]{2,}$/.test(name.trim());
}

function isValidPhone(phone) {
  const trimmed = phone.replace(/\s+/g, "");
  if (!/^\d{10}$/.test(trimmed)) return false;
  if (!trimmed.startsWith("05")) return false;
  return true;
}

// works with either "HH:MM" or full ISO from Sheet
function isTimeOver(rec, now = new Date()) {
  if (!rec.timeOut) return false;

  const baseISO = rec.dateISO || new Date().toISOString();
  const dateStr = baseISO.split("T")[0];

  let end;

  if (/^\d{1,2}:\d{2}$/.test(rec.timeOut)) {
    end = new Date(`${dateStr}T${rec.timeOut}:00`);
  } else {
    end = new Date(rec.timeOut);
  }

  if (isNaN(end.getTime())) return false;

  return end <= now;
}

function computeStatusCounts() {
  const now = new Date();
  let inside = 0;
  let overdue = 0;

  records.forEach((r) => {
    if (!r.timeIn || !r.timeOut || r.isClosed) return;
    if (isTimeOver(r, now)) overdue++;
    else inside++;
  });

  return { inside, overdue };
}

function updateStats() {
  if (!kidsInsideEl || !kidsOverdueEl) return;
  const { inside, overdue } = computeStatusCounts();
  kidsInsideEl.textContent = inside;
  kidsOverdueEl.textContent = overdue;
}

function countActiveKids() {
  const now = new Date();
  return records.filter(
    (r) => r.timeIn && r.timeOut && !r.isClosed && !isTimeOver(r, now)
  ).length;
}

function checkCapacityBeforeAdd() {
  const active = countActiveKids();
  if (active >= 30) {
    alert(
      "Maximum capacity reached (30 kids inside). Please clear kids before adding more."
    );
    return false;
  }
  return true;
}

function refreshTimeIn() {
  const now = new Date();
  const time = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  if (timeInInput) timeInInput.value = time;
}

function updateCurrentDateTime() {
  const now = new Date();
  if (currentDateTimeInput) {
    const formatted = now.toLocaleString("en-GB", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    currentDateTimeInput.value = formatted;
  }
}

// ====== GOOGLE SHEETS SYNC ======
// Convert Sheet time (e.g. "1899-12-30T06:23:48.000Z") or "HH:MM:SS" to "HH:MM"
function parseSheetTime(value) {
  if (!value) return "";

  // If it looks like an ISO datetime, try to parse
  const d = new Date(value);
  if (!isNaN(d.getTime())) {
    return d.toTimeString().slice(0, 5); // "HH:MM"
  }

  // If it's already something like "HH:MM" or "HH:MM:SS"
  const m = String(value).match(/^(\d{1,2}:\d{2})/);
  if (m) return m[1];

  // Fallback – just return the raw value
  return value;
}

async function loadRecordsFromSheet() {
  try {
    const res = await fetch(`${SHEET_WEBHOOK_URL}?action=list`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const sheetRecs = data.records || data;

    // 🔹 1) Load any existing local records to preserve cleared/removal info
    let localMap = new Map();
    try {
      const localRaw = localStorage.getItem(STORAGE_KEY);
      if (localRaw) {
        const localArr = JSON.parse(localRaw);
        localArr.forEach((r) => {
          if (r.invoiceNo) {
            localMap.set(String(r.invoiceNo), r);
          }
        });
      }
    } catch (e) {
      console.error("Failed to read local records for merge:", e);
    }

    // 🔹 2) Build records from Sheet, but keep local isClosed/clearedAt when present
    records = sheetRecs.map((r) => {
      const key = String(r.invoiceNo || "");
      const local = localMap.get(key);

      let rec = {
        id: r.invoiceNo || Date.now() + Math.random(),
        dateISO: r.dateISO,
        timeSaved: r.time || "",
        childName: r.childName,
        parentPhone: r.parentPhone,
        timeIn: parseSheetTime(r.timeIn),
        timeOut: parseSheetTime(r.timeOut),
        instruction: r.instruction || "",
        netAmount: Number(r.netAmount || 0),
        vatAmount: Number(r.vatAmount || 0),
        totalAmount: Number(r.totalAmount || 0),
        invoiceNo: r.invoiceNo,
        trnNo: r.trnNo || "",
        staffUser: r.staffUser || "",
        isClosed: r.isClosed === true || r.isClosed === "TRUE",
        clearedAt: r.clearedAt || null,
      };

      // 🔹 If locally this record was already cleared, KEEP it cleared
      if (local && local.isClosed) {
        rec.isClosed = true;
        rec.clearedAt =
          local.clearedAt || rec.clearedAt || new Date().toISOString();
      }

      return rec;
    });

    normalizeRecords();
    saveRecords();
    renderReports();
    updateStats();
  } catch (err) {
    console.error("Failed to load records from Sheet:", err);
    loadRecordsFromLocal();
    renderReports();
    updateStats();
  }
}

function sendToSheet(record) {
  if (!SHEET_WEBHOOK_URL || SHEET_WEBHOOK_URL === "YOUR_WEB_APP_URL_HERE")
    return;

  const payload = {
    action: "create",
    date: new Date(record.dateISO).toLocaleDateString("en-GB"),
    time: record.timeSaved,
    invoiceNo: record.invoiceNo,
    trnNo: record.trnNo,
    childName: record.childName,
    parentPhone: record.parentPhone,
    timeIn: record.timeIn,
    timeOut: record.timeOut,
    instruction: record.instruction,
    netAmount: record.netAmount,
    vatAmount: record.vatAmount,
    totalAmount: record.totalAmount,
    staffUser: record.staffUser,
    isClosed: record.isClosed ? true : false,
    clearedAt: record.clearedAt || "",
  };

  fetch(SHEET_WEBHOOK_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch((err) => console.error("Failed to send to Sheet:", err));
}

function updateSheetRecord(record) {
  if (!SHEET_WEBHOOK_URL || SHEET_WEBHOOK_URL === "YOUR_WEB_APP_URL_HERE")
    return;

  const payload = {
    action: "update",
    invoiceNo: record.invoiceNo,
    trnNo: record.trnNo,
    childName: record.childName,
    parentPhone: record.parentPhone,
    timeIn: record.timeIn,
    timeOut: record.timeOut,
    instruction: record.instruction,
    netAmount: record.netAmount,
    vatAmount: record.vatAmount,
    totalAmount: record.totalAmount,
    staffUser: record.staffUser,
    // NEW: sync cleared status to sheet (not delete)
    isClosed: record.isClosed ? true : false,
    clearedAt: record.clearedAt || "",
  };

  fetch(SHEET_WEBHOOK_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch((err) => console.error("Failed to update Sheet:", err));
}

function deleteSheetRecord(record) {
  if (!SHEET_WEBHOOK_URL || SHEET_WEBHOOK_URL === "YOUR_WEB_APP_URL_HERE")
    return;

  const payload = {
    action: "delete",
    invoiceNo: record.invoiceNo,
  };

  fetch(SHEET_WEBHOOK_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch((err) => console.error("Failed to delete from Sheet:", err));
}

// ====== RENDERING ======

function renderReports() {
  if (staffInsideBody) staffInsideBody.innerHTML = "";
  if (adminInsideBody) adminInsideBody.innerHTML = "";
  if (adminOverdueBody) adminOverdueBody.innerHTML = "";
  if (financialReportBody) financialReportBody.innerHTML = "";

  const now = new Date();

  records.forEach((rec) => {
    const cleared = rec.isClosed === true;
    const timeOver = isTimeOver(rec, now);
    const active = !cleared && !timeOver;

    // STAFF: Kids currently inside
    if (!cleared && staffInsideBody) {
      const statusText = timeOver ? "Time over" : "Inside";
      const trStaff = document.createElement("tr");
      trStaff.innerHTML = `
          <td>${rec.childName}</td>
          <td>${rec.timeIn || ""}</td>
          <td>${rec.timeOut || ""}</td>
          <td>${statusText}</td>
          <td>
            <button class="btn-staff-remove" data-id="${rec.id}">Remove</button>
          </td>
        `;
      staffInsideBody.appendChild(trStaff);
    }

    // ADMIN: Kids currently inside (not time over, not cleared)
    if (active && adminInsideBody) {
      const trIn = document.createElement("tr");
      trIn.innerHTML = `
          <td>${rec.childName}</td>
          <td>${rec.timeIn}</td>
          <td>${rec.timeOut || ""}</td>
          <td>${rec.parentPhone}</td>
          <td>${rec.staffUser || ""}</td>
        `;
      adminInsideBody.appendChild(trIn);
    }

    // ADMIN: Kids time over / cleared history
    if ((timeOver || cleared) && adminOverdueBody) {
      const visitDate = new Date(rec.dateISO).toLocaleDateString();

      let statusText;
      if (cleared) {
        statusText = "Removed";
      } else if (timeOver) {
        statusText = "Time over (not cleared)";
      } else {
        statusText = "";
      }

      const trOver = document.createElement("tr");
      trOver.innerHTML = `
          <td>${visitDate}</td>
          <td>${rec.childName}</td>
          <td>${rec.timeIn}</td>
          <td>${rec.timeOut || ""}</td>
          <td>${rec.parentPhone}</td>
          <td>${rec.staffUser || ""}</td>
          <td>${statusText}</td>
        `;
      adminOverdueBody.appendChild(trOver);
    }

    // ADMIN: Financial report
    if (financialReportBody) {
      const trFin = document.createElement("tr");
      trFin.innerHTML = `
          <td>${rec.childName}</td>
          <td>${rec.parentPhone}</td>
          <td>${rec.timeIn}</td>
          <td>${rec.timeOut || ""}</td>
          <td>${rec.netAmount.toFixed(2)}</td>
          <td>${rec.totalAmount.toFixed(2)}</td>
          <td>${rec.staffUser || ""}</td>
          <td>
            <button class="btn-edit" data-id="${rec.id}">Edit</button>
            <button class="btn-delete" data-id="${rec.id}">Delete</button>
          </td>
        `;
      financialReportBody.appendChild(trFin);
    }
  });

  updateStats();
}

// ====== LOGIN / LOGOUT ======

function handleLogin(e) {
  e.preventDefault();

  if (!loginUserInput || !loginPassInput) {
    console.error("Login inputs not found in DOM");
    alert("Technical error: login form is not correctly loaded.");
    return;
  }

  const username = loginUserInput.value.trim();
  const password = loginPassInput.value;

  const user = VALID_USERS.find(
    (u) => u.username === username && u.password === password
  );
  if (!user) {
    showAlert("Invalid username or password.");
    return;
  }

  currentUser = { username: user.username, role: user.role };
  localStorage.setItem(LOGIN_KEY, JSON.stringify(currentUser));

  // show app container
  if (loginScreen) loginScreen.style.display = "none";
  if (appContainer) appContainer.style.display = "block";

  // always show Payment first so you never end up with an “empty” module area
  showModule("payment");

  // then apply role-specific visibility (staff vs admin)
  applyRoleUI(currentUser.role);

  // finally, kick off sheet sync (async, errors go to console but won’t break the UI)
  loadRecordsFromSheet().catch((err) => {
    console.error("Error loading from sheet:", err);
  });
}

function handleLogout() {
  currentUser = null;
  localStorage.removeItem(LOGIN_KEY);

  if (appContainer) appContainer.style.display = "none";
  if (loginScreen) loginScreen.style.display = "block";

  if (loginForm) loginForm.reset();
}

function applyRoleUI(role) {
  if (role === "staff") {
    if (cardPayment) cardPayment.style.display = "block";
    if (cardStaffLive) cardStaffLive.style.display = "block";
    if (cardLive) cardLive.style.display = "none";
    if (cardFinance) cardFinance.style.display = "none";
    showModule("payment");
  } else if (role === "admin") {
    if (cardPayment) cardPayment.style.display = "none";
    if (cardStaffLive) cardStaffLive.style.display = "none";
    if (cardLive) cardLive.style.display = "block";
    if (cardFinance) cardFinance.style.display = "block";
    showModule("live");
  }
}

// ====== FORM HANDLING (CREATE TICKET) ======

function handleFormSubmit(e) {
  e.preventDefault();

  if (!checkCapacityBeforeAdd()) return;

  const childName = childNameInput.value.trim();
  const parentPhone = parentPhoneInput.value.trim();
  const amount = parseFloat(amountInput.value);
  const timeOut = timeOutInput.value;
  const instruction = instructionInput.value.trim();

  if (!childName || !parentPhone || isNaN(amount) || !timeOut) {
    showAlert("Please fill all required fields.");
    return;
  }

  if (!isValidChildName(childName)) {
    showAlert("Please enter a valid child's name (letters and spaces only).");
    childNameInput.focus();
    return;
  }

  if (!isValidPhone(parentPhone)) {
    showAlert(
      "Enter a valid UAE mobile number (must start with 05 and be 10 digits)."
    );
    parentPhoneInput.focus();
    return;
  }

  const now = new Date();
  const dateISO = now.toISOString();
  const timeSaved = now.toLocaleTimeString();
  const timeIn = now.toTimeString().slice(0, 5);

  if (timeInInput) timeInInput.value = timeIn;

  const minIn = timeToMinutes(timeIn);
  const minOut = timeToMinutes(timeOut);
  if (minIn === null || minOut === null || minOut <= minIn) {
    showAlert("Time Out must be greater than Time In.");
    return;
  }

  const invoiceNo = generateInvoiceNo();
  const trnNo = "--";

  const totalAmount = +amount.toFixed(2);
  const netAmount = +(totalAmount / (1 + VAT_RATE)).toFixed(2);
  const vatAmount = +(totalAmount - netAmount).toFixed(2);

  const record = {
    id: Date.now(),
    dateISO,
    timeSaved,
    childName,
    parentPhone,
    timeIn,
    timeOut,
    instruction,
    netAmount,
    vatAmount,
    totalAmount,
    invoiceNo,
    trnNo,
    staffUser: currentUser ? currentUser.username : "",
    isClosed: false,
    clearedAt: null,
  };

  records.push(record);
  saveRecords();
  renderReports();
  sendToSheet(record);

  // const durationText = diffTimeHuman(timeIn, timeOut);
  // const receiptHtml = `
  //   <h3>Funtura</h3>
  //   <p>Games S.P.S L.L.C</p>
  //   <p>Date: ${new Date(dateISO).toLocaleDateString()}</p>
  //   <p>Time: ${timeSaved}</p>
  //   <p>Invoice: ${invoiceNo}</p>
  //   <p>TRN: ${trnNo}</p>
  //   <hr/>
  //   <p>Child: ${childName}</p>
  //   <p>Phone: ${parentPhone}</p>
  //   <p>Time In: ${timeIn}</p>
  //   <p>Time Out: ${timeOut}</p>
  //   <p>${durationText}</p>
  //   <p>Instruction: ${instruction || "-"}</p>
  //   <hr/>
  //   <p>Net Amount: AED ${netAmount.toFixed(2)}</p>
  //   <p>VAT (5%): AED ${vatAmount.toFixed(2)}</p>
  //   <p>Total: AED ${totalAmount.toFixed(2)}</p>
  //   <p>Staff: ${record.staffUser}</p>
  //   <p>Thank you visit again!</p>
  // `;const durationText = diffTimeHuman(timeIn, timeOut);
  const durationText = diffTimeHuman(timeIn, timeOut);
  const receiptHtml = `
  <div class="ticket">
    
    <div class="t-center t-title">Funtura</div>
    <div class="t-center t-subtitle">Games S.P.S L.L.C</div>

    <div class="t-row">
      <div class="t-col-left">
        <div><strong>Date:</strong> ${new Date(
          dateISO
        ).toLocaleDateString()}</div>
        <div><strong>Time:</strong> ${timeSaved}</div>
        <div><strong>Staff:</strong> ${record.staffUser}</div>
      </div>
      <div class="t-col-right">
        <div><strong>Tax Invoice:</strong> ${invoiceNo}</div>
        <div><strong>TRN:</strong> ${trnNo}</div>
      </div>
    </div>

    <div class="t-block">
      <div><strong>Child:</strong> ${childName}</div>
      <div><strong>Phone:</strong> ${parentPhone}</div>
      <div><strong>Time In:</strong> ${timeIn}  <strong>Out:</strong> ${timeOut}</div>
      <div><strong>Description:</strong> ${durationText}</div>
      <div><strong>Instruction:</strong> ${instruction || "-"}</div>
    </div>

    <table class="t-table">
      <thead>
        <tr>
          <th>Item</th>
          <th>AED</th>
          <th>Vat(5%)</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Playing for ${durationText}</td>
          <td>${netAmount.toFixed(2)}</td>
          <td>${vatAmount.toFixed(2)}</td>
          <td>${totalAmount.toFixed(2)}</td>
        </tr>
      </tbody>
    </table>

    <div class="t-center t-footer">Thank you visit again!</div>

  </div>
`;
  //const durationText = diffTimeHuman(timeIn, timeOut);
  if (receiptDiv) receiptDiv.innerHTML = receiptHtml;
  window.print();

  // always reset the payment form safely
  if (paymentForm) {
    paymentForm.reset();
  }

  refreshTimeIn();
}

// ====== ADMIN: EDIT / DELETE IN FINANCIAL REPORT ======

function editRecord(id) {
  const idx = findRecordIndexById(id);
  if (idx === -1) return;
  const rec = records[idx];

  const newChild = prompt("Child Name:", rec.childName);
  if (newChild !== null && newChild.trim() !== "") rec.childName = newChild;

  const newPhone = prompt("Parent Phone:", rec.parentPhone);
  if (newPhone !== null && newPhone.trim() !== "")
    rec.parentPhone = newPhone.trim();

  const newTimeIn = prompt("Time In (HH:MM):", rec.timeIn);
  if (newTimeIn !== null && newTimeIn.trim() !== "")
    rec.timeIn = newTimeIn.trim();

  const newTimeOut = prompt("Time Out (HH:MM):", rec.timeOut);
  if (newTimeOut !== null && newTimeOut.trim() !== "")
    rec.timeOut = newTimeOut.trim();

  const newAmountStr = prompt("Amount incl. VAT:", rec.totalAmount.toFixed(2));
  if (newAmountStr !== null && newAmountStr.trim() !== "") {
    const newAmount = parseFloat(newAmountStr);
    if (!isNaN(newAmount)) {
      rec.totalAmount = +newAmount.toFixed(2);
      rec.netAmount = +(rec.totalAmount / (1 + VAT_RATE)).toFixed(2);
      rec.vatAmount = +(rec.totalAmount - rec.netAmount).toFixed(2);
    }
  }

  saveRecords();
  renderReports();
  updateSheetRecord(rec);
  showAlert("Record updated & synced to Google Sheet.");
}

function deleteRecord(id) {
  const idx = findRecordIndexById(id);
  if (idx === -1) return;
  const rec = records[idx];

  const ok = confirm(
    "Delete this record? It will also be removed from Google Sheet."
  );
  if (!ok) return;

  deleteSheetRecord(rec);
  records.splice(idx, 1);
  saveRecords();
  renderReports();
  showAlert("Record deleted locally & from Google Sheet (requested).");
}

// ====== STAFF REMOVE BUTTON + OVERDUE REMINDER ======

// STAFF Remove → mark cleared + UPDATE sheet (no delete)
if (staffInsideBody) {
  staffInsideBody.addEventListener("click", (e) => {
    const btn = e.target;
    if (!btn.classList.contains("btn-staff-remove")) return;

    const id = btn.dataset.id;
    const idx = findRecordIndexById(id);
    if (idx === -1) return;

    const rec = records[idx];
    const ok = confirm(`Are you sure you want to clear ${rec.childName}?`);
    if (!ok) return;

    rec.isClosed = true;
    rec.clearedAt = new Date().toISOString();

    saveRecords();
    renderReports();
    // IMPORTANT: call update, not delete
    updateSheetRecord(rec);
  });
}

// Popup should only bother STAFF, not Admin
// function overdueReminderTick() {
//   if (!currentUser || currentUser.role !== "staff") return;

//   const now = new Date();
//   const overdueKids = records.filter(
//     (r) => !r.isClosed && r.timeOut && isTimeOver(r, now)
//   );
//   if (overdueKids.length > 0) {
//     const names = overdueKids.map((r) => r.childName).join(", ");
//     alert(
//       `Time is over for: ${names}.\nPlease open "Kids Inside" and click Remove to clear them.`
//     );
//   }
// }

// setInterval(overdueReminderTick, 60 * 1000);
// ===== REAL-TIME OVERDUE POPUP (STAFF ONLY) =====

// runs every 10 seconds, alerts only for newly-overdue kids
function overdueReminderTick() {
  // Only staff get this popup, not admin
  if (!currentUser || currentUser.role !== "staff") return;

  const now = new Date();

  const newlyOverdue = records.filter((r) => {
    if (!r.timeOut || r.isClosed) return false;
    if (!isTimeOver(r, now)) return false;

    // already alerted in this session?
    return !alertedOverdueIds.has(String(r.id));
  });

  if (newlyOverdue.length === 0) return;

  const names = newlyOverdue.map((r) => r.childName).join(", ");

  alert(
    `Time is over for: ${names}.\n` +
      `Please open "Kids Inside" and click Remove to clear them.`
  );

  // remember we've alerted for these, so we don't spam again
  newlyOverdue.forEach((r) => alertedOverdueIds.add(String(r.id)));
}

// check every 10 seconds
setInterval(overdueReminderTick, 10 * 1000);

// ====== EVENT LISTENERS & INIT ======

if (loginForm) {
  loginForm.addEventListener("submit", handleLogin);
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", handleLogout);
}

if (togglePassword && loginPassInput) {
  togglePassword.addEventListener("click", () => {
    const type =
      loginPassInput.getAttribute("type") === "password" ? "text" : "password";
    loginPassInput.setAttribute("type", type);
  });
}

// if (printButton) {
//   printButton.addEventListener("click", handleFormSubmit);
// }

const paymentForm = document.getElementById("payment-form");
if (paymentForm) {
  paymentForm.addEventListener("submit", handleFormSubmit);
}

if (financialReportBody) {
  financialReportBody.addEventListener("click", (event) => {
    const target = event.target;
    if (target.classList.contains("btn-edit")) {
      const id = target.dataset.id;
      editRecord(id);
    } else if (target.classList.contains("btn-delete")) {
      const id = target.dataset.id;
      deleteRecord(id);
    }
  });
}

setInterval(() => {
  updateCurrentDateTime();
  refreshTimeIn();
}, 60 * 1000);
updateCurrentDateTime();
refreshTimeIn();
updateStats();
loadRecordsFromLocal();
renderReports();

// ===== AUTO REFRESH EVERY 10 SECONDS =====
setInterval(() => {
  try {
    console.log("Auto-refresh triggered");

    if (!currentUser) return;

    if (kidsInsideScreen.style.display !== "none") {
      renderReports();
    }

    if (reportScreen.style.display !== "none") {
      renderReports();
    }

    if (financialScreen.style.display !== "none") {
      renderReports();
    }
  } catch (e) {
    console.error("Auto-refresh error:", e);
  }
}, 10000);

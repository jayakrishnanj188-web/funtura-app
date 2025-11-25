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

let currentUser = null;
let records = [];

// ====== DOM REFS ======

// login
const loginScreen = document.getElementById("login-screen");
const loginForm = document.getElementById("login-form");
const loginUserInput = document.getElementById("loginUser");
const loginPassInput = document.getElementById("loginPassword");
const togglePassword = document.getElementById("togglePassword");

// main app
const appContainer = document.getElementById("app");
const logoutBtn = document.getElementById("logoutBtn");

// in-app alert
const alertBox = document.getElementById("alertBox");

// payment form
const form = document.getElementById("payment-form");
const childNameInput = document.getElementById("childName");
const parentPhoneInput = document.getElementById("parentPhone");
const amountInput = document.getElementById("amount");
const currentDateTime = document.getElementById("currentDateTime");
const timeInInput = document.getElementById("timeIn");
const timeOutInput = document.getElementById("timeOut");
const instructionInput = document.getElementById("instruction");

// staff stats & list
const staffStatsRow = document.getElementById("staff-stats");
const kidsInsideEl = document.getElementById("kidsInsideCount");
const kidsOverdueEl = document.getElementById("kidsOverdueCount");
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

// ====== DASHBOARD MODULE HANDLING ======

function showModule(name) {
  const allModules = [
    modulePayment,
    moduleStaffLive,
    moduleLive,
    moduleFinance,
  ];
  const allCards = [cardPayment, cardStaffLive, cardLive, cardFinance];

  allModules.forEach((m) => {
    if (!m) return;
    m.style.display = m.dataset.module === name ? "block" : "none";
  });

  allCards.forEach((c) => {
    if (!c) return;
    c.classList.toggle("active", c.dataset.target === name);
  });

  // 🔥 IMPORTANT: update Time In every time Payment is opened
  if (name === "payment") {
    updateCurrentDateTime();
    refreshTimeIn();
  }
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
  alertBox.textContent = message;
  alertBox.style.display = "block";
  clearTimeout(alertTimeout);
  alertTimeout = setTimeout(() => {
    alertBox.style.display = "none";
  }, 3000);
}

// main loader now delegates to Google Sheet (with fallback)
async function loadRecords() {
  // primary source is Google Sheet; falls back to localStorage on error
  await loadRecordsFromSheet();
}

function saveRecords() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function normalizeRecords() {
  records.forEach((r) => {
    if (typeof r.isClosed === "undefined") r.isClosed = false;
  });
}

function findRecordIndexById(id) {
  return records.findIndex((r) => r.id === id);
}

function generateInvoiceNo() {
  const STORAGE_KEY = "INVOICE_COUNTER";

  const now = new Date();
  const year2 = now.getFullYear().toString().slice(-2); // "25" for 2025

  // read previous counter
  let counter;
  try {
    counter = JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch (e) {
    counter = null;
  }

  let nextSeq;

  if (!counter || counter.year !== year2) {
    // new year OR nothing stored yet → start from 1
    nextSeq = 1;
  } else {
    // same year → increment
    nextSeq = (counter.seq || 0) + 1;
  }

  // save back to localStorage
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ year: year2, seq: nextSeq })
  );

  // 4-digit padded sequence
  const paddedSeq = String(nextSeq).padStart(4, "0");

  // final format: FUN0001/25
  return `FUN${paddedSeq}/${year2}`;
}

function updateCurrentDateTime() {
  const now = new Date();
  if (currentDateTime) currentDateTime.value = now.toLocaleString();
}

function refreshTimeIn() {
  if (!timeInInput) return;
  const now = new Date();
  // HH:MM in 24h format
  timeInInput.value = now.toTimeString().slice(0, 5);
}

function timeToMinutes(t) {
  if (!t || typeof t !== "string") return null;
  const [h, m] = t.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

//time calculation

function formatPlayItem(timeIn, timeOut) {
  const minIn = timeToMinutes(timeIn);
  const minOut = timeToMinutes(timeOut);

  if (minIn == null || minOut == null || minOut <= minIn) {
    return "Playing";
  }

  const diff = minOut - minIn; // minutes
  const hours = Math.floor(diff / 60);
  const mins = diff % 60;

  if (hours > 0 && mins === 0) {
    // exact hours
    return `Playing for ${hours} hr${hours > 1 ? "s" : ""}`;
  } else if (hours > 0 && mins > 0) {
    return `Playing for ${hours} hr ${mins} min`;
  } else {
    return `Playing for ${mins} min`;
  }
}

function isValidChildName(name) {
  // letters, spaces and basic punctuation like .-' allowed, at least 2 characters
  const trimmed = name.trim();
  if (trimmed.length < 2) return false;
  const re = /^[A-Za-z\s.'-]+$/;
  return re.test(trimmed);
}

function isValidPhone(phone) {
  const trimmed = phone.trim();

  // must not be empty
  if (!trimmed) return false;

  // must be digits only
  if (!/^\d+$/.test(trimmed)) return false;

  // must be exactly 10 digits
  if (trimmed.length !== 10) return false;

  // must start with "05"
  if (!trimmed.startsWith("05")) return false;

  return true;
}

function isTimeOver(rec, now = new Date()) {
  if (!rec.timeOut) return false;
  const baseISO = rec.dateISO || new Date().toISOString();
  const dateStr = baseISO.split("T")[0];
  const end = new Date(dateStr + "T" + rec.timeOut + ":00");
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
  return records.filter((r) => !r.isClosed).length;
}

function checkCapacityBeforeAdd() {
  const active = countActiveKids();
  if (active >= 25) {
    showAlert(
      "Maximum capacity reached (25 kids). Please wait before adding new entry."
    );
    return false;
  }
  return true;
}

// ====== SHEET HELPERS ======

function sendToSheet(record) {
  if (!SHEET_WEBHOOK_URL || SHEET_WEBHOOK_URL === "YOUR_WEB_APP_URL_HERE") {
    console.warn(
      "SHEET_WEBHOOK_URL not configured. Skipping Google Sheet logging."
    );
    return;
  }

  const payload = {
    action: "create",
    dateISO: record.dateISO,
    date: new Date(record.dateISO).toLocaleDateString(),
    time: record.timeSaved || "",
    invoiceNo: record.invoiceNo,
    trnNo: record.trnNo,
    childName: record.childName,
    parentPhone: record.parentPhone,
    timeIn: record.timeIn,
    timeOut: record.timeOut,
    instruction: record.instruction || "",
    netAmount: record.netAmount,
    vatAmount: record.vatAmount,
    totalAmount: record.totalAmount,
    staffUser: record.staffUser || "",
  };

  fetch(SHEET_WEBHOOK_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch((err) => console.error("Failed to send to Google Sheet:", err));
}

function updateSheetRecord(record) {
  if (!SHEET_WEBHOOK_URL || SHEET_WEBHOOK_URL === "YOUR_WEB_APP_URL_HERE")
    return;

  const payload = {
    action: "update",
    invoiceNo: record.invoiceNo,
    trnNo: record.trnNo || "",
    childName: record.childName,
    parentPhone: record.parentPhone,
    timeIn: record.timeIn,
    timeOut: record.timeOut,
    instruction: record.instruction || "",
    netAmount: record.netAmount,
    vatAmount: record.vatAmount,
    totalAmount: record.totalAmount,
    staffUser: record.staffUser || "",
  };

  fetch(SHEET_WEBHOOK_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch((err) => console.error("Failed to UPDATE Google Sheet:", err));
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
  }).catch((err) => console.error("Failed to DELETE from Google Sheet:", err));
}

// ====== RENDERING ======

function renderReports() {
  if (staffInsideBody) staffInsideBody.innerHTML = "";
  if (adminInsideBody) adminInsideBody.innerHTML = "";
  if (adminOverdueBody) adminOverdueBody.innerHTML = "";
  financialReportBody.innerHTML = "";

  const now = new Date();

  records
    .slice()
    .sort((a, b) => new Date(a.dateISO) - new Date(b.dateISO))
    .forEach((rec) => {
      const cleared = !!rec.isClosed; // staff cleared / kid left
      const timeOver = isTimeOver(rec, now); // based on Time Out vs now
      const active = !cleared && !timeOver; // still inside, not time over

      // ---------- STAFF: Kids currently inside ----------
      // show ONLY records that are not cleared
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

      // ---------- ADMIN: Report on Screen ----------
      // 1) Kids currently inside (not cleared, not time over)
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

      // 2) Kids time over / cleared history
      // show every record whose time is over, whether cleared or not
      if (timeOver && adminOverdueBody) {
        const visitDate = new Date(rec.dateISO).toLocaleDateString();
        const statusText = cleared ? "Removed" : "Time over (not cleared)";

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

      // ---------- FINANCIAL REPORT ----------
      // always include every record (cleared or not)
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
    });

  updateStats();
}

// ====== LOGIN / ROLE UI ======

function applyRoleUI(role) {
  // hide everything
  if (cardPayment) cardPayment.style.display = "none";
  if (cardStaffLive) cardStaffLive.style.display = "none";
  if (cardLive) cardLive.style.display = "none";
  if (cardFinance) cardFinance.style.display = "none";

  if (modulePayment) modulePayment.style.display = "none";
  if (moduleStaffLive) moduleStaffLive.style.display = "none";
  if (moduleLive) moduleLive.style.display = "none";
  if (moduleFinance) moduleFinance.style.display = "none";

  if (staffStatsRow) staffStatsRow.style.display = "none";
  if (staffInsideWrapper) staffInsideWrapper.style.display = "none";

  if (role === "admin") {
    if (cardLive) cardLive.style.display = "block";
    if (cardFinance) cardFinance.style.display = "block";
    showModule("live");
  } else if (role === "staff") {
    if (cardPayment) cardPayment.style.display = "block";
    if (cardStaffLive) cardStaffLive.style.display = "block";
    if (modulePayment) modulePayment.style.display = "block";
    if (staffStatsRow) staffStatsRow.style.display = "grid";
    if (staffInsideWrapper) staffInsideWrapper.style.display = "block";
    showModule("payment");
  }

  updateStats();
}

function findUser(username, password) {
  return VALID_USERS.find(
    (u) => u.username === username && u.password === password
  );
}

async function handleLogin(event) {
  event.preventDefault();
  const username = loginUserInput.value.trim();
  const password = loginPassInput.value.trim();

  const user = findUser(username, password);
  if (!user) {
    alert("Invalid credentials. Please try again.");
    return;
  }

  currentUser = { username: user.username, role: user.role };
  localStorage.setItem(LOGIN_KEY, JSON.stringify(currentUser));

  loginScreen.style.display = "none";
  appContainer.style.display = "block";

  await loadRecords();
  applyRoleUI(currentUser.role);
  renderReports();
}

function handleLogout() {
  currentUser = null;
  localStorage.removeItem(LOGIN_KEY);
  appContainer.style.display = "none";
  loginScreen.style.display = "block";
  loginForm.reset();
}

async function checkAutoLogin() {
  const raw = localStorage.getItem(LOGIN_KEY);
  if (!raw) return;
  try {
    const user = JSON.parse(raw);
    if (!user || !user.username || !user.role) return;
    currentUser = user;
    loginScreen.style.display = "none";
    appContainer.style.display = "block";

    // this now loads from Google Sheet
    await loadRecords();
    applyRoleUI(currentUser.role);
    renderReports();
  } catch (err) {
    console.error("Failed to parse login user:", err);
  }
}

// ====== PAYMENT / PRINT ======

function printReceipt(record) {
  // helper so we never crash if an element is missing
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value != null && value !== "" ? value : "";
  };

  const dateObj = record.dateISO ? new Date(record.dateISO) : new Date();

  // top meta
  setText("receiptDate", dateObj.toLocaleDateString());
  setText("receiptTime", record.timeSaved || dateObj.toLocaleTimeString());
  setText("invoiceNo", record.invoiceNo || "");
  setText("receiptStaff", currentUser ? currentUser.username : "");

  // child / phone / times
  setText("receiptChild", record.childName || "");
  setText("receiptPhone", record.parentPhone || "");
  setText("receiptTimeIn", record.timeIn || "");
  setText("receiptTimeOut", record.timeOut || "");

  // description & instruction
  const descText = record.childName
    ? `Playing for ${record.childName}`
    : "Playing";
  setText("description", descText);
  setText("receiptInstruction", record.instruction || "-");

  // amounts (net, VAT, total)
  const net = Number(record.netAmount || 0);
  const vat = Number(record.vatAmount || 0);
  const tot = Number(record.totalAmount || 0);

  setText("receiptAmount", net.toFixed(2)); // AED column
  setText("receiptVat", vat.toFixed(2)); // Vat column
  setText("receiptTotal", tot.toFixed(2)); // Total column

  // item text row (Playing for X hr/min)
  let itemText = "Playing";
  if (typeof formatPlayItem === "function") {
    itemText = formatPlayItem(record.timeIn, record.timeOut);
  }
  setText("receiptItem", itemText);

  // make sure the receipt is visible before printing
  receiptDiv.style.display = "block";
}

//Add a loader from Google Sheet

// Load records from Google Sheet instead of only from localStorage
async function loadRecordsFromSheet() {
  try {
    const res = await fetch(SHEET_WEBHOOK_URL + "?action=list");
    const data = await res.json();

    // data is { records: [...] }
    const sheetRecs = data.records || data;

    records = sheetRecs.map((r) => {
      return {
        // use invoiceNo as a stable id if there is no separate "id" column
        id: r.invoiceNo || Date.now() + Math.random(),

        dateISO: r.dateISO,
        timeSaved: r.time || "",
        childName: r.childName,
        parentPhone: r.parentPhone,
        timeIn: r.timeIn,
        timeOut: r.timeOut,
        instruction: r.instruction || "",
        netAmount: Number(r.netAmount || 0),
        vatAmount: Number(r.vatAmount || 0),
        totalAmount: Number(r.totalAmount || 0),
        invoiceNo: r.invoiceNo,
        trnNo: r.trnNo || "",
        staffUser: r.staffUser || "",
        // if you later add isClosed / clearedAt columns, map them here too
        isClosed: r.isClosed === true || r.isClosed === "TRUE",
        clearedAt: r.clearedAt || null,
      };
    });

    normalizeRecords(); // keep your helper
    saveRecords(); // optional cache
    renderReports();
    updateStats();
  } catch (err) {
    console.error("Failed to load records from Sheet:", err);
    // fallback to localStorage if fetch fails
    loadRecordsFromLocal();
  }
}

// old local loader, renamed
function loadRecordsFromLocal() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    records = [];
    return;
  }
  try {
    records = JSON.parse(raw);
    normalizeRecords();
  } catch (err) {
    console.error("Failed to parse records from localStorage:", err);
    records = [];
  }
}

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
  if (!childName || !parentPhone || isNaN(amount) || !timeOut) {
    showAlert("Please fill all required fields.");
    return;
  }

  // extra validation: child name & phone format
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
  const trnNo = "UAE-TRN12345";

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
  };

  records.push(record);
  saveRecords();
  renderReports();
  sendToSheet(record);

  printReceipt(record);
  setTimeout(() => window.print(), 200);

  updateCurrentDateTime();
  refreshTimeIn();
  checkAutoLogin();
  updateStats();
}

// ====== ADMIN EDIT / DELETE ======

function editRecord(id) {
  const idx = findRecordIndexById(id);
  if (idx === -1) return;
  const rec = records[idx];

  const newChild = prompt("Child Name:", rec.childName);
  if (newChild !== null && newChild.trim() !== "")
    rec.childName = newChild.trim();

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

if (staffInsideBody) {
  staffInsideBody.addEventListener("click", (e) => {
    const btn = e.target;
    if (!btn.classList.contains("btn-staff-remove")) return;

    const id = Number(btn.dataset.id);
    const idx = findRecordIndexById(id);
    if (idx === -1) return;

    const rec = records[idx];
    const ok = confirm(`Are you sure you want to clear ${rec.childName}?`);
    if (!ok) return;

    // ✅ Do NOT delete the record – just mark it as cleared
    rec.isClosed = true;

    // (optional) remember when it was cleared – useful later
    rec.clearedAt = new Date().toISOString();

    saveRecords();
    renderReports();
  });
}

function overdueReminderTick() {
  if (!currentUser || currentUser.role !== "staff") return;

  const now = new Date();
  const overdueKids = records.filter((r) => !r.isClosed && isTimeOver(r, now));

  if (overdueKids.length > 0) {
    const names = overdueKids.map((r) => r.childName).join(", ");
    alert(
      `Time is over for: ${names}.\nPlease open "Kids Inside" and click Remove to clear them.`
    );
  }
}

setInterval(overdueReminderTick, 60 * 1000);

// ====== EVENT LISTENERS & INIT ======

loginForm.addEventListener("submit", handleLogin);
logoutBtn.addEventListener("click", handleLogout);

togglePassword.addEventListener("click", () => {
  const type =
    loginPassInput.getAttribute("type") === "password" ? "text" : "password";
  loginPassInput.setAttribute("type", type);
});

form.addEventListener("submit", handleFormSubmit);

financialReportBody.addEventListener("click", (event) => {
  const target = event.target;
  if (target.classList.contains("btn-edit")) {
    const id = Number(target.dataset.id);
    editRecord(id);
  } else if (target.classList.contains("btn-delete")) {
    const id = Number(target.dataset.id);
    deleteRecord(id);
  }
});

setInterval(updateCurrentDateTime, 60 * 1000);

updateCurrentDateTime();
updateCurrentDateTime();
refreshTimeIn();
checkAutoLogin();
updateStats();

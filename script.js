"use strict";

/**
 * Sunday Cleaning — site config.
 * Update business details, services and the booking integration here.
 */
const CONFIG = {
  businessName: "Sunday Cleaning",
  serviceArea: "Toronto",
  // Set this to a real endpoint (e.g. your Formspree/API URL) to send real
  // booking requests. Left null, the site runs in a fully functional demo
  // mode and clearly labels submissions as not sent. See README.md.
  bookingEndpoint: null,
  maxPhotos: 6,
  maxPhotoSizeMB: 8,
};

const SERVICE_LABELS = {
  standard: "Standard Clean",
  deep: "Deep Clean",
  move: "Move In / Move Out",
  recurring: "Recurring Care",
};

const HOME_SIZE_LABELS = {
  studio: "Studio / 1 bedroom",
  "2bed": "2 bedroom",
  "3bed": "3 bedroom",
  "4plus": "4+ bedroom",
};

const prefersReducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)"
).matches;

document.addEventListener("DOMContentLoaded", init);

function init() {
  initHeaderScroll();
  initMobileNav();
  initServiceRows();
  initCalendar();
  initPostalCheck();
  initPhotoUpload();
  initBookingForm();
  setSelectedService(bookingState.service, {});

  document.querySelector('[data-role="copyright"]').textContent =
    "© " + new Date().getFullYear() + " " + CONFIG.businessName + ". All rights reserved.";
}

/* ==========================================================================
   Header
   ========================================================================== */

function initHeaderScroll() {
  const header = document.getElementById("siteHeader");
  const onScroll = () => {
    header.classList.toggle("is-scrolled", window.scrollY > 4);
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
}

function initMobileNav() {
  const toggle = document.getElementById("navToggle");
  const nav = document.getElementById("mobileNav");

  const closeNav = () => {
    nav.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
  };
  const openNav = () => {
    nav.classList.add("is-open");
    toggle.setAttribute("aria-expanded", "true");
    const firstLink = nav.querySelector("a");
    if (firstLink) firstLink.focus();
  };

  toggle.addEventListener("click", () => {
    const isOpen = nav.classList.contains("is-open");
    if (isOpen) {
      closeNav();
      toggle.focus();
    } else {
      openNav();
    }
  });

  nav.addEventListener("click", (e) => {
    if (e.target.tagName === "A") closeNav();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && nav.classList.contains("is-open")) {
      closeNav();
      toggle.focus();
    }
  });
}

/* ==========================================================================
   Services section — expandable rows
   ========================================================================== */

function initServiceRows() {
  const rows = document.querySelectorAll("[data-service-row]");

  rows.forEach((row) => {
    row.addEventListener("click", () => {
      const targetId = row.getAttribute("aria-controls");
      const detail = document.getElementById(targetId);
      const isOpen = row.getAttribute("aria-expanded") === "true";

      rows.forEach((r) => {
        if (r !== row) {
          r.setAttribute("aria-expanded", "false");
          r.classList.remove("is-active");
          document.getElementById(r.getAttribute("aria-controls")).classList.remove("is-open");
        }
      });

      row.setAttribute("aria-expanded", String(!isOpen));
      row.classList.toggle("is-active", !isOpen);
      detail.classList.toggle("is-open", !isOpen);
    });
  });

  document.querySelectorAll("[data-choose-service]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const service = btn.getAttribute("data-choose-service");
      setSelectedService(service, { fromHeroSelect: false });
      const panel = document.getElementById("heroBookingPanel");
      panel.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "center",
      });
      const heroSelect = document.querySelector('[data-role="service-select"]');
      if (heroSelect) heroSelect.focus();
    });
  });
}

/* ==========================================================================
   Shared booking state + sync across hero, services list and form
   ========================================================================== */

const bookingState = {
  service: "standard",
  date: null, // Date object, time-stripped
};

function setSelectedService(service, opts) {
  opts = opts || {};
  bookingState.service = service;

  const heroSelect = document.querySelector('[data-role="service-select"]');
  if (heroSelect && heroSelect.value !== service) heroSelect.value = service;

  const formRadio = document.querySelector(
    '[data-role="form-service"][value="' + service + '"]'
  );
  if (formRadio && !formRadio.checked) formRadio.checked = true;

  updateCalendarSelectionSummary();
  updateSummaryPanel();
}

/* ==========================================================================
   Calendar
   ========================================================================== */

let viewDate = startOfMonth(new Date());
let focusedISO = null;

function initCalendar() {
  const heroSelect = document.querySelector('[data-role="service-select"]');
  heroSelect.addEventListener("change", () => {
    setSelectedService(heroSelect.value, { fromHeroSelect: true });
  });

  document.querySelector("[data-cal-prev]").addEventListener("click", () => {
    changeMonth(-1);
  });
  document.querySelector("[data-cal-next]").addEventListener("click", () => {
    changeMonth(1);
  });

  const grid = document.querySelector("[data-cal-grid]");
  grid.addEventListener("keydown", handleGridKeydown);

  document
    .querySelector('[data-role="continue-booking"]')
    .addEventListener("click", handleContinueBooking);

  document
    .querySelectorAll('[data-role="form-service"]')
    .forEach((radio) => {
      radio.addEventListener("change", () => {
        if (radio.checked) setSelectedService(radio.value, { fromHeroSelect: false });
      });
    });

  const preferredDateInput = document.getElementById("preferredDate");
  preferredDateInput.addEventListener("change", () => {
    if (!preferredDateInput.value) return;
    const parsed = parseISODate(preferredDateInput.value);
    const today = startOfDay(new Date());
    if (!parsed || parsed < today) return;
    bookingState.date = parsed;
    viewDate = startOfMonth(parsed);
    renderCalendar();
    updateCalendarSelectionSummary();
    updateSummaryPanel();
  });

  renderCalendar();
}

function changeMonth(delta) {
  const earliest = startOfMonth(new Date());
  const next = new Date(viewDate.getFullYear(), viewDate.getMonth() + delta, 1);
  viewDate = next < earliest ? earliest : next;
  renderCalendar();
}

function renderCalendar() {
  const label = document.querySelector("[data-cal-label]");
  const grid = document.querySelector("[data-cal-grid]");
  const prevBtn = document.querySelector("[data-cal-prev]");

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  label.textContent = viewDate.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const today = startOfDay(new Date());
  const earliestMonth = startOfMonth(today);
  prevBtn.disabled = viewDate.getTime() <= earliestMonth.getTime();

  grid.innerHTML = "";

  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const candidateISO = getFocusCandidateISO(year, month, today);
  const cells = [];

  for (let i = 0; i < firstWeekday; i++) {
    const empty = document.createElement("span");
    empty.className = "cal-cell-empty";
    empty.setAttribute("aria-hidden", "true");
    cells.push(empty);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const cellDate = new Date(year, month, d);
    const iso = isoOf(cellDate);
    const isPast = cellDate < today;
    const isToday = isoOf(today) === iso;
    const isSelected = bookingState.date && isoOf(bookingState.date) === iso;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cal-day";
    btn.textContent = String(d);
    btn.dataset.date = iso;
    btn.setAttribute("role", "gridcell");
    btn.setAttribute(
      "aria-label",
      cellDate.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    );

    if (isToday) {
      btn.classList.add("is-today");
      btn.setAttribute("aria-current", "date");
    }
    if (isSelected) {
      btn.classList.add("is-selected");
      btn.setAttribute("aria-selected", "true");
    } else {
      btn.setAttribute("aria-selected", "false");
    }
    if (isPast) {
      btn.classList.add("is-disabled");
      btn.setAttribute("aria-disabled", "true");
    }

    btn.tabIndex = iso === candidateISO ? 0 : -1;

    btn.addEventListener("click", () => {
      if (isPast) return;
      selectDate(cellDate);
    });

    cells.push(btn);
  }

  for (let i = 0; i < cells.length; i += 7) {
    const row = document.createElement("div");
    row.className = "cal-row";
    row.setAttribute("role", "row");
    cells.slice(i, i + 7).forEach((cell) => row.appendChild(cell));
    grid.appendChild(row);
  }
}

function getFocusCandidateISO(year, month, today) {
  if (focusedISO) {
    const f = parseISODate(focusedISO);
    if (f.getFullYear() === year && f.getMonth() === month) return focusedISO;
  }
  if (bookingState.date) {
    const s = bookingState.date;
    if (s.getFullYear() === year && s.getMonth() === month) return isoOf(s);
  }
  if (today.getFullYear() === year && today.getMonth() === month) {
    return isoOf(today);
  }
  return isoOf(new Date(year, month, 1));
}

function selectDate(date) {
  bookingState.date = startOfDay(date);
  focusedISO = isoOf(bookingState.date);
  renderCalendar();
  updateCalendarSelectionSummary();
  updateSummaryPanel();
  syncPreferredDateInput();
  hideHeroError();
  focusCellForISO(focusedISO);
}

function syncPreferredDateInput() {
  const input = document.getElementById("preferredDate");
  if (bookingState.date) input.value = isoOf(bookingState.date);
}

function updateCalendarSelectionSummary() {
  const el = document.querySelector('[data-role="selection-summary"]');
  if (!bookingState.date) {
    el.innerHTML = "Select a date to continue.";
    return;
  }
  const label = bookingState.date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const service = SERVICE_LABELS[bookingState.service] || bookingState.service;
  el.innerHTML =
    "You selected <strong>" + label + "</strong> for a " + service + ".";
}

function handleGridKeydown(e) {
  const active = document.activeElement;
  if (!active || !active.classList.contains("cal-day")) return;

  let date = parseISODate(active.dataset.date);
  let handled = true;

  switch (e.key) {
    case "ArrowRight":
      date.setDate(date.getDate() + 1);
      break;
    case "ArrowLeft":
      date.setDate(date.getDate() - 1);
      break;
    case "ArrowDown":
      date.setDate(date.getDate() + 7);
      break;
    case "ArrowUp":
      date.setDate(date.getDate() - 7);
      break;
    case "Home":
      date.setDate(date.getDate() - date.getDay());
      break;
    case "End":
      date.setDate(date.getDate() + (6 - date.getDay()));
      break;
    case "PageUp":
      date = new Date(date.getFullYear(), date.getMonth() - 1, date.getDate());
      break;
    case "PageDown":
      date = new Date(date.getFullYear(), date.getMonth() + 1, date.getDate());
      break;
    case "Enter":
    case " ":
      e.preventDefault();
      if (!active.classList.contains("is-disabled")) selectDate(date);
      return;
    default:
      handled = false;
  }

  if (!handled) return;
  e.preventDefault();

  const earliest = startOfDay(new Date());
  if (date < earliest) date = earliest;

  focusedISO = isoOf(date);
  const needsRerender =
    date.getMonth() !== viewDate.getMonth() ||
    date.getFullYear() !== viewDate.getFullYear();

  if (needsRerender) {
    viewDate = startOfMonth(date);
    renderCalendar();
  }
  focusCellForISO(focusedISO);
}

function focusCellForISO(iso) {
  requestAnimationFrame(() => {
    const el = document.querySelector('[data-cal-grid] [data-date="' + iso + '"]');
    if (el) el.focus();
  });
}

function handleContinueBooking() {
  if (!bookingState.date) {
    showHeroError();
    focusCellForISO(focusedISO || isoOf(startOfDay(new Date())));
    return;
  }
  hideHeroError();
  syncPreferredDateInput();
  updateSummaryPanel();

  const bookingSection = document.getElementById("booking");
  bookingSection.scrollIntoView({
    behavior: prefersReducedMotion ? "auto" : "smooth",
    block: "start",
  });

  window.setTimeout(() => {
    const nameField = document.getElementById("fullName");
    if (nameField) nameField.focus();
  }, prefersReducedMotion ? 0 : 500);
}

function showHeroError() {
  document.querySelector('[data-role="hero-error"]').classList.add("is-visible");
}
function hideHeroError() {
  document.querySelector('[data-role="hero-error"]').classList.remove("is-visible");
}

/* ---- date helpers -------------------------------------------------- */

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function isoOf(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}
function parseISODate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/* ==========================================================================
   Service area — postal quick check
   ========================================================================== */

function initPostalCheck() {
  const form = document.querySelector('[data-role="postal-check"]');
  const result = document.querySelector('[data-role="postal-result"]');
  const input = document.getElementById("postalQuickCheck");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = input.value.trim();
    if (!value) {
      result.textContent = "Enter a postal code to check.";
      result.classList.remove("is-in");
      return;
    }
    const firstLetter = value.charAt(0).toUpperCase();
    if (firstLetter === "M") {
      result.textContent =
        "That looks like a Toronto postal code. We'll confirm full coverage when we review your request.";
      result.classList.add("is-in");
    } else {
      result.textContent =
        "We primarily serve Toronto (postal codes starting with M). Add your postal code to a booking request and we'll confirm coverage.";
      result.classList.remove("is-in");
    }

    const formPostal = document.getElementById("postalCode");
    if (formPostal) {
      formPostal.value = value;
      updateSummaryPanel();
    }
  });
}

/* ==========================================================================
   Booking form — photo upload
   ========================================================================== */

let selectedPhotos = [];

function initPhotoUpload() {
  const input = document.getElementById("photoInput");
  const previews = document.querySelector('[data-role="photo-previews"]');
  const upload = document.querySelector(".photo-upload");

  let errorEl = document.createElement("p");
  errorEl.className = "photo-upload__error";
  errorEl.setAttribute("role", "alert");
  upload.appendChild(errorEl);

  input.addEventListener("change", () => {
    const files = Array.from(input.files || []);
    errorEl.textContent = "";

    for (const file of files) {
      if (selectedPhotos.length >= CONFIG.maxPhotos) {
        errorEl.textContent =
          "You can attach up to " + CONFIG.maxPhotos + " photos.";
        break;
      }
      if (!file.type.startsWith("image/")) {
        errorEl.textContent = file.name + " isn't an image file and was skipped.";
        continue;
      }
      if (file.size > CONFIG.maxPhotoSizeMB * 1024 * 1024) {
        errorEl.textContent =
          file.name + " is larger than " + CONFIG.maxPhotoSizeMB + "MB and was skipped.";
        continue;
      }
      selectedPhotos.push({
        file,
        url: URL.createObjectURL(file),
        id: Date.now() + "-" + Math.random().toString(36).slice(2),
      });
    }

    input.value = "";
    renderPhotoPreviews();
  });

  function renderPhotoPreviews() {
    previews.innerHTML = "";
    selectedPhotos.forEach((photo, index) => {
      const wrap = document.createElement("div");
      wrap.className = "photo-preview";

      const img = document.createElement("img");
      img.src = photo.url;
      img.alt = "Selected photo " + (index + 1);
      wrap.appendChild(img);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.textContent = "×";
      removeBtn.setAttribute("aria-label", "Remove photo " + (index + 1));
      removeBtn.addEventListener("click", () => {
        URL.revokeObjectURL(photo.url);
        selectedPhotos = selectedPhotos.filter((p) => p.id !== photo.id);
        renderPhotoPreviews();
      });
      wrap.appendChild(removeBtn);

      previews.appendChild(wrap);
    });
  }
}

/* ==========================================================================
   Booking form — validation, summary, submission
   ========================================================================== */

function initBookingForm() {
  const form = document.getElementById("bookingForm");
  const fieldsToWatch = [
    "homeSize",
    "preferredDate",
    "fullName",
    "email",
    "phone",
    "postalCode",
  ];
  fieldsToWatch.forEach((id) => {
    const el = document.getElementById(id);
    el.addEventListener("input", updateSummaryPanel);
    el.addEventListener("change", updateSummaryPanel);
  });
  document.querySelectorAll('input[name="timeWindow"]').forEach((el) => {
    el.addEventListener("change", updateSummaryPanel);
  });

  form.addEventListener("submit", handleBookingSubmit);

  document
    .querySelector('[data-role="edit-booking"]')
    .addEventListener("click", () => {
      document.querySelector('[data-role="booking-complete"]').classList.remove("is-visible");
      form.style.display = "";
      document.getElementById("fullName").focus();
    });

  updateSummaryPanel();
}

function updateSummaryPanel() {
  const serviceEl = document.querySelector('[data-summary="service"]');
  const homeSizeEl = document.querySelector('[data-summary="homeSize"]');
  const dateEl = document.querySelector('[data-summary="date"]');
  const timeEl = document.querySelector('[data-summary="time"]');
  const postalEl = document.querySelector('[data-summary="postal"]');

  const checkedService = document.querySelector('[data-role="form-service"]:checked');
  serviceEl.textContent = checkedService
    ? SERVICE_LABELS[checkedService.value]
    : "Not selected";

  const homeSize = document.getElementById("homeSize").value;
  homeSizeEl.textContent = homeSize ? HOME_SIZE_LABELS[homeSize] : "Not selected";

  const dateValue = document.getElementById("preferredDate").value;
  if (dateValue) {
    dateEl.textContent = parseISODate(dateValue).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } else {
    dateEl.textContent = "Not selected";
  }

  const checkedTime = document.querySelector('input[name="timeWindow"]:checked');
  timeEl.textContent = checkedTime
    ? checkedTime.value.charAt(0).toUpperCase() + checkedTime.value.slice(1)
    : "Not selected";

  const postal = document.getElementById("postalCode").value.trim();
  postalEl.textContent = postal || "Not entered";
}

function setFieldValidity(fieldId, isValid) {
  const field = document.getElementById(fieldId);
  const group = field.closest(".form-group");
  if (group) group.classList.toggle("is-invalid", !isValid);
}
function setGroupValidity(name, isValid) {
  const input = document.querySelector('[name="' + name + '"]');
  if (!input) return;
  const group = input.closest(".form-group");
  if (group) group.classList.toggle("is-invalid", !isValid);
}

function validateBookingForm() {
  let firstInvalid = null;
  let valid = true;

  const serviceChecked = !!document.querySelector('[data-role="form-service"]:checked');
  setGroupValidity("service", serviceChecked);
  if (!serviceChecked) {
    valid = false;
    firstInvalid = firstInvalid || document.getElementById("svc-standard");
  }

  const homeSize = document.getElementById("homeSize");
  const homeSizeValid = !!homeSize.value;
  setFieldValidity("homeSize", homeSizeValid);
  if (!homeSizeValid) {
    valid = false;
    firstInvalid = firstInvalid || homeSize;
  }

  const dateInput = document.getElementById("preferredDate");
  const dateValid =
    !!dateInput.value && parseISODate(dateInput.value) >= startOfDay(new Date());
  setFieldValidity("preferredDate", dateValid);
  if (!dateValid) {
    valid = false;
    firstInvalid = firstInvalid || dateInput;
  }

  const timeChecked = !!document.querySelector('input[name="timeWindow"]:checked');
  setGroupValidity("timeWindow", timeChecked);
  if (!timeChecked) {
    valid = false;
    firstInvalid = firstInvalid || document.getElementById("time-morning");
  }

  const nameInput = document.getElementById("fullName");
  const nameValid = nameInput.value.trim().length > 1;
  setFieldValidity("fullName", nameValid);
  if (!nameValid) {
    valid = false;
    firstInvalid = firstInvalid || nameInput;
  }

  const emailInput = document.getElementById("email");
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput.value.trim());
  setFieldValidity("email", emailValid);
  if (!emailValid) {
    valid = false;
    firstInvalid = firstInvalid || emailInput;
  }

  const postalInput = document.getElementById("postalCode");
  const postalValid = postalInput.value.trim().length > 2;
  setFieldValidity("postalCode", postalValid);
  if (!postalValid) {
    valid = false;
    firstInvalid = firstInvalid || postalInput;
  }

  if (firstInvalid) firstInvalid.focus();
  return valid;
}

function handleBookingSubmit(e) {
  e.preventDefault();
  const statusEl = document.querySelector('[data-role="form-status"]');
  const submitBtn = document.querySelector('[data-role="submit-btn"]');

  if (!validateBookingForm()) {
    statusEl.textContent = "Please fix the highlighted fields before submitting.";
    statusEl.className = "form-status is-visible form-status--error";
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Sending request…";
  statusEl.textContent = "Sending your request…";
  statusEl.className = "form-status is-visible form-status--loading";

  if (CONFIG.bookingEndpoint) {
    submitToBackend(statusEl, submitBtn);
  } else {
    window.setTimeout(() => {
      completeDemoBooking(statusEl, submitBtn);
    }, 900);
  }
}

function submitToBackend(statusEl, submitBtn) {
  const form = document.getElementById("bookingForm");
  const formData = new FormData(form);
  selectedPhotos.forEach((photo, i) => {
    formData.append("photo_" + i, photo.file, photo.file.name);
  });

  fetch(CONFIG.bookingEndpoint, { method: "POST", body: formData })
    .then((res) => {
      if (!res.ok) throw new Error("Request failed (" + res.status + ")");
      showRealSuccess(statusEl, submitBtn);
    })
    .catch(() => {
      statusEl.textContent =
        "We couldn't send your request. Please try again, or reach us directly.";
      statusEl.className = "form-status is-visible form-status--error";
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit Booking Request";
    });
}

function showRealSuccess(statusEl, submitBtn) {
  statusEl.textContent = "Request sent.";
  statusEl.className = "form-status is-visible form-status--success";
  submitBtn.disabled = false;
  submitBtn.textContent = "Submit Booking Request";
  showCompletePanel(false);
}

function completeDemoBooking(statusEl, submitBtn) {
  statusEl.textContent = "";
  statusEl.className = "form-status";
  submitBtn.disabled = false;
  submitBtn.textContent = "Submit Booking Request";
  showCompletePanel(true);
}

function showCompletePanel(isDemo) {
  const form = document.getElementById("bookingForm");
  const complete = document.querySelector('[data-role="booking-complete"]');
  const summary = document.querySelector('[data-role="complete-summary"]');

  const name = document.getElementById("fullName").value.trim();
  const service = SERVICE_LABELS[
    document.querySelector('[data-role="form-service"]:checked').value
  ];
  const dateValue = document.getElementById("preferredDate").value;
  const dateLabel = dateValue
    ? parseISODate(dateValue).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "";

  summary.textContent =
    "Thanks, " + name + " — we've noted your request for a " + service +
    " on " + dateLabel + ".";

  form.style.display = "none";
  complete.classList.add("is-visible");
  complete.scrollIntoView({
    behavior: prefersReducedMotion ? "auto" : "smooth",
    block: "start",
  });
  complete.setAttribute("tabindex", "-1");
  complete.focus();
}

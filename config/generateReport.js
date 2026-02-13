const PDFDocument = require("pdfkit");
const axios = require("axios");
const FormData = require("form-data");

const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET;

async function generateStudentReport(studentData, data = {}) {
  const doc = new PDFDocument({
    size: "A4",
    margin: 50,
    bufferPages: true, // 🔥 REQUIRED
  });

  const buffers = [];
  doc.on("data", buffers.push.bind(buffers));

  const pageWidth = doc.page.width - 100;
  const pageHeight = doc.page.height;
  let currentY = 50;
  let pageNumber = 1;

  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9);
  const reportId = `REP-${timestamp}-${random}`;
  const reportDate = new Date().toLocaleDateString("en-GB");

  const cleanText = (text) => {
    if (!text || text === "N/A" || text === "null") return "N/A";

    return String(text)
      .replace(/[\x00-\x1F\x7F]/g, "")
      .replace(/→|!’|!/g, " => ")
      .replace(/\s+/g, " ")
      .trim();
  };

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    try {
      return new Date(dateString).toLocaleDateString("en-GB");
    } catch {
      return dateString;
    }
  };

  const formatShortDate = (dateString) => {
    if (!dateString) return "N/A";
    try {
      return new Date(dateString).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
      });
    } catch {
      return dateString;
    }
  };

  const formatSessionTime = (time) => {
    switch (time) {
      case "S1":
        return "Weekdays Early (S1)";
      case "S2":
        return "Weekdays Late (S2)";
      case "WM":
        return "Weekend Morning (WM)";
      case "WA":
        return "Weekend Afternoon (WA)";
      default:
        return time || "Not assigned";
    }
  };

  const checkPageBreak = (needed = 80) => {
    if (currentY + needed > pageHeight - 80) {
      doc.addPage();
      pageNumber++;
      currentY = 60;
    }
  };

  const drawCard = (title, fields, color = "#3498db") => {
    checkPageBreak(fields.length * 20 + 50);

    const startY = currentY;
    const height = 40 + fields.length * 18;

    doc
      .roundedRect(50, currentY, pageWidth, height, 6)
      .fillAndStroke("#f9f9f9", "#e0e0e0");

    doc.rect(50, currentY, 6, height).fill(color);

    doc
      .fillColor(color)
      .font("Helvetica-Bold")
      .fontSize(12)
      .text(title, 65, currentY + 10);

    let fieldY = currentY + 30;

    fields.forEach(([label, value]) => {
      doc
        .fillColor("#333")
        .font("Helvetica-Bold")
        .fontSize(10)
        .text(label + ":", 65, fieldY, { continued: true })
        .font("Helvetica")
        .text(" " + cleanText(value));
      fieldY += 18;
    });

    currentY += height + 20;
  };

  const drawProgressBar = (title, value, maxValue = 100, color = "#9b59b6") => {
    checkPageBreak(80);

    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .fillColor("#2c3e50")
      .text(title, 50, currentY);

    currentY += 20;

    const barWidth = pageWidth;
    const percent = Math.min(value / maxValue, 1);
    const progressWidth = barWidth * percent;

    doc.rect(50, currentY, barWidth, 10).fill("#eaeaea");
    doc.rect(50, currentY, progressWidth, 10).fill(color);

    doc
      .fillColor("#333")
      .fontSize(9)
      .text(`${value} pts`, 50, currentY + 15);

    currentY += 35;
  };

  // ===== HEADER =====
  doc.rect(0, 0, doc.page.width, 120).fill("#2c3e50");

  doc
    .fillColor("white")
    .font("Helvetica-Bold")
    .fontSize(22)
    .text("ALYAQEEN ACADEMY", 0, 50, { align: "center" });

  doc
    .fontSize(14)
    .font("Helvetica")
    .text("Student Progress Report", { align: "center" });

  doc
    .fontSize(8)
    .text(`Report ID: ${reportId}`, 50, 110)
    .text(`Generated: ${reportDate}`, doc.page.width - 200, 110);

  currentY = 140;

  // ===== STUDENT INFO =====
  drawCard(
    "Student Information",
    [
      ["Name", studentData?.name],
      ["Student ID", studentData?.student_id],
      ["Date of Birth", formatDate(studentData?.dob)],
      ["Gender", studentData?.gender],
      ["Starting Date", formatDate(studentData?.startingDate)],
      ["School Year", studentData?.school_year],
    ],
    "#2980b9",
  );

  drawCard(
    "Contact Information",
    [
      ["Emergency Contact", studentData?.emergency_number],
      ["Email", studentData?.email],
    ],
    "#27ae60",
  );

  drawCard(
    "Parent/Guardian Information",
    [
      [
        "Father",
        `${studentData?.father?.name || "N/A"} - ${studentData?.father?.number || "N/A"}`,
      ],
      [
        "Mother",
        `${studentData?.mother?.name || "N/A"} - ${studentData?.mother?.number || "N/A"}`,
      ],
    ],
    "#8e44ad",
  );

  // ===== ENROLLMENT =====
  const enrollments = studentData?.academic?.enrollments || [];
  const enrollmentFields = [];

  if (enrollments.length > 0) {
    enrollments.forEach((e, i) => {
      enrollmentFields.push(["Enrollment", i + 1]);
      enrollmentFields.push(["Department", e.department || e.dept_name]);
      enrollmentFields.push(["Class", e.class || e.class_name]);
      enrollmentFields.push(["Session", e.session]);
      enrollmentFields.push(["Time", formatSessionTime(e.session_time)]);
    });
  } else {
    enrollmentFields.push(["Status", "No active enrollments"]);
  }

  drawCard("Current Enrollment", enrollmentFields, "#e67e22");

  // ===== ATTENDANCE =====
  const attendance = data?.attendance || {
    total: 0,
    present: 0,
    absent: 0,
    late: 0,
  };
  const attendanceRate =
    attendance.total > 0
      ? Math.round((attendance.present / attendance.total) * 100 * 10) / 10
      : 0;

  drawCard(
    "Attendance Statistics",
    [
      ["Total Classes", attendance.total],
      ["Present Days", attendance.present],
      ["Absent Days", attendance.absent],
      ["Late Arrivals", attendance.late],
      ["Attendance Rate", `${attendanceRate}%`],
    ],
    "#2980b9",
  );

  // ===== MERIT =====
  const merit = data?.merits || {
    totalMeritPoints: 0,
    totalAwards: 0,
    averagePoints: 0,
    recentMerits: [],
    behaviorBreakdown: {},
  };

  drawCard(
    "Merit Overview",
    [
      ["Total Merit Points", merit.totalMeritPoints],
      ["Number of Awards", merit.totalAwards],
      ["Average Points", merit.averagePoints?.toFixed?.(1) || 0],
    ],
    "#9b59b6",
  );

  if (merit.totalMeritPoints > 0) {
    drawProgressBar(
      "Merit Points Progress",
      merit.totalMeritPoints,
      100,
      "#9b59b6",
    );
  }

  if (merit.recentMerits?.length > 0) {
    checkPageBreak(120);

    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .fillColor("#2c3e50")
      .text("Recent Merit Awards", 50, currentY);

    currentY += 20;

    merit.recentMerits.slice(0, 6).forEach((m) => {
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor("#333")
        .text(
          `${formatShortDate(m.date)} | ${cleanText(m.behavior)} | +${m.merit_points}`,
          60,
          currentY,
        );
      currentY += 15;
    });

    currentY += 15;
  }

  // ===== ACADEMIC PROGRESS =====
  const allYearsData = data.lessons || [];

  allYearsData.forEach((yearData) => {
    checkPageBreak(100);

    doc
      .font("Helvetica-Bold")
      .fontSize(14)
      .fillColor("#2c3e50")
      .text(`Academic Year ${yearData.year}`, 50, currentY);

    currentY += 20;

    const progress = yearData.progress || {};

    const subjectKeys = [
      ["Quran Qaidah", progress.qaidah_quran_progress],
      ["Islamic Studies", progress.islamic_studies_progress],
      ["Duas & Surahs", progress.dua_surah_progress],
      ["Gift for Muslim", progress.gift_for_muslim_progress],
    ];

    subjectKeys.forEach(([title, subject]) => {
      if (!subject || subject.page_progress === "N/A") return;

      const fields = [];

      Object.entries(subject).forEach(([key, value]) => {
        if (value && value !== "N/A") {
          fields.push([key.replace(/_/g, " "), value]);
        }
      });

      drawCard(title, fields, "#34495e");
    });

    currentY += 10;
  });

  // ===== FOOTER PAGES =====
  doc.on("end", () => {
    const range = doc.bufferedPageRange();
    const totalPages = range.count;

    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);

      doc
        .fontSize(8)
        .fillColor("gray")
        .text(
          `Page ${i - range.start + 1} of ${totalPages}`,
          0,
          doc.page.height - 40,
          { align: "center" },
        );
    }
  });

  doc.end();

  const pdfBuffer = await new Promise((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(buffers)));
  });

  return {
    pdfBuffer,
    reportId,
    fileName: `student_report_${studentData.student_id || studentData._id}_${timestamp}.pdf`,
    reportDate,
  };
}

// Function to upload PDF to Cloudinary
async function uploadToCloudinary(pdfBuffer, fileName) {
  try {
    const base64Data = pdfBuffer.toString("base64");
    const dataUrl = `data:application/pdf;base64,${base64Data}`;

    const formData = new FormData();
    formData.append("file", dataUrl);
    formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    formData.append("public_id", `student-reports/${fileName}`);
    formData.append("folder", "student-reports");

    const response = await axios.post(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/raw/upload`,
      formData,
      { headers: formData.getHeaders() },
    );

    return response.data.secure_url;
  } catch (error) {
    console.error("Cloudinary upload error:", error.message);
    throw error;
  }
}

exports.generateStudentReport = generateStudentReport;
exports.uploadToCloudinary = uploadToCloudinary;

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
  doc.rect(0, 0, doc.page.width, 140).fill("#2c3e50"); // Increased height to 140

  doc
    .fillColor("white")
    .font("Helvetica-Bold")
    .fontSize(22)
    .text("ALYAQEEN ACADEMY", 0, 40, { align: "center" });

  doc
    .fontSize(14)
    .font("Helvetica")
    .text("Student Progress Report", 0, 65, { align: "center" });

  // Add contact information in header
  doc
    .fontSize(8)
    .font("Helvetica")
    .fillColor("#ecf0f1") // Light gray/white color
    .text("116-118 Church Road, Yardley Birmingham B25 8UX", 0, 90, {
      align: "center",
    })
    .text(
      "Phone: 07869636849 | Email: contact@alyaqeen.co.uk | Website: www.alyaqeen.co.uk",
      0,
      105,
      { align: "center" },
    );

  doc
    .fontSize(8)
    .fillColor("#bdc3c7") // Lighter gray for date
    .text(`Generated: ${reportDate}`, doc.page.width - 200, 125);

  currentY = 160; // Increased starting Y to account for taller header

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

  // Filter out years with no progress data
  const yearsWithData = allYearsData.filter((yearData) => {
    const progress = yearData.progress || {};

    // Check if any subject has actual progress data
    const hasQuran =
      progress.qaidah_quran_progress &&
      progress.qaidah_quran_progress.page_progress !== "N/A" &&
      progress.qaidah_quran_progress.page_progress !== null;

    const hasIslamic =
      progress.islamic_studies_progress &&
      progress.islamic_studies_progress.page_progress !== "N/A" &&
      progress.islamic_studies_progress.page_progress !== null;

    const hasDuas =
      progress.dua_surah_progress &&
      progress.dua_surah_progress.page_progress !== "N/A" &&
      progress.dua_surah_progress.page_progress !== null;

    const hasGift =
      progress.gift_for_muslim_progress &&
      progress.gift_for_muslim_progress.page_progress !== "N/A" &&
      progress.gift_for_muslim_progress.page_progress !== null;

    return hasQuran || hasIslamic || hasDuas || hasGift;
  });

  if (yearsWithData.length > 0) {
    yearsWithData.forEach((yearData) => {
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

      let hasAnySubject = false;

      subjectKeys.forEach(([title, subject]) => {
        if (
          !subject ||
          subject.page_progress === "N/A" ||
          subject.page_progress === null
        )
          return;

        const fields = [];

        Object.entries(subject).forEach(([key, value]) => {
          if (value && value !== "N/A" && value !== null) {
            // Format the key to be more readable
            const formattedKey = key
              .replace(/_/g, " ")
              .replace(/display$/, "")
              .replace(/progress$/, "")
              .trim();

            if (formattedKey && value) {
              fields.push([formattedKey, value]);
            }
          }
        });

        if (fields.length > 0) {
          drawCard(title, fields, "#34495e");
          hasAnySubject = true;
        }
      });

      // If no subjects with data in this year, don't show the year at all
      if (!hasAnySubject) {
        // Remove the year header we added
        currentY -= 20;
      }

      currentY += 10;
    });
  } else {
    // Optional: Show a message if no academic progress data
    checkPageBreak(100);
    doc
      .font("Helvetica")
      .fontSize(12)
      .fillColor("#7f8c8d")
      .text("No academic progress records available", 50, currentY);
    currentY += 30;
  }
  // ===== FEE SUMMARY (OUTSTANDING BALANCE) =====
  const fees = data?.fees || {
    totalPaid: 0,
    outstandingAmount: 0,
    lastPaymentDate: null,
    paymentStatus: "No payment records",
    unpaidMonths: [],
    partiallyPaidMonths: [],
    fullyPaidMonths: [],
    monthlyFee: 50,
    discountedMonthlyFee: 50,
    paidMonthsCount: 0,
    partiallyPaidMonthsCount: 0,
    unpaidMonthsCount: 0,
  };

  // Only show fee section if there are any fees to display
  if (
    fees.paidMonthsCount > 0 ||
    fees.partiallyPaidMonthsCount > 0 ||
    fees.unpaidMonthsCount > 0
  ) {
    checkPageBreak(120);

    // Determine color based on status
    let feeStatusColor = "#95a5a6"; // Default gray
    if (fees.paymentStatus === "Fully Paid")
      feeStatusColor = "#27ae60"; // Green
    else if (fees.paymentStatus === "Partially Paid")
      feeStatusColor = "#f39c12"; // Orange
    else if (fees.paymentStatus === "Unpaid") feeStatusColor = "#e67e22"; // Dark orange

    // Build fee summary fields
    const feeFields = [
      ["Monthly Fee", `£${fees.monthlyFee}`],
      fees.discountedMonthlyFee !== fees.monthlyFee
        ? ["After Discount", `£${fees.discountedMonthlyFee.toFixed(2)}`]
        : null,
      ["Total Paid", `£${fees.totalPaid.toFixed(2)}`],
      ["Outstanding Balance", `£${fees.outstandingAmount.toFixed(2)}`],
      ["Status", fees.paymentStatus],
    ];

    // Add counts if they exist
    if (fees.fullyPaidMonths?.length > 0) {
      feeFields.push(["Fully Paid Months", fees.fullyPaidMonths.length]);
    }
    if (fees.partiallyPaidMonths?.length > 0) {
      feeFields.push([
        "Partially Paid Months",
        fees.partiallyPaidMonths.length,
      ]);
    }
    if (fees.unpaidMonths?.length > 0) {
      feeFields.push(["Unpaid Months", fees.unpaidMonths.length]);
    }
    if (fees.lastPaymentDate) {
      feeFields.push(["Last Payment", formatShortDate(fees.lastPaymentDate)]);
    }

    drawCard("Fee Summary", feeFields.filter(Boolean), feeStatusColor);

    // Show partially paid months if any
    if (fees.partiallyPaidMonths && fees.partiallyPaidMonths.length > 0) {
      checkPageBreak(100);

      doc
        .font("Helvetica-Bold")
        .fontSize(12)
        .fillColor("#f39c12")
        .text("Partially Paid Months", 50, currentY);

      currentY += 20;

      // Table header
      doc
        .font("Helvetica-Bold")
        .fontSize(8)
        .fillColor("#666")
        .text("Month", 55, currentY)
        .text("Paid", 120, currentY)
        .text("Due", pageWidth - 70, currentY, { align: "right" });

      currentY += 15; // Space after header

      fees.partiallyPaidMonths.slice(0, 6).forEach((month, index) => {
        // Background for alternating rows
        if (index % 2 === 0) {
          doc
            .fillColor("#fef9e7")
            .rect(50, currentY - 3, pageWidth, 18)
            .fill();
        }

        doc
          .fillColor("#333")
          .font("Helvetica")
          .fontSize(9)
          .text(month.displayMonth || month.month, 55, currentY)
          .text(`£${month.paidAmount?.toFixed(2) || 0}`, 120, currentY)
          .text(
            `£${month.remainingAmount?.toFixed(2) || month.dueAmount?.toFixed(2) || 0}`,
            pageWidth - 70,
            currentY,
            { align: "right" },
          );

        currentY += 18;
      });

      currentY += 15;
    }

    // Show unpaid months if any
    if (fees.unpaidMonths && fees.unpaidMonths.length > 0) {
      checkPageBreak(100);

      doc
        .font("Helvetica-Bold")
        .fontSize(12)
        .fillColor("#e67e22")
        .text("Unpaid Months", 50, currentY);

      currentY += 20;

      // Table header
      doc
        .font("Helvetica-Bold")
        .fontSize(8)
        .fillColor("#666")
        .text("Month", 55, currentY)
        .text("Amount Due", pageWidth - 70, currentY, { align: "right" });

      currentY += 15; // Space after header

      fees.unpaidMonths.slice(0, 6).forEach((month, index) => {
        // Background for alternating rows
        if (index % 2 === 0) {
          doc
            .fillColor("#fdedec")
            .rect(50, currentY - 3, pageWidth, 18)
            .fill();
        }

        doc
          .fillColor("#333")
          .font("Helvetica")
          .fontSize(9)
          .text(month.displayMonth || month.month, 55, currentY)
          .text(
            `£${month.dueAmount?.toFixed(2) || month.amount?.toFixed(2) || 0}`,
            pageWidth - 70,
            currentY,
            { align: "right" },
          );

        currentY += 18;
      });

      currentY += 15;
    }

    // Show fully paid months summary
    // if (fees.fullyPaidMonths && fees.fullyPaidMonths.length > 0) {
    //   checkPageBreak(80);

    //   doc
    //     .font("Helvetica")
    //     .fontSize(10)
    //     .fillColor("#27ae60")
    //     .text(
    //       `✓ ${fees.fullyPaidMonths.length} Month${fees.fullyPaidMonths.length > 1 ? "s" : ""} Fully Paid`,
    //       50,
    //       currentY,
    //     );

    //   currentY += 20;
    // }
  } else {
    // Show a simple "No fee records" message
    checkPageBreak(80);

    drawCard(
      "Fee Summary",
      [
        ["Monthly Fee", `£${fees.monthlyFee}`],
        ["Status", "No payment records found"],
      ],
      "#95a5a6",
    );
  }
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

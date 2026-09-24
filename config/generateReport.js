const PDFDocument = require("pdfkit");
const axios = require("axios");
const FormData = require("form-data");

const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET;

async function generateStudentReport(studentData, data = {}) {
  const doc = new PDFDocument({
    size: "A4",
    margin: 50,
    bufferPages: true,
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
      .replace(/→|!’|!/g, " -> ")
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

  // ===== NEW: Draw Progress Comparison Card =====
  const drawProgressComparison = (
    title,
    beginningFields,
    endingFields,
    color = "#3498db",
  ) => {
    const totalFields = Math.max(beginningFields.length, endingFields.length);
    const height = 50 + totalFields * 22;

    checkPageBreak(height + 30);

    // Card background
    doc
      .roundedRect(50, currentY, pageWidth, height, 6)
      .fillAndStroke("#f9f9f9", "#e0e0e0");

    doc.rect(50, currentY, 6, height).fill(color);

    // Title
    doc
      .fillColor(color)
      .font("Helvetica-Bold")
      .fontSize(12)
      .text(title, 65, currentY + 10);

    // Headers
    const headerY = currentY + 30;
    doc
      .fillColor("#666")
      .font("Helvetica-Bold")
      .fontSize(9)
      .text("Beginning", 70, headerY)
      .text("->", 220, headerY, { width: 30, align: "center" })
      .text("End", 260, headerY);

    // Divider line
    doc
      .moveTo(50, headerY + 15)
      .lineTo(pageWidth + 50, headerY + 15)
      .strokeColor("#ddd")
      .lineWidth(1)
      .stroke();

    let fieldY = headerY + 22;

    // Display fields
    const maxLength = Math.max(beginningFields.length, endingFields.length);
    for (let i = 0; i < maxLength; i++) {
      const beginVal = beginningFields[i] ? beginningFields[i][1] : "";
      const endVal = endingFields[i] ? endingFields[i][1] : "";
      const label = beginningFields[i]
        ? beginningFields[i][0]
        : endingFields[i]
          ? endingFields[i][0]
          : "";

      if (label) {
        doc
          .fillColor("#333")
          .font("Helvetica")
          .fontSize(9)
          .text(label + ":", 70, fieldY, { width: 60 })
          .text(cleanText(beginVal), 130, fieldY, { width: 80 })
          .text("->", 220, fieldY, { width: 30, align: "center" })
          .text(cleanText(endVal), 260, fieldY, { width: 80 });
      } else {
        // If no label, just show the values
        doc
          .fillColor("#333")
          .font("Helvetica")
          .fontSize(9)
          .text(cleanText(beginVal), 130, fieldY, { width: 80 })
          .text("->", 220, fieldY, { width: 30, align: "center" })
          .text(cleanText(endVal), 260, fieldY, { width: 80 });
      }

      fieldY += 20;
    }

    currentY += height + 15;
  };

  // ===== NEW: Draw a term progress card =====
  const drawTermCard = (title, subjects, color = "#3498db") => {
    const height = 40 + subjects.length * 60;

    checkPageBreak(height + 30);

    // Card background
    doc
      .roundedRect(50, currentY, pageWidth, height, 6)
      .fillAndStroke("#f9f9f9", "#e0e0e0");

    doc.rect(50, currentY, 6, height).fill(color);

    // Title
    doc
      .fillColor(color)
      .font("Helvetica-Bold")
      .fontSize(12)
      .text(title, 65, currentY + 10);

    let y = currentY + 32;

    subjects.forEach((sub) => {
      // Subject label
      doc
        .fillColor("#2c3e50")
        .font("Helvetica-Bold")
        .fontSize(10)
        .text(sub.label, 65, y);

      y += 16;

      // Beginning
      doc
        .fillColor("#555")
        .font("Helvetica-Bold")
        .fontSize(9)
        .text("Beginning:", 75, y, { width: 60 })
        .font("Helvetica")
        .fillColor("#333")
        .text(cleanText(sub.beginning), 135, y, {
          width: pageWidth - 110,
        });

      y += 13;

      // End
      doc
        .fillColor("#555")
        .font("Helvetica-Bold")
        .fontSize(9)
        .text("End:", 75, y, { width: 60 })
        .font("Helvetica")
        .fillColor("#333")
        .text(cleanText(sub.end), 135, y, {
          width: pageWidth - 110,
        });

      y += 13;

      // Summary
      doc
        .fillColor("#555")
        .font("Helvetica-Bold")
        .fontSize(9)
        .text("Summary:", 75, y, { width: 60 })
        .font("Helvetica")
        .fillColor("#333")
        .text(cleanText(sub.summary), 135, y, {
          width: pageWidth - 110,
        });

      y += 18;
    });

    currentY += height + 15;
  };
  // ===== HEADER =====
  doc.rect(0, 0, doc.page.width, 140).fill("#2c3e50");

  doc
    .fillColor("white")
    .font("Helvetica-Bold")
    .fontSize(22)
    .text("ALYAQEEN ACADEMY", 0, 40, { align: "center" });

  doc
    .fontSize(14)
    .font("Helvetica")
    .text("Student Progress Report", 0, 65, { align: "center" });

  doc
    .fontSize(8)
    .font("Helvetica")
    .fillColor("#ecf0f1")
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
    .fillColor("#bdc3c7")
    .text(`Generated: ${reportDate}`, doc.page.width - 200, 125);

  currentY = 160;

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

  // ===== ACADEMIC PROGRESS - YEARLY REPORTS =====
  const yearlyReports = data.yearlyReports || [];

  // Filter out years with no data
  const yearsWithData = yearlyReports.filter(
    (yearData) =>
      yearData.hasBeginning || yearData.hasEnding || yearData.hasTermProgress,
  );

  if (yearsWithData.length > 0) {
    yearsWithData.forEach((yearData) => {
      checkPageBreak(120);

      // Year Header
      doc
        .font("Helvetica-Bold")
        .fontSize(14)
        .fillColor("#2c3e50")
        .text(
          `Academic Year ${yearData.year} (${yearData.academic_year})`,
          50,
          currentY,
        );

      currentY += 25;

      const educationType = yearData.type || "normal";
      const isGiftMuslim = educationType === "gift_muslim";

      // Get beginning and ending data
      const beginning = yearData.beginning;
      const ending = yearData.ending;

      // ===== PROGRESS COMPARISON =====
      // For each subject, show Beginning -> End comparison
      const subjectKeys = isGiftMuslim
        ? ["qaidah_quran", "gift_for_muslim"]
        : ["qaidah_quran", "islamic_studies", "dua_surah"];

      subjectKeys.forEach((subjectKey) => {
        const beginSubject = beginning?.subjects?.[subjectKey];
        const endSubject = ending?.subjects?.[subjectKey];

        if (!beginSubject && !endSubject) return;

        // Build beginning fields
        const beginFields = [];
        const endFields = [];

        if (beginSubject) {
          Object.entries(beginSubject).forEach(([key, value]) => {
            if (
              value &&
              value !== "N/A" &&
              value !== "null" &&
              key !== "selected" &&
              key !== "type"
            ) {
              const formattedKey = key.replace(/_/g, " ").toUpperCase();
              beginFields.push([formattedKey, value]);
            }
          });
        }

        if (endSubject) {
          Object.entries(endSubject).forEach(([key, value]) => {
            if (
              value &&
              value !== "N/A" &&
              value !== "null" &&
              key !== "selected" &&
              key !== "type"
            ) {
              const formattedKey = key.replace(/_/g, " ").toUpperCase();
              // Only add if not already in beginFields or if value is different
              const existing = beginFields.find((f) => f[0] === formattedKey);
              if (existing) {
                // Update the end value
                const idx = beginFields.indexOf(existing);
                // We'll handle this differently - just add to endFields
                endFields.push([formattedKey, value]);
              } else {
                endFields.push([formattedKey, value]);
              }
            }
          });
        }

        // If we have both beginning and ending data, show comparison
        if (beginFields.length > 0 && endFields.length > 0) {
          // Combine fields - use beginning fields as base
          const combinedBegin = [];
          const combinedEnd = [];

          beginFields.forEach(([label, value]) => {
            const endMatch = endFields.find((f) => f[0] === label);
            combinedBegin.push([label, value]);
            combinedEnd.push([label, endMatch ? endMatch[1] : "N/A"]);
          });

          // Add any ending fields that weren't in beginning
          endFields.forEach(([label, value]) => {
            if (!combinedBegin.find((f) => f[0] === label)) {
              combinedBegin.push([label, "N/A"]);
              combinedEnd.push([label, value]);
            }
          });

          const subjectTitle =
            beginSubject?.type ||
            endSubject?.type ||
            subjectKey.replace(/_/g, " ").toUpperCase();

          drawProgressComparison(
            `${subjectTitle} Progress`,
            combinedBegin,
            combinedEnd,
            isGiftMuslim ? "#e67e22" : "#3498db",
          );
        } else if (beginFields.length > 0) {
          // Only beginning data
          drawCard(
            `${beginSubject?.type || subjectKey.replace(/_/g, " ").toUpperCase()} - Beginning Only`,
            beginFields,
            "#3498db",
          );
        } else if (endFields.length > 0) {
          // Only ending data
          drawCard(
            `${endSubject?.type || subjectKey.replace(/_/g, " ").toUpperCase()} - End Only`,
            endFields,
            "#e67e22",
          );
        }
      });
      // ===== TERM PROGRESS =====
      const termProgress = yearData.termProgress || {};
      const termOrder = ["autumn", "spring", "summer"];
      const termColors = {
        autumn: "#f39c12",
        spring: "#27ae60",
        summer: "#2980b9",
      };
      const termLabels = {
        autumn: "Autumn Term (1 Sep – 31 Dec)",
        spring: "Spring Term (1 Jan – 30 Apr)",
        summer: "Summer Term (1 May – 31 Aug)",
      };

      termOrder.forEach((termKey) => {
        const termData = termProgress[termKey];
        if (!termData || !termData.subjects?.length) return;

        checkPageBreak(200);

        drawTermCard(
          `${termLabels[termKey]}`,
          termData.subjects,
          termColors[termKey],
        );
      });
      // ===== NOTES =====
      if (yearData.notes && yearData.notes.length > 0) {
        checkPageBreak(60);
        doc
          .font("Helvetica-Bold")
          .fontSize(11)
          .fillColor("#f39c12")
          .text("Notes:", 50, currentY);
        currentY += 18;

        yearData.notes.slice(0, 5).forEach((note) => {
          doc
            .font("Helvetica")
            .fontSize(9)
            .fillColor("#333")
            .text(
              `${formatShortDate(note.date)}: ${cleanText(note.text)}`,
              65,
              currentY,
            );
          currentY += 16;
        });
        currentY += 10;
      }

      currentY += 10;
    });
  } else {
    checkPageBreak(100);
    doc
      .font("Helvetica")
      .fontSize(12)
      .fillColor("#7f8c8d")
      .text("No academic progress records available", 50, currentY);
    currentY += 30;
  }

  // ===== FEE SUMMARY =====
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

    let feeStatusColor = "#95a5a6";
    if (fees.paymentStatus === "Fully Paid") feeStatusColor = "#27ae60";
    else if (fees.paymentStatus === "Partially Paid")
      feeStatusColor = "#f39c12";
    else if (fees.paymentStatus === "Unpaid") feeStatusColor = "#e67e22";

    const feeFields = [
      ["Monthly Fee", `£${fees.monthlyFee}`],
      fees.discountedMonthlyFee !== fees.monthlyFee
        ? ["After Discount", `£${fees.discountedMonthlyFee.toFixed(2)}`]
        : null,
      ["Total Paid", `£${fees.totalPaid.toFixed(2)}`],
      ["Outstanding Balance", `£${fees.outstandingAmount.toFixed(2)}`],
      ["Status", fees.paymentStatus],
    ];

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
        .fontSize(11)
        .fillColor("#f39c12")
        .text("Partially Paid Months", 50, currentY);

      currentY += 20;

      fees.partiallyPaidMonths.slice(0, 6).forEach((month, index) => {
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
          .text(`£${month.paidAmount?.toFixed(2) || 0}`, 150, currentY)
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
        .fontSize(11)
        .fillColor("#e67e22")
        .text("Unpaid Months", 50, currentY);

      currentY += 20;

      fees.unpaidMonths.slice(0, 6).forEach((month, index) => {
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
  } else {
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

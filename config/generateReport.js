const { jsPDF } = require("jspdf");
const axios = require("axios");
const FormData = require("form-data");

// PDF Generation Configuration
const CLOUDINARY_CLOUD_NAME = "dqfazzau6";
const CLOUDINARY_UPLOAD_PRESET = "Alyaqeen";

// Function to generate Student Progress Report (Page 1 & 2 only)
// Function to generate Student Comprehensive Report with Lessons Covered
async function generateStudentReport(studentData, data = {}) {
  // Start with the base report (Pages 1 & 2)
  const pdf = new jsPDF("p", "mm", "a4");
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  let currentY = 10;
  let pageNumber = 1;

  // Generate report ID
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9);
  const reportId = `REP-${timestamp}-${random}`;
  const reportDate = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  // Add new page function
  const addNewPage = () => {
    pdf.addPage();
    pageNumber++;
    currentY = 10;

    // Page header for subsequent pages
    pdf.setFillColor(41, 128, 185);
    pdf.rect(0, 0, pageWidth, 10, "F");

    pdf.setFontSize(9);
    pdf.setTextColor(255, 255, 255);
    pdf.text(`Page ${pageNumber} - Alyaqeen Academy Student Report`, 105, 7, {
      align: "center",
    });
    pdf.setTextColor(100);
    currentY += 3;
  };

  // Function to draw a box with content
  const drawBox = (title, contentLines, boxColor = [41, 128, 185]) => {
    if (currentY > pageHeight - 40) {
      addNewPage();
    }

    // Box header
    pdf.setFillColor(...boxColor);
    pdf.rect(15, currentY, pageWidth - 30, 7, "F");

    pdf.setFontSize(11);
    pdf.setTextColor(255, 255, 255);
    pdf.text(title, 20, currentY + 5);

    currentY += 8;

    // Box content background
    const contentHeight = contentLines.length * 6 + 8;
    pdf.setFillColor(245, 245, 245);
    pdf.rect(15, currentY, pageWidth - 30, contentHeight, "F");

    // Box border
    pdf.setDrawColor(...boxColor);
    pdf.setLineWidth(0.5);
    pdf.rect(15, currentY - 8, pageWidth - 30, contentHeight + 8);

    // Content
    pdf.setFontSize(10);
    pdf.setTextColor(50, 50, 50);

    let contentY = currentY + 6;
    contentLines.forEach((line) => {
      if (typeof line === "string") {
        pdf.text(line, 20, contentY);
        contentY += 6;
      } else if (Array.isArray(line)) {
        pdf.setFont(undefined, "bold");
        pdf.text(line[0], 20, contentY);
        pdf.setFont(undefined, "normal");
        const value =
          line[1] !== undefined && line[1] !== null ? String(line[1]) : "N/A";
        pdf.text(`: ${value}`, 60, contentY);
        contentY += 6;
      }
    });

    currentY += contentHeight + 5;
  };

  // Helper function to format dates
  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    } catch (error) {
      return dateString;
    }
  };

  // Helper function to format session time
  const formatSessionTime = (time) => {
    switch (time) {
      case "S1":
        return "Weekdays Early";
      case "S2":
        return "Weekdays Late";
      case "WM":
        return "Weekend Morning";
      case "WA":
        return "Weekend Afternoon";
      default:
        return time || "Not assigned";
    }
  };

  // ========== PAGE 1: STUDENT PROFILE ==========

  // Main Report Header
  pdf.setFillColor(41, 128, 185);
  pdf.rect(0, 0, pageWidth, 35, "F");

  pdf.setFontSize(22);
  pdf.setTextColor(255, 255, 255);
  pdf.text("ALYAQEEN ACADEMY", 105, 18, { align: "center" });

  pdf.setFontSize(14);
  pdf.text("Student Progress Report", 105, 26, { align: "center" });

  pdf.setFontSize(9);
  pdf.text(`Report ID: ${reportId}`, 20, 40);
  pdf.text(`Report Date: ${reportDate}`, pageWidth - 20, 40, {
    align: "right",
  });

  currentY = 48;

  // 1. STUDENT BASIC INFORMATION
  const studentInfo = [
    [`Full Name`, studentData?.name || "N/A"],
    [`Student ID`, studentData?.student_id || "N/A"],
    [`Date of Birth`, formatDate(studentData?.dob)],
    [`Gender`, studentData?.gender || "N/A"],
    [`Starting Date`, formatDate(studentData?.startingDate)],
    [`School Year`, studentData?.school_year || "N/A"],
  ];
  drawBox("STUDENT INFORMATION", studentInfo, [41, 128, 185]);

  // 2. CONTACT INFORMATION
  const contactInfo = [
    [`Emergency Contact`, studentData?.emergency_number || "N/A"],
    [`Email`, studentData?.email || "N/A"],
  ];
  drawBox("CONTACT INFORMATION", contactInfo, [39, 174, 96]);

  // 3. PARENT/GUARDIAN INFORMATION
  const parentInfo = [
    [`Father Name`, studentData?.father?.name || "N/A"],
    [`Father Contact`, studentData?.father?.number || "N/A"],
    [`Mother Name`, studentData?.mother?.name || "N/A"],
    [`Mother Contact`, studentData?.mother?.number || "N/A"],
  ];
  drawBox("PARENT/GUARDIAN INFORMATION", parentInfo, [142, 68, 173]);

  // 4. CURRENT ENROLLMENT
  const enrollments = studentData?.academic?.enrollments || [];
  const enrollmentInfo = [];

  if (enrollments.length > 0) {
    enrollments.forEach((enrollment, index) => {
      enrollmentInfo.push(`--- Enrollment ${index + 1} ---`);
      enrollmentInfo.push([`Department`, enrollment.dept_name || "N/A"]);
      enrollmentInfo.push([`Class`, enrollment.class_name || "N/A"]);
      enrollmentInfo.push([`Session`, enrollment.session || "N/A"]);
      enrollmentInfo.push([`Time`, formatSessionTime(enrollment.session_time)]);
    });
  } else {
    enrollmentInfo.push("No active enrollments found");
  }
  drawBox("CURRENT ENROLLMENT", enrollmentInfo, [230, 126, 34]);

  // ========== PAGE 2: ATTENDANCE REPORT ==========
  addNewPage();

  // 5. ATTENDANCE SUMMARY
  const attendanceSummary = data?.attendance || {
    total: 0,
    present: 0,
    absent: 0,
    late: 0,
  };

  const attendanceRate =
    attendanceSummary.total > 0
      ? Math.round(
          (attendanceSummary.present / attendanceSummary.total) * 100 * 10,
        ) / 10
      : 0;

  const attendanceInfoArray = [
    [`Total Classes`, attendanceSummary.total.toString()],
    [`Present Days`, attendanceSummary.present.toString()],
    [`Absent Days`, attendanceSummary.absent.toString()],
    [`Late Arrivals`, attendanceSummary.late.toString()],
    [`Attendance Rate`, `${attendanceRate}%`],
  ];
  drawBox("ATTENDANCE SUMMARY", attendanceInfoArray, [41, 128, 185]);

  // Add attendance visualization
  if (currentY > pageHeight - 70) {
    addNewPage();
  }

  // Attendance bar chart
  currentY += 3;
  pdf.setFontSize(10);
  pdf.setTextColor(50, 50, 50);
  pdf.text("Attendance Distribution:", 20, currentY);
  currentY += 8;

  if (attendanceSummary.total > 0) {
    const maxBarWidth = 120;

    // Present bar
    const presentWidth =
      (attendanceSummary.present / attendanceSummary.total) * maxBarWidth;
    pdf.setFillColor(46, 204, 113);
    pdf.rect(20, currentY, presentWidth, 7, "F");
    pdf.setFontSize(8);
    pdf.setTextColor(0, 0, 0);
    pdf.text("Present", 22, currentY + 5);
    pdf.setTextColor(50, 50, 50);
    pdf.text(
      `${attendanceSummary.present} (${((attendanceSummary.present / attendanceSummary.total) * 100).toFixed(1)}%)`,
      150,
      currentY + 5,
    );
    currentY += 10;

    // Absent bar
    const absentWidth =
      (attendanceSummary.absent / attendanceSummary.total) * maxBarWidth;
    pdf.setFillColor(231, 76, 60);
    pdf.rect(20, currentY, absentWidth, 7, "F");
    pdf.setTextColor(0, 0, 0);
    pdf.text("Absent", 22, currentY + 5);
    pdf.setTextColor(50, 50, 50);
    pdf.text(
      `${attendanceSummary.absent} (${((attendanceSummary.absent / attendanceSummary.total) * 100).toFixed(1)}%)`,
      150,
      currentY + 5,
    );
    currentY += 10;

    // Late bar
    if (attendanceSummary.late > 0) {
      const lateWidth =
        (attendanceSummary.late / attendanceSummary.total) * maxBarWidth;
      pdf.setFillColor(241, 196, 15);
      pdf.rect(20, currentY, lateWidth, 7, "F");
      pdf.setTextColor(0, 0, 0);
      pdf.text("Late", 22, currentY + 5);
      pdf.setTextColor(50, 50, 50);
      pdf.text(
        `${attendanceSummary.late} (${((attendanceSummary.late / attendanceSummary.total) * 100).toFixed(1)}%)`,
        150,
        currentY + 5,
      );
      currentY += 15;
    } else {
      currentY += 8;
    }
  } else {
    pdf.setFontSize(9);
    pdf.setTextColor(120, 120, 120);
    pdf.text("No attendance records available", 20, currentY);
    currentY += 12;
  }

  // ========== PAGE 3+: LESSONS COVERED SUMMARY ==========
  const startingYear = data.startingYear || new Date().getFullYear();
  const currentYearValue = data.currentYear || new Date().getFullYear();
  const allYearsData = data.lessons || [];

  if (allYearsData.length > 0) {
    allYearsData.forEach((yearData, yearIndex) => {
      if (yearIndex > 0 || currentY > pageHeight - 50) {
        addNewPage();
        currentY = 15;
      }

      // Year Header
      pdf.setFontSize(16);
      pdf.setTextColor(41, 128, 185);
      pdf.text(`Academic Year: ${yearData.year}`, 20, currentY);

      pdf.setFontSize(10);
      pdf.setTextColor(80, 80, 80);
      pdf.text(`Period: ${startingYear} - ${currentYearValue}`, 140, currentY);

      currentY += 8;

      // Student info for this year
      pdf.text(`Student: ${studentData.name}`, 20, currentY);
      pdf.text(
        `ID: ${studentData.student_id || studentData._id}`,
        140,
        currentY,
      );
      currentY += 10;

      const progress = yearData.progress || {};

      // Function to draw a subject card WITHOUT setAlpha
      // Function to draw a subject card FIXED
      const drawSubjectCard = (title, subjectProgress, color, icon) => {
        if (!subjectProgress || subjectProgress.page_progress === "N/A") {
          return;
        }

        if (currentY > pageHeight - 50) {
          addNewPage();
          currentY = 15;
        }

        // Card dimensions
        const cardWidth = pageWidth - 40;
        const cardHeight = 45;

        // Card background - simple light fill
        const lightColor = [240, 240, 240];
        pdf.setFillColor(lightColor[0], lightColor[1], lightColor[2]);
        pdf.rect(20, currentY, cardWidth, cardHeight, "F");

        // Card border
        pdf.setDrawColor(color[0], color[1], color[2]);
        pdf.setLineWidth(0.5);
        pdf.rect(20, currentY, cardWidth, cardHeight);

        // Title with icon (icon as text)
        pdf.setFontSize(11);
        pdf.setTextColor(color[0], color[1], color[2]);
        // Use a text representation of icon instead of emoji
        let iconText = "";
        switch (icon) {
          case "📖":
            iconText = "Q";
            break;
          case "📚":
            iconText = "I";
            break;
          case "🕌":
            iconText = "D";
            break;
          case "🎁":
            iconText = "G";
            break;
          default:
            iconText = "•";
        }
        pdf.text(`${iconText} ${title}`, 25, currentY + 10);

        // Progress details
        pdf.setFontSize(9);
        pdf.setTextColor(60, 60, 60);

        let detailY = currentY + 20;
        const startX = 25;

        // Clean progress data function
        const cleanText = (text) => {
          if (!text || text === "N/A") return "N/A";
          return String(text)
            .replace(/[^\x00-\x7F]/g, "") // Remove non-ASCII characters
            .replace(/!/g, " → ") // Replace ! with arrow
            .replace(/-/g, " - ") // Format dashes
            .trim();
        };

        // Type
        if (subjectProgress.selected && subjectProgress.selected !== "N/A") {
          pdf.setFont(undefined, "bold");
          pdf.text("Type:", startX, detailY);
          pdf.setFont(undefined, "normal");
          pdf.text(cleanText(subjectProgress.selected), startX + 20, detailY);
          detailY += 5;
        }

        // Pages Done (with arrow)
        if (
          subjectProgress.page_progress &&
          subjectProgress.page_progress !== "N/A"
        ) {
          pdf.setFont(undefined, "bold");
          pdf.text("Pages Done:", startX, detailY);
          pdf.setFont(undefined, "normal");
          pdf.text(
            cleanText(subjectProgress.page_progress),
            startX + 35,
            detailY,
          );
          detailY += 5;
        }

        // Lines Progress (with dash)
        if (
          subjectProgress.line_progress &&
          subjectProgress.line_progress !== "N/A"
        ) {
          pdf.setFont(undefined, "bold");
          pdf.text("Lines:", startX, detailY);
          pdf.setFont(undefined, "normal");
          pdf.text(
            cleanText(subjectProgress.line_progress),
            startX + 25,
            detailY,
          );
          detailY += 5;
        }

        // Right column details
        detailY = currentY + 20;
        const rightStartX = 120;

        // Level (with arrow)
        if (
          subjectProgress.level_display &&
          subjectProgress.level_display !== "N/A"
        ) {
          pdf.setFont(undefined, "bold");
          pdf.text("Level:", rightStartX, detailY);
          pdf.setFont(undefined, "normal");
          pdf.text(
            cleanText(subjectProgress.level_display),
            rightStartX + 25,
            detailY,
          );
          detailY += 5;
        }

        // Book (with arrow)
        if (
          subjectProgress.book_display &&
          subjectProgress.book_display !== "N/A"
        ) {
          pdf.setFont(undefined, "bold");
          pdf.text("Book:", rightStartX, detailY);
          pdf.setFont(undefined, "normal");
          pdf.text(
            cleanText(subjectProgress.book_display),
            rightStartX + 25,
            detailY,
          );
          detailY += 5;
        }

        // Lesson (with arrow)
        if (
          subjectProgress.lesson_name_display &&
          subjectProgress.lesson_name_display !== "N/A"
        ) {
          pdf.setFont(undefined, "bold");
          pdf.text("Lesson:", rightStartX, detailY);
          pdf.setFont(undefined, "normal");
          pdf.text(
            cleanText(subjectProgress.lesson_name_display),
            rightStartX + 30,
            detailY,
          );
          detailY += 5;
        }

        // Special fields for Dua/Surah
        if (title === "Duas & Surahs" || title === "Dua / Surah") {
          // Targets (with arrow)
          if (
            subjectProgress.target_display &&
            subjectProgress.target_display !== "N/A"
          ) {
            pdf.setFont(undefined, "bold");
            pdf.text("Targets:", startX, detailY);
            pdf.setFont(undefined, "normal");
            pdf.text(
              cleanText(subjectProgress.target_display),
              startX + 30,
              detailY,
            );
            detailY += 5;
          }

          // Duas Done
          if (
            subjectProgress.dua_number_progress &&
            subjectProgress.dua_number_progress !== "N/A"
          ) {
            pdf.setFont(undefined, "bold");
            pdf.text("Duas Done:", startX, detailY);
            pdf.setFont(undefined, "normal");
            pdf.text(
              cleanText(subjectProgress.dua_number_progress),
              startX + 40,
              detailY,
            );
            detailY += 5;
          }
        }

        // Special field for Quran - Para progress
        if (
          (title === "Quran Qaidah" || title === "Qaidah / Quran") &&
          subjectProgress.para_progress &&
          subjectProgress.para_progress !== "N/A"
        ) {
          pdf.setFont(undefined, "bold");
          pdf.text("Paras Done:", startX, detailY);
          pdf.setFont(undefined, "normal");
          pdf.text(
            cleanText(subjectProgress.para_progress),
            startX + 40,
            detailY,
          );
          detailY += 5;
        }

        // Move Y position for next card
        currentY += cardHeight + 10;
      };

      // Draw each subject card
      drawSubjectCard(
        "Quran Qaidah",
        progress.qaidah_quran_progress,
        [41, 128, 185],
        "📖",
      );
      drawSubjectCard(
        "Islamic Studies",
        progress.islamic_studies_progress,
        [39, 174, 96],
        "📚",
      );
      drawSubjectCard(
        "Duas & Surahs",
        progress.dua_surah_progress,
        [142, 68, 173],
        "🕌",
      );
      drawSubjectCard(
        "Gift for Muslim",
        progress.gift_for_muslim_progress,
        [230, 126, 34],
        "🎁",
      );

      currentY += 10;
    });
  } else {
    // No lessons data available
    if (currentY > pageHeight - 50) {
      addNewPage();
      currentY = 15;
    }

    pdf.setFontSize(14);
    pdf.setTextColor(41, 128, 185);
    pdf.text("ACADEMIC PROGRESS SUMMARY", 105, currentY, { align: "center" });
    currentY += 15;

    pdf.setFontSize(11);
    pdf.setTextColor(120, 120, 120);
    pdf.text(
      "No academic progress data available for this period.",
      20,
      currentY,
    );
    currentY += 12;
  }

  // ========== FINAL FOOTER ==========
  const totalPages = pdf.getNumberOfPages();

  // Add page numbers to all pages
  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i);

    // Add page number footer
    pdf.setFontSize(8);
    pdf.setTextColor(150, 150, 150);
    pdf.text(`Page ${i} of ${totalPages}`, 105, pageHeight - 6, {
      align: "center",
    });
  }

  // Add contact footer on last page
  pdf.setPage(totalPages);
  const contactFooter = [
    "Alyaqeen Academy | 116-118 Church Road, Yardley Birmingham B25 8UX",
    "Phone: 07869636849 | Email: contact@alyaqeen.co.uk | Website: www.alyaqeen.co.uk",
  ];

  contactFooter.forEach((line, index) => {
    pdf.setFontSize(7);
    pdf.setTextColor(120, 120, 120);
    pdf.text(line, 105, pageHeight - 16 + index * 3.5, { align: "center" });
  });

  return {
    pdfBuffer: Buffer.from(pdf.output("arraybuffer")),
    reportId,
    fileName: `student_comprehensive_report_${studentData.student_id || studentData._id}_${timestamp}.pdf`,
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

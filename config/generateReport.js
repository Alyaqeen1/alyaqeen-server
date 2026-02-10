const { jsPDF } = require("jspdf");
const axios = require("axios");
const FormData = require("form-data");

// PDF Generation Configuration
const CLOUDINARY_CLOUD_NAME = "dqfazzau6";
const CLOUDINARY_UPLOAD_PRESET = "Alyaqeen";

// Function to generate Student Comprehensive Report with Lessons Covered
async function generateStudentReport(studentData, data = {}) {
  // Start with the base report
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

  // Helper to clean all text
  const cleanText = (text) => {
    if (!text || text === "N/A" || text === "null") return "N/A";

    return String(text)
      .replace(/[\x00-\x1F\x7F]/g, "")
      .replace(/→|!’|!/g, " => ")
      .replace(/\s+/g, " ")
      .trim();
  };

  // Format date for display
  const formatShortDate = (dateString) => {
    if (!dateString) return "N/A";
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
      });
    } catch (error) {
      return dateString;
    }
  };

  // Add new page function
  const addNewPage = () => {
    pdf.addPage();
    pageNumber++;
    currentY = 20;

    // Page header for subsequent pages
    pdf.setFillColor(41, 128, 185);
    pdf.rect(0, 0, pageWidth, 15, "F");

    pdf.setFontSize(10);
    pdf.setTextColor(255, 255, 255);
    pdf.text(`Alyaqeen Academy - Student Progress Report`, 105, 9, {
      align: "center",
    });

    pdf.setFontSize(8);
    pdf.text(`Page ${pageNumber}`, 105, 13, { align: "center" });

    pdf.setTextColor(100);
    currentY += 3;
  };

  // Function to draw a compact info box
  const drawCompactBox = (title, contentLines, boxColor = [41, 128, 185]) => {
    if (currentY > pageHeight - 30) {
      addNewPage();
    }

    // Calculate content height
    const lineHeight = 4.5;
    const padding = 4;
    const titleHeight = 6;
    const contentHeight = contentLines.length * lineHeight + padding * 2;

    // Box with color header
    pdf.setFillColor(boxColor[0], boxColor[1], boxColor[2]);
    pdf.rect(15, currentY, pageWidth - 30, titleHeight, "F");

    // Title
    pdf.setFontSize(10);
    pdf.setTextColor(255, 255, 255);
    pdf.text(cleanText(title), 20, currentY + 4);

    // Content background
    pdf.setFillColor(250, 250, 250);
    pdf.rect(15, currentY + titleHeight, pageWidth - 30, contentHeight, "F");

    // Border
    pdf.setDrawColor(boxColor[0], boxColor[1], boxColor[2]);
    pdf.setLineWidth(0.3);
    pdf.rect(15, currentY, pageWidth - 30, titleHeight + contentHeight);

    // Content
    pdf.setFontSize(9);
    pdf.setTextColor(60, 60, 60);

    let contentY = currentY + titleHeight + padding;
    contentLines.forEach((line) => {
      if (typeof line === "string") {
        pdf.setFont(undefined, "bold");
        pdf.text(cleanText(line), 20, contentY);
        contentY += lineHeight;
      } else if (Array.isArray(line)) {
        pdf.setFont(undefined, "bold");
        const label = line[0];
        const value = line[1];

        // Draw label
        pdf.text(cleanText(label), 20, contentY);

        // Draw value with text wrapping
        const cleanedValue = cleanText(value);
        const maxWidth = 80;
        const wrappedText = pdf.splitTextToSize(cleanedValue, maxWidth);

        if (wrappedText.length === 1) {
          pdf.setFont(undefined, "normal");
          pdf.text(`: ${cleanedValue}`, 55, contentY);
          contentY += lineHeight;
        } else {
          pdf.setFont(undefined, "normal");
          pdf.text(":", 55, contentY);
          wrappedText.forEach((textLine, idx) => {
            pdf.text(textLine, 58, contentY + idx * lineHeight);
          });
          contentY += wrappedText.length * lineHeight;
        }
      }
    });

    currentY += titleHeight + contentHeight + 8;
  };

  // Function to draw a merit progress bar
  const drawMeritProgressBar = (title, value, maxValue = 100, color) => {
    if (currentY > pageHeight - 20) {
      addNewPage();
    }

    const barWidth = pageWidth - 60;
    const barHeight = 8;
    const progressWidth = (value / maxValue) * barWidth;

    // Title
    pdf.setFontSize(9);
    pdf.setTextColor(60, 60, 60);
    pdf.text(title, 30, currentY + 6);

    // Background bar
    pdf.setFillColor(240, 240, 240);
    pdf.rect(30, currentY + 8, barWidth, barHeight, "F");

    // Progress bar
    pdf.setFillColor(...color);
    pdf.rect(30, currentY + 8, progressWidth, barHeight, "F");

    // Border
    pdf.setDrawColor(220, 220, 220);
    pdf.setLineWidth(0.3);
    pdf.rect(30, currentY + 8, barWidth, barHeight);

    // Value text
    pdf.setFontSize(8);
    pdf.setTextColor(255, 255, 255);
    const valueText = `${value} pts`;
    const textWidth = pdf.getTextWidth(valueText);

    // Center text on bar if it fits
    if (progressWidth > textWidth + 4) {
      pdf.text(valueText, 30 + (progressWidth - textWidth) / 2, currentY + 14);
    } else {
      // Put text to the right of the bar
      pdf.setTextColor(color[0], color[1], color[2]);
      pdf.text(valueText, 30 + barWidth + 5, currentY + 14);
    }

    currentY += 25;
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

  // ========== PAGE 1: STUDENT PROFILE ==========

  // Report Header
  pdf.setFillColor(41, 128, 185);
  pdf.rect(0, 0, pageWidth, 40, "F");

  // Academy Title
  pdf.setFontSize(24);
  pdf.setTextColor(255, 255, 255);
  pdf.text("ALYAQEEN", 105, 18, { align: "center" });

  pdf.setFontSize(16);
  pdf.text("ACADEMY", 105, 26, { align: "center" });

  pdf.setFontSize(12);
  pdf.text("Student Progress Report", 105, 34, { align: "center" });

  // Report metadata
  pdf.setFontSize(8);
  pdf.setTextColor(200, 200, 200);
  pdf.text(`Report ID: ${reportId}`, 20, 45);
  pdf.text(`Generated: ${reportDate}`, pageWidth - 20, 45, {
    align: "right",
  });

  // Add a divider
  pdf.setDrawColor(200, 200, 200);
  pdf.setLineWidth(0.2);
  pdf.line(15, 48, pageWidth - 15, 48);

  currentY = 55;

  // 1. STUDENT BASIC INFORMATION
  const studentInfo = [
    [`Name`, studentData?.name || "N/A"],
    [`Student ID`, studentData?.student_id || "N/A"],
    [`Date of Birth`, formatDate(studentData?.dob)],
    [`Gender`, studentData?.gender || "N/A"],
    [`Starting Date`, formatDate(studentData?.startingDate)],
    [`School Year`, studentData?.school_year || "N/A"],
  ];
  drawCompactBox("STUDENT INFORMATION", studentInfo, [41, 128, 185]);

  // 2. CONTACT INFORMATION
  const contactInfo = [
    [`Emergency Contact`, studentData?.emergency_number || "N/A"],
    [`Email`, studentData?.email || "N/A"],
  ];
  drawCompactBox("CONTACT INFORMATION", contactInfo, [39, 174, 96]);

  // 3. PARENT/GUARDIAN INFORMATION
  const parentInfo = [
    [
      `Father`,
      `${studentData?.father?.name || "N/A"} - ${studentData?.father?.number || "N/A"}`,
    ],
    [
      `Mother`,
      `${studentData?.mother?.name || "N/A"} - ${studentData?.mother?.number || "N/A"}`,
    ],
  ];
  drawCompactBox("PARENT/GUARDIAN INFORMATION", parentInfo, [142, 68, 173]);

  // 4. CURRENT ENROLLMENT
  const enrollments = studentData?.academic?.enrollments || [];
  const enrollmentInfo = [];

  if (enrollments.length > 0) {
    enrollments.forEach((enrollment, index) => {
      enrollmentInfo.push(`Enrollment ${index + 1}`);
      enrollmentInfo.push([
        `Department`,
        enrollment.department || enrollment.dept_name || "N/A",
      ]);
      enrollmentInfo.push([
        `Class`,
        enrollment.class || enrollment.class_name || "N/A",
      ]);
      enrollmentInfo.push([`Session`, enrollment.session || "N/A"]);
      enrollmentInfo.push([`Time`, formatSessionTime(enrollment.session_time)]);
    });
  } else {
    enrollmentInfo.push("No active enrollments");
  }
  drawCompactBox("CURRENT ENROLLMENT", enrollmentInfo, [230, 126, 34]);

  // ========== PAGE 2: ATTENDANCE & MERIT REPORT ==========
  addNewPage();

  // ATTENDANCE SECTION
  pdf.setFontSize(14);
  pdf.setTextColor(41, 128, 185);
  pdf.text("ATTENDANCE SUMMARY", 20, currentY);
  currentY += 10;

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
  drawCompactBox("ATTENDANCE STATISTICS", attendanceInfoArray, [41, 128, 185]);

  // Attendance visualization
  if (currentY > pageHeight - 50) {
    addNewPage();
  }

  currentY += 5;
  pdf.setFontSize(9);
  pdf.setTextColor(80, 80, 80);
  pdf.text("Attendance Breakdown:", 20, currentY);
  currentY += 8;

  if (attendanceSummary.total > 0) {
    const maxBarWidth = 100;
    const barHeight = 5;
    const barY = currentY;

    // Present bar
    const presentWidth =
      (attendanceSummary.present / attendanceSummary.total) * maxBarWidth;
    pdf.setFillColor(46, 204, 113);
    pdf.rect(20, barY, presentWidth, barHeight, "F");

    // Absent bar
    const absentWidth =
      (attendanceSummary.absent / attendanceSummary.total) * maxBarWidth;
    pdf.setFillColor(231, 76, 60);
    pdf.rect(20 + presentWidth, barY, absentWidth, barHeight, "F");

    // Legend
    currentY += 10;
    pdf.setFontSize(7);

    // Present
    pdf.setFillColor(46, 204, 113);
    pdf.rect(20, currentY, 4, 4, "F");
    pdf.setTextColor(60, 60, 60);
    pdf.text(`Present (${attendanceSummary.present})`, 27, currentY + 3);

    // Absent
    pdf.setFillColor(231, 76, 60);
    pdf.rect(70, currentY, 4, 4, "F");
    pdf.text(`Absent (${attendanceSummary.absent})`, 77, currentY + 3);

    currentY += 15;
  } else {
    pdf.setFontSize(9);
    pdf.setTextColor(150, 150, 150);
    pdf.text("No attendance records available", 20, currentY);
    currentY += 12;
  }

  // ========== MERIT SECTION ==========
  // Check if we need a new page for merit section
  if (currentY > pageHeight - 100) {
    addNewPage();
  }

  // Merit section header
  pdf.setFontSize(14);
  pdf.setTextColor(155, 89, 182); // Purple color for merit section
  pdf.text("MERIT & BEHAVIOR AWARDS", 20, currentY);
  currentY += 10;

  // Get merit data
  const meritSummary = data?.merits || {
    totalMeritPoints: 0,
    totalAwards: 0,
    averagePoints: 0,
    recentMerits: [],
    behaviorBreakdown: {},
  };

  // Merit Statistics Box
  const meritStats = [
    [`Total Merit Points`, meritSummary.totalMeritPoints.toString()],
    [`Number of Awards`, meritSummary.totalAwards.toString()],
    [`Average Points per Award`, meritSummary.averagePoints.toFixed(1)],
  ];

  if (meritSummary.totalAwards > 0) {
    meritStats.push([
      `Milestone`,
      `${meritSummary.totalMeritPoints >= 50 ? "🎯 50+ Points Achieved" : `${50 - meritSummary.totalMeritPoints} pts to next milestone`}`,
    ]);
  }

  drawCompactBox("MERIT OVERVIEW", meritStats, [155, 89, 182]);

  // Merit Progress Bar (if there are points)
  if (meritSummary.totalMeritPoints > 0) {
    if (currentY > pageHeight - 30) {
      addNewPage();
    }

    // Draw progress bar for merit points
    drawMeritProgressBar(
      "Merit Points Progress",
      meritSummary.totalMeritPoints,
      100,
      [155, 89, 182],
    );
  }

  // Behavior Breakdown
  if (Object.keys(meritSummary.behaviorBreakdown || {}).length > 0) {
    if (currentY > pageHeight - 60) {
      addNewPage();
    }

    // Sort behaviors by total points (highest first)
    const sortedBehaviors = Object.entries(meritSummary.behaviorBreakdown)
      .sort(([, a], [, b]) => b.totalPoints - a.totalPoints)
      .slice(0, 5); // Top 5 behaviors

    const behaviorInfo = [];
    behaviorInfo.push("--- Top Behaviors ---");

    sortedBehaviors.forEach(([behavior, data]) => {
      behaviorInfo.push([
        cleanText(behavior),
        `${data.totalPoints} pts (${data.count} awards)`,
      ]);
    });

    drawCompactBox("TOP BEHAVIORS", behaviorInfo, [52, 152, 219]);
  }

  // Recent Merit Awards
  if (meritSummary.recentMerits && meritSummary.recentMerits.length > 0) {
    if (currentY > pageHeight - 80) {
      addNewPage();
    }

    currentY += 5;
    pdf.setFontSize(10);
    pdf.setTextColor(46, 204, 113); // Green color
    pdf.text("Recent Merit Awards:", 20, currentY);
    currentY += 8;

    // Create a small table for recent merits
    pdf.setFontSize(8);
    pdf.setTextColor(80, 80, 80);

    // Table header
    pdf.setFillColor(245, 245, 245);
    pdf.rect(20, currentY, pageWidth - 40, 6, "F");

    pdf.setFont(undefined, "bold");
    pdf.text("Date", 22, currentY + 4);
    pdf.text("Behavior", 45, currentY + 4);
    pdf.text("Points", pageWidth - 30, currentY + 4, { align: "right" });

    currentY += 8;

    // Table rows
    pdf.setFont(undefined, "normal");
    meritSummary.recentMerits.slice(0, 6).forEach((merit, index) => {
      if (currentY > pageHeight - 15) {
        addNewPage();
        currentY = 20;
      }

      // Alternate row colors
      if (index % 2 === 0) {
        pdf.setFillColor(252, 252, 252);
      } else {
        pdf.setFillColor(250, 250, 250);
      }
      pdf.rect(20, currentY, pageWidth - 40, 6, "F");

      // Date
      pdf.text(formatShortDate(merit.date), 22, currentY + 4);

      // Behavior (truncated if too long)
      const behavior = cleanText(merit.behavior);
      const behaviorText =
        behavior.length > 30 ? behavior.substring(0, 27) + "..." : behavior;
      pdf.text(behaviorText, 45, currentY + 4);

      // Points with color based on value
      const points = merit.merit_points || 0;
      if (points >= 4) {
        pdf.setTextColor(46, 204, 113); // Green for high points
      } else if (points >= 2) {
        pdf.setTextColor(52, 152, 219); // Blue for medium points
      } else {
        pdf.setTextColor(155, 89, 182); // Purple for low points
      }

      pdf.text(`+${points}`, pageWidth - 30, currentY + 4, { align: "right" });
      pdf.setTextColor(80, 80, 80); // Reset color

      currentY += 8;
    });

    currentY += 5;
  }

  // ========== PAGE 3+: ACADEMIC PROGRESS ==========
  const startingYear = data.startingYear || new Date().getFullYear();
  const currentYearValue = data.currentYear || new Date().getFullYear();
  const allYearsData = data.lessons || [];

  if (allYearsData.length > 0) {
    // Start new page for academic progress
    addNewPage();

    // Academic Progress Header
    pdf.setFontSize(16);
    pdf.setTextColor(41, 128, 185);
    pdf.text("ACADEMIC PROGRESS", 105, currentY, { align: "center" });

    pdf.setFontSize(10);
    pdf.setTextColor(100, 100, 100);
    pdf.text(
      `Academic Years: ${startingYear} - ${currentYearValue}`,
      105,
      currentY + 7,
      { align: "center" },
    );

    currentY += 20;

    allYearsData.forEach((yearData, yearIndex) => {
      // Check if we need a new page for this year
      if (currentY > pageHeight - 100) {
        addNewPage();
        currentY = 20;
      }

      // Year Header
      pdf.setFillColor(245, 245, 245);
      pdf.rect(15, currentY, pageWidth - 30, 12, "F");

      pdf.setDrawColor(200, 200, 200);
      pdf.setLineWidth(0.3);
      pdf.rect(15, currentY, pageWidth - 30, 12);

      pdf.setFontSize(12);
      pdf.setTextColor(41, 128, 185);
      pdf.text(`📚 Academic Year ${yearData.year}`, 22, currentY + 8);

      currentY += 18;

      const progress = yearData.progress || {};

      // Subject cards function (your existing code, but cleaned up)
      // Update the drawSubjectCard function in your generateStudentReport function:

      // Subject cards function with ALL fields
      const drawSubjectCard = (title, subjectProgress, color, icon = "•") => {
        if (!subjectProgress || subjectProgress.page_progress === "N/A") {
          return;
        }

        if (currentY > pageHeight - 50) {
          addNewPage();
          currentY = 20;
        }

        // Calculate dynamic card height based on content
        let fieldCount = 0;
        const fieldsToDisplay = [];

        // Check which fields are available
        if (subjectProgress.selected && subjectProgress.selected !== "N/A") {
          fieldCount++;
          fieldsToDisplay.push({
            label: "Type:",
            value: subjectProgress.selected,
          });
        }

        if (
          subjectProgress.page_progress &&
          subjectProgress.page_progress !== "N/A"
        ) {
          fieldCount++;
          fieldsToDisplay.push({
            label: "Pages:",
            value: subjectProgress.page_progress,
            left: true,
          });
        }

        if (
          subjectProgress.line_progress &&
          subjectProgress.line_progress !== "N/A"
        ) {
          fieldCount++;
          fieldsToDisplay.push({
            label: "Lines:",
            value: subjectProgress.line_progress,
            left: true,
          });
        }

        if (
          subjectProgress.level_display &&
          subjectProgress.level_display !== "N/A"
        ) {
          fieldCount++;
          fieldsToDisplay.push({
            label: "Level:",
            value: subjectProgress.level_display,
            left: false,
          });
        }

        if (
          subjectProgress.book_display &&
          subjectProgress.book_display !== "N/A"
        ) {
          fieldCount++;
          fieldsToDisplay.push({
            label: "Book:",
            value: subjectProgress.book_display,
            left: false,
          });
        }

        if (
          subjectProgress.lesson_name_display &&
          subjectProgress.lesson_name_display !== "N/A"
        ) {
          fieldCount++;
          fieldsToDisplay.push({
            label: "Lesson:",
            value: subjectProgress.lesson_name_display,
            left: false,
          });
        }

        // Special fields for Duas & Surahs
        if (title === "Duas & Surahs" || title === "Dua / Surah") {
          if (
            subjectProgress.target_display &&
            subjectProgress.target_display !== "N/A"
          ) {
            fieldCount++;
            fieldsToDisplay.push({
              label: "Targets:",
              value: subjectProgress.target_display,
              left: true,
            });
          }

          if (
            subjectProgress.dua_number_progress &&
            subjectProgress.dua_number_progress !== "N/A"
          ) {
            fieldCount++;
            fieldsToDisplay.push({
              label: "Duas Done:",
              value: subjectProgress.dua_number_progress,
              left: true,
            });
          }
        }

        // Special field for Quran - Para progress
        if (
          (title === "Quran Qaidah" || title === "Qaidah / Quran") &&
          subjectProgress.para_progress &&
          subjectProgress.para_progress !== "N/A"
        ) {
          fieldCount++;
          fieldsToDisplay.push({
            label: "Paras Done:",
            value: subjectProgress.para_progress,
            left: true,
          });
        }

        // Calculate card height - each field takes about 5mm
        const baseHeight = 20; // Title and spacing
        const fieldHeight = 5;
        const cardHeight = baseHeight + fieldCount * fieldHeight;

        const cardWidth = pageWidth - 40;

        // Card background
        pdf.setFillColor(252, 252, 252);
        pdf.rect(20, currentY, cardWidth, cardHeight, "F");

        // Left color accent
        pdf.setFillColor(...color);
        pdf.rect(20, currentY, 4, cardHeight, "F");

        // Card border
        pdf.setDrawColor(220, 220, 220);
        pdf.setLineWidth(0.3);
        pdf.rect(20, currentY, cardWidth, cardHeight);

        // Title with icon
        pdf.setFontSize(10);
        pdf.setTextColor(...color);
        pdf.text(`${icon} ${cleanText(title)}`, 30, currentY + 8);

        // Progress details in two columns
        const leftColumnX = 30;
        const rightColumnX = 110;
        let leftY = currentY + 15;
        let rightY = currentY + 15;

        // Draw all fields
        fieldsToDisplay.forEach((field) => {
          if (field.left) {
            // Left column
            pdf.setFontSize(8);
            pdf.setTextColor(60, 60, 60);
            pdf.setFont(undefined, "bold");
            pdf.text(field.label, leftColumnX, leftY);
            pdf.setFont(undefined, "normal");

            const cleanedValue = cleanText(field.value);
            const maxWidth = 70;
            const wrappedText = pdf.splitTextToSize(cleanedValue, maxWidth);

            if (wrappedText.length === 1) {
              pdf.text(cleanedValue, leftColumnX + 25, leftY);
            } else {
              // Handle multi-line values
              wrappedText.forEach((line, idx) => {
                pdf.text(line, leftColumnX + 25, leftY + idx * 4);
              });
              leftY += (wrappedText.length - 1) * 4;
            }

            leftY += 5;
          } else {
            // Right column
            pdf.setFontSize(8);
            pdf.setTextColor(60, 60, 60);
            pdf.setFont(undefined, "bold");
            pdf.text(field.label, rightColumnX, rightY);
            pdf.setFont(undefined, "normal");

            const cleanedValue = cleanText(field.value);
            const maxWidth = 60;
            const wrappedText = pdf.splitTextToSize(cleanedValue, maxWidth);

            if (wrappedText.length === 1) {
              pdf.text(cleanedValue, rightColumnX + 25, rightY);
            } else {
              // Handle multi-line values
              wrappedText.forEach((line, idx) => {
                pdf.text(line, rightColumnX + 25, rightY + idx * 4);
              });
              rightY += (wrappedText.length - 1) * 4;
            }

            rightY += 5;
          }
        });

        // Adjust card height if right column has more content
        const maxHeight = Math.max(leftY, rightY);
        const actualCardHeight = Math.max(cardHeight, maxHeight - currentY + 5);

        // Redraw border with correct height
        pdf.setDrawColor(220, 220, 220);
        pdf.setLineWidth(0.3);
        pdf.rect(20, currentY, cardWidth, actualCardHeight);

        // Redraw left color accent with correct height
        pdf.setFillColor(...color);
        pdf.rect(20, currentY, 4, actualCardHeight, "F");

        currentY += actualCardHeight + 8;
      };

      // Draw subject cards for this year
      drawSubjectCard(
        "Quran Qaidah",
        progress.qaidah_quran_progress,
        [41, 128, 185],
        "[Q]",
      );
      drawSubjectCard(
        "Islamic Studies",
        progress.islamic_studies_progress,
        [39, 174, 96],
        "[IS]",
      );
      drawSubjectCard(
        "Duas & Surahs",
        progress.dua_surah_progress,
        [142, 68, 173],
        "[DS]",
      );
      drawSubjectCard(
        "Gift for Muslim",
        progress.gift_for_muslim_progress,
        [230, 126, 34],
        "[GM]",
      );

      // Add spacing between years
      currentY += 10;
    });
  } else {
    // No lessons data available
    if (currentY > pageHeight - 50) {
      addNewPage();
      currentY = 40;
    }

    pdf.setFontSize(12);
    pdf.setTextColor(150, 150, 150);
    pdf.text("No academic progress data available", 105, currentY, {
      align: "center",
    });
    currentY += 20;
  }

  // ========== FINAL FOOTER ==========
  const totalPages = pdf.getNumberOfPages();

  // Add page numbers to all pages
  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i);

    // Add footer divider
    pdf.setDrawColor(220, 220, 220);
    pdf.setLineWidth(0.3);
    pdf.line(15, pageHeight - 15, pageWidth - 15, pageHeight - 15);

    // Add page number
    pdf.setFontSize(8);
    pdf.setTextColor(150, 150, 150);
    pdf.text(`Page ${i} of ${totalPages}`, 105, pageHeight - 10, {
      align: "center",
    });
  }

  // Add final footer with contact info on last page
  pdf.setPage(totalPages);

  // Footer background
  pdf.setFillColor(41, 128, 185);
  pdf.rect(0, pageHeight - 25, pageWidth, 25, "F");

  // Contact info
  pdf.setFontSize(7);
  pdf.setTextColor(255, 255, 255);

  const contactLines = [
    "Alyaqeen Academy | 116-118 Church Road, Yardley Birmingham B25 8UX",
    "Phone: 07869636849 | Email: contact@alyaqeen.co.uk | Website: www.alyaqeen.co.uk",
    "Report generated on electronic system. For official copy, contact administration.",
  ];

  contactLines.forEach((line, index) => {
    pdf.text(line, 105, pageHeight - 20 + index * 3.5, { align: "center" });
  });

  return {
    pdfBuffer: Buffer.from(pdf.output("arraybuffer")),
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

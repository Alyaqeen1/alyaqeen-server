// config/generateFeeRefundReport.js
const PDFDocument = require("pdfkit");
const axios = require("axios");
const FormData = require("form-data");

const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET;

// ============================================================
//  ACADEMY POLICIES
//  These are the exact guidelines given to parents/guardians
//  at the time of admission. They are reproduced verbatim in
//  the Fee Refund / Dispute Report as proof of the agreement.
// ============================================================
const ACADEMY_GUIDELINES = [
  {
    n: 1,
    title: "Admission Fee",
    text: "A one-time fee of £20 per course is required before the start of classes.",
  },
  {
    n: 2,
    title: "Monthly Fees",
    text:
      "Fees are made on a monthly basis and are paid upfront for every month in our facility and centre. " +
      "This means the total sum of £50 for each child should be paid from the 1st to the 7th of the month.",
  },
  {
    n: 3,
    title: "Monthly Fees Policy",
    text:
      "Admission before the 10th: Full monthly fee is due, payable within the first 7 days of each month. " +
      "Admission after the 10th: You have two options — (a) pay only for the remaining days of that month, " +
      "then continue with regular monthly payments in the first week of each month; or (b) fix the fee date " +
      "according to the admission date (e.g. if admitted on the 15th, then every month the fee is due on the 15th).",
  },
  {
    n: 4,
    title: "Non-Refundable Fees",
    text:
      "Once the fee has been paid and after submitting the application form, the fee " +
      "(Admission & Monthly Fee) will not be refunded in any case — either by the student leaving " +
      "or by the Academy by withdrawing the student.",
  },
  {
    n: 5,
    title: "Books & Materials",
    text: "Required course books and materials will be paid for by parent(s) and will not be covered by the fees.",
  },
  {
    n: 6,
    title: "Damage to Property",
    text:
      "In the case of any intentionally damaged furniture or equipment (etc.) at the centre, " +
      "the Academy is entitled to require parents to pay for the cost of damage caused by their child.",
  },
  {
    n: 7,
    title: "Termination",
    text: "Alyaqeen Academy can at any time terminate the contract for a legitimate reason.",
  },
  {
    n: 8,
    title: "Student Supervision",
    text:
      "The Academy is only responsible for supervising students up to 10 minutes before and after " +
      "their class time. Please ensure timely drop-off and pick-up.",
  },
  {
    n: 9,
    title: "Dress Code",
    text:
      "While there is no strict uniform, we kindly encourage modest and simple attire. " +
      "Branded or fashion-label clothing is discouraged to help maintain a focused Islamic learning environment.",
  },
  {
    n: 10,
    title: "Progress Reports",
    text:
      "Parents may discuss their child's progress with the Head Teacher by arranging an appointment " +
      "or contacting the Academy at any time. Progress updates will be shared upon request.",
  },
];

const PHOTO_CONSENT_TEXT =
  "We may occasionally take photos or shoot videos during events and award ceremonies for marketing, " +
  "social media and other advertisement purposes, including publishing pictures on leaflets. " +
  "We kindly encourage parents to give us permission to allow their child's/children's pictures/videos " +
  "to be taken/published, as this will be a source of engagement for all students to participate in " +
  "different events. Please note that no names or personal data will be published. We also do not take " +
  "any picture of the female child if she is above 11 years old.";

const CLOSING_STATEMENT =
  "We are honored to be part of your child's educational journey. At Alyaqeen, our mission is to " +
  "nurture strong Islamic values, academic excellence, and a love for learning in a warm and welcoming " +
  "environment. Classes are available for boys and girls aged 5 to 16 years.";

// ============================================================
//  IN-MEMORY CACHE FOR SIGNATURES
//  Prevents re-downloading the same Cloudinary image on every
//  report generation (keyed by URL / base64 string).
// ============================================================
const signatureCache = new Map(); // rawSig -> Buffer

// ============================================================
//  SIGNATURE RESOLVER
//  Accepts:
//    - "data:image/png;base64,..."  (base64 data URI)
//    - "https://res.cloudinary.com/..."  (HTTPS URL)
//    - raw base64 string
//  Returns a Buffer ready for doc.image(), or null.
// ============================================================
async function resolveSignatureBuffer(rawSig) {
  if (!rawSig) return null;
  const sigStr = String(rawSig).trim();
  if (!sigStr || sigStr === "N/A" || sigStr === "null") return null;

  // Cache hit
  if (signatureCache.has(sigStr)) {
    return signatureCache.get(sigStr);
  }

  let imgBuffer = null;

  try {
    // a) Base64 data URI: "data:image/png;base64,...."
    if (sigStr.startsWith("data:image")) {
      const base64 = sigStr.split(",")[1];
      if (base64) {
        imgBuffer = Buffer.from(base64, "base64");
      }
    }
    // b) HTTPS URL (Cloudinary, etc.)
    else if (/^https?:\/\//i.test(sigStr)) {
      const response = await axios.get(sigStr, {
        responseType: "arraybuffer",
        timeout: 15000,
      });
      imgBuffer = Buffer.from(response.data);
    }
    // c) Raw base64 (no prefix)
    else if (/^[A-Za-z0-9+/=\s]+$/.test(sigStr) && sigStr.length > 100) {
      imgBuffer = Buffer.from(sigStr.replace(/\s/g, ""), "base64");
    }
  } catch (err) {
    console.error("Signature fetch/render error:", err.message);
    return null;
  }

  if (imgBuffer && imgBuffer.length > 0) {
    signatureCache.set(sigStr, imgBuffer);
    return imgBuffer;
  }
  return null;
}

// ============================================================
//  GENERATOR
// ============================================================
async function generateFeeRefundReport(studentData, data = {}) {
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
  const reportId = `FEE-REF-${timestamp}-${random}`;
  const reportDate = new Date().toLocaleDateString("en-GB");
  const reportTime = new Date().toLocaleTimeString("en-GB");

  // -------- helpers --------
  const cleanText = (text) => {
    if (!text || text === "N/A" || text === "null") return "N/A";
    return String(text)
      .replace(/[\x00-\x1F\x7F]/g, "")
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

  const checkPageBreak = (needed = 80) => {
    if (currentY + needed > pageHeight - 80) {
      doc.addPage();
      pageNumber++;
      currentY = 60;
    }
  };

  // ===== HEADER =====
  doc.rect(0, 0, doc.page.width, 130).fill("#7b241c");

  doc
    .fillColor("white")
    .font("Helvetica-Bold")
    .fontSize(22)
    .text("ALYAQEEN ACADEMY", 0, 35, { align: "center" });

  doc
    .fontSize(13)
    .font("Helvetica")
    .text("Fee Refund / Dispute Report", 0, 62, { align: "center" });

  doc
    .fontSize(8)
    .fillColor("#fadbd8")
    .text(
      "116-118 Church Road, Yew Tree Lane, Yardley, Birmingham B25 8UX",
      0,
      86,
      {
        align: "center",
      },
    )
    .text(
      "Phone: 07869636849  |  Email: contact@alyaqeen.co.uk  |  Website: www.alyaqeen.co.uk",
      0,
      100,
      { align: "center" },
    );

  currentY = 150;

  // ===== REPORT ID STRIP =====
  doc
    .fontSize(8)
    .fillColor("#666")
    .text(
      `Report ID: ${reportId}   |   Generated: ${reportDate} ${reportTime}`,
      50,
      currentY,
      { width: pageWidth, align: "right" },
    );
  currentY += 20;

  // ===== INTRO NOTICE =====
  checkPageBreak(90);
  doc
    .roundedRect(50, currentY, pageWidth, 80, 6)
    .fillAndStroke("#fdedec", "#e6b0aa");

  doc
    .fillColor("#7b241c")
    .font("Helvetica-Bold")
    .fontSize(11)
    .text(
      "STATEMENT OF ACADEMY POLICIES & PARENT AGREEMENT",
      65,
      currentY + 12,
      {
        width: pageWidth - 30,
      },
    );

  doc
    .fillColor("#333")
    .font("Helvetica")
    .fontSize(9)
    .text(
      "This document reproduces the official guidelines of Alyaqeen Academy that were provided to " +
        "and agreed upon by the parent/guardian at the time of admission. It is issued in support of a " +
        "fee refund or fee dispute enquiry, and confirms the Academy's non-refundable fee policy as " +
        "accepted by the parent/guardian at enrolment.",
      65,
      currentY + 30,
      { width: pageWidth - 30, align: "left" },
    );

  currentY += 95;

  // ===== SECTION 1: GUIDELINES HEADER =====
  doc
    .fillColor("#7b241c")
    .font("Helvetica-Bold")
    .fontSize(14)
    .text("Important Guidelines for Parents & Guardians", 50, currentY);
  currentY += 24;

  // ===== GUIDELINES LIST =====
  ACADEMY_GUIDELINES.forEach((item) => {
    // Estimate lines to reserve vertical space
    const approxCharsPerLine = 95;
    const lines = Math.ceil(item.text.length / approxCharsPerLine);
    const blockHeight = 18 + lines * 13 + 8; // title + text lines + gap

    checkPageBreak(blockHeight + 10);

    // Numbered title
    doc
      .fillColor("#7b241c")
      .font("Helvetica-Bold")
      .fontSize(11)
      .text(`${item.n}. ${item.title}`, 50, currentY, { width: pageWidth });

    currentY += 16;

    // Body text
    doc
      .fillColor("#333")
      .font("Helvetica")
      .fontSize(10)
      .text(item.text, 65, currentY, {
        width: pageWidth - 15,
        align: "justify",
        lineGap: 2,
      });

    currentY = doc.y + 10;
  });

  // ===== PHOTO CONSENT =====
  checkPageBreak(90);
  doc
    .fillColor("#7b241c")
    .font("Helvetica-Bold")
    .fontSize(11)
    .text("Photography & Media Consent", 50, currentY);
  currentY += 16;

  doc
    .fillColor("#333")
    .font("Helvetica")
    .fontSize(10)
    .text(PHOTO_CONSENT_TEXT, 65, currentY, {
      width: pageWidth - 15,
      align: "justify",
      lineGap: 2,
    });
  currentY = doc.y + 14;

  // ===== CLOSING STATEMENT =====
  checkPageBreak(80);
  doc
    .roundedRect(50, currentY, pageWidth, 70, 6)
    .fillAndStroke("#f4f6f7", "#d5dbdb");

  doc
    .fillColor("#2c3e50")
    .font("Helvetica-Oblique")
    .fontSize(10)
    .text(CLOSING_STATEMENT, 65, currentY + 14, {
      width: pageWidth - 30,
      align: "justify",
      lineGap: 2,
    });

  currentY += 85;

  // ===== SECTION 2: PARENT AGREEMENT & SIGNATURE =====
  checkPageBreak(240);

  doc
    .fillColor("#7b241c")
    .font("Helvetica-Bold")
    .fontSize(14)
    .text("Parent / Guardian Agreement & Signature", 50, currentY);
  currentY += 22;

  doc
    .fillColor("#333")
    .font("Helvetica")
    .fontSize(10)
    .text(
      "By signing below, the parent/guardian confirms that they have read, understood, and agreed to " +
        "the above guidelines of Alyaqeen Academy, including the non-refundable fee policy (Guideline 4), " +
        "at the time of the student's admission.",
      50,
      currentY,
      { width: pageWidth, align: "justify", lineGap: 2 },
    );

  currentY = doc.y + 25;

  // --- Agreement box ---
  const boxHeight = 210;
  checkPageBreak(boxHeight + 20);

  doc
    .roundedRect(50, currentY, pageWidth, boxHeight, 6)
    .fillAndStroke("#f9f9f9", "#e0e0e0");

  let y = currentY + 18;

  // Parent name
  doc
    .fillColor("#555")
    .font("Helvetica-Bold")
    .fontSize(10)
    .text("Parent / Guardian Name:", 65, y);
  doc
    .fillColor("#333")
    .font("Helvetica")
    .fontSize(11)
    .text(
      cleanText(
        studentData?.father?.name ||
          studentData?.mother?.name ||
          studentData?.family_name ||
          "N/A",
      ),
      220,
      y,
      { width: pageWidth - 190 },
    );

  y += 28;

  // Student name
  doc
    .fillColor("#555")
    .font("Helvetica-Bold")
    .fontSize(10)
    .text("Student Name:", 65, y);
  doc
    .fillColor("#333")
    .font("Helvetica")
    .fontSize(11)
    .text(cleanText(studentData?.name || "N/A"), 220, y, {
      width: pageWidth - 190,
    });

  y += 28;

  // Signed on
  doc
    .fillColor("#555")
    .font("Helvetica-Bold")
    .fontSize(10)
    .text("Signed on (Admission Date):", 65, y);
  doc
    .fillColor("#333")
    .font("Helvetica")
    .fontSize(11)
    .text(
      formatDate(studentData?.startingDate || studentData?.createdAt),
      260,
      y,
    );

  y += 35;

  // --- Signature label ---
  doc
    .fillColor("#555")
    .font("Helvetica-Bold")
    .fontSize(10)
    .text("Parent / Guardian Signature:", 65, y);

  y += 20;

  // ===== SIGNATURE RENDERING (supports Cloudinary URLs, base64, etc.) =====
  const signatureY = y;
  const signatureWidth = 180;
  const signatureHeight = 50;

  const imgBuffer = await resolveSignatureBuffer(studentData?.signature);

  if (imgBuffer) {
    try {
      doc.image(imgBuffer, 65, signatureY, {
        fit: [signatureWidth, signatureHeight],
        align: "left",
        valign: "center",
      });
    } catch (err) {
      console.error("Signature draw error:", err.message);
      doc
        .fillColor("#999")
        .font("Helvetica-Oblique")
        .fontSize(10)
        .text(
          "[Signature on file — could not be rendered]",
          65,
          signatureY + 12,
        );
    }
  } else {
    doc
      .fillColor("#999")
      .font("Helvetica-Oblique")
      .fontSize(10)
      .text("[Signature on file with admission form]", 65, signatureY + 12);
  }

  // Signature underline
  doc
    .moveTo(65, signatureY + 62)
    .lineTo(300, signatureY + 62)
    .strokeColor("#999")
    .lineWidth(1)
    .stroke();

  currentY += boxHeight + 20;

  // ===== SECTION 3: OFFICIAL STATEMENT =====
  checkPageBreak(160);

  doc
    .fillColor("#7b241c")
    .font("Helvetica-Bold")
    .fontSize(14)
    .text("Official Statement", 50, currentY);
  currentY += 22;

  doc
    .roundedRect(50, currentY, pageWidth, 110, 6)
    .fillAndStroke("#fdf2e9", "#f5cba7");

  doc
    .fillColor("#333")
    .font("Helvetica")
    .fontSize(10)
    .text(
      "Based on the guidelines above, which the parent/guardian accepted at the time of admission, " +
        "all fees paid to Alyaqeen Academy — including the admission fee and all monthly fees — are " +
        "strictly non-refundable. The Academy's position, as set out in Guideline 4, applies regardless " +
        "of whether the student leaves voluntarily or is withdrawn by the Academy for a legitimate reason. " +
        "Any refund request will be reviewed by the Academy administration in accordance with these terms.",
      65,
      currentY + 16,
      { width: pageWidth - 30, align: "justify", lineGap: 2 },
    );

  currentY += 130;

  // ===== FOOTER ON EVERY PAGE =====
  doc.on("end", () => {
    const range = doc.bufferedPageRange();
    const totalPages = range.count;

    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);

      doc
        .moveTo(50, doc.page.height - 55)
        .lineTo(doc.page.width - 50, doc.page.height - 55)
        .strokeColor("#ddd")
        .lineWidth(1)
        .stroke();

      doc
        .fontSize(8)
        .fillColor("gray")
        .text(
          `Page ${i - range.start + 1} of ${totalPages}`,
          0,
          doc.page.height - 45,
          { align: "center" },
        );

      doc
        .fontSize(7)
        .fillColor("#999")
        .text(
          `Fee Refund / Dispute Report  |  Report ID: ${reportId}  |  Generated: ${reportDate}`,
          0,
          doc.page.height - 32,
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
    fileName: `fee_refund_report_${studentData.student_id || studentData._id}_${timestamp}.pdf`,
    reportDate,
  };
}

// ============================================================
//  CLOUDINARY UPLOADER
// ============================================================
async function uploadToCloudinary(pdfBuffer, fileName) {
  try {
    const base64Data = pdfBuffer.toString("base64");
    const dataUrl = `data:application/pdf;base64,${base64Data}`;

    const formData = new FormData();
    formData.append("file", dataUrl);
    formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    formData.append("public_id", `fee-refund-reports/${fileName}`);
    formData.append("folder", "fee-refund-reports");

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

exports.generateFeeRefundReport = generateFeeRefundReport;
exports.uploadToCloudinary = uploadToCloudinary;
exports.ACADEMY_GUIDELINES = ACADEMY_GUIDELINES;

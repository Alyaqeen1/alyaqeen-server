require("dotenv").config();
const SibApiV3Sdk = require("sib-api-v3-sdk");

const getMonthName = (num) =>
  new Date(2000, Number(num) - 1).toLocaleString("en-US", { month: "long" });
const DISABLED_FAMILY_EMAILS = [
  "vezzaa786@hotmail.co.uk", // Amjad family
];
const sendMonthlyFeeEmail = async ({
  to,
  parentName,
  students,
  totalAmount,
  method = "Selected Method",
  paymentDate = new Date(),
  isOnHold = false,
  remainingAmount = 0,
  isPartialPayment = false,
}) => {
  if (DISABLED_FAMILY_EMAILS.includes(to)) {
    console.log(`🚫 EMAIL BLOCKED: ${parentName} <${to}>`);
    return; // Exit without sending
  }
  const defaultClient = SibApiV3Sdk.ApiClient.instance;
  const apiKey = defaultClient.authentications["api-key"];
  apiKey.apiKey = process.env.BREVO_PASS;

  const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

  // ✅ GET ALL UNIQUE PAID MONTHS FROM STUDENTS DATA
  const allPaidMonthsSet = new Set();

  students.forEach((student) => {
    student.monthsPaid?.forEach((month) => {
      if (month.paid > 0) {
        // Create a unique formatted month-year string
        const monthKey = `${getMonthName(month.month)} ${month.year}`;
        allPaidMonthsSet.add(monthKey);
      }
    });
  });

  // Convert Set to Array and sort by date (most recent first)
  const allPaidMonths = Array.from(allPaidMonthsSet).sort((a, b) => {
    // Convert month names back to dates for sorting
    const dateA = new Date(a);
    const dateB = new Date(b);
    return dateB - dateA;
  });

  // ✅ CREATE MONTHS TEXT FOR SUBJECT AND CONTENT
  let monthsText = "";
  let monthsTextForSubject = [...allPaidMonths]; // Copy for subject

  if (allPaidMonths.length > 0) {
    if (allPaidMonths.length === 1) {
      monthsText = ` for ${allPaidMonths[0]}`;
    } else if (allPaidMonths.length === 2) {
      monthsText = ` for ${allPaidMonths[0]} and ${allPaidMonths[1]}`;
    } else {
      const lastMonth = allPaidMonths[allPaidMonths.length - 1];
      const otherMonths = allPaidMonths.slice(0, -1);
      monthsText = ` for ${otherMonths.join(", ")} and ${lastMonth}`;
    }
  }

  const studentDetailsHtml = students
    .map((student, index) => {
      const { name, monthsPaid = [] } = student;

      // ✅ Calculate student totals
      const studentTotalPaid = monthsPaid.reduce(
        (sum, m) => sum + (m.paid || 0),
        0,
      );
      const studentExpectedTotal = monthsPaid.reduce(
        (sum, m) => sum + (m.discountedFee || m.monthlyFee || 0),
        0,
      );
      const studentRemaining = Math.max(
        0,
        studentExpectedTotal - studentTotalPaid,
      );

      const monthsHtml = monthsPaid
        .map((m) => {
          const monthPaid = m.paid || 0;
          const monthExpected = m.discountedFee || m.monthlyFee || 0;
          const monthRemaining = Math.max(0, monthExpected - monthPaid);
          return `<li>${getMonthName(m.month)} ${m.year}: 
        Paid: £${monthPaid.toFixed(2)} | 
        Expected: £${monthExpected.toFixed(2)} |
        Remaining: £${monthRemaining.toFixed(2)}
      </li>`;
        })
        .join("");

      return `
        <p><strong>${index + 1}. ${name}</strong></p>
        <ul>${monthsHtml}</ul>
        <p><strong>Student Total:</strong> Paid: £${studentTotalPaid.toFixed(
          2,
        )} | Expected: £${studentExpectedTotal.toFixed(
          2,
        )} | Remaining: £${studentRemaining.toFixed(2)}</p>
        <br/>
      `;
    })
    .join("");

  // ✅ Format the actual payment date
  const formattedDate = new Date(paymentDate).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  // ✅ DIFFERENT MESSAGES FOR PARTIAL VS FULL PAYMENTS - USING ALL MONTHS
  const messageIntro = isOnHold
    ? `<p>We have <strong>recorded</strong> your payment of <strong>£${totalAmount.toFixed(
        2,
      )}</strong> via <strong>${method}</strong> on ${formattedDate}${monthsText}.</p>
       <p><em>Your payment is currently under review and will be confirmed by our administration shortly.</em></p>`
    : isPartialPayment
      ? `<p>We have received your <strong>additional payment of £${totalAmount.toFixed(
          2,
        )}</strong> via <strong>${method}</strong> on ${formattedDate}${monthsText}.</p>`
      : `<p>We have received your <strong>payment of £${totalAmount.toFixed(
          2,
        )}</strong> via <strong>${method}</strong> on ${formattedDate}${monthsText}.</p>`;

  // ✅ Calculate if ALL monthly fees are fully paid
  const allMonthsFullyPaid = students.every((student) => {
    const monthsPaid = student.monthsPaid || [];
    return monthsPaid.every(
      (month) =>
        (month.paid || 0) >= (month.discountedFee || month.monthlyFee || 0),
    );
  });

  // ✅ REMAINING AMOUNT SECTION - Check if ALL months are fully paid
  const remainingSection = !allMonthsFullyPaid
    ? `<p><strong>Total Remaining Balance:</strong> £${remainingAmount.toFixed(
        2,
      )}</p>
       <p>Please pay the remaining amount at your earliest convenience.</p>`
    : `<p><strong>Payment Status:</strong> Fully Paid ✅</p>`;

  // ✅ DIFFERENT SUBJECT FOR ALL PAYMENT TYPES - INCLUDING ALL MONTHS
  let emailSubject = "";

  if (isOnHold) {
    emailSubject = "🕒 Payment Acknowledged - Awaiting Confirmation";
  } else if (isPartialPayment) {
    // For partial payments - show specific months
    if (monthsTextForSubject.length === 1) {
      emailSubject = `💰 Additional Payment for ${monthsTextForSubject[0]} - Alyaqeen`;
    } else if (monthsTextForSubject.length === 2) {
      emailSubject = `💰 Additional Payment for ${monthsTextForSubject[0]} & ${monthsTextForSubject[1]} - Alyaqeen`;
    } else if (monthsTextForSubject.length === 3) {
      emailSubject = `💰 Additional Payment for ${monthsTextForSubject[0]}, ${monthsTextForSubject[1]} & ${monthsTextForSubject[2]} - Alyaqeen`;
    } else {
      emailSubject = `💰 Additional Payment for ${monthsTextForSubject.length} Months - Alyaqeen`;
    }
  } else {
    // For full payments - show specific months
    if (monthsTextForSubject.length === 1) {
      emailSubject = `📅 ${monthsTextForSubject[0]} Fee Payment Confirmation - Alyaqeen`;
    } else if (monthsTextForSubject.length === 2) {
      emailSubject = `📅 ${monthsTextForSubject[0]} & ${monthsTextForSubject[1]} Fee Payment Confirmation - Alyaqeen`;
    } else if (monthsTextForSubject.length === 3) {
      emailSubject = `📅 ${monthsTextForSubject[0]}, ${monthsTextForSubject[1]} & ${monthsTextForSubject[2]} Fee Payment Confirmation - Alyaqeen`;
    } else {
      emailSubject = `📅 ${monthsTextForSubject.length} Months Fee Payment Confirmation - Alyaqeen`;
    }
  }

  const sendSmtpEmail = {
    sender: {
      name: "Alyaqeen",
      email: process.env.BREVO_USER,
    },
    to: [
      {
        email: to,
        name: parentName,
      },
    ],
    subject: emailSubject,
    htmlContent: `
      <p>Dear <strong>${parentName}</strong>,</p>
      ${messageIntro}
      <br/>
      <p><strong>Payment Breakdown by Student:</strong></p>
      ${studentDetailsHtml}
      <p><strong>Overall Summary:</strong></p>
      <p><strong>Amount Paid This Time:</strong> £${totalAmount.toFixed(2)}</p>
      ${remainingSection}
      <br/>
      <p>Thank you for supporting your child's education.</p>
      <p>JazakumAllahu khayran for your support.</p>
      <p>Warm regards,<br/>Alyaqeen Team</p>
    `,
  };

  try {
    await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log(
      `✅ Monthly fee email sent for ${
        allPaidMonths.length
      } month(s): ${allPaidMonths.join(", ")}`,
    );
  } catch (error) {
    console.error(
      "❌ Failed to send monthly fee email:",
      error.response?.body || error.message,
    );
  }
};

module.exports = sendMonthlyFeeEmail;

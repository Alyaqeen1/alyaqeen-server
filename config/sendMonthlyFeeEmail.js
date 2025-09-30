require("dotenv").config();
const SibApiV3Sdk = require("sib-api-v3-sdk");

const getMonthName = (num) =>
  new Date(2000, Number(num) - 1).toLocaleString("en-US", { month: "long" });

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
  // if (process.env.EMAIL_SENDING_ENABLED !== "true") {
  //   console.log(
  //     "🚫 Email sending is disabled (test mode). Skipping email to:",
  //     to
  //   );
  //   return;
  // }

  const defaultClient = SibApiV3Sdk.ApiClient.instance;
  const apiKey = defaultClient.authentications["api-key"];
  apiKey.apiKey = process.env.BREVO_PASS;

  const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

  // ✅ AUTOMATICALLY DETECT THE PAID MONTH FROM STUDENTS DATA
  let paidMonthName = "";
  let paidYear = "";

  // Find the most recent month that received payment in this transaction
  const allPaidMonths = [];

  students.forEach((student) => {
    student.monthsPaid?.forEach((month) => {
      if (month.paid > 0) {
        allPaidMonths.push({
          month: month.month,
          year: month.year,
          paid: month.paid,
        });
      }
    });
  });

  // Sort by most recent month
  if (allPaidMonths.length > 0) {
    allPaidMonths.sort((a, b) => {
      const dateA = new Date(a.year, a.month - 1);
      const dateB = new Date(b.year, b.month - 1);
      return dateB - dateA;
    });

    const latestPaidMonth = allPaidMonths[0];
    paidMonthName = getMonthName(latestPaidMonth.month);
    paidYear = latestPaidMonth.year;
  }

  const studentDetailsHtml = students
    .map((student, index) => {
      const { name, monthsPaid = [] } = student;

      // ✅ Calculate student totals
      const studentTotalPaid = monthsPaid.reduce(
        (sum, m) => sum + (m.paid || 0),
        0
      );
      const studentExpectedTotal = monthsPaid.reduce(
        (sum, m) => sum + (m.discountedFee || m.monthlyFee || 0),
        0
      );
      const studentRemaining = studentExpectedTotal - studentTotalPaid;

      const monthsHtml = monthsPaid
        .map(
          (m) =>
            `<li>${getMonthName(m.month)} ${m.year}: 
       Paid: £${(m.paid || 0).toFixed(2)} | 
       Expected: £${(m.discountedFee || m.monthlyFee || 0).toFixed(2)} |
       Remaining: £${(
         (m.discountedFee || m.monthlyFee || 0) - (m.paid || 0)
       ).toFixed(2)}
       </li>`
        )
        .join("");

      return `
        <p><strong>${index + 1}. ${name}</strong></p>
        <ul>${monthsHtml}</ul>
        <p><strong>Student Total:</strong> Paid: £${studentTotalPaid.toFixed(
          2
        )} | Expected: £${studentExpectedTotal.toFixed(
        2
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

  // ✅ DIFFERENT MESSAGES FOR PARTIAL VS FULL PAYMENTS - INCLUDING DETECTED MONTH/YEAR
  const monthYearText = paidMonthName
    ? ` for ${paidMonthName} ${paidYear}`
    : "";

  const messageIntro = isOnHold
    ? `<p>We have <strong>recorded</strong> your payment of <strong>£${totalAmount.toFixed(
        2
      )}</strong> via <strong>${method}</strong> on ${formattedDate}${monthYearText}.</p>
       <p><em>Your payment is currently under review and will be confirmed by our administration shortly.</em></p>`
    : isPartialPayment
    ? `<p>We have received your <strong>additional payment of £${totalAmount.toFixed(
        2
      )}</strong> via <strong>${method}</strong> on ${formattedDate}${monthYearText}.</p>`
    : `<p>We have received your <strong>payment of £${totalAmount.toFixed(
        2
      )}</strong> via <strong>${method}</strong> on ${formattedDate}${monthYearText}.</p>`;

  // ✅ Calculate if ALL monthly fees are fully paid
  const allMonthsFullyPaid = students.every((student) => {
    const monthsPaid = student.monthsPaid || [];
    return monthsPaid.every(
      (month) =>
        (month.paid || 0) >= (month.discountedFee || month.monthlyFee || 0)
    );
  });

  // ✅ REMAINING AMOUNT SECTION - Check if ALL months are fully paid
  const remainingSection = !allMonthsFullyPaid
    ? `<p><strong>Total Remaining Balance:</strong> £${remainingAmount.toFixed(
        2
      )}</p>
       <p>Please pay the remaining amount at your earliest convenience.</p>`
    : `<p><strong>Payment Status:</strong> Fully Paid ✅</p>`;

  // ✅ DIFFERENT SUBJECT FOR PARTIAL PAYMENTS - INCLUDING DETECTED MONTH/YEAR
  const emailSubject = isOnHold
    ? "🕒 Payment Acknowledged - Awaiting Confirmation"
    : isPartialPayment
    ? `💰 Additional Payment for ${paidMonthName} ${paidYear} - Alyaqeen`
    : `📅 ${paidMonthName} ${paidYear} Fee Payment Confirmation - Alyaqeen`;

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
    console.log(`✅ Monthly fee email sent for ${paidMonthName} ${paidYear}`);
  } catch (error) {
    console.error(
      "❌ Failed to send monthly fee email:",
      error.response?.body || error.message
    );
  }
};

module.exports = sendMonthlyFeeEmail;

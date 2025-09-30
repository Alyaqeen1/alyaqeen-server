require("dotenv").config();
const SibApiV3Sdk = require("sib-api-v3-sdk");
const sessionMap = require("./sessionMap");
const { isValid } = require("date-fns"); // ✅ ADD THIS IMPORT

const sendEmailViaAPI = async ({
  to,
  parentName,
  students,
  totalAmount,
  method = "Selected Method",
  paymentDate = null,
  remainingAmount = 0,
  studentBreakdown = [],
  isPartialPayment = false, // ✅ ADD THIS FLAG
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

  const studentsWithBreakdown =
    studentBreakdown.length > 0
      ? studentBreakdown
      : students.map((student) => {
          const admissionFee = student.admissionFee || 20;
          const monthlyFee = student.monthlyFee || 50;
          const totalPaid = student.subtotal || 0;

          const admissionPaid = Math.min(totalPaid, admissionFee);
          const monthlyPaid = Math.max(0, totalPaid - admissionFee);
          const admissionRemaining = Math.max(0, admissionFee - admissionPaid);
          const monthlyRemaining = Math.max(0, monthlyFee - monthlyPaid);
          const studentRemaining = admissionRemaining + monthlyRemaining;

          return {
            ...student,
            admissionPaid,
            monthlyPaid,
            admissionRemaining,
            monthlyRemaining,
            studentRemaining,
          };
        });

  const studentDetailsHtml = studentsWithBreakdown
    .map((student, index) => {
      const {
        name,
        startingDate,
        academic = {},
        admissionFee = 20,
        monthlyFee = 50,
        admissionPaid = 0,
        monthlyPaid = 0,
        admissionRemaining = 0,
        monthlyRemaining = 0,
        studentRemaining = 0,
      } = student;

      const formattedStartDate =
        startingDate && !isNaN(new Date(startingDate))
          ? new Date(startingDate).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })
          : "To be confirmed";

      const {
        department = "-",
        session = "-",
        class: className = "-",
        time,
      } = academic;

      return `
      <p><strong>${index + 1}. ${name}</strong></p>
      <p><strong>Admission Details:</strong></p>
      <ul>
        <li><strong>Department:</strong> ${department}</li>
        <li><strong>Class:</strong> ${className}</li>
        <li><strong>Session:</strong> ${session}</li>
        <li><strong>Starting Date:</strong> ${formattedStartDate}</li>
      </ul>
      <p><strong>Fee Breakdown:</strong></p>
      <ul>
        <li><strong>Admission Fee:</strong> £${admissionFee.toFixed(2)} 
            (Paid: £${admissionPaid.toFixed(
              2
            )} | Remaining: £${admissionRemaining.toFixed(2)})</li>
        <li><strong>First Month Fee:</strong> £${monthlyFee.toFixed(2)} 
            (Paid: £${monthlyPaid.toFixed(
              2
            )} | Remaining: £${monthlyRemaining.toFixed(2)})</li>
        <li><strong>Student Total Paid:</strong> £${(
          admissionPaid + monthlyPaid
        ).toFixed(2)}</li>
        <li><strong>Student Total Remaining:</strong> £${studentRemaining.toFixed(
          2
        )}</li>
      </ul>
      <br/>
    `;
    })
    .join("");

  // ✅ USE ACTUAL PAYMENT DATE
  const paymentDateText = paymentDate
    ? new Date(paymentDate).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "recently";

  // ✅ DIFFERENT MESSAGES FOR PARTIAL VS INITIAL PAYMENTS
  const messageIntro = isPartialPayment
    ? `<p>We have received your <strong>additional payment of £${totalAmount.toFixed(
        2
      )}</strong> towards the remaining balance via <strong>${method}</strong> on <strong>${paymentDateText}</strong>.</p>
     <p>This payment of <strong>£${totalAmount.toFixed(
       2
     )}</strong> has been applied to your outstanding fees.</p>`
    : `<p>We have received your <strong>admission payment of £${totalAmount.toFixed(
        2
      )}</strong> via <strong>${method}</strong> on <strong>${paymentDateText}</strong>.</p>`;
  // ✅ UPDATE THE SUMMARY TO SHOW BOTH
  const paymentSummary = isPartialPayment
    ? `<p><strong>Amount Paid This Time:</strong> £${totalAmount.toFixed(2)}</p>
     <p><strong>Total Amount Received So Far:</strong> £${studentsWithBreakdown
       .reduce((sum, student) => sum + student.subtotal, 0)
       .toFixed(2)}</p>`
    : `<p><strong>Total Amount Received:</strong> £${totalAmount.toFixed(
        2
      )}</p>`;

  // ✅ REMINING AMOUNT SECTION
  const remainingSection =
    remainingAmount > 0
      ? `<p><strong>Total Remaining Balance:</strong> £${remainingAmount.toFixed(
          2
        )}</p>
       <p>Please pay the remaining amount at your earliest convenience to complete the admission process.</p><br/>`
      : `<p><strong>Admission Status:</strong> Fully Completed ✅</p>
       <p>Your admission process is now complete. Welcome to Alyaqeen!</p><br/>`;

  // ✅ DIFFERENT SUBJECT FOR PARTIAL PAYMENTS
  const emailSubject = isPartialPayment
    ? "💰 Additional Payment Received - Alyaqeen"
    : "✅ Admission Fee Payment - Alyaqeen";

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
      ${studentDetailsHtml}
      <p><strong>Overall Summary:</strong></p>
      ${paymentSummary}
      ${remainingSection}
      ${
        isPartialPayment
          ? `<p><em>Thank you for your continued support. Your student's admission remains active.</em></p>`
          : `<p>Your student(s) admission process has been initiated. Full access to classes will be granted upon complete payment.</p>`
      }
      <br/>
      <p>Thank you for choosing Alyaqeen.</p>
      <p>JazakumAllahu khayran for your support.</p>
      <p>Warm regards,<br />Alyaqeen Team</p>
    `,
  };

  try {
    await apiInstance.sendTransacEmail(sendSmtpEmail);
  } catch (error) {
    console.error(
      "❌ Failed to send email via Brevo API:",
      error.response?.body || error.message
    );
  }
};

module.exports = sendEmailViaAPI;

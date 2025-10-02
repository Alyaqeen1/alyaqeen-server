require("dotenv").config();
const SibApiV3Sdk = require("sib-api-v3-sdk");
const sessionMap = require("./sessionMap");
const { isValid } = require("date-fns");

const sendEmailViaAPI = async ({
  to,
  parentName,
  students,
  totalAmount,
  method = "Selected Method",
  paymentDate = null,
  studentBreakdown = [],
  isEnrollmentConfirmed = true, // ✅ ADD THIS FLAG
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

  // ✅ SIMPLIFIED: Only use basic student info without breakdown calculations
  const studentsForEmail =
    studentBreakdown.length > 0 ? studentBreakdown : students;

  const studentDetailsHtml = studentsForEmail
    .map((student, index) => {
      const {
        name,
        startingDate,
        academic = {},
        subtotal = 0, // ✅ Only show what was actually paid
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
      <div style="margin-bottom: 20px; padding: 15px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <p style="margin: 0 0 10px 0; font-size: 16px; color: #2c5aa0;">
          <strong>${index + 1}. ${name}</strong>
        </p>
        <p style="margin: 10px 0 5px 0;"><strong>Admission Details:</strong></p>
        <ul style="margin: 0 0 10px 0; padding-left: 20px;">
          <li><strong>Department:</strong> ${department}</li>
          <li><strong>Class:</strong> ${className}</li>
          <li><strong>Session:</strong> ${session}</li>
          <li><strong>Starting Date:</strong> ${formattedStartDate}</li>
        </ul>
        <p style="margin: 10px 0 5px 0;"><strong>Payment Summary:</strong></p>
        <ul style="margin: 0; padding-left: 20px;">
          <li><strong>Amount Paid:</strong> £${subtotal.toFixed(2)}</li>
          <li><strong>Status:</strong> ✅ Enrollment Confirmed</li>
        </ul>
      </div>
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

  // ✅ SIMPLIFIED MESSAGE - ONLY SHOW PAID AMOUNT AND ENROLLMENT
  const messageIntro = `
    <p>We have successfully received your <strong>admission payment of £${totalAmount.toFixed(
      2
    )}</strong> via <strong>${method}</strong> on <strong>${paymentDateText}</strong>.</p>
    <p>Your student(s) have been <strong>successfully enrolled</strong> at Alyaqeen!</p>
  `;

  // ✅ SIMPLIFIED SUMMARY - ONLY SHOW TOTAL PAID
  const paymentSummary = `
    <div style="background-color: #f8f9fa; padding: 15px; border-radius: 8px; margin: 15px 0;">
      <p style="margin: 0 0 10px 0; font-size: 16px; color: #2c5aa0;">
        <strong>Payment Confirmation</strong>
      </p>
      <p style="margin: 5px 0;"><strong>Total Amount Paid:</strong> £${totalAmount.toFixed(
        2
      )}</p>
      <p style="margin: 5px 0;"><strong>Payment Method:</strong> ${method}</p>
      <p style="margin: 5px 0;"><strong>Payment Date:</strong> ${paymentDateText}</p>
    </div>
  `;

  // ✅ ENROLLMENT CONFIRMATION SECTION
  const enrollmentSection = `
    <div style="background-color: #d4edda; padding: 15px; border-radius: 8px; margin: 15px 0;">
      <p style="margin: 0; color: #155724; font-weight: bold;">
        ✅ Enrollment Successfully Completed
      </p>
      <p style="margin: 10px 0 0 0; color: #155724;">
        Your student(s) are now officially enrolled and can start attending classes according to their schedule.
      </p>
    </div>
  `;

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
    subject: "✅ Enrollment Confirmed - Alyaqeen", // ✅ SIMPLIFIED SUBJECT
    htmlContent: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <p>Dear <strong>${parentName}</strong>,</p>
        
        ${messageIntro}
        
        ${enrollmentSection}
        
        <p><strong>Student Enrollment Details:</strong></p>
        ${studentDetailsHtml}
        
        ${paymentSummary}
        
        <p>Your student(s) are now ready to begin their educational journey with us. 
           Welcome to the Alyaqeen family!</p>
           
        <p>If you have any questions about the class schedule or need further assistance, 
           please don't hesitate to contact us.</p>
           
        <br/>
        <p>Thank you for choosing Alyaqeen.</p>
        <p>JazakumAllahu khayran for your trust and support.</p>
        <p>Warm regards,<br />
           <strong>Alyaqeen Team</strong></p>
      </div>
    `,
  };

  try {
    await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log("✅ Enrollment confirmation email sent successfully to:", to);
  } catch (error) {
    console.error(
      "❌ Failed to send email via Brevo API:",
      error.response?.body || error.message
    );
  }
};

module.exports = sendEmailViaAPI;

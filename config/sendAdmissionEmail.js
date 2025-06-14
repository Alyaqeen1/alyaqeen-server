require("dotenv").config();
const SibApiV3Sdk = require("sib-api-v3-sdk");

const sendEmailViaAPI = async ({
  to,
  parentName,
  students,
  totalAmount,
  method = "Selected Method",
}) => {
  const defaultClient = SibApiV3Sdk.ApiClient.instance;
  const apiKey = defaultClient.authentications["api-key"];
  apiKey.apiKey = process.env.BREVO_PASS;

  const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

  const studentDetailsHtml = students
    .map((student, index) => {
      const {
        name,
        startingDate,
        academic = {},
        admissionFee = 0,
        monthly_fee = 0,
      } = student;

      const formattedStartDate = new Date(startingDate).toLocaleDateString(
        "en-GB",
        {
          day: "numeric",
          month: "short",
          year: "numeric",
        }
      );

      const {
        department = "-",
        session = "-",
        class: className = "-",
        time = "-",
      } = academic;

      return `
      <p><strong>${index + 1}. ${name}</strong></p>
      <p>You have been admitted to:</p>
      <ul>
        <li><strong>Department:</strong> ${department}</li>
        <li><strong>Class:</strong> ${className}</li>
        <li><strong>Session:</strong> ${session}</li>
        <li><strong>Time:</strong> ${time}</li>
        <li><strong>Admission Fee:</strong> €${admissionFee.toFixed(2)}</li>
        <li><strong>First Month Fee:</strong> €${monthly_fee.toFixed(2)}</li>
        <li><strong>Starting Date:</strong> ${formattedStartDate}</li>
      </ul>
      <br/>
    `;
    })
    .join("");

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
    subject: "✅ Admission Fee Confirmation - Alyaqeen",
    htmlContent: `
  <p>Dear <strong>${parentName}</strong>,</p>
  <p>We have received your admission payment of <strong>€${totalAmount.toFixed(
    2
  )}</strong> via <strong>${method} method</strong>.</p>
  <br/>
  ${studentDetailsHtml}
  <p><strong>Total Amount Received:</strong> €${totalAmount.toFixed(2)}</p>
  <br/>
  <p>Your student(s) have been successfully admitted and are now welcome to attend the academy.</p>
  <br/>
  <p>Thank you for choosing Alyaqeen. If you have any questions, please reply to this email.</p>
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

require("dotenv").config();
const SibApiV3Sdk = require("sib-api-v3-sdk");

const sendEmailViaAPI = async ({
  to,
  name,
  amount,
  department,
  session,
  class: className,
  time,
}) => {
  const defaultClient = SibApiV3Sdk.ApiClient.instance;
  const apiKey = defaultClient.authentications["api-key"];
  apiKey.apiKey = process.env.BREVO_PASS;

  const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

  const sendSmtpEmail = {
    sender: {
      name: "Alyaqeen",
      email: process.env.BREVO_USER, // must be Brevo-verified
    },
    to: [
      {
        email: to,
        name,
      },
    ],
    subject: "✅ Admission Fee Confirmation - Alyaqeen",
    htmlContent: `
      <p>Dear <strong>${name}</strong>,</p>
      <p>We have successfully received your <strong>admission fee of €${amount}</strong>.</p>
      <p>You have been admitted to:</p>
      <ul>
        <li><strong>Department:</strong> ${department}</li>
        <li><strong>Class:</strong> ${className}</li>
        <li><strong>Session:</strong> ${session}</li>
        <li><strong>Time:</strong> ${time}</li>
      </ul>
      <br />
      <p>Welcome to Alyaqeen! If you have any questions, feel free to reply to this email.</p>
      <br />
      <p>Warm regards,<br />Alyaqeen Team</p>
    `,
  };

  try {
    const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
  } catch (error) {
    console.error(
      "❌ Failed to send email via Brevo API:",
      error.response?.body || error.message
    );
  }
};

module.exports = sendEmailViaAPI;

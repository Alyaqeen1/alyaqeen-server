require("dotenv").config();
const SibApiV3Sdk = require("sib-api-v3-sdk");

const sendApprovalEmail = async ({ to, name, studentName }) => {
  if (process.env.EMAIL_SENDING_ENABLED !== "true") {
    console.log(
      "🚫 Email sending is disabled (test mode). Skipping email to:",
      to
    );
    return;
  }
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
    subject: "⚠️ Action Required: Complete Your Child’s Admission – Alyaqeen",
    htmlContent: `
      <p>Dear <strong>${name}</strong>,</p>
      <p>We’re happy to inform you that your child ${studentName} has been approved for admission to Alyaqeen.</p>
      <p>To complete the enrollment process, we kindly ask you to take the next step. Please visit our website and log in to your account to proceed with the necessary actions (e.g., fee payment).</p>
           <p>🔗 Website: https://www.alyaqeen.co.uk/login.</p>
           <p>(Use your registered email and password to log in.)</p>
           <p>If you need any help or have questions, feel free to reply to this email.</p>
           <p>Thank you for choosing Alyaqeen. We’re looking forward to welcoming your child on board!</p>
      <br />
      <p>JazakumAllahu khayran for your support.</p>
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

module.exports = sendApprovalEmail;

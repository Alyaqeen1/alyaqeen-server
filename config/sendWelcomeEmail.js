const SibApiV3Sdk = require("sib-api-v3-sdk");

const sendWelcomeEmail = async ({
  to, // recipient email
  name = "User", // teacher, parent, etc.
  email, // Firebase login email
  tempPassword = "Alyaqeen2025@", // temporary password shown (not used)
  resetLink, // Firebase reset password link
}) => {
  const defaultClient = SibApiV3Sdk.ApiClient.instance;
  const apiKey = defaultClient.authentications["api-key"];
  apiKey.apiKey = process.env.BREVO_PASS;

  const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

  const sendSmtpEmail = {
    sender: {
      name: "Alyaqeen",
      email: process.env.BREVO_USER,
    },
    to: [{ email: to, name }],
    subject: "📩 Welcome to Alyaqeen LMS – Your Account is Ready",
    htmlContent: `
      <p>Dear <strong>${name}</strong>,</p>

      <p>We are pleased to inform you that your account has been successfully created in the <strong>Alyaqeen Learning Management System</strong>.</p>

      <p><strong>Login Email:</strong> ${email}<br/>
      <strong>Temporary Password:</strong> ${tempPassword}</p>

      <p>For your security, please reset your password immediately by clicking the link below:</p>

      <p><a href="${resetLink}" target="_blank">🔐 Reset Your Password</a></p>

      <p><strong>📢 Please Note:</strong> This password reset link has also been sent by Firebase. If you do not see it in your inbox, kindly check your spam or junk folder.</p>

      <p>If you face any issues accessing your account, feel free to contact the administration for help.</p>

      <br/>
      <p>Warm regards,<br/>The Alyaqeen Team</p>
    `,
  };

  try {
    await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log(`✅ Welcome email sent to ${to}`);
  } catch (error) {
    console.error(
      "❌ Failed to send welcome email:",
      error.response?.body || error.message
    );
  }
};

module.exports = sendWelcomeEmail;

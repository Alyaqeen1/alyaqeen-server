require("dotenv").config();
const SibApiV3Sdk = require("sib-api-v3-sdk");

const sendAbsenceFirstReminderEmail = async ({
  to,
  parentName = "Parent",
  studentName = "your child",
}) => {
  if (process.env.EMAIL_SENDING_ENABLED !== "true") {
    console.log(
      "🚫 Email sending is disabled (test mode). Skipping email to:",
      to
    );
    return;
  }
  if (!to || !process.env.BREVO_USER || !process.env.BREVO_PASS) {
    console.error("❌ Missing email credentials or recipient address");
    return;
  }

  const defaultClient = SibApiV3Sdk.ApiClient.instance;
  const apiKey = defaultClient.authentications["api-key"];
  apiKey.apiKey = process.env.BREVO_PASS;

  const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

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
    subject: "❌ Absence – First Reminder (Attendance Reminder for Your Child)",
    htmlContent: `
      <p>Dear <strong>${parentName}</strong>,</p>
      <p>Regular presence is essential for <strong>${studentName}’s</strong> steady learning, especially in the sacred knowledge of Qur’an and Deen. Your child has missed multiple sessions this week.</p>
      <p>We kindly urge you to ensure consistent attendance, as it is part of nurturing commitment and responsibility.</p>
      <p>Please help ensure your child attends regularly.</p>
      <p>JazakumAllahu khayran.</p>
      <br />
      <p>Warm regards,<br />The Alyaqeen Team</p>
    `,
  };

  try {
    await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log("✅ Absence first reminder email sent successfully");
  } catch (error) {
    console.error(
      "❌ Failed to send absence first reminder email:",
      error.response?.body || error.message
    );
  }
};

module.exports = sendAbsenceFirstReminderEmail;

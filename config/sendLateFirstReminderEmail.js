require("dotenv").config();
const SibApiV3Sdk = require("sib-api-v3-sdk");

const sendLateFirstReminderEmail = async ({
  to,
  parentName = "Parent",
  studentName = "your child", // single student name string
}) => {
  // if (process.env.EMAIL_SENDING_ENABLED !== "true") {
  //   console.log(
  //     "🚫 Email sending is disabled (test mode). Skipping email to:",
  //     to
  //   );
  //   return;
  // }
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
    subject:
      "✅ Lateness – First Reminder (Encouragement for Punctual Attendance)",
    htmlContent: `
      <p>Dear <strong>${parentName}</strong>,</p>
      <p>Assalāmu ‘alaykum,</p>
      <p>Punctuality is a beautiful Islamic value that helps build discipline and barakah in learning. We noticed that <strong>${studentName}</strong> arrived late a few times this week.</p>
      <p>We kindly request your support in helping your child arrive on time, in shā’ Allāh.</p>
      <p>JazakumAllahu khayran for your cooperation.</p>
      <br />
      <p>Warm regards,<br />The Alyaqeen Team</p>
    `,
  };

  try {
    await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log("✅ Lateness first reminder email sent successfully");
  } catch (error) {
    console.error(
      "❌ Failed to send lateness first reminder email:",
      error.response?.body || error.message
    );
  }
};

module.exports = sendLateFirstReminderEmail;

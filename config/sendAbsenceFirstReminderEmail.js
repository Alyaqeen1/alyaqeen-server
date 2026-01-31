require("dotenv").config();
const SibApiV3Sdk = require("sib-api-v3-sdk");
const DISABLED_FAMILY_EMAILS = [
  "vezzaa786@hotmail.co.uk", // Amjad family
];
const sendAbsenceFirstReminderEmail = async ({
  to,
  parentName = "Parent",
  studentName = "your child",
}) => {
  // if (process.env.EMAIL_SENDING_ENABLED !== "true") {
  //   console.log(
  //     "🚫 Email sending is disabled (test mode). Skipping email to:",
  //     to
  //   );
  //   return;
  // }
  if (DISABLED_FAMILY_EMAILS.includes(to)) {
    console.log(`🚫 EMAIL BLOCKED: ${parentName} <${to}>`);
    return; // Exit without sending
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
    subject: "❌ Absence – (Attendance Reminder for Your Child)",
    htmlContent: `
      <p>Dear <strong>${parentName}</strong>,</p>
      <p>Assalāmu ‘alaykum,</p>
      <p>Regular attendance is important for steady progress in Qur’ān and Deen, and helps build consistency and responsibility. We noticed that <strong>${studentName}</strong> has missed a few sessions this week.</p>
      <p>We kindly request your support in ensuring regular attendance, in shā’ Allāh.</p>
      <p>JazakumAllahu khayran for your cooperation.</p>
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
      error.response?.body || error.message,
    );
  }
};

module.exports = sendAbsenceFirstReminderEmail;

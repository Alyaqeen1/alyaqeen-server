require("dotenv").config();
const SibApiV3Sdk = require("sib-api-v3-sdk");

const sendApprovalEmail = async ({ to, name, studentName, startingDate }) => {
  if (process.env.EMAIL_SENDING_ENABLED !== "false") {
    console.log(
      "🚫 Email sending is disabled (test mode). Skipping email to:",
      to,
    );
    return;
  }

  const defaultClient = SibApiV3Sdk.ApiClient.instance;
  const apiKey = defaultClient.authentications["api-key"];
  apiKey.apiKey = process.env.BREVO_PASS;

  const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

  const formattedStartingDate = startingDate
    ? new Date(startingDate).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    : "the scheduled starting date";

  const sendSmtpEmail = {
    sender: {
      name: "Alyaqeen",
      email: process.env.BREVO_USER,
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

      <p>
        We’re happy to inform you that your child
        <strong>${studentName}</strong> has been approved for admission to Alyaqeen.
      </p>

      <p>
        To complete the enrollment process, we kindly ask you to take the next step.
        Please visit our website and log in to your account to proceed with the
        necessary actions (e.g., fee payment).
      </p>

      <p>
        🔗 Website:
        <a href="https://www.alyaqeen.co.uk/login">
          https://www.alyaqeen.co.uk/login
        </a>
      </p>

      <p>
        <strong>Starting Date:</strong> ${formattedStartingDate}
      </p>

      <p>
        Once the enrollment process is completed, your child can start attending
        Alyaqeen from <strong>${formattedStartingDate}</strong>.
      </p>

      <p>
        (Use your registered email and password to log in.)
      </p>

      <p>
        If you need any help or have questions, feel free to reply to this email.
      </p>

      <p>
        Thank you for choosing Alyaqeen. We’re looking forward to welcoming
        your child on board!
      </p>

      <br />

      <p>JazakumAllahu khayran for your support.</p>

      <p>
        Warm regards,<br />
        Alyaqeen Team
      </p>
    `,
  };

  try {
    const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log("✅ Approval email sent successfully:", data);
  } catch (error) {
    console.error(
      "❌ Failed to send email via Brevo API:",
      error.response?.body || error.message,
    );
  }
};

module.exports = sendApprovalEmail;

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

  // Format YYYY-MM-DD without timezone issues
  const formattedStartingDate = startingDate
    ? (() => {
        const [year, month, day] = startingDate.split("-");
        const date = new Date(year, month - 1, day);

        return date.toLocaleDateString("en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
        });
      })()
    : "the scheduled starting date";

  const sendSmtpEmail = {
    sender: {
      name: "Alyaqeen",
      email: process.env.BREVO_USER,
    },

    to: [
      {
        email: to,
        name: name,
      },
    ],

    subject: "Admission Approved - Next Steps",

    htmlContent: `
      <p>Dear <strong>${name}</strong>,</p>

      <p>
        We’re pleased to inform you that your child
        <strong>${studentName}</strong>’s admission to Alyaqeen Academy has been approved.
      </p>

      <p>
        On the starting date you have chosen, please bring your child
        <strong>10 minutes before the class starting time</strong>. This will allow
        us to assess your child if required, provide any required books, and
        enrol them in the most suitable class.
      </p>

      <p>
        You may also pay the admission/registration fee and monthly fee by visiting
        our website and logging into your account. Alternatively, you can make the
        payment at the Academy Office on the starting date, where you can also
        purchase any required books or a bag, if needed.
      </p>

      <p>
        <strong>Starting Date: ${formattedStartingDate}</strong>
      </p>

      <p>
        We look forward to welcoming <strong>${studentName}</strong> to
        Alyaqeen Academy.
      </p>

      <p>JazakAllahu Khairan.</p>

      <br />

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

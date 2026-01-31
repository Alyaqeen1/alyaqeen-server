require("dotenv").config();
const SibApiV3Sdk = require("sib-api-v3-sdk");
const sanitizeHtml = require("sanitize-html");
const DISABLED_FAMILY_EMAILS = [
  "vezzaa786@hotmail.co.uk", // Amjad family
];
const sendAnnouncementEmail = async ({ to, name = "User", title, content }) => {
  // Optional: Enable/disable for testing
  // if (process.env.EMAIL_SENDING_ENABLED !== "true") {
  //   console.log("🚫 Email sending disabled. Skipping:", to);
  //   return;
  // }
  if (DISABLED_FAMILY_EMAILS.includes(to)) {
    console.log(`🚫 EMAIL BLOCKED: ${parentName} <${to}>`);
    return; // Exit without sending
  }
  if (!to || !process.env.BREVO_USER || !process.env.BREVO_PASS) {
    console.error("❌ Missing email credentials or recipient");
    return;
  }

  // Sanitize the HTML content for security
  const safeContent = sanitizeHtml(content, {
    allowedTags: [
      "p",
      "br",
      "b",
      "strong",
      "i",
      "em",
      "u",
      "ul",
      "ol",
      "li",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "div",
      "span",
      "blockquote",
      "code",
      "pre",
      "hr",
    ],
    allowedAttributes: {
      div: ["style"],
      span: ["style"],
      p: ["style"],
      h1: ["style"],
      h2: ["style"],
      h3: ["style"],
      h4: ["style"],
      h5: ["style"],
      h6: ["style"],
    },
    allowedStyles: {
      "*": {
        color: [
          /^#(0x)?[0-9a-f]+$/i,
          /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/,
        ],
        "background-color": [
          /^#(0x)?[0-9a-f]+$/i,
          /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/,
        ],
        "text-align": [/^left$/, /^right$/, /^center$/, /^justify$/],
        "font-weight": [/^bold$/, /^normal$/],
        "font-style": [/^italic$/, /^normal$/],
        "text-decoration": [/^underline$/],
      },
    },
  });

  // Also sanitize the title (though it's less likely to have HTML)
  const safeTitle = sanitizeHtml(title, {
    allowedTags: [], // No HTML tags in title
    allowedAttributes: {},
  });

  // Setup Brevo API client
  const defaultClient = SibApiV3Sdk.ApiClient.instance;
  const apiKey = defaultClient.authentications["api-key"];
  apiKey.apiKey = process.env.BREVO_PASS; // Brevo password is your API key

  const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

  const sendSmtpEmail = {
    sender: {
      name: "Alyaqeen Academy",
      email: process.env.BREVO_USER,
    },
    to: [
      {
        email: to,
        name: name,
      },
    ],
    subject: `📢 New Announcement – ${safeTitle}`,
    htmlContent: `
      <p>Dear <strong>${sanitizeHtml(name, {
        allowedTags: [],
        allowedAttributes: {},
      })}</strong>,</p>
      <p>You have a new announcement:</p>

      <h2 style="color:#2c3e50;">${safeTitle}</h2>
      <div style="padding:10px; background:#f8f9fa; border-radius:6px;">
          ${safeContent}
      </div>

      <br>
      <p>Kind regards,<br>Alyaqeen Academy</p>
    `,
  };

  try {
    await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log("✅ Announcement email sent successfully to:", to);
  } catch (error) {
    console.error(
      "❌ Failed to send announcement email:",
      error.response?.body || error.message,
    );
  }
};

module.exports = sendAnnouncementEmail;

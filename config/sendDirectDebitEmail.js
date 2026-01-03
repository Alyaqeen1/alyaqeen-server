require("dotenv").config();
const SibApiV3Sdk = require("sib-api-v3-sdk");

const sendDirectDebitEmail = async ({
  to,
  name,
  studentName,
  status, // 'success', 'pending', 'failed', 'expired', 'payment_failed'
  mandateId,
  failureReason = null,
}) => {
  console.log("📧 EMAIL FUNCTION CALLED:", {
    to,
    name,
    studentName,
    status,
    mandateId,
    failureReason,
  });

  // Check required environment variables
  if (!process.env.BREVO_PASS) {
    console.error("❌ BREVO_PASS environment variable is missing");
    return { success: false, reason: "missing_brevo_pass" };
  }

  if (!process.env.BREVO_USER) {
    console.error("❌ BREVO_USER environment variable is missing");
    return { success: false, reason: "missing_brevo_user" };
  }

  console.log("🔑 Brevo credentials check passed");

  try {
    const defaultClient = SibApiV3Sdk.ApiClient.instance;
    const apiKey = defaultClient.authentications["api-key"];
    apiKey.apiKey = process.env.BREVO_PASS;

    const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

    // Professional email templates used by major companies
    const emailTemplates = {
      success: {
        subject: "Your Direct Debit is Ready – Alyaqeen",
        htmlContent: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; color: white;">
              <h1 style="margin: 0; font-size: 24px;">Direct Debit Confirmed</h1>
            </div>
            
            <div style="padding: 30px; background: #ffffff;">
              <p>Dear ${name},</p>
              
              <p>Thank you for setting up Direct Debit for ${studentName}'s tuition fees. Your automatic payment method has been successfully configured and is ready for use.</p>
              
              <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3 style="color: #28a745; margin-top: 0;">What happens next?</h3>
                <ul style="margin-bottom: 0;">
                  <li>Your monthly tuition fees will be automatically collected</li>
                  <li>You'll receive email confirmation before each payment</li>
                  <li>Payments will appear as "Alyaqeen" on your bank statement</li>
                </ul>
              </div>

              <p>You can view your payment schedule and manage your account anytime through the parent portal.</p>
              
              <div style="text-align: center; margin: 30px 0;">
                <a href="https://www.alyaqeen.co.uk/login" 
                   style="background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
                  View Parent Portal
                </a>
              </div>

              <p>If you have any questions about your payments, please contact our finance team.</p>
              
            <p>JazakumAllahu khayran for your support.</p>
          <p>Warm regards,<br />Alyaqeen Team</p>
              
              <hr style="border: none; border-top: 1px solid #e9ecef; margin: 30px 0;">
              
              <p style="font-size: 12px; color: #6c757d;">
                Need help? Contact our support team at finance@alyaqeen.edu or call (XXX) XXX-XXXX<br>
                This is an automated message. Please do not reply to this email.
              </p>
            </div>
          </div>
        `,
      },
      pending: {
        subject: "Action Required: Verify Your Direct Debit – Alyaqeen",
        htmlContent: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #ffd89b 0%, #19547b 100%); padding: 30px; text-align: center; color: white;">
              <h1 style="margin: 0; font-size: 24px;">Verification Required</h1>
            </div>
            
            <div style="padding: 30px; background: #ffffff;">
              <p>Dear ${name},</p>
              
              <p>Thank you for choosing Direct Debit for ${studentName}'s tuition fees. We need to complete one final step to activate your automatic payments.</p>
              
              <div style="background: #fff3cd; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
                <h3 style="color: #856404; margin-top: 0;">Next Steps</h3>
                <p>Your bank may send small test transactions to verify your account. This process typically takes 2-3 business days.</p>
                <p>Once verified, your Direct Debit will be fully active and ready for monthly tuition collections.</p>
              </div>

              <p>You'll receive a confirmation email as soon as your Direct Debit is ready for use.</p>
              
               <p>JazakumAllahu khayran for your support.</p>
          <p>Warm regards,<br />Alyaqeen Team</p>
              
              <hr style="border: none; border-top: 1px solid #e9ecef; margin: 30px 0;">
              
              <p style="font-size: 12px; color: #6c757d;">
                Questions? Contact finance@alyaqeen.edu<br>
                This is an automated message. Please do not reply to this email.
              </p>
            </div>
          </div>
        `,
      },
      failed: {
        subject: "Unable to Process Your Direct Debit – Alyaqeen",
        htmlContent: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); padding: 30px; text-align: center; color: white;">
              <h1 style="margin: 0; font-size: 24px;">Setup Incomplete</h1>
            </div>
            
            <div style="padding: 30px; background: #ffffff;">
              <p>Dear ${name},</p>
              
              <p>We were unable to complete your Direct Debit setup for ${studentName}'s tuition fees.</p>
              
              <div style="background: #f8d7da; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc3545;">
                <h3 style="color: #721c24; margin-top: 0;">What you can do</h3>
                <ul style="margin-bottom: 0;">
                  <li>Check that your bank account details are correct</li>
                  <li>Contact your bank to ensure they support Direct Debit payments</li>
                  <li>Try setting up Direct Debit again in your parent portal</li>
                </ul>
              </div>

              <div style="text-align: center; margin: 30px 0;">
                <a href="https://www.alyaqeen.co.uk/login" 
                   style="background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
                  Try Setup Again
                </a>
              </div>

              <p>If you continue to experience issues, please contact our finance team for assistance.</p>
              
                 <p>JazakumAllahu khayran for your support.</p>
          <p>Warm regards,<br />Alyaqeen Team</p>
              
              <hr style="border: none; border-top: 1px solid #e9ecef; margin: 30px 0;">
              
              <p style="font-size: 12px; color: #6c757d;">
                Need help? Contact finance@alyaqeen.edu or call (XXX) XXX-XXXX<br>
                This is an automated message. Please do not reply to this email.
              </p>
            </div>
          </div>
        `,
      },
      payment_failed: {
        subject: "Payment Issue – Alyaqeen",
        htmlContent: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); padding: 30px; text-align: center; color: white;">
              <h1 style="margin: 0; font-size: 24px;">Payment Unsuccessful</h1>
            </div>
            
            <div style="padding: 30px; background: #ffffff;">
              <p>Dear ${name},</p>
              
              <p>We were unable to process your recent tuition payment for ${studentName}.</p>
              
              <div style="background: #f8d7da; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc3545;">
                <h3 style="color: #721c24; margin-top: 0;">Common reasons for payment issues:</h3>
                <ul style="margin-bottom: 0;">
                  <li>Insufficient funds in your account</li>
                  <li>Bank account details have changed</li>
                  <li>Temporary bank processing delays</li>
                </ul>
              </div>

              <p>We'll automatically retry this payment in 3-5 business days. To avoid interruption, please ensure sufficient funds are available.</p>

              <div style="text-align: center; margin: 30px 0;">
                <a href="https://www.alyaqeen.co.uk/login" 
                   style="background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
                  Update Payment Method
                </a>
              </div>

              <p>If this issue continues, please contact your bank or update your payment method in the parent portal.</p>
              
                 <p>JazakumAllahu khayran for your support.</p>
          <p>Warm regards,<br />Alyaqeen Team</p>
              
              <hr style="border: none; border-top: 1px solid #e9ecef; margin: 30px 0;">
              
              <p style="font-size: 12px; color: #6c757d;">
                Questions? Contact finance@alyaqeen.edu or call (XXX) XXX-XXXX<br>
                This is an automated message. Please do not reply to this email.
              </p>
            </div>
          </div>
        `,
      },
      expired: {
        subject: "Your Payment Method Needs Attention – Alyaqeen",
        htmlContent: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #ffd89b 0%, #19547b 100%); padding: 30px; text-align: center; color: white;">
              <h1 style="margin: 0; font-size: 24px;">Action Required</h1>
            </div>
            
            <div style="padding: 30px; background: #ffffff;">
              <p>Dear ${name},</p>
              
              <p>Your Direct Debit authorization for ${studentName}'s tuition fees will expire soon.</p>
              
              <div style="background: #fff3cd; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
                <h3 style="color: #856404; margin-top: 0;">To continue uninterrupted payments:</h3>
                <p>Please set up a new Direct Debit authorization in your parent portal. This quick process ensures your child's education continues without interruption.</p>
              </div>

              <div style="text-align: center; margin: 30px 0;">
                <a href="https://www.alyaqeen.co.uk/login" 
                   style="background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
                  Renew Authorization
                </a>
              </div>

              <p>If you need assistance with this process, our finance team is here to help.</p>
              
                <p>JazakumAllahu khayran for your support.</p>
          <p>Warm regards,<br />Alyaqeen Team</p>
              
              <hr style="border: none; border-top: 1px solid #e9ecef; margin: 30px 0;">
              
              <p style="font-size: 12px; color: #6c757d;">
                Need help? Contact finance@alyaqeen.edu or call (XXX) XXX-XXXX<br>
                This is an automated message. Please do not reply to this email.
              </p>
            </div>
          </div>
        `,
      },
    };

    const template = emailTemplates[status];

    if (!template) {
      console.error(`❌ Unknown email status: ${status}`);
      return { success: false, reason: "unknown_status" };
    }

    console.log(`📝 Using template for status: ${status}`);

    const sendSmtpEmail = {
      sender: {
        name: "Alyaqeen",
        email: process.env.BREVO_USER,
      },
      to: [{ email: to, name }],
      subject: template.subject,
      htmlContent: template.htmlContent,
    };

    console.log("📤 Sending email via Brevo...", {
      from: process.env.BREVO_USER,
      to: to,
      subject: template.subject,
    });

    const data = await apiInstance.sendTransacEmail(sendSmtpEmail);

    console.log(`✅ ${status} email sent successfully to: ${to}`);
    console.log("📨 Brevo API Response:", data);

    return { success: true, data };
  } catch (error) {
    console.error("❌ Failed to send email via Brevo API:");
    console.error("Error message:", error.message);
    console.error("Error response:", error.response?.body);
    console.error("Full error:", error);

    return {
      success: false,
      reason: "api_error",
      error: error.message,
      response: error.response?.body,
    };
  }
};

module.exports = sendDirectDebitEmail;

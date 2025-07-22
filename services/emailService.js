// backend/services/emailService.js - Fixed Email Service
import nodemailer from 'nodemailer';

class EmailService {
  constructor() {
    this.transporter = null;
    this.isConfigured = false;
    this.initializeTransporter();
  }

  initializeTransporter() {
    try {
      // Check if email configuration exists
      const emailUser = process.env.EMAIL_USER || process.env.SMTP_USER;
      const emailPass = process.env.EMAIL_PASS || process.env.SMTP_PASS;
      const emailHost = process.env.EMAIL_HOST || process.env.SMTP_HOST;
      
      if (!emailUser || !emailPass || !emailHost) {
        console.warn('⚠️ Email configuration incomplete. Email features will be disabled.');
        console.warn('Missing:', {
          user: !emailUser ? 'EMAIL_USER/SMTP_USER' : '✓',
          pass: !emailPass ? 'EMAIL_PASS/SMTP_PASS' : '✓',
          host: !emailHost ? 'EMAIL_HOST/SMTP_HOST' : '✓'
        });
        this.isConfigured = false;
        return;
      }

      // Use your existing environment variables
      const emailConfig = {
        host: emailHost,
        port: parseInt(process.env.EMAIL_PORT || process.env.SMTP_PORT || '587'),
        secure: false, // true for 465, false for other ports
        auth: {
          user: emailUser,
          pass: emailPass,
        },
        tls: {
          rejectUnauthorized: false // For development
        }
      };

      // FIXED: Use createTransport instead of createTransporter
      this.transporter = nodemailer.createTransport(emailConfig);
      
      console.log('📧 Email configuration loaded:', {
        host: emailConfig.host,
        port: emailConfig.port,
        user: emailConfig.auth.user,
        secure: emailConfig.secure
      });

      // Verify connection configuration
      this.transporter.verify((error, success) => {
        if (error) {
          console.error('❌ Email configuration error:', error.message);
          this.isConfigured = false;
        } else {
          console.log('✅ Email server is ready to send messages');
          this.isConfigured = true;
        }
      });

    } catch (error) {
      console.error('❌ Failed to initialize email transporter:', error.message);
      this.isConfigured = false;
    }
  }

  async sendWelcomeEmail(investor, userCredentials) {
    if (!this.isConfigured) {
      console.warn('⚠️ Email service not configured, skipping welcome email');
      return { success: false, message: 'Email service not configured' };
    }

    try {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      const fromEmail = process.env.EMAIL_FROM || process.env.FROM_EMAIL || `${process.env.COMPANY_NAME || 'FinanceTracker'} <${process.env.EMAIL_USER}>`;

      const mailOptions = {
        from: fromEmail,
        to: investor.email,
        subject: `Welcome to ${process.env.COMPANY_NAME || 'FinanceTracker'} - Your Investment Account`,
        html: this.generateWelcomeEmailTemplate(investor, userCredentials, frontendUrl)
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log(`✅ Welcome email sent to ${investor.email}:`, result.messageId);
      
      return { 
        success: true, 
        messageId: result.messageId,
        message: 'Welcome email sent successfully' 
      };
    } catch (error) {
      console.error('❌ Failed to send welcome email:', error.message);
      return { 
        success: false, 
        error: error.message,
        message: 'Failed to send welcome email' 
      };
    }
  }

  async sendPasswordResetEmail(investor, newPassword) {
    if (!this.isConfigured) {
      console.warn('⚠️ Email service not configured, skipping password reset email');
      return { success: false, message: 'Email service not configured' };
    }

    try {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      const fromEmail = process.env.EMAIL_FROM || process.env.FROM_EMAIL || `${process.env.COMPANY_NAME || 'FinanceTracker'} <${process.env.EMAIL_USER}>`;

      const mailOptions = {
        from: fromEmail,
        to: investor.email,
        subject: `${process.env.COMPANY_NAME || 'FinanceTracker'} - Password Reset`,
        html: this.generatePasswordResetEmailTemplate(investor, newPassword, frontendUrl)
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log(`✅ Password reset email sent to ${investor.email}:`, result.messageId);
      
      return { 
        success: true, 
        messageId: result.messageId,
        message: 'Password reset email sent successfully' 
      };
    } catch (error) {
      console.error('❌ Failed to send password reset email:', error.message);
      return { 
        success: false, 
        error: error.message,
        message: 'Failed to send password reset email' 
      };
    }
  }

  generateWelcomeEmailTemplate(investor, userCredentials, frontendUrl) {
    const companyName = process.env.COMPANY_NAME || 'FinanceTracker';
    const companyEmail = process.env.COMPANY_EMAIL || 'support@financetracker.com';
    const companyPhone = process.env.COMPANY_PHONE || '';
    const companyAddress = process.env.COMPANY_ADDRESS || '';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to ${companyName}</title>
        <style>
          body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            line-height: 1.6; 
            color: #333; 
            margin: 0; 
            padding: 0; 
            background-color: #f4f4f4; 
          }
          .container { 
            max-width: 600px; 
            margin: 20px auto; 
            background-color: white; 
            border-radius: 10px; 
            overflow: hidden; 
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); 
          }
          .header { 
            background: linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%); 
            color: white; 
            padding: 30px 20px; 
            text-align: center; 
          }
          .header h1 { margin: 0; font-size: 28px; font-weight: 600; }
          .content { padding: 30px; }
          .credentials-box { 
            background: linear-gradient(135deg, #EBF8FF 0%, #DBEAFE 100%); 
            border: 1px solid #3B82F6; 
            padding: 20px; 
            margin: 20px 0; 
            border-radius: 8px; 
            border-left: 4px solid #3B82F6;
          }
          .credentials-box h3 { margin-top: 0; color: #1E40AF; }
          .credentials-box code { 
            background-color: #1F2937; 
            color: #F3F4F6; 
            padding: 4px 8px; 
            border-radius: 4px; 
            font-family: 'Courier New', monospace;
            font-weight: bold;
          }
          .button { 
            display: inline-block; 
            background: linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%); 
            color: white; 
            padding: 15px 30px; 
            text-decoration: none; 
            border-radius: 8px; 
            margin: 20px 0; 
            font-weight: 600;
            box-shadow: 0 2px 4px rgba(59, 130, 246, 0.3);
          }
          .button:hover { transform: translateY(-1px); }
          .features-list { 
            background-color: #F9FAFB; 
            padding: 20px; 
            border-radius: 8px; 
            margin: 20px 0; 
          }
          .features-list ul { margin: 0; padding-left: 20px; }
          .features-list li { margin: 8px 0; }
          .footer { 
            background-color: #F3F4F6; 
            text-align: center; 
            padding: 20px; 
            color: #6B7280; 
            font-size: 14px; 
            border-top: 1px solid #E5E7EB; 
          }
          .warning { 
            background-color: #FEF3C7; 
            border: 1px solid #F59E0B; 
            padding: 15px; 
            border-radius: 6px; 
            margin: 20px 0; 
            border-left: 4px solid #F59E0B;
          }
          .warning h3 { margin-top: 0; color: #92400E; }
          .security-tips { 
            background-color: #F0FDF4; 
            border: 1px solid #10B981; 
            padding: 15px; 
            border-radius: 6px; 
            margin: 20px 0; 
            border-left: 4px solid #10B981;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎉 Welcome to ${companyName}!</h1>
            <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">Your investment journey starts here</p>
          </div>
          
          <div class="content">
            <h2>Dear ${investor.name},</h2>
            
            <p>Congratulations! Your investor account has been successfully created. You now have access to our comprehensive investment management platform where you can track your portfolio, monitor payments, and stay updated on your investment performance.</p>
            
            <div class="credentials-box">
              <h3>🔐 Your Login Credentials</h3>
              <p><strong>Email:</strong> ${investor.email}</p>
              <p><strong>Password:</strong> <code>${userCredentials.password}</code></p>
              ${userCredentials.isTemporary ? '<p style="color: #DC2626; font-weight: 600;">⚠️ This is a temporary password. You must change it after your first login for security.</p>' : ''}
            </div>
            
            <div style="text-align: center;">
              <a href="${frontendUrl}/login" class="button">🚀 Login to Your Account</a>
            </div>
            
            <div class="features-list">
              <h3>📋 What you can do with your account:</h3>
              <ul>
                <li><strong>Portfolio Overview:</strong> View all your investments in one place</li>
                <li><strong>Payment Tracking:</strong> Monitor payment schedules and history</li>
                <li><strong>Document Access:</strong> Download investment agreements and receipts</li>
                <li><strong>Performance Reports:</strong> Track your investment returns and growth</li>
                <li><strong>Account Management:</strong> Update your contact information and preferences</li>
                <li><strong>Real-time Updates:</strong> Get notifications about important account activities</li>
              </ul>
            </div>
            
            ${userCredentials.isTemporary ? `
            <div class="warning">
              <h3>🔒 Important Security Steps:</h3>
              <ol>
                <li><strong>Change your password immediately</strong> after first login</li>
                <li>Choose a strong password with letters, numbers, and special characters</li>
                <li>Never share your login credentials with anyone</li>
                <li>Log out completely when using shared computers</li>
                <li>Contact us immediately if you notice any suspicious activity</li>
              </ol>
            </div>
            ` : ''}
            
            <div class="security-tips">
              <h3>🛡️ Security Best Practices:</h3>
              <ul>
                <li>Always access your account through our official website</li>
                <li>Enable two-factor authentication when available</li>
                <li>Keep your contact information updated</li>
                <li>Review your account regularly for any unauthorized activity</li>
              </ul>
            </div>
            
            <p>Our support team is here to help you get started. If you have any questions or need assistance navigating your new account, please don't hesitate to reach out.</p>
            
            <p style="margin-top: 30px;">Welcome aboard, and thank you for choosing ${companyName} for your investment needs!</p>
            
            <p>Best regards,<br>
            <strong>The ${companyName} Team</strong></p>
          </div>
          
          <div class="footer">
            <p><strong>© ${new Date().getFullYear()} ${companyName}</strong> - All rights reserved</p>
            ${companyAddress ? `<p>📍 ${companyAddress}</p>` : ''}
            <p>
              ${companyEmail ? `📧 <a href="mailto:${companyEmail}" style="color: #3B82F6;">${companyEmail}</a>` : ''}
              ${companyPhone ? ` | 📞 ${companyPhone}` : ''}
            </p>
            <p style="margin-top: 15px; font-size: 12px; color: #9CA3AF;">
              This email was sent to ${investor.email}. This email contains sensitive information - please keep it secure.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  generatePasswordResetEmailTemplate(investor, newPassword, frontendUrl) {
    const companyName = process.env.COMPANY_NAME || 'FinanceTracker';
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Reset - ${companyName}</title>
        <style>
          body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            line-height: 1.6; 
            color: #333; 
            margin: 0; 
            padding: 0; 
            background-color: #f4f4f4; 
          }
          .container { 
            max-width: 600px; 
            margin: 20px auto; 
            background-color: white; 
            border-radius: 10px; 
            overflow: hidden; 
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); 
          }
          .header { 
            background: linear-gradient(135deg, #EF4444 0%, #DC2626 100%); 
            color: white; 
            padding: 30px 20px; 
            text-align: center; 
          }
          .content { padding: 30px; }
          .credentials-box { 
            background: linear-gradient(135deg, #FEF2F2 0%, #FEE2E2 100%); 
            border: 1px solid #EF4444; 
            padding: 20px; 
            margin: 20px 0; 
            border-radius: 8px; 
            border-left: 4px solid #EF4444;
          }
          .credentials-box code { 
            background-color: #1F2937; 
            color: #F3F4F6; 
            padding: 4px 8px; 
            border-radius: 4px; 
            font-family: 'Courier New', monospace;
            font-weight: bold;
          }
          .button { 
            display: inline-block; 
            background: linear-gradient(135deg, #EF4444 0%, #DC2626 100%); 
            color: white; 
            padding: 15px 30px; 
            text-decoration: none; 
            border-radius: 8px; 
            margin: 20px 0; 
            font-weight: 600;
          }
          .footer { 
            background-color: #F3F4F6; 
            text-align: center; 
            padding: 20px; 
            color: #6B7280; 
            font-size: 14px; 
          }
          .warning { 
            background-color: #FEF3C7; 
            border: 1px solid #F59E0B; 
            padding: 15px; 
            border-radius: 6px; 
            margin: 20px 0; 
            border-left: 4px solid #F59E0B;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🔑 Password Reset</h1>
          </div>
          
          <div class="content">
            <h2>Dear ${investor.name},</h2>
            
            <p>Your password has been reset by our administration team. Please use the new credentials below to access your account.</p>
            
            <div class="credentials-box">
              <h3>🔐 Your New Login Credentials</h3>
              <p><strong>Email:</strong> ${investor.email}</p>
              <p><strong>New Password:</strong> <code>${newPassword}</code></p>
              <p style="color: #DC2626; font-weight: 600;">⚠️ This is a temporary password. Please change it immediately after logging in.</p>
            </div>
            
            <div style="text-align: center;">
              <a href="${frontendUrl}/login" class="button">🔐 Login Now</a>
            </div>
            
            <div class="warning">
              <h3>🔒 Immediate Action Required:</h3>
              <ol>
                <li>Click the login button above</li>
                <li>Log in using the new password</li>
                <li><strong>Change your password immediately</strong></li>
                <li>Choose a strong, unique password</li>
                <li>Log out and log back in with your new password</li>
              </ol>
            </div>
            
            <p><strong>⚠️ Security Notice:</strong> If you did not request this password reset, please contact our support team immediately at ${process.env.COMPANY_EMAIL || 'support@financetracker.com'}.</p>
            
            <p>Best regards,<br>
            <strong>${companyName} Security Team</strong></p>
          </div>
          
          <div class="footer">
            <p>© ${new Date().getFullYear()} ${companyName}. All rights reserved.</p>
            <p style="margin-top: 10px; font-size: 12px;">This email was sent for security purposes. Please do not share your credentials.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  async sendTestEmail(toEmail) {
    if (!this.isConfigured) {
      return { success: false, message: 'Email service not configured' };
    }

    try {
      const fromEmail = process.env.EMAIL_FROM || process.env.FROM_EMAIL || `${process.env.COMPANY_NAME || 'FinanceTracker'} <${process.env.EMAIL_USER}>`;
      
      const mailOptions = {
        from: fromEmail,
        to: toEmail,
        subject: `${process.env.COMPANY_NAME || 'FinanceTracker'} - Email Configuration Test`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #3B82F6;">📧 Email Configuration Test</h2>
            <p>This is a test email to verify your ${process.env.COMPANY_NAME || 'FinanceTracker'} email configuration.</p>
            <div style="background-color: #F0FDF4; border: 1px solid #10B981; padding: 15px; border-radius: 6px; margin: 20px 0;">
              <p style="margin: 0; color: #065F46;">✅ <strong>Success!</strong> If you received this email, your email settings are working correctly!</p>
            </div>
            <p><strong>Configuration Details:</strong></p>
            <ul>
              <li>Host: ${process.env.EMAIL_HOST}</li>
              <li>Port: ${process.env.EMAIL_PORT}</li>
              <li>From: ${fromEmail}</li>
              <li>Test sent at: ${new Date().toISOString()}</li>
            </ul>
            <p>You can now create investor accounts with automatic email notifications.</p>
          </div>
        `
      };

      const result = await this.transporter.sendMail(mailOptions);
      return { 
        success: true, 
        messageId: result.messageId,
        message: 'Test email sent successfully' 
      };
    } catch (error) {
      return { 
        success: false, 
        error: error.message,
        message: 'Failed to send test email' 
      };
    }
  }

  isReady() {
    return this.isConfigured;
  }

  getStatus() {
    return {
      configured: this.isConfigured,
      host: process.env.EMAIL_HOST || process.env.SMTP_HOST,
      port: process.env.EMAIL_PORT || process.env.SMTP_PORT,
      user: process.env.EMAIL_USER || process.env.SMTP_USER,
      hasPassword: !!(process.env.EMAIL_PASS || process.env.SMTP_PASS)
    };
  }
}

// Create and export a singleton instance
const emailService = new EmailService();
export default emailService;
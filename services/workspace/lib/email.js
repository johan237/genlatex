/**
 * Email sending for verification, password reset, and welcome emails.
 * Set RESEND_API_KEY to use Resend; otherwise logs the link in development.
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.EMAIL_FROM || 'GenLaTeX <onboarding@resend.dev>';
const BASE_URL = process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

// Use a publicly hosted logo URL for email compatibility
// SVG data URIs and embedded SVGs don't work in most email clients (Gmail, Outlook, etc.)
// Logo is hosted on the assets server as a PNG for maximum email client compatibility
const EMAIL_LOGO_URL = 'https://assets.genlatex.com/genlatex-logo.png';

/**
 * Get the logo URL for emails
 */
function getLogoUrl() {
  return process.env.EMAIL_LOGO_URL || EMAIL_LOGO_URL;
}

/**
 * Send verification email. Called by Better Auth.
 * @param {{ to: string, url: string, user: { name?: string, email: string } }} opts
 */
export async function sendVerificationEmail({ to, url, user }) {
  const userName = user?.name || 'there';
  const subject = 'Verify your GenLaTeX account';
  const logoUrl = getLogoUrl();
  // Use hosted PNG image for email compatibility (SVG doesn't work in most email clients)
  // Fallback to text if EMAIL_LOGO_URL is not configured
  const logoHtml = process.env.EMAIL_LOGO_URL
    ? `<img src="${logoUrl}" alt="GenLaTeX" style="height: 40px; width: auto; display: block;" />`
    : '<h1 style="margin: 0; font-size: 24px; color: #2563eb;">GenLaTeX</h1>';
  
  const text = `Hi ${userName},\n\nWelcome to GenLaTeX! Please verify your email address to get started.\n\nClick this link to verify: ${url}\n\nThis link expires in 24 hours.\n\nIf you didn't create an account, you can safely ignore this email.\n\nBest regards,\nThe GenLaTeX Team`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify your GenLaTeX account</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f9fafb;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 30px; text-align: center; border-bottom: 1px solid #e5e7eb;">
              ${logoHtml}
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <h1 style="margin: 0 0 20px; font-size: 24px; font-weight: 600; color: #111827; line-height: 1.3;">
                Verify your email address
              </h1>
              <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: #4b5563;">
                Hi ${userName},
              </p>
              <p style="margin: 0 0 30px; font-size: 16px; line-height: 1.6; color: #4b5563;">
                Welcome to GenLaTeX! We're excited to have you on board. To get started, please verify your email address by clicking the button below.
              </p>
              
              <!-- CTA Button -->
              <table role="presentation" style="width: 100%; margin: 30px 0;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${url}" style="display: inline-block; padding: 14px 32px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 16px;">
                      Verify Email Address
                    </a>
                  </td>
                </tr>
              </table>
              
              <p style="margin: 30px 0 20px; font-size: 14px; line-height: 1.6; color: #6b7280;">
                Or copy and paste this link into your browser:
              </p>
              <p style="margin: 0 0 30px; font-size: 14px; line-height: 1.6; color: #2563eb; word-break: break-all;">
                <a href="${url}" style="color: #2563eb; text-decoration: none;">${url}</a>
              </p>
              
              <p style="margin: 0 0 10px; font-size: 14px; line-height: 1.6; color: #6b7280;">
                This verification link will expire in 24 hours.
              </p>
              <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #6b7280;">
                If you didn't create a GenLaTeX account, you can safely ignore this email.
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 30px 40px; background-color: #f9fafb; border-top: 1px solid #e5e7eb; border-radius: 0 0 8px 8px;">
              <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #6b7280; text-align: center;">
                Best regards,<br>
                <strong>The GenLaTeX Team</strong>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  if (RESEND_API_KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [to],
        subject,
        html,
        text,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      const isTestingRestriction = res.status === 403 && /testing emails|only send.*your own/i.test(err);
      if (isTestingRestriction && process.env.NODE_ENV !== 'production') {
        console.warn('[email] Resend testing restriction: can only send to your Resend account email. Link (dev):', url);
        return;
      }
      console.error('[email] Resend error:', res.status, err);
      throw new Error('Failed to send verification email');
    }
    return;
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log('[email] No RESEND_API_KEY – verification link (dev only):', url);
    return;
  }

  throw new Error('RESEND_API_KEY is required to send verification emails in production');
}

/**
 * Send password reset email. Called by Better Auth.
 */
export async function sendResetPassword({ user, url }) {
  const subject = 'Reset your GenLaTeX password';
  const text = `Hi${user?.name ? ` ${user.name}` : ''},\n\nReset your password: ${url}\n\n— GenLaTeX`;
  const html = `<!DOCTYPE html><html><body><p>Hi${user?.name ? ` ${user.name}` : ''},</p><p><a href="${url}">Reset your password</a></p><p>— GenLaTeX</p></body></html>`;

  if (RESEND_API_KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [user.email],
        subject,
        html,
        text,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      const isTestingRestriction = res.status === 403 && /testing emails|only send.*your own/i.test(err);
      if (isTestingRestriction && process.env.NODE_ENV !== 'production') {
        console.warn('[email] Resend testing restriction: can only send to your Resend account email. Reset link (dev):', url);
        return;
      }
      console.error('[email] Resend error:', res.status, err);
      throw new Error('Failed to send password reset email');
    }
    return;
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log('[email] No RESEND_API_KEY – reset link (dev only):', url);
    return;
  }

  throw new Error('RESEND_API_KEY is required for password reset in production');
}

/**
 * Send welcome email after user signs up and verifies their account.
 * @param {{ user: { name?: string, email: string } }} opts
 */
export async function sendWelcomeEmail({ user }) {
  const userName = user?.name || 'there';
  const subject = 'Welcome to GenLaTeX! 🎉';
  const logoUrl = getLogoUrl();
  // Use hosted PNG image for email compatibility (SVG doesn't work in most email clients)
  const logoHtml = process.env.EMAIL_LOGO_URL
    ? `<img src="${logoUrl}" alt="GenLaTeX" style="height: 50px; width: auto; display: block;" />`
    : '<h1 style="margin: 0; font-size: 28px; color: #2563eb;">GenLaTeX</h1>';
  
  const text = `Hey ${userName},\n\nMy name is Chris, co-founder of GenLaTeX. Thank you for using GenLaTeX—we really appreciate it!\n\nOur aim with GenLaTeX is to reduce the time needed for people, irrespective of their qualifications, to be able to write and conduct research easily. We believe research is an essential part of our society as it will enable us to grow, make discoveries, and better our collective lives.\n\nThis is just the beginning, and we hope you will be part of the adventure.\n\nThank you, and feel free to write to me if you need anything.\n\nBest regards,\nChris\nCo-founder, GenLaTeX`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to GenLaTeX</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f9fafb;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 30px; text-align: center; border-bottom: 1px solid #e5e7eb;">
              ${logoHtml}
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <h1 style="margin: 0 0 20px; font-size: 28px; font-weight: 700; color: #111827; line-height: 1.3;">
                Welcome to GenLaTeX! 🎉
              </h1>
              <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.7; color: #374151;">
                Hey ${userName},
              </p>
              <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.7; color: #374151;">
                My name is <strong>Chris</strong>, co-founder of GenLaTeX. Thank you for using GenLaTeX—we really appreciate it!
              </p>
              <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.7; color: #374151;">
                Our aim with GenLaTeX is to reduce the time needed for people, irrespective of their qualifications, to be able to write and conduct research easily. We believe research is an essential part of our society as it will enable us to grow, make discoveries, and better our collective lives.
              </p>
              <p style="margin: 0 0 30px; font-size: 16px; line-height: 1.7; color: #374151;">
                This is just the beginning, and we hope you will be part of the adventure.
              </p>
              
              <!-- CTA Button -->
              <table role="presentation" style="width: 100%; margin: 30px 0;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${BASE_URL}/dashboard" style="display: inline-block; padding: 14px 32px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 16px;">
                      Get Started
                    </a>
                  </td>
                </tr>
              </table>
              
              <p style="margin: 30px 0 0; font-size: 16px; line-height: 1.7; color: #374151;">
                Thank you, and feel free to write to me if you need anything.
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 30px 40px; background-color: #f9fafb; border-top: 1px solid #e5e7eb; border-radius: 0 0 8px 8px;">
              <p style="margin: 0 0 10px; font-size: 16px; line-height: 1.6; color: #111827; font-weight: 600;">
                Best regards,
              </p>
              <p style="margin: 0; font-size: 16px; line-height: 1.6; color: #374151;">
                <strong>Chris</strong><br>
                Co-founder, GenLaTeX
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  if (RESEND_API_KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [user.email],
        subject,
        html,
        text,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      const isTestingRestriction = res.status === 403 && /testing emails|only send.*your own/i.test(err);
      if (isTestingRestriction && process.env.NODE_ENV !== 'production') {
        console.warn('[email] Resend testing restriction: welcome email not sent (dev only)');
        return;
      }
      console.error('[email] Resend error sending welcome email:', res.status, err);
      // Don't throw - welcome email is nice-to-have, not critical
      return;
    }
    return;
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log('[email] No RESEND_API_KEY – welcome email not sent (dev only)');
    return;
  }

  // In production, fail silently if no API key (welcome email is nice-to-have)
  console.warn('[email] RESEND_API_KEY not set – welcome email not sent');
}

/**
 * Send project share invitation email
 * @param {{ to: string, shareLink: string, projectName: string, sharedBy: string, permission: string, userExists: boolean }} opts
 */
export async function sendShareInvitationEmail({ to, shareLink, projectName, sharedBy, permission, userExists }) {
  const subject = `${sharedBy} shared a project with you on GenLaTeX`;
  const logoUrl = getLogoUrl();
  const logoHtml = process.env.EMAIL_LOGO_URL
    ? `<img src="${logoUrl}" alt="GenLaTeX" style="height: 40px; width: auto; display: block;" />`
    : '<h1 style="margin: 0; font-size: 24px; color: #2563eb;">GenLaTeX</h1>';

  const permissionText = permission === 'edit' ? 'edit' : 'view';
  const actionText = userExists
    ? 'Click the button below to access the project.'
    : 'To access the project, you\'ll need to create a free GenLaTeX account first. Click the button below to get started.';

  const text = `Hi,\n\n${sharedBy} has invited you to ${permissionText} the project "${projectName}" on GenLaTeX.\n\n${actionText}\n\nAccess project: ${shareLink}\n\nBest regards,\nThe GenLaTeX Team`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Project Shared with You</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f9fafb;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 30px; text-align: center; border-bottom: 1px solid #e5e7eb;">
              ${logoHtml}
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <h1 style="margin: 0 0 20px; font-size: 24px; font-weight: 600; color: #111827; line-height: 1.3;">
                Project Shared with You
              </h1>
              <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: #4b5563;">
                Hi,
              </p>
              <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: #4b5563;">
                <strong>${sharedBy}</strong> has invited you to <strong>${permissionText}</strong> the project:
              </p>
              <p style="margin: 0 0 30px; font-size: 18px; line-height: 1.6; color: #111827; font-weight: 600; padding: 16px; background-color: #f3f4f6; border-radius: 6px;">
                "${projectName}"
              </p>
              <p style="margin: 0 0 30px; font-size: 16px; line-height: 1.6; color: #4b5563;">
                ${actionText}
              </p>

              <!-- CTA Button -->
              <table role="presentation" style="width: 100%; margin: 30px 0;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${shareLink}" style="display: inline-block; padding: 14px 32px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 16px;">
                      ${userExists ? 'Access Project' : 'Sign Up & Access Project'}
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 30px 0 20px; font-size: 14px; line-height: 1.6; color: #6b7280;">
                Or copy and paste this link into your browser:
              </p>
              <p style="margin: 0 0 30px; font-size: 14px; line-height: 1.6; color: #2563eb; word-break: break-all;">
                <a href="${shareLink}" style="color: #2563eb; text-decoration: none;">${shareLink}</a>
              </p>

              <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #6b7280;">
                If you didn't expect this invitation, you can safely ignore this email.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 30px 40px; background-color: #f9fafb; border-top: 1px solid #e5e7eb; border-radius: 0 0 8px 8px;">
              <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #6b7280; text-align: center;">
                Best regards,<br>
                <strong>The GenLaTeX Team</strong>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  if (RESEND_API_KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [to],
        subject,
        html,
        text,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      const isTestingRestriction = res.status === 403 && /testing emails|only send.*your own/i.test(err);
      if (isTestingRestriction && process.env.NODE_ENV !== 'production') {
        console.warn(`[email] Resend testing restriction: share invitation to ${to} not sent. Link (dev):`, shareLink);
        return;
      }
      console.error('[email] Resend error sending share invitation:', res.status, err);
      throw new Error('Failed to send share invitation email');
    }
    return;
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[email] No RESEND_API_KEY – share link for ${to} (dev only):`, shareLink);
    return;
  }

  throw new Error('RESEND_API_KEY is required to send share invitation emails in production');
}

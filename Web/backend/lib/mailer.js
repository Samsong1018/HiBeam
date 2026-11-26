'use strict';

/*
 * Transactional email through Resend (https://resend.com/docs/api-reference/emails/send-email).
 *
 * CreateMailer(pOptions) -> { enabled, sendPasswordReset(to, url), sendEmailConfirm(to, url),
 *                            sendPasswordChanged(to, url), sendEmailChanged(to, url) }
 * The last two are security notices to the address that was on file; url points at the login page.
 *   apiKey   Resend API key            (default process.env.RESEND_API_KEY)
 *   from     sender, "Name <addr>"     (default process.env.MAIL_FROM or DEFAULT_FROM)
 *   fetch    fetch implementation      (default global fetch; tests inject a fake)
 *   logger   { log, error }            (default console)
 *
 * With no API key the mailer is disabled: links are written to the server log instead, so local
 * development works without an account. Send failures reject with an Error whose message never
 * contains the API key or the link.
 */

const RESEND_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'HiBeam <hibeam@somab.dev>';
const SEND_TIMEOUT_MS = 10000;

const BRAND = {
    ink: '#14131a',
    muted: '#555',
    faint: '#999',
    accent: '#f2b705',
};

function EscapeHtml(pText)
{
    return String(pText)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// One layout for every message: heading, a paragraph, a button, a footnote.
function RenderHtml(pParts)
{
    const tmpUrl = EscapeHtml(pParts.url);
    return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:480px;margin:0 auto;padding:32px 16px;color:${BRAND.ink}">
  <div style="font-size:20px;font-weight:700;margin-bottom:20px">HiBeam</div>
  <h2 style="margin:0 0 12px;font-size:22px">${EscapeHtml(pParts.heading)}</h2>
  <p style="color:${BRAND.muted};line-height:1.6;margin:0">${EscapeHtml(pParts.body)}</p>
  <a href="${tmpUrl}" style="display:inline-block;background:${BRAND.accent};color:${BRAND.ink};padding:12px 26px;border-radius:8px;text-decoration:none;font-weight:600;margin:24px 0">${EscapeHtml(pParts.button)}</a>
  <p style="color:${BRAND.faint};font-size:13px;line-height:1.5;margin:0">${EscapeHtml(pParts.footnote)}</p>
  <p style="color:${BRAND.faint};font-size:12px;margin-top:20px">If the button doesn't work, paste this into your browser:<br><span style="word-break:break-all">${tmpUrl}</span></p>
</div>`;
}

function RenderText(pParts)
{
    return `${pParts.heading}\n\n${pParts.body}\n\n${pParts.url}\n\n${pParts.footnote}\n`;
}

const TEMPLATES = {
    passwordReset: {
        subject: 'Reset your HiBeam password',
        heading: 'Reset your password',
        body: 'Someone asked to reset the password on your HiBeam account. If that was you, use the button below to pick a new one.',
        button: 'Reset password',
        footnote: "This link expires in 30 minutes and works once. If you didn't ask for it, ignore this email and your password stays the same.",
    },
    emailConfirm: {
        subject: 'Confirm your new HiBeam email',
        heading: 'Confirm your new email',
        body: 'You asked to change the email on your HiBeam account to this address. Confirm it to finish the change.',
        button: 'Confirm email',
        footnote: "This link expires in 24 hours. If you didn't ask for this, ignore this email and nothing changes.",
    },
    passwordChanged: {
        subject: 'Your HiBeam password was changed',
        heading: 'Your password was changed',
        body: 'The password on your HiBeam account was just changed, and other signed-in sessions were logged out.',
        button: 'Go to HiBeam',
        footnote: "If this was you, there's nothing to do. If it wasn't, reset your password from the login page right away.",
    },
    emailChanged: {
        subject: 'Your HiBeam email was changed',
        heading: 'Your email was changed',
        body: "The email on your HiBeam account was just changed to a different address. You won't get account mail here anymore.",
        button: 'Go to HiBeam',
        footnote: "If this was you, there's nothing to do. If it wasn't, someone else may have access to your account. Contact the HiBeam team as soon as you can.",
    },
};

function CreateMailer(pOptions)
{
    const tmpOpts = pOptions || {};
    const tmpApiKey = tmpOpts.apiKey !== undefined ? tmpOpts.apiKey : (process.env.RESEND_API_KEY || '');
    const tmpFrom = tmpOpts.from || process.env.MAIL_FROM || DEFAULT_FROM;
    const tmpFetch = tmpOpts.fetch || globalThis.fetch;
    const tmpLogger = tmpOpts.logger || console;
    const tmpEnabled = typeof tmpApiKey === 'string' && tmpApiKey.trim() !== '';

    async function Send(pKind, pTo, pUrl)
    {
        const tmpTemplate = TEMPLATES[pKind];
        // .invalid is reserved (RFC 2606) and is what demo accounts use: never spend a send on it
        if (/\.invalid$/i.test(String(pTo).trim()))
        {
            return { sent: false };
        }
        if (!tmpEnabled)
        {
            tmpLogger.log(`[mail:disabled] ${pKind} for ${pTo}: ${pUrl}`);
            return { sent: false };
        }

        const tmpParts = { ...tmpTemplate, url: pUrl };
        let tmpRes;
        try
        {
            tmpRes = await tmpFetch(RESEND_URL, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${tmpApiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    from: tmpFrom,
                    to: [pTo],
                    subject: tmpTemplate.subject,
                    html: RenderHtml(tmpParts),
                    text: RenderText(tmpParts),
                }),
                signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
            });
        }
        catch (pErr)
        {
            throw new Error(`mail send failed (${pKind}): ${pErr && pErr.name ? pErr.name : 'network error'}`);
        }

        if (!tmpRes.ok)
        {
            // Resend error bodies are { name, message }; keep only the short name.
            let tmpName = '';
            try
            {
                const tmpBody = await tmpRes.json();
                tmpName = tmpBody && typeof tmpBody.name === 'string' ? ` ${tmpBody.name.slice(0, 64)}` : '';
            }
            catch
            {
                tmpName = '';
            }
            throw new Error(`mail send failed (${pKind}): HTTP ${tmpRes.status}${tmpName}`);
        }
        return { sent: true };
    }

    return {
        enabled: tmpEnabled,
        sendPasswordReset: (pTo, pUrl) => Send('passwordReset', pTo, pUrl),
        sendEmailConfirm: (pTo, pUrl) => Send('emailConfirm', pTo, pUrl),
        sendPasswordChanged: (pTo, pUrl) => Send('passwordChanged', pTo, pUrl),
        sendEmailChanged: (pTo, pUrl) => Send('emailChanged', pTo, pUrl),
    };
}

module.exports = { CreateMailer, EscapeHtml, RESEND_URL, DEFAULT_FROM, TEMPLATES };

/**
 * Vercel Serverless Function — POST /api/booking
 *
 * Handles booking email submissions from the client-facing site.
 * Accepts both the legacy web-form fields  { name, email, service, date, time, notes }
 * and the quick-booking fields              { name, phone, request }.
 *
 * Environment variables required in Vercel dashboard:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_TO
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import nodemailer from 'nodemailer';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  try {
    const {
      name,
      email,
      service,
      date,
      time,
      notes,
      // Quick-booking aliases
      phone,
      request: requestNotes,
    } = req.body as Record<string, string | undefined>;

    if (!name) {
      return res.status(400).json({ success: false, error: 'Name is required.' });
    }

    // Build a clean email body from whichever fields were submitted
    const lines: string[] = [`Full Name : ${name}`];
    if (phone)    lines.push(`Phone     : ${phone}`);
    if (email)    lines.push(`Email     : ${email}`);
    if (service)  lines.push(`Service   : ${service}`);
    if (date)     lines.push(`Date      : ${date}`);
    if (time)     lines.push(`Time      : ${time}`);
    const notesText = requestNotes || notes;
    if (notesText) lines.push(`Notes     : ${notesText}`);

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT || 465),
      secure: process.env.SMTP_PORT === '465' || !process.env.SMTP_PORT,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to:   process.env.SMTP_TO   || process.env.SMTP_USER,
      subject: `New Booking Request from ${name}`,
      text: `New Booking Request:\n\n${lines.join('\n')}`,
    });

    return res.status(200).json({ success: true, message: 'Booking email sent successfully!' });
  } catch (error: any) {
    console.error('[api/booking] error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Vercel Serverless Function — POST /api/booking
 *
 * Handles booking email submissions from the client-facing site.
 * Accepts { name, phone, request } — name and phone are required.
 *
 * Environment variables (set in Vercel dashboard):
 *   SMTP_HOST  SMTP_PORT  SMTP_USER  SMTP_PASS  SMTP_FROM  SMTP_TO
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import nodemailer from 'nodemailer';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Always enforce JSON response headers first
  res.setHeader('Content-Type', 'application/json');

  // Block any non-POST requests immediately
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  try {
    const { name, phone, request } = req.body as Record<string, string | undefined>;

    if (!name || !phone) {
      return res
        .status(400)
        .json({ success: false, error: 'Name and phone number are required.' });
    }

    // Connect to Nodemailer using Vercel's secure cloud env variables
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT || 465),
      secure: true,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from:    process.env.SMTP_FROM || 'samqtexsq@gmail.com',
      to:      process.env.SMTP_TO   || 'samqtexsq@gmail.com',
      subject: `🚀 New Booking Request from ${name}`,
      html: `
        <h3>New Booking Received</h3>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Phone:</strong> ${phone}</p>
        <p><strong>Message:</strong> ${request || 'None'}</p>
      `,
    });

    // Explicitly return valid JSON
    return res.status(200).json({ success: true, message: 'Booking completed successfully!' });

  } catch (error: any) {
    console.error('Vercel API Execution Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Backend processed cleanly but failed to send mail.',
      details: error.message,
    });
  }
}

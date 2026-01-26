import nodemailer from "nodemailer";

export const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export async function sendOtpEmail(email, otp) {
  await transporter.sendMail({
    from: `"My Text Digest" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Verify your email",
    html: `
      <p>Your verification code is:</p>
      <h2>${otp}</h2>
      <p>This code expires in 10 minutes.</p>
    `,
  });
}

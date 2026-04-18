import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY!);

export async function GET() {
  try {
    const result = await resend.emails.send({
      from: "onboarding@resend.dev",
      to: "fly4stars@gmail.com",
      subject: "Test",
      text: "It works",
    });

    console.log("EMAIL RESULT:", result);

    return Response.json({ success: true, result });
  } catch (error) {
    console.error("EMAIL ERROR:", error);

    return Response.json({ success: false, error });
  }
}
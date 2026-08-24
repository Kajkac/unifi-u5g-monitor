import nodemailer from "nodemailer";
import { config } from "./config.js";

export async function notify(title: string, message: string) {
  if (!config.notifications.enabled) return { attempted: 0, sent: 0, errors: [] as string[] };
  const tasks: Array<Promise<void>> = [];
  const errors: string[] = [];
  const capture = (label: string, task: Promise<unknown>) => tasks.push(task.then(() => undefined).catch((error) => { errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`); }));

  const ntfy = config.notifications.ntfy;
  if (ntfy.enabled && ntfy.url && ntfy.topic) {
    capture("ntfy", fetch(`${ntfy.url.replace(/\/$/, "")}/${encodeURIComponent(ntfy.topic)}`, { method: "POST", headers: { Title: title.replace(/[^\x20-\x7e]/g, "") }, body: message }).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    }));
  }
  const telegram = config.notifications.telegram;
  if (telegram.enabled && telegram.botToken && telegram.chatId) {
    capture("Telegram", fetch(`https://api.telegram.org/bot${telegram.botToken}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: telegram.chatId, text: `${title}\n${message}` }) }).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    }));
  }
  const email = config.notifications.email;
  if (email.enabled && email.host && email.to) {
    const transporter = nodemailer.createTransport({ host: email.host, port: email.port, secure: email.secure, auth: email.user ? { user: email.user, pass: email.password } : undefined });
    capture("Email", transporter.sendMail({ from: email.from || email.user, to: email.to, subject: title, text: message }));
  }
  await Promise.all(tasks);
  return { attempted: tasks.length, sent: tasks.length - errors.length, errors };
}

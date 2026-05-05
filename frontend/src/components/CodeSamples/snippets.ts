// Snippet templates for the SMTP code-samples panel. No auth —
// mailtrap-local accepts anonymous SMTP locally.
//
// Snippets are grouped by language: each tab is a language;
// multi-framework groups expose a dropdown chevron.

export interface SnippetParams {
  host: string
  port: number
  fromEmail: string
  toEmail: string
}

export interface Snippet {
  id: string
  label: string
  lang: string // prism language id
  paragraph?: string
  code: (params: SnippetParams) => string
}

export interface SnippetGroup {
  id: string
  label: string
  items: Snippet[]
}

export const SNIPPET_GROUPS: SnippetGroup[] = [
  {
    id: 'nodejs',
    label: 'Node.js',
    items: [
      {
        id: 'nodemailer',
        label: 'Nodemailer',
        lang: 'javascript',
        paragraph: 'Nodemailer is the de-facto SMTP client for Node.js.',
        code: ({ host, port, fromEmail, toEmail }) => `import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  host: '${host}',
  port: ${port},
  secure: false,
  // mailtrap-local accepts anonymous SMTP — no auth required
})

await transporter.sendMail({
  from: '${fromEmail}',
  to: '${toEmail}',
  subject: 'Hello from mailtrap-local',
  text: 'It works.',
})`,
      },
    ],
  },
  {
    id: 'python',
    label: 'Python',
    items: [
      {
        id: 'python_smtplib',
        label: 'smtplib',
        lang: 'python',
        paragraph: 'Sending mail with the standard-library smtplib module.',
        code: ({ host, port, fromEmail, toEmail }) => `import smtplib
from email.message import EmailMessage

msg = EmailMessage()
msg['From'] = '${fromEmail}'
msg['To'] = '${toEmail}'
msg['Subject'] = 'Hello from mailtrap-local'
msg.set_content('It works.')

with smtplib.SMTP('${host}', ${port}) as s:
    s.send_message(msg)`,
      },
      {
        id: 'django',
        label: 'Django',
        lang: 'python',
        paragraph: 'Add to settings.py — no auth, no TLS.',
        code: ({ host, port }) => `EMAIL_HOST = '${host}'
EMAIL_PORT = ${port}
EMAIL_HOST_USER = ''
EMAIL_HOST_PASSWORD = ''
EMAIL_USE_TLS = False`,
      },
    ],
  },
  {
    id: 'ruby',
    label: 'Ruby',
    items: [
      {
        id: 'rails',
        label: 'Ruby on Rails',
        lang: 'ruby',
        paragraph: 'In config/environments/development.rb:',
        code: ({ host, port }) => `config.action_mailer.delivery_method = :smtp
config.action_mailer.smtp_settings = {
  address: '${host}',
  port: ${port},
}`,
      },
      {
        id: 'ruby_net_smtp',
        label: 'net/smtp',
        lang: 'ruby',
        paragraph: 'Standard-library net/smtp.',
        code: ({ host, port, fromEmail, toEmail }) => `require 'net/smtp'

message = <<~END
  From: ${fromEmail}
  To: ${toEmail}
  Subject: Hello from mailtrap-local

  It works.
END

Net::SMTP.start('${host}', ${port}) do |smtp|
  smtp.send_message(message, '${fromEmail}', '${toEmail}')
end`,
      },
    ],
  },
  {
    id: 'php',
    label: 'PHP',
    items: [
      {
        id: 'php_symfony',
        label: 'Symfony Mailer',
        lang: 'php',
        paragraph: 'Set MAILER_DSN in your .env file.',
        code: ({ host, port }) => `MAILER_DSN="smtp://${host}:${port}"`,
      },
      {
        id: 'php_phpmailer',
        label: 'PHPMailer',
        lang: 'php',
        paragraph: 'Direct PHPMailer config — no auth, no TLS.',
        code: ({ host, port, fromEmail, toEmail }) => `<?php
use PHPMailer\\PHPMailer\\PHPMailer;

$mail = new PHPMailer(true);
$mail->isSMTP();
$mail->Host = '${host}';
$mail->Port = ${port};
$mail->SMTPAuth = false;
$mail->SMTPAutoTLS = false;

$mail->setFrom('${fromEmail}');
$mail->addAddress('${toEmail}');
$mail->Subject = 'Hello from mailtrap-local';
$mail->Body = 'It works.';
$mail->send();`,
      },
    ],
  },
  {
    id: 'go',
    label: 'Go',
    items: [
      {
        id: 'go_net_smtp',
        label: 'net/smtp',
        lang: 'go',
        paragraph: 'Standard-library net/smtp — no auth.',
        code: ({ host, port, fromEmail, toEmail }) => `package main

import (
	"fmt"
	"net/smtp"
)

func main() {
	addr := fmt.Sprintf("${host}:%d", ${port})
	msg := []byte("From: ${fromEmail}\\r\\n" +
		"To: ${toEmail}\\r\\n" +
		"Subject: Hello from mailtrap-local\\r\\n\\r\\n" +
		"It works.\\r\\n")
	if err := smtp.SendMail(addr, nil, "${fromEmail}", []string{"${toEmail}"}, msg); err != nil {
		panic(err)
	}
}`,
      },
    ],
  },
  {
    id: 'java',
    label: 'Java',
    items: [
      {
        id: 'java_jakarta',
        label: 'Jakarta Mail',
        lang: 'java',
        paragraph: 'Jakarta Mail (formerly JavaMail) — no auth.',
        code: ({ host, port, fromEmail, toEmail }) => `import jakarta.mail.*;
import jakarta.mail.internet.*;
import java.util.Properties;

Properties props = new Properties();
props.put("mail.smtp.host", "${host}");
props.put("mail.smtp.port", "${port}");

Session session = Session.getInstance(props);
MimeMessage message = new MimeMessage(session);
message.setFrom(new InternetAddress("${fromEmail}"));
message.addRecipient(Message.RecipientType.TO, new InternetAddress("${toEmail}"));
message.setSubject("Hello from mailtrap-local");
message.setText("It works.");
Transport.send(message);`,
      },
    ],
  },
  {
    id: 'csharp',
    label: 'C#',
    items: [
      {
        id: 'csharp_smtp',
        label: 'System.Net.Mail',
        lang: 'csharp',
        paragraph: 'System.Net.Mail.SmtpClient — no auth.',
        code: ({ host, port, fromEmail, toEmail }) => `using System.Net.Mail;

using var client = new SmtpClient("${host}", ${port});
client.EnableSsl = false;
client.UseDefaultCredentials = false;

var message = new MailMessage("${fromEmail}", "${toEmail}",
    "Hello from mailtrap-local", "It works.");
client.Send(message);`,
      },
    ],
  },
  {
    id: 'cli',
    label: 'CLI',
    items: [
      {
        id: 'curl',
        label: 'cURL',
        lang: 'bash',
        paragraph: 'Quick smoke-test from a terminal.',
        code: ({ host, port, fromEmail, toEmail }) => `curl --url 'smtp://${host}:${port}' \\
  --mail-from '${fromEmail}' \\
  --mail-rcpt '${toEmail}' \\
  --upload-file - <<EOF
From: ${fromEmail}
To: ${toEmail}
Subject: Hello from mailtrap-local

It works.
EOF`,
      },
      {
        id: 'swaks',
        label: 'swaks',
        lang: 'bash',
        paragraph: 'swaks is the Swiss-army knife for SMTP testing (brew install swaks).',
        code: ({ host, port, fromEmail, toEmail }) => `swaks \\
  --to ${toEmail} \\
  --from ${fromEmail} \\
  --server ${host}:${port} \\
  --header 'Subject: Hello from mailtrap-local' \\
  --body 'It works.'`,
      },
    ],
  },
]

export const SNIPPETS_FLAT: Snippet[] = SNIPPET_GROUPS.flatMap((g) => g.items)

export function findGroupForSnippet(snippetId: string): SnippetGroup | undefined {
  return SNIPPET_GROUPS.find((g) => g.items.some((i) => i.id === snippetId))
}

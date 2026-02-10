import {EmailMessage} from "cloudflare:email";
import {createMimeMessage, Mailbox} from "mimetext";

interface Env {
    SEB: SendEmailClient;
    EMAIL_QUEUE: Queue<EmailQueueMessage>;
    SENDER_ADDRESS: string;
    SENDER_NAME: string;
    RECIPIENT_ADDRESS: string;
    CONTACT_PATH: string;
    BASE_DELAY_SECONDS: number;
    TURNSTILE_SECRET_KEY: string;
}

interface SendEmailClient {
    send(message: EmailMessage): Promise<void>;
}

interface EmailEnvelope {
    name: string;
    email: string;
    message: string;
}

interface EmailQueueMessage {
    type: 'send_contact_email';
    data: EmailEnvelope;
    timestamp: number;
}

interface TurnstileResponse {
    success: boolean;
    challenge_ts: string;
    hostname: string;
    'error-codes': string[];
    action?: string;
    cdata?: string;
    metadata?: {
        ephemeral_id: string;
    };
}

export default {
    async fetch(request: Request, env: Env) {
        if (request.method == "POST" && request.url.endsWith("/api/contact")) {
            const formData = await request.formData();
            const name = formData.get("name") as string;
            const email = formData.get("email") as string;
            const message = formData.get("message") as string;
            const cfTurnstileResponse = formData.get("cf-turnstile-response");

            if (!name || !email || !message || !cfTurnstileResponse) {
                return new Response("Missing required fields", {status: 400});
            }

            if (name.length > 255) {
                return new Response("Validation error", {status: 400});
            }

            if (email.length > 254) {
                return new Response("Validation error", {status: 400});
            }

            if (message.length > 1000) {
                return new Response("Validation error", {status: 400});
            }

            try {
                const fdSv = new FormData();
                fdSv.append("secret", env.TURNSTILE_SECRET_KEY);
                fdSv.append("response", cfTurnstileResponse);
                fdSv.append("remoteip",
                    request.headers.get('CF-Connecting-IP') ||
                    request.headers.get('X-Forwarded-For') ||
                    'unknown');

                const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
                    method: 'POST',
                    body: fdSv
                });

                const validation = await res.json() as TurnstileResponse;
                if (!validation.success) {
                    console.log('Invalid token:', validation["error-codes"]);
                    return new Response('Invalid verification', {status: 400});
                }
            } catch (error) {
                console.error('Turnstile validation error:', error);
                return new Response('Validation error', {status: 400});
            }

            const emailEnvelope: EmailEnvelope = {
                name: name,
                email: email,
                message: message
            };

            try {
                await env.EMAIL_QUEUE.send({
                    type: 'send_contact_email',
                    data: emailEnvelope,
                    timestamp: Date.now()
                } as EmailQueueMessage);

                console.log(`Email queued.\nFor: ${email}\nFrom: ${name}`);
                return new Response("Email sent successfully.", {status: 200});
            } catch (e) {
                console.error(`Error queuing email.\nError: ${e}`);
                return new Response(`Error: ${(e as Error).message}`, {status: 500});
            }
        }

        return new Response("Not Found", {status: 404});
    },
    async queue(batch: MessageBatch<EmailQueueMessage>, env: Env) {
        const baseDelaySeconds = env.BASE_DELAY_SECONDS || 30;

        for (const it of batch.messages) {
            const envelope = it.body.data;
            const attemptNum = it.attempts;

            const mimeMsg = createMimeMessage();
            mimeMsg.setSender({addr: env.SENDER_ADDRESS, name: env.SENDER_NAME});
            mimeMsg.setRecipient(env.RECIPIENT_ADDRESS);
            mimeMsg.setHeader("Reply-To", new Mailbox({addr: envelope.email, name: envelope.name}));
            mimeMsg.setSubject("Submission");
            mimeMsg.addMessage({
                contentType: "text/plain",
                data: `${envelope.name}\n${envelope.email}\n\n${envelope.message}`
            });

            const emailMessage = new EmailMessage(
                env.SENDER_ADDRESS,
                env.RECIPIENT_ADDRESS,
                mimeMsg.asRaw()
            );

            console.log(`Sending email.\nTo: ${envelope.email}\nAttempt: ${attemptNum}`);

            try {
                await env.SEB.send(emailMessage);

                console.log("Email sent successfully.");

                it.ack();
            } catch (error: any) {
                const errorMessage = (error as Error).message || String(error);
                const status = error.status || error.code;

                console.log(`Error sending email.\nError: ${errorMessage}\nStatus: ${status}`);

                if (![421, 450, 503, 504].includes(status)) {
                    console.error("Email send failed - PERMANENT.");

                    throw error;
                } else {
                    const totalDelaySeconds = Math.ceil(baseDelaySeconds * Math.pow(2, attemptNum - 1) + Math.random() * 5);

                    console.warn(`Transient error.\nRetrying in: ${totalDelaySeconds}s`);

                    it.retry({delaySeconds: totalDelaySeconds});
                }
            }
        }
    }
} as ExportedHandler<Env>;
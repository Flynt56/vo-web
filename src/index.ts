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

interface MailboxAddress {
    address: string;
    name?: string;
}

interface EmailEnvelope {
    sender: MailboxAddress;
    message: string;
}

interface EmailQueueMessage {
    type: 'send_contact_email';
    data: EmailEnvelope;
    sender: MailboxAddress;
    recipient: MailboxAddress;
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
                sender: {name, address: email},
                message: message
            };

            try {
                await env.EMAIL_QUEUE.send({
                    type: 'send_contact_email',
                    data: emailEnvelope,
                    sender: {name: env.SENDER_NAME, address: env.SENDER_ADDRESS},
                    recipient: {address: env.RECIPIENT_ADDRESS},
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
    }
} as ExportedHandler<Env>;
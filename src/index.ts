interface Env {
    SENDER_ADDRESS: string;
    SENDER_NAME: string;
    RECIPIENT_ADDRESS: string;
    CONTACT_PATH: string;
    TURNSTILE_SECRET_KEY: string;
    CONTACT_HANDLER: Fetcher;
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
        if (request.method == "POST" && request.url.endsWith(env.CONTACT_PATH)) {
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

            try {
                const fd = new URLSearchParams({
                    'site_id': 'vo',
                    'user_name': name,
                    'user_address': email,
                    'sender_address': env.SENDER_ADDRESS,
                    'sender_name': env.SENDER_NAME,
                    'recipient_address': env.RECIPIENT_ADDRESS,
                    message: message
                });

                await env.CONTACT_HANDLER.fetch('https://CONTACT_HANDLER/api/contact', {method: 'post', body: fd});

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
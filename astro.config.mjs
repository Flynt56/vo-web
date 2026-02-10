// @ts-check
import {defineConfig, envField} from 'astro/config';
import sitemap from '@astrojs/sitemap';
import Locale from "./src/assets/Locale.ts";

// https://astro.build/config
export default defineConfig({
    prefetch: true,
    integrations: [sitemap()],
    trailingSlash: "never",
    site: "https://www.ib.actor",
    i18n: {
        defaultLocale: Locale.default,
        locales: Locale.supported
    },
    env: {
        schema: {
            PUBLIC_TURNSTILE_URL: envField.string({context: 'client', access: 'public'}),
            PUBLIC_TURNSTILE_SITE_KEY: envField.string({context: 'client', access: 'public'})
        },
    }
});
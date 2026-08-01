import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        include: ["tests/**/*.test.ts"],
        setupFiles: ["tests/setup.ts"],
        clearMocks: true,
        restoreMocks: true,
        unstubGlobals: true,
        environmentOptions: {
            jsdom: {
                url: "https://www.esjzone.cc/forum/1/2.html"
            }
        }
    }
});

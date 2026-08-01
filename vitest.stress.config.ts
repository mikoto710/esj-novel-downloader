import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        include: ["tests/stress/**/*.stress.test.ts"],
        setupFiles: ["tests/setup.ts"],
        clearMocks: true,
        restoreMocks: true,
        unstubGlobals: true,
        testTimeout: 60_000,
        environmentOptions: {
            jsdom: {
                url: "https://www.esjzone.cc/forum/1/2.html"
            }
        }
    }
});

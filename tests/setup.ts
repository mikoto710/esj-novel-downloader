import "fake-indexeddb/auto";
import { afterEach, beforeEach } from "vitest";
import { cleanupTestEnvironment, resetTestEnvironment } from "./support/environment";

beforeEach(() => {
    resetTestEnvironment();
});

afterEach(async () => {
    await cleanupTestEnvironment();
});

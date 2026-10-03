export function getErrorDetails(error: unknown): { name: string; message: string } {
    return error instanceof Error
        ? { name: error.name, message: error.message }
        : { name: "Error", message: String(error) };
}

export function isCancellationError(error: unknown): boolean {
    return getErrorDetails(error).name === "AbortError";
}

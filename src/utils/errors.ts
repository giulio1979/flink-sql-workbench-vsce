export function normalizeError(error: unknown): { message: string; stack?: string } {
    if (!error) {
        return { message: 'Unknown error' };
    }
    if (error instanceof Error) {
        return { message: error.message || 'Error', stack: error.stack };
    }
    try {
        return { message: String(error) };
    } catch (e) {
        return { message: 'Unknown error' };
    }
}

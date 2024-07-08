

/**
 * Types for remote errors.
 */
export type RemoteErrorCode = "worker-disappeared" | "invalid-message" | "call-failed"

//TODO evaluate these, which do we need?

/**
 * A special error with a retryable property, used when a migrating worker dies.
 */
export class RemoteError extends Error {

    constructor(readonly code: RemoteErrorCode, message: string, options?: ErrorOptions) {
        super(message, options)
    }

}


import { Observable, Subscribable } from "rxjs"

export type Target = object
export type ID = string | number | symbol
export type Allowed = Subscribable<unknown> | PromiseLike<unknown> | string | number | boolean | null | undefined | void | bigint | unknown[] | ({ [k: string]: unknown } & { subscribe?: never })
export type Returning<T> = T extends Observable<infer R> ? Observable<R> : (T extends PromiseLike<infer R> ? PromiseLike<R> : PromiseLike<T>)
export type Members<T extends Target> = { [K in string & keyof T as T[K] extends Allowed | ((...args: any) => Allowed) ? K : never]: T[K] }
export type Input<T> = T extends ((...args: any) => Allowed) ? Parameters<T> : void[]
export type Output<T> = T extends ((...args: any) => Allowed) ? Returning<ReturnType<T>> : Returning<T>
export type Result<T = unknown> = Observable<T> & PromiseLike<T>

export type Remote<T extends Target> = {

    [K in keyof Members<T>]: (...input: Input<Members<T>[K]>) => Output<Members<T>[K]>

}

export type Call = {
    readonly type: "execute"
    readonly id: ID
    readonly command: string | number | symbol
    readonly data: readonly unknown[]
} | {
    readonly type: "subscribe"
    readonly id: ID
    readonly command: string | number | symbol
    readonly data: readonly unknown[]
} | {
    readonly type: "unsubscribe"
    readonly id: ID
}

export type Answer = {
    readonly type: "fulfilled"
    readonly id: ID
    readonly value: unknown
} | {
    readonly type: "next"
    readonly id: ID
    readonly value: unknown
} | {
    readonly type: "error"
    readonly id: ID
    readonly error: unknown
} | {
    readonly id: ID
    readonly type: "complete"
}

/**
 * The backend object that receives calls and sends back answers. It's an observable, so to start running it, just subscribe to it.
 */
export type Receiver = Observable<void>

/**
 * The frontend object that translates calls to messages.
 */
export interface Sender {

    /**
     * Call a command on the remote.
     * @param command Command name.
     * @param data Arguments in an array.
     */
    call(command: string, ...data: readonly unknown[]): Result<unknown>

    /**
     * Close this sender and disconnect from the remote.
     */
    close(): void

}

/**
 * A special error with a retryable property, used when a migrating worker dies.
 */
export class RemoteError extends Error {

    constructor(readonly retryable: boolean, message?: string, options?: ErrorOptions) {
        super(message, options)
    }

}

/**
 * Proxy a sender as an object type.
 * @param sender Sender.
 * @returns A proxy object.
 */
export function proxy<T extends Target>(sender: Sender) {
    const proxy = new Proxy(sender, {
        get(target, key) {
            return (...args: unknown[]) => target.call(key as any, ...args as any)
        }
    })
    return proxy as Remote<T>
}

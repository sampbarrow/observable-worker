
import { Observable } from "rxjs"
import { ObservableAndPromise } from "./util"

export type Target = object
export type ID = string | number | symbol
export type Allowed = Observable<unknown> | PromiseLike<unknown> | string | number | boolean | null | undefined | void | bigint | unknown[] | ({ [k: string]: unknown } & { subscribe?: never, pipe?: never })
//export type RemoteType<T> = T extends Observable<infer R> ? ObservableResult<R> : (T extends PromiseLike<infer R> ? PromiseResult<R> : PromiseResult<T>)
export type Members<T extends Target> = { [K in string & keyof T as T[K] extends Allowed | ((...args: any) => Allowed) ? K : never]: T[K] }
export type Input<T> = T extends ((...args: any) => Allowed) ? Parameters<T> : void[]
export type Output<T> = T extends ((...args: any) => Allowed) ? RemoteType<ReturnType<T>> : RemoteType<T>

//TODO cleanup

export type RemoteType<T> = T extends Observable<infer R> ? Observable<R> : (T extends PromiseLike<infer R> ? PromiseLike<R> : PromiseLike<T>)

export type ObservableMembers<T extends Target> = { [K in keyof T as Output<T[K]> extends Observable<unknown> ? K : never]: T[K] }
export type PromiseMembers<T extends Target> = { [K in keyof T as Output<T[K]> extends PromiseLike<unknown> ? K : never]: T[K] }

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
export type Exposed = Observable<void>

/**
 * The frontend object that translates calls to messages.
 */
export interface Wrapper {

    /**
     * Call a command on the remote.
     * @param command Command name.
     * @param data Arguments in an array.
     */
    call(command: string, ...data: readonly unknown[]): ObservableAndPromise<unknown>

    /**
     * Close this sender and disconnect from the remote.
     */
    close(): void

}

/**
 * Proxy a wrapper as an object type.
 * @param sender Sender.
 * @returns A proxy object.
 */
export function proxy<T extends Target>(sender: Wrapper) {
    const proxy = new Proxy(sender, {
        get(target, key) {
            return (...args: unknown[]) => target.call(key as any, ...args as any)
        }
    })
    return proxy as Remote<T>
}

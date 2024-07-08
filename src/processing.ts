
import { Observable, ObservableNotification } from "rxjs"
import { ObservableAndPromise } from "./util"

export type Target = object
export type ID = string | number | symbol
export type Allowed = Observable<unknown> | PromiseLike<unknown> | string | number | boolean | null | undefined | void | bigint | unknown[] | ({ [k: string]: unknown } & { subscribe?: never, pipe?: never })
export type Members<T extends Target> = { [K in string & keyof T as T[K] extends Allowed | ((...args: any) => Allowed) ? K : never]: T[K] }
export type Input<T> = T extends ((...args: any) => Allowed) ? Parameters<T> : void[]
export type Output<T> = T extends ((...args: any) => Allowed) ? Remoted<ReturnType<T>> : Remoted<T>
export type Remoted<T> = T extends Observable<infer R> ? Observable<R> : (T extends PromiseLike<infer R> ? PromiseLike<R> : PromiseLike<T>)

//export type Value<T> = T extends Observable<infer R> ? R : (T extends PromiseLike<infer R> ? R : T)
//export type ObservableMembers<T extends Target> = { [K in keyof T as Output<T[K]> extends Observable<unknown> ? K : never]: T[K] }
//export type PromiseMembers<T extends Target> = { [K in keyof T as Output<T[K]> extends PromiseLike<unknown> ? K : never]: T[K] }

export type Proxied<T extends Target> = {

    readonly [K in keyof Members<T>]: (...input: Input<Members<T>[K]>) => Output<Members<T>[K]>

}

export type ExecuteCall = {

    readonly kind: "X"
    readonly id: ID
    readonly command: string | number
    readonly data: readonly unknown[]

}

export type SubscribeCall = {

    readonly kind: "S"
    readonly id: ID
    readonly command: string | number
    readonly data: readonly unknown[]

}

export type UnsubscribeCall = {

    readonly kind: "U"
    readonly id: ID

}

export type Call = ExecuteCall | SubscribeCall | UnsubscribeCall

export type Answer = ObservableNotification<unknown> & {

    readonly id: ID

}

export interface Callable {

    /**
     * Call a command on the remote.
     * @param command Command name.
     * @param data Arguments in an array.
     */
    call(command: string, ...data: readonly unknown[]): ObservableAndPromise<unknown>

}

/**
 * The frontend object that translates calls to messages and sends them over a connection.
 */
export interface Sender extends Callable {

    /**
     * Close this sender and disconnect from the remote.
     */
    close(): void

}

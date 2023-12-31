
import { Observable, ObservableNotification } from "rxjs"

export type Target = object
export type ID = string | number | symbol
export type Allowed = Observable<unknown> | PromiseLike<unknown> | string | number | boolean | null | undefined | void | bigint | unknown[] | ({ [k: string]: unknown } & { subscribe?: never, pipe?: never })
export type Members<T extends Target> = { [K in string & keyof T as T[K] extends Allowed | ((...args: any) => Allowed) ? K : never]: T[K] }
export type Input<T> = T extends ((...args: any) => Allowed) ? Parameters<T> : void[]
export type Output<T> = T extends ((...args: any) => Allowed) ? Remoted<ReturnType<T>> : Remoted<T>
export type Value<T> = T extends Observable<infer R> ? R : (T extends PromiseLike<infer R> ? R : T)
export type Remoted<T> = T extends Observable<infer R> ? Observable<R> : (T extends PromiseLike<infer R> ? PromiseLike<R> : PromiseLike<T>)
export type ObservableMembers<T extends Target> = { [K in keyof T as Output<T[K]> extends Observable<unknown> ? K : never]: T[K] }
export type PromiseMembers<T extends Target> = { [K in keyof T as Output<T[K]> extends PromiseLike<unknown> ? K : never]: T[K] }

//TODO cleanup
//export type RemoteType<T> = T extends Observable<infer R> ? ObservableResult<R> : (T extends PromiseLike<infer R> ? PromiseResult<R> : PromiseResult<T>)

export type Proxied<T extends Target> = {

    [K in keyof Members<T>]: (...input: Input<Members<T>[K]>) => Output<Members<T>[K]>

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

export type Answer = ObservableNotification<unknown> & { id: ID }

/**
 * The backend object that receives calls and sends back answers. It's an observable, so to start running it, just subscribe to it.
 */
export type Receiver = Observable<void>

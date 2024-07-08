
import { Observable } from "rxjs"

export type Target = object
export type ID = string | number
export type Primitive = string | number | boolean | null | undefined | void | bigint | { readonly [k: string]: Primitive } | readonly Primitive[]
export type Allowed = Observable<unknown> | PromiseLike<unknown> | Primitive
export type Remoted<T> = T extends Observable<infer R> ? Observable<R> : (T extends PromiseLike<infer R> ? PromiseLike<R> : PromiseLike<T>)
export type Input<T> = T extends ((...args: any) => Allowed) ? Parameters<T> : readonly void[]
export type Output<T> = T extends ((...args: any) => Allowed) ? Remoted<ReturnType<T>> : Remoted<T>
export type Members<T extends Target> = { [K in string & keyof T as T[K] extends Allowed | ((...args: any) => Allowed) ? K : never]: T[K] }

export type Proxied<T extends Target> = {

    readonly [K in keyof Members<T>]: (...input: Input<Members<T>[K]>) => Output<Members<T>[K]>

}

export interface ExecuteRequest {

    readonly kind: "execute"
    readonly id: ID
    readonly command: string | number
    readonly data: readonly unknown[]

}

export interface SubscribeRequest {

    readonly kind: "subscribe"
    readonly id: ID
    readonly command: string | number
    readonly data: readonly unknown[]

}

export interface UnsubscribeRequest {

    readonly kind: "unsubscribe"
    readonly id: ID

}

export interface FulfilledResponse {

    readonly kind: "fulfilled"
    readonly id: ID
    readonly value: unknown

}

export interface RejectedResponse {

    readonly kind: "rejected"
    readonly id: ID
    readonly error: unknown

}

export interface NextResponse {

    readonly kind: "next"
    readonly id: ID
    readonly value: unknown

}

export interface ErrorResponse {

    readonly kind: "error"
    readonly id: ID
    readonly error: unknown

}

export interface CompleteResponse {

    readonly kind: "complete"
    readonly id: ID

}

export type Request = ExecuteRequest | SubscribeRequest | UnsubscribeRequest

export type Response = FulfilledResponse | RejectedResponse | NextResponse | ErrorResponse | CompleteResponse

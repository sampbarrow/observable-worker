
import { CompleteNotification, ErrorNotification, NextNotification, Observable } from "rxjs"

export type Target = object
export type ID = string | number
export type Primitive = string | number | boolean | null | undefined | void | bigint | { readonly [k: string]: Primitive } | readonly Primitive[]
export type Allowed = Observable<unknown> | PromiseLike<unknown> | Primitive
export type Remoted<T> = T extends Observable<infer R> ? Observable<R> : (T extends PromiseLike<infer R> ? PromiseLike<R> : PromiseLike<T>)
export type Input<T> = T extends ((...args: any) => Allowed) ? Parameters<T> : readonly void[]
export type Output<T> = T extends ((...args: any) => Allowed) ? Remoted<ReturnType<T>> : Remoted<T>
export type Members<T extends Target> = { [K in string & keyof T as T[K] extends Member ? K : never]: T[K] }
export type Member = Allowed | ((...args: any) => Allowed)

export type Proxied<T extends Target> = {

    readonly [K in keyof Members<T>]: (...input: Input<Members<T>[K]>) => Output<Members<T>[K]>

}

export interface SubscribeRequest {

    readonly kind: "S"
    readonly id: ID
    readonly command: string | number
    readonly data: readonly unknown[]

}

export interface UnsubscribeRequest {

    readonly kind: "U"
    readonly id: ID

}

export interface NextResponse extends NextNotification<unknown> {

    readonly id: ID

}

export interface ErrorResponse extends ErrorNotification {

    readonly id: ID

}

export interface CompleteResponse extends CompleteNotification {

    readonly id: ID

}

export type Request = SubscribeRequest | UnsubscribeRequest

export type Response = NextResponse | ErrorResponse | CompleteResponse

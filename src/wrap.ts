import { customAlphabet } from "nanoid"
import PLazy from "p-lazy"
import { Observable, Subject, concatWith, dematerialize, filter, finalize, ignoreElements, lastValueFrom, merge, mergeMap, of, switchMap, throwError } from "rxjs"
import { Channel } from "./channel"
import { Proxied, Request, Response, Target } from "./types"
import { RemoteError } from "./util"

export interface Remote<T extends Target> {

    /**
     * The proxied object.
     */
    readonly proxy: Proxied<T>

    /**
     * Close this remote.
     */
    close(): void

}

export interface WrapOptions {

    /**
     * The channel to wrap.
     */
    readonly channel: Channel<Response, Request>

    /**
     * A function to generate an ID.
     */
    readonly generateId?: (() => string) | undefined

}

export function wrap<T extends Target>(options: WrapOptions): Remote<T> {
    const closed = new Subject<void>()
    const connection = options.channel()
    return {
        proxy: proxy((command: string, ...data: readonly unknown[]) => {
            const call = (kind: "subscribe" | "execute") => {
                return merge(
                    of(connection),
                    closed.pipe(concatWith(throwError(() => new Error("This remote is closed.")))).pipe(ignoreElements())
                ).pipe(
                    switchMap(connection => {
                        const id = options.generateId?.() ?? generateId()
                        connection.next({
                            kind,
                            id,
                            command,
                            data,
                        })
                        const observable = connection.pipe(
                            filter(message => message.id === id),
                            mergeMap(message => {
                                if (kind === "subscribe") {
                                    if (message.kind === "next") {
                                        return [
                                            {
                                                kind: "N" as const,
                                                value: message.value,
                                            }
                                        ]
                                    }
                                    else if (message.kind === "error") {
                                        return [
                                            {
                                                kind: "E" as const,
                                                error: message.error,
                                            }
                                        ]
                                    }
                                    else if (message.kind === "complete") {
                                        return [
                                            {
                                                kind: "C" as const
                                            }
                                        ]
                                    }
                                    else {
                                        throw new RemoteError("invalid-message", "Trying to treat a promise as an observable.")
                                    }
                                }
                                else {
                                    if (message.kind === "fulfilled") {
                                        return [
                                            {
                                                kind: "N" as const,
                                                value: message.value,
                                            }, {
                                                kind: "C" as const
                                            }
                                        ]
                                    }
                                    else if (message.kind === "rejected") {
                                        return [
                                            {
                                                kind: "E" as const,
                                                error: message.kind
                                            }, {
                                                kind: "C" as const,
                                            }
                                        ]
                                    }
                                    else {
                                        throw new RemoteError("invalid-message", "Trying to treat an observable as a promise.")
                                    }
                                }
                            }),
                            finalize(() => {
                                if (kind === "subscribe") {
                                    connection.next({
                                        kind: "unsubscribe",
                                        id
                                    })
                                }
                            }),
                        )
                        return observable
                    }),
                    dematerialize(),
                )
            }
            return new ObservableAndPromise(call("subscribe"), PLazy.from(() => lastValueFrom(call("execute"))))
        }),
        close: () => {
            closed.complete()
            connection.close()
        }
    }
}

/**
 * Utility class for combining and observable and promise.
 */
export class ObservableAndPromise<T> extends Observable<T> implements PromiseLike<T> {

    constructor(private readonly observable: Observable<T>, private readonly promise: PromiseLike<T>) {
        super(subscriber => this.observable.subscribe(subscriber))
    }

    then<TResult1 = T, TResult2 = never>(onFulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null | undefined, onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null | undefined) {
        return this.promise.then(onFulfilled, onRejected)
    }

}

export function proxy<T extends Target>(target: (command: string, ...data: readonly unknown[]) => unknown) {
    return new Proxy(target, {
        get(target, key) {
            if (typeof key === "symbol") {
                throw new Error("No symbol calls on a proxy.")
            }
            return (...args: unknown[]) => target(key, ...args)
        }
    }) as unknown as Proxied<T>
}

/**
 * Generate a unique string ID.
 */
export function generateId() {
    return customAlphabet("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 22)()
}

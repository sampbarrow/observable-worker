
import pDefer from "p-defer"
import { NextObserver, Observable } from "rxjs"
import { v4 } from "uuid"
import { Connection } from "./channel"

export const WORKER_LOG = false

/**
 * Config for utility class for combining and observable and observer.
 */
export type ObservableAndObserverConfig<I, O> = {

    readonly observable: Observable<I>
    readonly observer: NextObserver<O>

    close?(): void

}

/**
 * Utility class for combining and observable and observer.
 */
export class ObservableAndObserver<I, O> extends Observable<I> implements Connection<I, O> {

    constructor(private readonly config: ObservableAndObserverConfig<I, O>) {
        super(subscriber => {
            return config.observable.subscribe(subscriber)
        })
    }

    close() {
        return this.config.close?.()
    }

    next(value: O) {
        this.config.observer.next(value)
    }

}

/**
 * Utility class for combining and observable and promise.
 */
export class ObservableAndPromise<T> extends Observable<T> implements PromiseLike<T> {

    constructor(observable: Observable<T>, private readonly promise: PromiseLike<T>) {
        super(subscriber => {
            return observable.subscribe(subscriber)
        })
    }

    then<TResult1 = T, TResult2 = never>(onFulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null | undefined, onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null | undefined) {
        return this.promise.then(onFulfilled, onRejected)
    }

}

/**
 * Utility type for anything that has a postMessage method.
 */
export type HasPostMessage<T = unknown> = {

    postMessage(value: T): void

}

/**
 * A hack function to acquire a web lock and hold onto it.
 */
export async function acquireWebLock(name: string, options?: LockOptions) {
    return new Promise<() => void>(resolve => {
        navigator.locks.request(name, options ?? {}, () => {
            const defer = pDefer<void>()
            resolve(defer.resolve)
            return defer.promise
        })
    })
}

/**
 * A hack function to acquire a web lock as an observable. Releases when unsubscribed.
 */
export function observeWebLock(name: string, options?: Omit<LockOptions, "signal">) {
    return new Observable<void>(subscriber => {
        const controller = new AbortController()
        const lock = acquireWebLock(name, { ...options, signal: controller.signal })
        lock.then(() => subscriber.next()).catch(error => subscriber.error(error))
        return () => {
            controller.abort()
            lock.then(release => release())
        }
    })
}

/**
 * Generate a unique string ID.
 */
export function generateId() {
    return v4()
}

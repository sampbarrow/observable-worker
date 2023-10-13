
import pDefer from "p-defer"
import { Observable, Observer } from "rxjs"
import { v4 } from "uuid"
import { ValueOrFactory, callOrGet } from "value-or-factory"
import { Connection } from "./channel"

/**
 * Config for utility class for combining and observable and observer.
 */
export type ObservableAndObserverConfig<I, O> = {

    readonly observable: Observable<I>
    readonly observer: Observer<O>

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

    complete() {
        return this.config.observer.complete()
    }
    next(value: O) {
        return this.config.observer.next(value)
    }
    error(error: unknown) {
        return this.config.observer.error(error)
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

/**
 * A deferred observable that performs a cleanup action on unsubscribe.
 */
export function closing<T>(factory: ValueOrFactory<T>, close: (value: T) => void) {
    return new Observable<T>(subscriber => {
        const value = callOrGet(factory)
        subscriber.next(value)
        return () => {
            close(value)
        }
    })
}

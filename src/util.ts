
import { customAlphabet } from "nanoid"
import pDefer from "p-defer"
import { EMPTY, Observable, Observer, Subscription, defer, first, map, mergeMap } from "rxjs"
import { Connection } from "./channel"
import { Allowed, Target } from "./processing"

export type Next<O> = Pick<Observer<O>, "next"> | Observer<O>["next"]

/**
 * Config for utility class for combining and observable and observer.
 */
export type ObservableAndObserverConfig<I, O> = {

    readonly observable: Observable<I>
    readonly observer: Pick<Observer<O>, "next"> | Observer<O>["next"]

}



/**
 * Utility class for combining and observable and observer.
 */
export class ObservableAndObserver<I, O> extends Observable<I> implements Connection<I, O> {

    constructor(observable: Observable<I>, private readonly observer: Next<O>) {
        super(subscriber => {
            return observable.subscribe(subscriber)
        })
    }

    next(value: O) {
        if (typeof this.observer === "function") {
            return this.observer(value)
        }
        else {
            return this.observer.next(value)
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

/**
 * Utility type for anything that has a postMessage method.
 */
export type HasPostMessage<T = unknown> = {

    postMessage(value: T): void

}

/**
 * Utility type for anything that has a postMessage method.
 */
export type HasPostMessageWithTransferrables<T = unknown> = {

    postMessage(value: T, transfer?: Transferable[] | undefined): void

}

/**
 * A hack function to acquire a web lock and hold onto it.
 */
export async function acquireWebLock(name: string, options?: LockOptions) {
    return new Promise<() => void>((resolve, reject) => {
        navigator.locks.request(name, options ?? {}, () => {
            const defer = pDefer<void>()
            resolve(defer.resolve)
            return defer.promise
        }).catch(e => {
            reject(e)
        })
    })
}

/**
 * A hack function to acquire a randomly named web lock as an observable. Releases when unsubscribed.
 */
export function randomLock(tag: string = "") {
    return defer(() => {
        const lockId = tag + generateId()
        return holdWebLock(lockId).pipe(map(() => lockId))
    })
}

export function onWebLockAvailable(name: string) {
    return holdWebLock(name, { mode: "shared" }).pipe(first())
}

/**
 * A hack function to acquire a web lock as an observable. Releases when unsubscribed.
 */
export function holdWebLock(name: string, options?: Omit<LockOptions, "signal">) {
    return new Observable<void>(subscriber => {
        const controller = new AbortController()
        const lock = acquireWebLock(name, { ...options, signal: controller.signal })
        lock.then(() => subscriber.next()).catch(error => {
            if (error instanceof DOMException && error.code === error.ABORT_ERR) {
                return
            }
            subscriber.error(error)
        })
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
    return customAlphabet("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 22)()
}

/**
 * A deferred observable that performs a cleanup action on unsubscribe.
 */
export function closing<T>(factory: () => T, close: (value: T) => void) {
    return new Observable<T>(subscriber => {
        const value = factory()
        subscriber.next(value)
        return () => {
            close(value)
        }
    })
}

/**
 * Types for remote errors.
 */
export type RemoteErrorCode = "timeout" | "worker-disappeared" | "invalid-message" | "call-failed"

/**
 * A special error with a retryable property, used when a migrating worker dies.
 */
export class RemoteError extends Error {

    constructor(readonly code: RemoteErrorCode, message: string, options?: ErrorOptions) {
        super(message, options)
    }

}

export type RegistryAction<K, V> = {
    readonly action: "add"
    readonly key: K
    readonly observable: Observable<V>
} | {
    readonly action: "delete"
    readonly key: K
} | {
    readonly action: "clear"
}

export function registryWith<K, V>() {
    return (observable: Observable<RegistryAction<K, V>>) => {
        return registry(observable)
    }
}

/**
 * An observable that combines other observables, but also allows removing them.
 */
export function registry<K, V>(observable: Observable<RegistryAction<K, V>>) {
    const observables = new Map<K, Subscription>()
    return observable.pipe(
        /*
        finalize(() => {
            observables.forEach(observable => observable.unsubscribe())
            observables.clear()
        }),
        */
        mergeMap(action => {
            if (action.action === "add") {
                return new Observable<readonly [K, V]>(subscriber => {
                    const subscription = action.observable.pipe(map(value => [action.key, value] as const)).subscribe(subscriber)
                    observables.set(action.key, subscription)
                    return () => {
                        subscription.unsubscribe()
                        observables.delete(action.key)
                    }
                })
            }
            else if (action.action === "clear") {
                observables.forEach(subscription => {
                    subscription.unsubscribe()
                })
                return EMPTY
            }
            else {
                const observable = observables.get(action.key)
                if (observable !== undefined) {
                    observable.unsubscribe()
                }
                return EMPTY
            }
        }),
    )
}

export function callOnTarget<T extends Target>(target: T, command: string | number | symbol, data: readonly unknown[]) {
    if (!(command in target)) {
        throw new Error("Command " + command.toString() + " does not exist.")
    }
    const property = target[command as keyof T]
    const returned = (() => {
        if (typeof property === "function") {
            return property.call(target, ...data) as Allowed
        }
        else {
            return property as Allowed
        }
    })()
    if (typeof returned === "object" && returned !== null && "subscribe" in returned && returned.subscribe !== undefined) {
        return {
            observable: returned,
        }
    }
    else {
        return {
            promise: async () => await returned
        }
    }
}

export function proxy<I extends object, O extends object>(target: I, handler: ProxyHandler<I>) {
    return new Proxy(target, handler) as unknown as O
}

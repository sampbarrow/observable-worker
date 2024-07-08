
import { customAlphabet } from "nanoid"
import { EMPTY, NextObserver, Observable, Subscription, finalize, map, mergeMap } from "rxjs"
import { Allowed, Callable, Proxied, Target } from "./processing"

export type Next<O> = NextObserver<O> | NextObserver<O>["next"]

/**
 * Config for utility class for combining and observable and observer.
 */
export type ObservableAndObserverConfig<I, O> = {

    readonly observable: Observable<I>
    readonly observer: Next<O>

}

/**
 * Utility class for combining and observable and observer.
 */
export class ObservableAndObserver<I, O> extends Observable<I> implements NextObserver<O> {

    constructor(observable: Observable<I>, private readonly observer: Next<O>, readonly close: () => void = () => void 0) {
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
 * Generate a unique string ID.
 */
export function generateId() {
    return customAlphabet("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 22)()
}

/**
 * A deferred observable that performs a cleanup action on unsubscribe.
 * @deprecated
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

/**
 * An observable that combines other observables, but also allows removing them.
 */
export function registry<K, V>(observable: Observable<RegistryAction<K, V>>) {
    const observables = new Map<K, Subscription>()
    return observable.pipe(
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
        finalize(() => {
            observables.forEach(observable => observable.unsubscribe())
            observables.clear()
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

/*
export function proxy<I extends object, O extends object>(target: I, handler: ProxyHandler<I>) {
    return new Proxy(target, handler) as unknown as O
}
*/

export function proxy<T extends Target>(sender: Callable) {
    return new Proxy(sender, {
        get(target, key) {
            if (typeof key === "symbol") {
                throw new Error("No symbol calls on a proxy.")
            }
            return (...args: unknown[]) => target.call(key, ...args)
        }
    }) as unknown as Proxied<T>
}

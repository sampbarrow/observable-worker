import { Observable, Observer, combineLatest, first, fromEvent, map, merge, mergeMap, of, skip, startWith, switchMap, throwError, timer } from "rxjs"
import { HasEventTargetAddRemove } from "rxjs/internal/observable/fromEvent"
import { Batcher, BatcherOptions } from "./batcher"
import { HasPostMessage, Next, ObservableAndObserver, RemoteError, closing } from "./util"

/**
 * A channel creates Connection objects.
 */
export interface Channel<I, O> extends Observable<Connection<I, O>> {
}

export interface VolatileChannel<I, O> extends Observable<Connection<I, O> | undefined> {
}

/**
 * A connection sends and receives messages.
 */
export interface Connection<I, O> extends Observable<I>, Pick<Observer<O>, "next"> {
}

export namespace Channel {

    /**
     * A pre-created channel from this window's globalThis.
     */
    export const SELF = self<never, unknown>()

    /**
     * A pre-created channel from this window's globalThis.
     */
    export function self<I, O>() {
        return port<I, O>(of(globalThis))
    }

    export function unbatching<I, O>(channel: Channel<I[], O[]>) {
        return channel.pipe(
            map(connection => {
                return build<I, O>(connection.pipe(mergeMap(items => items)), value => connection.next([value]))
            })
        )
    }

    /**
     * Wraps another channel and batches any messages sent to it. Also treats incoming messages as batches.
     */
    export function batching<I, O>(channel: Channel<I[], O[]>, options?: BatcherOptions | undefined) {
        return channel.pipe(
            map(connection => {
                const batcher = new Batcher<O>(connection.next.bind(connection), options)
                return build<I, O>(
                    connection.pipe(mergeMap(items => items)),
                    batcher.add.bind(batcher)
                )
            })
        )
    }

    /**
     * Creates a channel from a broadcast channel.
     */
    export function broadcast<T>(name: string): Channel<T, T> {
        return port(closing(() => new BroadcastChannel(name), channel => setTimeout(() => channel.close(), 1000)))//TODO hack!!!!
    }

    /**
     * Creates a channel from a two broadcast channels, one for input and one for output.
     */
    export function dualBroadcast<I, O>(input: string, output: string): Channel<I, O> {
        return combine(broadcast<I>(input), broadcast<O>(output))
    }

    /**
     * Creates a channel from a worker.
     */
    export function worker<I, O>(url: string | URL, options?: WorkerOptions | undefined): Channel<I, O> {
        return port(closing(() => new Worker(url, options), worker => worker.terminate()))
    }

    /**
     * A two way port.
     */
    export type Port<I, O> = HasEventTargetAddRemove<MessageEvent<I>> & HasPostMessage<O>

    /**
     * Creates a channel from a port.
     */
    export function port<I = never, O = unknown>(open: Observable<Port<I, O>>): Channel<I, O> {
        return new Observable<Connection<I, O>>(subscriber => {
            const subscription = open.subscribe(object => {
                subscriber.next(build(fromEvent<MessageEvent<I>>(object, "message").pipe(map(_ => _.data)), object.postMessage.bind(object)))
            })
            return () => {
                subscription.unsubscribe()
            }
        })
    }

    /**
     * Combine and observable and observer into a channel.
     */
    export function combine<I, O>(input: Channel<I, never>, output: Channel<unknown, O>) {
        return combineLatest({ input, output }).pipe(
            map(connection => {
                return new ObservableAndObserver(connection.input, connection.output)
            })
        )
    }

    /**
     * Combine and observable and observer into a channel.
     */
    export function build<I, O>(observable: Observable<I>, next: Next<O>): Connection<I, O> {
        return new ObservableAndObserver(observable, next)
    }

    export function volatile<I, O>(channel: VolatileChannel<I, O>, retryOnInterrupt: boolean, connectionTimeout: number) {
        return merge(
            channel.pipe(first()),
            channel.pipe(
                skip(1),
                map(sender => {
                    if (retryOnInterrupt) {
                        return sender
                    }
                    else {
                        throw new RemoteError("worker-disappeared", "The worker disappeared. Please try again.")
                    }
                })
            )
        ).pipe(
            startWith(undefined),
            switchMap(connection => {
                if (connection === undefined) {
                    return timer(connectionTimeout).pipe(
                        mergeMap(() => {
                            return throwError(() => new RemoteError("timeout", "Could not establish a connection within the timeout of " + connectionTimeout.toLocaleString() + "ms."))
                        })
                    )
                }
                return of(connection)
            })
        )
    }

}

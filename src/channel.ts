import { Observable, Observer, combineLatest, fromEvent, map, mergeMap, of } from "rxjs"
import { HasEventTargetAddRemove } from "rxjs/internal/observable/fromEvent"
import { Batcher, BatcherOptions } from "./batcher"
import { HasPostMessage, ObservableAndObserver, ObservableAndObserverConfig, closing } from "./util"

/**
 * A channel creates Connection objects.
 */
export interface Channel<I, O> extends Observable<Connection<I, O>> {
}

/**
 * A connection sends and receives messages.
 */
export interface Connection<I, O> extends Observable<I>, Observer<O> {
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

    /**
     * Wraps another channel and batches any messages sent to it. Also treats incoming messages as batches.
     */
    export function batching<I, O>(channel: Channel<I[], O[]>, options?: BatcherOptions | undefined) {
        return channel.pipe(
            map(connection => {
                const batcher = new Batcher<O>(values => {
                    connection.next(values)
                }, options)
                return from<I, O>({
                    observable: connection.pipe(mergeMap(items => items)),
                    observer: {
                        next: value => {
                            batcher.add(value)
                        },
                        error: connection.error.bind(connection),
                        complete: connection.complete.bind(connection),
                    },
                })
            })
        )
    }

    /**
     * Creates a channel from a broadcast channel.
     */
    export function broadcast<T>(input: string): Channel<T, T> {
        return port(closing(() => new BroadcastChannel(input), channel => channel.close()))
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
                subscriber.next(from({
                    observable: fromEvent<MessageEvent<I>>(object, "message").pipe(map(_ => _.data)),
                    observer: {
                        next: (value: O) => {
                            object.postMessage(value)
                        },
                        error: error => {
                            console.error("Received an error on port.", error)
                            close?.()
                        },
                        complete: () => {
                            close?.()
                        }
                    },
                }))
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
                return new ObservableAndObserver({
                    observable: connection.input,
                    observer: connection.output,
                })
            })
        )
    }

    /**
     * Combine and observable and observer into a channel.
     */
    export function from<I, O>(config: ObservableAndObserverConfig<I, O>): Connection<I, O> {
        return new ObservableAndObserver(config)
    }

}

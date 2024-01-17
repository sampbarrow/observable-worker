import { Observable, Observer, combineLatest, concatWith, fromEvent, map, mergeMap, of, throwError } from "rxjs"
import { HasEventTargetAddRemove } from "rxjs/internal/observable/fromEvent"
import { Batcher, BatcherOptions } from "./batcher"
import { HasPostMessage, HasPostMessageWithTransferrables, Next, ObservableAndObserver, RemoteError, closing } from "./util"

export const DEFAULT_CONNECTION_TIMEOUT = 10000 //TODO why do we hit this when its syncing? should not be that backed up

/**
 * A connection sends and receives messages.
 */
export interface Connection<I, O> extends Observable<I>, Pick<Observer<O>, "next"> {
}

/**
 * A channel creates Connection objects.
 */
export interface Channel<I, O> extends Observable<Connection<I, O>> {
}

/**
 * A channel factory creates channels.
 */
export interface ChannelFactory<I, O> extends Observable<Channel<I, O>> {
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
                return from<I, O>(connection.pipe(mergeMap(items => items)), value => connection.next([value]))
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
                return from<I, O>(
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
        return port(closing(() => new BroadcastChannel(name), channel => () => channel.close()))
    }

    /**
     * Creates a channel from a two broadcast channels, one for input and one for output.
     */
    export function dualBroadcast<I, O>(input: string, output: string): Channel<I, O> {
        return combineLatest([broadcast<I>(input), broadcast<O>(output)]).pipe(map(([a, b]) => from(a, b)))
    }

    /**
     * Creates a channel from a worker.
     */
    export function worker<I, O>(url: string | URL, options?: WorkerOptions | undefined): Channel<I, O> {
        return port(closing(() => {
            console.log("TODO creating worker")
            return new Worker(url, options)
        }, worker => worker.terminate()))
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
                subscriber.next(from(
                    fromEvent<MessageEvent<I>>(object, "message").pipe(map(_ => _.data)),
                    value => {
                        object.postMessage(value)
                    }
                ))
            })
            return () => {
                subscription.unsubscribe()
            }
        })
    }

    /**
     * A two way port.
     */
    export type TransferrablePort<I, O> = HasEventTargetAddRemove<MessageEvent<I>> & HasPostMessageWithTransferrables<O>

    /**
     * Creates a channel from a port.
     */
    export function transferrablePort<I = never, O = unknown>(open: Observable<TransferrablePort<I, O>>): Channel<MessageEvent<I>, [O, Transferable[] | undefined]> {
        return new Observable<Connection<MessageEvent<I>, [O, Transferable[] | undefined]>>(subscriber => {
            const subscription = open.subscribe(object => {
                subscriber.next(from(fromEvent<MessageEvent<I>>(object, "message"), value => object.postMessage(...value)))
            })
            return () => {
                subscription.unsubscribe()
            }
        })
    }

    /**
     * Combine and observable and observer into a channel.
     */
    export function from<I, O>(observable: Observable<I>, next: Next<O>): Connection<I, O> {
        return new ObservableAndObserver(observable, next)
    }

    /*
    export function volatile2<I, O>(channel: VolatileChannel<I, O>, retryOnInterrupt: boolean, connectionTimeout: number) {
        if (retryOnInterrupt) {
            return channel //TODO timeout somehow
        }
        return channel.pipe(
            map(connection => {
                return connection.pipe(endWithError(() => new RemoteError("worker-disappeared", "The worker disappeared. Please try again.")))
            })
        )
    }
    export function volatile1<I, O>(channel: VolatileChannel<I, O>, retryOnInterrupt: boolean, connectionTimeout: number) {
        return volatile2(channel, retryOnInterrupt, connectionTimeout).pipe(switchMap(_ => _))
    }*/

}

export function timeoutError() {
    return throwError(() => new RemoteError("timeout", "This connection has timed out."))
}
export function withVolatility<I, O>(retryOnInterrupt: boolean, connectionTimeout = DEFAULT_CONNECTION_TIMEOUT) {
    return (observable: ChannelFactory<I, O>) => {
        if (retryOnInterrupt) {
            return observable //TODO timeout somehow
        }
        return observable.pipe(
            map(observable => {
                return observable.pipe(concatWith(throwError(() => new RemoteError("worker-disappeared", "The worker disappeared. Please try again."))))
            })
        )
    }
}

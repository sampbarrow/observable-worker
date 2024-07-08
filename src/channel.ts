import { Observable, Observer, fromEvent, map, mergeMap, tap } from "rxjs"
import { HasEventTargetAddRemove } from "rxjs/internal/observable/fromEvent"
import { ValueOrFactory, callOrGet } from "value-or-factory"
import { Batcher, BatcherOptions } from "./batcher"
import { HasPostMessage, Next, ObservableAndObserver } from "./util"

export const DEFAULT_CONNECTION_TIMEOUT = 10000 //TODO why do we hit this when its syncing? should not be that backed up

/**
 * A channel creates Connection objects.
 */
export type Channel<I, O> = () => Connection<I, O>

/**
 * A connection sends and receives messages.
 */
export interface Connection<I, O> extends Observable<I>, Pick<Observer<O>, "next"> {

    //TODO change - also all references
    close?: (() => void) | undefined

}

export namespace Channel {

    /**
     * A pre-created channel from this window's globalThis.
     */
    export const SELF = port(globalThis)

    /**
     * Wraps another channel and batches any messages sent to it. Also treats incoming messages as batches.
     */
    export function batching<I, O>(channel: Channel<readonly I[], readonly O[]>, options?: BatcherOptions | undefined) {
        return () => {
            const connection = channel()
            const batcher = new Batcher<O>(connection.next.bind(connection), options)
            return from<I, O>(
                connection.pipe(mergeMap(items => items)),
                batcher.add.bind(batcher),
                connection.close,
            )
        }
    }

    export function logging<I, O>(channel: Channel<I, O>, name: string = "Untitled") {
        return () => {
            const connection = channel()
            return from<I, O>(
                connection.pipe(tap(emission => console.log("Received emission on channel " + name + ".", emission))),
                value => {
                    console.log("Sending emission on channel " + name + ".", value)
                    connection.next(value)
                },
                connection.close,
            )
        }
    }

    export function broadcast<I, O>(name: string): Channel<I, O> {
        return port(() => new BroadcastChannel(name), channel => () => channel.close())
    }

    /**
     * A two way port.
     */
    export type Port<I, O> = HasEventTargetAddRemove<MessageEvent<I>> & HasPostMessage<O>

    export function port<T extends Port<I, O>, I = never, O = unknown>(open: ValueOrFactory<T, []>, close?: ((port: T) => void) | undefined) {
        return () => {
            const connection = callOrGet(open)
            return from(
                fromEvent<MessageEvent<I>>(connection, "message").pipe(map(_ => _.data)),
                connection.postMessage.bind(connection),
                () => close?.(connection),
            )
        }
    }

    /**
     * Combine and observable and observer into a channel.
     */
    export function from<I, O>(observable: Observable<I>, next: Next<O>, close?: () => void): Connection<I, O> {
        return new ObservableAndObserver(observable, next, close)
    }

}

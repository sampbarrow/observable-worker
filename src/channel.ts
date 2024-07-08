import { NextObserver, Observable, fromEvent, map, mergeMap, tap } from "rxjs"
import { HasEventTargetAddRemove } from "rxjs/internal/observable/fromEvent"
import { ValueOrFactory, callOrGet } from "value-or-factory"
import { Batcher, BatcherOptions } from "./batcher"

/**
 * A channel creates Connection objects.
 */
export type Channel<I, O> = () => Connection<I, O>

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
            return Connection.from<I, O>({
                observable: connection.pipe(mergeMap(items => items)),
                next: batcher.add.bind(batcher),
                close: connection.close,
            })
        }
    }

    export function logging<I, O>(channel: Channel<I, O>, name: string = "Untitled") {
        return () => {
            const connection = channel()
            return Connection.from<I, O>({
                observable: connection.pipe(tap(emission => console.log("Received emission on channel " + name + ".", emission))),
                next: value => {
                    console.log("Sending emission on channel " + name + ".", value)
                    connection.next(value)
                },
                close: connection.close,
            })
        }
    }

    /**
     * A broadcast channel.
     * @param name The name of the channel.
     * @returns A channel.
     */
    export function broadcast<I, O>(name: string): Channel<I, O> {
        return port(() => new BroadcastChannel(name), channel => channel.close())
    }

    /**
     * A two way port.
     */
    export type Port<I, O> = HasEventTargetAddRemove<MessageEvent<I>> & { postMessage(value: O): void }

    export function port<T extends Port<I, O>, I = never, O = unknown>(open: ValueOrFactory<T, []>, close?: ((port: T) => void) | undefined) {
        return () => {
            const connection = callOrGet(open)
            return Connection.from({
                observable: fromEvent(connection, "message").pipe(map(event => event.data)),
                next: connection.postMessage.bind(connection),
                close: () => close?.(connection),
            })
        }
    }

}

interface From<I, O> {

    readonly observable: Observable<I>
    next(value: O): void
    close(): void

}

export class Connection<I, O> extends Observable<I> {

    constructor(observable: Observable<I>, private readonly observer: (value: O) => void, readonly close: () => void = () => void 0) {
        super(subscriber => {
            return observable.subscribe(subscriber)
        })
    }

    next(value: O) {
        return this.observer(value)
    }

    /**
     * Combine and observable and observer into a channel.
     */
    static from<I, O>(from: From<I, O>): Connection<I, O> {
        return new Connection(from.observable, from.next, from.close)
    }

}

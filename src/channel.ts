import { NextObserver, Observable, fromEvent, map, mergeMap } from "rxjs"
import { HasEventTargetAddRemove } from "rxjs/internal/observable/fromEvent"
import { ValueOrFactory, callOrGet } from "value-or-factory"
import { Batcher, BatcherOptions } from "./batcher"
import { HasPostMessage, ObservableAndObserver, ObservableAndObserverConfig } from "./util"

export interface Channel<I, O> {

    open(): Connection<I, O>

}

export interface Connection<I, O> extends Observable<I>, NextObserver<O> {

    close(): void

}

export interface Closeable<T> {

    object: T
    close?(): void

}

export namespace Channel {

    /**
     * Combine and observable and observer into a channel.
     */
    export function combine<I, O>(input: Channel<I, never>, output: Channel<unknown, O>) {
        return {
            open: () => {
                const openedInput = input.open()
                const openedOutput = output.open()
                return new ObservableAndObserver({
                    observable: openedInput,
                    observer: openedOutput,
                    close: () => {
                        openedInput.close()
                        openedOutput.close()
                    }
                })
            }
        }
    }

    /**
     * Batches sending.
     */
    export function batching<I, O>(channel: Channel<I[], O[]>, options?: BatcherOptions | undefined) {
        return {
            open: () => {
                const opened = channel.open()
                const batcher = new Batcher<O>(values => opened.next(values), options)
                return from({
                    observable: opened.pipe(mergeMap(items => items)),
                    observer: {
                        next: (value: O) => {
                            batcher.add(value)
                        }
                    },
                    close: () => opened.close(),
                })
            }
        }
    }

    /**
     * Creates a channel from a broadcast channel.
     */
    export function broadcast<T>(input: string): Channel<T, T> {
        return port<T, T>(() => {
            const channel = new BroadcastChannel(input)
            return {
                object: channel,
                close: () => channel.close()
            }
        })
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
        return port(() => {
            const worker = new Worker(url, options)
            return {
                object: worker,
                close: () => worker.terminate()
            }
        })
    }

    /**
     * Creates a channel from this window's globalThis.
     */
    export function self() {
        return port({ object: globalThis })
    }

    export const SELF = port<never, unknown>({ object: globalThis })

    /**
     * A two way port.
     */
    export type Port<I, O> = HasEventTargetAddRemove<MessageEvent<I>> & HasPostMessage<O>

    /**
     * Creates a channel from a port.
     */
    export function port<I = never, O = unknown>(open: ValueOrFactory<Closeable<Port<I, O>>, []>): Channel<I, O> {
        return {
            open() {
                const opened = callOrGet(open)
                return from({
                    observable: fromEvent<MessageEvent<I>>(opened.object, "message").pipe(map(_ => _.data)),
                    observer: {
                        next: (value: O) => {
                            opened.object.postMessage(value)
                        }
                    },
                    close: () => {
                        opened.close?.()
                    }
                })
            }
        }
    }

    /**
     * Combine and observable and observer into a channel.
     */
    export function from<I, O>(config: ObservableAndObserverConfig<I, O>): Connection<I, O> {
        return new ObservableAndObserver(config)
    }

}

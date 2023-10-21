import { Observable, Subject, of } from "rxjs"
import { BatcherOptions } from "./batcher"
import { Channel } from "./channel"
import { DirectReceiver } from "./direct"
import { ChannelWrapper } from "./newremote"
import { Answer, Call, Remote, Target, proxy } from "./processing"

export function wrapWorker<T extends Target>(url: string | URL, options?: WorkerOptions | undefined): Wrap<T> {
    return wrap(Channel.worker(url, options))
}
export function wrapWorkerBatching<T extends Target>(url: string | URL, options?: WorkerOptions | undefined, batcherOptions?: BatcherOptions | undefined): Wrap<T> {
    return wrap(Channel.batching(Channel.worker(url, options), batcherOptions))
}

export interface WrapBatchingOptions extends BatcherOptions {

    readonly channel: Channel<Answer[], Call[]>
    readonly log?: boolean | undefined

}

export function wrapBatching<T extends Target>(options: WrapBatchingOptions): Wrap<T> {
    return wrap(Channel.batching(options.channel, { log: options.log, debounceTime: options.debounceTime }), { log: options.log })
}

export interface WrapOptions {

    readonly log?: boolean | undefined

}

export type Wrap<T extends Target> = {

    readonly remote: Remote<T>
    close(): void
    connected(): Observable<void>

}

export function wrap<T extends Target>(channel: Channel<Answer, Call>, options?: WrapOptions): Wrap<T> {
    const sender = new ChannelWrapper({ ...options, channel })
    return {
        remote: proxy<T>(sender),
        connected: () => sender.connected(),
        close: () => sender.close()
    }
}

export function wrapLocal<T extends Target>(target: T): Wrap<T> {
    const a = new Subject<Answer>()
    const b = new Subject<Call>()
    const receiver = new DirectReceiver({ target: of(target), channel: of(Channel.from({ observable: b, observer: a })) })
    receiver.subscribe()
    const sender = new ChannelWrapper({ channel: of(Channel.from({ observable: a, observer: b })) })
    return {
        remote: proxy<T>(sender),
        connected: () => sender.connected(),
        close: () => {
            sender.close()
        }
    }
}

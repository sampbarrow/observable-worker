import { ValueOrFactory } from "value-or-factory"
import { BatcherOptions } from "./batcher"
import { Channel, Closeable } from "./channel"
import { DirectReceiver } from "./direct"
import { ChannelWrapper } from "./newremote"
import { Answer, Call, Remote, Target, proxy } from "./processing"

export type Wrap<T extends Target> = {

    readonly remote: Remote<T>
    close(): void

}

export function wrapWorker<T extends Target>(url: string | URL, options?: WorkerOptions | undefined): Wrap<T> {
    return wrap(Channel.worker(url, options))
}
export function wrapWorkerBatching<T extends Target>(url: string | URL, options?: WorkerOptions | undefined, batcherOptions?: BatcherOptions | undefined): Wrap<T> {
    return wrap(Channel.batching(Channel.worker(url, options), batcherOptions))
}

export interface WrapBatchingOptions extends WrapOptions, BatcherOptions {

    readonly log?: boolean | undefined

}

export function wrapBatching<T extends Target>(channel: Channel<Answer[], Call[]>, options?: WrapBatchingOptions | undefined): Wrap<T> {
    return wrap(Channel.batching(channel, options), options)
}

export interface WrapOptions {

    readonly log?: boolean | undefined

}

export function wrap<T extends Target>(channel: Channel<Answer, Call>, options?: WrapOptions): Wrap<T> {
    const sender = new ChannelWrapper({ channel, ...options })
    return {
        remote: proxy<T>(sender),
        close: () => sender.close()
    }
}

export async function exposeSelf<T extends Target>(target: ValueOrFactory<Closeable<T>>) {
    return expose({
        channel: Channel.SELF,
        target
    })
}
export async function exposeSelfBatching<T extends Target>(target: ValueOrFactory<Closeable<T>>, options?: BatcherOptions | undefined) {
    //return expose(Channel.batching(Channel.SELF, options), target)
    expose({
        channel: Channel.batching(Channel.SELF, options),
        target
    })
}

export interface ExposeConfig<T extends Target> {

    readonly channel: Channel<Call, Answer>
    readonly target: ValueOrFactory<Closeable<T>>

}

export const expose = <T extends Target>(config: ExposeConfig<T>) => {
    /*return channel.pipe(
        receive(target)
    )*/
    const receiver = new DirectReceiver({
        channel: config.channel,
        target: config.target,
    })
    return receiver.subscribe()
}

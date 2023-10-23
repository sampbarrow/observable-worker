import { BatcherOptions } from "./batcher"
import { Channel } from "./channel"
import { ChannelSender } from "./channel-sender"
import { Answer, Call, Target } from "./processing"
import { Sender, SenderOptions, proxy } from "./sender"

//TODO redundant? maybe just merge into the channelwrapper or whatever
export class Remote<T extends Target> {

    readonly remote

    constructor(private readonly sender: Sender) {
        this.remote = proxy<T>(sender)
    }

    connected() {
        return this.sender.connected()
    }
    close() {
        return this.sender.close()
    }
    withOptions(options: SenderOptions) {
        return new Remote(this.sender.withOptions(options))
    }

}

/*
export class MockRemote {

    connected() {
        return of(void 0)
    }
    close() {
    }
    withOptions() {
        return this
    }

}
*/

export function wrapWorker<T extends Target>(url: string | URL, options?: WorkerOptions | undefined) {
    return wrap<T>(Channel.worker(url, options))
}
export function wrapWorkerBatching<T extends Target>(url: string | URL, options?: WorkerOptions | undefined, batcherOptions?: BatcherOptions | undefined) {
    return wrap<T>(Channel.batching(Channel.worker(url, options), batcherOptions))
}

export interface WrapBatchingOptions extends BatcherOptions {

    readonly channel: Channel<Answer[], Call[]>
    readonly log?: boolean | undefined

}

export function wrapBatching<T extends Target>(options: WrapBatchingOptions) {
    return wrap<T>(Channel.batching(options.channel, { log: options.log, debounceTime: options.debounceTime }), { log: options.log })
}

export interface WrapOptions {

    readonly log?: boolean | undefined

}

export function wrap<T extends Target>(channel: Channel<Answer, Call>, options?: WrapOptions): Remote<T> {
    return new Remote<T>(new ChannelSender({ ...options, channel }))
}

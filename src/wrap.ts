import { ObservableNotification, of } from "rxjs"
import { BatcherOptions } from "./batcher"
import { Channel } from "./channel"
import { VolatileChannelSender, VolatileChannelSenderOptions } from "./channel-sender"
import { Answer, Call, Target } from "./processing"
import { MockRemote, Remote, SenderRemote } from "./remote"

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
    return wrap<T>({
        channel: Channel.worker(url, options)
    })
}
export function wrapWorkerBatching<T extends Target>(url: string | URL, options?: WorkerOptions | undefined, batcherOptions?: BatcherOptions | undefined) {
    return wrap<T>({
        channel: Channel.batching(Channel.worker(url, options), batcherOptions)
    })
}

export interface WrapBatchingOptions extends BatcherOptions {

    readonly channel: Channel<ObservableNotification<Answer>[], Call[]>

}

export function wrapBatching<T extends Target>(options: WrapBatchingOptions) {
    return wrap<T>({
        //TODO hacky
        channel: of(Channel.batching(options.channel, { debounceTime: options.debounceTime }))
    })
}

export interface WrapOptions extends VolatileChannelSenderOptions {
}

export function wrap<T extends Target>(options: WrapOptions): Remote<T> {
    return new SenderRemote<T>(new VolatileChannelSender(options))
}

export function wrapMock<T extends Target>(object: T): Remote<T> {
    return new MockRemote(object)
}

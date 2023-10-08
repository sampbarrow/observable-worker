import { BatcherOptions } from "./batcher"
import { Channel } from "./channel"
import { DirectReceiver, DirectSender } from "./direct"
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

export function wrap<T extends Target>(channel: Channel<Answer, Call>): Wrap<T> {
    const sender = new DirectSender({ channel })
    return {
        remote: proxy<T>(sender),
        close: () => sender.close()
    }
}

export async function exposeSelf<T extends Target>(target: T) {
    return expose(Channel.SELF, target)
}
export async function exposeSelfBatching<T extends Target>(target: T, options?: BatcherOptions | undefined) {
    return expose(Channel.batching(Channel.SELF, options), target)
}

export async function expose<T extends Target>(channel: Channel<Call, Answer>, target: T) {
    const receiver = new DirectReceiver({
        channel,
        target
    })
    const subscription = receiver.subscribe()
    return {
        close: () => {
            subscription.unsubscribe()
        }
    }
}

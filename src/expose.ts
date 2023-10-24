import { ObservableInput } from "rxjs"
import { BatcherOptions } from "./batcher"
import { Channel } from "./channel"
import { ChannelReceiver, ChannelReceiverConfig } from "./channel-receiver"
import { Target } from "./processing"

export interface ExposeSelfConfig<T extends Target> {

    readonly target: ObservableInput<T>

}

export function exposeSelf<T extends Target>(config: ExposeSelfConfig<T>) {
    return expose({
        channel: Channel.SELF,
        target: config.target
    })
}

export interface ExposeSelfBatchingConfig<T extends Target> extends ExposeSelfConfig<T> {

    readonly batcher?: BatcherOptions

}

export function exposeSelfBatching<T extends Target>(config: ExposeSelfBatchingConfig<T>) {
    return expose({
        channel: Channel.batching(Channel.SELF, config.batcher),
        target: config.target
    })
}

export interface ExposeConfig<T extends Target> extends ChannelReceiverConfig<T> {
}

export function expose<T extends Target>(config: ExposeConfig<T>) {
    return new ChannelReceiver(config).subscribe()
}

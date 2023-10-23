import { ObservableInput } from "rxjs"
import { BatcherOptions } from "./batcher"
import { Channel } from "./channel"
import { ChannelReceiver } from "./channel-receiver"
import { Answer, Call, Target } from "./processing"

export interface ExposeSelfConfig<T extends Target> {

    readonly target: ObservableInput<T>
    readonly log?: boolean | undefined

}

export function exposeSelf<T extends Target>(config: ExposeSelfConfig<T>) {
    return expose({
        channel: Channel.SELF,
        target: config.target,
        log: config.log,
    })
}

export interface ExposeSelfBatchingConfig<T extends Target> extends BatcherOptions {

    readonly target: ObservableInput<T>

}

export function exposeSelfBatching<T extends Target>(config: ExposeSelfBatchingConfig<T>) {
    return expose({
        channel: Channel.batching(Channel.SELF, config),
        target: config.target,
        log: config.log,
    })
}

export interface ExposeConfig<T extends Target> {

    readonly channel: Channel<Call, Answer>
    readonly target: ObservableInput<T>
    readonly log?: boolean | undefined

}

export const expose = <T extends Target>(config: ExposeConfig<T>) => {
    return new ChannelReceiver({
        channel: config.channel,
        target: config.target,
        log: config.log,
    }).subscribe()
}

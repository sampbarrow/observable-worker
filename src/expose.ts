import { ObservableInput } from "rxjs"
import { BatcherOptions } from "./batcher"
import { Channel } from "./channel"
import { DirectReceiver } from "./direct"
import { Answer, Call, Target } from "./processing"

export interface ExposeSelfConfig<T extends Target> {

    readonly target: ObservableInput<T>

}

export function exposeSelf<T extends Target>(config: ExposeSelfConfig<T>) {
    return expose({
        channel: Channel.SELF,
        target: config.target
    })
}

export interface ExposeSelfBatchingConfig<T extends Target> extends BatcherOptions {

    readonly target: ObservableInput<T>

}

export function exposeSelfBatching<T extends Target>(config: ExposeSelfBatchingConfig<T>) {
    return expose({
        channel: Channel.batching(Channel.SELF, config),
        target: config.target
    })
}

export interface ExposeConfig<T extends Target> {

    readonly channel: Channel<Call, Answer>
    readonly target: ObservableInput<T>

}

export const expose = <T extends Target>(config: ExposeConfig<T>) => {
    const receiver = new DirectReceiver({
        channel: config.channel,
        target: config.target,
    })
    return receiver.subscribe()
}

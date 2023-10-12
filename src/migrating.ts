
import { Subscription } from "rxjs"
import { ValueOrFactory, callOrGet } from "value-or-factory"
import { Closeable } from "./channel"
import { Coordinator } from "./coordinator"
import { DirectReceiver } from "./direct"
import { ChannelWrapper } from "./newremote"
import { Target, proxy } from "./processing"
import { Wrap } from "./wrap"

export const DEFAULT_CONTEXT = "default"

export type RegistrationMessage = {
    readonly type: "registerClient"
    readonly clientId: string
    readonly lockId: string
    readonly callChannelId: string
    readonly answerChannelId: string
} | {
    readonly type: "clientRegistered"
    readonly clientId: string
}

interface ExposeMigratingConfig<T extends Target> {

    readonly coordinator: Coordinator
    readonly target: ValueOrFactory<Closeable<T>>
    readonly log?: boolean

}

export function exposeMigrating<T extends Target>(config: ExposeMigratingConfig<T>) {
    const clients = new Map<string, Subscription>()
    const target = callOrGet(config.target)
    return config.coordinator.backEnd.subscribe(action => {
        if (action.action === "added") {
            const receiver = new DirectReceiver({
                channel: action.channel,
                target: () => {
                    return {
                        object: target.object,
                    }
                },
                log: config.log,
            })
            clients.set(action.id, receiver.subscribe())
        }
        else {
            clients.get(action.id)?.unsubscribe()
            clients.delete(action.id)
        }
    })
}

export interface WrapMigratingConfig {

    readonly coordinator: Coordinator
    readonly log?: boolean
    readonly autoRetryPromises?: boolean | undefined
    readonly autoRetryObservables?: boolean | undefined

}

export function wrapMigrating<T extends Target>(config: WrapMigratingConfig): Wrap<T> {
    const sender = new ChannelWrapper({ log: config.log, autoRetryObservables: config.autoRetryObservables, autoRetryPromises: config.autoRetryPromises, channel: config.coordinator.frontEnd })
    return {
        remote: proxy<T>(sender),
        close: () => sender.close()
    }
}

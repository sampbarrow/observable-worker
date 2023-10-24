
import { Observable, map } from "rxjs"
import { ValueOrFactory, callOrGet } from "value-or-factory"
import { ChannelReceiver } from "./channel-receiver"
import { Coordinator } from "./coordinator"
import { Target } from "./processing"
import { RetryOptions } from "./sender"
import { registry } from "./util"
import { wrap } from "./wrap"

interface ExposeMigratingConfig<T extends Target> {

    readonly coordinator: Coordinator
    readonly target: ValueOrFactory<Observable<T>, [unknown]>

}

export function exposeMigrating<T extends Target>(config: ExposeMigratingConfig<T>) {
    return registry(config.coordinator.backEnd.pipe(
        map(action => {
            if (action.action === "add") {
                return {
                    action: "add",
                    key: action.clientId,
                    observable: new ChannelReceiver({
                        channel: action.channel,
                        target: callOrGet(config.target, action.clientId)
                    })
                }
            }
            else {
                return {
                    action: "delete",
                    key: action.clientId,
                }
            }
        }),
    )).subscribe()
}

export interface WrapMigratingConfig extends RetryOptions {

    readonly coordinator: Coordinator

}

export function wrapMigrating<T extends Target>(config: WrapMigratingConfig) {
    return wrap<T>({
        channel: config.coordinator.frontEnd,
        autoRetryObservables: config.autoRetryObservables,
        autoRetryPromises: config.autoRetryPromises
    })
}

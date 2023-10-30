
import { Observable, map } from "rxjs"
import { ValueOrFactory, callOrGet } from "value-or-factory"
import { ChannelReceiver } from "./channel-receiver"
import { Advertiser, Finder } from "./coordinator"
import { Target } from "./processing"
import { CallOptions } from "./sender"
import { registry } from "./util"
import { wrap } from "./wrap"

interface ExposeMigratingConfig<T extends Target> {

    readonly advertiser: Advertiser
    readonly target: ValueOrFactory<Observable<T>, [unknown]>

}

export function exposeMigrating<T extends Target>(config: ExposeMigratingConfig<T>) {
    return registry(config.advertiser.pipe(
        map(action => {
            if (action.action === "add") {
                return {
                    ...action,
                    observable: new ChannelReceiver({
                        channel: action.observable,
                        target: callOrGet(config.target, action.key)
                    })
                }
            }
            return action
        }),
    )).subscribe()
}

export interface WrapMigratingConfig extends CallOptions {

    readonly finder: Finder

}

export function wrapMigrating<T extends Target>(config: WrapMigratingConfig) {
    return wrap<T>({
        channel: config.finder,
        connectionTimeout: config.connectionTimeout,
        autoRetryPromises: config.autoRetryPromises,
        autoRetryObservables: config.autoRetryObservables,
        promiseTimeout: config.promiseTimeout,
    })
}

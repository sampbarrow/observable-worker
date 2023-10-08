import PLazy from "p-lazy"
import { Observable, ReplaySubject, connectable, first, firstValueFrom, map, merge, skip, switchMap } from "rxjs"
import { Channel } from "./channel"
import { DirectSender } from "./direct"
import { Answer, Call, RemoteError, Sender } from "./processing"
import { ObservableAndPromise, WORKER_LOG } from "./util"

export interface AutoRetryOptions {

    readonly autoRetryPromises?: boolean
    readonly autoRetryObservables?: boolean

}

export interface LazySenderConfig extends AutoRetryOptions {

    readonly channel: Observable<Channel<Answer, Call>>

}

export class LazySender implements Sender {

    private readonly sender
    private readonly connection

    constructor(private readonly config: LazySenderConfig) {
        this.sender = connectable(config.channel.pipe(map(channel => new DirectSender({ channel }))), { connector: () => new ReplaySubject(1) })
        this.connection = this.sender.connect()
    }

    close() {
        this.connection.unsubscribe()
    }
    execute(retryOnInterrupt: boolean) {
        return merge(
            this.sender.pipe(first()),
            this.sender.pipe(
                skip(1),
                map(sender => {
                    if (retryOnInterrupt) {
                        return sender
                    }
                    else {
                        throw new RemoteError(true, "The remote died before a response was received.")
                    }
                })
            )
        )
    }
    call(command: string, ...data: readonly unknown[]) {
        if (WORKER_LOG) {
            console.log("[Worker/Migrating] Received command.", { command, data })
        }
        const promise = PLazy.from(() => firstValueFrom(this.execute(this.config.autoRetryPromises ?? false)).then(sender => sender.call(command, ...data)))
        const observable = this.execute(this.config.autoRetryObservables ?? true).pipe(switchMap(sender => sender.call(command, ...data)))
        return new ObservableAndPromise(observable, promise)
    }

}

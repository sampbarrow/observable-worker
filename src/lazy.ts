import PLazy from "p-lazy"
import { Observable, ReplaySubject, connectable, first, firstValueFrom, map, merge, skip, switchMap } from "rxjs"
import { Channel } from "./channel"
import { DirectSender } from "./direct"
import { Answer, Call, RemoteError, Sender } from "./processing"
import { ObservableAndPromise } from "./util"

export interface AutoRetryOptions {

    readonly autoRetryPromises?: boolean
    readonly autoRetryObservables?: boolean

}

export interface LazySenderConfig extends AutoRetryOptions {

    readonly channel: Observable<Channel<Answer, Call>>
    readonly log?: boolean | undefined

}

export class LazySender implements Sender {

    private readonly sender
    private readonly connection

    constructor(private readonly config: LazySenderConfig) {
        this.sender = connectable(config.channel.pipe(map(channel => new DirectSender({ channel, log: config.log }))), { connector: () => new ReplaySubject(1) })
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
    //TODO the observableandpromise approach blows up in browser afgter vite compile
    call(command: string, ...data: readonly unknown[]) {
        if (this.config.log) {
            console.log("[Worker/Migrating] Received command.", { command, data })
        }
        const promise = PLazy.from(async () => {
            const sender = await firstValueFrom(this.execute(this.config.autoRetryPromises ?? false))
            return await sender.call(command, ...data)
        })
        const observable = this.execute(this.config.autoRetryObservables ?? true).pipe(
            switchMap(sender => {
                return sender.call(command, ...data).asObservable()
            })
        )
        return new ObservableAndPromise(observable, promise)
    }

}

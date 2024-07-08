import { Observable, map } from "rxjs"
import { Proxied, Sender, Target } from "./processing"
import { VolatileSender } from "./sender"
import { proxy } from "./util"

export interface Remote<T extends Target> {

    /**
     * The proxied object.
     */
    readonly proxy: Proxied<T>

    /**
     * Close this channel.
     */
    close(): void

}

export interface VolatileRemote<T extends Target> {

    /**
     * The proxied object.
     */
    readonly proxy: Proxied<T>

    /**
     * Watch for a new proxied object.
     * @deprecated
     * @param autoReconnect 
     */
    watch(autoReconnect?: boolean | undefined): Observable<Proxied<T>>

    /**
     * Close this channel.
     */
    close(): void

}

export class VolatileSenderRemote<T extends Target> implements VolatileRemote<T> {

    readonly proxy

    constructor(private readonly sender: VolatileSender) {
        this.proxy = proxy<T>(this.sender)
    }

    watch(autoReconnect?: boolean | undefined) {
        return this.sender.watch(autoReconnect).pipe(map(sender => proxy<T>(sender)))
    }
    close() {
        return this.sender.close()
    }

}

export class SenderRemote<T extends Target> implements Remote<T> {

    readonly proxy

    constructor(private readonly sender: Sender) {
        this.proxy = proxy<T>(this.sender)
    }

    close() {
        return this.sender.close()
    }

}

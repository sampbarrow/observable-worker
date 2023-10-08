import { throttle } from "throttle-debounce"

const DEFAULT_DEBOUNCE_TIME = 1

export interface BatcherOptions {

    readonly log?: boolean
    readonly debounceTime?: number
    readonly debounceMode?: boolean
    readonly noLeading?: boolean
    readonly noTrailing?: boolean

}

export class Batcher<T> {

    private readonly process
    private readonly batch = new Array<T>()

    constructor(flush: (items: T[]) => void, options?: BatcherOptions) {
        const process = () => {
            const items = this.batch.splice(0)
            if (options?.log === true) {
                console.log("[Worker] Sending a batch of " + items.length + " items.", items)
            }
            flush(items)
        }
        const debounceTime = options?.debounceTime ?? DEFAULT_DEBOUNCE_TIME
        if (debounceTime > 0) {
            this.process = throttle(debounceTime, process, options)
        }
        else {
            this.process = process
        }
    }

    add(item: T) {
        this.batch.push(item)
        this.process()
    }

}

import { debounce } from "throttle-debounce";

const DEFAULT_DEBOUNCE_TIME = 1

export interface BatcherOptions {

    readonly debounceTime?: number | undefined
    readonly maxItems?: number | undefined

}

export class Batcher<T> {

    private readonly process
    private readonly items = new Array<T>()

    constructor(private readonly flush: (items: T[]) => void, private readonly options?: BatcherOptions) {
        const debounceTime = options?.debounceTime ?? DEFAULT_DEBOUNCE_TIME
        if (debounceTime > 0) {
            this.process = debounce(debounceTime, this.forceProcess.bind(this))
        }
        else {
            this.process = this.forceProcess.bind(this)
        }
    }

    private forceProcess() {
        this.flush(this.items.splice(0))
    }

    add(item: T) {
        this.items.push(item)
        if (this.options?.maxItems !== undefined && this.items.length >= this.options?.maxItems) {
            this.forceProcess()
        }
        else {
            this.process()
        }
    }

}

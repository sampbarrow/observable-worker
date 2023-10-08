# Observable Worker

## Installation

## Usage

```
import { wrapWorker } from "observable-worker"

const worker = wrapWorker<WorkerService>(new URL("/src/app/DedicatedWorker.ts", import.meta.url), { type: 'module' })
worker.observeValue().subscribe(value => {
    console.log("Got a value: " + value + ".)
})
```

```
import { exposeSelf } from "observable-worker"
import { interval, map } from "rxjs"

const target = {
    observeValue() {
        return interval(500).pipe(map(() => Math.random()))
    }
}

export type WorkerService = typeof target

exposeSelf({ target })
```

## License

[MIT](https://choosealicense.com/licenses/mit/)
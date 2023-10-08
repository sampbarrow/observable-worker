# Observable Worker

## Installation

## Usage

In the main file:

```
import { wrapWorker } from "observable-worker"
import { Observable } from "rxjs"

type WorkerService = {

    observeValue(): Observable<number>

}

const worker = wrapWorker<WorkerService>(new URL("/src/app/DedicatedWorker.ts", import.meta.url), { type: 'module' })
worker.observeValue().subscribe(value => {
    console.log("Got a value: " + value + ".)
})
```

In the worker file:

```
import { exposeSelf } from "observable-worker"
import { interval, map } from "rxjs"

exposeSelf({
    target: {
        observeValue() {
            return interval(500).pipe(map(() => Math.random()))
        }
    }
})
```

## License

[MIT](https://choosealicense.com/licenses/mit/)
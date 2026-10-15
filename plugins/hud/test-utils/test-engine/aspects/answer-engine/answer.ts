// One answer to an engine call: a response with a result, or a refusal.
export abstract class Answer<T> {
    // Settles with what the engine responds with, once it may.
    abstract respond(): Promise<Response<T> | Deny>;
}

export class Response<T> extends Answer<T> {
    constructor(readonly value: T) {
        super();
    }

    async respond(): Promise<Response<T>> {
        return this;
    }
}

// A response held back until `release`. `reached` resolves once the engine is
// ready to send it, so a test can tell that the call has been made.
export class DelayedResponse<T> extends Response<T> {
    readonly reached: Promise<void>;
    private readonly released: Promise<void>;
    private markAsReached!: () => void;
    private resolveReleased!: () => void;

    constructor(value: T) {
        super(value);
        this.reached = new Promise<void>((resolve) => {
            this.markAsReached = resolve;
        });
        this.released = new Promise<void>((resolve) => {
            this.resolveReleased = resolve;
        });
    }

    release(): void {
        this.resolveReleased();
    }

    override async respond(): Promise<Response<T>> {
        this.markAsReached();
        await this.released;
        return this;
    }
}

export class Deny extends Answer<never> {
    constructor(readonly reason: string) {
        super();
    }

    async respond(): Promise<Deny> {
        return this;
    }
}

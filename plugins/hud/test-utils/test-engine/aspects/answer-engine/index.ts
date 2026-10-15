import type { Answer, Deny, Response } from "./answer";

// The answers lined up for one engine call, first in, first out.
class AnswerQueue<T> {
    private readonly answers: Answer<T>[] = [];

    push(...answers: Answer<T>[]): void {
        this.answers.push(...answers);
    }

    shift(): Answer<T> | undefined {
        return this.answers.shift();
    }
}

// How the engine answers one call: the answers a test lined up for the calls
// to come, and a record of every request it was asked. Once those run out, the
// default answer is given, with the request so that it can tell calls apart.
export class AnswerEngine<Req, Res> {
    // Mutated in place, so a test can hold on to it and read it again later.
    readonly calls: Req[] = [];
    private readonly upcoming = new AnswerQueue<Res>();

    constructor(
        private readonly defaultAnswer: (request: Req) => Response<Res>,
    ) {}

    // Answers the call after the ones already lined up, one answer for each.
    onNextCall(answer: Answer<Res>): void {
        this.upcoming.push(answer);
    }

    // The request is recorded before the answer is awaited, so a call held
    // back by a `DelayedResponse` already counts.
    answer(request: Req): Promise<Response<Res> | Deny> {
        this.calls.push(request);
        return (this.upcoming.shift() ?? this.defaultAnswer(request)).respond();
    }
}

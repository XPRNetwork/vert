import { expect } from "chai"

/**
 * Expect a promise to throw an error with a specific message.
 * @param promise - The promise to await.
 * @param {string} errorMsg - The error message that we expect to see.
 */
export const expectToThrow = async (promise: Promise<any>, errorMsg?: string) => {
    try {
        await promise
        throw new Error(`Was expecting to fail with ${errorMsg}`)
    } catch (e: any) {
        if ( errorMsg ) expect(e.message).to.include(errorMsg)
        else expect(!!e.message).to.be.true;
    }
}

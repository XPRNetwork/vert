import { Checksum256, Checksum256Type, Signature } from '@greymass/eosio'
import { ec } from 'elliptic'

const curves: {[type: string]: ec} = {}

/**
 * Get curve for key type.
 * @internal
 */
export function getCurve(type: string): ec {
    let rv = curves[type]
    if (!rv) {
        if (type === 'K1') {
            rv = curves[type] = new ec('secp256k1')
        } else if (type === 'R1') {
            rv = curves[type] = new ec('p256')
        } else {
            throw new Error(`Unknown curve type: ${type}`)
        }
    }
    return rv
}


/**
 * Recover public key from signature and recovery id.
 * @internal
 */
 export function recoverUncompressed(signature: Uint8Array, message: Uint8Array, type: string) {
    const curve = getCurve(type)
    const recid = signature[0] - 31
    const r = signature.subarray(1, 33)
    const s = signature.subarray(33)
    const point = curve.recoverPubKey(message, {r, s}, recid)
    return new Uint8Array(point.encode())
}

export function recoverUncompressedDigest(signature: Signature, digest: Checksum256Type) {
    digest = Checksum256.from(digest)
    const uncompressed = recoverUncompressed(signature.data.array, digest.array, signature.type)
    return uncompressed
}
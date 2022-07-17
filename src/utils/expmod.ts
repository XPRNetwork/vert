export function expmod(a: bigint, power: bigint, modulo: bigint) {
    console.log(a, power, modulo);
    if (power === BigInt(0)) {
        return BigInt(1) % modulo
    }
    let res = BigInt(1)
    while (power > BigInt(0)) {
        if (power & BigInt(1)) res = (res * a) % modulo
        a = (a * a) % modulo
        power >>= BigInt(1)
    }
    return res
}

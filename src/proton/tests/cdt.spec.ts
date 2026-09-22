import fs from "fs";
import { expect } from "chai";
import { Blockchain } from "../blockchain";
import { VM } from "../vm";
import Buffer from "../../buffer";

/**
 * AntelopeIO CDT exports the wasm memory VeRT reads only since v4.1.0; earlier
 * releases and the original eosio.cdt leave it unexported. A current toolchain
 * is covered by the CDT workflow, which builds examples/cdt and runs it, so
 * what is left to pin down here is the older output, reproduced by stripping
 * the memory export from the committed blanc binary.
 */

const EXPORT_SECTION = 7
const MEMORY_EXPORT = 2

const wasm = fs.readFileSync('contracts/eosio.token/eosio.token.wasm')

function readVarUInt(bytes: Uint8Array, offset: number): [value: number, next: number] {
  let value = 0
  let shift = 0
  let cursor = offset
  let byte: number

  do {
    byte = bytes[cursor++]
    value |= (byte & 0x7f) << shift
    shift += 7
  } while (byte & 0x80)

  return [value >>> 0, cursor]
}

function writeVarUInt(value: number): Uint8Array {
  const bytes: number[] = []

  do {
    const byte = value & 0x7f
    value >>>= 7
    bytes.push(value ? byte | 0x80 : byte)
  } while (value)

  return new Uint8Array(bytes)
}

function eachSection(wasm: Uint8Array, visit: (id: number, body: Uint8Array) => void) {
  let cursor = 8

  while (cursor < wasm.length) {
    const id = wasm[cursor++]
    const [size, bodyStart] = readVarUInt(wasm, cursor)
    visit(id, wasm.subarray(bodyStart, bodyStart + size))
    cursor = bodyStart + size
  }
}

/**
 * Rebuilds a wasm binary with its export section reduced to the entries
 * accepted by `keep`, which lets a single binary stand in for the output of
 * different contract toolchains.
 */
function keepExports(wasm: Uint8Array, keep: (name: string, kind: number) => boolean): Uint8Array {
  const chunks: Uint8Array[] = [wasm.subarray(0, 8)]

  eachSection(wasm, (id, body) => {
    if (id !== EXPORT_SECTION) {
      chunks.push(new Uint8Array([id]), writeVarUInt(body.length), body)
      return
    }

    const kept: Uint8Array[] = []
    let [count, cursor] = readVarUInt(body, 0)

    while (count--) {
      const entryStart = cursor
      const [length, nameStart] = readVarUInt(body, cursor)
      const name = Buffer.from_(body.slice(nameStart, nameStart + length)).toString()
      const kind = body[nameStart + length];
      [, cursor] = readVarUInt(body, nameStart + length + 1)

      if (keep(name, kind)) {
        kept.push(body.subarray(entryStart, cursor))
      }
    }

    const section = Buffer.concat([writeVarUInt(kept.length), ...kept])
    chunks.push(new Uint8Array([id]), writeVarUInt(section.length), section)
  })

  return Buffer.concat(chunks)
}

const legacyCdtWasm = keepExports(wasm, (_, kind) => kind !== MEMORY_EXPORT)

describe('antelope cdt', () => {
  it('reports a rebuild is needed when memory is not exported', async () => {
    const vm = VM.from(legacyCdtWasm, new Blockchain())

    let message = ''
    try {
      await vm.ready
    } catch (e) {
      message = (e as Error).message
    }

    expect(message).to.contain('does not export its memory')
    expect(message).to.contain('AntelopeIO CDT v4.1.0 or higher')
  })
})

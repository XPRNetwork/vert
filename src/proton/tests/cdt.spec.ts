import fs from "fs";
import { expect } from "chai";
import { Asset, Name } from "@greymass/eosio";
import { Blockchain } from "../blockchain";
import { VM } from "../vm";
import { symbolCodeToBigInt } from "../bn";
import Buffer from "../../buffer";

/**
 * AntelopeIO CDT links contracts with `--only-export apply:function` plus
 * `--only-export *:memory` (since v4.1.0), so its binaries export exactly
 * `apply` and `memory`, while blanc also exports `__heap_base` and
 * `__data_end`. The tests below pin down what VeRT relies on, using the
 * committed blanc binary reshaped into both layouts so that no C++ toolchain
 * is needed to run them.
 */

const EXPORT_SECTION = 7
const MEMORY_EXPORT = 2

const wasm = fs.readFileSync('contracts/eosio.token/eosio.token.wasm')
const abi = fs.readFileSync('contracts/eosio.token/eosio.token.abi', 'utf8')

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

function readExports(wasm: Uint8Array): { name: string, kind: number }[] {
  const exports: { name: string, kind: number }[] = []

  eachSection(wasm, (id, body) => {
    if (id !== EXPORT_SECTION) {
      return
    }

    let [count, cursor] = readVarUInt(body, 0)
    while (count--) {
      const [length, nameStart] = readVarUInt(body, cursor)
      const name = Buffer.from_(body.slice(nameStart, nameStart + length)).toString()
      const kind = body[nameStart + length];
      [, cursor] = readVarUInt(body, nameStart + length + 1)
      exports.push({ name, kind })
    }
  })

  return exports
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

const cdtWasm = keepExports(wasm, (name, kind) => name === 'apply' || kind === MEMORY_EXPORT)
const legacyCdtWasm = keepExports(wasm, (_, kind) => kind !== MEMORY_EXPORT)

describe('antelope cdt', () => {
  it('exposes the export layout each toolchain produces', () => {
    expect(readExports(wasm).map(({ name }) => name))
      .to.have.members(['memory', '__heap_base', '__data_end', 'apply'])

    expect(readExports(cdtWasm).map(({ name }) => name))
      .to.have.members(['memory', 'apply'])
  })

  it('runs a contract exporting only apply and memory', async () => {
    const blockchain = new Blockchain()
    const token = blockchain.createAccount({
      name: Name.from('eosio.token'),
      wasm: cdtWasm,
      abi,
    })
    blockchain.createAccount('alice')

    await token.actions.create(['alice', '1000.000 TKN']).send()
    await token.actions.issue(['alice', '25.000 TKN', 'issue']).send('alice@active')

    const symcode = symbolCodeToBigInt(Asset.SymbolCode.from('TKN'))
    expect(token.tables.stat(symcode).getTableRow(symcode)).to.be.deep.equal({
      supply: '25.000 TKN',
      max_supply: '1000.000 TKN',
      issuer: 'alice',
    })
  })

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

  it('implements every host function a contract imports', async () => {
    const module = await WebAssembly.compile(cdtWasm as unknown as BufferSource)
    const vm = VM.from(cdtWasm, new Blockchain())
    await vm.ready

    const missing = WebAssembly.Module
      .imports(module)
      .filter(({ module, kind }) => module === 'env' && kind === 'function')
      .map(({ name }) => name)
      .filter((name) => !(name in vm.imports.env))

    expect(missing).to.be.deep.equal([])
  })
})

# VeRT

**VM emulation RunTime for WASM-based blockchain contracts**

VeRT is a blockchain virtual machine emulator for WASM-based contracts like EOSIO. (CosmWasm and Substrate will be supported.)
It uses the built-in WebAssembly object in JavaScript, so can be executed on any modern browsers or runtime environments without additional dependencies.
It doesn't support the full specification of each blockchain state-machine, but can be used to run and test smart contracts before deployment.
The focus of VeRT is on the better compatibility than the performance, so it can be integrated with development pipelines.

- Run and test smart contracts
- Minimum dependencies (No native wrapper, docker or remote connection)
- Volatile key-value store with state rollback 

## Requirement

- WebAssembly binary with the exported memory, built with either [AntelopeIO CDT](https://github.com/AntelopeIO/cdt) v4.1.0 or higher, or [blanc](https://github.com/haderech/blanc) v0.9.2 or higher
- JavaScript runtime with WebAssembly BigInt support (nodejs v16 or higher)

## Contract toolchains

VeRT runs an action by calling the `apply` export of the contract binary, and reads contract state
by looking straight into the module's linear memory. Both of those have to be exported from the
WebAssembly binary, and that requirement is what ties VeRT to a particular toolchain version:
neither AntelopeIO CDT before v4.1.0 nor the original `eosio.cdt` exports the memory, so a binary
built with them is rejected with a message asking for a rebuild.

Apart from the memory export, the two supported toolchains are interchangeable as far as VeRT is
concerned. Both compile the same C++ contract sources against the same host API, and both emit the
`.abi` next to the `.wasm`.

|                                | AntelopeIO CDT                 | blanc                                                |
| ------------------------------ | ------------------------------ | ---------------------------------------------------- |
| Compiler                       | `cdt-cpp`                      | `blanc++`                                            |
| Minimum version VeRT can load  | v4.1.0                         | v0.9.2                                               |
| Exports in the built binary    | `apply`, `memory`              | `apply`, `memory`, `__heap_base`, `__data_end`       |
| Example suite                  | [examples/cdt](./examples/cdt) | [examples/foo](./examples/foo), and the other folders |

The extra exports blanc emits are unused by VeRT, which is why AntelopeIO CDT became usable the
moment it started exporting the memory: v4.1.0 links contracts with `--only-export *:memory` in
addition to the `--only-export apply:function` it already used.

Two differences are worth keeping in mind when writing tests against an AntelopeIO CDT build:

- CDT defaults to ABI version `eosio::abi/1.2`, so actions that return a value are declared as
  `action_results` in the ABI. VeRT captures the serialized value per action in
  `blockchain.actionTraces[n].returnValue`, but does not resolve the result type from the ABI, so
  decode it with an explicit type.
- VeRT implements the Antelope host API, excluding the BLS intrinsics added in CDT v4.x. A contract
  that calls them fails to instantiate with a `LinkError` naming the missing `env` import.

## Installation

```shell
npm install @proton/vert
```

## Development


```shell
pnpm install
```

## Test

```shell
pnpm run test
```

This runs the library tests, which include the toolchain compatibility checks in
[src/proton/tests/cdt.spec.ts](./src/proton/tests/cdt.spec.ts), followed by the example suites.

Example binaries are not checked in, so build them first. Each suite is built by the toolchain it
demonstrates, which means `pnpm --filter examples run build` needs both compilers on the `PATH`;
build a single suite instead if you only have one of them installed:

```shell
# examples/cdt, built with cdt-cpp; its suite is skipped while the binary is missing.
# When invoking cdt-cpp by hand, pass the source path without a leading ./ — with one,
# cdt-cpp loses track of the dispatcher it generates and the link aborts.
pnpm --filter examples run build:cdt

# examples/foo, built with blanc++
pnpm --filter examples run build:foo
```

CDT is distributed as a Linux x86_64 package only, so the
[CDT workflow](./.github/workflows/cdt.yml) builds `examples/cdt` on a runner and uploads the
resulting `cdt.wasm` and `cdt.abi`. Dropping those two files into `examples/cdt` is enough to run
the suite on a machine without the toolchain.

## License

[MIT](./LICENSE)

[@greymass-eosio](./src/eos/@greymass-eosio/LICENSE)

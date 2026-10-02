import {Memory} from "./memory";
import logger from "loglevel";
import prefix from "loglevel-plugin-prefix";

const log = logger;
prefix.reg(log);
prefix.apply(log);

try {
  log.setLevel(process.env.LOG_LEVEL as logger.LogLevelDesc || 'warn');
} catch (e) {
  console.warn(e)
}

export class Vert {
  protected module!: WebAssembly.Module;
  protected instance!: WebAssembly.Instance;
  protected _memory!: Memory;
  protected imports: any;

  public ready: Promise<void>;

  get memory() {
    return this._memory;
  }

  constructor(imports: any, bytes: Uint8Array | Promise<Uint8Array>) {
    const getReady = async () => {
      bytes = await Promise.resolve(bytes)
      const { module, instance } = await WebAssembly.instantiate(bytes as BufferSource, imports)
      this.module = module;
      this.instance = instance;
      const memory = this.instance.exports.memory
      if (!(memory instanceof WebAssembly.Memory)) {
        throw new Error(
          'contract wasm does not export its memory, so its state cannot be read. ' +
          'Rebuild it with AntelopeIO CDT v4.1.0 or higher, or blanc v0.9.2 or higher.'
        )
      }
      this._memory = new Memory(memory);
    }
    this.ready = getReady();
  }
}

// function setLogger(logger: any) {
//   log = logger;
// }

export {
  log,
}

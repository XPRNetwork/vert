import fs from "fs";
import path from "path";
import { expect } from "chai";
import { Int64, Name, Serializer } from "@greymass/eosio"
import { Account, Blockchain, expectToThrow, nameToBigInt, protonAssert, protonAssertMessage } from "@proton/vert";

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const wasmPath = path.join(__dirname, 'cdt.wasm')
const abiPath = path.join(__dirname, 'cdt.abi')
const isBuilt = fs.existsSync(wasmPath) && fs.existsSync(abiPath)

const contractName = Name.from('cdt')
const scope = nameToBigInt(contractName)
const alice = nameToBigInt(Name.from('alice'))

describe('cdt_test', function () {
  let blockchain: Blockchain
  let cdt: Account

  before(function () {
    if (!isBuilt) {
      console.warn(`\n  cdt.wasm/cdt.abi are missing.` +
        `\n  Run 'pnpm run build:cdt' with AntelopeIO CDT v4.1.0 or higher to run these tests.\n`)
      this.skip()
    }

    blockchain = new Blockchain()
    cdt = blockchain.createAccount({
      name: contractName,
      wasm: fs.readFileSync(wasmPath),
      abi: fs.readFileSync(abiPath, 'utf8')
    })
    blockchain.createAccounts('alice', 'bob')
  })

  beforeEach(() => {
    blockchain.resetTables()
  });

  it('store value', async () => {
    await cdt.actions.store(['alice', 7]).send('alice@active');

    expect(cdt.tables.data(scope).getTableRow(alice)).to.be.deep.equal({
      owner: 'alice',
      value: 7
    })
  });

  it('update stored value', async () => {
    await cdt.actions.store(['alice', 7]).send('alice@active');
    await cdt.actions.store(['alice', 8]).send('alice@active');

    expect(cdt.tables.data(scope).getTableRows()).to.be.deep.equal([{
      owner: 'alice',
      value: 8
    }])
  });

  it('charge the ram payer given to emplace', async () => {
    await cdt.actions.store(['alice', 7]).send('alice@active');

    const storage = blockchain.getStorage() as Record<string, any>
    const [row] = storage.cdt.data.cdt

    expect(row.primaryKey).to.be.equal(alice)
    expect(row.payer).to.be.equal('alice')
  });

  it('require authorization', async () => {
    await expectToThrow(
      cdt.actions.store(['alice', 7]).send('bob@active'),
      'missing required authority alice'
    )
  });

  it('reject a value asserted with a const char* message', async () => {
    await expectToThrow(
      cdt.actions.store(['alice', -1]).send('alice@active'),
      protonAssert('require non-negative value')
    )
  });

  it('reject a value asserted with a std::string message', async () => {
    await expectToThrow(
      cdt.actions.store(['alice', 101]).send('alice@active'),
      protonAssertMessage('value is out of range')
    )
  });

  it('read an action return value', async () => {
    await cdt.actions.sum([2, 3]).send();

    expect(blockchain.console).to.be.equal('5')

    const [trace] = blockchain.actionTraces
    expect(Serializer.decode({ data: trace.returnValue, type: Int64 }).toNumber()).to.be.equal(5)
  });
});

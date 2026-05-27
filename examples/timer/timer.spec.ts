import fs from "fs";
import path from "path";
import { expect } from "chai";
import { Name, TimePoint } from "@greymass/eosio"
import { Blockchain } from "../../dist";

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const blockchain = new Blockchain()

const timeName = Name.from('time')
const time = blockchain.createAccount({
  name: timeName,
  wasm: fs.readFileSync(path.join(__dirname, 'timer.wasm')),
  abi: fs.readFileSync(path.join(__dirname, 'timer.abi'), 'utf8')
})

beforeEach(() => {
  blockchain.resetTables()
});

describe('time_test', () => {
  it('check time', async () => {
    await time.actions.exec([timeName]).send();
    expect(time.bc.console).to.be.eq("0")

    blockchain.setTime(TimePoint.fromMilliseconds(500))

    await time.actions.exec([timeName]).send();
    expect(time.bc.console).to.be.eq("500000")
    
    blockchain.setTime(TimePoint.fromMilliseconds(1000))
    
    await time.actions.exec([timeName]).send();
    expect(time.bc.console).to.be.eq("1000000")
  });
});

import { TableStore } from "./table";
import { Name, Transaction, TimePoint, TimePointSec, NameType } from "@greymass/eosio";
import { Account, AccountArgs } from "./account";
import { VM } from "./vm";
import log from "loglevel";
import * as fs from "fs";
import fetch from "cross-fetch"

export class Blockchain {
  accounts: { [key: string]: Account }
  timestamp: TimePoint
  store: TableStore
  console: string = ''
  actionsQueue: VM.Context[] = []

  constructor ({
    accounts,
    timestamp,
    store
  }: {
    accounts?: { [key: string]: Account },
    timestamp?: TimePoint,
    store?: TableStore
  } = {}) {
    this.accounts = accounts || {}
    this.timestamp = timestamp || TimePoint.fromMilliseconds(0)
    this.store = store || new TableStore()
  }

  public async applyTransaction (transaction: Transaction, decodedData?: any) {
    await this.resetTransaction()

    this.actionsQueue = transaction.actions.map(action => {
      const contract = this.getAccount(action.account)
      if (!contract || !contract.isContract) {
        throw new Error(`Contract ${action.account} missing for inline action`)
      }

      return new VM.Context({
        receiver: contract,
        firstReceiver: contract,
        action: action.name,
        data: action.data.array,
        authorization: action.authorization,
        transaction,
        decodedData
      })
    })

    while(this.actionsQueue.length) {
      const action = this.actionsQueue.shift()

      log.debug(`
        \nSTART ACTION
    Inline: ${action.isInline}
    Notification: ${action.isNotification}
    Contract: ${action.receiver.name}
    Action: ${action.action}
    First Receiver: ${action.firstReceiver.name}
    Sender: ${action.sender}
    Authorization: ${JSON.stringify(action.authorization)}
    Data: ${JSON.stringify(action.decodedData)}
      `)

      action.receiver.vm.apply(action)
    }
  }

  public getAccount(name: Name): Account | undefined {
    return this.accounts[name.toString()]
  }

  public createAccount(args: string | Omit<AccountArgs, "bc">): Account {
    if (typeof args === "string") {
      args = { name: args }
    }

    args.name = Name.from(args.name)

    const account = new Account({
      ...args,
      bc: this
    })
    
    this.accounts[account.name.toString()] = account
    
    return account
  }

  /**
   * Create a list of accounts
   * @param {Blockchain} bc - Blockchain - The blockchain that the accounts will be created on.
   * @param {string[]} accounts - An array of account names.
   * @returns An array of accounts.
   */
  createAccounts (...accounts: string[]) {
    const createdAccounts = []
    for (const account of accounts) {
        createdAccounts.push(this.createAccount(account))
    }
    return createdAccounts
  }

  /**
   * It reads a file from the file system or from the network and returns it as a Uint8Array
   * @param {string} fileName - The name of the file to read.
   * @returns A promise of a Uint8Array.
   */
  async readWasm (fileName: string): Promise<Uint8Array> {
    if (!!fs.readFileSync) {
        return fs.readFileSync(fileName)
    } else {
        const res = await fetch(fileName)
        return Buffer.from(await res.arrayBuffer())
    }
  }

  /**
  * It reads the contents of a file and returns it as a string.
  * @param {string} fileName - The path to the ABI file.
  * @returns The ABI of the contract.
  */
  async readAbi (fileName: string): Promise<string> {
    if (!!fs.readFileSync) {
        return fs.readFileSync(fileName, 'utf8')
    } else {
        const res = await fetch(fileName)
        return res.text()
    }
  }

  /**
  * Create a new account with the given name, wasm, and abi
  * @param {Blockchain} bc - Blockchain - the blockchain to create the contract on
  * @param {NameType} name - Name of the contract.
  * @param {string} folder - The folder name of the contract.
  * @param [sendsInline=false] - If true, the contract will send inline. If false, it will send to a new
  * account.
  * @returns The contract account.
  */
  createContract (name: NameType, folder: string, sendsInline = false) {
    return this.createAccount({
        name: Name.from(name),
        wasm: this.readWasm(`${folder}.wasm`),
        abi: this.readAbi(`${folder}.abi`),
        sendsInline
    });
  }

  /**
   * Time
   */
  public setTime (time: TimePoint | TimePointSec) {
    this.timestamp = TimePoint.fromMilliseconds(time.toMilliseconds())
  }
  public addTime (time: TimePoint | TimePointSec) {
    this.timestamp = TimePoint.fromMilliseconds(this.timestamp.toMilliseconds() + time.toMilliseconds())
  }
  public subtractTime (time: TimePoint | TimePointSec) {
    if (this.timestamp.toMilliseconds() < time.toMilliseconds()) {
      throw new Error(`Blockchain time must not go negative`)
    }
    this.timestamp = TimePoint.fromMilliseconds(this.timestamp.toMilliseconds() - time.toMilliseconds())
  }

  /**
   * Reset
   */
  async resetTransaction () {
    await this.resetVm()
    this.clearConsole()
  }

  async resetVm () {
    await Promise.all(Object.values(this.accounts).map(account => account.recreateVm()))
  }

  public clearConsole () {
    this.console = ''
  }

  public resetTables (store?: TableStore) {
    this.store = store || new TableStore()
  }
}
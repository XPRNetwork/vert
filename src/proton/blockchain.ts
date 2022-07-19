import { Name, Transaction, TimePoint, TimePointSec, NameType, Checksum256 } from "@greymass/eosio";
import * as fs from "fs";
import fetch from "cross-fetch"
import { diff, flattenChangeset, Operation } from '../utils/diff'
import { set } from 'lodash'
import { Table, TableStore } from "./table";
import { Account, AccountArgs } from "./account";
import { SecondaryKeyConverter, VM } from "./vm";
import { ExecutionTrace } from "./types";
import { contextToExecutionTrace, logExecutionTrace } from "./utils";
import { bigIntToName } from "./bn";
import { findStartAndEnd } from '../utils/color'
import colors from 'colors'
import { ACTIVATED_PROTOCOL_FEATURES } from "../utils/activatedFeatures";
import Buffer from '../buffer'

export class Blockchain {
  accounts: { [key: string]: Account }
  timestamp: TimePoint
  blockNum: number
  store: TableStore
  console: string = ''
  actionTraces: VM.Context[] = []
  executionTraces: ExecutionTrace[] = []
  protocolFeatures: string[] = ACTIVATED_PROTOCOL_FEATURES

  // Storage
  isStorageDeltasEnabled: boolean = false
  preStorage: any
  postStorage: any
  storageDeltaChangesets: any
  _storageDeltas: any
  
  constructor ({
    accounts,
    timestamp,
    blockNum,
    store,
  }: {
    accounts?: { [key: string]: Account },
    timestamp?: TimePoint,
    blockNum?: number,
    store?: TableStore
  } = {}) {
    this.accounts = accounts || {}
    this.timestamp = timestamp || TimePoint.fromMilliseconds(0)
    this.blockNum = blockNum || 0
    this.store = store || new TableStore()
  }

  public async applyTransaction (transaction: Transaction, decodedData?: any) {
    await this.resetTransaction()

    let actionOrdinal = -1
    let executionOrder = -1

    // Take storage snapshot
    if (this.isStorageDeltasEnabled) {
      this.preStorage = this.getStorage()
    }

    for (const action of transaction.actions) {
      const contract = this.getAccount(action.account)
      if (!contract || !contract.isContract) {
        throw new Error(`Contract ${action.account} missing for inline action`)
      }

      let context = new VM.Context({
        receiver: contract,
        firstReceiver: contract,
        action: action.name,
        data: action.data.array,
        authorization: action.authorization,
        transaction,
        decodedData
      })

      let actionsQueue = [context]
      let notificationsQueue = []

      while(notificationsQueue.length || actionsQueue.length) {
        // Shift context and increment orders
        if (notificationsQueue.length) {
          context = notificationsQueue.shift()
          context.actionOrdinal = actionOrdinal;
        } else if (actionsQueue.length) {
          context = actionsQueue.shift();
          context.actionOrdinal = ++actionOrdinal;
        }
        context.executionOrder = ++executionOrder;

        // Add to action traces
        this.actionTraces.push(context)
        this.executionTraces.push(contextToExecutionTrace(context))
        logExecutionTrace(this.executionTraces[this.executionTraces.length - 1])

        // Execute context
        context.receiver.vm.apply(context)

        // Add to local queues
        notificationsQueue = notificationsQueue.concat(context.notificationsQueue)
        if (context.isNotification) {
          actionsQueue = actionsQueue.concat(context.actionsQueue)
        } else {
          actionsQueue = context.actionsQueue.concat(actionsQueue)
        }
      }
    }

    if (this.isStorageDeltasEnabled) {
      this.postStorage = this.getStorage()
      this.setStorageDeltas()
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
  createAccounts (...accounts: string[]): Account[] {
    const createdAccounts: Account[] = []
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
        return new Uint8Array(await res.arrayBuffer())
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
  * @param [enableInline=false] - If true, the contract will send inline. If false, it will send to a new
  * account.
  * @returns The contract account.
  */
  createContract (name: NameType, folder: string, enableInline = true) {
    return this.createAccount({
        name: Name.from(name),
        wasm: this.readWasm(`${folder}.wasm`),
        abi: this.readAbi(`${folder}.abi`),
        enableInline
    });
  }

  /**
   * Time
   */
  public setTime (time: TimePoint | TimePointSec) {
    this.timestamp = TimePoint.fromMilliseconds(time.toMilliseconds())
  }
  public addTime (time: TimePoint | TimePointSec) {
    const msToAdd = time.toMilliseconds()
    this.blockNum += msToAdd / 500
    this.timestamp = TimePoint.fromMilliseconds(this.timestamp.toMilliseconds() + msToAdd)
  }
  public subtractTime (time: TimePoint | TimePointSec) {
    if (this.timestamp.toMilliseconds() < time.toMilliseconds()) {
      throw new Error(`Blockchain time must not go negative`)
    }
    const msToSub = time.toMilliseconds()
    this.blockNum -= msToSub / 500
    this.timestamp = TimePoint.fromMilliseconds(this.timestamp.toMilliseconds() - msToSub)
  }
  public addBlocks(numberOfBlocks: number) {
    this.addTime(TimePoint.fromMilliseconds(numberOfBlocks * 500))
  }

  /**
   * Reset
   */
  async resetTransaction () {
    await this.resetVm()
    this.clearConsole()
  }

  async resetVm () {
    this.preStorage = undefined
    this.postStorage = undefined
    this._storageDeltas = undefined
    this.actionTraces = []
    this.executionTraces = []
    await Promise.all(Object.values(this.accounts).map(account => account.recreateVm()))
  }

  public clearConsole () {
    this.console = ''
  }

  public resetTables (store?: TableStore) {
    this.store = store || new TableStore()
  }

  /**
   * Storage
   */
  get storageDeltas () {
    if (!this.isStorageDeltasEnabled) {
      throw new Error('Storage deltas are not enabled (use enableStorageDeltas)')
    }

    return this._storageDeltas
  }

  public enableStorageDeltas() {
    this.isStorageDeltasEnabled = true
  }

  public disableStorageDeltas() {
    this.isStorageDeltasEnabled = false
  }

  public printStorageDeltas() {
    const stringifyWithBigInt = (json) => JSON.stringify(json, (key, value) => {
      return typeof value === 'bigint' ? value.toString() : value
    }, 4)

    let storageDeltasJson = stringifyWithBigInt(this.storageDeltas)
    storageDeltasJson = findStartAndEnd(storageDeltasJson, `"new":`, colors.green)
    storageDeltasJson = findStartAndEnd(storageDeltasJson, `"old":`, colors.red)

    console.log(storageDeltasJson)
  }

  public getStorage() {
    const indexes = ['idx64', 'idx128', 'idx256', 'idxDouble']
    const rowsByTable = {}

    const secondaryTableToPrimary = (sec: string) => {
      if (sec.length === 13) {
        sec = sec.slice(0, -1)
      }

      return sec.replace(/\.+$/, "")
    }

    const convertSecondary = (indexType, value) => {
      const obj: {
        type: string,
        value: any,
        rawValue?: any
      } = {
        type: indexType,
        value: value
      }

      if (indexType === 'idx64') {
        obj.type = 'idxu64'
      } else if (indexType === 'idx128') {
        obj.type = 'idxU128'
        const buf = Buffer.alloc(16)
        SecondaryKeyConverter.uint128.to(buf, value)
        obj.rawValue = buf.slice()
      } else if (indexType === 'idx256') {
        const convertedValue = SecondaryKeyConverter.checksum256.from(value)
        obj.value = Checksum256.from(convertedValue).hexString
        obj.type = 'idxU256'
      } else if (indexType === 'idxDouble') {
        const buf = Buffer.alloc(8)
        buf.writeDoubleLE(value)
        obj.value = buf.readDoubleBE().toString()
        obj.type = 'idxf64'
      }

      return obj
    }

    // Get all primary rows
    for (const tab of Array.from(this.store.prefixesIndex.values()) as Table[]) {
      const codeName = bigIntToName(tab.code).toString()
      const scopeName = bigIntToName(tab.scope).toString() || '.'
      const tableName = secondaryTableToPrimary(bigIntToName(tab.table).toString())

      if (!rowsByTable[codeName]) {
        rowsByTable[codeName] = {}
      }

      if (!rowsByTable[codeName][tableName]) {
        rowsByTable[codeName][tableName] = {}
      }

      if (!rowsByTable[codeName][tableName][scopeName]) {
        rowsByTable[codeName][tableName][scopeName] = []
      }

      let value = tab.lowerbound(tab.lowestKey())

      while (value) {
        const primaryObj: {
          primaryKey: bigint,
          payer: string,
          value: any,
          secondaryIndexes?: {
            type: string,
            value: any,
            rawValue?: any
          }[]
        } = {
          primaryKey: value.primaryKey,
          payer: bigIntToName(value.payer).toString(),
          value: this.accounts[codeName].tables[tableName](tab.scope).getTableRow(value.primaryKey)
        }

        for (const index of indexes) {
          const secondaryObj = this.store[index].get({
            tableId: value.tableId,
            primaryKey: value.primaryKey
          });

          if (secondaryObj) {
            if (!primaryObj.secondaryIndexes) {
              primaryObj.secondaryIndexes = []
            }
            primaryObj.secondaryIndexes.push(convertSecondary(index, secondaryObj.secondaryKey))
          }
        }

        rowsByTable[codeName][tableName][scopeName].push(primaryObj)
        value = tab.next(value.primaryKey)
      }
    }

    return rowsByTable
  }

  private setStorageDeltas() {
    this.storageDeltaChangesets = flattenChangeset(diff(this.preStorage, this.postStorage))

    let parsedDiff = {}

    for (const change of this.storageDeltaChangesets) {
      change.path = change.path.slice(2).split('|')
      const [account, table, scope, index] = change.path
      // console.log(account, table, scope, index, change.type, change.key)
      const fill = (storage: any) => {
        let path = []
        if (account) {
          if (table) {
            if (scope) {
              path = [account, table, scope, index]
              set(parsedDiff, path, storage[account][table][scope][index])
            } else {
              path = [account, table, change.key]
              set(parsedDiff, [account, table, change.key], storage[account][table][change.key])
            }
          } else {
            path = [account, change.key]
            set(parsedDiff, path, storage[account][change.key])
          }
        } else {
          path = [change.key]
          parsedDiff = { ...parsedDiff, ...change.value }
        }
        return path
      }

      if (change.type === Operation.UPDATE) {
        set(parsedDiff, [account, table, scope, index], this.preStorage[account][table][scope][index])
        set(parsedDiff, change.path, {
          old: change.oldValue,
          new: change.value
        })
        parsedDiff[account][table][scope] = parsedDiff[account][table][scope].filter(_ => !!_)
      } else if (change.type === Operation.ADD) {
        const path = fill(this.postStorage)
        set(parsedDiff, path, { new: change.value })
      } else if (change.type === Operation.REMOVE) {
        // fill(this.preStorage)
        // set(parsedDiff, change.path, { old: change.value })
      }
    }

    this._storageDeltas = parsedDiff
  }
}
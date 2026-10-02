import {VM} from "./vm";
import { TableView } from "./table";
import { API, ABI, Name, type NameType, PermissionLevel, type PermissionLevelType, Serializer, Transaction, type ABIDef, TransactionHeader, TimePoint } from "@greymass/eosio";
import { bnToBigInt, nameToBigInt } from "./bn";
import { Blockchain } from "./blockchain";
import { generatePermissions, addInlinePermission } from "./utils";
import BN from "bn.js";

export type AccountArgs = Omit<Partial<Account>, 'name'|'abi'|'wasm'> & {
  name: NameType,
  abi?: ABIDef | Promise<ABIDef>;
  wasm?: Uint8Array | Promise<Uint8Array>;
  enableInline?: boolean;
}

function isPromise(promise: any) {
  return !!promise && typeof promise.then === 'function'
}

type ActionData = any[] | object

export class Account {
  readonly name: Name;
  readonly bc: Blockchain;
  readonly creationTime: TimePoint;

  readonly actions: {
    [key: string]: (actionData?: ActionData) => {
      send: (authorization?: string | PermissionLevelType | PermissionLevelType[], options?: Partial<TransactionHeader>) => Promise<void>
    }
  } = {};
  readonly tables: {
    [key: string]: (scope?: bigint | BN) => TableView
  } = {};

  public permissions: API.v1.AccountPermission[] = [];
  public wasm?: Uint8Array;
  public codeSequence: number = 0;
  public abi?: ABI;
  public vm?: VM;

  constructor (args: AccountArgs) {
    this.name = Name.from(args.name)
    this.bc = args.bc as Blockchain
    this.creationTime = this.bc.timestamp

    // Permissions
    this.permissions = args.permissions || generatePermissions(this.name) as any
    if (args.enableInline) {
      addInlinePermission(this.name, this.permissions)
    }

    if (args.abi && args.wasm) {
      if (isPromise(args.abi) || isPromise(args.wasm)) {
        Promise
          .all([args.abi, args.wasm])
          .then(([abi, wasm]) => this.setContract(abi, wasm))
      } else {
        this.setContract(args.abi as ABIDef, args.wasm as Uint8Array)
      }
    }
  }

  get isContract () {
    return !!this.abi && !!this.wasm
  }

  toBigInt () {
    return nameToBigInt(this.name)
  }

  public async recreateVm () {
    if (this.wasm) {
      this.vm = VM.from(this.wasm, this.bc);
      await this.vm.ready
    }
  }

  setContract (abi: ABIDef, wasm: Uint8Array) {
    this.abi = ABI.from(abi)
    this.wasm = wasm
    this.codeSequence++;
    this.buildActions()
    this.buildTables()
  }

  setPermissions (permissions: API.v1.AccountPermission[]) {
    this.permissions = permissions
  }

  buildActions () {
    const abi = this.abi
    if(abi) {
    abi.actions.forEach((action) => {
      const resolved = abi.resolveType(action.name.toString());
      const fields = resolved.fields;

      this.actions[resolved.name] = (actionData?: ActionData) => {
        const data: Record<string, any> = {};

        if(fields) {
          if (Array.isArray(actionData)) {
            actionData.forEach((arg, i) => data[fields[i].name] = arg);
          } else {
            for (const field of fields) {
              if (!field.type.isOptional && !Object.prototype.hasOwnProperty.call(actionData, field.name)) {
                throw new Error(`Missing field ${field.name} on action ${action.name}`);
              }

              if (Object.prototype.hasOwnProperty.call(actionData, field.name)) {
                data[field.name] = (actionData as any)[field.name]
              }
            }
          }
        }

        const serializedData = Serializer.encode({
          abi: abi,
          type: action.name as string,
          object: data,
        }).array;

        return {
          send: async (authorization?: string | PermissionLevelType | PermissionLevelType[], options?: Partial<TransactionHeader>) => {
            // .send()
            if (!authorization) {
              authorization = `${this.name}@active`;
            }
            // .send("account")
            else if ( typeof authorization == "string" && !authorization.includes("@") ) {
              authorization += '@active';
            }

            await this.bc.applyTransaction(Transaction.from({
              actions: [{
                account: this.name,
                name: Name.from(action.name),
                data: serializedData,
                authorization: (Array.isArray(authorization) ? authorization : [authorization]).map(_ => PermissionLevel.from(_))
              }],
              expiration: 0,
              ref_block_num: 0,
              ref_block_prefix: 0,
              ...(options || {})
            }), data)
          }
        }
      }
    });
    }
  }

  buildTables () {
    const abi = this.abi
    if(abi) {
      abi.tables.forEach((table) => {
        const resolved = abi.resolveType(table.name as string);

        this.tables[resolved.name] = (scope: bigint | BN = nameToBigInt(this.name)): TableView => {
          if (BN.isBN(scope)) {
            scope = bnToBigInt(scope)
          }
          
          let tab = this.bc.store.findTable(nameToBigInt(this.name), scope, nameToBigInt(Name.from(resolved.name)));
          if (!tab) {
            tab = this.bc.store.createTable(nameToBigInt(this.name), scope, nameToBigInt(Name.from(resolved.name)), nameToBigInt(this.name))
          }

          return new TableView(tab, abi, this.bc);
        }
      });
    }
  }
}
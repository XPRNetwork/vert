import { Struct, VarUInt, UInt64, UInt8, Checksum256 } from "@greymass/eosio"

@Struct.type('code_hash')
export class CodeHashResult extends Struct {
    @Struct.field('varuint32', {default: 0}) struct_version!: VarUInt
    @Struct.field('uint64', { default: 0 }) code_sequence!: UInt64
    @Struct.field('checksum256') code_hash!: Checksum256
    @Struct.field('uint8', { default: 0 }) vm_type!: UInt8
    @Struct.field('uint8', { default: 0 }) vm_version!: UInt8
}

import { DataType } from "./dataType";
import { Function } from "./function";
import { Parameter } from "./parameter";
import { Signature } from "./signature";

const cfTagAttributePattern = /<((cf[a-z_]+)\s+)([^<>]*)$/i;

export interface GlobalEntity {
  name: string;
  syntax: string;
  description: string;
  signatures: Signature[];
}
export interface GlobalFunction extends GlobalEntity, Function {
  name: string;
  syntax: string;
  description: string;
  returntype: DataType;
  signatures: Signature[];
}
export interface GlobalFunctions {
  [name: string]: GlobalFunction;
}
export interface MemberFunction extends Function {
  name: string;
  syntax: string;
  description: string;
  returntype: DataType;
  signatures: Signature[];
}
export interface MemberFunctionsByType extends Map<DataType, Set<MemberFunction>> { }
export interface GlobalTag extends GlobalEntity {
  name: string;
  syntax: string;
  description: string;
  signatures: Signature[];
  hasScript: boolean;
  hasBody: boolean;
}
export interface GlobalTags {
  [name: string]: GlobalTag;
}

/**
 * (Unimplemented)
 * Returns the data type of the member function variant of the given global function
 * @param functionName The global function name
 */
export function getMemberFunctionType(functionName: string): DataType {
  return DataType.Any;
}

/**
 * Returns a pattern that matches the most recent unclosed cf-tag, capturing the name and attributes
 */
export function getCfTagAttributePattern(): RegExp {
  return cfTagAttributePattern;
}
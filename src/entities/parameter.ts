import { DataType } from "./dataType";
import { Argument } from "./userFunction";
import { Utils } from "vscode-uri";

export interface Parameter {
  name: string;
  description: string;
  type: string;
  dataType: DataType;
  required: boolean;
  default?: string;
  enumeratedValues?: string[];
}

export const namedParameterPattern: RegExp = /^\s*([\w$]+)\s*=(?!=)/;

/**
 * Gets the parameter's name
 * @param param The Parameter object from which to get the name
 */
export function getParameterName(param: Parameter): string {
  return param.name.split("=")[0];
}

/**
 * Constructs a string label representation of a parameter
 * @param param The Parameter object on which to base the label
 */
export function constructParameterLabel(param: Parameter): string {
  let paramLabel = getParameterName(param);
  if (!param.required) {
    paramLabel += "?";
  }

  if ( param.dataType ) {
    let paramType: string = param.dataType.toLowerCase();
    if (param.dataType === DataType.Component) {
        const arg: Argument = param as Argument;
        if (arg.dataTypeComponentUri) {
            paramType = Utils.basename(arg.dataTypeComponentUri);
        }
    }

    paramLabel += ": " + paramType;
  } else if ( param.type ) {
    paramLabel += ": " + param.type;
  } else {
    paramLabel += ": unknown";
  }

  return paramLabel;
}

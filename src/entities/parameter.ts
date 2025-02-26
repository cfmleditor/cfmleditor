import { uriBaseName } from "../utils/fileUtil";
import { COMPONENT_EXT } from "./component";
import { DataType } from "./dataType";
import { Argument } from "./userFunction";

export interface Parameter {
  name: string;
  description: string | undefined;
  type: string | undefined;
  dataType: DataType;
  required: boolean;
  default?: string;
  enumeratedValues?: string[];
}

export const namedParameterPattern: RegExp = /^\s*([\w$]+)\s*=(?!=)/;

/**
 * Gets the parameter's name
 * @param param The Parameter object from which to get the name
 * @returns
 */
export function getParameterName(param: Parameter): string {
  return param.name.split("=")[0];
}

/**
 * Constructs a string label representation of a parameter
 * @param param The Parameter object on which to base the label
 * @returns
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
            paramType = uriBaseName(arg.dataTypeComponentUri, COMPONENT_EXT);
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

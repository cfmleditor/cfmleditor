import { equalsIgnoreCase } from "./textUtil";

export class MyMap<K, V> extends Map<K, V> {
  /**
   * Creates a new `MyMap` with all elements that pass the test implemented by the provided function.
   * @param callbackfn A predicate to test each key-value pair of the map
   * @returns
   */
  public filter(callbackfn: (value: V, key: K, map: MyMap<K, V>) => boolean): MyMap<K, V> {
    const myMap = new MyMap<K, V>();
    this.forEach((value: V, key: K) => {
      if (callbackfn(value, key, this)) {
        myMap.set(key, value);
      }
    });

    return myMap;
  }
}

export class MySet<T> extends Set<T> {
  /**
   * Creates a new `MySet` with all elements that pass the test implemented by the provided function.
   * @param callbackfn A predicate to test each element of the set
   * @returns
   */
  public filter(callbackfn: (value: T, value2: T, set: MySet<T>) => boolean): MySet<T> {
    const mySet = new MySet<T>();
    this.forEach((value: T, value2: T) => {
      if (callbackfn(value, value2, this)) {
        mySet.add(value);
      }
    });

    return mySet;
  }
}

/**
 * Returns whether the given `str` is contained within the given `arr` ignoring case
 * @param arr The string array within which to search
 * @param str The string for which to check
 * @returns
 */
export function stringArrayIncludesIgnoreCase(arr: string[], str: string): boolean {
  return arr.some((val: string) => {
    return equalsIgnoreCase(val, str);
  });
}

// TODO: Find a better place for this
export interface NameWithOptionalValue<T> {
  name: string;
  value?: T;
}

// TODO: Find a better place for this
export enum SearchMode {
  StartsWith,
  Contains,
  EqualTo,
}

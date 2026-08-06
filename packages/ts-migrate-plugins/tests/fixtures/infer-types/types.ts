export interface Options {
  host: string;
}

export declare const options: Options;

export function connect(target: Options): string {
  return target.host;
}
